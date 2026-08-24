const { pool, query } = require('../config/db');

const ESTADOS_ACTIVOS = ['pendiente', 'confirmado'];

// Trae los turnos (activos o no) que se solapan con el rango [inicio, fin).
// Se usa antes de insertar para poder devolver un 409 con un mensaje claro.
// La proteccion definitiva contra condiciones de carrera es la constraint
// "no_solapamiento_turnos" (EXCLUDE USING gist) definida en schema.sql: si dos
// requests concurrentes pasan este chequeo a la vez, el INSERT que llegue
// segundo va a fallar igual con el error de Postgres 23P01 (ver crear()).
async function buscarSolapados(fechaHoraInicio, fechaHoraFin, { excluirTurnoId = null } = {}) {
  const params = [fechaHoraInicio, fechaHoraFin, ESTADOS_ACTIVOS];
  let sql = `
    SELECT id, fecha_hora_inicio, fecha_hora_fin
    FROM turnos
    WHERE estado = ANY($3::text[])
      AND (fecha_hora_inicio, fecha_hora_fin) OVERLAPS ($1::timestamptz, $2::timestamptz)
  `;
  if (excluirTurnoId) {
    params.push(excluirTurnoId);
    sql += ` AND id != $4`;
  }
  const { rows } = await query(sql, params);
  return rows;
}

function mapTurnoRow(row) {
  return {
    id: row.id,
    usuarioId: row.usuario_id,
    fechaHoraInicio: row.fecha_hora_inicio,
    fechaHoraFin: row.fecha_hora_fin,
    duracionTotalMinutos: row.duracion_total_minutos,
    precioTotal: Number(row.precio_total),
    estado: row.estado,
    creadoEn: row.creado_en,
    clienteNombre: row.cliente_nombre,
    clienteEmail: row.cliente_email,
    servicios: row.servicios || [],
  };
}

const SELECT_TURNO_CON_SERVICIOS = `
  SELECT
    t.*,
    u.nombre AS cliente_nombre,
    u.email AS cliente_email,
    COALESCE(
      json_agg(
        json_build_object('id', s.id, 'nombre', s.nombre, 'duracion_minutos', s.duracion_minutos, 'precio', s.precio)
        ORDER BY s.nombre
      ) FILTER (WHERE s.id IS NOT NULL),
      '[]'
    ) AS servicios
  FROM turnos t
  JOIN usuarios u ON u.id = t.usuario_id
  LEFT JOIN turno_servicios ts ON ts.turno_id = t.id
  LEFT JOIN servicios s ON s.id = ts.servicio_id
`;

async function listarTodos() {
  const { rows } = await query(
    `${SELECT_TURNO_CON_SERVICIOS} GROUP BY t.id, u.nombre, u.email ORDER BY t.fecha_hora_inicio DESC`
  );
  return rows.map(mapTurnoRow);
}

async function listarPorUsuario(usuarioId) {
  const { rows } = await query(
    `${SELECT_TURNO_CON_SERVICIOS} WHERE t.usuario_id = $1 GROUP BY t.id, u.nombre, u.email ORDER BY t.fecha_hora_inicio DESC`,
    [usuarioId]
  );
  return rows.map(mapTurnoRow);
}

async function buscarPorId(id) {
  const { rows } = await query(
    `${SELECT_TURNO_CON_SERVICIOS} WHERE t.id = $1 GROUP BY t.id, u.nombre, u.email`,
    [id]
  );
  return rows[0] ? mapTurnoRow(rows[0]) : null;
}

// Crea el turno y sus servicios asociados dentro de una transaccion.
// servicios: array de filas de la tabla servicios (ya validadas/leidas en el controller).
async function crear({ usuarioId, fechaHoraInicio, fechaHoraFin, duracionTotalMinutos, precioTotal, servicioIds }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const insertTurno = await client.query(
      `INSERT INTO turnos (usuario_id, fecha_hora_inicio, fecha_hora_fin, duracion_total_minutos, precio_total, estado)
       VALUES ($1, $2, $3, $4, $5, 'pendiente')
       RETURNING id`,
      [usuarioId, fechaHoraInicio, fechaHoraFin, duracionTotalMinutos, precioTotal]
    );
    const turnoId = insertTurno.rows[0].id;

    for (const servicioId of servicioIds) {
      await client.query(
        `INSERT INTO turno_servicios (turno_id, servicio_id) VALUES ($1, $2)`,
        [turnoId, servicioId]
      );
    }

    await client.query('COMMIT');
    return turnoId;
  } catch (err) {
    await client.query('ROLLBACK');
    // 23P01 = exclusion_violation -> otro turno ya ocupa ese horario.
    // Lo traducimos a un error de dominio prolijo para que el controller lo maneje.
    if (err.code === '23P01') {
      const conflictError = new Error('El horario elegido se solapa con otro turno existente.');
      conflictError.status = 409;
      conflictError.code = 'TURNO_SOLAPADO';
      throw conflictError;
    }
    throw err;
  } finally {
    client.release();
  }
}

async function actualizarEstado(id, nuevoEstado) {
  const { rows } = await query(
    `UPDATE turnos SET estado = $2 WHERE id = $1 RETURNING id, estado`,
    [id, nuevoEstado]
  );
  return rows[0] || null;
}

module.exports = {
  buscarSolapados,
  listarTodos,
  listarPorUsuario,
  buscarPorId,
  crear,
  actualizarEstado,
};

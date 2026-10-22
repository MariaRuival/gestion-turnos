const { query } = require('../config/db');

async function listarActivos() {
  const { rows } = await query(
    'SELECT id, nombre, duracion_minutos, precio FROM servicios WHERE activo = true ORDER BY nombre'
  );
  return rows;
}

// Trae los servicios que coinciden con los ids pedidos (y estan activos).
// Se usa para validar la eleccion del cliente y calcular los totales en el backend.
async function buscarPorIds(ids) {
  if (!ids || ids.length === 0) return [];
  const { rows } = await query(
    `SELECT id, nombre, duracion_minutos, precio
     FROM servicios
     WHERE id = ANY($1::int[]) AND activo = true`,
    [ids]
  );
  return rows;
}

async function crear({ nombre, duracionMinutos, precio }) {
  const { rows } = await query(
    `INSERT INTO servicios (nombre, duracion_minutos, precio)
     VALUES ($1, $2, $3)
     RETURNING id, nombre, duracion_minutos, precio, activo`,
    [nombre, duracionMinutos, precio]
  );
  return rows[0];
}

// Borrado logico: el servicio deja de listarse y de poder elegirse para turnos
// nuevos, pero los turnos viejos que lo referencian (turno_servicios) siguen
// intactos. Devuelve false si el id no existe.
async function desactivar(id) {
  const { rowCount } = await query('UPDATE servicios SET activo = false WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = { listarActivos, buscarPorIds, crear, desactivar };

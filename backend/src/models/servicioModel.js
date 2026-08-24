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

module.exports = { listarActivos, buscarPorIds };

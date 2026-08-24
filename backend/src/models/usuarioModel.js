const { query } = require('../config/db');

async function buscarPorEmail(email) {
  const { rows } = await query('SELECT * FROM usuarios WHERE email = $1', [email]);
  return rows[0] || null;
}

async function buscarPorId(id) {
  const { rows } = await query(
    'SELECT id, nombre, email, rol, creado_en FROM usuarios WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

async function crear({ nombre, email, passwordHash, rol }) {
  const { rows } = await query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol)
     VALUES ($1, $2, $3, $4)
     RETURNING id, nombre, email, rol, creado_en`,
    [nombre, email, passwordHash, rol]
  );
  return rows[0];
}

module.exports = { buscarPorEmail, buscarPorId, crear };

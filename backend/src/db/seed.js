// Carga datos de demo: un admin, dos clientes y algunos servicios.
// Es idempotente (usa ON CONFLICT DO NOTHING), se puede correr mas de una vez.
// Uso: npm run seed  (dentro de /backend, con el .env ya configurado)
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');

const USUARIOS_DEMO = [
  { nombre: 'Admin', email: 'admin@negocio.com', password: 'Admin123!', rol: 'admin' },
  { nombre: 'Cliente Uno', email: 'cliente1@mail.com', password: 'Cliente123!', rol: 'cliente' },
  { nombre: 'Cliente Dos', email: 'cliente2@mail.com', password: 'Cliente123!', rol: 'cliente' },
];

const SERVICIOS_DEMO = [
  { nombre: 'Corte de cabello', duracion_minutos: 30, precio: 4000 },
  { nombre: 'Coloracion', duracion_minutos: 90, precio: 12000 },
  { nombre: 'Manicura', duracion_minutos: 45, precio: 5000 },
  { nombre: 'Consulta general', duracion_minutos: 20, precio: 3000 },
];

async function seed() {
  for (const u of USUARIOS_DEMO) {
    const hash = await bcrypt.hash(u.password, 10);
    await pool.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING`,
      [u.nombre, u.email, hash, u.rol]
    );
  }

  for (const s of SERVICIOS_DEMO) {
    const { rows } = await pool.query(
      `SELECT id FROM servicios WHERE nombre = $1`,
      [s.nombre]
    );
    if (rows.length === 0) {
      await pool.query(
        `INSERT INTO servicios (nombre, duracion_minutos, precio) VALUES ($1, $2, $3)`,
        [s.nombre, s.duracion_minutos, s.precio]
      );
    }
  }

  console.log('Seed completado. Usuarios de demo:');
  USUARIOS_DEMO.forEach((u) => console.log(`  - ${u.rol}: ${u.email} / ${u.password}`));
}

seed()
  .catch((err) => {
    console.error('Error corriendo el seed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

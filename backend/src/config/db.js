// Configuracion de conexion a PostgreSQL.
// La cadena de conexion sale siempre de variables de entorno (.env via dotenv),
// nunca esta hardcodeada aca.
const { Pool } = require('pg');

// Si existe DATABASE_URL se usa directamente (util para Docker/plataformas cloud).
// Si no, se arma la conexion con las variables sueltas PGHOST/PGPORT/etc.
const connectionConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT) || 5432,
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
    };

const pool = new Pool(connectionConfig);

pool.on('error', (err) => {
  // Error en un cliente inactivo del pool: lo logueamos, no tiramos el proceso.
  console.error('Error inesperado en el pool de PostgreSQL', err);
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};

require('dotenv').config();

const REQUERIDAS = ['JWT_SECRET'];
const faltantes = REQUERIDAS.filter((k) => !process.env[k]);
if (faltantes.length > 0) {
  console.error(`Faltan variables de entorno obligatorias: ${faltantes.join(', ')}`);
  console.error('Revisa tu archivo .env (podes basarte en .env.example).');
  process.exit(1);
}

const app = require('./app');

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API de gestion de turnos escuchando en http://localhost:${PORT}`);
});

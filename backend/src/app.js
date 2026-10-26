// Sentry va primero: tiene que inicializarse antes de que se cargue Express
// para poder instrumentarlo. Sin SENTRY_DSN (local, QA) queda inactivo y no
// manda nada; solo PROD tiene la variable seteada.
const Sentry = require('@sentry/node');

Sentry.init({
  dsn: process.env.SENTRY_DSN || '',
  tracesSampleRate: 1.0,
  debug: true,
});

const express = require('express');
const cors = require('cors');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const { pool } = require('./config/db');

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// Publico, sin auth: lo usa el smoke test del pipeline. SELECT 1 prueba que
// la base contesta, y el commit prueba QUE version corre: lo setea Render si
// el servicio es git-backed, o viene horneado en la imagen (GIT_SHA).
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', commit: process.env.RENDER_GIT_COMMIT || process.env.GIT_SHA || null });
  } catch (err) {
    console.error('Health check fallo:', err.message);
    res.status(500).json({ status: 'error' });
  }
});

app.use('/api', routes);

app.use((req, res) => res.status(404).json({ error: 'Recurso no encontrado.' }));
// El de Sentry va ANTES del nuestro: reporta el error y lo pasa con next(err),
// y errorHandler arma la respuesta JSON como siempre.
Sentry.setupExpressErrorHandler(app);
app.use(errorHandler);

module.exports = app;

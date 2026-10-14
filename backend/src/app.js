const express = require('express');
const cors = require('cors');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const { pool } = require('./config/db');

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// Publico, sin auth: lo usa el smoke test del pipeline. SELECT 1 prueba que
// la base contesta, y el commit (lo setea Render) prueba QUE version corre.
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', commit: process.env.RENDER_GIT_COMMIT || null });
  } catch (err) {
    console.error('Health check fallo:', err.message);
    res.status(500).json({ status: 'error' });
  }
});

app.use('/api', routes);

app.use((req, res) => res.status(404).json({ error: 'Recurso no encontrado.' }));
app.use(errorHandler);

module.exports = app;

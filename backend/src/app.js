const express = require('express');
const cors = require('cors');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

app.use('/api', routes);

app.use((req, res) => res.status(404).json({ error: 'Recurso no encontrado.' }));
app.use(errorHandler);

module.exports = app;

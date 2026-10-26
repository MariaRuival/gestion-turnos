const express = require('express');
const authRoutes = require('./authRoutes');
const servicioRoutes = require('./servicioRoutes');
const turnoRoutes = require('./turnoRoutes');

const router = express.Router();

router.get('/salud', (req, res) => res.json({ ok: true }));

// TEMPORAL (demo TP9): falla a proposito para ver el error llegar a Sentry.
router.get('/falla', () => {
  throw new Error('Falla de prueba del TP9');
});

router.use('/auth', authRoutes);
router.use('/servicios', servicioRoutes);
router.use('/turnos', turnoRoutes);

module.exports = router;

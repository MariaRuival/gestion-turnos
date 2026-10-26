const express = require('express');
const authRoutes = require('./authRoutes');
const servicioRoutes = require('./servicioRoutes');
const turnoRoutes = require('./turnoRoutes');

const router = express.Router();

router.get('/salud', (req, res) => res.json({ ok: true }));
router.use('/auth', authRoutes);
router.use('/servicios', servicioRoutes);
router.use('/turnos', turnoRoutes);

module.exports = router;

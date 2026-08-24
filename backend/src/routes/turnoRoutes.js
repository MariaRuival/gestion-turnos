const express = require('express');
const turnoController = require('../controllers/turnoController');
const { requiereAutenticacion, requiereRol } = require('../middleware/auth');

const router = express.Router();

router.use(requiereAutenticacion);

// Cliente
router.post('/', requiereRol('cliente'), turnoController.crear);
router.get('/mios', requiereRol('cliente'), turnoController.listarMios);

// Admin
router.get('/', requiereRol('admin'), turnoController.listarTodos);
router.patch('/:id/confirmar', requiereRol('admin'), turnoController.confirmar);
router.patch('/:id/completar', requiereRol('admin'), turnoController.completar);

// Cancelar: cliente (solo lo suyo, validado en el controller) o admin (cualquiera).
router.patch('/:id/cancelar', requiereRol('cliente', 'admin'), turnoController.cancelar);

module.exports = router;

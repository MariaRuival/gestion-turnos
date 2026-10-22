const express = require('express');
const servicioController = require('../controllers/servicioController');
const { requiereAutenticacion, requiereRol } = require('../middleware/auth');

const router = express.Router();

router.get('/', requiereAutenticacion, servicioController.listar);

// Admin
router.post('/', requiereAutenticacion, requiereRol('admin'), servicioController.crear);
router.delete('/:id', requiereAutenticacion, requiereRol('admin'), servicioController.eliminar);

module.exports = router;

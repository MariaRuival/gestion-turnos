const express = require('express');
const servicioController = require('../controllers/servicioController');
const { requiereAutenticacion } = require('../middleware/auth');

const router = express.Router();

router.get('/', requiereAutenticacion, servicioController.listar);

module.exports = router;

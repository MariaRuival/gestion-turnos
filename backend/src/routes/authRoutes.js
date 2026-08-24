const express = require('express');
const authController = require('../controllers/authController');
const { requiereAutenticacion } = require('../middleware/auth');

const router = express.Router();

router.post('/login', authController.login);
router.post('/registro', authController.registro);
router.get('/yo', requiereAutenticacion, authController.yo);

module.exports = router;

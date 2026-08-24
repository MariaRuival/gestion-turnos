const servicioModel = require('../models/servicioModel');

// GET /api/servicios
async function listar(req, res, next) {
  try {
    const servicios = await servicioModel.listarActivos();
    res.json({ servicios });
  } catch (err) {
    next(err);
  }
}

module.exports = { listar };

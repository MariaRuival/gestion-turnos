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

const NOMBRE_MAX = 120; // VARCHAR(120) en schema.sql

// POST /api/servicios (solo admin). Las validaciones replican los CHECK del
// schema para responder 400 con un mensaje claro en vez de un 500 de Postgres.
async function crear(req, res, next) {
  try {
    const { nombre, duracionMinutos, precio } = req.body || {};

    if (typeof nombre !== 'string' || nombre.trim() === '') {
      return res.status(400).json({ error: 'El nombre es obligatorio.' });
    }
    if (nombre.trim().length > NOMBRE_MAX) {
      return res.status(400).json({ error: `El nombre no puede superar los ${NOMBRE_MAX} caracteres.` });
    }
    if (!Number.isInteger(duracionMinutos) || duracionMinutos <= 0) {
      return res.status(400).json({ error: 'duracionMinutos debe ser un entero positivo.' });
    }
    if (typeof precio !== 'number' || !Number.isFinite(precio) || precio < 0) {
      return res.status(400).json({ error: 'precio debe ser un numero mayor o igual a 0.' });
    }

    const servicio = await servicioModel.crear({ nombre: nombre.trim(), duracionMinutos, precio });
    res.status(201).json({ servicio });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/servicios/:id (solo admin): borrado logico (activo = false).
async function eliminar(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'id invalido.' });
    }

    const desactivado = await servicioModel.desactivar(id);
    if (!desactivado) {
      return res.status(404).json({ error: 'Servicio no encontrado.' });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, crear, eliminar };

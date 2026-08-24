const turnoModel = require('../models/turnoModel');
const servicioModel = require('../models/servicioModel');
const {
  esTransicionValida,
  puedeCancelarPorTiempo,
  calcularTotales,
  HORAS_MINIMAS_PARA_CANCELAR,
} = require('../utils/turnoRules');

// POST /api/turnos  (solo cliente autenticado; el turno siempre se crea para si mismo)
async function crear(req, res, next) {
  try {
    const { fechaHoraInicio, servicioIds } = req.body;

    if (!fechaHoraInicio || !Array.isArray(servicioIds) || servicioIds.length === 0) {
      return res.status(400).json({ error: 'Se requiere fechaHoraInicio y al menos un servicio.' });
    }

    const inicio = new Date(fechaHoraInicio);
    if (Number.isNaN(inicio.getTime())) {
      return res.status(400).json({ error: 'fechaHoraInicio invalida.' });
    }
    if (inicio.getTime() < Date.now()) {
      return res.status(400).json({ error: 'No se puede reservar un turno en el pasado.' });
    }

    // Los servicios se releen de la base (nunca se confia en nombre/precio que mande el cliente).
    const servicios = await servicioModel.buscarPorIds(servicioIds);
    if (servicios.length !== new Set(servicioIds).size) {
      return res.status(400).json({ error: 'Alguno de los servicios elegidos no existe o no esta activo.' });
    }

    // Regla de negocio #2: duracion y precio total = suma de los servicios elegidos.
    const { duracionTotalMinutos, precioTotal } = calcularTotales(servicios);
    const fin = new Date(inicio.getTime() + duracionTotalMinutos * 60000);

    // Regla de negocio #1 (chequeo "amigable", con mensaje claro y sin usar
    // codigos de error de Postgres). La constraint EXCLUDE de la base de datos
    // es la que impide el solapamiento de forma definitiva ante concurrencia.
    const solapados = await turnoModel.buscarSolapados(inicio, fin);
    if (solapados.length > 0) {
      return res.status(409).json({ error: 'El horario elegido se solapa con otro turno existente.' });
    }

    const turnoId = await turnoModel.crear({
      usuarioId: req.usuario.id,
      fechaHoraInicio: inicio,
      fechaHoraFin: fin,
      duracionTotalMinutos,
      precioTotal,
      servicioIds,
    });

    const turno = await turnoModel.buscarPorId(turnoId);
    res.status(201).json({ turno });
  } catch (err) {
    next(err);
  }
}

// GET /api/turnos/mios (cliente: solo sus propios turnos - regla de negocio #5)
async function listarMios(req, res, next) {
  try {
    const turnos = await turnoModel.listarPorUsuario(req.usuario.id);
    res.json({ turnos });
  } catch (err) {
    next(err);
  }
}

// GET /api/turnos (solo admin: todos los turnos del negocio)
async function listarTodos(req, res, next) {
  try {
    const turnos = await turnoModel.listarTodos();
    res.json({ turnos });
  } catch (err) {
    next(err);
  }
}

async function obtenerTurnoAutorizado(req) {
  const turno = await turnoModel.buscarPorId(req.params.id);
  if (!turno) {
    const err = new Error('Turno no encontrado.');
    err.status = 404;
    throw err;
  }
  // Regla de negocio #5: un cliente nunca puede operar sobre el turno de otro usuario.
  if (req.usuario.rol === 'cliente' && turno.usuarioId !== req.usuario.id) {
    const err = new Error('No podes operar sobre un turno que no es tuyo.');
    err.status = 403;
    throw err;
  }
  return turno;
}

async function cambiarEstado(req, res, next, estadoNuevo) {
  try {
    const turno = await obtenerTurnoAutorizado(req);

    // Regla de negocio #3: maquina de estados explicita, sin excepciones.
    if (!esTransicionValida(turno.estado, estadoNuevo)) {
      return res.status(409).json({
        error: `No se puede pasar un turno de "${turno.estado}" a "${estadoNuevo}".`,
      });
    }

    // Regla de negocio #4: ventana minima de 24hs para cancelar.
    if (estadoNuevo === 'cancelado' && !puedeCancelarPorTiempo(turno.fechaHoraInicio)) {
      return res.status(409).json({
        error: `Solo se puede cancelar con al menos ${HORAS_MINIMAS_PARA_CANCELAR}hs de anticipacion.`,
      });
    }

    const actualizado = await turnoModel.actualizarEstado(turno.id, estadoNuevo);
    const turnoActualizado = await turnoModel.buscarPorId(actualizado.id);
    res.json({ turno: turnoActualizado });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/turnos/:id/cancelar (cliente sobre lo suyo, o admin sobre cualquiera)
function cancelar(req, res, next) {
  return cambiarEstado(req, res, next, 'cancelado');
}

// PATCH /api/turnos/:id/confirmar (solo admin)
function confirmar(req, res, next) {
  return cambiarEstado(req, res, next, 'confirmado');
}

// PATCH /api/turnos/:id/completar (solo admin)
function completar(req, res, next) {
  return cambiarEstado(req, res, next, 'completado');
}

module.exports = { crear, listarMios, listarTodos, cancelar, confirmar, completar };

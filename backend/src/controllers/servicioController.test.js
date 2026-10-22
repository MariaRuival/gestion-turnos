jest.mock('../models/servicioModel');

const servicioModel = require('../models/servicioModel');
const servicioController = require('./servicioController');

function crearResMock() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.end = jest.fn().mockReturnValue(res);
  return res;
}

describe('servicioController.crear', () => {
  const bodyValido = { nombre: 'Peinado', duracionMinutos: 40, precio: 2500.5 };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['nombreVacio', { nombre: '' }],
    ['nombreSoloEspacios', { nombre: '   ' }],
    ['nombreDeMasDe120Caracteres', { nombre: 'a'.repeat(121) }],
    ['duracionNoEntera', { duracionMinutos: 12.5 }],
    ['duracionCero', { duracionMinutos: 0 }],
    ['duracionNegativa', { duracionMinutos: -10 }],
    ['precioNegativo', { precio: -1 }],
    ['precioComoString', { precio: '100' }],
  ])('%s_respondeBadRequestYNoCreaElServicio', async (_caso, cambio) => {
    // Arrange
    const req = { body: { ...bodyValido, ...cambio } };
    const res = crearResMock();
    const next = jest.fn();

    // Act
    await servicioController.crear(req, res, next);

    // Assert
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: expect.any(String) });
    expect(servicioModel.crear).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('datosValidos_creaElServicioConNombreRecortadoYRespondeCreado', async () => {
    // Arrange
    const req = { body: { ...bodyValido, nombre: '  Peinado  ' } };
    const res = crearResMock();
    const next = jest.fn();
    const servicioCreado = {
      id: 5,
      nombre: 'Peinado',
      duracion_minutos: 40,
      precio: '2500.50',
      activo: true,
    };
    servicioModel.crear.mockResolvedValue(servicioCreado);

    // Act
    await servicioController.crear(req, res, next);

    // Assert
    expect(servicioModel.crear).toHaveBeenCalledTimes(1);
    expect(servicioModel.crear).toHaveBeenCalledWith({
      nombre: 'Peinado',
      duracionMinutos: 40,
      precio: 2500.5,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ servicio: servicioCreado });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('servicioController.eliminar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('servicioExistente_loDesactivaYRespondeSinContenido', async () => {
    // Arrange
    const req = { params: { id: '5' } };
    const res = crearResMock();
    const next = jest.fn();
    servicioModel.desactivar.mockResolvedValue(true);

    // Act
    await servicioController.eliminar(req, res, next);

    // Assert
    expect(servicioModel.desactivar).toHaveBeenCalledWith(5);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('servicioInexistente_respondeNoEncontrado', async () => {
    // Arrange
    const req = { params: { id: '99999' } };
    const res = crearResMock();
    const next = jest.fn();
    servicioModel.desactivar.mockResolvedValue(false);

    // Act
    await servicioController.eliminar(req, res, next);

    // Assert
    expect(servicioModel.desactivar).toHaveBeenCalledWith(99999);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Servicio no encontrado.' });
  });

  it('idNoNumerico_respondeBadRequestYNoTocaLaBase', async () => {
    // Arrange
    const req = { params: { id: 'abc' } };
    const res = crearResMock();
    const next = jest.fn();

    // Act
    await servicioController.eliminar(req, res, next);

    // Assert
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'id invalido.' });
    expect(servicioModel.desactivar).not.toHaveBeenCalled();
  });
});

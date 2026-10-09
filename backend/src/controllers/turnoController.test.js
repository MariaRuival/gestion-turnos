jest.mock('../models/turnoModel');
jest.mock('../models/servicioModel');

const turnoModel = require('../models/turnoModel');
const servicioModel = require('../models/servicioModel');
const turnoController = require('./turnoController');

function crearResMock() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('turnoController.crear', () => {
  const fechaHoraInicio = '2099-01-15T10:00:00.000Z';
  const servicioIds = [1, 2];
  const serviciosValidos = [
    { id: 1, nombre: 'Corte', duracion_minutos: 30, precio: '1500.00' },
    { id: 2, nombre: 'Barba', duracion_minutos: 15, precio: '800.00' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('horarioSolapado_respondeConflictoYNoCreaElTurno', async () => {
    // Arrange
    const req = { body: { fechaHoraInicio, servicioIds }, usuario: { id: 7, rol: 'cliente' } };
    const res = crearResMock();
    const next = jest.fn();
    servicioModel.buscarPorIds.mockResolvedValue(serviciosValidos);
    turnoModel.buscarSolapados.mockResolvedValue([
      { id: 99, fecha_hora_inicio: fechaHoraInicio, fecha_hora_fin: '2099-01-15T10:30:00.000Z' },
    ]);

    // Act
    await turnoController.crear(req, res, next);

    // Assert
    expect(res.status).toHaveBeenCalledWith(409);
    expect(turnoModel.crear).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('horarioLibre_creaElTurnoConTotalesCalculadosYRespondeCreado', async () => {
    // Arrange
    const req = { body: { fechaHoraInicio, servicioIds }, usuario: { id: 7, rol: 'cliente' } };
    const res = crearResMock();
    const next = jest.fn();
    const turnoCreado = { id: 123, estado: 'pendiente' };
    servicioModel.buscarPorIds.mockResolvedValue(serviciosValidos);
    turnoModel.buscarSolapados.mockResolvedValue([]);
    turnoModel.crear.mockResolvedValue(123);
    turnoModel.buscarPorId.mockResolvedValue(turnoCreado);

    // Act
    await turnoController.crear(req, res, next);

    // Assert
    expect(turnoModel.crear).toHaveBeenCalledTimes(1);
    expect(turnoModel.crear).toHaveBeenCalledWith({
      usuarioId: 7,
      fechaHoraInicio: new Date('2099-01-15T10:00:00.000Z'),
      fechaHoraFin: new Date('2099-01-15T10:45:00.000Z'),
      duracionTotalMinutos: 45,
      precioTotal: 2300,
      servicioIds,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ turno: turnoCreado });
    expect(next).not.toHaveBeenCalled();
  });
});

const {
  TRANSICIONES_VALIDAS,
  calcularTotales,
  esTransicionValida,
  puedeCancelarPorTiempo,
} = require('./turnoRules');

const UNA_HORA_MS = 60 * 60 * 1000;

describe('calcularTotales', () => {
  it('variosServicios_sumaDuracionYPrecio', () => {
    // Arrange
    const servicios = [
      { duracion_minutos: 30, precio: '1500.50' },
      { duracion_minutos: 45, precio: 2000 },
      { duracion_minutos: 15, precio: '499.50' },
    ];

    // Act
    const totales = calcularTotales(servicios);

    // Assert
    expect(totales).toEqual({ duracionTotalMinutos: 90, precioTotal: 4000 });
  });

  it('arrayVacio_devuelveCeroDuracionYCeroPrecio', () => {
    // Arrange
    const servicios = [];

    // Act
    const totales = calcularTotales(servicios);

    // Assert
    expect(totales).toEqual({ duracionTotalMinutos: 0, precioTotal: 0 });
  });
});

describe('esTransicionValida', () => {
  it.each([
    // Validas (todas las definidas en TRANSICIONES_VALIDAS)
    ['pendiente', 'confirmado', true],
    ['pendiente', 'cancelado', true],
    ['confirmado', 'completado', true],
    ['confirmado', 'cancelado', true],
    // Invalidas
    ['completado', 'cancelado', false],
    ['pendiente', 'completado', false],
    ['cancelado', 'pendiente', false],
    ['pendiente', 'pendiente', false],
    ['inexistente', 'confirmado', false],
  ])('estadoYTransicion_decideSiEsValida: %s -> %s es %s', (estadoActual, estadoNuevo, esperado) => {
    // Arrange (los estados llegan parametrizados por it.each)

    // Act
    const resultado = esTransicionValida(estadoActual, estadoNuevo);

    // Assert
    expect(resultado).toBe(esperado);
  });

  it('tablaDeTransiciones_tieneExactamenteLasCuatroValidasCubiertas', () => {
    // Arrange
    const esperadas = [
      'pendiente->confirmado',
      'pendiente->cancelado',
      'confirmado->completado',
      'confirmado->cancelado',
    ];

    // Act
    const definidas = Object.entries(TRANSICIONES_VALIDAS).flatMap(([desde, destinos]) =>
      destinos.map((hacia) => `${desde}->${hacia}`)
    );

    // Assert
    expect(definidas.sort()).toEqual(esperadas.sort());
  });
});

describe('puedeCancelarPorTiempo', () => {
  const ahora = new Date('2026-10-09T12:00:00.000Z');

  it('turnoConVeinticincoHorasDeAnticipacion_permiteCancelar', () => {
    // Arrange
    const inicio = new Date(ahora.getTime() + 25 * UNA_HORA_MS);

    // Act
    const resultado = puedeCancelarPorTiempo(inicio, ahora);

    // Assert
    expect(resultado).toBe(true);
  });

  it('turnoConExactamenteVeinticuatroHoras_permiteCancelarEnElBorde', () => {
    // Arrange
    const inicio = new Date(ahora.getTime() + 24 * UNA_HORA_MS);

    // Act
    const resultado = puedeCancelarPorTiempo(inicio, ahora);

    // Assert
    expect(resultado).toBe(true);
  });

  it('turnoConVeintitresHorasDeAnticipacion_rechazaCancelacion', () => {
    // Arrange
    const inicio = new Date(ahora.getTime() + 23 * UNA_HORA_MS);

    // Act
    const resultado = puedeCancelarPorTiempo(inicio, ahora);

    // Assert
    expect(resultado).toBe(false);
  });
});

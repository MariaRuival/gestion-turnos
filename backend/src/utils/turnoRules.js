// Reglas de negocio de turnos que NO dependen de la base de datos.
// Se mantienen separadas y puras para poder leerlas/testearlas de forma aislada.

const HORAS_MINIMAS_PARA_CANCELAR = 24;

// Regla de negocio #3: maquina de estados explicita.
// Transiciones permitidas: pendiente -> confirmado -> completado
//                           pendiente | confirmado -> cancelado
// Cualquier otra combinacion (incluida "quedarse en el mismo estado") es invalida.
const TRANSICIONES_VALIDAS = {
  pendiente: ['confirmado', 'cancelado'],
  confirmado: ['completado', 'cancelado'],
  completado: [],
  cancelado: [],
};

function esTransicionValida(estadoActual, estadoNuevo) {
  const permitidos = TRANSICIONES_VALIDAS[estadoActual];
  return Array.isArray(permitidos) && permitidos.includes(estadoNuevo);
}

// Regla de negocio #4: no se puede cancelar si faltan menos de 24hs para el turno.
function puedeCancelarPorTiempo(fechaHoraInicio, ahora = new Date()) {
  const inicio = new Date(fechaHoraInicio);
  const diferenciaMs = inicio.getTime() - ahora.getTime();
  const horasRestantes = diferenciaMs / (1000 * 60 * 60);
  return horasRestantes >= HORAS_MINIMAS_PARA_CANCELAR;
}

// Regla de negocio #2: el total (duracion y precio) del turno es la suma de los
// servicios elegidos. Se calcula siempre en el backend, nunca se confia en lo
// que mande el cliente.
function calcularTotales(servicios) {
  return servicios.reduce(
    (acc, s) => ({
      duracionTotalMinutos: acc.duracionTotalMinutos + s.duracion_minutos,
      precioTotal: acc.precioTotal + Number(s.precio),
    }),
    { duracionTotalMinutos: 0, precioTotal: 0 }
  );
}

function urgenciaDeTurno(turno, ahora = new Date()) {
  if (!turno || !turno.fechaHoraInicio) {
    return 'sin-fecha';
  }
  if (turno.estado === 'cancelado' || turno.estado === 'completado') {
    return 'cerrado';
  }
  const horas = (new Date(turno.fechaHoraInicio) - ahora) / 3600000;
  if (horas < 0) {
    return 'pasado';
  }
  if (horas < 24) {
    return 'hoy';
  }
  if (horas < 24 * 7) {
    return 'esta-semana';
  }
  if (horas < 24 * 30) {
    return 'este-mes';
  }
  return 'lejano';
}

module.exports = {
  HORAS_MINIMAS_PARA_CANCELAR,
  TRANSICIONES_VALIDAS,
  esTransicionValida,
  puedeCancelarPorTiempo,
  calcularTotales,
  urgenciaDeTurno,
};

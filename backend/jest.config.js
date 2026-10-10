// collectCoverage queda en false a proposito: "npm test" corre rapido y sin
// coverage; "npm run test:coverage" lo activa con el flag --coverage.
module.exports = {
  testEnvironment: 'node',
  collectCoverage: false,
  // Solo la logica testeable con unit tests (controllers, auth, reglas).
  // Quedan afuera el wiring de Express (app, routes, errorHandler, server,
  // config) y el acceso a la base (db, models): eso se valida mejor con
  // tests de integracion.
  collectCoverageFrom: [
    'src/controllers/**/*.js',
    'src/middleware/auth.js',
    'src/utils/**/*.js',
  ],
  coverageReporters: ['text', 'lcov', 'json-summary'],
  // Piso definido sobre la medicion real (24.4% lines / 18.64% branches):
  // si el coverage baja de aca, "npm run test:coverage" falla.
  coverageThreshold: {
    global: {
      lines: 20,
      statements: 20,
      functions: 20,
      branches: 15,
    },
  },
};

import { defineConfig } from 'vitest/config';

// Config separada de vite.config.js a proposito: los tests son de logica pura
// (sin componentes ni DOM), asi que no necesitan el plugin de React ni el
// proxy /api que arma vite.config.js con loadEnv para dev/preview.
export default defineConfig({
  test: {
    // Node puro, sin jsdom: lo que el cliente HTTP toma del navegador
    // (fetch, localStorage) se mockea explicitamente en cada test.
    environment: 'node',
    include: ['src/**/*.test.js'],
    // Fija la base de la API para que un .env local con una URL absoluta
    // no cambie las rutas que verifican los tests.
    env: {
      VITE_API_URL: '/api',
    },
    // Solo se activa con "npm run test:coverage" (flag --coverage).
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Por ahora solo el archivo con tests; si se miden componentes es
      // una decision aparte.
      include: ['src/api/client.js'],
      // Piso definido sobre la medicion real (100% lines/stmts, 87.5% branches,
      // 81.81% funcs): si el coverage baja de aca, "npm run test:coverage" falla.
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 70,
        branches: 75,
      },
    },
  },
});

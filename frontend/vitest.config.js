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
  },
});

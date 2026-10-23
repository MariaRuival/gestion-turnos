import { defineConfig } from '@playwright/test';

// Suite de integracion/E2E. No hay baseURL global: cada spec arma su propia
// URL desde su variable de entorno (API_BASE_URL para la API, E2E_BASE_URL
// para el front), asi la misma suite corre contra compose local o contra QA.
export default defineConfig({
  testDir: './e2e',
  reporter: 'html',
  timeout: 30_000,
});

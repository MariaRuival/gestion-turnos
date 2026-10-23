import { defineConfig } from '@playwright/test';

// Suite de integracion (api.spec.js, sin navegador) y E2E (tareas.spec.js, con
// navegador). La misma suite corre contra compose local o contra QA:
// - E2E_BASE_URL: el front; es el baseURL, asi los specs hacen page.goto('/login').
// - API_BASE_URL: la API; api.spec.js arma sus URLs completas con esa variable.
export default defineConfig({
  testDir: './e2e',
  reporter: 'html',
  timeout: 30_000,
  // De a uno: api.spec.js cuenta los servicios antes/despues, y tareas.spec.js
  // crea y borra servicios en la misma base. En paralelo se pisarian.
  workers: 1,
  use: {
    baseURL: (process.env.E2E_BASE_URL || 'http://localhost:5173').replace(/\/+$/, ''),
  },
});

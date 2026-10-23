import { test, expect } from '@playwright/test';

// Pruebas de integracion contra la API real (sin navegador: fixture "request").
// Por defecto pegan al backend de docker compose; para QA:
//   API_BASE_URL=https://turnos-api-qa.onrender.com npx playwright test e2e/api.spec.js
const API = (process.env.API_BASE_URL || 'http://localhost:4000').replace(/\/+$/, '');

const ADMIN = { email: 'admin@negocio.com', password: 'Admin123!' };
const CLIENTE = { email: 'cliente1@mail.com', password: 'Cliente123!' };

async function login(request, { email, password }) {
  const res = await request.post(`${API}/api/auth/login`, { data: { email, password } });
  expect(res.status(), `login de ${email}`).toBe(200);
  const { token } = await res.json();
  return token;
}

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

async function listarServicios(request, token) {
  const res = await request.get(`${API}/api/servicios`, { headers: auth(token) });
  expect(res.status()).toBe(200);
  const { servicios } = await res.json();
  return servicios;
}

test('admin crea un servicio, aparece en la lista, lo elimina y deja de aparecer', async ({ request }) => {
  const token = await login(request, ADMIN);
  const nombre = `Integracion ${Date.now()}`;

  const alta = await request.post(`${API}/api/servicios`, {
    headers: auth(token),
    data: { nombre, duracionMinutos: 30, precio: 1500 },
  });
  expect(alta.status()).toBe(201);
  const { servicio } = await alta.json();
  expect(servicio).toMatchObject({ nombre, duracion_minutos: 30, activo: true });

  try {
    const antes = await listarServicios(request, token);
    expect(antes.map((s) => s.id)).toContain(servicio.id);
  } finally {
    // Se borra aunque falle la verificacion de arriba, para no dejar basura activa en QA.
    const baja = await request.delete(`${API}/api/servicios/${servicio.id}`, { headers: auth(token) });
    expect(baja.status()).toBe(204);
  }

  const despues = await listarServicios(request, token);
  expect(despues.map((s) => s.id)).not.toContain(servicio.id);
});

test('admin no puede crear un servicio con nombre vacio y no se crea nada', async ({ request }) => {
  const token = await login(request, ADMIN);
  const cantidadAntes = (await listarServicios(request, token)).length;

  const alta = await request.post(`${API}/api/servicios`, {
    headers: auth(token),
    data: { nombre: '', duracionMinutos: 30, precio: 1500 },
  });
  expect(alta.status()).toBe(400);

  const cantidadDespues = (await listarServicios(request, token)).length;
  expect(cantidadDespues).toBe(cantidadAntes);
});

test('un cliente autenticado no puede crear servicios (403, no 401) y no se crea nada', async ({ request }) => {
  const tokenAdmin = await login(request, ADMIN);
  const tokenCliente = await login(request, CLIENTE);
  const cantidadAntes = (await listarServicios(request, tokenAdmin)).length;

  const alta = await request.post(`${API}/api/servicios`, {
    headers: auth(tokenCliente),
    data: { nombre: `No deberia existir ${Date.now()}`, duracionMinutos: 30, precio: 1500 },
  });
  expect(alta.status()).toBe(403);

  const cantidadDespues = (await listarServicios(request, tokenAdmin)).length;
  expect(cantidadDespues).toBe(cantidadAntes);
});

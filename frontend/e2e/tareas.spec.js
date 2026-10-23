import { test, expect } from '@playwright/test';

// E2E con navegador real contra la app completa (front + API + base).
// La URL sale del baseURL de playwright.config.js (E2E_BASE_URL); para QA:
//   E2E_BASE_URL=https://turnos-front-qa.onrender.com npx playwright test e2e/tareas.spec.js

const ADMIN = { email: 'admin@negocio.com', password: 'Admin123!' };
const CLIENTE = { email: 'cliente1@mail.com', password: 'Cliente123!' };

async function loginUI(page, { email, password }, rol) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(new RegExp(`/${rol}$`));
}

// Espera a que "Mis turnos" termine de cargar y devuelve las tarjetas.
async function misTurnosCargados(page) {
  const seccion = page.getByTestId('mis-turnos');
  await expect(seccion.getByText('Cargando...')).toHaveCount(0);
  return seccion.getByTestId('turno-card');
}

// Fecha/hora futura al azar, para no chocar con turnos que ya existan en QA
// (la base no permite turnos solapados) ni con otra corrida en el mismo minuto:
// entre ~6 meses y ~1 año y medio adelante, de 9 a 17hs, cada 15 minutos.
function horarioLibre() {
  const azar = (n) => Math.floor(Math.random() * n);
  const dia = new Date();
  dia.setDate(dia.getDate() + 180 + azar(365));
  const fecha = `${dia.getFullYear()}-${String(dia.getMonth() + 1).padStart(2, '0')}-${String(dia.getDate()).padStart(2, '0')}`;
  const hora = `${String(9 + azar(9)).padStart(2, '0')}:${String(azar(4) * 15).padStart(2, '0')}`;
  return { fecha, hora };
}

function idsDeTurnos(tarjetas) {
  return tarjetas.evaluateAll((els) => els.map((el) => el.dataset.turnoId));
}

test('admin crea un servicio desde la UI, lo ve en la lista y lo elimina', async ({ page }) => {
  await loginUI(page, ADMIN, 'admin');
  const seccion = page.getByTestId('gestion-servicios');
  const nombre = `E2E ${Date.now()}`;
  const fila = seccion.getByTestId('servicio-fila').filter({ hasText: nombre });

  await seccion.getByTestId('servicio-nombre').fill(nombre);
  await seccion.getByTestId('servicio-duracion').fill('30');
  await seccion.getByTestId('servicio-precio').fill('1500');
  await seccion.getByTestId('servicio-crear').click();

  await expect(fila).toHaveCount(1);
  await expect(seccion.getByTestId('servicio-nombre')).toHaveValue('');

  await fila.getByTestId('servicio-eliminar').click();
  await expect(fila).toHaveCount(0);
});

test('cliente no puede reservar sin elegir servicios', async ({ page }) => {
  await loginUI(page, CLIENTE, 'cliente');
  const cantidadAntes = await (await misTurnosCargados(page)).count();
  const { fecha, hora } = horarioLibre();

  await page.getByTestId('reserva-fecha').fill(fecha);
  await page.getByTestId('reserva-hora').fill(hora);
  await expect(page.getByTestId('servicio-opcion').first()).toBeVisible();
  await expect(page.getByTestId('servicio-checkbox').and(page.locator(':checked'))).toHaveCount(0);
  await page.getByTestId('reserva-submit').click();

  await expect(page.getByTestId('mensaje-error')).toBeVisible();
  await expect(page.getByTestId('mensaje-exito')).toHaveCount(0);
  await expect(page).toHaveURL(/\/cliente$/);
  await expect(await misTurnosCargados(page)).toHaveCount(cantidadAntes);
});

test('cliente reserva un turno y lo ve en "Mis turnos" con el servicio elegido', async ({ page }) => {
  await loginUI(page, CLIENTE, 'cliente');
  const tarjetas = await misTurnosCargados(page);
  const idsAntes = await idsDeTurnos(tarjetas);
  const { fecha, hora } = horarioLibre();

  const opcion = page.getByTestId('servicio-opcion').first();
  const servicio = (await opcion.innerText()).split('\n')[0].trim();

  await page.getByTestId('reserva-fecha').fill(fecha);
  await page.getByTestId('reserva-hora').fill(hora);
  await opcion.getByTestId('servicio-checkbox').check();
  await page.getByTestId('reserva-submit').click();

  await expect(page.getByTestId('mensaje-exito')).toBeVisible();

  // El turno nuevo es la unica tarjeta con un id que antes no estaba (puede
  // haber otros turnos, incluso cancelados, con la misma fecha).
  let idNuevo;
  await expect
    .poll(async () => {
      [idNuevo] = (await idsDeTurnos(await misTurnosCargados(page))).filter((id) => !idsAntes.includes(id));
      return idNuevo;
    })
    .toBeTruthy();
  const turno = page.locator(`[data-testid="turno-card"][data-turno-id="${idNuevo}"]`);

  try {
    // Mismo calculo que hace ClienteView, en la zona horaria del navegador.
    const inicioISO = await page.evaluate(([f, h]) => new Date(`${f}T${h}:00`).toISOString(), [fecha, hora]);
    await expect(turno).toHaveAttribute('data-fecha-inicio', inicioISO);
    await expect(turno).toContainText(servicio);
    await expect(turno).toContainText('pendiente');
  } finally {
    // Limpieza: se cancela aunque falle algo de arriba, para no dejar el horario ocupado en QA.
    await turno.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByTestId('mensaje-exito')).toHaveText('Turno cancelado');
    await expect(turno).toContainText('cancelado');
  }
});

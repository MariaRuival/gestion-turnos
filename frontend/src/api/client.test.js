import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './client';

function respuestaOk(data = {}) {
  return { ok: true, status: 200, json: () => Promise.resolve(data) };
}

describe('api (cliente HTTP)', () => {
  let getItem;

  beforeEach(() => {
    // El entorno es Node puro: no hay fetch del navegador ni localStorage,
    // asi que ambos se reemplazan por dobles de prueba.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuestaOk()));
    getItem = vi.fn().mockReturnValue(null);
    vi.stubGlobal('localStorage', { getItem });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('login_enviaPostAAuthLoginConCredencialesEnJson', async () => {
    // Arrange
    const email = 'cliente@test.com';
    const password = 'secreta123';

    // Act
    await api.login(email, password);

    // Assert
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, opciones] = fetch.mock.calls[0];
    expect(url).toBe('/api/auth/login');
    expect(opciones.method).toBe('POST');
    expect(JSON.parse(opciones.body)).toEqual({ email, password });
  });

  it.each([
    ['servicios', [], '/api/servicios', 'GET'],
    ['misTurnos', [], '/api/turnos/mios', 'GET'],
    ['todosLosTurnos', [], '/api/turnos', 'GET'],
    ['cancelarTurno', [42], '/api/turnos/42/cancelar', 'PATCH'],
    ['confirmarTurno', [42], '/api/turnos/42/confirmar', 'PATCH'],
    ['completarTurno', [42], '/api/turnos/42/completar', 'PATCH'],
  ])('metodo_%s_llamaAFetchConRutaYVerboCorrectos', async (metodo, args, urlEsperada, verboEsperado) => {
    // Arrange (metodo, argumentos y resultado esperado llegan por it.each)

    // Act
    await api[metodo](...args);

    // Assert
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(urlEsperada, expect.objectContaining({ method: verboEsperado }));
  });

  it('respuestaConError_lanzaErrorConElMensajeDelBackend', async () => {
    // Arrange
    fetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ error: 'mensaje de prueba' }),
    });

    // Act
    const promesa = api.cancelarTurno(42);

    // Assert
    await expect(promesa).rejects.toThrow(Error);
    await expect(promesa).rejects.toHaveProperty('message', 'mensaje de prueba');
  });

  it('conTokenGuardado_enviaHeaderAuthorizationBearer', async () => {
    // Arrange
    const tokenFijo = 'token-fijo-de-prueba';
    getItem.mockReturnValue(tokenFijo);

    // Act
    await api.misTurnos();

    // Assert
    expect(getItem).toHaveBeenCalledWith('turnos_token');
    const [, opciones] = fetch.mock.calls[0];
    expect(opciones.headers.Authorization).toBe(`Bearer ${tokenFijo}`);
  });
});

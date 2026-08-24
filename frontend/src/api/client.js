const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

function getToken() {
  return localStorage.getItem('turnos_token');
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `Error ${res.status}`);
  }
  return data;
}

export const api = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  registro: (nombre, email, password) =>
    request('/auth/registro', { method: 'POST', body: { nombre, email, password } }),
  servicios: () => request('/servicios'),
  misTurnos: () => request('/turnos/mios'),
  todosLosTurnos: () => request('/turnos'),
  crearTurno: (fechaHoraInicio, servicioIds) =>
    request('/turnos', { method: 'POST', body: { fechaHoraInicio, servicioIds } }),
  cancelarTurno: (id) => request(`/turnos/${id}/cancelar`, { method: 'PATCH' }),
  confirmarTurno: (id) => request(`/turnos/${id}/confirmar`, { method: 'PATCH' }),
  completarTurno: (id) => request(`/turnos/${id}/completar`, { method: 'PATCH' }),
};

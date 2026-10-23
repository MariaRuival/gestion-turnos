import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import TurnoCard from '../components/TurnoCard';

const FILTROS = ['todos', 'pendiente', 'confirmado', 'completado', 'cancelado'];
const formateadorPrecio = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
const SERVICIO_VACIO = { nombre: '', duracionMinutos: '', precio: '' };

// Los inputs numericos devuelven string: vacio se manda como null y el resto
// como numero, para que el backend valide y devuelva su propio mensaje.
function aNumero(valor) {
  return valor === '' ? null : Number(valor);
}

// Pantalla 3: vista de admin. Ve todos los turnos del negocio y puede
// confirmarlos o marcarlos como completados (o cancelarlos). Las transiciones
// invalidas ni siquiera se muestran como boton: se calculan segun el estado
// actual del turno, en espejo de la maquina de estados que manda el backend.
export default function AdminView() {
  const { usuario, cerrarSesion } = useAuth();

  const [turnos, setTurnos] = useState([]);
  const [filtro, setFiltro] = useState('todos');
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [cargando, setCargando] = useState(true);

  const [servicios, setServicios] = useState([]);
  const [nuevoServicio, setNuevoServicio] = useState(SERVICIO_VACIO);
  const [errorServicio, setErrorServicio] = useState('');
  const [guardandoServicio, setGuardandoServicio] = useState(false);

  async function cargarTurnos() {
    setCargando(true);
    try {
      const { turnos } = await api.todosLosTurnos();
      setTurnos(turnos);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  async function cargarServicios() {
    try {
      const { servicios } = await api.servicios();
      setServicios(servicios);
    } catch (err) {
      setErrorServicio(err.message);
    }
  }

  useEffect(() => {
    cargarTurnos();
    cargarServicios();
  }, []);

  async function crearServicio(e) {
    e.preventDefault();
    setErrorServicio('');
    setGuardandoServicio(true);
    try {
      await api.crearServicio({
        nombre: nuevoServicio.nombre,
        duracionMinutos: aNumero(nuevoServicio.duracionMinutos),
        precio: aNumero(nuevoServicio.precio),
      });
      setNuevoServicio(SERVICIO_VACIO);
      await cargarServicios();
    } catch (err) {
      // El 400 del backend trae el motivo exacto (ej. "El nombre es obligatorio.").
      setErrorServicio(err.message);
    } finally {
      setGuardandoServicio(false);
    }
  }

  async function eliminarServicio(id) {
    setErrorServicio('');
    try {
      await api.eliminarServicio(id);
      setServicios((actuales) => actuales.filter((s) => s.id !== id));
    } catch (err) {
      setErrorServicio(err.message);
    }
  }

  function cambiarCampo(campo) {
    return (e) => setNuevoServicio((actual) => ({ ...actual, [campo]: e.target.value }));
  }

  async function ejecutarAccion(accion, turnoId) {
    setError('');
    setMensaje('');
    try {
      await accion(turnoId);
      setMensaje('Turno actualizado.');
      cargarTurnos();
    } catch (err) {
      setError(err.message);
    }
  }

  function accionesPara(turno) {
    const acciones = [];
    if (turno.estado === 'pendiente') {
      acciones.push({
        label: 'Confirmar',
        onClick: () => ejecutarAccion(api.confirmarTurno, turno.id),
      });
    }
    if (turno.estado === 'confirmado') {
      acciones.push({
        label: 'Completar',
        onClick: () => ejecutarAccion(api.completarTurno, turno.id),
      });
    }
    if (turno.estado === 'pendiente' || turno.estado === 'confirmado') {
      acciones.push({
        label: 'Cancelar',
        variante: 'boton-peligro',
        onClick: () => ejecutarAccion(api.cancelarTurno, turno.id),
      });
    }
    return acciones;
  }

  const turnosFiltrados = filtro === 'todos' ? turnos : turnos.filter((t) => t.estado === filtro);

  return (
    <div className="pagina">
      <header className="encabezado">
        <h1>Panel de admin — {usuario.nombre}</h1>
        <button className="boton boton-secundario boton-chico" onClick={cerrarSesion}>
          Cerrar sesion
        </button>
      </header>

      <main className="contenido">
        {error && <div className="error">{error}</div>}
        {mensaje && <div className="exito">{mensaje}</div>}

        <section className="tarjeta">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h2 style={{ margin: 0 }}>Turnos del negocio</h2>
            <select value={filtro} onChange={(e) => setFiltro(e.target.value)}>
              {FILTROS.map((f) => (
                <option key={f} value={f}>
                  {f === 'todos' ? 'Todos los estados' : f}
                </option>
              ))}
            </select>
          </div>

          {cargando && <p className="vacio">Cargando...</p>}
          {!cargando && turnosFiltrados.length === 0 && (
            <p className="vacio">No hay turnos con ese filtro.</p>
          )}
          {turnosFiltrados.map((t) => (
            <TurnoCard key={t.id} turno={t} mostrarCliente acciones={accionesPara(t)} />
          ))}
        </section>

        <section className="tarjeta" data-testid="gestion-servicios">
          <h2 style={{ marginTop: 0 }}>Gestionar servicios</h2>

          {errorServicio && (
            <div className="error" data-testid="servicio-error">
              {errorServicio}
            </div>
          )}

          {/* noValidate: las validaciones las hace el backend y se muestra su mensaje. */}
          <form onSubmit={crearServicio} noValidate>
            <div className="campo">
              <label htmlFor="servicio-nombre">Nombre</label>
              <input
                id="servicio-nombre"
                data-testid="servicio-nombre"
                type="text"
                value={nuevoServicio.nombre}
                onChange={cambiarCampo('nombre')}
              />
            </div>
            <div className="grid-form">
              <div className="campo">
                <label htmlFor="servicio-duracion">Duracion (minutos)</label>
                <input
                  id="servicio-duracion"
                  data-testid="servicio-duracion"
                  type="number"
                  min="1"
                  step="1"
                  value={nuevoServicio.duracionMinutos}
                  onChange={cambiarCampo('duracionMinutos')}
                />
              </div>
              <div className="campo">
                <label htmlFor="servicio-precio">Precio</label>
                <input
                  id="servicio-precio"
                  data-testid="servicio-precio"
                  type="number"
                  min="0"
                  step="0.01"
                  value={nuevoServicio.precio}
                  onChange={cambiarCampo('precio')}
                />
              </div>
            </div>
            <button
              type="submit"
              className="boton"
              data-testid="servicio-crear"
              disabled={guardandoServicio}
            >
              {guardandoServicio ? 'Creando...' : 'Crear servicio'}
            </button>
          </form>

          <div className="servicios-lista" data-testid="servicios-lista">
            {servicios.length === 0 && <p className="vacio">No hay servicios activos.</p>}
            {servicios.map((s) => (
              <div key={s.id} className="servicio-item" data-testid="servicio-fila" data-servicio-id={s.id}>
                <span>{s.nombre}</span>
                <span className="detalle">
                  {s.duracion_minutos} min · {formateadorPrecio.format(s.precio)}
                </span>
                <button
                  type="button"
                  className="boton boton-peligro boton-chico"
                  data-testid="servicio-eliminar"
                  onClick={() => eliminarServicio(s.id)}
                >
                  Eliminar
                </button>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

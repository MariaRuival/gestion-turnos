import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import TurnoCard from '../components/TurnoCard';

const FILTROS = ['todos', 'pendiente', 'confirmado', 'completado', 'cancelado'];

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

  useEffect(() => {
    cargarTurnos();
  }, []);

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
      </main>
    </div>
  );
}

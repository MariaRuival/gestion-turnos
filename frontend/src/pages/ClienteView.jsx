import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import ServicioCheckboxList from '../components/ServicioCheckboxList';
import TurnoCard from '../components/TurnoCard';

const HORAS_MINIMAS_PARA_CANCELAR = 24;

// Refleja en la UI la misma regla de negocio #4 que valida el backend, solo
// para deshabilitar el boton de forma amigable. El backend es quien decide de verdad.
function faltanMenosDe24hs(fechaHoraInicio) {
  const horasRestantes = (new Date(fechaHoraInicio).getTime() - Date.now()) / 3_600_000;
  return horasRestantes < HORAS_MINIMAS_PARA_CANCELAR;
}

// Pantalla 2: vista de cliente. Elegir fecha/hora + servicio(s) y reservar;
// ver y cancelar los propios turnos (nunca los de otro usuario: la API ya
// filtra por /turnos/mios, aca solo se listan).
export default function ClienteView() {
  const { usuario, cerrarSesion } = useAuth();

  const [servicios, setServicios] = useState([]);
  const [misTurnos, setMisTurnos] = useState([]);
  const [seleccionados, setSeleccionados] = useState([]);
  const [fecha, setFecha] = useState('');
  const [hora, setHora] = useState('');
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [reservando, setReservando] = useState(false);
  const [cargandoTurnos, setCargandoTurnos] = useState(true);

  async function cargarTurnos() {
    setCargandoTurnos(true);
    try {
      const { turnos } = await api.misTurnos();
      setMisTurnos(turnos);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargandoTurnos(false);
    }
  }

  useEffect(() => {
    api.servicios().then((d) => setServicios(d.servicios)).catch((err) => setError(err.message));
    cargarTurnos();
  }, []);

  async function manejarReserva(e) {
    e.preventDefault();
    setError('');
    setMensaje('');

    if (!fecha || !hora || seleccionados.length === 0) {
      setError('Elegi el dia, hora y al menos un servicio.');
      return;
    }

    const fechaHoraInicio = new Date(`${fecha}T${hora}:00`).toISOString();

    setReservando(true);
    try {
      await api.crearTurno(fechaHoraInicio, seleccionados);
      setMensaje('Turno reservado con exito.');
      setSeleccionados([]);
      setFecha('');
      setHora('');
      cargarTurnos();
    } catch (err) {
      setError(err.message);
    } finally {
      setReservando(false);
    }
  }

  async function manejarCancelar(turnoId) {
    setError('');
    setMensaje('');
    try {
      await api.cancelarTurno(turnoId);
      setMensaje('Turno cancelado');
      cargarTurnos();
    } catch (err) {
      setError(err.message);
    }
  }

  const turnosActivos = misTurnos.filter((t) => t.estado !== 'cancelado');
  const turnosPasados = misTurnos.filter((t) => t.estado === 'cancelado');

  return (
    <div className="pagina">
      <header className="encabezado">
        <h1>Hola, {usuario.nombre}</h1>
        <button className="boton boton-secundario boton-chico" onClick={cerrarSesion}>
          Cerrar sesion
        </button>
      </header>

      <main className="contenido">
        {error && <div className="error">{error}</div>}
        {mensaje && <div className="exito">{mensaje}</div>}

        <section className="tarjeta">
          <h2>Reservar turno</h2>
          <form onSubmit={manejarReserva}>
            <div className="grid-form">
              <div className="campo">
                <label htmlFor="fecha">Fecha</label>
                <input
                  id="fecha"
                  type="date"
                  value={fecha}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setFecha(e.target.value)}
                  required
                />
              </div>
              <div className="campo">
                <label htmlFor="hora">Hora</label>
                <input
                  id="hora"
                  type="time"
                  value={hora}
                  onChange={(e) => setHora(e.target.value)}
                  required
                />
              </div>
            </div>

            <label style={{ fontSize: '0.85rem', color: '#57606a' }}>Servicios</label>
            <ServicioCheckboxList
              servicios={servicios}
              seleccionados={seleccionados}
              onCambiar={setSeleccionados}
            />

            <button type="submit" className="boton" disabled={reservando}>
              {reservando ? 'Reservando...' : 'Reservar turno'}
            </button>
          </form>
        </section>

        <section className="tarjeta">
          <h2>Mis turnos</h2>
          {cargandoTurnos && <p className="vacio">Cargando...</p>}
          {!cargandoTurnos && turnosActivos.length === 0 && turnosPasados.length === 0 && (
            <p className="vacio">Todavia no reservaste ningun turno.</p>
          )}
          {turnosActivos.map((t) => {
            const puedeCancelar = t.estado === 'pendiente' || t.estado === 'confirmado';
            const bloqueadoPorTiempo = puedeCancelar && faltanMenosDe24hs(t.fechaHoraInicio);
            return (
              <TurnoCard
                key={t.id}
                turno={t}
                acciones={
                  puedeCancelar
                    ? [
                        {
                          label: bloqueadoPorTiempo ? 'Cancelar (fuera de plazo)' : 'Cancelar',
                          variante: 'boton-peligro',
                          disabled: bloqueadoPorTiempo,
                          title: bloqueadoPorTiempo
                            ? `Solo se puede cancelar con ${HORAS_MINIMAS_PARA_CANCELAR}hs de anticipacion`
                            : undefined,
                          onClick: () => manejarCancelar(t.id),
                        },
                      ]
                    : []
                }
              />
            );
          })}
          {turnosPasados.map((t) => (
            <TurnoCard key={t.id} turno={t} />
          ))}
        </section>
      </main>
    </div>
  );
}

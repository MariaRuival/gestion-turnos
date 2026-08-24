const formateadorPrecio = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
const formateadorFecha = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

// Tarjeta generica de turno. `acciones` es un array de botones a mostrar
// (distinto para la vista de cliente y la de admin).
export default function TurnoCard({ turno, mostrarCliente = false, acciones = [] }) {
  return (
    <div className="turno-card">
      <div className="turno-info">
        <h3>
          {formateadorFecha.format(new Date(turno.fechaHoraInicio))}{' '}
          <span className={`estado-badge estado-${turno.estado}`}>{turno.estado}</span>
        </h3>
        {mostrarCliente && (
          <p className="usuario-chip">
            {turno.clienteNombre} · {turno.clienteEmail}
          </p>
        )}
        <p>{turno.servicios.map((s) => s.nombre).join(', ')}</p>
        <p>
          {turno.duracionTotalMinutos} min · {formateadorPrecio.format(turno.precioTotal)}
        </p>
      </div>
      {acciones.length > 0 && (
        <div className="acciones">
          {acciones.map((a) => (
            <button
              key={a.label}
              type="button"
              className={`boton boton-chico ${a.variante || ''}`}
              onClick={a.onClick}
              disabled={a.disabled}
              title={a.title}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

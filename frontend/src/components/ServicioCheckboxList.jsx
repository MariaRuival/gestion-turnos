const formateadorPrecio = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

export default function ServicioCheckboxList({ servicios, seleccionados, onCambiar }) {
  function toggle(id) {
    const yaEsta = seleccionados.includes(id);
    onCambiar(yaEsta ? seleccionados.filter((s) => s !== id) : [...seleccionados, id]);
  }

  const elegidos = servicios.filter((s) => seleccionados.includes(s.id));
  const duracionTotal = elegidos.reduce((acc, s) => acc + s.duracion_minutos, 0);
  const precioTotal = elegidos.reduce((acc, s) => acc + Number(s.precio), 0);

  return (
    <div>
      <div className="servicios-lista">
        {servicios.map((s) => (
          <label key={s.id} className="servicio-item">
            <input
              type="checkbox"
              checked={seleccionados.includes(s.id)}
              onChange={() => toggle(s.id)}
            />
            {s.nombre}
            <span className="detalle">
              {s.duracion_minutos} min · {formateadorPrecio.format(s.precio)}
            </span>
          </label>
        ))}
      </div>
      {elegidos.length > 0 && (
        <div className="resumen-total">
          <span>Total ({elegidos.length} servicio{elegidos.length > 1 ? 's' : ''})</span>
          <strong>
            {duracionTotal} min · {formateadorPrecio.format(precioTotal)}
          </strong>
        </div>
      )}
    </div>
  );
}

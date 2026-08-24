// Manejador de errores centralizado. Los controllers hacen next(err) y todo
// termina aca en un unico formato de respuesta { error: "..." }.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(err);
  }
  res.status(status).json({ error: err.message || 'Error interno del servidor.' });
}

module.exports = errorHandler;

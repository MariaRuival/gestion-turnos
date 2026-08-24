const jwt = require('jsonwebtoken');

// Exige un JWT valido en el header Authorization: Bearer <token>.
// Cuelga el usuario decodificado (id, rol) en req.usuario para el resto de la cadena.
function requiereAutenticacion(req, res, next) {
  const header = req.headers.authorization || '';
  const [tipo, token] = header.split(' ');

  if (tipo !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Falta el token de autenticacion.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = { id: payload.id, rol: payload.rol, nombre: payload.nombre };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalido o expirado.' });
  }
}

// Regla de negocio #5 (parte "administrativa"): ciertas rutas son solo para admin.
function requiereRol(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.usuario || !rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'No tenes permisos para esta accion.' });
    }
    next();
  };
}

module.exports = { requiereAutenticacion, requiereRol };

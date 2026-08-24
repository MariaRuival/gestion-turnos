const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const usuarioModel = require('../models/usuarioModel');

function firmarToken(usuario) {
  return jwt.sign(
    { id: usuario.id, rol: usuario.rol, nombre: usuario.nombre },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

function usuarioPublico(usuario) {
  return { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol };
}

// POST /api/auth/login
async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contrasena son obligatorios.' });
    }

    const usuario = await usuarioModel.buscarPorEmail(email.toLowerCase().trim());
    if (!usuario) {
      return res.status(401).json({ error: 'Credenciales invalidas.' });
    }

    const claveValida = await bcrypt.compare(password, usuario.password_hash);
    if (!claveValida) {
      return res.status(401).json({ error: 'Credenciales invalidas.' });
    }

    const token = firmarToken(usuario);
    res.json({ token, usuario: usuarioPublico(usuario) });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/registro
// Autoregistro de clientes. No permite elegir rol "admin": los admin se crean
// por seed/DB, nunca vía un endpoint publico (evita escalar privilegios).
async function registro(req, res, next) {
  try {
    const { nombre, email, password } = req.body;
    if (!nombre || !email || !password) {
      return res.status(400).json({ error: 'Nombre, email y contrasena son obligatorios.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'La contrasena debe tener al menos 6 caracteres.' });
    }

    const emailNormalizado = email.toLowerCase().trim();
    const existente = await usuarioModel.buscarPorEmail(emailNormalizado);
    if (existente) {
      return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const usuario = await usuarioModel.crear({
      nombre: nombre.trim(),
      email: emailNormalizado,
      passwordHash,
      rol: 'cliente',
    });

    const token = firmarToken(usuario);
    res.status(201).json({ token, usuario: usuarioPublico(usuario) });
  } catch (err) {
    next(err);
  }
}

// GET /api/auth/yo
async function yo(req, res, next) {
  try {
    const usuario = await usuarioModel.buscarPorId(req.usuario.id);
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado.' });
    res.json({ usuario });
  } catch (err) {
    next(err);
  }
}

module.exports = { login, registro, yo };

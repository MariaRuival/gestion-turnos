import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

// Pantalla 1: login simple de usuario/contrasena. El registro (solo para
// clientes; los admin se cargan por seed) esta en la misma pantalla como
// un modo alternativo, para no sumar una 4ta pantalla al proyecto.
export default function Login() {
  const [modo, setModo] = useState('login'); // 'login' | 'registro'
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const { iniciarSesion } = useAuth();
  const navigate = useNavigate();

  async function manejarSubmit(e) {
    e.preventDefault();
    setError('');
    setCargando(true);
    try {
      const data =
        modo === 'login'
          ? await api.login(email, password)
          : await api.registro(nombre, email, password);
      iniciarSesion(data.token, data.usuario);
      navigate(`/${data.usuario.rol}`, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="login-contenedor">
      <div className="login-tarjeta">
        <h1>Gestion de Turnos</h1>

        <div className="toggle-tipo">
          <button
            type="button"
            className={modo === 'login' ? 'activo' : ''}
            onClick={() => setModo('login')}
          >
            Iniciar sesion
          </button>
          <button
            type="button"
            className={modo === 'registro' ? 'activo' : ''}
            onClick={() => setModo('registro')}
          >
            Crear cuenta cliente
          </button>
        </div>

        {error && <div className="error">{error}</div>}

        <form onSubmit={manejarSubmit}>
          {modo === 'registro' && (
            <div className="campo">
              <label htmlFor="nombre">Nombre</label>
              <input
                id="nombre"
                type="text"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                required
              />
            </div>
          )}

          <div className="campo">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </div>

          <div className="campo">
            <label htmlFor="password">Contrasena</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={modo === 'login' ? 'current-password' : 'new-password'}
              required
            />
          </div>

          <button type="submit" className="boton boton-ancho" disabled={cargando}>
            {cargando ? 'Un momento...' : modo === 'login' ? 'Ingresar' : 'Crear cuenta'}
          </button>
        </form>

        {modo === 'login' && (
          <p style={{ fontSize: '0.8rem', color: '#57606a', marginTop: '1rem' }}>
            El rol (cliente o admin) lo determina la cuenta con la que inicies sesion.
            Las cuentas admin las crea el negocio; los clientes se pueden registrar aca.
          </p>
        )}
      </div>
    </div>
  );
}

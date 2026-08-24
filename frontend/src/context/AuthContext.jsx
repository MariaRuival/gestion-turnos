import { createContext, useContext, useState, useCallback } from 'react';

const AuthContext = createContext(null);

function leerUsuarioGuardado() {
  const raw = localStorage.getItem('turnos_usuario');
  return raw ? JSON.parse(raw) : null;
}

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(leerUsuarioGuardado);

  const iniciarSesion = useCallback((token, usuarioNuevo) => {
    localStorage.setItem('turnos_token', token);
    localStorage.setItem('turnos_usuario', JSON.stringify(usuarioNuevo));
    setUsuario(usuarioNuevo);
  }, []);

  const cerrarSesion = useCallback(() => {
    localStorage.removeItem('turnos_token');
    localStorage.removeItem('turnos_usuario');
    setUsuario(null);
  }, []);

  return (
    <AuthContext.Provider value={{ usuario, iniciarSesion, cerrarSesion }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de un AuthProvider');
  return ctx;
}

import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Protege una pantalla segun sesion iniciada y, opcionalmente, rol requerido.
export default function ProtectedRoute({ rol, children }) {
  const { usuario } = useAuth();

  if (!usuario) return <Navigate to="/login" replace />;
  if (rol && usuario.rol !== rol) return <Navigate to="/login" replace />;

  return children;
}

import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import ClienteView from './pages/ClienteView';
import AdminView from './pages/AdminView';
import ProtectedRoute from './components/ProtectedRoute';
import { useAuth } from './context/AuthContext';

// La app tiene solo 3 pantallas: Login, vista de cliente y vista de admin.
export default function App() {
  const { usuario } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/cliente"
        element={
          <ProtectedRoute rol="cliente">
            <ClienteView />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute rol="admin">
            <AdminView />
          </ProtectedRoute>
        }
      />
      <Route
        path="/"
        element={<Navigate to={usuario ? `/${usuario.rol}` : '/login'} replace />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

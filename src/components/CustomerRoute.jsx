import { Navigate } from '../i18n/router';
import { useAuth } from '../context/AuthContext';

export default function CustomerRoute({ children }) {
  const { isAuthenticated, isAdmin, loading } = useAuth();

  if (loading) {
    return (
      <main className="account-page">
        <p className="account-loading">Chargement...</p>
      </main>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: '/account' }} />;
  }

  if (isAdmin) {
    return <Navigate to="/admin" replace />;
  }

  return children;
}

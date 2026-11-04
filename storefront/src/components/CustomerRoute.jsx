import { Navigate } from '../lib/router';
import { useAuth } from '../stores/auth';

export default function CustomerRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

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


  return children;
}

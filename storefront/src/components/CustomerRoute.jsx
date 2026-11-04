import { useEffect } from 'react';
import { Navigate } from '../lib/router';
import { useAuth } from '../stores/auth';
import { ADMIN_URL } from '../lib/adminUrl';

export default function CustomerRoute({ children }) {
  const { isAuthenticated, isAdmin, loading } = useAuth();

  // The admin panel is not a customer page: an admin who lands here is sent to it (as on the old site).
  useEffect(() => {
    if (!loading && isAdmin) window.location.assign(ADMIN_URL);
  }, [loading, isAdmin]);

  if (loading || isAdmin) {
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

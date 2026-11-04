import { useEffect } from 'react';
import { useLocation } from '../lib/router.jsx';
import { Navigate } from '../lib/router';
import { useAuth } from '../stores/auth';
import { ADMIN_URL } from '../lib/adminUrl';

export default function GuestRoute({ children }) {
  const { isAuthenticated, isAdmin, loading } = useAuth();
  const location = useLocation();

  // An admin who is already signed in goes to the admin panel, not to a customer page.
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

  if (isAuthenticated) {
    // A customer who logged in or signed up from another page (for example a review prompt) goes back to it;
    // an internal path only. Everyone else lands on their usual page.
    const from = location.state?.from;
    const backTo = typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/account';
    return <Navigate to={backTo} replace />;
  }

  return children;
}

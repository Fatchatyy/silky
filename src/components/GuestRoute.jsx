import { useLocation } from 'react-router-dom';
import { Navigate } from '../i18n/router';
import { useAuth } from '../context/AuthContext';

export default function GuestRoute({ children }) {
  const { isAuthenticated, isAdmin, loading } = useAuth();
  const location = useLocation();

  if (loading) {
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
    return <Navigate to={isAdmin ? '/admin' : backTo} replace />;
  }

  return children;
}

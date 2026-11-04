import { useLocation } from '../lib/router.jsx';
import { Navigate } from '../lib/router';
import { useAuth } from '../stores/auth';

export default function GuestRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
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
    return <Navigate to={backTo} replace />;
  }

  return children;
}

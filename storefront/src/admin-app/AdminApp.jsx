// The whole admin panel, mounted as ONE Astro island (client:only="react") by src/pages/admin/[...path].astro. React Router
// keeps working inside it with basename "/admin": /admin is the dashboard (its tabs are component state), /admin/login the
// password form; any other address under /admin shows the dashboard too.
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { ProductsProvider } from './context/ProductsContext';
import { useAuth } from './context/useAuth';
import AdminLogin, { AdminRoute } from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';
import '../lib/island'; // sets the media base used by mediaUrl()

function loadingPage() {
  return (
    <main className="admin-login-page">
      <p>Chargement...</p>
    </main>
  );
}

// /admin/login is for people who are not signed in: an admin goes to the dashboard, a customer account to the shop's account page.
function GuestOnly({ children }) {
  const { isAuthenticated, isAdmin, loading } = useAuth();
  if (loading) return loadingPage();
  if (isAdmin) return <Navigate to="/" replace />;
  if (isAuthenticated) {
    window.location.assign('/account');
    return null;
  }
  return children;
}

export default function AdminApp() {
  return (
    <BrowserRouter basename="/admin">
      <ThemeProvider>
        <ProductsProvider>
          <Routes>
            <Route
              path="login"
              element={
                <GuestOnly>
                  <AdminLogin />
                </GuestOnly>
              }
            />
            <Route
              path="/"
              element={
                <AdminRoute>
                  <AdminDashboard />
                </AdminRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ProductsProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

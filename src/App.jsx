import { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';

import Layout from './components/layout/Layout';

import Home from './pages/Home';

import Product from './pages/Product';

import Cart from './pages/Cart';

import Checkout from './pages/Checkout';

import OrderConfirmation from './pages/OrderConfirmation';

import Collection from './pages/Collection';

import SearchResults from './pages/SearchResults';

import LeaveReview from './pages/LeaveReview';

import About from './pages/About';

import Contact from './pages/Contact';

import CustomerService from './pages/CustomerService';

import DeliveryReturns from './pages/DeliveryReturns';

import FAQ from './pages/FAQ';

import Login from './pages/Login';

import Signup from './pages/Signup';

import Favorites from './pages/Favorites';

import Account from './pages/Account';

import CustomerRoute from './components/CustomerRoute';
import GuestRoute from './components/GuestRoute';
import PasswordReset from './pages/PasswordReset';
import NotFound from './pages/NotFound';
import { ARABIC_ENABLED } from '../shared/locales';

// The admin screens (about a third of the code) are downloaded only when someone opens /admin. Their stylesheet stays
// in the main bundle: the admin review panel shown on product pages shares its rules.
import './styles/admin.css';

const AdminLogin = lazy(() => import('./pages/admin/AdminLogin'));
const AdminRoute = lazy(() => import('./pages/admin/AdminLogin').then((module) => ({ default: module.AdminRoute })));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));

const adminLoading = <div style={{ padding: '2rem', textAlign: 'center' }}>Chargement...</div>;

// The storefront pages, once for French (no prefix) and once under /ar for Arabic. The admin stays French only.
const storefrontRoutes = (
  <>
          <Route index element={<Home />} />
          <Route path="product/:slug?" element={<Product />} />
          <Route path="collection/:category" element={<Collection />} />
          <Route path="search" element={<SearchResults />} />
          <Route path="cart" element={<Cart />} />
          <Route path="checkout" element={<Checkout />} />
          <Route path="order-confirmation" element={<OrderConfirmation />} />
          <Route path="leave-review" element={<LeaveReview />} />
          <Route path="about" element={<About />} />
          <Route path="contact" element={<Contact />} />
          <Route path="service-client" element={<CustomerService />} />
          <Route path="livraison-retours" element={<DeliveryReturns />} />
          <Route path="faq" element={<FAQ />} />
          <Route
            path="login"
            element={
              <GuestRoute>
                <Login />
              </GuestRoute>
            }
          />
          <Route
            path="signup"
            element={
              <GuestRoute>
                <Signup />
              </GuestRoute>
            }
          />
          <Route
            path="register"
            element={
              <GuestRoute>
                <Signup />
              </GuestRoute>
            }
          />
          <Route
            path="password-reset"
            element={
              <GuestRoute>
                <PasswordReset />
              </GuestRoute>
            }
          />
          <Route
            path="password-reset/:token"
            element={
              <GuestRoute>
                <PasswordReset />
              </GuestRoute>
            }
          />
          <Route path="favorites" element={<Favorites />} />
          <Route
            path="account"
            element={
              <CustomerRoute>
                <Account />
              </CustomerRoute>
            }
          />
          <Route path="*" element={<NotFound />} />
  </>
);

export default function App() {
  return (
    <Routes>
        <Route element={<Layout />}>{storefrontRoutes}</Route>
        {ARABIC_ENABLED && (
          <Route path="ar" element={<Layout />}>
            {storefrontRoutes}
          </Route>
        )}

      <Route
        path="admin/login"
        element={
          <GuestRoute>
            <Suspense fallback={adminLoading}>
              <AdminLogin />
            </Suspense>
          </GuestRoute>
        }
      />

      <Route

        path="admin"

        element={

          <Suspense fallback={adminLoading}>
            <AdminRoute>
              <AdminDashboard />
            </AdminRoute>
          </Suspense>

        }

      />

    </Routes>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from '../lib/router';
import { api } from '../lib/apiClient';
import { useAuth } from '../stores/auth';
import { useCart } from '../stores/cart';
import { useProducts } from '../stores/products';
import { useFavorites } from '../stores/favorites';
import { formatPrice } from '@shared/formatPrice';
import { useT } from '../i18n/useT';

const ORDER_STATUS_LABELS = {
  pending: 'En attente',
  processing: 'En cours',
  confirmed: 'Confirmée',
  completed: 'Confirmée',
  delivered: 'Livrée',
  exchanged: 'Échangée',
  refunded: 'Remboursée',
  cancelled: 'Annulée',
};

function formatDate(iso, locale = 'fr') {
  if (!iso) return '—';
  // Arabic: Tunisian month names, Western digits
  return new Date(iso).toLocaleDateString(locale === 'ar' ? 'ar-TN-u-nu-latn' : 'fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function Account() {
  const { t, known, locale, detailsLabel } = useT();
  const { getProduct } = useProducts();
  const navigate = useNavigate();
  const { user, logout, refreshUser } = useAuth();
  const { itemCount } = useCart();
  const { favoriteIds } = useFavorites();

  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState('');

  const [editingProfile, setEditingProfile] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');

  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const [expandedOrderId, setExpandedOrderId] = useState(null);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    setOrdersError('');
    try {
      const data = await api.getMyOrders();
      setOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      setOrdersError(known(err.message) || t('account.loadOrdersFailed'));
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    refreshUser().catch(() => {});
  }, [refreshUser]);

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    setProfileError('');
    setProfileSuccess('');

    const form = new FormData(e.target);
    const fullName = (form.get('fullName') || '').trim();
    const email = (form.get('email') || '').trim();
    const phoneNumber = (form.get('phoneNumber') || '').trim();

    if (!fullName) {
      setProfileError(t('account.fullNameRequired'));
      return;
    }

    if (!email && !phoneNumber) {
      setProfileError(t('account.keepOne'));
      return;
    }

    if (user?.email && !email) {
      setProfileError(t('contact.emailRequired'));
      return;
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setProfileError(t('contact.emailInvalid'));
      return;
    }

    setProfileLoading(true);

    try {
      await api.updateProfile({
        fullName,
        email: email || null,
        phoneNumber: phoneNumber || null,
      });
      await refreshUser();
      setProfileSuccess(t('account.profileUpdated'));
      setEditingProfile(false);
    } catch (err) {
      setProfileError(known(err.message) || t('account.updateFailed'));
    } finally {
      setProfileLoading(false);
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');
    setPasswordLoading(true);

    const form = new FormData(e.target);
    const newPassword = form.get('newPassword');
    const confirmPassword = form.get('confirmPassword');

    if (newPassword !== confirmPassword) {
      setPasswordError(t('reset.mismatch'));
      setPasswordLoading(false);
      return;
    }

    try {
      await api.changePassword({
        currentPassword: form.get('currentPassword'),
        newPassword,
      });
      setPasswordSuccess(t('account.passwordUpdated'));
      setChangingPassword(false);
      e.target.reset();
    } catch (err) {
      setPasswordError(known(err.message) || t('account.changeFailed'));
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <main className="account-page">
      <header className="account-header">
        <img src="/pictures/logo.png" alt="Silky" className="account-logo" />
        <h1 className="account-title">{t('account.title')}</h1>
        <p className="account-subtitle">{t('account.welcome', { name: user?.fullName || user?.email })}</p>
        <Link to="/" className="secondary-btn" style={{ display: 'inline-block', marginTop: 16 }}>
          {t('fav.discover')}
        </Link>
      </header>

      <section className="account-section">
        <h2 className="account-section-title">{t('account.personal')}</h2>

        {!editingProfile ? (
          <>
            <div className="account-info-grid">
              <div className="account-info-row">
                <span className="account-info-label">{t('account.fullName')}</span>
                <span className="account-info-value">{user?.fullName || '—'}</span>
              </div>
              <div className="account-info-row">
                <span className="account-info-label">{t('account.email')}</span>
                <span className="account-info-value">{user?.email || '—'}</span>
              </div>
              {user?.phoneNumber && (
                <div className="account-info-row">
                  <span className="account-info-label">{t('account.phone')}</span>
                  <span className="account-info-value">{user.phoneNumber}</span>
                </div>
              )}
              {user?.createdAt && (
                <div className="account-info-row">
                  <span className="account-info-label">{t('account.memberSince')}</span>
                  <span className="account-info-value">{formatDate(user.createdAt, locale)}</span>
                </div>
              )}
            </div>
            <div className="account-actions-row">
              <button
                type="button"
                className="account-text-btn"
                onClick={() => {
                  setEditingProfile(true);
                  setProfileError('');
                  setProfileSuccess('');
                }}
              >
                {t('account.editProfile')}
              </button>
              {!changingPassword && (
                <button
                  type="button"
                  className="account-text-btn"
                  onClick={() => {
                    setChangingPassword(true);
                    setPasswordError('');
                    setPasswordSuccess('');
                  }}
                >
                  {t('account.changePassword')}
                </button>
              )}
            </div>
          </>
        ) : (
          <form className="account-form" onSubmit={handleProfileSubmit} noValidate>
            <div className="form-group">
              <label htmlFor="fullName">{t('account.fullName')}</label>
              <input
                type="text"
                id="fullName"
                name="fullName"
                required
                defaultValue={user?.fullName || ''}
                autoComplete="name"
              />
            </div>
            <div className="form-group">
              <label htmlFor="email">
                {t('contact.email')} {user?.email ? '' : t('account.optional')}
              </label>
              <input
                type="email"
                id="email"
                name="email"
                defaultValue={user?.email || ''}
                autoComplete="email"
              />
            </div>
            <div className="form-group">
              <label htmlFor="phoneNumber">{t('account.phoneOptional')}</label>
              <input
                type="tel"
                id="phoneNumber"
                name="phoneNumber"
                defaultValue={user?.phoneNumber || ''}
                autoComplete="tel"
              />
            </div>
            {profileError && <p className="account-form-error">{profileError}</p>}
            {profileSuccess && <p className="account-form-success">{profileSuccess}</p>}
            <div className="account-form-actions">
              <button type="submit" className="account-link-btn" disabled={profileLoading}>
                {profileLoading ? t('common.saving') : t('common.save')}
              </button>
              <button
                type="button"
                className="account-link-btn secondary"
                onClick={() => setEditingProfile(false)}
              >
                {t('common.cancel')}
              </button>
            </div>
          </form>
        )}
      </section>

      {changingPassword && (
        <section className="account-section">
          <h2 className="account-section-title">{t('account.changePassword')}</h2>
          <form className="account-form" onSubmit={handlePasswordSubmit}>
            <div className="form-group">
              <label htmlFor="currentPassword">{t('account.currentPassword')}</label>
              <input
                type="password"
                id="currentPassword"
                name="currentPassword"
                required
                autoComplete="current-password"
              />
            </div>
            <div className="form-group">
              <label htmlFor="newPassword">{t('reset.newPassword')}</label>
              <input
                type="password"
                id="newPassword"
                name="newPassword"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div className="form-group">
              <label htmlFor="confirmPassword">{t('reset.confirmPassword')}</label>
              <input
                type="password"
                id="confirmPassword"
                name="confirmPassword"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            {passwordError && <p className="account-form-error">{passwordError}</p>}
            {passwordSuccess && <p className="account-form-success">{passwordSuccess}</p>}
            <div className="account-form-actions">
              <button type="submit" className="account-link-btn" disabled={passwordLoading}>
                {passwordLoading ? t('account.updating') : t('account.update')}
              </button>
              <button
                type="button"
                className="account-link-btn secondary"
                onClick={() => setChangingPassword(false)}
              >
                {t('common.cancel')}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="account-section">
        <h2 className="account-section-title">{t('account.myOrders')}</h2>

        {ordersLoading ? (
          <p className="account-empty">{t('account.ordersLoading')}</p>
        ) : ordersError ? (
          <p className="account-form-error">{ordersError}</p>
        ) : orders.length === 0 ? (
          <p className="account-empty">{t('account.noOrders')}</p>
        ) : (
          <div className="account-orders-list">
            {orders.map((order) => {
              const isExpanded = expandedOrderId === order.id;
              return (
                <article key={order.id} className="account-order-card">
                  <div className="account-order-summary">
                    <span className="account-order-number">{order.orderNumber}</span>
                    <span className="account-order-date">{formatDate(order.createdAt, locale)}</span>
                    <span className="account-order-status">
                      {known(ORDER_STATUS_LABELS[order.status]) || order.status}
                    </span>
                    <span className="account-order-total">{formatPrice(order.total)}</span>
                    <button
                      type="button"
                      className="account-order-toggle"
                      onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                    >
                      {isExpanded ? t('account.hide') : t('account.show')}
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="account-order-details">
                      <p>
                        <strong>{t('account.delivery')}</strong> {order.customer?.address}
                      </p>
                      <p>
                        <strong>{t('account.articles', { count: order.items?.length || 0 })}</strong>
                      </p>
                      <ul>
                        {(order.items || []).map((item, index) => (
                          <li key={`${order.id}-${index}`}>
                            {item.name}
                            {item.details ? ` — ${detailsLabel(item.details, getProduct(item.productId))}` : ''} × {item.quantity} —{' '}
                            {formatPrice(item.price * item.quantity)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="account-section">
        <h2 className="account-section-title">{t('account.quick')}</h2>
        <div className="account-quick-links">
          <Link to="/favorites" className="account-link-btn">
            {t('account.myFavs')}{favoriteIds.length > 0 ? ` (${favoriteIds.length})` : ''}
          </Link>
          <Link to="/cart" className="account-link-btn secondary">
            {t('account.myCart')}{itemCount > 0 ? ` (${itemCount})` : ''}
          </Link>
        </div>
      </section>

      <section className="account-section">
        <div className="account-actions-row">
          <button type="button" className="account-link-btn secondary" onClick={handleLogout}>
            {t('account.logout')}
          </button>
        </div>
      </section>
    </main>
  );
}

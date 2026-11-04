import { useState, useEffect, useRef } from 'react';
import { ADMIN_URL } from '../lib/adminUrl';
import { Link, useNavigate } from '../lib/router';
import { useCart } from '../stores/cart';
import { useProducts } from '../stores/products';
import { cartItemName } from '@shared/productText';
import { useAuth } from '../stores/auth';
import { api, generateIdempotencyKey } from '../lib/apiClient';
import { formatPrice } from '@shared/formatPrice';
import { useT } from '../i18n/useT';


const TUNISIAN_GOVERNORATES = [
  'Tunis',
  'Sousse',
  'Nabeul',
  'Ariana',
  'Manouba',
  'Monastir',
  'Mahdia',
  'Ben Arous',
  'Bizerte',
  'Kairouan',
  'Sfax',
  'Zaghouan',
  'Beja',
  'Gabes',
  'Gafsa',
  'Jendouba',
  'Kasserine',
  'Kebili',
  'Kef',
  'Medenine',
  'Sidi Bouzid',
  'Siliana',
  'Tataouine',
  'Tozeur',
];

export default function Checkout() {
  const { t, known, govName, locale, detailsLabel } = useT();
  const navigate = useNavigate();
  const { isAdmin, user } = useAuth();
  const { items, subtotal, deliveryFee, total, refreshCart, loading } = useCart();
  const { refreshProducts, getProduct } = useProducts();
  // The order keeps the French name; Arabic pages show the Arabic name the cart API sends with each line.
  const itemName = (item) => cartItemName(item, locale);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    governorate: '',
    address: '',
  });

  const idempotencyKeyRef = useRef(null);

  useEffect(() => {
    if (user) {
      const parts = (user.fullName || user.full_name || '').split(' ');
      setForm((prev) => ({
        ...prev,
        firstName: prev.firstName || parts[0] || '',
        lastName: prev.lastName || parts.slice(1).join(' ') || '',
        phone: prev.phone || user.phone || user.phoneNumber || '',
        address: prev.address || user.address || '',
      }));
    }
  }, [user]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (fieldErrors[name]) {
      setFieldErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const validateForm = () => {
    const errors = {};

    const trimmedFirstName = (form.firstName || '').trim();
    if (!trimmedFirstName) {
      errors.firstName = t('contact.firstNameRequired');
    } else if (!/^[a-zA-ZÀ-ÿ\s'-]+$/.test(trimmedFirstName)) {
      errors.firstName = t('checkout.firstNameLetters');
    } else if (trimmedFirstName.length < 3) {
      errors.firstName = t('contact.firstNameMin');
    } else if (trimmedFirstName.length > 35) {
      errors.firstName = t('contact.firstNameMax');
    }

    const trimmedLastName = (form.lastName || '').trim();
    if (!trimmedLastName) {
      errors.lastName = t('checkout.lastNameRequired');
    } else if (!/^[a-zA-ZÀ-ÿ\s'-]+$/.test(trimmedLastName)) {
      errors.lastName = t('checkout.lastNameLetters');
    } else if (trimmedLastName.length < 3) {
      errors.lastName = t('checkout.lastNameMin');
    } else if (trimmedLastName.length > 35) {
      errors.lastName = t('checkout.lastNameMax');
    }

    const trimmedPhone = (form.phone || '').trim();
    if (!trimmedPhone) {
      errors.phone = t('checkout.phoneRequired');
    } else if (!/^\d{8}$/.test(trimmedPhone)) {
      errors.phone = t('auth.phone8');
    }

    if (!form.governorate) {
      errors.governorate = t('checkout.govRequired');
    }

    const trimmedAddress = (form.address || '').trim();
    if (!trimmedAddress) {
      errors.address = t('checkout.addressRequired');
    }

    return errors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isAdmin) {
      setError(t('product.adminOrder'));
      return;
    }
    if (!items.length) return;

    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    setError('');
    setFieldErrors({});

    // Ensure a stable idempotency key for this checkout attempt.
    // Preserved on network retry; reset on successful completion.
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = generateIdempotencyKey();
    }
    const idempotencyKey = idempotencyKeyRef.current;

    try {
      const order = await api.checkout(
        {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          phone: form.phone.trim(),
          governorate: form.governorate,
          address: form.address.trim(),
        },
        null,
        idempotencyKey
      );

      // Reset idempotency key on success so future checkout gets a new key
      idempotencyKeyRef.current = null;
      await refreshCart();
      await refreshProducts();
      navigate('/order-confirmation', { state: { order } });
    } catch (err) {
      // Keep idempotencyKeyRef.current so user retry reuses the same key
      setError(known(err.message) || t('checkout.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="checkout-page">
        <section className="checkout-section">
          <h1 className="checkout-title">{t('checkout.title')}</h1>
          <p className="checkout-empty">{t('cart.loading')}</p>
        </section>
      </main>
    );
  }

  if (isAdmin) {
    return (
      <main className="checkout-page">
        <section className="checkout-section">
          <h1 className="checkout-title">{t('checkout.title')}</h1>
          <p className="checkout-empty" style={{ color: '#b00020' }}>
            {t('checkout.adminCannotClient')}
          </p>
          <a href={ADMIN_URL} className="checkout-back-link" style={{ display: 'inline-block', marginTop: 16 }}>
            {t('contact.backAdmin')}
          </a>
        </section>
      </main>
    );
  }

  if (!items.length) {
    return (
      <main className="checkout-page">
        <section className="checkout-section">
          <h1 className="checkout-title">{t('checkout.title')}</h1>
          <p className="checkout-empty">{t('cart.empty')}</p>
          <Link to="/" className="checkout-back-link">
            {t('checkout.backShop')}
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="checkout-page">
      <section className="checkout-section">
        <h1 className="checkout-title">{t('checkout.title')}</h1>

        <div className="checkout-layout">
          <form className="checkout-form" onSubmit={handleSubmit} noValidate>
            <h2>{t('checkout.info')}</h2>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="firstName">{t('checkout.firstNameLabel')}</label>
                <input
                  id="firstName"
                  name="firstName"
                  value={form.firstName}
                  onChange={handleChange}
                  className={fieldErrors.firstName ? 'input-error' : ''}
                />
                {fieldErrors.firstName && (
                  <span className="field-error-msg">{fieldErrors.firstName}</span>
                )}
              </div>
              <div className="form-group">
                <label htmlFor="lastName">{t('checkout.lastNameLabel')}</label>
                <input
                  id="lastName"
                  name="lastName"
                  value={form.lastName}
                  onChange={handleChange}
                  className={fieldErrors.lastName ? 'input-error' : ''}
                />
                {fieldErrors.lastName && (
                  <span className="field-error-msg">{fieldErrors.lastName}</span>
                )}
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="phone">{t('checkout.phoneLabel')}</label>
              <input
                type="tel"
                id="phone"
                name="phone"
                inputMode="numeric"
                maxLength={8}
                value={form.phone}
                onChange={handleChange}
                className={fieldErrors.phone ? 'input-error' : ''}
              />
              {fieldErrors.phone && (
                <span className="field-error-msg">{fieldErrors.phone}</span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="governorate">{t('checkout.govLabel')}</label>
              <select
                id="governorate"
                name="governorate"
                value={form.governorate}
                onChange={handleChange}
                className={fieldErrors.governorate ? 'input-error' : ''}
              >
                <option value="">{t('checkout.govPlaceholder')}</option>
                {TUNISIAN_GOVERNORATES.map((gov) => (
                  <option key={gov} value={gov}>
                    {govName(gov)}
                  </option>
                ))}
              </select>
              {fieldErrors.governorate && (
                <span className="field-error-msg">{fieldErrors.governorate}</span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="address">{t('checkout.addressLabel')}</label>
              <textarea
                id="address"
                name="address"
                rows={3}
                placeholder={t('checkout.addressPlaceholder')}
                value={form.address}
                onChange={handleChange}
                className={fieldErrors.address ? 'input-error' : ''}
              />
              {fieldErrors.address && (
                <span className="field-error-msg">{fieldErrors.address}</span>
              )}
            </div>

            {error && <p className="checkout-error">{error}</p>}

            <button type="submit" className="checkout-submit" disabled={submitting}>
              {submitting ? t('checkout.confirming') : t('cart.confirm')}
            </button>
          </form>

          <aside className="checkout-summary">
            <h2>{t('checkout.summary')}</h2>
            <ul className="checkout-items">
              {items.map((item) => (
                <li key={item.cartItemId}>
                  <span>
                    {itemName(item)} × {item.quantity}
                    {item.details ? ` (${detailsLabel(item.details, getProduct(item.productId))})` : ''}
                  </span>
                  <span>{formatPrice(item.price * item.quantity)}</span>
                </li>
              ))}
            </ul>
            <div className="checkout-row">
              <span>{t('checkout.subtotal')}</span>
              <strong>{formatPrice(subtotal)}</strong>
            </div>
            <div className="checkout-row">
              <span>{t('cart.delivery')}</span>
              <strong>{formatPrice(deliveryFee)}</strong>
            </div>
            <div className="checkout-row checkout-total">
              <span>{t('cart.total')}</span>
              <strong>{formatPrice(total)}</strong>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

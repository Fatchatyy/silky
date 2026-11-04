import { useState, useEffect, useRef } from 'react';
import { useNavigate } from '../i18n/router';
import { useAuth } from '../context/AuthContext';
import { useProducts } from '../context/ProductsContext';
import { productName } from '../../shared/productText';
import { api, generateIdempotencyKey } from '../api/client';
import { formatPrice } from '../../shared/formatPrice';
import { DELIVERY_FEE_TND } from '../../shared/delivery';
import '../styles/buyNowModal.css';
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

const DEFAULT_DELIVERY_FEE = DELIVERY_FEE_TND;

export default function BuyNowModal({ isOpen, onClose, buyNowItem }) {
  const { t, known, govName, locale, detailsLabel } = useT();
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const { refreshProducts, getProduct } = useProducts();
  const modalRef = useRef(null);
  const idempotencyKeyRef = useRef(null);

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

  // Prefill phone from saved account when user is logged in
  useEffect(() => {
    if (user?.phoneNumber) {
      const digits = user.phoneNumber.replace(/\D/g, '').slice(0, 8);
      setForm((prev) => ({ ...prev, phone: digits }));
    }
  }, [user]);

  // Lock body scroll when modal is open and handle Escape key
  useEffect(() => {
    if (!isOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !buyNowItem) return null;

  const liveProduct = getProduct(buyNowItem.productId);
  const buyNowName = liveProduct ? productName(liveProduct, locale) : buyNowItem.name;

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'phone') {
      const numericValue = value.replace(/\D/g, '').slice(0, 8);
      setForm((prev) => ({ ...prev, phone: numericValue }));
      if (fieldErrors.phone) setFieldErrors((prev) => ({ ...prev, phone: '' }));
      return;
    }
    setForm((prev) => ({ ...prev, [name]: value }));
    if (fieldErrors[name]) setFieldErrors((prev) => ({ ...prev, [name]: '' }));
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
      errors.lastName = t('contact.lastNameRequired');
    } else if (!/^[a-zA-ZÀ-ÿ\s'-]+$/.test(trimmedLastName)) {
      errors.lastName = t('buynow.lastNameLetters');
    } else if (trimmedLastName.length < 3) {
      errors.lastName = t('contact.lastNameMin');
    } else if (trimmedLastName.length > 35) {
      errors.lastName = t('contact.lastNameMax');
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
      errors.address = "L'adresse de livraison est obligatoire.";
    }

    return errors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isAdmin) {
      setError(t('product.adminOrder'));
      return;
    }

    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    setError('');
    setFieldErrors({});

    // Ensure a stable idempotency key for this Buy Now attempt.
    // Preserved across retries if network fails, reset on success.
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
        {
          productId: buyNowItem.productId,
          colorId: buyNowItem.colorId,
          size: buyNowItem.size,
          quantity: buyNowItem.quantity,
        },
        idempotencyKey
      );

      // Reset idempotency key on success so future checkout gets a new key
      idempotencyKeyRef.current = null;
      await refreshProducts();
      onClose();
      navigate('/order-confirmation', { state: { order } });
    } catch (err) {
      // Keep idempotencyKeyRef.current so user retry reuses the same key
      setError(known(err.message) || t('buynow.failed'));
    } finally {
      setSubmitting(false);
    }
  };


  const unitPrice = buyNowItem.price || 0;
  const quantity = buyNowItem.quantity || 1;
  const subtotal = unitPrice * quantity;
  const deliveryFee = DEFAULT_DELIVERY_FEE;
  const total = subtotal + deliveryFee;

  return (
    <div
      className="buy-now-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="buy-now-modal" ref={modalRef} role="dialog" aria-modal="true">
        <div className="buy-now-modal-header">
          <h1 className="buy-now-modal-title">{t('checkout.title')}</h1>
          <button
            type="button"
            className="buy-now-close-btn"
            onClick={onClose}
            aria-label={t('share.close')}
          >
            &times;
          </button>
        </div>

        <div className="buy-now-layout">
          <form className="buy-now-form" onSubmit={handleSubmit} noValidate>
            <h2>{t('checkout.info')}</h2>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="buyNowFirstName">{t('checkout.firstNameLabel')}</label>
                <input
                  id="buyNowFirstName"
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
                <label htmlFor="buyNowLastName">{t('checkout.lastNameLabel')}</label>
                <input
                  id="buyNowLastName"
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
              <label htmlFor="buyNowPhone">{t('checkout.phoneLabel')}</label>
              <input
                type="tel"
                id="buyNowPhone"
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
              <label htmlFor="buyNowGovernorate">{t('checkout.govLabel')}</label>
              <select
                id="buyNowGovernorate"
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
              <label htmlFor="buyNowAddress">{t('checkout.addressLabel')}</label>
              <textarea
                id="buyNowAddress"
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

            {error && <p className="buy-now-error">{error}</p>}

            <button type="submit" className="buy-now-submit-btn" disabled={submitting}>
              {submitting ? t('checkout.confirming') : t('cart.confirm')}
            </button>
          </form>

          <aside className="buy-now-summary">
            <h2>{t('checkout.summary')}</h2>
            <div className="buy-now-item-card">
              {buyNowItem.image && (
                <img
                  src={buyNowItem.image}
                  alt={buyNowName}
                  className="buy-now-item-img"
                />
              )}
              <div className="buy-now-item-details">
                <h3 className="buy-now-item-title">{buyNowName}</h3>
                {buyNowItem.details && (
                  <p className="buy-now-item-variant">{detailsLabel(buyNowItem.details, liveProduct)}</p>
                )}
                <p className="buy-now-item-price-qty">
                  {formatPrice(unitPrice)} × {quantity}
                </p>
              </div>
            </div>

            <div className="buy-now-row">
              <span>{t('checkout.subtotal')}</span>
              <strong>{formatPrice(subtotal)}</strong>
            </div>
            <div className="buy-now-row">
              <span>{t('cart.delivery')}</span>
              <strong>{formatPrice(deliveryFee)}</strong>
            </div>
            <div className="buy-now-row buy-now-total">
              <span>{t('cart.total')}</span>
              <strong>{formatPrice(total)}</strong>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

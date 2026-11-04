import { useLocation } from 'react-router-dom';
import { Link } from '../i18n/router';
import '../styles/checkout.css';
import { useT } from '../i18n/useT';

export default function OrderConfirmation() {
  const { t } = useT();
  const { state } = useLocation();
  const order = state?.order;

  if (!order) {
    return (
      <main className="checkout-page">
        <section className="checkout-section">
          <h1 className="checkout-title">{t('order.confirmedTitle')}</h1>
          <p>{t('order.none')}</p>
          <Link to="/" className="checkout-back-link">
            {t('notfound.home')}
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="checkout-page">
      <section className="checkout-section checkout-success">
        <h1 className="checkout-title">{t('order.thanks')}</h1>
        <p className="checkout-order-number">{t('order.number')} <strong>{order.orderNumber}</strong></p>
        <p>{t('order.received')}</p>
        <Link to="/" className="checkout-back-link">
          {t('cart.continue')}
        </Link>
      </section>
    </main>
  );
}

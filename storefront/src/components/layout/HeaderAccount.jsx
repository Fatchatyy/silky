// The "Mon compte" / "Connexion" link (and the logout button once signed in): depends on the visitor's session.
import { Link, useNavigate } from '../../lib/router';
import { useT } from '../../i18n/useT';
import { useAuth } from '../../stores/auth';
import { withIsland } from '../../lib/island';

function HeaderAccount() {
  const navigate = useNavigate();
  const { t } = useT();
  const { isAuthenticated, isAdmin, logout } = useAuth();

  if (!isAuthenticated) {
    return (
      <Link to="/login" className="action_item">
        <img src="/pictures/account.png" alt={t('nav.account')} className="action_icon_img" />
        <span>{t('nav.account')}</span>
      </Link>
    );
  }

  // The admin panel is its own app: an admin signed in here goes to the customer account page like any customer.
  const accountLabel = isAdmin ? t('nav.admin') : t('nav.myAccount');
  return (
    <>
      <Link to="/account" className="action_item">
        <img src="/pictures/account.png" alt={accountLabel} className="action_icon_img" />
        <span>{accountLabel}</span>
      </Link>
      <button
        type="button"
        className="action_item header-logout-btn"
        onClick={() => {
          logout();
          navigate('/');
        }}
        title={t('nav.logout')}
        aria-label={t('nav.logout')}
      >
        <span>{t('nav.logout')}</span>
      </button>
    </>
  );
}

export default withIsland(HeaderAccount);

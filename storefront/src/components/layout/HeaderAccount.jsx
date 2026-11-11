// The "Mon compte" / "Connexion" link (and the logout button once signed in): depends on the visitor's session.
import { useEffect } from 'react';
import { Link, useNavigate } from '../../lib/router';
import { useT } from '../../i18n/useT';
import { useAuth } from '../../stores/auth';
import { withIsland } from '../../lib/island';
import { ADMIN_URL } from '../../lib/adminUrl';

// inDrawer: the second copy of this island, inside the phone menu. The admin tools must load once, from the copy in the bar.
function HeaderAccount({ inDrawer = false }) {
  const navigate = useNavigate();
  const { t } = useT();
  const { isAuthenticated, isAdmin, logout } = useAuth();

  // A valid admin token (useAuth has checked it with the API): load the admin tools, a separate chunk that visitors
  // never download. It finds the marked places of the page (hidden products, recommendations, ...) and fills them.
  useEffect(() => {
    if (isAdmin && !inDrawer) import('../../admin/enhance').then((module) => module.enhancePage());
  }, [isAdmin, inDrawer]);

  if (!isAuthenticated) {
    return (
      <Link to="/login" className="action_item">
        <img src="/pictures/account.png" alt={t('nav.account')} className="action_icon_img" />
        <span>{t('nav.account')}</span>
      </Link>
    );
  }

  // An admin's account link opens the admin panel, as on the old site.
  const accountLabel = isAdmin ? t('nav.admin') : t('nav.myAccount');
  return (
    <>
      {isAdmin ? (
        <a href={ADMIN_URL} className="action_item">
          <img src="/pictures/account.png" alt={accountLabel} className="action_icon_img" />
          <span>{accountLabel}</span>
        </a>
      ) : (
        <Link to="/account" className="action_item">
          <img src="/pictures/account.png" alt={accountLabel} className="action_icon_img" />
          <span>{accountLabel}</span>
        </Link>
      )}
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

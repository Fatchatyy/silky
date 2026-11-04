import { Link } from '../i18n/router';
import { useLocation } from 'react-router-dom';
import { useT } from '../i18n/useT';
import '../styles/review-login-prompt.css';

/** Shown to visitors who are not logged in instead of a review form: only customers can write a review. */
export default function ReviewLoginPrompt() {
  const { t } = useT();
  const { pathname, search } = useLocation();
  // After logging in (or signing up) the visitor comes back to the page they were on.
  const from = `${pathname}${search}`;

  return (
    <div className="review_login_prompt">
      <p>{t('review.loginRequired')}</p>
      <div className="review_login_prompt_actions">
        <Link to="/login" state={{ from }} className="review_login_prompt_btn review_login_prompt_btn_primary">
          {t('review.loginCta')}
        </Link>
        <Link to="/signup" state={{ from }} className="review_login_prompt_btn">
          {t('review.signupCta')}
        </Link>
      </div>
    </div>
  );
}

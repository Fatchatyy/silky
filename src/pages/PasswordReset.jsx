import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Link, useNavigate } from '../i18n/router';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import '../styles/pwreset.css';
import { useT } from '../i18n/useT';

export default function PasswordReset() {
  const { t, known } = useT();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  const { token } = useParams();
  const isResetStep = Boolean(token);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) {
    return null;
  }

  const handleEmailChange = (e) => {
    setEmail(e.target.value);
    if (fieldErrors.email) {
      setFieldErrors((prev) => ({ ...prev, email: '' }));
    }
  };

  const handlePasswordChange = (e) => {
    setPassword(e.target.value);
    if (fieldErrors.password) {
      setFieldErrors((prev) => ({ ...prev, password: '' }));
    }
  };

  const handleConfirmPasswordChange = (e) => {
    setConfirmPassword(e.target.value);
    if (fieldErrors.confirmPassword) {
      setFieldErrors((prev) => ({ ...prev, confirmPassword: '' }));
    }
  };

  const validateForgotForm = () => {
    const errors = {};
    const trimmedEmail = (email || '').trim();
    if (!trimmedEmail) {
      errors.email = t('contact.emailRequired');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      errors.email = t('contact.emailInvalid');
    }
    return errors;
  };

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    if (isAuthenticated) return;
    setError('');
    setMessage('');

    const errors = validateForgotForm();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setLoading(true);

    try {
      const result = await api.forgotPassword(email.trim());

      if (result.resetToken) {
        // Dev / no-SMTP mode: show the token so it can be tested locally
        setMessage(
          `(dev) Token: ${result.resetToken} — utilisez /password-reset/${result.resetToken}`,
        );
      } else {
        // Real email sent — show a clean confirmation
        setMessage(
          t('reset.sentOk'),
        );
      }
    } catch (err) {
      setError(known(err.message) || t('reset.sendFailed'));
    } finally {
      setLoading(false);
    }
  };

  const validateResetForm = () => {
    const errors = {};

    if (!password) {
      errors.password = t('auth.passwordRequired');
    } else if (password.length < 8) {
      errors.password = t('auth.passwordMin');
    }

    if (!confirmPassword) {
      errors.confirmPassword = t('reset.confirmRequired');
    } else if (confirmPassword.length < 8) {
      errors.confirmPassword = t('auth.passwordMin');
    } else if (password !== confirmPassword) {
      errors.confirmPassword = t('reset.mismatch');
    }

    return errors;
  };

  const handleResetSubmit = async (e) => {
    e.preventDefault();
    if (isAuthenticated) return;
    setError('');
    setMessage('');

    const errors = validateResetForm();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setLoading(true);

    try {
      const result = await api.resetPassword({ token, newPassword: password });
      setMessage(known(result.message));
    } catch (err) {
      setError(known(err.message) || t('reset.failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main>
      <section className="contact-section">
        <img src="/pictures/logo.png" alt="Silky" className="auth-logo" />
        <h1 className="contact-title">{t('auth.login')}</h1>
        <h2 className="reset-subtitle">
          {isResetStep ? t('reset.chooseNew') : t('reset.title')}
        </h2>

        {!isResetStep && (
          <div className="reset-intro">
            <p>{t('reset.intro1')}</p>
            <p>{t('reset.intro2')}</p>
          </div>
        )}

        {isResetStep ? (
          <form className="contact-form" onSubmit={handleResetSubmit} noValidate>
            <div className="form-group">
              <label htmlFor="password">{t('reset.newPassword')}</label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={handlePasswordChange}
                className={fieldErrors.password ? 'input-error' : ''}
                autoComplete="new-password"
              />
              {fieldErrors.password && (
                <span className="field-error-msg">{fieldErrors.password}</span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="confirmPassword">{t('reset.confirmPassword')}</label>
              <input
                type="password"
                id="confirmPassword"
                value={confirmPassword}
                onChange={handleConfirmPasswordChange}
                className={fieldErrors.confirmPassword ? 'input-error' : ''}
                autoComplete="new-password"
              />
              {fieldErrors.confirmPassword && (
                <span className="field-error-msg">{fieldErrors.confirmPassword}</span>
              )}
            </div>

            {error && <p className="form-error">{error}</p>}
            {message && <p className="form-success">{message}</p>}

            <div className="form-actions">
              <button type="submit" className="submit-btn" disabled={loading}>
                {loading ? t('common.saving') : t('common.save')}
              </button>
              <Link to="/login" className="cancel-link">
                {t('reset.back')}
              </Link>
            </div>
          </form>
        ) : (
          <form className="contact-form" onSubmit={handleForgotSubmit} noValidate>
            <div className="form-group">
              <label htmlFor="email">{t('contact.email')}</label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={handleEmailChange}
                className={fieldErrors.email ? 'input-error' : ''}
                autoComplete="email"
              />
              {fieldErrors.email && (
                <span className="field-error-msg">{fieldErrors.email}</span>
              )}
            </div>

            {error && <p className="form-error">{error}</p>}
            {message && <p className="form-success">{message}</p>}

            <div className="form-actions">
              <button type="submit" className="submit-btn" disabled={loading}>
                {loading ? t('common.sending') : t('contact.send')}
              </button>
              <Link to="/login" className="cancel-link">
                {t('common.cancel')}
              </Link>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}

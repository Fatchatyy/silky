import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Link, useNavigate } from '../i18n/router';
import { useAuth } from '../context/AuthContext';
import '../styles/auth.css';
import { useT } from '../i18n/useT';

export default function Login() {
  const { t, known } = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, login } = useAuth();

  const [form, setForm] = useState({ identifier: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) {
    return null;
  }

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (fieldErrors[name]) {
      setFieldErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const validateForm = () => {
    const errors = {};
    const trimmedId = (form.identifier || '').trim();

    if (!trimmedId) {
      errors.identifier = t('auth.identifierRequired');
    } else if (trimmedId.includes('@')) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedId)) {
        errors.identifier = t('contact.emailInvalid');
      }
    } else {
      if (!/^\d{8}$/.test(trimmedId)) {
        errors.identifier = t('auth.phone8');
      }
    }

    const passwordVal = form.password || '';
    if (!passwordVal) {
      errors.password = t('auth.passwordRequired');
    }

    return errors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isAuthenticated) return;
    setError('');

    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setLoading(true);

    try {
      const result = await login({
        identifier: form.identifier.trim(),
        password: form.password,
      });
      const defaultPath = result.user?.role === 'admin' ? '/admin' : '/account';
      let redirectTo = location.state?.from || defaultPath;
      if (result.user?.role === 'admin' && redirectTo === '/account') {
        redirectTo = '/admin';
      }
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(known(err.message) || t('auth.loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main>
      <section className="contact-section">
        <img src="/pictures/logo.png" alt="Silky" className="auth-logo" />
        <h1 className="contact-title">{t('auth.login')}</h1>

        <form className="contact-form" onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="identifier">{t('auth.identifierLabel')}</label>
            <input
              type="text"
              id="identifier"
              name="identifier"
              value={form.identifier}
              onChange={handleChange}
              className={fieldErrors.identifier ? 'input-error' : ''}
              autoComplete="username"
            />
            {fieldErrors.identifier && (
              <span className="field-error-msg">{fieldErrors.identifier}</span>
            )}
          </div>

          <div className="form-group">
            <div className="label-row">
              <label htmlFor="password">{t('auth.password')}</label>
              <Link to="/password-reset" className="forgot-link">
                {t('auth.forgot')}
              </Link>
            </div>
            <input
              type="password"
              id="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              className={fieldErrors.password ? 'input-error' : ''}
              autoComplete="current-password"
            />
            {fieldErrors.password && <span className="field-error-msg">{fieldErrors.password}</span>}
          </div>

          {error && <p className="form-error">{error}</p>}

          <div className="form-actions">
            <button type="submit" className="submit-btn" disabled={loading}>
              {loading ? t('auth.loggingIn') : t('auth.submitLogin')}
            </button>
            <Link to="/signup" state={location.state} className="secondary-btn">
              {t('auth.createAccount')}
            </Link>
          </div>
        </form>
      </section>
    </main>
  );
}

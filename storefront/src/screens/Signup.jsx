import { useState } from 'react';
import { useLocation } from '../lib/router.jsx';
import { Link, useNavigate } from '../lib/router';
import { useAuth } from '../stores/auth';
import { useT } from '../i18n/useT';

export default function Signup() {
  const { t, known } = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, register } = useAuth();

  const [form, setForm] = useState({ prenom: '', nom: '', identifier: '', password: '' });
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

    const trimmedPrenom = (form.prenom || '').trim();
    if (!trimmedPrenom) {
      errors.prenom = t('contact.firstNameRequired');
    } else if (trimmedPrenom.length < 3) {
      errors.prenom = t('contact.firstNameMin');
    } else if (trimmedPrenom.length > 35) {
      errors.prenom = t('contact.firstNameMax');
    }

    const trimmedNom = (form.nom || '').trim();
    if (!trimmedNom) {
      errors.nom = t('contact.lastNameRequired');
    } else if (trimmedNom.length < 3) {
      errors.nom = t('contact.lastNameMin');
    } else if (trimmedNom.length > 35) {
      errors.nom = t('contact.lastNameMax');
    }

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
    } else if (passwordVal.length < 8) {
      errors.password = t('auth.passwordMin');
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
      await register({
        prenom: form.prenom.trim(),
        nom: form.nom.trim(),
        identifier: form.identifier.trim(),
        password: form.password,
      });
      // Back to the page the visitor came from (for example a review prompt); an internal path only.
      const from = location.state?.from;
      const backTo = typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/account';
      navigate(backTo, { replace: true });
    } catch (err) {
      setError(known(err.message) || t('auth.signupFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main>
      <section className="contact-section">
        <img src="/pictures/logo.png" alt="Silky" className="auth-logo" />
        <h1 className="contact-title">{t('auth.createAccount')}</h1>

        <form className="contact-form" onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="prenom">{t('contact.firstName')}</label>
            <input
              type="text"
              id="prenom"
              name="prenom"
              value={form.prenom}
              onChange={handleChange}
              className={fieldErrors.prenom ? 'input-error' : ''}
              autoComplete="given-name"
            />
            {fieldErrors.prenom && <span className="field-error-msg">{fieldErrors.prenom}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="nom">{t('contact.lastName')}</label>
            <input
              type="text"
              id="nom"
              name="nom"
              value={form.nom}
              onChange={handleChange}
              className={fieldErrors.nom ? 'input-error' : ''}
              autoComplete="family-name"
            />
            {fieldErrors.nom && <span className="field-error-msg">{fieldErrors.nom}</span>}
          </div>

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
            <label htmlFor="password">{t('auth.password')}</label>
            <input
              type="password"
              id="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              className={fieldErrors.password ? 'input-error' : ''}
              autoComplete="new-password"
            />
            {fieldErrors.password && <span className="field-error-msg">{fieldErrors.password}</span>}
          </div>

          {error && <p className="form-error">{error}</p>}

          <div className="form-actions">
            <button type="submit" className="submit-btn" disabled={loading}>
              {loading ? t('auth.creating') : t('auth.create')}
            </button>
            <Link to="/login" state={location.state} className="secondary-btn">
              {t('auth.haveAccount')}
            </Link>
          </div>
        </form>
      </section>
    </main>
  );
}

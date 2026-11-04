import { useState, useEffect } from 'react';
import { ADMIN_URL } from '../lib/adminUrl';
import { Link } from '../lib/router';
import { api } from '../lib/apiClient';
import { useAuth } from '../stores/auth';
import RichText from '../components/RichText';
import { getTextPage } from '@shared/textPages';
import { useLocale } from '../i18n/LocaleContext';
import { useT } from '../i18n/useT';

export default function Contact() {
  const { locale } = useLocale();
  const { t, known } = useT();
  const contactPage = getTextPage('contact', locale);
  const { user, isAdmin } = useAuth();
  const [form, setForm] = useState({
    prenom: '',
    nom: '',
    email: user?.email || '',
    message: '',
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (user?.email) {
      setForm((prev) => ({
        ...prev,
        email: prev.email || user.email,
      }));
    }
  }, [user?.email]);

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

    const trimmedEmail = (form.email || '').trim();
    if (!trimmedEmail) {
      errors.email = t('contact.emailRequired');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      errors.email = t('contact.emailInvalid');
    }

    const trimmedMessage = (form.message || '').trim();
    if (!trimmedMessage) {
      errors.message = t('contact.messageRequired');
    }

    return errors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isAdmin) {
      setError(t('contact.adminCannot'));
      return;
    }

    setSuccess('');
    setError('');

    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);

    try {
      await api.submitContactMessage({
        prenom: form.prenom.trim(),
        nom: form.nom.trim(),
        email: form.email.trim(),
        message: form.message.trim(),
      });
      setSuccess(t('contact.success'));
      setForm({
        prenom: '',
        nom: '',
        email: user?.email || '',
        message: '',
      });
    } catch (err) {
      setError(known(err.message) || t('contact.error'));
    } finally {
      setSubmitting(false);
    }
  };

  if (isAdmin) {
    return (
      <main>
        <section className="contact-section">
          <div className="contact-container" style={{ textAlign: 'center' }}>
            <h1 className="contact-title">{contactPage.title}</h1>
            <p className="form-error" style={{ fontSize: 16, marginTop: 24 }}>
              {t('contact.adminCannot')}
            </p>
            <div style={{ marginTop: 24 }}>
              <a href={ADMIN_URL} className="submit-btn" style={{ display: 'inline-block', textDecoration: 'none' }}>
                {t('contact.backAdmin')}
              </a>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main>
      <section className="contact-section">
        <div className="contact-container">
          <h1 className="contact-title">{contactPage.title}</h1>

          <div className="contact-intro">
            {contactPage.intro.map((parts, index) => (
              <p key={index}>
                <RichText parts={parts} />
              </p>
            ))}
          </div>

          <form className="contact-form" onSubmit={handleSubmit} noValidate>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="prenom">{t('contact.firstName')}</label>
                <input
                  type="text"
                  id="prenom"
                  name="prenom"
                  value={form.prenom}
                  onChange={handleChange}
                  className={fieldErrors.prenom ? 'input-error' : ''}
                />
                {fieldErrors.prenom && (
                  <span className="field-error-msg">{fieldErrors.prenom}</span>
                )}
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
                />
                {fieldErrors.nom && (
                  <span className="field-error-msg">{fieldErrors.nom}</span>
                )}
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="email">{t('contact.email')}</label>
              <input
                type="email"
                id="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                className={fieldErrors.email ? 'input-error' : ''}
              />
              {fieldErrors.email && (
                <span className="field-error-msg">{fieldErrors.email}</span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="message">{t('contact.message')}</label>
              <textarea
                id="message"
                name="message"
                rows={6}
                value={form.message}
                onChange={handleChange}
                className={fieldErrors.message ? 'input-error' : ''}
              />
              {fieldErrors.message && (
                <span className="field-error-msg">{fieldErrors.message}</span>
              )}
            </div>

            {error && <p className="form-error">{error}</p>}
            {success && <p className="form-success">{success}</p>}

            <div className="form-actions">
              <button type="submit" className="submit-btn" disabled={submitting}>
                {submitting ? t('contact.sending') : t('contact.send')}
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}

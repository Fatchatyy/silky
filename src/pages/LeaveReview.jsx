import { useState } from 'react';
import { Link } from '../i18n/router';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import ReviewsSection from '../components/ReviewsSection';
import ReviewLoginPrompt from '../components/ReviewLoginPrompt';
import '../styles/reviews-page.css';
import '../styles/home.css';
import { useT } from '../i18n/useT';

export default function LeaveReview() {
  const { t, known } = useT();
  const { user, isAuthenticated, isAdmin, loading: authLoading } = useAuth();
  const [form, setForm] = useState({ body: '', rating: 5 });
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (fieldErrors[name]) {
      setFieldErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const validateForm = () => {
    const errors = {};
    const nameVal = user?.fullName || user?.full_name || user?.name || '';
    const emailVal = user?.email || '';

    const trimmedName = (nameVal || '').trim();
    if (!trimmedName) {
      errors.authorName = t('review.nameRequired');
    } else if (trimmedName.length < 3) {
      errors.authorName = t('review.nameMin');
    } else if (trimmedName.length > 35) {
      errors.authorName = t('review.nameMax');
    }

    const trimmedEmail = (emailVal || '').trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      errors.email = t('contact.emailInvalid');
    }

    const trimmedBody = (form.body || '').trim();
    if (!trimmedBody) {
      errors.body = t('review.commentRequired');
    }

    return errors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isAdmin) {
      setError(t('review.adminCannot'));
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

    // Only customers can write a review: the name and e-mail are the account's, never typed.
    const finalAuthorName = user?.fullName || user?.full_name || user?.name || 'Client';
    const finalEmail = user?.email || '';

    try {
      await api.submitReview({
        ...form,
        authorName: finalAuthorName,
        email: finalEmail,
        body: form.body.trim(),
        rating: Number(form.rating),
      });
      setSuccess(true);
      setForm({ body: '', rating: 5 });
    } catch (err) {
      setError(known(err.message) || t('review.sendFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (isAdmin) {
    return (
      <>
        <main className="collections_wrapper" style={{ minHeight: 400, paddingTop: 40 }}>
          <h1 className="collection_title">{t('review.give')}</h1>
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <p style={{ fontSize: 16, color: '#b00020', marginBottom: 24 }}>
              {t('review.adminClient')}
            </p>
            <Link to="/admin" className="tout_button">
              {t('contact.backAdmin')}
            </Link>
          </div>
        </main>
        <ReviewsSection layout="leave-review" />
      </>
    );
  }

  return (
    <>
      <main className="reviews-page">
        <section className="reviews-page-section">
          <div className="reviews-page-header">
            <img src="/pictures/avis.png" alt={t('reviews.logoAlt')} className="reviews-page-logo" />
            <h1>{t('review.give')}</h1>
            <p>{t('review.pageIntro')}</p>
          </div>

          {success ? (
            <div className="reviews-page-success">
              <h2>{t('review.thanks')}</h2>
              <p>{t('review.thanksMsg')}</p>
              <button type="button" className="reviews-page-btn" onClick={() => setSuccess(false)}>
                {t('review.another')}
              </button>
              <Link to="/" className="reviews-page-link">
                {t('notfound.home')}
              </Link>
            </div>
          ) : authLoading ? null : !isAuthenticated ? (
            <ReviewLoginPrompt />
          ) : (
            <form className="reviews-page-form" onSubmit={handleSubmit} noValidate>
              <div className="form-group">
                <label htmlFor="rating">{t('review.ratingShort')}</label>
                <select id="rating" name="rating" value={form.rating} onChange={handleChange}>
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {n} / 5
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="body">{t('review.yourOpinion')}</label>
                <textarea
                  id="body"
                  name="body"
                  rows={6}
                  value={form.body}
                  onChange={handleChange}
                  placeholder={t('review.pagePlaceholder')}
                  className={fieldErrors.body ? 'input-error' : ''}
                />
                {fieldErrors.body && (
                  <span className="field-error-msg">{fieldErrors.body}</span>
                )}
              </div>

              {error && <p className="reviews-page-error">{error}</p>}

              <button type="submit" className="reviews-page-btn" disabled={submitting}>
                {submitting ? t('common.sending') : t('review.send')}
              </button>
            </form>
          )}
        </section>
      </main>

      <ReviewsSection layout="leave-review" />
    </>
  );
}


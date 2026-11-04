import { lazy, Suspense, useEffect, useState } from 'react';
import { api } from '../lib/apiClient';
import { useAuth } from '../stores/auth';
import ReviewLoginPrompt from './ReviewLoginPrompt';

// Review moderation for an admin: a separate chunk, downloaded only with a valid admin token.
const AdminProductReviewsSection = lazy(() => import('../admin/AdminProductReviewsSection'));
import { useT } from '../i18n/useT';

// initialReviews / initialSummary come from the server render, so the reviews are in the first HTML.
export default function ProductReviewsSection({ productId, initialReviews = null, initialSummary = null }) {
  const { t, known } = useT();
  const { user, isAuthenticated, isAdmin, loading: authLoading } = useAuth();

  const [reviews, setReviews] = useState(initialReviews || []);
  const [summary, setRatingSummary] = useState(initialSummary || { average: 0, count: 0 });
  const [loading, setLoading] = useState(!initialReviews);

  const [form, setForm] = useState({ rating: 5, comment: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  // Kept as a key (or the raw server text) and translated at render, so it follows a language switch.
  const [message, setMessage] = useState(null);
  const [messageType, setMessageType] = useState('');

  const fetchReviews = async () => {
    if (!productId) return;
    setLoading(true);
    try {
      const data = await api.getProductReviews(productId);
      if (data) {
        setReviews(data.reviews || []);
        setRatingSummary(data.summary || { average: 0, count: 0 });
      }
    } catch {
      /* fallback empty */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialReviews) fetchReviews();
  }, [productId]);

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

    const trimmedComment = (form.comment || '').trim();
    if (!trimmedComment) {
      errors.comment = t('review.commentRequired');
    }

    return errors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isAdmin) {
      setMessage({ key: 'review.adminCannot' });
      setMessageType('error');
      return;
    }

    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    setMessage(null);
    setFieldErrors({});

    // Only customers can write a review: the name and e-mail are the account's, never typed.
    const finalAuthorName = user?.fullName || user?.full_name || user?.name || 'Client';
    const finalEmail = user?.email || '';

    try {
      await api.submitProductReview(productId, {
        authorName: finalAuthorName,
        email: finalEmail,
        rating: Number(form.rating),
        comment: form.comment.trim(),
      });
      setMessage({ key: 'review.submitOk' });
      setMessageType('success');
      setForm({ rating: 5, comment: '' });
    } catch (err) {
      setMessage({ raw: err.message });
      setMessageType('error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="product_reviews_section" aria-label={t('review.sectionLabel')}>
      <div className="product_reviews_container" id="product_reviews_container">
        <h2 className="product_reviews_heading">{t('review.productHeading')}</h2>

        <div className="product_reviews_summary_header">
          {summary.count > 0 ? (
            <div className="product_rating_badge">
              <span className="rating_number">{summary.average}/5</span>
              <span className="rating_stars">
                {'★'.repeat(Math.round(summary.average))}
                {'☆'.repeat(5 - Math.round(summary.average))}
              </span>
              <span className="rating_count">({t('reviews.count', { count: summary.count })})</span>
            </div>
          ) : (
            <div className="no_rating_badge">
              <span>{t('review.noneYet')}</span>
            </div>
          )}
        </div>

        <div className="product_reviews_layout">
          {/* Reviews list */}
          <div className="product_reviews_list_wrapper">
            {loading ? (
              <p className="loading_text">{t('review.loadingList')}</p>
            ) : reviews.length === 0 ? (
              <div className="empty_reviews_box">
                <p>{t('review.noPublished')}</p>
              </div>
            ) : (
              <div className="product_reviews_cards">
                {reviews.map((rev) => (
                  <article key={rev.id} className="product_review_card">
                    <div className="product_review_card_header">
                      <strong className="review_author">{rev.authorName || t('review.anonymous')}</strong>
                      <span className="review_stars">
                        {'★'.repeat(rev.rating)}
                        {'☆'.repeat(5 - rev.rating)}
                      </span>
                    </div>
                    <p className="review_text">{rev.comment || rev.body}</p>
                    <time className="review_date">
                      {new Date(rev.createdAt).toLocaleDateString('fr-FR')}
                    </time>
                  </article>
                ))}
              </div>
            )}
          </div>

          {/* Compact Review Form */}
          <div className="product_review_form_wrapper">
            <h3 className="compact_form_title">{t('review.give')}</h3>

            {isAdmin ? (
              <p className="admin_notice_text">
                {t('review.adminProduct')}
              </p>
            ) : authLoading ? null : !isAuthenticated ? (
              <ReviewLoginPrompt />
            ) : (
              <form className="compact_review_form" onSubmit={handleSubmit} noValidate>
                <div className="compact_form_group">
                  <label htmlFor="product_review_rating">{t('review.rating')}</label>
                  <select
                    id="product_review_rating"
                    value={form.rating}
                    onChange={(e) => setForm((f) => ({ ...f, rating: Number(e.target.value) }))}
                  >
                    <option value={5}>★★★★★ (5/5)</option>
                    <option value={4}>★★★★☆ (4/5)</option>
                    <option value={3}>★★★☆☆ (3/5)</option>
                    <option value={2}>★★☆☆☆ (2/5)</option>
                    <option value={1}>★☆☆☆☆ (1/5)</option>
                  </select>
                </div>

                <div className="compact_form_group">
                  <label htmlFor="product_review_comment">{t('review.yourOpinion')}</label>
                  <textarea
                    id="product_review_comment"
                    rows={4}
                    value={form.comment}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, comment: e.target.value }));
                      if (fieldErrors.comment) setFieldErrors((f) => ({ ...f, comment: '' }));
                    }}
                    placeholder={t('review.commentPlaceholder')}
                    className={fieldErrors.comment ? 'input-error' : ''}
                  />
                  {fieldErrors.comment && (
                    <span className="field-error-msg">{fieldErrors.comment}</span>
                  )}
                </div>

                {message && (
                  <p className={`form_message ${messageType}`}>
                    {message.key ? t(message.key) : known(message.raw) || t('review.submitFailed')}
                  </p>
                )}

                <button type="submit" className="compact_submit_btn" disabled={submitting}>
                  {submitting ? t('common.sending') : t('review.send')}
                </button>
              </form>
            )}
          </div>
        </div>

        {isAdmin && (
          <Suspense fallback={null}>
            <AdminProductReviewsSection productId={productId} onReviewUpdated={fetchReviews} />
          </Suspense>
        )}
      </div>
    </section>
  );
}

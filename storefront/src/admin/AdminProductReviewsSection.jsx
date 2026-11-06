import { useEffect, useState } from 'react';
import { adminApi as api, catalogueChanged } from './adminApi';
import './adminStyles';

export default function AdminProductReviewsSection({ productId, onReviewUpdated, highlightReviewId = null }) {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeHighlightId, setActiveHighlightId] = useState(null);

  const loadReviews = async (isInitial = false) => {
    if (!productId) return;
    if (isInitial) setLoading(true);
    setError('');
    try {
      const data = await api.getAdminProductReviews(productId);
      setReviews(data || []);
    } catch (err) {
      setError(err.message || 'Impossible de charger les avis.');
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  useEffect(() => {
    loadReviews(true);
  }, [productId]);

  useEffect(() => {
    if (highlightReviewId && reviews.length > 0) {
      setActiveHighlightId(highlightReviewId);
      const timer = setTimeout(() => {
        const el = document.getElementById(`product-review-${highlightReviewId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 150);

      const clearTimer = setTimeout(() => {
        setActiveHighlightId(null);
      }, 3500);

      return () => {
        clearTimeout(timer);
        clearTimeout(clearTimer);
      };
    }
  }, [highlightReviewId, reviews]);

  const handleUpdateStatus = async (reviewId, status) => {
    try {
      await api.updateAdminProductReview(reviewId, { status });
      await loadReviews();
      catalogueChanged();
      if (onReviewUpdated) onReviewUpdated();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleToggleGeneral = async (reviewId, currentVal) => {
    try {
      await api.updateAdminProductReview(reviewId, { showInGeneral: !currentVal });
      await loadReviews();
      catalogueChanged();
      if (onReviewUpdated) onReviewUpdated();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (reviewId) => {
    if (!window.confirm('Supprimer cet avis produit ?')) return;
    try {
      await api.deleteAdminProductReview(reviewId);
      await loadReviews();
      catalogueChanged();
      if (onReviewUpdated) onReviewUpdated();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <p className="admin-loading" style={{ marginTop: 20 }}>Chargement des avis du produit...</p>;

  return (
    <div className="admin-product-reviews-container" style={{ marginTop: 30, paddingTop: 20, borderTop: '1px solid #eee' }}>
      <h4 style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 12 }}>Avis clients pour ce produit ({reviews.length})</h4>
      {error && <p className="admin-message error" style={{ color: 'red' }}>{error}</p>}

      {reviews.length === 0 ? (
        <p className="admin-empty" style={{ fontSize: 13, color: '#666' }}>Aucun avis soumis pour ce produit.</p>
      ) : (
        <div className="admin-reviews-list" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {reviews.map((review) => (
            <div
              key={review.id}
              id={`product-review-${review.id}`}
              className={`admin-review-card ${review.status} ${activeHighlightId === review.id ? 'notification-highlight' : ''}`}
              style={{ padding: 14, border: '1px solid #e0e0e0', borderRadius: 8, background: '#fafafa' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                <strong>{review.authorName} <span style={{ color: '#f5a623' }}>({review.rating}/5★)</span></strong>
                <span
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontWeight: 'bold',
                    background: review.status === 'approved' ? '#e8f5e9' : review.status === 'rejected' ? '#ffebee' : '#fff3e0',
                    color: review.status === 'approved' ? '#2e7d32' : review.status === 'rejected' ? '#c62828' : '#e65100',
                  }}
                >
                  {review.status === 'approved' ? 'Approuvé' : review.status === 'rejected' ? 'Refusé' : 'En attente'}
                </span>
              </div>
              <p style={{ fontSize: 13, color: '#333', marginBottom: 10, lineHeight: 1.4 }}>{review.comment || review.body}</p>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                {review.status !== 'approved' && (
                  <button type="button" className="admin-btn sm" onClick={() => handleUpdateStatus(review.id, 'approved')}>
                    Approuver
                  </button>
                )}
                {review.status !== 'rejected' && (
                  <button type="button" className="admin-btn secondary sm" onClick={() => handleUpdateStatus(review.id, 'rejected')}>
                    Refuser
                  </button>
                )}
                <button type="button" className="admin-btn danger sm" onClick={() => handleDelete(review.id)}>
                  Supprimer
                </button>

                <button
                  type="button"
                  className={`admin-btn sm ${review.showInGeneral ? 'warning-btn' : 'secondary'}`}
                  style={{ marginLeft: 'auto' }}
                  onClick={() => handleToggleGeneral(review.id, review.showInGeneral)}
                >
                  {review.showInGeneral ? '★ Visible dans Avis Généraux (clic pour masquer)' : '+ Afficher dans Avis Généraux'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

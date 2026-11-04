import { useEffect, useState } from 'react';
import { mediaUrl } from '@shared/media';
import { adminApi as api } from '../../admin/adminApi';

const STATUS_LABELS = {
  pending: 'En attente',
  approved: 'Approuvé',
  rejected: 'Refusé',
};

export default function AdminReviews({ highlightReviewId = null }) {
  const [reviews, setReviews] = useState([]);
  const [gallery, setGallery] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [galleryAlt, setGalleryAlt] = useState('');
  const [galleryFile, setGalleryFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [activeHighlightId, setActiveHighlightId] = useState(null);

  const loadAll = async (isInitial = false) => {
    if (isInitial) setLoading(true);
    setError('');
    try {
      const [reviewData, galleryData] = await Promise.all([api.getAllReviews(), api.getGallery()]);
      setReviews(reviewData);
      setGallery(galleryData);
    } catch (err) {
      setError(err.message);
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  useEffect(() => {
    loadAll(true);
  }, []);

  useEffect(() => {
    if (highlightReviewId && reviews.length > 0) {
      setActiveHighlightId(highlightReviewId);
      const timer = setTimeout(() => {
        const el = document.getElementById(`review-${highlightReviewId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);

      const clearTimer = setTimeout(() => {
        setActiveHighlightId(null);
      }, 3500);

      return () => {
        clearTimeout(timer);
        clearTimeout(clearTimer);
      };
    }
  }, [highlightReviewId, reviews]);

  const updateStatus = async (id, status) => {
    try {
      await api.updateReviewStatus(id, status);
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAddGallery = async (e) => {
    e.preventDefault();
    setUploading(true);
    setError('');

    try {
      const formData = new FormData();
      if (galleryFile) formData.append('image', galleryFile);
      if (galleryAlt) formData.append('alt', galleryAlt);
      await api.addGalleryItem(formData);
      setGalleryAlt('');
      setGalleryFile(null);
      loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteGallery = async (id) => {
    if (!confirm('Supprimer cette image de la galerie?')) return;
    try {
      await api.deleteGalleryItem(id);
      loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <p className="admin-loading">Chargement des avis...</p>;

  const pending = reviews.filter((r) => r.status === 'pending');
  const approved = reviews.filter((r) => r.status === 'approved');

  return (
    <div className="admin-reviews-layout">
      <section className="admin-panel">
        <h2>Galerie photos (carrousel horizontal)</h2>
        <p>Ces images apparaissent dans le carrousel horizontal de la section avis sur le site.</p>

        <form className="admin-gallery-form" onSubmit={handleAddGallery}>
          <div className="form-group">
            <label htmlFor="galleryFile">Téléverser une image</label>
            <input
              id="galleryFile"
              type="file"
              accept="image/*"
              onChange={(e) => setGalleryFile(e.target.files?.[0] || null)}
            />
          </div>
          <button type="submit" className="admin-primary-btn" disabled={uploading}>
            {uploading ? 'Ajout...' : 'Ajouter à la galerie'}
          </button>
        </form>

        <div className="admin-gallery-grid">
          {gallery.map((item) => (
            <figure key={item.id} className="admin-gallery-item">
              <img src={mediaUrl(item.src)} alt={item.alt} />
              <figcaption>{item.alt}</figcaption>
              <button type="button" onClick={() => handleDeleteGallery(item.id)}>
                Supprimer
              </button>
            </figure>
          ))}
        </div>
      </section>

      <section className="admin-panel">
        <h2>Avis en attente ({pending.length})</h2>
        {error && <p className="admin-error">{error}</p>}

        {pending.length === 0 ? (
          <p className="admin-empty">Aucun avis en attente.</p>
        ) : (
          <div className="admin-reviews-list">
            {pending.map((review) => (
              <article
                key={review.id}
                id={`review-${review.id}`}
                className={`admin-review-card ${activeHighlightId === review.id ? 'notification-highlight' : ''}`}
              >
                <div className="admin-review-meta">
                  <strong>{review.authorName}</strong>
                  <span>{review.rating}/5</span>
                  <span>{new Date(review.createdAt).toLocaleString('fr-FR')}</span>
                </div>
                <p>{review.body}</p>
                {review.email && <p className="admin-review-email">{review.email}</p>}
                <div className="admin-review-actions">
                  <button type="button" className="approve" onClick={() => updateStatus(review.id, 'approved')}>
                    Approuver (afficher sur le site)
                  </button>
                  <button type="button" className="reject" onClick={() => updateStatus(review.id, 'rejected')}>
                    Refuser
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="admin-panel">
        <h2>Avis publiés ({approved.length})</h2>
        <p>Ces avis sont visibles dans la liste verticale sur la page d&apos;accueil et les pages produit.</p>

        {approved.length === 0 ? (
          <p className="admin-empty">Aucun avis publié.</p>
        ) : (
          <div className="admin-reviews-list">
            {approved.map((review) => (
              <article
                key={review.id}
                id={`review-${review.id}`}
                className={`admin-review-card approved ${activeHighlightId === review.id ? 'notification-highlight' : ''}`}
              >
                <div className="admin-review-meta">
                  <strong>{review.authorName}</strong>
                  <span>{review.rating}/5</span>
                  <span>{STATUS_LABELS[review.status]}</span>
                </div>
                <p>{review.body}</p>
                <div className="admin-review-actions">
                  <button type="button" onClick={() => updateStatus(review.id, 'pending')}>
                    Retirer du site
                  </button>
                  <button type="button" className="reject" onClick={() => updateStatus(review.id, 'rejected')}>
                    Supprimer
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

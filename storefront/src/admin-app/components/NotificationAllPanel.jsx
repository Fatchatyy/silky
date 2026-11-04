import React, { useEffect, useState } from 'react';
import { adminApi as api } from '../../admin/adminApi';

function formatRelativeTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 60) return "À l'instant";
  if (diffSec < 3600) return `Il y a ${Math.floor(diffSec / 60)} min`;
  if (diffSec < 86400) return `Il y a ${Math.floor(diffSec / 3600)} h`;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getTypeIcon(type) {
  switch (type) {
    case 'order':
      return '/pictures/orders.png';
    case 'review':
      return '/pictures/avisdash.png';
    case 'product_review':
      return '/pictures/product.png';
    case 'contact_message':
      return '/pictures/message.png';
    default:
      return '/pictures/bell.png';
  }
}

export default function NotificationAllPanel({
  isOpen,
  onClose,
  onMarkRead,
  onMarkAllRead,
  onNavigate,
}) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const limit = 15;

  const loadPage = async (pageIndex = 0) => {
    setLoading(true);
    setError('');
    try {
      const offset = pageIndex * limit;
      const res = await api.getAllNotifications({ offset, limit });
      setItems(res.notifications || []);
      setTotal(res.total || 0);
      setPage(pageIndex);
    } catch (err) {
      setError(err.message || 'Impossible de charger les notifications.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadPage(0);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const totalPages = Math.ceil(total / limit) || 1;

  const handleItemClick = async (n) => {
    if (!n.isRead) {
      await onMarkRead(n.id);
      setItems((prev) => prev.map((item) => (item.id === n.id ? { ...item, isRead: true } : item)));
    }
    onNavigate(n);
    onClose();
  };

  const handleMarkAll = async () => {
    await onMarkAllRead();
    setItems((prev) => prev.map((item) => ({ ...item, isRead: true })));
  };

  return (
    <div
      className="admin-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="admin-notification-all-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-notification-all-header">
          <div className="admin-notification-all-title-wrap">
            <img src="/pictures/bell.png" alt="" className="admin-modal-bell-icon" />
            <h3>Toutes les notifications ({total})</h3>
          </div>
          <div className="admin-notification-all-actions">
            <button
              type="button"
              className="admin-notification-mark-all-btn"
              onClick={handleMarkAll}
            >
              Marquer tout comme lu
            </button>
            <button
              type="button"
              className="admin-sidebar-close"
              onClick={onClose}
              aria-label="Fermer"
              style={{ position: 'static', color: '#666' }}
            >
              ✕
            </button>
          </div>
        </div>

        {error && <p className="admin-error" style={{ margin: '16px 20px 0' }}>{error}</p>}

        <div className="admin-notification-all-body">
          {loading ? (
            <p className="admin-loading" style={{ padding: '30px', textAlign: 'center' }}>
              Chargement des notifications...
            </p>
          ) : items.length === 0 ? (
            <p className="admin-empty" style={{ padding: '40px', textAlign: 'center' }}>
              Aucune notification trouvée.
            </p>
          ) : (
            <div className="admin-notification-all-list">
              {items.map((n) => (
                <div
                  key={n.id}
                  className={`admin-notification-item ${n.isRead ? 'read' : 'unread'}`}
                  onClick={() => handleItemClick(n)}
                >
                  <div className="admin-notification-item-icon-wrap">
                    <span
                      className="admin-notification-item-icon"
                      style={{
                        WebkitMaskImage: `url(${getTypeIcon(n.type)})`,
                        maskImage: `url(${getTypeIcon(n.type)})`,
                      }}
                      aria-hidden="true"
                    />
                  </div>
                  <div className="admin-notification-item-content">
                    <div className="admin-notification-item-top">
                      <span className="admin-notification-item-title">{n.title}</span>
                      <span className="admin-notification-item-time">{formatRelativeTime(n.createdAt)}</span>
                    </div>
                    <p className="admin-notification-item-msg">{n.message}</p>
                  </div>
                  {!n.isRead && <span className="admin-notification-unread-dot" />}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="admin-notification-all-footer">
          <span className="admin-notification-page-info">
            Page {page + 1} sur {totalPages}
          </span>
          <div className="admin-notification-pagination">
            <button
              type="button"
              className="admin-btn sm secondary"
              disabled={page === 0 || loading}
              onClick={() => loadPage(page - 1)}
            >
              Précédent
            </button>
            <button
              type="button"
              className="admin-btn sm secondary"
              disabled={page >= totalPages - 1 || loading}
              onClick={() => loadPage(page + 1)}
            >
              Suivant
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

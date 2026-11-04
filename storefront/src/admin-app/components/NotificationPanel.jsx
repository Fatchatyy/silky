import React, { useEffect, useRef } from 'react';

function formatRelativeTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 60) return "À l'instant";
  if (diffSec < 3600) return `Il y a ${Math.floor(diffSec / 60)} min`;
  if (diffSec < 86400) return `Il y a ${Math.floor(diffSec / 3600)} h`;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
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

export default function NotificationPanel({
  notifications = [],
  unreadCount = 0,
  isOpen,
  onClose,
  onMarkRead,
  onMarkAllRead,
  onViewAll,
  onNavigate,
}) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        // Only close if not clicking on the bell button itself
        const isBell = e.target.closest('.admin-notification-bell-btn');
        if (!isBell) {
          onClose();
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleItemClick = (notification) => {
    if (!notification.isRead) {
      onMarkRead(notification.id);
    }
    onNavigate(notification);
    onClose();
  };

  return (
    <div className="admin-notification-panel" ref={panelRef}>
      <div className="admin-notification-panel-header">
        <div className="admin-notification-header-title">
          <strong>Notifications</strong>
          {unreadCount > 0 && (
            <span className="admin-notification-unread-pill">{unreadCount} non lue{unreadCount > 1 ? 's' : ''}</span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            className="admin-notification-mark-all-btn"
            onClick={onMarkAllRead}
          >
            Marquer tout comme lu
          </button>
        )}
      </div>

      <div className="admin-notification-list">
        {notifications.length === 0 ? (
          <div className="admin-notification-empty">
            <p>Aucune notification pour le moment.</p>
          </div>
        ) : (
          notifications.map((n) => (
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
          ))
        )}
      </div>

      <div className="admin-notification-panel-footer">
        <button
          type="button"
          className="admin-notification-view-all-btn"
          onClick={() => {
            onClose();
            onViewAll();
          }}
        >
          Voir tout
        </button>
      </div>
    </div>
  );
}

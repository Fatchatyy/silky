import React, { useEffect } from 'react';

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

function PopupItem({ popup, onDismiss, onClick }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(popup.id);
    }, 6000);
    return () => clearTimeout(timer);
  }, [popup.id, onDismiss]);

  return (
    <div
      className="admin-notification-popup"
      onClick={() => onClick(popup)}
      role="alert"
    >
      <div className="admin-popup-icon-wrap">
        <img
          src={getTypeIcon(popup.type)}
          alt=""
          className="admin-popup-type-icon"
        />
      </div>
      <div className="admin-popup-body">
        <div className="admin-popup-header">
          <strong className="admin-popup-title">{popup.title}</strong>
          <span className="admin-popup-time">{formatRelativeTime(popup.createdAt)}</span>
        </div>
        <p className="admin-popup-msg">{popup.message}</p>
      </div>
      <button
        type="button"
        className="admin-popup-close"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(popup.id);
        }}
        aria-label="Fermer"
      >
        ✕
      </button>
    </div>
  );
}

export default function NotificationPopup({ popups = [], onDismiss, onClick }) {
  if (!popups || popups.length === 0) return null;

  return (
    <div className="admin-notification-popup-stack">
      {popups.map((popup) => (
        <PopupItem
          key={popup.id}
          popup={popup}
          onDismiss={onDismiss}
          onClick={onClick}
        />
      ))}
    </div>
  );
}

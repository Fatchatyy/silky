import React from 'react';

export default function NotificationBell({ unreadCount = 0, isOpen, onClick }) {
  const badgeLabel = unreadCount > 99 ? '99+' : unreadCount;

  return (
    <button
      type="button"
      className={`admin-notification-bell-btn${isOpen ? ' is-active' : ''}`}
      onClick={onClick}
      aria-label="Centre de notifications"
      title="Notifications"
    >
      <img
        src="/pictures/bell.png"
        alt="Notifications"
        className="admin-notification-bell-icon"
      />
      {unreadCount > 0 && (
        <span className="admin-notification-badge" aria-label={`${unreadCount} notifications non lues`}>
          {badgeLabel}
        </span>
      )}
    </button>
  );
}

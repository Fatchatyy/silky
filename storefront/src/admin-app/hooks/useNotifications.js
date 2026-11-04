import { useState, useEffect, useRef, useCallback } from 'react';
import { adminApi as api } from '../../admin/adminApi';

const POLL_INTERVAL = 15000;
const POPUP_DURATION = 6000;
const MAX_POPUPS = 3;

export function useNotifications() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [newPopups, setNewPopups] = useState([]);

  const isInitialRef = useRef(true);
  const seenIdsRef = useRef(new Set());
  const timerRef = useRef(null);
  const isMountedRef = useRef(true);

  const fetchLatest = useCallback(async () => {
    try {
      const data = await api.getNotifications();
      if (!isMountedRef.current || !data) return;

      const latestList = data.notifications || [];
      const count = typeof data.unreadCount === 'number' ? data.unreadCount : 0;

      setNotifications(latestList);
      setUnreadCount(count);

      if (isInitialRef.current) {
        // Initial baseline: mark all existing IDs as seen without popping up
        latestList.forEach((n) => seenIdsRef.current.add(n.id));
        isInitialRef.current = false;
      } else {
        // Subsequent poll: detect genuinely new notifications
        const newlyArrived = [];
        for (const n of latestList) {
          if (!seenIdsRef.current.has(n.id)) {
            seenIdsRef.current.add(n.id);
            if (!n.isRead) {
              newlyArrived.push(n);
            }
          }
        }

        if (newlyArrived.length > 0) {
          setNewPopups((prev) => {
            const combined = [...newlyArrived, ...prev];
            return combined.slice(0, MAX_POPUPS);
          });
        }
      }
    } catch (err) {
      console.warn('[useNotifications] Polling error:', err.message);
    }
  }, []);

  // Poll setup
  useEffect(() => {
    isMountedRef.current = true;
    isInitialRef.current = true;
    seenIdsRef.current.clear();

    fetchLatest();

    timerRef.current = setInterval(() => {
      fetchLatest();
    }, POLL_INTERVAL);

    return () => {
      isMountedRef.current = false;
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [fetchLatest]);

  const dismissPopup = useCallback((id) => {
    setNewPopups((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const markRead = useCallback(async (id) => {
    if (!id) return;
    dismissPopup(id);

    // Optimistic UI update
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));

    try {
      await api.markNotificationRead(id);
    } catch (err) {
      console.warn('[useNotifications] Failed to mark notification read:', err.message);
      // Resync
      fetchLatest();
    }
  }, [dismissPopup, fetchLatest]);

  const markAllRead = useCallback(async () => {
    // Optimistic UI update
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
    setNewPopups([]);

    try {
      await api.markAllNotificationsRead();
    } catch (err) {
      console.warn('[useNotifications] Failed to mark all notifications read:', err.message);
      fetchLatest();
    }
  }, [fetchLatest]);

  return {
    notifications,
    unreadCount,
    newPopups,
    dismissPopup,
    markRead,
    markAllRead,
    refreshNotifications: fetchLatest,
  };
}

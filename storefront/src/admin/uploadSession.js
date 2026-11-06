// Photos go to the storage as soon as the admin picks them, before the product / hero is saved. An editor keeps an "upload
// session": every file it uploaded. When the editor ends (after a save, when it is closed without saving, or when the page
// is reloaded or left), the session asks the server to delete the files that nothing uses. The server never deletes a file
// that something still uses, so the ones that were saved stay.
import { adminApi } from './adminApi';

const sessions = new Set();

/** One session per editor (products, hero...), so one editor never discards the other's unsaved uploads. */
export function createUploadSession() {
  const urls = new Set();
  const session = {
    /** Remembers an uploaded file (only real storage paths; data URLs and /pictures files are ignored). Returns the url. */
    track(url) {
      if (typeof url === 'string' && url.startsWith('/uploads/')) urls.add(url);
      return url;
    },
    /** Asks the server to delete the session's files that nothing uses, then forgets them. Never throws. */
    async discard() {
      if (urls.size === 0) return;
      const list = [...urls];
      urls.clear();
      try {
        await adminApi.discardUploads(list);
      } catch (err) {
        console.warn('Could not clean up unused uploads:', err);
      }
    },
    /** Same, for a page that is going away (keepalive lets the request outlive the page). */
    discardOnPageExit() {
      if (urls.size === 0) return;
      const list = [...urls];
      urls.clear();
      try {
        adminApi.discardUploads(list, { keepalive: true }).catch(() => {});
      } catch {
        /* nothing more to do while the page is closing */
      }
    },
  };
  sessions.add(session);
  return session;
}

// Reloading or leaving the page in the middle of an edit throws the draft away: its uploads are never used.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    for (const session of sessions) session.discardOnPageExit();
  });
}

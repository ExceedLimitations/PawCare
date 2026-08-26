/* PawCare Service Worker — handles push/background notifications */

const CACHE_NAME = 'pawcare-sw-v2';

self.addEventListener('install', () => {
  // Take over immediately — don't wait for old SW to become idle.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Claim all open clients so navigator.serviceWorker.controller is set
  // right away (important: without this, the first page load after install
  // has no controller and postMessage() from the page drops on the floor).
  event.waitUntil(self.clients.claim());
});

/**
 * The main page posts a message like:
 *   { type: 'NOTIFY', title, body, tag, icon }
 *
 * The SW calls self.registration.showNotification() which renders a real
 * OS-level notification even when the tab is in the background, minimised,
 * or the screen is locked (Android Chrome / desktop Chrome & Firefox).
 *
 * We wrap showNotification() in event.waitUntil() so the browser keeps the
 * SW alive long enough for the async call to complete.
 */
self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'NOTIFY') return;

  const { title, body, tag, icon } = event.data;

  event.waitUntil(
    self.registration.showNotification(title || 'PawCare', {
      body:              body  || '',
      tag:               tag   || `pawcare-${Date.now()}`,
      icon:              icon  || '/favicon.svg',
      badge:             '/favicon.svg',
      // vibrate is ignored on desktop but works on Android
      vibrate:           [200, 100, 200],
      requireInteraction: false,
      // renotify is left out intentionally — unique tags mean each
      // notification occupies its own slot in the tray, so there is
      // nothing to "re-notify" about.
    })
  );
});

/**
 * Clicking the OS notification focuses the PawCare dashboard tab.
 * Prefers an existing open tab over opening a new window.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Look for a PawCare tab that is already open.
        const pawCareTab = clientList.find(
          (c) => new URL(c.url).origin === self.location.origin
        );
        if (pawCareTab) {
          return pawCareTab.focus();
        }
        // No open tab — open a new one.
        return self.clients.openWindow('/');
      })
  );
});

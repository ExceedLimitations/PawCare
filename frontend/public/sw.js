/* PawCare Service Worker — handles push/background notifications */

const CACHE_NAME = 'pawcare-sw-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * The main page posts a message like:
 *   { type: 'NOTIFY', title, body, tag, icon }
 *
 * The SW then calls self.registration.showNotification() which renders
 * a real OS-level notification even when the tab is in the background
 * or the screen is locked (on Android Chrome / desktop).
 */
self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'NOTIFY') return;

  const { title, body, tag, icon } = event.data;
  const options = {
    body: body || '',
    tag: tag || 'pawcare',           // deduplicates same-type notifications
    icon: icon || '/favicon.svg',
    badge: '/favicon.svg',
    renotify: true,                  // vibrate/sound even if tag already shown
    requireInteraction: false,
  };

  event.waitUntil(
    self.registration.showNotification(title || 'PawCare', options)
  );
});

/** Clicking the notification brings the dashboard tab to focus */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.length > 0) {
        return clientList[0].focus();
      }
      return self.clients.openWindow('/');
    })
  );
});

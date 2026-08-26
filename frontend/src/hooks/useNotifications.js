import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Manages browser notification permissions and a Service Worker registration
 * so that OS-level notifications fire even when the tab is in the background.
 *
 * Returns:
 *   - permission: 'default' | 'granted' | 'denied' | 'unsupported'
 *   - requestPermission(): asks the user to allow notifications
 *   - notify(title, body, options?): fires a real system notification
 */
export function useNotifications() {
  // Holds a Promise<ServiceWorkerRegistration> so every notify() can await it
  // regardless of whether the SW has finished activating yet.
  const swReadyRef = useRef(null);

  const [permission, setPermission] = useState(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission;
  });

  // Register the service worker once on mount and store the ready-promise.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // navigator.serviceWorker.ready resolves only after an active SW controls
    // the page — guaranteeing clients.claim() has run before we postMessage.
    swReadyRef.current = navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then(() => navigator.serviceWorker.ready)
      .catch((err) => {
        console.warn('[PawCare SW] Registration failed:', err);
        return null;
      });
  }, []);

  // Keep permission state in sync if the user changes it in browser settings.
  useEffect(() => {
    if (!('permissions' in navigator)) return;
    navigator.permissions
      .query({ name: 'notifications' })
      .then((status) => {
        status.onchange = () => setPermission(Notification.permission);
      })
      .catch(() => {});
  }, []);

  /** Prompt the user to grant notification permission */
  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) return 'unsupported';
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result;
    } catch (err) {
      console.warn('[PawCare] Notification permission request failed:', err);
      return 'denied';
    }
  }, []);

  /**
   * Fire a system notification.
   *
   * Preferred path: post to the SW controller via postMessage() — works even
   * when the tab is minimised, in background, or screen-locked.
   *
   * If the SW isn't controlling the page yet (first load after install), we
   * await the ready-promise and call reg.showNotification() directly on the
   * registration — identical to what the SW does internally.
   *
   * Final fallback: new Notification() constructor (tab must be focused).
   *
   * Tags are made unique per call so the browser never silently collapses
   * two different alerts into one (desktop Chrome/Firefox ignore renotify
   * when no push subscription is active, so deduplication kills alerts).
   *
   * @param {string} title
   * @param {string} body
   * @param {{ tag?: string, icon?: string }} [options]
   */
  const notify = useCallback(async (title, body, options = {}) => {
    if (!('Notification' in window)) return;
    // Re-read at call-time — stale closure value can lag if user just granted.
    if (Notification.permission !== 'granted') return;

    const icon = options.icon || '/favicon.svg';
    // Append timestamp so every alert gets its own unique slot in the
    // notification tray and none are silently replaced by a same-tag update.
    const tag = options.tag
      ? `${options.tag}-${Date.now()}`
      : `pawcare-${Date.now()}`;

    // ── Preferred: SW controller postMessage ──────────────────────────────────
    // navigator.serviceWorker.controller is the SW currently controlling the page.
    // This is separate from reg.active — controller is null until clients.claim().
    const controller = navigator.serviceWorker?.controller;
    if (controller) {
      controller.postMessage({ type: 'NOTIFY', title, body, tag, icon });
      return;
    }

    // ── Wait for SW activation (first load after install) ─────────────────────
    if (swReadyRef.current) {
      try {
        const reg = await swReadyRef.current;
        if (reg) {
          // After clients.claim() the controller slot may now be filled.
          const ctrl = navigator.serviceWorker.controller;
          if (ctrl) {
            ctrl.postMessage({ type: 'NOTIFY', title, body, tag, icon });
            return;
          }
          // Still no controller — call showNotification() on the registration
          // directly. This is the proper API; it works identically.
          await reg.showNotification(title, {
            body,
            tag,
            icon,
            badge: '/favicon.svg',
            requireInteraction: false,
          });
          return;
        }
      } catch (err) {
        console.warn('[PawCare] SW notify failed:', err);
      }
    }

    // ── Final fallback: Notification constructor ───────────────────────────────
    // Only fires while the tab is focused; better than nothing.
    try {
      new Notification(title, { body, tag, icon });
    } catch (e) {
      console.warn('[PawCare] Fallback notification failed:', e);
    }
  }, []);

  return { permission, requestPermission, notify };
}

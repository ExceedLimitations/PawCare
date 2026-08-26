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
  const swRef = useRef(null); // ServiceWorkerRegistration
  const [permission, setPermission] = useState(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission;
  });

  // Register the service worker once on mount
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        swRef.current = reg;
        // Keep the ref up to date if SW updates itself
        reg.addEventListener('updatefound', () => {
          swRef.current = reg;
        });
      })
      .catch((err) => {
        console.warn('[PawCare SW] Registration failed:', err);
      });
  }, []);

  // Keep permission state in sync if the user changes it in browser settings
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
   * Prefers the SW path (works in background); falls back to new Notification().
   *
   * @param {string} title
   * @param {string} body
   * @param {{ tag?: string, icon?: string }} [options]
   */
  const notify = useCallback((title, body, options = {}) => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const tag  = options.tag  || 'pawcare';
    const icon = options.icon || '/favicon.svg';

    // Preferred path: tell the SW to call showNotification()
    // This works even when the page is in the background / minimised.
    const sw = swRef.current?.active ?? navigator.serviceWorker?.controller;
    if (sw) {
      sw.postMessage({ type: 'NOTIFY', title, body, tag, icon });
      return;
    }

    // Fallback: direct Notification constructor (only works while page is focused)
    try {
      new Notification(title, { body, tag, icon });
    } catch (e) {
      console.warn('[PawCare] Fallback notification failed:', e);
    }
  }, []);

  return { permission, requestPermission, notify };
}

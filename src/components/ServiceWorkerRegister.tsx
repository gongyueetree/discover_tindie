'use client';

// src/components/ServiceWorkerRegister.tsx
// Registers /sw.js after the page loads. Renders nothing.
// Mount once in the root layout.

import { useEffect } from 'react';

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
          // When a new SW is found, ask it to activate immediately.
          reg.addEventListener('updatefound', () => {
            const sw = reg.installing;
            if (!sw) return;
            sw.addEventListener('statechange', () => {
              if (
                sw.state === 'installed' &&
                navigator.serviceWorker.controller
              ) {
                sw.postMessage('SKIP_WAITING');
              }
            });
          });
        })
        .catch((err) => {
          // Non-fatal: app still works without the SW.
          console.warn('SW registration failed:', err);
        });
    };

    // Register after load so it never competes with first paint.
    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
    }

    // Reload once when the controlling SW changes, so the user gets
    // the fresh version without a manual refresh.
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }, []);

  return null;
}


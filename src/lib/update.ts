/*
 * Tells the app when a new version has been downloaded. The service worker
 * takes over as soon as it has installed, but the page keeps running the
 * old code until it reloads – so we offer a "tap to update" banner.
 */
let ready = false;
const listeners = new Set<() => void>();

export function updateReady(): boolean {
  return ready;
}

export function onUpdateReady(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function markUpdateReady() {
  ready = true;
  listeners.forEach((fn) => fn());
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Only an *update* counts: on a first visit there is no previous controller.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) markUpdateReady();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        // Look for a new version whenever the app comes back to the front.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void reg.update().catch(() => {});
        });
      })
      .catch((e) => console.warn('SW registration failed', e));
  });
}

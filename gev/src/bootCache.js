// @ts-nocheck
/**
 * One globe, one boot. React Strict Mode, route remounts, and hydration
 * must not tear down the Cesium canvas or rewind the loading sequence
 * after the engine module is already in memory.
 *
 * The persistent host lives on document.body — never inside a React
 * fiber — so a remount cannot wipe the WebGL canvas or the loading cover.
 */

import {
  completeBootPhase,
  mountBootDebugBar,
  reportBootError,
  reportBootPhase,
} from './bootDebugBar.js';

const emptyStore = () => ({
  host: null,
  enginePromise: null,
  bootPromise: null,
  initPromise: null,
  engineReady: false,
});

function store() {
  if (typeof window === 'undefined') {
    if (!globalThis.__gevBootCache) globalThis.__gevBootCache = emptyStore();
    return globalThis.__gevBootCache;
  }
  if (!window.__gevBootCache) window.__gevBootCache = emptyStore();
  return window.__gevBootCache;
}

export function getBootCache() {
  return store();
}

export function getPersistentGlobeHost() {
  return store().host;
}

export function attachPersistentGlobeHost(slot, shellHtml) {
  if (typeof document === 'undefined') return null;
  const cache = store();

  if (!cache.host) {
    cache.host = document.createElement('div');
    cache.host.id = 'gev-root';
    cache.host.className = 'gev-root';
    cache.host.dataset.gevPersistent = 'true';
    if (slot?.querySelector?.('#cesiumContainer')) {
      while (slot.firstChild) cache.host.appendChild(slot.firstChild);
    } else {
      cache.host.innerHTML = String(shellHtml || '');
    }
  }

  cache.host.classList.remove('gev-host-parked');
  cache.host.removeAttribute('aria-hidden');
  // Prefer the React slot so the globe fills the app chrome. Park to <body>
  // only when the slot is gone — never create a circular module graph with main.js.
  if (slot && cache.host.parentElement !== slot) slot.replaceChildren(cache.host);
  else if (!cache.host.isConnected && typeof document !== 'undefined') {
    document.body.appendChild(cache.host);
  }
  return cache.host;
}

export function parkPersistentGlobeHost() {
  const cache = store();
  if (!cache.host || typeof document === 'undefined') return;
  cache.host.classList.add('gev-host-parked');
  cache.host.setAttribute('aria-hidden', 'true');
  if (cache.host.parentElement !== document.body) {
    document.body.appendChild(cache.host);
  }
}

export function isGlobeLive(root = typeof window === 'undefined' ? undefined : window) {
  const canvas = root?.__godsEyeView?.viewer?.scene?.canvas;
  return Boolean(canvas?.isConnected);
}

export function loadGlobeEngine(importer) {
  const cache = store();
  if (!cache.enginePromise) cache.enginePromise = Promise.resolve().then(importer);
  return cache.enginePromise;
}

export function startGlobeBoot({ loadMain } = {}) {
  if (typeof window !== 'undefined') window.CESIUM_BASE_URL = '/cesium/';
  mountBootDebugBar();
  const cache = store();

  if (isGlobeLive()) return cache.bootPromise || cache.initPromise || Promise.resolve();
  if (cache.bootPromise) return cache.bootPromise;
  if (cache.initPromise) return cache.initPromise;

  if (!cache.enginePromise) {
    reportBootPhase('engine', 'Loading globe engine', 'Downloading Cesium and app modules');
  } else if (!cache.engineReady) {
    reportBootPhase('engine', 'Loading globe engine', 'Waiting on cached engine download');
  }

  cache.bootPromise = loadGlobeEngine(loadMain)
    .then((mod) => {
      if (!store().engineReady) {
        completeBootPhase('engine', {
          status: 'ok',
          detail: 'Globe engine cached in memory',
        });
        store().engineReady = true;
      }
      if (typeof mod?.init !== 'function') {
        throw new Error('Globe engine loaded without an init() export');
      }
      return mod.init();
    })
    .catch((error) => {
      const next = store();
      next.bootPromise = null;
      next.initPromise = null;
      const message = error instanceof Error ? error.message : String(error);
      reportBootError(message, {
        source: 'boot',
        detail: 'The globe engine failed before the viewer was created.',
      });
      throw error;
    });

  return cache.bootPromise;
}

export function resetBootCache() {
  const cache = store();
  cache.host = null;
  cache.enginePromise = null;
  cache.bootPromise = null;
  cache.initPromise = null;
  cache.engineReady = false;
}

if (import.meta.hot) import.meta.hot.accept();

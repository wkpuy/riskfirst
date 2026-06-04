// sw.js — Production Service Worker for RiskFirst PWA
// Strategy: Cache-first for app shell, Network-first for API calls

const CACHE_VERSION = 'riskfirst-v1';

// App shell — static assets to pre-cache on install
const APP_SHELL = [
  './',
  './index.html',
  './css/app.css',
  './manifest.json',
  './js/app.js',
  './js/api.js',
  './js/cache.js',
  './js/config.js',
  './js/db.js',
  './js/indicators.js',
  './js/journal.js',
  './js/nav.js',
  './js/portfolio.js',
  './js/regime.js',
  './js/risk-calc.js',
  './js/rules.js',
  './js/state.js',
  './js/trader-scan.js',
  './js/ui.js',
  './js/vi-scan.js',
  './js/watchlist.js',
];

// External API origins — never cache these (always network)
const API_ORIGINS = ['finnhub.io', 'api.twelvedata.com'];

// ─── Install: pre-cache app shell ────────────────────────────────────────────

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL))
  );
});

// ─── Activate: delete old cache versions ─────────────────────────────────────

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch: route requests ────────────────────────────────────────────────────

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. External API calls → always network, never cache
  if (API_ORIGINS.some(origin => url.hostname.includes(origin))) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 2. Non-GET requests → passthrough
  if (event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  // 3. App shell (same origin) → Cache-first, update cache in background
  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => null);

      // Return cached immediately; if not in cache wait for network
      return cached || networkFetch;
    })
  );
});

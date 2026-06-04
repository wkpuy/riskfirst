// cache.js — localStorage cache helpers with QuotaExceeded eviction

import {
  CACHE_TTL,
  CACHE_PREFIX_QUOTE, CACHE_PREFIX_PROFILE, CACHE_PREFIX_METRIC,
  CACHE_PREFIX_EARNINGS, CACHE_PREFIX_CANDLES, CACHE_PREFIX_SYNC_P,
} from './config.js';

export { CACHE_TTL };

const EVICTABLE_PREFIXES = [
  CACHE_PREFIX_QUOTE, CACHE_PREFIX_PROFILE, CACHE_PREFIX_METRIC,
  CACHE_PREFIX_EARNINGS, CACHE_PREFIX_CANDLES, CACHE_PREFIX_SYNC_P,
];

export function getCached(key, ttl) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > ttl) { localStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}

export function setCache(key, data) {
  const value = JSON.stringify({ ts: Date.now(), data });
  try {
    localStorage.setItem(key, value);
  } catch {
    // QuotaExceededError — evict oldest entries first
    const entries = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && EVICTABLE_PREFIXES.some(p => k.startsWith(p))) {
        try { entries.push({ k, ts: JSON.parse(localStorage.getItem(k)).ts }); } catch {}
      }
    }
    entries.sort((a, b) => a.ts - b.ts);
    for (const entry of entries) {
      localStorage.removeItem(entry.k);
      try { localStorage.setItem(key, value); return; } catch {}
    }
  }
}

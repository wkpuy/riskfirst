// api.js — Finnhub + Twelve Data fetch helpers
// All functions return parsed data or null on failure.
// Callers are responsible for showing error UI.

import { getCached, setCache, CACHE_TTL } from './cache.js';
import {
  CACHE_PREFIX_QUOTE, CACHE_PREFIX_PROFILE, CACHE_PREFIX_METRIC,
  CACHE_PREFIX_EARNINGS, CACHE_PREFIX_CANDLES, MIN_CANDLE_BARS,
} from './config.js';

const FH  = 'https://finnhub.io/api/v1';
const TD  = 'https://api.twelvedata.com';

// ─── Finnhub ──────────────────────────────────────────────────────────────────

export async function fetchQuote(symbol, apiKey, ttl = CACHE_TTL.quote) {
  const key = CACHE_PREFIX_QUOTE + symbol;
  const hit = getCached(key, ttl);
  if (hit) return hit;
  const data = await fetch(`${FH}/quote?symbol=${symbol}&token=${apiKey}`).then(r => r.json());
  if (!data.error) setCache(key, data);
  return data;
}

export async function fetchProfile(symbol, apiKey) {
  const key = CACHE_PREFIX_PROFILE + symbol;
  const hit = getCached(key, CACHE_TTL.profile);
  if (hit) return hit;
  const data = await fetch(`${FH}/stock/profile2?symbol=${symbol}&token=${apiKey}`).then(r => r.json());
  setCache(key, data);
  return data;
}

export async function fetchMetric(symbol, apiKey) {
  const key = CACHE_PREFIX_METRIC + symbol;
  const hit = getCached(key, CACHE_TTL.profile);
  if (hit) return hit;
  const data = await fetch(`${FH}/stock/metric?symbol=${symbol}&metric=all&token=${apiKey}`).then(r => r.json());
  setCache(key, data);
  return data;
}

export async function fetchEarnings(symbol, apiKey) {
  const key = CACHE_PREFIX_EARNINGS + symbol;
  const hit = getCached(key, CACHE_TTL.profile);
  if (hit) return hit;
  const data = await fetch(`${FH}/stock/earnings?symbol=${symbol}&limit=4&token=${apiKey}`).then(r => r.json());
  if (Array.isArray(data) && data.length) setCache(key, data);
  return data;
}

export async function fetchEarningsCalendar(symbol, apiKey) {
  const key = 'fhEC_' + symbol;
  const hit = getCached(key, 6 * 60 * 60 * 1000); // 6 hours
  if (hit) return hit;
  const now = new Date();
  const to  = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // +14 days
  
  const fromStr = now.toISOString().split('T')[0];
  const toStr   = to.toISOString().split('T')[0];
  
  const data = await fetch(`${FH}/calendar/earnings?from=${fromStr}&to=${toStr}&symbol=${symbol}&token=${apiKey}`).then(r => r.json());
  if (data.earningsCalendar) setCache(key, data.earningsCalendar);
  return data.earningsCalendar || [];
}

export async function fetchRecentNews(symbol, apiKey) {
  const key = 'fhNews_' + symbol;
  const hit = getCached(key, 60 * 60 * 1000); // 1 hour cache
  if (hit) return hit;
  const now = new Date();
  const from = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000); // -3 days
  
  const fromStr = from.toISOString().split('T')[0];
  const toStr   = now.toISOString().split('T')[0];
  
  const data = await fetch(`${FH}/company-news?symbol=${symbol}&from=${fromStr}&to=${toStr}&token=${apiKey}`).then(r => r.json());
  if (Array.isArray(data)) {
    setCache(key, data);
    return data;
  }
  return [];
}

/**
 * Finnhub daily candles for the last 370 days.
 * Returns parsed {c,h,l,v} or null if too few bars.
 */
export async function fetchFinnhubCandles(symbol, apiKey) {
  const now  = Math.floor(Date.now() / 1000);
  const from = now - 370 * 24 * 60 * 60;
  const data = await fetch(
    `${FH}/stock/candle?symbol=${symbol}&resolution=D&from=${from}&to=${now}&token=${apiKey}`
  ).then(r => r.json());

  if (data.s !== 'ok' || !data.c || data.c.length < MIN_CANDLE_BARS) return null;
  return { c: data.c, h: data.h, l: data.l, v: data.v };
}

// ─── Twelve Data ─────────────────────────────────────────────────────────────

function _parseTDResponse(tdData) {
  if (tdData.status !== 'ok' || !tdData.values?.length) return null;
  const rows = [...tdData.values].reverse();
  return {
    c: rows.map(r => parseFloat(r.close)),
    h: rows.map(r => parseFloat(r.high)),
    l: rows.map(r => parseFloat(r.low)),
    v: rows.map(r => parseInt(r.volume)),
  };
}

/**
 * Twelve Data daily candles, stored as parsed {c,h,l,v} to save ~50% storage.
 * Returns parsed candles or null.
 */
export async function fetchTDCandles(symbol, apiKey, outputsize = 300) {
  const key = CACHE_PREFIX_CANDLES + symbol;

  // Cache hit — already stored as parsed format
  const hit = getCached(key, CACHE_TTL.candles);
  if (hit?.c) return hit;

  const data = await fetch(
    `${TD}/time_series?symbol=${symbol}&interval=1day&outputsize=${outputsize}&apikey=${apiKey}`
  ).then(r => r.json());

  const parsed = _parseTDResponse(data);
  if (parsed && parsed.c.length >= MIN_CANDLE_BARS) {
    setCache(key, parsed);
    return parsed;
  }
  return null;
}

/**
 * Twelve Data closes-only (for SPY/QQQ regime check).
 * Returns number[] (oldest → newest) or throws.
 */
export async function fetchTDCloses(symbol, apiKey, outputsize = 210) {
  const data = await fetch(
    `${TD}/time_series?symbol=${symbol}&interval=1day&outputsize=${outputsize}&apikey=${apiKey}`
  ).then(r => r.json());

  if (data.status !== 'ok' || !data.values?.length) {
    throw new Error(data.message || `No data for ${symbol}`);
  }
  return [...data.values].reverse().map(r => parseFloat(r.close));
}

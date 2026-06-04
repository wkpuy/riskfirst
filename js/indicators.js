// indicators.js — pure technical-analysis math (no side effects, no imports)
// Same input → same output. Safe to unit-test in isolation.

/** Simple moving average of the last `period` values in `arr`. */
export function calcMA(arr, period) {
  if (arr.length < period) return null;
  return arr.slice(-period).reduce((a, b) => a + b, 0) / period;
}

/**
 * ATR-14 using Wilder's Smoothing (as used by Minervini).
 * Falls back to daily range when fewer than period+1 bars are available.
 */
export function calcATR(candles, period = 14) {
  const { h, l, c } = candles;
  if (h.length < period + 1) return h[h.length - 1] - l[l.length - 1];

  const trs = [];
  for (let i = 1; i < h.length; i++) {
    trs.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }

  // Seed with SMA of first `period` true ranges
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Wilder's EMA: ATR = (ATR_prev × (period−1) + TR) / period
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

/**
 * Approximate RS Rating (1–99): excess 1-year return vs SPY.
 * Uses the same 252-bar window for both stock and SPY.
 *
 * @param {number[]} closes     — stock close prices (oldest → newest)
 * @param {number[]|null} spyCloses — SPY close prices (oldest → newest)
 */
export function calcRSRating(closes, spyCloses = null) {
  const WINDOW     = 252;
  const stockStart = closes.length >= WINDOW ? closes[closes.length - WINDOW] : closes[0];
  const stockRet   = ((closes.at(-1) - stockStart) / stockStart) * 100;

  if (spyCloses && spyCloses.length >= 2) {
    const spyStart = spyCloses.length >= WINDOW ? spyCloses[spyCloses.length - WINDOW] : spyCloses[0];
    const spyRet   = ((spyCloses.at(-1) - spyStart) / spyStart) * 100;
    return Math.min(99, Math.max(1, Math.round(50 + (stockRet - spyRet) * 0.6)));
  }

  return Math.min(99, Math.max(1, Math.round(50 + stockRet * 0.4)));
}

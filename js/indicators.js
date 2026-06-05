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
 * IBD-style 4-quarter weighted return.
 * Weights: Q1 (most recent 63 bars) ×40%, Q2 ×20%, Q3 ×20%, Q4 ×20%.
 * Returns the raw weighted return % (not clamped to 1–99).
 *
 * @param {number[]} closes — close prices (oldest → newest)
 */
export function calcWeightedReturn(closes) {
  // qRet: % return from `old` bars ago to `young` bars ago (young < old)
  const qRet = (arr, young, old) => {
    if (arr.length <= old) return 0;
    const start = arr[arr.length - 1 - old];
    const end   = young === 0 ? arr.at(-1) : arr[arr.length - 1 - young];
    return start > 0 ? ((end - start) / start) * 100 : 0;
  };
  const Q = 63; // ≈ 1 quarter of trading days
  return (
    qRet(closes, 0,   Q)     * 0.4 +
    qRet(closes, Q,   Q * 2) * 0.2 +
    qRet(closes, Q*2, Q * 3) * 0.2 +
    qRet(closes, Q*3, Q * 4) * 0.2
  );
}

/**
 * RS Rating (1–99) vs SPY using IBD-style weighted 4-quarter formula.
 * Better than simple 1-year return — recent quarters count more.
 *
 * For true cross-sectional rank, use calcWeightedReturn() on all stocks
 * in a universe and rank them (done in scanAllWatchlist).
 *
 * @param {number[]} closes     — stock close prices (oldest → newest)
 * @param {number[]|null} spyCloses — SPY close prices (oldest → newest)
 */
export function calcRSRating(closes, spyCloses = null) {
  const stockW = calcWeightedReturn(closes);

  if (spyCloses && spyCloses.length >= 2) {
    const spyW = calcWeightedReturn(spyCloses);
    return Math.min(99, Math.max(1, Math.round(50 + (stockW - spyW) * 0.6)));
  }

  return Math.min(99, Math.max(1, Math.round(50 + stockW * 0.4)));
}

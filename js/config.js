// config.js — app-wide constants (no imports)

export const CACHE_TTL = {
  quote:   10 * 60 * 1000,       // 10 min
  profile: 24 * 60 * 60 * 1000,  // 24 h
  candles:  6 * 60 * 60 * 1000,  //  6 h
};

export const ATR_MULTIPLIER        = 2.5;
export const ATR_MULTIPLIER_WIDE   = 3.0;  // earnings window
export const MIN_CANDLE_BARS       = 50;
export const POST_EARNINGS_DAYS    = 45;   // Minervini: VCP consolidates 2-8 weeks
export const CACHE_PREFIX_QUOTE    = 'fhQ_';
export const CACHE_PREFIX_PROFILE  = 'fhP_';
export const CACHE_PREFIX_METRIC   = 'fhM_';
export const CACHE_PREFIX_EARNINGS = 'fhE_';
export const CACHE_PREFIX_CANDLES  = 'tdC_';
export const CACHE_PREFIX_SYNC_P   = 'syncP_';

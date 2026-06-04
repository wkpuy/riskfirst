// regime.js — Market Regime check (SPY + QQQ vs MA200)

import { fetchTDCloses } from './api.js';
import { calcMA } from './indicators.js';

const REGIME_CACHE_KEY = 'regimeCache';
const REGIME_TTL_MS    = 6 * 60 * 60 * 1000; // 6 hours

export async function updateMarketRegime() {
  const tdKey = localStorage.getItem('twelvedataApiKey');

  if (!tdKey) {
    _renderBannerNoKey();
    return;
  }

  const cached = JSON.parse(localStorage.getItem(REGIME_CACHE_KEY) || 'null');
  if (cached && Date.now() - cached.ts < REGIME_TTL_MS) {
    renderRegimeBanner(cached);
    return;
  }

  try {
    const [spyCloses, qqqCloses] = await Promise.all([
      fetchTDCloses('SPY', tdKey),
      fetchTDCloses('QQQ', tdKey),
    ]);

    const spyMA200 = calcMA(spyCloses, Math.min(200, spyCloses.length));
    const qqqMA200 = calcMA(qqqCloses, Math.min(200, qqqCloses.length));
    const spyAbove = spyCloses.at(-1) > spyMA200;
    const qqqAbove = qqqCloses.at(-1) > qqqMA200;

    // BUG-M4: store only last 252 bars (enough for RS Rating) to limit localStorage size
    const regime = { ts: Date.now(), bullish: spyAbove && qqqAbove, spyAbove, qqqAbove, spyCloses: spyCloses.slice(-252) };
    localStorage.setItem(REGIME_CACHE_KEY, JSON.stringify(regime));
    renderRegimeBanner(regime);
  } catch (e) {
    console.warn('Regime check failed:', e);
  }
}

export function renderRegimeBanner(regime) {
  const banner = document.getElementById('market-regime-banner');
  if (!banner) return;

  if (regime.bullish) {
    banner.className = 'flex items-center justify-between mb-4 bg-green-500/10 border-l-4 border-green-500 rounded-r-lg p-3';
    banner.innerHTML = `
      <div class="flex items-center gap-2">
        <div class="pulse-dot"></div>
        <span class="text-sm font-bold text-green-500">Market Regime: BULL</span>
      </div>
      <span class="text-xs text-gray-400">SPY & QQQ > MA200</span>`;
  } else {
    const label = !regime.spyAbove && !regime.qqqAbove
      ? 'SPY & QQQ < MA200'
      : (!regime.spyAbove ? 'SPY < MA200' : 'QQQ < MA200');
    banner.className = 'flex items-center justify-between mb-4 bg-red-500/10 border-l-4 border-red-500 rounded-r-lg p-3';
    banner.innerHTML = `
      <div class="flex items-center gap-2">
        <div class="w-2 h-2 rounded-full bg-red-500"></div>
        <span class="text-sm font-bold text-red-400">Market Regime: BEAR ⚠️ งดเปิด Long ใหม่</span>
      </div>
      <span class="text-xs text-gray-400">${label}</span>`;
  }
}

function _renderBannerNoKey() {
  const banner = document.getElementById('market-regime-banner');
  if (!banner) return;
  banner.className = 'flex items-center justify-between mb-4 bg-gray-500/10 border-l-4 border-gray-500 rounded-r-lg p-3';
  banner.innerHTML = `
    <div class="flex items-center gap-2">
      <span class="text-sm font-bold text-gray-400">Market Regime: ยังไม่ได้ตั้งค่า</span>
    </div>
    <button onclick="openGlobalLogicModal()" class="text-xs text-teal-400 underline">ตั้งค่า API Key →</button>`;
}

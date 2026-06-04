// portfolio.js — Capital management, price sync, and VI portfolio reallocation

import { getPortfolio, updatePortfolio, getJournalEntries } from './db.js';
import { fetchQuote } from './api.js';
import { getCached, setCache } from './cache.js';
import { CACHE_PREFIX_SYNC_P } from './config.js';
import { state } from './state.js';
import { showToast } from './ui.js';
import { openModal, closeModal } from './ui.js';

// ─── Capital Modal ────────────────────────────────────────────────────────────

export function openCapitalModal(type = 'trader') {
  state.capitalEditingType = type;
  const port = type === 'vi' ? state.viPortfolio : state.traderPortfolio;
  const input = document.getElementById('input-edit-capital');
  if (input) input.value = port?.capital ?? 550;
  openModal('capital-modal', 'capital-sheet', 'scale');
}

export function closeCapitalModal() {
  closeModal('capital-modal', 'capital-sheet', 'scale');
}

export async function saveCapital() {
  const newCap = parseFloat(document.getElementById('input-edit-capital')?.value);
  if (!newCap || newCap <= 0) return;

  const type    = state.capitalEditingType;
  const port    = type === 'vi' ? state.viPortfolio : state.traderPortfolio;
  const initial = port?.initialCapital ?? newCap;

  await updatePortfolio({ capital: newCap, initialCapital: initial }, type);
  closeCapitalModal();
  document.dispatchEvent(new Event('riskfirst:refresh'));
}

// ─── Sync Prices (Finnhub) ────────────────────────────────────────────────────

export async function syncPrices() {
  const apiKey = localStorage.getItem('finnhubApiKey');
  if (!apiKey) {
    showToast('กรุณาใส่ Finnhub API Key ใน ℹ️ ก่อน', 'warning');
    return;
  }

  const [traderJ, viJ] = await Promise.all([
    getJournalEntries('trader'),
    getJournalEntries('vi'),
  ]);
  const openSymbols = new Set(
    [...traderJ, ...viJ]
      .filter(t => t.status === 'open' && t.strategy !== 'dividend')
      .map(t => t.symbol)
  );

  if (!openSymbols.size) { showToast('No open positions to sync.', 'info'); return; }

  const syncBtn = document.querySelector('button[onclick="syncPrices()"]');
  if (syncBtn) { syncBtn.innerHTML = '<span>⏳</span> Syncing...'; syncBtn.disabled = true; }

  const results = await Promise.all(
    [...openSymbols].map(async sym => {
      const cached = getCached(`${CACHE_PREFIX_SYNC_P}${sym}`, 15 * 60 * 1000);
      if (cached?.c) return { symbol: sym, price: cached.c };
      try {
        const data = await fetchQuote(sym, apiKey, 15 * 60 * 1000);
        if (data?.c) { setCache(`${CACHE_PREFIX_SYNC_P}${sym}`, data); return { symbol: sym, price: data.c }; }
      } catch {}
      return null;
    })
  );

  const priceCache = JSON.parse(localStorage.getItem('priceCache') || '{}');
  let count = 0;
  results.forEach(r => { if (r) { priceCache[r.symbol] = r.price; count++; } });
  localStorage.setItem('priceCache', JSON.stringify(priceCache));

  showToast(`อัปเดตราคาล่าสุด ${count} หุ้นแล้ว ✅`, 'success');

  if (syncBtn) { syncBtn.innerHTML = '<span>🔄</span> Sync Prices'; syncBtn.disabled = false; }
  document.dispatchEvent(new Event('riskfirst:refresh'));
  renderReallocation();
}

// ─── VI Portfolio Reallocation ────────────────────────────────────────────────

export async function renderReallocation() {
  const listEl = document.getElementById('vi-realloc-list');
  if (!listEl) return;

  if (!state.viPortfolio) state.viPortfolio = await getPortfolio('vi');
  const entries       = await getJournalEntries('vi');
  const openPositions = entries.filter(t => t.status === 'open' && t.strategy !== 'dividend');

  if (!openPositions.length) {
    listEl.innerHTML = `
      <div class="text-center py-8 px-4 bg-gray-50 rounded-2xl border border-gray-200">
        <div class="text-3xl mb-2">📭</div>
        <p class="text-sm text-gray-500">ยังไม่มีหุ้นในพอร์ต<br>บันทึกจาก Risk/Port ก่อน</p>
      </div>`;
    return;
  }

  const priceCache = JSON.parse(localStorage.getItem('priceCache') || '{}');

  // Group by symbol
  const holdings = {};
  openPositions.forEach(t => {
    if (!holdings[t.symbol]) {
      holdings[t.symbol] = { trades: [], totalShares: 0, totalCost: 0, fairValue: null, viMeta: null };
    }
    const h = holdings[t.symbol];
    h.trades.push(t);
    h.totalShares += t.shares || 0;
    h.totalCost   += (t.shares || 0) * (t.buyPrice || 0);
    if (t.targetPrice) h.fairValue = t.targetPrice;
    if (t.viMeta)      h.viMeta    = t.viMeta;
  });

  listEl.innerHTML = Object.keys(holdings).map(symbol => {
    const h         = holdings[symbol];
    const avgBuy    = h.totalShares > 0 ? h.totalCost / h.totalShares : (h.trades[0]?.buyPrice || 0);
    const curPrice  = priceCache[symbol] || null;
    const fairValue = h.fairValue;
    const vm        = h.viMeta;

    // ── Verdict ──
    let verdict, verdictBg, verdictColor, verdictIcon, reasoning;
    if (curPrice && fairValue) {
      const mos = ((fairValue - curPrice) / fairValue) * 100;
      if      (curPrice > fairValue * 1.05) { verdict = 'TRIM / SELL'; verdictBg = '#fee2e2'; verdictColor = '#b91c1c'; verdictIcon = '📤'; reasoning = `ราคาปัจจุบัน $${curPrice.toFixed(2)} สูงกว่า Fair Value ${Math.abs(mos).toFixed(1)}% แล้ว — พิจารณาขายบางส่วน`; }
      else if (mos >= 20)                   { verdict = 'ADD MORE';     verdictBg = '#dcfce7'; verdictColor = '#15803d'; verdictIcon = '📥'; reasoning = `MOS ยังเหลือ ${mos.toFixed(1)}% — ราคายังน่าซื้อเพิ่ม`; }
      else if (mos >= 5)                    { verdict = 'HOLD';          verdictBg = '#dbeafe'; verdictColor = '#1d4ed8'; verdictIcon = '✋'; reasoning = `ราคาใกล้ Fair Value (MOS ${mos.toFixed(1)}%) — ถือต่อ รอราคาเต็ม`; }
      else                                  { verdict = 'HOLD / REVIEW'; verdictBg = '#fef9c3'; verdictColor = '#854d0e'; verdictIcon = '👀'; reasoning = `ราคาจ่อ Fair Value แล้ว — ทบทวน thesis ว่ายัง valid ไหม`; }
    } else if (!curPrice) {
      verdict = 'กด Sync Prices'; verdictBg = '#f3f4f6'; verdictColor = '#6b7280'; verdictIcon = '🔄'; reasoning = 'ยังไม่มีราคาปัจจุบัน กด Sync Prices เพื่ออัปเดต';
    } else {
      verdict = 'ใส่ Fair Value'; verdictBg = '#f0f7ff'; verdictColor = '#1d4ed8'; verdictIcon = '📐'; reasoning = 'ยังไม่มี Fair Value — scan หุ้นแล้วใส่ค่าใน MOS Calculator';
    }

    const chg     = (curPrice && avgBuy) ? ((curPrice - avgBuy) / avgBuy) * 100 : null;
    const chgHtml = chg != null
      ? `<span style="color:${chg >= 0 ? '#16a34a' : '#dc2626'}" class="font-bold">${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%</span>`
      : '<span class="text-gray-400">—</span>';

    return `
      <div class="bg-white border border-gray-200 rounded-2xl p-4 mb-3 shadow-sm">
        <div class="flex justify-between items-start mb-3">
          <div>
            <div class="font-black text-xl text-gray-800">${symbol}</div>
            <div class="text-[10px] text-gray-400 mt-0.5">
              Avg Buy $${avgBuy.toFixed(2)}
              ${h.totalShares > 0 ? ` · ${h.totalShares} shares` : ''}
              ${fairValue ? ` · Fair $${parseFloat(fairValue).toFixed(2)}` : ''}
            </div>
          </div>
          <div class="text-right">
            ${curPrice ? `<div class="font-bold text-gray-800">$${curPrice.toFixed(2)}</div>` : '<div class="text-xs text-gray-400">ราคา—</div>'}
            <div class="text-xs">${chgHtml} จาก avg</div>
          </div>
        </div>

        <div class="rounded-xl px-3 py-2.5 mb-3" style="background:${verdictBg}">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-lg">${verdictIcon}</span>
            <span class="font-black text-sm" style="color:${verdictColor}">${verdict}</span>
          </div>
          <p class="text-xs" style="color:${verdictColor};opacity:0.85">${reasoning}</p>
        </div>

        ${vm ? `
        <div class="grid grid-cols-3 gap-x-3 gap-y-0.5 text-[10px] text-gray-400 mb-3 px-1">
          <div>VI Score <span class="font-bold text-blue-600">${vm.viScore}/10</span></div>
          <div>Mode <span class="font-bold ${vm.isGrowth ? 'text-yellow-600' : 'text-purple-600'}">${vm.stockMode}</span></div>
          <div>PEG <span class="font-bold text-gray-600">${vm.pegRatio != null ? vm.pegRatio.toFixed(2) : '—'}</span></div>
          <div>ROE <span class="font-bold text-gray-600">${vm.roe != null ? vm.roe.toFixed(1) + '%' : '—'}</span></div>
          <div>EPS Gr <span class="font-bold text-gray-600">${vm.epsGrow != null ? (vm.epsGrow > 0 ? '+' : '') + vm.epsGrow.toFixed(1) + '%' : '—'}</span></div>
        </div>` : ''}

        <div class="flex gap-2">
          <button onclick="document.getElementById('vi-scan-input').value='${symbol}'; switchTab('scan'); scanVI()"
                  class="flex-1 py-2 rounded-xl text-xs font-bold border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors">
            🔄 Scan ใหม่
          </button>
          <button onclick="openCloseVITrade([${h.trades.map(t => t.id).join(',')}], '${symbol}', ${avgBuy.toFixed(2)}, ${h.totalShares}, ${fairValue || 'null'})"
                  class="flex-1 py-2 rounded-xl text-xs font-bold border border-red-200 text-red-500 hover:bg-red-50 transition-colors">
            ขายทิ้ง →
          </button>
        </div>
      </div>`;
  }).join('');
}

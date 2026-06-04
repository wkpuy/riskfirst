// journal.js — Dashboard stats, trade CRUD, and journal rendering

import {
  getPortfolio, updatePortfolio, addJournalEntry, getJournalEntries,
  updateJournalEntry, deleteJournalEntry,
} from './db.js';
import { state } from './state.js';
import { showToast, showConfirm, openModal, closeModal, escapeHtml } from './ui.js';
import { updateRiskCalc, updateVIRiskCalc } from './risk-calc.js';
import { renderReallocation } from './portfolio.js';
import { fetchQuote } from './api.js';
import { calculatePyramidRisk, checkMonthlyCooldown } from './rules.js';

// ─── Dashboard ────────────────────────────────────────────────────────────────

export async function loadDashboard() {
  try {
    [state.traderPortfolio, state.viPortfolio] = await Promise.all([
      getPortfolio('trader'),
      getPortfolio('vi'),
    ]);
  } catch (e) { console.warn('Port load err:', e); }

  try {
    const accountEl = document.getElementById('calc-account-size');
    if (accountEl && state.traderPortfolio) { accountEl.value = state.traderPortfolio.capital; updateRiskCalc(); }

    if (state.traderPortfolio) {
      _setText('global-capital-txt-trader', '$' + state.traderPortfolio.capital.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
      _setText('dash-capital',              state.traderPortfolio.capital.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    }
    if (state.viPortfolio) {
      _setText('global-capital-txt-vi',     '$' + state.viPortfolio.capital.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
    }
    updateVIRiskCalc();
    renderReallocation();
  } catch (e) { console.warn('UI update err:', e); }

  let entries = [], viEntries = [];
  try {
    [entries, viEntries] = await Promise.all([
      getJournalEntries('trader'),
      getJournalEntries('vi'),
    ]);
  } catch (e) { console.error('DB fetch err:', e); }

  try {
    _renderStats(entries);
    _renderJournal(entries,   'journal-list',    false);
    _renderJournal(viEntries, 'vi-journal-list', true);
  } catch (e) { console.error('Render err:', e); }

  try {
    if (state.traderPortfolio) {
      state.cooldownStatus = checkMonthlyCooldown(entries, state.traderPortfolio.capital);
      updateRiskCalc();
    }
  } catch (e) { console.warn('Cooldown err:', e); }
}

// ─── Sync Journal Prices ──────────────────────────────────────────────────────

export async function syncJournalPrices() {
  if (state.journalPricesSyncing) return;
  const apiKey = localStorage.getItem('finnhubApiKey');
  if (!apiKey) { showToast('กรุณาตั้งค่า Finnhub API Key ก่อน', 'warning'); return; }

  const [traderEntries, viEntries] = await Promise.all([
    getJournalEntries('trader'),
    getJournalEntries('vi'),
  ]);
  const openSymbols = [...new Set(
    [...traderEntries, ...viEntries]
      .filter(t => t.status === 'open' && t.shares > 0 && t.symbol && t.symbol !== 'DIV')
      .map(t => t.symbol)
  )];

  if (!openSymbols.length) { showToast('ไม่มี Open Position ที่ต้องอัปเดต', 'info'); return; }

  state.journalPricesSyncing = true;
  _setBtnSyncing(true);
  showToast(`กำลัง sync ราคา ${openSymbols.length} ตัว...`, 'info');

  try {
    // fetch with short TTL (1 min) to always get fresh prices on manual sync
    const results = [];
    for (const sym of openSymbols) {
      try {
        const q = await fetchQuote(sym, apiKey, 60_000);
        results.push({ status: 'fulfilled', value: { sym, price: q?.c || null } });
      } catch (e) {
        results.push({ status: 'rejected', reason: e });
      }
      await new Promise(r => setTimeout(r, 100)); // 100ms delay to prevent 429
    }

    // BUG-M2: update both state.journalPrices AND priceCache (used by Portfolio Reallocation)
    const priceCache = JSON.parse(localStorage.getItem('priceCache') || '{}');
    results.forEach(r => {
      if (r.status === 'fulfilled' && r.value.price) {
        state.journalPrices[r.value.sym] = r.value.price;
        priceCache[r.value.sym] = r.value.price;
      }
    });
    localStorage.setItem('priceCache', JSON.stringify(priceCache));

    await loadDashboard();
    showToast('อัปเดตราคาแล้ว ✅', 'success');
  } finally {
    // BUG-L2: always reset button state even if an error occurs
    state.journalPricesSyncing = false;
    _setBtnSyncing(false);
  }
}

// ─── Move to Breakeven ────────────────────────────────────────────────────────

export async function moveToBreakeven(id, buyPrice) {
  await updateJournalEntry(id, { stopPrice: parseFloat(buyPrice), plannedLoss: 0 });
  showToast('Stop → Breakeven 📍 ไม้นี้ Risk Free แล้ว ✅', 'success');
  await loadDashboard();
}

// ─── Partial Close Modal ──────────────────────────────────────────────────────

export function openPartialCloseModal(id, symbol, buyPrice, shares, isVI = false) {
  state.partialCloseId  = id;
  state.partialCloseCtx = { symbol, buyPrice: parseFloat(buyPrice), totalShares: parseFloat(shares), isVI };

  document.getElementById('pc-symbol').textContent = symbol;
  document.getElementById('pc-info').innerHTML = `
    <div class="flex justify-between"><span>Buy Price</span><span class="font-bold text-white">$${parseFloat(buyPrice).toFixed(2)}</span></div>
    <div class="flex justify-between"><span>Total Shares</span><span class="font-bold text-white">${shares}</span></div>`;
  document.getElementById('pc-shares').value    = '';
  document.getElementById('pc-shares').max      = shares - 1;
  document.getElementById('pc-sell-price').value = '';
  document.getElementById('pc-pnl-preview').innerHTML = '<div class="text-gray-500 text-center text-xs">ใส่จำนวนและราคาขาย</div>';
  openModal('partial-close-modal', 'partial-close-sheet');
}

export function closePartialCloseModal() {
  closeModal('partial-close-modal', 'partial-close-sheet');
  state.partialCloseId  = null;
  state.partialCloseCtx = null;
}

export function updatePartialPnl() {
  const ctx       = state.partialCloseCtx;
  if (!ctx) return;
  const sellShares = parseFloat(document.getElementById('pc-shares')?.value);
  const sellPrice  = parseFloat(document.getElementById('pc-sell-price')?.value);
  const preview    = document.getElementById('pc-pnl-preview');
  if (!sellShares || !sellPrice || sellShares <= 0 || sellPrice <= 0 || !preview) return;

  const pnl        = (sellPrice - ctx.buyPrice) * sellShares;
  const pnlPct     = ((sellPrice - ctx.buyPrice) / ctx.buyPrice) * 100;
  const remaining  = ctx.totalShares - sellShares;
  const isProfit   = pnl >= 0;
  const color      = isProfit ? '#22c55e' : '#ef4444';

  preview.innerHTML = `
    <div class="grid grid-cols-3 gap-2 text-xs">
      <div class="bg-white/5 rounded-lg p-2 text-center"><div class="text-gray-400 mb-0.5">PnL ส่วนนี้</div>
        <div class="font-black" style="color:${color}">${isProfit ? '+' : ''}$${pnl.toFixed(2)}</div>
        <div style="color:${color}">${isProfit ? '+' : ''}${pnlPct.toFixed(1)}%</div></div>
      <div class="bg-white/5 rounded-lg p-2 text-center"><div class="text-gray-400 mb-0.5">ขาย</div>
        <div class="font-black text-white">${sellShares} shares</div></div>
      <div class="bg-white/5 rounded-lg p-2 text-center"><div class="text-gray-400 mb-0.5">เหลือ</div>
        <div class="font-black ${remaining > 0 ? 'text-blue-400' : 'text-gray-400'}">${remaining} shares</div></div>
    </div>`;
}

export async function confirmPartialClose() {
  const ctx = state.partialCloseCtx;
  const id  = state.partialCloseId;
  if (!ctx || !id) return;

  const sellShares = parseFloat(document.getElementById('pc-shares')?.value);
  const sellPrice  = parseFloat(document.getElementById('pc-sell-price')?.value);
  if (!sellShares || sellShares <= 0)      { showToast('กรุณาใส่จำนวนหุ้นที่ขาย', 'warning'); return; }
  if (!sellPrice || sellPrice <= 0)        { showToast('กรุณาใส่ราคาขาย', 'warning'); return; }
  if (sellShares >= ctx.totalShares)       { showToast('ถ้าขายทั้งหมด ให้ใช้ปุ่ม "ปิดไม้" แทน', 'warning'); return; }

  const pnl       = (sellPrice - ctx.buyPrice) * sellShares;
  const remaining = ctx.totalShares - sellShares;
  const isVI      = ctx.isVI ?? false;
  const now       = Date.now();

  try {
    // 1. Reduce shares on the original open entry
    await updateJournalEntry(id, { shares: remaining });

    // 2. Create closed audit entry for the sold portion
    await addJournalEntry({
      symbol: ctx.symbol, type: isVI ? 'vi' : 'trader', status: 'closed',
      buyPrice: ctx.buyPrice, sellPrice, shares: sellShares,
      stopPrice: null, targetPrice: null,
      strategy: 'partial-TP', chartLink: '',
      accountSize: null, riskPct: null, plannedLoss: null,
      plannedWin: null, rrRatio: null, targetLabel: 'Partial TP',
      isApplied: true, closedAt: now, createdAt: now,
    });

    // 3. Update portfolio capital
    const port = isVI
      ? (state.viPortfolio     || await getPortfolio('vi'))
      : (state.traderPortfolio || await getPortfolio('trader'));
    await updatePortfolio({ capital: port.capital + pnl, initialCapital: port.initialCapital }, isVI ? 'vi' : 'trader');
  } catch (e) {
    showToast(`เกิดข้อผิดพลาดระหว่างบันทึก: ${e.message} — กรุณาตรวจสอบ Journal`, 'error');
    await loadDashboard(); // re-render to show actual DB state
    return;
  }

  closePartialCloseModal();
  showToast(`✂️ ขาย ${sellShares} shares ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} · เหลือ ${remaining} shares open`, pnl >= 0 ? 'success' : 'warning');
  await loadDashboard();
}

// ─── Pyramid Modal ────────────────────────────────────────────────────────────

export function openPyramidModal(id, symbol, buyPrice, shares, stopPrice) {
  state.pyramidTradeId  = id;
  state.pyramidFirstLot = { shares, buyPrice, stopPrice, symbol };

  document.getElementById('pyramid-symbol').textContent = symbol;
  document.getElementById('pyramid-first-info').innerHTML = `
    <div class="flex justify-between"><span>ไม้แรก Buy</span><span class="font-bold text-white">$${parseFloat(buyPrice).toFixed(2)}</span></div>
    <div class="flex justify-between"><span>Shares</span><span class="font-bold text-white">${shares}</span></div>
    <div class="flex justify-between"><span>Stop ปัจจุบัน</span><span class="font-bold text-red-400">$${parseFloat(stopPrice || 0).toFixed(2)}</span></div>
    <div class="flex justify-between"><span>Ceiling ไม้ 2</span><span class="font-bold text-yellow-400">≤ ${Math.floor(shares * 0.5)} shares</span></div>`;
  document.getElementById('pyramid-next-entry').value = '';
  document.getElementById('pyramid-next-stop').value  = '';
  document.getElementById('pyramid-preview').innerHTML = '<div class="text-gray-500 text-center">ใส่ราคาเพื่อดูผล</div>';
  document.getElementById('pyramid-error').classList.add('hidden');

  openModal('pyramid-modal', 'pyramid-sheet');
}

export function closePyramidModal() {
  closeModal('pyramid-modal', 'pyramid-sheet');
  state.pyramidTradeId  = null;
  state.pyramidFirstLot = null;
}

export function previewPyramid() {
  const firstLot   = state.pyramidFirstLot;
  if (!firstLot) return;

  const port       = state.traderPortfolio;
  const accountSize = port?.capital || 0;
  const riskPct    = parseFloat(document.getElementById('calc-risk-pct')?.value) || 1;
  const nextEntry  = parseFloat(document.getElementById('pyramid-next-entry')?.value);
  const nextStop   = parseFloat(document.getElementById('pyramid-next-stop')?.value);
  const fractional = document.getElementById('calc-frac')?.checked ?? false;

  const errEl  = document.getElementById('pyramid-error');
  const prevEl = document.getElementById('pyramid-preview');

  if (!nextEntry || !nextStop || nextEntry <= 0 || nextStop <= 0) {
    prevEl.innerHTML = '<div class="text-gray-500 text-center">ใส่ราคาเพื่อดูผล</div>';
    errEl.classList.add('hidden');
    return;
  }

  const res = calculatePyramidRisk(accountSize, riskPct, firstLot, nextEntry, nextStop, fractional);

  if (res.errors?.length) {
    errEl.textContent = res.errors[0];
    errEl.classList.remove('hidden');
    prevEl.innerHTML = '';
    return;
  }

  errEl.classList.add('hidden');
  const isAlert = res.alerts?.length;
  prevEl.innerHTML = `
    <div class="grid grid-cols-2 gap-2 text-xs">
      <div class="bg-white/5 rounded-lg p-2"><div class="text-gray-400 mb-0.5">ซื้อเพิ่ม</div><div class="font-black text-white text-lg">${res.nextShares} shares</div></div>
      <div class="bg-white/5 rounded-lg p-2"><div class="text-gray-400 mb-0.5">Stop ใหม่</div><div class="font-black text-red-400">$${res.nextStop.toFixed(2)}</div></div>
      <div class="bg-white/5 rounded-lg p-2"><div class="text-gray-400 mb-0.5">Avg Cost ใหม่</div><div class="font-black text-yellow-400">$${res.newAvgCost.toFixed(2)}</div></div>
      <div class="bg-white/5 rounded-lg p-2"><div class="text-gray-400 mb-0.5">Combined Risk</div><div class="font-black ${res.combinedRiskPct <= 0 ? 'text-blue-400' : isAlert ? 'text-orange-400' : 'text-green-400'}">${res.combinedRiskPct <= 0 ? '📍 Risk-Free' : res.combinedRiskPct.toFixed(2) + '%'}</div></div>
    </div>
    ${isAlert ? `<div class="mt-2 text-[10px] text-orange-400 text-center">⚠️ ${res.alerts[0]}</div>` : ''}`;
}

export async function confirmPyramid() {
  const firstLot   = state.pyramidFirstLot;
  const id         = state.pyramidTradeId;
  if (!firstLot || !id) return;

  const port       = state.traderPortfolio;
  const accountSize = port?.capital || 0;
  const riskPct    = parseFloat(document.getElementById('calc-risk-pct')?.value) || 1;
  const nextEntry  = parseFloat(document.getElementById('pyramid-next-entry')?.value);
  const nextStop   = parseFloat(document.getElementById('pyramid-next-stop')?.value);
  const fractional = document.getElementById('calc-frac')?.checked ?? false;

  const res = calculatePyramidRisk(accountSize, riskPct, firstLot, nextEntry, nextStop, fractional);
  if (res.errors?.length) { showToast(res.errors[0], 'warning'); return; }

  // Update original trade's stop to new trailing stop
  await updateJournalEntry(id, { stopPrice: res.nextStop });

  // Add new lot as separate journal entry (preserves audit trail)
  await addJournalEntry({
    symbol:      firstLot.symbol,
    type:        'trader',
    status:      'open',
    buyPrice:    res.nextEntry,
    sellPrice:   null,
    shares:      res.nextShares,
    stopPrice:   res.nextStop,
    targetPrice: null,
    strategy:    'pyramid',
    chartLink:   '',
    accountSize,
    riskPct,
    plannedLoss: res.combinedRisk,
    plannedWin:  null,
    rrRatio:     null,
    targetLabel: 'Pyramid Lot 2',
    isApplied:   true,
    createdAt:   Date.now(),
  });

  closePyramidModal();
  showToast(`บันทึก Pyramid ${firstLot.symbol} +${res.nextShares} shares แล้ว ✅`, 'success');
  await loadDashboard();
}

function _setBtnSyncing(loading) {
  ['journal-sync-btn', 'vi-journal-sync-btn'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? '⏳ กำลัง sync...' : '🔄 Sync ราคา';
  });
}

export function setTimeframe(tf) {
  state.dashboardTimeframe = tf;
  ['all', 'month', 'week'].forEach(id => {
    document.getElementById('btn-tf-' + id)?.classList.toggle('active', id === tf);
  });
  loadDashboard();
}

// ─── Capital Sync ─────────────────────────────────────────────────────────────

export async function runCapitalSync(type = 'trader') {
  const entries  = await getJournalEntries(type);
  let totalPnL   = 0;
  entries.forEach(t => {
    if (t.isApplied === false) return;
    if (t.strategy === 'dividend') { totalPnL += t.sellPrice || 0; return; }
    if (t.status === 'closed' && t.shares > 0) totalPnL += ((t.sellPrice || 0) - (t.buyPrice || 0)) * t.shares;
  });

  const port = type === 'vi' ? state.viPortfolio : state.traderPortfolio;
  if (!port) return;
  await updatePortfolio({ capital: port.initialCapital + totalPnL, initialCapital: port.initialCapital }, type);
  await loadDashboard();
}

// ─── Trade Modal ──────────────────────────────────────────────────────────────

export function openTradeModal(type = 'trader') {
  state.editingTradeId     = null;
  state.tradeEditingType   = type;
  setTradeStatus('closed');
  ['trade-symbol', 'trade-buy', 'trade-sell', 'trade-shares', 'trade-stop', 'trade-target'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const expert = document.getElementById('wrapper-trade-expert');
  if (expert) {
    expert.classList.toggle('hidden', type !== 'trader');
    if (type === 'trader') {
      document.getElementById('trade-strategy').value = '';
      document.getElementById('trade-chart').value    = '';
    }
  }
  openModal('trade-modal', 'trade-sheet');
}

export function closeTradeModal() { closeModal('trade-modal', 'trade-sheet'); }

export function setTradeStatus(status) {
  state.tradeStatus = status;
  const isOpen = status === 'open';
  document.getElementById('btn-status-open')?.classList.toggle('bg-[var(--accent-primary)]', isOpen);
  document.getElementById('btn-status-open')?.classList.toggle('text-white', isOpen);
  document.getElementById('btn-status-open')?.classList.toggle('text-gray-400', !isOpen);
  document.getElementById('btn-status-closed')?.classList.toggle('bg-[var(--card-dark)]', !isOpen);
  document.getElementById('btn-status-closed')?.classList.toggle('text-white', !isOpen);
  document.getElementById('btn-status-closed')?.classList.toggle('text-gray-400', isOpen);
  const wrapSell   = document.getElementById('wrapper-trade-sell');
  const sellInput  = document.getElementById('trade-sell');
  if (wrapSell) {
    wrapSell.classList.remove('hidden');
    wrapSell.classList.toggle('opacity-30', isOpen);
    wrapSell.classList.toggle('pointer-events-none', isOpen);
  }
  if (isOpen && sellInput) sellInput.value = '';
}

export async function saveTrade() {
  const symbol   = document.getElementById('trade-symbol')?.value.toUpperCase();
  const buyPrice = parseFloat(document.getElementById('trade-buy')?.value);
  let   sellPrice = parseFloat(document.getElementById('trade-sell')?.value);
  const shares    = parseFloat(document.getElementById('trade-shares')?.value);
  const stopPrice = parseFloat(document.getElementById('trade-stop')?.value);
  const target    = parseFloat(document.getElementById('trade-target')?.value);
  const status    = state.tradeStatus;
  const type      = state.tradeEditingType;

  if (status === 'open') {
    sellPrice = null;
    if (!symbol || isNaN(buyPrice) || isNaN(shares)) { showToast('กรุณาใส่ Symbol, Buy Price, Shares', 'error'); return; }
  } else {
    if (!symbol || isNaN(buyPrice) || isNaN(sellPrice) || isNaN(shares)) { showToast('กรุณาใส่ข้อมูลให้ครบ', 'error'); return; }
  }

  const entry = {
    symbol, buyPrice, sellPrice, shares, status, type,
    stopPrice:   isNaN(stopPrice) ? null : stopPrice,
    targetPrice: isNaN(target)    ? null : target,
  };
  if (type === 'trader') {
    entry.strategy  = document.getElementById('trade-strategy')?.value || '';
    entry.chartLink = document.getElementById('trade-chart')?.value    || '';
  }

  if (state.editingTradeId) {
    const all = await getJournalEntries(type);
    const existing = all.find(e => e.id === state.editingTradeId);
    if (existing) await updateJournalEntry({ ...existing, ...entry });
  } else {
    entry.isApplied = true;
    await addJournalEntry(entry);
  }

  await runCapitalSync(type);
  closeTradeModal();
}

export async function editTrade(id, type = 'trader') {
  const entries = await getJournalEntries(type);
  const t = entries.find(e => e.id === id);
  if (!t) return;

  state.editingTradeId   = id;
  state.tradeEditingType = type;
  setTradeStatus(t.status || 'closed');
  _setVal('trade-symbol',   t.symbol);
  _setVal('trade-buy',      t.buyPrice);
  _setVal('trade-sell',     t.sellPrice || '');
  _setVal('trade-shares',   t.shares);
  _setVal('trade-stop',     t.stopPrice || '');
  _setVal('trade-target',   t.targetPrice || '');

  const expert = document.getElementById('wrapper-trade-expert');
  if (expert) {
    expert.classList.toggle('hidden', type !== 'trader');
    if (type === 'trader') { _setVal('trade-strategy', t.strategy || ''); _setVal('trade-chart', t.chartLink || ''); }
  }
  openModal('trade-modal', 'trade-sheet');
}

export async function deleteTrade(id, type = 'trader') {
  showConfirm('ลบรายการนี้?', async () => {
    await deleteJournalEntry(id);
    await runCapitalSync(type);
  });
}

// ─── Close Trade Modal ────────────────────────────────────────────────────────

export function openCloseTradeModal(id, symbol, buyPrice, shares, targetPrice) {
  state.closeTradeId = id;
  const tp = _sanitizeFloat(targetPrice);

  _setText('ct-symbol', symbol);
  document.getElementById('ct-info').innerHTML = `
    <div class="flex justify-between"><span>Buy Price</span><span class="font-bold text-white">$${parseFloat(buyPrice).toFixed(2)}</span></div>
    <div class="flex justify-between"><span>Shares</span><span class="font-bold text-white">${shares}</span></div>
    ${tp ? `<div class="flex justify-between"><span>Target</span><span class="font-bold text-green-400">$${tp.toFixed(2)}</span></div>` : ''}`;

  const sellInput = document.getElementById('ct-sell-price');
  sellInput.value              = tp ? tp.toFixed(2) : '';
  sellInput.dataset.buyPrice   = buyPrice;
  sellInput.dataset.shares     = shares;
  sellInput.dataset.viMode     = 'false';

  _resetCTPnl();
  updateCTPnl();
  openModal('close-trade-modal', 'close-trade-sheet');
  setTimeout(() => sellInput.focus(), 200);
}

export function openCloseVITrade(idOrIds, symbol, buyPrice, shares, targetPrice) {
  // BUG-C1: support array of IDs for multi-lot positions
  const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
  state.closeTradeId     = ids[0];
  state.closeTradeAllIds = ids;
  const tp = _sanitizeFloat(targetPrice);

  _setText('ct-symbol', symbol);
  document.getElementById('ct-info').innerHTML = `
    <div class="flex justify-between"><span>Buy Price</span><span class="font-bold text-white">$${parseFloat(buyPrice).toFixed(2)}</span></div>
    ${shares > 0 ? `<div class="flex justify-between"><span>Shares</span><span class="font-bold text-white">${shares}</span></div>` : '<div class="flex justify-between"><span>Shares</span><span class="text-gray-400">ไม่ระบุ</span></div>'}
    ${tp ? `<div class="flex justify-between"><span>Fair Value</span><span class="font-bold text-green-400">$${tp.toFixed(2)}</span></div>` : ''}`;

  const sellInput = document.getElementById('ct-sell-price');
  sellInput.value              = tp ? tp.toFixed(2) : '';
  sellInput.dataset.buyPrice   = buyPrice;
  sellInput.dataset.shares     = shares;
  sellInput.dataset.viMode     = 'true';

  _resetCTPnl();
  updateCTPnl();
  openModal('close-trade-modal', 'close-trade-sheet');
  setTimeout(() => sellInput.focus(), 200);
}

export function closeCloseTradeModal() {
  closeModal('close-trade-modal', 'close-trade-sheet');
  state.closeTradeId     = null;
  state.closeTradeAllIds = [];
}

export function updateCTPnl() {
  const sellInput = document.getElementById('ct-sell-price');
  const preview   = document.getElementById('ct-pnl-preview');
  const sell  = parseFloat(sellInput?.value);
  const buy   = parseFloat(sellInput?.dataset.buyPrice);
  const shares = parseFloat(sellInput?.dataset.shares);
  if (!sell || !buy || !shares) return;

  const pnl   = (sell - buy) * shares;
  const pct   = ((sell - buy) / buy) * 100;
  const color = pnl >= 0 ? '#22c55e' : '#ef4444';
  preview.innerHTML = `
    <div class="text-xs text-gray-400 mb-1">PnL</div>
    <div class="text-2xl font-black" style="color:${color}">${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}</div>
    <div class="text-xs" style="color:${color}">${pnl >= 0 ? '+' : ''}${pct.toFixed(2)}%</div>`;
}

export async function confirmCloseTrade() {
  if (!state.closeTradeId) return;
  const sellInput = document.getElementById('ct-sell-price');
  const sell = parseFloat(sellInput?.value);
  if (!sell || sell <= 0) { showToast('กรุณาใส่ราคาขาย', 'warning'); return; }

  const buy    = parseFloat(sellInput.dataset.buyPrice);
  const shares = parseFloat(sellInput.dataset.shares);
  const pnl    = shares > 0 ? (sell - buy) * shares : 0;
  const isVI   = sellInput.dataset.viMode === 'true';

  // BUG-C1: close all trade IDs (multi-lot VI positions have multiple entries)
  const idsToClose = state.closeTradeAllIds?.length ? state.closeTradeAllIds : [state.closeTradeId];
  const closedAt   = Date.now();
  await Promise.all(idsToClose.map(id => updateJournalEntry(id, { status: 'closed', sellPrice: sell, closedAt })));

  if (shares > 0) {
    const port = isVI
      ? (state.viPortfolio   || await getPortfolio('vi'))
      : (state.traderPortfolio || await getPortfolio('trader'));
    await updatePortfolio({ capital: port.capital + pnl, initialCapital: port.initialCapital }, isVI ? 'vi' : 'trader');
  }

  closeCloseTradeModal();
  showToast(`ปิดไม้แล้ว ${shares > 0 ? (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2) : 'Tracking closed'} → อัปเดตพอร์ตแล้ว`, shares > 0 ? (pnl >= 0 ? 'success' : 'warning') : 'info');
  await loadDashboard();
}

export function cancelTrade() {
  if (!state.closeTradeId) return;
  const idToDelete = state.closeTradeId;
  // BUG-L3: confirm BEFORE closing modal so user can see context
  showConfirm('ไม่ได้ซื้อ / ลบรายการนี้? (ไม่กระทบพอร์ต)', async () => {
    closeCloseTradeModal();
    await deleteJournalEntry(idToDelete);
    showToast('ลบรายการแล้ว', 'info');
    await loadDashboard();
  });
}

// ─── Quick Save ───────────────────────────────────────────────────────────────

export function saveFromRiskCalc() {
  const entry      = parseFloat(document.getElementById('calc-entry-price')?.value);
  const stop       = parseFloat(document.getElementById('calc-stop-loss')?.value);
  const target     = parseFloat(document.getElementById('calc-target-price')?.value) || null;
  const accountSize = parseFloat(document.getElementById('calc-account-size')?.value) || null;
  const riskPct    = parseFloat(document.getElementById('calc-risk-pct')?.value) || null;
  const shares     = parseFloat(document.getElementById('out-shares')?.innerText.replace(/[^0-9.]/g, '')) || null;
  const plannedLoss = parseFloat(document.getElementById('out-risk-amt')?.innerText.replace(/[^0-9.]/g, '')) || null;
  const plannedWin  = parseFloat(document.getElementById('out-reward-amt')?.innerText.replace(/[^0-9.]/g, '')) || null;
  const rrRatio     = document.getElementById('out-rr')?.innerText.replace('R/R: ', '') || null;

  if (!entry || !stop) { showToast('กรุณาใส่ Entry และ Stop ก่อน', 'warning'); return; }

  state.quickSaveData = { entry, stop, target, shares, accountSize, riskPct, plannedLoss, plannedWin, rrRatio, targetLabel: state.lastTargetLabel };

  const knownSymbol = state.lastScanData?.symbol || '';
  if (knownSymbol) { _confirmQuickSaveWithSymbol(knownSymbol); return; }

  _setVal('qs-symbol', '');
  document.getElementById('qs-summary').innerHTML = `
    <div class="flex justify-between"><span class="text-gray-400">Entry</span><span class="font-bold">$${entry.toFixed(2)}</span></div>
    <div class="flex justify-between"><span class="text-gray-400">Stop</span><span class="font-bold text-red-400">$${stop.toFixed(2)}</span></div>
    ${target ? `<div class="flex justify-between"><span class="text-gray-400">Target (${state.lastTargetLabel})</span><span class="font-bold text-green-400">$${target.toFixed(2)}</span></div>` : ''}
    ${shares ? `<div class="flex justify-between"><span class="text-gray-400">Shares</span><span class="font-bold">${shares}</span></div>` : ''}
    <div class="flex justify-between border-t border-white/10 pt-1 mt-1">
      ${accountSize ? `<span class="text-gray-400">Port $${accountSize.toLocaleString()}</span>` : '<span></span>'}
      ${riskPct ? `<span class="text-yellow-400 font-bold">Risk ${riskPct}%</span>` : ''}
    </div>`;
  openModal('quick-save-modal', 'quick-save-sheet');
  setTimeout(() => document.getElementById('qs-symbol')?.focus(), 200);
}

export function saveFromVIRisk() {
  const currentPrice = parseFloat(document.getElementById('vi-mos-price')?.value);
  const fairValue    = parseFloat(document.getElementById('vi-mos-fair')?.value) || null;

  if (!currentPrice || currentPrice <= 0) { showToast('กรุณาใส่ราคาปัจจุบันใน Current Price ก่อน', 'warning'); return; }

  const allocText   = document.getElementById('vi-alloc-result')?.innerText || '';
  const maxPos      = parseFloat(allocText.replace(/[^0-9.]/g, '')) || null;
  const fractional  = document.getElementById('vi-frac')?.checked || false;
  const sharesExact = (maxPos && currentPrice) ? maxPos / currentPrice : null;
  const shares      = sharesExact != null ? (fractional ? Math.round(sharesExact * 10000) / 10000 : Math.floor(sharesExact)) : null;

  // Restore lastViScanMeta from localStorage if missing
  if (!state.lastViScanMeta) {
    try { state.lastViScanMeta = JSON.parse(localStorage.getItem('lastViScanMeta') || 'null'); } catch {}
  }

  state.quickSaveData = {
    entry: currentPrice, stop: null, target: fairValue, shares,
    accountSize: state.viPortfolio?.capital || null,
    riskPct: null, plannedLoss: null,
    plannedWin: fairValue && shares ? ((fairValue - currentPrice) * shares) : null,
    rrRatio: null, targetLabel: fairValue ? `Fair $${fairValue.toFixed(2)}` : null,
    _viMode: true, _viMeta: state.lastViScanMeta || null,
  };

  const knownSymbol = state.lastViScanMeta?.symbol
    || state.lastScanData?.symbol
    || document.getElementById('vi-scan-input')?.value.trim().toUpperCase()
    || '';
  if (knownSymbol) { _confirmQuickSaveWithSymbol(knownSymbol); return; }

  _setVal('qs-symbol', '');
  openModal('quick-save-modal', 'quick-save-sheet');
  setTimeout(() => document.getElementById('qs-symbol')?.focus(), 200);
}

export function closeQuickSave() { closeModal('quick-save-modal', 'quick-save-sheet'); }

export async function confirmQuickSave() {
  const symbol = document.getElementById('qs-symbol')?.value.trim().toUpperCase();
  if (!symbol) { showToast('กรุณาใส่ Ticker', 'warning'); return; }
  if (!state.quickSaveData) return;
  await _confirmQuickSaveWithSymbol(symbol);
}

async function _confirmQuickSaveWithSymbol(symbol) {
  if (!state.quickSaveData) return;
  const { entry, stop, target, shares, accountSize, riskPct, plannedLoss, plannedWin, rrRatio, targetLabel, _viMode, _viMeta } = state.quickSaveData;
  await addJournalEntry({
    symbol, type: _viMode ? 'vi' : 'trader', status: 'open',
    buyPrice: entry, sellPrice: null, shares: shares || 0,
    stopPrice: stop, targetPrice: target || null,
    accountSize: accountSize || null, riskPct: riskPct || null,
    plannedLoss: plannedLoss || null, plannedWin: plannedWin || null,
    rrRatio: rrRatio || null, targetLabel: targetLabel || (_viMode ? 'Fair Value' : '2R'),
    viMeta: _viMeta || null, strategy: '', chartLink: '',
    isApplied: true, createdAt: Date.now(),
  });
  closeQuickSave();
  showToast(`บันทึก ${symbol} เป็น Open Position แล้ว ✅`, 'success');
  await loadDashboard();
}

// ─── Save from Scan ───────────────────────────────────────────────────────────

export function saveFromScan() {
  if (!state.lastScanData) return;
  const d = state.lastScanData;
  openTradeModal('trader');
  setTimeout(() => {
    _setVal('trade-symbol',  d.symbol);
    _setVal('trade-buy',     d.entry.toFixed(2));
    _setVal('trade-stop',    d.stop.toFixed(2));
    _setVal('trade-target',  d.target.toFixed(2));
    if (d.shares) _setVal('trade-shares', d.shares);
    setTradeStatus('open');
  }, 50);
}

// ─── Dividend ─────────────────────────────────────────────────────────────────

export async function logDividend() {
  const entries    = await getJournalEntries('vi');
  const openSymbols = [...new Set(entries.filter(t => t.status === 'open').map(t => t.symbol))];
  const select     = document.getElementById('div-symbol');
  select.innerHTML = '<option value="">-- เลือกหุ้น (optional) --</option>';
  openSymbols.forEach(sym => {
    const opt = document.createElement('option');
    opt.value = sym; opt.textContent = sym;
    select.appendChild(opt);
  });
  document.getElementById('div-amount').value = '';
  document.getElementById('div-preview').classList.add('hidden');

  document.getElementById('div-amount').oninput = function () {
    const v    = parseFloat(this.value);
    const prev = document.getElementById('div-preview');
    const amt  = document.getElementById('div-preview-amt');
    if (v > 0) { prev.classList.remove('hidden'); amt.textContent = `+$${v.toFixed(2)}`; }
    else         prev.classList.add('hidden');
  };

  openModal('dividend-modal', 'dividend-sheet');
}

export function closeDividendModal() { closeModal('dividend-modal', 'dividend-sheet'); }

export async function confirmDividend() {
  const amount = parseFloat(document.getElementById('div-amount')?.value);
  const sym    = document.getElementById('div-symbol')?.value;
  if (!amount || amount <= 0) { showToast('กรุณาใส่จำนวนเงิน', 'warning'); return; }

  // Removed double counting: initialCapital will be properly added via runCapitalSync
  await addJournalEntry({
    symbol: sym || 'DIV', type: 'vi', status: 'open',
    buyPrice: 0, sellPrice: amount, shares: 0,
    stopPrice: null, targetPrice: null,
    strategy: 'dividend', chartLink: '',
    isApplied: true, createdAt: Date.now(),
  });

  closeDividendModal();
  showToast(`บันทึกปันผล${sym ? ` ${sym}` : ''} +$${amount.toFixed(2)} แล้ว`, 'success');
  await runCapitalSync('vi');
}

// ─── Sync Modal ───────────────────────────────────────────────────────────────

export async function openSyncModal() {
  state.syncEntriesCache = await getJournalEntries('trader');
  state.syncEntriesCache.sort((a, b) => b.createdAt - a.createdAt);
  _renderSyncList();
  openModal('sync-modal', 'sync-sheet');
}

export function closeSyncModal() { closeModal('sync-modal', 'sync-sheet'); }

export function toggleSyncTrade(index, checked) {
  state.syncEntriesCache[index].isApplied = checked;
  _renderSyncList();
}

export async function confirmSync() {
  for (const t of state.syncEntriesCache) await updateJournalEntry(t);
  await runCapitalSync('trader');
  closeSyncModal();
}

function _renderSyncList() {
  const list = document.getElementById('sync-trade-list');
  list.innerHTML = '';
  let previewPnL = 0;

  state.syncEntriesCache.forEach((t, i) => {
    // BUG-C2: skip dividend entries — they have buyPrice=0, shares=0 and cause NaN
    if (t.strategy === 'dividend' || !t.shares) return;
    const pnl       = (t.sellPrice - t.buyPrice) * t.shares;
    const isApplied = t.isApplied !== false;
    if (isApplied) previewPnL += pnl;
    list.innerHTML += `
      <div class="bg-white/5 border border-white/5 rounded-xl p-3 flex justify-between items-center ${isApplied ? '' : 'opacity-50'}">
        <div class="flex items-center gap-3">
          <input type="checkbox" class="w-5 h-5 accent-blue-500" ${isApplied ? 'checked' : ''} onchange="toggleSyncTrade(${i}, this.checked)">
          <div>
            <div class="font-bold">${t.symbol}</div>
            <div class="text-[10px] text-gray-400">$${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</div>
          </div>
        </div>
      </div>`;
  });

  const newCap = (state.traderPortfolio?.initialCapital || 0) + previewPnL;
  _setText('sync-preview-capital', '$' + newCap.toLocaleString(undefined, { minimumFractionDigits: 2 }));
}

// ─── Stats rendering ──────────────────────────────────────────────────────────

function _renderStats(entries) {
  const now  = Date.now();
  const tf   = state.dashboardTimeframe;
  const filtered = tf === 'all' ? entries
    : entries.filter(t => now - t.createdAt < (tf === 'month' ? 30 : 7) * 24 * 60 * 60 * 1000);

  let pnl = 0, grossProfit = 0, grossLoss = 0, winCount = 0, applied = 0, sumRR = 0, rrCount = 0;
  filtered.forEach(t => {
    if (t.isApplied === false || t.status !== 'closed') return;
    const p = (t.sellPrice - t.buyPrice) * t.shares;
    pnl += p; applied++;
    if (p > 0) { grossProfit += p; winCount++; } else grossLoss += Math.abs(p);
    if (t.stopPrice && t.buyPrice !== t.stopPrice) {
      const risk = t.buyPrice - t.stopPrice;
      if (risk > 0) { sumRR += (t.sellPrice - t.buyPrice) / risk; rrCount++; }
    }
  });

  const initCap = state.traderPortfolio?.initialCapital || 1;
  const pf      = grossLoss === 0 ? (grossProfit > 0 ? 99.99 : 0) : grossProfit / grossLoss;

  // Max Drawdown — peak-to-trough across all-time closed trades (always uses full history)
  const allClosed = entries
    .filter(t => t.status === 'closed' && t.isApplied !== false && t.shares > 0 && t.strategy !== 'dividend')
    .sort((a, b) => a.createdAt - b.createdAt);
  let ddCum = 0, ddPeak = initCap, maxDD = 0;
  allClosed.forEach(t => {
    ddCum += (t.sellPrice - t.buyPrice) * t.shares;
    const cur = initCap + ddCum;
    if (cur > ddPeak) ddPeak = cur;
    if (ddPeak > 0) maxDD = Math.max(maxDD, (ddPeak - cur) / ddPeak * 100);
  });

  _setText('dash-pnl',          `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`);
  _setText('dash-pnl-pct',      `${pnl >= 0 ? '+' : ''}${((pnl / initCap) * 100).toFixed(1)}%`);
  _setText('dash-winrate',      `${applied > 0 ? ((winCount / applied) * 100).toFixed(1) : 0}%`);
  _setText('dash-trades-count', String(applied));
  _setText('dash-avg-rr',       rrCount > 0 ? `${(sumRR / rrCount).toFixed(2)}R` : '—');
  _setText('dash-pf',           pf >= 99 ? 'MAX' : pf.toFixed(2));
  _setText('dash-max-dd',       maxDD > 0 ? `-${maxDD.toFixed(1)}%` : '—');

  // Label updates
  const pnlLabel = document.querySelector('#dash-pnl')?.previousElementSibling;
  if (pnlLabel) pnlLabel.innerText = tf === 'all' ? 'All-Time PnL' : tf === 'month' ? '1M PnL' : '1W PnL';

  // Top performers
  const topEl = document.getElementById('dash-top-performers');
  if (topEl) {
    const valid = filtered.filter(t => t.isApplied !== false && t.status === 'closed');
    if (!valid.length) { topEl.innerHTML = '<div class="text-center text-gray-500 text-sm py-4">No data yet.</div>'; return; }
    const agg = {};
    valid.forEach(t => {
      const p = (t.sellPrice - t.buyPrice) * t.shares;
      if (!agg[t.symbol]) agg[t.symbol] = { symbol: t.symbol, pnl: 0, count: 0 };
      agg[t.symbol].pnl += p; agg[t.symbol].count++;
    });
    topEl.innerHTML = Object.values(agg).sort((a, b) => b.pnl - a.pnl).map(p => `
      <div class="flex justify-between items-center bg-white/5 px-3 py-2 rounded-lg border border-white/5">
        <div class="flex items-center gap-2"><span class="font-bold text-sm">${p.symbol}</span><span class="text-[10px] text-gray-400">${p.count} trades</span></div>
        <div class="font-bold text-sm ${p.pnl >= 0 ? 'text-green-400' : 'text-red-400'}">${p.pnl >= 0 ? '+' : ''}$${p.pnl.toFixed(2)}</div>
      </div>`).join('');
  }
}

// ─── Journal rendering ────────────────────────────────────────────────────────

function _renderJournal(entries, targetId, isVI) {
  const el = document.getElementById(targetId);
  if (!el) return;

  if (!entries.length) {
    el.innerHTML = isVI ? `
      <div class="text-center py-12 px-4 bg-gray-50 border border-gray-200 rounded-3xl mt-4">
        <div class="text-5xl mb-3">📊</div>
        <h3 class="text-lg font-bold text-gray-800 mb-2">ยังไม่มีรายการ</h3>
        <p class="text-sm text-gray-500 max-w-xs mx-auto">ไปที่ <b>Scan → Risk/Port</b> แล้วกด "บันทึกเข้า VI Journal"</p>
      </div>` : `
      <div class="text-center py-16 px-4 bg-white/5 border border-white/10 rounded-3xl mt-4">
        <div class="text-5xl mb-4">📓</div>
        <h3 class="text-lg font-bold text-white mb-2">No Trades Logged Yet</h3>
        <p class="text-sm text-gray-400 mb-6 max-w-xs mx-auto">Scan a stock, calculate risk, then tap "📓 บันทึกเข้า Journal"</p>
      </div>`;
    return;
  }

  el.innerHTML = '';
  if (isVI) _renderVIJournal(el, entries);
  else      _renderTraderJournal(el, entries);
}

function _renderTraderJournal(el, entries) {
  entries.sort((a, b) => b.createdAt - a.createdAt).forEach(t => {
    const pnl    = (t.sellPrice - t.buyPrice) * t.shares;
    const pnlPct = ((t.sellPrice - t.buyPrice) / t.buyPrice) * 100;
    let realRR   = null;
    if (t.status === 'closed' && t.stopPrice && t.buyPrice !== t.stopPrice) {
      const risk = t.buyPrice - t.stopPrice;
      if (risk > 0) realRR = (t.sellPrice - t.buyPrice) / risk;
    }
    const safeSymbol = escapeHtml(t.symbol);
    const safeStrategy = escapeHtml(t.strategy);
    const safeTargetLabel = escapeHtml(t.targetLabel);
    const safeChartLink = escapeHtml(t.chartLink);
    const extras = [
      t.strategy  ? `<span class="text-[9px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded border border-purple-500/20">${safeStrategy}</span>` : '',
      t.chartLink ? `<a href="${safeChartLink}" target="_blank" class="text-xs hover:scale-110 transition-transform">📈</a>` : '',
    ].join('');

    if (t.status === 'open') {
      const tlabel    = t.targetLabel ? `<span class="text-[9px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded border border-purple-500/20">Target: ${safeTargetLabel}</span>` : '';
      const riskBadge = t.riskPct     ? `<span class="text-[9px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">Risk ${t.riskPct}%</span>` : '';

      const cur = state.journalPrices[t.symbol];
      const livePnlBlock = cur && t.shares > 0 ? (() => {
        const livePnl    = (cur - t.buyPrice) * t.shares;
        const livePnlPct = ((cur - t.buyPrice) / t.buyPrice) * 100;
        const isProfit   = livePnl >= 0;
        const atTarget   = t.targetPrice && cur >= t.targetPrice;
        const nearStop   = t.stopPrice   && cur <= t.stopPrice * 1.02;
        let statusBadge  = '';
        if (atTarget) statusBadge = `<span class="text-[9px] font-bold bg-green-500/30 text-green-300 px-2 py-0.5 rounded-full border border-green-500/30">🎯 ถึงเป้าแล้ว!</span>`;
        else if (nearStop) statusBadge = `<span class="text-[9px] font-bold bg-red-500/30 text-red-300 px-2 py-0.5 rounded-full border border-red-500/30">⚠️ ใกล้ Stop!</span>`;
        return `
        <div class="mt-2 pt-2 border-t border-white/10 flex items-center justify-between">
          <div class="text-[10px] text-gray-400">ราคาล่าสุด <span class="text-white font-bold">$${cur.toFixed(2)}</span></div>
          <div class="flex items-center gap-2">
            ${statusBadge}
            <div class="text-right">
              <div class="text-xs font-black ${isProfit ? 'text-green-400' : 'text-red-400'}">${isProfit ? '+' : ''}$${livePnl.toFixed(2)}</div>
              <div class="text-[10px] ${isProfit ? 'text-green-500' : 'text-red-500'}">${isProfit ? '+' : ''}${livePnlPct.toFixed(1)}%</div>
            </div>
          </div>
        </div>`;
      })() : (cur ? `<div class="mt-2 pt-2 border-t border-white/10 text-[10px] text-gray-400">ราคาล่าสุด <span class="text-white font-bold">$${cur.toFixed(2)}</span></div>` : '');

      const isBE   = t.stopPrice != null && parseFloat(t.stopPrice) >= parseFloat(t.buyPrice);
      const beCell = t.stopPrice != null
        ? isBE
          ? `<div class="py-2 text-center text-[10px] font-bold text-green-400 border border-green-500/20 rounded-lg bg-green-500/5">📍 Risk Free</div>`
          : `<button onclick="moveToBreakeven(${t.id}, ${t.buyPrice})" class="py-2 rounded-lg text-xs font-bold border border-green-500/40 text-green-400 hover:bg-green-500/10 transition-colors">📍 BE</button>`
        : `<div></div>`;
      const partialCell = t.shares >= 2
        ? `<button onclick="openPartialCloseModal(${t.id}, '${safeSymbol}', ${t.buyPrice}, ${t.shares})" class="py-2 rounded-lg text-xs font-bold border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 transition-colors">✂️ ขายบางส่วน</button>`
        : `<div></div>`;

      el.innerHTML += `
        <div class="bg-[var(--card-dark)] border border-[var(--border-dark)] rounded-xl p-3 mb-2">
          <div class="flex justify-between items-start mb-2">
            <div class="flex-1 min-w-0">
              <div class="font-bold flex items-center gap-1.5 flex-wrap text-white mb-1">
                ${safeSymbol} <span class="text-[9px] bg-blue-500/20 text-blue-500 px-1.5 py-0.5 rounded border border-blue-500/20">OPEN</span>
                ${tlabel} ${riskBadge} ${extras}
              </div>
              <div class="text-[10px] text-gray-400">
                Buy <span class="text-white font-bold">$${t.buyPrice}</span>
                ${t.stopPrice   ? ` · Stop <span class="${isBE ? 'text-green-400' : 'text-red-400'}">$${t.stopPrice}</span>` : ''}
                ${t.targetPrice ? ` · Target <span class="text-green-400">$${t.targetPrice}</span>` : ''}
                · ${t.shares} shares
              </div>
              ${(t.plannedLoss || t.plannedWin) ? `
              <div class="flex gap-3 mt-1 text-[10px]">
                ${t.accountSize  ? `<span class="text-gray-500">Port $${t.accountSize.toLocaleString()}</span>` : ''}
                ${t.plannedLoss  ? `<span class="text-red-400">Loss -$${t.plannedLoss.toFixed(2)}</span>`        : ''}
                ${t.plannedWin   ? `<span class="text-green-400">Win +$${t.plannedWin.toFixed(2)}</span>`        : ''}
                ${t.rrRatio      ? `<span class="text-purple-400 font-bold">${t.rrRatio}</span>`                  : ''}
              </div>` : ''}
              ${livePnlBlock}
            </div>
            <button onclick="deleteTrade(${t.id}, 'trader')" class="text-xs text-gray-600 hover:text-red-400 ml-2 shrink-0">🗑️</button>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <button onclick="openPyramidModal(${t.id}, '${safeSymbol}', ${t.buyPrice}, ${t.shares}, ${t.stopPrice || 'null'})"
                    class="py-2 rounded-lg text-xs font-bold border border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10 transition-colors">
              ➕ Pyramid
            </button>
            ${beCell}
            ${partialCell}
            <button onclick="openCloseTradeModal(${t.id}, '${safeSymbol}', ${t.buyPrice}, ${t.shares}, ${t.targetPrice || 'null'})"
                    class="py-2 rounded-lg text-sm font-bold border border-purple-500/40 text-purple-400 hover:bg-purple-500/10 transition-colors">
              ปิดไม้ →
            </button>
          </div>
        </div>`;
    } else if (t.status === 'expired') {
      el.innerHTML += `
        <div class="bg-[var(--card-dark)] border border-orange-500/30 rounded-xl p-3 flex justify-between items-center mb-2 opacity-60">
          <div>
            <div class="font-bold flex items-center gap-2 text-white">${t.symbol} <span class="text-[9px] bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded border border-orange-500/20">EXPIRED</span></div>
            <div class="text-[10px] text-gray-400">Order ค้าง ${Math.round((Date.now() - t.createdAt) / 3600_000)}h · Buy $${t.buyPrice} · ${t.shares} shares</div>
            <div class="text-[10px] text-orange-400 mt-0.5">⚠️ ยกเลิก order ที่ broker ด้วย</div>
          </div>
          <button onclick="deleteTrade(${t.id}, 'trader')" class="text-xs text-gray-600 hover:text-red-400">🗑️</button>
        </div>`;
    } else {
      const rrBadge = realRR !== null
        ? `<span class="text-[9px] ${realRR >= 1 ? 'bg-green-500/20 text-green-500 border-green-500/20' : 'bg-red-500/20 text-red-500 border-red-500/20'} px-1.5 py-0.5 rounded border">${realRR.toFixed(1)}R</span>`
        : '';
      el.innerHTML += `
        <div class="bg-[var(--card-dark)] border border-[var(--border-dark)] rounded-xl p-3 flex justify-between items-center mb-2">
          <div>
            <div class="font-bold flex items-center gap-2 text-white">${safeSymbol} ${rrBadge} ${extras}</div>
            <div class="text-[10px] text-gray-400">Buy $${t.buyPrice} → Sell $${t.sellPrice} · ${t.shares} shares</div>
          </div>
          <div class="text-right flex items-center gap-2">
            <div>
              <div class="font-bold ${pnl >= 0 ? 'text-green-500' : 'text-red-500'}">${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}</div>
              <div class="text-[10px] ${pnl >= 0 ? 'text-green-500' : 'text-red-500'}">${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%</div>
            </div>
            <div class="flex flex-col gap-1 ml-2 border-l border-white/10 pl-2">
              <button onclick="editTrade(${t.id}, 'trader')" class="text-xs text-blue-500">✏️</button>
              <button onclick="deleteTrade(${t.id}, 'trader')" class="text-xs text-red-500">🗑️</button>
            </div>
          </div>
        </div>`;
    }
  });
}

function _renderVIJournal(el, entries) {
  const grouped  = {};
  const dividends = [];
  const closed    = [];

  entries.forEach(t => {
    if (t.strategy === 'dividend') { dividends.push(t); return; }
    if (t.status === 'open') {
      if (!grouped[t.symbol]) grouped[t.symbol] = { shares: 0, cost: 0, trades: [] };
      grouped[t.symbol].shares += t.shares || 0;
      grouped[t.symbol].cost   += (t.shares || 0) * (t.buyPrice || 0);
      grouped[t.symbol].trades.push(t);
    } else { closed.push(t); }
  });

  const f2  = v => v != null ? parseFloat(v).toFixed(2) : '—';
  const fp  = v => v != null ? `${v > 0 ? '+' : ''}${parseFloat(v).toFixed(1)}%` : '—';
  const dt  = ts => new Date(ts).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });

  // Open positions grouped
  Object.keys(grouped).forEach(sym => {
    const g        = grouped[sym];
    const avgCost  = g.shares > 0 ? g.cost / g.shares : (g.trades[0]?.buyPrice || 0);
    const safeSymbol = escapeHtml(sym);

    // Yield on Cost: dividends received for this symbol / total cost basis
    const symDivs    = dividends.filter(d => d.symbol === sym);
    const totalDiv   = symDivs.reduce((s, d) => s + (d.sellPrice || 0), 0);
    const totalCost  = avgCost * g.shares;
    const yoc        = (totalCost > 0 && totalDiv > 0) ? (totalDiv / totalCost * 100) : 0;
    const yocBadge   = yoc > 0
      ? `<span class="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full ml-1">YOC ${yoc.toFixed(1)}%</span>`
      : '';

    const cur = state.journalPrices[sym];
    let livePnlHeader = '';
    if (cur && g.shares > 0) {
      const livePnl    = (cur - avgCost) * g.shares;
      const livePnlPct = ((cur - avgCost) / avgCost) * 100;
      const isProfit   = livePnl >= 0;
      const fairValue  = g.trades.find(t => t.targetPrice)?.targetPrice;
      const atTarget   = fairValue && cur >= fairValue;
      livePnlHeader = `
        <div class="px-3 pb-3 pt-1 border-b border-gray-100 flex items-center justify-between">
          <div class="text-xs text-gray-500">ราคาล่าสุด <span class="font-bold text-gray-800">$${cur.toFixed(2)}</span></div>
          <div class="flex items-center gap-2">
            ${atTarget ? `<span class="text-[9px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">🎯 ถึง Fair Value!</span>` : ''}
            <div class="text-right">
              <div class="text-sm font-black ${isProfit ? 'text-green-600' : 'text-red-500'}">${isProfit ? '+' : ''}$${livePnl.toFixed(2)}</div>
              <div class="text-[10px] ${isProfit ? 'text-green-500' : 'text-red-500'}">${isProfit ? '+' : ''}${livePnlPct.toFixed(1)}%</div>
            </div>
          </div>
        </div>`;
    }

    el.innerHTML += `
      <div class="bg-white border border-gray-200 rounded-xl mb-3 shadow-sm overflow-hidden">
        <div class="bg-gray-50 p-3 border-b border-gray-200 flex justify-between items-center">
          <div class="font-black text-gray-800 text-lg flex items-center flex-wrap gap-1">
            ${safeSymbol}
            <span class="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Avg $${avgCost.toFixed(2)}</span>
            ${yocBadge}
          </div>
          <div class="text-xs font-bold text-gray-500">${g.shares > 0 ? `${g.shares} Shares` : 'Tracking Only'}</div>
        </div>
        ${livePnlHeader}
        <div class="p-2 space-y-1">
          ${g.trades.sort((a, b) => b.createdAt - a.createdAt).map(t => {
            const vm = t.viMeta;
            const meta = vm ? `
              <div class="mt-2 pt-2 border-t border-gray-100 grid grid-cols-3 gap-x-3 gap-y-1 text-[10px]">
                <div class="text-gray-400">VI Score <span class="font-bold text-blue-600">${vm.viScore}/10 ${vm.verdict}</span></div>
                <div class="text-gray-400">Mode <span class="font-bold ${vm.isGrowth ? 'text-yellow-600' : 'text-purple-600'}">${vm.stockMode}</span></div>
                <div class="text-gray-400">P/E <span class="font-bold text-gray-700">${f2(vm.pe)}</span></div>
                ${vm.pegRatio != null ? `<div class="text-gray-400">PEG <span class="font-bold ${vm.pegRatio < 1.5 ? 'text-green-600' : 'text-red-500'}">${f2(vm.pegRatio)}</span></div>` : ''}
                <div class="text-gray-400">ROE <span class="font-bold text-gray-700">${fp(vm.roe)}</span></div>
                <div class="text-gray-400">EPS Gr <span class="font-bold text-gray-700">${fp(vm.epsGrow)}</span></div>
              </div>` : '';
            return `
            <div class="text-xs p-2 border border-transparent hover:border-gray-100 rounded transition-colors">
              <div class="flex justify-between items-start">
                <div class="text-gray-600 font-medium">
                  Buy: $${t.buyPrice} ${t.shares > 0 ? `× ${t.shares} shares` : '(ไม่ระบุหุ้น)'}
                  ${t.targetPrice ? `<span class="text-green-600 ml-1">· Fair $${t.targetPrice}</span>` : ''}
                </div>
                <button onclick="deleteTrade(${t.id}, 'vi')" class="text-gray-400 hover:text-red-500">🗑️</button>
              </div>
              ${meta}
              <button onclick="openCloseVITrade(${t.id}, '${safeSymbol}', ${t.buyPrice}, ${t.shares || 0}, ${t.targetPrice || 'null'})"
                      class="w-full mt-2 py-1.5 rounded-lg text-xs font-bold border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors">ขายทิ้ง →</button>
            </div>`;
          }).join('')}
        </div>
      </div>`;
  });

  // Dividends
  if (dividends.length) {
    const totalDiv = dividends.reduce((s, t) => s + (t.sellPrice || 0), 0);
    el.innerHTML += `<h4 class="font-bold text-gray-500 text-xs mt-5 mb-2 uppercase tracking-wider ml-1">💵 Dividends — รวม +$${totalDiv.toFixed(2)}</h4>`;
    dividends.sort((a, b) => b.createdAt - a.createdAt).forEach(t => {
      el.innerHTML += `
        <div class="bg-green-50 border border-green-100 rounded-xl p-3 flex justify-between items-center mb-2">
          <div><div class="font-bold text-green-800">${t.symbol !== 'DIV' ? escapeHtml(t.symbol) : '—'}</div><div class="text-[10px] text-green-600">${dt(t.createdAt)}</div></div>
          <div class="flex items-center gap-3">
            <div class="font-black text-green-600">+$${(t.sellPrice || 0).toFixed(2)}</div>
            <button onclick="deleteTrade(${t.id}, 'vi')" class="text-xs text-gray-400 hover:text-red-500">🗑️</button>
          </div>
        </div>`;
    });
  }

  // Closed positions
  if (closed.length) {
    el.innerHTML += `<h4 class="font-bold text-gray-500 text-xs mt-5 mb-2 uppercase tracking-wider ml-1">📦 Closed Positions</h4>`;
    closed.sort((a, b) => b.createdAt - a.createdAt).forEach(t => {
      const pnl    = ((t.sellPrice || 0) - (t.buyPrice || 0)) * (t.shares || 1);
      const pnlPct = t.buyPrice > 0 ? ((t.sellPrice - t.buyPrice) / t.buyPrice * 100) : 0;
      el.innerHTML += `
        <div class="bg-white border border-gray-200 rounded-xl p-3 flex justify-between items-center mb-2">
          <div>
            <div class="font-bold text-gray-800">${escapeHtml(t.symbol)}</div>
            <div class="text-[10px] text-gray-500">Buy $${t.buyPrice} → Sell $${t.sellPrice}${t.shares > 0 ? ` · ${t.shares} shares` : ''} · ${dt(t.createdAt)}</div>
          </div>
          <div class="text-right flex items-center gap-2">
            <div>
              <div class="font-bold ${pnl >= 0 ? 'text-green-500' : 'text-red-500'}">${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}</div>
              <div class="text-[10px] ${pnl >= 0 ? 'text-green-500' : 'text-red-500'}">${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%</div>
            </div>
            <button onclick="deleteTrade(${t.id}, 'vi')" class="text-xs text-gray-400 hover:text-red-500 ml-1">🗑️</button>
          </div>
        </div>`;
    });
  }
}

// ─── Tiny DOM helpers ─────────────────────────────────────────────────────────

function _setText(id, text) { const el = document.getElementById(id); if (el) el.innerText = text; }
function _setVal(id, val)   { const el = document.getElementById(id); if (el) el.value = val; }
function _sanitizeFloat(v)  { return (v && v !== 'null' && !isNaN(parseFloat(v))) ? parseFloat(v) : null; }
function _resetCTPnl()      { const p = document.getElementById('ct-pnl-preview'); if (p) p.innerHTML = `<div class="text-xs text-gray-400 mb-1">PnL (ประมาณ)</div><div class="text-2xl font-black text-gray-400">—</div>`; }

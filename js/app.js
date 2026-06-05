// app.js — Entry point
// Initialises the app, wires input event listeners, and exposes public
// functions to window so HTML onclick attributes can reach them.

import { initDB, exportAllData, importAllData } from './db.js';
import { showToast, showConfirm } from './ui.js';
import {
  switchModule, switchTab, switchTraderTab,
  openGlobalLogicModal, closeGlobalLogicModal,
  openStockLogicModal, closeStockLogicModal, copyPrompt,
} from './nav.js';
import { updateMarketRegime, renderRegimeBanner } from './regime.js';
import { loadWatchlist, addWatchlist, removeWatchlist, addWatchlistDirect } from './watchlist.js';
import { openCapitalModal, closeCapitalModal, saveCapital, syncPrices, renderReallocation } from './portfolio.js';
import { updateRiskCalc, updateVIRiskCalc, applyToRiskCalc, applyToVIRisk, overrideCooldown } from './risk-calc.js';
import { scanStock, scanAllWatchlist, selectTarget } from './trader-scan.js';
import { scanVI, scanAllVI, calcMOSScan } from './vi-scan.js';
import {
  loadDashboard, setTimeframe, syncJournalPrices,
  openTradeModal, closeTradeModal, setTradeStatus, saveTrade, editTrade, deleteTrade,
  openCloseTradeModal, openCloseVITrade, closeCloseTradeModal, updateCTPnl,
  confirmCloseTrade, cancelTrade,
  saveFromRiskCalc, saveFromVIRisk, confirmQuickSave, closeQuickSave, saveFromScan,
  logDividend, closeDividendModal, confirmDividend,
  openSyncModal, closeSyncModal, toggleSyncTrade, confirmSync,
  openPyramidModal, closePyramidModal, previewPyramid, confirmPyramid,
  moveToBreakeven, toggleEntered,
  openPartialCloseModal, closePartialCloseModal, updatePartialPnl, confirmPartialClose,
} from './journal.js';

// ─── Expose to global scope (required for HTML onclick attributes) ─────────────

Object.assign(window, {
  // Navigation + modals
  switchModule, switchTab, switchTraderTab,
  openGlobalLogicModal, closeGlobalLogicModal,
  openStockLogicModal, closeStockLogicModal, copyPrompt,

  // Capital
  openCapitalModal, closeCapitalModal, saveCapital,

  // Trader scan
  scanStock, scanAllWatchlist, selectTarget,

  // VI scan
  scanVI, scanAllVI, calcMOSScan,

  // Watchlist
  addWatchlist, removeWatchlist, addWatchlistDirect,

  // Risk calculators
  applyToRiskCalc, applyToVIRisk, overrideCooldown,

  // Trade journal
  setTimeframe,
  openTradeModal, closeTradeModal, setTradeStatus,
  saveTrade, editTrade, deleteTrade,
  openCloseTradeModal, openCloseVITrade, closeCloseTradeModal,
  updateCTPnl, confirmCloseTrade, cancelTrade,
  saveFromRiskCalc, saveFromVIRisk, confirmQuickSave, closeQuickSave, saveFromScan,
  syncJournalPrices,
  moveToBreakeven, toggleEntered,
  openPartialCloseModal, closePartialCloseModal, updatePartialPnl, confirmPartialClose,
  openPyramidModal, closePyramidModal, previewPyramid, confirmPyramid,
  logDividend, closeDividendModal, confirmDividend,
  openSyncModal, closeSyncModal, toggleSyncTrade, confirmSync,

  // Portfolio
  syncPrices,
  evaluateHoldings: renderReallocation,

  // UI helpers (used in inline HTML handlers)
  showToast,
  showConfirm,

  // Backup / Restore
  exportBackup: _exportBackup,
  importBackup: _importBackup,
  saveApiKey:   _saveApiKey,
  saveOrderTTL: _saveOrderTTL,
  forceUpdate:  _forceUpdate,

});

// Risk % pill button — assigned separately to guarantee visibility
window.setRiskPct = function(val) {
  const range = document.getElementById('calc-risk-pct');
  if (range) { range.value = val; range.dispatchEvent(new Event('input')); }
  document.querySelectorAll('.risk-pct-btn').forEach(btn => {
    const active = parseFloat(btn.dataset.rpct) === parseFloat(val);
    btn.classList.toggle('bg-purple-600', active);
    btn.classList.toggle('text-white',    active);
    btn.classList.toggle('shadow-sm',     active);
    btn.classList.toggle('text-gray-400', !active);
  });
};

// ─── Force Update ─────────────────────────────────────────────────────────────

async function _forceUpdate() {
  const statusEl = document.getElementById('force-update-status');
  if (statusEl) statusEl.classList.remove('hidden');

  try {
    // 1. Unregister all Service Workers
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }

    // 2. Clear all Cache API caches (SW caches — JS/HTML files)
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }

    // 3. Hard reload (bypass browser HTTP cache too)
    window.location.reload(true);
  } catch (e) {
    if (statusEl) {
      statusEl.textContent = '❌ เกิดข้อผิดพลาด: ' + e.message;
      statusEl.classList.remove('animate-pulse');
    }
  }
}

// ─── Order TTL helpers ────────────────────────────────────────────────────────

function _updateTTLDaysLabel(hours) {
  const el = document.getElementById('order-ttl-days');
  if (!el) return;
  if (hours % 24 === 0) el.textContent = `${hours / 24} วัน`;
  else                   el.textContent = `${hours} ชม.`;
}

function _saveOrderTTL(val) {
  const hours = Math.min(168, Math.max(1, parseInt(val) || 72));
  localStorage.setItem('order_ttl_hours', String(hours));
  _updateTTLDaysLabel(hours);
  // Sync input in case value was clamped
  const el = document.getElementById('order-ttl-hours');
  if (el && parseInt(el.value) !== hours) el.value = hours;
}

// ─── Backup helpers ───────────────────────────────────────────────────────────

async function _exportBackup() {
  try {
    const data = await exportAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href:     url,
      download: `riskfirst-backup-${new Date().toISOString().split('T')[0]}.json`,
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Backup exported successfully!', 'success');
  } catch (e) {
    showToast('Error exporting data: ' + e.message, 'error');
  }
}

function _importBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data = JSON.parse(e.target.result);
      showConfirm('⚠️ จะ overwrite ข้อมูลทั้งหมด — แน่ใจ?', async () => {
        await importAllData(data);
        showToast('Backup imported!', 'success');
        setTimeout(() => location.reload(), 1000);
      });
    } catch (err) {
      showToast('Error parsing backup file: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function _saveApiKey() {
  const fhKey = document.getElementById('input-api-key')?.value.trim()        || '';
  const tdKey = document.getElementById('input-twelvedata-key')?.value.trim() || '';
  if (fhKey) localStorage.setItem('finnhubApiKey',    fhKey); else localStorage.removeItem('finnhubApiKey');
  if (tdKey) localStorage.setItem('twelvedataApiKey', tdKey); else localStorage.removeItem('twelvedataApiKey');
  const saved = [fhKey && 'Finnhub', tdKey && 'Twelve Data'].filter(Boolean).join(' + ');
  showToast(saved ? `${saved} key saved!` : 'API Keys cleared.', saved ? 'success' : 'info');
  if (tdKey) updateMarketRegime();
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initDB();
  } catch (e) {
    console.error('DB init failed:', e);
  }

  // Populate stored API keys into settings inputs
  const apiEl = document.getElementById('input-api-key');
  const tdEl  = document.getElementById('input-twelvedata-key');
  if (apiEl) apiEl.value = localStorage.getItem('finnhubApiKey')    || '';
  if (tdEl)  tdEl.value  = localStorage.getItem('twelvedataApiKey') || '';

  // Populate Order TTL setting
  const savedTTL = localStorage.getItem('order_ttl_hours') || '72';
  const ttlEl    = document.getElementById('order-ttl-hours');
  if (ttlEl) ttlEl.value = savedTTL;
  _updateTTLDaysLabel(parseInt(savedTTL));

  // ── Trader Risk Calculator ──
  ['calc-account-size', 'calc-risk-pct', 'calc-entry-price', 'calc-stop-loss', 'calc-target-price']
    .forEach(id => document.getElementById(id)?.addEventListener('input', updateRiskCalc));
  document.getElementById('calc-frac')?.addEventListener('change', updateRiskCalc);

  // ── VI Position Sizing — load saved settings into all inputs ──
  const savedAllocPct = localStorage.getItem('vi_alloc_pct') || '10';
  const savedFrac     = localStorage.getItem('vi_frac') === 'true';

  // Sync to both hidden (Risk/Port page) and visible (Settings modal) inputs
  const _syncVIInputs = (pct, frac) => {
    ['vi-alloc-pct', 'vi-alloc-pct-settings'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = pct;
    });
    ['vi-frac', 'vi-frac-settings'].forEach(id => {
      const el = document.getElementById(id); if (el) el.checked = frac;
    });
    // Update preview in settings modal
    const preview = document.getElementById('vi-alloc-preview');
    if (preview && state.viPortfolio) {
      preview.textContent = '$' + Math.round(state.viPortfolio.capital * (parseFloat(pct) / 100)).toLocaleString();
    }
  };
  _syncVIInputs(savedAllocPct, savedFrac);

  // Hidden inputs trigger updateVIRiskCalc
  document.getElementById('vi-alloc-pct')?.addEventListener('input', updateVIRiskCalc);
  document.getElementById('vi-frac')?.addEventListener('change', updateVIRiskCalc);
  ['vi-mos-fair', 'vi-mos-price']
    .forEach(id => document.getElementById(id)?.addEventListener('input', updateVIRiskCalc));

  // Settings modal inputs also update preview
  document.getElementById('vi-alloc-pct-settings')?.addEventListener('input', e => {
    const preview = document.getElementById('vi-alloc-preview');
    if (preview && state.viPortfolio) {
      preview.textContent = '$' + Math.round(state.viPortfolio.capital * (parseFloat(e.target.value) / 100)).toLocaleString();
    }
  });

  // ── Cross-module refresh events ──
  document.addEventListener('riskfirst:refresh',      () => loadDashboard());
  document.addEventListener('riskfirst:vi-activated', () => renderReallocation());
  document.addEventListener('vi-risk-shown',          () => updateVIRiskCalc());
  document.addEventListener('riskfirst:watch-shown',  () => {
    const type = document.body.classList.contains('vi-mode') ? 'vi' : 'trader';
    loadWatchlist(type);
  });

  // Auto-refresh when returning to the app from background (iOS/Mobile Safari PWA sync)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadDashboard();
      loadWatchlist('trader');
      loadWatchlist('vi');
    }
  });

  // Restore state when coming back from bfcache (e.g. after visiting guide.html in same window)
  // pageshow fires with e.persisted=true when browser restores page from back-forward cache
  // — visibilitychange alone won't fire in this case on some iOS/Safari versions
  window.addEventListener('pageshow', e => {
    if (e.persisted) {
      loadDashboard();
      loadWatchlist('trader');
      loadWatchlist('vi');
    }
  });

  // ── Initial load ──
  await loadDashboard();
  loadWatchlist('trader');
  loadWatchlist('vi');
  // BUG-L1: render cached regime immediately so banner never stays "Loading..."
  const cachedRegime = JSON.parse(localStorage.getItem('regimeCache') || 'null');
  if (cachedRegime) renderRegimeBanner(cachedRegime);
  updateMarketRegime();

  // ── Order TTL: auto-expire open Trader orders older than configured hours ──
  try {
    const { getJournalEntries, updateJournalEntry } = await import('./db.js');
    const allEntries  = await getJournalEntries('trader');
    const ttlHours    = parseInt(localStorage.getItem('order_ttl_hours')) || 72;
    const TTL_MS      = ttlHours * 60 * 60 * 1000;
    const stale       = allEntries.filter(t =>
      t.status === 'open' && t.strategy !== 'pyramid' && (Date.now() - t.createdAt) > TTL_MS
    );
    if (stale.length) {
      await Promise.all(stale.map(t => updateJournalEntry(t.id, { status: 'expired' })));
      const days = ttlHours % 24 === 0 ? `${ttlHours / 24} วัน` : `${ttlHours} ชม.`;
      showToast(
        `⚠️ ${stale.length} คำสั่งซื้อค้างเกิน ${days} → ตั้งเป็น Expired แล้ว — ตรวจสอบและยกเลิก order ที่ broker ด้วย`,
        'warning'
      );
      await loadDashboard();
    }
  } catch (e) { console.warn('Order TTL check failed:', e); }
});

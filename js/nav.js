// nav.js — Module switcher, tab navigation, and overlay modals

import { state } from './state.js';
import { showToast } from './ui.js';

const ALL_TABS = [
  'trader-scan', 'trader-watch', 'trader-risk', 'trader-journal',
  'vi-scan',     'vi-watch',     'vi-risk',     'vi-journal',
];
const NAV_IDS = ['nav-scan', 'nav-watch', 'nav-risk', 'nav-journal'];

export function switchTab(baseTabId) {
  const isVI   = document.body.classList.contains('vi-mode');
  const fullId = (isVI ? 'vi-' : 'trader-') + baseTabId;

  ALL_TABS.forEach(id => document.getElementById(id)?.classList.remove('active'));
  NAV_IDS.forEach(id => document.getElementById(id)?.classList.remove('active'));

  document.getElementById(fullId)?.classList.add('active');
  document.getElementById('nav-' + baseTabId)?.classList.add('active');

  // Risk/Port tab: sync portfolio capital into calculator inputs
  if (baseTabId === 'risk') {
    document.dispatchEvent(new Event('riskfirst:refresh')); // updates calc-account-size + PORT bar
    if (isVI) document.dispatchEvent(new Event('vi-risk-shown'));
  }
  // Refresh journal on every tab switch to ensure fresh data
  if (baseTabId === 'journal') {
    document.dispatchEvent(new Event('riskfirst:refresh'));
  }
  // Reload watchlist on every tab switch (handles back-navigation reload edge case)
  if (baseTabId === 'watch') {
    document.dispatchEvent(new Event('riskfirst:watch-shown'));
  }
}

export function switchTraderTab(tabId) {
  switchTab(tabId.replace('trader-', '').replace('vi-', ''));
}

export function switchModule(module) {
  const isVI   = module === 'vi';
  const trader = document.getElementById('module-trader');
  const vi     = document.getElementById('module-vi');
  const logo   = document.getElementById('logo-icon');

  document.getElementById('btn-trader')?.classList.toggle('active', !isVI);
  document.getElementById('btn-vi')?.classList.toggle('active', isVI);
  document.body.classList.toggle('vi-mode', isVI);

  trader.style.cssText = isVI ? 'display:none !important'  : 'display:block !important';
  vi.style.cssText     = isVI ? 'display:block !important' : 'display:none !important';

  logo.className = isVI
    ? 'w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-sm font-bold shadow-lg'
    : 'w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white text-sm font-bold shadow-lg';

  document.getElementById('btn-port-trader')?.classList.toggle('hidden', isVI);
  document.getElementById('btn-port-vi')?.classList.toggle('hidden', !isVI);

  if (isVI) document.dispatchEvent(new Event('riskfirst:vi-activated'));

  // Re-apply whichever tab is currently active in the bottom nav
  const activeNav = document.querySelector('.nav-item.active');
  const activeBase = activeNav ? activeNav.id.replace('nav-', '') : 'scan';
  switchTab(activeBase);
}

// ─── Global Logic Modal (ℹ️ Settings + How-it-works) ─────────────────────────

export function openGlobalLogicModal() {
  const modal = document.getElementById('global-logic-modal');
  const sheet = document.getElementById('global-logic-sheet');
  modal.classList.remove('hidden');
  setTimeout(() => {
    modal.classList.remove('opacity-0');
    sheet.classList.remove('translate-y-full');
  }, 10);
}

export function closeGlobalLogicModal() {
  const modal = document.getElementById('global-logic-modal');
  const sheet = document.getElementById('global-logic-sheet');
  modal.classList.add('opacity-0');
  sheet.classList.add('translate-y-full');
  setTimeout(() => modal.classList.add('hidden'), 300);
}

// ─── Stock Inspect Modal ──────────────────────────────────────────────────────

export function openStockLogicModal(symbol, type) {
  const modal   = document.getElementById('stock-logic-modal');
  const sheet   = document.getElementById('stock-logic-sheet');
  const content = document.getElementById('inspect-content');

  document.getElementById('inspect-title').innerText    = `${symbol} Logic`;
  document.getElementById('inspect-subtitle').innerText = type === 'trader' ? 'SEPA Template Checklist' : 'Fundamentals Scorecard';

  if (type === 'trader') {
    content.innerHTML = `
      <div class="bg-[var(--bg-dark)] border border-[var(--border-dark)] rounded-xl p-4">
        <div class="flex justify-between items-center mb-3 pb-2 border-b border-white/5">
          <span class="font-bold">SEPA Score</span><span class="text-green-400 font-bold text-lg">8/8</span>
        </div>
        <ul class="text-sm space-y-3">
          <li class="flex items-start gap-2"><span class="text-green-400">✅</span><span>1. ราคา > MA150 & MA200</span></li>
          <li class="flex items-start gap-2"><span class="text-green-400">✅</span><span>2. MA150 > MA200</span></li>
          <li class="flex items-start gap-2"><span class="text-green-400">✅</span><span>3. MA200 ขาขึ้นมา 1 เดือน</span></li>
          <li class="flex items-start gap-2"><span class="text-green-400">✅</span><span>4. MA50 > MA150 & MA200</span></li>
          <li class="flex items-start gap-2"><span class="text-green-400">✅</span><span>5. ราคา > MA50</span></li>
          <li class="flex items-start gap-2"><span class="text-green-400">✅</span><span>6. > Low 52w อย่างน้อย 30%</span></li>
          <li class="flex items-start gap-2"><span class="text-green-400">✅</span><span>7. < High 52w ไม่เกิน 25%</span></li>
          <li class="flex items-start gap-2"><span class="text-green-400">✅</span><span>8. RS Rating ≥ 70</span></li>
        </ul>
      </div>
      <button onclick="copyPrompt('${symbol}', 'trader')"
              class="w-full mt-4 bg-blue-500/20 hover:bg-blue-500/40 text-blue-300 text-sm font-bold py-3 rounded-xl transition-colors border border-blue-500/30 flex items-center justify-center gap-2">
        <span>📋</span> คัดลอกข้อมูลไปถาม AI
      </button>`;
  } else {
    content.innerHTML = `
      <div class="bg-[var(--bg-dark)] border border-[var(--border-dark)] rounded-xl p-4">
        <div class="flex justify-between items-center mb-3 pb-2 border-b border-black/5">
          <span class="font-bold text-blue-600">Piotroski F-Score</span><span class="text-blue-600 font-bold text-lg">8/9</span>
        </div>
        <ul class="text-sm space-y-2">
          <li class="flex items-start gap-2"><span class="text-green-500">✅</span><span>ROA > 0</span></li>
          <li class="flex items-start gap-2"><span class="text-green-500">✅</span><span>Operating Cash Flow > 0</span></li>
          <li class="flex items-start gap-2"><span class="text-green-500">✅</span><span>ROA โตกว่าปีก่อน</span></li>
          <li class="flex items-start gap-2"><span class="text-green-500">✅</span><span>OCF > Net Income</span></li>
          <li class="flex items-start gap-2"><span class="text-red-500">❌</span><span class="text-gray-400">LT Debt Ratio ลดลง</span></li>
          <li class="flex items-start gap-2"><span class="text-green-500">✅</span><span>Current Ratio เพิ่มขึ้น</span></li>
          <li class="flex items-start gap-2"><span class="text-green-500">✅</span><span>ไม่ออกหุ้นใหม่เพิ่ม</span></li>
          <li class="flex items-start gap-2"><span class="text-green-500">✅</span><span>Gross Margin เพิ่มขึ้น</span></li>
          <li class="flex items-start gap-2"><span class="text-green-500">✅</span><span>Asset Turnover เพิ่มขึ้น</span></li>
        </ul>
      </div>
      <button onclick="copyPrompt('${symbol}', 'vi')"
              class="w-full mt-4 bg-blue-100 hover:bg-blue-200 text-blue-700 text-sm font-bold py-3 rounded-xl transition-colors border border-blue-300 flex items-center justify-center gap-2">
        <span>📋</span> คัดลอกข้อมูลไปถาม AI
      </button>`;
  }

  modal.classList.remove('hidden');
  setTimeout(() => {
    modal.classList.remove('opacity-0');
    sheet.classList.remove('translate-y-full');
  }, 10);
}

export function closeStockLogicModal() {
  const modal = document.getElementById('stock-logic-modal');
  const sheet = document.getElementById('stock-logic-sheet');
  modal.classList.add('opacity-0');
  sheet.classList.add('translate-y-full');
  setTimeout(() => modal.classList.add('hidden'), 300);
}

export function copyPrompt(symbol, type) {
  const text = type === 'trader'
    ? `ช่วยวิเคราะห์หุ้น ${symbol} ให้หน่อยครับ ผ่านเงื่อนไข SEPA ของ Minervini ครบ 8/8 ข้อ ช่วยวิเคราะห์กราฟเทคนิคและ momentum ว่าควรเข้าซื้อที่จุดไหนและวาง Stop loss ที่ใด?`
    : `ช่วยวิเคราะห์พื้นฐานหุ้น ${symbol} ให้หน่อยครับ สอบผ่าน Piotroski F-Score 8/9 มองว่าหุ้นตัวนี้มี Moat แข็งแกร่งพอที่จะถือยาวไหมครับ?`;
  navigator.clipboard.writeText(text).then(() => showToast('คัดลอกแล้ว ✅ นำไป Paste ใน AI ได้เลย', 'success'));
}

// ─── Initialise on first load ─────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('module-trader').style.display = 'block';
  document.getElementById('module-vi').style.display     = 'none';
});

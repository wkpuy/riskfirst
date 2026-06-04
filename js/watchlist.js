// watchlist.js — Trader + VI watchlist UI and DB operations

import { addWatchlistDB, getWatchlistDB, removeWatchlistDB } from './db.js';
import { showToast } from './ui.js';

export async function loadWatchlist(type = 'trader') {
  const wl     = await getWatchlistDB(type);
  const listEl = document.getElementById(type === 'vi' ? 'vi-watch-list' : 'watch-list');
  if (!listEl) return;

  if (wl.length === 0) {
    listEl.innerHTML = `
      <div class="text-center py-12 px-4 bg-[var(--card-dark)] border border-[var(--border-dark)] rounded-3xl mt-4">
        <div class="text-5xl mb-3">🔭</div>
        <h3 class="text-lg font-bold ${type === 'trader' ? 'text-white' : 'text-gray-800'} mb-1">Watchlist Empty</h3>
        <p class="text-sm text-gray-400">Add symbols above to track potential setups.</p>
      </div>`;
    return;
  }

  listEl.innerHTML = '';
  wl.sort((a, b) => b.addedAt - a.addedAt).forEach(item => {
    const isVI   = type === 'vi';
    const scanFn = isVI
      ? `document.getElementById('vi-scan-input').value='${item.symbol}'; switchTab('scan'); scanVI()`
      : `document.getElementById('trader-scan-input').value='${item.symbol}'; switchTab('scan'); scanStock()`;
    const badge  = isVI
      ? 'text-[10px] px-2 py-0.5 rounded-full font-bold bg-blue-100 text-blue-600'
      : 'pill bg-yellow-900/40 text-yellow-400 border border-yellow-500/20 text-[10px] px-2';

    listEl.innerHTML += `
      <div class="bg-[var(--card-dark)] border border-[var(--border-dark)] rounded-xl p-4 flex justify-between items-center
                  relative overflow-hidden cursor-pointer hover:border-[var(--accent-primary)] transition-colors active:opacity-70"
           onclick="${scanFn}">
        <div class="flex items-center gap-3 relative z-10">
          <div class="font-black text-xl tracking-tight">${item.symbol}</div>
          <span class="${badge}">Tap to Scan</span>
        </div>
        <button onclick="event.stopPropagation(); removeWatchlist('${item.symbol}', '${type}')"
                class="w-8 h-8 rounded-full bg-red-500/10 hover:bg-red-500/20 flex items-center justify-center
                       text-red-400 font-bold transition-colors relative z-10">✕</button>
      </div>`;
  });
}

export async function addWatchlist(type = 'trader') {
  const inputId = type === 'vi' ? 'vi-watch-input' : 'watch-input';
  const input   = document.getElementById(inputId);
  const raw     = input?.value.trim().toUpperCase();
  if (!raw) return;

  const symbols = raw.split(/[\s,;\n\t]+/).map(s => s.trim()).filter(s => /^[A-Z.]{1,10}$/.test(s));
  if (!symbols.length) { showToast('ไม่พบ ticker ที่ถูกต้อง', 'error'); return; }

  for (const sym of symbols) await addWatchlistDB(sym, type);
  if (input) input.value = '';

  loadWatchlist(type);
  showToast(
    symbols.length > 1
      ? `เพิ่ม ${symbols.length} หุ้นแล้ว: ${symbols.join(', ')}`
      : `เพิ่ม ${symbols[0]} แล้ว`,
    'success'
  );
}

export async function removeWatchlist(symbol, type = 'trader') {
  await removeWatchlistDB(symbol, type);
  loadWatchlist(type);
}

export async function addWatchlistDirect(symbol, type = 'trader') {
  if (!symbol) return;
  await addWatchlistDB(symbol, type);
  loadWatchlist(type);
  showToast(`เพิ่ม ${symbol} ใน Watchlist แล้ว`, 'success');
}

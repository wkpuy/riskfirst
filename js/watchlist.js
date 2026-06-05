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

  const BADGE_TTL = 6 * 60 * 60 * 1000; // 6h — same as candle cache

  listEl.innerHTML = '';
  wl.sort((a, b) => b.addedAt - a.addedAt).forEach(item => {
    const isVI   = type === 'vi';
    const scanFn = isVI
      ? `document.getElementById('vi-scan-input').value='${item.symbol}'; switchTab('scan'); scanVI()`
      : `document.getElementById('trader-scan-input').value='${item.symbol}'; switchTab('scan'); scanStock()`;

    // ── Scan badge (Trader only) ──
    let badgeHtml = `<span class="pill bg-yellow-900/40 text-yellow-400 border border-yellow-500/20 text-[10px] px-2">Tap to Scan</span>`;
    if (!isVI) {
      try {
        const raw = localStorage.getItem(`wl_badge_${item.symbol}`);
        if (raw) {
          const b     = JSON.parse(raw);
          const age   = Date.now() - b.ts;
          const stale = age > BADGE_TTL;
          const scoreColor = b.qualifies ? '#22c55e' : b.sepa >= 6 ? '#eab308' : '#f87171';
          const sepaColor  = b.qualifies ? '#22c55e' : b.sepa >= 6 ? '#eab308' : '#f87171';
          const opacity    = stale ? 'opacity-60' : '';
          const staleTag   = stale ? '<span class="text-gray-500 text-[9px] ml-1">เก่า</span>' : '';
          const hrsAgo     = Math.round(age / 36e5);
          const timeLabel  = hrsAgo < 1 ? 'เมื่อกี้' : hrsAgo < 24 ? `${hrsAgo}ชม.ที่แล้ว` : `${Math.round(hrsAgo/24)}วันที่แล้ว`;
          badgeHtml = `
            <div class="flex flex-col gap-0.5 ${opacity}">
              <div class="flex items-center gap-1.5">
                <span class="text-[11px] font-black" style="color:${scoreColor}">
                  ${b.qualifies ? '✅' : ''} SEPA <span style="color:${sepaColor}">${b.sepa}/8</span>
                </span>
                <span class="text-[10px] text-gray-400">RS ${b.rs}</span>
                <span class="text-[10px] font-bold" style="color:${scoreColor}">${b.score.toFixed(0)}pts</span>
                ${staleTag}
              </div>
              <div class="text-[9px] text-gray-500">${timeLabel}</div>
            </div>`;
        }
      } catch {}
    } else {
      // VI badge
      try {
        const raw = localStorage.getItem(`vi_badge_${item.symbol}`);
        if (raw) {
          const b     = JSON.parse(raw);
          const age   = Date.now() - b.ts;
          const stale = age > BADGE_TTL;
          const vc    = { 'STRONG BUY':'#15803d','BUY':'#1d4ed8','WATCH':'#92400e' }[b.verdict] ?? '#b91c1c';
          const vb    = { 'STRONG BUY':'#dcfce7','BUY':'#dbeafe','WATCH':'#fef3c7' }[b.verdict] ?? '#fee2e2';
          const vi    = { 'STRONG BUY':'💎','BUY':'✅','WATCH':'👀' }[b.verdict] ?? '🚫';
          const opacity   = stale ? 'opacity-60' : '';
          const staleTag  = stale ? '<span class="text-gray-400 text-[9px] ml-1">เก่า</span>' : '';
          const hrsAgo    = Math.round(age / 36e5);
          const timeLabel = hrsAgo < 1 ? 'เมื่อกี้' : hrsAgo < 24 ? `${hrsAgo}ชม.ที่แล้ว` : `${Math.round(hrsAgo/24)}วันที่แล้ว`;
          badgeHtml = `
            <div class="flex flex-col gap-0.5 ${opacity}">
              <div class="flex items-center gap-1.5">
                <span class="text-[11px] font-black" style="color:${vc}">${vi} ${b.viScore}/10</span>
                <span class="text-[10px] font-bold px-1.5 py-0.5 rounded" style="background:${vb};color:${vc}">${b.verdict}</span>
                ${staleTag}
              </div>
              <div class="text-[9px] text-gray-400">${timeLabel}${b.price ? ` · $${b.price.toFixed(2)}` : ''}</div>
            </div>`;
        } else {
          badgeHtml = `<span class="text-[10px] px-2 py-0.5 rounded-full font-bold bg-blue-100 text-blue-600">Tap to Scan</span>`;
        }
      } catch {
        badgeHtml = `<span class="text-[10px] px-2 py-0.5 rounded-full font-bold bg-blue-100 text-blue-600">Tap to Scan</span>`;
      }
    }

    listEl.innerHTML += `
      <div class="bg-[var(--card-dark)] border border-[var(--border-dark)] rounded-xl p-3 flex justify-between items-center
                  relative overflow-hidden cursor-pointer hover:border-[var(--accent-primary)] transition-colors active:opacity-70"
           onclick="${scanFn}">
        <div class="flex items-center gap-3 relative z-10 min-w-0">
          <div class="font-black text-xl tracking-tight shrink-0">${item.symbol}</div>
          ${badgeHtml}
        </div>
        <button onclick="event.stopPropagation(); removeWatchlist('${item.symbol}', '${type}')"
                class="w-8 h-8 rounded-full bg-red-500/10 hover:bg-red-500/20 flex items-center justify-center
                       text-red-400 font-bold transition-colors relative z-10 shrink-0">✕</button>
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

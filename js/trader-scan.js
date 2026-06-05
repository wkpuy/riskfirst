// trader-scan.js — Trader scan (single + scan all watchlist)

import { fetchQuote, fetchProfile, fetchFinnhubCandles, fetchTDCandles, fetchEarnings, fetchEarningsCalendar, fetchRecentNews } from './api.js';
import { getCached } from './cache.js';
import { CACHE_TTL, ATR_MULTIPLIER, ATR_MULTIPLIER_WIDE, POST_EARNINGS_DAYS } from './config.js';
import { calcMA, calcATR, calcRSRating, calcWeightedReturn } from './indicators.js';
import { checkSEPA } from './rules.js';
import { state } from './state.js';
import { showToast } from './ui.js';
import { switchTab } from './nav.js';

// ─── Public: scan single stock ────────────────────────────────────────────────

export async function scanStock() {
  const apiKey = localStorage.getItem('finnhubApiKey');
  if (!apiKey) {
    showToast('กรุณาใส่ Finnhub API Key ใน ℹ️ ก่อน', 'warning');
    if (typeof openGlobalLogicModal === 'function') openGlobalLogicModal();
    return;
  }

  const symbol = document.getElementById('trader-scan-input')?.value.trim().toUpperCase();
  if (!symbol) { showToast('กรุณาพิมพ์ ticker ก่อน', 'warning'); return; }

  const area = document.getElementById('scan-result-area');
  area.innerHTML = `<div class="card py-10 text-center"><p class="text-gray-400 text-sm animate-pulse">กำลังดึงข้อมูล <b class="text-white">${symbol}</b>...</p></div>`;

  try {
    const [quote, profile] = await Promise.all([
      fetchQuote(symbol, apiKey),
      fetchProfile(symbol, apiKey),
    ]);

    if (quote.error) {
      area.innerHTML = `<div class="card text-center py-8"><div class="text-4xl mb-2">🔑</div><p class="text-gray-400 text-sm">API Key ไม่ถูกต้อง<br><span class="text-xs text-red-400">${quote.error}</span></p></div>`;
      return;
    }
    if (!quote.c) {
      area.innerHTML = `<div class="card text-center py-8"><div class="text-4xl mb-2">❌</div><p class="text-gray-400 text-sm mb-2">ไม่พบ <b class="text-white">${symbol}</b></p><p class="text-xs text-yellow-400">ต้องใช้ Ticker Symbol เช่น NVDA, AAPL, MSFT</p></div>`;
      return;
    }

    // ── Candles: Finnhub → Twelve Data fallback ──
    let candles = await fetchFinnhubCandles(symbol, apiKey);

    if (!candles) {
      const tdKey = localStorage.getItem('twelvedataApiKey');
      if (tdKey) candles = await fetchTDCandles(symbol, tdKey);
    }

    if (!candles) {
      const chColor = quote.d >= 0 ? 'text-green-400' : 'text-red-400';
      const chSign  = quote.d >= 0 ? '+' : '';
      area.innerHTML = `
        <div class="card">
          <div class="flex justify-between items-start mb-4">
            <div><h2 class="text-3xl font-extrabold tracking-tight mb-1">${symbol}</h2><span class="text-xs text-gray-400">${profile.name || symbol}</span></div>
            <div class="text-right"><div class="text-2xl font-bold">$${quote.c.toFixed(2)}</div><div class="text-sm font-semibold ${chColor}">${chSign}${(quote.d||0).toFixed(2)} (${chSign}${(quote.dp||0).toFixed(2)}%)</div></div>
          </div>
          <div class="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 text-xs text-yellow-400">
            ⚠️ ข้อมูล Historical Candle ไม่พร้อมใช้งาน (ต้องการ Twelve Data API Key)<br>ไม่สามารถคำนวณ MA / SEPA / ATR ได้ — แสดงเฉพาะราคาปัจจุบัน
          </div>
          <button onclick="applyToRiskCalc('${symbol}', ${quote.c.toFixed(2)}, 0, 0, 1.0)" class="w-full btn-primary mt-4">⚡ ใช้ราคานี้ใน Risk Calculator</button>
        </div>`;
      return;
    }

    const data = _computeIndicators(quote, candles, symbol);
    const earningsInfo = await _fetchEarningsInfo(symbol, apiKey);
    const recentNews   = await fetchRecentNews(symbol, apiKey);

    _renderScanCard(area, { symbol, profile, earningsInfo, recentNews, ...data });
    _saveScanBadge(symbol, data.sepaResult.score, data.rsRating, data.compScore, data.sepaResult.qualifies);

    state.lastScanData  = { symbol, entry: data.price, stop: data.atrStop, target: Math.round((data.price + (data.price - data.atrStop) * 2) * 100) / 100, shares: null };
    state.lastTargetLabel = '2R';

  } catch (e) {
    area.innerHTML = `<div class="card text-center py-8"><p class="text-red-400 text-sm">Error: ${e.message}</p></div>`;
  }
}

// ─── Scan badge cache (localStorage) ─────────────────────────────────────────

function _saveScanBadge(symbol, sepa, rs, score, qualifies) {
  try {
    localStorage.setItem(`wl_badge_${symbol}`, JSON.stringify({ sepa, rs, score, qualifies, ts: Date.now() }));
  } catch {}
}

// ─── Public: scan all watchlist ───────────────────────────────────────────────

export async function scanAllWatchlist() {
  const apiKey = localStorage.getItem('finnhubApiKey');
  const tdKey  = localStorage.getItem('twelvedataApiKey');
  if (!apiKey) { showToast('กรุณาใส่ Finnhub API Key ก่อน', 'warning'); return; }
  if (!tdKey)  { showToast('กรุณาใส่ Twelve Data API Key ก่อน', 'warning'); return; }

  const { getWatchlistDB } = await import('./db.js');
  const wl = await getWatchlistDB('trader');
  if (!wl.length) { showToast('Watchlist ว่างเปล่า', 'warning'); return; }

  const watchEl = document.getElementById('watch-list');
  const symbols = wl.map(i => i.symbol);
  const total   = symbols.length;

  const showProgress = (done, cached, apiCalls, msg = '') => {
    watchEl.innerHTML = `
      <div class="card py-6 text-center">
        <p class="text-sm font-bold text-white mb-2">${msg || `กำลัง Scan ${done}/${total} หุ้น...`}</p>
        <div class="w-full bg-white/10 rounded-full h-2 mb-2">
          <div class="bg-purple-500 h-2 rounded-full transition-all" style="width:${Math.round(done / total * 100)}%"></div>
        </div>
        <p class="text-[10px] text-gray-500">💾 Cache: ${cached} · 🌐 API: ${apiCalls}</p>
      </div>`;
  };

  showProgress(0, 0, 0);

  // ── Step 1: Finnhub quote + profile (parallel) ──
  const fhData = {};
  await Promise.all(symbols.map(async sym => {
    try {
      const [quote, profile] = await Promise.all([
        fetchQuote(sym, apiKey),
        fetchProfile(sym, apiKey),
      ]);
      fhData[sym] = { quote, profile };
    } catch { fhData[sym] = {}; }
  }));

  // ── Step 2: Twelve Data candles — cache first, batch API requests ──
  const needTD   = symbols.filter(sym => !getCached(`tdC_${sym}`, CACHE_TTL.candles));
  const cachedTD = total - needTD.length;
  const BATCH    = 8; // Twelve Data free: 8 req/min
  let apiCalls   = 0;

  showProgress(cachedTD, cachedTD, 0,
    needTD.length > 0
      ? `Finnhub ✅ | ต้องดึง TD ${needTD.length} หุ้น (cache ${cachedTD}/${total})`
      : `Finnhub ✅ | ทุกหุ้นใช้ cache 🚀`);

  for (let i = 0; i < needTD.length; i += BATCH) {
    const batch = needTD.slice(i, i + BATCH);

    if (i > 0) {
      for (let s = 62; s > 0; s--) {
        showProgress(cachedTD + i, cachedTD, apiCalls, `รอ rate limit... ${s}s | batch ${Math.ceil(i / BATCH) + 1}/${Math.ceil(needTD.length / BATCH)}`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    await Promise.all(batch.map(async sym => {
      try { await fetchTDCandles(sym, tdKey); apiCalls++; } catch {}
    }));
    showProgress(cachedTD + i + batch.length, cachedTD, apiCalls);
  }

  // ── Step 3: compute SEPA + composite score ──
  const results = symbols.map(sym => {
    const { quote, profile } = fhData[sym] || {};
    if (!quote?.c || quote.c === 0) return { symbol: sym, error: true };

    const candles = getCached(`tdC_${sym}`, CACHE_TTL.candles);
    if (!candles?.c) return { symbol: sym, name: profile?.name, price: quote.c, error: true };

    const { sepa, rs, score, qualifies, rawReturn } = _calcComposite(candles, quote.c);
    return { symbol: sym, name: profile?.name, price: quote.c, sepa, rs, score, qualifies, rawReturn };
  });

  // ── True cross-sectional RS percentile rank within scanned universe ──
  const valid = results.filter(r => !r.error && r.rawReturn != null);
  if (valid.length >= 2) {
    valid.sort((a, b) => a.rawReturn - b.rawReturn); // ascending → index 0 = weakest
    valid.forEach((r, i) => {
      const trueRS = Math.round((i / (valid.length - 1)) * 98) + 1; // 1–99
      // Adjust composite score: swap out old RS portion for true RS portion
      const oldRSPortion  = (r.rs / 99) * 40;
      const trueRSPortion = (trueRS / 99) * 40;
      r.score = Math.max(0, r.score - oldRSPortion + trueRSPortion);
      r.rs    = trueRS;
    });
  }
  // Save badges with true RS after ranking is complete
  results.forEach(r => {
    if (!r.error) _saveScanBadge(r.symbol, r.sepa, r.rs, r.score, r.qualifies);
  });

  results.sort((a, b) => (b.score || 0) - (a.score || 0));

  watchEl.innerHTML = `
    <div class="flex justify-between items-center mb-3 px-1">
      <span class="text-xs font-bold text-gray-400 uppercase tracking-wider">Top Picks — Ranked by Score</span>
      <div class="flex gap-3 items-center">
        <button onclick="scanAllWatchlist()" class="text-xs text-purple-400 font-bold underline">Scan Again</button>
        <button onclick="loadWatchlist('trader')" class="text-xs text-gray-400 underline">Reset View</button>
      </div>
    </div>` +
    results.map((r, i) => {
      if (r.error) return `
        <div class="bg-[var(--card-dark)] border border-[var(--border-dark)] rounded-xl p-4 flex justify-between items-center opacity-50">
          <span class="font-black text-lg">${r.symbol}</span>
          <span class="text-xs text-red-400">ดึงข้อมูลไม่ได้</span>
        </div>`;
      const medal   = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
      const sepaCol = r.sepa >= 7 ? 'text-green-400' : r.sepa >= 5 ? 'text-yellow-400' : 'text-red-400';
      const badge   = r.qualifies ? '<span class="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full font-bold">SEPA ✓</span>' : '';
      return `
        <div class="bg-[var(--card-dark)] border border-[var(--border-dark)] rounded-xl p-4 cursor-pointer hover:border-purple-500/50 transition-colors"
             onclick="document.getElementById('trader-scan-input').value='${r.symbol}'; switchTraderTab('trader-scan'); scanStock()">
          <div class="flex justify-between items-center">
            <div class="flex items-center gap-2">
              <span class="text-lg">${medal}</span>
              <div><div class="font-black text-xl tracking-tight">${r.symbol}</div><div class="text-[10px] text-gray-400">${r.name || ''}</div></div>
              ${badge}
            </div>
            <div class="text-right">
              <div class="font-bold text-lg">$${r.price.toFixed(2)}</div>
              <div class="text-xs text-purple-400 font-bold">Score ${r.score.toFixed(1)}</div>
            </div>
          </div>
          <div class="flex gap-3 mt-2 text-xs">
            <span class="text-gray-400">SEPA <span class="${sepaCol} font-bold">${r.sepa}/8</span></span>
            <span class="text-gray-400">RS <span class="text-blue-400 font-bold">${r.rs}</span></span>
          </div>
        </div>`;
    }).join('');
}

// ─── Public: target selector ──────────────────────────────────────────────────

export function selectTarget(label, targetValue, symbol, entry, stop) {
  state.lastTargetLabel = label;

  document.querySelectorAll('[data-target]').forEach(el => {
    el.classList.remove('ring-2', 'ring-purple-500', 'ring-inset');
    el.style.opacity = '0.6';
  });
  const sel = document.querySelector(`[data-target="${label}"]`);
  if (sel) { sel.classList.add('ring-2', 'ring-purple-500', 'ring-inset'); sel.style.opacity = '1'; }

  const btn = document.getElementById('scan-calc-btn');
  if (btn) {
    btn.setAttribute('onclick', `applyToRiskCalc('${symbol}', ${entry}, ${stop}, ${targetValue}, 1.0)`);
    btn.innerHTML = `⚡ คำนวณ Risk — Stop $${parseFloat(stop).toFixed(2)} / ${label} $${parseFloat(targetValue).toFixed(2)}`;
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

const r2 = v => Math.round(v * 100) / 100;

function _computeIndicators(quote, candles, symbol) {
  const { c, h, l, v } = candles;
  const price         = quote.c;
  const change        = price - (quote.pc || price);
  // BUG-H2: guard division by zero for new listings where pc = 0
  const changePct     = quote.pc ? (change / quote.pc) * 100 : (quote.dp ?? 0);
  const spyCloses     = JSON.parse(localStorage.getItem('regimeCache') || 'null')?.spyCloses ?? null;

  const ma50          = r2(calcMA(c, 50));
  const ma150         = r2(calcMA(c, Math.min(150, c.length)));
  const ma200         = r2(calcMA(c, Math.min(200, c.length)));
  const prevSlice     = c.slice(0, -20);
  const ma200_1moAgo  = r2(prevSlice.length >= 50 ? calcMA(prevSlice, Math.min(200, prevSlice.length)) : ma200);
  const high52w       = r2(Math.max(...h));
  const low52w        = r2(Math.min(...l));
  const atr           = r2(calcATR(candles));
  const atrStop       = r2(Math.max(price * 0.01, price - atr * ATR_MULTIPLIER));

  // ── RS Rating: prefer true cross-sectional rank from last Scan All (≤7 days) ──
  // calcRSRating vs SPY alone can't produce a real 1-99 percentile without
  // ranking against a full universe. Use cached rank when available.
  let rsRating, rsSource;
  try {
    const badge = JSON.parse(localStorage.getItem(`wl_badge_${symbol}`) || 'null');
    const age   = badge ? Date.now() - badge.ts : Infinity;
    if (badge?.rs != null && age < 7 * 24 * 60 * 60 * 1000) {
      rsRating = badge.rs;
      rsSource = 'rank'; // true percentile from cross-sectional scan
    } else {
      rsRating = calcRSRating(c, spyCloses);
      rsSource = 'approx'; // relative to SPY only — not a full-market percentile
    }
  } catch {
    rsRating = calcRSRating(c, spyCloses);
    rsSource = 'approx';
  }

  const sepaResult    = checkSEPA({ price, ma50, ma150, ma200, ma200_1moAgo, low52w, high52w, rsRating });
  const proximity     = Math.max(0, Math.min(1, 1 - (high52w - price) / high52w));
  const vol5          = v.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const vol20         = v.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volDry        = Math.max(0, Math.min(1, 1 - vol5 / vol20));
  const compScore     = (rsRating / 99) * 40 + (sepaResult.score / 8) * 25 + proximity * 25 + volDry * 10;

  // BUG-M6: flag insufficient candle data for user warning
  const hasFullData = c.length >= 200;
  return { price, change, changePct, ma50, ma150, ma200, high52w, low52w, atr, atrStop, rsRating, rsSource, sepaResult, compScore, proximity, volDry, hasFullData };
}

function _calcComposite(candles, price) {
  const { c, h, l, v }  = candles;
  const spyCloses        = JSON.parse(localStorage.getItem('regimeCache') || 'null')?.spyCloses ?? null;
  const ma50             = calcMA(c, 50);
  const ma150            = calcMA(c, Math.min(150, c.length));
  const ma200            = calcMA(c, Math.min(200, c.length));
  const prevSlice        = c.slice(0, -20);
  const ma200_1mo        = prevSlice.length >= 50 ? calcMA(prevSlice, Math.min(200, prevSlice.length)) : ma200;
  const high52w          = Math.max(...h);
  const low52w           = Math.min(...l);
  const spyW             = spyCloses ? calcWeightedReturn(spyCloses) : 0;
  const stockW           = calcWeightedReturn(c);
  const rawReturn        = stockW - spyW;  // excess weighted return vs SPY (pre-rank)
  const rsRating         = calcRSRating(c, spyCloses);
  const sepa             = checkSEPA({ price, ma50, ma150, ma200, ma200_1moAgo: ma200_1mo, low52w, high52w, rsRating });
  const proximity        = Math.max(0, Math.min(1, 1 - (high52w - price) / high52w));
  const vols             = v.slice(-20);
  const avgVol           = vols.reduce((a, b) => a + b, 0) / vols.length;
  const recentVol        = vols.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const volDry           = Math.max(0, Math.min(1, 1 - recentVol / avgVol));
  const score            = (rsRating / 99) * 40 + (sepa.score / 8) * 25 + proximity * 25 + volDry * 10;
  return { sepa: sepa.score, rs: rsRating, score, qualifies: sepa.qualifies, rawReturn };
}

async function _fetchEarningsInfo(symbol, apiKey) {
  try {
    const todayMs = new Date().setHours(0,0,0,0);
    
    // 1. Try real calendar first
    const calendar = await fetchEarningsCalendar(symbol, apiKey);
    if (calendar && calendar.length > 0) {
      // Find the upcoming earnings
      const upcoming = calendar.find(e => new Date(e.date).getTime() >= todayMs);
      if (upcoming) {
        const nextEst = new Date(upcoming.date);
        nextEst.setUTCHours(13, 30, 0, 0); // Approximate Market Open (13:30 UTC) for countdown
        const daysUntilNext = Math.round((nextEst.getTime() - todayMs) / (24 * 60 * 60 * 1000));
        return { nextEst, daysUntilNext, daysAgo: -daysUntilNext, isConfirmed: true };
      }
    }

    // 2. Fallback to historical guessing
    const data = await fetchEarnings(symbol, apiKey);
    if (!Array.isArray(data) || !data.length) return null;

    const sorted = [...data]
      .filter(d => d.period)
      .sort((a, b) => new Date(b.period) - new Date(a.period));

    if (!sorted.length) return null;
    const lastDate = new Date(sorted[0].period);

    let avgIntervalMs = 91 * 24 * 60 * 60 * 1000;
    if (sorted.length >= 2) {
      const gaps = [];
      for (let i = 0; i < sorted.length - 1; i++) {
        gaps.push(new Date(sorted[i].period) - new Date(sorted[i + 1].period));
      }
      avgIntervalMs = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      avgIntervalMs = Math.max(60, Math.min(120, Math.round(avgIntervalMs / (24 * 60 * 60 * 1000)))) * 24 * 60 * 60 * 1000;
    }

    const nextEst       = new Date(lastDate.getTime() + avgIntervalMs);
    nextEst.setUTCHours(13, 30, 0, 0);
    const daysUntilNext = Math.round((nextEst.getTime() - todayMs) / (24 * 60 * 60 * 1000));
    return { lastDate, nextEst, daysUntilNext, daysAgo: -daysUntilNext, isConfirmed: false };
  } catch { return null; }
}

function _earningsBanners(earningsInfo, price, atr) {
  if (!earningsInfo) return { earningsBanner: '', atrNote: '', postEarningsBadge: '' };
  const { daysUntilNext, daysAgo, nextEst, isConfirmed } = earningsInfo;
  const dateStr = nextEst.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
  const estTag  = isConfirmed ? 'ยืนยัน' : 'คาดการณ์';

  let earningsBanner = '', atrNote = '', postEarningsBadge = '';

  if (daysUntilNext >= 0 && daysUntilNext <= 3) {
    
    // Calculate hours/minutes if it's less than 2 days
    let timeText = `ใน ${daysUntilNext} วัน`;
    if (daysUntilNext <= 1) {
       const msDiff = nextEst.getTime() - Date.now();
       if (msDiff > 0) {
         const hours = Math.floor(msDiff / (1000 * 60 * 60));
         const mins = Math.floor((msDiff % (1000 * 60 * 60)) / (1000 * 60));
         timeText = `ในอีก ${hours} ชม. ${mins} นาที`;
       } else {
         timeText = `วันนี้!`;
       }
    }
    
    earningsBanner = `
      <div class="flex items-start gap-2 rounded-xl p-3 mb-3 border" style="background:#fee2e2;border-color:#fca5a5">
        <span class="text-xl shrink-0 animate-pulse">🚫</span>
        <div>
          <div class="text-xs font-black text-red-700">Earnings ${timeText} (${dateStr})</div>
          <div class="text-[10px] text-red-600 mt-0.5">ระวัง! ราคาอาจ Gap ได้ 10-20% ทั้งสองทิศทาง แนะนำรอหลังงบออกแล้วค่อยตัดสินใจ</div>
        </div>
      </div>`;
    if (atr) atrNote = `<br><span class="text-yellow-400">ถ้าเข้าตอนนี้ แนะนำ Stop กว้างขึ้น $${(price - atr * ATR_MULTIPLIER_WIDE).toFixed(2)} (${ATR_MULTIPLIER_WIDE}×ATR)</span>`;

  } else if (daysUntilNext > 3 && daysUntilNext <= 14) {
    earningsBanner = `
      <div class="flex items-start gap-2 rounded-xl p-3 mb-3 border" style="background:#fef3c7;border-color:#fcd34d">
        <span class="text-xl shrink-0">⚠️</span>
        <div>
          <div class="text-xs font-black text-yellow-800">ระวัง — คาดงบออกอีก ~${daysUntilNext} วัน (~${dateStr})</div>
          <div class="text-[10px] text-yellow-700 mt-0.5">IV จะเริ่มสูงขึ้น ถ้าเข้าให้ตั้ง Stop กว้างกว่าปกติ</div>
        </div>
      </div>`;
    if (atr) atrNote = `<br><span class="text-yellow-400">ใกล้งบ — แนะนำ Stop $${(price - atr * ATR_MULTIPLIER_WIDE).toFixed(2)} (${ATR_MULTIPLIER_WIDE}×ATR)</span>`;

  } else if (daysAgo >= 3 && daysAgo <= POST_EARNINGS_DAYS) {
    postEarningsBadge = `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full" style="background:#dcfce7;color:#15803d">🎯 Post-Earnings Setup</span>`;
    earningsBanner = `
      <div class="flex items-start gap-2 rounded-xl p-3 mb-3 border" style="background:#dcfce7;border-color:#86efac">
        <span class="text-xl shrink-0">🎯</span>
        <div>
          <div class="text-xs font-black text-green-800">Post-Earnings Window — ${daysAgo} วันหลังงบออก</div>
          <div class="text-[10px] text-green-700 mt-0.5">High-Probability Setup ของ Minervini — ถ้า SEPA ยังครบหลังงบ แสดงว่า setup แข็งแกร่งมาก</div>
        </div>
      </div>`;
  }

  return { earningsBanner, atrNote, postEarningsBadge };
}

function _renderScanCard(container, d) {
  const { symbol, profile, price, change, changePct, sepaResult, rsRating, rsSource, compScore,
          atrStop, ma50, ma150, ma200, high52w, atr, earningsInfo, recentNews, hasFullData } = d;

  const pass    = sepaResult.qualifies;
  const name    = profile?.name || symbol;
  const chColor = change >= 0 ? 'text-green-400' : 'text-red-400';
  const chSign  = change >= 0 ? '+' : '';

  const { earningsBanner, atrNote, postEarningsBadge } = _earningsBanners(earningsInfo, price, atr);
  
  // News Badge
  let newsBadge = '';
  if (recentNews && recentNews.length > 0) {
    // Save to global state so modal can read it
    window.currentStockNews = recentNews;
    newsBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30 cursor-pointer hover:bg-blue-500/30 transition-colors" onclick="openNewsModal()">📰 News (${recentNews.length})</span>`;
  }

  const failedNames = sepaResult.rules.filter(r => !r.passed).map(r => r.name);
  const briefing    = pass
    ? `${symbol} ผ่าน SEPA 8/8 โซน momentum แข็งแกร่ง<br><span class="text-purple-400 font-medium">ATR Stop แนะนำ $${atrStop.toFixed(2)} (${ATR_MULTIPLIER}×ATR)</span>${atrNote}`
    : `${symbol} ผ่าน SEPA ${sepaResult.score}/8 ยังไม่ครบเกณฑ์<br><span class="text-red-400">ยังไม่ผ่าน:</span> ${failedNames.slice(0, 2).join(', ')}${failedNames.length > 2 ? ` +${failedNames.length - 2} more` : ''}${atrNote}`;

  const ruleRows  = sepaResult.rules.map(r => `
    <li class="flex items-center gap-2 py-1.5 border-b border-white/5 last:border-0">
      <span class="shrink-0 ${r.passed ? 'text-green-400' : 'text-red-400'}">${r.passed ? '✅' : '❌'}</span>
      <span class="flex-1 text-xs ${r.passed ? 'text-gray-300' : 'text-gray-500'}">${r.name}</span>
      <span class="text-[10px] text-gray-600 font-mono">${r.detail}</span>
    </li>`).join('');

  const sepaColor  = sepaResult.score === 8 ? 'text-green-400' : sepaResult.score >= 6 ? 'text-yellow-400' : 'text-red-400';
  const ma50Color  = price > ma50  ? 'text-green-400' : 'text-red-400';
  const ma150Color = price > ma150 ? 'text-green-400' : 'text-red-400';
  const ma200Color = price > ma200 ? 'text-green-400' : 'text-red-400';
  const target2R   = Math.round((price + (price - atrStop) * 2) * 100) / 100;

  container.innerHTML = `
    <div class="card relative overflow-hidden">
      <div class="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl -mr-10 -mt-10"></div>

      ${!hasFullData ? `<div class="flex items-start gap-2 rounded-xl p-3 mb-3 border" style="background:#fff7ed;border-color:#fcd34d"><span class="shrink-0">⚠️</span><div class="text-xs text-yellow-700"><span class="font-bold">ข้อมูลราคาน้อยกว่า 200 วัน</span> — MA150/MA200 และ SEPA ใช้ข้อมูลที่มีทั้งหมดแทน อาจคลาดเคลื่อนสำหรับหุ้นใหม่หรือ data จำกัด</div></div>` : ''}
      ${earningsBanner}

      <div class="flex justify-between items-start mb-4 relative z-10">
        <div>
          <h2 class="text-3xl font-extrabold tracking-tight mb-1">${symbol}</h2>
          <div class="flex gap-2 items-center flex-wrap">
            <span class="text-xs text-gray-400">${name}</span>
            <span class="pill ${pass ? 'pill-green' : 'pill-red'}">${pass ? 'PASS' : 'FAIL'}</span>
            ${postEarningsBadge}
            ${newsBadge}
          </div>
        </div>
        <div class="text-right">
          <div class="text-2xl font-bold">$${price.toFixed(2)}</div>
          <div class="text-sm font-semibold ${chColor}">${chSign}${change.toFixed(2)} (${chSign}${changePct.toFixed(2)}%)</div>
        </div>
      </div>

      <div class="bg-purple-500/10 border border-purple-500/20 rounded-xl p-4 mb-4 relative z-10">
        <div class="flex items-center gap-2 mb-1.5"><span>⚙️</span><span class="text-xs font-bold text-purple-400 tracking-widest uppercase">System Briefing</span></div>
        <p class="text-sm leading-relaxed text-gray-300">${briefing}</p>
      </div>

      <div class="grid grid-cols-3 gap-3 mb-4">
        <div class="bg-white/5 rounded-xl p-3 text-center border border-white/5">
          <div class="text-xs text-gray-400 mb-1">SEPA Score</div>
          <div class="text-lg font-bold ${sepaColor}">${sepaResult.score}/8</div>
        </div>
        <div class="bg-white/5 rounded-xl p-3 text-center border border-white/5">
          <div class="text-[10px] text-gray-400 mb-1">${rsSource === 'rank' ? 'RS Rank ✓' : 'RS vs SPY'}</div>
          <div class="text-lg font-bold text-blue-400">${rsRating}</div>
          <div class="text-[9px] mt-0.5 ${rsSource === 'rank' ? 'text-green-600' : 'text-gray-600'}">${rsSource === 'rank' ? 'rank จริง (Scan All)' : 'approx — ยังไม่ Scan All'}</div>
        </div>
        <div class="bg-white/5 rounded-xl p-3 text-center border border-white/5">
          <div class="text-xs text-gray-400 mb-1">Score</div>
          <div class="text-lg font-bold text-purple-400">${compScore.toFixed(1)}</div>
        </div>
      </div>

      <div class="bg-black/20 rounded-xl p-3 mb-4 border border-white/5">
        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">SEPA Checklist</div>
        <ul class="space-y-0">${ruleRows}</ul>
      </div>

      <div class="grid grid-cols-3 gap-2 text-center bg-white/5 rounded-xl p-3 mb-4 border border-white/5">
        <div><div class="text-[10px] text-gray-500 mb-0.5">MA50</div><div class="font-mono text-xs font-bold ${ma50Color}">$${ma50.toFixed(2)}</div></div>
        <div><div class="text-[10px] text-gray-500 mb-0.5">MA150</div><div class="font-mono text-xs font-bold ${ma150Color}">$${ma150.toFixed(2)}</div></div>
        <div><div class="text-[10px] text-gray-500 mb-0.5">MA200</div><div class="font-mono text-xs font-bold ${ma200Color}">$${ma200.toFixed(2)}</div></div>
      </div>

      ${_buildTargetHtml(price, atrStop, d.high52w, symbol)}

      <button id="scan-calc-btn"
              onclick="applyToRiskCalc('${symbol}', ${price.toFixed(2)}, ${atrStop.toFixed(2)}, ${target2R}, 1.0)"
              class="w-full btn-primary">
        ⚡ คำนวณ Risk — Stop $${atrStop.toFixed(2)} / 2R $${target2R.toFixed(2)}
      </button>
    </div>`;
}

function _buildTargetHtml(price, stop, high52w, symbol) {
  const risk  = price - stop;
  const t2r   = Math.round((price + risk * 2) * 100) / 100;
  const t3r   = Math.round((price + risk * 3) * 100) / 100;
  const rr2   = ((t2r - price) / risk).toFixed(1);
  const rr3   = ((t3r - price) / risk).toFixed(1);
  const rrH   = high52w > price ? ((high52w - price) / risk).toFixed(1) : null;
  const useHigh = high52w > price;

  let highNote, highColor;
  if      (high52w < t2r)  { highNote = '⚠️ 52w High ต่ำกว่า 2R — upside จำกัด'; highColor = 'text-yellow-400'; }
  else if (high52w <= t3r) { highNote = '✅ 52w High อยู่ระหว่าง 2R–3R — target สมเหตุสมผล'; highColor = 'text-green-400'; }
  else                     { highNote = '🚀 52w High เหนือ 3R — upside มากกว่า 3R'; highColor = 'text-purple-400'; }

  return `
    <div class="bg-black/20 rounded-xl p-3 mb-4 border border-white/5">
      <div class="flex items-center justify-between mb-3">
        <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">เลือก Target</span>
        <span class="text-[10px] text-gray-600">กดเพื่อเลือก</span>
      </div>
      <div class="grid grid-cols-${useHigh ? '3' : '2'} gap-2 mb-3">
        <div data-target="2R" onclick="selectTarget('2R', ${t2r}, '${symbol}', ${price}, ${stop})"
             style="opacity:1" class="ring-2 ring-purple-500 ring-inset bg-green-500/10 rounded-xl p-3 text-center cursor-pointer active:scale-95 transition-transform border border-green-500/20">
          <div class="text-[10px] text-gray-400 mb-1">2R Target</div>
          <div class="font-mono text-sm font-bold text-green-400">$${t2r.toFixed(2)}</div>
          <div class="text-[9px] text-green-600 mt-0.5">R/R ${rr2}x</div>
        </div>
        <div data-target="3R" onclick="selectTarget('3R', ${t3r}, '${symbol}', ${price}, ${stop})"
             style="opacity:0.6" class="bg-purple-500/10 rounded-xl p-3 text-center cursor-pointer active:scale-95 transition-transform border border-purple-500/20">
          <div class="text-[10px] text-gray-400 mb-1">3R Target</div>
          <div class="font-mono text-sm font-bold text-purple-400">$${t3r.toFixed(2)}</div>
          <div class="text-[9px] text-purple-600 mt-0.5">R/R ${rr3}x</div>
        </div>
        ${useHigh ? `
        <div data-target="52wHigh" onclick="selectTarget('52wHigh', ${high52w}, '${symbol}', ${price}, ${stop})"
             style="opacity:0.6" class="bg-blue-500/10 rounded-xl p-3 text-center cursor-pointer active:scale-95 transition-transform border border-blue-500/20">
          <div class="text-[10px] text-gray-400 mb-1">52w High</div>
          <div class="font-mono text-sm font-bold text-blue-400">$${high52w.toFixed(2)}</div>
          <div class="text-[9px] text-blue-600 mt-0.5">${rrH ? `R/R ${rrH}x` : '—'}</div>
        </div>` : ''}
      </div>
      <p class="text-[10px] ${highColor}">${highNote}</p>
    </div>`;
}

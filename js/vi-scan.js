// vi-scan.js — Value Investor scan (Finnhub metrics)

import { fetchQuote, fetchProfile, fetchMetric } from './api.js';
import { getWatchlistDB } from './db.js';
import { state } from './state.js';
import { showToast, escapeHtml } from './ui.js';

export async function scanVI() {
  const apiKey = localStorage.getItem('finnhubApiKey');
  if (!apiKey) { showToast('กรุณาใส่ Finnhub API Key ใน ℹ️ ก่อน', 'warning'); return; }

  const symbol = document.getElementById('vi-scan-input')?.value.trim().toUpperCase();
  if (!symbol) { showToast('กรุณาพิมพ์ ticker ก่อน', 'warning'); return; }

  const safeSymbol = escapeHtml(symbol);
  const area = document.getElementById('vi-scan-result-area');
  area.innerHTML = `<div class="card py-10 text-center" style="background:#fff;border-color:#e5e7eb">
    <p class="text-gray-400 text-sm animate-pulse">กำลังดึงข้อมูล <b class="text-gray-700">${safeSymbol}</b>...</p></div>`;

  try {
    const [quote, profile, metricData] = await Promise.all([
      fetchQuote(symbol, apiKey, 10 * 60 * 1000),
      fetchProfile(symbol, apiKey),
      fetchMetric(symbol, apiKey),
    ]);

    if (!quote.c || quote.c === 0) {
      area.innerHTML = `<div class="card py-10 text-center" style="background:#fff">
        <p class="text-red-400 font-bold">ไม่พบ ticker "${safeSymbol}"</p></div>`;
      return;
    }

    area.innerHTML = _renderVICard(symbol, quote, profile, metricData);

    // Persist scan meta for Journal / Risk/Port
    const meta = _buildMeta(symbol, quote, profile, metricData);
    state.lastViScanMeta = meta;
    localStorage.setItem('lastViScanMeta', JSON.stringify(meta));

    // Auto-trigger MOS Calculator if fair value was pre-filled
    setTimeout(() => {
      const fairInput = document.getElementById('vi-mos-fair-scan');
      if (fairInput?.value) calcMOSScan(quote.c);
    }, 50);

  } catch (e) {
    area.innerHTML = `<div class="card py-10 text-center" style="background:#fff">
      <p class="text-red-400 font-bold">เกิดข้อผิดพลาด: ${escapeHtml(e.message)}</p></div>`;
  }
}

export async function scanAllVI() {
  const apiKey = localStorage.getItem('finnhubApiKey');
  if (!apiKey) { showToast('กรุณาใส่ Finnhub API Key ใน ⚙️ ก่อน', 'warning'); return; }

  const wl = await getWatchlistDB('vi');
  if (!wl.length) { showToast('VI Watchlist ว่าง — เพิ่มหุ้นก่อน', 'warning'); return; }

  const listEl = document.getElementById('vi-watch-list');
  const symbols = wl.map(w => w.symbol);
  const results = [];

  // Finnhub free tier: 60 req/min. Each symbol = 3 calls → max 18 symbols/min safely.
  const BATCH_SIZE = 18;
  for (let i = 0; i < symbols.length; i++) {
    // Rate-limit pause every BATCH_SIZE symbols (skip pause before first symbol)
    if (i > 0 && i % BATCH_SIZE === 0) {
      listEl.innerHTML = `<div class="text-center py-10 text-blue-500 font-bold text-sm">⏳ รอ rate limit (${i}/${symbols.length} เสร็จแล้ว)...</div>`;
      await new Promise(r => setTimeout(r, 62_000)); // 62s ให้ quota reset
    }

    const sym = symbols[i];
    listEl.innerHTML = `<div class="text-center py-10 text-blue-500 font-bold animate-pulse text-sm">⏳ Scanning <b>${sym}</b> (${i + 1}/${symbols.length})...</div>`;
    try {
      const [quote, profile, metricData] = await Promise.all([
        fetchQuote(sym, apiKey, 10 * 60 * 1000),
        fetchProfile(sym, apiKey),
        fetchMetric(sym, apiKey),
      ]);
      if (!quote.c || quote.c === 0) { results.push({ symbol: sym, error: true }); continue; }
      const meta = _buildMeta(sym, quote, profile, metricData);
      localStorage.setItem(`vi_badge_${sym}`, JSON.stringify({
        viScore: meta.viScore, verdict: meta.verdict, isGrowth: meta.isGrowth,
        price: meta.price, ts: Date.now(),
      }));
      results.push({ ...meta, error: false });
    } catch { results.push({ symbol: sym, error: true }); }
  }

  results.sort((a, b) => (b.viScore ?? -1) - (a.viScore ?? -1));

  const _vc = v => ({ 'STRONG BUY':'#15803d', 'BUY':'#1d4ed8', 'WATCH':'#92400e' }[v] ?? '#b91c1c');
  const _vb = v => ({ 'STRONG BUY':'#dcfce7', 'BUY':'#dbeafe', 'WATCH':'#fef3c7' }[v] ?? '#fee2e2');
  const _vi = v => ({ 'STRONG BUY':'💎', 'BUY':'✅', 'WATCH':'👀' }[v] ?? '🚫');

  listEl.innerHTML = `
    <div class="flex justify-between items-center mb-3 px-1">
      <span class="text-xs font-bold text-gray-500 uppercase tracking-wider">VI Scan — เรียงตาม Score</span>
      <div class="flex gap-3 items-center">
        <button onclick="scanAllVI()" class="text-xs text-blue-500 font-bold underline">Scan Again</button>
        <button onclick="loadWatchlist('vi')" class="text-xs text-gray-400 underline">Reset</button>
      </div>
    </div>`;

  results.forEach(r => {
    if (r.error) {
      listEl.innerHTML += `
        <div class="rounded-xl border border-gray-200 p-3 flex justify-between items-center bg-gray-50">
          <span class="font-black text-gray-500">${r.symbol}</span>
          <span class="text-xs text-gray-400">ดึงข้อมูลไม่ได้</span>
        </div>`;
      return;
    }
    const vc = _vc(r.verdict); const vb = _vb(r.verdict); const vi = _vi(r.verdict);
    const modeBadge = r.isGrowth
      ? `<span class="text-[9px] font-bold px-1.5 py-0.5 rounded" style="background:#fef3c7;color:#92400e">GROWTH</span>`
      : `<span class="text-[9px] font-bold px-1.5 py-0.5 rounded" style="background:#ede9fe;color:#5b21b6">VALUE</span>`;
    const scanFn = `document.getElementById('vi-scan-input').value='${r.symbol}';switchTab('scan');scanVI()`;
    listEl.innerHTML += `
      <div class="rounded-xl border p-3 cursor-pointer active:opacity-70 transition-all hover:shadow-sm"
           style="background:${vb};border-color:${vc}40" onclick="${scanFn}">
        <div class="flex items-center justify-between mb-1.5">
          <div class="flex items-center gap-2">
            <span class="font-black text-xl" style="color:#111">${r.symbol}</span>
            ${modeBadge}
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span class="text-xs font-bold px-2 py-1 rounded-lg text-white" style="background:${vc}">${vi} ${r.verdict}</span>
            <span class="font-black text-xl" style="color:${vc}">${r.viScore}/10</span>
          </div>
        </div>
        <div class="flex gap-3 text-[10px]" style="color:${vc};opacity:0.75">
          <span>$${r.price?.toFixed(2) ?? '—'}</span>
          ${r.pe      != null ? `<span>P/E ${r.pe.toFixed(1)}</span>`                                 : ''}
          ${r.roe     != null ? `<span>ROE ${r.roe.toFixed(1)}%</span>`                               : ''}
          ${r.revGrow != null ? `<span>Rev ${r.revGrow > 0 ? '+' : ''}${r.revGrow.toFixed(0)}%</span>` : ''}
          ${r.epsGrow != null ? `<span>EPS ${r.epsGrow > 0 ? '+' : ''}${r.epsGrow.toFixed(0)}%</span>` : ''}
        </div>
      </div>`;
  });

  showToast(`VI Scan All เสร็จ — ${results.filter(r => !r.error).length}/${symbols.length} หุ้น`, 'success');
}

export function calcMOSScan(currentPrice) {
  const fair    = parseFloat(document.getElementById('vi-mos-fair-scan')?.value);
  const mosPct  = parseFloat(document.getElementById('vi-mos-pct-scan')?.value);
  const resultEl = document.getElementById('vi-mos-result-scan');
  if (!fair || fair <= 0 || !mosPct || isNaN(mosPct) || !resultEl) return;

  const buyPrice  = fair * (1 - mosPct / 100);
  const currentMOS = ((fair - currentPrice) / fair) * 100;
  const gap = buyPrice - currentPrice;

  let statusColor, statusBg, statusText;
  if      (currentMOS >= mosPct) { statusColor = '#15803d'; statusBg = '#dcfce7'; statusText = `✅ ราคาปัจจุบันให้ MOS ${currentMOS.toFixed(1)}% — ถึงเกณฑ์ซื้อแล้ว`; }
  else if (currentMOS > 0)       { statusColor = '#854d0e'; statusBg = '#fef9c3'; statusText = `⏳ MOS ปัจจุบัน ${currentMOS.toFixed(1)}% — ยังต้องรอราคาลง $${Math.abs(gap).toFixed(2)}`; }
  else                           { statusColor = '#b91c1c'; statusBg = '#fee2e2'; statusText = `🚫 ราคาแพงกว่า Fair Value ${Math.abs(currentMOS).toFixed(1)}% — อย่าซื้อ`; }

  resultEl.style.background = statusBg;
  resultEl.style.color      = statusColor;
  resultEl.innerHTML = `
    <div class="text-xs font-bold mb-2">${statusText}</div>
    <div class="flex justify-around text-sm">
      <div><div class="text-[10px] opacity-70">Fair Value</div><div class="font-black">$${fair.toFixed(2)}</div></div>
      <div><div class="text-[10px] opacity-70">ราคาซื้อ (${mosPct}% MOS)</div><div class="font-black">$${buyPrice.toFixed(2)}</div></div>
      <div><div class="text-[10px] opacity-70">ราคาปัจจุบัน</div><div class="font-black">$${currentPrice.toFixed(2)}</div></div>
    </div>`;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function _buildMeta(symbol, quote, profile, metricData) {
  const m         = metricData.metric || {};
  const price     = quote.c;
  const pe        = m['peNormalizedAnnual'] || m['peTTM']    || null;
  const pb        = m['pbAnnual']           || m['pbQuarterly'] || null;
  const roe       = m['roeRfy']             || m['roeTTM']   || null;
  const roa       = m['roaRfy']             || m['roaTTM']   || null;
  const revGrow   = m['revenueGrowthTTMYoy'] || m['revenueGrowth3Y'] || null;
  const epsGrow   = m['epsGrowthTTMYoy']   || m['epsGrowth3Y'] || null;
  const beta      = m['beta']               || null;
  const high52    = m['52WeekHigh']         || price;
  const low52     = m['52WeekLow']          || price;
  const mktCap    = profile.marketCapitalization || null;
  const divYield  = m['dividendYieldIndicatedAnnual'] || null;
  const pegRatio  = (pe != null && pe > 0 && epsGrow != null && epsGrow > 0) ? pe / epsGrow : null;

  const isGrowth  = (epsGrow != null && epsGrow > 25) || (revGrow != null && revGrow > 20);
  const negEq     = pb != null && pb < 0;
  const epsNeg    = epsGrow == null || epsGrow <= 0;

  const checks    = _buildChecks({ pe, pb, roe, roa, revGrow, epsGrow, beta, pegRatio, isGrowth, negEq, epsNeg, high52, low52, price });
  const valid     = checks.filter(c => !c.na).length || 1;
  const viScore   = Math.round(checks.filter(c => c.pass && !c.na).length / valid * 10);
  const stockMode = isGrowth ? 'GROWTH' : 'VALUE';

  let verdict;
  if      (viScore >= 8) verdict = 'STRONG BUY';
  else if (viScore >= 6) verdict = 'BUY';
  else if (viScore >= 4) verdict = 'WATCH';
  else                   verdict = 'AVOID';

  return { symbol, price, pe, pegRatio, pb, roe, roa, revGrow, epsGrow, divYield, beta, high52, low52, mktCap, viScore, verdict, stockMode, isGrowth };
}

function _buildChecks({ pe, pb, roe, roa, revGrow, epsGrow, beta, pegRatio, isGrowth, negEq, epsNeg, high52, low52, price }) {
  const posInRange = high52 > low52 ? (price - low52) / (high52 - low52) : 0.5;

  return [
    negEq
      ? { label: 'ROE N/A (Equity ติดลบ)',          pass: false, na: true,  why: 'Equity ติดลบจากการซื้อหุ้นคืนสะสม — ROE คำนวณได้แต่ตัวเลขเชื่อถือไม่ได้' }
      : { label: 'ROE ≥ 15%',                        pass: roe != null && roe >= 15, why: 'บริษัทสร้างผลตอบแทนให้ผู้ถือหุ้นได้ดี' },
    negEq
      ? { label: 'ROE (ขั้นต่ำ) N/A (Equity ติดลบ)', pass: false, na: true,  why: 'ไม่สามารถประเมิน ROE ได้อย่างน่าเชื่อถือ' }
      : { label: 'ROE ≥ 10% (ขั้นต่ำ)',               pass: roe != null && roe >= 10, why: 'ทำกำไรจากส่วนของผู้ถือหุ้นได้' },
    { label: 'Revenue Growth > 0%', pass: revGrow != null && revGrow > 0, why: 'ยอดขายยังโต ธุรกิจไม่หดตัว' },
    { label: 'EPS Growth > 0%',     pass: epsGrow != null && epsGrow > 0, why: 'กำไรต่อหุ้นโต = ผู้ถือหุ้นได้ประโยชน์' },
    isGrowth
      ? epsNeg
        ? { label: 'PEG N/A (EPS โตติดลบ)',                           pass: false, na: true,  why: 'EPS growth ≤ 0 ทำให้สูตร PEG ไม่มีความหมาย' }
        : { label: `PEG Ratio ${pegRatio != null ? pegRatio.toFixed(2) : '—'} < 1.5 (Peter Lynch)`, pass: pegRatio != null && pegRatio < 1.5, why: 'PEG < 1.5 = ราคายุติธรรมเทียบกับการเติบโต' }
      : { label: 'P/E < 30 (ราคาสมเหตุ)', pass: pe != null && pe > 0 && pe < 30, why: 'ไม่แพงเกินไปเทียบกับกำไร' },
    { label: 'P/E > 0 (มีกำไร)', pass: pe != null && pe > 0, why: 'บริษัทมีกำไรจริง ไม่ขาดทุน' },
    negEq
      ? { label: 'P/B N/A (Equity ติดลบ)', pass: false, na: true, why: 'Book value ติดลบ — P/B ใช้ประเมินมูลค่าไม่ได้' }
      : isGrowth
        ? { label: 'ROE > P/B (สร้างมูลค่าคุ้มราคา)', pass: roe != null && pb != null && roe > pb, why: 'ROE > P/B = บริษัทสร้างผลตอบแทนได้มากกว่าที่ตลาดจ่าย' }
        : { label: 'P/B < 5', pass: pb != null && pb > 0 && pb < 5, why: 'ราคาหุ้นไม่แพงกว่ามูลค่าบัญชีมากเกินไป' },
    isGrowth
      ? { label: `Beta ${beta != null ? beta.toFixed(2) : '—'} (ปกติสำหรับ Growth)`, pass: true, why: 'หุ้น Growth/Tech มักมี Beta > 1 เป็นเรื่องปกติ' }
      : { label: 'Beta < 1.2 (ความเสี่ยงต่ำ)', pass: beta != null && beta < 1.2, why: 'ความผันผวนต่ำกว่าตลาดรวม' },
    { label: 'ROA > 5%', pass: roa != null && roa > 5, why: 'ใช้สินทรัพย์สร้างกำไรได้มีประสิทธิภาพ' },
    isGrowth
      ? { label: 'ใกล้ 52w High > 60% (Growth Momentum)', pass: posInRange > 0.60, why: 'หุ้น Growth แข็งแกร่งจะเกาะใกล้ 52w High เสมอ' }
      : { label: 'ใกล้ 52w Low < 40% (Margin of Safety)', pass: posInRange < 0.40, why: 'ราคาอยู่ในโซนต่ำ — Margin of Safety สูงกว่า' },
  ];
}

/**
 * Auto-estimate Fair Value from available Finnhub metrics.
 * All methods use established financial formulas — no made-up heuristics.
 * Returns { value, method, note, confidence } where confidence is 'high'|'medium'|'low'.
 *
 * Priority chain (stops at first valid result):
 *   Growth:  PEG=1 (Lynch) → Gordon Growth DDM → null
 *   Value:   Graham Number → P/E 15x → Gordon Growth DDM → P/B=1 (Book Value) → null
 */
function _calcFairValue(price, pe, pb, epsGrow, revGrow, divYield, isGrowth) {
  const eps = (pe != null && pe > 0 && pe < 200) ? price / pe : null;
  const bv  = (pb != null && pb > 0)             ? price / pb : null;

  // ── Shared helper: Gordon Growth Model (Dividend Discount Model) ──────────
  // Formula: Fair Value = D / (r − g)
  // D = annual dividend per share = price × divYield%
  // r = 10% required return (long-run market average, Damodaran)
  // g = sustainable growth rate, capped at 8% (g must be < r)
  const _gordonDDM = () => {
    if (!divYield || divYield <= 0) return null;
    const D = price * (divYield / 100);
    const rawG = (revGrow != null && revGrow > 0) ? revGrow / 100 : 0;
    const g = Math.min(rawG, 0.08);       // cap: perpetual growth can't exceed ~GDP
    const r = 0.10;
    if (g >= r || D <= 0) return null;
    const fv = D / (r - g);
    if (fv <= 0 || !isFinite(fv) || fv > price * 10) return null;
    return {
      value:      fv,
      method:     'Gordon Growth (DDM)',
      note:       `Dividend $${D.toFixed(2)} ÷ (10% − ${(g * 100).toFixed(0)}% growth) = $${fv.toFixed(2)}`,
      confidence: divYield > 1 && g > 0 ? 'medium' : 'low',
    };
  };

  // ── GROWTH stocks ──────────────────────────────────────────────────────────

  if (isGrowth) {
    // 1. PEG = 1 (Peter Lynch): Fair P/E = EPS growth rate
    if (eps != null && epsGrow != null && epsGrow > 0) {
      const fairPE = Math.min(epsGrow, 30); // cap at 30× — Lynch himself says don't overpay
      const fv     = fairPE * eps;
      if (fv > 0 && fv < price * 5) {
        return {
          value:      fv,
          method:     'PEG = 1 (Lynch)',
          note:       `Fair P/E ${fairPE.toFixed(0)}x × EPS $${eps.toFixed(2)} (EPS growth ${epsGrow.toFixed(0)}%)`,
          confidence: epsGrow > 10 ? 'high' : 'medium',
        };
      }
    }
    // 2. Gordon DDM (rare for growth — only if pays dividend)
    const ddm = _gordonDDM();
    if (ddm) return ddm;

    // No valid estimate for growth stock with negative EPS and no dividend
    return null;
  }

  // ── VALUE stocks ───────────────────────────────────────────────────────────

  // 1. Graham Number: √(22.5 × EPS × BV) — both positive required
  if (eps != null && bv != null && eps > 0 && bv > 0) {
    const graham = Math.sqrt(22.5 * eps * bv);
    if (graham > 0 && isFinite(graham) && graham < price * 5) {
      return {
        value:      graham,
        method:     'Graham Number',
        note:       `√(22.5 × EPS $${eps.toFixed(2)} × BV $${bv.toFixed(2)})`,
        confidence: 'high',
      };
    }
  }

  // 2. Conservative P/E 15x — Shiller's historical fair-market P/E average
  if (eps != null && eps > 0 && pe != null && pe > 0 && pe < 50) {
    const fv = 15 * eps;
    if (fv > 0) {
      return {
        value:      fv,
        method:     'Conservative P/E 15x',
        note:       `EPS $${eps.toFixed(2)} × P/E 15 (Shiller ค่าเฉลี่ยระยะยาว S&P500)`,
        confidence: 'medium',
      };
    }
  }

  // 3. Gordon DDM — for dividend-paying value stocks
  const ddm = _gordonDDM();
  if (ddm) return ddm;

  // 4. P/B = 1 (Graham's floor) — worth no more than book value
  // Only useful when stock trades at premium to book (pb > 1)
  if (bv != null && bv > 0 && pb != null && pb > 1) {
    return {
      value:      bv,
      method:     'Book Value (Graham floor)',
      note:       `BV/share = $${bv.toFixed(2)} (ราคาปัจจุบัน P/B ${pb.toFixed(1)}x — floor ที่ Graham ถือว่าปลอดภัย)`,
      confidence: 'low',
    };
  }

  // No valid estimate — caller should prompt user to input manually
  return null;
}

function _renderVICard(symbol, quote, profile, metricData) {
  const safeSymbol = escapeHtml(symbol);
  const m         = metricData.metric || {};
  const price     = quote.c;
  const change    = price - quote.pc;
  const changePct = (change / quote.pc) * 100;
  const chSign    = change >= 0 ? '+' : '';
  const chColor   = change >= 0 ? 'color:#16a34a' : 'color:#dc2626';

  const pe       = m['peNormalizedAnnual'] || m['peTTM']        || null;
  const pb       = m['pbAnnual']           || m['pbQuarterly']  || null;
  const roe      = m['roeRfy']             || m['roeTTM']       || null;
  const roa      = m['roaRfy']             || m['roaTTM']       || null;
  const revGrow  = m['revenueGrowthTTMYoy'] || m['revenueGrowth3Y'] || null;
  const epsGrow  = m['epsGrowthTTMYoy']   || m['epsGrowth3Y']  || null;
  const divYield = m['dividendYieldIndicatedAnnual']             || null;
  const beta     = m['beta']               || null;
  const high52   = m['52WeekHigh']         || price;
  const low52    = m['52WeekLow']          || price;
  const mktCap   = profile.marketCapitalization || null;
  const pegRatio = (pe != null && pe > 0 && epsGrow != null && epsGrow > 0) ? pe / epsGrow : null;

  const isGrowth  = (epsGrow != null && epsGrow > 25) || (revGrow != null && revGrow > 20);
  const negEq     = pb != null && pb < 0;
  const epsNeg    = epsGrow == null || epsGrow <= 0;
  const stockMode = isGrowth ? 'GROWTH' : 'VALUE';

  const checks    = _buildChecks({ pe, pb, roe, roa, revGrow, epsGrow, beta, pegRatio, isGrowth, negEq, epsNeg, high52, low52, price });
  const valid     = checks.filter(c => !c.na).length || 1;
  const viScore   = Math.round(checks.filter(c => c.pass && !c.na).length / valid * 10);

  let verdict, verdictBg, verdictColor, verdictIcon;
  if      (viScore >= 8) { verdict = 'STRONG BUY'; verdictBg = '#dcfce7'; verdictColor = '#15803d'; verdictIcon = '💎'; }
  else if (viScore >= 6) { verdict = 'BUY';         verdictBg = '#dbeafe'; verdictColor = '#1d4ed8'; verdictIcon = '✅'; }
  else if (viScore >= 4) { verdict = 'WATCH';       verdictBg = '#fef9c3'; verdictColor = '#854d0e'; verdictIcon = '👀'; }
  else                   { verdict = 'AVOID';       verdictBg = '#fee2e2'; verdictColor = '#b91c1c'; verdictIcon = '🚫'; }

  const rangePct = high52 > low52
    ? Math.max(0, Math.min(100, ((price - low52) / (high52 - low52) * 100))).toFixed(0)
    : 50;

  const fmt    = (v, d = 2) => v != null ? v.toFixed(d) : '—';
  const fmtPct = v => v != null ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%` : '—';
  const fmtCap = v => !v ? '—' : v >= 1000 ? `$${(v / 1000).toFixed(1)}T` : `$${v.toFixed(0)}B`;

  const checkRow = c => {
    const icon       = c.na ? '⚠️' : (c.pass ? '✅' : '❌');
    const iconCls    = c.na ? 'text-orange-500' : (c.pass ? 'text-green-500' : 'text-red-400');
    const labelColor = c.na ? 'text-orange-600' : (c.pass ? 'text-gray-700' : 'text-gray-400');
    return `
      <div class="flex items-start gap-2 py-2 border-b border-gray-50 last:border-0">
        <span class="shrink-0 mt-0.5 ${iconCls}">${icon}</span>
        <div class="flex-1 min-w-0">
          <div class="text-xs font-bold ${labelColor}">${c.label}</div>
          <div class="text-[10px] text-gray-400">${c.why}</div>
        </div>
      </div>`;
  };

  const metricRow = (label, value, color = '#374151', note = '') =>
    `<div class="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
      <div>
        <div class="text-sm text-gray-500">${label}</div>
        ${note ? `<div class="text-[10px] text-gray-400">${note}</div>` : ''}
      </div>
      <span class="text-sm font-bold" style="color:${color}">${value}</span>
    </div>`;

  return `
    <div class="card relative overflow-hidden mb-4" style="background:#fff;border-color:#e5e7eb">
      <div class="absolute top-0 right-0 w-40 h-40 rounded-full blur-3xl -mr-10 -mt-10" style="background:rgba(59,130,246,0.06)"></div>

      <div class="flex justify-between items-start mb-3 relative z-10">
        <div>
          <h2 class="text-3xl font-extrabold tracking-tight" style="color:#111">${safeSymbol}</h2>
          <div class="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span class="text-xs" style="color:#6b7280">${escapeHtml(profile.name) || safeSymbol}${mktCap ? ` · MCap ${fmtCap(mktCap)}` : ''}</span>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" style="${isGrowth ? 'background:#fef3c7;color:#92400e' : 'background:#ede9fe;color:#5b21b6'}">${stockMode}</span>
          </div>
        </div>
        <div class="text-right">
          <div class="text-2xl font-bold" style="color:#111">$${price.toFixed(2)}</div>
          <div class="text-sm font-semibold" style="${chColor}">${chSign}${change.toFixed(2)} (${chSign}${changePct.toFixed(2)}%)</div>
        </div>
      </div>

      <div class="rounded-2xl p-4 mb-4 relative z-10" style="background:${verdictBg}">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-xs font-bold uppercase tracking-wider mb-0.5" style="color:${verdictColor};opacity:0.7">VI Quality Score</div>
            <div class="flex items-center gap-2">
              <span class="text-3xl font-black" style="color:${verdictColor}">${viScore}/10</span>
              <span class="text-lg font-bold px-3 py-1 rounded-xl" style="background:${verdictColor};color:#fff">${verdictIcon} ${verdict}</span>
            </div>
          </div>
          <div class="text-right">
            <div class="text-xs" style="color:${verdictColor};opacity:0.7">ผ่านเกณฑ์</div>
            <div class="text-lg font-bold" style="color:${verdictColor}">${checks.filter(c => c.pass && !c.na).length} จาก ${valid} ข้อ</div>
          </div>
        </div>
      </div>

      <div class="mb-4">
        <div class="flex justify-between text-[10px] text-gray-400 mb-1">
          <span>52w Low $${low52.toFixed(2)}</span>
          <span>52w High $${high52.toFixed(2)}</span>
        </div>
        <div class="relative h-2.5 rounded-full" style="background:#e5e7eb">
          <div class="absolute h-2.5 rounded-full" style="background:#3b82f6;width:${rangePct}%"></div>
          <div class="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-white shadow" style="background:#1d4ed8;left:calc(${rangePct}% - 7px)"></div>
        </div>
        <div class="text-center text-[10px] text-gray-400 mt-1">ราคาอยู่ที่ ${rangePct}% ของ 52w range ${parseInt(rangePct) < 40 ? '(โซนต่ำ — value zone)' : parseInt(rangePct) > 80 ? '(ใกล้ High)' : ''}</div>
      </div>

      ${(!isGrowth && epsGrow == null && revGrow == null && pe != null && pe > 30) ? `<div class="mb-3 rounded-xl px-3 py-2.5 text-xs font-bold flex gap-2 items-start" style="background:#f0f7ff;color:#1d4ed8;border:1px solid #bfdbfe"><span class="shrink-0">ℹ️</span><div><div class="font-bold">ข้อมูล Growth ไม่พบใน Finnhub</div><div class="font-normal mt-0.5 opacity-80">ใช้เกณฑ์ VALUE เป็น default (P/E ${pe.toFixed(0)}x สูง — ถ้าเป็น Growth Stock จริง ผลลัพธ์อาจต่ำกว่าความเป็นจริง)</div></div></div>` : ''}
      ${negEq ? `<div class="mb-3 rounded-xl px-3 py-2.5 text-xs font-bold flex gap-2 items-start" style="background:#fff7ed;color:#c2410c;border:1px solid #fed7aa"><span class="shrink-0">⚠️</span><div><div class="font-bold">Negative Equity ตรวจพบ</div><div class="font-normal mt-0.5 opacity-80">P/B ติดลบ ($${Math.abs(pb).toFixed(1)}) = ส่วนทุนผู้ถือหุ้นเป็นลบ อาจมาจากซื้อหุ้นคืนสะสม</div></div></div>` : ''}
      ${epsNeg && isGrowth ? `<div class="mb-3 rounded-xl px-3 py-2.5 text-xs font-bold flex gap-2 items-start" style="background:#fff7ed;color:#c2410c;border:1px solid #fed7aa"><span class="shrink-0">⚠️</span><div><div class="font-bold">EPS Growth ≤ 0 — PEG ใช้ไม่ได้</div><div class="font-normal mt-0.5 opacity-80">EPS โต ${epsGrow != null ? epsGrow.toFixed(1) : '—'}% — สูตร PEG ไม่มีความหมายเมื่อตัวหารเป็นลบ</div></div></div>` : ''}

      <div class="mb-4">
        <div class="text-xs font-bold uppercase tracking-wider mb-2" style="color:#9ca3af">VI Checklist (Buffett + Lynch)</div>
        <div class="rounded-xl border border-gray-100 px-3" style="background:#fafafa">${checks.map(checkRow).join('')}</div>
      </div>

      <div class="mb-4">
        <div class="text-xs font-bold uppercase tracking-wider mb-2" style="color:#9ca3af">ตัวเลขสำคัญ</div>
        <div class="rounded-xl border border-gray-100 px-3" style="background:#fafafa">
          ${metricRow('P/E', pe != null ? fmt(pe, 1) : '—', pe != null && pe > 0 && pe < 25 ? '#16a34a' : pe != null && pe > 50 ? '#dc2626' : '#374151', 'ราคา ÷ กำไร/หุ้น (ต่ำ = ถูก)')}
          ${isGrowth ? (epsNeg ? metricRow('PEG Ratio', 'N/A ⚠️', '#c2410c', 'EPS Growth ≤ 0 — ไม่สามารถคำนวณ PEG ได้') : metricRow('PEG Ratio', pegRatio != null ? fmt(pegRatio) : '—', pegRatio != null && pegRatio < 1.5 ? '#16a34a' : pegRatio != null && pegRatio > 3 ? '#dc2626' : '#374151', 'P/E ÷ EPS Growth% — < 1.5 = fair')) : ''}
          ${negEq ? metricRow('P/B', `${fmt(pb, 1)} ⚠️`, '#c2410c', 'P/B ติดลบ = Equity ติดลบ') : metricRow('P/B', pb != null ? fmt(pb, 1) : '—', pb != null && pb < 3 ? '#16a34a' : '#374151', 'ราคา ÷ มูลค่าทางบัญชี (< 3 = สมเหตุ)')}
          ${negEq ? metricRow('ROE', roe != null ? fmtPct(roe) + ' ⚠️' : 'N/A', '#c2410c', 'Equity ติดลบ — ROE ไม่น่าเชื่อถือ') : metricRow('ROE', roe != null ? fmtPct(roe) : '—', roe != null && roe >= 15 ? '#16a34a' : roe != null && roe < 5 ? '#dc2626' : '#374151', 'ผลตอบแทนต่อทุน (> 15% = แข็งแกร่ง)')}
          ${metricRow('Revenue Growth', fmtPct(revGrow), revGrow != null && revGrow > 0 ? '#16a34a' : '#dc2626', 'การเติบโตของยอดขาย YoY')}
          ${metricRow('EPS Growth', fmtPct(epsGrow), epsGrow != null && epsGrow > 0 ? '#16a34a' : '#dc2626', 'การเติบโตของกำไรต่อหุ้น YoY')}
          ${divYield ? metricRow('Dividend Yield', `${divYield.toFixed(2)}%`, '#374151', 'อัตราเงินปันผล') : ''}
          ${metricRow('Beta', beta != null ? fmt(beta) : '—', beta != null && beta < 1 ? '#16a34a' : '#374151', '< 1 = ผันผวนน้อยกว่าตลาด')}
        </div>
      </div>

      ${(() => {
        const fv = _calcFairValue(price, pe, pb, epsGrow, revGrow, divYield, isGrowth);
        const fvVal   = fv ? fv.value.toFixed(2) : '';
        const confColor = { high:'#15803d', medium:'#92400e', low:'#b91c1c' }[fv?.confidence] ?? '#374151';
        const confBg    = { high:'#dcfce7', medium:'#fef9c3', low:'#fee2e2' }[fv?.confidence] ?? '#f3f4f6';
        const confLabel = { high:'ความน่าเชื่อถือ: สูง', medium:'ความน่าเชื่อถือ: ปานกลาง', low:'ความน่าเชื่อถือ: ต่ำ' }[fv?.confidence] ?? '';
        const autoFvBadge = fv ? `
          <div class="flex items-center justify-between mb-2 px-1">
            <span class="text-[10px] font-bold" style="color:${confColor}">⚙️ ${fv.method}</span>
            <span class="text-[9px] font-bold px-1.5 py-0.5 rounded" style="background:${confBg};color:${confColor}">${confLabel}</span>
          </div>
          <div class="text-[10px] text-gray-400 mb-2 px-1">${fv.note}</div>` : '';
        return `
      <div class="mb-4 rounded-2xl border border-blue-100 p-4" style="background:#f0f7ff">
        <div class="flex items-center justify-between mb-1">
          <div class="text-xs font-bold uppercase tracking-wider" style="color:#1d4ed8">📐 Fair Value & MOS Calculator</div>
          <span class="text-[10px] font-bold px-2 py-0.5 rounded-full" style="background:#dbeafe;color:#1d4ed8">แก้ได้</span>
        </div>
        <p class="text-xs text-blue-600 mb-3">ระบบประมาณ Fair Value ให้จาก metrics — กรอกเองได้เสมอ<br><span class="text-blue-400 font-normal">ไม่กระทบ Position Size — กด ⚡ ด้านล่างเพื่อคำนวณจำนวนหุ้นจริง</span></p>
        ${autoFvBadge}
        <div class="flex gap-2 mb-3">
          <div class="flex-1">
            <label class="text-[10px] font-bold text-gray-400 flex items-center gap-1 mb-1">
              Fair Value ($)
              <button type="button" data-fv-method="${escapeHtml(fv?.method ?? 'ไม่มีข้อมูลเพียงพอ')}"
                      onclick="showToast('ระบบประมาณจาก ' + this.dataset.fvMethod + ' — เป็นค่าประมาณเท่านั้น ปรับตามการวิเคราะห์ของคุณเองได้', 'info')"
                      class="text-blue-400 leading-none">ℹ️</button>
            </label>
            <input type="number" id="vi-mos-fair-scan" placeholder="0.00"
                   value="${fvVal}"
                   oninput="calcMOSScan(${price.toFixed(2)})"
                   class="w-full rounded-xl font-bold text-lg px-3 py-2 focus:outline-none focus:border-blue-400"
                   style="background:#fff;border:2px solid ${fv ? confColor + '60' : '#bfdbfe'};color:#111">
          </div>
          <div class="flex-1">
            <label class="text-[10px] font-bold text-gray-400 block mb-1">แสดงราคาซื้อที่ MOS</label>
            <select id="vi-mos-pct-scan" onchange="calcMOSScan(${price.toFixed(2)})"
                    class="w-full rounded-xl border border-blue-200 text-gray-800 font-bold text-base px-3 py-2.5 focus:outline-none" style="background:#fff">
              <option value="20">20%</option>
              <option value="30" selected>30%</option>
              <option value="40">40%</option>
              <option value="50">50%</option>
            </select>
          </div>
        </div>
        <div id="vi-mos-result-scan" class="rounded-xl p-3 text-center" style="background:#e0eeff;color:#1d4ed8">
          <div class="text-xs text-blue-500 mb-1">${fv ? 'กำลังคำนวณ...' : 'ใส่ Fair Value เพื่อดูผล'}</div>
        </div>
      </div>`;
      })()}

      <button onclick="applyToVIRisk(${price.toFixed(2)})"
              class="w-full py-3.5 rounded-xl font-bold text-sm transition-colors mb-2" style="background:#1d4ed8;color:#fff">
        ⚡ คำนวณ Position Size → Risk/Port
      </button>
      <button onclick="addWatchlistDirect('${safeSymbol}', 'vi')"
              class="w-full py-3 rounded-xl font-bold text-sm border transition-colors" style="background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe">
        ⭐ เพิ่มใน VI Watchlist
      </button>
    </div>`;
}

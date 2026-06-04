// vi-scan.js — Value Investor scan (Finnhub metrics)

import { fetchQuote, fetchProfile, fetchMetric } from './api.js';
import { state } from './state.js';
import { showToast } from './ui.js';

export async function scanVI() {
  const apiKey = localStorage.getItem('finnhubApiKey');
  if (!apiKey) { showToast('กรุณาใส่ Finnhub API Key ใน ℹ️ ก่อน', 'warning'); return; }

  const symbol = document.getElementById('vi-scan-input')?.value.trim().toUpperCase();
  if (!symbol) { showToast('กรุณาพิมพ์ ticker ก่อน', 'warning'); return; }

  const area = document.getElementById('vi-scan-result-area');
  area.innerHTML = `<div class="card py-10 text-center" style="background:#fff;border-color:#e5e7eb">
    <p class="text-gray-400 text-sm animate-pulse">กำลังดึงข้อมูล <b class="text-gray-700">${symbol}</b>...</p></div>`;

  try {
    const [quote, profile, metricData] = await Promise.all([
      fetchQuote(symbol, apiKey, 10 * 60 * 1000),
      fetchProfile(symbol, apiKey),
      fetchMetric(symbol, apiKey),
    ]);

    if (!quote.c || quote.c === 0) {
      area.innerHTML = `<div class="card py-10 text-center" style="background:#fff">
        <p class="text-red-400 font-bold">ไม่พบ ticker "${symbol}"</p></div>`;
      return;
    }

    area.innerHTML = _renderVICard(symbol, quote, profile, metricData);

    // Persist scan meta for Journal / Risk/Port
    const meta = _buildMeta(symbol, quote, profile, metricData);
    state.lastViScanMeta = meta;
    localStorage.setItem('lastViScanMeta', JSON.stringify(meta));

  } catch (e) {
    area.innerHTML = `<div class="card py-10 text-center" style="background:#fff">
      <p class="text-red-400 font-bold">เกิดข้อผิดพลาด: ${e.message}</p></div>`;
  }
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

function _renderVICard(symbol, quote, profile, metricData) {
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
          <h2 class="text-3xl font-extrabold tracking-tight" style="color:#111">${symbol}</h2>
          <div class="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span class="text-xs" style="color:#6b7280">${profile.name || symbol}${mktCap ? ` · MCap ${fmtCap(mktCap)}` : ''}</span>
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

      <div class="mb-4 rounded-2xl border border-blue-100 p-4" style="background:#f0f7ff">
        <div class="text-xs font-bold uppercase tracking-wider mb-3" style="color:#1d4ed8">📐 Margin of Safety Calculator</div>
        <p class="text-xs text-blue-600 mb-3">ใส่ Fair Value ที่คุณประเมินไว้ ระบบจะคำนวณ MOS และราคาที่ควรซื้อ</p>
        <div class="flex gap-2 mb-3">
          <div class="flex-1">
            <label class="text-[10px] font-bold text-gray-400 flex items-center gap-1 mb-1">
              Fair Value ($)
              <button type="button" onclick="showToast('Fair Value = มูลค่าที่แท้จริงของธุรกิจ ที่คุณประเมินจากการวิเคราะห์พื้นฐาน — ไม่ใช่ราคาตลาด แอปไม่ได้คำนวณให้เพราะขึ้นอยู่กับ assumptions ของแต่ละคน', 'info')" class="text-blue-400 leading-none">ℹ️</button>
            </label>
            <input type="number" id="vi-mos-fair-scan" placeholder="0.00"
                   oninput="calcMOSScan(${price.toFixed(2)})"
                   class="w-full rounded-xl border border-blue-200 text-gray-800 font-bold text-lg px-3 py-2 focus:outline-none focus:border-blue-400" style="background:#fff">
          </div>
          <div class="flex-1">
            <label class="text-[10px] font-bold text-gray-400 block mb-1">MOS % ที่ต้องการ</label>
            <select id="vi-mos-pct-scan" onchange="calcMOSScan(${price.toFixed(2)})"
                    class="w-full rounded-xl border border-blue-200 text-gray-800 font-bold text-base px-3 py-2.5 focus:outline-none" style="background:#fff">
              <option value="20">20% (ปกติ)</option>
              <option value="30" selected>30% (แนะนำ)</option>
              <option value="40">40% (ระมัดระวัง)</option>
              <option value="50">50% (เข้มงวด)</option>
            </select>
          </div>
        </div>
        <div id="vi-mos-result-scan" class="rounded-xl p-3 text-center" style="background:#e0eeff;color:#1d4ed8">
          <div class="text-xs text-blue-500 mb-1">ใส่ Fair Value เพื่อดูผล</div>
        </div>
      </div>

      <button onclick="applyToVIRisk(${price.toFixed(2)})"
              class="w-full py-3.5 rounded-xl font-bold text-sm transition-colors mb-2" style="background:#1d4ed8;color:#fff">
        ⚡ คำนวณ Position Size → Risk/Port
      </button>
      <button onclick="addWatchlistDirect('${symbol}', 'vi')"
              class="w-full py-3 rounded-xl font-bold text-sm border transition-colors" style="background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe">
        ⭐ เพิ่มใน VI Watchlist
      </button>
    </div>`;
}

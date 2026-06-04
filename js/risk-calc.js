// risk-calc.js — Trader 1% Risk Calculator + VI Position Sizing

import { calculateRisk } from './rules.js';
import { fetchEarnings } from './api.js';
import { getCached } from './cache.js';
import { CACHE_TTL, CACHE_PREFIX_EARNINGS } from './config.js';
import { state } from './state.js';
import { showToast } from './ui.js';
import { switchTab } from './nav.js';

// ─── Trader Risk Calculator ───────────────────────────────────────────────────

function _readRiskInputs() {
  return {
    accountSize: parseFloat(document.getElementById('calc-account-size')?.value) || 0,
    riskPct:     parseFloat(document.getElementById('calc-risk-pct')?.value)     || 0,
    entryPrice:  parseFloat(document.getElementById('calc-entry-price')?.value)  || 0,
    stopPrice:   parseFloat(document.getElementById('calc-stop-loss')?.value)    || 0,
    targetPrice: parseFloat(document.getElementById('calc-target-price')?.value) || 0,
    fractional:  document.getElementById('calc-frac')?.checked ?? false,
  };
}

export function updateRiskCalc() {
  const display = document.getElementById('display-risk-pct');
  let { accountSize, riskPct, entryPrice, stopPrice, targetPrice, fractional } = _readRiskInputs();

  // ── Monthly Cooldown: intercept riskPct if in drawdown ──
  const cooldown   = state.cooldownStatus;
  const badgeEl    = document.getElementById('cooldown-badge');
  const FORCED_PCT = 0.5;   // match smallest pill — 0.25 would disable every pill
  const inCooldown = cooldown?.inCooldown ?? false;

  if (inCooldown) {
    riskPct = FORCED_PCT;
    // Write back to the DOM input so saveFromRiskCalc() reads the correct value
    const riskInput = document.getElementById('calc-risk-pct');
    if (riskInput) riskInput.value = FORCED_PCT;

    if (badgeEl) {
      badgeEl.classList.remove('hidden');
      badgeEl.innerHTML = `<span class="text-base">🛡️</span><span><span class="font-black">Defensive Mode Active</span> — Monthly Loss ${cooldown.lossPct.toFixed(1)}% ≥ ${cooldown.thresholdPct}%<br><span class="font-normal opacity-80">บัญชีติดลิมิตขาดทุนรายเดือน ระบบบีบให้เล่น ${FORCED_PCT}% max ประคองชีวิตเท่านั้น</span></span>`;
    }
  } else {
    if (badgeEl) badgeEl.classList.add('hidden');
  }

  // Single pass: disable pills > FORCED_PCT only when in cooldown
  document.querySelectorAll('.risk-pct-btn').forEach(btn => {
    const v      = parseFloat(btn.dataset.rpct);
    const locked = inCooldown && v > FORCED_PCT;
    btn.disabled = locked;
    btn.classList.toggle('opacity-30',        locked);
    btn.classList.toggle('cursor-not-allowed', locked);
  });

  if (display) display.innerText = riskPct.toFixed(1) + '%';

  const valid = entryPrice > 0 && stopPrice > 0 && entryPrice > stopPrice && accountSize > 0;

  const setOutputs = (shares, posVal, riskAmt, posPct, rewardAmt, rr) => {
    const s = v => document.getElementById(v);
    if (s('out-shares'))    s('out-shares').innerText    = shares;
    if (s('out-pos-val'))   s('out-pos-val').innerText   = posVal;
    if (s('out-risk-amt'))  s('out-risk-amt').innerText  = riskAmt;
    if (s('out-pos-pct'))   s('out-pos-pct').innerText   = posPct;
    if (s('out-reward-amt')) s('out-reward-amt').innerText = rewardAmt;
    if (s('out-rr'))        s('out-rr').innerText        = rr;
  };

  if (!valid) { setOutputs('0', '-', '-', '-', '-', '-'); return; }

  const res = calculateRisk(accountSize, riskPct, entryPrice, stopPrice, targetPrice, fractional);
  if (res.errors?.length) { setOutputs('0', '-', '-', '-', '-', '-'); return; }

  setOutputs(
    res.shares.toLocaleString(undefined, { maximumFractionDigits: 4 }),
    '$' + res.positionValue.toLocaleString(undefined, { maximumFractionDigits: 2 }),
    '-$' + res.riskAmount.toLocaleString(undefined, { maximumFractionDigits: 2 }),
    res.positionPct.toFixed(1) + '%',
    res.rewardAmount != null ? '+$' + res.rewardAmount.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-',
    res.rrRatio != null ? 'R/R: ' + res.rrRatio.toFixed(1) + 'x' : 'R/R: -',
  );
}

export function applyToRiskCalc(symbol, entry, stop, target, risk) {
  if (state.traderPortfolio) {
    const el = document.getElementById('calc-account-size');
    if (el) el.value = state.traderPortfolio.capital;
  }
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  set('calc-entry-price', entry);
  set('calc-stop-loss',   stop);
  set('calc-target-price', target);
  set('calc-risk-pct',    risk);
  updateRiskCalc();
  switchTab('risk');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─── VI Position Sizing ───────────────────────────────────────────────────────

export function updateVIRiskCalc() {
  if (!state.viPortfolio) return;

  const allocPct   = parseFloat(document.getElementById('vi-alloc-pct')?.value)   || 0;
  const fractional = document.getElementById('vi-frac')?.checked ?? false;
  const curPrice   = parseFloat(document.getElementById('vi-mos-price')?.value)   || 0;
  const fair       = parseFloat(document.getElementById('vi-mos-fair')?.value)    || 0;
  const maxPos     = state.viPortfolio.capital * (allocPct / 100);

  const allocResult = document.getElementById('vi-alloc-result');
  if (allocResult) allocResult.innerText = '$' + maxPos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const sharesEl = document.getElementById('vi-alloc-shares');
  if (sharesEl && curPrice > 0) {
    const maxShares = fractional ? (maxPos / curPrice).toFixed(4) : Math.floor(maxPos / curPrice);
    sharesEl.textContent = `สูงสุดได้ ≈ ${maxShares} shares`;
  } else if (sharesEl) { sharesEl.textContent = ''; }

  const mosPctEl     = document.getElementById('vi-mos-pct');
  const mosRecommend = document.getElementById('vi-mos-recommend');
  const buyResultEl  = document.getElementById('vi-buy-result');
  const buyAmountEl  = document.getElementById('vi-buy-amount');
  const sharesResEl  = document.getElementById('vi-shares-result');
  const warnEl       = document.getElementById('vi-shares-warning');

  if (fair > 0 && curPrice > 0) {
    const mos = ((fair - curPrice) / fair) * 100;
    if (mosPctEl)     { mosPctEl.innerText = mos.toFixed(1) + '%'; mosPctEl.style.color = ''; }

    let label, weight, color, bg, cls;
    if      (mos > 30) { label = 'BUY LARGE';    weight = 1.00; color = '#15803d'; bg = 'bg-green-100';  cls = 'text-green-700'; }
    else if (mos > 20) { label = 'BUY MEDIUM+';  weight = 0.70; color = '#1d4ed8'; bg = 'bg-blue-100';   cls = 'text-blue-700'; }
    else if (mos >= 10){ label = 'BUY MEDIUM';   weight = 0.50; color = '#1d4ed8'; bg = 'bg-blue-100';   cls = 'text-blue-700'; }
    else if (mos >= 5) { label = 'BUY SMALL';    weight = 0.30; color = '#92400e'; bg = 'bg-yellow-100'; cls = 'text-yellow-700'; }
    else if (mos > 0)  { label = 'STARTER';      weight = 0.20; color = '#92400e'; bg = 'bg-yellow-100'; cls = 'text-yellow-700'; }
    else               { label = 'TOO EXPENSIVE'; weight = 0;   color = '#b91c1c'; bg = 'bg-red-100';    cls = 'text-red-700'; }

    if (mosRecommend) { mosRecommend.innerText = label; mosRecommend.className = `px-3 py-1 rounded-full text-xs font-bold ${bg} ${cls}`; }
    if (mosPctEl)     mosPctEl.style.color = color;

    const recBuy = maxPos * weight;
    if (buyResultEl && weight > 0 && maxPos > 0) {
      buyResultEl.classList.remove('hidden');
      if (buyAmountEl) buyAmountEl.textContent = '$' + recBuy.toFixed(2);

      if (curPrice > 0 && sharesResEl) {
        const exact = recBuy / curPrice;
        if (fractional) {
          sharesResEl.innerHTML = `<span class="text-blue-600">≈ ${exact.toFixed(4)} shares</span> <span class="text-gray-400 text-xs">(${Math.round(weight * 100)}% ของ Max $${maxPos.toFixed(2)})</span>`;
          warnEl?.classList.add('hidden');
        } else {
          const whole = Math.floor(exact);
          if (whole < 1) {
            sharesResEl.innerHTML = `<span class="text-orange-500">0 shares (whole)</span>`;
            if (warnEl) { warnEl.classList.remove('hidden'); warnEl.innerHTML = `⚠️ เงินในไม้นี้ ($${recBuy.toFixed(2)}) น้อยกว่าราคาหุ้น ($${curPrice.toFixed(2)}) — ซื้อไม่ได้<br>เปิด Fractional Shares หรือเพิ่ม Max % per Stock`; }
          } else {
            sharesResEl.innerHTML = `<span class="text-blue-600">${whole} shares</span> <span class="text-gray-400 text-xs">(${Math.round(weight * 100)}% ของ Max $${maxPos.toFixed(2)})</span>`;
            warnEl?.classList.add('hidden');
          }
        }
      }
    } else if (buyResultEl) { buyResultEl.classList.add('hidden'); }

  } else {
    if (mosPctEl)     { mosPctEl.innerText = '0.0%'; mosPctEl.className = 'text-3xl font-black text-indigo-700 mb-2'; mosPctEl.style.color = ''; }
    if (mosRecommend) { mosRecommend.innerText = 'Waiting for input...'; mosRecommend.className = 'px-3 py-1 rounded-full text-xs font-bold bg-indigo-100 text-indigo-600'; }
    buyResultEl?.classList.add('hidden');
  }

  _updateVISafetyBadges();
}

async function _updateVISafetyBadges() {
  const badgesEl = document.getElementById('vi-safety-badges');
  if (!badgesEl) return;

  const meta = state.lastViScanMeta;
  if (!meta) { badgesEl.classList.add('hidden'); return; }

  badgesEl.classList.remove('hidden');

  const scoreColor = meta.viScore >= 8 ? '#15803d' : meta.viScore >= 6 ? '#1d4ed8' : '#b45309';
  const scoreBg    = meta.viScore >= 8 ? '#dcfce7' : meta.viScore >= 6 ? '#dbeafe' : '#fef3c7';
  let html = `
    <div class="flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold"
         style="background:${scoreBg};border-color:${scoreColor}20;color:${scoreColor}">
      <span>📊</span>
      <span>VI Score ${meta.viScore}/10 ${meta.verdict} · ${meta.stockMode}</span>
      ${meta.pegRatio != null ? `<span class="ml-auto opacity-70">PEG ${meta.pegRatio.toFixed(2)}</span>` : ''}
    </div>`;

  const apiKey = localStorage.getItem('finnhubApiKey');
  if (apiKey && meta.symbol) {
    try {
      const data = await fetchEarnings(meta.symbol, apiKey);
      badgesEl.innerHTML = html + _earningsBadgeHtml(data);
      return;
    } catch {}
  }
  badgesEl.innerHTML = html;
}

function _earningsBadgeHtml(data) {
  if (!Array.isArray(data) || !data.length) return '';
  const last    = [...data].sort((a, b) => new Date(b.period) - new Date(a.period))[0];
  if (!last?.period) return '';

  const nextEst = new Date(new Date(last.period).getTime() + 90 * 24 * 60 * 60 * 1000);
  const daysLeft = Math.round((nextEst - Date.now()) / (24 * 60 * 60 * 1000));
  if (daysLeft < 0 || daysLeft > 30) return '';

  const urgency = daysLeft <= 5 ? '#b91c1c' : '#92400e';
  const urgBg   = daysLeft <= 5 ? '#fee2e2' : '#fef3c7';
  return `
    <div class="flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold"
         style="background:${urgBg};border-color:${urgency}20;color:${urgency}">
      <span>⚠️</span>
      <span>คาดงบออกใน ~${daysLeft} วัน (ประมาณ ${nextEst.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}) — พิจารณาชะลอซื้อ</span>
    </div>`;
}

export function applyToVIRisk(price) {
  const fairInput = document.getElementById('vi-mos-fair-scan');
  const fairVal   = parseFloat(fairInput?.value) || null;
  const priceEl   = document.getElementById('vi-mos-price');
  const fairEl    = document.getElementById('vi-mos-fair');
  if (priceEl) priceEl.value = price.toFixed(2);
  if (fairVal && fairEl) fairEl.value = fairVal.toFixed(2);
  updateVIRiskCalc();
  switchTab('risk');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

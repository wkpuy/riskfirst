// rules.js - Deterministic rule engine logic for RiskFirst Phase 1

/**
 * SEPA Trend Template Checker (Minervini 8 criteria)
 * @param {Object} data - Contains price, ma50, ma150, ma200, ma200_1moAgo, low52w, high52w, rsRating
 * @returns {Object} result - score, pass/fail per rule, qualifies
 */
export function checkSEPA(data) {
  const { price, ma50, ma150, ma200, ma200_1moAgo, low52w, high52w, rsRating } = data;
  
  const rules = [
    { id: 1, name: "ราคาเหนือ MA150 & MA200", passed: price > ma150 && price > ma200, detail: `${price} > ${ma150}/${ma200}` },
    { id: 2, name: "MA150 > MA200", passed: ma150 > ma200, detail: `${ma150} > ${ma200}` },
    { id: 3, name: "MA200 ขาขึ้น (≥1 เดือน)", passed: ma200 > ma200_1moAgo, detail: `${ma200} > ${ma200_1moAgo}` },
    { id: 4, name: "MA50 > MA150 & MA200", passed: ma50 > ma150 && ma50 > ma200, detail: `${ma50} > ${ma150}/${ma200}` },
    { id: 5, name: "ราคาเหนือ MA50", passed: price > ma50, detail: `${price} > ${ma50}` },
    { id: 6, name: "ห่างจากจุดต่ำ 52w ≥30%", passed: price >= low52w * 1.30, detail: `+${(((price/low52w)-1)*100).toFixed(1)}%` },
    { id: 7, name: "ใกล้จุดสูง 52w ≤25%", passed: price >= high52w * 0.75, detail: `${((1-(price/high52w))*100).toFixed(1)}% below 52w High` },
    { id: 8, name: "RS Rating ≥70", passed: rsRating >= 70, detail: `RS ${rsRating}` }
  ];

  const score = rules.filter(r => r.passed).length;
  const qualifies = score === 8;

  return { rules, score, qualifies };
}

/**
 * 1% Risk Position Calculator
 * @param {number} accountSize 
 * @param {number} riskPct (default 1)
 * @param {number} entryPrice 
 * @param {number} stopPrice 
 * @param {number} targetPrice (Optional)
 * @param {boolean} fractionalAllowed 
 * @returns {Object} result - shares, posValue, posPct, riskAmount, rewardAmount, rrRatio, errors, alerts
 */
export function calculateRisk(accountSize, riskPct, entryPrice, stopPrice, targetPrice, fractionalAllowed) {
  let errors = [];
  let alerts = [];

  if (stopPrice >= entryPrice) {
    errors.push("Stop price must be lower than entry price.");
    return { errors };
  }

  const riskPerTrade = accountSize * (riskPct / 100);
  const riskPerShare = entryPrice - stopPrice;
  const sharesExact = riskPerTrade / riskPerShare;
  const shares = fractionalAllowed ? sharesExact : Math.floor(sharesExact);

  if (shares < 1 && !fractionalAllowed) {
    const minCap = (1 * riskPerShare) / (riskPct / 100);
    errors.push(`Not enough capital for 1 share. Need at least $${minCap.toFixed(2)}.`);
    return { errors, minCap };
  }

  const posValue = shares * entryPrice;
  const posPct = (posValue / accountSize) * 100;
  
  let rewardAmount = null;
  let rrRatio = null;
  
  if (targetPrice && targetPrice > entryPrice) {
    const rewardPerShare = targetPrice - entryPrice;
    rewardAmount = shares * rewardPerShare;
    rrRatio = rewardPerShare / riskPerShare;
  }

  if (posPct > 20) {
    alerts.push("Position is larger than 20% of your portfolio.");
  }

  return {
    shares,
    positionValue: posValue,
    positionPct: posPct,
    riskAmount: shares * riskPerShare,
    rewardAmount,
    rrRatio,
    errors,
    alerts
  };
}

/**
 * Anti-Martingale Pyramid Risk Calculator
 * Second lot must be smaller than first, and combined risk must stay within riskPct.
 * @param {number} accountSize
 * @param {number} riskPct
 * @param {{ shares: number, buyPrice: number, stopPrice: number }} firstLot
 * @param {number} nextEntry   — must be > firstLot.buyPrice (profit requirement)
 * @param {number} nextStop    — new trailing stop for the full position
 * @param {boolean} fractionalAllowed
 */
export function calculatePyramidRisk(accountSize, riskPct, firstLot, nextEntry, nextStop, fractionalAllowed) {
  const errors = [];

  if (nextEntry <= firstLot.buyPrice) {
    errors.push('ห้ามซื้อเพิ่มเด็ดขาด! หุ้นไม้แรกยังไม่มีกำไร (nextEntry ต้องสูงกว่า buyPrice ไม้แรก)');
    return { errors };
  }
  if (nextStop >= nextEntry) {
    errors.push('Stop price ต้องต่ำกว่า Entry price');
    return { errors };
  }

  // Pyramid ceiling: second lot ≤ 50% of first lot
  const ceiling = fractionalAllowed
    ? firstLot.shares * 0.5
    : Math.floor(firstLot.shares * 0.5);

  if (!fractionalAllowed && ceiling < 1) {
    errors.push('จำนวนหุ้นในไม้แรกน้อยเกินไป — ต้องมีอย่างน้อย 2 shares จึงจะ Pyramid ได้');
    return { errors };
  }

  const riskPerShare  = nextEntry - nextStop;
  const sharesRaw     = (accountSize * (riskPct / 100)) / riskPerShare;
  const nextShares    = fractionalAllowed
    ? Math.min(sharesRaw, ceiling)
    : Math.min(Math.floor(sharesRaw), ceiling);

  if (!fractionalAllowed && nextShares < 1) {
    errors.push('ทุนไม่พอสำหรับ 1 share ในไม้ที่สอง');
    return { errors };
  }

  // Combined risk check
  const totalShares    = firstLot.shares + nextShares;
  const totalCost      = (firstLot.buyPrice * firstLot.shares) + (nextEntry * nextShares);
  const newAvgCost     = totalCost / totalShares;
  const combinedRisk   = (newAvgCost - nextStop) * totalShares;
  const combinedRiskPct = (combinedRisk / accountSize) * 100;

  if (combinedRiskPct > riskPct * 1.05) { // 5% tolerance buffer
    errors.push(`ห้ามซื้อเพิ่ม! ต้นทุนเฉลี่ยจะลอยสูงเกินไป — Combined Risk ${combinedRiskPct.toFixed(1)}% เกิน ${riskPct}% ที่ตั้งไว้`);
    return { errors };
  }

  return {
    nextShares,
    nextEntry,
    nextStop,
    newAvgCost,
    totalShares,
    combinedRisk,
    combinedRiskPct,
    positionValue: nextShares * nextEntry,
    errors: [],
    alerts: combinedRiskPct > riskPct * 0.9
      ? [`Combined Risk ใกล้เพดาน: ${combinedRiskPct.toFixed(1)}%`]
      : [],
  };
}

/**
 * Monthly Loss Cooldown checker
 * Returns cooldown state based on net P&L of current calendar month.
 * @param {Array}  closedTrades   — all journal entries of type 'trader'
 * @param {number} capital        — current portfolio capital
 * @param {number} thresholdPct   — default 8%
 */
export function checkMonthlyCooldown(closedTrades, capital, thresholdPct = 8) {
  const now        = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const monthTrades = closedTrades.filter(t =>
    t.status === 'closed' &&
    t.strategy !== 'dividend' &&
    t.shares > 0 &&
    t.createdAt >= monthStart
  );

  const monthlyPnL = monthTrades.reduce(
    (sum, t) => sum + ((t.sellPrice - t.buyPrice) * t.shares), 0
  );

  const lossPct    = capital > 0 ? (Math.abs(Math.min(0, monthlyPnL)) / capital) * 100 : 0;
  const inCooldown = monthlyPnL < 0 && lossPct >= thresholdPct;

  return { inCooldown, monthlyPnL, lossPct, thresholdPct, tradesThisMonth: monthTrades.length };
}

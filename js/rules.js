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

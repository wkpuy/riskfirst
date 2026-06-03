import { calculateRisk, checkSEPA } from './rules.js';

function assert(condition, message) {
  if (!condition) {
    console.error("❌ TEST FAILED:", message);
  } else {
    console.log("✅ TEST PASSED:", message);
  }
}

console.log("--- Running Risk Calculator Tests ---");
const test1 = calculateRisk(550, 1.0, 875.40, 813.90, 998.40, false);
assert(test1.shares === 8, "Shares should be 8 (floored from 8.94)");
assert(Math.abs(test1.positionValue - 7003.20) < 0.1, "Position value should be ~7003.20");
assert(Math.abs(test1.riskAmount - 492) < 0.1, "Risk amount should be 492");
assert(Math.abs(test1.rewardAmount - 984) < 0.1, "Reward amount should be 984");
assert(test1.rrRatio === 2.0, "R/R Ratio should be 2.0");

const test2 = calculateRisk(550, 1.0, 875.40, 813.90, null, true);
assert(test2.shares > 8.9 && test2.shares < 9.0, "Fractional shares should be ~8.94");

console.log("--- Running SEPA Tests ---");
const sepaPass = checkSEPA({
  price: 150,
  ma50: 140,
  ma150: 120,
  ma200: 100,
  ma200_1moAgo: 90,
  low52w: 80,
  high52w: 160,
  rsRating: 85
});
assert(sepaPass.qualifies === true, "Should pass all SEPA criteria");
assert(sepaPass.score === 8, "Score should be 8");

const sepaFail = checkSEPA({
  price: 90, // fails price > ma150/200, price > ma50
  ma50: 140,
  ma150: 120,
  ma200: 100,
  ma200_1moAgo: 90,
  low52w: 80,
  high52w: 160,
  rsRating: 50 // fails rsRating
});
assert(sepaFail.qualifies === false, "Should fail SEPA criteria");
assert(sepaFail.score < 8, "Score should be < 8");

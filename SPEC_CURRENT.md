# RiskFirst — Current Spec (อัปเดตล่าสุด 2026-06-04)

> เอกสารนี้คือ **สถานะปัจจุบันของโปรเจกต์จริง** (ยึดโค้ดเป็น source of truth)
> ใช้ส่งต่อ AI chat ใหม่เพื่อทำงานต่อได้ทันที

---

## 1. ภาพรวม

PWA (Progressive Web App) สำหรับ iPhone ใช้ส่วนตัวคนเดียว
ช่วยตัดสินใจเทรด/ลงทุนหุ้น US — ไม่มี backend, ไม่มี auth, ข้อมูลเก็บใน browser

**2 โมดูล:**
- **Trader** (Dark theme) — Momentum trading สไตล์ Minervini (SEPA)
- **Value Investor (VI)** (Light theme) — Fundamental / ถือยาว (Buffett + Lynch)

---

## 2. Tech Stack

| ส่วน | เทคโนโลยี |
|------|-----------|
| Frontend | HTML + Tailwind CSS (CDN) + Vanilla JS (ES Modules) |
| Storage | IndexedDB (journal, watchlist, portfolio) + localStorage (API keys, settings, cache) |
| Data: ราคาปัจจุบัน | Finnhub API (`/quote`, `/stock/profile2`, `/stock/metric`, `/stock/earnings`) |
| Data: Historical candles (MA/ATR/Regime) | Twelve Data API (`/time_series`) |
| Hosting | Python `http.server` local / static host |
| PWA | manifest.json + sw.js (network-first) |

**ไม่มี backend** — API calls ทำจาก browser โดยตรง (CORS supported)

---

## 3. โครงสร้างไฟล์

```
riskfirst/                    ← root (ไม่มี /web subfolder อีกต่อไป)
├── index.html                ← UI หลัก (HTML only, ไม่มี inline script logic)
├── guide.html                ← คู่มือระบบฉบับสมบูรณ์ (ทฤษฎี + สูตรทุกอย่าง)
├── manifest.json
├── sw.js
├── css/
│   └── app.css               ← CSS ทั้งหมด (แยกออกจาก HTML แล้ว)
└── js/
    ├── app.js                ← Entry point + window.* bindings (~160 บรรทัด)
    ├── db.js                 ← IndexedDB wrapper
    ├── rules.js              ← checkSEPA() + calculateRisk() (pure functions)
    ├── config.js             ← Constants (CACHE_TTL, ATR_MULTIPLIER ฯลฯ)
    ├── cache.js              ← getCached/setCache + QuotaExceeded eviction
    ├── state.js              ← Shared mutable state
    ├── api.js                ← Finnhub + TwelveData fetch helpers
    ├── indicators.js         ← calcMA, calcATR, calcRSRating (pure math)
    ├── ui.js                 ← showToast, showConfirm, openModal/closeModal
    ├── nav.js                ← switchModule, switchTab, modal functions
    ├── regime.js             ← Market Regime (SPY+QQQ vs MA200)
    ├── watchlist.js          ← Watchlist CRUD
    ├── portfolio.js          ← Capital modal, syncPrices, reallocation
    ├── risk-calc.js          ← updateRiskCalc, updateVIRiskCalc, applyTo*
    ├── vi-scan.js            ← VI scan + VI Quality Score
    ├── trader-scan.js        ← scanStock, scanAllWatchlist, selectTarget
    └── journal.js            ← loadDashboard, trade CRUD, journal rendering
```

**Cross-module communication:**
- `document.dispatchEvent(new Event('riskfirst:refresh'))` → reload dashboard
- `state.js` — shared mutable state ที่ทุก module import ตรงๆ
- `window.*` ใน app.js สำหรับ HTML onclick handlers

---

## 4. API Keys (เก็บใน localStorage)

| Key | ใช้ทำอะไร |
|-----|----------|
| `finnhubApiKey` | ราคาปัจจุบัน, company profile, VI metrics (P/E, ROE ฯลฯ), earnings dates |
| `twelvedataApiKey` | Historical candles → MA50/150/200, ATR, Market Regime (SPY/QQQ) |

**ตั้งค่าที่:** ปุ่ม ⚙️ → API Settings · บันทึกใน browser เท่านั้น

**ข้อจำกัด Free tier:**
- Finnhub: ไม่มี historical candle → ใช้ได้แค่ quote + metrics
- Twelve Data: 800 req/day, 8/min — รองรับ CORS จาก browser ✓

---

## 5. Features ที่ทำงานได้แล้ว ✅

### Trader Module

#### 5.1 Market Regime Banner
- ดึง SPY + QQQ จาก Twelve Data → ตรวจสอบ vs MA200
- **BULL** = ทั้งคู่เหนือ MA200 → เปิด Long ได้
- **BEAR** = อย่างน้อย 1 ตัวต่ำกว่า → งดเปิด Long ใหม่
- Cache 6 ชั่วโมงใน localStorage
- ถ้าไม่มี API key → แสดง "ยังไม่ได้ตั้งค่า" + link ไปตั้งค่า

#### 5.2 Scan (Real Data)
- Search ticker → Finnhub `/quote` + `/profile2` + Twelve Data candles
- คำนวณ MA50, MA150, MA200, MA200 (1 เดือนก่อน), 52w High/Low, ATR14
- **ATR** = Wilder's Smoothing 14 bars (ไม่ใช่ Simple Average)
- **RS Rating** = เทียบ 1-year return vs SPY (252-bar window เดียวกัน)
- รัน SEPA 8 เกณฑ์ → แสดง PASS/FAIL พร้อม Checklist ตัวเลขจริง
- แสดง Earnings Window: 🚫 0–5 วัน / ⚠️ 6–14 วัน / 🎯 3–45 วันหลังงบ (Post-Earnings)

#### 5.3 Composite Score & Scan All
- Score 0–100: `(RS/99)×40 + (SEPA/8)×25 + Proximity×25 + VolDry×10`
- ปุ่ม **Scan All** ใน Watchlist → ดึงข้อมูลทุกตัว + จัดอันดับ Top Picks
- Rate limit handler: รอ 62 วินาทีระหว่าง batch (8 req/min ของ Twelve Data)

#### 5.4 Profit Targets (Selectable)
- เลือกได้: **2R / 3R / 52w High** ก่อนคำนวณ Risk
- แสดง R/R ratio ของแต่ละ target + ตำแหน่ง 52w High เทียบ 2R/3R

#### 5.5 ATR Stop Loss
- Stop = `max(entry × 0.01, entry − ATR × 2.5)` (มี floor ป้องกัน negative)
- ใกล้งบ: แนะนำ 3.0×ATR แทน

#### 5.6 Risk Calculator (1% Rule)
- Account Size sync จาก PORT อัตโนมัติ
- **Risk %** เลือกได้ 4 ตัว: 0.5% / 1% / 2% / 3% (pill buttons, mobile-friendly)
- Entry, Stop, Target → shares, position value, Max Loss, Max Gain, R/R
- Fractional Shares toggle
- Alert ถ้า position > 20% ของพอร์ต

#### 5.7 Watchlist
- Add/Remove tickers + **Bulk Add** วางหลายตัวพร้อมกัน
- แยก Trader watchlist และ VI watchlist
- Scan All → จัดอันดับ Composite Score

#### 5.8 Trade Journal
- บันทึก Open / Closed trades พร้อม Strategy tag + TradingView link
- ปิดไม้ → อัปเดต capital อัตโนมัติ
- Stats: PnL, Win Rate, Avg R/R, Profit Factor
- กรองตาม timeframe: All / 1M / 1W
- Top Performers
- Export/Import JSON backup
- Sync Capital Modal

### VI Module (ข้อมูลจริงทั้งหมด — ไม่ใช่ mock)

#### 5.9 VI Scan
- Finnhub `/metric` → P/E, P/B, ROE, ROA, EPS Growth, Revenue Growth, Beta, 52w High/Low
- แยก **Growth** (EPS >25% หรือ Revenue >20%) vs **Value** อัตโนมัติ
- **VI Quality Score 0–10** จาก 10 เกณฑ์ (นับเฉพาะ valid checks เป็น denominator)
- Negative Equity detection → ไม่หักคะแนน ROE/P/B แต่แสดง warning
- Inline **MOS Calculator**: กรอก Fair Value → แสดงราคาซื้อ + สถานะ
- Verdict: STRONG BUY 💎 / BUY ✅ / WATCH 👀 / AVOID 🚫

#### 5.10 VI Position Sizing
- **Fixed Allocation** (Rule 1): max % ต่อหุ้น — **บันทึกอัตโนมัติ** ไม่ต้องพิมพ์ซ้ำ
- **MOS Weighting** (Rule 2): buy amount = max position × น้ำหนักตาม MOS tier
  - >30% = BUY LARGE (100%), 20–30% = BUY MEDIUM+ (70%), 10–20% = MEDIUM (50%)
  - 5–10% = SMALL (30%), <5% = STARTER (20%), <0% = ห้ามซื้อ
- Fractional toggle — บันทึกอัตโนมัติ
- Safety badges: VI Score + คาดงบออกเมื่อไหร่ (ประมาณ)

#### 5.11 VI Portfolio Reallocation
- Sync Prices จาก Finnhub (15 นาที cache)
- TRIM/SELL / ADD MORE / HOLD / REVIEW ตาม Fair Value vs ราคาปัจจุบัน
- Grouped by symbol (รวม avg cost ถ้ามีซื้อหลายครั้ง)

#### 5.12 VI Journal
- Grouped open positions (avg cost)
- Dividend log (บวกพอร์ต VI)
- Closed positions

---

## 6. IndexedDB Schema

```
DB: RiskFirstDB (version 3)

journal store:
  - id (autoIncrement)
  - symbol, type ('trader'|'vi'), status ('open'|'closed')
  - buyPrice, sellPrice, shares
  - stopPrice, targetPrice
  - strategy, chartLink
  - accountSize, riskPct, plannedLoss, plannedWin, rrRatio, targetLabel
  - viMeta (object — VI quality data)
  - strategy: 'dividend' = เงินปันผล
  - isApplied (bool), createdAt (timestamp)

portfolio store:
  - id: 'main-trader' | 'main-vi'
  - capital, initialCapital

watchlist store:
  - id (autoIncrement)
  - symbol, type ('trader'|'vi'), addedAt
```

---

## 7. localStorage keys

| Key | ค่า | หมายเหตุ |
|-----|-----|---------|
| `finnhubApiKey` | string | Finnhub API key |
| `twelvedataApiKey` | string | Twelve Data API key |
| `regimeCache` | JSON | {ts, bullish, spyAbove, qqqAbove, spyCloses} · TTL 6h |
| `fhQ_<SYM>` | JSON | Finnhub quote cache · TTL 10 min |
| `fhP_<SYM>` | JSON | Finnhub profile cache · TTL 24h |
| `fhM_<SYM>` | JSON | Finnhub metric cache · TTL 24h |
| `fhE_<SYM>` | JSON | Finnhub earnings cache · TTL 24h |
| `tdC_<SYM>` | JSON | Twelve Data candles (parsed {c,h,l,v}) · TTL 6h |
| `priceCache` | JSON | {symbol: price} จาก Sync Prices |
| `lastViScanMeta` | JSON | VI scan result ล่าสุด (fallback) |
| `vi_alloc_pct` | string | Max % per Stock setting (auto-saved) |
| `vi_frac` | 'true'/'false' | Fractional Shares setting (auto-saved) |

---

## 8. Business Logic (rules.js)

### checkSEPA(data)
Input: `{ price, ma50, ma150, ma200, ma200_1moAgo, low52w, high52w, rsRating }`

| # | กฎ | เงื่อนไขผ่าน |
|---|---|---|
| 1 | ราคาเหนือ MA150 & MA200 | `price > ma150 && price > ma200` |
| 2 | MA150 > MA200 | `ma150 > ma200` |
| 3 | MA200 ขาขึ้น ≥1 เดือน | `ma200 > ma200_1moAgo` |
| 4 | MA50 > MA150 & MA200 | `ma50 > ma150 && ma50 > ma200` |
| 5 | ราคาเหนือ MA50 | `price > ma50` |
| 6 | ห่างจากจุดต่ำ 52w ≥30% | `price >= low52w * 1.30` |
| 7 | ใกล้จุดสูง 52w ≤25% | `price >= high52w * 0.75` |
| 8 | RS Rating ≥70 | `rsRating >= 70` |

Rule 7 detail แสดง: `"X% below 52w High"` (ไม่ใช่ negative %)

Returns: `{ rules[], score (0-8), qualifies (bool) }`

### calculateRisk(accountSize, riskPct, entryPrice, stopPrice, targetPrice, fractionalAllowed)
Returns: `{ shares, positionValue, positionPct, riskAmount, rewardAmount, rrRatio, errors[], alerts[] }`

Edge cases:
- `stopPrice >= entryPrice` → error
- `shares < 1 && !fractional` → error + minCapitalNeeded
- `positionPct > 20` → alert

### ATR (indicators.js)
Wilder's Smoothing 14 bars:
```
ATR[0] = SMA(TR, 14)
ATR[i] = (ATR[i-1] × 13 + TR[i]) / 14
stop   = max(entry × 0.01, entry − ATR × 2.5)
```

### RS Rating (indicators.js)
```
stockRet = (close[-1] - close[-252]) / close[-252] × 100
spyRet   = (spy[-1]   - spy[-252])   / spy[-252]   × 100
RS       = clamp(round(50 + (stockRet - spyRet) × 0.6), 1, 99)
```
ใช้ window 252 bars เดียวกันทั้ง stock และ SPY

---

## 9. Workflow การใช้งาน (ปัจจุบัน)

### Trader
```
1. ตรวจ Market Regime (BULL/BEAR) ก่อนเสมอ
2. วาง tickers หลายตัวพร้อมกันลง Watchlist
3. กด Scan All → ดู Top Picks เรียงตาม Score
4. กดหุ้นที่สนใจ → Scan เต็มรูปแบบ
5. ดู SEPA Checklist + Earnings Window + ATR Stop
6. เลือก Target (2R / 3R / 52w High)
7. กด "คำนวณ Risk" → ไป Risk Calculator (ดึง PORT อัตโนมัติ)
8. ตรวจ Risk% pill (default 1%) → ดู shares, Max Loss, Max Gain
9. บันทึกเข้า Journal (Open Position)
10. เมื่อขาย → "ปิดไม้" → อัปเดต capital อัตโนมัติ
```

### VI
```
1. Scan ticker → ดู VI Quality Score + Growth/Value mode
2. ดู VI Checklist + Key Numbers
3. กรอก Fair Value ใน MOS Calculator → ดูว่าซื้อได้ไหม
4. กด "คำนวณ Position Size" → ไป Risk/Port
5. ปรับ Max % per Stock (ตั้งครั้งเดียว, auto-save)
6. ดู Buy Amount ตาม MOS tier
7. บันทึกเข้า VI Journal
8. ใช้ Sync Prices + Portfolio Reallocation ดู HOLD/ADD/TRIM
```

---

## 10. Bug Fixes (June 2026 — ทำเสร็จแล้ว)

### 🔴 Critical (5 ข้อ)
- **#1** updateJournalEntry signature ผิด → แก้ db.js รับ (id, partial) แล้ว merge
- **#2** runCapitalSync() ลบ dividend → แก้ให้รวม dividend entries
- **#3 + #4** exportAllData/importAllData ไม่ครบ VI → แก้ export ทั้ง Trader + VI
- **#5** evaluateHoldings() ยัง mock → ลบออก ใช้ renderReallocation() จริง

### 🟠 High (5 ข้อ)
- **#6** RS Rating ใช้ window ต่างกัน → standardize 252 bars ทั้ง stock และ SPY
- **#7** ATR ใช้ Simple Average → เปลี่ยนเป็น Wilder's Smoothing
- **#8** addJournalEntry ทับ createdAt → แก้ order spread operator
- **#9** VI Journal "No Trades" → ลบปุ่ม openTradeModal('vi') ออก
- **#10** confirm/prompt iOS PWA → แทนด้วย custom showConfirm modal

### 🟡 Trading Logic (5 ข้อ)
- **#11** Earnings label → เพิ่ม "ประมาณ" ทุก banner
- **#12** SEPA Rule 7 detail → เปลี่ยนจาก "-1.4%" เป็น "1.4% below 52w High"
- **#13** Post-Earnings window แคบ → ขยายจาก 3–14 วัน เป็น 3–45 วัน
- **#14** Proximity ใน scanAll ต่างกัน → standardize เป็น 0–1 ทั้งสองฟังก์ชัน
- **#15** VI Score นับ na เป็น fail → ใช้ validChecks เป็น denominator

### 🟢 UX/Data (5 ข้อ)
- **#16** localStorage QuotaExceeded → evict oldest entries อัตโนมัติ
- **#17** ATR Stop ติดลบ → floor = max(entry×0.01, entry−ATR×2.5)
- **#18** Scan All button หายหลัง scan → เพิ่ม "Scan Again" button
- **#19** Market Regime "Loading..." ตลอด → แสดง "ยังไม่ได้ตั้งค่า" + link
- **#20** setCache TD candles ใหญ่ → เก็บ parsed {c,h,l,v} แทน raw JSON (~50% ประหยัด)

---

## 11. หลักการสำคัญ (ห้ามละเมิด)

1. **Deterministic-first** — ตัวเลขทุกตัวต้องคำนวณได้ซ้ำ ไม่ใช่ AI แต่งเอง
2. **AI narrates, human decides** — ระบบให้ข้อมูล ผู้ใช้ตัดสินใจเอง
3. **Free & single-user** — ไม่มี auth, ไม่มี multi-tenant, API ฟรีทั้งหมด
4. **ยึดโค้ดเป็น source of truth** — `trading_app_spec.md` เดิมล้าสมัย อย่า follow

---

## 12. วิธีรัน Local

```bash
cd /Users/mtb730773/riskfirst
python3 -m http.server 3456
# เปิด http://localhost:3456/index.html
# คู่มือ: http://localhost:3456/guide.html
```

---

## 13. TODO / Next Steps

| Priority | รายการ | หมายเหตุ |
|----------|--------|---------|
| 🟡 Medium | RS Rank true percentile | ตอนนี้ใช้ excess return vs SPY (approximate) — ยังไม่ใช่ true cross-sectional rank |
| 🟡 Medium | Watchlist scan status badge | แสดง SEPA score / last scan time บน watchlist card โดยไม่ต้อง scan ซ้ำ |
| 🟡 Medium | SW cache ใน production | Service Worker ยัง unregister ตัวเอง (อยู่ระหว่างพัฒนา) |
| 🟢 Low | Top 5 Picks daily cron | Auto-scan universe ทุกเช้า (ต้องมี backend) |
| 🟢 Low | Piotroski F-Score | ยังไม่ implement จริง (อยู่ใน spec เดิมแต่ยังไม่มี data source) |
| 🟢 Low | DCF Calculator | เป็น manual input เท่านั้นตอนนี้ |

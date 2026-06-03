# Personal Trading Web App — Build Spec (สำหรับ Claude Code)

> เอกสารนี้คือ requirement + implementation guide สำหรับให้ Claude Code สร้างแอปทีละ phase
> เขียนเป็นภาษาไทย (narrative) + English (technical terms / code / formulas)

---

## 0. วิธีใช้เอกสารนี้กับ Claude Code

- เริ่มที่ **Phase 1** เสมอ อย่าให้ Claude Code กระโดดไปสร้างทั้งระบบในครั้งเดียว
- แต่ละ rule engine ต้องมาพร้อม **unit test** ที่ทดสอบกับค่าตัวอย่าง (ทำให้มั่นใจว่า logic ถูก)
- คำสั่งเริ่มต้นที่แนะนำ:
  > "อ่าน `trading_app_spec.md` แล้วเริ่มทำ Phase 1 เท่านั้น: สร้าง 1% Risk Calculator และ SEPA Trend Template checker เป็น client-side ใน `/web` พร้อม unit test สำหรับ logic"

---

## 1. ภาพรวมโปรเจกต์ (Project Overview)

แอปช่วยตัดสินใจเทรด/ลงทุนหุ้น **US** ใช้งานส่วนตัวคนเดียวบน iPhone (PWA) แบ่งเป็น 2 โหมดตาม mindset

- **Module 1 — Day Trade / Short-term** (ธีมมืด): สาย momentum วินัยเหล็ก
- **Module 2 — Value Investor (VI)** (ธีมสว่าง): สายพื้นฐาน ถือยาว

**เป้าหมายหลัก:** เครื่องมือให้ "ข้อมูลครบ" เพื่อให้ผู้ใช้ตัดสินใจเอง ไม่ใช่ระบบที่ "สั่งซื้อ" แทน

### Target market & scope (ฉบับเริ่มต้น)
- หุ้น US (NYSE / NASDAQ) เป็นหลัก
- หุ้นไทยเป็น future enhancement (ต้องเปลี่ยน data source — ดู §7)

---

## 2. หลักการสำคัญ 3 ข้อ (CRITICAL — ห้ามละเมิด)

1. **Deterministic-first**
   เครื่องมือ/indicator/screener ทุกตัวต้องเป็นกฎตัวเลขที่คำนวณซ้ำได้และ backtest ได้
   LLM **ห้าม** เป็นผู้ตัดสิน signal หรือสร้างราคา/ตัวเลขเอง (มัน hallucinate)

2. **AI narrates, human decides**
   LLM (Gemini) มีหน้าที่เดียว: เอา output ตัวเลขจาก rule engine มาเรียบเรียงเป็นภาษาคน + ชี้จุดเสี่ยง
   ไม่มีปุ่ม "AI สั่งซื้อ" — output เป็น **briefing** ไม่ใช่ command

3. **Free & single-user**
   ใช้ของฟรีทั้งหมด, ใช้คนเดียว (ไม่ต้องทำ auth / multi-tenant / user management)

---

## 3. Tech Stack

| ส่วน | เทคโนโลยี | หมายเหตุ |
|---|---|---|
| Frontend | HTML + Tailwind (CDN) + vanilla JS, PWA | single-column mobile-first, Add to Home Screen |
| Chart | TradingView embedded widget | dark theme สำหรับ Module 1 |
| Backend | **Go + Echo** | thin proxy + rule engine |
| Stock data | Alpha Vantage (หลัก) + Finnhub (สำรอง) | ดู §7 rate limit |
| LLM | Google Gemini Flash (free tier) | narrate only |
| Cache DB | SQLite (`modernc.org/sqlite` แบบ pure-Go) | server-side cache |
| Client storage | IndexedDB | journal + watchlist + price cache |
| Backup | Google Drive (manual export JSON) | ดู §8 |
| Hosting | Cloudflare Pages (web) + Fly.io/Render (Go) | free tier |

---

## 4. สถาปัตยกรรม (Architecture)

```
iPhone PWA (web/)
  ├─ IndexedDB: trade journal, watchlist, price cache
  ├─ Export JSON ──► Google Drive (manual backup)
  └─ HTTPS ──► Go backend
                 ├─ ซ่อน API key + เลี่ยง CORS (proxy)
                 ├─ rule engine (deterministic) ◄── Stock data API (AV/Finnhub) + SQLite cache
                 └─ ส่ง output ──► Gemini (narrate only) ──► briefing กลับ PWA
```

**Flow ของหนึ่ง request (เช่น scan หุ้นตัวหนึ่ง):**
1. PWA เรียก `GET /api/analyze?symbol=NVDA`
2. Go ดึงราคา/งบจาก cache (ถ้าไม่มี/หมดอายุ → เรียก API จริง แล้ว cache)
3. Go รัน rule engine → ได้ผลเป็น struct ตัวเลข (pass/fail แต่ละกฎ)
4. (optional) Go ส่งผลให้ Gemini เรียบเรียงเป็น briefing 3 บรรทัด
5. Go ส่ง JSON `{rules: {...}, briefing: "..."}` กลับ PWA
6. PWA แสดงผล — ผู้ใช้ตัดสินใจเอง

---

## 5. โครงสร้างโปรเจกต์ Go (แนะนำ)

```
.
├── cmd/server/main.go
├── internal/
│   ├── config/          # env vars, API keys (จาก env เท่านั้น ห้าม hardcode)
│   ├── handler/         # Echo handlers + routes
│   ├── service/         # orchestration (เรียก datasource + ruleengine + llm)
│   ├── ruleengine/      # *** deterministic logic ทั้งหมด พร้อม _test.go ***
│   │   ├── sepa.go
│   │   ├── regime.go
│   │   ├── relativestrength.go
│   │   ├── atr.go
│   │   ├── risk.go
│   │   ├── capital_aware.go
│   │   ├── scoring.go        # NEW: composite score + top 5 ranking
│   │   ├── portfolioheat.go
│   │   ├── piotroski.go
│   │   ├── altman.go
│   │   ├── dcf.go
│   │   └── expectancy.go
│   ├── datasource/      # AlphaVantage + Finnhub clients + rate limiter
│   ├── llm/             # Gemini client (narrate only)
│   ├── store/           # SQLite cache layer
│   └── model/           # shared structs
├── web/                 # PWA (static)
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js
│   ├── js/
│   └── css/
└── README.md
```

**Convention:**
- API key อ่านจาก env (`ALPHAVANTAGE_API_KEY`, `FINNHUB_API_KEY`, `GEMINI_API_KEY`) เท่านั้น
- ทุกฟังก์ชันใน `ruleengine/` ต้องเป็น pure function (input → output) ไม่มี side effect → test ง่าย
- ใช้ `golang.org/x/time/rate` ทำ rate limiter คุมโควต้า API

---

## 6. รายละเอียด Rule Engine (สูตรสำหรับ implement)

> ทุกตัวต้องมี unit test เทียบกับค่าตัวอย่างที่คำนวณมือได้

### 6.1 SEPA Trend Template (Module 1) — Minervini 8 เกณฑ์
Input: `price, ma50, ma150, ma200, ma200_1moAgo, low52w, high52w, rsRating`

| # | กฎ | เงื่อนไขผ่าน |
|---|---|---|
| 1 | ราคาเหนือ MA ยาว | `price > ma150 && price > ma200` |
| 2 | MA เรียงตัว | `ma150 > ma200` |
| 3 | MA200 ขาขึ้น (≥1 เดือน) | `ma200 > ma200_1moAgo` |
| 4 | MA50 นำ | `ma50 > ma150 && ma50 > ma200` |
| 5 | ราคาเหนือ MA50 | `price > ma50` |
| 6 | ห่างจากจุดต่ำ ≥30% | `price >= low52w * 1.30` |
| 7 | ใกล้จุดสูง ≤25% | `price >= high52w * 0.75` |
| 8 | RS Rating ≥70 | `rsRating >= 70` (ดีสุด ≥80) |

Output: ผ่านกี่/8, รายการที่ fail, verdict (ผ่านทั้ง 8 = qualifies)

### 6.2 Market Regime Filter (Module 1) — ตัวกันขาดทุนสำคัญสุด
Input: `indexClose, indexMA200`
- `bullish = indexClose > indexMA200`
- ถ้า `!bullish` → ระบบเตือน "regime แดง อย่าเปิด long ใหม่"

### 6.3 Relative Strength Ranking (Module 1)
- เวอร์ชันง่าย: weighted performance score
  `score = 0.4*ret(63d) + 0.2*ret(126d) + 0.2*ret(189d) + 0.2*ret(252d)`
  (ret = % return ช่วงนั้น, 63 วัน ≈ 1 ไตรมาส)
- จัด percentile rank (1–99) เทียบ universe ที่ scan → ได้ `rsRating` ใช้ใน SEPA #8

### 6.4 ATR-based Stop Loss (Module 1)
- `ATR = SMA(TrueRange, 14)` โดย `TrueRange = max(high-low, |high-prevClose|, |low-prevClose|)`
- `stop = entry - (ATR * multiplier)` (multiplier ค่าเริ่มต้น 2.5)

### 6.5 1% Risk Calculator (Module 1) — ทำใน Phase 1 (client-side ได้)
Input: `accountSize, riskPct (default 1), entryPrice, stopPrice, fractionalAllowed bool`
```
riskPerTrade  = accountSize * (riskPct/100)
riskPerShare  = entryPrice - stopPrice           // ต้อง > 0
sharesExact   = riskPerTrade / riskPerShare
shares        = fractionalAllowed ? sharesExact : floor(sharesExact)
positionValue = shares * entryPrice
positionPct   = positionValue / accountSize * 100
```
Output: `shares, positionValue, positionPct, riskPerTrade`

Edge cases:
- `stopPrice >= entryPrice` → error "stop ต้องต่ำกว่าราคาเข้า"
- `shares < 1 && !fractionalAllowed` → error พร้อม `minCapitalNeeded` (ดู §6.12)
- `positionPct > 20` → warning "position กระจุกเกิน 20% ของพอร์ต"

### 6.6 Portfolio Heat (ข้าม module)
Input: array ของ open positions แต่ละตัวมี `riskAmount` (= shares × (entry−stop))
```
totalHeat = sum(riskAmount) / accountSize * 100
```
- เตือนเมื่อ `totalHeat > maxHeatPct` (default 6%)

### 6.7 Piotroski F-Score (Module 2) — 9 คะแนน
ต้องการงบ 2 ปีล่าสุด ให้คะแนน 1 ถ้าผ่าน:
- Profitability: (1) ROA>0 (2) OCF>0 (3) ROA โตกว่าปีก่อน (4) OCF>NetIncome
- Leverage/Liquidity: (5) LT debt ratio ลดลง (6) current ratio เพิ่ม (7) ไม่ออกหุ้นใหม่
- Efficiency: (8) gross margin เพิ่ม (9) asset turnover เพิ่ม

Verdict: `>=7` แข็งแกร่ง, `<=2` อ่อนแอ

### 6.8 Altman Z-Score (Module 2) — กรองเสี่ยงล้มละลาย
```
Z = 1.2*(WC/TA) + 1.4*(RE/TA) + 3.3*(EBIT/TA) + 0.6*(MktCap/TotalLiab) + 1.0*(Sales/TA)
```
- `Z > 2.99` ปลอดภัย, `1.81–2.99` เทา, `< 1.81` เสี่ยงสูง

### 6.9 DCF (Module 2) — scenario ไม่ใช่ตัวเลขเดียว
Input: `fcf0, growthRate g, discountRate r (WACC), years N, terminalGrowth tg, shares, netDebt`
```
PV_FCF   = Σ_{t=1..N} fcf0*(1+g)^t / (1+r)^t
TV       = fcf0*(1+g)^N*(1+tg) / (r - tg)
PV_TV    = TV / (1+r)^N
EV       = PV_FCF + PV_TV
Equity   = EV - netDebt
Intrinsic= Equity / shares
```
- รัน 3 ชุด: **bear / base / bull** (ต่างกันที่ g และ r) → output เป็น **ช่วงราคา**
- `marginOfSafety = (intrinsic - price) / intrinsic * 100`
- Alert เขียวเมื่อ `marginOfSafety >= 20–30%`

### 6.10 Expectancy (ข้าม module) — ปิด loop จาก journal
Input: ประวัติเทรดที่ปิดแล้วจาก journal
```
winRate    = wins / total
lossRate   = 1 - winRate
expectancy = (winRate * avgWin) - (lossRate * avgLoss)
```
- `expectancy > 0` = กลยุทธ์มี edge เชิงสถิติ

### 6.11 Behavioral Guards (UI logic)
- **Pre-trade checklist**: บังคับตอบครบก่อนเปิดฟอร์มซื้อ (regime ผ่าน? heat เกิน? earnings ใกล้?)
- **Loss Cooldown**: ถ้าขาดทุนติดกัน N ครั้ง → หน่วง/เตือนก่อนเทรดใหม่
- **Rule-break Flag**: ถ้า position size เกินที่ 1% calculator แนะนำ → เด้งถามยืนยัน

### 6.13 Universe & Top 5 Daily Picks

#### Universe Composition (A+B Hybrid)
```
Static List (A): S&P 500 + Nasdaq 100
  - ดึง list ฟรีจาก github.com/datasets/s-and-p-500-companies
  - เก็บเป็น CSV ในโปรเจกต์ อัปเดต manual รายไตรมาส
  - รวม ~600 symbols

Pre-filter (B): กรองออกก่อน scan
  - market cap > $1B
  - avg daily volume > 500,000 shares
  - price > $10 (ตัด penny stocks)
  - Altman Z > 1.81 (ตัดเสี่ยงล้มละลาย)

ผลลัพธ์ universe จริง: ~400 ตัว
```

#### Hard Filter (ต้องผ่านทุกข้อก่อนเข้า scoring)
```
1. SEPA Trend Template ≥ 7/8
2. Market Regime = bullish (SPY & QQQ เหนือ MA200)
3. Capital suitability ≠ 🔴  (หรือ fractionalEnabled = true)
4. Earnings date ไม่อยู่ใน 5 วันข้างหน้า (ป้องกัน gap เสี่ยง)
```

#### Composite Scoring (0–100) — deterministic ทั้งหมด
```go
score = (rsRank/99.0)                          * 40   // RS แรงสุดในตลาด
      + (float64(sepaScore)/8.0)               * 25   // ผ่านครบดีกว่า
      + proximity                              * 25   // ใกล้ 52w high = ใกล้ breakout
      + volumeDryScore                         * 10   // volume แห้งลง = VCP กำลังบีบ

// proximity = 1 - ((high52w - price) / high52w)
// volumeDryScore = 1 - (avgVol5d / avgVol20d)  clamp 0–1
//   ถ้า volume 5 วันล่าสุดแห้งกว่า 20 วัน = score สูง
```

#### Top 5 Output Format
```json
{
  "date": "2026-06-03",
  "regime": "bullish",
  "totalQualified": 12,
  "picks": [
    {
      "rank": 1,
      "symbol": "AXON",
      "score": 87.2,
      "sepa": "8/8",
      "rsRank": 94,
      "proximityToHigh": 0.04,
      "capitalSuitability": "suitable",
      "briefing": "..."
    }
  ]
}
```

#### กรณีพิเศษ (ต้องรองรับทุกกรณี)
```
totalQualified = 0
→ แสดง "วันนี้ไม่มี setup ที่ผ่านเกณฑ์"
→ ถ้า regime = bearish → "Regime แดง — งดเปิด long ใหม่"
→ ไม่ต้องรัน scoring เลย ประหยัด API call

totalQualified < 5
→ แสดงทุกตัวที่มี + note "วันนี้มี X ตัวที่ผ่านเกณฑ์"

totalQualified ≥ 5
→ แสดง top 5 ตาม score
→ ผู้ใช้กด "ดูทั้งหมด" เพื่อดูที่เหลือได้
```

#### API Refresh Cadence (คุม quota 250 calls/วัน)
```
Priority 1 — ทุกวัน (~35 calls):
  watchlist 30 ตัว + SPY + QQQ (regime check)

Priority 2 — rotation batch (~165 calls/วัน):
  400 ตัว ÷ 3 วัน = ~133 ตัว/วัน

On-demand — reserve (~50 calls/วัน):
  เมื่อผู้ใช้ค้นหา symbol นอก watchlist

รวม ~200–235 calls/วัน — อยู่ใน quota ฟรี
```

#### Cron Schedule (Go backend)
```
02:00 UTC (09:00 Thai) — regime check + watchlist refresh
03:00 UTC (10:00 Thai) — rotation batch scan (group A/B/C วนเวียน)
04:00 UTC (11:00 Thai) — คำนวณ score + สร้าง top 5 + เรียก Gemini briefing
                         → ผลพร้อมให้ดูก่อนตลาด US เปิด (20:30 Thai)
```

#### เพิ่มใน `ruleengine/scoring.go`
```go
type DailyPick struct {
    Symbol           string
    Rank             int
    Score            float64
    SepaScore        int       // 0–8
    RsRank           float64   // 0–99
    ProximityToHigh  float64   // 0–1
    VolumeDryScore   float64   // 0–1
    CapSuitability   string
    EarningsAlert    bool
    Briefing         string    // จาก Gemini
}

func ScoreAndRank(stocks []StockData, account AccountConfig) []DailyPick
func Top5(picks []DailyPick) []DailyPick
```

### 6.12 Capital-Aware Filtering — กรองหุ้นตามขนาดทุน

> บริบทของโปรเจกต์นี้: ทุนเริ่มต้น ~20,000 THB (~$550 USD) ระบบต้องไกด์ผู้ใช้ ไม่ใช่ปล่อยให้คำนวณแล้วได้ 0 หุ้นโดยไม่อธิบาย

#### สูตรหลัก: Minimum Capital per Stock
```
minCapitalNeeded(price, stopDist, minShares, riskPct) =
    (minShares × stopDist) / riskPct

// stopDist = ATR × 2.5 (ค่า default ATR stop จาก §6.4)
// minShares = 5 (configurable, ขั้นต่ำที่ position มีความหมาย)
// riskPct   = 0.01 (1%)

// ตัวอย่าง: NVDA ราคา $130, ATR $5 → stopDist = $12.50
// minCapital = (5 × $12.50) / 0.01 = $6,250
```

#### Capital Suitability Badge (แสดงบนทุก stock card)
| Badge | เงื่อนไข | ข้อความที่แสดง |
|---|---|---|
| 🟢 เหมาะ | `accountSize >= minCapital × 1.5` | "ทุนพอ — ได้ ~N หุ้น" |
| 🟡 ระวัง | `accountSize >= minCapital` | "ทุนพอขั้นต่ำ — position เล็กมาก" |
| 🔴 ไม่เหมาะ | `accountSize < minCapital` | "ต้องทุน $X+ · ดูทางออก" |

#### "ทางออก" ที่แอปแนะนำเมื่อ 🔴 (ไม่ตัดสินแทนผู้ใช้ แค่ inform)
```
1. "หุ้นที่ราคาเหมาะกับทุน $550: ≤ $15/หุ้น"
2. "ถ้า broker รองรับ fractional shares → ซื้อ NVDA ได้ในสัดส่วนเล็ก"
3. "ต้องการทุน $X สำหรับ setup นี้"
```

#### Capital-Compatible Stock Filter (เพิ่มใน SEPA screener)
กรองก่อน return ผลการ scan โดยคำนวณ `maxAffordablePrice`:
```
maxAffordablePrice = (accountSize × riskPct × minAffordableShares) / (atrMultiplier × typicalAtrPct)

// ย่อ: หุ้นที่ราคา > maxAffordablePrice → ติด flag "ราคาสูงเกินทุน"
// แสดงให้เห็นแต่ไม่ซ่อน — ผู้ใช้ตัดสินใจเองว่าจะใช้ fractional หรือไม่
```

#### Fractional Shares Mode
- Config: `fractionalSharesEnabled bool` (default false)
- ถ้า true: `shares = sharesExact` (ทศนิยมได้), badge 🔴 จะเปลี่ยนเป็น 🟡 อัตโนมัติ
- แสดง note: "Fractional shares — ต้อง broker ที่รองรับ เช่น IBKR, Alpaca"

#### Capital Growth Guide (section พิเศษในแอป)
แสดงตารางง่าย ๆ ให้เห็นว่าทุนระดับต่าง ๆ เปิด universe กว้างขึ้นแค่ไหน:
```
ทุน $500:   หุ้น ≤ $15 | max 1–2 positions | fractional recommended
ทุน $2,000: หุ้น ≤ $50 | max 2–3 positions
ทุน $5,000: หุ้น ≤ $100 | max 3–4 positions
ทุน $10,000+: เต็มระบบ SEPA ไม่มีข้อจำกัดรายตัว
```

#### เพิ่มใน `ruleengine/capital_aware.go`
```go
type CapitalCheck struct {
    MinCapitalNeeded float64
    AffordableShares float64  // ด้วยทุนปัจจุบัน
    Suitability      string   // "suitable" | "caution" | "unsuitable"
    Suggestion       string   // ข้อความแนะนำ
    FractionalNeeded bool
}

func CheckCapitalSuitability(
    accountSize, entryPrice, stopDist float64,
    minShares int, riskPct float64,
    fractionalAllowed bool,
) CapitalCheck
```

---

## 7. Data Layer (สำคัญ — กิน effort เยอะสุด)

### Alpha Vantage (หลัก)
- Base: `https://www.alphavantage.co/query`
- ราคา: `function=TIME_SERIES_DAILY&symbol=...&outputsize=full`
- งบ/ภาพรวม: `function=OVERVIEW`, `INCOME_STATEMENT`, `BALANCE_SHEET`, `CASH_FLOW`
- **Rate limit ฟรีจำกัดมาก** → ต้องมี cache layer + rate limiter เสมอ

### Finnhub (สำรอง / fundamentals)
- Base: `https://finnhub.io/api/v1`
- ราคา: `/stock/candle`, metric: `/stock/metric`, งบ: `/stock/financials-reported`

### กลยุทธ์ caching (บังคับ)
- **ห้าม scan สดทั้ง universe ทุกวัน** — โควต้าไม่พอ
- Cron/manual job ค่อย ๆ ดึงทีละชุด เก็บลง SQLite (`symbol, date, ohlcv, fetched_at`)
- Rule engine ทำงานบน data ใน SQLite ไม่ยิง API ทุกครั้ง
- ตั้ง TTL: ราคา daily = 1 วัน, งบการเงิน = 1 ไตรมาส
- ใช้ `golang.org/x/time/rate` คุมไม่ให้เกินโควต้า/วัน

### Gemini (narrate only)
- ใช้ Gemini Flash free tier (รุ่นฟรีล่าสุด ตอน implement ให้เช็กชื่อ model ปัจจุบัน)
- **System prompt ต้องล็อกบทบาท**: "คุณคือผู้ช่วยสรุป สรุปเฉพาะตัวเลขที่ได้รับเท่านั้น ห้ามแต่งราคา/ตัวเลขเอง ห้ามบอกให้ซื้อหรือขาย"
- Input = JSON ผลจาก rule engine, Output = briefing 3 บรรทัด

---

## 8. Storage & Backup

### Client (IndexedDB)
- Stores: `journal` (สำคัญ), `watchlist`, `priceCache` (หายได้)
- ใช้ `navigator.storage.persist()` เพื่อขอ persistent storage
- **ต้อง Add to Home Screen** เพื่อหนีกฎลบข้อมูล 7 วันของ iOS Safari

### Backup (Google Drive — manual)
- ปุ่ม **Export**: serialize `journal` → ไฟล์ JSON → `navigator.share()` / download → ผู้ใช้เลือก "Save to Drive"
- ปุ่ม **Import**: เลือกไฟล์ JSON → parse → merge กลับ IndexedDB
- UX กันลืม: แถบ "สำรองล่าสุด: X วันก่อน" (เกิน 3–5 วัน = สีส้ม) + เตือนเมื่อมี journal entry ใหม่หลายรายการ
- เริ่มที่ manual export ก่อน — **อย่าเพิ่งทำ Drive API/OAuth** (token เก็บใน localStorage โดน ITP ลบได้เหมือนกัน)

---

## 9. API Endpoints (Go backend)

| Method | Path | หน้าที่ |
|---|---|---|
| GET | `/api/health` | health check |
| GET | `/api/top5` | daily top 5 picks พร้อม score + briefing |
| GET | `/api/quote?symbol=` | ราคาล่าสุด (ผ่าน cache) |
| GET | `/api/analyze?symbol=` | รัน SEPA + RS + ATR + regime → JSON |
| GET | `/api/regime` | สถานะตลาดรวม (SPY/QQQ vs MA200) |
| POST | `/api/risk` | 1% risk calc |
| GET | `/api/fundamentals?symbol=` | Piotroski + Altman + DCF scenario |
| POST | `/api/briefing` | ส่ง rule output → Gemini → briefing |
| GET | `/api/universe` | list หุ้นทั้งหมดใน universe + สถานะ cache |

ทุก response เป็น JSON `{data, error}` มาตรฐานเดียว

---

## 10. Build Phases (Roadmap — ทำตามลำดับ)

### ✅ Phase 1 — Client-side, ไม่ต้องพึ่ง API
- [ ] โครง PWA: `index.html`, `manifest.json`, service worker, mobile single-column
- [ ] **1% Risk Calculator** (§6.5) + unit test
- [ ] **SEPA Trend Template checker** (§6.1) กรอกเลขเอง + unit test
- [ ] IndexedDB setup เบื้องต้น

### Phase 2 — Go proxy + data จริงตัวแรก
- [ ] โครง Go + Echo ตาม §5
- [ ] Config อ่าน API key จาก env
- [ ] Alpha Vantage client + SQLite cache + rate limiter
- [ ] โหลด universe CSV (S&P 500 + Nasdaq 100) + pre-filter logic
- [ ] `/api/quote`, `/api/analyze` (เชื่อม SEPA กับ data จริง)
- [ ] Market Regime Filter (§6.2) + `/api/regime`

### Phase 3 — Trade Journal + Backup
- [ ] Journal CRUD บน IndexedDB (เหตุผลเข้า/ออก, P&L)
- [ ] Export/Import JSON + แถบเตือนวันที่ backup (§8)

### Phase 4 — เติม rule engine + Top 5 system
- [ ] Relative Strength Ranking (§6.3)
- [ ] ATR Stop (§6.4)
- [ ] Portfolio Heat (§6.6)
- [ ] Behavioral Guards (§6.11)
- [ ] Composite Scoring + Top 5 ranking (§6.13) + `/api/top5`
- [ ] Rotation batch cron job (§6.13 Cron Schedule)
- [ ] **Backtest harness** (รัน rule ย้อนหลังกับ data ใน SQLite)

### Phase 5 — Gemini briefing layer
- [ ] Gemini client + system prompt ล็อกบทบาท (§7)
- [ ] `/api/briefing` + แสดง briefing ใน UI

### Phase 6 — VI Module
- [ ] Fundamentals fetch (AV/Finnhub)
- [ ] Piotroski (§6.7), Altman (§6.8), DCF scenario (§6.9)
- [ ] Margin of Safety alert + Moat & Earnings checklist (ธีมสว่าง)
- [ ] Expectancy report จาก journal (§6.10)

---

## 11. Non-Goals (อยู่นอกขอบเขต — อย่าทำ)
- ❌ ระบบ auth / login / multi-user
- ❌ การส่งคำสั่งซื้อขายจริง (ไม่ต่อ broker API)
- ❌ ให้ LLM สร้าง signal / ทำนายราคา / แต่งตัวเลข
- ❌ Realtime tick streaming (ใช้ EOD/delayed ก็พอ)
- ❌ Drive API/OAuth ใน phase แรก (เริ่มที่ manual export)

---

## 12. หมายเหตุสำคัญ (Disclaimer)
แอปนี้เป็น **เครื่องมือช่วยตัดสินใจส่วนตัว** ไม่ใช่คำแนะนำการลงทุน และ rule/สูตรเหล่านี้ **ไม่การันตีกำไร** การเทรดมีความเสี่ยงขาดทุนจริง ผู้ใช้เป็นผู้ตัดสินใจและรับผลเองทุกครั้ง

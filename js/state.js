// state.js — shared mutable app state (no imports)
// Modules import and mutate this object directly.

export const state = {
  // Portfolios (loaded from IndexedDB on init)
  traderPortfolio: null,
  viPortfolio:     null,

  // Modal context
  capitalEditingType:  'trader',
  tradeEditingType:    'trader',
  tradeStatus:         'closed',
  editingTradeId:      null,
  closeTradeId:        null,
  closeTradeAllIds:    [],

  // Dashboard
  dashboardTimeframe: 'all',

  // Scan results — shared between scan → risk calc → journal
  lastScanData:     null,  // { symbol, entry, stop, target, shares }
  lastViScanMeta:   null,  // { symbol, price, viScore, … }
  lastTargetLabel:  '2R',

  // Quick-save payload built by saveFromRiskCalc / saveFromVIRisk
  quickSaveData: null,

  // Sync modal
  syncEntriesCache: [],

  // Journal live prices: { SYMBOL: currentPrice }
  journalPrices: {},
  journalPricesSyncing: false,
};

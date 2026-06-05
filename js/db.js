// db.js - IndexedDB storage for RiskFirst

const DB_NAME = 'RiskFirstDB';
const DB_VERSION = 3;

let db;

export function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => reject(event.target.error);

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Journal store
      if (!db.objectStoreNames.contains('journal')) {
        const journalStore = db.createObjectStore('journal', { keyPath: 'id', autoIncrement: true });
        journalStore.createIndex('symbol', 'symbol', { unique: false });
        journalStore.createIndex('status', 'status', { unique: false }); 
        journalStore.createIndex('closeDate', 'closeDate', { unique: false });
        journalStore.createIndex('type', 'type', { unique: false });
      } else {
        const journalStore = event.target.transaction.objectStore('journal');
        if (!journalStore.indexNames.contains('closeDate')) {
          journalStore.createIndex('closeDate', 'closeDate', { unique: false });
        }
        if (!journalStore.indexNames.contains('type')) {
          journalStore.createIndex('type', 'type', { unique: false });
        }
      }

      // Portfolio store
      if (!db.objectStoreNames.contains('portfolio')) {
        db.createObjectStore('portfolio', { keyPath: 'id' });
      }

      // Watchlist store
      if (db.objectStoreNames.contains('watchlist')) {
        // We delete and recreate to change the keyPath to an auto-incrementing id
        db.deleteObjectStore('watchlist');
      }
      const wlStore = db.createObjectStore('watchlist', { keyPath: 'id', autoIncrement: true });
      wlStore.createIndex('symbol', 'symbol', { unique: false });
      wlStore.createIndex('type', 'type', { unique: false });
      
      // Price Cache store
      if (!db.objectStoreNames.contains('priceCache')) {
        db.createObjectStore('priceCache', { keyPath: 'symbol' });
      }
    };
  });
}

export function getPortfolio(type = 'trader') {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('portfolio', 'readonly');
    const store = tx.objectStore('portfolio');
    const req = store.get(`main-${type}`);
    req.onsuccess = () => resolve(req.result || { id: `main-${type}`, capital: 500, initialCapital: 500 });
    req.onerror = () => reject(req.error);
  });
}

export function updatePortfolio(data, type = 'trader') {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('portfolio', 'readwrite');
    const store = tx.objectStore('portfolio');
    const req = store.put({ id: `main-${type}`, ...data });
    req.onerror   = () => reject(req.error);
    tx.oncomplete = () => resolve();          // wait for commit, not just request success
    tx.onerror    = () => reject(tx.error);
  });
}

export function addJournalEntry(entry) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('journal', 'readwrite');
    const store = tx.objectStore('journal');
    if(!entry.type) entry.type = 'trader';
    const req = store.add({ createdAt: Date.now(), ...entry });
    let newId;
    req.onsuccess = () => { newId = req.result; };
    req.onerror   = () => reject(req.error);
    tx.oncomplete = () => resolve(newId);    // return new ID after commit
    tx.onerror    = () => reject(tx.error);
  });
}

export function getJournalEntries(type = 'trader') {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('journal', 'readonly');
    const store = tx.objectStore('journal');
    const index = store.index('type');
    const req = index.getAll(type);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function updateJournalEntry(entryOrId, partial = null) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('journal', 'readwrite');
    const store = tx.objectStore('journal');
    if (partial !== null) {
      // called as (id, partialFields) — fetch full entry first then merge
      const getReq = store.get(entryOrId);
      getReq.onsuccess = () => {
        const existing = getReq.result;
        if (!existing) { reject(new Error(`Journal entry ${entryOrId} not found`)); return; }
        const putReq = store.put({ ...existing, ...partial });
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    } else {
      // called as (fullEntry)
      const req = store.put(entryOrId);
      req.onerror = () => reject(req.error);
    }
    tx.oncomplete = () => resolve();         // wait for commit before resolving
    tx.onerror    = () => reject(tx.error);
  });
}

export function deleteJournalEntry(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('journal', 'readwrite');
    const store = tx.objectStore('journal');
    const req = store.delete(id);
    req.onerror   = () => reject(req.error);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

// Watchlist CRUD
export function addWatchlistDB(symbol, type = 'trader') {
  // BUG-M5: removed async-in-Promise antipattern — use plain callbacks instead
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('watchlist', 'readwrite');
    const store = tx.objectStore('watchlist');
    const req   = store.index('type').getAll(type);

    req.onsuccess = () => {
      const existing = req.result.find(item => item.symbol === symbol);
      if (!existing) store.add({ symbol, type, addedAt: Date.now() });
    };
    req.onerror   = () => reject(req.error);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

export function getWatchlistDB(type = 'trader') {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('watchlist', 'readonly');
    const store = tx.objectStore('watchlist');
    const index = store.index('type');
    const req = index.getAll(type);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function removeWatchlistDB(symbol, type = 'trader') {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('watchlist', 'readwrite');
    const store = tx.objectStore('watchlist');
    const index = store.index('type');
    const req = index.getAll(type);
    
    req.onsuccess = () => {
      const existing = req.result.find(item => item.symbol === symbol);
      if (existing) store.delete(existing.id);
    };
    req.onerror   = () => reject(req.error);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

// Backup & Restore
export async function exportAllData() {
  const [traderPort, viPort, traderJournal, viJournal, traderWL, viWL] = await Promise.all([
    getPortfolio('trader'),
    getPortfolio('vi'),
    getJournalEntries('trader'),
    getJournalEntries('vi'),
    getWatchlistDB('trader'),
    getWatchlistDB('vi'),
  ]);
  return {
    version: 2,
    timestamp: Date.now(),
    portfolioTrader: traderPort,
    portfolioVI: viPort,
    journalTrader: traderJournal,
    journalVI: viJournal,
    watchlistTrader: traderWL,
    watchlistVI: viWL,
    // backward-compat keys
    portfolio: traderPort,
    journal: traderJournal,
    watchlist: traderWL,
  };
}

export function importAllData(data) {
  return new Promise((resolve, reject) => {
    if (!data || (!data.journal && !data.journalTrader)) {
      return reject(new Error('Invalid backup data format'));
    }

    const tx = db.transaction(['portfolio', 'journal', 'watchlist'], 'readwrite');

    tx.objectStore('portfolio').clear();
    tx.objectStore('journal').clear();
    tx.objectStore('watchlist').clear();

    const portStore = tx.objectStore('portfolio');
    // Support v2 (portfolioTrader/portfolioVI) and v1 (portfolio)
    const traderPort = data.portfolioTrader || data.portfolio;
    const viPort     = data.portfolioVI;
    if (traderPort) portStore.put({ ...traderPort, id: 'main-trader' });
    if (viPort)     portStore.put({ ...viPort,     id: 'main-vi' });

    const journalStore = tx.objectStore('journal');
    const allJournal = [
      ...(data.journalTrader || data.journal || []),
      ...(data.journalVI || []),
    ];
    allJournal.forEach(entry => journalStore.put(entry));

    const watchStore = tx.objectStore('watchlist');
    const allWatch = [
      ...(data.watchlistTrader || data.watchlist || []),
      ...(data.watchlistVI || []),
    ];
    allWatch.forEach(item => watchStore.put(item));

    tx.oncomplete = () => resolve();
    tx.onerror   = () => reject(tx.error);
  });
}

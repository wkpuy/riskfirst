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
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export function addJournalEntry(entry) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('journal', 'readwrite');
    const store = tx.objectStore('journal');
    // Ensure type is set (default to trader for backward compatibility)
    if(!entry.type) entry.type = 'trader';
    const req = store.add({ ...entry, createdAt: Date.now() });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
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

export function updateJournalEntry(entry) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('journal', 'readwrite');
    const store = tx.objectStore('journal');
    const req = store.put(entry);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function deleteJournalEntry(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('journal', 'readwrite');
    const store = tx.objectStore('journal');
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// Watchlist CRUD
export function addWatchlistDB(symbol, type = 'trader') {
  return new Promise(async (resolve, reject) => {
    const tx = db.transaction('watchlist', 'readwrite');
    const store = tx.objectStore('watchlist');
    
    // Check if already exists for this type
    const index = store.index('type');
    const req = index.getAll(type);
    
    req.onsuccess = () => {
      const existing = req.result.find(item => item.symbol === symbol);
      if(!existing) {
        store.add({ symbol: symbol, type: type, addedAt: Date.now() });
      }
      resolve();
    };
    req.onerror = () => reject(req.error);
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
      if(existing) {
        store.delete(existing.id);
      }
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

// Backup & Restore
export async function exportAllData() {
  const portfolio = await getPortfolio();
  const journal = await getJournalEntries();
  const watchlist = await getWatchlistDB();
  return {
    version: 1,
    timestamp: Date.now(),
    portfolio,
    journal,
    watchlist
  };
}

export function importAllData(data) {
  return new Promise((resolve, reject) => {
    if (!data || !data.portfolio || !data.journal || !data.watchlist) {
      return reject(new Error("Invalid backup data format"));
    }

    const tx = db.transaction(['portfolio', 'journal', 'watchlist'], 'readwrite');
    
    // Clear existing data
    tx.objectStore('portfolio').clear();
    tx.objectStore('journal').clear();
    tx.objectStore('watchlist').clear();

    // Insert new data
    tx.objectStore('portfolio').put({ id: 1, ...data.portfolio });
    
    const journalStore = tx.objectStore('journal');
    data.journal.forEach(entry => {
      // Remove auto-increment ID if it exists to let DB generate it or keep it?
      // Since it's a restore, keeping original IDs is safer if they don't clash, but clearing solves clashes.
      journalStore.put(entry);
    });

    const watchStore = tx.objectStore('watchlist');
    data.watchlist.forEach(item => {
      watchStore.put(item);
    });

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

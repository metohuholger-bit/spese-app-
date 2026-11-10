// Archivio locale delle spese (IndexedDB): i dati restano sul dispositivo.
const DB_NAME = 'spese-db';
const STORE = 'expenses';

let dbPromise;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(mode, work) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const getAllExpenses = () => run('readonly', (s) => s.getAll());
export const saveExpense = (expense) => run('readwrite', (s) => s.put(expense));
export const deleteExpense = (id) => run('readwrite', (s) => s.delete(id));
export const importExpenses = (expenses) =>
  run('readwrite', (s) => {
    for (const e of expenses) s.put(e);
  });

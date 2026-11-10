// Backup automatico su Google Sheet: ogni modifica finisce in una coda locale
// e viene inviata allo script Google appena c'è connessione.
import { categoryById } from './categories.js';

const CONFIG_KEY = 'spese.sync';
const OUTBOX_KEY = 'spese.outbox';

const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* archiviazione non disponibile */
  }
};

export const getSyncConfig = () => read(CONFIG_KEY, { url: '', token: '' });
export const setSyncConfig = (config) => write(CONFIG_KEY, config);
export const isSyncConfigured = () => {
  const { url, token } = getSyncConfig();
  return Boolean(url && token);
};
export const pendingCount = () => read(OUTBOX_KEY, []).length;

let lastError = '';
let flushing = false;
let onChange = () => {};
export const onSyncChange = (callback) => (onChange = callback);
export const syncError = () => lastError;

function enqueue(op) {
  const id = op.t === 'delete' ? op.id : op.e.id;
  // Una sola operazione per spesa: l'ultima sostituisce le precedenti.
  const outbox = read(OUTBOX_KEY, []).filter((o) => (o.t === 'delete' ? o.id : o.e.id) !== id);
  outbox.push({ ...op, seq: crypto.randomUUID() });
  write(OUTBOX_KEY, outbox);
}

const toRow = (e) => ({
  id: e.id,
  date: e.date,
  description: e.description,
  category: e.category,
  categoryLabel: categoryById(e.category).label,
  cents: e.cents,
  createdAt: e.createdAt,
});

export function queueUpsert(expenses) {
  for (const e of [].concat(expenses)) enqueue({ t: 'upsert', e: toRow(e) });
  onChange();
  flush();
}

export function queueDelete(id) {
  enqueue({ t: 'delete', id });
  onChange();
  flush();
}

async function post(payload) {
  const { url, token } = getSyncConfig();
  // text/plain evita la richiesta preliminare CORS, che Apps Script non gestisce.
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token, ...payload }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.error === 'codice' ? 'Codice segreto errato.' : 'Lo script ha rifiutato la richiesta.');
  }
  return data;
}

export async function flush() {
  if (flushing || !isSyncConfigured()) return;
  const batch = read(OUTBOX_KEY, []).slice(0, 200);
  if (!batch.length) return;
  flushing = true;
  try {
    await post({ ops: batch });
    const sent = new Set(batch.map((o) => o.seq));
    write(OUTBOX_KEY, read(OUTBOX_KEY, []).filter((o) => !sent.has(o.seq)));
    lastError = '';
  } catch (error) {
    lastError = navigator.onLine === false ? '' : error.message.startsWith('Codice') ? error.message : 'Foglio non raggiungibile.';
  } finally {
    flushing = false;
    onChange();
  }
  if (!lastError && navigator.onLine !== false && pendingCount()) flush();
}

export async function fetchRemoteExpenses() {
  return (await post({ action: 'list' })).expenses ?? [];
}

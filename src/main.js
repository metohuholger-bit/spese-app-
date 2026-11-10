import './style.css';
import { CATEGORIES, categoryById } from './categories.js';
import { deleteExpense, getAllExpenses, importExpenses, saveExpense } from './db.js';
import {
  fetchRemoteExpenses,
  flush,
  getSyncConfig,
  isSyncConfigured,
  onSyncChange,
  pendingCount,
  queueDelete,
  queueUpsert,
  setSyncConfig,
  syncError,
} from './sync.js';

const $ = (id) => document.getElementById(id);
const KEY_STORAGE = 'spese.apiKey';

const euro = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const monthFmt = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' });
const dayFmt = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDate(new Date());
const parseIso = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const state = {
  expenses: [],
  month: today().slice(0, 7), // AAAA-MM
  editing: null, // spesa in modifica, oppure null per una nuova
  category: 'alimentari',
  photo: null, // data URL JPEG
};

const getApiKey = () => {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
};

// ---------- Riepilogo e lista ----------

function render() {
  const [y, m] = state.month.split('-').map(Number);
  const label = monthFmt.format(new Date(y, m - 1, 1));
  $('month-label').textContent = label.charAt(0).toUpperCase() + label.slice(1);
  $('next-month').disabled = state.month >= today().slice(0, 7);

  const items = state.expenses
    .filter((e) => e.date.startsWith(state.month))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const total = items.reduce((sum, e) => sum + e.cents, 0);

  $('month-total').textContent = euro.format(total / 100);
  $('month-sub').textContent = items.length
    ? `${items.length} ${items.length === 1 ? 'spesa' : 'spese'} · media ${euro.format(total / 100 / daysElapsed(y, m))} al giorno`
    : 'Nessuna spesa in questo mese';

  renderCategories(items, total);
  renderList(items);
}

function daysElapsed(y, m) {
  const now = new Date();
  const isCurrent = now.getFullYear() === y && now.getMonth() + 1 === m;
  return isCurrent ? now.getDate() : new Date(y, m, 0).getDate();
}

function renderCategories(items, total) {
  const byCat = new Map();
  for (const e of items) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.cents);
  const rows = [...byCat.entries()].sort((a, b) => b[1] - a[1]);

  $('categories').innerHTML = rows
    .map(([id, cents]) => {
      const cat = categoryById(id);
      const pct = total ? Math.round((cents / total) * 100) : 0;
      return `<div class="cat-row">
        <div class="cat-head"><span>${cat.icon} ${escapeHtml(cat.label)}</span><span>${euro.format(cents / 100)} · ${pct}%</span></div>
        <div class="bar"><div style="width:${Math.max(pct, 2)}%;background:${cat.color}"></div></div>
      </div>`;
    })
    .join('');
}

function renderList(items) {
  if (!items.length) {
    $('list').innerHTML = `<p class="empty">Aggiungi la prima spesa con il pulsante qui sotto, oppure fotografa uno scontrino.</p>`;
    return;
  }
  const groups = new Map();
  for (const e of items) {
    if (!groups.has(e.date)) groups.set(e.date, []);
    groups.get(e.date).push(e);
  }
  $('list').innerHTML = [...groups.entries()]
    .map(([date, list]) => {
      const dayTotal = list.reduce((s, e) => s + e.cents, 0);
      const dayLabel = date === today() ? 'Oggi' : dayFmt.format(parseIso(date));
      return `<div class="day">
        <div class="day-head"><span>${escapeHtml(dayLabel)}</span><span>${euro.format(dayTotal / 100)}</span></div>
        ${list
          .map((e) => {
            const cat = categoryById(e.category);
            return `<button class="item" data-id="${escapeHtml(e.id)}">
              <span class="item-icon" style="background:${cat.color}22">${cat.icon}</span>
              <span class="item-text">
                <span class="item-desc">${escapeHtml(e.description || cat.label)}</span>
                <span class="item-cat">${escapeHtml(cat.label)}${e.photo ? ' · 📎' : ''}</span>
              </span>
              <span class="item-amount">${euro.format(e.cents / 100)}</span>
            </button>`;
          })
          .join('')}
      </div>`;
    })
    .join('');
}

function shiftMonth(delta) {
  const [y, m] = state.month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  state.month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  render();
}

// ---------- Modulo spesa ----------

function renderChips() {
  $('f-cats').innerHTML = CATEGORIES.map(
    (c) =>
      `<button type="button" class="chip${c.id === state.category ? ' on' : ''}" data-cat="${c.id}" aria-pressed="${c.id === state.category}">${c.icon} ${escapeHtml(c.label)}</button>`,
  ).join('');
}

function setPhoto(dataUrl) {
  state.photo = dataUrl;
  $('f-photo').hidden = !dataUrl;
  $('f-photo-del').hidden = !dataUrl;
  $('f-photo-add').textContent = dataUrl ? '📷 Cambia foto' : '📷 Aggiungi foto';
  if (dataUrl) $('f-photo').src = dataUrl;
  else $('f-photo').removeAttribute('src');
}

function setStatus(text, kind = 'info') {
  const el = $('scan-status');
  el.hidden = !text;
  el.textContent = text ?? '';
  el.className = `status ${kind}`;
}

function openExpense(expense = null) {
  state.editing = expense;
  state.category = expense?.category ?? 'alimentari';
  $('expense-title').textContent = expense ? 'Modifica spesa' : 'Nuova spesa';
  $('f-amount').value = expense ? (expense.cents / 100).toFixed(2).replace('.', ',') : '';
  $('f-desc').value = expense?.description ?? '';
  $('f-date').value = expense?.date ?? today();
  $('f-date').max = today();
  $('f-delete').hidden = !expense;
  $('form-error').hidden = true;
  setStatus(null);
  setPhoto(expense?.photo ?? null);
  renderChips();
  if (!$('dlg-expense').open) $('dlg-expense').showModal();
}

/** Accetta "12,50", "12.50", "1.234,56", "€ 12" e restituisce i centesimi, oppure null. */
export function parseAmount(text) {
  let s = text.replace(/[€\s]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return cents > 0 ? cents : null;
}

async function submitExpense(event) {
  event.preventDefault();
  const cents = parseAmount($('f-amount').value);
  const date = $('f-date').value;
  const error = $('form-error');
  if (cents === null || !date) {
    error.textContent = cents === null ? 'Inserisci un importo valido, ad esempio 12,50.' : 'Scegli una data.';
    error.hidden = false;
    return;
  }
  const expense = {
    id: state.editing?.id ?? crypto.randomUUID(),
    createdAt: state.editing?.createdAt ?? Date.now(),
    cents,
    description: $('f-desc').value.trim(),
    category: state.category,
    date,
    photo: state.photo,
  };
  try {
    await saveExpense(expense);
  } catch {
    error.textContent = 'Salvataggio non riuscito: spazio insufficiente sul dispositivo?';
    error.hidden = false;
    return;
  }
  state.expenses = state.expenses.filter((e) => e.id !== expense.id).concat(expense);
  queueUpsert(expense);
  state.month = date.slice(0, 7);
  $('dlg-expense').close();
  render();
}

async function removeExpense() {
  const expense = state.editing;
  if (!expense || !confirm('Eliminare questa spesa?')) return;
  await deleteExpense(expense.id);
  queueDelete(expense.id);
  state.expenses = state.expenses.filter((e) => e.id !== expense.id);
  $('dlg-expense').close();
  render();
}

// ---------- Foto e scontrino ----------

/** Ridimensiona la foto e la converte in JPEG (data URL). */
async function toJpeg(file, maxSide = 1568, quality = 0.8) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', quality);
}

let photoTriggersScan = false;

function pickPhoto(scan) {
  photoTriggersScan = scan;
  $('photo-input').value = '';
  $('photo-input').click();
}

async function onPhotoPicked() {
  const file = $('photo-input').files?.[0];
  if (!file) return;

  let dataUrl;
  try {
    dataUrl = await toJpeg(file);
  } catch {
    alert('Non riesco ad aprire questa immagine.');
    return;
  }

  if (!$('dlg-expense').open) openExpense();
  setPhoto(dataUrl);
  if (!photoTriggersScan) return;

  const apiKey = getApiKey();
  if (!apiKey) {
    setStatus('Foto allegata. Per la lettura automatica aggiungi la chiave API nelle impostazioni.', 'info');
    return;
  }

  setStatus('Sto leggendo lo scontrino…', 'busy');
  try {
    const { readReceipt, ReceiptError } = await import('./receipt.js');
    try {
      const receipt = await readReceipt(apiKey, dataUrl.split(',')[1]);
      // Compila solo se la finestra è ancora aperta sulla stessa foto.
      if (!$('dlg-expense').open || state.photo !== dataUrl) return;
      if (receipt.totale != null && receipt.totale > 0) {
        $('f-amount').value = receipt.totale.toFixed(2).replace('.', ',');
      }
      if (receipt.negozio) $('f-desc').value = receipt.negozio.slice(0, 80);
      if (receipt.data && /^\d{4}-\d{2}-\d{2}$/.test(receipt.data) && receipt.data <= today()) {
        $('f-date').value = receipt.data;
      }
      state.category = receipt.categoria;
      renderChips();
      setStatus(
        receipt.totale != null
          ? 'Scontrino letto: controlla i dati e salva.'
          : 'Totale non leggibile: inseriscilo a mano.',
        receipt.totale != null ? 'ok' : 'warn',
      );
    } catch (error) {
      if (!(error instanceof ReceiptError)) throw error;
      setStatus(error.message, 'warn');
    }
  } catch (error) {
    console.error(error);
    setStatus('Lettura non riuscita. Inserisci i dati a mano.', 'warn');
  }
}

// ---------- Impostazioni e backup ----------

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCsv() {
  const quote = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [...state.expenses]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) =>
      [e.date, quote(e.description), quote(categoryById(e.category).label), (e.cents / 100).toFixed(2).replace('.', ',')].join(';'),
    );
  // BOM iniziale: così Excel apre correttamente le lettere accentate.
  download(`spese-${today()}.csv`, '﻿' + ['Data;Descrizione;Categoria;Importo', ...rows].join('\r\n'), 'text/csv');
}

function isValidExpense(e) {
  return (
    e &&
    typeof e.id === 'string' &&
    Number.isInteger(e.cents) &&
    e.cents > 0 &&
    typeof e.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(e.date)
  );
}

async function importBackup() {
  const file = $('s-import-file').files?.[0];
  if (!file) return;
  const msg = $('settings-msg');
  try {
    const data = JSON.parse(await file.text());
    const list = (Array.isArray(data) ? data : data.expenses)?.filter(isValidExpense);
    if (!list?.length) throw new Error('vuoto');
    const clean = list.map((e) => ({
      id: e.id,
      createdAt: Number(e.createdAt) || Date.now(),
      cents: e.cents,
      description: String(e.description ?? '').slice(0, 80),
      category: categoryById(e.category).id,
      date: e.date,
      photo: typeof e.photo === 'string' && e.photo.startsWith('data:image/') ? e.photo : null,
    }));
    await importExpenses(clean);
    queueUpsert(clean);
    state.expenses = await getAllExpenses();
    render();
    msg.textContent = `Importate ${clean.length} spese.`;
  } catch {
    msg.textContent = 'File non valido: scegli un backup esportato da questa app.';
  }
}

// ---------- Backup su Google Sheet ----------

function renderSync() {
  const badge = $('sync-badge');
  badge.hidden = !isSyncConfigured();
  const pending = pendingCount();
  const error = syncError();
  let text = '☁ Salvato sul foglio';
  if (error) text = `☁ ${error}`;
  else if (pending) text = `☁ ${pending} in attesa`;
  badge.textContent = pending || error ? `☁ ${pending}` : '☁ ✓';
  badge.title = text;
  badge.classList.toggle('pending', Boolean(pending || error));
  $('sync-msg').textContent = isSyncConfigured()
    ? text.slice(2) + (error && pending ? ` ${pending} spese in attesa di invio.` : '')
    : 'Non configurato: segui le istruzioni nel file apps-script/Code.gs.';
}

function saveSyncFields() {
  setSyncConfig({ url: $('s-sync-url').value.trim(), token: $('s-sync-token').value.trim() });
}

async function restoreFromSheet() {
  saveSyncFields();
  const msg = $('sync-msg');
  if (!isSyncConfigured()) return renderSync();
  msg.textContent = 'Scarico le spese dal foglio…';
  try {
    const remote = (await fetchRemoteExpenses()).filter(isValidExpense);
    const local = new Map(state.expenses.map((e) => [e.id, e]));
    const merged = remote.map((e) => ({
      id: e.id,
      createdAt: Number(e.createdAt) || Date.now(),
      cents: e.cents,
      description: String(e.description ?? '').slice(0, 80),
      category: categoryById(e.category).id,
      date: e.date,
      photo: local.get(e.id)?.photo ?? null, // le foto restano solo sul dispositivo
    }));
    await importExpenses(merged);
    state.expenses = await getAllExpenses();
    render();
    msg.textContent = `Ripristinate ${merged.length} spese dal foglio.`;
  } catch (error) {
    msg.textContent = `Ripristino non riuscito: ${error.message}`;
  }
}

// ---------- Eventi ----------

$('prev-month').addEventListener('click', () => shiftMonth(-1));
$('next-month').addEventListener('click', () => shiftMonth(1));
$('btn-add').addEventListener('click', () => openExpense());
$('btn-scan').addEventListener('click', () => pickPhoto(true));
$('photo-input').addEventListener('change', onPhotoPicked);

$('list').addEventListener('click', (event) => {
  const id = event.target.closest('.item')?.dataset.id;
  const expense = state.expenses.find((e) => e.id === id);
  if (expense) openExpense(expense);
});

$('f-cats').addEventListener('click', (event) => {
  const cat = event.target.closest('.chip')?.dataset.cat;
  if (!cat) return;
  state.category = cat;
  renderChips();
});
$('form-expense').addEventListener('submit', submitExpense);
$('f-cancel').addEventListener('click', () => $('dlg-expense').close());
$('f-delete').addEventListener('click', removeExpense);
$('f-photo-add').addEventListener('click', () => pickPhoto(false));
$('f-photo-del').addEventListener('click', () => setPhoto(null));

$('btn-settings').addEventListener('click', () => {
  $('s-key').value = getApiKey();
  $('settings-msg').textContent = '';
  const sync = getSyncConfig();
  $('s-sync-url').value = sync.url;
  $('s-sync-token').value = sync.token;
  renderSync();
  $('dlg-settings').showModal();
});
$('s-sync-all').addEventListener('click', () => {
  saveSyncFields();
  if (isSyncConfigured()) queueUpsert(state.expenses);
  renderSync();
});
$('s-sync-restore').addEventListener('click', restoreFromSheet);
onSyncChange(renderSync);
window.addEventListener('online', flush);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') flush();
});
$('s-close').addEventListener('click', () => $('dlg-settings').close());
$('dlg-settings').addEventListener('close', () => {
  try {
    const key = $('s-key').value.trim();
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* archiviazione non disponibile (es. navigazione privata) */
  }
  saveSyncFields();
  renderSync();
  flush();
});
$('s-export-json').addEventListener('click', () =>
  download(`spese-backup-${today()}.json`, JSON.stringify({ version: 1, expenses: state.expenses }), 'application/json'),
);
$('s-export-csv').addEventListener('click', exportCsv);
$('s-import').addEventListener('click', () => {
  $('s-import-file').value = '';
  $('s-import-file').click();
});
$('s-import-file').addEventListener('change', importBackup);

// ---------- Avvio ----------

try {
  state.expenses = await getAllExpenses();
} catch (error) {
  console.error(error);
  $('list').innerHTML = `<p class="empty">Impossibile aprire l'archivio locale su questo browser.</p>`;
}
render();
renderSync();
flush();
navigator.storage?.persist?.(); // chiede al browser di non cancellare i dati in automatico

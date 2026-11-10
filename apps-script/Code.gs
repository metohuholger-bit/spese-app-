/**
 * Backup delle spese su Google Sheet per l'app "Le mie spese".
 *
 * Installazione (una volta sola):
 *  1. Vai su https://script.new e incolla tutto questo file al posto del codice esistente.
 *  2. In alto scegli la funzione "configura" e premi Esegui; accetta le autorizzazioni.
 *     Nel registro in basso compaiono il link del foglio e il CODICE SEGRETO.
 *  3. Esegui il deployment > Nuovo deployment > tipo "App web":
 *     "Esegui come: Me", "Chi ha accesso: Chiunque". Copia l'URL che finisce con /exec.
 *  4. Nell'app, in Impostazioni > Backup su Google Sheet, incolla URL e codice segreto.
 */

const FOGLIO = 'Spese';
const INTESTAZIONE = ['ID', 'Data', 'Descrizione', 'Categoria', 'Importo (€)', 'Aggiornato il', 'Cat. ID', 'Creato (ms)'];

function configura() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('SHEET_ID');
  let ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('Le mie spese');
    props.setProperty('SHEET_ID', ss.getId());
  }
  foglio_(ss);
  let token = props.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('TOKEN', token);
  }
  Logger.log('Foglio: ' + ss.getUrl());
  Logger.log('CODICE SEGRETO: ' + token);
}

function foglio_(ss) {
  let sh = ss.getSheetByName(FOGLIO);
  if (!sh) {
    sh = ss.getSheets()[0];
    sh.setName(FOGLIO);
  }
  if (sh.getLastRow() === 0) {
    sh.appendRow(INTESTAZIONE);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, INTESTAZIONE.length).setFontWeight('bold');
    sh.getRange('A:A').setNumberFormat('@');
    sh.getRange('B:B').setNumberFormat('yyyy-mm-dd');
    sh.getRange('E:E').setNumberFormat('#,##0.00');
    sh.hideColumns(7, 2);
  }
  return sh;
}

function rispondi_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return rispondi_({ ok: true, app: 'Le mie spese' });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return rispondi_({ ok: false, error: 'formato' });
  }
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('TOKEN');
  if (!token || body.token !== token) return rispondi_({ ok: false, error: 'codice' });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
    const sh = foglio_(ss);
    if (body.action === 'list') return rispondi_({ ok: true, expenses: leggi_(ss, sh) });
    applica_(sh, body.ops || []);
    return rispondi_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function applica_(sh, ops) {
  const righe = sh.getLastRow() - 1;
  const ids = righe > 0 ? sh.getRange(2, 1, righe, 1).getValues().map((r) => String(r[0])) : [];
  const ora = new Date();
  ops.forEach((op) => {
    const id = String(op.t === 'delete' ? op.id : op.e && op.e.id);
    if (!id || id === 'undefined') return;
    const i = ids.indexOf(id);
    if (op.t === 'delete') {
      if (i >= 0) {
        sh.deleteRow(i + 2);
        ids.splice(i, 1);
      }
      return;
    }
    const x = op.e;
    const riga = [id, String(x.date), String(x.description || ''), String(x.categoryLabel || ''), Number(x.cents) / 100, ora, String(x.category || ''), Number(x.createdAt) || 0];
    if (i >= 0) {
      sh.getRange(i + 2, 1, 1, riga.length).setValues([riga]);
    } else {
      sh.appendRow(riga);
      ids.push(id);
    }
  });
}

function leggi_(ss, sh) {
  const righe = sh.getLastRow() - 1;
  if (righe <= 0) return [];
  const tz = ss.getSpreadsheetTimeZone();
  return sh
    .getRange(2, 1, righe, INTESTAZIONE.length)
    .getValues()
    .filter((r) => r[0])
    .map((r) => ({
      id: String(r[0]),
      date: r[1] instanceof Date ? Utilities.formatDate(r[1], tz, 'yyyy-MM-dd') : String(r[1]),
      description: String(r[2]),
      cents: Math.round(Number(r[4]) * 100),
      category: String(r[6]),
      createdAt: Number(r[7]) || 0,
    }));
}

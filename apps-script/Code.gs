/**
 * מכינת יפו — מעקב מד"ס
 * Backend ב-Google Apps Script שיושב על גיליון Google Sheets.
 *
 * התקנה: ראו README.md בשורש הריפו.
 * הגיליון צריך שני טאבים (נוצרים אוטומטית בהרצה הראשונה של setup):
 *   Trainees — רשימת החניכים
 *   Logs     — רשומות האימונים
 */

const TRAINEE_HEADERS = ['id', 'name', 'year', 'squad', 'level', 'isLeader', 'createdAt'];
const LOG_HEADERS = [
  'id', 'traineeId', 'date', 'runDistanceKm', 'runTimeSec',
  'pushups', 'situps', 'pullups', 'notes', 'createdAt'
];

/** הריצו פעם אחת מתוך העורך כדי ליצור את הטאבים והכותרות. */
function setup() {
  getSheet_('Trainees', TRAINEE_HEADERS);
  getSheet_('Logs', LOG_HEADERS);
}

function doGet(e) {
  const action = (e.parameter && e.parameter.action) || 'all';
  if (action === 'all') {
    return json_({
      ok: true,
      trainees: readAll_('Trainees', TRAINEE_HEADERS),
      logs: readAll_('Logs', LOG_HEADERS)
    });
  }
  return json_({ ok: false, error: 'unknown action' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'addTrainee') return json_({ ok: true, trainee: addTrainee_(body.trainee) });
    if (body.action === 'addLog') return json_({ ok: true, log: addLog_(body.log) });
    if (body.action === 'deleteLog') return json_({ ok: deleteLog_(body.id, body.traineeId) });
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function addTrainee_(t) {
  const name = String(t.name || '').trim();
  if (!name) throw new Error('חסר שם');
  if (['א', 'ב'].indexOf(t.year) < 0) throw new Error('שנה לא תקינה');
  if (['א', 'ב', 'ג'].indexOf(t.level) < 0) throw new Error('רמה לא תקינה');
  const maxSquad = t.year === 'א' ? 12 : 2;
  const squad = Number(t.squad);
  if (!(squad >= 1 && squad <= maxSquad)) throw new Error('קבוצה לא תקינה');

  const existing = readAll_('Trainees', TRAINEE_HEADERS)
    .find(x => x.name === name && x.year === t.year && Number(x.squad) === squad);
  if (existing) return existing;

  const row = {
    id: Utilities.getUuid(),
    name: name,
    year: t.year,
    squad: squad,
    level: t.level,
    isLeader: t.isLeader ? 'TRUE' : '',
    createdAt: new Date().toISOString()
  };
  getSheet_('Trainees', TRAINEE_HEADERS).appendRow(TRAINEE_HEADERS.map(h => row[h]));
  return row;
}

function addLog_(l) {
  if (!l.traineeId) throw new Error('חסר חניך');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(l.date)) throw new Error('תאריך לא תקין');
  const num = v => (v === '' || v == null ? '' : Number(v));
  const row = {
    id: Utilities.getUuid(),
    traineeId: l.traineeId,
    date: l.date,
    runDistanceKm: num(l.runDistanceKm),
    runTimeSec: num(l.runTimeSec),
    pushups: num(l.pushups),
    situps: num(l.situps),
    pullups: num(l.pullups),
    notes: String(l.notes || '').slice(0, 500),
    createdAt: new Date().toISOString()
  };
  // הגיליון שומר את התאריך כטקסט כדי שלא יומר לאזור זמן אחר
  const sheet = getSheet_('Logs', LOG_HEADERS);
  sheet.appendRow(LOG_HEADERS.map(h => (h === 'date' ? "'" + row.date : row[h])));
  return row;
}

function deleteLog_(id, traineeId) {
  const sheet = getSheet_('Logs', LOG_HEADERS);
  const values = sheet.getDataRange().getValues();
  for (let i = values.length - 1; i >= 1; i--) {
    if (values[i][0] === id && values[i][1] === traineeId) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

function readAll_(name, headers) {
  const values = getSheet_(name, headers).getDataRange().getValues();
  const head = values.shift();
  return values
    .filter(r => r[0] !== '')
    .map(r => {
      const o = {};
      head.forEach((h, i) => {
        let v = r[i];
        if (v instanceof Date) v = Utilities.formatDate(v, 'Asia/Jerusalem', 'yyyy-MM-dd');
        o[h] = v;
      });
      return o;
    });
}

function getSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

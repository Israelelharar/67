/**
 * מכינת יפו — מעקב מד"ס
 * Backend ב-Google Apps Script שיושב על גיליון Google Sheets.
 *
 * התקנה: ראו README.md בשורש הריפו.
 * טאבים בגיליון (נוצרים אוטומטית ע"י setup):
 *   Trainees — רשימת החניכים
 *   Workouts — אימוני המד"ס שהצוות מגדיר
 *   Logs     — התוצאות שהחניכים מזינים
 *   Codes    — קודי אחראי קבוצה
 * קוד הצוות נשמר ב-Script Properties תחת STAFF_CODE.
 */

const SHEETS = {
  Trainees: ['id', 'name', 'year', 'squad', 'level', 'createdAt'],
  Workouts: ['id', 'date', 'title', 'year', 'level', 'exercises', 'notes', 'createdAt'],
  Logs: ['id', 'traineeId', 'workoutId', 'date', 'results', 'notes', 'createdAt'],
  Codes: ['year', 'squad', 'code']
};
const SQUADS = { 'א': 12, 'ב': 2 };
const LEVELS = ['א', 'ב', 'ג'];
const UNITS = ['reps', 'time', 'hold', 'kg', 'meters'];

/** הריצו פעם אחת מתוך העורך. יוצר את הטאבים, קוד צוות וקודי אחראים. */
function setup() {
  Object.keys(SHEETS).forEach(getSheet_);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('STAFF_CODE')) props.setProperty('STAFF_CODE', randomCode_());
  genLeaderCodes_();
  Logger.log('קוד צוות: ' + props.getProperty('STAFF_CODE'));
  Logger.log('קודי אחראים נמצאים בטאב Codes');
}

// ---------- ניתוב ----------

function doGet(e) {
  const p = e.parameter || {};
  try {
    if (p.action === 'public') {
      return json_({ ok: true, trainees: readAll_('Trainees'), workouts: readWorkouts_() });
    }
    if (p.action === 'myLogs') {
      return json_({ ok: true, logs: readLogs_().filter(l => l.traineeId === p.traineeId) });
    }
    return json_({ ok: false, error: 'פעולה לא מוכרת' });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const b = JSON.parse(e.postData.contents);
    switch (b.action) {
      // פתוח לכולם
      case 'addTrainee': return json_({ ok: true, trainee: addTrainee_(b.trainee) });
      case 'addLog': return json_({ ok: true, log: addLog_(b.log) });
      case 'deleteLog': return json_({ ok: deleteRow_('Logs', r => r.id === b.id && r.traineeId === b.traineeId) });
      // דורש קוד
      case 'login': return json_(Object.assign({ ok: true }, loginData_(auth_(b.code))));
      case 'addWorkout': staff_(b.code); return json_({ ok: true, workout: addWorkout_(b.workout) });
      case 'deleteWorkout': staff_(b.code); return json_({ ok: deleteRow_('Workouts', r => r.id === b.id) });
      case 'setLevel': staff_(b.code); return json_({ ok: setLevel_(b.traineeId, b.level) });
      case 'genCodes': staff_(b.code); genLeaderCodes_(b.reset); return json_({ ok: true, codes: readAll_('Codes') });
      default: return json_({ ok: false, error: 'פעולה לא מוכרת' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

// ---------- הרשאות ----------

function auth_(code) {
  code = String(code || '').trim();
  if (!code) throw new Error('נא להזין קוד');
  if (code === PropertiesService.getScriptProperties().getProperty('STAFF_CODE')) return { role: 'staff' };
  const c = readAll_('Codes').find(x => String(x.code) === code);
  if (c) return { role: 'leader', year: c.year, squad: Number(c.squad) };
  Utilities.sleep(800); // מאט ניחושים
  throw new Error('קוד שגוי');
}

function staff_(code) {
  if (auth_(code).role !== 'staff') throw new Error('הפעולה מותרת לצוות בלבד');
}

function loginData_(auth) {
  let logs = readLogs_();
  if (auth.role === 'leader') {
    const ids = {};
    readAll_('Trainees')
      .filter(t => t.year === auth.year && Number(t.squad) === auth.squad)
      .forEach(t => (ids[t.id] = true));
    logs = logs.filter(l => ids[l.traineeId]);
  }
  const out = { auth: auth, logs: logs };
  if (auth.role === 'staff') out.codes = readAll_('Codes');
  return out;
}

// ---------- פעולות ----------

function addTrainee_(t) {
  const name = String(t.name || '').trim().slice(0, 60);
  if (name.length < 2) throw new Error('חסר שם');
  if (!SQUADS[t.year]) throw new Error('שנה לא תקינה');
  if (LEVELS.indexOf(t.level) < 0) throw new Error('רמה לא תקינה');
  const squad = Number(t.squad);
  if (!(squad >= 1 && squad <= SQUADS[t.year])) throw new Error('קבוצה לא תקינה');

  const existing = readAll_('Trainees').find(x => x.name === name && x.year === t.year && Number(x.squad) === squad);
  if (existing) return existing;
  const row = { id: Utilities.getUuid(), name: name, year: t.year, squad: squad, level: t.level, createdAt: new Date().toISOString() };
  append_('Trainees', row);
  return row;
}

function addWorkout_(w) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(w.date)) throw new Error('תאריך לא תקין');
  const title = String(w.title || '').trim().slice(0, 80);
  if (!title) throw new Error('חסר שם לאימון');
  if (w.year && !SQUADS[w.year]) throw new Error('שנה לא תקינה');
  if (w.level && LEVELS.indexOf(w.level) < 0) throw new Error('רמה לא תקינה');
  const exercises = (w.exercises || [])
    .map(x => ({ name: String(x.name || '').trim().slice(0, 60), unit: x.unit, target: String(x.target || '').trim().slice(0, 40) }))
    .filter(x => x.name);
  if (!exercises.length) throw new Error('צריך לפחות תרגיל אחד');
  exercises.forEach(x => { if (UNITS.indexOf(x.unit) < 0) throw new Error('יחידה לא תקינה'); });

  const row = {
    id: Utilities.getUuid(), date: w.date, title: title, year: w.year || '', level: w.level || '',
    exercises: JSON.stringify(exercises), notes: String(w.notes || '').slice(0, 300), createdAt: new Date().toISOString()
  };
  append_('Workouts', row);
  row.exercises = exercises;
  return row;
}

function addLog_(l) {
  const trainee = readAll_('Trainees').find(t => t.id === l.traineeId);
  if (!trainee) throw new Error('חניך לא נמצא');
  const workout = readWorkouts_().find(w => w.id === l.workoutId);
  if (!workout) throw new Error('האימון לא נמצא');
  if ((workout.year && workout.year !== trainee.year) || (workout.level && workout.level !== trainee.level)) {
    throw new Error('האימון הזה לא מיועד לך');
  }
  const results = {};
  workout.exercises.forEach((x, i) => {
    const v = l.results && l.results[i];
    if (v !== '' && v != null && !isNaN(Number(v)) && Number(v) >= 0) results[i] = Number(v);
  });
  if (!Object.keys(results).length) throw new Error('לא הוזנו תוצאות');

  // תיעוד חוזר של אותו אימון מחליף את הקודם
  deleteRow_('Logs', r => r.traineeId === trainee.id && r.workoutId === workout.id);
  const row = {
    id: Utilities.getUuid(), traineeId: trainee.id, workoutId: workout.id, date: workout.date,
    results: JSON.stringify(results), notes: String(l.notes || '').slice(0, 300), createdAt: new Date().toISOString()
  };
  append_('Logs', row);
  row.results = results;
  return row;
}

function setLevel_(traineeId, level) {
  if (LEVELS.indexOf(level) < 0) throw new Error('רמה לא תקינה');
  const sheet = getSheet_('Trainees');
  const values = sheet.getDataRange().getValues();
  const col = SHEETS.Trainees.indexOf('level');
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === traineeId) { sheet.getRange(i + 1, col + 1).setValue(level); return true; }
  }
  return false;
}

function genLeaderCodes_(reset) {
  const sheet = getSheet_('Codes');
  if (reset && sheet.getLastRow() > 1) sheet.deleteRows(2, sheet.getLastRow() - 1);
  const have = readAll_('Codes');
  const used = {};
  have.forEach(c => (used[String(c.code)] = true));
  Object.keys(SQUADS).forEach(year => {
    for (let q = 1; q <= SQUADS[year]; q++) {
      if (have.some(c => c.year === year && Number(c.squad) === q)) continue;
      let code;
      do { code = randomCode_(); } while (used[code]);
      used[code] = true;
      append_('Codes', { year: year, squad: q, code: code });
    }
  });
}

// ---------- גישה לגיליון ----------

function readWorkouts_() {
  return readAll_('Workouts').map(w => Object.assign(w, { exercises: parse_(w.exercises, []) }));
}

function readLogs_() {
  return readAll_('Logs').map(l => Object.assign(l, { results: parse_(l.results, {}) }));
}

function readAll_(name) {
  const values = getSheet_(name).getDataRange().getValues();
  const head = values.shift();
  return values
    .filter(r => r[0] !== '')
    .map(r => {
      const o = {};
      head.forEach((h, i) => {
        let v = r[i];
        if (v instanceof Date) v = Utilities.formatDate(v, 'Asia/Jerusalem', 'yyyy-MM-dd');
        o[h] = h === 'code' ? String(v) : v;
      });
      return o;
    });
}

function append_(name, row) {
  // טקסט עם גרש מונע מהגיליון להמיר תאריכים וקודים עם אפסים מובילים
  const asText = { date: true, code: true };
  getSheet_(name).appendRow(SHEETS[name].map(h => (asText[h] ? "'" + row[h] : row[h])));
}

function deleteRow_(name, match) {
  const sheet = getSheet_(name);
  const values = sheet.getDataRange().getValues();
  const head = values[0];
  let deleted = false;
  for (let i = values.length - 1; i >= 1; i--) {
    const o = {};
    head.forEach((h, j) => (o[h] = values[i][j]));
    if (match(o)) { sheet.deleteRow(i + 1); deleted = true; }
  }
  return deleted;
}

function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(SHEETS[name]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function randomCode_() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function parse_(s, fallback) {
  if (typeof s !== 'string') return s || fallback;
  try { return JSON.parse(s); } catch (e) { return fallback; }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

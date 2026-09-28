// API של מעקב המד"ס. כל בקשה נושאת קוד בכותרת x-code, והקוד קובע מה מותר:
//   קוד צוות        — הכל
//   קוד אחראי קבוצה — רק הקבוצה שלו: חניכים, אימונים ותוצאות
//   קוד חניך        — רק האימונים והתוצאות שלו
// קודי הצוות והאחראים מגיעים ממשתנה הסביבה MDS_CODES; קודי החניכים נוצרים כשאחראי מוסיף חניך.
import crypto from 'node:crypto';
import { openStore, update, read } from '../lib/store.mjs';

const SQUADS = { 'א': 12, 'ב': 2 };
const LEVELS = ['א', 'ב', 'ג'];
const STATUSES = ['פעיל', 'פצוע', 'פטור', 'עזב'];
const UNITS = ['reps', 'time', 'hold', 'kg', 'meters'];
const LATIN = { 'א': 'A', 'ב': 'B' };
const HEB = { A: 'א', B: 'ב' };

const EMPTY_SQUAD = { trainees: [], workouts: [], logs: [] };
const squadKey = (year, squad) => `squad/${LATIN[year]}-${squad}`;
const allSquads = () => Object.entries(SQUADS).flatMap(([year, n]) => Array.from({ length: n }, (_, i) => ({ year, squad: i + 1 })));

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (msg, status = 400) => { throw new HttpError(status, msg); };

// "STAFF:1234567890;A1:12345678;B2:87654321"
function envCodes() {
  const out = new Map();
  for (const part of String(process.env.MDS_CODES || '').split(/[;,\s]+/)) {
    const [who, code] = part.split(':').map(s => s && s.trim());
    if (!who || !code) continue;
    if (who.toUpperCase() === 'STAFF') out.set(code, { role: 'staff' });
    const m = who.toUpperCase().match(/^([AB])(\d{1,2})$/);
    if (m) out.set(code, { role: 'leader', year: HEB[m[1]], squad: Number(m[2]) });
  }
  return out;
}

async function resolve(store, code) {
  code = String(code || '').trim();
  if (!code) fail('נא להזין קוד', 401);
  const env = envCodes();
  if (env.has(code)) return env.get(code);
  const idx = await read(store, 'trainee-codes', {});
  if (idx[code]) return { role: 'trainee', ...idx[code] };
  await new Promise(r => setTimeout(r, 700)); // מאט ניחושים
  fail('קוד שגוי', 401);
}

const newId = () => crypto.randomUUID();
const newCode = taken => {
  let c;
  do { c = String(crypto.randomInt(10000000, 100000000)); } while (taken.has(c));
  return c;
};
const clean = (s, max) => String(s ?? '').trim().slice(0, max);
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
const forTrainee = (w, t) => !w.level || w.level === t.level;

// מה חניך רואה: רק הוא, האימונים שמיועדים לו והתוצאות שלו
function traineeView(doc, id) {
  const me = doc.trainees.find(t => t.id === id);
  if (!me) fail('החניך לא נמצא. פנו לאחראי הקבוצה', 401);
  const { code, ...pub } = me;
  return {
    me: pub,
    workouts: doc.workouts.filter(w => forTrainee(w, me)),
    logs: doc.logs.filter(l => l.traineeId === id)
  };
}

function scopeOf(auth, body) {
  if (auth.role === 'leader') return { year: auth.year, squad: auth.squad };
  if (auth.role === 'staff') {
    const year = body.year, squad = Number(body.squad);
    if (!SQUADS[year] || !(squad >= 1 && squad <= SQUADS[year])) fail('קבוצה לא תקינה');
    return { year, squad };
  }
  fail('אין הרשאה', 403);
}

function validWorkout(w) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(w.date || '')) fail('תאריך לא תקין');
  const slot = Number(w.slot);
  if (![1, 2, 3].includes(slot)) fail('נא לבחור מד"ס 1, 2 או 3');
  const title = clean(w.title, 80);
  if (w.level && !LEVELS.includes(w.level)) fail('רמה לא תקינה');
  const exercises = (w.exercises || [])
    .map(x => ({ name: clean(x.name, 60), unit: x.unit, target: clean(x.target, 40) }))
    .filter(x => x.name);
  if (!exercises.length) fail('צריך לפחות תרגיל אחד');
  if (exercises.some(x => !UNITS.includes(x.unit))) fail('יחידה לא תקינה');
  return { date: w.date, slot, title, level: w.level || '', exercises, notes: clean(w.notes, 300) };
}

const actions = {
  async login(store, auth) {
    if (auth.role === 'trainee') {
      const doc = await read(store, squadKey(auth.year, auth.squad), EMPTY_SQUAD);
      return { auth: { role: 'trainee', year: auth.year, squad: auth.squad }, ...traineeView(doc, auth.id) };
    }
    const scopes = auth.role === 'staff' ? allSquads() : [{ year: auth.year, squad: auth.squad }];
    const squads = await Promise.all(scopes.map(async s => ({ ...s, ...(await read(store, squadKey(s.year, s.squad), EMPTY_SQUAD)) })));
    return { auth, squads };
  },

  // ----- חניך -----
  async saveLog(store, auth, b) {
    if (auth.role !== 'trainee') fail('רק חניך יכול להזין תוצאה', 403);
    const { result } = await update(store, squadKey(auth.year, auth.squad), EMPTY_SQUAD, doc => {
      const me = doc.trainees.find(t => t.id === auth.id);
      if (!me) fail('החניך לא נמצא', 401);
      const w = doc.workouts.find(x => x.id === b.workoutId);
      if (!w || !forTrainee(w, me)) fail('האימון לא נמצא');
      if (w.date > today()) fail('אי אפשר להזין תוצאה לאימון עתידי');
      const results = {};
      w.exercises.forEach((x, i) => {
        const v = b.results?.[i];
        if (v !== '' && v != null && Number.isFinite(Number(v)) && Number(v) >= 0) results[i] = Number(v);
      });
      if (!Object.keys(results).length) fail('לא הוזנו תוצאות');
      doc.logs = doc.logs.filter(l => !(l.traineeId === me.id && l.workoutId === w.id));
      const log = { id: newId(), traineeId: me.id, workoutId: w.id, date: w.date, results, notes: clean(b.notes, 300), createdAt: new Date().toISOString() };
      doc.logs.push(log);
      return log;
    });
    return { log: result };
  },

  async deleteLog(store, auth, b) {
    if (auth.role !== 'trainee') fail('אין הרשאה', 403);
    await update(store, squadKey(auth.year, auth.squad), EMPTY_SQUAD, doc => {
      doc.logs = doc.logs.filter(l => !(l.id === b.id && l.traineeId === auth.id));
    });
    return {};
  },

  // ----- אחראי קבוצה וצוות -----
  async addTrainees(store, auth, b) {
    const s = scopeOf(auth, b);
    const names = [...new Set((b.names || []).map(n => clean(n, 60)).filter(n => n.length >= 2))];
    if (!names.length) fail('נא להזין לפחות שם אחד');
    if (names.length > 60) fail('אפשר להוסיף עד 60 שמות בכל פעם');
    const level = LEVELS.includes(b.level) ? b.level : 'ב';
    const status = STATUSES.includes(b.status) ? b.status : 'פעיל';

    const existing = await read(store, squadKey(s.year, s.squad), EMPTY_SQUAD);
    const added = names
      .filter(name => !existing.trainees.some(t => t.name === name))
      .map(name => ({ id: newId(), name, level, status, code: '', createdAt: new Date().toISOString() }));
    if (!added.length) fail('כל השמות כבר קיימים בקבוצה');

    // קודם שומרים קודים באינדקס, ואז את החניכים עצמם
    const env = envCodes();
    await update(store, 'trainee-codes', {}, idx => {
      const taken = new Set([...Object.keys(idx), ...env.keys()]);
      for (const t of added) { t.code = newCode(taken); taken.add(t.code); idx[t.code] = { year: s.year, squad: s.squad, id: t.id }; }
    });
    const { data } = await update(store, squadKey(s.year, s.squad), EMPTY_SQUAD, doc => {
      for (const t of added) if (!doc.trainees.some(x => x.name === t.name)) doc.trainees.push(t);
    });
    return { trainees: data.trainees, added: added.length };
  },

  async updateTrainee(store, auth, b) {
    const s = scopeOf(auth, b);
    const { data } = await update(store, squadKey(s.year, s.squad), EMPTY_SQUAD, doc => {
      const t = doc.trainees.find(x => x.id === b.id);
      if (!t) fail('החניך לא נמצא');
      if (b.name != null) { const n = clean(b.name, 60); if (n.length < 2) fail('שם קצר מדי'); t.name = n; }
      if (b.level != null) { if (!LEVELS.includes(b.level)) fail('רמה לא תקינה'); t.level = b.level; }
      if (b.status != null) { if (!STATUSES.includes(b.status)) fail('סטטוס לא תקין'); t.status = b.status; }
    });
    return { trainees: data.trainees };
  },

  async resetTraineeCode(store, auth, b) {
    const s = scopeOf(auth, b);
    const doc = await read(store, squadKey(s.year, s.squad), EMPTY_SQUAD);
    const t = doc.trainees.find(x => x.id === b.id);
    if (!t) fail('החניך לא נמצא');
    const env = envCodes();
    let code;
    await update(store, 'trainee-codes', {}, idx => {
      delete idx[t.code];
      code = newCode(new Set([...Object.keys(idx), ...env.keys()]));
      idx[code] = { year: s.year, squad: s.squad, id: t.id };
    });
    const { data } = await update(store, squadKey(s.year, s.squad), EMPTY_SQUAD, d => {
      const x = d.trainees.find(y => y.id === t.id);
      if (x) x.code = code;
    });
    return { trainees: data.trainees };
  },

  async deleteTrainee(store, auth, b) {
    const s = scopeOf(auth, b);
    let code = null;
    const { data } = await update(store, squadKey(s.year, s.squad), EMPTY_SQUAD, doc => {
      const t = doc.trainees.find(x => x.id === b.id);
      if (!t) fail('החניך לא נמצא');
      code = t.code;
      doc.trainees = doc.trainees.filter(x => x.id !== b.id);
      doc.logs = doc.logs.filter(l => l.traineeId !== b.id);
    });
    if (code) await update(store, 'trainee-codes', {}, idx => { delete idx[code]; });
    return { trainees: data.trainees, logs: data.logs };
  },

  async addWorkout(store, auth, b) {
    const w = validWorkout(b.workout || {});
    // צוות יכול לפרסם לכמה קבוצות בבת אחת
    let targets;
    if (auth.role === 'staff' && b.target === 'all') targets = allSquads();
    else if (auth.role === 'staff' && SQUADS[b.target]) targets = allSquads().filter(s => s.year === b.target);
    else targets = [scopeOf(auth, b)];
    const created = [];
    for (const s of targets) {
      const workout = { ...w, id: newId(), createdAt: new Date().toISOString() };
      await update(store, squadKey(s.year, s.squad), EMPTY_SQUAD, doc => {
        doc.workouts = doc.workouts.filter(x => x.id !== workout.id);
        doc.workouts.push(workout);
      });
      created.push({ ...s, workout });
    }
    return { created };
  },

  async deleteWorkout(store, auth, b) {
    const s = scopeOf(auth, b);
    await update(store, squadKey(s.year, s.squad), EMPTY_SQUAD, doc => {
      doc.workouts = doc.workouts.filter(w => w.id !== b.id);
      doc.logs = doc.logs.filter(l => l.workoutId !== b.id);
    });
    return {};
  }
};

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

export default async req => {
  if (req.method !== 'POST') return json({ ok: false, error: 'POST בלבד' }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const fn = actions[body.action];
    if (!fn) fail('פעולה לא מוכרת');
    const store = openStore();
    const auth = await resolve(store, req.headers.get('x-code'));
    return json({ ok: true, ...(await fn(store, auth, body)) });
  } catch (err) {
    if (err instanceof HttpError) return json({ ok: false, error: err.message }, err.status);
    console.error(err);
    return json({ ok: false, error: 'שגיאת שרת, נסו שוב' }, 500);
  }
};

export const config = { path: '/api' };

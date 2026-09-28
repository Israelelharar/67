(() => {
  const CFG = window.CONFIG;
  const DEMO = !CFG.API_URL;
  const ME_KEY = 'mds.me';
  const CODE_KEY = 'mds.code';
  const DEMO_KEY = 'mds.demo.v3';

  const UNITS = {
    reps: { label: 'חזרות', short: 'חזרות' },
    time: { label: 'זמן ריצה/מקטע (פחות = טוב)', short: '', lowerBetter: true, clock: true },
    hold: { label: 'זמן החזקה (יותר = טוב)', short: '', clock: true },
    kg: { label: 'ק"ג', short: 'ק"ג' },
    meters: { label: 'מטרים', short: 'מ\'' }
  };

  const state = {
    trainees: [], workouts: [], logs: [], codes: [],
    auth: null, view: 'log', viewTrainee: null, squadFilter: null, staffTab: 'workouts',
    exercise: null, draft: null
  };
  const charts = [];

  // ---------- עזרים ----------
  const $ = sel => document.querySelector(sel);
  const $$ = sel => document.querySelectorAll(sel);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
  const toISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = () => toISO(new Date());
  const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return toISO(d); };
  // שבוע ישראלי: ראשון עד שבת
  const weekStart = iso => { const d = new Date(iso + 'T12:00:00'); return addDays(iso, -d.getDay()); };
  const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const dayName = iso => DAYS[new Date(iso + 'T12:00:00').getDay()];
  const fmtDate = iso => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y.slice(2)}`; };
  const fmtTime = sec => {
    if (sec == null) return '—';
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };
  const parseTime = str => {
    const m = String(str).trim().match(/^(\d{1,3})(?::(\d{1,2}))?$/);
    return m ? Number(m[1]) * 60 + Number(m[2] || 0) : null;
  };
  const isClock = unit => !!UNITS[unit]?.clock;
  const fmtVal = (v, unit) => (v == null ? '—' : isClock(unit) ? fmtTime(v) : `${v}${UNITS[unit]?.short ? ' ' + UNITS[unit].short : ''}`);
  const avg = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const pct = x => (x == null ? '—' : `${Math.round(x * 100)}%`);
  const squadName = t => `שנה ${t.year} · קבוצה ${t.squad}`;
  const lvlBadge = lvl => `<span class="lvl lvl-${esc(lvl)}" title="${esc(CFG.LEVELS[lvl] || '')}">${esc(lvl)}</span>`;
  const weekDots = (done, total) => total
    ? `<span class="week-dots" title="${done} מתוך ${total}">${Array.from({ length: total }, (_, i) => `<i class="${i < done ? 'on' : ''}"></i>`).join('')}</span>`
    : '<span class="muted">—</span>';
  const audience = w => [w.year ? `שנה ${w.year}` : 'כל השנים', w.level ? `רמה ${w.level}` : 'כל הרמות'].join(' · ');

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (el.hidden = true), 2800);
  }

  const store = (area, key, val) => { try { val == null ? area.removeItem(key) : area.setItem(key, val); } catch {} };
  const load = (area, key) => { try { return area.getItem(key); } catch { return null; } };
  const getMe = () => load(localStorage, ME_KEY);
  const me = () => state.trainees.find(t => t.id === getMe()) || null;
  const isStaff = () => state.auth?.role === 'staff';

  function mergeLogs(list) {
    const byId = new Map(state.logs.map(l => [l.id, l]));
    list.forEach(l => byId.set(l.id, l));
    state.logs = [...byId.values()];
  }

  // ---------- שכבת נתונים ----------
  const api = {
    async get(params) {
      if (DEMO) return demo.handle(params.action, params);
      const res = await fetch(`${CFG.API_URL}?${new URLSearchParams(params)}`);
      return check(await res.json());
    },
    async post(body) {
      if (DEMO) return demo.handle(body.action, body);
      // text/plain כדי לא לגרום לבקשת preflight שגוגל לא תומך בה
      const res = await fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
      return check(await res.json());
    }
  };
  function check(data) {
    if (!data.ok) throw new Error(data.error || 'שגיאה');
    return data;
  }

  // מצב הדגמה: אותו API כמו השרת, על נתונים מדומים בדפדפן
  const demo = {
    STAFF: '999999',
    leaderCode: (year, q) => String((year === 'א' ? 100000 : 200000) + q),
    db() {
      if (this._db) return this._db;
      try { this._db = JSON.parse(localStorage.getItem(DEMO_KEY)); } catch {}
      if (!this._db) { this._db = seedDemo(); this.save(); }
      return this._db;
    },
    save() { try { localStorage.setItem(DEMO_KEY, JSON.stringify(this._db)); } catch {} },
    auth(code) {
      code = String(code || '').trim();
      if (code === this.STAFF) return { role: 'staff' };
      const c = this.db().codes.find(x => x.code === code);
      if (c) return { role: 'leader', year: c.year, squad: c.squad };
      throw new Error('קוד שגוי');
    },
    staff(code) { if (this.auth(code).role !== 'staff') throw new Error('הפעולה מותרת לצוות בלבד'); },
    handle(action, b) {
      const d = this.db();
      const id = () => Math.random().toString(36).slice(2, 10);
      switch (action) {
        case 'public': return { ok: true, trainees: d.trainees, workouts: d.workouts };
        case 'myLogs': return { ok: true, logs: d.logs.filter(l => l.traineeId === b.traineeId) };
        case 'login': {
          const auth = this.auth(b.code);
          let logs = d.logs;
          if (auth.role === 'leader') {
            const ids = new Set(d.trainees.filter(t => t.year === auth.year && t.squad === auth.squad).map(t => t.id));
            logs = logs.filter(l => ids.has(l.traineeId));
          }
          return { ok: true, auth, logs, codes: auth.role === 'staff' ? d.codes : undefined };
        }
        case 'addTrainee': {
          const t = { ...b.trainee, id: id(), squad: Number(b.trainee.squad), createdAt: new Date().toISOString() };
          d.trainees.push(t); this.save();
          return { ok: true, trainee: t };
        }
        case 'addLog': {
          const w = d.workouts.find(x => x.id === b.log.workoutId);
          d.logs = d.logs.filter(l => !(l.traineeId === b.log.traineeId && l.workoutId === b.log.workoutId));
          const l = { ...b.log, id: id(), date: w.date };
          d.logs.push(l); this.save();
          return { ok: true, log: l };
        }
        case 'deleteLog': d.logs = d.logs.filter(l => l.id !== b.id); this.save(); return { ok: true };
        case 'addWorkout': {
          this.staff(b.code);
          const w = { ...b.workout, id: id() };
          d.workouts.push(w); this.save();
          return { ok: true, workout: w };
        }
        case 'deleteWorkout': this.staff(b.code); d.workouts = d.workouts.filter(w => w.id !== b.id); this.save(); return { ok: true };
        case 'setLevel': this.staff(b.code); d.trainees.find(t => t.id === b.traineeId).level = b.level; this.save(); return { ok: true };
        case 'genCodes': {
          this.staff(b.code);
          if (b.reset) d.codes = d.codes.map(c => ({ ...c, code: String(Math.floor(100000 + Math.random() * 900000)) }));
          this.save();
          return { ok: true, codes: d.codes };
        }
      }
      throw new Error('פעולה לא מוכרת');
    }
  };

  function seedDemo() {
    const first = ['נועם', 'יונתן', 'איתי', 'עומר', 'אורי', 'דניאל', 'יואב', 'אלון', 'רועי', 'עידו', 'תמר', 'נוגה', 'שירה', 'מאיה', 'הילה', 'ליה', 'אביגיל', 'רוני', 'גיא', 'אריאל'];
    const last = ['כהן', 'לוי', 'מזרחי', 'פרץ', 'ביטון', 'אברהם', 'פרידמן', 'שפירא', 'דהן', 'אזולאי', 'גבאי', 'חדד'];
    const rand = (a, b) => a + Math.random() * (b - a);
    const templates = [
      { title: 'מד"ס פלג גוף עליון', exercises: [{ name: 'שכיבות סמיכה', unit: 'reps', target: '3 סטים מקסימום' }, { name: 'מתח', unit: 'reps', target: 'מקסימום' }, { name: 'מקבילים', unit: 'reps', target: '3×12' }] },
      { title: 'מד"ס ליבה', exercises: [{ name: 'כפיפות בטן', unit: 'reps', target: 'דקה' }, { name: 'פלאנק', unit: 'hold', target: 'מקסימום זמן' }] },
      { title: 'מד"ס רגליים וריצה', exercises: [{ name: 'סקוואט', unit: 'reps', target: 'דקה' }, { name: 'ריצת 3 ק"מ', unit: 'time', target: 'מתחת ל-15:00' }] }
    ];
    const base = { 'שכיבות סמיכה': [45, 32, 18], 'מתח': [12, 7, 3], 'מקבילים': [30, 20, 10], 'כפיפות בטן': [55, 42, 30], 'פלאנק': [150, 100, 60], 'סקוואט': [60, 48, 35], 'ריצת 3 ק"מ': [780, 930, 1110] };
    const growth = { 'פלאנק': 3, 'ריצת 3 ק"מ': -6 };

    const workouts = [];
    const thisWeek = weekStart(today());
    for (let w = -8; w <= 0; w++) {
      [0, 2, 4].forEach((dow, i) => {
        const tpl = templates[i];
        workouts.push({ id: `w${w + 8}_${i}`, date: addDays(thisWeek, w * 7 + dow), title: tpl.title, year: '', level: '', exercises: tpl.exercises, notes: '' });
      });
    }

    const trainees = [], logs = [];
    let n = 0;
    const add = (year, squad) => {
      const li = Math.floor(Math.random() * 3);
      const t = { id: 'd' + n, name: `${first[n % first.length]} ${last[(n * 7) % last.length]}`, year, squad, level: ['א', 'ב', 'ג'][li] };
      n++;
      trainees.push(t);
      const skill = rand(0.9, 1.1), diligence = rand(0.6, 0.98);
      workouts.forEach(w => {
        if (w.date > today() || Math.random() > diligence) return;
        const weeks = (new Date(w.date) - new Date(workouts[0].date)) / (7 * 864e5);
        const results = {};
        w.exercises.forEach((x, i) => {
          const b = base[x.name][li] * (x.unit === 'time' ? 2 - skill : skill);
          const g = growth[x.name] ?? Math.max(0.5, b * 0.03);
          results[i] = Math.max(0, Math.round(b + g * weeks + rand(-b * 0.06, b * 0.06)));
        });
        logs.push({ id: 'l' + logs.length, traineeId: t.id, workoutId: w.id, date: w.date, results, notes: '' });
      });
    };
    for (let s = 1; s <= 12; s++) for (let i = 0; i < 10; i++) add('א', s);
    for (let s = 1; s <= 2; s++) for (let i = 0; i < 15; i++) add('ב', s);

    const codes = [];
    for (const year of ['א', 'ב']) for (let q = 1; q <= CFG.SQUADS[year]; q++) codes.push({ year, squad: q, code: demo.leaderCode(year, q) });
    return { trainees, workouts, logs, codes };
  }

  // ---------- חישובים ----------
  const logsOf = id => state.logs.filter(l => l.traineeId === id).sort((a, b) => a.date.localeCompare(b.date));
  const forTrainee = (w, t) => (!w.year || w.year === t.year) && (!w.level || w.level === t.level);
  const assignedTo = t => state.workouts.filter(w => forTrainee(w, t)).sort((a, b) => a.date.localeCompare(b.date));

  function summary(t) {
    const joined = t.createdAt ? String(t.createdAt).slice(0, 10) : '';
    const L = logsOf(t.id);
    const doneIds = new Set(L.map(l => l.workoutId));
    const all = assignedTo(t);
    const due = all.filter(w => w.date <= today() && w.date >= weekStart(joined || '2000-01-01'));
    const wk = weekStart(today());
    const weekAll = all.filter(w => weekStart(w.date) === wk);
    const weekDone = weekAll.filter(w => doneIds.has(w.id)).length;
    const doneDue = due.filter(w => doneIds.has(w.id)).length;
    const missed = due.filter(w => !doneIds.has(w.id) && w.date >= addDays(today(), -7)).length;
    return {
      total: L.length, weekDone, weekTotal: weekAll.length, due: due.length, doneDue,
      rate: due.length ? doneDue / due.length : null, missed,
      lastDate: L.length ? L[L.length - 1].date : null
    };
  }

  // כל התרגילים שהחניך ביצע, מקובצים לפי שם התרגיל
  function exerciseSeries(t) {
    const byName = new Map();
    const wById = new Map(state.workouts.map(w => [w.id, w]));
    logsOf(t.id).forEach(l => {
      const w = wById.get(l.workoutId);
      if (!w) return;
      w.exercises.forEach((x, i) => {
        const v = num(l.results?.[i]);
        if (v == null) return;
        if (!byName.has(x.name)) byName.set(x.name, { name: x.name, unit: x.unit, points: [] });
        byName.get(x.name).points.push({ date: l.date, v });
      });
    });
    return [...byName.values()].map(s => {
      const vals = s.points.map(p => p.v);
      const lower = UNITS[s.unit]?.lowerBetter;
      const best = lower ? Math.min(...vals) : Math.max(...vals);
      const change = vals.length >= 2 ? (lower ? vals[0] - vals[vals.length - 1] : vals[vals.length - 1] - vals[0]) : null;
      return { ...s, best, last: vals[vals.length - 1], change };
    });
  }

  const changeHtml = s => {
    if (s.change == null) return '<span class="muted">—</span>';
    const v = isClock(s.unit) ? fmtTime(Math.abs(s.change)) : Math.abs(s.change);
    return s.change > 0 ? `<span class="up">▲ ${v}</span>` : s.change < 0 ? `<span class="down">▼ ${v}</span>` : '<span class="muted">ללא שינוי</span>';
  };

  // ---------- רינדור ----------
  function destroyCharts() { while (charts.length) charts.pop().destroy(); }

  function render() {
    destroyCharts();
    $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
    const m = me();
    const role = state.auth ? (isStaff() ? 'צוות' : `אחראי ${squadName(state.auth)}`) : '';
    $('#me').innerHTML = [
      m ? `<div><strong>${esc(m.name)}</strong> <span class="muted">${esc(squadName(m))}</span></div>` : '',
      role ? `<div class="role-chip">${esc(role)}</div>` : '',
      m || state.auth ? `<div class="me-actions">${m ? '<button class="btn link" id="switchMe">החלפת חניך</button>' : ''}${state.auth ? '<button class="btn link" id="logoutCode">יציאה מהקוד</button>' : ''}</div>` : ''
    ].join('');

    const main = $('#main');
    if (state.view === 'log') main.innerHTML = m ? logView(m) : pickView();
    if (state.view === 'progress') {
      const t = state.viewTrainee || m;
      main.innerHTML = t ? progressView(t) : pickView();
    }
    if (state.view === 'squad') main.innerHTML = state.auth ? squadView() : codeGate('אחראי קבוצה', 'הזינו את הקוד שקיבלתם מהצוות כדי לראות את החניכים בקבוצה שלכם.');
    if (state.view === 'staff') main.innerHTML = isStaff() ? staffView() : codeGate('צוות', 'הכניסה לאנשי צוות בלבד. עם קוד הצוות רואים את כל הקבוצות ומגדירים אימונים.');
    bind();
  }

  function squadOptions(year, selected) {
    return Array.from({ length: CFG.SQUADS[year] || 0 }, (_, i) => `<option value="${i + 1}" ${Number(selected) === i + 1 ? 'selected' : ''}>קבוצה ${i + 1}</option>`).join('');
  }
  const yearOptions = (sel, withAll) => `${withAll ? `<option value="" ${!sel ? 'selected' : ''}>כל השנים</option>` : ''}<option value="א" ${sel === 'א' ? 'selected' : ''}>שנה א</option><option value="ב" ${sel === 'ב' ? 'selected' : ''}>שנה ב</option>`;
  const levelOptions = (sel, allLabel) => `${allLabel ? `<option value="" ${!sel ? 'selected' : ''}>${allLabel}</option>` : ''}${Object.entries(CFG.LEVELS).map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${k} · ${v}</option>`).join('')}`;

  function codeGate(title, text) {
    return `
      <section class="card gate">
        <h2>${esc(title)}</h2>
        <p class="muted">${esc(text)}</p>
        <form id="codeForm" class="code-row">
          <input id="codeInput" inputmode="numeric" autocomplete="one-time-code" placeholder="קוד" aria-label="קוד">
          <button class="btn" type="submit">כניסה</button>
        </form>
        ${DEMO ? `<p class="hint">בהדגמה: קוד צוות <b>${demo.STAFF}</b> · קוד אחראי שנה א קבוצה 1 <b>${demo.leaderCode('א', 1)}</b></p>` : ''}
      </section>`;
  }

  function pickView() {
    return `
      <section class="card">
        <h2>מי את/ה?</h2>
        <p class="muted">בוחרים פעם אחת, והדפדפן זוכר.</p>
        <div class="grid">
          <label>שנה<select id="pYear">${yearOptions('א')}</select></label>
          <label>קבוצה<select id="pSquad">${squadOptions('א', 1)}</select></label>
          <label>שם<select id="pName"></select></label>
        </div>
        <div class="actions"><button class="btn" id="pGo">המשך</button></div>
      </section>
      <section class="card">
        <h2>לא מופיעים ברשימה? הרשמה</h2>
        <div class="grid">
          <label>שם מלא<input id="rName" autocomplete="name"></label>
          <label>שנה<select id="rYear">${yearOptions('א')}</select></label>
          <label>קבוצה<select id="rSquad">${squadOptions('א', 1)}</select></label>
          <label>רמה<select id="rLevel">${levelOptions('ב')}</select></label>
        </div>
        <div class="actions"><button class="btn" id="rGo">הרשמה</button></div>
      </section>`;
  }

  // מסך החניך: אימוני השבוע + אימונים מהשבוע שעבר שלא תועדו
  function logView(m) {
    const s = summary(m);
    const L = logsOf(m.id);
    const logByW = new Map(L.map(l => [l.workoutId, l]));
    const from = addDays(weekStart(today()), -7), to = addDays(weekStart(today()), 6);
    const list = assignedTo(m).filter(w => w.date >= from && w.date <= to && (w.date >= weekStart(today()) || !logByW.has(w.id)));
    return `
      <div class="stats">
        <div class="stat"><div class="v">${s.weekDone}/${s.weekTotal || '—'}</div><div class="l">מד"ס השבוע ${weekDots(s.weekDone, s.weekTotal)}</div></div>
        <div class="stat"><div class="v">${pct(s.rate)}</div><div class="l">אחוז השלמה</div></div>
        <div class="stat"><div class="v">${s.total}</div><div class="l">אימונים שתועדו</div></div>
      </div>
      ${list.length ? list.map(w => workoutCard(w, logByW.get(w.id))).join('') : '<section class="card empty">הצוות עוד לא הגדיר מד"ס לשבוע הזה.</section>'}`;
  }

  function workoutCard(w, log) {
    const future = w.date > today();
    const isToday = w.date === today();
    const state_ = log ? 'done' : future ? 'future' : isToday ? 'today' : 'open';
    const chip = { done: '<span class="chip ok">תועד ✓</span>', future: '<span class="chip">בקרוב</span>', today: '<span class="chip now">היום</span>', open: '<span class="chip warn">חסר תיעוד</span>' }[state_];
    const editing = state.draft === w.id;
    const body = log && !editing
      ? `<ul class="results">${w.exercises.map((x, i) => `<li><span>${esc(x.name)}</span><b>${fmtVal(num(log.results?.[i]), x.unit)}</b></li>`).join('')}</ul>
         ${log.notes ? `<p class="muted">${esc(log.notes)}</p>` : ''}
         <div class="actions"><button class="btn ghost" data-edit="${esc(w.id)}">עדכון תוצאה</button></div>`
      : future
        ? `<ul class="results">${w.exercises.map(x => `<li><span>${esc(x.name)}</span><span class="muted">${esc(x.target)}</span></li>`).join('')}</ul>`
        : `<form class="result-form" data-wid="${esc(w.id)}">
            ${w.exercises.map((x, i) => `
              <label class="ex-row">
                <span class="ex-name">${esc(x.name)}${x.target ? `<small>${esc(x.target)}</small>` : ''}</span>
                <span class="ex-input">
                  <input id="r_${esc(w.id)}_${i}" name="${i}" ${isClock(x.unit) ? 'inputmode="numeric" placeholder="דק:שנ"' : 'type="number" min="0" step="any" inputmode="decimal"'} value="${num(log?.results?.[i]) == null ? '' : esc(isClock(x.unit) ? fmtTime(num(log.results[i])) : log.results[i])}">
                  <span class="unit">${esc(UNITS[x.unit].short)}</span>
                </span>
              </label>`).join('')}
            <label>הערה (לא חובה)<input id="n_${esc(w.id)}" name="notes" maxlength="300" value="${esc(log?.notes || '')}"></label>
            <div class="actions"><button class="btn" type="submit">שמירת תוצאה</button>${editing ? '<button class="btn ghost" type="button" data-cancel>ביטול</button>' : ''}</div>
          </form>`;
    return `
      <section class="card workout ${state_}">
        <div class="w-head">
          <div><div class="w-date">יום ${dayName(w.date)} · ${fmtDate(w.date)}</div><h2>${esc(w.title)}</h2></div>
          ${chip}
        </div>
        ${w.notes ? `<p class="w-notes">${esc(w.notes)}</p>` : ''}
        ${body}
      </section>`;
  }

  function progressView(t) {
    const s = summary(t);
    const series = exerciseSeries(t);
    if (!series.find(x => x.name === state.exercise)) state.exercise = series[0]?.name || null;
    const isMe = me()?.id === t.id;
    const wById = new Map(state.workouts.map(w => [w.id, w]));
    const L = logsOf(t.id).reverse();
    return `
      ${!isMe ? '<div class="actions top"><button class="btn ghost" id="backSquad">→ חזרה לקבוצה</button></div>' : ''}
      <section class="card">
        <div class="w-head">
          <div><h2>${esc(t.name)} ${lvlBadge(t.level)}</h2><div class="muted">${esc(squadName(t))} · רמה ${esc(t.level)} (${esc(CFG.LEVELS[t.level] || '')})</div></div>
          ${isStaff() ? `<label class="inline">שינוי רמה<select id="setLevel">${levelOptions(t.level)}</select></label>` : ''}
        </div>
      </section>
      <div class="stats">
        <div class="stat"><div class="v">${s.weekDone}/${s.weekTotal || '—'}</div><div class="l">השבוע ${weekDots(s.weekDone, s.weekTotal)}</div></div>
        <div class="stat"><div class="v">${pct(s.rate)}</div><div class="l">אחוז השלמה (${s.doneDue}/${s.due})</div></div>
        <div class="stat"><div class="v">${s.total}</div><div class="l">אימונים שתועדו</div></div>
      </div>
      ${series.length ? `
        <section class="card">
          <h2>שיאים ושיפור</h2>
          <div class="table-wrap"><table>
            <thead><tr><th>תרגיל</th><th>שיא</th><th>אחרון</th><th>שיפור מההתחלה</th><th>פעמים</th></tr></thead>
            <tbody>${series.map(x => `<tr class="clickable ${x.name === state.exercise ? 'sel' : ''}" data-ex="${esc(x.name)}"><td><strong>${esc(x.name)}</strong></td><td>${fmtVal(x.best, x.unit)}</td><td>${fmtVal(x.last, x.unit)}</td><td>${changeHtml(x)}</td><td>${x.points.length}</td></tr>`).join('')}</tbody>
          </table></div>
        </section>
        <section class="card">
          <div class="w-head"><h2>גרף התקדמות</h2><select id="exSel" aria-label="תרגיל">${series.map(x => `<option ${x.name === state.exercise ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
          <div class="chart-box"><canvas id="chEx"></canvas></div>
        </section>
        <section class="card"><h2>היסטוריה</h2><div class="table-wrap"><table>
          <thead><tr><th>תאריך</th><th>אימון</th><th>תוצאות</th>${isMe ? '<th></th>' : ''}</tr></thead>
          <tbody>${L.map(l => {
            const w = wById.get(l.workoutId);
            return `<tr><td>${fmtDate(l.date)}</td><td>${esc(w?.title || 'אימון שנמחק')}</td>
              <td class="wrap">${w ? w.exercises.map((x, i) => `${esc(x.name)}: <b>${fmtVal(num(l.results?.[i]), x.unit)}</b>`).join(' · ') : ''}${l.notes ? `<div class="muted">${esc(l.notes)}</div>` : ''}</td>
              ${isMe ? `<td><button class="btn danger" data-del="${esc(l.id)}">מחיקה</button></td>` : ''}</tr>`;
          }).join('')}</tbody></table></div></section>`
      : '<section class="card empty">עוד אין תוצאות מתועדות.</section>'}`;
  }

  function squadView() {
    const a = state.auth;
    const f = isStaff()
      ? (state.squadFilter ||= { year: 'א', squad: 1, level: '' })
      : (state.squadFilter = { year: a.year, squad: a.squad, level: state.squadFilter?.level || '' });
    const list = state.trainees
      .filter(t => t.year === f.year && Number(t.squad) === Number(f.squad) && (!f.level || t.level === f.level))
      .map(t => ({ t, s: summary(t) }))
      .sort((x, y) => x.t.level.localeCompare(y.t.level) || x.t.name.localeCompare(y.t.name, 'he'));
    const behind = list.filter(x => x.s.missed > 0).length;
    const avgRate = avg(list.filter(x => x.s.rate != null).map(x => x.s.rate));
    return `
      <section class="card">
        <h2>${isStaff() ? 'לוח קבוצה' : `הקבוצה שלי · ${esc(squadName(a))}`}</h2>
        <div class="filters">
          ${isStaff() ? `<select id="sYear" aria-label="שנה">${yearOptions(f.year)}</select><select id="sSquad" aria-label="קבוצה">${squadOptions(f.year, f.squad)}</select>` : ''}
          <select id="sLevel" aria-label="רמה">${levelOptions(f.level, 'כל הרמות')}</select>
        </div>
        <div class="stats">
          <div class="stat"><div class="v">${list.length}</div><div class="l">חניכים</div></div>
          <div class="stat"><div class="v">${pct(avgRate)}</div><div class="l">השלמה ממוצעת</div></div>
          <div class="stat"><div class="v warn-text">${behind}</div><div class="l">חסר להם תיעוד מהשבוע האחרון</div></div>
        </div>
        ${list.length ? `<div class="table-wrap"><table>
          <thead><tr><th>שם</th><th>רמה</th><th>השבוע</th><th>אחוז השלמה</th><th>חסרים (7 ימים)</th><th>תיעוד אחרון</th></tr></thead>
          <tbody>${list.map(({ t, s }) => `<tr class="clickable" data-tr="${esc(t.id)}">
            <td><strong>${esc(t.name)}</strong></td><td>${lvlBadge(t.level)}</td>
            <td>${weekDots(s.weekDone, s.weekTotal)}</td><td>${pct(s.rate)}</td>
            <td>${s.missed ? `<span class="chip warn">${s.missed}</span>` : '<span class="muted">0</span>'}</td>
            <td>${s.lastDate ? fmtDate(s.lastDate) : '—'}</td>
          </tr>`).join('')}</tbody></table></div>
          <p class="muted small">לחיצה על חניך פותחת את ההתקדמות שלו.</p>`
        : '<div class="empty">אין חניכים בקבוצה הזאת.</div>'}
      </section>`;
  }

  // ---------- מסך צוות ----------
  function staffView() {
    const tabs = { workouts: 'אימונים', overview: 'סקירה כללית', codes: 'קודי אחראים' };
    return `
      <nav class="subtabs">${Object.entries(tabs).map(([k, v]) => `<button data-stab="${k}" class="${state.staffTab === k ? 'active' : ''}">${v}</button>`).join('')}</nav>
      ${state.staffTab === 'workouts' ? workoutsAdmin() : state.staffTab === 'codes' ? codesAdmin() : overviewView()}`;
  }

  function blankWorkout() {
    return { date: today(), title: '', year: '', level: '', notes: '', exercises: [{ name: '', unit: 'reps', target: '' }] };
  }

  function workoutsAdmin() {
    const w = state.form ||= blankWorkout();
    const upcoming = [...state.workouts].sort((a, b) => b.date.localeCompare(a.date));
    const shown = upcoming.filter(x => x.date >= addDays(today(), -21));
    return `
      <section class="card">
        <h2>הגדרת מד"ס חדש</h2>
        <form id="wForm">
          <div class="grid">
            <label>תאריך<input type="date" id="wDate" value="${esc(w.date)}" required></label>
            <label>שם האימון<input id="wTitle" value="${esc(w.title)}" placeholder='מד"ס פלג גוף עליון' required></label>
            <label>שנה<select id="wYear">${yearOptions(w.year, true)}</select></label>
            <label>רמה<select id="wLevel">${levelOptions(w.level, 'כל הרמות')}</select></label>
          </div>
          <h3>תרגילים</h3>
          <div class="ex-edit">
            ${w.exercises.map((x, i) => `
              <div class="ex-edit-row">
                <input id="exN${i}" data-exf="name" data-i="${i}" value="${esc(x.name)}" placeholder="שם התרגיל" aria-label="שם התרגיל">
                <select id="exU${i}" data-exf="unit" data-i="${i}" aria-label="מה החניך מזין">${Object.entries(UNITS).map(([k, u]) => `<option value="${k}" ${x.unit === k ? 'selected' : ''}>${u.label}</option>`).join('')}</select>
                <input id="exT${i}" data-exf="target" data-i="${i}" value="${esc(x.target)}" placeholder="יעד / הנחיה (לא חובה)" aria-label="יעד">
                <button type="button" class="btn danger" data-exdel="${i}" ${w.exercises.length < 2 ? 'disabled' : ''} aria-label="הסרת תרגיל">✕</button>
              </div>`).join('')}
          </div>
          <button type="button" class="btn ghost" id="exAdd">+ הוספת תרגיל</button>
          <label class="spaced">הנחיות לחניכים (לא חובה)<input id="wNotes" value="${esc(w.notes)}" maxlength="300"></label>
          <div class="actions"><button class="btn" type="submit">פרסום לחניכים</button><button type="button" class="btn ghost" id="wClear">ניקוי</button></div>
        </form>
      </section>
      <section class="card">
        <h2>אימונים (3 שבועות אחרונים והלאה)</h2>
        ${shown.length ? `<div class="table-wrap"><table>
          <thead><tr><th>תאריך</th><th>אימון</th><th>למי</th><th>תרגילים</th><th>תיעדו</th><th></th></tr></thead>
          <tbody>${shown.map(x => {
            const target = state.trainees.filter(t => forTrainee(x, t));
            const done = new Set(state.logs.filter(l => l.workoutId === x.id).map(l => l.traineeId)).size;
            return `<tr><td>${dayName(x.date)} ${fmtDate(x.date)}</td><td><strong>${esc(x.title)}</strong></td><td>${esc(audience(x))}</td>
              <td class="wrap">${x.exercises.map(e => esc(e.name)).join(', ')}</td>
              <td>${x.date > today() ? '<span class="muted">—</span>' : `${done}/${target.length}`}</td>
              <td class="row-actions"><button class="btn ghost" data-dup="${esc(x.id)}">שכפול</button><button class="btn danger" data-wdel="${esc(x.id)}">מחיקה</button></td></tr>`;
          }).join('')}</tbody></table></div>` : '<div class="empty">עוד לא הוגדרו אימונים.</div>'}
      </section>`;
  }

  function codesAdmin() {
    const codes = [...state.codes].sort((a, b) => a.year.localeCompare(b.year) || a.squad - b.squad);
    return `
      <section class="card">
        <h2>קודי אחראי קבוצה</h2>
        <p class="muted">כל אחראי מקבל את הקוד של הקבוצה שלו ורואה רק אותה. קוד הצוות לא מופיע כאן${DEMO ? '' : ' (הוא נשמר ב-Script Properties)'}.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>שנה</th><th>קבוצה</th><th>קוד</th></tr></thead>
          <tbody>${codes.map(c => `<tr><td>שנה ${esc(c.year)}</td><td>${esc(c.squad)}</td><td class="code">${esc(c.code)}</td></tr>`).join('')}</tbody>
        </table></div>
        <div class="actions"><button class="btn ghost" id="resetCodes">החלפת כל הקודים</button></div>
      </section>`;
  }

  function overviewView() {
    const rows = [];
    for (const year of ['א', 'ב']) for (const lvl of Object.keys(CFG.LEVELS)) {
      const ss = state.trainees.filter(t => t.year === year && t.level === lvl).map(summary);
      rows.push({ year, lvl, count: ss.length, rate: avg(ss.filter(s => s.rate != null).map(s => s.rate)), week: avg(ss.filter(s => s.weekTotal).map(s => s.weekDone / s.weekTotal)), behind: ss.filter(s => s.missed).length });
    }
    const squads = [];
    for (const year of ['א', 'ב']) for (let q = 1; q <= CFG.SQUADS[year]; q++) {
      const ss = state.trainees.filter(t => t.year === year && Number(t.squad) === q).map(summary);
      squads.push({ year, q, count: ss.length, rate: avg(ss.filter(s => s.rate != null).map(s => s.rate)), behind: ss.filter(s => s.missed).length });
    }
    const wk = weekStart(today());
    const weekLogs = state.logs.filter(l => weekStart(l.date) === wk).length;
    return `
      <div class="stats">
        <div class="stat"><div class="v">${state.trainees.length}</div><div class="l">חניכים רשומים</div></div>
        <div class="stat"><div class="v">${weekLogs}</div><div class="l">תיעודים השבוע</div></div>
        <div class="stat"><div class="v">${pct(avg(squads.filter(s => s.rate != null).map(s => s.rate)))}</div><div class="l">השלמה ממוצעת</div></div>
      </div>
      <section class="card"><h2>לפי שנה ורמה</h2><div class="table-wrap"><table>
        <thead><tr><th>שנה</th><th>רמה</th><th>חניכים</th><th>השלמה כוללת</th><th>השלמה השבוע</th><th>חסר להם תיעוד</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>שנה ${r.year}</td><td>${lvlBadge(r.lvl)} ${esc(CFG.LEVELS[r.lvl])}</td><td>${r.count}</td><td>${pct(r.rate)}</td><td>${pct(r.week)}</td><td>${r.behind}</td></tr>`).join('')}</tbody>
      </table></div></section>
      <section class="card"><h2>השלמת מד"ס לפי קבוצה</h2><div class="chart-box"><canvas id="chSquads"></canvas></div>
        <div class="table-wrap"><table>
        <thead><tr><th>קבוצה</th><th>חניכים</th><th>אחוז השלמה</th><th>חסר להם תיעוד</th></tr></thead>
        <tbody>${squads.map(s => `<tr class="clickable" data-squad="${s.year}|${s.q}"><td>שנה ${s.year} · ${s.q}</td><td>${s.count}</td><td>${pct(s.rate)}</td><td>${s.behind}</td></tr>`).join('')}</tbody>
      </table></div></section>`;
  }

  // ---------- גרפים ----------
  const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function drawExerciseChart(t) {
    if (!window.Chart || !$('#chEx')) return;
    const s = exerciseSeries(t).find(x => x.name === state.exercise);
    if (!s) return;
    const time = isClock(s.unit);
    const lower = !!UNITS[s.unit].lowerBetter;
    const color = token('--brand');
    charts.push(new Chart($('#chEx'), {
      type: 'line',
      data: { labels: s.points.map(p => fmtDate(p.date)), datasets: [{ label: s.name, data: s.points.map(p => p.v), borderColor: color, backgroundColor: color, tension: .25, pointRadius: 3 }] },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmtVal(c.parsed.y, s.unit) } } },
        // כשפחות זה טוב (זמן ריצה) הציר הפוך, כדי ששיפור תמיד יעלה למעלה
        scales: { y: { reverse: lower, beginAtZero: !lower, ticks: { callback: v => (time ? fmtTime(v) : v) } } }
      }
    }));
  }

  function drawSquadChart() {
    if (!window.Chart || !$('#chSquads')) return;
    const labels = [], data = [];
    for (const year of ['א', 'ב']) for (let q = 1; q <= CFG.SQUADS[year]; q++) {
      const ss = state.trainees.filter(t => t.year === year && Number(t.squad) === q).map(summary).filter(s => s.rate != null);
      labels.push(`${year}${q}`);
      data.push(ss.length ? Math.round(avg(ss.map(s => s.rate)) * 100) : 0);
    }
    charts.push(new Chart($('#chSquads'), {
      type: 'bar',
      data: { labels, datasets: [{ label: 'אחוז השלמה', data, backgroundColor: token('--brand'), borderRadius: 4 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.parsed.y}%` } } }, scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } } } }
    }));
  }

  // ---------- אירועים ----------
  async function busy(btn, fn) {
    btn.disabled = true;
    try { await fn(); } catch (err) { toast(err.message); } finally { btn.disabled = false; }
  }

  // כפתור שדורש לחיצה שנייה לאישור (דיאלוג confirm לא תמיד זמין)
  function armed(btn, label) {
    if (btn.dataset.armed) return true;
    btn.dataset.armed = '1';
    btn.textContent = label;
    return false;
  }

  async function login(code, silent) {
    const data = await api.post({ action: 'login', code });
    state.auth = { ...data.auth, code };
    state.codes = data.codes || [];
    mergeLogs(data.logs);
    store(sessionStorage, CODE_KEY, code);
    if (!silent) toast(isStaff() ? 'נכנסת כצוות' : `נכנסת כאחראי ${squadName(state.auth)}`);
  }

  async function selectMe(id) {
    store(localStorage, ME_KEY, id);
    state.viewTrainee = null;
    const { logs } = await api.get({ action: 'myLogs', traineeId: id });
    mergeLogs(logs);
  }

  function bind() {
    if ($('#switchMe')) $('#switchMe').onclick = () => { store(localStorage, ME_KEY, null); state.view = 'log'; render(); };
    if ($('#logoutCode')) $('#logoutCode').onclick = () => {
      state.auth = null; state.codes = []; state.squadFilter = null;
      store(sessionStorage, CODE_KEY, null);
      const mine = getMe();
      state.logs = state.logs.filter(l => l.traineeId === mine);
      if (state.view === 'progress' && state.viewTrainee) state.viewTrainee = null;
      render();
    };

    // בחירת חניך והרשמה
    if ($('#pYear')) {
      const fillNames = () => {
        const y = $('#pYear').value, q = Number($('#pSquad').value);
        const names = state.trainees.filter(t => t.year === y && Number(t.squad) === q).sort((a, b) => a.name.localeCompare(b.name, 'he'));
        $('#pName').innerHTML = names.length ? names.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('') : '<option value="">אין עדיין חניכים. אפשר להירשם למטה</option>';
      };
      fillNames();
      $('#pYear').onchange = () => { $('#pSquad').innerHTML = squadOptions($('#pYear').value, 1); fillNames(); };
      $('#pSquad').onchange = fillNames;
      $('#pGo').onclick = e => { if ($('#pName').value) busy(e.target, async () => { await selectMe($('#pName').value); render(); }); };
      $('#rYear').onchange = () => { $('#rSquad').innerHTML = squadOptions($('#rYear').value, 1); };
      $('#rGo').onclick = e => busy(e.target, async () => {
        const name = $('#rName').value.trim();
        if (name.length < 2) throw new Error('נא להזין שם מלא');
        const { trainee } = await api.post({ action: 'addTrainee', trainee: { name, year: $('#rYear').value, squad: Number($('#rSquad').value), level: $('#rLevel').value } });
        if (!state.trainees.some(t => t.id === trainee.id)) state.trainees.push(trainee);
        await selectMe(trainee.id);
        toast('נרשמת בהצלחה');
        render();
      });
    }

    // הזנת תוצאה
    $$('.result-form').forEach(form => form.onsubmit = e => {
      e.preventDefault();
      const w = state.workouts.find(x => x.id === form.dataset.wid);
      busy(form.querySelector('[type=submit]'), async () => {
        const results = {};
        w.exercises.forEach((x, i) => {
          const raw = form.elements[String(i)].value.trim();
          if (!raw) return;
          const v = isClock(x.unit) ? parseTime(raw) : num(raw);
          if (v == null || v < 0) throw new Error(`ערך לא תקין ב"${x.name}"${isClock(x.unit) ? ' (דקות:שניות, למשל 1:45)' : ''}`);
          results[i] = v;
        });
        if (!Object.keys(results).length) throw new Error('מלאו לפחות תוצאה אחת');
        const { log } = await api.post({ action: 'addLog', log: { traineeId: me().id, workoutId: w.id, results, notes: form.elements.notes.value.trim() } });
        state.logs = state.logs.filter(l => !(l.traineeId === log.traineeId && l.workoutId === log.workoutId));
        state.logs.push(log);
        state.draft = null;
        toast('התוצאה נשמרה');
        render();
      });
    });
    $$('[data-edit]').forEach(b => b.onclick = () => { state.draft = b.dataset.edit; render(); });
    $$('[data-cancel]').forEach(b => b.onclick = () => { state.draft = null; render(); });

    $$('[data-del]').forEach(b => b.onclick = () => {
      if (!armed(b, 'לאשר מחיקה?')) return;
      busy(b, async () => {
        await api.post({ action: 'deleteLog', id: b.dataset.del, traineeId: me().id });
        state.logs = state.logs.filter(l => l.id !== b.dataset.del);
        render();
      });
    });

    // התקדמות
    if ($('#exSel')) $('#exSel').onchange = () => { state.exercise = $('#exSel').value; render(); };
    $$('[data-ex]').forEach(r => r.onclick = () => { state.exercise = r.dataset.ex; render(); });
    if ($('#setLevel')) $('#setLevel').onchange = e => busy(e.target, async () => {
      await api.post({ action: 'setLevel', code: state.auth.code, traineeId: state.viewTrainee.id, level: e.target.value });
      state.viewTrainee.level = e.target.value;
      toast('הרמה עודכנה');
      render();
    });
    if ($('#backSquad')) $('#backSquad').onclick = () => { state.view = 'squad'; state.viewTrainee = null; render(); };

    // כניסה עם קוד
    if ($('#codeForm')) $('#codeForm').onsubmit = e => {
      e.preventDefault();
      busy(e.target.querySelector('button'), async () => {
        await login($('#codeInput').value.trim());
        if (state.view === 'staff' && !isStaff()) { state.view = 'squad'; }
        render();
      });
    };

    // לוח קבוצה
    if ($('#sLevel')) {
      const upd = () => {
        state.squadFilter = isStaff()
          ? { year: $('#sYear').value, squad: Number($('#sSquad').value), level: $('#sLevel').value }
          : { ...state.squadFilter, level: $('#sLevel').value };
        render();
      };
      if ($('#sYear')) {
        $('#sYear').onchange = () => { $('#sSquad').innerHTML = squadOptions($('#sYear').value, 1); upd(); };
        $('#sSquad').onchange = upd;
      }
      $('#sLevel').onchange = upd;
    }
    $$('[data-tr]').forEach(r => r.onclick = () => {
      state.viewTrainee = state.trainees.find(t => t.id === r.dataset.tr);
      state.view = 'progress';
      render();
    });
    $$('[data-squad]').forEach(r => r.onclick = () => {
      const [year, q] = r.dataset.squad.split('|');
      state.squadFilter = { year, squad: Number(q), level: '' };
      state.view = 'squad';
      render();
    });

    // צוות
    $$('[data-stab]').forEach(b => b.onclick = () => { state.staffTab = b.dataset.stab; render(); });
    if ($('#wForm')) {
      const f = state.form;
      const sync = () => {
        f.date = $('#wDate').value; f.title = $('#wTitle').value; f.year = $('#wYear').value; f.level = $('#wLevel').value; f.notes = $('#wNotes').value;
        $$('[data-exf]').forEach(el => { f.exercises[el.dataset.i][el.dataset.exf] = el.value; });
      };
      $('#wForm').oninput = sync;
      $('#wForm').onchange = sync;
      $('#exAdd').onclick = () => { sync(); f.exercises.push({ name: '', unit: 'reps', target: '' }); render(); $(`#exN${f.exercises.length - 1}`)?.focus(); };
      $$('[data-exdel]').forEach(b => b.onclick = () => { sync(); f.exercises.splice(Number(b.dataset.exdel), 1); render(); });
      $('#wClear').onclick = () => { state.form = blankWorkout(); render(); };
      $('#wForm').onsubmit = e => {
        e.preventDefault();
        sync();
        busy(e.target.querySelector('[type=submit]'), async () => {
          const exercises = f.exercises.map(x => ({ ...x, name: x.name.trim(), target: x.target.trim() })).filter(x => x.name);
          if (!f.title.trim()) throw new Error('נא לתת שם לאימון');
          if (!exercises.length) throw new Error('נא להוסיף לפחות תרגיל אחד');
          const { workout } = await api.post({ action: 'addWorkout', code: state.auth.code, workout: { ...f, title: f.title.trim(), exercises } });
          state.workouts.push(workout);
          state.form = { ...blankWorkout(), date: f.date };
          toast(`האימון פורסם ל${audience(workout)}`);
          render();
        });
      };
    }
    $$('[data-dup]').forEach(b => b.onclick = () => {
      const w = state.workouts.find(x => x.id === b.dataset.dup);
      state.form = { date: today(), title: w.title, year: w.year, level: w.level, notes: w.notes || '', exercises: w.exercises.map(x => ({ ...x })) };
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      toast('האימון הועתק לטופס. בחרו תאריך ופרסמו');
    });
    $$('[data-wdel]').forEach(b => b.onclick = () => {
      if (!armed(b, 'למחוק?')) return;
      busy(b, async () => {
        await api.post({ action: 'deleteWorkout', code: state.auth.code, id: b.dataset.wdel });
        state.workouts = state.workouts.filter(w => w.id !== b.dataset.wdel);
        render();
      });
    });
    if ($('#resetCodes')) $('#resetCodes').onclick = e => {
      if (!armed(e.target, 'בטוח? הקודים הישנים יפסיקו לעבוד')) return;
      busy(e.target, async () => {
        const { codes } = await api.post({ action: 'genCodes', code: state.auth.code, reset: true });
        state.codes = codes;
        toast('נוצרו קודים חדשים');
        render();
      });
    };

    if (state.view === 'progress') { const t = state.viewTrainee || me(); if (t) drawExerciseChart(t); }
    if (state.view === 'staff' && state.staffTab === 'overview') drawSquadChart();
  }

  $$('#tabs button').forEach(b => b.onclick = () => {
    state.view = b.dataset.view;
    if (state.view === 'progress') state.viewTrainee = null;
    render();
  });

  // ---------- טעינה ----------
  (async () => {
    $('#demoBanner').hidden = !DEMO;
    if (window.Chart) {
      Chart.defaults.font.family = 'Heebo, sans-serif';
      Chart.defaults.color = token('--muted');
      Chart.defaults.borderColor = token('--line');
    }
    try {
      const data = await api.get({ action: 'public' });
      state.trainees = data.trainees.map(t => ({ ...t, squad: Number(t.squad) }));
      state.workouts = data.workouts.map(w => ({ ...w, date: String(w.date).slice(0, 10) }));
      if (me()) mergeLogs((await api.get({ action: 'myLogs', traineeId: me().id })).logs);
      const code = load(sessionStorage, CODE_KEY);
      if (code) await login(code, true).catch(() => store(sessionStorage, CODE_KEY, null));
      render();
    } catch (err) {
      $('#main').innerHTML = `<div class="card empty">לא הצלחנו לטעון את הנתונים: ${esc(err.message)}<br>בדקו את API_URL בקובץ config.js</div>`;
    }
  })();
})();

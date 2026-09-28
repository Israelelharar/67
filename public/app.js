(() => {
  const SQUADS = { 'א': 12, 'ב': 2 };
  const LEVELS = { 'א': 'טובים', 'ב': 'בינוניים', 'ג': 'מתקשים' };
  const STATUSES = ['פעיל', 'פצוע', 'פטור', 'עזב'];
  const COUNTED = new Set(['פעיל', 'פצוע']); // סטטוסים שנכללים בממוצעי הקבוצה
  const CODE_KEY = 'mds.code';
  const UNITS = {
    reps: { label: 'חזרות', short: 'חזרות' },
    time: { label: 'זמן ריצה/מקטע (פחות = טוב)', short: '', lowerBetter: true, clock: true },
    hold: { label: 'זמן החזקה (יותר = טוב)', short: '', clock: true },
    kg: { label: 'ק"ג', short: 'ק"ג' },
    meters: { label: 'מטרים', short: 'מ\'' }
  };

  const state = {
    code: null, auth: null,
    me: null, workouts: [], logs: [], // חניך
    squads: [], sel: null,             // אחראי / צוות
    view: null, viewTrainee: null, exercise: null, draft: null, form: null
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
  const weekStart = iso => addDays(iso, -new Date(iso + 'T12:00:00').getDay());
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
  const squadLabel = s => `שנה ${s.year} · קבוצה ${s.squad}`;
  const lvlBadge = lvl => `<span class="lvl lvl-${esc(lvl)}" title="${esc(LEVELS[lvl] || '')}">${esc(lvl)}</span>`;
  const statusChip = st => (st && st !== 'פעיל' ? `<span class="chip st-${esc(st)}">${esc(st)}</span>` : '');
  const weekDots = (done, total) => total
    ? `<span class="week-dots" title="${done} מתוך ${total}">${Array.from({ length: total }, (_, i) => `<i class="${i < done ? 'on' : ''}"></i>`).join('')}</span>`
    : '<span class="muted">—</span>';

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (el.hidden = true), 3000);
  }
  const store = (key, val) => { try { val == null ? localStorage.removeItem(key) : localStorage.setItem(key, val); } catch {} };
  const load = key => { try { return localStorage.getItem(key); } catch { return null; } };

  const role = () => state.auth?.role;
  const isStaff = () => role() === 'staff';
  const cur = () => state.squads.find(s => s.year === state.sel?.year && s.squad === state.sel?.squad) || { trainees: [], workouts: [], logs: [] };

  // ---------- שרת ----------
  async function api(action, body = {}, code = state.code) {
    const res = await fetch('/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-code': code || '' },
      body: JSON.stringify({ action, ...body })
    });
    let data;
    try { data = await res.json(); } catch { throw new Error('אין חיבור לשרת'); }
    if (!data.ok) {
      const err = new Error(data.error || 'שגיאה');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function login(code) {
    const data = await api('login', {}, code);
    state.code = code;
    state.auth = data.auth;
    store(CODE_KEY, code);
    if (data.auth.role === 'trainee') {
      state.me = data.me;
      state.workouts = data.workouts;
      state.logs = data.logs;
      state.view ||= 'log';
    } else {
      state.squads = data.squads;
      if (!state.sel) state.sel = isStaff() ? { year: 'א', squad: 1 } : { year: data.auth.year, squad: data.auth.squad };
      state.view ||= isStaff() ? 'overview' : 'board';
      if (state.viewTrainee) state.viewTrainee = cur().trainees.find(t => t.id === state.viewTrainee.id) || null;
    }
  }
  const refresh = () => login(state.code);

  function logout() {
    store(CODE_KEY, null);
    Object.assign(state, { code: null, auth: null, me: null, workouts: [], logs: [], squads: [], sel: null, view: null, viewTrainee: null, form: null, draft: null });
    render();
  }

  // ---------- חישובים ----------
  const forTrainee = (w, t) => !w.level || w.level === t.level;
  const logsOf = (doc, id) => doc.logs.filter(l => l.traineeId === id).sort((a, b) => a.date.localeCompare(b.date));

  function summary(t, doc) {
    const joined = String(t.createdAt || '').slice(0, 10) || '2000-01-01';
    const L = logsOf(doc, t.id);
    const doneIds = new Set(L.map(l => l.workoutId));
    const all = doc.workouts.filter(w => forTrainee(w, t));
    const due = all.filter(w => w.date <= today() && w.date >= weekStart(joined));
    const wk = weekStart(today());
    const weekAll = all.filter(w => weekStart(w.date) === wk);
    const doneDue = due.filter(w => doneIds.has(w.id)).length;
    return {
      total: L.length,
      weekDone: weekAll.filter(w => doneIds.has(w.id)).length,
      weekTotal: weekAll.length,
      due: due.length, doneDue,
      rate: due.length ? doneDue / due.length : null,
      missed: due.filter(w => !doneIds.has(w.id) && w.date >= addDays(today(), -7)).length,
      lastDate: L.length ? L[L.length - 1].date : null
    };
  }

  function exerciseSeries(t, doc) {
    const byName = new Map();
    const wById = new Map(doc.workouts.map(w => [w.id, w]));
    logsOf(doc, t.id).forEach(l => {
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
      return {
        ...s,
        best: lower ? Math.min(...vals) : Math.max(...vals),
        last: vals[vals.length - 1],
        change: vals.length >= 2 ? (lower ? vals[0] - vals[vals.length - 1] : vals[vals.length - 1] - vals[0]) : null
      };
    });
  }

  const changeHtml = s => {
    if (s.change == null) return '<span class="muted">—</span>';
    const v = isClock(s.unit) ? fmtTime(Math.abs(s.change)) : Math.abs(s.change);
    return s.change > 0 ? `<span class="up">▲ ${v}</span>` : s.change < 0 ? `<span class="down">▼ ${v}</span>` : '<span class="muted">ללא שינוי</span>';
  };

  // ---------- רינדור ----------
  function tabsFor() {
    if (role() === 'trainee') return { log: 'המד"ס שלי', progress: 'התקדמות' };
    const t = { board: 'הקבוצה', trainees: 'חניכים', workouts: 'אימונים' };
    return isStaff() ? { overview: 'סקירה', ...t } : t;
  }

  function render() {
    while (charts.length) charts.pop().destroy();
    const main = $('#main');
    if (!state.auth) {
      $('#tabs').hidden = true;
      $('#me').innerHTML = '';
      main.innerHTML = loginView();
      return bind();
    }

    const tabs = tabsFor();
    $('#tabs').hidden = false;
    $('#tabs').innerHTML = Object.entries(tabs).map(([k, v]) => `<button data-view="${k}" class="${state.view === k || (state.view === 'progress' && k === 'board' && state.viewTrainee) ? 'active' : ''}">${v}</button>`).join('');
    const who = role() === 'trainee'
      ? `<strong>${esc(state.me.name)}</strong> <span class="muted">${esc(squadLabel(state.auth))}</span>`
      : `<span class="role-chip">${isStaff() ? 'צוות' : `אחראי ${esc(squadLabel(state.auth))}`}</span>`;
    $('#me').innerHTML = `<div>${who}</div><button class="btn link" id="logout">יציאה</button>`;

    const squadPicker = isStaff() && state.view !== 'overview' && state.view !== 'progress'
      ? `<div class="squad-picker"><select id="selYear" aria-label="שנה">${yearOptions(state.sel.year)}</select><select id="selSquad" aria-label="קבוצה">${squadOptions(state.sel.year, state.sel.squad)}</select></div>`
      : '';

    const views = {
      log: () => traineeLogView(),
      progress: () => progressView(state.viewTrainee || state.me, role() === 'trainee' ? state : cur()),
      board: boardView, trainees: traineesView, workouts: workoutsView, overview: overviewView
    };
    main.innerHTML = squadPicker + (views[state.view] || views[Object.keys(tabs)[0]])();
    bind();
  }

  const yearOptions = (sel, allLabel) => `${allLabel ? `<option value="">${allLabel}</option>` : ''}<option value="א" ${sel === 'א' ? 'selected' : ''}>שנה א</option><option value="ב" ${sel === 'ב' ? 'selected' : ''}>שנה ב</option>`;
  const squadOptions = (year, selected) => Array.from({ length: SQUADS[year] || 0 }, (_, i) => `<option value="${i + 1}" ${Number(selected) === i + 1 ? 'selected' : ''}>קבוצה ${i + 1}</option>`).join('');
  const levelOptions = (sel, allLabel) => `${allLabel ? `<option value="" ${!sel ? 'selected' : ''}>${allLabel}</option>` : ''}${Object.entries(LEVELS).map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${k} · ${v}</option>`).join('')}`;
  const statusOptions = sel => STATUSES.map(s => `<option ${sel === s ? 'selected' : ''}>${s}</option>`).join('');

  function loginView() {
    return `
      <section class="card gate">
        <h2>כניסה</h2>
        <p class="muted">הזינו את הקוד שקיבלתם מאחראי הקבוצה. אחראים וצוות נכנסים עם הקוד שלהם.</p>
        <form id="codeForm" class="code-row">
          <input id="codeInput" inputmode="numeric" autocomplete="one-time-code" placeholder="קוד" aria-label="קוד" autofocus>
          <button class="btn" type="submit">כניסה</button>
        </form>
      </section>`;
  }

  // ----- חניך -----
  function traineeLogView() {
    const m = state.me;
    const s = summary(m, state);
    const logByW = new Map(state.logs.map(l => [l.workoutId, l]));
    const wk = weekStart(today());
    const list = state.workouts
      .filter(w => (w.date >= wk && w.date <= addDays(wk, 6)) || (w.date >= addDays(wk, -7) && w.date < wk && !logByW.has(w.id)))
      .sort((a, b) => a.date.localeCompare(b.date));
    return `
      <div class="stats">
        <div class="stat"><div class="v">${s.weekDone}/${s.weekTotal || '—'}</div><div class="l">מד"ס השבוע ${weekDots(s.weekDone, s.weekTotal)}</div></div>
        <div class="stat"><div class="v">${pct(s.rate)}</div><div class="l">אחוז השלמה</div></div>
        <div class="stat"><div class="v">${s.total}</div><div class="l">אימונים שתועדו</div></div>
      </div>
      ${list.length ? list.map(w => workoutCard(w, logByW.get(w.id))).join('') : '<section class="card empty">אחראי הקבוצה עוד לא הגדיר מד"ס לשבוע הזה.</section>'}`;
  }

  function workoutCard(w, log) {
    const future = w.date > today();
    const kind = log ? 'done' : future ? 'future' : w.date === today() ? 'today' : 'open';
    const chip = { done: '<span class="chip ok">תועד ✓</span>', future: '<span class="chip">בקרוב</span>', today: '<span class="chip now">היום</span>', open: '<span class="chip warn">חסר תיעוד</span>' }[kind];
    const editing = state.draft === w.id;
    let body;
    if (log && !editing) {
      body = `<ul class="results">${w.exercises.map((x, i) => `<li><span>${esc(x.name)}</span><b>${fmtVal(num(log.results?.[i]), x.unit)}</b></li>`).join('')}</ul>
        ${log.notes ? `<p class="muted">${esc(log.notes)}</p>` : ''}
        <div class="actions"><button class="btn ghost" data-edit="${esc(w.id)}">עדכון תוצאה</button></div>`;
    } else if (future) {
      body = `<ul class="results">${w.exercises.map(x => `<li><span>${esc(x.name)}</span><span class="muted">${esc(x.target)}</span></li>`).join('')}</ul>`;
    } else {
      body = `<form class="result-form" data-wid="${esc(w.id)}">
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
    }
    return `
      <section class="card workout ${kind}">
        <div class="w-head">
          <div><div class="w-date">יום ${dayName(w.date)} · ${fmtDate(w.date)}</div><h2>${esc(w.title)}</h2></div>
          ${chip}
        </div>
        ${w.notes ? `<p class="w-notes">${esc(w.notes)}</p>` : ''}
        ${body}
      </section>`;
  }

  function progressView(t, doc) {
    if (!t) return '<section class="card empty">החניך לא נמצא.</section>';
    const s = summary(t, doc);
    const series = exerciseSeries(t, doc);
    if (!series.find(x => x.name === state.exercise)) state.exercise = series[0]?.name || null;
    const isMe = role() === 'trainee';
    const wById = new Map(doc.workouts.map(w => [w.id, w]));
    const L = logsOf(doc, t.id).reverse();
    return `
      ${!isMe ? '<div class="actions top"><button class="btn ghost" id="backBoard">→ חזרה לקבוצה</button></div>' : ''}
      <section class="card">
        <h2>${esc(t.name)} ${lvlBadge(t.level)} ${statusChip(t.status)}</h2>
        <div class="muted">${esc(squadLabel(isMe ? state.auth : state.sel))} · רמה ${esc(t.level)} (${esc(LEVELS[t.level] || '')})</div>
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

  // ----- אחראי קבוצה -----
  function boardView() {
    const doc = cur();
    const list = doc.trainees
      .map(t => ({ t, s: summary(t, doc) }))
      .sort((x, y) => (COUNTED.has(y.t.status) - COUNTED.has(x.t.status)) || x.t.level.localeCompare(y.t.level) || x.t.name.localeCompare(y.t.name, 'he'));
    const counted = list.filter(x => COUNTED.has(x.t.status));
    const behind = counted.filter(x => x.s.missed > 0).length;
    const avgRate = avg(counted.filter(x => x.s.rate != null).map(x => x.s.rate));
    return `
      <div class="stats">
        <div class="stat"><div class="v">${counted.length}</div><div class="l">חניכים פעילים</div></div>
        <div class="stat"><div class="v">${pct(avgRate)}</div><div class="l">השלמה ממוצעת</div></div>
        <div class="stat"><div class="v warn-text">${behind}</div><div class="l">חסר להם תיעוד מהשבוע האחרון</div></div>
      </div>
      <section class="card">
        <h2>${esc(squadLabel(state.sel))}</h2>
        ${list.length ? `<div class="table-wrap"><table>
          <thead><tr><th>שם</th><th>רמה</th><th>השבוע</th><th>אחוז השלמה</th><th>חסרים (7 ימים)</th><th>תיעוד אחרון</th></tr></thead>
          <tbody>${list.map(({ t, s }) => `<tr class="clickable ${COUNTED.has(t.status) ? '' : 'dim'}" data-tr="${esc(t.id)}">
            <td><strong>${esc(t.name)}</strong> ${statusChip(t.status)}</td><td>${lvlBadge(t.level)}</td>
            <td>${weekDots(s.weekDone, s.weekTotal)}</td><td>${pct(s.rate)}</td>
            <td>${s.missed ? `<span class="chip warn">${s.missed}</span>` : '<span class="muted">0</span>'}</td>
            <td>${s.lastDate ? fmtDate(s.lastDate) : '—'}</td>
          </tr>`).join('')}</tbody></table></div>
          <p class="muted small">לחיצה על חניך פותחת את ההתקדמות שלו.</p>`
        : '<div class="empty">אין עדיין חניכים. מוסיפים אותם בלשונית "חניכים".</div>'}
      </section>`;
  }

  function traineesView() {
    const doc = cur();
    const list = [...doc.trainees].sort((a, b) => a.name.localeCompare(b.name, 'he'));
    return `
      <section class="card">
        <h2>הוספת חניכים</h2>
        <p class="muted">שם בכל שורה. כל חניך מקבל קוד אישי שאיתו הוא נכנס ורואה רק את הנתונים שלו.</p>
        <form id="addForm">
          <label>שמות<textarea id="addNames" rows="5" placeholder="ישראל ישראלי&#10;נועה כהן"></textarea></label>
          <div class="grid">
            <label>רמה<select id="addLevel">${levelOptions('ב')}</select></label>
            <label>סטטוס<select id="addStatus">${statusOptions('פעיל')}</select></label>
          </div>
          <div class="actions"><button class="btn" type="submit">הוספה</button></div>
        </form>
      </section>
      <section class="card">
        <div class="w-head"><h2>חניכי ${esc(squadLabel(state.sel))} (${list.length})</h2>${list.length ? '<button class="btn ghost" id="copyCodes">העתקת רשימת קודים</button>' : ''}</div>
        ${list.length ? `<div class="table-wrap"><table class="edit-table">
          <thead><tr><th>שם</th><th>רמה</th><th>סטטוס</th><th>קוד כניסה</th><th></th></tr></thead>
          <tbody>${list.map(t => `<tr>
            <td><input class="name-in" id="nm_${esc(t.id)}" data-tid="${esc(t.id)}" value="${esc(t.name)}" aria-label="שם"></td>
            <td><select id="lv_${esc(t.id)}" data-tid="${esc(t.id)}" data-field="level" aria-label="רמה">${levelOptions(t.level)}</select></td>
            <td><select id="st_${esc(t.id)}" data-tid="${esc(t.id)}" data-field="status" aria-label="סטטוס">${statusOptions(t.status)}</select></td>
            <td class="code">${esc(t.code)}</td>
            <td class="row-actions"><button class="btn ghost" data-recode="${esc(t.id)}">קוד חדש</button><button class="btn danger" data-tdel="${esc(t.id)}">מחיקה</button></td>
          </tr>`).join('')}</tbody></table></div>
          <p class="muted small">שינוי שם, רמה או סטטוס נשמר מיד. "קוד חדש" מבטל את הקוד הקודם.</p>`
        : '<div class="empty">אין עדיין חניכים בקבוצה.</div>'}
      </section>`;
  }

  const blankWorkout = () => ({ date: today(), title: '', level: '', notes: '', target: 'squad', exercises: [{ name: '', unit: 'reps', target: '' }] });

  function workoutsView() {
    const doc = cur();
    const w = state.form ||= blankWorkout();
    const shown = [...doc.workouts].sort((a, b) => b.date.localeCompare(a.date)).filter(x => x.date >= addDays(today(), -28));
    const counted = doc.trainees.filter(t => COUNTED.has(t.status));
    return `
      <section class="card">
        <h2>מד"ס חדש</h2>
        <form id="wForm">
          <div class="grid">
            <label>תאריך<input type="date" id="wDate" value="${esc(w.date)}" required></label>
            <label>שם האימון<input id="wTitle" value="${esc(w.title)}" placeholder='מד"ס פלג גוף עליון'></label>
            <label>לאיזו רמה<select id="wLevel">${levelOptions(w.level, 'כל הרמות')}</select></label>
            ${isStaff() ? `<label>לאילו קבוצות<select id="wTarget">
              <option value="squad" ${w.target === 'squad' ? 'selected' : ''}>רק ${esc(squadLabel(state.sel))}</option>
              <option value="א" ${w.target === 'א' ? 'selected' : ''}>כל קבוצות שנה א</option>
              <option value="ב" ${w.target === 'ב' ? 'selected' : ''}>כל קבוצות שנה ב</option>
              <option value="all" ${w.target === 'all' ? 'selected' : ''}>כל הקבוצות</option></select></label>` : ''}
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
        <h2>אימונים של ${esc(squadLabel(state.sel))}</h2>
        ${shown.length ? `<div class="table-wrap"><table>
          <thead><tr><th>תאריך</th><th>אימון</th><th>רמה</th><th>תרגילים</th><th>תיעדו</th><th></th></tr></thead>
          <tbody>${shown.map(x => {
            const target = counted.filter(t => forTrainee(x, t));
            const done = new Set(doc.logs.filter(l => l.workoutId === x.id).map(l => l.traineeId)).size;
            return `<tr><td>${dayName(x.date)} ${fmtDate(x.date)}</td><td><strong>${esc(x.title)}</strong></td><td>${x.level ? lvlBadge(x.level) : '<span class="muted">כולם</span>'}</td>
              <td class="wrap">${x.exercises.map(e => esc(e.name)).join(', ')}</td>
              <td>${x.date > today() ? '<span class="muted">—</span>' : `${done}/${target.length}`}</td>
              <td class="row-actions"><button class="btn ghost" data-dup="${esc(x.id)}">שכפול</button><button class="btn danger" data-wdel="${esc(x.id)}">מחיקה</button></td></tr>`;
          }).join('')}</tbody></table></div>` : '<div class="empty">עוד לא הוגדרו אימונים לקבוצה.</div>'}
      </section>`;
  }

  // ----- צוות -----
  function overviewView() {
    const rows = state.squads.map(doc => {
      const ss = doc.trainees.filter(t => COUNTED.has(t.status)).map(t => summary(t, doc));
      return { ...doc, count: ss.length, rate: avg(ss.filter(s => s.rate != null).map(s => s.rate)), behind: ss.filter(s => s.missed).length, workouts: doc.workouts.length };
    });
    const levelRows = [];
    for (const year of ['א', 'ב']) for (const lvl of Object.keys(LEVELS)) {
      const ss = state.squads.filter(d => d.year === year).flatMap(d => d.trainees.filter(t => t.level === lvl && COUNTED.has(t.status)).map(t => summary(t, d)));
      levelRows.push({ year, lvl, count: ss.length, rate: avg(ss.filter(s => s.rate != null).map(s => s.rate)), behind: ss.filter(s => s.missed).length });
    }
    const total = rows.reduce((a, r) => a + r.count, 0);
    const wk = weekStart(today());
    const weekLogs = state.squads.reduce((a, d) => a + d.logs.filter(l => weekStart(l.date) === wk).length, 0);
    return `
      <div class="stats">
        <div class="stat"><div class="v">${total}</div><div class="l">חניכים פעילים</div></div>
        <div class="stat"><div class="v">${weekLogs}</div><div class="l">תיעודים השבוע</div></div>
        <div class="stat"><div class="v">${pct(avg(rows.filter(r => r.rate != null).map(r => r.rate)))}</div><div class="l">השלמה ממוצעת</div></div>
      </div>
      <section class="card"><h2>השלמת מד"ס לפי קבוצה</h2><div class="chart-box"><canvas id="chSquads"></canvas></div>
        <div class="table-wrap"><table>
        <thead><tr><th>קבוצה</th><th>חניכים</th><th>אימונים שהוגדרו</th><th>אחוז השלמה</th><th>חסר להם תיעוד</th></tr></thead>
        <tbody>${rows.map(r => `<tr class="clickable" data-squad="${r.year}|${r.squad}"><td>${esc(squadLabel(r))}</td><td>${r.count}</td><td>${r.workouts}</td><td>${pct(r.rate)}</td><td>${r.behind}</td></tr>`).join('')}</tbody>
      </table></div></section>
      <section class="card"><h2>לפי שנה ורמה</h2><div class="table-wrap"><table>
        <thead><tr><th>שנה</th><th>רמה</th><th>חניכים</th><th>אחוז השלמה</th><th>חסר להם תיעוד</th></tr></thead>
        <tbody>${levelRows.map(r => `<tr><td>שנה ${r.year}</td><td>${lvlBadge(r.lvl)} ${esc(LEVELS[r.lvl])}</td><td>${r.count}</td><td>${pct(r.rate)}</td><td>${r.behind}</td></tr>`).join('')}</tbody>
      </table></div></section>`;
  }

  // ---------- גרפים ----------
  const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function drawExerciseChart(t, doc) {
    if (!window.Chart || !$('#chEx')) return;
    const s = exerciseSeries(t, doc).find(x => x.name === state.exercise);
    if (!s) return;
    const clock = isClock(s.unit), lower = !!UNITS[s.unit].lowerBetter;
    const color = token('--brand');
    charts.push(new Chart($('#chEx'), {
      type: 'line',
      data: { labels: s.points.map(p => fmtDate(p.date)), datasets: [{ label: s.name, data: s.points.map(p => p.v), borderColor: color, backgroundColor: color, tension: .25, pointRadius: 3 }] },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmtVal(c.parsed.y, s.unit) } } },
        // כשפחות זה טוב (זמן ריצה) הציר הפוך, כדי ששיפור תמיד יעלה למעלה
        scales: { y: { reverse: lower, beginAtZero: !lower, ticks: { callback: v => (clock ? fmtTime(v) : v) } } }
      }
    }));
  }

  function drawSquadChart() {
    if (!window.Chart || !$('#chSquads')) return;
    const labels = [], data = [];
    state.squads.forEach(doc => {
      const ss = doc.trainees.filter(t => COUNTED.has(t.status)).map(t => summary(t, doc)).filter(s => s.rate != null);
      labels.push(`${doc.year}${doc.squad}`);
      data.push(ss.length ? Math.round(avg(ss.map(s => s.rate)) * 100) : 0);
    });
    charts.push(new Chart($('#chSquads'), {
      type: 'bar',
      data: { labels, datasets: [{ label: 'אחוז השלמה', data, backgroundColor: token('--brand'), borderRadius: 4 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.parsed.y}%` } } }, scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } } } }
    }));
  }

  // ---------- אירועים ----------
  async function busy(btn, fn) {
    if (btn) btn.disabled = true;
    try { await fn(); } catch (err) {
      toast(err.message);
      if (err.status === 401 && state.auth) logout();
    } finally { if (btn) btn.disabled = false; }
  }

  // כפתור שדורש לחיצה שנייה לאישור
  function armed(btn, label) {
    if (btn.dataset.armed) return true;
    btn.dataset.armed = '1';
    btn.textContent = label;
    return false;
  }

  const scope = () => ({ year: state.sel.year, squad: state.sel.squad });

  function bind() {
    $$('#tabs button').forEach(b => b.onclick = () => { state.view = b.dataset.view; state.viewTrainee = null; render(); });
    if ($('#logout')) $('#logout').onclick = logout;

    if ($('#codeForm')) $('#codeForm').onsubmit = e => {
      e.preventDefault();
      busy(e.target.querySelector('button'), async () => { await login($('#codeInput').value.trim()); render(); });
    };

    if ($('#selYear')) {
      $('#selYear').onchange = () => { state.sel = { year: $('#selYear').value, squad: 1 }; render(); };
      $('#selSquad').onchange = () => { state.sel = { year: state.sel.year, squad: Number($('#selSquad').value) }; render(); };
    }

    // חניך: הזנת תוצאה
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
        const { log } = await api('saveLog', { workoutId: w.id, results, notes: form.elements.notes.value.trim() });
        state.logs = state.logs.filter(l => l.workoutId !== log.workoutId).concat(log);
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
        await api('deleteLog', { id: b.dataset.del });
        state.logs = state.logs.filter(l => l.id !== b.dataset.del);
        render();
      });
    });

    // התקדמות
    if ($('#exSel')) $('#exSel').onchange = () => { state.exercise = $('#exSel').value; render(); };
    $$('[data-ex]').forEach(r => r.onclick = () => { state.exercise = r.dataset.ex; render(); });
    if ($('#backBoard')) $('#backBoard').onclick = () => { state.view = 'board'; state.viewTrainee = null; render(); };

    // לוח קבוצה וסקירה
    $$('[data-tr]').forEach(r => r.onclick = () => {
      state.viewTrainee = cur().trainees.find(t => t.id === r.dataset.tr);
      state.view = 'progress';
      render();
    });
    $$('[data-squad]').forEach(r => r.onclick = () => {
      const [year, q] = r.dataset.squad.split('|');
      state.sel = { year, squad: Number(q) };
      state.view = 'board';
      render();
    });

    // ניהול חניכים
    if ($('#addForm')) $('#addForm').onsubmit = e => {
      e.preventDefault();
      busy(e.target.querySelector('[type=submit]'), async () => {
        const names = $('#addNames').value.split('\n').map(s => s.trim()).filter(Boolean);
        if (!names.length) throw new Error('נא להזין לפחות שם אחד');
        const { added } = await api('addTrainees', { ...scope(), names, level: $('#addLevel').value, status: $('#addStatus').value });
        await refresh();
        toast(`נוספו ${added} חניכים`);
        render();
      });
    };
    $$('select[data-field]').forEach(sel => sel.onchange = () => busy(sel, async () => {
      await api('updateTrainee', { ...scope(), id: sel.dataset.tid, [sel.dataset.field]: sel.value });
      await refresh();
      toast('נשמר');
      render();
    }));
    $$('.name-in').forEach(inp => inp.onchange = () => busy(inp, async () => {
      await api('updateTrainee', { ...scope(), id: inp.dataset.tid, name: inp.value });
      await refresh();
      toast('השם עודכן');
      render();
    }));
    $$('[data-recode]').forEach(b => b.onclick = () => {
      if (!armed(b, 'להחליף קוד?')) return;
      busy(b, async () => { await api('resetTraineeCode', { ...scope(), id: b.dataset.recode }); await refresh(); toast('נוצר קוד חדש'); render(); });
    });
    $$('[data-tdel]').forEach(b => b.onclick = () => {
      if (!armed(b, 'למחוק עם כל הנתונים?')) return;
      busy(b, async () => { await api('deleteTrainee', { ...scope(), id: b.dataset.tdel }); await refresh(); toast('החניך נמחק'); render(); });
    });
    if ($('#copyCodes')) $('#copyCodes').onclick = async () => {
      const text = [...cur().trainees].sort((a, b) => a.name.localeCompare(b.name, 'he'))
        .map(t => `${t.name}: ${t.code}`).join('\n');
      try { await navigator.clipboard.writeText(`קודי כניסה למעקב המד"ס (${squadLabel(state.sel)})\n${location.origin}\n\n${text}`); toast('הרשימה הועתקה. אפשר להדביק בוואטסאפ'); }
      catch { toast('ההעתקה נכשלה. אפשר לסמן את הטבלה ולהעתיק ידנית'); }
    };

    // ניהול אימונים
    if ($('#wForm')) {
      const f = state.form;
      const sync = () => {
        f.date = $('#wDate').value; f.title = $('#wTitle').value; f.level = $('#wLevel').value; f.notes = $('#wNotes').value;
        if ($('#wTarget')) f.target = $('#wTarget').value;
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
          const { created } = await api('addWorkout', { ...scope(), target: f.target, workout: { date: f.date, title: f.title.trim(), level: f.level, notes: f.notes, exercises } });
          await refresh();
          state.form = { ...blankWorkout(), date: f.date, target: f.target };
          toast(created.length > 1 ? `האימון פורסם ל-${created.length} קבוצות` : 'האימון פורסם לחניכים');
          render();
        });
      };
    }
    $$('[data-dup]').forEach(b => b.onclick = () => {
      const w = cur().workouts.find(x => x.id === b.dataset.dup);
      state.form = { date: today(), title: w.title, level: w.level, notes: w.notes || '', target: 'squad', exercises: w.exercises.map(x => ({ ...x })) };
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      toast('האימון הועתק לטופס. בחרו תאריך ופרסמו');
    });
    $$('[data-wdel]').forEach(b => b.onclick = () => {
      if (!armed(b, 'למחוק כולל תוצאות?')) return;
      busy(b, async () => { await api('deleteWorkout', { ...scope(), id: b.dataset.wdel }); await refresh(); render(); });
    });

    if (state.view === 'progress') {
      const t = state.viewTrainee || state.me;
      if (t) drawExerciseChart(t, role() === 'trainee' ? state : cur());
    }
    if (state.view === 'overview') drawSquadChart();
  }

  // ---------- טעינה ----------
  (async () => {
    if (window.Chart) {
      Chart.defaults.font.family = 'Heebo, sans-serif';
      Chart.defaults.color = token('--muted');
      Chart.defaults.borderColor = token('--line');
    }
    const saved = load(CODE_KEY);
    if (saved) {
      try { await login(saved); } catch (err) { if (err.status === 401) store(CODE_KEY, null); else toast(err.message); }
    }
    render();
  })();
})();

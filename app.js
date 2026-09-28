(() => {
  const CFG = window.CONFIG;
  const DEMO = !CFG.API_URL;
  const ME_KEY = 'mds.me';
  const DEMO_KEY = 'mds.demo';

  const state = { trainees: [], logs: [], view: 'log', viewTrainee: null, squadFilter: null };
  const charts = [];

  // ---------- עזרים ----------
  const $ = sel => document.querySelector(sel);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
  const today = () => toISO(new Date());
  function toISO(d) {
    const z = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  }
  // שבוע ישראלי: ראשון עד שבת
  function weekStart(iso) {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() - d.getDay());
    return toISO(d);
  }
  const fmtTime = sec => {
    if (sec == null) return '—';
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };
  const parseTime = str => {
    const m = String(str).trim().match(/^(\d{1,3})(?::(\d{1,2}))?$/);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2] || 0);
  };
  const pace = l => (num(l.runDistanceKm) && num(l.runTimeSec) ? l.runTimeSec / l.runDistanceKm : null);
  const fmtDate = iso => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y.slice(2)}`; };
  const avg = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const squadName = t => `שנה ${t.year} · קבוצה ${t.squad}`;
  const lvlBadge = lvl => `<span class="lvl lvl-${esc(lvl)}" title="${esc(CFG.LEVELS[lvl] || '')}">${esc(lvl)}</span>`;
  const weekDots = n => `<span class="week-dots">${Array.from({ length: CFG.SESSIONS_PER_WEEK }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (el.hidden = true), 2600);
  }

  const getMe = () => { try { return JSON.parse(localStorage.getItem(ME_KEY)); } catch { return null; } };
  const setMe = id => { try { id ? localStorage.setItem(ME_KEY, JSON.stringify(id)) : localStorage.removeItem(ME_KEY); } catch {} };
  const me = () => state.trainees.find(t => t.id === getMe()) || null;
  const logsOf = id => state.logs.filter(l => l.traineeId === id).sort((a, b) => a.date.localeCompare(b.date));

  // ---------- שכבת נתונים ----------
  const api = {
    async load() {
      if (DEMO) return demoStore.load();
      const res = await fetch(`${CFG.API_URL}?action=all`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      return data;
    },
    async post(body) {
      if (DEMO) return demoStore.post(body);
      // text/plain כדי לא לגרום לבקשת preflight שגוגל לא תומך בה
      const res = await fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'שגיאה בשמירה');
      return data;
    }
  };

  const demoStore = {
    read() { try { return JSON.parse(localStorage.getItem(DEMO_KEY)); } catch { return null; } },
    write(d) { try { localStorage.setItem(DEMO_KEY, JSON.stringify(d)); } catch {} },
    load() {
      let d = this.read();
      if (!d) { d = seedDemo(); this.write(d); }
      return d;
    },
    post(body) {
      const d = this.load();
      const id = () => Math.random().toString(36).slice(2, 10);
      if (body.action === 'addTrainee') {
        const t = { ...body.trainee, id: id(), squad: Number(body.trainee.squad) };
        d.trainees.push(t); this.write(d);
        return { ok: true, trainee: t };
      }
      if (body.action === 'addLog') {
        const l = { ...body.log, id: id() };
        d.logs.push(l); this.write(d);
        return { ok: true, log: l };
      }
      if (body.action === 'deleteLog') {
        d.logs = d.logs.filter(l => l.id !== body.id); this.write(d);
        return { ok: true };
      }
    }
  };

  function seedDemo() {
    const first = ['נועם', 'יונתן', 'איתי', 'עומר', 'אורי', 'דניאל', 'יואב', 'אלון', 'רועי', 'עידו', 'תמר', 'נוגה', 'שירה', 'מאיה', 'הילה', 'ליה', 'אביגיל', 'רוני', 'גיא', 'אריאל'];
    const last = ['כהן', 'לוי', 'מזרחי', 'פרץ', 'ביטון', 'אברהם', 'פרידמן', 'שפירא', 'דהן', 'אזולאי', 'גבאי', 'חדד'];
    const trainees = [], logs = [];
    let n = 0;
    const rand = (a, b) => a + Math.random() * (b - a);
    const add = (year, squad) => {
      const level = ['א', 'ב', 'ג'][Math.floor(Math.random() * 3)];
      const t = { id: 'd' + (n++), name: `${first[n % first.length]} ${last[(n * 7) % last.length]}`, year, squad, level };
      trainees.push(t);
      const basePace = { 'א': 270, 'ב': 320, 'ג': 380 }[level] + rand(-20, 20);
      const basePush = { 'א': 45, 'ב': 32, 'ג': 18 }[level] + rand(-5, 5);
      const start = new Date(); start.setDate(start.getDate() - 7 * 9);
      for (let w = 0; w < 10; w++) {
        for (const dow of [0, 2, 4]) {
          if (Math.random() < 0.18) continue;
          const d = new Date(start); d.setDate(d.getDate() - d.getDay() + w * 7 + dow);
          if (d > new Date()) continue;
          const dist = [2, 3, 3, 4][Math.floor(Math.random() * 4)];
          const p = basePace * (1 - w * 0.008) + rand(-10, 10);
          logs.push({ id: 'l' + logs.length, traineeId: t.id, date: toISO(d), runDistanceKm: dist, runTimeSec: Math.round(p * dist), pushups: Math.round(basePush + w * 1.2 + rand(-3, 3)), situps: Math.round(basePush * 1.3 + w + rand(-3, 3)), pullups: Math.max(0, Math.round(basePush / 5 + w * 0.3 + rand(-2, 2))), notes: '' });
        }
      }
    };
    for (let s = 1; s <= 12; s++) for (let i = 0; i < 10; i++) add('א', s);
    for (let s = 1; s <= 2; s++) for (let i = 0; i < 15; i++) add('ב', s);
    return { trainees, logs };
  }

  // ---------- חישובי סיכום ----------
  function summary(t) {
    const L = logsOf(t.id);
    const thisWeek = weekStart(today());
    const weekCount = L.filter(l => weekStart(l.date) === thisWeek).length;
    const runs = L.filter(l => pace(l) != null);
    const paces = runs.map(pace);
    const lastPace = paces.length ? paces[paces.length - 1] : null;
    const bestPace = paces.length ? Math.min(...paces) : null;
    // מגמה: ממוצע 3 ריצות אחרונות מול 3 הראשונות
    let trend = null;
    if (paces.length >= 4) trend = avg(paces.slice(0, 3)) - avg(paces.slice(-3));
    const pushLast = [...L].reverse().find(l => num(l.pushups) != null);
    const pushBest = Math.max(0, ...L.map(l => num(l.pushups) || 0)) || null;
    // נוכחות ממוצעת לשבוע מאז הרשומה הראשונה
    let weeklyAvg = null;
    if (L.length) {
      const weeks = Math.max(1, Math.round((new Date(thisWeek) - new Date(weekStart(L[0].date))) / (7 * 864e5)) + 1);
      weeklyAvg = L.length / weeks;
    }
    return { total: L.length, weekCount, lastPace, bestPace, trend, pushLast: pushLast ? num(pushLast.pushups) : null, pushBest, weeklyAvg, lastDate: L.length ? L[L.length - 1].date : null };
  }

  const trendHtml = tr => tr == null ? '<span class="muted">—</span>' : tr > 3 ? `<span class="up">▲ ${fmtTime(tr)}</span>` : tr < -3 ? `<span class="down">▼ ${fmtTime(-tr)}</span>` : '<span class="muted">יציב</span>';

  // ---------- רינדור ----------
  function destroyCharts() { while (charts.length) charts.pop().destroy(); }

  function render() {
    destroyCharts();
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
    const m = me();
    $('#me').innerHTML = m ? `<div><strong>${esc(m.name)}</strong></div><div class="muted">${esc(squadName(m))}</div><button class="btn link" id="logout">החלפת חניך</button>` : '';
    if (m) $('#logout').onclick = () => { setMe(null); state.view = 'log'; render(); };

    const main = $('#main');
    if (state.view === 'log') main.innerHTML = m ? logView(m) : pickView();
    if (state.view === 'progress') {
      const t = state.viewTrainee || m;
      main.innerHTML = t ? progressView(t) : pickView();
    }
    if (state.view === 'squad') main.innerHTML = squadView();
    if (state.view === 'overview') main.innerHTML = overviewView();
    bind();
  }

  function squadOptions(year, selected) {
    return Array.from({ length: CFG.SQUADS[year] || 0 }, (_, i) => `<option value="${i + 1}" ${Number(selected) === i + 1 ? 'selected' : ''}>קבוצה ${i + 1}</option>`).join('');
  }

  function pickView() {
    return `
      <section class="card">
        <h2>מי את/ה?</h2>
        <p class="muted">בחרו את השם שלכם פעם אחת — הדפדפן יזכור אתכם.</p>
        <div class="grid">
          <label>שנה<select id="pYear"><option value="א">שנה א</option><option value="ב">שנה ב</option></select></label>
          <label>קבוצה<select id="pSquad">${squadOptions('א', 1)}</select></label>
          <label>שם<select id="pName"></select></label>
        </div>
        <div class="actions"><button class="btn" id="pGo">המשך</button></div>
      </section>
      <section class="card">
        <h2>לא ברשימה? הרשמה</h2>
        <div class="grid">
          <label>שם מלא<input id="rName" autocomplete="name"></label>
          <label>שנה<select id="rYear"><option value="א">שנה א</option><option value="ב">שנה ב</option></select></label>
          <label>קבוצה<select id="rSquad">${squadOptions('א', 1)}</select></label>
          <label>רמה<select id="rLevel">${Object.entries(CFG.LEVELS).map(([k, v]) => `<option value="${k}">${k} — ${v}</option>`).join('')}</select></label>
        </div>
        <div class="actions"><button class="btn" id="rGo">הרשמה</button></div>
      </section>`;
  }

  function logView(m) {
    const s = summary(m);
    const recent = logsOf(m.id).slice(-5).reverse();
    return `
      <div class="stats">
        <div class="stat"><div class="v">${s.weekCount}/${CFG.SESSIONS_PER_WEEK}</div><div class="l">אימונים השבוע ${weekDots(s.weekCount)}</div></div>
        <div class="stat"><div class="v">${fmtTime(s.bestPace)}</div><div class="l">קצב שיא לק"מ</div></div>
        <div class="stat"><div class="v">${s.pushBest ?? '—'}</div><div class="l">שיא שכיבות סמיכה</div></div>
      </div>
      <section class="card">
        <h2>תיעוד אימון חדש</h2>
        <div class="grid">
          <label>תאריך<input type="date" id="fDate" value="${today()}" max="${today()}"></label>
        </div>
        <h3>🏃 ריצה</h3>
        <div class="grid">
          <label>מרחק (ק"מ)<input type="number" id="fDist" step="0.1" min="0" inputmode="decimal" placeholder="3"></label>
          <label>זמן (דקות:שניות)<input id="fTime" placeholder="14:30" inputmode="numeric"></label>
        </div>
        <h3>💪 תרגילי כוח (מספר חזרות)</h3>
        <div class="grid">
          <label>שכיבות סמיכה<input type="number" id="fPush" min="0" inputmode="numeric"></label>
          <label>בטן<input type="number" id="fSit" min="0" inputmode="numeric"></label>
          <label>מתח<input type="number" id="fPull" min="0" inputmode="numeric"></label>
        </div>
        <h3>הערות</h3>
        <textarea id="fNotes" maxlength="500" placeholder="איך הרגשת? משהו מיוחד?"></textarea>
        <div class="actions"><button class="btn" id="fSave">שמירת אימון</button></div>
      </section>
      ${recent.length ? `<section class="card"><h2>אימונים אחרונים</h2>${logTable(recent, true)}</section>` : ''}`;
  }

  function logTable(list, canDelete) {
    return `<div class="table-wrap"><table>
      <thead><tr><th>תאריך</th><th>מרחק</th><th>זמן</th><th>קצב</th><th>שכ"ס</th><th>בטן</th><th>מתח</th><th>הערות</th>${canDelete ? '<th></th>' : ''}</tr></thead>
      <tbody>${list.map(l => `<tr>
        <td>${fmtDate(l.date)}</td>
        <td>${num(l.runDistanceKm) != null ? l.runDistanceKm + ' ק"מ' : '—'}</td>
        <td>${fmtTime(num(l.runTimeSec))}</td>
        <td>${fmtTime(pace(l))}</td>
        <td>${num(l.pushups) ?? '—'}</td><td>${num(l.situps) ?? '—'}</td><td>${num(l.pullups) ?? '—'}</td>
        <td class="muted">${esc(l.notes)}</td>
        ${canDelete ? `<td><button class="btn danger" data-del="${esc(l.id)}">מחיקה</button></td>` : ''}
      </tr>`).join('')}</tbody></table></div>`;
  }

  function progressView(t) {
    const s = summary(t);
    const L = logsOf(t.id);
    const isMe = me() && me().id === t.id;
    return `
      ${!isMe ? `<div class="actions" style="margin:0 0 12px"><button class="btn ghost" id="backSquad">→ חזרה לקבוצה</button></div>` : ''}
      <section class="card">
        <h2>${esc(t.name)} ${lvlBadge(t.level)}</h2>
        <div class="muted">${esc(squadName(t))} · רמה ${esc(t.level)} (${esc(CFG.LEVELS[t.level] || '')})</div>
      </section>
      <div class="stats">
        <div class="stat"><div class="v">${s.weekCount}/${CFG.SESSIONS_PER_WEEK}</div><div class="l">השבוע ${weekDots(s.weekCount)}</div></div>
        <div class="stat"><div class="v">${s.total}</div><div class="l">סה"כ אימונים</div></div>
        <div class="stat"><div class="v">${s.weeklyAvg != null ? s.weeklyAvg.toFixed(1) : '—'}</div><div class="l">ממוצע אימונים לשבוע</div></div>
        <div class="stat"><div class="v">${fmtTime(s.bestPace)}</div><div class="l">קצב שיא לק"מ</div></div>
        <div class="stat"><div class="v">${trendHtml(s.trend)}</div><div class="l">שיפור בקצב</div></div>
      </div>
      ${L.length ? `
        <section class="card"><h2>קצב ריצה (דקות לק"מ — למעלה = מהיר יותר)</h2><div class="chart-box"><canvas id="chPace"></canvas></div></section>
        <section class="card"><h2>תרגילי כוח</h2><div class="chart-box"><canvas id="chStr"></canvas></div></section>
        <section class="card"><h2>כל האימונים</h2>${logTable([...L].reverse(), isMe)}</section>`
      : '<div class="card empty">עוד אין אימונים מתועדים.</div>'}`;
  }

  function squadView() {
    const m = me();
    const f = state.squadFilter || { year: m ? m.year : 'א', squad: m ? Number(m.squad) : 1, level: '' };
    state.squadFilter = f;
    const list = state.trainees
      .filter(t => t.year === f.year && Number(t.squad) === Number(f.squad) && (!f.level || t.level === f.level))
      .map(t => ({ t, s: summary(t) }))
      .sort((a, b) => a.t.level.localeCompare(b.t.level) || a.t.name.localeCompare(b.t.name, 'he'));
    const done = list.filter(x => x.s.weekCount >= CFG.SESSIONS_PER_WEEK).length;
    const missing = list.filter(x => x.s.weekCount === 0).length;
    return `
      <section class="card">
        <h2>לוח אחראי קבוצה</h2>
        <div class="filters">
          <select id="sYear"><option value="א" ${f.year === 'א' ? 'selected' : ''}>שנה א</option><option value="ב" ${f.year === 'ב' ? 'selected' : ''}>שנה ב</option></select>
          <select id="sSquad">${squadOptions(f.year, f.squad)}</select>
          <select id="sLevel"><option value="">כל הרמות</option>${Object.entries(CFG.LEVELS).map(([k, v]) => `<option value="${k}" ${f.level === k ? 'selected' : ''}>${k} — ${v}</option>`).join('')}</select>
        </div>
        <div class="stats">
          <div class="stat"><div class="v">${list.length}</div><div class="l">חניכים</div></div>
          <div class="stat"><div class="v">${done}</div><div class="l">השלימו ${CFG.SESSIONS_PER_WEEK} אימונים השבוע</div></div>
          <div class="stat"><div class="v" style="color:var(--weak)">${missing}</div><div class="l">עוד לא התאמנו השבוע</div></div>
        </div>
        ${list.length ? `<div class="table-wrap"><table>
          <thead><tr><th>שם</th><th>רמה</th><th>השבוע</th><th>ממוצע/שבוע</th><th>קצב אחרון</th><th>קצב שיא</th><th>מגמה</th><th>שכ"ס אחרון</th><th>אימון אחרון</th></tr></thead>
          <tbody>${list.map(({ t, s }) => `<tr class="clickable" data-tr="${esc(t.id)}">
            <td><strong>${esc(t.name)}</strong></td><td>${lvlBadge(t.level)}</td>
            <td>${weekDots(s.weekCount)}</td>
            <td>${s.weeklyAvg != null ? s.weeklyAvg.toFixed(1) : '—'}</td>
            <td>${fmtTime(s.lastPace)}</td><td>${fmtTime(s.bestPace)}</td><td>${trendHtml(s.trend)}</td>
            <td>${s.pushLast ?? '—'}</td><td>${s.lastDate ? fmtDate(s.lastDate) : '—'}</td>
          </tr>`).join('')}</tbody></table></div>
          <p class="muted" style="font-size:13px">לחיצה על חניך פותחת את גרף ההתקדמות שלו.</p>`
        : '<div class="empty">אין חניכים בקבוצה הזאת.</div>'}
      </section>`;
  }

  function overviewView() {
    const thisWeek = weekStart(today());
    const rows = [];
    for (const year of ['א', 'ב']) {
      for (const lvl of Object.keys(CFG.LEVELS)) {
        const ts = state.trainees.filter(t => t.year === year && t.level === lvl);
        const ss = ts.map(summary);
        rows.push({ year, lvl, count: ts.length,
          week: avg(ss.map(s => s.weekCount)),
          weekly: avg(ss.filter(s => s.weeklyAvg != null).map(s => s.weeklyAvg)),
          pace: avg(ss.filter(s => s.lastPace != null).map(s => s.lastPace)),
          trend: avg(ss.filter(s => s.trend != null).map(s => s.trend)),
          push: avg(ss.filter(s => s.pushLast != null).map(s => s.pushLast)) });
      }
    }
    const squads = [];
    for (const year of ['א', 'ב']) for (let q = 1; q <= CFG.SQUADS[year]; q++) {
      const ts = state.trainees.filter(t => t.year === year && Number(t.squad) === q);
      const ss = ts.map(summary);
      squads.push({ year, q, count: ts.length, week: avg(ss.map(s => s.weekCount)), zero: ss.filter(s => s.weekCount === 0).length, pace: avg(ss.filter(s => s.lastPace != null).map(s => s.lastPace)) });
    }
    const totalWeek = state.logs.filter(l => weekStart(l.date) === thisWeek).length;
    return `
      <div class="stats">
        <div class="stat"><div class="v">${state.trainees.length}</div><div class="l">חניכים רשומים</div></div>
        <div class="stat"><div class="v">${totalWeek}</div><div class="l">אימונים תועדו השבוע</div></div>
        <div class="stat"><div class="v">${state.logs.length}</div><div class="l">סה"כ רשומות</div></div>
      </div>
      <section class="card"><h2>לפי שנה ורמה</h2><div class="table-wrap"><table>
        <thead><tr><th>שנה</th><th>רמה</th><th>חניכים</th><th>ממוצע השבוע</th><th>ממוצע/שבוע</th><th>קצב ממוצע</th><th>שיפור ממוצע</th><th>שכ"ס ממוצע</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>שנה ${r.year}</td><td>${lvlBadge(r.lvl)} ${esc(CFG.LEVELS[r.lvl])}</td><td>${r.count}</td>
          <td>${r.week != null ? r.week.toFixed(1) : '—'}</td><td>${r.weekly != null ? r.weekly.toFixed(1) : '—'}</td>
          <td>${fmtTime(r.pace)}</td><td>${trendHtml(r.trend)}</td><td>${r.push != null ? Math.round(r.push) : '—'}</td></tr>`).join('')}</tbody>
      </table></div></section>
      <section class="card"><h2>לפי קבוצה</h2><div class="chart-box"><canvas id="chSquads"></canvas></div>
        <div class="table-wrap"><table>
        <thead><tr><th>קבוצה</th><th>חניכים</th><th>ממוצע אימונים השבוע</th><th>לא התאמנו השבוע</th><th>קצב ממוצע</th></tr></thead>
        <tbody>${squads.map(s => `<tr class="clickable" data-squad="${s.year}|${s.q}"><td>שנה ${s.year} · ${s.q}</td><td>${s.count}</td><td>${s.week != null ? s.week.toFixed(1) : '—'}</td><td>${s.zero}</td><td>${fmtTime(s.pace)}</td></tr>`).join('')}</tbody>
      </table></div></section>`;
  }

  // ---------- גרפים ----------
  const brand = '#1a8599';
  const axisTime = { ticks: { callback: v => fmtTime(v) } };

  function drawProgressCharts(t) {
    const L = logsOf(t.id);
    const runs = L.filter(l => pace(l) != null);
    if (!window.Chart) return;
    if ($('#chPace')) charts.push(new Chart($('#chPace'), {
      type: 'line',
      data: { labels: runs.map(l => fmtDate(l.date)), datasets: [{ label: 'קצב לק"מ', data: runs.map(pace), borderColor: brand, backgroundColor: brand, tension: .25, pointRadius: 3 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${fmtTime(c.parsed.y)} לק"מ · ${runs[c.dataIndex].runDistanceKm} ק"מ` } } }, scales: { y: { ...axisTime, reverse: true } } }
    }));
    if ($('#chStr')) charts.push(new Chart($('#chStr'), {
      type: 'line',
      data: { labels: L.map(l => fmtDate(l.date)), datasets: [
        { label: 'שכיבות סמיכה', data: L.map(l => num(l.pushups)), borderColor: brand, backgroundColor: brand },
        { label: 'בטן', data: L.map(l => num(l.situps)), borderColor: '#d69e2e', backgroundColor: '#d69e2e' },
        { label: 'מתח', data: L.map(l => num(l.pullups)), borderColor: '#6b46c1', backgroundColor: '#6b46c1' }
      ].map(d => ({ ...d, tension: .25, pointRadius: 2, spanGaps: true })) },
      options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } }
    }));
  }

  function drawSquadChart() {
    if (!window.Chart || !$('#chSquads')) return;
    const labels = [], data = [];
    for (const year of ['א', 'ב']) for (let q = 1; q <= CFG.SQUADS[year]; q++) {
      const ss = state.trainees.filter(t => t.year === year && Number(t.squad) === q).map(summary);
      labels.push(`${year}${q}`);
      data.push(ss.length ? +avg(ss.map(s => s.weekCount)).toFixed(2) : 0);
    }
    charts.push(new Chart($('#chSquads'), {
      type: 'bar',
      data: { labels, datasets: [{ label: 'ממוצע אימונים השבוע', data, backgroundColor: brand, borderRadius: 4 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: CFG.SESSIONS_PER_WEEK } } }
    }));
  }

  // ---------- אירועים ----------
  function bind() {
    // בחירת חניך
    const fillNames = () => {
      const y = $('#pYear').value, q = Number($('#pSquad').value);
      const names = state.trainees.filter(t => t.year === y && Number(t.squad) === q).sort((a, b) => a.name.localeCompare(b.name, 'he'));
      $('#pName').innerHTML = names.length ? names.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('') : '<option value="">אין עדיין חניכים — הירשמו למטה</option>';
    };
    if ($('#pYear')) {
      fillNames();
      $('#pYear').onchange = () => { $('#pSquad').innerHTML = squadOptions($('#pYear').value, 1); fillNames(); };
      $('#pSquad').onchange = fillNames;
      $('#pGo').onclick = () => { if (!$('#pName').value) return; setMe($('#pName').value); state.viewTrainee = null; render(); };
      $('#rYear').onchange = () => { $('#rSquad').innerHTML = squadOptions($('#rYear').value, 1); };
      $('#rGo').onclick = async e => {
        const name = $('#rName').value.trim();
        if (name.length < 2) return toast('נא להזין שם מלא');
        e.target.disabled = true;
        try {
          const { trainee } = await api.post({ action: 'addTrainee', trainee: { name, year: $('#rYear').value, squad: Number($('#rSquad').value), level: $('#rLevel').value } });
          if (!state.trainees.some(t => t.id === trainee.id)) state.trainees.push(trainee);
          setMe(trainee.id);
          toast('נרשמת בהצלחה!');
          render();
        } catch (err) { toast(err.message); e.target.disabled = false; }
      };
    }

    // שמירת אימון
    if ($('#fSave')) $('#fSave').onclick = async e => {
      const dist = num($('#fDist').value), timeStr = $('#fTime').value.trim();
      const time = timeStr ? parseTime(timeStr) : null;
      if (timeStr && time == null) return toast('זמן בפורמט דקות:שניות, למשל 14:30');
      if ((dist != null) !== (time != null)) return toast('בריצה צריך למלא גם מרחק וגם זמן');
      const log = { traineeId: me().id, date: $('#fDate').value, runDistanceKm: dist ?? '', runTimeSec: time ?? '', pushups: $('#fPush').value, situps: $('#fSit').value, pullups: $('#fPull').value, notes: $('#fNotes').value.trim() };
      if (!log.date) return toast('נא לבחור תאריך');
      if (dist == null && !log.pushups && !log.situps && !log.pullups) return toast('מלאו לפחות ריצה או תרגיל אחד');
      e.target.disabled = true;
      try {
        const res = await api.post({ action: 'addLog', log });
        state.logs.push(res.log);
        toast('האימון נשמר 💪');
        render();
      } catch (err) { toast(err.message); e.target.disabled = false; }
    };

    document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('למחוק את האימון?')) return;
      try {
        await api.post({ action: 'deleteLog', id: b.dataset.del, traineeId: me().id });
        state.logs = state.logs.filter(l => l.id !== b.dataset.del);
        render();
      } catch (err) { toast(err.message); }
    });

    // לוח קבוצה
    if ($('#sYear')) {
      const upd = () => { state.squadFilter = { year: $('#sYear').value, squad: Number($('#sSquad').value), level: $('#sLevel').value }; render(); };
      $('#sYear').onchange = () => { $('#sSquad').innerHTML = squadOptions($('#sYear').value, 1); upd(); };
      $('#sSquad').onchange = upd;
      $('#sLevel').onchange = upd;
    }
    document.querySelectorAll('[data-tr]').forEach(r => r.onclick = () => {
      state.viewTrainee = state.trainees.find(t => t.id === r.dataset.tr);
      state.view = 'progress';
      render();
    });
    document.querySelectorAll('[data-squad]').forEach(r => r.onclick = () => {
      const [year, q] = r.dataset.squad.split('|');
      state.squadFilter = { year, squad: Number(q), level: '' };
      state.view = 'squad';
      render();
    });
    if ($('#backSquad')) $('#backSquad').onclick = () => { state.view = 'squad'; state.viewTrainee = null; render(); };

    if (state.view === 'progress') { const t = state.viewTrainee || me(); if (t) drawProgressCharts(t); }
    if (state.view === 'overview') drawSquadChart();
  }

  document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => {
    state.view = b.dataset.view;
    if (state.view === 'progress') state.viewTrainee = null;
    render();
  });

  // ---------- טעינה ----------
  (async () => {
    $('#demoBanner').hidden = !DEMO;
    if (window.Chart) { Chart.defaults.font.family = 'Heebo, sans-serif'; }
    try {
      const data = await api.load();
      state.trainees = data.trainees.map(t => ({ ...t, squad: Number(t.squad) }));
      state.logs = data.logs.map(l => ({ ...l, date: String(l.date).slice(0, 10) }));
      render();
    } catch (err) {
      $('#main').innerHTML = `<div class="card empty">שגיאה בטעינת הנתונים: ${esc(err.message)}<br>בדקו את API_URL בקובץ config.js</div>`;
    }
  })();
})();

'use strict';
// Nebulix 3.0 — Calendar & Tasks. Each account has its own events (with repetition and reminders) and tasks
// (priority, due date, subtasks, project). Reminders are delivered by a one-minute scheduler as a "notice"
// (toast in the app, push notification when the user is offline — see state.js offlinePush).
const { S, hub } = require('../state');
const { HttpError, now, rid } = require('../util');

const T = () => S.store.table('calendar');
const mine = (u) => { const t = T(); t[u.id] = t[u.id] || { events: [], tasks: [] }; return t[u.id]; };
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, n);
const COLORS = ['#8b7bff', '#3ee6c4', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#22c55e', '#64748b'];
const REPEAT = ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly'];
const time = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 && n < 8e12 ? Math.round(n) : null; };
function cleanEvent(b, old) {
  const start = time(b.start); if (!start) throw new HttpError(400, 'bad_start', 'The event needs a start date');
  let end = time(b.end) || start + 3600000; if (end < start) end = start; if (end - start > 30 * 86400000) end = start + 30 * 86400000;
  const title = str(b.title, 120); if (!title) throw new HttpError(400, 'bad_title', 'Give the event a title');
  const remind = b.remind === null || b.remind === undefined || b.remind === '' ? -1 : Math.max(-1, Math.min(10080, Math.round(Number(b.remind) || 0)));
  return { id: (old && old.id) || rid(10), title, notes: str(b.notes, 2000), place: str(b.place, 120), start, end, allDay: !!b.allDay, color: COLORS.includes(b.color) ? b.color : COLORS[0],
    repeat: REPEAT.includes(b.repeat) ? b.repeat : 'none', until: time(b.until), remind, created: (old && old.created) || now(), updated: now() };
}
function cleanTask(b, old) {
  const title = str(b.title, 200); if (!title) throw new HttpError(400, 'bad_title', 'Give the task a title');
  const subs = (Array.isArray(b.subs) ? b.subs : []).slice(0, 30).map((s) => ({ t: str(s && s.t, 160), done: !!(s && s.done) })).filter((s) => s.t);
  const done = !!b.done;
  return { id: (old && old.id) || rid(10), title, notes: str(b.notes, 2000), project: str(b.project, 40) || 'Inbox', prio: Math.max(0, Math.min(3, Math.round(Number(b.prio) || 0))), due: time(b.due),
    remind: b.remind === true || b.remind === 1, subs, done, doneAt: done ? (old && old.doneAt) || now() : null, created: (old && old.created) || now(), updated: now() };
}
// the start of the occurrence of a repeating event that is the first one at or after `from`
function nextStart(e, from) {
  if (e.repeat === 'none') return e.start >= from ? e.start : null;
  let d = new Date(e.start); let guard = 0;
  while (+d < from && guard++ < 4000) {
    if (e.repeat === 'daily') d.setDate(d.getDate() + 1);
    else if (e.repeat === 'weekdays') { do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6); }
    else if (e.repeat === 'weekly') d.setDate(d.getDate() + 7);
    else if (e.repeat === 'monthly') d.setMonth(d.getMonth() + 1);
    else if (e.repeat === 'yearly') d.setFullYear(d.getFullYear() + 1);
  }
  if (e.until && +d > e.until) return null; return +d;
}
// every minute: send the reminders that are due (each occurrence once)
let timer = null; const sent = new Map();
function tick() {
  const t = now(); const tbl = T();
  for (const [uid, c] of Object.entries(tbl)) {
    if (!S.users[uid] || S.users[uid].deleted) continue; const es = S.users[uid].lang !== 'en';
    for (const e of c.events || []) {
      if (e.remind < 0) continue; const occ = nextStart(e, t - 60000); if (!occ) continue; const at = occ - e.remind * 60000;
      if (at > t || at < t - 5 * 60000) continue; const key = uid + ':' + e.id + ':' + occ; if (sent.has(key)) continue; sent.set(key, t);
      const hm = new Date(occ).toLocaleTimeString(es ? 'es-ES' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
      hub.push(uid, { t: 'notice', text: e.remind ? `⏰ “${e.title}” starts in ${e.remind} min (${hm})` : `⏰ “${e.title}” is starting now`, es: e.remind ? `⏰ «${e.title}» empieza en ${e.remind} min (${hm})` : `⏰ «${e.title}» empieza ahora` });
    }
    for (const k of c.tasks || []) {
      if (!k.remind || k.done || !k.due || k.due > t || k.due < t - 5 * 60000) continue; const key = uid + ':task:' + k.id + ':' + k.due; if (sent.has(key)) continue; sent.set(key, t);
      hub.push(uid, { t: 'notice', text: `✅ Task due: “${k.title}”`, es: `✅ Tarea pendiente: «${k.title}»` });
    }
  }
  for (const [k, v] of sent) if (t - v > 3 * 3600000) sent.delete(k);
}

module.exports = function register(r) {
  if (!timer) { timer = setInterval(() => { try { tick(); } catch (e) { console.error('[calendar]', e); } }, 60000); timer.unref && timer.unref(); }
  r.get('/api/calendar', { auth: true }, async (c) => { const m = mine(c.user); let exams = []; try { exams = (require('../study').mine(c.user).exams || []).filter((e) => e.date).map((e) => ({ id: e.id, subject: e.subject, title: e.title, date: e.date, done: !!e.done })); } catch {}
    return { events: m.events, tasks: m.tasks, exams, colors: COLORS, repeats: REPEAT }; });
  r.post('/api/calendar/events', { auth: true, limit: [120, 60000, 'user'] }, async (c) => {
    const m = mine(c.user); const id = c.body.id && String(c.body.id); const i = id ? m.events.findIndex((e) => e.id === id) : -1;
    if (id && i < 0) throw new HttpError(404, 'no_event', 'Event not found'); if (i < 0 && m.events.length >= 2000) throw new HttpError(400, 'too_many', 'Too many events');
    const e = cleanEvent(c.body, i >= 0 ? m.events[i] : null); if (i >= 0) m.events[i] = e; else m.events.push(e); S.store.touch('calendar'); return { event: e };
  });
  r.delete('/api/calendar/events/:id', { auth: true }, async (c) => { const m = mine(c.user); m.events = m.events.filter((e) => e.id !== c.params.id); S.store.touch('calendar'); return { ok: true }; });
  r.post('/api/calendar/tasks', { auth: true, limit: [200, 60000, 'user'] }, async (c) => {
    const m = mine(c.user); const id = c.body.id && String(c.body.id); const i = id ? m.tasks.findIndex((e) => e.id === id) : -1;
    if (id && i < 0) throw new HttpError(404, 'no_task', 'Task not found'); if (i < 0 && m.tasks.length >= 3000) throw new HttpError(400, 'too_many', 'Too many tasks');
    const wasDone = i >= 0 && m.tasks[i].done; const k = cleanTask(c.body, i >= 0 ? m.tasks[i] : null); if (i >= 0) m.tasks[i] = k; else m.tasks.push(k); S.store.touch('calendar');
    if (k.done && !wasDone) { try { require('../progress').award(c.user, 'work'); } catch {} }
    return { task: k };
  });
  r.delete('/api/calendar/tasks/:id', { auth: true }, async (c) => { const m = mine(c.user); m.tasks = m.tasks.filter((e) => e.id !== c.params.id); S.store.touch('calendar'); return { ok: true }; });
};
module.exports.nextStart = nextStart;

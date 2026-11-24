// Nebulix Calendar & Tasks (Nebulix 3.0). #/calendar/<month|week|agenda|tasks>
// Events with repetition and reminders (delivered by the server as notifications, also when Nebulix is closed if push
// is on) and tasks with projects, priorities, due dates, reminders and subtasks. Everything is saved on the account.
import { h, mount, ls } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { toast, toastErr, modal, confirmBox, loading, segEl } from '../ui.js';

const DAY = 86400000;
const lang = () => document.documentElement.lang || 'es';
const sod = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const fmtT = (ms) => new Date(ms).toLocaleTimeString(lang(), { hour: '2-digit', minute: '2-digit' });
const fmtD = (ms, o) => new Date(ms).toLocaleDateString(lang(), o || { weekday: 'short', day: 'numeric', month: 'short' });
const pad2 = (n) => String(n).padStart(2, '0');
const toInputDate = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
const toInputTime = (ms) => { const d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
const fromInputs = (date, time) => { const [y, m, d] = date.split('-').map(Number); const [hh, mm] = (time || '00:00').split(':').map(Number); return +new Date(y, m - 1, d, hh || 0, mm || 0); };
const REMIND = [[-1, 'No reminder'], [0, 'At the start'], [5, '5 minutes before'], [10, '10 minutes before'], [30, '30 minutes before'], [60, '1 hour before'], [1440, '1 day before']];
const REPEAT = [['none', 'Does not repeat'], ['daily', 'Every day'], ['weekdays', 'Every weekday'], ['weekly', 'Every week'], ['monthly', 'Every month'], ['yearly', 'Every year']];
const PRIO = [[0, 'None', '#64748b'], [1, 'Low', '#3b82f6'], [2, 'Medium', '#f59e0b'], [3, 'High', '#ef4444']];

// every occurrence of an event that overlaps [from, to)
function occurrences(e, from, to) {
  const out = []; const len = e.end - e.start; let d = new Date(e.start); let guard = 0;
  while (+d < to && guard++ < 1500) {
    if (e.until && +d > e.until) break;
    if (+d + len >= from && (e.repeat !== 'weekdays' || (d.getDay() !== 0 && d.getDay() !== 6))) out.push({ e, start: +d, end: +d + len });
    if (e.repeat === 'none') break; if (e.repeat === 'daily' || e.repeat === 'weekdays') d.setDate(d.getDate() + 1); else if (e.repeat === 'weekly') d.setDate(d.getDate() + 7); else if (e.repeat === 'monthly') d.setMonth(d.getMonth() + 1); else if (e.repeat === 'yearly') d.setFullYear(d.getFullYear() + 1);
  }
  return out;
}

export default {
  title: () => t('Calendar'),
  async mount(root, ctx) {
    let view = ['month', 'week', 'agenda', 'tasks'].includes(ctx.params[0]) ? ctx.params[0] : ls('cal.view') || 'month';
    let cursor = sod(Date.now()); let data = { events: [], tasks: [], colors: [] }; let proj = 'all'; let tfilter = 'open';
    const body = h('div.cal-body'); const head = h('div.cal-head');
    mount(root, h('div.inner.cal', h('div.page-title', h('div', h('h2', icon('calendar', 22), ' ', t('Calendar & Tasks')), h('p', t('Your events, reminders and to-dos in one place. Reminders also arrive as notifications.')))), head, body));
    mount(body, loading());
    try { data = await api.get('/api/calendar'); } catch (e) { toastErr(e); }
    const save = async (kind, obj) => { try { const r = await api.post('/api/calendar/' + kind, obj); const list = data[kind]; const k = kind === 'events' ? r.event : r.task; const i = list.findIndex((x) => x.id === k.id); if (i >= 0) list[i] = k; else list.push(k); paint(); return k; } catch (e) { toastErr(e); return null; } };
    const del = async (kind, id) => { try { await api.del('/api/calendar/' + kind + '/' + id); data[kind] = data[kind].filter((x) => x.id !== id); paint(); } catch (e) { toastErr(e); } };
    const occIn = (from, to) => data.events.flatMap((e) => occurrences(e, from, to)).sort((a, b) => a.start - b.start);

    function eventEditor(e0, at) {
      const e = e0 || { title: '', start: at || +new Date(cursor).setHours(new Date().getHours() + 1, 0, 0, 0), end: 0, allDay: false, color: data.colors[0] || '#8b7bff', repeat: 'none', remind: 10, place: '', notes: '' }; if (!e.end) e.end = e.start + 3600000;
      const title = h('input.input', { value: e.title, placeholder: t('Title'), maxlength: 120 }); const date = h('input.input', { type: 'date', value: toInputDate(e.start) }); const st = h('input.input', { type: 'time', value: toInputTime(e.start) }); const et = h('input.input', { type: 'time', value: toInputTime(e.end) });
      const allDay = h('input', { type: 'checkbox', checked: e.allDay, onChange: () => { st.disabled = et.disabled = allDay.checked; } }); st.disabled = et.disabled = e.allDay;
      const rep = h('select.select', REPEAT.map(([v, l]) => h('option', { value: v, selected: e.repeat === v }, t(l)))); const rem = h('select.select', REMIND.map(([v, l]) => h('option', { value: v, selected: e.remind === v }, t(l))));
      const place = h('input.input', { value: e.place || '', placeholder: t('Place (optional)'), maxlength: 120 }); const notes = h('textarea.input', { rows: 3, placeholder: t('Notes'), maxlength: 2000 }); notes.value = e.notes || '';
      let color = e.color; const cols = h('div.cal-cols', (data.colors || []).map((c) => h('button.cal-col' + (c === color ? '.on' : ''), { type: 'button', style: { background: c }, onClick: (ev) => { color = c; cols.querySelectorAll('.on').forEach((x) => x.classList.remove('on')); ev.currentTarget.classList.add('on'); } })));
      modal({ title: e0 ? t('Edit event') : t('New event'), body: h('div.col.gap', title, h('div.cal-2', date, h('label.row', { style: 'gap:6px;align-items:center' }, allDay, t('All day'))), h('div.cal-2', st, et), h('div.cal-2', rep, rem), place, notes, cols),
        actions: [e0 ? { label: t('Delete'), kind: 'danger', onClick: async () => { if (await confirmBox(t('Delete “{n}”?', { n: e0.title }), { danger: true })) { await del('events', e0.id); return true; } return false; } } : null, { label: t('Cancel') },
          { label: t('Save'), kind: 'primary', onClick: async () => { if (!title.value.trim()) { toast(t('Give the event a title'), 'err'); return false; } const start = allDay.checked ? fromInputs(date.value, '00:00') : fromInputs(date.value, st.value); let end = allDay.checked ? start + DAY - 60000 : fromInputs(date.value, et.value); if (end <= start) end = start + 3600000;
            const r = await save('events', { id: e0 && e0.id, title: title.value, start, end, allDay: allDay.checked, repeat: rep.value, remind: Number(rem.value), color, place: place.value, notes: notes.value }); if (r) toast(t('Saved'), 'good', 1200); return !!r; } }].filter(Boolean) });
      setTimeout(() => title.focus(), 50);
    }
    const chip = (o) => h('button.cal-ev', { style: { '--c': o.e.color }, title: o.e.title, onClick: (ev) => { ev.stopPropagation(); eventEditor(o.e); } }, o.e.allDay ? '' : h('b', fmtT(o.start)), ' ', o.e.title, o.e.repeat !== 'none' ? ' ↻' : '');
    const taskChip = (k) => h('button.cal-tk' + (k.done ? '.done' : ''), { onClick: (ev) => { ev.stopPropagation(); taskEditor(k); } }, k.done ? '☑ ' : '☐ ', k.title);

    function paintHead() {
      const label = view === 'month' ? cursor.toLocaleDateString(lang(), { month: 'long', year: 'numeric' }) : view === 'week' ? (() => { const s = weekStart(); return fmtD(+s, { day: 'numeric', month: 'short' }) + ' – ' + fmtD(+s + 6 * DAY, { day: 'numeric', month: 'short', year: 'numeric' }); })() : '';
      const step = (k) => { if (view === 'month') cursor.setMonth(cursor.getMonth() + k); else cursor = new Date(+cursor + k * 7 * DAY); paint(); };
      mount(head, h('div.cal-bar', view === 'month' || view === 'week' ? [h('button.btn.sm.ghost', { onClick: () => step(-1), 'aria-label': t('Previous') }, '‹'), h('button.btn.sm', { onClick: () => { cursor = sod(Date.now()); paint(); } }, t('Today')), h('button.btn.sm.ghost', { onClick: () => step(1), 'aria-label': t('Next') }, '›'), h('h3.cal-label', label)] : h('div.grow'),
        h('div.grow'), segEl([['month', t('Month')], ['week', t('Week')], ['agenda', t('Agenda')], ['tasks', t('Tasks')]], view, (v) => { view = v; ls('cal.view', v); history.replaceState(null, '', '#/calendar/' + v); paint(); }),
        h('button.btn.primary.sm', { onClick: () => (view === 'tasks' ? taskEditor(null) : eventEditor(null)) }, icon('plus', 14), view === 'tasks' ? t('New task') : t('New event'))));
    }
    const weekStart = () => { const d = sod(cursor); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; };
    function paintMonth() {
      const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1); const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7)); const from = +start, to = from + 42 * DAY; const occ = occIn(from, to); const today = +sod(Date.now());
      const dows = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(lang(), { weekday: 'short' }));
      mount(body, h('div.cal-month', dows.map((d) => h('div.cal-dow', d)), Array.from({ length: 42 }, (_, i) => { const d0 = from + i * DAY; const d1 = d0 + DAY; const inM = new Date(d0).getMonth() === cursor.getMonth(); const evs = occ.filter((o) => o.start < d1 && o.end >= d0); const tks = data.tasks.filter((k) => k.due && k.due >= d0 && k.due < d1);
        return h('div.cal-day' + (inM ? '' : '.out') + (d0 === today ? '.today' : ''), { onDblclick: () => eventEditor(null, d0 + 9 * 3600000) }, h('div.cal-dn', h('span', String(new Date(d0).getDate())), h('button.cal-add', { title: t('New event'), onClick: () => eventEditor(null, d0 + 9 * 3600000) }, '+')), evs.slice(0, 3).map(chip), tks.slice(0, 2).map(taskChip), evs.length + tks.length > 5 ? h('span.tiny.muted', '+' + (evs.length + tks.length - 5)) : null); })));
    }
    function paintWeek() {
      const ws = +weekStart(); const occ = occIn(ws, ws + 7 * DAY); const H0 = 6, H1 = 24, PX = 44; const nowMs = Date.now();
      const cols = Array.from({ length: 7 }, (_, i) => { const d0 = ws + i * DAY; const evs = occ.filter((o) => !o.e.allDay && o.start < d0 + DAY && o.end > d0); const all = occ.filter((o) => o.e.allDay && o.start < d0 + DAY && o.end > d0);
        return h('div.cal-wcol' + (d0 === +sod(nowMs) ? '.today' : ''), h('div.cal-wh', fmtD(d0)), h('div.cal-wall', all.map(chip), data.tasks.filter((k) => k.due && k.due >= d0 && k.due < d0 + DAY).map(taskChip)),
          h('div.cal-wgrid', { style: { height: (H1 - H0) * PX + 'px' }, onDblclick: (ev) => { const y = ev.offsetY; eventEditor(null, d0 + (H0 + Math.floor(y / PX)) * 3600000); } },
            Array.from({ length: H1 - H0 }, (_, k) => h('i.cal-hl', { style: { top: k * PX + 'px' } })), d0 === +sod(nowMs) ? h('i.cal-now', { style: { top: ((nowMs - d0) / 3600000 - H0) * PX + 'px' } }) : null,
            evs.map((o) => { const s = Math.max(o.start, d0 + H0 * 3600000), e = Math.min(o.end, d0 + H1 * 3600000); return h('button.cal-wev', { style: { '--c': o.e.color, top: ((s - d0) / 3600000 - H0) * PX + 'px', height: Math.max(20, (e - s) / 3600000 * PX - 2) + 'px' }, onClick: () => eventEditor(o.e) }, h('b', o.e.title), h('span', fmtT(o.start) + ' – ' + fmtT(o.end))); }))); });
      mount(body, h('div.cal-week', h('div.cal-hours', h('div.cal-wh'), h('div.cal-wall'), Array.from({ length: H1 - H0 }, (_, k) => h('span', { style: { height: PX + 'px' } }, pad2(H0 + k) + ':00'))), cols));
    }
    function paintAgenda() {
      const from = +sod(Date.now()); const occ = occIn(from, from + 60 * DAY); const byDay = new Map(); for (const o of occ) { const k = +sod(o.start); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(o); }
      for (const k of data.tasks) if (k.due && !k.done && k.due >= from && k.due < from + 60 * DAY) { const d = +sod(k.due); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push({ task: k, start: k.due }); }
      const days = [...byDay.keys()].sort((a, b) => a - b);
      mount(body, days.length ? h('div.cal-agenda', days.map((d) => h('section', h('h4', fmtD(d, { weekday: 'long', day: 'numeric', month: 'long' }), d === from ? h('span.pill', t('Today')) : null), byDay.get(d).sort((a, b) => a.start - b.start).map((o) => (o.task ? h('div.cal-ag.task', h('span.cal-agt', fmtT(o.start)), taskChip(o.task)) : h('div.cal-ag', { style: { '--c': o.e.color } }, h('span.cal-agt', o.e.allDay ? t('All day') : fmtT(o.start) + ' – ' + fmtT(o.end)), h('button.cal-agb', { onClick: () => eventEditor(o.e) }, h('b', o.e.title), o.e.place ? h('span.muted', ' · ' + o.e.place) : null, o.e.remind >= 0 ? ' 🔔' : '', o.e.repeat !== 'none' ? ' ↻' : ''))))))) : h('div.empty', h('div.empty-art', icon('calendar', 26)), h('h3', t('Nothing in the next 60 days')), h('button.btn.primary', { onClick: () => eventEditor(null) }, t('New event'))));
    }
    function taskEditor(k0) {
      const k = k0 || { title: '', notes: '', project: proj !== 'all' ? proj : 'Inbox', prio: 0, due: null, remind: false, subs: [], done: false };
      const title = h('input.input', { value: k.title, placeholder: t('What needs doing?'), maxlength: 200 }); const project = h('input.input', { value: k.project, placeholder: t('Project'), maxlength: 40, list: 'cal-projects' });
      const dl = h('datalist#cal-projects', [...new Set(data.tasks.map((x) => x.project))].map((p) => h('option', { value: p })));
      const date = h('input.input', { type: 'date', value: k.due ? toInputDate(k.due) : '' }); const time = h('input.input', { type: 'time', value: k.due ? toInputTime(k.due) : '09:00' });
      const prio = h('select.select', PRIO.map(([v, l]) => h('option', { value: v, selected: k.prio === v }, t(l)))); const remind = h('input', { type: 'checkbox', checked: !!k.remind });
      const notes = h('textarea.input', { rows: 3, placeholder: t('Notes'), maxlength: 2000 }); notes.value = k.notes || '';
      let subs = (k.subs || []).map((s) => Object.assign({}, s)); const subsEl = h('div.cal-subs'); const subIn = h('input.input.sm', { placeholder: t('Add a subtask and press Enter'), onKeydown: (e) => { if (e.key === 'Enter' && subIn.value.trim()) { subs.push({ t: subIn.value.trim(), done: false }); subIn.value = ''; paintSubs(); } } });
      const paintSubs = () => mount(subsEl, subs.map((s, i) => h('label.cal-sub', h('input', { type: 'checkbox', checked: s.done, onChange: () => { s.done = !s.done; } }), h('span.grow', s.t), h('button.btn.sm.ghost', { onClick: () => { subs.splice(i, 1); paintSubs(); } }, '×'))), subIn); paintSubs();
      modal({ title: k0 ? t('Edit task') : t('New task'), body: h('div.col.gap', title, h('div.cal-2', project, prio), dl, h('div.cal-2', date, time), h('label.row', { style: 'gap:6px;align-items:center' }, remind, t('Remind me when it is due')), h('b.small', t('Subtasks')), subsEl, notes),
        actions: [k0 ? { label: t('Delete'), kind: 'danger', onClick: async () => { await del('tasks', k0.id); return true; } } : null, { label: t('Cancel') }, { label: t('Save'), kind: 'primary', onClick: async () => { if (!title.value.trim()) { toast(t('Give the task a title'), 'err'); return false; } const r = await save('tasks', { id: k0 && k0.id, title: title.value, project: project.value, prio: Number(prio.value), due: date.value ? fromInputs(date.value, time.value) : null, remind: remind.checked, subs, notes: notes.value, done: k.done }); return !!r; } }].filter(Boolean) });
      setTimeout(() => title.focus(), 50);
    }
    function paintTasks() {
      const projects = ['all', ...new Set(data.tasks.map((x) => x.project || 'Inbox'))]; const today = +sod(Date.now());
      const list = data.tasks.filter((k) => (proj === 'all' || k.project === proj) && (tfilter === 'done' ? k.done : tfilter === 'today' ? !k.done && k.due && k.due < today + DAY : !k.done)).sort((a, b) => (a.done - b.done) || (b.prio - a.prio) || ((a.due || 9e15) - (b.due || 9e15)));
      const quick = h('input.input', { placeholder: t('Quick add: type a task and press Enter (add !1 !2 !3 for priority)'), onKeydown: async (e) => { if (e.key !== 'Enter' || !quick.value.trim()) return; const m = /!([1-3])/.exec(quick.value); const title = quick.value.replace(/!([1-3])/, '').trim(); quick.value = ''; await save('tasks', { title, prio: m ? Number(m[1]) : 0, project: proj !== 'all' ? proj : 'Inbox' }); } });
      const doneN = data.tasks.filter((k) => k.done).length;
      mount(body, h('div.cal-tasks', h('aside.cal-proj', projects.map((p) => h('button' + (p === proj ? '.on' : ''), { onClick: () => { proj = p; paint(); } }, icon(p === 'all' ? 'layers' : 'folder', 14), h('span.grow', p === 'all' ? t('All projects') : p), h('span.tiny.muted', String(data.tasks.filter((k) => !k.done && (p === 'all' || k.project === p)).length)))),
        h('div.cal-prog', h('div', h('i', { style: { width: (data.tasks.length ? doneN / data.tasks.length * 100 : 0) + '%' } })), h('span.tiny.muted', t('{a} of {b} done', { a: doneN, b: data.tasks.length })))),
        h('div.cal-tmain', quick, segEl([['open', t('To do')], ['today', t('Today')], ['done', t('Done')]], tfilter, (v) => { tfilter = v; paint(); }),
          list.length ? h('div.cal-tlist', list.map((k) => { const late = !k.done && k.due && k.due < Date.now(); const subsDone = (k.subs || []).filter((s) => s.done).length;
            return h('div.cal-trow' + (k.done ? '.done' : ''), h('button.cal-check', { style: { '--p': PRIO[k.prio][2] }, 'aria-label': t('Done'), onClick: () => save('tasks', Object.assign({}, k, { done: !k.done })) }, k.done ? '✓' : ''),
              h('button.cal-tbody', { onClick: () => taskEditor(k) }, h('b', k.title), h('div.cal-tmeta', k.project !== 'Inbox' ? h('span', '# ' + k.project) : null, k.due ? h('span' + (late ? '.late' : ''), icon('clock', 11), ' ', fmtD(k.due) + ' ' + fmtT(k.due)) : null, k.subs && k.subs.length ? h('span', '☑ ' + subsDone + '/' + k.subs.length) : null, k.remind ? h('span', '🔔') : null, k.prio ? h('span', { style: { color: PRIO[k.prio][2] } }, '⚑ ' + t(PRIO[k.prio][1])) : null))); })) : h('div.empty', h('p.muted', tfilter === 'done' ? t('No finished tasks yet.') : t('Nothing to do here. 🎉'))))));
      setTimeout(() => quick.focus(), 30);
    }
    function paint() { paintHead(); if (view === 'month') paintMonth(); else if (view === 'week') paintWeek(); else if (view === 'agenda') paintAgenda(); else paintTasks(); }
    paint();
    return () => {};
  },
};

// Nebulix Forms (3.0 phase 16): build a form, share its link, collect answers from Nebulix users and see the results.
// #/forms · #/forms/<id> (answer) · #/forms/<id>/edit · #/forms/<id>/results
import { h, mount } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { toast, toastErr, confirmBox, loading, emptyState, field } from '../ui.js';

const TYPES = [['text', 'Short answer'], ['para', 'Paragraph'], ['choice', 'One choice'], ['multi', 'Checkboxes'], ['scale', 'Scale'], ['number', 'Number'], ['email', 'Email'], ['date', 'Date']];
const nid = () => Math.random().toString(36).slice(2, 10);
const link = (id) => location.origin + '/#/forms/' + id;

export default {
  title: () => t('Forms'),
  async mount(root, ctx) {
    const [id, sub] = ctx.params; const wrap = h('div.inner.fm'); mount(root, wrap, loading());
    try {
      if (!id) await listPage(wrap, ctx); else if (sub === 'edit') await editPage(wrap, ctx, id); else if (sub === 'results') await resultsPage(wrap, ctx, id); else await answerPage(wrap, ctx, id);
    } catch (e) { mount(wrap, emptyState('alert', t('Form not found'), e.message, h('a.btn', { href: '#/forms' }, t('Back')))); }
    return () => {};
  },
};

async function listPage(wrap, ctx) {
  const { forms } = await api.get('/api/forms');
  const create = async () => { try { const r = await api.post('/api/forms', { title: t('Untitled form'), questions: [{ id: nid(), type: 'text', label: t('Your name'), required: true }] }); ctx.go('forms/' + r.form.id + '/edit'); } catch (e) { toastErr(e); } };
  mount(wrap, h('div.page-title', h('div', h('h2', icon('list', 22), ' ', t('Forms')), h('p', t('Surveys, sign-ups and quizzes: share the link and see the answers live.'))), h('button.btn.primary', { onClick: create }, icon('plus', 15), t('New form'))),
    forms.length ? h('div.fm-grid', forms.map((f) => h('article.fm-card', h('b', f.title), h('div.tiny.muted', t('{n} answers', { n: f.responses }) + ' · ' + (f.open ? t('Open') : t('Closed'))),
      h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, h('a.btn.sm.primary', { href: '#/forms/' + f.id + '/results' }, icon('chart', 13), t('Results')), h('a.btn.sm', { href: '#/forms/' + f.id + '/edit' }, icon('edit', 13), t('Edit')),
        h('button.btn.sm', { onClick: () => { navigator.clipboard.writeText(link(f.id)); toast(t('Link copied'), 'good'); } }, icon('link', 13), t('Copy link')))))) : emptyState('list', t('No forms yet'), t('Create a form and share its link with anyone on Nebulix.')));
}

async function editPage(wrap, ctx, id) {
  const { form } = await api.get('/api/forms/' + id); if (!form.mine) throw new Error(t('Only the owner can edit this form'));
  const f = JSON.parse(JSON.stringify(form)); let saveT = 0; const state = h('span.tiny.muted');
  const save = () => { clearTimeout(saveT); state.textContent = t('Saving…'); saveT = setTimeout(async () => { try { await api.put('/api/forms/' + id, { title: f.title, desc: f.desc, questions: f.questions, open: f.open, multi: f.multi, anonymous: f.anonymous }); state.textContent = t('All changes saved'); } catch (e) { state.textContent = ''; toastErr(e); } }, 600); };
  const qBox = h('div.fm-qs');
  function paintQs() {
    mount(qBox, f.questions.map((q, i) => {
      const opts = ['choice', 'multi'].includes(q.type) ? h('div.fm-opts', (q.options || []).map((o, k) => h('div.row', { style: 'gap:6px' }, h('input.input', { value: o, 'aria-label': t('Option {n}', { n: k + 1 }), onInput: (e) => { q.options[k] = e.target.value; save(); } }), h('button.btn.sm.ghost', { 'aria-label': t('Remove option'), onClick: () => { q.options.splice(k, 1); paintQs(); save(); } }, icon('trash', 12)))),
        h('button.btn.sm', { onClick: () => { q.options.push(t('Option {n}', { n: q.options.length + 1 })); paintQs(); save(); } }, icon('plus', 12), t('Add option'))) : q.type === 'scale' ? field(t('Scale up to'), h('select.input', { onChange: (e) => { q.max = Number(e.target.value); save(); } }, [5, 7, 10].map((n) => h('option', { value: n, selected: (q.max || 5) === n }, '1 – ' + n)))) : null;
      return h('div.fm-q', h('div.row', { style: 'gap:8px' }, h('input.input.grow', { value: q.label, 'aria-label': t('Question'), onInput: (e) => { q.label = e.target.value; save(); } }),
        h('select.input', { style: 'width:auto', 'aria-label': t('Type'), onChange: (e) => { q.type = e.target.value; if (['choice', 'multi'].includes(q.type) && !(q.options && q.options.length)) q.options = [t('Option {n}', { n: 1 }), t('Option {n}', { n: 2 })]; paintQs(); save(); } }, TYPES.map(([v, l]) => h('option', { value: v, selected: v === q.type }, t(l))))), opts,
        h('div.row', { style: 'gap:10px;align-items:center' }, h('label.tiny', h('input', { type: 'checkbox', checked: q.required, onChange: (e) => { q.required = e.target.checked; save(); } }), ' ', t('Required')), h('span.grow'),
          h('button.btn.sm.ghost', { disabled: i === 0, 'aria-label': t('Move up'), onClick: () => { [f.questions[i - 1], f.questions[i]] = [f.questions[i], f.questions[i - 1]]; paintQs(); save(); } }, '↑'),
          h('button.btn.sm.ghost', { 'aria-label': t('Delete question'), onClick: () => { f.questions.splice(i, 1); paintQs(); save(); } }, icon('trash', 13))));
    }), h('button.btn', { onClick: () => { f.questions.push({ id: nid(), type: 'text', label: t('New question'), required: false }); paintQs(); save(); } }, icon('plus', 14), t('Add question')));
  }
  const chk = (key, label) => h('label.small', h('input', { type: 'checkbox', checked: !!f[key], onChange: (e) => { f[key] = e.target.checked; save(); } }), ' ', label);
  mount(wrap, h('div.row', { style: 'gap:8px;align-items:center;margin-bottom:12px' }, h('a.btn.sm.ghost', { href: '#/forms', 'aria-label': t('Back') }, icon('back', 15)), h('b.grow', t('Edit form')), state,
    h('a.btn.sm', { href: '#/forms/' + id }, icon('eye', 13), t('Preview')), h('button.btn.sm.primary', { onClick: () => { navigator.clipboard.writeText(link(id)); toast(t('Link copied'), 'good'); } }, icon('link', 13), t('Copy link'))),
    h('div.fm-head', h('input.input.fm-title', { value: f.title, 'aria-label': t('Title'), onInput: (e) => { f.title = e.target.value; save(); } }), h('textarea.input', { rows: 2, placeholder: t('Description (optional)'), onInput: (e) => { f.desc = e.target.value; save(); } }, f.desc),
      h('div.row', { style: 'gap:14px;flex-wrap:wrap' }, chk('open', t('Accepting answers')), chk('multi', t('Allow several answers per person')), chk('anonymous', t('Hide who answered')))),
    qBox, h('div.row', { style: 'margin-top:20px' }, h('button.btn.danger', { onClick: async () => { if (await confirmBox(t('Delete this form and all its answers?'), { danger: true })) { await api.del('/api/forms/' + id); ctx.go('forms'); } } }, icon('trash', 14), t('Delete form'))));
  const ta = wrap.querySelector('.fm-head textarea'); ta.value = f.desc || ''; paintQs();
}

async function answerPage(wrap, ctx, id) {
  const { form } = await api.get('/api/forms/' + id); const vals = {};
  if (!form.open) { mount(wrap, emptyState('lock', form.title, t('This form is no longer accepting answers.'))); return; }
  if (form.answered && !form.multi) { mount(wrap, emptyState('check', form.title, t('You have already answered this form. Thank you!'), form.mine ? h('a.btn', { href: '#/forms/' + id + '/results' }, t('Results')) : null)); return; }
  const inputFor = (q) => {
    const set = (v) => { vals[q.id] = v; };
    if (q.type === 'para') return h('textarea.input', { rows: 4, onInput: (e) => set(e.target.value) });
    if (q.type === 'choice') return h('div.fm-choices', q.options.map((o) => h('label', h('input', { type: 'radio', name: q.id, onChange: () => set(o) }), ' ', o)));
    if (q.type === 'multi') { vals[q.id] = []; return h('div.fm-choices', q.options.map((o) => h('label', h('input', { type: 'checkbox', onChange: (e) => { vals[q.id] = e.target.checked ? [...vals[q.id], o] : vals[q.id].filter((x) => x !== o); } }), ' ', o))); }
    if (q.type === 'scale') return h('div.fm-scale', Array.from({ length: q.max }, (_, i) => h('label', h('input', { type: 'radio', name: q.id, onChange: () => set(i + 1) }), h('span', String(i + 1)))));
    return h('input.input', { type: { email: 'email', number: 'number', date: 'date' }[q.type] || 'text', onInput: (e) => set(e.target.value) });
  };
  const send = h('button.btn.primary', t('Send'));
  send.onclick = async () => { send.disabled = true; try { await api.post('/api/forms/' + id + '/answer', { answers: vals }); mount(wrap, emptyState('check', t('Thank you!'), t('Your answer has been sent.'), h('a.btn', { href: '#/home' }, t('Back to Nebulix')))); } catch (e) { toastErr(e); send.disabled = false; } };
  mount(wrap, h('form.fm-answer', { onSubmit: (e) => { e.preventDefault(); send.onclick(); } }, h('h2', form.title), form.desc ? h('p.muted', form.desc) : null, h('p.tiny.muted', t('By @{u}', { u: form.owner }) + (form.anonymous ? ' · ' + t('Answers are anonymous') : '')),
    form.questions.map((q) => h('div.fm-aq', h('label.fm-label', q.label, q.required ? h('span.fm-req', ' *') : null), inputFor(q))), send));
}

async function resultsPage(wrap, ctx, id) {
  const r = await api.get('/api/forms/' + id + '/results'); const { form, answers } = r;
  const summary = (q) => {
    const vs = answers.map((a) => a.answers[q.id]).filter((v) => v !== '' && v != null && !(Array.isArray(v) && !v.length));
    if (['choice', 'multi', 'scale'].includes(q.type)) {
      const keys = q.type === 'scale' ? Array.from({ length: q.max }, (_, i) => i + 1) : q.options; const n = new Map(keys.map((k) => [k, 0]));
      for (const v of vs) for (const x of [].concat(v)) n.set(x, (n.get(x) || 0) + 1); const max = Math.max(1, ...n.values());
      return h('div.fm-bars', [...n].map(([k, c]) => h('div.fm-bar', h('span.fm-bl', String(k)), h('i', h('em', { style: 'width:' + (c / max * 100) + '%' })), h('b', String(c)))), q.type === 'scale' && vs.length ? h('div.tiny.muted', t('Average {a}', { a: (vs.reduce((s, v) => s + v, 0) / vs.length).toFixed(2) })) : null);
    }
    return h('div.fm-texts', vs.slice(-8).reverse().map((v) => h('div.fm-text', String(v))), vs.length > 8 ? h('div.tiny.muted', t('…and {n} more', { n: vs.length - 8 })) : null);
  };
  const csv = () => { const esc = (v) => '"' + String(Array.isArray(v) ? v.join('; ') : v ?? '').replace(/"/g, '""') + '"'; const rows = [[t('Date'), ...(form.anonymous ? [] : [t('User')]), ...form.questions.map((q) => q.label)].map(esc).join(',')];
    for (const a of answers) rows.push([new Date(a.at).toISOString(), ...(form.anonymous ? [] : [a.by]), ...form.questions.map((q) => a.answers[q.id])].map(esc).join(','));
    const el = h('a', { href: URL.createObjectURL(new Blob(['﻿' + rows.join('\n')], { type: 'text/csv' })), download: form.title + '.csv' }); el.click(); };
  mount(wrap, h('div.row', { style: 'gap:8px;align-items:center;margin-bottom:12px' }, h('a.btn.sm.ghost', { href: '#/forms', 'aria-label': t('Back') }, icon('back', 15)), h('h2.grow', form.title),
    h('a.btn.sm', { href: '#/forms/' + id + '/edit' }, icon('edit', 13), t('Edit')), h('button.btn.sm', { disabled: !answers.length, onClick: csv }, icon('download', 13), 'CSV'), h('button.btn.sm.primary', { onClick: () => { navigator.clipboard.writeText(link(id)); toast(t('Link copied'), 'good'); } }, icon('link', 13), t('Copy link'))),
    h('p.muted', t('{n} answers', { n: answers.length })),
    answers.length ? form.questions.map((q) => h('section.fm-res', h('b', q.label), summary(q))) : emptyState('inbox', t('No answers yet'), t('Share the link: {l}', { l: link(id) })));
}

// Nebulix Study (13.8): #/study · #/study/notes · #/study/cards · #/study/grades · #/study/exams · #/study/tutor · #/study/live
// Community study notes, flashcards with spaced repetition (SM-2) and test / write modes, an AI tutor that teaches step
// by step, AI generators (flashcards and quizzes from your notes), live class quizzes with a PIN, a grade tracker with
// "what do I need" and an exam planner. Original design for Nebulix.
import { h, mount, fmt, ls } from '../util.js';
import { t, getLang } from '../i18n.js';
import { api, ws } from '../api.js';
import { bus } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, modal, confirmBox, loading } from '../ui.js';
import { renderMarkdown } from '../markdown.js';
import { askNova, novaOnce } from '../nova-core.js';
import { sfx } from '../sfx.js';

const es = () => getLang() === 'es';
const L = (p) => (es() ? p[1] : p[0]);
const SUBJ = { math: ['Maths', 'Matemáticas', '#6366f1'], spanish: ['Spanish', 'Lengua', '#ef4444'], english: ['English', 'Inglés', '#0ea5e9'], physics: ['Physics', 'Física', '#8b5cf6'], chemistry: ['Chemistry', 'Química', '#14b8a6'], biology: ['Biology', 'Biología', '#22c55e'], geology: ['Geology', 'Geología', '#a16207'], history: ['History', 'Historia', '#b45309'], geography: ['Geography', 'Geografía', '#0d9488'], philosophy: ['Philosophy', 'Filosofía', '#7c3aed'], economics: ['Economics', 'Economía', '#16a34a'], tech: ['Technology', 'Tecnología', '#475569'], cs: ['Computer science', 'Informática', '#2563eb'], art: ['Art', 'Plástica', '#db2777'], music: ['Music', 'Música', '#e11d48'], pe: ['PE', 'Educación física', '#f97316'], latin: ['Latin', 'Latín', '#92400e'], french: ['French', 'Francés', '#1d4ed8'], german: ['German', 'Alemán', '#ca8a04'], catalan: ['Catalan', 'Catalán', '#dc2626'], valencian: ['Valencian', 'Valenciano', '#dc2626'], basque: ['Basque', 'Euskera', '#15803d'], galician: ['Galician', 'Gallego', '#0284c7'], religion: ['Religion', 'Religión', '#a855f7'], other: ['Other', 'Otra', '#64748b'] };
const LEVELS = { primary: ['Primary', 'Primaria'], eso1: ['1st ESO', '1º ESO'], eso2: ['2nd ESO', '2º ESO'], eso3: ['3rd ESO', '3º ESO'], eso4: ['4th ESO', '4º ESO'], bach1: ['1st Bach.', '1º Bach.'], bach2: ['2nd Bach.', '2º Bach.'], fp: ['Vocational', 'FP'], uni: ['University', 'Universidad'], other: ['Other', 'Otro'] };
const sName = (k) => L(SUBJ[k] || SUBJ.other); const sCol = (k) => (SUBJ[k] || SUBJ.other)[2];
const chip = (k) => h('span.nst-subj', { style: { '--c': sCol(k) } }, sName(k));
const subjSelect = (v, all) => h('select.input', (all ? [['', t('All subjects')]] : []).concat(Object.keys(SUBJ).map((k) => [k, sName(k)])).map(([k, n]) => h('option', { value: k, selected: k === (v || '') }, n)));
const levelSelect = (v, all) => h('select.input', (all ? [['', t('All years')]] : []).concat(Object.entries(LEVELS).map(([k, n]) => [k, L(n)])).map(([k, n]) => h('option', { value: k, selected: k === (v || '') }, n)));
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const snd = (k) => { try { sfx[k] && sfx[k](); } catch {} };
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
// pull a JSON array out of an AI answer (it may come inside ``` fences or with text around it)
function jsonArray(txt) { const m = String(txt).match(/\[[\s\S]*\]/); if (!m) return null; try { const a = JSON.parse(m[0]); return Array.isArray(a) ? a : null; } catch { return null; } }

const TABS = [['home', 'Study', 'home'], ['notes', 'Notes', 'note'], ['cards', 'Flashcards', 'layers'], ['tutor', 'AI tutor', 'spark'], ['live', 'Live class', 'users'], ['grades', 'My grades', 'chart'], ['exams', 'Exams', 'calendar'], ['tools', 'Tools', 'grid']];

export default {
  title: () => t('Study'), full: true,
  async mount(root, ctx) {
    let tab = TABS.some((x) => x[0] === ctx.params[0]) ? ctx.params[0] : 'home'; let off = null; let info = null;
    const body = h('div.nst-body'); const nav = h('nav.nst-tabs');
    mount(root, h('div.nst', h('header.nst-head', h('div.nst-brand', icon('book', 22), h('div', h('b', 'Nebulix ' + t('Study')), h('span.tiny.muted', t('Notes, flashcards, an AI tutor and live quizzes for class')))), nav), body));
    async function refresh() { try { info = await api.get('/api/study'); } catch (e) { info = info || { grades: [], exams: [], myDecks: [], due: 0, earned: 0, subjects: [], levels: [] }; } }
    async function show(id, sub) {
      if (off) { try { off(); } catch {} off = null; } tab = id; history.replaceState(null, '', '#/study' + (id === 'home' ? '' : '/' + id) + (sub ? '/' + sub : ''));
      mount(nav, TABS.map(([k, n, ic]) => h('button' + (k === tab ? '.on' : ''), { onClick: () => show(k) }, icon(ic, 16), h('span', t(n)))));
      mount(body, loading()); await refresh();
      const fn = { home: homeTab, notes: notesTab, cards: cardsTab, tutor: tutorTab, live: liveTab, grades: gradesTab, exams: examsTab, tools: toolsTab }[id];
      const box = h('div.nst-tab'); mount(body, box); off = (await fn(box, sub)) || null;
    }
    const go = (id, sub) => show(id, sub);

    // ================= home =================
    async function homeTab(box) {
      const avg = overall(info.grades); const next = (info.exams || []).filter((e) => !e.done && e.date > Date.now() - 86400000).sort((a, b) => a.date - b.date).slice(0, 4);
      mount(box, h('div.nst-kpis',
        kpi('layers', t('Cards to review'), String(info.due || 0), () => go('cards')), kpi('chart', t('Average grade'), avg === null ? '—' : avg.toFixed(2), () => go('grades')),
        kpi('calendar', t('Next exam'), next[0] ? daysTo(next[0].date) : '—', () => go('exams')), kpi('coins', t('Earned studying today'), String(info.earned || 0) + ' / 120')),
      h('div.nst-grid',
        h('section.card.nst-quick', h('h3', t('What do you want to do?')),
          h('div.nst-actions', act('note', t('Read notes'), t('Notes shared by students, by subject and year'), () => go('notes')), act('plus', t('Write notes'), t('Share yours and earn coins'), () => editNote()), act('layers', t('Practise flashcards'), t('Spaced repetition: you see each card right before you forget it'), () => go('cards')),
            act('spark', t('Ask the AI tutor'), t('It explains step by step instead of just giving the answer'), () => go('tutor')), act('users', t('Play in class'), t('Live quiz with a PIN, like a contest'), () => go('live')), act('chart', t('Track my grades'), t('Averages and what you need on the next exam'), () => go('grades')))),
        h('section.card', h('h3', icon('calendar', 16), ' ', t('Upcoming exams')), next.length ? next.map((e) => h('div.nst-exam', chip(e.subject), h('b.grow', e.title), h('span.pill', daysTo(e.date)))) : h('p.muted.small', t('No exams planned. Add them in Exams to get a countdown.')), h('button.btn.sm', { onClick: () => go('exams') }, icon('plus', 14), t('Add exam'))),
        h('section.card', h('h3', icon('layers', 16), ' ', t('My decks')), (info.myDecks || []).length ? info.myDecks.slice(0, 6).map((d) => h('button.nst-deckrow', { onClick: () => go('cards', d.id) }, chip(d.subject), h('b.grow', d.title), d.due ? h('span.pill.nst-due', t('{n} due', { n: d.due })) : h('span.tiny.muted', t('{n} cards', { n: d.count })))) : h('p.muted.small', t('Create a deck or save one from the community.')), h('button.btn.sm', { onClick: () => editDeck() }, icon('plus', 14), t('New deck')))));
    }
    const kpi = (ic, label, val, onClick) => h(onClick ? 'button.nst-kpi' : 'div.nst-kpi', { onClick }, icon(ic, 18), h('div', h('span.tiny.muted', label), h('b', val)));
    const act = (ic, title, sub, onClick) => h('button.nst-act', { onClick }, h('span.nst-act-ic', icon(ic, 20)), h('b', title), h('span.tiny.muted', sub));

    // ================= notes =================
    async function notesTab(box, sub) {
      if (sub) return readNote(box, sub);
      const q = { subject: ls('st.subj') || '', level: ls('st.level') || '', sort: 'new', q: '', mine: '', saved: '' };
      const search = h('input.input', { placeholder: t('Search notes (topic, word, title)…'), onInput: debounce(() => { q.q = search.value; load(); }, 300) });
      const sj = subjSelect(q.subject, true); sj.onchange = () => { q.subject = sj.value; ls('st.subj', q.subject); load(); };
      const lv = levelSelect(q.level, true); lv.onchange = () => { q.level = lv.value; ls('st.level', q.level); load(); };
      const filt = h('div.nst-seg', [['new', t('Newest')], ['top', t('Most popular')], ['saved', t('Saved')], ['mine', t('Mine')]].map(([k, n]) => h('button' + (k === 'new' ? '.on' : ''), { onClick: (e) => { [...filt.children].forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); q.sort = k === 'top' ? 'top' : 'new'; q.saved = k === 'saved' ? '1' : ''; q.mine = k === 'mine' ? '1' : ''; load(); } }, n)));
      const list = h('div.nst-notes');
      mount(box, h('div.nst-bar', search, sj, lv, h('button.btn.primary', { onClick: () => editNote() }, icon('plus', 15), t('Write notes'))), filt, list);
      async function load() {
        mount(list, loading());
        try { const r = await api.get('/api/study/notes?' + new URLSearchParams(q)); mount(list, r.notes.length ? r.notes.map(noteCard) : h('div.empty', h('h3', t('No notes here yet')), h('p.muted', t('Be the first: write notes for this subject and earn coins.')), h('button.btn.primary', { onClick: () => editNote() }, t('Write notes')))); } catch (e) { mount(list, h('span.error', e.message)); }
      }
      const noteCard = (n) => h('button.nst-note', { onClick: () => go('notes', n.id) }, h('div.row', { style: 'gap:6px' }, chip(n.subject), n.level ? h('span.tiny.muted', L(LEVELS[n.level] || LEVELS.other)) : null), h('b', n.title), h('p.small.muted', n.excerpt.replace(/[#*_>`-]/g, '').slice(0, 160) + '…'),
        h('div.nst-meta', n.author ? h('span.tiny', '@' + n.author.username) : null, h('span.grow'), h('span.tiny', icon('heart', 12), ' ' + n.likes), h('span.tiny', icon('eye', 12), ' ' + n.views)));
      load();
    }
    async function readNote(box, id) {
      let n; try { n = (await api.get('/api/study/notes/' + encodeURIComponent(id))).note; } catch (e) { mount(box, h('span.error', e.message)); return; }
      const likeB = h('button.btn.sm', { onClick: async () => { try { const r = await api.post(`/api/study/notes/${n.id}/like`); n.likes = r.likes; n.liked = r.liked; paintLike(); } catch (e) { toastErr(e); } } });
      const paintLike = () => mount(likeB, icon('heart', 14), ' ' + n.likes + ' ' + (n.liked ? t('Liked') : t('Like')));
      const saveB = h('button.btn.sm', { onClick: async () => { try { const r = await api.post('/api/study/save', { kind: 'note', id: n.id }); n.saved = r.saved; saveB.lastChild.textContent = ' ' + (n.saved ? t('Saved') : t('Save')); } catch (e) { toastErr(e); } } }, icon('bookmark', 14), h('span', ' ' + (n.saved ? t('Saved') : t('Save'))));
      paintLike();
      const askIn = h('input.input', { placeholder: t('What do you want to know about this?'), onKeydown: (e) => { if (e.key === 'Enter') ask(); } });
      const ask = () => { const q2 = askIn.value.trim(); if (!q2) return; askIn.value = ''; aiModal(q2, `${lng()} ${es() ? 'Eres un tutor. Contesta usando estos apuntes (y lo que sepas si hace falta), claro y con ejemplos.' : 'You are a tutor. Answer using these notes (and what you know if needed), clearly and with examples.'}\n\n${es() ? 'Pregunta' : 'Question'}: ${q2}\n\n${es() ? 'Apuntes' : 'Notes'} "${n.title}":\n${n.body.slice(0, 10000)}`); };
      mount(box, h('div.nst-read',
        h('div.row', { style: 'gap:8px;flex-wrap:wrap;align-items:center' }, h('button.btn.sm.ghost', { onClick: () => go('notes') }, icon('back', 14), t('Notes')), chip(n.subject), h('span.tiny.muted', L(LEVELS[n.level] || LEVELS.other)), h('span.grow'), likeB, saveB,
          h('button.btn.sm', { onClick: () => aiFromNote(n, 'cards') }, icon('layers', 14), t('Flashcards with AI')), h('button.btn.sm', { onClick: () => aiFromNote(n, 'quiz') }, icon('flag', 14), t('Quiz with AI')), h('button.btn.sm', { onClick: () => aiFromNote(n, 'summary') }, icon('spark', 14), t('Summary')),
          n.mine ? h('button.btn.sm', { onClick: () => editNote(n) }, icon('edit', 14), t('Edit')) : h('button.btn.sm.ghost', { title: t('Report'), onClick: async () => { if (await confirmBox(t('Report these notes as wrong or inappropriate?'))) { try { await api.post('/api/study/report', { kind: 'note', id: n.id }); toast(t('Thanks, the team will check it'), 'good'); } catch (e) { toastErr(e); } } } }, icon('flag', 14))),
        h('h1', n.title), h('div.tiny.muted', (n.author ? '@' + n.author.username + ' · ' : '') + fmt.date(n.updated || n.created) + ' · ' + t('{n} views', { n: n.views })),
        h('article.nst-md', renderMarkdown(n.body, { go: ctx.go })),
        h('section.card.nst-ask', h('h3', icon('spark', 16), ' ', t('Ask the AI about these notes')), h('div.nst-send', askIn, h('button.btn.primary', { onClick: ask }, icon('send', 15))), h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, [t('Explain the hardest part simply'), t('Give me 3 exam-style questions'), t('Make a mnemonic to remember it')].map((q2) => h('button.btn.sm', { onClick: () => { askIn.value = q2; ask(); } }, q2))))));
    }
    async function editNote(n) {
      const title = h('input.input', { value: n ? n.title : '', maxlength: 120, placeholder: t('E.g. Cell division: mitosis and meiosis') });
      const sj = subjSelect(n ? n.subject : ls('st.subj') || 'math'); const lv = levelSelect(n ? n.level : ls('st.level') || 'eso3');
      const tags = h('input.input', { value: n ? (n.tags || []).join(', ') : '', placeholder: t('Tags, separated by commas') });
      const area = h('textarea.input.nst-editor', { rows: 14, placeholder: t('Write in Markdown: # titles, **bold**, - lists, tables, $formulas$…') }, n ? n.body : '');
      const prev = h('div.nst-md.nst-prev'); const paintPrev = () => mount(prev, renderMarkdown(area.value || '*' + t('Preview') + '*'));
      area.oninput = debounce(paintPrev, 250); if (n) area.value = n.body; paintPrev();
      const aiB = h('button.btn.sm', { onClick: async () => { if (!title.value.trim()) return toast(t('Write a title first'), 'info'); aiB.disabled = true; try { const txt = await novaOnce(`${es() ? 'Escribe en español unos apuntes de estudio claros y completos en Markdown' : 'Write clear, complete study notes in Markdown'} (${sName(sj.value)}, ${L(LEVELS[lv.value] || LEVELS.other)}) ${es() ? 'sobre' : 'about'}: "${title.value.trim()}". ${es() ? 'Usa títulos, listas, ejemplos y un resumen final. Solo los apuntes.' : 'Use headings, lists, examples and a final summary. Only the notes.'}`); area.value = txt; paintPrev(); } catch (e) { toast(e.busy ? t('The AI is busy, try again in a moment') : e.message, 'err'); } aiB.disabled = false; } }, icon('spark', 14), t('Draft with AI'));
      // 13.8: add pictures (photos of the board, diagrams, scans): uploaded to Nebulix and inserted where the cursor is
      const picIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true, onChange: async () => { const f = picIn.files[0]; picIn.value = ''; if (!f) return; picB.disabled = true; try { const r = await api.upload('chat', f); const md = '\n![' + (f.name || '').replace(/\.[^.]+$/, '').replace(/[\[\]]/g, '').slice(0, 60) + '](' + r.url + ')\n'; const at = area.selectionStart || area.value.length; area.value = area.value.slice(0, at) + md + area.value.slice(at); paintPrev(); toast(t('Picture added'), 'good'); } catch (e) { toastErr(e); } picB.disabled = false; } });
      const picB = h('button.btn.sm', { onClick: () => picIn.click() }, icon('image', 14), t('Add picture'));
      const ok = await modal({ title: n ? t('Edit notes') : t('Write notes'), cls: 'wide nst-noteform', body: h('div.col', { style: 'gap:8px' }, h('label.small', t('Title')), title, h('div.row', { style: 'gap:8px' }, h('label.col.grow.small', t('Subject'), sj), h('label.col.grow.small', t('Year'), lv)), tags, h('div.row', { style: 'justify-content:space-between;align-items:center' }, h('label.small', t('Content')), h('div.row', { style: 'gap:6px' }, picB, aiB, picIn)), h('div.nst-split', area, prev), h('p.tiny.muted', t('Share your own notes. Others can read, like and save them. Publishing gives you coins (up to 120 a day while studying).'))), actions: [{ label: t('Cancel'), value: false }, { label: n ? t('Save') : t('Publish'), value: true, kind: 'primary' }] });
      if (ok !== true) return;
      try { const body = { title: title.value, subject: sj.value, level: lv.value, tags: tags.value, body: area.value }; const r = n ? await api.put('/api/study/notes/' + n.id, body) : await api.post('/api/study/notes', body); ls('st.subj', sj.value); ls('st.level', lv.value); toast(n ? t('Saved') : t('Notes published'), 'good'); go('notes', r.note.id); } catch (e) { toastErr(e); }
    }
    async function aiFromNote(n, kind) {
      const lang = es() ? 'en español' : 'in English';
      if (kind === 'summary') { const out = h('div.nst-md', loading()); modal({ title: t('Summary'), cls: 'wide', body: out, actions: [{ label: t('Close') }] }); let txt = ''; try { await askNova({ messages: [{ role: 'user', content: `${es() ? 'Resume' : 'Summarise'} ${lang} ${es() ? 'estos apuntes en puntos clave para repasar antes del examen' : 'these notes into key points to revise before the exam'}:\n\n${n.body.slice(0, 12000)}` }], onText: (d) => { txt += d; mount(out, renderMarkdown(txt, { done: false })); } }); mount(out, renderMarkdown(txt)); } catch (e) { mount(out, h('span.error', t('The AI is busy, try again in a moment'))); } return; }
      const pr = kind === 'cards'
        ? `${es() ? 'Crea' : 'Create'} 12 ${es() ? 'tarjetas de estudio' : 'flashcards'} ${lang} ${es() ? 'a partir de estos apuntes' : 'from these notes'}. ${es() ? 'Responde SOLO con un array JSON' : 'Reply ONLY with a JSON array'} [{"q":"…","a":"…"}], ${es() ? 'preguntas cortas y respuestas concretas' : 'short questions and precise answers'}.\n\n${n.body.slice(0, 10000)}`
        : `${es() ? 'Crea' : 'Create'} 8 ${es() ? 'preguntas tipo test' : 'multiple-choice questions'} ${lang} ${es() ? 'sobre estos apuntes' : 'about these notes'}. ${es() ? 'Responde SOLO con un array JSON' : 'Reply ONLY with a JSON array'} [{"q":"…","opts":["…","…","…","…"],"ok":0}] (${es() ? '"ok" es el índice de la correcta' : '"ok" is the index of the right one'}).\n\n${n.body.slice(0, 10000)}`;
      const m = modal({ title: kind === 'cards' ? t('Flashcards with AI') : t('Quiz with AI'), body: h('div', loading(), h('p.tiny.muted', t('The AI is reading the notes…'))), actions: [{ label: t('Close') }] });
      let arr = null; for (let tries = 0; tries < 2 && !arr; tries++) { try { arr = jsonArray(await novaOnce(pr)); } catch (e) { if (!e.busy) break; } }
      m.close(); if (!arr || !arr.length) return toast(t('The AI could not make it now. Try again in a moment.'), 'err');
      if (kind === 'cards') { const cards = arr.map((c) => ({ q: String(c.q || '').slice(0, 500), a: String(c.a || '').slice(0, 1000) })).filter((c) => c.q && c.a); return editDeck({ title: n.title, subject: n.subject, level: n.level, cards, public: false }); }
      const qs = arr.map((x) => ({ q: String(x.q || ''), opts: (x.opts || []).map(String).slice(0, 4), ok: Math.trunc(Number(x.ok)) })).filter((x) => x.q && x.opts.length >= 2 && x.ok >= 0 && x.ok < x.opts.length);
      if (!qs.length) return toast(t('The AI could not make it now. Try again in a moment.'), 'err');
      runQuiz(n.title, qs);
    }
    // 13.8: AI everywhere in Study — one streaming answer in a modal
    async function aiModal(title, prompt) {
      const out = h('div.nst-md', loading()); modal({ title, cls: 'wide', body: out, actions: [{ label: t('Close') }] }); let txt = '';
      try { await askNova({ messages: [{ role: 'user', content: prompt }], onText: (d) => { txt += d; mount(out, renderMarkdown(txt, { done: false })); } }); mount(out, renderMarkdown(txt || t('The AI is busy, try again in a moment'))); }
      catch { mount(out, h('span.error', t('The AI is busy, try again in a moment'))); }
    }
    const lng = () => (es() ? 'Responde en español.' : 'Answer in English.');
    // a multiple-choice quiz in a modal (AI quizzes and deck tests)
    function runQuiz(title, qs) {
      let i = 0, right = 0; const wrong = []; const bodyEl = h('div.nst-quiz'); const m = modal({ title: title, cls: 'wide', body: bodyEl, actions: [{ label: t('Close') }] });
      const paint = () => {
        if (i >= qs.length) { const pct = Math.round((right / qs.length) * 100); api.post('/api/study/test', { score: pct }).then((r) => r.coins && toast(t('+{n} coins for studying', { n: r.coins }), 'good')).catch(() => {}); snd(pct >= 50 ? 'win' : 'lose');
          return mount(bodyEl, h('div.nst-qend', h('div.nst-big', pct + '%'), h('p', t('{a} of {b} right', { a: right, b: qs.length })), wrong.length ? h('div', h('b', t('To review')), wrong.map((w) => h('div.nst-wrong', h('span', w.q), h('b', '→ ' + w.opts[w.ok])))) : h('p', t('Perfect!')))); }
        const q = qs[i]; mount(bodyEl, h('div.nst-qhead', h('span.tiny.muted', `${i + 1} / ${qs.length}`), h('div.nst-qbar', h('i', { style: { width: (i / qs.length) * 100 + '%' } }))), h('h3', q.q),
          h('div.nst-opts', q.opts.map((o, k) => h('button.nst-opt', { onClick: (e) => { const ok = k === q.ok; if (ok) right++; else wrong.push(q); snd(ok ? 'coin' : 'lose'); [...e.currentTarget.parentNode.children].forEach((b, j) => { b.disabled = true; if (j === q.ok) b.classList.add('ok'); }); if (!ok) e.currentTarget.classList.add('bad'); setTimeout(() => { i++; paint(); }, ok ? 650 : 1400); } }, h('i', 'ABCD'[k]), o))));
      };
      paint(); return m;
    }

    // ================= flashcards =================
    async function cardsTab(box, sub) {
      if (sub) return studyDeck(box, sub);
      const q = { subject: '', q: '', sort: 'new', mine: '1' };
      const search = h('input.input', { placeholder: t('Search decks…'), onInput: debounce(() => { q.q = search.value; load(); }, 300) });
      const sj = subjSelect('', true); sj.onchange = () => { q.subject = sj.value; load(); };
      const filt = h('div.nst-seg', [['mine', t('My decks')], ['all', t('Community')], ['top', t('Most used')]].map(([k, n]) => h('button' + (k === 'mine' ? '.on' : ''), { onClick: (e) => { [...filt.children].forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); q.mine = k === 'mine' ? '1' : ''; q.sort = k === 'top' ? 'top' : 'new'; load(); } }, n)));
      const list = h('div.nst-decks');
      mount(box, h('div.nst-bar', search, sj, h('button.btn.primary', { onClick: () => editDeck() }, icon('plus', 15), t('New deck'))), filt, list);
      async function load() { mount(list, loading()); try { const r = await api.get('/api/study/decks?' + new URLSearchParams(q)); mount(list, r.decks.length ? r.decks.map((d) => h('button.nst-deck', { onClick: () => go('cards', d.id) }, h('div.row', { style: 'gap:6px' }, chip(d.subject), d.public ? null : h('span.tiny.muted', icon('lock', 11), ' ' + t('Private'))), h('b', d.title), h('span.small.muted', t('{n} cards', { n: d.count }) + (d.author ? ' · @' + d.author.username : '')), d.due ? h('span.pill.nst-due', t('{n} due', { n: d.due })) : h('span.tiny.muted', t('All reviewed')))) : h('div.empty', h('h3', t('No decks yet')), h('p.muted', t('Create one, or generate it with AI from any notes.')))); } catch (e) { mount(list, h('span.error', e.message)); } }
      load();
    }
    async function editDeck(d) {
      const title = h('input.input', { value: d ? d.title : '', maxlength: 100, placeholder: t('E.g. English irregular verbs') });
      const sj = subjSelect(d ? d.subject : 'english'); const lv = levelSelect(d ? d.level : ls('st.level') || 'eso3'); const pub = h('input', { type: 'checkbox', checked: d ? d.public !== false : true });
      let cards = d && d.cards ? d.cards.map((c) => Object.assign({}, c)) : [{ q: '', a: '' }, { q: '', a: '' }, { q: '', a: '' }];
      const rows = h('div.nst-cardrows'); const paint = () => mount(rows, cards.map((c, i) => h('div.nst-cardrow', h('span.tiny.muted', String(i + 1)), h('input.input', { value: c.q, placeholder: t('Question / term'), onInput: (e) => { c.q = e.target.value; } }), h('input.input', { value: c.a, placeholder: t('Answer / definition'), onInput: (e) => { c.a = e.target.value; } }), h('button.btn.sm.ghost', { onClick: () => { cards.splice(i, 1); paint(); } }, icon('x', 13)))));
      paint();
      const bulk = h('textarea.input', { rows: 3, placeholder: t('Paste many at once: one per line, “question ; answer” (or a tab between them)') });
      const addBulk = () => { const add = bulk.value.split('\n').map((l) => l.split(/\t|;| - | — /)).filter((p) => p.length >= 2).map((p) => ({ q: p[0].trim(), a: p.slice(1).join(' ').trim() })); if (add.length) { cards = cards.filter((c) => c.q || c.a).concat(add); bulk.value = ''; paint(); toast(t('{n} cards added', { n: add.length }), 'good'); } };
      const aiB = h('button.btn.sm', { onClick: async () => { if (!title.value.trim()) return toast(t('Write a title first'), 'info'); aiB.disabled = true; try { const arr = jsonArray(await novaOnce(`${es() ? 'Crea 15 tarjetas de estudio en español' : 'Create 15 flashcards in English'} (${sName(sj.value)}, ${L(LEVELS[lv.value] || LEVELS.other)}) ${es() ? 'sobre' : 'about'}: "${title.value.trim()}". ${es() ? 'Responde SOLO con un array JSON' : 'Reply ONLY with a JSON array'} [{"q":"…","a":"…"}].`)); if (!arr) throw new Error(t('The AI could not make it now. Try again in a moment.')); cards = cards.filter((c) => c.q || c.a).concat(arr.map((c) => ({ q: String(c.q || ''), a: String(c.a || '') })).filter((c) => c.q && c.a)); paint(); } catch (e) { toast(e.busy ? t('The AI is busy, try again in a moment') : e.message, 'err'); } aiB.disabled = false; } }, icon('spark', 14), t('Fill with AI'));
      const ok = await modal({ title: d && d.id ? t('Edit deck') : t('New deck'), cls: 'wide', body: h('div.col', { style: 'gap:8px' }, h('label.small', t('Title')), title, h('div.row', { style: 'gap:8px' }, h('label.col.grow.small', t('Subject'), sj), h('label.col.grow.small', t('Year'), lv)), h('label.row.small', { style: 'gap:8px' }, pub, t('Public: others can find and practise it')),
        h('div.row', { style: 'justify-content:space-between;align-items:center' }, h('b.small', t('Cards')), aiB), rows, h('button.btn.sm', { onClick: () => { cards.push({ q: '', a: '' }); paint(); } }, icon('plus', 13), t('Add card')), bulk, h('button.btn.sm', { onClick: addBulk }, t('Add pasted cards'))),
        actions: [{ label: t('Cancel'), value: false }, { label: t('Save'), value: true, kind: 'primary' }] });
      if (ok !== true) return;
      try { const b = { title: title.value, subject: sj.value, level: lv.value, public: pub.checked, cards: cards.filter((c) => c.q.trim() && c.a.trim()) }; const r = d && d.id ? await api.put('/api/study/decks/' + d.id, b) : await api.post('/api/study/decks', b); toast(t('Deck saved'), 'good'); go('cards', r.deck.id); } catch (e) { toastErr(e); }
    }
    async function studyDeck(box, id) {
      let r; try { r = await api.get('/api/study/decks/' + encodeURIComponent(id)); } catch (e) { mount(box, h('span.error', e.message)); return; }
      const d = r.deck; let prog = r.progress || {}; let mode = 'review';
      const stage = h('div.nst-stage'); const modes = h('div.nst-seg');
      const paintModes = () => mount(modes, [['review', t('Review (spaced)')], ['learn', t('All cards')], ['test', t('Test')], ['write', t('Write')]].map(([k, n]) => h('button' + (k === mode ? '.on' : ''), { onClick: () => { mode = k; paintModes(); start(); } }, n)));
      mount(box, h('div.nst-deckhead', h('button.btn.sm.ghost', { onClick: () => go('cards') }, icon('back', 14), t('Flashcards')), chip(d.subject), h('h2.grow', d.title), h('span.tiny.muted', t('{n} cards', { n: d.count })),
        d.mine ? h('button.btn.sm', { onClick: () => editDeck(d) }, icon('edit', 14), t('Edit')) : h('button.btn.sm', { onClick: async () => { try { const s = await api.post('/api/study/save', { kind: 'deck', id: d.id }); toast(s.saved ? t('Saved to My decks') : t('Removed from My decks'), 'good'); } catch (e) { toastErr(e); } } }, icon('bookmark', 14), t('Save')),
        h('button.btn.sm', { onClick: () => go('live', 'host:' + d.id) }, icon('users', 14), t('Play in class')),
        d.mine ? h('button.btn.sm.ghost', { onClick: async () => { if (await confirmBox(t('Delete this deck?'), { danger: true })) { try { await api.del('/api/study/decks/' + d.id); go('cards'); } catch (e) { toastErr(e); } } } }, icon('trash', 14)) : null), modes, stage);
      paintModes();
      const dueList = () => d.cards.map((c, i) => i).filter((i) => !prog[i] || prog[i].due <= Date.now());
      function start() { if (mode === 'review') review(dueList()); else if (mode === 'learn') review(shuffle(d.cards.map((c, i) => i)), true); else if (mode === 'test') testMode(); else writeMode(); }
      function review(order, free) {
        let k = 0; let flipped = false;
        const paint = () => {
          if (k >= order.length) return mount(stage, h('div.nst-done', icon('check', 30), h('h3', free ? t('You went through every card') : t('All caught up!')), h('p.muted', free ? '' : t('Come back later: cards return right before you would forget them.')), h('button.btn', { onClick: () => { mode = 'learn'; paintModes(); start(); } }, t('Practise all again'))));
          const c = d.cards[order[k]];
          const card = h('button.nst-flash' + (flipped ? '.flip' : ''), { onClick: () => { flipped = !flipped; paint(); } }, h('div.nst-face.front', h('span.tiny.muted', t('Question')), h('div', c.q)), h('div.nst-face.back', h('span.tiny.muted', t('Answer')), h('div', c.a)));
          const grade = async (g) => { if (!free) { try { const res = await api.post(`/api/study/decks/${d.id}/review`, { i: order[k], grade: g }); prog[order[k]] = res.card; } catch (e) { toastErr(e); } } if (g === 0 && !free) order.push(order[k]); k++; flipped = false; snd('tick'); paint(); };
          mount(stage, h('div.nst-prog', h('i', { style: { width: (k / order.length) * 100 + '%' } })), h('div.tiny.muted', `${k + 1} / ${order.length}` + (free ? '' : ' · ' + t('due today'))), card,
            flipped ? h('div.nst-grades', [[0, t('Again'), 'bad'], [1, t('Hard'), 'warn'], [2, t('Good'), 'ok'], [3, t('Easy'), 'easy']].map(([g, n, c]) => h('button.nst-g.' + c, { onClick: () => grade(g) }, n, h('span.tiny', ['1', '2', '3', '4'][g])))) : h('button.btn.primary', { onClick: () => { flipped = true; paint(); } }, t('Show answer') + ' (Space)'));
        };
        stage.onkeydown = null; paint();
        keyH = (e) => { if (!stage.isConnected || e.target.closest('input,textarea,select')) return; if (e.key === ' ') { e.preventDefault(); if (!flipped) { flipped = true; paint(); } } else if (flipped && /^[1-4]$/.test(e.key)) { stage.querySelectorAll('.nst-g')[Number(e.key) - 1].click(); } };
      }
      function testMode() { const qs = shuffle(d.cards.slice()).slice(0, 15).map((c) => { const wrong = shuffle([...new Set(d.cards.map((x) => x.a).filter((a) => a !== c.a))]).slice(0, 3); const opts = shuffle([c.a].concat(wrong)); return { q: c.q, opts, ok: opts.indexOf(c.a) }; }); if (d.cards.length < 4) return mount(stage, h('p.muted', t('A test needs at least 4 cards.'))); mount(stage, h('div.nst-done', h('p', t('15 questions with 4 options, made from this deck.')), h('button.btn.primary', { onClick: () => runQuiz(d.title, qs) }, t('Start test')))); }
      function writeMode() {
        const order = shuffle(d.cards.map((c, i) => i)).slice(0, 20); let k = 0, right = 0;
        const paint = () => {
          if (k >= order.length) { const pct = Math.round((right / order.length) * 100); api.post('/api/study/test', { score: pct }).catch(() => {}); return mount(stage, h('div.nst-done', h('div.nst-big', pct + '%'), h('p', t('{a} of {b} right', { a: right, b: order.length })), h('button.btn', { onClick: writeMode }, t('Again')))); }
          const c = d.cards[order[k]]; const inp = h('input.input.nst-write', { placeholder: t('Type the answer and press Enter'), onKeydown: (e) => { if (e.key === 'Enter') check(); } }); const fb = h('div.nst-fb');
          const check = () => { if (fb.dataset.done) { k++; return paint(); } const a = norm(inp.value), b = norm(c.a); const ok = a && (a === b || (b.length > 8 && (b.includes(a) && a.length >= b.length * 0.6))); if (ok) right++; fb.dataset.done = '1'; fb.className = 'nst-fb ' + (ok ? 'ok' : 'bad'); mount(fb, ok ? t('Correct!') : [t('Answer: '), h('b', c.a)], h('span.tiny.muted', ' · Enter →')); snd(ok ? 'coin' : 'lose'); };
          mount(stage, h('div.nst-prog', h('i', { style: { width: (k / order.length) * 100 + '%' } })), h('div.nst-flash.static', h('div.nst-face.front', h('div', c.q))), inp, fb, h('button.btn.primary', { onClick: check }, t('Check'))); inp.focus();
        };
        paint();
      }
      start();
      return () => { keyH = null; };
    }
    let keyH = null; const onKey = (e) => keyH && keyH(e); document.addEventListener('keydown', onKey);

    // ================= AI tutor =================
    async function tutorTab(box) {
      const hist = ls('st.tutor') || []; let busy = false; let subjNow = ls('st.subj') || 'math'; let style = ls('st.tstyle') || 'guide';
      const log = h('div.nst-chat'); const inp = h('textarea.input', { rows: 2, placeholder: t('Ask anything: an exercise, a concept, “quiz me on…”'), onKeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } } });
      const sj = subjSelect(subjNow); sj.onchange = () => { subjNow = sj.value; ls('st.subj', subjNow); };
      const sty = h('select.input', { onChange: (e) => { style = e.target.value; ls('st.tstyle', style); } }, [['guide', t('Guide me step by step')], ['explain', t('Explain it clearly')], ['quiz', t('Quiz me')], ['check', t('Check my answer')]].map(([k, n]) => h('option', { value: k, selected: k === style }, n)));
      const paint = () => { mount(log, hist.length ? hist.map((m) => h('div.nst-msg.' + m.role, m.role === 'assistant' ? renderMarkdown(m.content) : h('div', m.content))) : h('div.nst-tintro', icon('spark', 28), h('h3', t('Your AI tutor')), h('p.muted', t('It helps you understand, not just copy: it asks you questions, explains step by step and checks your answers.')), h('div.nst-sugs', [t('Explain photosynthesis simply'), t('Help me solve 2x + 5 = 17 step by step'), t('Quiz me on the French Revolution'), t('Difference between past simple and present perfect')].map((s) => h('button.btn.sm', { onClick: () => { inp.value = s; send(); } }, s))))); log.scrollTop = log.scrollHeight; };
      const PROMPT = { guide: es() ? 'Eres un tutor paciente. No des la solución final directamente: guía con preguntas cortas y pistas, un paso cada vez, y comprueba que el alumno lo entiende.' : 'You are a patient tutor. Do not give the final solution straight away: guide with short questions and hints, one step at a time, and check the student understands.', explain: es() ? 'Eres un profesor claro. Explica con palabras sencillas, ejemplos y un resumen final de 3 puntos.' : 'You are a clear teacher. Explain in simple words, with examples and a 3-point summary at the end.', quiz: es() ? 'Eres un examinador amable. Haz una pregunta cada vez sobre el tema, espera la respuesta, corrígela y pon nota al final.' : 'You are a friendly examiner. Ask one question at a time on the topic, wait for the answer, correct it and give a mark at the end.', check: es() ? 'Corrige la respuesta del alumno: di qué está bien, qué está mal y por qué, y cómo mejorarla.' : 'Mark the student\'s answer: what is right, what is wrong and why, and how to improve it.' };
      async function send() {
        const text = inp.value.trim(); if (!text || busy) return; busy = true; inp.value = ''; hist.push({ role: 'user', content: text }); const a = { role: 'assistant', content: '' }; hist.push(a); paint();
        const sys = `[${es() ? 'Modo tutor de Nebulix Estudio' : 'Nebulix Study tutor mode'} · ${sName(subjNow)}] ${PROMPT[style]} ${es() ? 'Responde en español.' : 'Answer in English.'}`;
        const msgs = hist.slice(-13, -1).map((m, i) => ({ role: m.role, content: i === 0 && m.role === 'user' ? sys + '\n\n' + m.content : m.content })); if (msgs[0] && msgs[0].role !== 'user') msgs.shift(); if (msgs.length && !msgs[0].content.startsWith('[')) msgs[0] = { role: 'user', content: sys + '\n\n' + msgs[0].content };
        const last = log.lastChild;
        try { await askNova({ messages: msgs, mode: 'chat', onText: (dlt) => { a.content += dlt; if (last) mount(last, renderMarkdown(a.content, { done: false })); log.scrollTop = log.scrollHeight; } }); } catch (e) { a.content = a.content || t('The AI is busy, try again in a moment'); }
        busy = false; ls('st.tutor', hist.slice(-40)); paint();
      }
      mount(box, h('div.nst-tutor', h('div.nst-bar', sj, sty, h('button.btn.sm.ghost', { onClick: () => { hist.length = 0; ls('st.tutor', []); paint(); } }, icon('trash', 14), t('New chat'))), log, h('div.nst-send', inp, h('button.btn.primary', { onClick: send }, icon('send', 16))), h('p.tiny.muted', t('Uses the Nebulix AI. Check important facts with your teacher or textbook.'))));
      paint();
    }

    // ================= live class =================
    async function liveTab(box, sub) {
      const offs = []; const on = (k, fn) => offs.push(bus.on('ws:' + k, fn)); let room = null; let state = {}; let timer = 0;
      const stage = h('div.nst-live');
      const pinIn = h('input.input.nst-pin', { inputmode: 'numeric', maxlength: 6, placeholder: '123456', onKeydown: (e) => { if (e.key === 'Enter') join(); } });
      const join = () => { const p = pinIn.value.replace(/\D/g, ''); if (p.length !== 6) return toast(t('The PIN has 6 digits'), 'info'); ws.send({ t: 'st_join', pin: p }); };
      async function lobby() {
        let decks = []; try { decks = (await api.get('/api/study/decks?mine=1')).decks.filter((d) => d.count >= 4); } catch {}
        const dk = h('select.input', decks.map((d) => h('option', { value: d.id }, d.title + ' (' + d.count + ')'))); const n = h('input.input', { type: 'number', min: 3, max: 30, value: 10, style: 'width:90px' });
        mount(stage, h('div.nst-livegrid',
          h('section.card.nst-joincard', h('h3', icon('users', 18), ' ', t('Join a game')), h('p.small.muted', t('Type the PIN your teacher or friend shows on screen.')), pinIn, h('button.btn.primary', { onClick: join }, t('Join'))),
          h('section.card', h('h3', icon('monitor', 18), ' ', t('Host a game')), h('p.small.muted', t('Pick a deck (4+ cards). Everyone answers on their own device; faster right answers score more.')), decks.length ? [dk, h('label.row.small', { style: 'gap:8px;align-items:center' }, t('Questions'), n), h('button.btn.primary', { onClick: () => ws.send({ t: 'st_host', deck: dk.value, n: Number(n.value) }) }, icon('play', 15), t('Create game'))] : h('p.muted', t('You need a deck with at least 4 cards. Create one in Flashcards.')))));
      }
      const optCol = ['#e11d48', '#2563eb', '#ca8a04', '#16a34a'];
      on('st_err', (m) => toast(m.text, 'err'));
      on('st_room', (m) => { room = m; state = { players: m.players || [] }; paintRoom(); });
      on('st_players', (m) => { state.players = m.players; paintRoom(); });
      on('st_q', (m) => { state.q = m; state.answered = null; state.count = 0; clearInterval(timer); timer = setInterval(() => { const el = stage.querySelector('.nst-timer'); if (el) el.textContent = Math.max(0, Math.ceil((m.until - Date.now()) / 1000)); }, 250); paintQ(); snd('tick'); });
      on('st_got', () => { state.answered = true; paintQ(); });
      on('st_count', (m) => { state.count = m.n; state.of = m.of; const el = stage.querySelector('.nst-count'); if (el) el.textContent = `${m.n} / ${m.of} ${t('answered')}`; });
      on('st_reveal', (m) => { clearInterval(timer); state.rev = m; paintReveal(); if (!room.host) snd(m.right ? 'win' : 'lose'); });
      on('st_end', (m) => { clearInterval(timer); paintEnd(m.board); });
      on('st_closed', () => { room = null; toast(t('The game has ended'), 'info'); lobby(); });
      function paintRoom() { if (!room) return; mount(stage, h('div.nst-room', h('div.nst-roomhead', h('span.tiny.muted', t('Game PIN')), h('div.nst-bigpin', room.pin), h('b', room.title)), room.host ? [h('p.muted', t('Players join at Nebulix → Study → Live class with this PIN.')), h('div.nst-players', (state.players || []).map((p) => h('span.pill', p))), h('div.row', { style: 'gap:8px;justify-content:center' }, h('button.btn.primary', { disabled: !(state.players || []).length, onClick: () => ws.send({ t: 'st_start' }) }, icon('play', 15), t('Start') + ` (${(state.players || []).length})`), h('button.btn.ghost', { onClick: () => ws.send({ t: 'st_close' }) }, t('Close game')))] : h('p', t('You are in! Waiting for the host to start…')))); }
      function paintQ() { const q = state.q; mount(stage, h('div.nst-q', h('div.row', { style: 'justify-content:space-between' }, h('span.tiny.muted', `${q.i + 1} / ${q.n}`), h('b.nst-timer', Math.ceil((q.until - Date.now()) / 1000))), h('h2', q.q), room.host ? [h('div.nst-liveopts', q.opts.map((o, k) => h('div.nst-lopt', { style: { background: optCol[k] } }, h('i', '▲◆●■'[k]), o))), h('div.row', { style: 'justify-content:space-between' }, h('span.nst-count', `${state.count || 0} ${t('answered')}`), h('button.btn', { onClick: () => ws.send({ t: 'st_skip' }) }, t('Show answer')))]
        : state.answered ? h('div.nst-wait', icon('check', 26), h('p', t('Answer sent! Wait for the others…'))) : h('div.nst-liveopts', q.opts.map((o, k) => h('button.nst-lopt', { style: { background: optCol[k] }, onClick: () => ws.send({ t: 'st_answer', opt: k }) }, h('i', '▲◆●■'[k]), o))))); }
      function paintReveal() { const m = state.rev; const q = state.q; mount(stage, h('div.nst-q', h('h2', q.q), h('div.nst-liveopts', q.opts.map((o, k) => h('div.nst-lopt' + (k === m.ok ? '.ok' : '.dim'), { style: { background: optCol[k] } }, h('i', '▲◆●■'[k]), o, h('span.nst-cnt', String(m.counts[k] || 0))))),
        room.host ? null : h('div.nst-you' + (m.right ? '.ok' : '.bad'), m.right ? t('Correct!') : m.you === null ? t('Time is up') : t('Not this time'), h('span', ` · ${fmt.num(m.score)} ${t('points')} · #${m.rank}`)),
        h('div.nst-board', (m.board || []).map((p, i) => h('div', h('b', '#' + (i + 1)), h('span.grow', p.name), h('b', fmt.num(p.score))))), room.host ? h('button.btn.primary', { onClick: () => ws.send({ t: 'st_next' }) }, q.i + 1 >= q.n ? t('See the podium') : t('Next question')) : null)); }
      function paintEnd(b) { mount(stage, h('div.nst-end', h('h2', t('Podium')), h('div.nst-podium', [1, 0, 2].map((i) => b[i] ? h('div.nst-pod.p' + (i + 1), h('b', b[i].name), h('span', fmt.num(b[i].score)), h('div.nst-podbar', '#' + (i + 1))) : null)), h('div.nst-board', b.slice(3, 20).map((p, i) => h('div', h('b', '#' + (i + 4)), h('span.grow', p.name), h('b', fmt.num(p.score))))), h('p.tiny.muted', t('The top 3 get coins.')), h('button.btn', { onClick: () => { room = null; lobby(); } }, t('Back')))); }
      mount(box, stage);
      let hosting = null; try { hosting = (await api.get('/api/study/live')).hosting; } catch {}
      if (hosting) ws.send({ t: 'st_rehost' }); else if (sub && sub.startsWith('host:')) { lobby(); ws.send({ t: 'st_host', deck: sub.slice(5), n: 10 }); } else lobby();
      const pq = new URLSearchParams(location.hash.split('?')[1] || '').get('pin'); if (pq) { pinIn.value = pq; join(); }
      return () => { clearInterval(timer); offs.forEach((f) => f()); };
    }

    // ================= grades =================
    async function gradesTab(box) {
      let grades = (info.grades || []).slice(); const save = debounce(async () => { try { grades = (await api.put('/api/study/grades', { grades })).grades; } catch (e) { toastErr(e); } }, 600);
      const wrap = h('div');
      function paint() {
        const bySub = {}; for (const g of grades) (bySub[g.subject] = bySub[g.subject] || []).push(g); const all = overall(grades);
        mount(wrap, h('div.nst-kpis', kpi('chart', t('Overall average'), all === null ? '—' : all.toFixed(2)), kpi('book', t('Subjects'), String(Object.keys(bySub).length)), kpi('check', t('Passed subjects'), String(Object.values(bySub).filter((l) => avgOf(l) >= 5).length))),
          h('div.nst-bar', h('button.btn.primary', { onClick: add }, icon('plus', 15), t('Add grade')), h('button.btn', { onClick: need }, icon('target', 15), t('What do I need?')), grades.length ? h('button.btn', { onClick: () => { const bySub2 = {}; for (const g of grades) (bySub2[sName(g.subject)] = bySub2[sName(g.subject)] || []).push(((g.score / g.max) * 10).toFixed(1) + ' (×' + g.weight + ')'); aiModal(t('AI advice on your grades'), `${lng()} ${es() ? 'Eres un orientador escolar. Analiza estas notas (sobre 10, con su peso), di qué va bien y qué peligra, y da un plan concreto de 2 semanas para subir las más flojas.' : 'You are a school counsellor. Analyse these grades (out of 10, with weight), say what is going well and what is at risk, and give a concrete 2-week plan to raise the weakest.'}\n\n${Object.entries(bySub2).map(([k, v]) => k + ': ' + v.join(', ')).join('\n')}`); } }, icon('spark', 15), t('AI advice')) : null),
          Object.keys(bySub).length ? h('div.nst-subjgrid', Object.entries(bySub).map(([s, l]) => { const a = avgOf(l); return h('section.card.nst-gcard', h('div.row', { style: 'justify-content:space-between;align-items:center' }, chip(s), h('b.nst-avg' + (a >= 5 ? '.ok' : '.bad'), a.toFixed(2))), h('div.nst-gbar', h('i', { style: { width: Math.min(100, a * 10) + '%', background: a >= 5 ? 'var(--ok,#22c55e)' : '#ef4444' } })),
            l.map((g) => h('div.nst-grow', h('span.grow', g.name || t('Grade')), h('span.tiny.muted', '×' + g.weight), h('b', ((g.score / g.max) * 10).toFixed(1)), h('button.btn.sm.ghost', { onClick: () => { grades = grades.filter((x) => x !== g); save(); paint(); } }, icon('x', 12))))); })) : h('div.empty', h('h3', t('No grades yet')), h('p.muted', t('Add your marks to see your averages and what you need to pass or reach a goal.'))));
      }
      async function add() {
        const sj = subjSelect(ls('st.subj') || 'math'); const name = h('input.input', { placeholder: t('E.g. Unit 3 exam') }); const sc = h('input.input', { type: 'number', step: '0.01', value: 7 }); const mx = h('input.input', { type: 'number', step: '0.01', value: 10 }); const w = h('input.input', { type: 'number', step: '0.1', value: 1 });
        const ok = await modal({ title: t('Add grade'), body: h('div.col', { style: 'gap:8px' }, h('label.small', t('Subject')), sj, h('label.small', t('Name')), name, h('div.row', { style: 'gap:8px' }, h('label.col.grow.small', t('Mark'), sc), h('label.col.grow.small', t('Out of'), mx), h('label.col.grow.small', t('Weight'), w)), h('p.tiny.muted', t('Weight: how much it counts. E.g. an exam 3, homework 1.'))), actions: [{ label: t('Cancel'), value: false }, { label: t('Add'), value: true, kind: 'primary' }] });
        if (ok !== true) return; grades.push({ id: Math.random().toString(36).slice(2, 8), subject: sj.value, name: name.value.trim(), score: Number(sc.value), max: Number(mx.value) || 10, weight: Number(w.value) || 1, date: Date.now() }); ls('st.subj', sj.value); save(); paint();
      }
      async function need() {
        const subs = [...new Set(grades.map((g) => g.subject))]; if (!subs.length) return toast(t('Add some grades first'), 'info');
        const sj = h('select.input', subs.map((s) => h('option', { value: s }, sName(s)))); const goal = h('input.input', { type: 'number', step: '0.1', value: 5 }); const w = h('input.input', { type: 'number', step: '0.1', value: 3 }); const out = h('div.nst-need');
        const calc = () => { const l = grades.filter((g) => g.subject === sj.value); const W = l.reduce((a, g) => a + g.weight, 0); const S2 = l.reduce((a, g) => a + (g.score / g.max) * 10 * g.weight, 0); const nw = Number(w.value) || 1; const x = (Number(goal.value) * (W + nw) - S2) / nw;
          mount(out, x <= 0 ? h('b.ok', t('You already have it, even with a 0!')) : x > 10 ? h('b.bad', t('You would need {n} — not possible with one exam', { n: x.toFixed(2) })) : h('div', t('You need at least'), h('div.nst-big', x.toFixed(2)), t('on the next exam'))); };
        [sj, goal, w].forEach((e) => { e.oninput = calc; e.onchange = calc; }); calc();
        modal({ title: t('What do I need?'), body: h('div.col', { style: 'gap:8px' }, h('label.small', t('Subject')), sj, h('div.row', { style: 'gap:8px' }, h('label.col.grow.small', t('Average I want'), goal), h('label.col.grow.small', t('Weight of the next exam'), w)), out), actions: [{ label: t('Close') }] });
      }
      mount(box, wrap); paint();
    }

    // ================= exams =================
    async function examsTab(box) {
      let exams = (info.exams || []).slice(); const save = async () => { try { exams = (await api.put('/api/study/exams', { exams })).exams; } catch (e) { toastErr(e); } };
      const wrap = h('div');
      function paint() {
        const up = exams.filter((e) => !e.done).sort((a, b) => a.date - b.date); const done = exams.filter((e) => e.done);
        mount(wrap, h('div.nst-bar', h('button.btn.primary', { onClick: add }, icon('plus', 15), t('Add exam'))),
          up.length ? h('div.nst-examlist', up.map((e) => { const days = Math.ceil((e.date - Date.now()) / 86400000); return h('section.card.nst-examcard' + (days <= 3 ? '.soon' : ''), chip(e.subject), h('b', e.title), h('div.nst-count', days < 0 ? t('Past') : days === 0 ? t('Today!') : t('In {n} days', { n: days })), h('span.tiny.muted', new Date(e.date).toLocaleDateString()),
            h('div.row', { style: 'gap:6px' }, h('button.btn.sm', { onClick: () => aiModal(t('Study plan: {e}', { e: e.title }), `${lng()} ${es() ? 'Haz un plan de estudio día a día, realista y motivador, para este examen' : 'Make a realistic, motivating day-by-day study plan for this exam'}: "${e.title}" (${sName(e.subject)}). ${es() ? 'Faltan' : 'Days left'}: ${Math.max(1, days)}. ${es() ? 'Cada día: qué repasar, cuánto tiempo y una técnica (tarjetas, test, resumen). Termina con 5 consejos para el día del examen.' : 'Each day: what to review, how long and a technique (flashcards, test, summary). End with 5 tips for exam day.'}`) }, icon('spark', 13), t('Plan with AI')), h('button.btn.sm', { onClick: () => go('tutor') }, icon('spark', 13), t('Revise with AI')), h('button.btn.sm', { onClick: () => { e.done = true; save(); paint(); } }, icon('check', 13), t('Done')), h('button.btn.sm.ghost', { onClick: () => { exams = exams.filter((x) => x !== e); save(); paint(); } }, icon('trash', 13)))); })) : h('div.empty', h('h3', t('No exams coming up')), h('p.muted', t('Add your exams to see a countdown and plan your revision.'))),
          done.length ? h('details', h('summary.small.muted', t('Finished') + ' (' + done.length + ')'), done.map((e) => h('div.nst-exam', chip(e.subject), h('span.grow', e.title), h('button.btn.sm.ghost', { onClick: () => { exams = exams.filter((x) => x !== e); save(); paint(); } }, icon('trash', 12))))) : null);
      }
      async function add() {
        const sj = subjSelect(ls('st.subj') || 'math'); const title = h('input.input', { placeholder: t('E.g. Unit 4: equations') }); const date = h('input.input', { type: 'date', value: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) });
        const ok = await modal({ title: t('Add exam'), body: h('div.col', { style: 'gap:8px' }, h('label.small', t('Subject')), sj, h('label.small', t('Topic')), title, h('label.small', t('Date')), date), actions: [{ label: t('Cancel'), value: false }, { label: t('Add'), value: true, kind: 'primary' }] });
        if (ok !== true || !title.value.trim() || !date.value) return; exams.push({ id: Math.random().toString(36).slice(2, 8), subject: sj.value, title: title.value.trim(), date: new Date(date.value + 'T09:00').getTime() }); save(); paint();
      }
      mount(box, wrap); paint();
    }

    // ================= tools =================
    async function toolsTab(box) {
      // Pomodoro
      let left = 25 * 60, run = null, phase = 'focus', rounds = 0; const tm = h('div.nst-big'); const lab = h('div.muted');
      const paintT = () => { tm.textContent = String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0'); lab.textContent = (phase === 'focus' ? t('Focus') : t('Break')) + ' · ' + t('{n} rounds', { n: rounds }); };
      const tick = () => { left--; if (left <= 0) { snd('win'); if (phase === 'focus') { rounds++; phase = 'break'; left = (rounds % 4 ? 5 : 15) * 60; } else { phase = 'focus'; left = 25 * 60; } try { new Notification('Nebulix', { body: phase === 'focus' ? t('Back to studying!') : t('Take a break') }); } catch {} } paintT(); };
      const startB = h('button.btn.primary', { onClick: () => { if (run) { clearInterval(run); run = null; startB.textContent = t('Start'); } else { run = setInterval(tick, 1000); startB.textContent = t('Pause'); try { Notification.requestPermission && Notification.requestPermission(); } catch {} } } }, t('Start'));
      paintT();
      // scientific calculator (safe: only numbers, operators and Math functions)
      const calcIn = h('input.input', { placeholder: 'sqrt(2) * sin(pi/4) + 3^2', onKeydown: (e) => { if (e.key === 'Enter') calc(); } }); const calcOut = h('div.nst-calcout');
      function calc() { try { const v = evalMath(calcIn.value); calcOut.textContent = '= ' + (Number.isFinite(v) ? Math.round(v * 1e10) / 1e10 : t('Error')); } catch (e) { calcOut.textContent = t('Error') + (e.message ? ': ' + e.message : ''); } }
      // unit converter
      const UNITS = { length: [['m', 1], ['km', 1000], ['cm', 0.01], ['mm', 0.001], ['mi', 1609.344], ['ft', 0.3048], ['in', 0.0254]], mass: [['kg', 1], ['g', 0.001], ['mg', 1e-6], ['t', 1000], ['lb', 0.45359237], ['oz', 0.0283495]], time: [['s', 1], ['min', 60], ['h', 3600], ['day', 86400]], speed: [['m/s', 1], ['km/h', 1 / 3.6], ['mph', 0.44704]] };
      const kind = h('select.input', Object.keys(UNITS).map((k) => h('option', { value: k }, t({ length: 'Distance', mass: 'Mass', time: 'Time', speed: 'Speed' }[k])))); const from = h('select.input'); const to = h('select.input'); const val = h('input.input', { type: 'number', value: 1 }); const res = h('b.nst-calcout');
      const fill = () => { const u = UNITS[kind.value]; mount(from, u.map(([n]) => h('option', { value: n }, n))); mount(to, u.map(([n], i) => h('option', { value: n, selected: i === 1 }, n))); conv(); };
      const conv = () => { const u = UNITS[kind.value]; const a = u.find((x) => x[0] === from.value), b = u.find((x) => x[0] === to.value); if (a && b) res.textContent = '= ' + Math.round((Number(val.value) * a[1]) / b[1] * 1e8) / 1e8 + ' ' + b[0]; };
      kind.onchange = fill; [from, to, val].forEach((e) => { e.oninput = conv; e.onchange = conv; }); fill();
      // formula sheet
      const FORM = [['Maths', 'Matemáticas', '- 2nd degree / 2º grado: **x = (−b ± √(b² − 4ac)) / 2a**\n- Pythagoras / Pitágoras: **a² + b² = c²**\n- Circle / Círculo: área **π·r²**, perímetro **2·π·r**\n- (xⁿ)′ = **n·xⁿ⁻¹** · (sen x)′ = **cos x** · (eˣ)′ = **eˣ**'], ['Physics', 'Física', '- **v = d / t** · MRUA: **v = v₀ + a·t**, **x = x₀ + v₀·t + ½·a·t²**\n- **F = m·a** · Peso **P = m·g** (g ≈ 9,8 m/s²)\n- Ec = **½·m·v²** · Ep = **m·g·h** · W = **F·d·cos α**\n- Ohm: **V = I·R** · P = **V·I**'], ['Chemistry', 'Química', '- Moles: **n = m / M** · Molaridad: **M = n / V(L)**\n- Gases ideales: **P·V = n·R·T** (R = 0,082 atm·L/mol·K)\n- **pH = −log[H⁺]** · pH + pOH = 14 · Nº de Avogadro **6,022·10²³**']];
      // word counter
      const wc = h('textarea.input', { rows: 4, placeholder: t('Paste a text to count words and reading time'), onInput: () => { const w = (wc.value.match(/\S+/g) || []).length; wcOut.textContent = t('{w} words · {c} characters · {m} min reading', { w, c: wc.value.length, m: Math.max(1, Math.round(w / 200)) }); } }); const wcOut = h('div.small.muted');
      mount(box, h('div.nst-tools',
        h('section.card.nst-pomo', h('h3', icon('clock', 16), ' Pomodoro'), tm, lab, h('div.row', { style: 'gap:8px;justify-content:center' }, startB, h('button.btn', { onClick: () => { clearInterval(run); run = null; startB.textContent = t('Start'); phase = 'focus'; left = 25 * 60; paintT(); } }, t('Reset'))), h('p.tiny.muted', t('25 minutes of focus, 5 of rest; every 4 rounds a long break.'))),
        h('section.card', h('h3', icon('hash', 16), ' ', t('Scientific calculator')), calcIn, h('button.btn.sm', { onClick: calc }, '='), calcOut, h('p.tiny.muted', 'sin cos tan sqrt log ln abs pi e ^')),
        h('section.card', h('h3', icon('refresh', 16), ' ', t('Unit converter')), kind, h('div.row', { style: 'gap:6px' }, val, from, to), res),
        h('section.card', h('h3', icon('book', 16), ' ', t('Formula sheet')), FORM.map(([en, esn, md]) => h('details', h('summary', es() ? esn : en), h('div.nst-md', renderMarkdown(md))))),
        h('section.card', h('h3', icon('type', 16), ' ', t('Word counter')), wc, wcOut)));
      return () => clearInterval(run);
    }

    await show(tab, ctx.params[1]);
    return () => { if (off) try { off(); } catch {} document.removeEventListener('keydown', onKey); };
  },
};

function avgOf(l) { const W = l.reduce((a, g) => a + g.weight, 0); return W ? l.reduce((a, g) => a + (g.score / g.max) * 10 * g.weight, 0) / W : 0; }
function overall(grades) { const bySub = {}; for (const g of grades || []) (bySub[g.subject] = bySub[g.subject] || []).push(g); const v = Object.values(bySub).map(avgOf); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
function daysTo(ts) { const d = Math.ceil((ts - Date.now()) / 86400000); return d < 0 ? t('Past') : d === 0 ? t('Today!') : d === 1 ? t('Tomorrow') : t('In {n} days', { n: d }); }
function debounce(fn, ms) { let tm = 0; return (...a) => { clearTimeout(tm); tm = setTimeout(() => fn(...a), ms); }; }

// a small, safe maths parser for the calculator (the page's security policy forbids eval, and it should anyway)
function evalMath(src) {
  const FN = { sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, sqrt: Math.sqrt, cbrt: Math.cbrt, log: Math.log10, log10: Math.log10, log2: Math.log2, ln: Math.log, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, exp: Math.exp };
  const C = { pi: Math.PI, e: Math.E };
  const s = String(src).replace(/,/g, '.').replace(/×/g, '*').replace(/÷/g, '/').replace(/π/g, 'pi').replace(/√/g, 'sqrt'); let i = 0;
  const ws = () => { while (s[i] === ' ') i++; }; const peek = () => (ws(), s[i]); const eat = (c) => { if (peek() === c) { i++; return true; } return false; };
  function expr() { let v = term(); for (;;) { if (eat('+')) v += term(); else if (eat('-')) v -= term(); else return v; } }
  function term() { let v = unary(); for (;;) { if (eat('*')) v *= unary(); else if (eat('/')) v /= unary(); else if (eat('%')) v %= unary(); else return v; } }
  function unary() { if (eat('-')) return -unary(); if (eat('+')) return unary(); return power(); }
  function power() { const b = atom(); return eat('^') ? Math.pow(b, unary()) : b; }
  function atom() {
    ws(); if (eat('(')) { const v = expr(); if (!eat(')')) throw new Error(')'); return v; }
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i)); if (m) { i += m[0].length; return Number(m[0]); }
    const w = /^[a-z][a-z0-9]*/i.exec(s.slice(i)); if (w) { i += w[0].length; const k = w[0].toLowerCase(); if (k in C) return C[k]; if (FN[k]) { if (!eat('(')) throw new Error('('); const v = expr(); if (!eat(')')) throw new Error(')'); return FN[k](v); } throw new Error(k); }
    throw new Error('?');
  }
  const v = expr(); ws(); if (i < s.length) throw new Error(s.slice(i, i + 6)); return v;
}

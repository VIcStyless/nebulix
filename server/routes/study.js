'use strict';
// Nebulix Study API (13.8). See server/study.js.
const st = require('../study');
const { HttpError } = require('../util');

module.exports = function register(r) {
  const A = { auth: true }; const W = (n) => ({ auth: true, verified: true, limit: [n, 60000, 'user'] });
  r.get('/api/study', A, async (c) => { const me = st.mine(c.user); const decks = Object.values(st.DECKS()).filter((d) => d.uid === c.user.id || me.saved.includes('d:' + d.id) || (me.usedDecks || []).includes(d.id)); return { subjects: st.SUBJECTS, levels: st.LEVELS, grades: me.grades, exams: me.exams, earned: me.day ? me.earned : 0, cards: me.cards || 0, due: decks.reduce((a, d) => a + st.dueCount(c.user, d), 0), myDecks: decks.slice(0, 40).map((d) => st.deckView(d, c.user, false)) }; });
  // notes
  r.get('/api/study/notes', A, async (c) => st.listNotes(c.user, c.query));
  r.get('/api/study/notes/:id', A, async (c) => { const n = st.NOTES()[c.params.id]; if (!n || (n.hidden && n.uid !== c.user.id)) throw new HttpError(404, 'gone', 'Notes not found'); if (n.uid !== c.user.id) { n.views = (n.views || 0) + 1; require('../state').S.store.touch('studynotes'); } return { note: st.noteView(n, c.user, true) }; });
  r.post('/api/study/notes', W(20), async (c) => ({ note: st.saveNote(c.user, c.body || {}) }));
  r.put('/api/study/notes/:id', W(40), async (c) => ({ note: st.saveNote(c.user, c.body || {}, c.params.id) }));
  r.delete('/api/study/notes/:id', W(20), async (c) => { const n = st.NOTES()[c.params.id]; if (!n || (n.uid !== c.user.id && !['admin', 'owner', 'mod'].includes(c.user.role))) throw new HttpError(404, 'gone', 'Notes not found'); delete st.NOTES()[c.params.id]; require('../state').S.store.touch('studynotes'); return { ok: true }; });
  r.post('/api/study/notes/:id/like', W(60), async (c) => { const n = st.NOTES()[c.params.id]; if (!n) throw new HttpError(404, 'gone', 'Notes not found'); const i = n.likes.indexOf(c.user.id); if (i >= 0) n.likes.splice(i, 1); else if (n.uid !== c.user.id) n.likes.push(c.user.id); require('../state').S.store.touch('studynotes'); return { likes: n.likes.length, liked: n.likes.includes(c.user.id) }; });
  r.post('/api/study/save', W(60), async (c) => { const k = (c.body.kind === 'deck' ? 'd:' : 'n:') + String(c.body.id || '').slice(0, 12); const me = st.mine(c.user); const i = me.saved.indexOf(k); if (i >= 0) me.saved.splice(i, 1); else me.saved = [k].concat(me.saved).slice(0, 500); require('../state').S.store.touch('users'); return { saved: i < 0 }; });
  r.post('/api/study/report', W(10), async (c) => { st.report(c.user, c.body.kind === 'deck' ? 'deck' : 'note', String(c.body.id || '')); return { ok: true }; });
  // decks
  r.get('/api/study/decks', A, async (c) => st.listDecks(c.user, c.query));
  r.get('/api/study/decks/:id', A, async (c) => { const d = st.DECKS()[c.params.id]; if (!d || (!d.public && d.uid !== c.user.id)) throw new HttpError(404, 'gone', 'Deck not found'); return { deck: st.deckView(d, c.user, true), progress: st.mine(c.user).progress[d.id] || {} }; });
  r.post('/api/study/decks', W(20), async (c) => ({ deck: st.saveDeck(c.user, c.body || {}) }));
  r.put('/api/study/decks/:id', W(40), async (c) => ({ deck: st.saveDeck(c.user, c.body || {}, c.params.id) }));
  r.delete('/api/study/decks/:id', W(20), async (c) => { const d = st.DECKS()[c.params.id]; if (!d || (d.uid !== c.user.id && !['admin', 'owner', 'mod'].includes(c.user.role))) throw new HttpError(404, 'gone', 'Deck not found'); delete st.DECKS()[c.params.id]; require('../state').S.store.touch('studydecks'); return { ok: true }; });
  r.post('/api/study/decks/:id/review', { auth: true, limit: [600, 60000, 'user'] }, async (c) => st.review(c.user, c.params.id, c.body.i, c.body.grade));
  r.post('/api/study/test', W(30), async (c) => { const n = Math.max(0, Math.min(100, Math.trunc(Number(c.body.score) || 0))); return { coins: st.earn(c.user, Math.round(n / 10), 'test') }; });
  // grades & exams
  r.put('/api/study/grades', W(60), async (c) => ({ grades: st.setGrades(c.user, c.body.grades) }));
  r.put('/api/study/exams', W(60), async (c) => ({ exams: st.setExams(c.user, c.body.exams) }));
  // live class: am I hosting a game? (after a reload)
  r.get('/api/study/live', A, async (c) => { const g = [...st.rooms.values()].find((x) => x.host === c.user.id); return { hosting: g ? { pin: g.pin, title: g.title, phase: g.phase, players: [...g.players.values()].map((p) => p.name) } : null }; });
};

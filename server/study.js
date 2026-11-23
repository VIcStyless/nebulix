'use strict';
// Nebulix Study (13.8): a study space for school.
//  · Notes: students share study notes (markdown) by subject and year; like, save, search, report.
//  · Flashcard decks with spaced repetition (SM-2), plus test and writing modes in the browser.
//  · My grades: marks per subject with weights, averages and "what do I need on the next exam".
//  · Exams planner with countdowns.
//  · Live class quizzes: a host opens a room from a deck, players join with a 6-digit PIN, answer against the clock and
//    a leaderboard appears after every question (over the WebSocket, messages that start with st_).
// Studying gives a few coins a day (capped), so it counts like everything else in Nebulix.
const { S, publicUser } = require('./state');
const { HttpError, rid, now, dayKey } = require('./util');

const SUBJECTS = ['math', 'spanish', 'english', 'physics', 'chemistry', 'biology', 'geology', 'history', 'geography', 'philosophy', 'economics', 'tech', 'cs', 'art', 'music', 'pe', 'latin', 'french', 'german', 'catalan', 'valencian', 'basque', 'galician', 'religion', 'other'];
const LEVELS = ['primary', 'eso1', 'eso2', 'eso3', 'eso4', 'bach1', 'bach2', 'fp', 'uni', 'other'];
const NOTES = () => S.store.table('studynotes');
const DECKS = () => S.store.table('studydecks');
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f‪-‮⁦-⁩]/g, '').replace(/\r\n?/g, '\n').slice(0, n);
const subj = (s) => (SUBJECTS.includes(s) ? s : 'other'); const lvl = (s) => (LEVELS.includes(s) ? s : 'other');
const mine = (u) => (u.study = u.study || { progress: {}, grades: [], exams: [], saved: [], day: '', earned: 0, cards: 0 });

// ---------- notes ----------
const noteView = (n, u, full) => ({ id: n.id, title: n.title, subject: n.subject, level: n.level, tags: n.tags, excerpt: n.body.slice(0, 220), body: full ? n.body : undefined, likes: n.likes.length, liked: !!u && n.likes.includes(u.id), saved: !!u && mine(u).saved.includes('n:' + n.id), views: n.views || 0, author: S.users[n.uid] ? publicUser(S.users[n.uid]) : null, mine: !!u && n.uid === u.id, created: n.created, updated: n.updated });
function listNotes(u, q) {
  let list = Object.values(NOTES()).filter((n) => !n.hidden);
  if (q.subject && SUBJECTS.includes(q.subject)) list = list.filter((n) => n.subject === q.subject);
  if (q.level && LEVELS.includes(q.level)) list = list.filter((n) => n.level === q.level);
  if (q.mine === '1') list = list.filter((n) => n.uid === u.id);
  if (q.saved === '1') { const sv = mine(u).saved; list = list.filter((n) => sv.includes('n:' + n.id)); }
  const term = String(q.q || '').toLowerCase().trim().slice(0, 60);
  if (term) list = list.filter((n) => (n.title + ' ' + n.tags.join(' ') + ' ' + n.body.slice(0, 4000)).toLowerCase().includes(term));
  list.sort(q.sort === 'top' ? (a, b) => b.likes.length * 3 + (b.views || 0) - (a.likes.length * 3 + (a.views || 0)) : (a, b) => b.created - a.created);
  return { notes: list.slice(0, 60).map((n) => noteView(n, u, false)), total: list.length };
}
function saveNote(u, b, id) {
  const title = clean(b.title, 120).trim(); const body = clean(b.body, 40000).trim();
  if (title.length < 3) throw new HttpError(400, 'bad_title', 'Give the notes a title');
  if (body.length < 20) throw new HttpError(400, 'bad_body', 'The notes are too short');
  const tags = (Array.isArray(b.tags) ? b.tags : String(b.tags || '').split(',')).map((x) => clean(x, 24).trim().toLowerCase()).filter(Boolean).slice(0, 6);
  if (id) { const n = NOTES()[id]; if (!n || n.uid !== u.id) throw new HttpError(404, 'gone', 'Notes not found'); Object.assign(n, { title, body, tags, subject: subj(b.subject), level: lvl(b.level), updated: now() }); S.store.touch('studynotes'); return noteView(n, u, true); }
  if (Object.values(NOTES()).filter((n) => n.uid === u.id && now() - n.created < 3600000).length >= 10) throw new HttpError(429, 'too_many', 'You have published a lot this hour — try again later');
  const n = { id: rid(10), uid: u.id, title, body, tags, subject: subj(b.subject), level: lvl(b.level), likes: [], views: 0, created: now(), updated: now() };
  NOTES()[n.id] = n; S.store.touch('studynotes'); earn(u, 15, 'notes'); return noteView(n, u, true);
}

// ---------- decks ----------
const deckView = (d, u, full) => ({ id: d.id, title: d.title, subject: d.subject, level: d.level, count: d.cards.length, cards: full ? d.cards : undefined, public: d.public, uses: d.uses || 0, author: S.users[d.uid] ? publicUser(S.users[d.uid]) : null, mine: !!u && d.uid === u.id, saved: !!u && mine(u).saved.includes('d:' + d.id), due: u ? dueCount(u, d) : 0, created: d.created });
function listDecks(u, q) {
  let list = Object.values(DECKS()).filter((d) => !d.hidden && (d.public || d.uid === u.id));
  if (q.subject && SUBJECTS.includes(q.subject)) list = list.filter((d) => d.subject === q.subject);
  if (q.mine === '1') list = list.filter((d) => d.uid === u.id || mine(u).saved.includes('d:' + d.id));
  const term = String(q.q || '').toLowerCase().trim().slice(0, 60);
  if (term) list = list.filter((d) => (d.title + ' ' + d.cards.slice(0, 50).map((c) => c.q).join(' ')).toLowerCase().includes(term));
  list.sort((a, b) => (q.sort === 'top' ? (b.uses || 0) - (a.uses || 0) : b.created - a.created));
  return { decks: list.slice(0, 60).map((d) => deckView(d, u, false)) };
}
function saveDeck(u, b, id) {
  const title = clean(b.title, 100).trim(); if (title.length < 2) throw new HttpError(400, 'bad_title', 'Give the deck a title');
  const cards = (Array.isArray(b.cards) ? b.cards : []).map((c) => ({ q: clean(c && c.q, 500).trim(), a: clean(c && c.a, 1000).trim() })).filter((c) => c.q && c.a).slice(0, 500);
  if (cards.length < 2) throw new HttpError(400, 'few_cards', 'Add at least 2 cards');
  if (id) { const d = DECKS()[id]; if (!d || d.uid !== u.id) throw new HttpError(404, 'gone', 'Deck not found'); Object.assign(d, { title, cards, subject: subj(b.subject), level: lvl(b.level), public: !!b.public }); S.store.touch('studydecks'); return deckView(d, u, true); }
  if (Object.values(DECKS()).filter((d) => d.uid === u.id).length >= 300) throw new HttpError(400, 'too_many', 'You have too many decks');
  const d = { id: rid(10), uid: u.id, title, cards, subject: subj(b.subject), level: lvl(b.level), public: !!b.public, uses: 0, created: now() };
  DECKS()[d.id] = d; S.store.touch('studydecks'); earn(u, 10, 'deck'); return deckView(d, u, true);
}
// SM-2 spaced repetition per person and card (index): ease, interval (days), due time
function dueCount(u, d) { const p = mine(u).progress[d.id] || {}; const t = now(); let n = 0; for (let i = 0; i < d.cards.length; i++) { const c = p[i]; if (!c || c.due <= t) n++; } return n; }
function review(u, deckId, idx, grade) {
  const d = DECKS()[deckId]; if (!d || (!d.public && d.uid !== u.id)) throw new HttpError(404, 'gone', 'Deck not found');
  idx = Math.trunc(Number(idx)); grade = Math.trunc(Number(grade)); if (!d.cards[idx] || ![0, 1, 2, 3].includes(grade)) throw new HttpError(400, 'bad', 'Bad review');
  const st = mine(u); const p = (st.progress[deckId] = st.progress[deckId] || {}); const c = p[idx] || { ease: 2.5, ivl: 0, reps: 0, due: 0 };
  // grade: 0 again · 1 hard · 2 good · 3 easy
  if (grade === 0) { c.reps = 0; c.ivl = 0; c.due = now() + 60000; c.ease = Math.max(1.3, c.ease - 0.2); }
  else { c.reps++; c.ivl = c.reps === 1 ? (grade === 3 ? 3 : 1) : c.reps === 2 ? (grade === 1 ? 3 : 6) : Math.round(c.ivl * (grade === 1 ? 1.2 : c.ease * (grade === 3 ? 1.3 : 1))); c.ease = Math.max(1.3, c.ease + (grade === 1 ? -0.15 : grade === 3 ? 0.15 : 0)); c.due = now() + c.ivl * 86400000; }
  p[idx] = c; st.cards = (st.cards || 0) + 1; if (st.cards % 20 === 0) earn(u, 5, 'review'); S.store.touch('users');
  if (!st.usedDecks) st.usedDecks = []; if (!st.usedDecks.includes(deckId)) { st.usedDecks.push(deckId); st.usedDecks = st.usedDecks.slice(-200); if (d.uid !== u.id) { d.uses = (d.uses || 0) + 1; S.store.touch('studydecks'); } }
  return { due: dueCount(u, d), card: c };
}
// a few coins for studying, at most 120 a day
function earn(u, n, why) { const cap = [120, 150, 200, 300][require('./state').tierRank(u)] || 120; const st = mine(u); if (st.day !== dayKey()) { st.day = dayKey(); st.earned = 0; } const give = Math.min(n, cap - st.earned); if (give <= 0) return 0; st.earned += give; try { require('./economy').adjust(u, give, 'study:' + why); } catch {} try { require('./progress').award(u, 'study', 1); } catch {} return give; }

// ---------- grades & exams ----------
function setGrades(u, list) {
  const st = mine(u);
  st.grades = (Array.isArray(list) ? list : []).slice(0, 400).map((g) => ({ id: clean(g.id, 12) || rid(6), subject: clean(g.subject, 40).trim() || 'other', name: clean(g.name, 60).trim(), score: Math.max(0, Math.min(1000, Number(g.score) || 0)), max: Math.max(1, Math.min(1000, Number(g.max) || 10)), weight: Math.max(0, Math.min(100, Number(g.weight) || 1)), date: Number(g.date) || now() }));
  S.store.touch('users'); return st.grades;
}
function setExams(u, list) {
  const st = mine(u);
  const old = new Map((st.exams || []).map((e) => [e.id, e]));
  st.exams = (Array.isArray(list) ? list : []).slice(0, 200).map((e) => { const id = clean(e.id, 12) || rid(6); const date = Number(e.date) || 0; const prev = old.get(id); return { id, subject: clean(e.subject, 40).trim(), title: clean(e.title, 80).trim(), date, done: !!e.done, reminded: !!(prev && prev.reminded && prev.date === date) }; }).filter((e) => e.title && e.date);
  S.store.touch('users'); return st.exams;
}

// ---------- live class quizzes ----------
const rooms = new Map(); // pin -> room
const Q_TIME = 20000;
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function makeQuestions(deck, n) {
  const cards = shuffle(deck.cards.slice()).slice(0, n); const answers = [...new Set(deck.cards.map((c) => c.a))];
  return cards.map((c) => { const wrong = shuffle(answers.filter((a) => a !== c.a)).slice(0, 3); const opts = shuffle([c.a].concat(wrong)); return { q: c.q, opts, ok: opts.indexOf(c.a) }; });
}
const roomSend = (r, m, onlyHost) => { const str = JSON.stringify(m); for (const p of r.players.values()) if (!onlyHost && p.conn) p.conn.send(str); if (r.hostConn) r.hostConn.send(str); };
const board = (r) => [...r.players.values()].map((p) => ({ id: p.id, name: p.name, score: p.score, streak: p.streak })).sort((a, b) => b.score - a.score);
function newPin() { for (let i = 0; i < 50; i++) { const p = String(100000 + Math.floor(Math.random() * 900000)); if (!rooms.has(p)) return p; } return null; }
function closeRoom(r) { clearTimeout(r.timer); rooms.delete(r.pin); roomSend(r, { t: 'st_closed' }); for (const p of r.players.values()) if (p.conn) p.conn.data.study = null; if (r.hostConn) r.hostConn.data.study = null; }
function nextQuestion(r) {
  clearTimeout(r.timer); r.qi++;
  if (r.qi >= r.qs.length) { r.phase = 'end'; const b = board(r); roomSend(r, { t: 'st_end', board: b.slice(0, 50) }); for (const [i, p] of b.slice(0, 3).entries()) { const u = S.users[p.id]; if (u) earn(u, [30, 20, 10][i], 'live'); } r.timer = setTimeout(() => closeRoom(r), 10 * 60000); return; }
  r.phase = 'q'; r.qAt = now(); r.answers = new Map(); const q = r.qs[r.qi];
  roomSend(r, { t: 'st_q', i: r.qi, n: r.qs.length, q: q.q, opts: q.opts, until: r.qAt + Q_TIME });
  r.timer = setTimeout(() => reveal(r), Q_TIME + 300);
}
function reveal(r) {
  if (r.phase !== 'q') return; clearTimeout(r.timer); r.phase = 'reveal'; const q = r.qs[r.qi]; const counts = q.opts.map(() => 0);
  for (const p of r.players.values()) { const a = r.answers.get(p.id); if (a) counts[a.opt]++; if (a && a.opt === q.ok) { p.streak++; p.score += Math.round(500 + 500 * Math.max(0, 1 - a.ms / Q_TIME)) + Math.min(5, p.streak - 1) * 50; } else p.streak = 0; }
  const b = board(r); for (const p of r.players.values()) if (p.conn) { const a = r.answers.get(p.id); p.conn.send({ t: 'st_reveal', ok: q.ok, counts, you: a ? a.opt : null, right: !!a && a.opt === q.ok, score: p.score, rank: b.findIndex((x) => x.id === p.id) + 1, board: b.slice(0, 5) }); }
  if (r.hostConn) r.hostConn.send({ t: 'st_reveal', ok: q.ok, counts, board: b.slice(0, 10), host: true });
}
function onMessage(conn, u, m) {
  const pin = String(m.pin || conn.data.study || '');
  if (m.t === 'st_host') {
    const d = DECKS()[String(m.deck || '')]; if (!d || (!d.public && d.uid !== u.id) || d.cards.length < 4) return conn.send({ t: 'st_err', code: 'deck', text: 'Pick a deck with at least 4 cards' });
    if ([...rooms.values()].some((r) => r.host === u.id)) for (const r of [...rooms.values()].filter((x) => x.host === u.id)) closeRoom(r);
    const p = newPin(); if (!p) return; const n = Math.max(3, Math.min(30, Math.trunc(Number(m.n) || 10)));
    const r = { pin: p, host: u.id, hostConn: conn, deck: d.id, title: d.title, qs: makeQuestions(d, n), qi: -1, phase: 'lobby', players: new Map(), created: now() };
    rooms.set(p, r); conn.data.study = p; conn.send({ t: 'st_room', pin: p, title: d.title, n: r.qs.length, host: true, players: [] }); return;
  }
  if (m.t === 'st_join') {
    const r = rooms.get(String(m.pin || '')); if (!r || r.phase === 'end') return conn.send({ t: 'st_err', code: 'pin', text: 'No game with that PIN' });
    if (r.host === u.id) return conn.send({ t: 'st_err', code: 'host', text: 'You are the host of this game' });
    if (!r.players.has(u.id) && r.players.size >= 200) return conn.send({ t: 'st_err', code: 'full', text: 'This game is full' });
    const name = (u.displayName || u.username).slice(0, 24); const p = r.players.get(u.id) || { id: u.id, name, score: 0, streak: 0 }; p.conn = conn; r.players.set(u.id, p); conn.data.study = r.pin;
    conn.send({ t: 'st_room', pin: r.pin, title: r.title, n: r.qs.length, host: false, phase: r.phase });
    if (r.hostConn) r.hostConn.send({ t: 'st_players', players: [...r.players.values()].map((x) => x.name) }); return;
  }
  const r = rooms.get(pin); if (!r) return;
  if (m.t === 'st_start' && r.host === u.id && r.phase === 'lobby' && r.players.size) return nextQuestion(r);
  if (m.t === 'st_next' && r.host === u.id && r.phase === 'reveal') return nextQuestion(r);
  if (m.t === 'st_skip' && r.host === u.id && r.phase === 'q') return reveal(r);
  if (m.t === 'st_close' && r.host === u.id) return closeRoom(r);
  if (m.t === 'st_answer' && r.phase === 'q' && r.players.has(u.id) && !r.answers.has(u.id)) {
    const opt = Math.trunc(Number(m.opt)); if (opt < 0 || opt >= r.qs[r.qi].opts.length) return;
    r.answers.set(u.id, { opt, ms: now() - r.qAt }); conn.send({ t: 'st_got' });
    if (r.hostConn) r.hostConn.send({ t: 'st_count', n: r.answers.size, of: r.players.size });
    if (r.answers.size >= r.players.size) setTimeout(() => reveal(r), 400);
  }
}
function onClose(conn, u) {
  const r = rooms.get(conn.data.study || ''); if (!r) return;
  if (r.host === u.id && r.hostConn === conn) { r.hostConn = null; r.hostGone = setTimeout(() => { if (!r.hostConn) closeRoom(r); }, 60000); return; }
  const p = r.players.get(u.id); if (p && p.conn === conn) p.conn = null;
}
// the host can come back to their game (page reload)
function rejoinHost(conn, u) { const r = [...rooms.values()].find((x) => x.host === u.id); if (!r) return null; r.hostConn = conn; clearTimeout(r.hostGone); conn.data.study = r.pin; return r; }
// exam reminders: the day before, a notice (as a push notification if the person is offline and allowed it)
function remindExams() {
  const t = now(); const { hub } = require('./state');
  for (const u of Object.values(S.users)) {
    const ex = u && u.study && u.study.exams; if (!ex || !ex.length || u.deleted || (u.settings && u.settings.pushStudy === false)) continue;
    for (const e of ex) { if (e.done || e.reminded || e.date - t > 30 * 3600000 || e.date - t < 2 * 3600000) continue; e.reminded = true; S.store.touch('users'); const es = u.lang === 'es'; hub.push(u.id, { t: 'notify', kind: 'study', text: es ? `Mañana tienes examen: ${e.title}. ¡Repasa con tus tarjetas!` : `Exam tomorrow: ${e.title}. Revise with your flashcards!`, link: 'study/exams', at: t }); }
  }
}
setInterval(() => { try { remindExams(); } catch (e) { console.error('[study]', e.message); } }, 1800000).unref();
// old rooms are cleaned up
setInterval(() => { for (const r of rooms.values()) if (now() - r.created > 3 * 3600000) closeRoom(r); }, 600000).unref();

function report(u, kind, id) {
  const t = kind === 'deck' ? DECKS()[id] : NOTES()[id]; if (!t) throw new HttpError(404, 'gone', 'Not found');
  t.reports = (t.reports || []).filter((x) => x !== u.id).concat(u.id); if (t.reports.length >= 5) t.hidden = true; // hidden until staff look at it
  S.store.touch(kind === 'deck' ? 'studydecks' : 'studynotes');
  try { S.reports.unshift({ id: rid(6), type: 'study-' + kind, target: id, ref: null, reason: 'Study content: ' + (t.title || ''), by: u.id, t: now(), open: true }); if (S.reports.length > 1000) S.reports.length = 1000; S.store.touch('reports'); } catch {}
}

module.exports = { SUBJECTS, LEVELS, NOTES, DECKS, mine, listNotes, saveNote, noteView, listDecks, saveDeck, deckView, review, dueCount, setGrades, setExams, onMessage, onClose, rejoinHost, report, earn, rooms };

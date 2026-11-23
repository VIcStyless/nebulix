'use strict';
// Nebulix Quiz: live quiz games. A host picks a quiz and gets a 6-digit PIN; players join with the PIN and answer
// on their own screen. Faster correct answers score more, streaks add a bonus. Live state is in memory and pushed
// over the WebSocket; quizzes people create are saved. Podium prizes need 3+ players and are capped per day.
const crypto = require('crypto');
const { S, hub } = require('./state');
const { now, rid, dayKey, HttpError } = require('./util');

const Q = (q, a, c, time = 20) => ({ q, a, c, time });
const BANKS = [
  { id: 'general', title: 'Cultura general', emoji: '🧠', questions: [
    Q('¿Cuál es el planeta más grande del sistema solar?', ['Saturno', 'Júpiter', 'Neptuno', 'Tierra'], 1), Q('¿Cuántos continentes hay?', ['5', '6', '7', '8'], 2),
    Q('¿Quién pintó la Mona Lisa?', ['Picasso', 'Van Gogh', 'Leonardo da Vinci', 'Dalí'], 2), Q('¿Cuál es el océano más grande?', ['Atlántico', 'Índico', 'Ártico', 'Pacífico'], 3),
    Q('¿Cuántos lados tiene un hexágono?', ['5', '6', '7', '8'], 1), Q('¿En qué año llegó el ser humano a la Luna?', ['1959', '1969', '1979', '1989'], 1),
    Q('¿Cuál es el animal terrestre más rápido?', ['León', 'Guepardo', 'Caballo', 'Gacela'], 1), Q('¿Qué idioma tiene más hablantes nativos?', ['Inglés', 'Español', 'Chino mandarín', 'Hindi'], 2),
    Q('¿Cuántos huesos tiene un adulto humano?', ['186', '206', '226', '256'], 1), Q('¿Cuál es el metal más ligero?', ['Litio', 'Aluminio', 'Hierro', 'Plata'], 0)] },
  { id: 'science', title: 'Ciencia', emoji: '🔬', questions: [
    Q('¿Cuál es el símbolo químico del oro?', ['Go', 'Au', 'Ag', 'Or'], 1), Q('¿A qué temperatura hierve el agua al nivel del mar?', ['90 °C', '100 °C', '110 °C', '120 °C'], 1),
    Q('¿Qué gas respiran las plantas para la fotosíntesis?', ['Oxígeno', 'Nitrógeno', 'Dióxido de carbono', 'Helio'], 2), Q('¿Cuál es la velocidad de la luz aproximada?', ['300 km/s', '3.000 km/s', '300.000 km/s', '3 millones km/s'], 2),
    Q('¿Qué órgano bombea la sangre?', ['Pulmón', 'Hígado', 'Corazón', 'Riñón'], 2), Q('¿Cuántos planetas tiene el sistema solar?', ['7', '8', '9', '10'], 1),
    Q('¿Qué partícula tiene carga negativa?', ['Protón', 'Neutrón', 'Electrón', 'Fotón'], 2), Q('¿Cuál es el planeta más cercano al Sol?', ['Venus', 'Mercurio', 'Marte', 'Tierra'], 1)] },
  { id: 'geo', title: 'Geografía', emoji: '🌍', questions: [
    Q('¿Cuál es la capital de Japón?', ['Osaka', 'Kioto', 'Tokio', 'Seúl'], 2), Q('¿Cuál es el río más largo del mundo?', ['Nilo', 'Amazonas', 'Yangtsé', 'Misisipi'], 1),
    Q('¿En qué país está la Torre Eiffel?', ['Italia', 'Francia', 'Bélgica', 'Suiza'], 1), Q('¿Cuál es el país más grande del mundo?', ['Canadá', 'China', 'Rusia', 'EE. UU.'], 2),
    Q('¿Capital de Australia?', ['Sídney', 'Melbourne', 'Canberra', 'Perth'], 2), Q('¿Montaña más alta del mundo?', ['K2', 'Everest', 'Aconcagua', 'Kilimanjaro'], 1),
    Q('¿En qué continente está Egipto?', ['Asia', 'África', 'Europa', 'Oceanía'], 1), Q('¿Capital de Argentina?', ['Córdoba', 'Rosario', 'Buenos Aires', 'Montevideo'], 2)] },
  { id: 'games', title: 'Videojuegos', emoji: '🎮', questions: [
    Q('¿Cuántos jugadores hay en un equipo de fútbol en el campo?', ['9', '10', '11', '12'], 2), Q('¿Qué significa "GG" en los juegos?', ['Good game', 'Go go', 'Great goal', 'Game guide'], 0),
    Q('¿Qué significa "FPS" en un shooter?', ['Fast player speed', 'First-person shooter', 'Free play system', 'Final power shot'], 1), Q('¿Cuántas fichas tiene un tablero de ajedrez al empezar?', ['24', '30', '32', '36'], 2),
    Q('En el 2048, ¿qué pasa al juntar dos 8?', ['Sale un 10', 'Sale un 16', 'Sale un 64', 'Desaparecen'], 1), Q('¿Qué significa "AFK"?', ['Away from keyboard', 'All for kills', 'Attack from keep', 'Auto fire kill'], 0),
    Q('¿Qué significa "NPC"?', ['New player character', 'Non-player character', 'No points counted', 'Next play card'], 1), Q('¿Cuántas caras tiene un dado normal?', ['4', '6', '8', '12'], 1)] },
  { id: 'nebulix', title: 'Trivial de Nebulix', emoji: '✨', questions: [
    Q('¿Quién creó Nebulix?', ['Nova', 'VicStyles', 'Leo', 'Echo'], 1), Q('¿Cómo se llama la IA de Nebulix?', ['Nova', 'Luna', 'Astra', 'Orion'], 0),
    Q('¿Cuántos niveles tiene el pase de temporada?', ['20', '30', '40', '50'], 2), Q('¿Cómo se llama la red de fotos de Nebulix?', ['Lens', 'Pics', 'Snap', 'Frame'], 0),
    Q('¿Qué da el Banco Nebulix cada día?', ['0,1 %', '0,5 %', '1 %', '5 %'], 1), Q('¿Cómo se llama el shooter 3D del Arcade?', ['Nebula Ops', 'Star Strike', 'Void War', 'Space Force'], 0),
    Q('¿Con qué se compran las mejoras en Ventajas?', ['Gemas', 'Monedas', 'Dinero real', 'XP'], 1), Q('¿Cómo se llaman los foros de Nebulix?', ['Foros', 'Hilos', 'Charla', 'Tablón'], 0)] },
  { id: 'maths', title: 'Cálculo rápido', emoji: '➗', questions: [
    Q('7 × 8 = ?', ['54', '56', '58', '64'], 1, 12), Q('144 ÷ 12 = ?', ['10', '11', '12', '14'], 2, 12), Q('15 + 27 = ?', ['42', '41', '43', '32'], 0, 10), Q('9² = ?', ['18', '72', '81', '99'], 2, 10),
    Q('25 % de 200 = ?', ['25', '40', '50', '75'], 2, 15), Q('√64 = ?', ['6', '7', '8', '9'], 2, 10), Q('1.000 − 357 = ?', ['643', '653', '743', '657'], 0, 15), Q('3 × 3 × 3 = ?', ['9', '18', '27', '33'], 2, 10)] },
];
const quizzes = () => S.store.table('quizzes');
function findQuiz(id) { const b = BANKS.find((x) => x.id === id); if (b) return Object.assign({ builtin: true }, b); const q = quizzes()[id]; return q || null; }
function catalog(me) {
  const own = Object.values(quizzes()).filter((q) => q.owner === me.id || q.public).sort((a, b) => b.created - a.created).slice(0, 60);
  return { builtin: BANKS.map((b) => ({ id: b.id, title: b.title, emoji: b.emoji, count: b.questions.length })), mine: own.map((q) => ({ id: q.id, title: q.title, emoji: q.emoji || '❓', count: q.questions.length, mine: q.owner === me.id, owner: S.users[q.owner] ? S.users[q.owner].username : null, public: !!q.public })) };
}
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f‪-‮⁦-⁩]/g, ' ').trim().slice(0, n);
function saveQuiz(me, body) {
  const qs = Array.isArray(body.questions) ? body.questions.slice(0, 40) : [];
  const questions = qs.map((x) => ({ q: clean(x.q, 160), a: (Array.isArray(x.a) ? x.a : []).slice(0, 4).map((y) => clean(y, 60)), c: Math.trunc(Number(x.c)), time: [10, 15, 20, 30, 45, 60].includes(Number(x.time)) ? Number(x.time) : 20 }))
    .filter((x) => x.q && x.a.length >= 2 && x.a.every(Boolean) && x.c >= 0 && x.c < x.a.length);
  if (!questions.length) throw new HttpError(400, 'empty', 'Add at least one complete question');
  const title = clean(body.title, 60) || 'Quiz';
  const all = quizzes(); let q = body.id ? all[String(body.id)] : null;
  if (q && q.owner !== me.id) throw new HttpError(403, 'not_yours', 'You can only edit your own quizzes');
  if (!q) { if (Object.values(all).filter((x) => x.owner === me.id).length >= 30) throw new HttpError(400, 'too_many', 'You can save up to 30 quizzes'); const id = rid(8); q = all[id] = { id, owner: me.id, created: now() }; }
  Object.assign(q, { title, emoji: clean(body.emoji, 4) || '❓', questions, public: !!body.public, updated: now() }); S.store.touch('quizzes');
  return { id: q.id };
}

// ---------- live games ----------
const games = new Map(); // pin -> game
const pinOf = () => { let p; do { p = String(crypto.randomInt(100000, 1000000)); } while (games.has(p)); return p; };
function snapshot(g, uid) {
  const q = g.quiz.questions[g.qi]; const isHost = uid === g.host;
  const board = [...g.players.entries()].map(([id, p]) => ({ id, name: p.name, score: p.score, streak: p.streak })).sort((a, b) => b.score - a.score);
  const v = { t: 'quiz', pin: g.pin, state: g.state, title: g.quiz.title, total: g.quiz.questions.length, qi: g.qi, host: isHost, hostName: g.hostName, players: board.length, board: board.slice(0, isHost || g.state === 'end' ? 50 : 5) };
  if (g.state === 'question' || g.state === 'reveal') { v.q = q.q; v.a = q.a; v.time = q.time; v.endsAt = g.qEnd; v.answered = g.answers.size; }
  if (g.state === 'reveal') { v.c = q.c; v.dist = q.a.map((_, i) => [...g.answers.values()].filter((x) => x.i === i).length); }
  const me = g.players.get(uid); if (me) { v.me = { score: me.score, streak: me.streak, rank: board.findIndex((x) => x.id === uid) + 1, last: me.last || null }; v.myAnswer = g.answers.has(uid) ? g.answers.get(uid).i : null; }
  if (g.state === 'end') v.prizes = g.prizes || [];
  return v;
}
function broadcast(g) { for (const id of new Set([g.host, ...g.players.keys()])) hub.push(id, snapshot(g, id)); g.touched = now(); }
function reveal(g) {
  if (g.state !== 'question') return; clearTimeout(g.timer); g.state = 'reveal'; const q = g.quiz.questions[g.qi];
  for (const [id, p] of g.players) { const a = g.answers.get(id); if (a && a.i === q.c) { p.streak++; const pts = Math.round(1000 * (1 - (a.ms / (q.time * 1000)) / 2)) + Math.min(5, p.streak - 1) * 100; p.score += pts; p.last = { ok: true, pts }; } else { p.streak = 0; p.last = { ok: false, pts: 0 }; } }
  broadcast(g);
}
function ask(g) { g.state = 'question'; g.answers = new Map(); const q = g.quiz.questions[g.qi]; g.qStart = now(); g.qEnd = g.qStart + q.time * 1000; clearTimeout(g.timer); g.timer = setTimeout(() => reveal(g), q.time * 1000 + 300); broadcast(g); }
function finish(g) {
  g.state = 'end'; clearTimeout(g.timer); const board = [...g.players.entries()].sort((a, b) => b[1].score - a[1].score); g.prizes = [];
  if (board.length >= 3) {
    const econ = require('./economy'); const day = dayKey();
    [500, 300, 150].forEach((amt, i) => { const [id, p] = board[i] || []; const u = id && S.users[id]; if (!u || !p.score) return; const d = (u.quizDay = u.quizDay && u.quizDay.d === day ? u.quizDay : { d: day, n: 0 }); if (d.n >= 5) return; d.n++; econ.adjust(u, amt, 'quiz:podium'); g.prizes.push({ id, rank: i + 1, coins: amt }); });
    for (const [id] of board) { const u = S.users[id]; if (u) require('./progress').award(u, 'arcade'); }
    S.store.touch('users');
  }
  broadcast(g);
}
function getGame(pin) { const g = games.get(String(pin)); if (!g) throw new HttpError(404, 'no_game', 'No game with that PIN'); return g; }
function host(me, quizId) {
  const quiz = findQuiz(String(quizId || '')); if (!quiz || (!quiz.builtin && quiz.owner !== me.id && !quiz.public)) throw new HttpError(404, 'no_quiz', 'Quiz not found');
  for (const [p, g] of games) if (g.host === me.id) { clearTimeout(g.timer); games.delete(p); }
  const g = { pin: pinOf(), host: me.id, hostName: me.displayName || me.username, quiz: { title: quiz.title, questions: quiz.questions }, players: new Map(), state: 'lobby', qi: 0, answers: new Map(), touched: now() };
  games.set(g.pin, g); return snapshot(g, me.id);
}
function join(me, pin) {
  const g = getGame(pin); if (g.host === me.id) return snapshot(g, me.id);
  if (!g.players.has(me.id)) { if (g.state === 'end') throw new HttpError(400, 'ended', 'That game has ended'); if (g.players.size >= 100) throw new HttpError(400, 'full', 'This game is full'); g.players.set(me.id, { name: me.displayName || me.username, score: 0, streak: 0 }); broadcast(g); }
  return snapshot(g, me.id);
}
function control(me, pin, action) {
  const g = getGame(pin); if (g.host !== me.id) throw new HttpError(403, 'not_host', 'Only the host can do that');
  if (action === 'start') { if (g.state !== 'lobby') throw new HttpError(400, 'started', 'Already started'); if (!g.players.size) throw new HttpError(400, 'no_players', 'Wait for at least one player'); g.qi = 0; ask(g); }
  else if (action === 'next') { if (g.state === 'question') reveal(g); else if (g.state === 'reveal') { if (g.qi + 1 >= g.quiz.questions.length) finish(g); else { g.qi++; ask(g); } } }
  else if (action === 'end') { if (g.state !== 'end') finish(g); }
  return snapshot(g, me.id);
}
function answer(me, pin, i) {
  const g = getGame(pin); const p = g.players.get(me.id); if (!p) throw new HttpError(403, 'not_in_game', 'Join the game first');
  if (g.state !== 'question') throw new HttpError(400, 'too_late', 'Too late!'); if (g.answers.has(me.id)) return snapshot(g, me.id);
  const q = g.quiz.questions[g.qi]; i = Math.trunc(Number(i)); if (!(i >= 0 && i < q.a.length)) throw new HttpError(400, 'bad_answer', 'Pick an answer');
  g.answers.set(me.id, { i, ms: Math.max(0, now() - g.qStart) });
  if (g.answers.size >= g.players.size) reveal(g); else hub.push(g.host, snapshot(g, g.host));
  return snapshot(g, me.id);
}
function state(me, pin) { const g = getGame(pin); if (g.host !== me.id && !g.players.has(me.id)) throw new HttpError(403, 'not_in_game', 'Join the game first'); return snapshot(g, me.id); }
function leave(me, pin) { const g = games.get(String(pin)); if (!g) return { ok: true }; if (g.host === me.id) { clearTimeout(g.timer); for (const id of g.players.keys()) hub.push(id, { t: 'quiz', pin: g.pin, state: 'closed' }); games.delete(g.pin); } else if (g.players.delete(me.id)) broadcast(g); return { ok: true }; }
setInterval(() => { const t = now(); for (const [p, g] of games) if (t - g.touched > 2 * 3600000) { clearTimeout(g.timer); games.delete(p); } }, 600000).unref();
const liveCount = () => [...games.values()].filter((g) => g.state !== 'end').length;
module.exports = { catalog, findQuiz, saveQuiz, host, join, control, answer, state, leave, liveCount, BANKS };

'use strict';
// Palabra del día: one secret Spanish 5-letter word a day (UTC), the same for everyone. Six tries; the server scores each
// guess (green = right place, yellow = in the word, grey = not in it) so the answer never reaches the browser before
// you finish. Winning pays coins (more for fewer tries, plus a streak bonus) once a day.
const { S } = require('./state');
const { dayKey, HttpError, sha256 } = require('./util');

const WORDS = ["ABRIL", "ALFIL", "AMIGA", "AMIGO", "ARBOL", "ARENA", "ARROZ", "ASTRO", "AVION", "BAHIA", "BANCO", "BANDA", "BARCO", "BEBER", "BRISA", "BRUJA", "BUENO", "BURRO", "BYTES", "CABRA", "CALLE", "CALOR", "CAMPO", "CANTO", "CARNE", "CASAS", "CEBRA", "CERDO", "CHICO", "CIELO", "CINES", "CINTA", "CLAVE", "COBRE", "COCHE", "COFRE", "COMER", "CORTO", "COSTA", "CUERO", "CURAR", "DADOS", "DATOS", "DISCO", "DOLOR", "DULCE", "ENERO", "FELIZ", "FICHA", "FRUTA", "FUEGO", "GARZA", "GATOS", "GEMAS", "GOLFO", "HEROE", "HIJOS", "HOJAS", "HOTEL", "HUEVO", "JEFES", "JUEGO", "JUGAR", "JULIO", "JUNIO", "JUSTO", "LAPIZ", "LARGO", "LECHE", "LENTO", "LIBRO", "LIMON", "LLAMA", "LLANO", "LUNES", "MADRE", "MAGIA", "MANGO", "MANTA", "MAPAS", "MARTE", "MARZO", "METAL", "METRO", "MIRAR", "MONTE", "MUNDO", "MUSEO", "NADAR", "NEGRO", "NIETO", "NIEVE", "NIVEL", "NOCHE", "NODOS", "NOTAS", "NOVIO", "NUBES", "NUEVO", "OVEJA", "PADRE", "PAPEL", "PARED", "PASTA", "PERAS", "PERRO", "PIANO", "PIEZA", "PIXEL", "PIZZA", "PLATA", "PLATO", "PLAYA", "PLAZA", "POLLO", "PRIMA", "PRIMO", "QUESO", "RADIO", "RAMAS", "RATON", "REDES", "REINA", "RELOJ", "REYES", "RITMO", "ROBOT", "ROJOS", "SALON", "SALSA", "SALUD", "SELVA", "SILLA", "SOFAS", "SONAR", "SOPAS", "SUAVE", "SUELO", "TACOS", "TARDE", "TECHO", "TIGRE", "TOCAR", "TORRE", "TORTA", "VACAS", "VALLE", "VENUS", "VERDE", "VIAJE", "VIDEO", "VIEJO", "VIRUS", "VOLAR", "ZORRO"];
const ALPHA = /^[A-ZÑ]{5}$/;
const PRIZE = [600, 450, 320, 220, 150, 100];
const EPOCH = Date.UTC(2026, 10, 1);
const dayNo = (d = dayKey()) => Math.floor((Date.parse(d + 'T00:00:00Z') - EPOCH) / 86400000) + 1;
// a fixed shuffle of the list, so consecutive days do not follow alphabetical order
const ORDER = WORDS.map((w, i) => [sha256('nbx-word-' + w).slice(0, 8), i]).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map((x) => x[1]);
const answer = (d = dayKey()) => WORDS[ORDER[((dayNo(d) % WORDS.length) + WORDS.length) % WORDS.length]];
const clean = (w) => String(w || '').toUpperCase().replace(/Á/g, 'A').replace(/É/g, 'E').replace(/Í/g, 'I').replace(/[ÓÖ]/g, 'O').replace(/[ÚÜ]/g, 'U').trim();
function score(guess, ans) {
  const r = [0, 0, 0, 0, 0]; const left = {};
  for (let i = 0; i < 5; i++) { if (guess[i] === ans[i]) r[i] = 2; else left[ans[i]] = (left[ans[i]] || 0) + 1; }
  for (let i = 0; i < 5; i++) if (r[i] !== 2 && left[guess[i]]) { r[i] = 1; left[guess[i]]--; }
  return r;
}
function state(u) {
  const d = dayKey(); if (!u.word || u.word.d !== d) u.word = { d, guesses: [], done: false, won: false };
  u.wordStats = u.wordStats || { played: 0, won: 0, streak: 0, best: 0, dist: [0, 0, 0, 0, 0, 0], last: null };
  return u.word;
}
function view(u) {
  const w = state(u); const ans = answer();
  return { day: dayNo(), guesses: w.guesses.map((g) => ({ w: g, r: score(g, ans) })), done: w.done, won: w.won, answer: w.done ? ans : null, stats: u.wordStats, prize: PRIZE, coins: w.coins || 0,
    next: Date.parse(w.d + 'T00:00:00Z') + 86400000 };
}
function guess(u, raw) {
  const w = state(u); if (w.done) throw new HttpError(409, 'word_done', 'You already finished today’s word');
  const g = clean(raw); if (!ALPHA.test(g)) throw new HttpError(400, 'bad_word', 'Write a 5-letter word');
  const ans = answer(); w.guesses.push(g); const won = g === ans; const st = u.wordStats;
  if (won || w.guesses.length >= 6) {
    w.done = true; w.won = won; st.played++;
    const y = dayKey(Date.parse(w.d + 'T00:00:00Z') - 86400000);
    if (won) {
      st.won++; st.streak = st.last === y ? st.streak + 1 : 1; st.best = Math.max(st.best, st.streak); st.dist[w.guesses.length - 1]++; st.last = w.d;
      w.coins = PRIZE[w.guesses.length - 1] + Math.min(300, (st.streak - 1) * 25); require('./economy').adjust(u, w.coins, 'word:' + w.d);
      try { require('./progress').award(u, 'arcade', 1); } catch {}
      if (st.streak % 7 === 0) require('./feed').add('record', '🔤', [`@${u.username} has a ${st.streak}-day streak in Word of the day`, `@${u.username} lleva una racha de ${st.streak} días en la Palabra del día`], { uid: u.id, link: '#/word' });
    } else { st.streak = 0; st.last = w.d; }
  }
  S.store.touch('users');
  return view(u);
}
module.exports = { view, guess, answer, score, WORDS };

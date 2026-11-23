'use strict';
// Nebula Fusion (13.8): an original element-combining game. Start with four elements and combine any two.
// The first time a pair is combined anywhere, the AI decides the result; it is saved for everyone, so the same pair
// always gives the same thing. Being the first player in Nebulix to discover an element pays coins.
// Separate worlds per language (es / en). With no AI available, a built-in recipe book keeps the game playable.
const { S } = require('./state');
const { HttpError, now, dayKey } = require('./util');

const BASE = { es: ['Agua', 'Fuego', 'Tierra', 'Aire'], en: ['Water', 'Fire', 'Earth', 'Air'] };
const BOOK = { // built-in recipes (used when the AI is offline, and to seed the world)
  es: [['Agua', 'Fuego', 'Vapor'], ['Agua', 'Tierra', 'Barro'], ['Fuego', 'Tierra', 'Lava'], ['Aire', 'Fuego', 'Energía'], ['Agua', 'Aire', 'Lluvia'], ['Tierra', 'Aire', 'Polvo'], ['Agua', 'Agua', 'Lago'], ['Fuego', 'Fuego', 'Incendio'], ['Tierra', 'Tierra', 'Montaña'], ['Aire', 'Aire', 'Viento'], ['Lava', 'Agua', 'Piedra'], ['Vapor', 'Aire', 'Nube'], ['Nube', 'Agua', 'Lluvia'], ['Lluvia', 'Tierra', 'Planta'], ['Planta', 'Planta', 'Bosque'], ['Barro', 'Fuego', 'Ladrillo'], ['Ladrillo', 'Ladrillo', 'Casa'], ['Piedra', 'Fuego', 'Metal'], ['Energía', 'Nube', 'Rayo'], ['Lago', 'Planta', 'Alga'], ['Polvo', 'Fuego', 'Pólvora'], ['Viento', 'Agua', 'Ola'], ['Montaña', 'Agua', 'Río'], ['Metal', 'Energía', 'Electricidad'], ['Electricidad', 'Metal', 'Robot'], ['Rayo', 'Barro', 'Vida'], ['Vida', 'Tierra', 'Animal'], ['Animal', 'Vida', 'Persona'], ['Persona', 'Metal', 'Herramienta'], ['Persona', 'Casa', 'Familia']],
  en: [['Water', 'Fire', 'Steam'], ['Water', 'Earth', 'Mud'], ['Fire', 'Earth', 'Lava'], ['Air', 'Fire', 'Energy'], ['Water', 'Air', 'Rain'], ['Earth', 'Air', 'Dust'], ['Water', 'Water', 'Lake'], ['Fire', 'Fire', 'Wildfire'], ['Earth', 'Earth', 'Mountain'], ['Air', 'Air', 'Wind'], ['Lava', 'Water', 'Stone'], ['Steam', 'Air', 'Cloud'], ['Rain', 'Earth', 'Plant'], ['Plant', 'Plant', 'Forest'], ['Mud', 'Fire', 'Brick'], ['Brick', 'Brick', 'House'], ['Stone', 'Fire', 'Metal'], ['Energy', 'Cloud', 'Lightning'], ['Dust', 'Fire', 'Gunpowder'], ['Wind', 'Water', 'Wave'], ['Mountain', 'Water', 'River'], ['Metal', 'Energy', 'Electricity'], ['Electricity', 'Metal', 'Robot'], ['Lightning', 'Mud', 'Life'], ['Life', 'Earth', 'Animal'], ['Animal', 'Life', 'Human'], ['Human', 'Metal', 'Tool'], ['Human', 'House', 'Family']],
};
const T = () => S.store.table('fusion', {});
const world = (lang) => { const t = T(); t[lang] = t[lang] || { combos: {}, els: {} }; return t[lang]; };
const key = (a, b) => [a.toLowerCase(), b.toLowerCase()].sort().join('|');
const clean = (s) => String(s || '').replace(/[\u0000-\u001f]/g, '').replace(/[^\p{L}\p{N} '\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 32);
const titleCase = (s) => s.split(' ').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
const langOf = (u) => (u.lang === 'en' ? 'en' : 'es');
function seed(lang) { const w = world(lang); if (w.seeded) return; for (const [a, b, r] of BOOK[lang]) if (!w.combos[key(a, b)]) w.combos[key(a, b)] = { r, at: now(), by: null }; for (const e of BASE[lang]) w.els[e.toLowerCase()] = w.els[e.toLowerCase()] || { n: e, by: null, at: now() }; w.seeded = true; S.store.touch('fusion'); }
function mine(u) { const lang = langOf(u); u.fusion = u.fusion || {}; const f = (u.fusion[lang] = u.fusion[lang] || { found: BASE[lang].slice(), firsts: 0 }); return f; }

const pending = new Map();
async function askAI(lang, a, b) {
  const sys = lang === 'es'
    ? 'Eres el motor de un juego de combinar elementos. Te dan dos cosas y respondes SOLO con el nombre de lo que resulta al combinarlas (1 a 3 palabras, en español, sustantivo, sin explicación, sin comillas, sin emojis). Sé creativo pero lógico; puede ser un objeto, ser vivo, lugar, concepto, personaje o cultura popular apta para todos. Si combinar no tiene sentido, inventa algo divertido y coherente.'
    : 'You are the engine of an element-combining game. Given two things, reply with ONLY the name of what you get by combining them (1 to 3 words, English, a noun, no explanation, no quotes, no emojis). Be creative but logical; it can be an object, creature, place, idea, character or family-friendly pop culture. If it makes little sense, invent something fun and coherent.';
  let out = null; try { out = await require('./routes/ai').complete(sys, `${a} + ${b}`, { maxChars: 120, timeout: 25000 }); } catch { out = null; }
  const r = titleCase(clean(String(out || '').split('\n')[0].replace(/^(resultado|result)\s*:\s*/i, '')));
  return r.length >= 2 && r.toLowerCase() !== a.toLowerCase() + ' ' + b.toLowerCase() ? r : null;
}
async function combine(u, a, b) {
  const lang = langOf(u); seed(lang); const f = mine(u); const w = world(lang);
  const A = f.found.find((x) => x.toLowerCase() === String(a || '').toLowerCase()); const B = f.found.find((x) => x.toLowerCase() === String(b || '').toLowerCase());
  if (!A || !B) throw new HttpError(400, 'not_found', 'You have not discovered one of those elements yet');
  const k = key(A, B); let c = w.combos[k];
  if (!c) {
    if (!pending.has(lang + k)) pending.set(lang + k, askAI(lang, A, B).finally(() => setTimeout(() => pending.delete(lang + k), 1000)));
    const r = await pending.get(lang + k); c = w.combos[k];
    if (!c) { if (!r) return { result: null, aiOff: require('./routes/ai').mode() === 'local' }; c = w.combos[k] = { r, at: now(), by: u.id }; S.store.touch('fusion'); }
  }
  const r = c.r; const lk = r.toLowerCase(); let isNew = false; let first = false; let coins = 0;
  if (!f.found.some((x) => x.toLowerCase() === lk)) { f.found.push(r); isNew = true; try { require('./progress').award(u, 'fusion'); } catch {} if (f.found.length > 5000) f.found = f.found.slice(-5000); }
  if (!w.els[lk]) { w.els[lk] = { n: r, by: u.id, at: now() }; first = true; f.firsts = (f.firsts || 0) + 1; S.store.touch('fusion'); }
  if (isNew) { const day = dayKey(); if (u.fusion.dayKey !== day) { u.fusion.dayKey = day; u.fusion.earned = 0; } const give = Math.min(first ? 15 : 2, 150 - (u.fusion.earned || 0)); if (give > 0) { u.fusion.earned = (u.fusion.earned || 0) + give; coins = give; try { require('./economy').adjust(u, give, 'fusion'); } catch {} } }
  S.store.touch('users');
  return { result: r, isNew, first, coins, total: f.found.length };
}
function state(u) { const lang = langOf(u); seed(lang); const f = mine(u); const w = world(lang); return { lang, found: f.found, firsts: f.firsts || 0, worldTotal: Object.keys(w.els).length, base: BASE[lang] }; }
function board(u) { const lang = langOf(u); const list = Object.values(S.users).filter((x) => x.fusion && x.fusion[lang] && !x.deleted).map((x) => ({ u: x, firsts: x.fusion[lang].firsts || 0, found: x.fusion[lang].found.length })).sort((a, b) => b.firsts - a.firsts || b.found - a.found).slice(0, 20); return list.map((x) => ({ user: require('./state').publicUser(x.u), firsts: x.firsts, found: x.found })); }
module.exports = { combine, state, board, BASE, key };

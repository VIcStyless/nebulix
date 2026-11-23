'use strict';
// Life simulator ("Vida"): needs (energy, food, health, happiness) that change over time, daily-life actions that
// cost coins, education that raises every salary, homes (live in one, rent the others out for daily income),
// vehicles that add work pay, and a life score. All coins are virtual.
const { S } = require('../state');
const econ = require('../economy');
const prog = require('../progress');
const { HttpError, now } = require('../util');

const HOUR = 3600000; const DAY = 24 * HOUR;
const L2 = (en, es) => [en, es];
// id, name, icon, price, comfort (sleep/happiness bonus), daily rent when rented out (fraction of the price)
const HOMES = [
  ['room', L2('Shared room', 'Habitación compartida'), '🛏️', 0, 0],
  ['studio', L2('Studio flat', 'Estudio'), '🏢', 50_000, 1],
  ['apartment', L2('City apartment', 'Piso en la ciudad'), '🏙️', 250_000, 2],
  ['house', L2('Family house', 'Casa familiar'), '🏡', 1_000_000, 3],
  ['beach', L2('Beach house', 'Casa en la playa'), '🏖️', 3_500_000, 4],
  ['villa', L2('Villa with pool', 'Villa con piscina'), '🏰', 8_000_000, 5],
  ['penthouse', L2('Skyline penthouse', 'Ático con vistas'), '🌆', 20_000_000, 6],
  ['orbital', L2('Orbital station', 'Estación orbital'), '🛰️', 100_000_000, 8],
].map(([id, n, icon, price, comfort]) => ({ id, n, icon, price, comfort }));
const HOME_BY = new Map(HOMES.map((x) => [x.id, x]));
const RENT_RATE = 0.004; // per day of the property price, while rented out
const CARS = [
  ['bike', L2('Bicycle', 'Bicicleta'), '🚲', 2_000, 0.03], ['scooter', L2('Scooter', 'Patinete eléctrico'), '🛴', 8_000, 0.05],
  ['moto', L2('Motorbike', 'Moto'), '🏍️', 25_000, 0.07], ['compact', L2('Compact car', 'Coche compacto'), '🚗', 60_000, 0.09],
  ['suv', L2('SUV', 'Todoterreno'), '🚙', 180_000, 0.12], ['sports', L2('Sports car', 'Deportivo'), '🏎️', 750_000, 0.15],
  ['heli', L2('Helicopter', 'Helicóptero'), '🚁', 4_000_000, 0.18], ['hover', L2('Hovercar', 'Coche volador'), '🛸', 25_000_000, 0.22],
].map(([id, n, icon, price, pay]) => ({ id, n, icon, price, pay }));
const CAR_BY = new Map(CARS.map((x) => [x.id, x]));
// education: one course at a time, takes real time; each finished level adds to every salary
const EDU = [
  ['school', L2('High school diploma', 'Bachillerato'), '🎒', 0, 1, 0.05],
  ['vocational', L2('Vocational training', 'Formación profesional'), '🛠️', 5_000, 4, 0.08],
  ['degree', L2('University degree', 'Grado universitario'), '🎓', 25_000, 12, 0.12],
  ['master', L2('Master’s degree', 'Máster'), '📜', 90_000, 24, 0.15],
  ['phd', L2('Doctorate (PhD)', 'Doctorado'), '🔬', 250_000, 48, 0.2],
].map(([id, n, icon, price, hours, pay], i) => ({ id, n, icon, price, hours, pay, i }));
const EDU_BY = new Map(EDU.map((x) => [x.id, x]));
// actions: cost, cooldown (min), effects on needs, skill gained
const ACTS = [
  ['snack', L2('Quick snack', 'Picar algo'), '🥪', 25, 10, { food: 20 }],
  ['cook', L2('Cook at home', 'Cocinar en casa'), '🍳', 60, 45, { food: 45, happy: 4 }, 'cooking'],
  ['restaurant', L2('Restaurant dinner', 'Cenar en un restaurante'), '🍝', 400, 120, { food: 60, happy: 15 }],
  ['sleep', L2('Sleep', 'Dormir'), '😴', 0, 240, { energy: 70 }],
  ['nap', L2('Power nap', 'Siesta'), '💤', 0, 60, { energy: 25 }],
  ['coffee', L2('Coffee', 'Café'), '☕', 15, 30, { energy: 12, happy: 2 }],
  ['gym', L2('Gym session', 'Ir al gimnasio'), '🏋️', 80, 90, { energy: -20, health: 8, happy: 5 }, 'fitness'],
  ['run', L2('Go for a run', 'Salir a correr'), '🏃', 0, 60, { energy: -15, health: 5, food: -8 }, 'fitness'],
  ['read', L2('Read a book', 'Leer un libro'), '📚', 30, 60, { happy: 6, energy: -5 }, 'knowledge'],
  ['games', L2('Game night', 'Noche de videojuegos'), '🎮', 0, 90, { happy: 12, energy: -10 }],
  ['friends', L2('Hang out with friends', 'Quedar con amigos'), '🍻', 250, 180, { happy: 22, energy: -15, food: 10 }, 'charisma'],
  ['date', L2('Go on a date', 'Tener una cita'), '💘', 600, 360, { happy: 30, energy: -10 }, 'charisma'],
  ['doctor', L2('Doctor visit', 'Ir al médico'), '🩺', 500, 360, { health: 60 }],
  ['spa', L2('Spa day', 'Día de spa'), '🧖', 2_500, 720, { happy: 25, health: 15, energy: 30 }],
  ['concert', L2('Concert', 'Concierto'), '🎤', 1_500, 720, { happy: 35, energy: -20 }],
  ['vacation', L2('Holiday trip', 'Viaje de vacaciones'), '✈️', 25_000, 4320, { happy: 100, energy: 100, health: 20 }],
].map(([id, n, icon, price, cd, fx, skill]) => ({ id, n, icon, price, cd: cd * 60000, fx, skill: skill || null }));
const ACT_BY = new Map(ACTS.map((x) => [x.id, x]));
const SKILLS = { fitness: L2('Fitness', 'Forma física'), cooking: L2('Cooking', 'Cocina'), charisma: L2('Charisma', 'Carisma'), knowledge: L2('Knowledge', 'Conocimiento') };
const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));

function life(u) {
  const L = (u.life = u.life || { energy: 90, food: 80, health: 95, happy: 75, t: now(), home: 'room', homes: ['room'], rented: {}, rentAt: now(), cars: [], car: null, edu: [], course: null, cds: {}, skills: {}, log: [], born: now() });
  L.homes = L.homes || ['room']; L.rented = L.rented || {}; L.cars = L.cars || []; L.edu = L.edu || []; L.cds = L.cds || {}; L.skills = L.skills || {}; L.log = L.log || [];
  // needs drift every hour: food −4, energy −3 (−1 while asleep is not modelled), happiness drifts to 50
  const t = now(); const hrs = (t - (L.t || t)) / HOUR;
  if (hrs >= 0.25) {
    const comfort = (HOME_BY.get(L.home) || HOMES[0]).comfort;
    L.food = clamp(L.food - hrs * 4); L.energy = clamp(L.energy - hrs * 3);
    L.happy = clamp(L.happy + (50 + comfort * 4 - L.happy) * Math.min(1, hrs * 0.03));
    if (L.food < 15) L.health = clamp(L.health - hrs * 2); else if (L.food > 50 && L.energy > 30) L.health = clamp(L.health + hrs * 0.5);
    L.t = t; S.store.touch('users');
  }
  if (L.course && L.course.until <= t) { const e = EDU_BY.get(L.course.id); if (e && !L.edu.includes(e.id)) L.edu.push(e.id); logIt(L, '🎓', `${e ? e.n[0] : 'Course'} finished`, `${e ? e.n[1] : 'Curso'} terminado`); L.course = null; prog.award(u, 'life'); S.store.touch('users'); }
  return L;
}
function logIt(L, icon, en, es) { L.log.unshift({ t: now(), icon, m: [en, es] }); if (L.log.length > 30) L.log.length = 30; }
const eduPay = (L) => L.edu.reduce((a, id) => a + ((EDU_BY.get(id) || {}).pay || 0), 0);
const carPay = (L) => (L.car ? (CAR_BY.get(L.car) || {}).pay || 0 : 0);
// salary multiplier used by Work: education + vehicle, and how you feel (tired or hungry = less productive)
function workMult(u) {
  if (!u || !u.life) return 1; const L = life(u);
  let m = 1 + eduPay(L) + carPay(L);
  if (L.energy < 15 || L.food < 10) m *= 0.75; else if (L.happy >= 80 && L.health >= 70) m *= 1.05;
  return m;
}
// a work shift tires you a little
function afterShift(u) { if (!u || !u.life) return; const L = life(u); L.energy = clamp(L.energy - 8); L.food = clamp(L.food - 6); S.store.touch('users'); }
function pendingRent(L) { const days = (now() - (L.rentAt || now())) / DAY; let sum = 0; for (const id of Object.keys(L.rented)) { const h = HOME_BY.get(id); if (h) sum += h.price * RENT_RATE * days; } return Math.floor(sum); }
function score(L) { const homeV = L.homes.reduce((a, id) => a + ((HOME_BY.get(id) || {}).price || 0), 0); const carV = L.cars.reduce((a, id) => a + ((CAR_BY.get(id) || {}).price || 0), 0); const sk = Object.values(L.skills).reduce((a, b) => a + b, 0); return Math.round((L.energy + L.food + L.health + L.happy) / 4 * 10 + L.edu.length * 400 + Math.sqrt(homeV + carV) + sk * 5); }
function view(u) {
  const L = life(u); const t = now();
  return {
    needs: { energy: L.energy, food: L.food, health: L.health, happy: L.happy },
    score: score(L), born: L.born, home: L.home, homes: L.homes, rented: Object.keys(L.rented), rentDue: pendingRent(L), rentPerDay: Math.floor(Object.keys(L.rented).reduce((a, id) => a + ((HOME_BY.get(id) || {}).price || 0) * RENT_RATE, 0)),
    car: L.car, cars: L.cars, edu: L.edu, course: L.course, skills: L.skills, workMult: Math.round(workMult(u) * 100) / 100, eduPay: eduPay(L), carPay: carPay(L),
    acts: ACTS.map((a) => ({ id: a.id, n: a.n, icon: a.icon, price: a.price, fx: a.fx, cd: a.cd, readyAt: (L.cds[a.id] || 0) + a.cd, skill: a.skill })),
    HOMES, CARS, EDU, SKILLS, rentRate: RENT_RATE, log: L.log.slice(0, 15), coins: u.coins, now: t,
  };
}
function act(u, id) {
  const a = ACT_BY.get(id); if (!a) throw new HttpError(404, 'no_action', 'Unknown action');
  const L = life(u); const t = now();
  if ((L.cds[a.id] || 0) + a.cd > t) throw new HttpError(429, 'cooldown', 'Not yet — try again later');
  if ((a.fx.energy || 0) < 0 && L.energy + a.fx.energy < 0) throw new HttpError(400, 'tired', 'You are too tired. Sleep or have a coffee first.');
  if (a.price && !econ.adjust(u, -a.price, 'life:' + a.id)) throw new HttpError(402, 'no_coins', 'Not enough coins');
  const comfort = (HOME_BY.get(L.home) || HOMES[0]).comfort;
  for (const [k, v] of Object.entries(a.fx)) L[k] = clamp(L[k] + (v > 0 && (a.id === 'sleep' || a.id === 'nap') ? v * (1 + comfort * 0.08) : v));
  if (a.skill) L.skills[a.skill] = Math.min(100, (L.skills[a.skill] || 0) + 1);
  if (a.skill === 'fitness') L.health = clamp(L.health + (L.skills.fitness || 0) * 0.05);
  L.cds[a.id] = t; logIt(L, a.icon, a.n[0], a.n[1]); S.store.touch('users'); prog.award(u, 'life');
  return view(u);
}
function buyHome(u, id) {
  const x = HOME_BY.get(id); if (!x) throw new HttpError(404, 'no_home', 'Unknown property'); const L = life(u);
  if (L.homes.includes(id)) throw new HttpError(400, 'owned', 'You already own it');
  if (!econ.adjust(u, -x.price, 'life:home:' + id)) throw new HttpError(402, 'no_coins', 'Not enough coins');
  L.homes.push(id); collectRent(u, true); logIt(L, x.icon, 'Bought: ' + x.n[0], 'Comprado: ' + x.n[1]); S.store.touch('users'); prog.award(u, 'life');
  return view(u);
}
function moveIn(u, id) { const L = life(u); if (!L.homes.includes(id)) throw new HttpError(400, 'not_owned', 'You do not own that property'); collectRent(u, true); delete L.rented[id]; L.home = id; S.store.touch('users'); return view(u); }
function toggleRent(u, id) {
  const L = life(u); const x = HOME_BY.get(id); if (!x || !L.homes.includes(id)) throw new HttpError(400, 'not_owned', 'You do not own that property');
  if (L.home === id) throw new HttpError(400, 'living', 'You live there. Move to another home first.'); if (!x.price) throw new HttpError(400, 'no_rent', 'Nobody rents a shared room');
  collectRent(u, true); if (L.rented[id]) delete L.rented[id]; else L.rented[id] = now(); S.store.touch('users'); return view(u);
}
function collectRent(u, silent) {
  const L = life(u); const due = pendingRent(L); L.rentAt = now();
  if (due > 0) { econ.adjust(u, due, 'life:rent'); if (!silent) logIt(L, '🏦', `Rent collected: ${due}`, `Alquiler cobrado: ${due}`); }
  S.store.touch('users'); return due;
}
function buyCar(u, id) {
  const x = CAR_BY.get(id); if (!x) throw new HttpError(404, 'no_car', 'Unknown vehicle'); const L = life(u);
  if (L.cars.includes(id)) { L.car = id; S.store.touch('users'); return view(u); }
  if (!econ.adjust(u, -x.price, 'life:car:' + id)) throw new HttpError(402, 'no_coins', 'Not enough coins');
  L.cars.push(id); if (!L.car || (CAR_BY.get(L.car) || {}).pay < x.pay) L.car = id; L.happy = clamp(L.happy + 15); logIt(L, x.icon, 'New vehicle: ' + x.n[0], 'Vehículo nuevo: ' + x.n[1]); S.store.touch('users'); prog.award(u, 'life');
  return view(u);
}
function study(u, id) {
  const e = EDU_BY.get(id); if (!e) throw new HttpError(404, 'no_course', 'Unknown course'); const L = life(u);
  if (L.edu.includes(id)) throw new HttpError(400, 'done', 'You already finished it');
  if (L.course) throw new HttpError(400, 'busy', 'You are already studying');
  if (e.i > 0 && !L.edu.includes(EDU[e.i - 1].id)) throw new HttpError(400, 'locked', 'Finish the previous level first');
  if (e.price && !econ.adjust(u, -e.price, 'life:edu:' + id)) throw new HttpError(402, 'no_coins', 'Not enough coins');
  // knowledge shortens study time (up to −30 %)
  const ms = e.hours * HOUR * (1 - Math.min(0.3, (L.skills.knowledge || 0) / 100 * 0.6));
  L.course = { id, start: now(), until: now() + Math.round(ms) }; logIt(L, e.icon, 'Started: ' + e.n[0], 'Empezado: ' + e.n[1]); S.store.touch('users');
  return view(u);
}

module.exports = function register(r) {
  const opt = { auth: true, verified: true, limit: [60, 60000, 'user'] };
  r.get('/api/life', { auth: true, limit: [120, 60000, 'user'] }, async (c) => view(c.user));
  r.post('/api/life/act', opt, async (c) => act(c.user, String(c.body.id || '')));
  r.post('/api/life/home/buy', opt, async (c) => buyHome(c.user, String(c.body.id || '')));
  r.post('/api/life/home/move', opt, async (c) => moveIn(c.user, String(c.body.id || '')));
  r.post('/api/life/home/rent', opt, async (c) => toggleRent(c.user, String(c.body.id || '')));
  r.post('/api/life/rent/collect', opt, async (c) => { const n = collectRent(c.user); return Object.assign(view(c.user), { collected: n }); });
  r.post('/api/life/car', opt, async (c) => buyCar(c.user, String(c.body.id || '')));
  r.post('/api/life/study', opt, async (c) => study(c.user, String(c.body.id || '')));
  r.get('/api/life/top', { auth: true, limit: [30, 60000, 'user'] }, async () => {
    const rows = Object.values(S.users).filter((u) => u.life && !u.deleted && !u.banned).map((u) => ({ u, s: score(u.life) })).sort((a, b) => b.s - a.s).slice(0, 20);
    return { top: rows.map(({ u, s }) => ({ username: u.username, displayName: u.displayName || u.username, score: s, home: u.life.home })) };
  });
};
module.exports.workMult = workMult;
module.exports.afterShift = afterShift;

'use strict';
// Advantages bought with virtual coins (beyond cosmetics):
//   boosts   — timed effects (double XP, overtime pay, casino cashback, motivated staff, lucky daily wheel, Nova turbo)
//   upgrades — permanent levels (extra cloud storage, longer staff shifts, bigger bank vault)
//   bank     — a savings account that pays interest every hour (0.5 % a day), withdraw any time
// Casino odds are never changed: the cashback is paid after a losing round, outside the provably fair result.
const { S, hub } = require('./state');
const { HttpError, now } = require('./util');

const HOUR = 3600000; const DAY = 24 * HOUR;
const BOOSTS = [
  { id: 'xp2', icon: '⚡', n: ['Double XP', 'XP doble'], d: ['Every action gives twice the XP.', 'Cada acción da el doble de XP.'], price: 15000, hours: 24 },
  { id: 'work', icon: '💼', n: ['Overtime pay', 'Horas extra'], d: ['+50% pay on every work shift.', '+50 % de sueldo en cada turno de trabajo.'], price: 12000, hours: 24 },
  { id: 'staff', icon: '🚀', n: ['Motivated staff', 'Plantilla motivada'], d: ['Your staff earn 50% more per hour.', 'Tus empleados ganan un 50 % más por hora.'], price: 20000, hours: 24 },
  { id: 'cashback', icon: '🛡️', n: ['Casino cashback', 'Reembolso del casino'], d: ['Get 5% of every casino loss back, instantly.', 'Recupera al instante el 5 % de cada pérdida en el casino.'], price: 25000, hours: 24 },
  { id: 'daily', icon: '🎡', n: ['Lucky wheel', 'Ruleta de la suerte'], d: ['Your daily reward pays double.', 'Tu recompensa diaria paga el doble.'], price: 8000, hours: 72 },
  { id: 'nova', icon: '🧠', n: ['Nova turbo', 'Nova turbo'], d: ['+40 Nova AI messages per day.', '+40 mensajes diarios con Nova IA.'], price: 6000, hours: 24 },
  { id: 'arena', icon: '🎯', n: ['Arena booster', 'Potenciador Arena'], d: ['+50% coins in Nebulix Arena and a higher daily cap (4,500).', '+50 % de monedas en Nebulix Arena y un límite diario mayor (4.500).'], price: 9000, hours: 24 },
  { id: 'vip', icon: '👑', n: ['VIP lounge', 'Sala VIP'], d: ['All boosts above at once, at a discount.', 'Todas las mejoras de arriba a la vez, con descuento.'], price: 70000, hours: 24, all: true },
];
const BOOST_BY = new Map(BOOSTS.map((b) => [b.id, b]));
const UPGRADES = [
  { id: 'storage', icon: '☁️', n: ['Cloud storage', 'Almacenamiento en la nube'], d: ['+1 GB for Drive, Hub, Clips and Code per level.', '+1 GB para Drive, Hub, Clips y Code por nivel.'], base: 50000, max: 10 },
  { id: 'shift', icon: '⏱️', n: ['Longer shifts', 'Turnos más largos'], d: ['Staff keep earning 3 more hours before you must collect.', 'Los empleados siguen ganando 3 horas más antes de recoger.'], base: 40000, max: 4 },
  { id: 'vault', icon: '🏦', n: ['Bigger vault', 'Cámara más grande'], d: ['+1 million coins of bank capacity per level.', '+1 millón de monedas de capacidad en el banco por nivel.'], base: 60000, max: 10 },
];
const UPG_BY = new Map(UPGRADES.map((x) => [x.id, x]));
const upgPrice = (x, lvl) => require('./market').price(Math.round(x.base * Math.pow(1.6, lvl)));
const bPrice = (x) => require('./market').price(x.price);
const BANK_RATE = 0.005; // per day
const BANK_BASE = 2_000_000;

const boosts = (u) => (u.boosts = u.boosts || {});
const level = (u, id) => ((u.upg || {})[id] || 0);
function active(u, id) {
  if (!u || !u.boosts) return false; const t = now();
  return (u.boosts[id] || 0) > t || (u.boosts.vip || 0) > t;
}
const vaultCap = (u) => BANK_BASE + level(u, 'vault') * 1_000_000;
function bank(u) {
  const b = (u.bank = u.bank || { bal: 0, t: now(), earned: 0 });
  const t = now(); const days = (t - b.t) / DAY;
  if (b.bal > 0 && days > 0) { const i = Math.floor(b.bal * BANK_RATE * days); if (i >= 1) { b.bal = Math.min(vaultCap(u), b.bal + i); b.earned = (b.earned || 0) + i; b.t = t; S.store.touch('users'); } }
  else b.t = t;
  return b;
}
function view(u) {
  const t = now(); const b = bank(u);
  return {
    boosts: BOOSTS.map((x) => ({ id: x.id, icon: x.icon, n: x.n, d: x.d, price: bPrice(x), base: x.price, hours: x.hours, all: !!x.all, until: Math.max(0, (boosts(u)[x.id] || 0) - t) > 0 ? boosts(u)[x.id] : 0, on: active(u, x.id) })),
    upgrades: UPGRADES.map((x) => ({ id: x.id, icon: x.icon, n: x.n, d: x.d, level: level(u, x.id), max: x.max, price: level(u, x.id) >= x.max ? null : upgPrice(x, level(u, x.id)) })),
    bank: { bal: b.bal, earned: b.earned || 0, cap: vaultCap(u), rate: BANK_RATE, perDay: Math.floor(b.bal * BANK_RATE) },
    coins: u.coins, index: require('./market').index(),
  };
}
function buyBoost(u, id) {
  const x = BOOST_BY.get(id); if (!x) throw new HttpError(404, 'no_boost', 'Unknown boost');
  if (!require('./economy').adjust(u, -bPrice(x), 'boost:' + id)) throw new HttpError(402, 'no_coins', 'Not enough coins');
  const b = boosts(u); const t = now(); b[id] = Math.max(b[id] || 0, t) + x.hours * HOUR; // buying again extends it
  S.store.touch('users'); hub.push(u.id, { t: 'notice', text: `${x.icon} ${x.n[0]} active` });
  return view(u);
}
function buyUpgrade(u, id) {
  const x = UPG_BY.get(id); if (!x) throw new HttpError(404, 'no_upgrade', 'Unknown upgrade');
  const lvl = level(u, id); if (lvl >= x.max) throw new HttpError(400, 'maxed', 'Already at the maximum level');
  if (!require('./economy').adjust(u, -upgPrice(x, lvl), 'upgrade:' + id)) throw new HttpError(402, 'no_coins', 'Not enough coins');
  u.upg = u.upg || {}; u.upg[id] = lvl + 1; S.store.touch('users');
  return view(u);
}
function deposit(u, amount) {
  amount = Math.trunc(Number(amount)); if (!(amount >= 1)) throw new HttpError(400, 'bad_amount', 'Enter an amount');
  const b = bank(u); const room = vaultCap(u) - b.bal; if (room <= 0) throw new HttpError(400, 'vault_full', 'Your vault is full — upgrade it to save more');
  amount = Math.min(amount, room);
  if (!require('./economy').adjust(u, -amount, 'bank:deposit')) throw new HttpError(402, 'no_coins', 'Not enough coins');
  b.bal += amount; b.t = now(); S.store.touch('users'); return view(u);
}
function withdraw(u, amount) {
  const b = bank(u); amount = amount === 'all' ? b.bal : Math.trunc(Number(amount)); if (!(amount >= 1)) throw new HttpError(400, 'bad_amount', 'Enter an amount');
  if (amount > b.bal) throw new HttpError(400, 'too_much', 'You do not have that much in the bank');
  b.bal -= amount; b.t = now(); require('./economy').adjust(u, amount, 'bank:withdraw'); S.store.touch('users'); return view(u);
}
// hooks used by the rest of the server
const xpMult = (u) => (active(u, 'xp2') ? 2 : 1);
const workMult = (u) => (active(u, 'work') ? 1.5 : 1);
const staffMult = (u) => (active(u, 'staff') ? 1.5 : 1);
const dailyMult = (u) => (active(u, 'daily') ? 2 : 1);
const novaExtra = (u) => (active(u, 'nova') ? 40 : 0);
const extraStorage = (u) => level(u, 'storage') * 1024 ** 3;
const extraShift = (u) => level(u, 'shift') * 3;
function cashback(u, net) {
  if (!(net < 0) || !active(u, 'cashback')) return 0;
  const back = Math.floor(-net * 0.05); if (back >= 1) require('./economy').adjust(u, back, 'casino:cashback');
  return back;
}
module.exports = { BOOSTS, UPGRADES, view, buyBoost, buyUpgrade, deposit, withdraw, active, xpMult, workMult, staffMult, dailyMult, novaExtra, extraStorage, extraShift, cashback, bank };

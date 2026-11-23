'use strict';
// Nebulix 13 — the live economy ("market script").
// Every hour it reads the whole coin economy:
//   · supply: all coins in wallets + bank
//   · median and top-10 % wealth of real players
//   · coins created vs destroyed in the last 24 h (from every player's ledger)
//   · what people are buying (demand per item, decaying over a few days)
// and turns that into a price index between ×0.75 and ×1.5 that moves slowly (at most 4 % per hour).
// When players are rich and coins pour in faster than they are spent, prices go up (inflation);
// when the economy is tight, prices go down. Popular items cost a bit more, unpopular ones go on sale.
// Every price in the Market, the Advantages and the daily Shop goes through price().
const { S } = require('./state');
const { now } = require('./util');

const HOUR = 3600000; const DAY = 24 * HOUR;
const BASE_MEDIAN = 25000;         // wealth of a "normal" player at index 1.0
const MIN = 0.75, MAX = 1.5, STEP = 0.04;
// ledger reasons that only move coins around (they are not created or destroyed)
const NEUTRAL = new Set(['bank', 'transfer', 'gems']);

const st = () => {
  const m = (S.meta.market = S.meta.market || {});
  if (!Number.isFinite(m.idx)) m.idx = 1; m.hist = Array.isArray(m.hist) ? m.hist : []; m.demand = m.demand && typeof m.demand === 'object' ? m.demand : {};
  return m;
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function analyze() {
  const t = now(); const users = Object.values(S.users).filter((u) => u && !u.deleted && !u.infinite);
  const bal = users.map((u) => (u.coins || 0) + ((u.bank && u.bank.bal) || 0)).sort((a, b) => a - b);
  const supply = bal.reduce((a, b) => a + b, 0);
  const at = (q) => (bal.length ? bal[Math.min(bal.length - 1, Math.floor(bal.length * q))] : 0);
  // Gini coefficient: 0 = everyone has the same, 1 = one player has everything
  let gini = 0; if (bal.length > 1 && supply > 0) { let acc = 0; bal.forEach((b, i) => { acc += (2 * (i + 1) - bal.length - 1) * b; }); gini = acc / (bal.length * supply); }
  let minted = 0, burned = 0, active = 0; const sources = {}, sinks = {};
  for (const u of users) {
    let act = false;
    for (const x of u.tx || []) {
      if (t - x.t > DAY) break; act = true; const k = String(x.r || 'other').split(':')[0]; if (NEUTRAL.has(k)) continue;
      if (x.d > 0) { minted += x.d; sources[k] = (sources[k] || 0) + x.d; } else { burned -= x.d; sinks[k] = (sinks[k] || 0) - x.d; }
    }
    if (act) active++;
  }
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => ({ k, v }));
  return { t, players: users.length, active, supply, median: at(0.5), p90: at(0.9), gini: Math.round(gini * 1000) / 1000, minted, burned, sources: top(sources), sinks: top(sinks) };
}

// one step of the index (called every hour, and once at start)
function update() {
  const m = st(); const a = analyze();
  const wealth = a.median > 0 ? a.median / BASE_MEDIAN : 0.4;
  const flow = clamp((a.minted + 1000) / (a.burned + 1000), 0.25, 4);
  // the player Marketplace counts too: when players pay more than the shops ask, cosmetics are scarce (prices go up)
  let tr = null; try { const T = require('./trade'); T.sweep(); tr = T.summary(); } catch (e) { console.error('[market] trade', e); }
  const tradeK = tr && tr.sold7 >= 5 ? Math.pow(clamp(tr.tradeIndex, 0.6, 1.6), 0.15) : 1; m.trade = tr;
  const raw = clamp(Math.pow(Math.max(0.02, wealth), 0.12) * Math.pow(flow, 0.18) * tradeK, MIN, MAX);
  m.raw = Math.round(raw * 1000) / 1000;
  m.idx = Math.round(clamp(m.idx + clamp(raw - m.idx, -STEP, STEP), MIN, MAX) * 1000) / 1000;
  m.snap = a; m.last = a.t;
  m.hist.push({ t: a.t, i: m.idx, med: a.median, sup: a.supply, mi: a.minted, bu: a.burned });
  if (m.hist.length > 24 * 14) m.hist.splice(0, m.hist.length - 24 * 14);
  // demand fades: half-life about 3 days
  const k = Math.pow(0.5, 1 / 72); for (const id of Object.keys(m.demand)) { m.demand[id] *= k; if (m.demand[id] < 0.05) delete m.demand[id]; }
  S.store.touch('meta');
  return m;
}

// popular items cost up to 20 % more, items nobody buys up to 15 % less
function demandMult(id) {
  const d = st().demand; const v = d[id] || 0; if (!id) return 1;
  const vals = Object.values(d); const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  if (!avg) return 1; return clamp(1 + (v - avg) / (avg * 10), 0.85, 1.2);
}
const nice = (p) => (p >= 10000 ? Math.round(p / 100) * 100 : p >= 1000 ? Math.round(p / 10) * 10 : p >= 100 ? Math.round(p / 5) * 5 : Math.max(1, Math.round(p)));
function price(base, id) { if (!(base > 0)) return 0; return nice(base * st().idx * (id ? demandMult(id) : 1)); }
function demand(id, n = 1) { const d = st().demand; d[id] = (d[id] || 0) + n; S.store.touch('meta'); }
const index = () => st().idx;

function mood(i) { return i >= 1.25 ? ['High inflation', 'Inflación alta'] : i >= 1.08 ? ['Prices rising', 'Precios al alza'] : i > 0.95 ? ['Stable', 'Estable'] : i > 0.85 ? ['Prices falling', 'Precios a la baja'] : ['Bargain time', 'Época de chollos']; }
function publicView(full) {
  const m = st(); const a = m.snap || analyze();
  const hist = m.hist.filter((_, i, arr) => i % 3 === 0 || i === arr.length - 1).slice(-112).map((x) => [x.t, x.i]);
  let trade = m.trade || null; try { trade = require('./trade').summary(); } catch {}
  const out = { trade, idx: m.idx, raw: m.raw || m.idx, mood: mood(m.idx), hist, players: a.players, active: a.active, median: a.median, minted: a.minted, burned: a.burned, updated: m.last || 0, next: (m.last || now()) + HOUR };
  if (full) Object.assign(out, { supply: a.supply, p90: a.p90, gini: a.gini, sources: a.sources, sinks: a.sinks, demand: Object.entries(m.demand).sort((x, y) => y[1] - x[1]).slice(0, 12).map(([id, v]) => ({ id, v: Math.round(v * 10) / 10 })), base: BASE_MEDIAN, range: [MIN, MAX] });
  return out;
}

let timer = null;
function start() {
  if (timer) return; try { const m = st(); if (!m.last || now() - m.last > HOUR) update(); } catch (e) { console.error('[market]', e); }
  timer = setInterval(() => { try { update(); require('./ranked').tick(); } catch (e) { console.error('[market] tick', e); } }, HOUR); if (timer.unref) timer.unref();
}
module.exports = { analyze, update, price, demand, index, publicView, start, mood };

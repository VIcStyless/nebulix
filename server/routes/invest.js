'use strict';
// Investments: a simulated portfolio priced with real stock quotes (Yahoo Finance chart API, fetched server-side
// and cached). 1 virtual coin = 1 USD of price. Nothing is real money: no deposits, no withdrawals.
const { S } = require('../state');
const econ = require('../economy');
const prog = require('../progress');
const { HttpError, now } = require('../util');

const STOCKS = [['AAPL', 'Apple'], ['NVDA', 'NVIDIA'], ['MSFT', 'Microsoft'], ['GOOGL', 'Alphabet (Google)'], ['AMZN', 'Amazon'], ['TSLA', 'Tesla'], ['META', 'Meta']];
// Crypto (virtual, 24/7): priced with the same public quote feed (BTC-USD …). Coins stay virtual; nothing is bought for real.
const CRYPTO = [['BTC-USD', 'Bitcoin'], ['ETH-USD', 'Ethereum'], ['SOL-USD', 'Solana'], ['BNB-USD', 'BNB'], ['XRP-USD', 'XRP'], ['ADA-USD', 'Cardano'], ['DOGE-USD', 'Dogecoin'], ['LTC-USD', 'Litecoin'], ['AVAX-USD', 'Avalanche'], ['DOT-USD', 'Polkadot']];
const SYM = new Map([...STOCKS, ...CRYPTO]);
const IS_CRYPTO = new Set(CRYPTO.map((x) => x[0]));
const px = (v) => (v >= 10 ? Math.round(v * 100) / 100 : Math.round(v * 1e6) / 1e6);
const RANGES = { '1d': ['1d', '5m'], '5d': ['5d', '30m'], '1mo': ['1mo', '1d'], '6mo': ['6mo', '1d'], '1y': ['1y', '1wk'] };
const QUOTE_TTL = 60000; const CHART_TTL = 5 * 60000; const STALE = 30 * 60000;
const quotes = new Map(); const charts = new Map(); const inflight = new Map();

async function yahoo(sym, range, interval) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}&includePrePost=false`;
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Nebulix virtual market)', Accept: 'application/json' }, signal: ctl.signal });
    if (!r.ok) throw new Error('quote service ' + r.status);
    const j = await r.json(); const res = j && j.chart && j.chart.result && j.chart.result[0];
    if (!res || !res.meta) throw new Error('no data');
    return res;
  } finally { clearTimeout(to); }
}
function once(key, fn) { if (inflight.has(key)) return inflight.get(key); const p = fn().finally(() => inflight.delete(key)); inflight.set(key, p); return p; }

async function quote(sym) {
  const c = quotes.get(sym); if (c && now() - c.fetched < QUOTE_TTL) return c;
  try {
    return await once('q:' + sym, async () => {
      const res = await yahoo(sym, '1d', '5m'); const m = res.meta;
      const price = Number(m.regularMarketPrice); const prev = Number(m.chartPreviousClose || m.previousClose);
      if (!Number.isFinite(price) || price <= 0) throw new Error('bad price');
      const q = { sym, name: SYM.get(sym), price: px(price), kind: IS_CRYPTO.has(sym) ? 'crypto' : 'stock', short: sym.replace('-USD', ''), prev: Number.isFinite(prev) ? prev : price, change: Number.isFinite(prev) && prev ? Math.round(((price - prev) / prev) * 10000) / 100 : 0, time: (m.regularMarketTime || 0) * 1000, currency: m.currency || 'USD', fetched: now(), live: true };
      quotes.set(sym, q); return q;
    });
  } catch (e) {
    if (c) return Object.assign({}, c, { live: false });
    throw new HttpError(503, 'quotes_down', 'Live quotes are unavailable right now. Try again in a minute.');
  }
}
async function chart(sym, range) {
  const key = sym + ':' + range; const c = charts.get(key); if (c && now() - c.fetched < CHART_TTL) return c;
  try {
    return await once('c:' + key, async () => {
      const [rg, iv] = RANGES[range]; const res = await yahoo(sym, rg, iv);
      const ts = res.timestamp || []; const cl = (res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close) || [];
      const pts = []; for (let i = 0; i < ts.length; i++) if (Number.isFinite(cl[i])) pts.push([ts[i] * 1000, px(cl[i])]);
      const out = { sym, range, pts, fetched: now() }; charts.set(key, out); return out;
    });
  } catch { if (c) return c; throw new HttpError(503, 'quotes_down', 'Chart data is unavailable right now.'); }
}

function pf(u) { u.invest = u.invest || { h: {}, hist: [], realized: 0 }; return u.invest; }
const round4 = (x) => Math.round(x * 10000) / 10000;

async function portfolio(u) {
  const p = pf(u); const rows = [];
  let value = 0, cost = 0;
  for (const [sym, hd] of Object.entries(p.h)) {
    if (!(hd.q > 0)) continue;
    let q = null; try { q = await quote(sym); } catch {}
    const price = q ? q.price : null; const v = price !== null ? hd.q * price : null;
    if (v !== null) value += v; cost += hd.cost;
    rows.push({ sym, short: sym.replace('-USD', ''), kind: IS_CRYPTO.has(sym) ? 'crypto' : 'stock', name: SYM.get(sym), q: hd.q, cost: Math.round(hd.cost), avg: hd.q ? px(hd.cost / hd.q) : 0, price, value: v !== null ? Math.round(v) : null, pl: v !== null ? Math.round(v - hd.cost) : null });
  }
  return { rows, value: Math.round(value), cost: Math.round(cost), pl: Math.round(value - cost), realized: Math.round(p.realized || 0), hist: p.hist.slice(0, 40), coins: u.coins };
}

// Market minigames (Arcade → Stocks): playing pays out in shares of a real stock, not coins. Capped per day.
const GAME_DAY_CAP = 3000; // coin value of shares per day
function gameReward(u, sym, score, ms) {
  score = Math.trunc(Number(score)); ms = Math.trunc(Number(ms));
  if (!Number.isFinite(score) || score < 0 || !Number.isFinite(ms) || ms < 15000 || ms > 200000) throw new HttpError(400, 'bad_score', 'Bad game result');
  if (score > (ms / 1000) * 12) throw new HttpError(400, 'bad_score', 'That score is not plausible');
  const d = (u.stockGame = u.stockGame && u.stockGame.d === new Date().toISOString().slice(0, 10) ? u.stockGame : { d: new Date().toISOString().slice(0, 10), v: 0 });
  const value = Math.max(0, Math.min(score * 4, 800, GAME_DAY_CAP - d.v));
  return { value, d };
}

module.exports = function register(r) {
  r.post('/api/invest/game', { auth: true, verified: true, limit: [12, 60000, 'user'] }, async (c) => {
    const u = c.user; const sym = String(c.body.sym || '').toUpperCase(); if (!SYM.has(sym) || IS_CRYPTO.has(sym)) throw new HttpError(404, 'no_stock', 'Unknown stock');
    const { value, d } = gameReward(u, sym, c.body.score, c.body.ms);
    prog.award(u, 'stockgame');
    if (value <= 0) return { shares: 0, value: 0, capped: true, left: 0 };
    const q = await quote(sym); const qty = round4(value / q.price);
    if (qty <= 0) return { shares: 0, value: 0, capped: false, left: GAME_DAY_CAP - d.v };
    const p = pf(u); const hd = (p.h[sym] = p.h[sym] || { q: 0, cost: 0 });
    hd.q = round4(hd.q + qty); hd.cost += value; d.v += value;
    p.hist.unshift({ t: now(), sym, side: 'game', q: qty, price: q.price, coins: 0 }); if (p.hist.length > 100) p.hist.length = 100;
    S.store.touch('users');
    return { sym, shares: qty, value, price: q.price, left: GAME_DAY_CAP - d.v };
  });
  r.get('/api/invest/market', { auth: true, limit: [60, 60000, 'user'] }, async () => {
    const list = await Promise.all([...STOCKS, ...CRYPTO].map(async ([sym, name]) => { try { const q = await quote(sym); return q; } catch { return { sym, name, price: null, change: 0, live: false, kind: IS_CRYPTO.has(sym) ? 'crypto' : 'stock', short: sym.replace('-USD', '') }; } }));
    return { stocks: list, note: 'Real market prices, simulated trading. 1 coin = 1 USD of price. Virtual coins have no real value.' };
  });
  r.get('/api/invest/chart/:sym', { auth: true, limit: [90, 60000, 'user'] }, async (c) => {
    const sym = String(c.params.sym).toUpperCase(); if (!SYM.has(sym)) throw new HttpError(404, 'no_stock', 'Unknown stock');
    const range = RANGES[c.query.range] ? c.query.range : '1mo';
    return chart(sym, range);
  });
  r.get('/api/invest/portfolio', { auth: true, limit: [60, 60000, 'user'] }, async (c) => portfolio(c.user));

  r.post('/api/invest/trade', { auth: true, verified: true, limit: [40, 60000, 'user'] }, async (c) => {
    const u = c.user; const sym = String(c.body.sym || '').toUpperCase(); const side = c.body.side === 'sell' ? 'sell' : c.body.side === 'buy' ? 'buy' : null;
    if (!SYM.has(sym)) throw new HttpError(404, 'no_stock', 'Unknown stock');
    if (!side) throw new HttpError(400, 'bad_side', 'Buy or sell');
    const qty = round4(Number(c.body.qty));
    if (!Number.isFinite(qty) || qty < 0.0001 || qty > (IS_CRYPTO.has(sym) ? 1e9 : 1e6)) throw new HttpError(400, 'bad_qty', 'Enter a quantity of at least 0.0001 shares');
    const q = await quote(sym);
    if (!q.live && now() - q.fetched > STALE) throw new HttpError(503, 'stale', 'Prices are out of date. Try again shortly.');
    const p = pf(u); const hd = (p.h[sym] = p.h[sym] || { q: 0, cost: 0 });
    let coins;
    if (side === 'buy') {
      coins = Math.ceil(qty * q.price); if (coins < 1) throw new HttpError(400, 'too_small', 'That order is too small');
      if (!econ.adjust(u, -coins, 'invest:buy:' + sym)) throw new HttpError(402, 'no_funds', 'Not enough coins');
      hd.q = round4(hd.q + qty); hd.cost += coins;
    } else {
      if (qty > hd.q + 1e-9) throw new HttpError(400, 'no_shares', 'You do not own that many shares');
      coins = Math.floor(qty * q.price); const basis = hd.q ? hd.cost * (qty / hd.q) : 0;
      hd.q = round4(hd.q - qty); hd.cost = hd.q > 0 ? hd.cost - basis : 0; p.realized = (p.realized || 0) + (coins - basis);
      if (coins > 0) econ.adjust(u, coins, 'invest:sell:' + sym);
      if (hd.q <= 0) delete p.h[sym];
    }
    p.hist.unshift({ t: now(), sym, side, q: qty, price: q.price, coins }); if (p.hist.length > 100) p.hist.length = 100;
    S.store.touch('users'); prog.award(u, 'trade');
    return Object.assign({ ok: true, side, sym, qty, price: q.price, coinsMoved: coins }, await portfolio(u));
  });
};
module.exports.quote = quote;

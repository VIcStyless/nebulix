// Casino, part 4 (Nebulix 13.7): Baccarat, Video Poker (Jacks or Better) and Hi-Lo.
// Same virtual coins and provably fair seeds as every other table; the server deals every card.
import { h, mount, fmt } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S, patchMe } from '../state.js';
import { sfx } from '../sfx.js';
import { betRow, sumBox, goBtn, coin } from './casino-more.js';

const snd = (k) => { try { sfx[k] && sfx[k](); } catch {} };
const mx = (m) => '×' + (Math.round(m * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
const red = (c) => c.s === '♥' || c.s === '♦';
const card = (c, i, extra = '') => h('div.cx-card' + (red(c) ? '.red' : '') + extra, { style: { '--i': i } }, h('span.cx-r', c.r), h('span.cx-s', c.s), h('span.cx-r2', c.r));
const back = (i) => h('div.cx-card.back', { style: { '--i': i } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function result(res, r, desc) {
  res.className = 'cs-result ' + (r.net > 0 ? 'win' : r.net < 0 ? 'lose' : '');
  mount(res, h('div', desc), h('b', r.net > 0 ? t('You won {n} coins!', { n: fmt.coins(r.payout) }) : r.net === 0 ? t('{n} coins returned.', { n: fmt.coins(r.payout) }) : t('You lost {n} coins.', { n: fmt.coins(-r.net) })));
}

// ================= BACCARAT =================
const SIDES = [['player', 'Player', 2], ['banker', 'Banker', 1.95], ['tie', 'Tie', 9]];
export function baccarat(env) {
  let side = 'player'; let busyNow = false;
  const pEl = h('div.cx-hand'); const bEl = h('div.cx-hand'); const pv = h('span.pill', '—'); const bv = h('span.pill', '—');
  const res = h('div.cs-result', h('span.muted', t('Bet on Player, Banker or a Tie. The hand closest to 9 wins.')));
  mount(env.stage, h('div.cx-table.cx-bac', h('div.cx-side', h('div.row', h('b', t('Player')), pv), pEl), h('div.cx-side', h('div.row', h('b', t('Banker')), bv), bEl)), res);
  async function deal() {
    if (busyNow || env.paused()) return; if (env.bet() > S.me.coins) return env.err(new Error(t('Not enough coins')));
    busyNow = true; env.hold(true); paintCtl(); mount(pEl, back(0), back(1)); mount(bEl, back(0), back(1)); pv.textContent = bv.textContent = '…';
    let r; try { r = await api.post('/api/casino/play/baccarat', { bet: env.bet(), side }); } catch (e) { busyNow = false; env.hold(false); paintCtl(); return env.err(e); }
    const R = r.result; const tot = (cs) => cs.reduce((a, c) => a + (c.r === 'A' ? 1 : ['10', 'J', 'Q', 'K'].includes(c.r) ? 0 : Number(c.r)), 0) % 10;
    // deal in the real order: P, B, P, B, then the third cards
    const order = [['p', 0], ['b', 0], ['p', 1], ['b', 1]].concat(R.player[2] ? [['p', 2]] : []).concat(R.banker[2] ? [['b', 2]] : []);
    const shown = { p: [], b: [] };
    for (const [who, i] of order) { shown[who].push((who === 'p' ? R.player : R.banker)[i]); mount(pEl, shown.p.map((c, k) => card(c, k))); mount(bEl, shown.b.map((c, k) => card(c, k))); pv.textContent = shown.p.length ? String(tot(shown.p)) : '—'; bv.textContent = shown.b.length ? String(tot(shown.b)) : '—'; snd('tick'); await wait(330); }
    const label = R.win === 'tie' ? t('Tie') : R.win === 'player' ? t('Player wins') : t('Banker wins');
    busyNow = false; env.hold(false); result(res, r, label + ' · ' + R.p + ' – ' + R.b); snd(r.net > 0 ? 'win' : 'lose');
    env.done(Object.assign(r, { desc: t('Baccarat') + ' · ' + label })); paintCtl();
  }
  function paintCtl() {
    const pay = SIDES.find((x) => x[0] === side)[2];
    mount(env.betBox, betRow(Object.assign({}, env, { onBet: paintCtl }), { disabled: busyNow }),
      h('div.cx-bac-sides', SIDES.map(([k, n, m]) => h('button.cx-bac-side' + (side === k ? '.on' : ''), { type: 'button', disabled: busyNow, onClick: () => { side = k; paintCtl(); } }, h('b', t(n)), h('span', mx(m))))),
      sumBox([[t('Payout on win'), coin(Math.floor(env.bet() * pay))], [t('On a tie'), side === 'tie' ? mx(9) : t('Bet returned')]]),
      env.pausedBox(), goBtn(t('Deal'), deal, busyNow || env.paused() || S.me.coins < 1, coin(env.bet())));
  }
  paintCtl();
  return () => {};
}

// ================= VIDEO POKER =================
const HANDS = { royal: 'Royal flush', sflush: 'Straight flush', four: 'Four of a kind', full: 'Full house', flush: 'Flush', straight: 'Straight', three: 'Three of a kind', twopair: 'Two pair', jacks: 'Jacks or better' };
const PAYS = [['royal', 800], ['sflush', 50], ['four', 25], ['full', 9], ['flush', 6], ['straight', 4], ['three', 3], ['twopair', 2], ['jacks', 1]];
export function videopoker(env) {
  let round = env.rounds().vp || null; let held = new Set(); let busyNow = false; let lastHand = null;
  const handEl = h('div.cx-hand.cx-vp'); const table = h('div.cx-vptable');
  const res = h('div.cs-result', h('span.muted', t('Deal 5 cards, hold the ones you want and draw once. A pair of Jacks or better pays.')));
  mount(env.stage, h('div.cx-vpwrap', table, handEl), res);
  const paintTable = (hl) => mount(table, PAYS.map(([k, m]) => h('div' + (hl === k ? '.on' : ''), h('span', t(HANDS[k])), h('b', mx(m)))));
  function paintHand(cards, done) {
    if (!cards) { mount(handEl, [0, 1, 2, 3, 4].map((i) => back(i))); return; }
    mount(handEl, cards.map((c, i) => h('button.cx-vpcard' + (held.has(i) ? '.held' : ''), { type: 'button', disabled: done || busyNow, onClick: () => { if (held.has(i)) held.delete(i); else held.add(i); snd('tick'); paintHand(cards, done); paintCtl(); } }, card(c, i), h('span.cx-hold', held.has(i) ? t('HELD') : ''))));
  }
  async function deal() {
    if (busyNow || env.paused()) return; busyNow = true; held = new Set(); paintCtl();
    try { const r = await api.post('/api/casino/videopoker/deal', { bet: env.bet() }); round = r.round; patchMe({ coins: r.balance }); env.paintBal(); snd('tick');
      res.className = 'cs-result'; mount(res, round.hand ? h('div', t('You were dealt: {h}', { h: t(HANDS[round.hand]) })) : h('span.muted', t('Pick the cards to hold, then draw.'))); paintTable(round.hand);
    } catch (e) { env.err(e); }
    busyNow = false; paintHand(round && round.cards, false); paintCtl();
  }
  async function draw() {
    if (!round || busyNow) return; busyNow = true; paintCtl();
    try {
      const r = await api.post('/api/casino/videopoker/draw', { held: [...held] });
      const old = round.cards; round = null; lastHand = r.round;
      for (let i = 0; i < 5; i++) if (!held.has(i)) { old[i] = r.round.cards[i]; paintHand(old, true); snd('tick'); await wait(140); }
      paintHand(r.round.cards, true); paintTable(r.hand);
      result(res, r, r.hand ? t(HANDS[r.hand]) + ' · ' + mx(r.mult) : t('No winning hand')); snd(r.net > 0 ? 'win' : 'lose');
      env.done(Object.assign({ game: 'videopoker', bet: r.round.bet, nonce: r.round.nonce }, r, { desc: t('Video Poker') + ' · ' + (r.hand ? t(HANDS[r.hand]) : t('No winning hand')) }));
    } catch (e) { env.err(e); }
    busyNow = false; paintCtl();
  }
  function paintCtl() {
    mount(env.betBox, round ? sumBox([[t('Bet'), coin(round.bet)], [t('Held'), held.size + ' / 5']]) : betRow(Object.assign({}, env, { onBet: paintCtl }), { disabled: busyNow }), env.pausedBox(),
      round ? goBtn(t('Draw'), draw, busyNow) : goBtn(t('Deal'), deal, busyNow || env.paused() || S.me.coins < 1, coin(env.bet())));
  }
  paintTable(round && round.hand); paintHand(round ? round.cards : lastHand && lastHand.cards, !round); paintCtl();
  return () => {};
}

// ================= HI-LO =================
export function hilo(env) {
  let round = env.rounds().hl || null; let busyNow = false;
  const trail = h('div.cx-hltrail'); const cur = h('div.cx-hlcur'); const multEl = h('div.cx-hlmult', '×1.00');
  const res = h('div.cs-result', h('span.muted', t('Guess if the next card is higher or lower (equal also wins). Cash out whenever you like.')));
  mount(env.stage, h('div.cx-hilo', h('div.cx-hltop', cur, multEl), trail), res);
  function paint(r, lostCard) {
    if (!r) { mount(cur, back(0)); mount(trail); multEl.textContent = '×1.00'; return; }
    const cs = r.cards; mount(cur, card(cs[cs.length - 1], 0, lostCard ? '.lost' : '')); mount(trail, cs.slice(0, -1).slice(-10).map((c, i) => card(c, i, '.mini')));
    multEl.textContent = mx(r.mult);
  }
  async function call(path, body) {
    if (busyNow) return; busyNow = true; paintCtl();
    try {
      const r = await api.post('/api/casino/hilo/' + path, body); snd('tick');
      if (r.lost || r.cashed) {
        round = null; paint(r.round, r.lost); result(res, r, r.lost ? t('Wrong guess') : t('Cashed out at {m}', { m: mx(r.mult) })); snd(r.lost ? 'lose' : 'win');
        env.done({ game: 'hilo', bet: r.round.bet, payout: r.payout, net: r.net, mult: r.mult, nonce: r.round.nonce, balance: r.balance, desc: t('Hi-Lo') + ' · ' + (r.lost ? t('Wrong guess') : mx(r.mult)) });
      } else { round = r.round; patchMe({ coins: r.balance }); env.paintBal(); paint(round); res.className = 'cs-result'; mount(res, h('span.muted', t('Next card: higher or lower?'))); }
    } catch (e) { env.err(e); }
    busyNow = false; paintCtl();
  }
  function paintCtl() {
    const pct = (p) => Math.round(p * 1000) / 10 + '%';
    mount(env.betBox, round ? sumBox([[t('Bet'), coin(round.bet)], [t('Multiplier'), mx(round.mult)], [t('Cash out now'), coin(Math.floor(round.bet * round.mult))]]) : betRow(Object.assign({}, env, { onBet: paintCtl }), { disabled: busyNow }),
      env.pausedBox(),
      round ? h('div.cx-hlbtns',
        h('button.btn.primary', { type: 'button', disabled: busyNow || !round.hi, onClick: () => call('guess', { dir: 'hi' }) }, '▲ ' + t('Higher or same'), round.hi ? h('small', ' ' + mx(round.hi) + ' · ' + pct(round.pHi)) : null),
        h('button.btn.primary', { type: 'button', disabled: busyNow || !round.lo, onClick: () => call('guess', { dir: 'lo' }) }, '▼ ' + t('Lower or same'), round.lo ? h('small', ' ' + mx(round.lo) + ' · ' + pct(round.pLo)) : null),
        h('div.row', { style: 'gap:8px' }, h('button.btn', { type: 'button', disabled: busyNow, onClick: () => call('guess', { dir: 'skip' }) }, t('Skip card')), h('button.btn.good', { type: 'button', disabled: busyNow || !round.steps, onClick: () => call('cashout') }, t('Cash out'))))
        : goBtn(t('Start'), () => call('start', { bet: env.bet() }), busyNow || env.paused() || S.me.coins < 1, coin(env.bet())));
  }
  paint(round); paintCtl();
  return () => {};
}

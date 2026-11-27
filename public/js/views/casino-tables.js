// Casino, part 4 (Nebulix 3.0): Dragon Tiger, Sic Bo, Craps and Tower. Same virtual coins (play money only) and the
// same provably fair seeds as every other table; the server decides every outcome, the client only animates it.
import { h, mount, fmt, ls } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S, patchMe } from '../state.js';
import { icon } from '../icons.js';
import { toast, segEl, field } from '../ui.js';
import { sfx } from '../sfx.js';
import { betRow, sumBox, goBtn, coin } from './casino-more.js';

const mx = (m) => '×' + (Math.round(m * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
const snd = (k) => { try { sfx[k] && sfx[k](); } catch {} };
const reduced = () => document.documentElement.dataset.reduce === '1' || matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, reduced() ? 0 : ms));
const red = (c) => c.s === '♥' || c.s === '♦';
const cardEl = (c, cls = '') => h('div.ct-card' + (c ? (red(c) ? '.red' : '') : '.back') + cls, c ? [h('b', c.r), h('span', c.s)] : null);
const DIE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const dieEl = (n, rolling) => h('div.ct-die' + (rolling ? '.roll' : ''), { 'aria-label': String(n) }, pips(n));
function pips(n) { const P = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }[n] || []; return Array.from({ length: 9 }, (_, i) => h('i' + (P.includes(i) ? '.on' : ''))); }
function result(res, r, label) {
  res.className = 'cs-result pop ' + (r.net > 0 ? 'win' : r.net === 0 ? '' : 'lose');
  mount(res, h('div', label), h('b', r.net > 0 ? t('You won {n} coins!', { n: fmt.coins(r.payout) }) : r.payout > 0 ? t('Returned {n} of {b}', { n: fmt.coins(r.payout), b: fmt.coins(r.bet) }) : t('You lost {n} coins.', { n: fmt.coins(r.bet) })));
  snd(r.net > 0 ? 'win' : r.net < 0 ? 'lose' : 'tick');
}
// one-shot games share the same flow: bet → server → animate → report
function oneShot(env, { game, body, animate, label }) {
  let busy = false;
  return async function go() {
    if (busy || env.paused()) return; if (env.bet() > S.me.coins) { toast(t('Not enough coins'), 'err'); return; }
    busy = true; env.hold(true);
    let r; try { r = await api.post('/api/casino/play/' + game, Object.assign({ bet: env.bet() }, body())); } catch (e) { busy = false; env.hold(false); env.err(e); return; }
    await animate(r); busy = false; env.hold(false);
    env.done(Object.assign(r, { desc: label(r) }));
  };
}

// ================= DRAGON TIGER =================
export function dragontiger(env) {
  let side = ls('casino.dt') || 'dragon';
  const dSlot = h('div.ct-slot', cardEl(null)), tSlot = h('div.ct-slot', cardEl(null));
  const res = h('div.cs-result', h('span.muted', t('One card each. Bet on the higher card, or on a tie. Aces are low.')));
  mount(env.stage, h('div.ct-felt.dt', h('div.ct-side', h('div.ct-lbl', '🐉 ' + t('Dragon')), dSlot), h('div.ct-vs', 'VS'), h('div.ct-side', h('div.ct-lbl', '🐯 ' + t('Tiger')), tSlot)), res);
  const name = (s) => ({ dragon: t('Dragon'), tiger: t('Tiger'), tie: t('Tie') })[s];
  const play = oneShot(env, { game: 'dragontiger', body: () => ({ side }), label: (r) => t('Dragon Tiger') + ' · ' + name(r.result.side) + ' → ' + name(r.result.win),
    animate: async (r) => { mount(dSlot, cardEl(null)); mount(tSlot, cardEl(null)); await wait(250); mount(dSlot, cardEl(r.result.dragon, '.flip')); snd('tick'); await wait(450); mount(tSlot, cardEl(r.result.tiger, '.flip')); snd('tick'); await wait(350);
      dSlot.classList.toggle('won', r.result.win === 'dragon'); tSlot.classList.toggle('won', r.result.win === 'tiger'); result(res, r, t('{w} wins', { w: name(r.result.win) })); paint(); } });
  function paint() {
    mount(env.betBox, betRow(Object.assign({}, env, { onBet: paint })), field(t('Your bet'), segEl([['dragon', '🐉 ' + t('Dragon')], ['tie', t('Tie') + ' ×12'], ['tiger', '🐯 ' + t('Tiger')]], side, (v) => { side = v; ls('casino.dt', v); paint(); })),
      sumBox([[t('Pays'), side === 'tie' ? '×12' : '×2'], [t('On a tie'), side === 'tie' ? t('You win') : t('Half your bet back')]]), env.pausedBox(), goBtn(t('Deal'), play, env.paused() || S.me.coins < 1, coin(env.bet())));
  }
  paint(); return () => {};
}

// ================= SIC BO =================
export function sicbo(env) {
  let kind = ls('casino.sb') || 'small'; let total = Number(ls('casino.sbt')) || 10;
  const diceEl = h('div.ct-dice', [1, 2, 3].map((n) => dieEl(n))); const sumEl = h('div.ct-sum', '—');
  const res = h('div.cs-result', h('span.muted', t('Three dice. Small is 4–10, Big is 11–17; a triple loses those bets.')));
  mount(env.stage, h('div.ct-felt.sb', diceEl, sumEl), res);
  const pay = () => (kind === 'total' ? env.cfg.sicbo.total[total] : env.cfg.sicbo[kind]);
  const name = (k) => ({ small: t('Small'), big: t('Big'), odd: t('Odd'), even: t('Even'), triple: t('Any triple'), total: t('Total {n}', { n: total }) })[k];
  const play = oneShot(env, { game: 'sicbo', body: () => ({ kind, total }), label: (r) => 'Sic Bo · ' + name(r.result.kind) + ' · ' + r.result.dice.join('-'),
    animate: async (r) => { const end = Date.now() + (reduced() ? 0 : 900); snd('spin'); while (Date.now() < end) { mount(diceEl, [0, 1, 2].map(() => dieEl(1 + Math.floor(Math.random() * 6), true))); await wait(80); }
      mount(diceEl, r.result.dice.map((n) => dieEl(n))); sumEl.textContent = String(r.result.sum); result(res, r, t('Rolled {d} = {s}', { d: r.result.dice.join(' · '), s: r.result.sum })); paint(); } });
  function paint() {
    const totals = h('select.select', { disabled: kind !== 'total', 'aria-label': t('Total'), onChange: (e) => { total = Number(e.target.value); ls('casino.sbt', total); paint(); } }, Array.from({ length: 14 }, (_, i) => h('option', { value: i + 4, selected: i + 4 === total }, (i + 4) + ' · ' + mx(env.cfg.sicbo.total[i + 4]))));
    mount(env.betBox, betRow(Object.assign({}, env, { onBet: paint })), field(t('Your bet'), segEl([['small', t('Small')], ['big', t('Big')], ['odd', t('Odd')], ['even', t('Even')], ['triple', t('Any triple')], ['total', t('Total')]], kind, (v) => { kind = v; ls('casino.sb', v); paint(); })),
      kind === 'total' ? field(t('Total'), totals) : null, sumBox([[t('Pays'), mx(pay())], [t('Payout on win'), coin(Math.floor(env.bet() * pay()))]]), env.pausedBox(), goBtn(t('Roll'), play, env.paused() || S.me.coins < 1, coin(env.bet())));
  }
  paint(); return () => {};
}

// ================= CRAPS =================
export function craps(env) {
  let line = ls('casino.craps') || 'pass';
  const diceEl = h('div.ct-dice', [6, 1].map((n) => dieEl(n))); const pointEl = h('div.ct-point', t('Come-out roll')); const log = h('div.ct-log');
  const res = h('div.cs-result', h('span.muted', t('Pass: 7 or 11 wins, 2, 3 or 12 loses; any other number becomes the point — roll it again before a 7.')));
  mount(env.stage, h('div.ct-felt.cr', diceEl, pointEl, log), res);
  const name = (l) => ({ pass: t('Pass line'), dontpass: t('Don’t pass'), field: t('Field') })[l];
  const play = oneShot(env, { game: 'craps', body: () => ({ line }), label: (r) => t('Craps') + ' · ' + name(r.result.line) + ' · ' + t('{n} rolls', { n: r.result.rolls.length }),
    animate: async (r) => { mount(log); pointEl.textContent = t('Come-out roll'); const rolls = r.result.rolls; const fast = rolls.length > 8;
      for (let i = 0; i < rolls.length; i++) { const end = Date.now() + (fast ? 120 : 420); snd('tick'); while (Date.now() < end) { mount(diceEl, [0, 1].map(() => dieEl(1 + Math.floor(Math.random() * 6), true))); await wait(60); }
        const [a, b] = rolls[i]; mount(diceEl, [a, b].map((n) => dieEl(n))); log.append(h('span.ct-roll', String(a + b))); if (i === 0 && r.result.point) pointEl.textContent = t('Point is {n}', { n: r.result.point }); await wait(fast ? 60 : 250); }
      result(res, r, r.result.point ? t('Point {p} · {n} rolls', { p: r.result.point, n: rolls.length }) : t('Rolled {s}', { s: rolls[0][0] + rolls[0][1] })); paint(); } });
  function paint() {
    const info = { pass: [t('Pays'), '×2 · ' + t('house edge {e}', { e: '1.41%' })], dontpass: [t('Pays'), '×2 · ' + t('12 on the come-out is a push')], field: [t('Pays'), t('3,4,9,10,11 ×2 · 2 ×3 · 12 ×4')] }[line];
    mount(env.betBox, betRow(Object.assign({}, env, { onBet: paint })), field(t('Your bet'), segEl([['pass', t('Pass line')], ['dontpass', t('Don’t pass')], ['field', t('Field')]], line, (v) => { line = v; ls('casino.craps', v); paint(); })),
      sumBox([info]), env.pausedBox(), goBtn(t('Roll'), play, env.paused() || S.me.coins < 1, coin(env.bet())));
  }
  paint(); return () => {};
}

// ================= TOWER =================
export function tower(env) {
  const cfg = env.cfg.tower; let mode = ls('casino.tower') || 'medium'; let round = env.rounds().tower || null; let busy = false; let reveal = null; let boom = null;
  const towerEl = h('div.ct-tower'); const res = h('div.cs-result', h('span.muted', t('Climb 8 floors by picking safe tiles. Cash out any time after the first floor.')));
  mount(env.stage, towerEl, res);
  const mult = (f) => Math.floor(0.98 * Math.pow(cfg.modes[mode].tiles / (cfg.modes[mode].tiles - cfg.modes[mode].bombs), f) * 100) / 100;
  function paintTower() {
    const m = round ? round.mode : mode; const tiles = cfg.modes[m].tiles; const at = round && !round.over ? round.picks.length : -1;
    mount(towerEl, Array.from({ length: cfg.floors }, (_, k) => { const f = cfg.floors - 1 - k; const pick = round && round.picks[f]; const lay = reveal && reveal[f];
      return h('div.ct-floor' + (f === at ? '.active' : '') + (round && f < round.picks.length ? '.done' : ''), h('span.ct-fm', mx(Math.floor(0.98 * Math.pow(tiles / (tiles - cfg.modes[m].bombs), f + 1) * 100) / 100)),
        Array.from({ length: tiles }, (_, i) => { const safe = pick === i; const bomb = lay && lay.includes(i); const hit = boom && boom.floor === f && boom.tile === i;
          return h('button.ct-tile' + (safe ? '.safe' : '') + (bomb ? '.bomb' : '') + (hit ? '.boom' : '') + (lay && !bomb && !safe ? '.dim' : ''), { type: 'button', disabled: f !== at || busy, onClick: () => pickTile(i), 'aria-label': t('Floor {f}, tile {n}', { f: f + 1, n: i + 1 }) },
            safe ? '💎' : bomb ? '💣' : ''); })); }));
  }
  async function start() { busy = true; reveal = null; boom = null; paint(); try { const r = await api.post('/api/casino/tower/start', { bet: env.bet(), mode }); round = r.round; patchMe({ coins: r.balance }); env.paintBal(); snd('tick'); res.className = 'cs-result'; mount(res, h('span.muted', t('Pick a tile on floor 1. Next floor pays {m}.', { m: mx(round.next) }))); } catch (e) { env.err(e); } busy = false; paint(); }
  async function pickTile(i) { if (!round || busy) return; busy = true; paintTower();
    try { const r = await api.post('/api/casino/tower/pick', { tile: i }); if (r.boom || r.cashed) return finish(r); round = r.round; snd('coin'); res.className = 'cs-result'; mount(res, h('div', t('Floor {f} cleared! Cash out {n} now', { f: round.floor, n: fmt.coins(Math.floor(round.bet * round.mult)) })), h('span.muted', t('Next floor: {m}', { m: mx(round.next) }))); }
    catch (e) { env.err(e); } busy = false; paint(); }
  async function cashout() { if (!round || busy) return; busy = true; paint(); try { finish(await api.post('/api/casino/tower/cashout')); } catch (e) { env.err(e); busy = false; paint(); } }
  function finish(r) {
    reveal = r.round.layout; boom = r.boom || null; const bet = r.round.bet; const floors = r.round.picks.length; round = Object.assign({}, r.round, { over: true }); busy = false;
    res.className = 'cs-result ' + (r.payout > 0 ? 'win' : 'lose'); mount(res, h('div', boom ? t('A bomb on floor {f}!', { f: boom.floor + 1 }) : t('Cashed out at {m}', { m: mx(r.mult) })), h('b', r.payout > 0 ? t('You won {n} coins!', { n: fmt.coins(r.payout) }) : t('You lost {n} coins.', { n: fmt.coins(bet) })));
    snd(boom ? 'lose' : 'win'); env.done({ game: 'tower', bet, payout: r.payout, net: r.net, mult: r.mult, nonce: r.round.nonce, balance: r.balance, desc: t('Tower') + ' · ' + t('{n} floors', { n: floors }) + (boom ? ' · 💥' : ' · ' + mx(r.mult)) }); paint();
  }
  function paint() {
    paintTower(); const live = round && !round.over;
    mount(env.betBox, live ? sumBox([[t('Bet'), coin(round.bet)], [t('Floor'), round.floor + ' / ' + cfg.floors], [t('Current multiplier'), mx(round.mult)], [t('Cash out now'), coin(Math.floor(round.bet * round.mult))]])
      : h('div', betRow(Object.assign({}, env, { onBet: paint }), { disabled: busy }), field(t('Difficulty'), segEl([['easy', t('Easy')], ['medium', t('Medium')], ['hard', t('Hard')], ['expert', t('Expert')]], mode, (v) => { mode = v; ls('casino.tower', v); paint(); })),
        sumBox([[t('Tiles per floor'), cfg.modes[mode].tiles + ' · ' + cfg.modes[mode].bombs + ' 💣'], [t('Top floor pays'), mx(mult(cfg.floors))]])),
      env.pausedBox(), live ? h('button.btn.primary.cs-go', { type: 'button', disabled: busy || !round.picks.length, onClick: cashout }, icon('coins', 17), t('Cash out'), ' · ', coin(Math.floor(round.bet * round.mult)))
        : goBtn(t('Start climb'), start, busy || env.paused() || S.me.coins < 1, coin(env.bet())));
  }
  paint(); return () => {};
}

// Casino, part 2: Crash, Plinko, Mines, Blackjack and the shared Jackpot. Same virtual coins and provably fair seeds
// as the classic tables; each game renders its own stage + controls and reports finished bets back to casino.js.
import { h, mount, fmt, clamp, ls, parseCoins } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S, bus, patchMe } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, segEl, field } from '../ui.js';
import { avatarEl } from '../cosmetics.js';
import { sfx } from '../sfx.js';

import { horses } from '../casino-fx3d.js';
import { wheel, keno, limbo } from './casino-new.js';
import { baccarat, videopoker, hilo } from './casino-cards.js';
export const EXTRA = new Set(['crash', 'plinko', 'mines', 'blackjack', 'jackpot', 'horses', 'wheel', 'keno', 'limbo', 'baccarat', 'videopoker', 'hilo']);
const mx = (m) => '×' + (Math.round(m * 100) / 100).toFixed(2);
const css = (k, d) => getComputedStyle(document.documentElement).getPropertyValue(k).trim() || d;

// Shared bet row (input, ½ 2× min max, chips) used by every extra game.
export function betRow(env, { disabled = false, label } = {}) {
  const max = () => Math.max(1, Math.min(env.cfg.max, S.me.coins));
  const inp = h('input.input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '100, 10k, 1m', value: String(env.bet()), 'aria-label': t('Bet'), disabled, onInput: (e) => env.setBet(clamp(parseCoins(e.target.value) || 1, 1, env.cfg.max), false), onChange: () => set(env.bet()) });
  const set = (v) => { env.setBet(clamp(parseCoins(v) || 1, 1, max())); inp.value = String(env.bet()); env.onBet && env.onBet(); };
  const b = (lbl, fn) => h('button.btn.sm', { type: 'button', disabled, onClick: fn }, lbl);
  return h('div', h('div.row', { style: 'gap:8px;flex-wrap:wrap' }, h('div.grow', { style: 'min-width:120px' }, field(label || t('Bet'), inp)),
    h('div.row', { style: 'gap:6px;align-self:flex-end;margin-bottom:2px' }, b('½', () => set(env.bet() / 2)), b('2×', () => set(env.bet() * 2)), b(t('Min'), () => set(1)), b(t('Max'), () => set(max())))),
  h('div.cs-chips', [10, 50, 100, 500, 1000].map((n) => h('button.cs-chip', { type: 'button', disabled, onClick: () => set(env.bet() + n) }, '+' + n))));
}
export const sumBox = (rows) => h('div.cs-sum', rows.map(([k, v]) => h('div', h('span.muted', k), typeof v === 'string' || typeof v === 'number' ? h('b', String(v)) : v)));
export const goBtn = (label, onClick, disabled, extra) => h('button.btn.primary.cs-go', { type: 'button', disabled, onClick }, icon('play', 17), label, extra ? [' · ', extra] : null);
export const coin = (n) => h('span.coin', fmt.coins(n));

export function mountExtra(game, env) {
  return ({ crash, plinko, mines, blackjack, jackpot, horses, wheel, keno, limbo, baccarat, videopoker, hilo })[game](env);
}

// ================= CRASH =================
function crash(env) {
  let cash = Number(ls('casino.crash') || 2); let busyNow = false; let raf = 0;
  const cv = h('canvas.cx-crash', { width: 720, height: 300 }); const big = h('div.cx-mult', '1.00×'); const res = h('div.cs-result', h('span.muted', t('Pick an auto cash-out and launch.')));
  mount(env.stage, h('div.cx-crashwrap', cv, big), res);
  const g = cv.getContext('2d');
  const draw = (m, crashed) => {
    const W = 720, H = 300; g.clearRect(0, 0, W, H);
    const top = Math.max(2, m * 1.15); const tMax = Math.log(top);
    g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 1; for (let i = 1; i < 5; i++) { const y = H - (i / 5) * H; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    const yOf = (v) => H - 14 - ((v - 1) / (top - 1)) * (H - 40);
    const cashY = yOf(cash); if (cash <= top) { g.setLineDash([6, 6]); g.strokeStyle = 'rgba(52,211,153,.6)'; g.beginPath(); g.moveTo(0, cashY); g.lineTo(W, cashY); g.stroke(); g.setLineDash([]); g.fillStyle = 'rgba(52,211,153,.9)'; g.font = '600 13px system-ui'; g.fillText(mx(cash), 8, cashY - 6); }
    const grad = g.createLinearGradient(0, 0, W, 0); grad.addColorStop(0, css('--accent', '#8b5cf6')); grad.addColorStop(1, crashed ? '#ef4444' : css('--accent2', '#38bdf8'));
    g.strokeStyle = grad; g.lineWidth = 4; g.beginPath();
    const N = 80; for (let i = 0; i <= N; i++) { const k = i / N; const v = Math.exp(k * Math.log(m)); const x = 10 + k * (W - 40) * (Math.log(m) / Math.max(tMax, 1e-6)); const y = yOf(v); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    const xe = 10 + (W - 40) * (Math.log(m) / Math.max(tMax, 1e-6)); g.fillStyle = crashed ? '#ef4444' : '#fff'; g.beginPath(); g.arc(xe, yOf(m), 7, 0, 7); g.fill();
  };
  draw(1, false);
  const paintCtl = () => {
    const ci = h('input.input', { type: 'number', min: '1.01', max: String(env.cfg.crashMax), step: '0.01', value: cash.toFixed(2), disabled: busyNow, 'aria-label': t('Auto cash-out'), onChange: (e) => { cash = clamp(Math.floor(Number(e.target.value) * 100) / 100 || 2, 1.01, env.cfg.crashMax); ls('casino.crash', cash); paintCtl(); draw(1, false); } });
    mount(env.betBox, betRow(Object.assign({}, env, { onBet: paintCtl }), { disabled: busyNow }),
      h('div.row', { style: 'gap:8px;flex-wrap:wrap;align-items:flex-end' }, h('div.grow', field(t('Auto cash-out (×)'), ci)), h('div.row', { style: 'gap:6px;margin-bottom:2px' }, [1.5, 2, 3, 5, 10, 100].map((v) => h('button.btn.sm' + (cash === v ? '.primary' : ''), { type: 'button', disabled: busyNow, onClick: () => { cash = v; ls('casino.crash', v); paintCtl(); draw(1, false); } }, v + '×')))),
      sumBox([[t('Win chance'), (Math.min(99, 98 / cash)).toFixed(2) + '%'], [t('Multiplier'), mx(cash)], [t('Payout if you win'), coin(Math.floor(env.bet() * cash))]]),
      env.pausedBox(), goBtn(t('Launch'), go, busyNow || env.paused() || S.me.coins < 1, coin(env.bet())));
  };
  async function go() {
    if (busyNow) return; busyNow = true; env.hold(true); paintCtl(); res.className = 'cs-result'; mount(res, h('span.muted', t('Launching…')));
    let r; try { r = await api.post('/api/casino/play/crash', { bet: env.bet(), cashout: cash }); } catch (e) { busyNow = false; env.hold(false); paintCtl(); return env.err(e); }
    const point = r.result.point; const stopAt = r.payout > 0 ? cash : point; const k = Math.max(0.35, Math.log(Math.max(stopAt, 1.01)) / 6); const t0 = performance.now(); sfx.spin();
    await new Promise((done) => { const step = () => { if (!env.alive()) return done(); const s = (performance.now() - t0) / 1000; const m = Math.min(stopAt, Math.exp(k * s)); big.textContent = m.toFixed(2) + '×'; big.className = 'cx-mult'; draw(m, false); if (m >= stopAt) return done(); raf = requestAnimationFrame(step); }; step(); });
    if (!env.alive()) return;
    if (r.payout > 0) { big.className = 'cx-mult win'; big.textContent = mx(cash); sfx.tick(); await env.pause(350); }
    // fast-forward to where it actually crashed
    const from = Math.max(1, stopAt); const t1 = performance.now();
    await new Promise((done) => { const step = () => { if (!env.alive()) return done(); const k2 = clamp((performance.now() - t1) / 500, 0, 1); const m = from + (point - from) * k2; draw(Math.max(1.0001, m), k2 >= 1); if (k2 >= 1) return done(); raf = requestAnimationFrame(step); }; step(); });
    big.className = 'cx-mult ' + (r.payout > 0 ? 'win' : 'lose'); big.textContent = r.payout > 0 ? mx(cash) : t('Crashed @ {m}', { m: mx(point) });
    res.className = 'cs-result ' + (r.payout > 0 ? 'win' : 'lose');
    mount(res, h('div', t('Crashed at {m}', { m: mx(point) })), h('b', r.payout > 0 ? t('Cashed out at {m} — you won {n} coins!', { m: mx(cash), n: fmt.coins(r.payout) }) : t('You lost {n} coins.', { n: fmt.coins(r.bet) })));
    busyNow = false; env.hold(false);
    env.done(Object.assign(r, { desc: t('Crash') + ' · ' + mx(point) + ' (' + t('cash-out') + ' ' + mx(cash) + ')' }));
    paintCtl();
  }
  paintCtl();
  return () => cancelAnimationFrame(raf);
}

// ================= PLINKO =================
function plinko(env) {
  let rows = Number(ls('casino.prows') || 12); let risk = ls('casino.prisk') || 'medium'; let flying = 0; const balls = []; let raf = 0;
  if (!env.cfg.plinko[rows]) rows = 12; if (!env.cfg.plinko[rows][risk]) risk = 'medium';
  const W = 620, H = 520; const cv = h('canvas.cx-plinko', { width: W, height: H }); const slotsEl = h('div.cx-pslots'); const res = h('div.cs-result', h('span.muted', t('Drop a ball. Higher risk = bigger edges, smaller middle.')));
  mount(env.stage, h('div.cx-pwrap', cv, slotsEl), res);
  const g = cv.getContext('2d');
  const geo = () => { const gap = (W - 60) / (rows + 1); return { gap, top: 40, dy: (H - 80) / rows }; };
  const slotColor = (m) => (m >= 10 ? '#ef4444' : m >= 3 ? '#f97316' : m >= 1.2 ? '#eab308' : m >= 1 ? '#84cc16' : '#64748b');
  function paintSlots() { const pay = env.cfg.plinko[rows][risk]; mount(slotsEl, pay.map((m, i) => h('span.cx-ps', { dataset: { i }, style: { background: slotColor(m) } }, m >= 100 ? String(m) : m + '×'))); slotsEl.style.setProperty('--n', pay.length); }
  function board() {
    const { gap, top, dy } = geo(); g.clearRect(0, 0, W, H); g.fillStyle = 'rgba(255,255,255,.75)';
    for (let r = 0; r < rows; r++) { const n = r + 3; const w = (n - 1) * gap; for (let i = 0; i < n; i++) { g.beginPath(); g.arc(W / 2 - w / 2 + i * gap, top + r * dy, 3.2, 0, 7); g.fill(); } }
    for (const b of balls) { g.fillStyle = b.c; g.shadowColor = b.c; g.shadowBlur = 12; g.beginPath(); g.arc(b.x, b.y, 7, 0, 7); g.fill(); g.shadowBlur = 0; }
  }
  const loop = () => { board(); raf = requestAnimationFrame(loop); }; loop();
  function animateBall(path) {
    return new Promise((done) => {
      const { gap, top, dy } = geo(); const c = css('--accent2', '#38bdf8'); const b = { x: W / 2, y: 10, c }; balls.push(b);
      // waypoints: after r+1 rows with `pos` rights, the ball sits at centre + (pos - (r+1)/2) * gap, just under that peg row
      const pts = [[W / 2, 10]]; let pos = 0;
      for (let r = 0; r < rows; r++) { pos += path[r]; pts.push([W / 2 + (pos - (r + 1) / 2) * gap, top + r * dy + dy * 0.55]); }
      pts.push([pts[pts.length - 1][0], H - 18]);
      let i = 0; const seg = 115; let t0 = performance.now();
      const step = () => { if (!env.alive()) return done(); const k = (performance.now() - t0) / seg; if (k >= 1) { i++; t0 = performance.now(); if (i >= pts.length - 1) { balls.splice(balls.indexOf(b), 1); return done(); } if (i < rows) sfx.tick(); } const a = pts[i], z = pts[Math.min(i + 1, pts.length - 1)]; const kk = clamp(k, 0, 1); b.x = a[0] + (z[0] - a[0]) * kk; b.y = a[1] + (z[1] - a[1]) * kk - Math.sin(kk * Math.PI) * 9; requestAnimationFrame(step); };
      step();
    });
  }
  async function drop() {
    if (env.paused()) return; if (env.bet() > S.me.coins) return toast(t('Not enough coins'), 'err');
    flying++; env.hold(true); paintCtl();
    let r; try { r = await api.post('/api/casino/play/plinko', { bet: env.bet(), rows, risk }); } catch (e) { flying--; if (!flying) env.hold(false); paintCtl(); return env.err(e); }
    await animateBall(r.result.path); flying--;
    const s = slotsEl.querySelector(`[data-i="${r.result.slot}"]`); if (s) { s.classList.remove('hit'); void s.offsetWidth; s.classList.add('hit'); }
    res.className = 'cs-result ' + (r.net >= 0 ? 'win' : 'lose'); mount(res, h('div', t('Landed on {m}', { m: mx(r.mult) })), h('b', r.net >= 0 ? t('You won {n} coins!', { n: fmt.coins(r.payout) }) : t('Returned {n} of {b}', { n: fmt.coins(r.payout), b: fmt.coins(r.bet) })));
    if (!flying) env.hold(false);
    env.done(Object.assign(r, { desc: t('Plinko') + ' · ' + rows + ' ' + t('rows') + ' · ' + t(risk) + ' · ' + mx(r.mult) }));
    paintCtl();
  }
  function paintCtl() {
    const lock = flying > 0;
    mount(env.betBox, betRow(Object.assign({}, env, { onBet: paintCtl }), { disabled: false }),
      h('div.row', { style: 'gap:10px;flex-wrap:wrap' }, field(t('Rows'), segEl([[8, '8'], [12, '12'], [16, '16']], rows, (v) => { if (lock) return; rows = Number(v); ls('casino.prows', rows); paintSlots(); paintCtl(); })),
        field(t('Risk'), segEl([['low', t('Low')], ['medium', t('Medium')], ['high', t('High')]], risk, (v) => { if (lock) return; risk = v; ls('casino.prisk', v); paintSlots(); paintCtl(); }))),
      sumBox([[t('Top prize'), mx(Math.max(...env.cfg.plinko[rows][risk]))], [t('Balls in play'), String(flying)]]),
      env.pausedBox(), goBtn(t('Drop ball'), drop, env.paused() || S.me.coins < 1 || flying >= 5, coin(env.bet())));
  }
  paintSlots(); paintCtl();
  return () => cancelAnimationFrame(raf);
}

// ================= MINES =================
function mines(env) {
  let count = Number(ls('casino.mines') || 3); let round = env.rounds().mines || null; let busyNow = false; let reveal = null; let boom = null;
  const gridEl = h('div.cx-mines'); const res = h('div.cs-result', h('span.muted', t('Pick how many mines, then reveal safe tiles. Cash out any time.')));
  mount(env.stage, gridEl, res);
  const paintGrid = () => mount(gridEl, Array.from({ length: 25 }, (_, i) => {
    const picked = round && round.picks.includes(i); const mine = reveal && reveal.includes(i);
    return h('button.cx-tile' + (picked ? '.safe' : '') + (mine ? '.mine' : '') + (boom === i ? '.boom' : '') + (reveal && !mine && !picked ? '.dim' : ''), { type: 'button', disabled: !round || round.over || picked || busyNow, onClick: () => pickTile(i), 'aria-label': t('Tile {n}', { n: i + 1 }) },
      picked || (reveal && !mine) ? h('span.cx-gem', '💎') : mine ? h('span.cx-bomb', '💣') : null);
  }));
  async function start() {
    busyNow = true; paintCtl(); reveal = null; boom = null;
    try { const r = await api.post('/api/casino/mines/start', { bet: env.bet(), mines: count }); round = r.round; patchMe({ coins: r.balance }); env.paintBal(); sfx.tick(); res.className = 'cs-result'; mount(res, h('span.muted', t('Good luck! Next safe tile pays {m}.', { m: mx(round.next) }))); }
    catch (e) { env.err(e); }
    busyNow = false; paintGrid(); paintCtl();
  }
  async function pickTile(i) {
    if (!round || busyNow) return; busyNow = true; paintGrid();
    try {
      const r = await api.post('/api/casino/mines/pick', { cell: i });
      if (r.boom !== undefined || r.cashed) return finish(r);
      round = r.round; sfx.coin ? sfx.coin() : sfx.tick(); res.className = 'cs-result'; mount(res, h('div', t('Safe! Current payout {n}', { n: fmt.coins(Math.floor(round.bet * round.mult)) })), h('span.muted', t('Next tile: {m}', { m: mx(round.next) })));
    } catch (e) { env.err(e); }
    busyNow = false; paintGrid(); paintCtl();
  }
  async function cashout() { if (!round || busyNow) return; busyNow = true; paintCtl(); try { finish(await api.post('/api/casino/mines/cashout')); } catch (e) { env.err(e); busyNow = false; paintCtl(); } }
  function finish(r) {
    reveal = r.round.layout; boom = r.boom !== undefined ? r.boom : null; const bet = r.round.bet; const picks = r.round.picks.length;
    round = Object.assign({}, r.round, { over: true }); busyNow = false;
    res.className = 'cs-result ' + (r.payout > 0 ? 'win' : 'lose');
    mount(res, h('div', boom !== null ? t('Boom! You hit a mine.') : t('Cashed out at {m}', { m: mx(r.mult) })), h('b', r.payout > 0 ? t('You won {n} coins!', { n: fmt.coins(r.payout) }) : t('You lost {n} coins.', { n: fmt.coins(bet) })));
    if (boom !== null) sfx.lose();
    env.done({ game: 'mines', bet, payout: r.payout, net: r.net, mult: r.mult, nonce: r.round.nonce, balance: r.balance, desc: t('Mines') + ' · ' + count + ' 💣 · ' + t('{n} safe', { n: picks }) + (boom !== null ? ' · 💥' : ' · ' + mx(r.mult)) });
    paintGrid(); paintCtl();
  }
  function paintCtl() {
    const live = round && !round.over;
    const sel = h('select.select', { disabled: live || busyNow, 'aria-label': t('Mines'), onChange: (e) => { count = Number(e.target.value); ls('casino.mines', count); paintCtl(); } }, Array.from({ length: 24 }, (_, i) => h('option', { value: i + 1, selected: i + 1 === count }, String(i + 1))));
    mount(env.betBox, live ? sumBox([[t('Bet'), coin(round.bet)], [t('Mines'), String(round.mines)], [t('Current multiplier'), mx(round.mult)], [t('Cash out now'), coin(Math.floor(round.bet * round.mult))]]) : h('div', betRow(Object.assign({}, env, { onBet: paintCtl }), { disabled: busyNow }), field(t('Mines'), sel), sumBox([[t('First tile pays'), mx(minesMult(count, 1))], [t('Max multiplier'), mx(minesMult(count, 25 - count))]])),
      env.pausedBox(),
      live ? h('button.btn.primary.cs-go', { type: 'button', disabled: busyNow || !round.picks.length, onClick: cashout }, icon('coins', 17), t('Cash out'), ' · ', coin(Math.floor(round.bet * round.mult)))
        : goBtn(t('Start round'), start, busyNow || env.paused() || S.me.coins < 1, coin(env.bet())));
  }
  const minesMult = (m, safe) => { let x = env.cfg.minesEdge; for (let k = 0; k < safe; k++) x *= (25 - k) / (25 - m - k); return Math.floor(x * 100) / 100; };
  paintGrid(); paintCtl();
  return () => {};
}

// ================= BLACKJACK =================
function blackjack(env) {
  let round = env.rounds().bj || null; let busyNow = false; let last = null;
  const dealerEl = h('div.cx-hand'); const playerEl = h('div.cx-hand'); const dv = h('span.pill'); const pv = h('span.pill'); const res = h('div.cs-result', h('span.muted', t('Beat the dealer without going over 21. Blackjack pays 3:2.')));
  mount(env.stage, h('div.cx-table', h('div.cx-side', h('div.row', h('b', t('Dealer')), dv), dealerEl), h('div.cx-side', h('div.row', h('b', t('You')), pv), playerEl)), res);
  const card = (c, i) => h('div.cx-card' + (c.s === '♥' || c.s === '♦' ? '.red' : ''), { style: { '--i': i } }, h('span.cx-r', c.r), h('span.cx-s', c.s), h('span.cx-r2', c.r));
  const back = (i) => h('div.cx-card.back', { style: { '--i': i } });
  const paintHands = (r) => {
    if (!r) { mount(dealerEl); mount(playerEl); dv.textContent = '—'; pv.textContent = '—'; return; }
    mount(dealerEl, r.dealer.map(card), r.over ? null : back(1)); mount(playerEl, r.player.map(card)); dv.textContent = String(r.dv); pv.textContent = String(r.pv);
  };
  async function act(path, body) {
    if (busyNow) return; busyNow = true; paintCtl();
    try {
      const r = await api.post('/api/casino/blackjack/' + path, body); sfx.tick();
      if (r.outcome) { round = null; last = r; paintHands(r.round); finish(r); }
      else { round = r.round; patchMe({ coins: r.balance }); env.paintBal(); paintHands(round); res.className = 'cs-result'; mount(res, h('span.muted', t('Hit, stand or double?'))); }
    } catch (e) { env.err(e); }
    busyNow = false; paintCtl();
  }
  function finish(r) {
    const o = r.outcome; const stake = r.round.bet * (r.round.doubled ? 2 : 1);
    const label = { blackjack: t('Blackjack!'), win: t('You win!'), push: t('Push — your bet is returned.'), lose: t('Dealer wins.'), bust: t('Bust!') }[o];
    res.className = 'cs-result ' + (r.payout > stake ? 'win' : r.payout === stake ? '' : 'lose');
    mount(res, h('div', label), h('b', r.payout > stake ? t('You won {n} coins!', { n: fmt.coins(r.payout) }) : r.payout === stake ? t('{n} coins returned.', { n: fmt.coins(stake) }) : t('You lost {n} coins.', { n: fmt.coins(stake) })));
    env.done({ game: 'blackjack', bet: stake, payout: r.payout, net: r.net, mult: r.payout / stake, nonce: r.round.nonce, balance: r.balance, desc: t('Blackjack') + ' · ' + r.round.pv + ' vs ' + r.round.dv + ' · ' + label });
  }
  function paintCtl() {
    const live = !!round;
    mount(env.betBox, live ? sumBox([[t('Bet'), coin(round.bet * (round.doubled ? 2 : 1))], [t('Your hand'), String(round.pv)], [t('Dealer shows'), String(round.dv)]]) : betRow(env, { disabled: busyNow }),
      env.pausedBox(),
      live ? h('div.row.cx-bjbtns', h('button.btn.primary', { type: 'button', disabled: busyNow, onClick: () => act('hit') }, t('Hit')), h('button.btn', { type: 'button', disabled: busyNow, onClick: () => act('stand') }, t('Stand')), h('button.btn', { type: 'button', disabled: busyNow || !round.canDouble || S.me.coins < round.bet, onClick: () => act('double') }, t('Double')))
        : goBtn(t('Deal'), () => act('deal', { bet: env.bet() }), busyNow || env.paused() || S.me.coins < 1, coin(env.bet())));
  }
  paintHands(round); paintCtl();
  return () => {};
}

// ================= JACKPOT =================
function jackpot(env) {
  let jp = null; let timer = 0; let tick = 0; let lastSettled = null; let busyNow = false;
  const potEl = h('div.cx-pot'); const barEl = h('div.cx-jbar'); const listEl = h('div.cx-jlist'); const clock = h('div.cx-jclock'); const histEl = h('div');
  mount(env.stage, h('div.cx-jp', h('div.cx-jtop', potEl, clock), barEl, listEl));
  const COLORS = ['#8b5cf6', '#22d3ee', '#f59e0b', '#ef4444', '#22c55e', '#ec4899', '#3b82f6', '#a3e635', '#f97316', '#14b8a6'];
  async function load() {
    try { const r = await api.get('/api/casino/jackpot', { quiet: true }); const prev = jp; jp = r.jackpot; if (prev && prev.id !== jp.id && jp.history[0] && jp.history[0].id === prev.id) announce(jp.history[0], prev); paint(); } catch {}
  }
  function announce(hst, prev) {
    if (lastSettled === hst.id || hst.refunded) return; lastSettled = hst.id;
    const mine = prev.mine; if (!mine) return;
    const won = hst.winner === S.me.id;
    if (won) { sfx.big(); toast(t('You won the jackpot: {n} coins!', { n: fmt.coins(hst.prize) }), 'coin'); }
    env.done({ game: 'jackpot', bet: mine, payout: won ? hst.prize : 0, net: (won ? hst.prize : 0) - mine, mult: won ? hst.prize / mine : 0, balance: S.me.coins, desc: t('Jackpot') + ' · ' + t('pot {n}', { n: fmt.coins(hst.pot) }) + ' · ' + t('winner {u}', { u: hst.winnerName }) });
    api.get('/api/me', { quiet: true }).then((m) => { const u = m.user || m; if (u && typeof u.coins === 'number') { patchMe({ coins: u.coins }); env.paintBal(); } }).catch(() => {});
  }
  function paint() {
    if (!jp) return;
    mount(potEl, h('div.tiny.muted', t('Current pot')), h('div.cx-potn', coin(jp.pot)), h('div.tiny.muted', t('{n} players · {f}% fee', { n: jp.players.length, f: Math.round(jp.fee * 100) })));
    mount(barEl, jp.players.length ? jp.players.map((p, i) => h('i', { style: { flex: String(p.amt), background: COLORS[i % COLORS.length] }, title: p.name + ' · ' + p.chance + '%' })) : h('i.empty', { style: { flex: '1' } }));
    mount(listEl, jp.players.length ? jp.players.map((p, i) => h('div.cx-jrow' + (p.id === S.me.id ? '.me' : ''), h('span.cx-dot', { style: { background: COLORS[i % COLORS.length] } }), avatarEl({ id: p.id, username: p.name, displayName: p.name, avatar: p.avatar }, { size: 26 }), h('b.grow.ellipsis', p.name), coin(p.amt), h('span.pill', p.chance + '%')))
      : h('p.small.muted', t('No deposits yet. Be the first — the round starts when a second player joins.')));
    paintClock(); paintCtl(); paintHist();
  }
  function paintClock() { if (!jp) return; const left = jp.endsAt ? Math.max(0, Math.ceil((jp.endsAt - Date.now()) / 1000)) : null; clock.textContent = left === null ? t('Waiting for players') : left > 0 ? t('Draw in {s}s', { s: left }) : t('Drawing…'); clock.classList.toggle('hot', left !== null && left <= 10); }
  function paintCtl() {
    mount(env.betBox, betRow(Object.assign({}, env, { onBet: paintCtl }), { disabled: busyNow, label: t('Deposit') }),
      sumBox([[t('Your deposit'), coin(jp ? jp.mine : 0)], [t('Your chance'), jp && jp.pot ? (Math.round(((jp.mine) / jp.pot) * 10000) / 100) + '%' : '0%'], [t('Chance after deposit'), jp ? (Math.round(((jp.mine + env.bet()) / (jp.pot + env.bet())) * 10000) / 100) + '%' : '—']]),
      env.pausedBox(), goBtn(t('Join the pot'), join, busyNow || env.paused() || S.me.coins < 10, coin(env.bet())),
      h('p.tiny.muted', t('One ticket per coin. The winner takes the pot minus a {f}% fee. The draw uses a seed whose hash is shown before the round.', { f: jp ? Math.round(jp.fee * 100) : 2 })));
  }
  function paintHist() {
    mount(histEl, h('h3', t('Recent jackpots')), jp.history.length ? h('div.cs-hist', jp.history.map((x) => h('div.cs-h' + (x.winner === S.me.id ? '.win' : ''), h('span.cs-h-ic', icon(x.refunded ? 'refresh' : 'trophy', 16)), h('div.grow', h('div', x.refunded ? t('Refunded (nobody joined)') : t('{u} won {n} ({c}% chance)', { u: x.winnerName, n: fmt.coins(x.prize), c: x.chance })), h('div.tiny.muted.ellipsis', { title: 'seed ' + x.seed }, fmt.rel(x.t) + ' · seed ' + x.seed.slice(0, 16) + '… · hash ' + x.hash.slice(0, 12) + '…')), coin(x.pot)))) : h('p.small.muted', t('No rounds yet.')));
  }
  async function join() {
    if (busyNow) return; busyNow = true; paintCtl();
    try { const r = await api.post('/api/casino/jackpot/join', { bet: env.bet() }); jp = r.jackpot; patchMe({ coins: r.balance }); env.paintBal(); sfx.tick(); toast(t('You joined the pot!'), 'good'); } catch (e) { env.err(e); }
    busyNow = false; paint();
  }
  env.sideSlot(histEl);
  load(); timer = setInterval(load, 2500); tick = setInterval(paintClock, 500);
  const off = bus.on('ws:jackpot', () => load());
  return () => { clearInterval(timer); clearInterval(tick); off(); env.sideSlot(null); };
}

// Casino, part 3 (Nebulix 9): Wheel, Keno and Limbo — same virtual coins and provably fair seeds as every other table,
// each with its own animation, plus auto-bet (play N rounds in a row, stop any time).
import { h, mount, fmt, clamp, ls } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S } from '../state.js';
import { toast, segEl, field } from '../ui.js';
import { sfx } from '../sfx.js';
import { betRow, sumBox, goBtn, coin } from './casino-more.js';

const mx = (m) => '×' + (Math.round(m * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
const snd = (k) => { try { sfx[k] && sfx[k](); } catch {} };
const reduced = () => document.documentElement.dataset.reduce === '1' || matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOut = (k) => 1 - Math.pow(1 - k, 4);
const animate = (ms, fn) => new Promise((done) => { if (reduced()) { fn(1); return done(); } const t0 = performance.now(); const step = () => { const k = Math.min(1, (performance.now() - t0) / ms); fn(k); if (k < 1) requestAnimationFrame(step); else done(); }; requestAnimationFrame(step); });
const resultBox = (res, r, label) => { res.className = 'cs-result pop ' + (r.net > 0 ? 'win' : 'lose'); mount(res, h('div', label), h('b', r.net > 0 ? t('You won {n} coins!', { n: fmt.coins(r.payout) }) : r.payout > 0 ? t('Returned {n} of {b}', { n: fmt.coins(r.payout), b: fmt.coins(r.bet) }) : t('No luck this time'))); };

// ---- auto-bet: runs `once()` N times; stops on a click, when coins run out or when you leave the game ----
function autoBet(env, once, repaint) {
  const st = { left: 0, on: false, net: 0, n: 0 };
  async function run(n) {
    if (st.on) { st.left = 0; return; }
    st.on = true; st.left = n; st.net = 0; st.n = 0; repaint();
    while (st.left > 0 && env.alive()) {
      if (env.bet() > S.me.coins) { toast(t('Not enough coins'), 'err'); break; }
      const r = await once(true); if (!r) break; st.left--; st.n++; st.net += r.net; repaint();
      await env.pause(reduced() ? 150 : 350);
    }
    st.on = false; st.left = 0; repaint();
    if (st.n > 1) toast(t('Auto-bet finished: {n} rounds, {s} coins', { n: st.n, s: (st.net >= 0 ? '+' : '') + fmt.coins(st.net) }), st.net >= 0 ? 'good' : 'info');
  }
  const row = () => h('div.cs-auto', h('span.small.muted', t('Auto-bet')), st.on
    ? [h('b.small', t('{n} left', { n: st.left }) + ' · ' + (st.net >= 0 ? '+' : '') + fmt.coins(st.net)), h('button.btn.sm.danger', { type: 'button', onClick: () => { st.left = 0; } }, t('Stop'))]
    : [10, 25, 50, 100].map((n) => h('button.btn.sm', { type: 'button', disabled: env.paused(), onClick: () => run(n) }, '×' + n)));
  return { row, get on() { return st.on; } };
}

// ================= WHEEL =================
const WCOL = (m) => (m === 0 ? '#1e2230' : m >= 20 ? '#f43f5e' : m >= 4 ? '#a855f7' : m >= 3 ? '#f97316' : m >= 2 ? '#eab308' : m >= 1.6 ? '#22c55e' : m >= 1.4 ? '#14b8a6' : '#38bdf8');
export function wheel(env) {
  let risk = ls('casino.wrisk') || 'medium'; if (!env.cfg.wheel[risk]) risk = 'medium';
  let spinning = false; let angle = 0; let hit = -1;
  const S2 = 440; const cv = h('canvas.cx-wheel', { width: S2 * 2, height: S2 * 2 }); const g = cv.getContext('2d');
  const legend = h('div.cx-wlegend'); const res = h('div.cs-result', h('span.muted', t('Spin the wheel. Higher risk: fewer winning slices, bigger prizes.')));
  mount(env.stage, h('div.cx-wheelwrap', h('div.cx-wpointer'), cv, h('div.cx-whub', '★')), legend, res);
  const segs = () => env.cfg.wheel[risk];
  function draw() {
    const R = S2 * 2; const c = R / 2; const sg = segs(); const n = sg.length; const a0 = (Math.PI * 2) / n;
    g.clearRect(0, 0, R, R); g.save(); g.translate(c, c); g.rotate(angle);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + i * a0 - a0 / 2; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, c - 18, a, a + a0); g.closePath();
      g.fillStyle = WCOL(sg[i]); g.globalAlpha = hit === -1 || hit === i ? 1 : 0.45; g.fill(); g.globalAlpha = 1; g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 3; g.stroke();
      if (sg[i] > 0) { g.save(); g.rotate(a + a0 / 2); g.fillStyle = '#fff'; g.font = '800 30px system-ui'; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(sg[i] + '×', c - 42, 0); g.restore(); }
    }
    g.restore();
    // golden rim with lights
    g.beginPath(); g.arc(c, c, c - 9, 0, 7); g.lineWidth = 18; g.strokeStyle = '#b8860b'; g.stroke();
    const lights = 30; const on = Math.floor(performance.now() / 160) % 2;
    for (let i = 0; i < lights; i++) { const a = (i / lights) * Math.PI * 2; g.beginPath(); g.arc(c + Math.cos(a) * (c - 9), c + Math.sin(a) * (c - 9), 5, 0, 7); g.fillStyle = (i % 2) === on || spinning ? '#fff7cc' : '#7a5b00'; g.fill(); }
  }
  let raf = 0; const loop = () => { draw(); raf = requestAnimationFrame(loop); }; loop();
  const paintLegend = () => { const counts = {}; segs().forEach((m) => { counts[m] = (counts[m] || 0) + 1; }); mount(legend, Object.keys(counts).map(Number).sort((a, b) => a - b).map((m) => h('span.cx-wl', { style: { '--c': WCOL(m) } }, m + '×', h('small', ' ' + Math.round((counts[m] / 30) * 1000) / 10 + '%')))); };
  paintLegend();
  async function once(auto) {
    if (spinning || env.paused()) return null; if (env.bet() > S.me.coins) { toast(t('Not enough coins'), 'err'); return null; }
    spinning = true; hit = -1; env.hold(true); paintCtl();
    let r; try { r = await api.post('/api/casino/play/wheel', { bet: env.bet(), risk }); } catch (e) { spinning = false; env.hold(false); paintCtl(); env.err(e); return null; }
    const n = segs().length; const a0 = (Math.PI * 2) / n;
    // land segment r.result.seg under the pointer (top), plus a few full turns and a little jitter inside the slice
    const TAU = Math.PI * 2; const target = -(r.result.seg * a0) + (Math.random() - 0.5) * a0 * 0.6; const from = angle % TAU; const turns = (auto ? 3 : 5) * TAU;
    const end = from + turns + ((((target - from) % TAU) + TAU) % TAU); let last = -1;
    snd('spin');
    await animate(auto ? 1800 : 3600, (k) => { angle = from + (end - from) * easeOut(k); const s = Math.round(((-angle / a0) % n + n) % n) % n; if (s !== last) { last = s; if (k < 0.97) snd('tick'); } });
    angle = end % TAU; hit = r.result.seg; spinning = false; env.hold(false);
    resultBox(res, r, t('Landed on {m}', { m: mx(r.mult) }));
    env.done(Object.assign(r, { desc: t('Wheel') + ' · ' + t(risk) + ' · ' + mx(r.mult) })); paintCtl();
    return r;
  }
  const auto = autoBet(env, once, () => paintCtl());
  function paintCtl() {
    const lock = spinning || auto.on;
    mount(env.betBox, betRow(Object.assign({}, env, { onBet: paintCtl }), { disabled: lock }),
      field(t('Risk'), segEl([['low', t('Low')], ['medium', t('Medium')], ['high', t('High')]], risk, (v) => { if (lock) return; risk = v; ls('casino.wrisk', v); hit = -1; paintLegend(); paintCtl(); })),
      sumBox([[t('Top prize'), mx(Math.max(...segs()))], [t('Win chance'), Math.round((segs().filter((m) => m > 0).length / 30) * 1000) / 10 + '%']]),
      env.pausedBox(), goBtn(t('Spin'), () => once(false), lock || env.paused() || S.me.coins < 1, coin(env.bet())), auto.row());
  }
  paintCtl();
  return () => cancelAnimationFrame(raf);
}

// ================= KENO =================
export function keno(env) {
  let picks = (() => { try { return (JSON.parse(ls('casino.kpicks') || '[]') || []).filter((x) => x >= 1 && x <= 40).slice(0, 10); } catch { return []; } })();
  let busyNow = false; let drawn = []; let shown = 0;
  const grid = h('div.cx-keno'); const pay = h('div.cx-kpay'); const res = h('div.cs-result', h('span.muted', t('Pick up to 10 numbers. 10 balls are drawn — the more you match, the more you win.')));
  mount(env.stage, grid, pay, res);
  const save = () => ls('casino.kpicks', JSON.stringify(picks));
  function paintGrid() {
    const vis = drawn.slice(0, shown);
    mount(grid, Array.from({ length: 40 }, (_, i) => { const n = i + 1; const sel = picks.includes(n); const d = vis.includes(n);
      return h('button.cx-kn' + (sel ? '.sel' : '') + (d ? (sel ? '.hit' : '.drawn') : ''), { type: 'button', disabled: busyNow || auto.on, onClick: () => { if (sel) picks = picks.filter((x) => x !== n); else if (picks.length < 10) picks.push(n); else toast(t('Up to 10 numbers'), 'info', 1200); drawn = []; shown = 0; save(); paintAll(); } }, String(n)); }));
  }
  function paintPay() {
    const row = picks.length ? env.cfg.keno[picks.length] : null; const hits = drawn.length ? picks.filter((x) => drawn.slice(0, shown).includes(x)).length : -1;
    mount(pay, row ? row.map((m, i) => h('div.cx-kp' + (i === hits ? '.on' : '') + (m === 0 ? '.zero' : ''), h('small', i + ' ✓'), h('b', m ? mx(m) : '—'))) : h('span.small.muted', t('Pick numbers to see the prizes.')));
  }
  function paintAll() { paintGrid(); paintPay(); paintCtl(); }
  async function once(auto) {
    if (busyNow || env.paused()) return null; if (!picks.length) { toast(t('Pick at least one number'), 'info'); return null; } if (env.bet() > S.me.coins) { toast(t('Not enough coins'), 'err'); return null; }
    busyNow = true; drawn = []; shown = 0; env.hold(true); paintAll();
    let r; try { r = await api.post('/api/casino/play/keno', { bet: env.bet(), picks }); } catch (e) { busyNow = false; env.hold(false); paintAll(); env.err(e); return null; }
    drawn = r.result.drawn;
    for (shown = 1; shown <= 10; shown++) { if (!env.alive()) return null; paintGrid(); paintPay(); snd(picks.includes(drawn[shown - 1]) ? 'coin' : 'tick'); await env.pause(reduced() ? 20 : auto ? 70 : 160); }
    shown = 10; busyNow = false; env.hold(false);
    resultBox(res, r, t('{h} of {p} matched · {m}', { h: r.result.hits, p: picks.length, m: mx(r.mult) }));
    env.done(Object.assign(r, { desc: t('Keno') + ' · ' + r.result.hits + '/' + picks.length + ' · ' + mx(r.mult) })); paintAll();
    return r;
  }
  const auto = autoBet(env, once, () => paintAll());
  function paintCtl() {
    const lock = busyNow || auto.on;
    mount(env.betBox, betRow(Object.assign({}, env, { onBet: paintCtl }), { disabled: lock }),
      h('div.row', { style: 'gap:6px;flex-wrap:wrap' },
        h('button.btn.sm', { type: 'button', disabled: lock, onClick: () => { const pool = [...Array(40).keys()].map((x) => x + 1); const n = picks.length || 10; picks = []; while (picks.length < n) picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]); drawn = []; shown = 0; save(); paintAll(); } }, '🎲 ' + t('Random pick')),
        h('button.btn.sm', { type: 'button', disabled: lock || !picks.length, onClick: () => { picks = []; drawn = []; shown = 0; save(); paintAll(); } }, t('Clear'))),
      sumBox([[t('Numbers'), picks.length + ' / 10'], [t('Top prize'), picks.length ? mx(Math.max(...env.cfg.keno[picks.length])) : '—']]),
      env.pausedBox(), goBtn(t('Play'), () => once(false), lock || env.paused() || !picks.length || S.me.coins < 1, coin(env.bet())), auto.row());
  }
  paintAll();
  return () => {};
}

// ================= LIMBO =================
export function limbo(env) {
  let target = clamp(Number(ls('casino.limbo')) || 2, 1.01, env.cfg.limboMax); let busyNow = false;
  const num = h('div.cx-lnum', '1.00×'); const bar = h('div.cx-lbar', h('i')); const res = h('div.cs-result', h('span.muted', t('Pick a target. If the number reaches it, you win bet × target.')));
  const rocket = h('div.cx-lrocket', '🚀');
  mount(env.stage, h('div.cx-limbo', h('div.cx-lstars'), rocket, num, bar), res);
  const chance = () => Math.min(98, 98 / target);
  async function once(auto) {
    if (busyNow || env.paused()) return null; if (env.bet() > S.me.coins) { toast(t('Not enough coins'), 'err'); return null; }
    busyNow = true; env.hold(true); paintCtl(); num.className = 'cx-lnum'; rocket.className = 'cx-lrocket go';
    let r; try { r = await api.post('/api/casino/play/limbo', { bet: env.bet(), target }); } catch (e) { busyNow = false; env.hold(false); rocket.className = 'cx-lrocket'; paintCtl(); env.err(e); return null; }
    const p = r.result.point; snd('spin');
    await animate(auto ? 450 : 900, (k) => { const v = Math.exp(Math.log(p) * easeOut(k)); num.textContent = mx(v); bar.firstChild.style.width = Math.min(100, (Math.log(v) / Math.log(Math.max(target * 1.25, 1.1))) * 100) + '%'; });
    num.textContent = mx(p); num.className = 'cx-lnum ' + (r.net > 0 ? 'win' : 'lose'); rocket.className = 'cx-lrocket ' + (r.net > 0 ? 'win' : 'boom');
    busyNow = false; env.hold(false);
    resultBox(res, r, t('Result {p} · target {t}', { p: mx(p), t: mx(target) }));
    env.done(Object.assign(r, { desc: t('Limbo') + ' · ' + mx(p) + ' / ' + mx(target) })); paintCtl();
    return r;
  }
  const auto = autoBet(env, once, () => paintCtl());
  function paintCtl() {
    const lock = busyNow || auto.on;
    const ti = h('input.input', { type: 'number', min: '1.01', max: String(env.cfg.limboMax), step: '0.01', value: String(target), disabled: lock, 'aria-label': t('Target'), onChange: (e) => { target = clamp(Math.floor(Number(e.target.value) * 100) / 100 || 2, 1.01, env.cfg.limboMax); ls('casino.limbo', target); paintCtl(); } });
    mount(env.betBox, betRow(Object.assign({}, env, { onBet: paintCtl }), { disabled: lock }),
      h('div.row', { style: 'gap:8px;flex-wrap:wrap;align-items:flex-end' }, h('div.grow', { style: 'min-width:120px' }, field(t('Target'), ti)),
        h('div.row', { style: 'gap:6px;margin-bottom:2px' }, [1.5, 2, 10, 100, 1000].map((v) => h('button.btn.sm', { type: 'button', disabled: lock, onClick: () => { target = v; ls('casino.limbo', v); paintCtl(); } }, v + '×')))),
      sumBox([[t('Win chance'), (Math.round(chance() * 100) / 100) + '%'], [t('Payout on win'), h('span.coin', fmt.coins(Math.floor(env.bet() * target)))]]),
      env.pausedBox(), goBtn(t('Launch'), () => once(false), lock || env.paused() || S.me.coins < 1, coin(env.bet())), auto.row());
  }
  paintCtl();
  return () => {};
}

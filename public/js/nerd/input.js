// Nerd Lab → Input & display: keyboard rollover, mouse + polling rate, reflex tests, gamepad (with stick-drift check), screen tests and audio.
// Nothing here is recorded or uploaded — every test runs inside your browser and stops when you leave the tab.
import { h, mount, ls, clamp } from '../util.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { toast, tabsEl } from '../ui.js';
import { card, kv, stat, pill, sparkline, mean, median, pctl, round, snapHz, sleep } from './common.js';

// ============================================================ keyboard
const L = (code, label, w = 1) => ({ code, label, w }); const G = (w) => ({ gap: w });
const FN = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => L('F' + (a + i), 'F' + (a + i)));
const ch = (s) => [...s].map((c) => L(/\d/.test(c) ? 'Digit' + c : 'Key' + c, c));
const KB_MAIN = [
  [L('Escape', 'Esc'), G(1), ...FN(1, 4), G(0.5), ...FN(5, 8), G(0.5), ...FN(9, 12)],
  [L('Backquote', '`'), ...ch('1234567890'), L('Minus', '-'), L('Equal', '='), L('Backspace', '⌫', 2)],
  [L('Tab', 'Tab', 1.5), ...ch('QWERTYUIOP'), L('BracketLeft', '['), L('BracketRight', ']'), L('Backslash', '\\', 1.5)],
  [L('CapsLock', 'Caps', 1.75), ...ch('ASDFGHJKL'), L('Semicolon', ';'), L('Quote', "'"), L('Enter', 'Enter', 2.25)],
  [L('ShiftLeft', 'Shift', 2.25), ...ch('ZXCVBNM'), L('Comma', ','), L('Period', '.'), L('Slash', '/'), L('ShiftRight', 'Shift', 2.75)],
  [L('ControlLeft', 'Ctrl', 1.25), L('MetaLeft', 'Win', 1.25), L('AltLeft', 'Alt', 1.25), L('Space', '', 6.25), L('AltRight', 'Alt', 1.25), L('MetaRight', 'Win', 1.25), L('ContextMenu', '☰', 1.25), L('ControlRight', 'Ctrl', 1.25)],
];
const KB_NAV = [[L('PrintScreen', 'PrtSc'), L('ScrollLock', 'ScrLk'), L('Pause', 'Pause')], [L('Insert', 'Ins'), L('Home', 'Home'), L('PageUp', 'PgUp')], [L('Delete', 'Del'), L('End', 'End'), L('PageDown', 'PgDn')], [], [G(1), L('ArrowUp', '↑'), G(1)], [L('ArrowLeft', '←'), L('ArrowDown', '↓'), L('ArrowRight', '→')]];
const KB_NUM = [[], [L('NumLock', 'Num'), L('NumpadDivide', '/'), L('NumpadMultiply', '*'), L('NumpadSubtract', '-')], [L('Numpad7', '7'), L('Numpad8', '8'), L('Numpad9', '9'), L('NumpadAdd', '+')], [L('Numpad4', '4'), L('Numpad5', '5'), L('Numpad6', '6'), G(1)], [L('Numpad1', '1'), L('Numpad2', '2'), L('Numpad3', '3'), L('NumpadEnter', '⏎')], [L('Numpad0', '0', 2), L('NumpadDecimal', '.'), G(1)]];

function keyboard(box) {
  const els = new Map(); const pressed = new Set(); const seen = new Set(); const extra = new Set(); let max = 0, on = false;
  const total = [...KB_MAIN, ...KB_NAV, ...KB_NUM].flat().filter((k) => k.code).length;
  const grp = (rows, cls) => h('div.kb-grp.' + cls, rows.map((r) => h('div.kb-row', r.map((k) => {
    if (k.gap) return h('div.kb-gap', { style: { '--w': k.gap } });
    const e = h('div.kb-key', { style: { '--w': k.w }, dataset: { code: k.code } }, k.label); els.set(k.code, e); return e;
  }))));
  const stLast = stat(t('Last key'), '—'), stHeld = stat(t('Held now'), '0'), stMax = stat(t('Most at once'), '0'), stSeen = stat(t('Keys tested'), `0 / ${total}`);
  const extraBox = h('div.nl-pills'); const toggle = h('button.btn.primary', { onClick: () => setOn(!on) });
  const label = (e) => (e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key);
  function update(e) {
    if (e) stLast.set(`${label(e)}`, undefined, `${e.code || ''}${e.location === 3 ? ' · numpad' : e.location === 1 ? ' · left' : e.location === 2 ? ' · right' : ''}`);
    max = Math.max(max, pressed.size); stHeld.set(pressed.size); stMax.set(max); stSeen.set(`${seen.size} / ${total}`);
  }
  function down(e) { e.preventDefault(); e.stopPropagation(); const c = e.code || e.key; pressed.add(c); const el = els.get(c); if (el) { el.classList.add('on', 'seen'); seen.add(c); } else if (c && !extra.has(c)) { extra.add(c); extraBox.appendChild(pill(c)); } update(e); }
  function up(e) { e.preventDefault(); e.stopPropagation(); const c = e.code || e.key; pressed.delete(c); const el = els.get(c); if (el) el.classList.remove('on'); update(e); }
  function clearHeld() { pressed.clear(); els.forEach((e) => e.classList.remove('on')); update(); }
  function setOn(v) {
    on = v;
    if (v) { document.addEventListener('keydown', down, true); document.addEventListener('keyup', up, true); window.addEventListener('blur', clearHeld); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }
    else { document.removeEventListener('keydown', down, true); document.removeEventListener('keyup', up, true); window.removeEventListener('blur', clearHeld); clearHeld(); }
    mount(toggle, icon(v ? 'pause' : 'play', 16), v ? t('Stop testing') : t('Start testing')); box.classList.toggle('capturing', v);
  }
  mount(box,
    h('div.row.wrap', toggle, h('button.btn', { onClick: () => { seen.clear(); extra.clear(); max = 0; els.forEach((e) => e.classList.remove('seen', 'on')); mount(extraBox); pressed.clear(); update(); stLast.set('—', undefined, ''); } }, icon('refresh', 16), t('Reset')),
      h('span.small.muted.grow', t('Press "Start testing", then hit keys. While testing, the page ignores shortcuts — click "Stop testing" with the mouse to leave.'))),
    h('div.nl-tiles.sm', stLast, stHeld, stMax, stSeen),
    h('div.kb-wrap', h('div.kb', grp(KB_MAIN, 'main'), grp(KB_NAV, 'nav'), grp(KB_NUM, 'num'))),
    h('div.small.muted', t('Other keys detected:'), ' ', extraBox),
    h('p.tiny.muted', t('"Most at once" shows how many keys your keyboard can register together (rollover). Some combinations are blocked by keyboard hardware or the operating system, not by this page.')));
  setOn(false);
  return () => setOn(false);
}

// ============================================================ mouse
function mouse(box) {
  const names = [[0, 'Left'], [1, 'Middle'], [2, 'Right'], [3, 'Back'], [4, 'Forward']]; const lights = {};
  const row = h('div.ms-lights', names.map(([b, n]) => (lights[b] = h('div.ms-light', t(n)))));
  const stPos = stat(t('Pointer'), '—'), stSpeed = stat(t('Speed'), '—', ' px/s'), stHz = stat(t('Polling rate (est.)'), '—', ' Hz', t('Move quickly in circles')), stWheel = stat(t('Wheel'), '0 ↑  0 ↓'), stDbl = stat(t('Double clicks'), '0');
  const pad = h('div.ms-pad', { tabindex: 0, 'aria-label': t('Mouse test area') }, h('div.ms-hint', icon('mouse', 28), h('div', t('Move, click, scroll and double-click in here'))));
  let up = 0, down = 0, dbl = 0, peak = 0; const ts = []; let mv = []; const raw = 'onpointerrawupdate' in window;
  const snap = (hz) => [125, 250, 500, 1000, 2000, 4000, 8000].find((r) => Math.abs(hz - r) / r < 0.22) || Math.round(hz);
  const onDown = (e) => { const l = lights[e.button]; if (l) l.classList.add('on', 'seen'); try { pad.setPointerCapture(e.pointerId); } catch {} pad.focus({ preventScroll: true }); };
  const onUp = (e) => { const l = lights[e.button]; if (l) l.classList.remove('on'); };
  const stop = (e) => e.preventDefault();
  const onWheel = (e) => { e.preventDefault(); if (e.deltaY < 0) up++; else if (e.deltaY > 0) down++; stWheel.set(`${up} ↑  ${down} ↓`); };
  const onMove = (e) => {
    const r = pad.getBoundingClientRect(); stPos.set(`${Math.round(e.clientX - r.left)}, ${Math.round(e.clientY - r.top)}`);
    const list = e.getCoalescedEvents ? e.getCoalescedEvents() : []; if (list.length) for (const c of list) ts.push(c.timeStamp); else ts.push(e.timeStamp);
    if (ts.length > 500) ts.splice(0, ts.length - 500); mv.push([performance.now(), Math.hypot(e.movementX || 0, e.movementY || 0)]);
  };
  const timer = setInterval(() => {
    const now = performance.now(); mv = mv.filter((m) => now - m[0] < 300); const px = mv.reduce((a, m) => a + m[1], 0); stSpeed.set(mv.length ? Math.round(px / 0.3) : 0);
    const d = []; for (let i = 1; i < ts.length; i++) { const x = ts[i] - ts[i - 1]; if (x > 0 && x < 30) d.push(x); }
    if (d.length >= 25 && now - (mv.length ? mv[mv.length - 1][0] : 0) < 400) { const hz = 1000 / median(d); peak = Math.max(peak * 0.995, hz); stHz.set(snap(peak), undefined, t('Estimate — browsers may cap it at your screen refresh rate')); }
  }, 300);
  pad.addEventListener('pointerdown', onDown); pad.addEventListener('pointerup', onUp); pad.addEventListener('pointercancel', onUp); pad.addEventListener('contextmenu', stop); pad.addEventListener('auxclick', stop); pad.addEventListener('mouseup', stop);
  pad.addEventListener('wheel', onWheel, { passive: false }); pad.addEventListener(raw ? 'pointerrawupdate' : 'pointermove', onMove); pad.addEventListener('dblclick', () => stDbl.set(++dbl));
  mount(box, h('div.nl-tiles.sm', stPos, stSpeed, stHz, stWheel, stDbl), pad, row,
    h('p.tiny.muted', t('Back/Forward buttons are captured inside the test area so they will not change the page. Polling rate is a best-effort estimate from event timestamps.')));
  return () => { clearInterval(timer); };
}

// ============================================================ reflex (CPS + reaction)
function reflex(box) {
  // --- clicks per second ---
  const DUR = 5000; let n = 0, started = 0, ct = null, cs = 'idle'; let bestC = ls('nerd.cps') || 0;
  const cpsBtn = h('button.cps-btn', { onPointerdown: (e) => { if (e.pointerType === 'mouse' && e.button !== 0) return; hit(); }, onKeydown: (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); hit(); } } });
  const cpsInfo = h('div.small.muted');
  function hit() { if (cs === 'done') return; if (cs === 'idle') { cs = 'run'; started = performance.now(); n = 0; ct = setInterval(tick, 50); } n++; paintC(); }
  function tick() { const el = performance.now() - started; if (el >= DUR) { clearInterval(ct); cs = 'done'; const c = n / (DUR / 1000); if (c > bestC) { bestC = c; ls('nerd.cps', round(c, 2)); } } paintC(); }
  function paintC() {
    const el = cs === 'run' ? performance.now() - started : DUR; const left = Math.max(0, (DUR - (cs === 'idle' ? 0 : el)) / 1000);
    cpsBtn.classList.toggle('run', cs === 'run'); cpsBtn.classList.toggle('done', cs === 'done');
    mount(cpsBtn, h('div.big', cs === 'idle' ? t('Click here!') : cs === 'run' ? String(n) : round(n / (DUR / 1000), 1) + ' CPS'), h('div.small', cs === 'idle' ? t('The 5-second timer starts on your first click') : cs === 'run' ? t('{s}s left', { s: left.toFixed(1) }) : t('Click "Try again" to repeat')));
    mount(cpsInfo, t('Best: {v} CPS', { v: bestC ? round(bestC, 1) : '—' }), cs === 'run' ? ' · ' + round(n / Math.max(0.2, (performance.now() - started) / 1000), 1) + ' CPS' : '');
  }
  // --- reaction time ---
  let rs = 'idle', rto = null, r0 = 0; const runs = []; let bestR = ls('nerd.react') || 0;
  const rx = h('div.rx-pad', { tabindex: 0, role: 'button', onPointerdown: (e) => { if (e.pointerType === 'mouse' && e.button !== 0) return; press(e.timeStamp); }, onKeydown: (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); press(e.timeStamp); } } });
  const rxInfo = h('div.small.muted');
  function press(ts) {
    if (rs === 'idle' || rs === 'result' || rs === 'early') { rs = 'wait'; paintR(); rto = setTimeout(() => { rs = 'go'; paintR(); requestAnimationFrame((f) => { r0 = f; }); r0 = performance.now(); }, 1200 + Math.random() * 2800); }
    else if (rs === 'wait') { clearTimeout(rto); rs = 'early'; paintR(); }
    else if (rs === 'go') { const ms = Math.max(1, Math.round(ts - r0)); runs.push(ms); if (runs.length > 5) runs.shift(); if (!bestR || ms < bestR) { bestR = ms; ls('nerd.react', ms); } rs = 'result'; last = ms; paintR(); }
  }
  let last = 0; const verdict = (ms) => (ms < 180 ? t('Pro-level') : ms < 230 ? t('Fast') : ms < 300 ? t('Average') : t('Warm up first'));
  function paintR() {
    rx.dataset.s = rs;
    mount(rx, h('div.big', rs === 'idle' ? t('Click to start') : rs === 'wait' ? t('Wait for green…') : rs === 'go' ? t('CLICK!') : rs === 'early' ? t('Too soon!') : `${last} ms`),
      h('div.small', rs === 'result' ? verdict(last) + ' · ' + t('click to go again') : rs === 'early' ? t('Click to try again') : ''));
    mount(rxInfo, t('Best: {v}', { v: bestR ? bestR + ' ms' : '—' }), runs.length ? ' · ' + t('Average of last {n}: {v} ms', { n: runs.length, v: Math.round(mean(runs)) }) : '');
  }
  mount(box, h('div.grid.cols-2',
    h('div.col', h('h4', icon('mouse', 16), ' ', t('Click speed (CPS)')), cpsBtn, cpsInfo, h('button.btn.sm', { onClick: () => { clearInterval(ct); cs = 'idle'; n = 0; paintC(); } }, icon('refresh', 14), t('Try again'))),
    h('div.col', h('h4', icon('bolt', 16), ' ', t('Reaction time')), rx, rxInfo)),
    h('p.tiny.muted', t('Reaction results depend on your screen and input device. Your best scores are saved on this device only.')));
  paintC(); paintR();
  return () => { clearInterval(ct); clearTimeout(rto); };
}

// ============================================================ gamepad
const PAD_STD = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', '↑', '↓', '←', '→', 'Home'];
function gamepad(box) {
  const list = h('div.col'); const views = new Map(); let raf = 0, alive = true;
  const none = h('div.empty', h('div.empty-art.ea-mark'), h('h3', t('No controller detected')), h('p', t('Connect a controller (USB or Bluetooth) and press any button — browsers keep pads hidden until you do.')));
  mount(box, list, h('p.tiny.muted', t('Works with Xbox, PlayStation, Switch and most generic pads. Stick drift check: let go of both sticks and press the button.')));
  function build(pad) {
    const std = pad.mapping === 'standard'; const btns = pad.buttons.map((_, i) => { const i2 = h('i'); const el = h('div.gp-b', { title: String(i) }, i2, h('span', std && PAD_STD[i] ? PAD_STD[i] : String(i))); return { el, fill: i2, v: -1 }; });
    const stick = (name) => { const dot = h('i'); const txt = h('div.tiny.mono', '0.00 · 0.00'); return { el: h('div.gp-stick', h('div.gp-well', dot), h('div.small', name), txt), dot, txt }; };
    const sL = stick(t('Left stick')), sR = stick(t('Right stick')); const hz = h('b', '—'); const driftOut = h('div.small'); let drift = null;
    const rumble = pad.vibrationActuator || (pad.hapticActuators && pad.hapticActuators[0]);
    const rb = rumble ? h('button.btn.sm', { onClick: () => { try { if (pad.vibrationActuator && pad.vibrationActuator.playEffect) pad.vibrationActuator.playEffect('dual-rumble', { duration: 500, strongMagnitude: 0.9, weakMagnitude: 0.5 }); else if (rumble.pulse) rumble.pulse(1, 500); } catch { toast(t('This controller cannot rumble in this browser.'), 'err'); } } }, icon('bolt', 14), t('Rumble')) : null;
    const db = h('button.btn.sm', { onClick: () => { drift = { t0: performance.now(), s: [[], [], [], []] }; db.disabled = true; driftOut.textContent = t('Sampling for 3 seconds… keep the sticks untouched.'); } }, icon('eye', 14), t('Stick drift check'));
    const el = h('div.card.gp', h('div.row.wrap', h('b.grow.ellipsis', { title: pad.id }, pad.id.replace(/\(.*?\)/g, '').trim() || pad.id), pill('#' + pad.index), pill(std ? t('Standard layout') : t('Custom layout')), pill(t('{n} buttons', { n: pad.buttons.length }))),
      h('div.gp-layout', h('div.gp-sticks', sL.el, sR.el), h('div.gp-btns', btns.map((b) => b.el))), h('div.row.wrap', rb, db, h('span.small.muted', t('Updates/s: '), hz)), driftOut);
    return { pad, el, btns, sL, sR, hz, endDrift() { drift = null; db.disabled = false; }, driftOut, lastTs: 0, upd: 0, t0: performance.now(), sampleDrift(p) { if (!drift) return; for (let i = 0; i < 4; i++) drift.s[i].push(p.axes[i] || 0); if (performance.now() - drift.t0 > 3000) { const r = (a) => { const m = mean(a); return { m, span: Math.max(...a) - Math.min(...a) }; }; const o = [r(drift.s[0]), r(drift.s[1]), r(drift.s[2]), r(drift.s[3])]; const v = (a, b) => { const d = Math.max(Math.abs(a.m), Math.abs(b.m)); return d < 0.05 && a.span < 0.1 && b.span < 0.1 ? t('OK') : d < 0.12 ? t('Slight drift') : t('Drifting — consider cleaning or replacing the stick'); }; mount(driftOut, t('Left: {v}', { v: v(o[0], o[1]) }), ' · ', t('Right: {v}', { v: v(o[2], o[3]) }), ' ', h('span.muted', `(L ${o[0].m.toFixed(2)}, ${o[1].m.toFixed(2)} · R ${o[2].m.toFixed(2)}, ${o[3].m.toFixed(2)})`)); this.endDrift(); } } };
  }
  function loop() {
    if (!alive) return;
    const pads = (navigator.getGamepads ? [...navigator.getGamepads()] : []).filter(Boolean);
    for (const [k, v] of views) if (!pads.some((p) => p.index === k && p.id === v.pad.id)) { v.el.remove(); views.delete(k); }
    for (const p of pads) {
      let v = views.get(p.index); if (!v) { v = build(p); views.set(p.index, v); list.appendChild(v.el); }
      p.buttons.forEach((b, i) => { const bt = v.btns[i]; if (!bt) return; const val = b.value !== undefined ? b.value : b.pressed ? 1 : 0; if (val !== bt.v) { bt.v = val; bt.fill.style.height = Math.round(val * 100) + '%'; bt.el.classList.toggle('on', b.pressed || val > 0.5); } });
      const ax = (i) => p.axes[i] || 0; const place = (s, x, y) => { s.dot.style.transform = `translate(${x * 34}px, ${y * 34}px)`; s.txt.textContent = `${x.toFixed(2)} · ${y.toFixed(2)}`; };
      place(v.sL, ax(0), ax(1)); place(v.sR, ax(2), ax(3));
      if (p.timestamp !== v.lastTs) { v.lastTs = p.timestamp; v.upd++; } const el = performance.now() - v.t0; if (el > 1000) { v.hz.textContent = Math.round((v.upd * 1000) / el); v.upd = 0; v.t0 = performance.now(); }
      v.sampleDrift(p);
    }
    none.classList.toggle('hide', pads.length > 0); raf = requestAnimationFrame(loop);
  }
  list.appendChild(none); loop();
  const onConn = (e) => { toast(t('Controller connected: {n}', { n: (e.gamepad.id || '').slice(0, 40) }), 'good', 2500); };
  window.addEventListener('gamepadconnected', onConn);
  return () => { alive = false; cancelAnimationFrame(raf); window.removeEventListener('gamepadconnected', onConn); };
}

// ============================================================ display
const COLOR_STEPS = [
  ['#000000', 'Black'], ['#ffffff', 'White'], ['#ff0000', 'Red'], ['#00ff00', 'Green'], ['#0000ff', 'Blue'], ['#00ffff', 'Cyan'], ['#ff00ff', 'Magenta'], ['#ffff00', 'Yellow'], ['#808080', 'Mid grey'],
  ['linear-gradient(90deg,#000,#fff)', 'Grey gradient (look for banding)'], ['linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)', 'Colour sweep'],
  ['repeating-conic-gradient(#fff 0% 25%,#000 0% 50%) 0 0/48px 48px', 'Checkerboard (look for flicker)'],
];
function fullscreenTest(kind, onClose) {
  const el = h('div.nl-full', { tabindex: 0, role: 'dialog', 'aria-label': t('Screen test') }); const hint = h('div.nl-full-hint'); let i = 0, raf = 0, hintT = 0, closed = false;
  const label = (n) => t(COLOR_STEPS[n][1]);
  const flash = (msg) => { hint.textContent = msg; hint.classList.add('show'); clearTimeout(hintT); hintT = setTimeout(() => hint.classList.remove('show'), 2200); };
  function drawColors() { const [bg, name] = COLOR_STEPS[i]; el.style.background = bg; flash(`${i + 1}/${COLOR_STEPS.length} · ${t(name)} — ${t('click or → next · ← back · Esc exit')}`); }
  let speed = 960;
  function startMotion() {
    el.style.background = '#c8c8c8'; const rows = [480, 960, 1920].map((sp, k) => { const b = h('div.nl-mv', { style: { top: 14 + k * 22 + '%' } }, h('span', 'READABLE? ' + sp + ' px/s')); el.appendChild(b); return { b, sp }; });
    const t0 = performance.now(); const tick = (now) => { const W = innerWidth + 320; for (const r of rows) r.b.style.transform = `translateX(${((now - t0) / 1000 * r.sp * (speed / 960)) % W - 300}px)`; if (!closed) raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick);
    flash(t('Follow the moving text with your eyes. Sharp = fast panel. Smeared or doubled = ghosting. Esc to exit · ↑↓ speed'));
  }
  function key(e) {
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') return close();
    if (kind === 'colors') { if (['ArrowRight', ' ', 'Enter', 'PageDown'].includes(e.key)) { i = (i + 1) % COLOR_STEPS.length; drawColors(); } else if (['ArrowLeft', 'Backspace', 'PageUp'].includes(e.key)) { i = (i + COLOR_STEPS.length - 1) % COLOR_STEPS.length; drawColors(); } }
    else if (e.key === 'ArrowUp') { speed = Math.min(3840, speed * 1.25); flash(`×${(speed / 960).toFixed(2)}`); } else if (e.key === 'ArrowDown') { speed = Math.max(120, speed / 1.25); flash(`×${(speed / 960).toFixed(2)}`); }
  }
  function close() { if (closed) return; closed = true; cancelAnimationFrame(raf); clearTimeout(hintT); document.removeEventListener('keydown', key, true); document.removeEventListener('fullscreenchange', onFs); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); el.remove(); onClose && onClose(); }
  const onFs = () => { if (!document.fullscreenElement && entered) close(); }; let entered = false;
  el.addEventListener('click', () => { if (kind === 'colors') { i = (i + 1) % COLOR_STEPS.length; drawColors(); } });
  document.body.appendChild(el); el.appendChild(hint); document.addEventListener('keydown', key, true); document.addEventListener('fullscreenchange', onFs);
  if (el.requestFullscreen) el.requestFullscreen().then(() => { entered = true; }).catch(() => {});
  if (kind === 'colors') drawColors(); else startMotion();
  return close;
}

function display(box) {
  const stHz = stat(t('Refresh rate'), '—', ' Hz'), stFps = stat(t('Current FPS'), '—'), stLow = stat(t('1% low'), '—', ' FPS'), stJit = stat(t('Frame-time jitter'), '—', ' ms');
  const chart = sparkline({ h: 110 }); let raf = 0, last = 0, lastPaint = 0, alive = true; const ft = []; let closer = null;
  function loop(now) {
    if (!alive) return; if (document.hidden) { last = 0; raf = requestAnimationFrame(loop); return; }
    if (last) { ft.push(now - last); if (ft.length > 240) ft.shift(); } last = now;
    if (now - lastPaint > 250 && ft.length > 12) {
      lastPaint = now; const med = median(ft); stHz.set(snapHz(1000 / med)); stFps.set(Math.round(1000 / mean(ft))); stLow.set(Math.round(1000 / pctl(ft, 99)));
      stJit.set(round(mean(ft.slice(1).map((v, k) => Math.abs(v - ft[k]))), 2)); chart.draw(ft, { min: 0, max: Math.max(24, pctl(ft, 99) * 1.2) });
    }
    raf = requestAnimationFrame(loop);
  }
  const launch = (kind) => { if (closer) closer(); closer = fullscreenTest(kind, () => { closer = null; }); };
  mount(box, h('div.nl-tiles.sm', stHz, stFps, stLow, stJit),
    h('div.card.flat', h('div.row.between', h('b', t('Frame times (live)')), h('span.tiny.muted', t('Lower and flatter is better'))), chart),
    h('div.row.wrap', { style: 'margin-top:12px' }, h('button.btn.primary', { onClick: () => launch('colors') }, icon('monitor', 16), t('Colour & dead-pixel test')), h('button.btn', { onClick: () => launch('motion') }, icon('bolt', 16), t('Motion / ghosting test')),
      h('button.btn', { onClick: () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {}); } }, icon('fullscreen', 16), t('Toggle fullscreen'))),
    h('p.tiny.muted', { style: 'margin-top:10px' }, t('Dead-pixel test: cycle through solid colours in fullscreen and look for dots that stay a different colour. Click or press → for the next screen.')));
  raf = requestAnimationFrame(loop);
  return () => { alive = false; cancelAnimationFrame(raf); if (closer) closer(); };
}

// ============================================================ audio
function audio(box) {
  let ac = null, vol = ls('nerd.vol') ?? 25, sweepRaf = 0, mic = null, micRaf = 0;
  const ctx = () => { if (!ac) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) throw new Error(t('Web Audio is not available in this browser.')); ac = new AC(); } if (ac.state === 'suspended') ac.resume(); return ac; };
  const gainOf = () => Math.pow(vol / 100, 2) * 0.6;
  const readout = h('div.nl-big.mono', '—');
  function tone(pan, freq = 440, dur = 1.2, sweepTo) {
    try {
      const a = ctx(); const o = a.createOscillator(), g = a.createGain(); const p = a.createStereoPanner ? a.createStereoPanner() : null; const now = a.currentTime;
      o.type = 'sine'; o.frequency.setValueAtTime(freq, now); if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, now + dur);
      g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainOf()), now + 0.03); g.gain.setValueAtTime(Math.max(0.0002, gainOf()), now + dur - 0.05); g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      if (p) { p.pan.value = pan; o.connect(g); g.connect(p); p.connect(a.destination); } else { o.connect(g); g.connect(a.destination); }
      o.start(now); o.stop(now + dur + 0.05);
      if (sweepTo) { const t0 = performance.now(); cancelAnimationFrame(sweepRaf); const tick = () => { const k = (performance.now() - t0) / (dur * 1000); if (k >= 1) { readout.textContent = '—'; return; } readout.textContent = Math.round(freq * Math.pow(sweepTo / freq, k)) + ' Hz'; sweepRaf = requestAnimationFrame(tick); }; tick(); }
      else readout.textContent = pan < 0 ? t('Left speaker') : pan > 0 ? t('Right speaker') : t('Both speakers');
    } catch (e) { toast(e.message, 'err'); }
  }
  const vslider = h('input', { type: 'range', min: 0, max: 100, value: vol, 'aria-label': t('Volume'), onInput: (e) => { vol = +e.target.value; ls('nerd.vol', vol); } });
  // microphone meter
  const meter = h('div.nl-bar.mic', h('i')), peakEl = h('span.mono', '—'), micName = h('span.small.muted'); const micBtn = h('button.btn', { onClick: () => (mic ? stopMic() : startMic()) }, icon('volume', 16), t('Start microphone check'));
  async function startMic() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error(t('Microphone access needs a secure page (https or localhost).'));
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); const a = ctx(); const src = a.createMediaStreamSource(stream); const an = a.createAnalyser(); an.fftSize = 1024; src.connect(an);
      mic = { stream, src, an }; micName.textContent = (stream.getAudioTracks()[0] || {}).label || ''; mount(micBtn, icon('pause', 16), t('Stop microphone check')); let pk = -90; const buf = new Float32Array(an.fftSize);
      const tick = () => { if (!mic) return; an.getFloatTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; const db = 20 * Math.log10(Math.sqrt(s / buf.length) || 1e-5); pk = Math.max(db, pk - 0.25); meter.firstChild.style.width = clamp((db + 70) / 70, 0, 1) * 100 + '%'; peakEl.textContent = `${Math.round(db)} dB · ${t('peak')} ${Math.round(pk)} dB`; micRaf = requestAnimationFrame(tick); };
      tick();
    } catch (e) { toast(/denied|NotAllowed/i.test(String(e && (e.name || e.message))) ? t('Microphone permission was denied.') : (e.message || t('No microphone found.')), 'err', 5000); }
  }
  function stopMic() { cancelAnimationFrame(micRaf); if (mic) { mic.stream.getTracks().forEach((tr) => tr.stop()); try { mic.src.disconnect(); } catch {} mic = null; } meter.firstChild.style.width = '0%'; peakEl.textContent = '—'; mount(micBtn, icon('volume', 16), t('Start microphone check')); }
  mount(box, h('div.grid.cols-2',
    h('div.col', h('h4', icon('volume', 16), ' ', t('Speaker test')), h('div.row', h('span.small.muted', t('Volume')), vslider),
      h('div.row.wrap', h('button.btn', { onClick: () => tone(-1) }, t('Left')), h('button.btn', { onClick: () => tone(0) }, t('Both')), h('button.btn', { onClick: () => tone(1) }, t('Right')), h('button.btn', { onClick: () => tone(0, 20, 8, 20000) }, icon('play', 14), t('Sweep 20 Hz → 20 kHz'))), readout,
      h('p.tiny.muted', t('Start low, then raise the volume. If the sound comes from the wrong side, check your cables or the Windows sound settings.'))),
    h('div.col', h('h4', icon('volume', 16), ' ', t('Microphone check')), micBtn, meter, h('div.row.between.wrap', peakEl, micName),
      h('p.tiny.muted', t('Audio from your microphone is only measured on this page — nothing is recorded or sent anywhere.')))));
  return () => { cancelAnimationFrame(sweepRaf); stopMic(); if (ac) { ac.close().catch(() => {}); ac = null; } };
}

const SUBS = [['kb', 'Keyboard', 'keyboard', keyboard], ['ms', 'Mouse', 'mouse', mouse], ['rx', 'Reflexes', 'bolt', reflex], ['gp', 'Gamepad', 'gamepad', gamepad], ['dp', 'Display', 'monitor', display], ['au', 'Audio', 'volume', audio]];
export default {
  mount(host, ctx) {
    let cur = null, cleanup = null; const pane = h('div.nl-pane');
    const start = ctx && ctx.query && ctx.query.get('s'); const first = SUBS.some((s) => s[0] === start) ? start : 'kb';
    function show(id) { if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; } cur = id; mount(pane); const box = h('div.nl-sub', { dataset: { sub: id } }); pane.appendChild(box); cleanup = SUBS.find((s) => s[0] === id)[3](box); }
    const tabs = tabsEl(SUBS.map(([id, l, ic]) => [id, t(l), ic]), first, show);
    mount(host, tabs, pane); show(first);
    return () => { if (cleanup) cleanup(); };
  },
};

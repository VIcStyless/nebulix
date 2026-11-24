// Pointer effects for the whole app, driven by three delegated listeners (no per-element wiring):
//  • spotlight — writes --mx/--my (percent) on the hovered card/tile so CSS can paint a glow under the cursor
//  • tilt      — tiles lean towards the cursor in 3D
//  • ripple    — a soft ink ripple where you press a button
// All of it is skipped when the user prefers reduced motion (OS setting or the in-app switch).
const SPOT = '.site-tile, .spot, .card, .hb-card, .hbx-row, .kpi, .app-tile, .cl-card, .auth-card';
const TILT = '.site-tile, .th-prev, .rd-card, .syn-style, .game-card, .arc-card';
const RIPPLE = '.btn.primary, .btn.lg, .app-tile, .site-tile, .nv-chip, .chip, .rail-btn, .nv-game';

const reduced = () => document.documentElement.dataset.reduce === '1' || (document.documentElement.dataset.reduce !== '0' && matchMedia('(prefers-reduced-motion: reduce)').matches);
let tilted = null;

function onMove(e) {
  const t = e.target; if (!t || !t.closest) return;
  const el = t.closest(SPOT);
  if (el) {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
    el.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
    el.style.setProperty('--tx', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(2)); el.style.setProperty('--ty', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(2));
  }
  if (e.pointerType === 'touch' || reduced()) return;
  const tl = t.closest(TILT);
  if (tilted && tilted !== tl) { tilted.style.transform = ''; tilted = null; }
  if (tl) {
    const r = tl.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width - .5; const py = (e.clientY - r.top) / r.height - .5;
    tl.style.transform = `perspective(700px) rotateX(${(-py * 9).toFixed(2)}deg) rotateY(${(px * 11).toFixed(2)}deg) translateY(-4px) scale(1.02)`;
    tilted = tl;
  }
}
function onLeave(e) { if (tilted && (!e || e.type === 'blur' || e.target === tilted || e.target === document)) { tilted.style.transform = ''; tilted = null; } }

function onDown(e) {
  if (e.button || reduced()) return;
  const el = e.target.closest && e.target.closest(RIPPLE); if (!el || el.disabled) return;
  const r = el.getBoundingClientRect(); const d = Math.max(r.width, r.height) * 2.2;
  const s = document.createElement('span'); s.className = 'nv-rpl';
  s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  const cs = getComputedStyle(el); if (cs.position === 'static') el.style.position = 'relative'; if (cs.overflow === 'visible') el.style.overflow = 'hidden';
  el.appendChild(s); setTimeout(() => s.remove(), 650);
}

// A soft light that trails the cursor behind the interface (sits with the ambient aurora, under #app).
function initCursorLight() {
  if (matchMedia('(pointer: coarse)').matches) return;
  const orb = document.createElement('div'); orb.id = 'nv-cursor'; orb.setAttribute('aria-hidden', 'true'); document.body.insertBefore(orb, document.body.firstChild);
  let tx = innerWidth / 2, ty = innerHeight / 3, x = tx, y = ty, raf = 0, seen = false;
  const step = () => { x += (tx - x) * .12; y += (ty - y) * .12; orb.style.transform = `translate3d(${(x - 260).toFixed(1)}px, ${(y - 260).toFixed(1)}px, 0)`; raf = Math.abs(tx - x) + Math.abs(ty - y) > .5 ? requestAnimationFrame(step) : 0; };
  document.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch') return; tx = e.clientX; ty = e.clientY; if (!seen) { seen = true; orb.classList.add('on'); } if (reduced()) { orb.classList.remove('on'); seen = false; return; } if (!raf) raf = requestAnimationFrame(step); }, { passive: true });
  document.addEventListener('pointerleave', (e) => { if (e.target === document) { orb.classList.remove('on'); seen = false; } }, true);
}

export function initHoverGlow() {
  initCursorLight();
  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerleave', onLeave, true);
  document.addEventListener('pointerdown', onDown, { passive: true });
  window.addEventListener('blur', onLeave);
}

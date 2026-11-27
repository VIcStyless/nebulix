// Nebulix 3.0 phase 23 — automatic playtime for Nebulix's own games. A second counts only when a game page is open, the
// tab is visible and you touched the mouse, keyboard, screen or a controller in the last two minutes. Totals go to
// /api/playtime about once a minute (and when you leave the tab). Shown in Game library → Playtime. The server caps every
// report at the real time that passed, so the numbers cannot be inflated.
export const GAME_ROUTES = new Set(['games', 'arena', 'fusion', 'dash', 'retro', 'worlds', 'boss', 'quiz', 'word', 'play', 'music', 'arcade', 'casino', 'casino3d', 'ranked', 'vault', 'gamemaker']);
const IDLE = 120000;
let started = false, lastInput = Date.now(), pending = new Map(), getInfo = null, lastSent = Date.now();

export function keyOf(hash) {
  const raw = String(hash || '').replace(/^#\/?/, ''); const [path, q] = raw.split('?'); const parts = path.split('/').filter(Boolean);
  const name = (parts[0] || '').toLowerCase(); if (!GAME_ROUTES.has(name)) return null;
  const qs = new URLSearchParams(q || ''); const sub = String(parts[1] || qs.get('play') || qs.get('game') || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
  return sub ? name + '/' + sub : name;
}
function tick() {
  if (document.visibilityState !== 'visible' || Date.now() - lastInput > IDLE) return;
  const info = getInfo ? getInfo() : null; if (!info || info.desktop) return;
  const key = keyOf(location.hash); if (!key) return;
  const p = pending.get(key) || { key, sec: 0, title: '' }; p.sec++; if (info.title) p.title = info.title; pending.set(key, p);
}
export async function flush(keepalive = false) {
  if (!pending.size) return; const items = [...pending.values()]; pending = new Map(); lastSent = Date.now();
  try { await fetch('/api/playtime', { method: 'POST', credentials: 'same-origin', keepalive, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items }) }); } catch { for (const it of items) { const p = pending.get(it.key) || { key: it.key, sec: 0, title: it.title }; p.sec += it.sec; pending.set(it.key, p); } }
}
export function start(info) {
  getInfo = info; if (started) return; started = true;
  const seen = () => { lastInput = Date.now(); };
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, seen, { passive: true, capture: true });
  addEventListener('gamepadconnected', seen);
  setInterval(() => { try { if (navigator.getGamepads && [...navigator.getGamepads()].some((g) => g && g.buttons.some((b) => b.pressed))) seen(); } catch {} tick(); if (Date.now() - lastSent > 60000) flush(); }, 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });
  addEventListener('pagehide', () => flush(true));
}
export const pendingSeconds = () => [...pending.values()].reduce((a, p) => a + p.sec, 0);

// "Route map": an original canvas animation for the sign-in screen.
// A loose grid of relay nodes; packets travel along orthogonal routes, converge on the core node (the proxy)
// and leave towards the edges. Colours come from the active theme; honours reduced motion.

const css = (n, d) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d;

export function routeMap({ cols = 9, rows = 6 } = {}) {
  const cv = document.createElement('canvas'); cv.className = 'routemap'; cv.setAttribute('aria-hidden', 'true');
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1, nodes = [], core = null, packets = [], raf = 0, last = 0, alive = true;
  const reduce = () => document.documentElement.dataset.reduce === '1' || matchMedia('(prefers-reduced-motion: reduce)').matches;

  function layout() {
    const r = cv.getBoundingClientRect(); dpr = Math.min(2, devicePixelRatio || 1);
    W = Math.max(1, r.width); H = Math.max(1, r.height); cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    nodes = []; const gx = W / (cols + 1), gy = H / (rows + 1);
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let y = 1; y <= rows; y++) for (let x = 1; x <= cols; x++) {
      if (rnd() < 0.28) continue; // gaps make the grid feel hand-placed
      nodes.push({ x: x * gx + (rnd() - 0.5) * gx * 0.35, y: y * gy + (rnd() - 0.5) * gy * 0.35, gx: x, gy: y, heat: 0 });
    }
    const cx = Math.ceil(cols / 2), cy = Math.ceil(rows / 2);
    core = nodes.reduce((b, n) => (Math.abs(n.gx - cx) + Math.abs(n.gy - cy) < Math.abs(b.gx - cx) + Math.abs(b.gy - cy) ? n : b), nodes[0]);
    packets = [];
  }

  // Orthogonal path: horizontal then vertical, via an elbow.
  function route(a, b) { return [a, { x: b.x, y: a.y }, b]; }
  function spawn() {
    if (!nodes.length) return;
    const from = nodes[(Math.random() * nodes.length) | 0]; if (from === core) return;
    const to = nodes[(Math.random() * nodes.length) | 0];
    const pts = [...route(from, core), ...route(core, to).slice(1)];
    packets.push({ pts, seg: 0, t: 0, speed: 90 + Math.random() * 70, tail: [], end: to });
  }

  function draw(dt) {
    const fg = css('--text', '#ececef'), ac = css('--accent', '#d4ff3f'), line = css('--border', '#24262c');
    ctx.clearRect(0, 0, W, H);
    // faint guide lines between neighbours
    ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.globalAlpha = 0.7; ctx.beginPath();
    for (const n of nodes) for (const m of nodes) if ((m.gx === n.gx + 1 && m.gy === n.gy) || (m.gy === n.gy + 1 && m.gx === n.gx)) { ctx.moveTo(n.x, n.y); ctx.lineTo(m.x, m.y); }
    ctx.stroke(); ctx.globalAlpha = 1;
    // packets
    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i]; const a = p.pts[p.seg], b = p.pts[p.seg + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1; p.t += (p.speed * dt) / len;
      if (p.t >= 1) { p.seg++; p.t = 0; if (p.pts[p.seg] === core) core.heat = 1; if (p.seg >= p.pts.length - 1) { p.end.heat = Math.max(p.end.heat, 0.6); packets.splice(i, 1); continue; } }
      const c = p.pts[p.seg], d = p.pts[p.seg + 1]; const x = c.x + (d.x - c.x) * p.t, y = c.y + (d.y - c.y) * p.t;
      p.tail.push({ x, y }); if (p.tail.length > 14) p.tail.shift();
      ctx.lineCap = 'round';
      for (let k = 1; k < p.tail.length; k++) { ctx.strokeStyle = ac; ctx.globalAlpha = (k / p.tail.length) * 0.85; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.tail[k - 1].x, p.tail[k - 1].y); ctx.lineTo(p.tail[k].x, p.tail[k].y); ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.fillStyle = ac; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    // nodes
    for (const n of nodes) {
      n.heat = Math.max(0, n.heat - dt * 1.4);
      const isCore = n === core; const r = isCore ? 5 : 2;
      ctx.fillStyle = n.heat > 0.01 ? ac : fg; ctx.globalAlpha = isCore ? 1 : 0.28 + n.heat * 0.7;
      ctx.beginPath(); ctx.arc(n.x, n.y, r + n.heat * 2, 0, Math.PI * 2); ctx.fill();
      if (isCore) { ctx.globalAlpha = 0.5 * (1 - (performance.now() % 1800) / 1800); ctx.strokeStyle = ac; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(n.x, n.y, 6 + ((performance.now() % 1800) / 1800) * 22, 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    if (!alive) return;
    if (!cv.isConnected) { alive = false; return; }
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    if (Math.random() < dt * 3.2 && packets.length < 18) spawn();
    draw(dt); raf = requestAnimationFrame(frame);
  }

  const ro = new ResizeObserver(() => { layout(); if (reduce()) { for (let i = 0; i < 6; i++) spawn(); packets.forEach((p) => { p.seg = 1; p.t = 0.5; }); draw(0); } });
  ro.observe(cv);
  requestAnimationFrame(() => { layout(); if (!reduce()) raf = requestAnimationFrame(frame); else draw(0); });
  cv.stop = () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); };
  return cv;
}

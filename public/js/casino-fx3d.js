// 3D for the casino (WebGL / three.js): a small animated scene above every game (coin flip, dice, slots,
// roulette, crash rocket, chips for the rest) that plays the real result, plus the full Horse Racing game.
import { h, mount, fmt, clamp, ls, parseCoins } from './util.js';
import { t } from './i18n.js';
import { api } from './api.js';
import { S } from './state.js';
import { icon } from './icons.js';
import { field } from './ui.js';
import { sfx } from './sfx.js';
import { load3d } from './avatar3d.js';
import { rtxOn, rtxPipeline } from './rtx.js';

export const fx3dOn = () => ls('casino.3d') !== false && !!document.createElement('canvas').getContext('webgl2');
const snd = (k) => { try { sfx[k] && sfx[k](); } catch {} };
const ease = (x) => 1 - Math.pow(1 - x, 3);
const tex = (THREE, w, hh, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = hh; draw(c.getContext('2d'), w, hh); const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4; return tx; };

// A self-contained renderer + loop. Returns { el, scene, cam, THREE, onFrame(fn), dispose() }
async function stage3d(el, { height = 230, bg = null } = {}) {
  const { THREE } = await load3d();
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: !bg }); r.setPixelRatio(Math.min(2, devicePixelRatio || 1)); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
  el.style.height = height + 'px'; el.append(r.domElement);
  const scene = new THREE.Scene(); if (bg) scene.background = new THREE.Color(bg);
  const cam = new THREE.PerspectiveCamera(40, 2, 0.1, 200);
  scene.add(new THREE.HemisphereLight('#e0e7ff', '#1e1b4b', 1.3));
  const key = new THREE.DirectionalLight('#fff4e0', 2.4); key.position.set(4, 8, 6); key.castShadow = true; key.shadow.mapSize.set(rtxOn() ? 2048 : 1024, rtxOn() ? 2048 : 1024); Object.assign(key.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 0.5, far: 40 }); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = rtxOn() ? 5 : 2; scene.add(key); scene.add(key.target);
  const rim = new THREE.PointLight(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8b5cf6', 30, 30); rim.position.set(-4, 3, -3); scene.add(rim);
  // environment for metal reflections
  const pm = new THREE.PMREMGenerator(r); const env = new THREE.Scene(); env.add(new THREE.Mesh(new THREE.SphereGeometry(20, 16, 8), new THREE.MeshBasicMaterial({ color: '#1b1340', side: THREE.BackSide }))); for (const [x, c] of [[-8, '#f472b6'], [8, '#22d3ee'], [0, '#fde68a']]) { const m = new THREE.Mesh(new THREE.BoxGeometry(5, 2, 5), new THREE.MeshBasicMaterial({ color: c })); m.position.set(x, 8, x ? 0 : -8); env.add(m); } scene.environment = pm.fromScene(env, 0.04).texture; pm.dispose();
  const frames = new Set(); let raf = 0; let alive = true; const t0 = performance.now(); let last = t0;
  let post = null; let nf = 0;
  const resize = () => { const w = el.clientWidth || 600; r.setSize(w, height, false); if (post) post.setSize(w, height); cam.aspect = w / height; cam.updateProjectionMatrix(); };
  const ro = new ResizeObserver(resize); ro.observe(el); resize();
  // RTX: post-processing (AO + bloom + SMAA) on opaque stages; every mesh casts and receives soft shadows; the key light follows the camera
  if (bg && rtxOn()) rtxPipeline(THREE, r, scene, cam, { bloom: 0.45, threshold: 0.88, aoRadius: 0.5 }).then((p) => { if (!alive) { if (p) p.dispose(); return; } post = p; resize(); });
  const loop = () => {
    if (!alive) return; raf = requestAnimationFrame(loop); const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now; for (const f of frames) f((now - t0) / 1000, dt);
    if (nf++ % 30 === 0) scene.traverse((o) => { if (o.isMesh && !o.material.transparent) { o.castShadow = true; o.receiveShadow = true; } });
    key.position.set(cam.position.x + 4, 8, 6); key.target.position.set(cam.position.x, 0, 0);
    if (post) post.render(); else r.render(scene, cam);
  };
  loop();
  return { el, scene, cam, THREE, renderer: r, onFrame: (f) => { frames.add(f); return () => frames.delete(f); },
    dispose: () => { if (post) { post.dispose(); post = null; } alive = false; cancelAnimationFrame(raf); ro.disconnect(); scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); } }); r.dispose(); try { r.forceContextLoss(); } catch {} r.domElement.remove(); } };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function tween(st, ms, fn) { return new Promise((res) => { const t0 = performance.now(); const off = st.onFrame(() => { const k = clamp((performance.now() - t0) / ms, 0, 1); fn(k); if (k >= 1) { off(); res(); } }); }); }

// coins / confetti burst for wins
function burst(st, at, n = 40, colors = ['#facc15', '#fde68a', '#f59e0b']) {
  const { THREE, scene } = st; const g = new THREE.Group(); scene.add(g); const parts = [];
  for (let i = 0; i < n; i++) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.02, 14), new THREE.MeshStandardMaterial({ color: colors[i % colors.length], metalness: 0.9, roughness: 0.2 })); m.position.copy(at); g.add(m); parts.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 4, 3 + Math.random() * 4, (Math.random() - 0.5) * 3), s: new THREE.Vector3(Math.random() * 10, Math.random() * 10, 0) }); }
  const t0 = performance.now(); const off = st.onFrame((tt, dt) => { const el = (performance.now() - t0) / 1000; for (const p of parts) { p.v.y -= 9 * dt; p.m.position.addScaledVector(p.v, dt); p.m.rotation.x += p.s.x * dt; p.m.rotation.y += p.s.y * dt; } if (el > 2) { off(); scene.remove(g); g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); } });
}

// ================= per-game scenes =================
export async function makeFx(game, host) {
  if (!fx3dOn()) return null;
  const el = h('div.fx3d'); host.append(el);
  let st; try { st = await stage3d(el); } catch { el.remove(); return null; }
  const { THREE, scene, cam } = st;
  const felt = new THREE.Mesh(new THREE.CircleGeometry(9, 48), new THREE.MeshStandardMaterial({ color: '#0f3d2e', roughness: 0.9 })); felt.rotation.x = -Math.PI / 2; felt.receiveShadow = true; scene.add(felt);
  cam.position.set(0, 3.2, 6.2); cam.lookAt(0, 0.6, 0);
  const gold = new THREE.MeshStandardMaterial({ color: '#f5c542', metalness: 1, roughness: 0.22 });
  let play = async () => {}; let idle = null;
  if (game === 'coinflip') {
    const faceT = (txt) => tex(THREE, 256, 256, (g) => { g.fillStyle = '#e8b923'; g.beginPath(); g.arc(128, 128, 126, 0, 7); g.fill(); g.strokeStyle = '#a77a0f'; g.lineWidth = 10; g.beginPath(); g.arc(128, 128, 110, 0, 7); g.stroke(); g.fillStyle = '#7a5507'; g.font = '700 130px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 128, 140); });
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.12, 64), [gold, new THREE.MeshStandardMaterial({ map: faceT('★'), metalness: 0.85, roughness: 0.3 }), new THREE.MeshStandardMaterial({ map: faceT('☾'), metalness: 0.85, roughness: 0.3 })]);
    coin.castShadow = true; coin.position.y = 1; scene.add(coin);
    idle = st.onFrame((tt) => { if (!coin.userData.busy) { coin.rotation.y = tt * 0.8; coin.position.y = 1 + Math.sin(tt * 2) * 0.05; } });
    play = async (r) => { coin.userData.busy = true; snd('spin'); const heads = r.result.side === 'heads'; const turns = 8 * Math.PI * 2 + (heads ? 0 : Math.PI); coin.rotation.set(0, 0, 0);
      await tween(st, 1500, (k) => { coin.position.y = 1 + Math.sin(k * Math.PI) * 2.4; coin.rotation.x = ease(k) * turns; });
      coin.rotation.x = heads ? 0 : Math.PI; if (r.payout > 0) burst(st, new THREE.Vector3(0, 1, 0)); await wait(500); coin.userData.busy = false; };
  } else if (game === 'dice') {
    const faceTex = (n) => tex(THREE, 128, 128, (g) => { g.fillStyle = '#fafafa'; g.fillRect(0, 0, 128, 128); g.fillStyle = '#7c3aed'; g.font = '800 70px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(n, 64, 70); });
    const mkDie = (x) => { const mats = Array.from({ length: 6 }, (_, i) => new THREE.MeshStandardMaterial({ map: faceTex(i), roughness: 0.35 })); const d = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mats); d.position.set(x, 0.5, 0); d.castShadow = true; scene.add(d); return d; };
    const d1 = mkDie(-0.8); const d2 = mkDie(0.8);
    const setTop = (d, digit) => { d.material[2].map.dispose(); d.material[2].map = faceTex(digit); d.material[2].needsUpdate = true; d.rotation.set(0, (Math.random() - 0.5) * 0.6, 0); };
    play = async (r) => { snd('spin'); const s = String(Math.floor(r.result.roll)).padStart(2, '0'); const sp = [[Math.random() * 12 + 10, Math.random() * 12 + 10], [Math.random() * 12 + 10, Math.random() * 12 + 10]];
      await tween(st, 1100, (k) => { [d1, d2].forEach((d, i) => { d.position.y = 0.5 + Math.abs(Math.sin(k * Math.PI * 3)) * (1 - k) * 2; d.rotation.x = sp[i][0] * (1 - k); d.rotation.z = sp[i][1] * (1 - k); }); });
      setTop(d1, s[0]); setTop(d2, s[1]); [d1, d2].forEach((d) => { d.position.y = 0.5; d.rotation.x = 0; d.rotation.z = 0; }); if (r.payout > 0) burst(st, new THREE.Vector3(0, 1, 0)); };
  } else if (game === 'slots') {
    const SYM = (cfgSyms) => cfgSyms;
    const syms = ['🍒', '🍋', '🔔', '🍇', '⭐', '💎', '7️⃣'];
    const stripTex = tex(THREE, 128, 128 * syms.length, (g, w) => { syms.forEach((s, i) => { g.fillStyle = i % 2 ? '#fff7ed' : '#ffffff'; g.fillRect(0, i * 128, w, 128); g.font = '90px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, 64, i * 128 + 70); }); });
    stripTex.wrapT = THREE.RepeatWrapping; void SYM;
    const reels = [-1.2, 0, 1.2].map((x) => { const tx = stripTex.clone(); tx.needsUpdate = true; tx.repeat.set(1, 1); const m = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1, 40, 1, true), new THREE.MeshStandardMaterial({ map: tx, roughness: 0.5 })); m.rotation.z = Math.PI / 2; m.position.set(x, 1.1, 0); scene.add(m); return m; });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.2, 0.4), new THREE.MeshStandardMaterial({ color: '#4c1d95', metalness: 0.6, roughness: 0.3 })); frame.position.set(0, 1.1, -0.85); scene.add(frame);
    const angFor = (sym) => { const i = Math.max(0, syms.indexOf(sym)); return -((i + 0.5) / syms.length) * Math.PI * 2 + Math.PI / 2; };
    reels.forEach((m) => { m.rotation.x = 0; });
    play = async (r) => { snd('spin'); const target = r.result.reels.map(angFor); const start = reels.map((m) => m.rotation.y);
      await tween(st, 1700, (k) => { reels.forEach((m, i) => { const kk = clamp(k * (1.25 - i * 0.12), 0, 1); m.rotation.y = start[i] + (target[i] - start[i] - Math.PI * 2 * (6 + i * 2)) * ease(kk); }); });
      reels.forEach((m, i) => { m.rotation.y = target[i]; }); if (r.payout > 0) burst(st, new THREE.Vector3(0, 1.6, 0.5), 60); };
  } else if (game === 'roulette') {
    const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
    const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
    const wt = tex(THREE, 1024, 1024, (g) => { const c = 512; ORDER.forEach((n, i) => { const a0 = (i / 37) * Math.PI * 2 - Math.PI / 2; const a1 = ((i + 1) / 37) * Math.PI * 2 - Math.PI / 2; g.fillStyle = n === 0 ? '#16a34a' : REDS.has(n) ? '#b91c1c' : '#111827'; g.beginPath(); g.moveTo(c, c); g.arc(c, c, 500, a0, a1); g.fill(); g.save(); g.translate(c, c); g.rotate((a0 + a1) / 2 + Math.PI / 2); g.fillStyle = '#fff'; g.font = '700 40px system-ui'; g.textAlign = 'center'; g.fillText(String(n), 0, -440); g.restore(); }); g.fillStyle = '#3f2a14'; g.beginPath(); g.arc(c, c, 330, 0, 7); g.fill(); g.fillStyle = '#d4a017'; g.beginPath(); g.arc(c, c, 120, 0, 7); g.fill(); });
    const wheel = new THREE.Group(); scene.add(wheel);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.3, 0.2, 74), [new THREE.MeshStandardMaterial({ color: '#3f2a14' }), new THREE.MeshStandardMaterial({ map: wt, roughness: 0.4, metalness: 0.2 }), new THREE.MeshStandardMaterial({ color: '#3f2a14' })]); disc.position.y = 0.3; disc.receiveShadow = true; wheel.add(disc);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 24), gold); cone.position.y = 0.7; wheel.add(cone);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.12, 12, 80), new THREE.MeshStandardMaterial({ color: '#5b3a1a', roughness: 0.3, metalness: 0.4 })); rim.rotation.x = Math.PI / 2; rim.position.y = 0.42; scene.add(rim);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.09, 20, 14), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.1, metalness: 0.2 })); ball.castShadow = true; scene.add(ball);
    cam.position.set(0, 4.6, 4.2); cam.lookAt(0, 0.2, 0);
    let wheelSpin = 0.25; idle = st.onFrame((tt, dt) => { wheel.rotation.y += wheelSpin * dt; if (!ball.userData.busy) { const a = wheel.rotation.y + ball.userData.a; ball.position.set(Math.cos(a) * 1.85, 0.48, -Math.sin(a) * 1.85); } });
    ball.userData.a = 0;
    play = async (r) => { snd('spin'); ball.userData.busy = true; wheelSpin = 1.6; const idx = ORDER.indexOf(r.result.n); const slotA = -((idx + 0.5) / 37) * Math.PI * 2 + Math.PI / 2; let ba = 0; const t0 = performance.now();
      await tween(st, 2600, (k) => { const rr = 2.15 - ease(k) * 0.3; ba -= (8 * (1 - k) + 0.6) * 0.016; if (k > 0.85) { const target = wheel.rotation.y + slotA; ba += ((target - ba + Math.PI * 40) % (Math.PI * 2) - Math.PI) * 0.15; } ball.position.set(Math.cos(ba) * rr, 0.5 + Math.abs(Math.sin(k * 30)) * 0.05 * (1 - k), -Math.sin(ba) * rr); });
      void t0; ball.userData.a = slotA; ball.userData.busy = false; wheelSpin = 0.25; if (r.payout > 0) burst(st, new THREE.Vector3(0, 0.8, 0), 50); };
  } else if (game === 'crash') {
    const rocket = new THREE.Group(); scene.add(rocket);
    const bodyM = new THREE.MeshStandardMaterial({ color: '#e5e7eb', metalness: 0.6, roughness: 0.25 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 1.3, 24), bodyM); rocket.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.5, 24), new THREE.MeshStandardMaterial({ color: '#ef4444', metalness: 0.4, roughness: 0.3 })); nose.position.y = 0.9; rocket.add(nose);
    for (let i = 0; i < 3; i++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.35), new THREE.MeshStandardMaterial({ color: '#7c3aed' })); const a = (i / 3) * Math.PI * 2; fin.position.set(Math.cos(a) * 0.3, -0.5, Math.sin(a) * 0.3); fin.rotation.y = -a; rocket.add(fin); }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.7, 16), new THREE.MeshBasicMaterial({ color: '#fb923c', transparent: true, opacity: 0.9 })); flame.rotation.x = Math.PI; flame.position.y = -1; rocket.add(flame);
    const stars = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(Float32Array.from({ length: 900 }, () => (Math.random() - 0.5) * 30), 3)), new THREE.PointsMaterial({ color: '#fff', size: 0.05 })); scene.add(stars); felt.visible = false;
    rocket.position.set(0, 0.2, 0); rocket.rotation.z = -0.15; cam.position.set(0, 1.4, 6); cam.lookAt(0, 1.2, 0);
    let speed = 0.2; idle = st.onFrame((tt, dt) => { flame.scale.y = 0.7 + Math.random() * 0.6; stars.position.y = (stars.position.y - dt * speed * 6) % 10; rocket.position.x = Math.sin(tt * 1.3) * 0.1; });
    play = async (r) => { snd('spin'); speed = 3; const crashed = !(r.payout > 0); await tween(st, 1400, (k) => { rocket.position.y = 0.2 + ease(k) * 1.6; speed = 2 + k * 8; });
      if (crashed) { burst(st, rocket.position.clone(), 60, ['#ef4444', '#f97316', '#fde68a']); rocket.visible = false; await wait(900); rocket.visible = true; } else burst(st, rocket.position.clone(), 50);
      rocket.position.y = 0.2; speed = 0.2; };
  } else {
    // generic: a stack of chips that bounces; wins rain coins (plinko, mines, blackjack, jackpot)
    const colors = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7'];
    const chips = []; for (let i = 0; i < 5; i++) { for (let j = 0; j < 4 + i; j++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.08, 32), new THREE.MeshStandardMaterial({ color: colors[i], roughness: 0.4, metalness: 0.3 })); c.position.set((i - 2) * 0.85, 0.05 + j * 0.085, 0); c.castShadow = true; scene.add(c); chips.push(c); } }
    idle = st.onFrame((tt) => { chips.forEach((c, i) => { c.rotation.y = tt * 0.6 + i; }); });
    play = async (r) => { if (r.payout > 0) { burst(st, new THREE.Vector3(0, 1.5, 0), r.mult >= 5 ? 90 : 45); snd('win'); } else { await tween(st, 400, (k) => { chips.forEach((c) => { c.position.x += (Math.random() - 0.5) * 0.02 * (1 - k); }); }); } };
  }
  void idle;
  return { el, play: (r) => play(r).catch(() => {}), dispose: () => { st.dispose(); el.remove(); } };
}

// ================= HORSE RACING (full game) =================
export function horses(env) {
  const list = env.cfg.horses || []; let pick = Number(ls('casino.horse') || 0); let busy = false; let st = null; let runners = []; let alive = true;
  const view = h('div.hr-view'); const res = h('div.cs-result', h('span.muted', t('Pick a horse and start the race.')));
  mount(env.stage, view, res);
  (async () => {
    try { st = await stage3d(view, { height: 300, bg: '#7cc4f2' }); } catch { mount(view, h('div.empty', h('p', t('3D is not available — results still work.')))); return; }
    if (!alive) return st.dispose();
    const { THREE, scene, cam } = st; scene.fog = new THREE.Fog('#a6d8f5', 25, 70);
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(120, 60), new THREE.MeshStandardMaterial({ color: '#3f9b4a', roughness: 1 })); grass.rotation.x = -Math.PI / 2; grass.receiveShadow = true; scene.add(grass);
    const track = new THREE.Mesh(new THREE.PlaneGeometry(64, 9), new THREE.MeshStandardMaterial({ color: '#b8875a', roughness: 1 })); track.rotation.x = -Math.PI / 2; track.position.set(0, 0.01, 0); track.receiveShadow = true; scene.add(track);
    for (let i = 0; i <= list.length; i++) { const ln = new THREE.Mesh(new THREE.PlaneGeometry(64, 0.05), new THREE.MeshBasicMaterial({ color: '#f5f5f4' })); ln.rotation.x = -Math.PI / 2; ln.position.set(0, 0.02, -4.2 + i * 1.4); scene.add(ln); }
    const finish = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 9), new THREE.MeshBasicMaterial({ map: tex(THREE, 32, 256, (g) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 2; x++) { g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * 16, y * 16, 16, 16); } }) })); finish.rotation.x = -Math.PI / 2; finish.position.set(29, 0.03, 0); scene.add(finish);
    for (const z of [-4.8, 4.8]) for (let x = -32; x <= 32; x += 2) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.1), new THREE.MeshStandardMaterial({ color: '#fff' })); post.position.set(x, 0.45, z); scene.add(post); }
    for (const z of [-4.8, 4.8]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(64, 0.12, 0.12), new THREE.MeshStandardMaterial({ color: '#fff' })); rail.position.set(0, 0.9, z); scene.add(rail); }
    const stand = new THREE.Mesh(new THREE.BoxGeometry(40, 4, 6), new THREE.MeshStandardMaterial({ color: '#94a3b8' })); stand.position.set(0, 2, -12); scene.add(stand);
    const crowd = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(Float32Array.from({ length: 3000 }, (_, i) => (i % 3 === 0 ? (Math.random() - 0.5) * 38 : i % 3 === 1 ? 4.2 + Math.random() * 0.6 : -10 - Math.random() * 3)), 3)), new THREE.PointsMaterial({ size: 0.35, vertexColors: false, color: '#f472b6' })); scene.add(crowd);
    // horses: body + neck + head + 4 legs + jockey
    runners = list.map((hz, i) => {
      const g = new THREE.Group(); const coat = new THREE.MeshStandardMaterial({ color: ['#6b4423', '#3b2a1a', '#8b5a2b', '#1f1a17', '#a0522d', '#e7e5e4'][i], roughness: 0.6 });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.1, 6, 12), coat); body.rotation.z = Math.PI / 2; body.position.y = 1.15; body.castShadow = true; g.add(body);
      const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.6, 4, 8), coat); neck.position.set(0.75, 1.5, 0); neck.rotation.z = -0.8; g.add(neck);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.24), coat); head.position.set(1.05, 1.78, 0); head.rotation.z = -0.4; g.add(head);
      const legs = []; for (const [x, z] of [[0.5, 0.15], [0.5, -0.15], [-0.5, 0.15], [-0.5, -0.15]]) { const p = new THREE.Group(); p.position.set(x, 0.95, z); const l = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.95, 8), coat); l.position.y = -0.47; l.castShadow = true; p.add(l); g.add(p); legs.push(p); }
      const silk = new THREE.MeshStandardMaterial({ color: hz.color, roughness: 0.4 });
      const jockey = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.35, 4, 8), silk); jockey.position.set(0.15, 1.75, 0); jockey.rotation.z = -0.5; g.add(jockey);
      const helm = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), silk); helm.position.set(0.35, 2.05, 0); g.add(helm);
      const num = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial({ map: tex(THREE, 64, 64, (c) => { c.fillStyle = '#fff'; c.fillRect(0, 0, 64, 64); c.fillStyle = '#111'; c.font = '800 46px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(i + 1), 32, 36); }) })); num.position.set(0, 1.15, 0.33); g.add(num);
      g.position.set(-30, 0, -3.5 + i * 1.4); scene.add(g);
      return { g, legs, x: 0, hz };
    });
    cam.position.set(-24, 5.5, 12); cam.lookAt(-24, 0.8, 0);
    st.onFrame((tt) => { for (const rn of runners) { const sp = rn.speed || 0; rn.legs.forEach((p, k) => { p.rotation.z = Math.sin(tt * (sp > 0 ? 18 : 3) + k * 1.6 + rn.hz.id) * (sp > 0 ? 0.7 : 0.08); }); rn.g.position.y = sp > 0 ? Math.abs(Math.sin(tt * 18 + rn.hz.id)) * 0.12 : 0; } });
  })();
  const paintCtl = () => {
    mount(env.betBox, h('div.hr-picks', list.map((hz) => h('button.hr-pick' + (hz.id === pick ? '.on' : ''), { type: 'button', disabled: busy, style: '--hc:' + hz.color, onClick: () => { pick = hz.id; ls('casino.horse', pick); paintCtl(); } }, h('span.hr-num', hz.id + 1), h('b', hz.name), h('span.tiny.muted', t('{p}% chance', { p: Math.round(hz.p * 100) })), h('span.hr-mult', '×' + hz.mult.toFixed(2))))),
      field(t('Bet'), h('input.input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '100, 10k, 1m', 'aria-label': t('Bet'), value: env.bet(), disabled: busy, onInput: (e) => env.setBet(clamp(parseCoins(e.target.value) || 1, 1, env.cfg.max)) })),
      env.pausedBox(), h('button.btn.primary.cs-go', { type: 'button', disabled: busy || env.paused(), onClick: go }, icon('play', 17), t('Start the race'), ' · ', h('span.coin', fmt.coins(env.bet()))));
  };
  async function go() {
    if (busy) return; busy = true; env.hold(true); paintCtl(); mount(res, h('span.muted', t('And they are off!')));
    let r; try { r = await api.post('/api/casino/play/horses', { bet: env.bet(), horse: pick }); } catch (e) { busy = false; env.hold(false); paintCtl(); return env.err(e); }
    snd('spin');
    if (st && runners.length) {
      const dur = 6500; const t0 = performance.now(); const { pace } = r.result;
      for (const rn of runners) rn.speed = 1;
      await new Promise((done) => { const off = st.onFrame(() => { const k = clamp((performance.now() - t0) / dur, 0, 1); let lead = -30;
        for (const rn of runners) { const pts = [0, ...pace[rn.hz.id]]; const f = k * 10; const i = Math.min(9, Math.floor(f)); const frac = pts[i] + (pts[i + 1] - pts[i]) * (f - i); rn.g.position.x = -30 + frac * 59; lead = Math.max(lead, rn.g.position.x); }
        st.cam.position.x += (lead - 6 - st.cam.position.x) * 0.08; st.cam.lookAt(st.cam.position.x, 0.8, 0);
        if (k >= 1) { off(); done(); } }); });
      for (const rn of runners) rn.speed = 0;
    } else await new Promise((d) => setTimeout(d, 1500));
    const w = list[r.result.winner];
    if (st && r.payout > 0) { burst(st, new st.THREE.Vector3(st.cam.position.x + 6, 2, 0), 90); snd('win'); }
    res.className = 'cs-result ' + (r.payout > 0 ? 'win' : 'lose');
    mount(res, h('div', t('Winner: #{n} {h}', { n: w.id + 1, h: w.name }) + ' · ' + t('Order') + ': ' + r.result.order.map((x) => x + 1).join(' – ')), h('b', r.payout > 0 ? t('Your horse won! +{n} coins', { n: fmt.coins(r.payout) }) : t('You lost {n} coins.', { n: fmt.coins(r.bet) })));
    busy = false; env.hold(false); env.done(Object.assign(r, { desc: t('Horse racing') + ' · #' + (w.id + 1) + ' ' + w.name }));
    setTimeout(() => { if (st && !busy) { for (const rn of runners) rn.g.position.x = -30; st.cam.position.set(-24, 5.5, 12); st.cam.lookAt(-24, 0.8, 0); } }, 3500);
    paintCtl();
  }
  paintCtl();
  return () => { alive = false; if (st) st.dispose(); };
}

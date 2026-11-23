// Nebulix 3D avatars: a small blocky character built from the parts in /data/avatar.json. Used in the 3D casino,
// on profiles (like a console "mini me") and in the Plaza. Rendering uses WebGL through three.js (vendored).
import { h } from './util.js';

let THREE = null; let AV = null; let loading = null;
export async function load3d() {
  if (THREE && AV) return { THREE, AV };
  if (!loading) loading = Promise.all([import('./vendor/three.module.min.js'), fetch('/data/avatar.json').then((r) => r.json())]).then(([m, a]) => { THREE = m; AV = a; return { THREE, AV }; });
  return loading;
}
export const avatarDefaults = () => (AV ? Object.assign({}, AV.default) : null);

const mat = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.55, metalness: 0.05 }, o));
function box(w, h_, d, m, x = 0, y = 0, z = 0) { const g = new THREE.Mesh(new THREE.BoxGeometry(w, h_, d), m); g.position.set(x, y, z); g.castShadow = true; g.receiveShadow = true; return g; }

// Builds the character. Origin at the feet, ~2.1 units tall, facing +z.
export function buildAvatar(av) {
  const a = Object.assign({}, AV.default, av || {});
  const skin = mat(AV.skin[a.skin] || AV.skin[1]); const hairM = mat(AV.hairColor[a.hairColor] || AV.hairColor[1], { roughness: 0.8 });
  const topC = AV.color[a.topColor] || AV.color[0]; const pantsM = mat(AV.color[a.pants] || '#1f2937', { roughness: 0.7 });
  const g = new THREE.Group(); g.name = 'avatar';
  const body = new THREE.Group(); g.add(body);
  // legs
  const legL = box(0.24, 0.62, 0.26, pantsM, -0.15, 0.31, 0); const legR = box(0.24, 0.62, 0.26, pantsM, 0.15, 0.31, 0);
  const shoe = mat('#111318', { roughness: 0.4 }); legL.add(box(0.26, 0.1, 0.32, shoe, 0, -0.28, 0.03)); legR.add(box(0.26, 0.1, 0.32, shoe, 0, -0.28, 0.03));
  body.add(legL, legR);
  // torso by top type
  const torsoM = a.top === 'armor' ? mat('#cbd5e1', { metalness: 0.85, roughness: 0.25, color: new THREE.Color(topC).lerp(new THREE.Color('#e2e8f0'), 0.6) }) : mat(topC, { roughness: a.top === 'suit' ? 0.35 : 0.7 });
  const torso = box(0.62, 0.66, 0.36, torsoM, 0, 0.95, 0); body.add(torso);
  if (a.top === 'hoodie') { torso.add(box(0.5, 0.14, 0.04, mat(new THREE.Color(topC).multiplyScalar(0.8)), 0, -0.18, 0.19)); torso.add(box(0.5, 0.26, 0.2, torsoM, 0, 0.36, -0.2)); }
  if (a.top === 'suit') { torso.add(box(0.18, 0.62, 0.02, mat('#f8fafc'), 0, 0.02, 0.185)); torso.add(box(0.07, 0.4, 0.02, mat('#b91c1c'), 0, 0.02, 0.2)); }
  if (a.top === 'armor') { const pad = mat('#94a3b8', { metalness: 0.9, roughness: 0.2 }); torso.add(box(0.26, 0.14, 0.42, pad, -0.38, 0.28, 0)); torso.add(box(0.26, 0.14, 0.42, pad, 0.38, 0.28, 0)); torso.add(box(0.2, 0.2, 0.02, mat('#22d3ee', { emissive: '#22d3ee', emissiveIntensity: 1.6 }), 0, 0.06, 0.19)); }
  if (a.top === 'robe') { const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.5, 0.6, 12), torsoM); skirt.position.set(0, 0.42, 0); skirt.castShadow = true; body.add(skirt); torso.add(box(0.64, 0.06, 0.38, mat('#fbbf24', { metalness: 0.7, roughness: 0.3 }), 0, -0.3, 0)); }
  // arms (pivot at shoulder so they can swing)
  const mkArm = (x) => { const p = new THREE.Group(); p.position.set(x, 1.22, 0); const s = box(0.2, 0.58, 0.24, torsoM, 0, -0.29, 0); p.add(s); s.add(box(0.18, 0.14, 0.2, skin, 0, -0.34, 0)); body.add(p); return p; };
  const armL = mkArm(-0.42); const armR = mkArm(0.42);
  // head
  const head = new THREE.Group(); head.position.set(0, 1.62, 0); body.add(head);
  head.add(box(0.62, 0.6, 0.58, skin));
  const eyeM = mat('#0b0c10', { roughness: 0.3 }); const white = mat('#ffffff');
  const eye = (x) => {
    if (a.eyes === 'happy') return box(0.12, 0.035, 0.02, eyeM, x, 0.05, 0.3);
    if (a.eyes === 'wink' && x > 0) return box(0.12, 0.035, 0.02, eyeM, x, 0.05, 0.3);
    if (a.eyes === 'cool') return box(0.14, 0.06, 0.02, eyeM, x, 0.05, 0.3);
    if (a.eyes === 'star') return box(0.11, 0.11, 0.02, mat('#fde047', { emissive: '#facc15', emissiveIntensity: 1.2 }), x, 0.05, 0.3);
    const e = box(0.1, 0.12, 0.02, white, x, 0.05, 0.295); e.add(box(0.06, 0.08, 0.02, eyeM, 0, -0.01, 0.006)); return e;
  };
  head.add(eye(-0.14), eye(0.14));
  head.add(box(0.16, 0.035, 0.02, mat('#7f1d1d'), 0, -0.14, 0.295)); // mouth
  // hair
  const hr = a.hair;
  if (hr === 'short') { head.add(box(0.66, 0.16, 0.62, hairM, 0, 0.3, 0)); head.add(box(0.66, 0.3, 0.12, hairM, 0, 0.12, -0.27)); }
  if (hr === 'spiky') { head.add(box(0.66, 0.12, 0.62, hairM, 0, 0.3, 0)); for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.26, 4), hairM); s.position.set(-0.24 + i * 0.12, 0.46, (i % 2) * 0.1 - 0.05); s.castShadow = true; head.add(s); } }
  if (hr === 'long') { head.add(box(0.68, 0.16, 0.64, hairM, 0, 0.3, 0)); head.add(box(0.68, 0.8, 0.16, hairM, 0, -0.12, -0.28)); head.add(box(0.1, 0.6, 0.5, hairM, -0.34, -0.02, -0.04)); head.add(box(0.1, 0.6, 0.5, hairM, 0.34, -0.02, -0.04)); }
  if (hr === 'bun') { head.add(box(0.66, 0.14, 0.62, hairM, 0, 0.3, 0)); const b = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), hairM); b.position.set(0, 0.48, -0.16); b.castShadow = true; head.add(b); }
  if (hr === 'afro') { const b = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), hairM); b.position.set(0, 0.22, -0.06); b.scale.set(1, 0.85, 1); b.castShadow = true; head.add(b); }
  if (hr === 'mohawk') head.add(box(0.12, 0.3, 0.6, hairM, 0, 0.42, 0));
  if (hr === 'twintails') { head.add(box(0.66, 0.15, 0.62, hairM, 0, 0.3, 0)); for (const x of [-0.42, 0.42]) { const tl = box(0.16, 0.6, 0.16, hairM, x, -0.1, -0.1); tl.rotation.z = x > 0 ? -0.25 : 0.25; head.add(tl); } }
  // hats
  const ht = a.hat;
  if (ht === 'cap') { const c = mat(topC); head.add(box(0.68, 0.18, 0.64, c, 0, 0.38, 0)); head.add(box(0.6, 0.04, 0.3, c, 0, 0.3, 0.42)); }
  if (ht === 'beanie') { head.add(box(0.7, 0.26, 0.66, mat('#e11d48', { roughness: 0.95 }), 0, 0.4, 0)); }
  if (ht === 'tophat') { const m = mat('#111827', { roughness: 0.3 }); head.add(box(0.9, 0.04, 0.84, m, 0, 0.33, 0)); head.add(box(0.5, 0.5, 0.5, m, 0, 0.6, 0)); head.add(box(0.52, 0.08, 0.52, mat('#b91c1c'), 0, 0.4, 0)); }
  if (ht === 'crown') { const gold = mat('#facc15', { metalness: 1, roughness: 0.18, emissive: '#7c5a00', emissiveIntensity: 0.25 }); head.add(box(0.62, 0.14, 0.58, gold, 0, 0.38, 0)); for (const [x, z] of [[-0.24, 0.22], [0, 0.22], [0.24, 0.22], [-0.24, -0.22], [0.24, -0.22]]) { const s = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 4), gold); s.position.set(x, 0.53, z); head.add(s); } const gemM = mat('#ef4444', { emissive: '#ef4444', emissiveIntensity: 1 }); head.add(box(0.08, 0.08, 0.02, gemM, 0, 0.38, 0.3)); }
  if (ht === 'halo') { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 8, 28), mat('#fff7c2', { emissive: '#fde68a', emissiveIntensity: 2.4 })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.62; ring.name = 'halo'; head.add(ring); }
  if (ht === 'horns') { const m = mat('#7f1d1d', { roughness: 0.4 }); for (const x of [-0.22, 0.22]) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 8), m); c.position.set(x, 0.42, 0.05); c.rotation.z = x > 0 ? -0.35 : 0.35; head.add(c); } }
  if (ht === 'headset') { const m = mat('#111827', { roughness: 0.3 }); head.add(box(0.72, 0.06, 0.12, m, 0, 0.34, 0)); for (const x of [-0.35, 0.35]) head.add(box(0.08, 0.24, 0.24, mat('#7c5cff', { emissive: '#7c5cff', emissiveIntensity: 0.8 }), x, 0.02, 0)); head.add(box(0.04, 0.04, 0.26, m, -0.34, -0.12, 0.16)); }
  // accessories
  const ac = a.acc;
  if (ac === 'glasses' || ac === 'shades') { const m = ac === 'shades' ? mat('#0b0c10', { metalness: 0.6, roughness: 0.1 }) : mat('#1f2937'); for (const x of [-0.14, 0.14]) head.add(box(0.18, 0.12, 0.02, ac === 'shades' ? m : mat('#bfdbfe', { transparent: true, opacity: 0.35 }), x, 0.05, 0.32)); head.add(box(0.5, 0.025, 0.02, m, 0, 0.1, 0.32)); }
  if (ac === 'visor') head.add(box(0.6, 0.1, 0.03, mat('#22d3ee', { emissive: '#22d3ee', emissiveIntensity: 2.2, transparent: true, opacity: 0.85 }), 0, 0.06, 0.31));
  if (ac === 'wings') { const wm = mat('#ffffff', { emissive: '#c7d2fe', emissiveIntensity: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.92 }); for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.03), wm); w.position.set(s * 0.45, 1.15, -0.25); w.rotation.y = s * 0.5; w.rotation.z = s * 0.25; w.name = 'wing'; w.userData.s = s; body.add(w); } }
  if (ac === 'cape') { const cm = mat('#b91c1c', { side: THREE.DoubleSide, roughness: 0.6 }); const c = new THREE.Mesh(new THREE.BoxGeometry(0.64, 1.0, 0.03), cm); c.position.set(0, 0.82, -0.22); c.rotation.x = 0.12; c.castShadow = true; c.name = 'cape'; body.add(c); }
  // aura
  if (a.aura && a.aura !== 'none') {
    const col = a.aura === 'fire' ? '#f97316' : a.aura === 'rainbow' ? '#e879f9' : '#fde68a';
    const n = 40; const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const r = 0.6 + Math.random() * 0.4; const t = Math.random() * Math.PI * 2; pos[i * 3] = Math.cos(t) * r; pos[i * 3 + 1] = Math.random() * 2.2; pos[i * 3 + 2] = Math.sin(t) * r; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: col, size: 0.08, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    pts.name = 'aura'; pts.userData.rainbow = a.aura === 'rainbow'; g.add(pts);
  }
  g.userData = { armL, armR, legL, legR, head, body };
  return g;
}

// Animate: idle bob, walk cycle (speed 0-1), aura drift. Call every frame.
export function animateAvatar(g, t, walk = 0) {
  const u = g.userData; if (!u || !u.armL) return;
  const s = Math.sin(t * 8) * 0.7 * walk;
  u.armL.rotation.x = s; u.armR.rotation.x = -s; u.legL.rotation.x = -s * 0.8; u.legR.rotation.x = s * 0.8;
  u.body.position.y = Math.abs(Math.sin(t * 8)) * 0.05 * walk + Math.sin(t * 2) * 0.012;
  u.head.rotation.z = Math.sin(t * 1.3) * 0.03;
  g.traverse((o) => {
    if (o.name === 'aura') { o.rotation.y = t * 0.6; if (o.userData.rainbow) o.material.color.setHSL((t * 0.2) % 1, 0.9, 0.65); }
    else if (o.name === 'wing') o.rotation.y = o.userData.s * (0.5 + Math.sin(t * 3) * 0.15);
    else if (o.name === 'halo') o.position.y = 0.62 + Math.sin(t * 2) * 0.03;
    else if (o.name === 'cape') o.rotation.x = 0.12 + walk * 0.35 + Math.sin(t * 3) * 0.04;
  });
}

// Shared lighting for small stages.
function stageScene(rtx) {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#c7d2fe', '#1e1b4b', 1.1));
  const key = new THREE.DirectionalLight('#ffffff', 2.2); key.position.set(2, 4, 3); key.castShadow = !!rtx; key.shadow && key.shadow.mapSize.set(1024, 1024); scene.add(key);
  const rim = new THREE.DirectionalLight('#7c5cff', 1.4); rim.position.set(-3, 2, -3); scene.add(rim);
  return scene;
}

// Static portrait (one shared WebGL renderer; images are cached), for lists with many avatars.
let shared = null; const cache = new Map();
async function portrait(av, size) {
  await load3d();
  const key = JSON.stringify(av) + size; if (cache.has(key)) return cache.get(key);
  if (!shared) { shared = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); shared.toneMapping = THREE.ACESFilmicToneMapping; shared.outputColorSpace = THREE.SRGBColorSpace; }
  shared.setSize(size, size, false); shared.setPixelRatio(1);
  const scene = stageScene(false); const a = buildAvatar(av); a.rotation.y = -0.45; scene.add(a); animateAvatar(a, 0.6, 0);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50); cam.position.set(0, 1.35, 5.2); cam.lookAt(0, 1.05, 0);
  shared.render(scene, cam); const url = shared.domElement.toDataURL('image/png');
  scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose && o.material.dispose(); });
  if (cache.size > 200) cache.clear(); cache.set(key, url); return url;
}
export function avatarCanvas(av, { size = 96 } = {}) {
  const img = h('img.av3-img', { width: size, height: size, alt: '', style: `width:${size}px;height:${size}px` });
  portrait(av, size * 2).then((u) => { img.src = u; }).catch(() => {});
  return img;
}

// Live, rotating stage (its own renderer) — profile header and the avatar editor. Drag to turn it.
export function avatarStage(av, { size = 260, rtx = true, onReady } = {}) {
  const wrap = h('div.av3-stage', { style: `width:${size}px;height:${size}px` });
  let alive = true; let renderer, scene, cam, avatar, raf; let rotY = -0.3; let drag = null; let auto = true;
  load3d().then(() => {
    if (!alive) return;
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); renderer.setSize(size, size);
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = rtx; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene = stageScene(rtx);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.4, 40), new THREE.MeshStandardMaterial({ color: '#1e1b4b', roughness: 0.35, metalness: 0.4, transparent: true, opacity: 0.85 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.38, 1.45, 48), new THREE.MeshBasicMaterial({ color: '#7c5cff', transparent: true, opacity: 0.8 })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.005; scene.add(ring);
    cam = new THREE.PerspectiveCamera(32, 1, 0.1, 50); cam.position.set(0, 1.45, 5.4); cam.lookAt(0, 1.05, 0);
    set(av); wrap.appendChild(renderer.domElement);
    const t0 = performance.now();
    const loop = () => { if (!alive) return; raf = requestAnimationFrame(loop); const t = (performance.now() - t0) / 1000; if (auto && !drag) rotY += 0.006; if (avatar) { avatar.rotation.y = rotY; animateAvatar(avatar, t, 0); } renderer.render(scene, cam); };
    loop(); onReady && onReady();
  }).catch(() => { wrap.classList.add('av3-off'); });
  function set(next) { if (!scene) { av = next; return; } if (avatar) { scene.remove(avatar); avatar.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); } avatar = buildAvatar(next); scene.add(avatar); }
  wrap.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, r: rotY }; auto = false; wrap.setPointerCapture(e.pointerId); });
  wrap.addEventListener('pointermove', (e) => { if (drag) rotY = drag.r + (e.clientX - drag.x) * 0.012; });
  wrap.addEventListener('pointerup', () => { drag = null; });
  wrap.update = set;
  wrap.destroy = () => { alive = false; cancelAnimationFrame(raf); try { renderer && renderer.dispose(); renderer && renderer.forceContextLoss(); } catch {} };
  return wrap;
}

// 3D theme backgrounds (WebGL): space, neon tunnel, crystal cave, synth city. Loaded only when a 3D theme is on.
// Colours come from the theme background (c1, c2, c3). Pauses when the tab is hidden; static with reduced motion.
let THREE = null; let state = null; let want = null;
const reduced = () => document.documentElement.dataset.reduce === '1' || (matchMedia('(prefers-reduced-motion: reduce)').matches && document.documentElement.dataset.reduce !== '0');
export const TYPES_3D = ['space3d', 'tunnel3d', 'crystals3d', 'city3d'];

export async function startBg3d(type, colors, speed = 1) {
  want = { type, colors: colors.join(','), speed };
  if (state && state.type === type && state.colors === want.colors) { state.speed = speed; return; }
  stopBg3d(); want = { type, colors: colors.join(','), speed };
  try { THREE = THREE || await import('./vendor/three.module.min.js'); } catch { return; }
  if (!want || want.type !== type) return;
  const cv = document.createElement('canvas'); cv.id = 'bg3d'; cv.setAttribute('aria-hidden', 'true');
  Object.assign(cv.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: '-1', pointerEvents: 'none' });
  document.body.prepend(cv);
  let renderer; try { renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: false, alpha: false, powerPreference: 'low-power' }); } catch { cv.remove(); return; }
  renderer.setPixelRatio(Math.min(1.25, devicePixelRatio || 1)); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
  const [c1, c2, c3] = colors.map((c) => new THREE.Color(c));
  const scene = new THREE.Scene(); scene.background = c1.clone().multiplyScalar(0.6); scene.fog = new THREE.FogExp2(scene.background, type === 'city3d' ? 0.018 : 0.03);
  const cam = new THREE.PerspectiveCamera(70, 1, 0.1, 300); const upd = [];
  scene.add(new THREE.HemisphereLight(c3, c1, 1.2));
  const pl = new THREE.PointLight(c2, 60, 60, 1.5); pl.position.set(0, 4, 4); scene.add(pl);

  if (type === 'space3d') {
    const n = 4000; const p = new Float32Array(n * 3); const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const r = 20 + Math.random() * 140; const th = Math.random() * 6.283; const ph = Math.acos(2 * Math.random() - 1); p.set([r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph)], i * 3); const c = [c2, c3, new THREE.Color('#ffffff')][i % 3]; col.set([c.r, c.g, c.b], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.6, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending })); scene.add(stars);
    const planet = new THREE.Mesh(new THREE.SphereGeometry(6, 48, 32), new THREE.MeshStandardMaterial({ color: c2, roughness: 0.7, emissive: c1, emissiveIntensity: 0.4 })); planet.position.set(14, -4, -30); scene.add(planet);
    const ring = new THREE.Mesh(new THREE.RingGeometry(8, 12, 64), new THREE.MeshBasicMaterial({ color: c3, transparent: true, opacity: 0.35, side: THREE.DoubleSide })); ring.rotation.x = 1.2; planet.add(ring);
    const moon = new THREE.Mesh(new THREE.SphereGeometry(1.4, 24, 16), new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.9 })); scene.add(moon);
    cam.position.set(0, 0, 10);
    upd.push((t) => { stars.rotation.y = t * 0.012; stars.rotation.x = t * 0.004; planet.rotation.y = t * 0.05; moon.position.set(14 + Math.cos(t * 0.2) * 14, -4 + Math.sin(t * 0.2) * 3, -30 + Math.sin(t * 0.2) * 14); cam.position.x = Math.sin(t * 0.05) * 2; cam.lookAt(0, 0, -20); });
  } else if (type === 'tunnel3d') {
    const rings = [];
    for (let i = 0; i < 46; i++) { const m = new THREE.Mesh(new THREE.TorusGeometry(6, 0.06, 6, 6), new THREE.MeshBasicMaterial({ color: i % 2 ? c2 : c3 })); m.position.z = -i * 3; m.rotation.z = i * 0.12; scene.add(m); rings.push(m); }
    cam.position.set(0, 0, 4);
    upd.push((t, dt, sp) => { for (const r of rings) { r.position.z += dt * 10 * sp; r.rotation.z += dt * 0.3; if (r.position.z > 6) r.position.z -= 46 * 3; } cam.rotation.z = Math.sin(t * 0.3) * 0.2; });
  } else if (type === 'crystals3d') {
    const geo = new THREE.OctahedronGeometry(1, 0); const ms = [];
    for (let i = 0; i < 70; i++) { const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: [c2, c3][i % 2], metalness: 0.6, roughness: 0.15, emissive: [c2, c3][i % 2], emissiveIntensity: 0.25, flatShading: true })); m.position.set((Math.random() - 0.5) * 50, (Math.random() - 0.5) * 30, -Math.random() * 60 - 5); m.scale.set(0.6 + Math.random() * 1.6, 1 + Math.random() * 3, 0.6 + Math.random() * 1.6); m.userData.s = 0.2 + Math.random() * 0.6; scene.add(m); ms.push(m); }
    cam.position.set(0, 0, 10);
    upd.push((t) => { for (const m of ms) { m.rotation.y = t * m.userData.s; m.position.y += Math.sin(t + m.position.x) * 0.002; } pl.position.set(Math.sin(t * 0.4) * 15, Math.cos(t * 0.3) * 8, -10); cam.position.x = Math.sin(t * 0.07) * 4; cam.lookAt(0, 0, -25); });
  } else if (type === 'city3d') {
    const grid = new THREE.GridHelper(400, 160, c3, c2); grid.material.transparent = true; grid.material.opacity = 0.5; scene.add(grid);
    const bm = new THREE.MeshStandardMaterial({ color: c1.clone().multiplyScalar(0.5), roughness: 0.4, metalness: 0.5, emissive: c2, emissiveIntensity: 0.06 });
    const b = new THREE.BoxGeometry(1, 1, 1); const blds = [];
    for (let i = 0; i < 220; i++) { const m = new THREE.Mesh(b, bm); const hgt = 2 + Math.random() * Math.random() * 30; let x = (Math.random() - 0.5) * 160; if (Math.abs(x) < 6) x += Math.sign(x || 1) * 8; m.scale.set(2 + Math.random() * 4, hgt, 2 + Math.random() * 4); m.position.set(x, hgt / 2, -Math.random() * 200); scene.add(m); blds.push(m);
      if (Math.random() < 0.5) { const top = new THREE.Mesh(new THREE.BoxGeometry(1.03, 1, 1.03), new THREE.MeshBasicMaterial({ color: Math.random() < 0.5 ? c2 : c3 })); top.position.y = 0.5; top.scale.y = 0.15 / hgt; m.add(top); } }
    const sunM = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshBasicMaterial({ color: c3, fog: false })); sunM.position.set(0, 18, -260); scene.add(sunM);
    cam.position.set(0, 3, 10);
    upd.push((t, dt, sp) => { for (const m of blds) { m.position.z += dt * 14 * sp; if (m.position.z > 12) m.position.z -= 200; } grid.position.z = (grid.position.z + dt * 14 * sp) % 2.5; cam.position.y = 3 + Math.sin(t * 0.5) * 0.4; cam.lookAt(0, 4, -60); });
  }
  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); };
  resize(); addEventListener('resize', resize);
  let raf = 0; let last = performance.now(); let tt = 0;
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (document.hidden) { last = now; return; }
    const dt = Math.min(0.05, (now - last) / 1000); if (dt < 1 / 40) return; last = now;
    const sp = reduced() ? 0 : state.speed; tt += dt * sp; for (const f of upd) f(tt, dt, sp); renderer.render(scene, cam);
  };
  state = { type, colors: want.colors, speed, stop() { cancelAnimationFrame(raf); removeEventListener('resize', resize); scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); renderer.dispose(); try { renderer.forceContextLoss(); } catch {} cv.remove(); } };
  for (const f of upd) f(0, 0, 0); renderer.render(scene, cam);
  raf = requestAnimationFrame(loop);
}
export function stopBg3d() { want = null; if (state) { state.stop(); state = null; } }

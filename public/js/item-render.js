// Nebulix 13.1 — item pictures: every Locker item is rendered once in 3D (one shared offscreen renderer) and kept as
// an image, so the Shop, Locker and Marketplace show the real item instead of an icon. Images are cached per session.
import { load3d } from './avatar3d.js';
import { buildHero, animateHero } from './worlds-engine.js';
import { outfitAv, dressHero, backpackMesh, pickaxeMesh, gliderMesh, wrapMaterial, poseEmote } from './locker3d.js';
import { S } from './state.js';

const cache = new Map(); let R = null; let queue = Promise.resolve();
async function rig() {
  if (R) return R; const { THREE, AV } = await load3d();
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true }); renderer.setPixelRatio(1); renderer.setSize(256, 256, false); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene(); scene.add(new THREE.HemisphereLight('#eef2ff', '#312e81', 1.6)); const key = new THREE.DirectionalLight('#ffffff', 2.6); key.position.set(3, 4, 5); scene.add(key); const rim = new THREE.DirectionalLight('#c4b5fd', 2.2); rim.position.set(-4, 2, -3); scene.add(rim);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 60);
  R = { THREE, AV, renderer, scene, cam }; return R;
}
function frame(THREE, cam, obj, pad = 1.25) {
  const box = new THREE.Box3().setFromObject(obj); const size = box.getSize(new THREE.Vector3()); const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z) * 0.5 * pad; const d = r / Math.tan((cam.fov * Math.PI) / 360);
  cam.position.set(c.x + d * 0.35, c.y + d * 0.18, c.z + d * 0.94); cam.lookAt(c); cam.updateProjectionMatrix();
}
function build(r, it) {
  const { THREE, AV } = r; const s = Object.assign({ id: it.id }, it.spec || {}); const g = new THREE.Group();
  if (it.cat === 'outfit' || it.cat === 'emote') {
    const hero = buildHero(THREE, it.cat === 'outfit' ? outfitAv(S.me && S.me.av3, { outfit: s }) : (S.me && S.me.av3) || null, AV, { shadows: false }); dressHero(THREE, hero, {});
    hero.userData.lk.pickaxe.visible = false; animateHero(hero, 0.1, 1, { speed: 0, ground: true, vy: 0 }); if (it.cat === 'emote') poseEmote(hero, s.k, 0.6); hero.rotation.y = -0.35; g.add(hero);
  } else if (it.cat === 'backpack') { const m = backpackMesh(THREE, s); m.rotation.y = Math.PI + 0.5; g.add(m); }
  else if (it.cat === 'pickaxe') { const m = pickaxeMesh(THREE, s); m.rotation.z = -0.6; g.add(m); }
  else if (it.cat === 'glider') { const m = gliderMesh(THREE, s); m.rotation.x = 0.35; g.add(m); }
  else if (it.cat === 'wrap') { const mat = wrapMaterial(THREE, s); const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.16, 0.12), mat); const grip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.28, 0.1), mat); grip.position.set(-0.22, -0.18, 0); grip.rotation.z = 0.25; const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 10), mat); barrel.rotation.z = Math.PI / 2; barrel.position.x = 0.62; const mag = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.24, 0.08), mat); mag.position.set(0.1, -0.18, 0); g.add(body, grip, barrel, mag); g.rotation.y = -0.5; }
  else { // trail / elim: a burst of glowing particles in the item's colour
    const col = s.c || '#a78bfa'; const n = 70; const pos = new Float32Array(n * 3); const cols = new Float32Array(n * 3); const c = new THREE.Color();
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, rr = it.cat === 'trail' ? 0.15 + Math.random() * 0.25 : Math.random() * 0.9; const y = it.cat === 'trail' ? (i / n) * 1.8 - 0.9 : (Math.random() - 0.5) * 1.6; pos.set([Math.cos(a) * rr + (it.cat === 'trail' ? Math.sin(y * 3) * 0.3 : 0), y, Math.sin(a) * rr], i * 3); c.set(s.k === 'rainbow' ? `hsl(${(i / n) * 360},90%,65%)` : i % 4 ? col : '#ffffff'); cols.set([c.r, c.g, c.b], i * 3); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.12, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 1), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 2 })); g.add(core);
  }
  return g;
}
// returns a data URL with the item's picture (or null where 3D is not available)
export function itemImage(it) {
  if (cache.has(it.id)) return cache.get(it.id);
  const p = (queue = queue.then(async () => {
    try { const r = await rig(); const obj = build(r, it); r.scene.add(obj); frame(r.THREE, r.cam, obj, it.cat === 'outfit' || it.cat === 'emote' ? 1.05 : 1.3); r.renderer.render(r.scene, r.cam); const url = r.renderer.domElement.toDataURL('image/png'); r.scene.remove(obj); obj.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); return url; } catch { return null; }
  }));
  cache.set(it.id, p); return p;
}

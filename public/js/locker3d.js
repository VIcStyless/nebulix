// Nebulix 13 — the Locker (Taquilla) in 3D: outfits, backpacks, pickaxes, gliders, weapon wraps, trails,
// emotes and elimination effects. All shapes are simple original designs built from primitives.
// Used by the Locker preview (views/shop.js) and Nebula Royale (views/arena.js).

// outfit = a full look for the hero: merges over the player's own avatar
export function outfitAv(av, lk) {
  const o = lk && lk.outfit; if (!o) return av || null;
  return Object.assign({}, av || {}, { top: o.top === 'tee' ? 'tee' : o.top, hat: o.hat || 'none', acc: o.acc || 'none', topHex: o.topHex, pantsHex: o.pantsHex, aura: o.aura || 'none' });
}
const glowCache = new WeakMap();
function glow(THREE) {
  if (glowCache.has(THREE)) return glowCache.get(THREE);
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const tx = new THREE.CanvasTexture(c); glowCache.set(THREE, tx); return tx;
}
const M = (THREE, c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.45, metalness: 0.3 }, o));
function sprite(THREE, color, s) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(THREE), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); sp.scale.setScalar(s); return sp; }

export function backpackMesh(THREE, b) {
  const g = new THREE.Group(); const m1 = M(THREE, b.c), m2 = M(THREE, b.c2 || '#ffffff', { emissive: b.c2 || '#ffffff', emissiveIntensity: b.fx ? 1.4 : 0.5 });
  if (b.k === 'jet') { for (const s of [-1, 1]) { const cy = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.42, 14), m1); cy.position.set(s * 0.1, 0, 0); g.add(cy); const n = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.1, 12), m2); n.rotation.x = Math.PI; n.position.set(s * 0.1, -0.26, 0); g.add(n); const f = sprite(THREE, b.c2 || '#38bdf8', 0.3); f.position.set(s * 0.1, -0.34, 0); f.name = 'flame'; g.add(f); } }
  else if (b.k === 'wings') { for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.CircleGeometry(0.42, 3, 0, Math.PI / 1.4), M(THREE, b.c, { side: THREE.DoubleSide, emissive: b.c2 || b.c, emissiveIntensity: 0.4, transparent: true, opacity: 0.92 })); w.position.set(s * 0.06, 0.1, -0.02); w.rotation.set(0, s * 0.5, s * -0.6); w.name = 'wing'; w.userData.s = s; g.add(w); } }
  else if (b.k === 'orb') { const o = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 14), m2); g.add(o); const r = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.02, 8, 32), m1); r.rotation.x = Math.PI / 2.4; r.name = 'spin'; g.add(r); g.add(sprite(THREE, b.c2 || b.c, b.fx ? 0.9 : 0.55)); }
  else if (b.k === 'fin') { const f = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.6, 4), m1); f.scale.z = 0.35; f.position.y = 0.05; g.add(f); const s2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.04), m2); s2.position.z = -0.05; g.add(s2); }
  else { const bx = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.38, 0.16), m1); g.add(bx); const st = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.17), m2); st.position.y = 0.06; g.add(st); }
  return g;
}
export function pickaxeMesh(THREE, p) {
  const g = new THREE.Group(); const hm = M(THREE, '#3f3f46', { metalness: 0.2 }); const c1 = M(THREE, p.c, { metalness: 0.6, roughness: 0.3 }); const c2 = M(THREE, p.c2 || '#fff', { emissive: p.c2 || '#fff', emissiveIntensity: p.fx ? 1.5 : 0.4 });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.8, 8), hm); handle.position.y = 0.4; g.add(handle);
  if (p.k === 'hammer') { const hd = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.16), c1); hd.position.y = 0.8; g.add(hd); const b = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.04, 0.17), c2); b.position.y = 0.8; g.add(b); }
  else if (p.k === 'scythe') { const bl = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.03, 6, 20, Math.PI * 0.8), c1); bl.position.set(0.18, 0.78, 0); bl.rotation.z = Math.PI * 0.15; g.add(bl); const e = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.012, 4, 20, Math.PI * 0.8), c2); e.position.copy(bl.position); e.rotation.copy(bl.rotation); e.scale.setScalar(1.08); g.add(e); }
  else if (p.k === 'crystal') { const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.15), M(THREE, p.c, { emissive: p.c, emissiveIntensity: 0.8, transparent: true, opacity: 0.9 })); cr.scale.set(1.6, 0.8, 0.6); cr.position.y = 0.82; g.add(cr); g.add(Object.assign(sprite(THREE, p.c2 || p.c, 0.5), { position: new THREE.Vector3(0, 0.82, 0) })); }
  else { const bl = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.5, 4), c1); bl.rotation.z = Math.PI / 2; bl.position.set(0.16, 0.78, 0); g.add(bl); const bl2 = bl.clone(); bl2.rotation.z = -Math.PI / 2; bl2.position.x = -0.16; bl2.scale.y = 0.5; g.add(bl2); const cap = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), c2); cap.position.y = 0.8; g.add(cap); }
  return g;
}
export function gliderMesh(THREE, gl) {
  const g = new THREE.Group(); const a = M(THREE, gl.c, { side: THREE.DoubleSide, roughness: 0.6, metalness: 0.1 }); const b = M(THREE, gl.c2 || '#fff', { side: THREE.DoubleSide, emissive: gl.c2 || '#fff', emissiveIntensity: gl.fx ? 1.2 : 0.3 });
  if (gl.k === 'disc') { const d = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.12, 32), a); g.add(d); const r = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.05, 8, 40), b); r.rotation.x = Math.PI / 2; g.add(r); for (let i = 0; i < 4; i++) { const l = sprite(THREE, gl.c2 || '#fff', 0.5); l.position.set(Math.cos(i * Math.PI / 2) * 1.15, -0.05, Math.sin(i * Math.PI / 2) * 1.15); g.add(l); } }
  else if (gl.k === 'kite') { const sh = new THREE.Shape(); sh.moveTo(0, 1.1); sh.lineTo(1.3, 0); sh.lineTo(0, -0.7); sh.lineTo(-1.3, 0); sh.closePath(); const k = new THREE.Mesh(new THREE.ShapeGeometry(sh), a); k.rotation.x = -Math.PI / 2; g.add(k); const st = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.04, 0.04), b); g.add(st); }
  else if (gl.k === 'canopy') { const c = new THREE.Mesh(new THREE.SphereGeometry(1.3, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2.6), a); g.add(c); const rim = new THREE.Mesh(new THREE.TorusGeometry(Math.sin(Math.PI / 2.6) * 1.3, 0.04, 6, 32), b); rim.rotation.x = Math.PI / 2; rim.position.y = Math.cos(Math.PI / 2.6) * 1.3; g.add(rim); g.children[0].position.y = -0.2; }
  else { for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.8), a); w.position.set(s * 0.72, 0, 0); w.rotation.z = s * 0.12; g.add(w); const e = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.07, 0.1), b); e.position.set(s * 0.72, 0.01, 0.4); e.rotation.z = s * 0.12; g.add(e); } }
  // strings to the hands
  const lm = new THREE.LineBasicMaterial({ color: '#e5e7eb', transparent: true, opacity: 0.6 });
  for (const s of [-1, 1]) g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(s * 0.9, 0, 0), new THREE.Vector3(s * 0.25, -1.1, 0)]), lm));
  return g;
}
export function wrapMaterial(THREE, w) {
  if (!w) return null; const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 64, 64); gr.addColorStop(0, w.c); gr.addColorStop(1, w.c2 || w.c); x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  x.fillStyle = 'rgba(255,255,255,.18)'; for (let i = 0; i < 6; i++) x.fillRect(0, i * 11, 64, 3);
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: tx, metalness: w.metal ? 0.85 : 0.3, roughness: w.metal ? 0.25 : 0.55, emissive: w.fx ? w.c2 : '#000000', emissiveIntensity: w.fx ? 0.35 : 0 });
}
// put the locker on a hero from buildHero(): backpack on the back, pickaxe in the right hand, glider over the head
export function dressHero(THREE, hero, lk) {
  const u = hero.userData; const o = (u.lk = { backpack: null, pickaxe: null, glider: null, trail: lk && lk.trail ? lk.trail : null, elim: lk && lk.elim ? lk.elim : null, wrap: null, emotes: (lk && lk.emotes) || [] });
  if (!u.spine) return o;
  if (lk && lk.backpack) { const b = backpackMesh(THREE, lk.backpack); b.position.set(0, 0.36, -0.28); u.spine.add(b); o.backpack = b; }
  const pk = pickaxeMesh(THREE, (lk && lk.pickaxe) || { k: 'axe', c: '#9ca3af', c2: '#e5e7eb' }); pk.position.set(0, -0.36, 0.05); pk.rotation.set(Math.PI / 2, 0, 0); pk.visible = false; u.R.el.add(pk); o.pickaxe = pk;
  const gl = gliderMesh(THREE, (lk && lk.glider) || { k: 'wing', c: '#64748b', c2: '#e2e8f0' }); gl.position.y = 2.9; gl.visible = false; hero.add(gl); o.glider = gl;
  if (lk && lk.wrap) o.wrap = wrapMaterial(THREE, lk.wrap);
  return o;
}
// emotes: a pose on top of animateHero (call after it every frame while the emote plays, t in seconds)
export const EMOTE_LEN = 2.6;
export function poseEmote(hero, k, t) {
  const u = hero.userData; if (!u || !u.L) return; const s = Math.sin(t * 8), c = Math.cos(t * 8);
  const set = (o, x, z) => { o.rotation.x = x; if (z !== undefined) o.rotation.z = z; };
  if (k === 'wave') { set(u.R.sh, -2.7, 0.4 + s * 0.35); u.R.el.rotation.x = -0.6; }
  else if (k === 'dance') { set(u.L.sh, -1.6 + s, -0.5); set(u.R.sh, -1.6 - s, 0.5); u.hips.position.y = 0.92 + Math.abs(s) * 0.08; u.spine.rotation.z = s * 0.25; u.LL.hp.rotation.x = Math.max(0, s) * -0.9; u.RL.hp.rotation.x = Math.max(0, -s) * -0.9; }
  else if (k === 'spin') { hero.rotation.y += 0.25; set(u.L.sh, 0, -1.4); set(u.R.sh, 0, 1.4); }
  else if (k === 'flex') { set(u.L.sh, -1.2, -1.3); set(u.R.sh, -1.2, 1.3); u.L.el.rotation.x = -2 - Math.abs(s) * 0.3; u.R.el.rotation.x = -2 - Math.abs(s) * 0.3; }
  else if (k === 'hop') { u.root.position.y = Math.abs(Math.sin(t * 6)) * 0.45; set(u.L.sh, -2.6, -0.3); set(u.R.sh, -2.6, 0.3); }
  else if (k === 'bow') { u.spine.rotation.x = Math.min(1, t * 2) * (t < 2 ? 0.9 : 0.9 * (EMOTE_LEN - t) / 0.6); set(u.R.sh, 0.4, 0.2); set(u.L.sh, -1.4, -0.9); }
  else if (k === 'robot') { const st = Math.floor(t * 4) % 4; set(u.L.sh, st % 2 ? -1.57 : 0, -0.2); set(u.R.sh, st % 2 ? 0 : -1.57, 0.2); u.L.el.rotation.x = -1.57; u.R.el.rotation.x = -1.57; u.head.rotation.y = (st - 1.5) * 0.4; }
  else if (k === 'orbit') { u.root.position.y = 0.3 + Math.sin(t * 3) * 0.15; hero.rotation.y += 0.06; set(u.L.sh, -0.3, -1.2 + c * 0.1); set(u.R.sh, -0.3, 1.2 - c * 0.1); u.LL.kn.rotation.x = 1.2; u.RL.kn.rotation.x = 1.2; }
}
export function resetEmote(hero) { const u = hero.userData; if (u && u.root) { u.root.position.y = 0; u.spine.rotation.z = 0; } }
// elimination effect at a point; pushes short-lived objects into fx (array of { o, t, life, v? })
export function elimBurst(THREE, scene, fx, p, spec) {
  const k = (spec && spec.k) || 'burst'; const col = (spec && spec.c) || '#a78bfa'; const n = k === 'pixels' ? 26 : k === 'flame' ? 34 : 22; const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    let o; if (k === 'pixels') { o = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), new THREE.MeshBasicMaterial({ color: i % 3 ? col : '#ffffff', transparent: true })); }
    else o = sprite(THREE, k === 'flame' ? (i % 2 ? '#f97316' : '#fde047') : k === 'stars' ? (i % 2 ? col : '#ffffff') : col, k === 'ring' ? 0.5 : 0.6);
    o.position.set(p.x, p.y + 1, p.z); const a = (i / n) * Math.PI * 2; const up = k === 'ring' ? 0 : Math.random() * 4 + (k === 'flame' ? 3 : 1);
    const sp = k === 'ring' ? 6 : 2 + Math.random() * 3; scene.add(o); fx.push({ o, t: t0, life: 900 + Math.random() * 300, v: new THREE.Vector3(Math.cos(a) * sp, up, Math.sin(a) * sp), g: k === 'flame' ? -1 : 6 });
  }
  const flash = sprite(THREE, col, 3.5); flash.position.set(p.x, p.y + 1, p.z); scene.add(flash); fx.push({ o: flash, t: t0, life: 260 });
}
// trail puff behind a falling / gliding hero
export function trailPuff(THREE, scene, fx, p, spec) {
  const k = spec.k; const col = k === 'rainbow' ? `hsl(${(performance.now() / 6) % 360},90%,65%)` : spec.c; const o = sprite(THREE, col, k === 'smoke' ? 0.9 : 0.45);
  if (k === 'smoke') { o.material.blending = THREE.NormalBlending; o.material.opacity = 0.5; }
  o.position.set(p.x + (Math.random() - 0.5) * 0.4, p.y + 0.6 + (Math.random() - 0.5) * 0.4, p.z + (Math.random() - 0.5) * 0.4); scene.add(o); fx.push({ o, t: performance.now(), life: k === 'smoke' ? 900 : 650, v: new THREE.Vector3(0, k === 'smoke' ? 0.6 : 0.2, 0) });
}
// advance fx made by elimBurst / trailPuff (velocity, gravity, fade); returns nothing, removes finished ones
export function stepFx(scene, fx, now, dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i]; const age = now - f.t;
    if (age > f.life) { scene.remove(f.o); if (f.o.geometry && !f.o.isSprite) f.o.geometry.dispose(); if (f.o.material) f.o.material.dispose(); fx.splice(i, 1); continue; }
    if (f.v) { f.o.position.addScaledVector(f.v, dt); if (f.g) f.v.y -= f.g * dt; }
    if (f.o.material && f.o.material.opacity !== undefined) { f.o.material.transparent = true; f.o.material.opacity = Math.max(0, 1 - age / f.life) * (f.o.userData.op || 1); }
  }
}

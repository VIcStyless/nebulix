// Nebula Worlds engine (Nebulix 9): the look of the 3D worlds. A smooth, jointed hero with real run / jump / fall /
// land animation, polished rounded platforms with panel textures and glowing trims, laser hazards, bounce pads,
// checkpoint beacons, a finish portal, a shader sky with sun, stars, a sea of clouds and floating islands.
// Physics stays in views/worlds.js (boxes: x, y, z, w, h, d).

let T = null; // THREE
const cache = new Map();
const once = (k, fn) => { if (!cache.has(k)) cache.set(k, fn()); return cache.get(k); };
export function engineReset() { for (const v of cache.values()) { try { v && v.dispose && v.dispose(); } catch {} } cache.clear(); for (const m of matCache.values()) { try { m.dispose(); } catch {} } matCache.clear(); }

// ---------- procedural textures ----------
function canvasTex(w, h, draw, { repeat = 1, srgb = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const tx = new T.CanvasTexture(c); tx.wrapS = tx.wrapT = T.RepeatWrapping; tx.repeat.set(repeat, repeat); tx.anisotropy = 8; if (srgb) tx.colorSpace = T.SRGBColorSpace; return tx;
}
// light panel tiles with soft noise (multiplies the block colour)
const panelTex = () => once('tex:panel', () => canvasTex(256, 256, (g, w) => {
  g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, w, w);
  const img = g.getImageData(0, 0, w, w); for (let i = 0; i < img.data.length; i += 4) { const n = 232 + Math.random() * 23; img.data[i] = img.data[i + 1] = img.data[i + 2] = n; } g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(0,0,0,.16)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, w - 3); g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.5; g.strokeRect(5, 5, w - 10, w - 10);
  g.fillStyle = 'rgba(0,0,0,.07)'; for (const [x, y] of [[14, 14], [w - 14, 14], [14, w - 14], [w - 14, w - 14]]) { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
}, { repeat: 0.5 }));
const roughTex = () => once('tex:rough', () => canvasTex(128, 128, (g, w) => { const img = g.createImageData(w, w); for (let i = 0; i < img.data.length; i += 4) { const n = 120 + Math.random() * 110; img.data[i] = img.data[i + 1] = img.data[i + 2] = n; img.data[i + 3] = 255; } g.putImageData(img, 0, 0); }, { repeat: 0.5, srgb: false }));
const stripeTex = () => once('tex:stripe', () => canvasTex(128, 128, (g, w) => { g.fillStyle = '#facc15'; g.fillRect(0, 0, w, w); g.fillStyle = '#111'; for (let i = -w; i < w * 2; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 16, 0); g.lineTo(i + 16 - w, w); g.lineTo(i - w, w); g.fill(); } }, { repeat: 1 }));
export const glowTex = (THREE) => { if (THREE) T = THREE; return glowTex0(); };
const glowTex0 = () => once('tex:glow', () => canvasTex(64, 64, (g, w) => { const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); }));
const cloudTex = () => once('tex:cloud', () => canvasTex(256, 128, (g, w, h) => { for (let i = 0; i < 26; i++) { const x = 40 + Math.random() * (w - 80), y = 50 + Math.random() * 40, r = 18 + Math.random() * 34; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); } }));

// ---------- rounded platform geometry (extruded rounded rectangle with a bevel) ----------
function roundedBox(w, h, d) {
  const key = `rb:${w.toFixed(2)}:${h.toFixed(2)}:${d.toFixed(2)}`;
  return once(key, () => {
    const bv = Math.min(0.12, h * 0.25, w * 0.2, d * 0.2); const r = Math.min(0.35, (Math.min(w, d) - 2 * bv) * 0.3);
    const W = Math.max(0.05, w - 2 * bv), D = Math.max(0.05, d - 2 * bv); const s = new T.Shape(); const x = -W / 2, y = -D / 2;
    s.moveTo(x + r, y); s.lineTo(x + W - r, y); s.quadraticCurveTo(x + W, y, x + W, y + r); s.lineTo(x + W, y + D - r); s.quadraticCurveTo(x + W, y + D, x + W - r, y + D); s.lineTo(x + r, y + D); s.quadraticCurveTo(x, y + D, x, y + D - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    const depth = Math.max(0.01, h - 2 * bv);
    const g = new T.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bv, bevelSize: bv, bevelSegments: 3, curveSegments: 5 });
    g.rotateX(-Math.PI / 2); g.translate(0, -depth / 2, 0); g.computeVertexNormals(); return g;
  });
}
function topLoop(w, d, color, y) {
  const W = w - 0.16, D = d - 0.16; const r = Math.min(0.3, Math.min(W, D) * 0.3); const s = new T.Shape(); const x = -W / 2, z = -D / 2;
  s.moveTo(x + r, z); s.lineTo(x + W - r, z); s.quadraticCurveTo(x + W, z, x + W, z + r); s.lineTo(x + W, z + D - r); s.quadraticCurveTo(x + W, z + D, x + W - r, z + D); s.lineTo(x + r, z + D); s.quadraticCurveTo(x, z + D, x, z + D - r); s.lineTo(x, z + r); s.quadraticCurveTo(x, z, x + r, z);
  const pts = s.getPoints(6).map((p) => new T.Vector3(p.x, y, p.y)); const g = new T.BufferGeometry().setFromPoints(pts);
  return new T.LineLoop(g, new T.LineBasicMaterial({ color, transparent: true, opacity: 0.95 }));
}

// ---------- materials ----------
const matCache = new Map();
function surf(color, o = {}) {
  const k = color + JSON.stringify(o); if (matCache.has(k)) return matCache.get(k);
  const m = new T.MeshStandardMaterial(Object.assign({ color, map: panelTex(), roughnessMap: roughTex(), roughness: 0.62, metalness: 0.12 }, o)); matCache.set(k, m); return m;
}

// theme for a level: { neon: trims glow, trim colour }
export function themeOf(lv) { const dark = /^#(0|1|2)/.test(lv.sky[0]); return { neon: dark, trim: lv.lava ? '#fb923c' : dark ? '#a5b4fc' : '#ffffff' }; }

// Build the visual for one block. Returns { obj, tick(ts, dt) | null, glow(on) | null }
export function makeBlock(THREE, b, theme, shadows) {
  T = THREE; const grp = new T.Group(); grp.position.set(b.x, b.y, b.z); let tick = null; let glow = null;
  const solid = (m) => { const mesh = new T.Mesh(roundedBox(b.w, b.h, b.d), m); mesh.castShadow = shadows; mesh.receiveShadow = shadows; grp.add(mesh); return mesh; };
  if (b.k === 'kill') {
    // laser fence: two emitter posts and a glowing beam along the long side
    const along = b.w >= b.d; const len = along ? b.w : b.d; const beamM = new T.MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.9 }); const coreM = new T.MeshBasicMaterial({ color: '#fff1f1' });
    const postM = new T.MeshStandardMaterial({ color: '#1f2937', metalness: 0.8, roughness: 0.3, emissive: '#ef4444', emissiveIntensity: 0.4 });
    for (const s of [-1, 1]) { const p = new T.Mesh(new T.CylinderGeometry(0.09, 0.12, b.h + 0.25, 10), postM); p.position[along ? 'x' : 'z'] = (s * len) / 2; p.castShadow = shadows; grp.add(p); }
    const beams = []; for (const yy of [-b.h * 0.28, 0, b.h * 0.28]) { const beam = new T.Mesh(new T.CylinderGeometry(0.055, 0.055, len, 8), beamM); const core = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, len, 6), coreM); beam.add(core); beam.rotation[along ? 'z' : 'x'] = Math.PI / 2; beam.position.y = yy; grp.add(beam); beams.push(beam); }
    const halo = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: '#ff2d2d', transparent: true, opacity: 0.5, depthWrite: false, blending: T.AdditiveBlending })); halo.scale.set(len * 1.1, b.h * 1.6, 1); grp.add(halo);
    tick = (ts) => { const f = 0.75 + Math.sin(ts * 23 + b.x) * 0.12 + Math.sin(ts * 7.3) * 0.1; beamM.opacity = f; halo.material.opacity = 0.35 + f * 0.25; };
  } else if (b.k === 'spin') {
    // spinning laser bar around a glowing hub (physics: views/worlds.js)
    const hub = new T.Mesh(new T.CylinderGeometry(0.22, 0.28, 0.5, 16), new T.MeshStandardMaterial({ color: '#1f2937', metalness: 0.9, roughness: 0.25, emissive: '#ef4444', emissiveIntensity: 0.8 })); hub.castShadow = shadows; grp.add(hub);
    const beamM = new T.MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.92 }); const beam = new T.Mesh(new T.CylinderGeometry(0.07, 0.07, b.w, 10), beamM); beam.rotation.z = Math.PI / 2; beam.add(new T.Mesh(new T.CylinderGeometry(0.025, 0.025, b.w, 6), new T.MeshBasicMaterial({ color: '#fff1f1' }))); grp.add(beam);
    for (const sx of [-1, 1]) { const tip = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color: '#ff2d2d', transparent: true, depthWrite: false, blending: T.AdditiveBlending })); tip.position.x = (sx * b.w) / 2; tip.scale.setScalar(0.9); grp.add(tip); }
    tick = (ts) => { beamM.opacity = 0.8 + Math.sin(ts * 25) * 0.12; };
  } else if (b.k === 'bounce') {
    solid(surf('#3b0a2a', { map: null, metalness: 0.6, roughness: 0.3 }));
    const ringM = new T.MeshBasicMaterial({ color: '#f472b6', transparent: true, opacity: 0.9, blending: T.AdditiveBlending, depthWrite: false }); const rings = [];
    for (let i = 0; i < 3; i++) { const r = new T.Mesh(new T.TorusGeometry(Math.min(b.w, b.d) * 0.36, 0.04, 6, 40), ringM.clone()); r.rotation.x = Math.PI / 2; r.position.y = b.h / 2 + 0.03; grp.add(r); rings.push(r); }
    const pad = new T.Mesh(new T.CircleGeometry(Math.min(b.w, b.d) * 0.4, 32), new T.MeshStandardMaterial({ color: '#ec4899', emissive: '#ec4899', emissiveIntensity: 1.4 })); pad.rotation.x = -Math.PI / 2; pad.position.y = b.h / 2 + 0.02; grp.add(pad);
    tick = (ts) => { rings.forEach((r, i) => { const k = (ts * 0.9 + i / 3) % 1; r.position.y = b.h / 2 + 0.05 + k * 1.6; r.scale.setScalar(1 - k * 0.35); r.material.opacity = (1 - k) * 0.9; }); pad.material.emissiveIntensity = 1.1 + Math.sin(ts * 6) * 0.4; };
  } else if (b.k === 'check') {
    solid(surf('#14532d', { metalness: 0.3 })); const ringM = new T.MeshStandardMaterial({ color: '#4ade80', emissive: '#22c55e', emissiveIntensity: 0.6 });
    const ring = new T.Mesh(new T.TorusGeometry(Math.min(b.w, b.d) * 0.42, 0.06, 8, 48), ringM); ring.rotation.x = Math.PI / 2; ring.position.y = b.h / 2 + 0.04; grp.add(ring);
    const beamM = new T.MeshBasicMaterial({ color: '#86efac', transparent: true, opacity: 0.16, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide });
    const beam = new T.Mesh(new T.CylinderGeometry(0.5, 0.9, 14, 24, 1, true), beamM); beam.position.y = b.h / 2 + 7; grp.add(beam);
    const gem = new T.Mesh(new T.OctahedronGeometry(0.32), new T.MeshStandardMaterial({ color: '#bbf7d0', emissive: '#22c55e', emissiveIntensity: 0.8, metalness: 0.4, roughness: 0.15 })); gem.position.y = b.h / 2 + 1.7; gem.castShadow = shadows; grp.add(gem);
    let on = false; glow = (v) => { on = v; ringM.emissiveIntensity = v ? 2.4 : 0.6; beamM.opacity = v ? 0.32 : 0.16; gem.material.emissiveIntensity = v ? 2.2 : 0.8; };
    tick = (ts) => { gem.rotation.y = ts * 1.6; gem.position.y = b.h / 2 + 1.7 + Math.sin(ts * 2.2) * 0.12; beam.material.opacity = (on ? 0.28 : 0.12) + Math.sin(ts * 3) * 0.04; };
  } else if (b.k === 'finish') {
    solid(surf('#fbbf24', { metalness: 0.75, roughness: 0.25, map: null }));
    const portal = new T.Mesh(new T.TorusGeometry(1.7, 0.16, 12, 64), new T.MeshStandardMaterial({ color: '#fde68a', emissive: '#f59e0b', emissiveIntensity: 1.6, metalness: 0.9, roughness: 0.2 })); portal.position.y = b.h / 2 + 2.1; grp.add(portal);
    const disc = new T.Mesh(new T.CircleGeometry(1.55, 48), new T.MeshBasicMaterial({ color: '#fff7cc', transparent: true, opacity: 0.25, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide })); disc.position.y = portal.position.y; grp.add(disc);
    const n = 70; const pos = new Float32Array(n * 3); const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    const swirl = new T.Points(geo, new T.PointsMaterial({ color: '#fde68a', size: 0.12, transparent: true, depthWrite: false, blending: T.AdditiveBlending })); swirl.position.y = portal.position.y; grp.add(swirl);
    tick = (ts) => { portal.rotation.y = ts * 0.5; disc.rotation.y = ts * 0.5; disc.material.opacity = 0.18 + Math.sin(ts * 3) * 0.08; for (let i = 0; i < n; i++) { const a = ts * (1 + (i % 5) * 0.2) + i; const r = 0.4 + ((i * 37) % 100) / 100 * 1.2; pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.sin(a) * r; pos[i * 3 + 2] = Math.sin(a * 2 + i) * 0.15; } geo.attributes.position.needsUpdate = true; swirl.rotation.y = ts * 0.5; };
  } else if (b.k === 'deco') {
    solid(surf(b.c, { metalness: 0.35, roughness: 0.4, emissive: theme.neon ? b.c : '#000', emissiveIntensity: theme.neon ? 0.25 : 0 }));
  } else {
    const ice = !!b.ice; if (b.k === 'fall') { solid(surf('#f59e0b', { roughness: 0.8, emissive: '#7c2d12', emissiveIntensity: 0.25 })); const crack = topLoop(b.w * 0.6, b.d * 0.6, '#7c2d12', b.h / 2 + 0.012); grp.add(crack); return { obj: grp, tick: null, glow: null }; }
    const m = ice ? new T.MeshPhysicalMaterial({ color: '#bae6fd', roughness: 0.05, metalness: 0.1, transmission: 0.35, thickness: 0.5, clearcoat: 1 }) : surf(b.c);
    solid(m);
    if (b.k === 'move') { const strip = new T.Mesh(new T.BoxGeometry(b.w * 0.86, 0.02, 0.16), new T.MeshStandardMaterial({ map: stripeTex(), roughness: 0.5 })); strip.position.set(0, b.h / 2 + 0.011, b.d / 2 - 0.2); grp.add(strip); const s2 = strip.clone(); s2.position.z = -b.d / 2 + 0.2; grp.add(s2); }
    if (b.w * b.d < 4000 && (theme.neon || b.k === 'move')) { const loop = topLoop(b.w, b.d, b.k === 'move' ? '#22d3ee' : theme.trim, b.h / 2 + 0.012); grp.add(loop); }
  }
  return { obj: grp, tick, glow };
}

// ---------- sky, stars, clouds, islands ----------
export function makeWorldEnv(THREE, scene, lv, { tier = 'med' } = {}) {
  T = THREE; const parts = []; const ticks = [];
  const top = new T.Color(lv.sky[0]); const hor = new T.Color(lv.sky[1]);
  const skyM = new T.ShaderMaterial({ side: T.BackSide, depthWrite: false, fog: false, uniforms: { top: { value: top }, hor: { value: hor }, sun: { value: new T.Vector3(0.45, 0.55, 0.3).normalize() }, sunC: { value: new T.Color(lv.lava ? '#ffb27a' : '#fff4d6') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }',
    fragmentShader: 'uniform vec3 top; uniform vec3 hor; uniform vec3 sun; uniform vec3 sunC; varying vec3 vP; void main(){ float h = vP.y; vec3 c = mix(hor, top, smoothstep(-0.05, 0.6, h)); c = mix(c, hor * 0.55, smoothstep(0.0, -0.5, h)); float s = max(dot(vP, sun), 0.0); c += sunC * (pow(s, 900.0) * 3.0 + pow(s, 24.0) * 0.35); gl_FragColor = vec4(c, 1.0); }' });
  const sky = new T.Mesh(new T.SphereGeometry(400, 32, 16), skyM); sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky); parts.push(sky);
  const dark = top.getHSL({}).l < 0.3;
  if (dark) { const n = tier === 'low' ? 400 : 1200; const g = new T.BufferGeometry(); const p = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, b = Math.acos(Math.random() * 1.6 - 0.6), r = 380; p[i * 3] = Math.cos(a) * Math.sin(b) * r; p[i * 3 + 1] = Math.cos(b) * r; p[i * 3 + 2] = Math.sin(a) * Math.sin(b) * r; } g.setAttribute('position', new T.BufferAttribute(p, 3)); const st = new T.Points(g, new T.PointsMaterial({ size: 1.4, color: '#ffffff', fog: false, transparent: true, opacity: 0.9, sizeAttenuation: false })); scene.add(st); parts.push(st); ticks.push((ts) => { st.material.opacity = 0.75 + Math.sin(ts * 1.7) * 0.15; st.rotation.y = ts * 0.003; }); }
  // the course's bounds → clouds below it and islands around it
  const xs = lv.blocks.map((b) => b.x), zs = lv.blocks.map((b) => b.z), ys = lv.blocks.map((b) => b.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2; const span = Math.max(60, Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)); const low = Math.min(...ys);
  if (!lv.lava) {
    const n = tier === 'low' ? 24 : tier === 'med' ? 60 : 110; const cm = new T.SpriteMaterial({ map: cloudTex(), color: dark ? new T.Color(lv.sky[1]).lerp(new T.Color('#ffffff'), 0.35) : '#ffffff', transparent: true, opacity: dark ? 0.35 : 0.85, depthWrite: false, fog: true });
    const clouds = new T.Group(); for (let i = 0; i < n; i++) { const s = new T.Sprite(cm); const a = Math.random() * 6.28, r = Math.random() * span * 1.1 + 10; s.position.set(cx + Math.cos(a) * r, low - 10 - Math.random() * 14, cz + Math.sin(a) * r); const k = 18 + Math.random() * 26; s.scale.set(k * 2, k, 1); clouds.add(s); }
    scene.add(clouds); parts.push(clouds); ticks.push((ts) => { clouds.position.x = Math.sin(ts * 0.02) * 6; clouds.position.z = ts * 0.4 % 40; });
  }
  // floating islands far away (rocky undersides, grassy or tinted tops)
  const rockM = new T.MeshStandardMaterial({ color: lv.lava ? '#292524' : '#3f3a52', roughness: 0.95, flatShading: true }); const topM = new T.MeshStandardMaterial({ color: lv.lava ? '#7c2d12' : dark ? new T.Color(lv.sky[1]).lerp(new T.Color('#64748b'), 0.5) : '#4ade80', roughness: 0.9, flatShading: true });
  const isl = new T.Group(); const ni = tier === 'low' ? 5 : 10;
  for (let i = 0; i < ni; i++) {
    const g = new T.ConeGeometry(4 + Math.random() * 6, 7 + Math.random() * 8, 7, 3); const p = g.attributes.position; for (let j = 0; j < p.count; j++) { p.setX(j, p.getX(j) * (0.8 + Math.random() * 0.4)); p.setZ(j, p.getZ(j) * (0.8 + Math.random() * 0.4)); } g.computeVertexNormals();
    const rock = new T.Mesh(g, rockM); rock.rotation.x = Math.PI; const cap = new T.Mesh(new T.CylinderGeometry(g.parameters.radius * 1.02, g.parameters.radius * 0.95, 1.2, 7), topM); cap.position.y = g.parameters.height / 2 + 0.4;
    const one = new T.Group(); one.add(rock, cap); const a = (i / ni) * 6.28 + Math.random() * 0.4, r = span * 0.75 + 40 + Math.random() * 60; one.position.set(cx + Math.cos(a) * r, low + Math.random() * 30 - 6, cz + Math.sin(a) * r); one.scale.setScalar(1 + Math.random() * 1.4); isl.add(one);
  }
  scene.add(isl); parts.push(isl); ticks.push((ts) => { isl.children.forEach((o, i) => { o.position.y += Math.sin(ts * 0.5 + i) * 0.004; }); });
  // drifting motes near the player (adds depth)
  const mn = tier === 'low' ? 0 : 160; let motes = null;
  if (mn) { const g = new T.BufferGeometry(); const p = new Float32Array(mn * 3); for (let i = 0; i < mn * 3; i++) p[i] = (Math.random() - 0.5) * 50; g.setAttribute('position', new T.BufferAttribute(p, 3)); motes = new T.Points(g, new T.PointsMaterial({ map: glowTex(), size: 0.22, color: lv.lava ? '#fdba74' : '#e0e7ff', transparent: true, opacity: 0.55, depthWrite: false, blending: T.AdditiveBlending })); scene.add(motes); parts.push(motes); }
  return {
    tick: (ts, me) => { for (const f of ticks) f(ts); if (motes && me) { motes.position.set(me.x, me.y, me.z); motes.rotation.y = ts * 0.03; } sky.position.set(me ? me.x : 0, me ? me.y : 0, me ? me.z : 0); },
    dispose: () => parts.forEach((p) => scene.remove(p)),
  };
}

// ---------- hero: smooth jointed character ----------
const cap = (r, len, m) => { const mesh = new T.Mesh(new T.CapsuleGeometry(r, len, 6, 14), m); return mesh; };
// limb: a pivot group at the joint with a capsule hanging below it
function limb(r, len, m, shadows) { const p = new T.Group(); const c = cap(r, len, m); c.position.y = -len / 2 - r * 0.2; c.castShadow = shadows; p.add(c); return p; }
export function buildHero(THREE, av, AV, { shadows = true, ghost = false } = {}) {
  T = THREE; const a = Object.assign({}, (AV && AV.default) || {}, av || {});
  const pick = (list, i, d) => (list && list[i]) || d;
  const std = (c, o = {}) => (ghost ? new T.MeshStandardMaterial({ color: '#7dd3fc', emissive: '#38bdf8', emissiveIntensity: 0.8, transparent: true, opacity: 0.32, depthWrite: false }) : new T.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.55, metalness: 0.04 }, o)));
  const skin = std(pick(AV && AV.skin, a.skin, '#f1c27d'), { roughness: 0.6 }); const topC = a.topHex || pick(AV && AV.color, a.topColor, '#6366f1'); const top = std(topC, { roughness: a.top === 'suit' ? 0.35 : 0.7, metalness: a.top === 'armor' ? 0.8 : 0.04 });
  const pants = std(a.pantsHex || pick(AV && AV.color, a.pants, '#1f2937'), { roughness: 0.75 }); const hair = std(pick(AV && AV.hairColor, a.hairColor, '#3b2f2f'), { roughness: 0.85 }); const shoeM = std('#15171c', { roughness: 0.35 }); const accent = std(new T.Color(topC).offsetHSL(0, 0, 0.18).getStyle(), { roughness: 0.5 });
  const g = new T.Group(); g.name = 'hero'; const root = new T.Group(); g.add(root); // root: squash & stretch
  const hips = new T.Group(); hips.position.y = 0.92; root.add(hips);
  const pelvis = cap(0.2, 0.12, pants); pelvis.rotation.z = Math.PI / 2; pelvis.castShadow = shadows; hips.add(pelvis);
  const spine = new T.Group(); spine.position.y = 0.08; hips.add(spine);
  const torso = cap(0.25, 0.32, top); torso.position.y = 0.3; torso.scale.set(1.08, 1, 0.82); torso.castShadow = shadows; spine.add(torso);
  const belt = new T.Mesh(new T.TorusGeometry(0.235, 0.035, 8, 24), accent); belt.rotation.x = Math.PI / 2; belt.position.y = 0.08; belt.scale.set(1.08, 0.82, 1); spine.add(belt);
  if (a.top === 'hoodie') { const hood = new T.Mesh(new T.TorusGeometry(0.17, 0.07, 8, 20), top); hood.position.set(0, 0.6, -0.08); hood.rotation.x = 1.2; spine.add(hood); }
  if (a.top === 'suit') { const tie = new T.Mesh(new T.BoxGeometry(0.06, 0.3, 0.02), std('#b91c1c')); tie.position.set(0, 0.36, 0.21); spine.add(tie); }
  if (a.top === 'armor') { for (const s of [-1, 1]) { const pad = new T.Mesh(new T.SphereGeometry(0.15, 14, 10, 0, 6.3, 0, 1.6), std('#cbd5e1', { metalness: 0.9, roughness: 0.2 })); pad.position.set(s * 0.3, 0.55, 0); spine.add(pad); } const core = new T.Mesh(new T.CircleGeometry(0.07, 20), std('#22d3ee', { emissive: '#22d3ee', emissiveIntensity: 2 })); core.position.set(0, 0.38, 0.215); spine.add(core); }
  // neck + head
  const neck = new T.Group(); neck.position.y = 0.66; spine.add(neck);
  const head = new T.Group(); head.position.y = 0.2; neck.add(head);
  const skull = new T.Mesh(new T.SphereGeometry(0.25, 28, 20), skin); skull.scale.set(1, 1.06, 0.98); skull.castShadow = shadows; head.add(skull);
  const eyeM = std('#101216', { roughness: 0.2 }); const shine = std('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.6 });
  for (const s of [-1, 1]) { const e = cap(0.035, 0.05, eyeM); e.position.set(s * 0.09, 0.02, 0.225); head.add(e); const sh = new T.Mesh(new T.SphereGeometry(0.012, 8, 6), shine); sh.position.set(s * 0.09 + 0.012, 0.05, 0.255); head.add(sh); if (a.eyes === 'happy') { e.scale.set(1.2, 0.35, 1); } if (a.eyes === 'star') e.material = std('#fde047', { emissive: '#facc15', emissiveIntensity: 1.5 }); }
  const brow = std(pick(AV && AV.hairColor, a.hairColor, '#3b2f2f')); for (const s of [-1, 1]) { const b = new T.Mesh(new T.BoxGeometry(0.08, 0.016, 0.02), brow); b.position.set(s * 0.09, 0.1, 0.235); b.rotation.z = -s * 0.12; head.add(b); }
  const mouth = new T.Mesh(new T.TorusGeometry(0.035, 0.008, 6, 12, Math.PI), std('#7f1d1d')); mouth.position.set(0, -0.08, 0.235); mouth.rotation.z = Math.PI; head.add(mouth);
  // hair styles (smooth shells)
  const hr = a.hair || 'short'; const shell = (sx, sy, sz, y, z, cut = 0.55) => { const m = new T.Mesh(new T.SphereGeometry(0.265, 28, 18, 0, Math.PI * 2, 0, Math.PI * cut), hair); m.scale.set(sx, sy, sz); m.position.set(0, y, z); m.castShadow = shadows; head.add(m); return m; };
  if (hr !== 'bald' && hr !== 'none') {
    if (hr === 'afro') { const m = new T.Mesh(new T.SphereGeometry(0.4, 24, 18), hair); m.position.set(0, 0.12, -0.05); m.scale.set(1, 0.9, 1); head.add(m); }
    else { shell(1.04, 1.08, 1.06, 0.02, -0.01, hr === 'long' ? 0.62 : 0.5); }
    if (hr === 'spiky') for (let i = 0; i < 6; i++) { const s = new T.Mesh(new T.ConeGeometry(0.06, 0.2, 8), hair); const an = (i / 6) * Math.PI - Math.PI / 2; s.position.set(Math.sin(an) * 0.16, 0.25, -0.02 + Math.cos(an) * 0.05); s.rotation.z = -Math.sin(an) * 0.6; head.add(s); }
    if (hr === 'long') { const back = cap(0.2, 0.28, hair); back.position.set(0, -0.22, -0.14); back.scale.set(1.15, 1, 0.6); head.add(back); }
    if (hr === 'bun') { const b = new T.Mesh(new T.SphereGeometry(0.12, 16, 12), hair); b.position.set(0, 0.26, -0.15); head.add(b); }
    if (hr === 'mohawk') { const m = new T.Mesh(new T.BoxGeometry(0.06, 0.16, 0.42), hair); m.position.set(0, 0.28, -0.02); head.add(m); }
    if (hr === 'twintails') for (const s of [-1, 1]) { const tl = cap(0.07, 0.3, hair); tl.position.set(s * 0.3, -0.12, -0.1); tl.rotation.z = s * 0.3; head.add(tl); }
  }
  if (a.hat === 'cap') { const c = shell(1.1, 0.75, 1.1, 0.06, 0, 0.5); c.material = top; const brim = new T.Mesh(new T.CylinderGeometry(0.2, 0.2, 0.02, 20, 1, false, -Math.PI / 2, Math.PI), top); brim.position.set(0, 0.1, 0.18); head.add(brim); }
  if (a.hat === 'beanie') { const c = shell(1.12, 1.0, 1.12, 0.05, 0, 0.5); c.material = std('#e11d48', { roughness: 0.95 }); }
  if (a.hat === 'tophat') { const m = std('#111827', { roughness: 0.3 }); const br = new T.Mesh(new T.CylinderGeometry(0.36, 0.36, 0.03, 28), m); br.position.y = 0.22; head.add(br); const tp = new T.Mesh(new T.CylinderGeometry(0.21, 0.21, 0.34, 28), m); tp.position.y = 0.4; head.add(tp); }
  if (a.hat === 'crown') { const gold = std('#facc15', { metalness: 1, roughness: 0.2, emissive: '#7c5a00', emissiveIntensity: 0.3 }); const cr = new T.Mesh(new T.CylinderGeometry(0.2, 0.22, 0.14, 10, 1, true), gold); cr.material.side = T.DoubleSide; cr.position.y = 0.3; head.add(cr); }
  if (a.hat === 'halo') { const ring = new T.Mesh(new T.TorusGeometry(0.22, 0.025, 8, 32), std('#fff7c2', { emissive: '#fde68a', emissiveIntensity: 2.4 })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.42; ring.name = 'halo'; head.add(ring); }
  if (a.hat === 'horns') for (const s of [-1, 1]) { const c = new T.Mesh(new T.ConeGeometry(0.05, 0.2, 10), std('#7f1d1d')); c.position.set(s * 0.15, 0.25, 0.04); c.rotation.z = -s * 0.4; head.add(c); }
  if (a.hat === 'headset') { const band = new T.Mesh(new T.TorusGeometry(0.27, 0.025, 8, 24, Math.PI), std('#111827')); band.position.y = 0.02; head.add(band); for (const s of [-1, 1]) { const cup = new T.Mesh(new T.CylinderGeometry(0.08, 0.08, 0.06, 16), std('#7c5cff', { emissive: '#7c5cff', emissiveIntensity: 0.8 })); cup.rotation.z = Math.PI / 2; cup.position.set(s * 0.27, 0, 0); head.add(cup); } }
  if (a.acc === 'visor') { const v = new T.Mesh(new T.SphereGeometry(0.262, 24, 10, -0.9, 1.8, 1.25, 0.45), std('#22d3ee', { emissive: '#22d3ee', emissiveIntensity: 1.8, transparent: true, opacity: 0.85 })); head.add(v); }
  if (a.acc === 'glasses' || a.acc === 'shades') for (const s of [-1, 1]) { const l = new T.Mesh(new T.CircleGeometry(0.055, 18), a.acc === 'shades' ? std('#0b0c10', { metalness: 0.6, roughness: 0.1 }) : std('#bfdbfe', { transparent: true, opacity: 0.5 })); l.position.set(s * 0.09, 0.02, 0.248); head.add(l); }
  // arms (shoulder → elbow) and legs (hip → knee)
  const mkArm = (s) => { const sh = limb(0.075, 0.24, top, shadows); sh.position.set(s * 0.33, 0.56, 0); spine.add(sh); const el = limb(0.065, 0.22, skin, shadows); el.position.y = -0.34; sh.add(el); const hand = new T.Mesh(new T.SphereGeometry(0.07, 12, 10), skin); hand.position.y = -0.33; hand.castShadow = shadows; el.add(hand); return { sh, el }; };
  const mkLeg = (s) => { const hp = limb(0.095, 0.3, pants, shadows); hp.position.set(s * 0.12, -0.04, 0); hips.add(hp); const kn = limb(0.085, 0.3, pants, shadows); kn.position.y = -0.42; hp.add(kn); const foot = cap(0.075, 0.12, shoeM); foot.rotation.x = Math.PI / 2; foot.position.set(0, -0.44, 0.06); foot.castShadow = shadows; kn.add(foot); return { hp, kn }; };
  const L = mkArm(-1), R = mkArm(1), LL = mkLeg(-1), RL = mkLeg(1);
  if (a.acc === 'cape') { const c = new T.Mesh(new T.PlaneGeometry(0.5, 0.9, 1, 4), std('#b91c1c', { side: T.DoubleSide, roughness: 0.6 })); c.geometry.translate(0, -0.45, 0); c.position.set(0, 0.62, -0.2); c.name = 'cape'; spine.add(c); }
  if (a.acc === 'wings') for (const s of [-1, 1]) { const w = new T.Mesh(new T.CircleGeometry(0.4, 24, 0, Math.PI), std('#ffffff', { emissive: '#c7d2fe', emissiveIntensity: 0.6, side: T.DoubleSide, transparent: true, opacity: 0.9 })); w.position.set(s * 0.08, 0.45, -0.18); w.rotation.set(0, s * 0.6, s * -0.9); w.name = 'wing'; w.userData.s = s; spine.add(w); }
  if (a.aura && a.aura !== 'none') { const col = a.aura === 'fire' ? '#f97316' : a.aura === 'rainbow' ? '#e879f9' : '#fde68a'; const n = 40; const pos = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const r = 0.55 + Math.random() * 0.35; const tt = Math.random() * 6.28; pos[i * 3] = Math.cos(tt) * r; pos[i * 3 + 1] = Math.random() * 1.9; pos[i * 3 + 2] = Math.sin(tt) * r; } const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3)); const pts = new T.Points(geo, new T.PointsMaterial({ color: col, size: 0.07, transparent: true, depthWrite: false, blending: T.AdditiveBlending })); pts.name = 'aura'; pts.userData.rainbow = a.aura === 'rainbow'; g.add(pts); }
  // contact shadow blob (always, also when real shadows are off)
  const blob = new T.Mesh(new T.CircleGeometry(0.42, 24), new T.MeshBasicMaterial({ color: '#000', transparent: true, opacity: ghost ? 0 : 0.28, depthWrite: false })); blob.rotation.x = -Math.PI / 2; blob.position.y = 0.015; blob.name = 'blob'; g.add(blob);
  g.userData = { root, hips, spine, neck, head, L, R, LL, RL, phase: 0, squash: 0, lean: 0, cur: {} };
  return g;
}
// s: { speed: 0..1.5 (1 = run, >1 sprint), ground, vy, dash }
export function animateHero(g, dt, ts, s) {
  const u = g.userData; if (!u || !u.L) return; const k = 1 - Math.exp(-dt * 16); const lerp = (o, key, v) => { o[key] += (v - o[key]) * k; };
  const sp = Math.min(1.5, s.speed || 0); u.phase += dt * (5 + sp * 7) * (sp > 0.05 ? 1 : 0);
  const p = u.phase; const sw = Math.sin(p); const air = !s.ground;
  let thighL, thighR, kneeL, kneeR, armL, armR, elbL, elbR, lean, bob, armOut;
  if (air) {
    const up = s.vy > 0; thighL = up ? -1.0 : -0.35; thighR = up ? 0.25 : 0.15; kneeL = up ? 1.5 : 0.5; kneeR = up ? 0.6 : 0.35; armL = up ? -2.3 : -0.6; armR = up ? 0.6 : -0.5; elbL = 0.3; elbR = 0.5; lean = s.dash ? 0.55 : up ? 0.05 : -0.08; bob = 0; armOut = up ? 0.2 : 0.75;
  } else if (sp > 0.05) {
    const a = 0.55 + sp * 0.45; thighL = sw * a; thighR = -sw * a; kneeL = Math.max(0, -Math.cos(p)) * (0.9 + sp * 0.6) + 0.15; kneeR = Math.max(0, Math.cos(p)) * (0.9 + sp * 0.6) + 0.15;
    armL = -sw * a * 0.9; armR = sw * a * 0.9; elbL = elbR = 0.5 + sp * 0.5; lean = 0.08 + sp * 0.16; bob = Math.abs(Math.cos(p)) * 0.07 * sp; armOut = 0.12;
  } else { const br = Math.sin(ts * 2); thighL = thighR = 0; kneeL = kneeR = 0.05; armL = 0.05 + br * 0.03; armR = 0.05 - br * 0.03; elbL = elbR = 0.18; lean = 0; bob = br * 0.012; armOut = 0.08; }
  lerp(u.LL.hp.rotation, 'x', -thighL); lerp(u.RL.hp.rotation, 'x', -thighR); lerp(u.LL.kn.rotation, 'x', kneeL); lerp(u.RL.kn.rotation, 'x', kneeR);
  lerp(u.L.sh.rotation, 'x', armL); lerp(u.R.sh.rotation, 'x', armR); lerp(u.L.el.rotation, 'x', -elbL); lerp(u.R.el.rotation, 'x', -elbR); lerp(u.L.sh.rotation, 'z', -armOut); lerp(u.R.sh.rotation, 'z', armOut);
  lerp(u.spine.rotation, 'x', lean); lerp(u.hips.position, 'y', 0.92 + bob); u.spine.rotation.y = sp > 0.05 && !air ? sw * 0.12 : u.spine.rotation.y * 0.9; u.head.rotation.y = -u.spine.rotation.y * 0.7; u.head.rotation.x = -lean * 0.6;
  // landing squash / bounce stretch
  u.squash *= Math.exp(-dt * 9); const sq = u.squash; u.root.scale.set(1 + sq * 0.18, 1 - sq * 0.22, 1 + sq * 0.18);
  g.traverse((o) => { if (o.name === 'aura') { o.rotation.y = ts * 0.6; if (o.userData.rainbow) o.material.color.setHSL((ts * 0.2) % 1, 0.9, 0.65); } else if (o.name === 'wing') o.rotation.y = o.userData.s * (0.6 + Math.sin(ts * (air ? 9 : 3)) * (air ? 0.4 : 0.12)); else if (o.name === 'halo') o.position.y = 0.42 + Math.sin(ts * 2) * 0.02; else if (o.name === 'cape') o.rotation.x = 0.1 + sp * 0.5 + (air && s.vy < 0 ? 0.6 : 0) + Math.sin(ts * 5) * 0.05; });
}
export const lerpAngle = (a, b, k) => { let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI; if (d < -Math.PI) d += Math.PI * 2; return a + d * k; };

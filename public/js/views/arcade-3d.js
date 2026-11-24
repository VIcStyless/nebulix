// Arcade, part 3 (WebGL): Nebula Ops — an original first-person tactical shooter against bot squads, round after
// round — and Market Rush, a stock-market minigame that pays out in shares of a real stock.
import { h, mount, fmt, ls } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { toast, toastErr } from '../ui.js';
import { sfx } from '../sfx.js';
import { load3d, buildAvatar, animateAvatar } from '../avatar3d.js';
import { rtxPipeline, softShadows, autoTier } from '../rtx.js';
import { makeFx3d } from '../fx3d.js';

export const THREE_GAMES = [
  ['ops', 'Nebula Ops (3D)', 'target', 'First-person tactical shooter on Nebula Outpost: rifle, pistol and a scoped sniper. Works on Chromebooks too.', 'pts'],
  ['stocks', 'Market Rush', 'chart', 'Catch the green candles, dodge the red ones. Pays out in real-stock shares.', 'pts'],
];
const snd = (k) => { try { sfx[k] && sfx[k](); } catch {} };
const rnd = (a, b) => a + Math.random() * (b - a);

// ===================== NEBULA OPS =====================
// An original tactical shooter on "Nebula Outpost", a sunset desert outpost under a violet sky.
// Graphics tiers: low (Chromebooks, phones, software GL), med, high (shadows + post-processing). 'auto' picks one
// from the GPU; if the frame rate drops the game lowers the resolution and effects by itself.
const TIERS = ['auto', 'low', 'med', 'high'];
const tierName = (q) => ({ auto: t('Auto'), low: t('Low'), med: t('Medium'), high: 'RTX' }[q]);
function cvTex(THREE, size, draw, rep) { const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size); const tx = new THREE.CanvasTexture(c); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4; if (rep) tx.repeat.set(rep, rep); return tx; }
const speck = (g, S, n, rgb, a, sz = 3) => { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${rgb},${Math.random() * a})`; const s = Math.random() * sz + 1; g.fillRect(Math.random() * S, Math.random() * S, s, s); } };
// textures (procedural, drawn once per game)
function makeTextures(THREE) {
  const plaster = cvTex(THREE, 256, (g, S) => {
    g.fillStyle = '#d9c39b'; g.fillRect(0, 0, S, S); speck(g, S, 2200, '120,90,55', 0.18); speck(g, S, 900, '255,245,225', 0.25);
    const gr = g.createLinearGradient(0, S * 0.7, 0, S); gr.addColorStop(0, 'rgba(90,60,30,0)'); gr.addColorStop(1, 'rgba(90,60,30,.35)'); g.fillStyle = gr; g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(80,55,30,.35)'; g.lineWidth = 1; for (let k = 0; k < 4; k++) { g.beginPath(); let x = Math.random() * S, y = Math.random() * S; g.moveTo(x, y); for (let i = 0; i < 6; i++) { x += (Math.random() - 0.5) * 30; y += Math.random() * 14; g.lineTo(x, y); } g.stroke(); }
    g.fillStyle = 'rgba(70,50,30,.45)'; g.fillRect(0, S - 10, S, 10);
  });
  const brick = cvTex(THREE, 256, (g, S) => {
    g.fillStyle = '#8f7a63'; g.fillRect(0, 0, S, S); const bh = 16, bw = 42;
    for (let r = 0; r * bh < S; r++) for (let c = -1; c * bw < S; c++) { const x = c * bw + (r % 2 ? bw / 2 : 0); const l = 150 + Math.random() * 40; g.fillStyle = `rgb(${l},${l * 0.72},${l * 0.5})`; g.fillRect(x + 1, r * bh + 1, bw - 2, bh - 2); }
    speck(g, S, 1500, '40,25,15', 0.2, 2);
  });
  const planks = cvTex(THREE, 128, (g, S) => {
    g.fillStyle = '#9b6a3a'; g.fillRect(0, 0, S, S); for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(60,35,15,${0.1 + Math.random() * 0.15})`; g.fillRect(0, i * S / 6, S, 2); }
    speck(g, S, 500, '60,35,15', 0.2, 2); g.strokeStyle = '#5b3a1c'; g.lineWidth = 10; g.strokeRect(5, 5, S - 10, S - 10); g.beginPath(); g.moveTo(8, 8); g.lineTo(S - 8, S - 8); g.stroke();
  });
  const metal = (hex) => cvTex(THREE, 128, (g, S) => {
    g.fillStyle = hex; g.fillRect(0, 0, S, S); for (let x = 0; x < S; x += 8) { const gr = g.createLinearGradient(x, 0, x + 8, 0); gr.addColorStop(0, 'rgba(255,255,255,.12)'); gr.addColorStop(0.5, 'rgba(0,0,0,.18)'); gr.addColorStop(1, 'rgba(255,255,255,.08)'); g.fillStyle = gr; g.fillRect(x, 0, 8, S); }
    speck(g, S, 220, '110,60,20', 0.5, 4); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 0, S, 4); g.fillRect(0, S - 4, S, 4);
  });
  const ground = cvTex(THREE, 512, (g, S) => {
    g.fillStyle = '#c8a878'; g.fillRect(0, 0, S, S); speck(g, S, 9000, '120,90,50', 0.16, 3); speck(g, S, 3000, '255,240,210', 0.18, 2);
    for (let i = 0; i < 26; i++) { const x = Math.random() * S, y = Math.random() * S, r = 10 + Math.random() * 40; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(110,80,45,.18)'); gr.addColorStop(1, 'rgba(110,80,45,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  }, 14);
  const paving = cvTex(THREE, 256, (g, S) => {
    g.fillStyle = '#a99579'; g.fillRect(0, 0, S, S); const n = 4; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const l = 160 + Math.random() * 30; g.fillStyle = `rgb(${l},${l * 0.9},${l * 0.75})`; g.fillRect(i * S / n + 2, j * S / n + 2, S / n - 4, S / n - 4); }
    speck(g, S, 1200, '60,45,30', 0.18, 2);
  });
  const sky = cvTex(THREE, 512, (g, S) => {
    const gr = g.createLinearGradient(0, 0, 0, S); gr.addColorStop(0, '#1b1440'); gr.addColorStop(0.35, '#4b2f7a'); gr.addColorStop(0.5, '#c46a7a'); gr.addColorStop(0.56, '#f3b07a'); gr.addColorStop(1, '#f6d2a8'); g.fillStyle = gr; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.8})`; g.fillRect(Math.random() * S, Math.random() * S * 0.3, 1.2, 1.2); }
    for (let i = 0; i < 9; i++) { const x = Math.random() * S, y = S * (0.12 + Math.random() * 0.25), r = 40 + Math.random() * 90; const nb = g.createRadialGradient(x, y, 0, x, y, r); nb.addColorStop(0, `rgba(${150 + Math.random() * 100},90,220,.22)`); nb.addColorStop(1, 'rgba(120,80,200,0)'); g.fillStyle = nb; g.fillRect(x - r, y - r, r * 2, r * 2); }
  });
  sky.wrapS = THREE.RepeatWrapping; sky.wrapT = THREE.ClampToEdgeWrapping;
  const glow = cvTex(THREE, 128, (g, S) => { const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); gr.addColorStop(0, 'rgba(255,250,235,1)'); gr.addColorStop(0.2, 'rgba(255,220,160,.8)'); gr.addColorStop(1, 'rgba(255,170,90,0)'); g.fillStyle = gr; g.fillRect(0, 0, S, S); });
  const hole = cvTex(THREE, 64, (g, S) => { const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); gr.addColorStop(0, 'rgba(15,10,5,.95)'); gr.addColorStop(0.35, 'rgba(40,28,18,.7)'); gr.addColorStop(1, 'rgba(60,40,20,0)'); g.fillStyle = gr; g.fillRect(0, 0, S, S); });
  return { plaster, brick, planks, metal, ground, paving, sky, glow, hole };
}
// scale a BoxGeometry's UVs so textures keep the same size on every box (1 repeat per `unit` metres)
function boxUV(geo, w, hh, d, unit) {
  const uv = geo.attributes.uv; const dims = [[d, hh], [d, hh], [w, d], [w, d], [w, hh], [w, hh]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, uv.getX(i) * dims[f][0] / unit, uv.getY(i) * dims[f][1] / unit); }
  uv.needsUpdate = true; return geo;
}

function opsGame(stage, hud, end, best) {
  const box = h('div.ops'); const ov = h('div.arc-ov'); const hudIn = h('div.ops-hud');
  const cross = h('div.ops-cross'); const hit = h('div.ops-hit'); const dmg = h('div.ops-dmg'); const feed = h('div.ops-feed');
  const scope = h('div.ops-scope'); const radar = h('canvas.ops-radar', { width: 150, height: 150 }); const fpsEl = h('div.ops-fps');
  const qBtn = h('button.btn.sm.ops-rtx', { onClick: (e) => { e.stopPropagation(); const q = TIERS[(TIERS.indexOf(ls('ops.q') || 'auto') + 1) % TIERS.length]; ls('ops.q', q); paintQ(); toast(t('Graphics: {q}. Applies when you deploy again.', { q: tierName(q) }), 'info', 2500); } });
  let tierNow = null;
  const paintQ = () => { const q = ls('ops.q') || 'auto'; qBtn.textContent = t('Graphics') + ': ' + tierName(q) + (q === 'auto' && tierNow ? ' (' + tierName(tierNow) + ')' : ''); qBtn.classList.toggle('primary', (q === 'auto' ? tierNow : q) === 'high'); }; paintQ();
  box.append(hudIn, scope, cross, hit, dmg, feed, radar, fpsEl, ov, qBtn); stage.append(box);
  let cleanup = () => {};
  const help = () => h('p.tiny.muted', t('WASD move · mouse aim · click shoot · right click scope · R reload · 1/2/3 weapons · Shift walk · C crouch · Space jump · Esc pause'));
  const showOv = (title, big, sub, btn, go) => { ov.classList.remove('hide'); mount(ov, h('div.arc-ovc', h('h3', title), big != null ? h('div.arc-big', String(big)) : null, sub ? h('p.muted', sub) : null, h('button.btn.primary', { onClick: go }, btn), help())); };
  showOv(t('Nebula Ops'), null, t('Hold Nebula Outpost. Each round brings a bigger, sharper squad.'), t('Deploy'), () => start());
  mount(hud, h('span.pill', t('Best: {s}', { s: fmt.num(best) })));

  async function start() {
    ov.classList.add('hide'); mount(ov);
    let THREE; try { ({ THREE } = await load3d()); } catch (e) { showOv(t('3D is not available'), null, e.message, t('Retry'), () => start()); return; }
    const pref = ls('ops.q') || 'auto';
    let renderer = null;
    for (const opts of [{ antialias: pref !== 'low', powerPreference: pref === 'high' ? 'high-performance' : 'default' }, { antialias: false }, { antialias: false, precision: 'mediump' }]) {
      try { renderer = new THREE.WebGLRenderer(opts); break; } catch { renderer = null; }
    }
    if (!renderer) { showOv(t('3D is not available'), null, t('Your browser could not start WebGL. Turn on hardware acceleration in the browser settings (chrome://settings/system) and try again.'), t('Retry'), () => start()); return; }
    let tier = pref === 'auto' ? autoTier(renderer) : pref; tierNow = tier; paintQ();
    const shadows = tier !== 'low';
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = shadows; renderer.shadowMap.type = tier === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    let pr = tier === 'high' ? Math.min(2, devicePixelRatio || 1) : tier === 'med' ? Math.min(1.25, devicePixelRatio || 1) : Math.min(1, devicePixelRatio || 1) * 0.8;
    renderer.setPixelRatio(pr);
    box.prepend(renderer.domElement); renderer.domElement.className = 'ops-cv';
    const TX = makeTextures(THREE);
    const scene = new THREE.Scene(); const fx3 = makeFx3d(THREE, scene); const FOG = '#e7b48f'; scene.fog = new THREE.Fog(FOG, 45, 150); scene.background = new THREE.Color(FOG);
    const skyM = new THREE.Mesh(new THREE.SphereGeometry(160, 32, 16), new THREE.MeshBasicMaterial({ map: TX.sky, side: THREE.BackSide, fog: false, depthWrite: false })); skyM.renderOrder = -1; scene.add(skyM);
    const sunDir = new THREE.Vector3(-0.55, 0.32, -0.77).normalize();
    const sunSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.glow, fog: false, depthWrite: false, blending: THREE.AdditiveBlending, transparent: true })); sunSpr.scale.setScalar(38); sunSpr.position.copy(sunDir).multiplyScalar(140); scene.add(sunSpr);
    const cam = new THREE.PerspectiveCamera(74, 16 / 9, 0.05, 400); scene.add(cam);
    scene.add(new THREE.HemisphereLight('#c7b8ff', '#8a6a48', tier === 'low' ? 1.5 : 1.15));
    const sun = new THREE.DirectionalLight('#ffd9a8', tier === 'low' ? 2.2 : 3.0); sun.position.copy(sunDir).multiplyScalar(60); sun.castShadow = shadows;
    sun.shadow.mapSize.set(tier === 'high' ? 4096 : 1024, tier === 'high' ? 4096 : 1024); Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, far: 160 }); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04; scene.add(sun);
    const fill = new THREE.DirectionalLight('#7c5cff', 0.35); fill.position.set(30, 20, 40); scene.add(fill);
    // ground: sand + paved plaza in the middle
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), new THREE.MeshStandardMaterial({ map: TX.ground, roughness: 0.97 })); ground.material.map.repeat.set(30, 30); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = shadows; scene.add(ground);
    TX.paving.repeat.set(9, 9); const plaza = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), new THREE.MeshStandardMaterial({ map: TX.paving, roughness: 0.9 })); plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.01; plaza.receiveShadow = shadows; scene.add(plaza);
    const W = 34; const boxes = []; const solids = [];
    const M = {
      wall: new THREE.MeshStandardMaterial({ map: TX.plaster, roughness: 0.92 }), brick: new THREE.MeshStandardMaterial({ map: TX.brick, roughness: 0.9 }),
      crate: new THREE.MeshStandardMaterial({ map: TX.planks, roughness: 0.85 }), trim: new THREE.MeshStandardMaterial({ color: '#6b5640', roughness: 0.8 }),
      cont: ['#a8322a', '#2a5aa8', '#3f7d3a', '#c48a22'].map((c) => new THREE.MeshStandardMaterial({ map: TX.metal(c), roughness: 0.55, metalness: 0.45 })),
      neon: new THREE.MeshStandardMaterial({ color: '#2b1d52', emissive: '#a78bfa', emissiveIntensity: 2.2 }),
    };
    const solid = (x, z, w, d, hh, m, unit = 3, y0 = 0) => { const geo = boxUV(new THREE.BoxGeometry(w, hh, d), w, hh, d, unit); const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y0 + hh / 2, z); mesh.castShadow = shadows; mesh.receiveShadow = shadows; scene.add(mesh); const b = { x, z, w, d, h: y0 + hh }; boxes.push(b); solids.push(mesh); return mesh; };
    const deco = (mesh) => { mesh.castShadow = shadows; mesh.receiveShadow = shadows; scene.add(mesh); return mesh; };
    // outer walls with a coping strip
    for (const [x, z, w, d] of [[0, -W, W * 2 + 2, 1.2], [0, W, W * 2 + 2, 1.2], [-W, 0, 1.2, W * 2], [W, 0, 1.2, W * 2]]) { solid(x, z, w, d, 6, M.brick, 3); deco(new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.3, d + 0.3), M.trim)).position.set(x, 6.1, z); }
    // a small building with a doorway on each side of mid, plus a neon arch over the centre
    const house = (cx, cz, s) => {
      const w = 10, d = 8, hh = 4.2;
      solid(cx, cz - s * d / 2, w, 0.6, hh, M.wall); // back
      solid(cx - w / 2, cz, 0.6, d, hh, M.wall); solid(cx + w / 2, cz, 0.6, d, hh, M.wall);
      solid(cx - 3.2, cz + s * d / 2, 3.6, 0.6, hh, M.wall); solid(cx + 3.2, cz + s * d / 2, 3.6, 0.6, hh, M.wall); // door gap in the middle
      deco(new THREE.Mesh(boxUV(new THREE.BoxGeometry(2.8, 1.2, 0.6), 2.8, 1.2, 0.6, 3), M.wall)).position.set(cx, hh - 0.6, cz + s * d / 2);
      deco(new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.25, d + 0.4), M.trim)).position.set(cx, hh + 0.12, cz);
      deco(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.08), M.neon)).position.set(cx, hh - 1.3, cz + s * (d / 2 + 0.32));
    };
    house(-20, -18, 1); house(20, 18, -1);
    solid(-11, 0, 12, 1, 4, M.wall); solid(11, 0, 12, 1, 4, M.wall);
    for (const x of [-4.6, 4.6]) solid(x, 0, 1.2, 1.2, 5, M.brick, 2);
    deco(new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.8, 1.3), M.brick)).position.set(0, 5.2, 0);
    deco(new THREE.Mesh(new THREE.BoxGeometry(8, 0.1, 0.1), M.neon)).position.set(0, 4.75, 0.66);
    deco(new THREE.Mesh(new THREE.BoxGeometry(8, 0.1, 0.1), M.neon)).position.set(0, 4.75, -0.66);
    for (const s of [-1, 1]) {
      solid(s * 22, s * 4, 6.2, 2.6, 2.7, M.cont[0], 2.6); solid(s * 22, s * 4, 6.2, 2.6, 2.7, M.cont[3], 2.6, 2.7);
      solid(-s * 8, s * 12, 2.6, 6.2, 2.7, M.cont[1], 2.6); solid(s * 4, s * 24, 2.6, 6.2, 2.7, M.cont[2], 2.6);
      for (const [x, z] of [[4, 8], [-9, 7], [27, 12], [-26, 24], [12, 27], [-3, 16], [28, 26], [-15, 4], [14, 9]]) { const sz = Math.random() < 0.5 ? 1.4 : 1.15; solid(s * x, s * z, sz, sz, sz, M.crate, sz); if (Math.random() < 0.4) solid(s * x, s * z, sz * 0.92, sz * 0.92, sz * 0.92, M.crate, sz, sz); }
      solid(s * 2, s * 5, 1.2, 1.2, 1.2, M.crate, 1.2);
    }
    // palm-like posts and lamp posts outside the walls (decor, no collision)
    for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; const r = 44 + Math.random() * 16; const tr = deco(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 8 + Math.random() * 4, 7), M.trim)); tr.position.set(Math.cos(a) * r, 5, Math.sin(a) * r); const top = deco(new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.6, 7), new THREE.MeshStandardMaterial({ color: '#4d6b3a', roughness: 0.9 }))); top.position.set(tr.position.x, tr.position.y + 5, tr.position.z); }
    if (tier !== 'low') { const pm = new THREE.PMREMGenerator(renderer); const envS = new THREE.Scene(); envS.add(new THREE.Mesh(new THREE.SphereGeometry(50, 16, 8), new THREE.MeshBasicMaterial({ map: TX.sky, side: THREE.BackSide }))); const rt = pm.fromScene(envS, 0.04); scene.environment = rt.texture; pm.dispose(); }
    // floating dust in the light
    const dustN = tier === 'low' ? 150 : 500; const dg = new THREE.BufferGeometry(); const dp = new Float32Array(dustN * 3); for (let i = 0; i < dustN; i++) { dp[i * 3] = rnd(-W, W); dp[i * 3 + 1] = rnd(0.2, 7); dp[i * 3 + 2] = rnd(-W, W); } dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    const dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: 0.05, color: '#fff2d8', transparent: true, opacity: 0.55, depthWrite: false })); scene.add(dust);

    // ---------- weapons + viewmodel ----------
    const gun = new THREE.Group(); cam.add(gun); const GUN_REST = new THREE.Vector3(0.2, -0.2, -0.42); gun.position.copy(GUN_REST); gun.scale.setScalar(0.48);
    const gm = new THREE.MeshStandardMaterial({ color: '#232a35', roughness: 0.38, metalness: 0.75 }); const gm2 = new THREE.MeshStandardMaterial({ color: '#5a4632', roughness: 0.7 }); const accent = new THREE.MeshStandardMaterial({ color: '#7c5cff', emissive: '#7c5cff', emissiveIntensity: 1.2 });
    const part = (geo, m, x, y, z, rx = 0) => { const p = new THREE.Mesh(geo, m); p.position.set(x, y, z); p.rotation.x = rx; return p; };
    const models = {
      rifle: [part(new THREE.BoxGeometry(0.085, 0.11, 0.52), gm, 0, 0, 0), part(new THREE.BoxGeometry(0.075, 0.09, 0.34), gm2, 0, -0.01, -0.36), part(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 10), gm, 0, 0.015, -0.66, Math.PI / 2), part(new THREE.BoxGeometry(0.06, 0.2, 0.08), gm, 0, -0.14, -0.1, 0.25), part(new THREE.BoxGeometry(0.05, 0.13, 0.06), gm2, 0, -0.1, 0.13, -0.3), part(new THREE.BoxGeometry(0.07, 0.1, 0.22), gm2, 0, -0.02, 0.36), part(new THREE.BoxGeometry(0.087, 0.018, 0.36), accent, 0, 0.065, -0.05), part(new THREE.BoxGeometry(0.03, 0.05, 0.03), gm, 0, 0.08, -0.5)],
      pistol: [part(new THREE.BoxGeometry(0.07, 0.09, 0.26), gm, 0, 0.02, -0.08), part(new THREE.BoxGeometry(0.06, 0.15, 0.07), gm2, 0, -0.08, 0.02, -0.2), part(new THREE.BoxGeometry(0.072, 0.015, 0.2), accent, 0, 0.07, -0.08)],
      lance: [part(new THREE.BoxGeometry(0.08, 0.1, 0.6), gm, 0, 0, 0), part(new THREE.CylinderGeometry(0.016, 0.016, 0.55, 10), gm, 0, 0.01, -0.55, Math.PI / 2), part(new THREE.CylinderGeometry(0.035, 0.035, 0.26, 12), gm, 0, 0.1, -0.02, Math.PI / 2), part(new THREE.BoxGeometry(0.07, 0.12, 0.3), gm2, 0, -0.03, 0.38), part(new THREE.BoxGeometry(0.05, 0.13, 0.06), gm2, 0, -0.11, 0.1, -0.3), part(new THREE.BoxGeometry(0.082, 0.016, 0.3), accent, 0, 0.055, -0.15)],
    };
    const gunParts = new THREE.Group(); gun.add(gunParts);
    const flash = new THREE.PointLight('#ffcf6b', 0, 7); gun.add(flash);
    const flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.glow, color: '#ffd27a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); flashSprite.scale.setScalar(0.3); gun.add(flashSprite);
    const WEAPONS = {
      rifle: { name: t('Rifle'), mag: 30, dmg: 27, rate: 0.1, auto: true, spread: 0.011, reload: 1.9, kick: 0.012, muzzle: -0.82 },
      pistol: { name: t('Pistol'), mag: 12, dmg: 38, rate: 0.2, auto: false, spread: 0.006, reload: 1.2, kick: 0.018, muzzle: -0.24 },
      lance: { name: t('Lance (sniper)'), mag: 5, dmg: 120, rate: 1.15, auto: false, spread: 0.03, reload: 2.6, kick: 0.05, muzzle: -0.85, scope: true },
    };
    const setWeapon = (k) => { me.w = k; me.reloading = 0; me.scoped = false; gunParts.clear(); for (const p of models[k]) gunParts.add(p); flash.position.set(0, 0.02, WEAPONS[k].muzzle); flashSprite.position.set(0, 0.02, WEAPONS[k].muzzle + 0.04); for (const o of gunParts.children) o.castShadow = false; };
    const me = { x: 0, z: 28, y: 1.6, vy: 0, yaw: 0, pitch: 0, hp: 100, w: 'rifle', ammo: { rifle: 30, pistol: 12, lance: 5 }, reloading: 0, cd: 0, kick: 0, crouch: 0, scoped: false, recoil: 0, bob: 0, floor: 0 };
    setWeapon('rifle');
    let round = 0, score = 0, kills = 0, heads = 0; const t0 = performance.now(); let bots = []; let over = false; let between = 0;
    const tracers = []; const fx = []; const decals = []; let live = true;
    const botGunGeo = new THREE.BoxGeometry(0.08, 0.1, 0.55);
    function spawnRound() {
      round++; between = 0; me.hp = Math.min(100, me.hp + 50); if (round === 1) me.hp = 100;
      const n = Math.min(9, 2 + round);
      for (let i = 0; i < n; i++) {
        const av = { skin: Math.floor(rnd(0, 7)), hair: 'short', hairColor: 0, eyes: 'cool', top: 'armor', topColor: [4, 5, 7][i % 3], hat: i % 2 ? 'beanie' : 'cap', acc: 'visor', aura: 'none', pants: 7 };
        const obj = buildAvatar(av); obj.scale.setScalar(0.92); const bg = new THREE.Mesh(botGunGeo, gm); bg.position.set(0.28, 0.95, 0.32); obj.add(bg); obj.traverse((o) => { if (o.isMesh) o.castShadow = shadows; }); scene.add(obj);
        let x, z; do { x = rnd(-W + 3, W - 3); z = rnd(-W + 3, -6); } while (blocked(x, z, 0.6));
        bots.push({ obj, x, z, hp: 60 + round * 10, ry: 0, cd: rnd(1, 2.5), strafe: rnd(-1, 1), think: 0, acc: Math.min(0.6, 0.2 + round * 0.05), dead: 0, seen: 0 });
      }
      killfeed(t('Round {n} — {k} hostiles', { n: round, k: n }), '#fbbf24');
    }
    const blocked = (x, z, r = 0.4, y = 0) => { for (const b of boxes) if (y < b.h - 0.05 && Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r) return true; return false; };
    function los(ax, az, bx, bz) {
      for (const b of boxes) { if (b.h < 1.3) continue; const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2; let tmin = 0, tmax = 1; const dx = bx - ax, dz = bz - az;
        for (const [p, d, lo, hi] of [[ax, dx, x0, x1], [az, dz, z0, z1]]) { if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) { tmin = 2; break; } } else { let ta = (lo - p) / d, tb = (hi - p) / d; if (ta > tb) [ta, tb] = [tb, ta]; tmin = Math.max(tmin, ta); tmax = Math.min(tmax, tb); if (tmin > tmax) break; } }
        if (tmin <= tmax && tmin < 1 && tmax > 0) return false; }
      return true;
    }
    function killfeed(text, color) { const el = h('div', { style: color ? 'color:' + color : null }, text); feed.prepend(el); setTimeout(() => el.remove(), 4000); while (feed.children.length > 5) feed.lastChild.remove(); }
    function tracer(from, to, color) { const g = new THREE.BufferGeometry().setFromPoints([from, to]); const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, fog: false })); scene.add(l); tracers.push({ l, t: performance.now() }); }
    const sparkMat = new THREE.SpriteMaterial({ map: TX.glow, color: '#ffc06b', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const holeMat = new THREE.MeshBasicMaterial({ map: TX.hole, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }); const holeGeo = new THREE.PlaneGeometry(0.16, 0.16);
    function impact(p, n, color) {
      const k = tier === 'low' ? 3 : 7;
      for (let i = 0; i < k; i++) { const s = new THREE.Sprite(color ? new THREE.SpriteMaterial({ map: TX.glow, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }) : sparkMat); s.scale.setScalar(rnd(0.06, 0.14)); s.position.copy(p); scene.add(s); fx.push({ s, v: new THREE.Vector3(n.x + rnd(-0.8, 0.8), n.y + rnd(0, 1.2), n.z + rnd(-0.8, 0.8)).multiplyScalar(rnd(2, 4)), t: performance.now(), own: !!color }); }
      if (!color) { const d = new THREE.Mesh(holeGeo, holeMat); d.position.copy(p).addScaledVector(n, 0.01); d.lookAt(p.clone().add(n)); d.rotation.z = Math.random() * 6; scene.add(d); decals.push(d); if (decals.length > 80) scene.remove(decals.shift()); }
    }
    function shoot() {
      const W_ = WEAPONS[me.w]; if (me.reloading > 0 || me.cd > 0) return;
      if (me.ammo[me.w] <= 0) { reload(); return; }
      me.ammo[me.w]--; me.cd = W_.rate; me.kick = 1; flash.intensity = 7; flashSprite.material.opacity = 1; snd('click');
      const moving = keys.has('w') || keys.has('a') || keys.has('s') || keys.has('d') || !!touchMove;
      let spread = W_.spread * (keys.has('shift') ? 0.5 : 1) * (me.crouch > 0.5 ? 0.6 : 1) * (moving ? 1.8 : 1) * (me.y > 1.65 + me.floor ? 3 : 1);
      if (W_.scope && me.scoped) spread = moving ? 0.01 : 0.0004;
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion); dir.x += rnd(-1, 1) * spread; dir.y += rnd(-1, 1) * spread; dir.normalize();
      me.recoil = Math.min(0.12, me.recoil + W_.kick); me.pitch = Math.min(1.45, me.pitch + W_.kick * 0.6); me.yaw += rnd(-1, 1) * W_.kick * 0.3;
      const origin = cam.getWorldPosition(new THREE.Vector3());
      const ray = new THREE.Ray(origin, dir); let wallD = 300; const tmp = new THREE.Vector3(); let wallP = null; let wallB = null;
      for (const b of boxes) { const bb = new THREE.Box3(new THREE.Vector3(b.x - b.w / 2, 0, b.z - b.d / 2), new THREE.Vector3(b.x + b.w / 2, b.h, b.z + b.d / 2)); if (ray.intersectBox(bb, tmp)) { const dd = tmp.distanceTo(origin); if (dd < wallD) { wallD = dd; wallP = tmp.clone(); wallB = b; } } }
      if (dir.y < 0 && origin.y / -dir.y < wallD) { wallD = origin.y / -dir.y; wallP = origin.clone().addScaledVector(dir, wallD); wallB = null; }
      let target = null, tD = wallD, head = false;
      for (const b of bots) { if (b.dead) continue; const sc = 0.92; for (const [cy, r, isHead] of [[1.55 * sc, 0.28, true], [0.98 * sc, 0.42, false], [0.42 * sc, 0.3, false]]) { const c = new THREE.Vector3(b.x, cy, b.z); const d = ray.distanceSqToPoint(c); if (d < r * r) { const along = c.clone().sub(origin).dot(dir); if (along > 0 && along < tD) { tD = along; target = b; head = isHead; } } } }
      const end_ = origin.clone().add(dir.clone().multiplyScalar(Math.min(tD, 200)));
      tracer(origin.clone().add(new THREE.Vector3(0.18, -0.16, -0.3).applyQuaternion(cam.quaternion)), end_, me.w === 'lance' ? '#c4b5fd' : '#ffe08a');
      if (target) {
        impact(end_, dir.clone().negate(), head ? '#f472b6' : '#a78bfa');
        const dmgV = W_.dmg * (head ? 2.3 : 1); target.hp -= dmgV; fx3.text({ x: end_.x, y: end_.y + 0.25, z: end_.z }, String(Math.round(dmgV)), head ? '#f472b6' : '#ffffff', { size: head ? 0.5 : 0.36 }); hit.classList.remove('on'); void hit.offsetWidth; hit.classList.add('on'); hit.classList.toggle('hs', head);
        if (target.hp <= 0) { target.dead = performance.now(); kills++; fx3.burst({ x: target.x, y: 1.1, z: target.z }, head ? '#f472b6' : '#a78bfa', { n: 46, speed: 6 }); fx3.ring({ x: target.x, z: target.z }, '#c4b5fd', { r: 3 }); if (head) heads++; score += 100 + (head ? 60 : 0) + (me.w === 'lance' ? 40 : 0); killfeed((head ? '🎯 ' : '✖ ') + t('Hostile down') + (head ? ' — ' + t('headshot') : ''), head ? '#f472b6' : null); snd('win'); }
      } else if (wallP && wallD < 200) {
        let n = new THREE.Vector3(0, 1, 0);
        if (wallB) { const dx = (wallP.x - wallB.x) / (wallB.w / 2), dz = (wallP.z - wallB.z) / (wallB.d / 2), dy = wallP.y >= wallB.h - 0.02 ? 1 : 0; if (dy) n.set(0, 1, 0); else if (Math.abs(dx) > Math.abs(dz)) n.set(Math.sign(dx), 0, 0); else n.set(0, 0, Math.sign(dz)); }
        impact(wallP, n);
      }
      if (me.w === 'lance') { me.scoped = false; }
    }
    function reload() { const W_ = WEAPONS[me.w]; if (me.reloading > 0 || me.ammo[me.w] === W_.mag) return; me.reloading = W_.reload; me.scoped = false; killfeed(t('Reloading…')); }
    // ---------- input ----------
    const keys = new Set(); let mouseDown = false; let locked = false; let lockFailed = false; let hover = false;
    const cv = renderer.domElement;
    const onKey = (e) => {
      if (!box.isConnected) return; const k = String(e.key || '').toLowerCase(); if (!k) return;
      if (e.type === 'keydown') {
        if (over) return; if (k === 'r') reload(); if (k === '1') setWeapon('rifle'); if (k === '2') setWeapon('pistol'); if (k === '3') setWeapon('lance');
        if (k === ' ' && me.y <= 1.61 + me.floor) { me.vy = 5.4; e.preventDefault(); }
        if (['w', 'a', 's', 'd', 'c', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k) && (locked || hover)) e.preventDefault(); keys.add(k);
      } else keys.delete(k);
    };
    document.addEventListener('keydown', onKey); document.addEventListener('keyup', onKey);
    const onBlur = () => { keys.clear(); mouseDown = false; }; addEventListener('blur', onBlur);
    // aiming: pointer lock when the browser allows it; otherwise (some Chromebooks, kiosk/managed browsers, iframes)
    // the mouse aims while it is over the game, using the relative movement of the pointer.
    const sens = () => (me.scoped ? 0.0007 : 0.0022) * (Number(ls('ops.sens')) || 1);
    const onMove = (e) => { if (!(locked || drag || (lockFailed && hover))) return; let dx = e.movementX, dy = e.movementY; if (!locked && drag && !Number.isFinite(dx)) { dx = e.clientX - drag.x; dy = e.clientY - drag.y; } if (drag) { drag.x = e.clientX; drag.y = e.clientY; } if (Math.abs(dx) > 300 || Math.abs(dy) > 300) return; me.yaw -= dx * sens(); me.pitch = Math.max(-1.45, Math.min(1.45, me.pitch - dy * sens())); };
    let drag = null;
    const askLock = () => { try { const p = cv.requestPointerLock(); if (p && p.catch) p.catch(() => { lockFailed = true; }); } catch { lockFailed = true; } };
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('mouseenter', () => { hover = true; }); cv.addEventListener('mouseleave', () => { hover = false; mouseDown = false; });
    cv.addEventListener('mousedown', (e) => { if (over) return; e.preventDefault(); if (!locked) { askLock(); if (!lockFailed) drag = { x: e.clientX, y: e.clientY }; } if (e.button === 2) { if (WEAPONS[me.w].scope && me.reloading <= 0) me.scoped = !me.scoped; return; } if (e.button === 0) { mouseDown = true; shoot(); } });
    const onUp = () => { mouseDown = false; drag = null; }; document.addEventListener('mouseup', onUp); document.addEventListener('mousemove', onMove);
    const onLock = () => { locked = document.pointerLockElement === cv; if (locked) lockFailed = false; }; document.addEventListener('pointerlockchange', onLock);
    const onLockErr = () => { lockFailed = true; }; document.addEventListener('pointerlockerror', onLockErr);
    // touch: left half moves, right half aims; tap = shoot. Two-finger tap = scope.
    let touchMove = null, touchAim = null;
    cv.addEventListener('touchstart', (e) => { if (e.touches.length === 2 && WEAPONS[me.w].scope) me.scoped = !me.scoped; for (const tc of e.changedTouches) { if (tc.clientX < innerWidth / 2) touchMove = { id: tc.identifier, x: tc.clientX, y: tc.clientY, dx: 0, dy: 0 }; else { touchAim = { id: tc.identifier, x: tc.clientX, y: tc.clientY, t: performance.now() }; } } e.preventDefault(); }, { passive: false });
    cv.addEventListener('touchmove', (e) => { for (const tc of e.changedTouches) { if (touchMove && tc.identifier === touchMove.id) { touchMove.dx = (tc.clientX - touchMove.x) / 50; touchMove.dy = (tc.clientY - touchMove.y) / 50; } if (touchAim && tc.identifier === touchAim.id) { me.yaw -= (tc.clientX - touchAim.x) * 0.005; me.pitch = Math.max(-1.4, Math.min(1.4, me.pitch - (tc.clientY - touchAim.y) * 0.005)); touchAim.x = tc.clientX; touchAim.y = tc.clientY; } } e.preventDefault(); }, { passive: false });
    cv.addEventListener('touchend', (e) => { for (const tc of e.changedTouches) { if (touchMove && tc.identifier === touchMove.id) touchMove = null; if (touchAim && tc.identifier === touchAim.id) { if (performance.now() - touchAim.t < 220) shoot(); touchAim = null; } } });
    // a lost GPU context (common on low-memory Chromebooks) falls back to Low instead of a frozen black screen
    cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); if (!live) return; live = false; if ((ls('ops.q') || 'auto') !== 'low') ls('ops.q', 'low'); paintQ(); showOv(t('The graphics card stopped responding'), null, t('Graphics were switched to Low. Press Deploy to keep playing.'), t('Deploy'), () => { cleanup(); start(); }); });
    let post = null;
    const resize = () => { const w = box.clientWidth || 640; const hh = Math.round(Math.min(w * 9 / 16, innerHeight * 0.74)); box.style.height = hh + 'px'; renderer.setSize(w, hh, false); if (post) post.setSize(w, hh); cam.aspect = w / hh; cam.updateProjectionMatrix(); };
    const ro = new ResizeObserver(resize); ro.observe(box); resize();
    if (tier === 'high') { softShadows(THREE, renderer, scene, { size: 4096 }); post = await rtxPipeline(THREE, renderer, scene, cam, { bloom: 0.4, threshold: 0.88, aoRadius: 0.8 }); if (!live) { if (post) post.dispose(); return; } resize(); }
    spawnRound();
    let last = performance.now(); let raf = 0;
    // adaptive quality: if the game runs below ~30 fps it steps the resolution and effects down
    let perfT = performance.now(), perfN = 0, perfSum = 0, lowered = 0;
    function adapt(dt) {
      perfN++; perfSum += dt; const now = performance.now(); if (now - perfT < 2500) return; const avg = perfSum / perfN; perfT = now; perfN = 0; perfSum = 0;
      fpsEl.textContent = Math.round(1 / avg) + ' fps';
      if (avg > 1 / 30 && lowered < 4) {
        lowered++;
        if (post) { post.dispose(); post = null; renderer.shadowMap.type = THREE.PCFShadowMap; }
        else if (pr > 0.6) { pr = Math.max(0.55, pr * 0.8); renderer.setPixelRatio(pr); resize(); }
        else if (renderer.shadowMap.enabled) { renderer.shadowMap.enabled = false; scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; }); }
        if (lowered === 1) toast(t('Graphics lowered for smoother play'), 'info', 2500);
      }
    }
    const paintHud = () => mount(hudIn,
      h('div.ops-hp' + (me.hp < 30 ? '.low' : ''), h('span.ops-hpi', '✚'), h('b', Math.max(0, Math.ceil(me.hp))), h('i', { style: 'width:' + Math.max(0, me.hp) + '%' })),
      h('div.ops-ammo', h('b', me.reloading > 0 ? '…' : me.ammo[me.w]), h('span', ' / ' + WEAPONS[me.w].mag), h('div.ops-wsel', ['rifle', 'pistol', 'lance'].map((k, i) => h('span' + (k === me.w ? '.on' : ''), (i + 1) + ' ' + WEAPONS[k].name)))),
      h('div.ops-top', h('span.ops-round', t('Round {n}', { n: round })), h('span', '✖ ' + kills), h('span', fmt.num(score) + ' pts'), h('span', bots.filter((b) => !b.dead).length + ' ' + t('left'))),
      (!locked && lockFailed && !touchMove) ? h('div.ops-tip', t('Move the mouse over the game to aim')) : null);
    const rg = radar.getContext('2d');
    function paintRadar(now) {
      const S = 150, R = 72, sc = R / 30; rg.clearRect(0, 0, S, S); rg.save(); rg.beginPath(); rg.arc(S / 2, S / 2, R, 0, 7); rg.clip(); rg.fillStyle = 'rgba(10,8,25,.62)'; rg.fillRect(0, 0, S, S);
      rg.translate(S / 2, S / 2); rg.rotate(me.yaw); rg.fillStyle = 'rgba(214,195,155,.55)';
      for (const b of boxes) { if (b.h < 1.3) continue; rg.fillRect((b.x - me.x - b.w / 2) * sc, (b.z - me.z - b.d / 2) * sc, b.w * sc, b.d * sc); }
      for (const b of bots) { if (b.dead || now - b.seen > 1500) continue; rg.fillStyle = '#ff5c7a'; rg.beginPath(); rg.arc((b.x - me.x) * sc, (b.z - me.z) * sc, 3.4, 0, 7); rg.fill(); }
      rg.restore(); rg.fillStyle = '#a78bfa'; rg.beginPath(); rg.moveTo(S / 2, S / 2 - 7); rg.lineTo(S / 2 - 5, S / 2 + 5); rg.lineTo(S / 2 + 5, S / 2 + 5); rg.fill();
      rg.strokeStyle = 'rgba(167,139,250,.7)'; rg.lineWidth = 2; rg.beginPath(); rg.arc(S / 2, S / 2, R, 0, 7); rg.stroke();
    }
    let hudT = 0; const fwd = new THREE.Vector3();
    function frame() {
      if (!live) return; raf = requestAnimationFrame(frame);
      const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now; adapt(dt);
      me.floor = 0;
      if (!over) {
        const crouching = keys.has('c') || keys.has('control'); me.crouch += ((crouching ? 1 : 0) - me.crouch) * Math.min(1, dt * 12);
        let fx = 0, fz = 0; if (keys.has('w') || keys.has('arrowup')) fz -= 1; if (keys.has('s') || keys.has('arrowdown')) fz += 1; if (keys.has('a') || keys.has('arrowleft')) fx -= 1; if (keys.has('d') || keys.has('arrowright')) fx += 1;
        if (touchMove) { fx += Math.max(-1, Math.min(1, touchMove.dx)); fz += Math.max(-1, Math.min(1, touchMove.dy)); }
        const l = Math.hypot(fx, fz); const movingNow = l > 0;
        if (movingNow) { fx /= Math.max(1, l); fz /= Math.max(1, l); const sp = (keys.has('shift') || crouching ? 2.8 : me.scoped ? 3.2 : 6.2) * dt; const s = Math.sin(me.yaw), c = Math.cos(me.yaw); const mx = (fx * c + fz * s) * sp, mz = (-fx * s + fz * c) * sp; if (!blocked(me.x + mx, me.z, 0.4, me.y - 1.6)) me.x += mx; if (!blocked(me.x, me.z + mz, 0.4, me.y - 1.6)) me.z += mz; me.bob += dt * (keys.has('shift') || crouching ? 6 : 10); }
        me.vy -= 14 * dt; me.y += me.vy * dt; let floorY = 1.6; for (const b of boxes) if (Math.abs(me.x - b.x) < b.w / 2 + 0.3 && Math.abs(me.z - b.z) < b.d / 2 + 0.3 && me.y - 1.6 >= b.h - 0.3) floorY = Math.max(floorY, b.h + 1.6); if (me.y < floorY) { me.y = floorY; me.vy = 0; } me.floor = floorY - 1.6;
        me.cd = Math.max(0, me.cd - dt); if (me.reloading > 0) { me.reloading -= dt; if (me.reloading <= 0) { me.ammo[me.w] = WEAPONS[me.w].mag; me.reloading = 0; } }
        me.recoil = Math.max(0, me.recoil - dt * 0.4);
        if (mouseDown && WEAPONS[me.w].auto) shoot();
        for (const b of bots) {
          if (b.dead) { const p = (now - b.dead) / 600; b.obj.rotation.x = Math.min(Math.PI / 2, p * Math.PI / 2); b.obj.position.y = -Math.min(0.4, p * 0.4); continue; }
          const dx = me.x - b.x, dz = me.z - b.z; const dist = Math.hypot(dx, dz) || 0.001; const see = dist < 46 && los(b.x, b.z, me.x, me.z);
          if (see) { cam.getWorldDirection(fwd); const dot = (-dx * fwd.x - dz * fwd.z) / dist; if (dot > 0.35 || dist < 10) b.seen = now; }
          b.think -= dt; if (b.think <= 0) { b.think = rnd(0.6, 1.6); b.strafe = rnd(-1, 1); }
          let vx = 0, vz = 0; const sp = 2.6 + round * 0.15;
          if (!see || dist > 16) { vx = dx / dist; vz = dz / dist; } else if (dist < 8) { vx = -dx / dist * 0.5; vz = -dz / dist * 0.5; }
          vx += (-dz / dist) * b.strafe * 0.7; vz += (dx / dist) * b.strafe * 0.7;
          const nx = b.x + vx * sp * dt, nz = b.z + vz * sp * dt; if (!blocked(nx, b.z, 0.45)) b.x = nx; else b.strafe = -b.strafe; if (!blocked(b.x, nz, 0.45)) b.z = nz; else b.strafe = -b.strafe;
          b.ry = Math.atan2(dx, dz); b.obj.position.set(b.x, 0, b.z); b.obj.rotation.y = b.ry; animateAvatar(b.obj, now / 1000 + b.x, Math.hypot(vx, vz) > 0.2 ? 1 : 0);
          b.cd -= dt;
          if (see && b.cd <= 0) { b.cd = Math.max(0.4, rnd(0.55, 1.3) - round * 0.03); const from = new THREE.Vector3(b.x, 1.3, b.z); const hitP = Math.random() < b.acc * (keys.has('shift') ? 0.8 : 1) * (me.crouch > 0.5 ? 0.75 : 1) * (dist < 10 ? 1.2 : dist > 28 ? 0.6 : 1); const to = new THREE.Vector3(me.x + (hitP ? 0 : rnd(-1.2, 1.2)), me.y - 0.4 - (hitP ? 0 : rnd(-0.5, 0.8)), me.z + (hitP ? 0 : rnd(-1.2, 1.2))); tracer(from, to, '#ff6b6b');
            if (hitP) { me.hp -= 7 + round; fx3.kick(0.45); dmg.classList.remove('on'); void dmg.offsetWidth; dmg.classList.add('on'); snd('lose'); if (me.hp <= 0) return die(); } }
        }
        if (!bots.some((b) => !b.dead) && !between) { between = now; score += 500 * round; killfeed(t('Round cleared! +{n}', { n: 500 * round }), '#3ddc84'); }
        if (between && now - between > 2500) { for (const b of bots) scene.remove(b.obj); bots = []; spawnRound(); }
      }
      // camera, scope and viewmodel
      const eye = me.y - me.crouch * 0.5 + (me.y <= me.floor + 1.61 ? Math.sin(me.bob) * 0.035 : 0);
      cam.position.set(me.x, eye, me.z); cam.rotation.order = 'YXZ'; cam.rotation.y = me.yaw; cam.rotation.x = me.pitch;
      const fov = me.scoped ? 20 : 74; if (Math.abs(cam.fov - fov) > 0.1) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 18); cam.updateProjectionMatrix(); }
      scope.classList.toggle('on', me.scoped); cross.classList.toggle('hide', me.scoped); gun.visible = !me.scoped;
      me.kick = Math.max(0, me.kick - dt * 10);
      gun.position.set(GUN_REST.x + Math.cos(me.bob * 0.5) * 0.008, GUN_REST.y + (me.reloading > 0 ? -0.14 : 0) + Math.abs(Math.sin(me.bob * 0.5)) * 0.01, GUN_REST.z + me.kick * 0.05); gun.rotation.x = me.kick * 0.14 + (me.reloading > 0 ? -0.4 : 0);
      flash.intensity = Math.max(0, flash.intensity - dt * 90); flashSprite.material.opacity = Math.max(0, flashSprite.material.opacity - dt * 22); flashSprite.material.rotation = Math.random() * 6;
      for (let i = tracers.length - 1; i >= 0; i--) { const tr = tracers[i]; const a = (now - tr.t) / 110; if (a > 1) { scene.remove(tr.l); tr.l.geometry.dispose(); tr.l.material.dispose(); tracers.splice(i, 1); } else tr.l.material.opacity = 1 - a; }
      for (let i = fx.length - 1; i >= 0; i--) { const f = fx[i]; const a = (now - f.t) / 380; if (a > 1) { scene.remove(f.s); if (f.own) f.s.material.dispose(); fx.splice(i, 1); continue; } f.v.y -= 9 * dt; f.s.position.addScaledVector(f.v, dt); f.s.scale.multiplyScalar(0.96); }
      const dpos = dust.geometry.attributes.position; for (let i = 0; i < dustN; i += 7) { dpos.array[i * 3 + 1] += Math.sin(now / 1500 + i) * 0.002; } dpos.needsUpdate = true; dust.rotation.y += dt * 0.004;
      skyM.position.copy(cam.position); sunSpr.position.copy(cam.position).addScaledVector(sunDir, 140);
      if (now - hudT > 100) { hudT = now; paintHud(); paintRadar(now); }
      fx3.update(dt); fx3.shake(cam);
      if (post) post.render(); else renderer.render(scene, cam);
    }
    function die() {
      over = true; me.scoped = false; scope.classList.remove('on'); try { document.exitPointerLock(); } catch {} const ms = Math.round(performance.now() - t0);
      end(score, ms);
      showOv(t('Eliminated'), fmt.num(score), t('Round {r} · {k} kills · {hs} headshots', { r: round, k: kills, hs: heads }), t('Play again'), () => { cleanup(); start(); });
    }
    frame();
    cleanup = () => { fx3.dispose(); if (post) { post.dispose(); post = null; } live = false; cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onKey); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.removeEventListener('pointerlockchange', onLock); document.removeEventListener('pointerlockerror', onLockErr); removeEventListener('blur', onBlur); try { document.exitPointerLock(); } catch {} scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); for (const k of Object.keys(TX)) if (TX[k] && TX[k].dispose) TX[k].dispose(); renderer.dispose(); try { renderer.forceContextLoss(); } catch {} renderer.domElement.remove(); scope.classList.remove('on'); };
  }
  return () => { cleanup(); };
}

// ===================== MARKET RUSH =====================
// Catch green candles (+), dodge red ones (−) for 60 s. The score pays out in shares of the stock you pick.
const STOCKS = ['AAPL', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META'];
function stocksGame(stage, hud, end, best, env) {
  const cv = h('canvas.arc-canvas', { width: 640, height: 420 }); const ov = h('div.arc-ov'); stage.append(h('div.arc-board', cv, ov));
  const g = cv.getContext('2d'); let sym = STOCKS[Math.floor(Math.random() * STOCKS.length)];
  let raf = 0, alive = true, run = null;
  const pick = h('div.row.wrap', { style: 'gap:6px;justify-content:center' }, STOCKS.map((s) => h('button.btn.sm' + (s === sym ? '.primary' : ''), { onClick: (e) => { sym = s; pick.querySelectorAll('.primary').forEach((x) => x.classList.remove('primary')); e.currentTarget.classList.add('primary'); } }, s)));
  const intro = () => { ov.classList.remove('hide'); mount(ov, h('div.arc-ovc', h('h3', t('Market Rush')), h('p.muted', t('Move with the mouse, a finger or ←/→. Green candles add points, red ones take them away. 60 seconds.')), h('p.small', t('Your score is paid in shares of:')), pick, h('button.btn.primary', { onClick: begin }, t('Start')))); };
  intro();
  const keys = new Set(); const kd = (e) => { if (!stage.isConnected) return; if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { keys.add(e.key); e.preventDefault(); } }; const ku = (e) => keys.delete(e.key);
  document.addEventListener('keydown', kd); document.addEventListener('keyup', ku);
  const mv = (e) => { if (!run) return; const r = cv.getBoundingClientRect(); const x = ((e.touches ? e.touches[0].clientX : e.clientX) - r.left) / r.width * 640; run.px = Math.max(40, Math.min(600, x)); };
  cv.addEventListener('mousemove', mv); cv.addEventListener('touchmove', (e) => { mv(e); e.preventDefault(); }, { passive: false });
  function begin() {
    ov.classList.add('hide'); mount(ov);
    run = { px: 320, vx: 0, items: [], score: 0, t0: performance.now(), spawn: 0, combo: 0, last: performance.now(), line: [210], parts: [], floats: [], shake: 0, trail: [], flash: 0 };
    loop();
  }
  function loop() {
    if (!alive || !run) return; raf = requestAnimationFrame(loop);
    const now = performance.now(); const dt = Math.min(0.05, (now - run.last) / 1000); run.last = now; const el = (now - run.t0) / 1000; const left = 60 - el;
    if (keys.has('ArrowLeft')) run.px = Math.max(40, run.px - 520 * dt); if (keys.has('ArrowRight')) run.px = Math.min(600, run.px + 520 * dt);
    run.spawn -= dt; if (run.spawn <= 0) { run.spawn = Math.max(0.22, 0.6 - el * 0.006); const up = Math.random() < 0.62; run.items.push({ x: rnd(30, 610), y: -30, v: rnd(150, 230) + el * 3, up, hgt: rnd(22, 46), gold: up && Math.random() < 0.06 }); }
    for (const it of run.items) it.y += it.v * dt;
    for (const it of run.items) if (!it.done && it.y > 360 && it.y < 395 && Math.abs(it.x - run.px) < 46) { it.done = true; const col = it.gold ? '#facc15' : it.up ? '#22c55e' : '#ef4444'; for (let k = 0; k < (it.gold ? 34 : 18); k++) { const a = rnd(Math.PI, Math.PI * 2); const sp = rnd(80, it.gold ? 320 : 220); run.parts.push({ x: it.x, y: 380, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(.4, .9), t: 0, c: col, r: rnd(1.5, 3.5) }); }
      if (it.up) { run.combo++; const add = (it.gold ? 25 : 5) + Math.min(10, run.combo); run.score += add; run.floats.push({ x: it.x, y: 360, txt: '+' + add, c: col, t: 0 }); if (it.gold) run.flash = 1; snd('coin'); } else { run.combo = 0; run.score = Math.max(0, run.score - 12); run.floats.push({ x: it.x, y: 360, txt: '−12', c: col, t: 0 }); run.shake = 1; snd('lose'); } }
    run.items = run.items.filter((it) => it.y < 460 && !it.done);
    if (Math.random() < 0.3) { const lst = run.line[run.line.length - 1]; run.line.push(Math.max(40, Math.min(320, lst + rnd(-8, 8) - (run.combo > 3 ? 2 : 0)))); if (run.line.length > 160) run.line.shift(); }
    // draw (14.0: neon trading floor)
    const px0 = run.px; run.vx = (px0 - (run.lastPx ?? px0)) / Math.max(dt, .001); run.lastPx = px0; run.trail.push(px0); if (run.trail.length > 10) run.trail.shift();
    run.shake = Math.max(0, run.shake - dt * 3); run.flash = Math.max(0, run.flash - dt * 2.5);
    g.save(); if (run.shake > 0) g.translate(rnd(-1, 1) * 9 * run.shake, rnd(-1, 1) * 6 * run.shake);
    const bgG = g.createLinearGradient(0, 0, 0, 420); bgG.addColorStop(0, '#120a2a'); bgG.addColorStop(.55, '#0a0f22'); bgG.addColorStop(1, '#050812'); g.fillStyle = bgG; g.fillRect(-20, -20, 680, 460);
    // moving perspective grid floor
    g.strokeStyle = 'rgba(124,92,255,.16)'; g.lineWidth = 1; const off = (now / 30) % 28; for (let y = 300 + off; y < 420; y += 28) { g.globalAlpha = (y - 300) / 120; g.beginPath(); g.moveTo(0, y); g.lineTo(640, y); g.stroke(); } g.globalAlpha = 1;
    for (let x = -320; x <= 960; x += 64) { g.beginPath(); g.moveTo(320 + (x - 320) * .25, 300); g.lineTo(x, 420); g.stroke(); }
    // price chart with glow and area
    const pts = run.line.map((v, i) => [i * 4, v]); const area = g.createLinearGradient(0, 40, 0, 320); area.addColorStop(0, 'rgba(124,92,255,.35)'); area.addColorStop(1, 'rgba(124,92,255,0)');
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.lineTo(pts[pts.length - 1][0], 320); g.lineTo(0, 320); g.closePath(); g.fillStyle = area; g.fill();
    g.shadowColor = '#7c5cff'; g.shadowBlur = 14; g.strokeStyle = '#a78bfa'; g.lineWidth = 2.5; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
    const [lx, ly] = pts[pts.length - 1]; g.fillStyle = '#fff'; g.beginPath(); g.arc(lx, ly, 3.5 + Math.sin(now / 150) * 1.2, 0, 6.283); g.fill();
    // candles: glowing, slightly tilted, with a wick
    for (const it of run.items) { const col = it.gold ? '#facc15' : it.up ? '#22c55e' : '#ef4444'; g.save(); g.translate(it.x, it.y); g.rotate(Math.sin(now / 300 + it.x) * .06); g.shadowColor = col; g.shadowBlur = it.gold ? 26 : 16;
      g.fillStyle = col; g.fillRect(-1.5, -it.hgt / 2 - 10, 3, it.hgt + 20); const cg = g.createLinearGradient(-9, 0, 9, 0); cg.addColorStop(0, col); cg.addColorStop(.5, '#ffffff'); cg.addColorStop(1, col); g.fillStyle = cg; g.globalAlpha = .9; g.beginPath(); g.roundRect(-9, -it.hgt / 2, 18, it.hgt, 4); g.fill(); g.globalAlpha = 1;
      if (it.gold) { g.fillStyle = '#fff'; g.font = '900 12px system-ui'; g.textAlign = 'center'; g.fillText('★', 0, 4); } g.restore(); }
    g.shadowBlur = 0;
    // paddle: light trail, glow and a tilt in the direction it moves
    run.trail.forEach((x, i) => { g.fillStyle = `rgba(124,92,255,${(i / run.trail.length) * .18})`; g.beginPath(); g.roundRect(x - 46, 380, 92, 16, 8); g.fill(); });
    g.save(); g.translate(px0, 388); g.rotate(Math.max(-.12, Math.min(.12, run.vx / 6000))); g.shadowColor = run.combo > 4 ? '#22d3ee' : '#7c5cff'; g.shadowBlur = 20 + Math.min(20, run.combo * 2);
    const pg = g.createLinearGradient(-46, 0, 46, 0); pg.addColorStop(0, '#7c5cff'); pg.addColorStop(1, run.combo > 4 ? '#22d3ee' : '#c084fc'); g.fillStyle = pg; g.beginPath(); g.roundRect(-46, -8, 92, 16, 8); g.fill();
    g.shadowBlur = 0; g.fillStyle = '#fff'; g.font = '800 12px system-ui'; g.textAlign = 'center'; g.fillText(sym, 0, 4); g.restore(); g.textAlign = 'left';
    // sparks
    for (const p of run.parts) { p.t += dt; p.vy += 520 * dt; p.x += p.vx * dt; p.y += p.vy * dt; const k = 1 - p.t / p.life; if (k <= 0) continue; g.globalAlpha = k; g.fillStyle = p.c; g.shadowColor = p.c; g.shadowBlur = 8; g.beginPath(); g.arc(p.x, p.y, p.r * k + .5, 0, 6.283); g.fill(); }
    run.parts = run.parts.filter((p) => p.t < p.life); g.shadowBlur = 0; g.globalAlpha = 1;
    // floating points
    for (const fl of run.floats) { fl.t += dt; const k = fl.t / .9; if (k >= 1) continue; g.globalAlpha = 1 - k; g.fillStyle = fl.c; g.font = `900 ${18 + (1 - k) * 6}px system-ui`; g.textAlign = 'center'; g.fillText(fl.txt, fl.x, fl.y - k * 50); }
    run.floats = run.floats.filter((x) => x.t < .9); g.globalAlpha = 1; g.textAlign = 'left';
    g.restore();
    if (run.flash > 0) { g.fillStyle = `rgba(250,204,21,${run.flash * .22})`; g.fillRect(0, 0, 640, 420); }
    if (run.shake > .4) { g.fillStyle = `rgba(239,68,68,${(run.shake - .4) * .3})`; g.fillRect(0, 0, 640, 420); }
    // HUD: score, timer ring, combo bar
    g.fillStyle = '#fff'; g.font = '900 24px system-ui'; g.shadowColor = '#7c5cff'; g.shadowBlur = 12; g.fillText(fmt.num(run.score) + ' pts', 16, 34); g.shadowBlur = 0;
    g.strokeStyle = 'rgba(255,255,255,.15)'; g.lineWidth = 5; g.beginPath(); g.arc(606, 32, 18, 0, 6.283); g.stroke(); g.strokeStyle = left < 10 ? '#ef4444' : '#22d3ee'; g.beginPath(); g.arc(606, 32, 18, -Math.PI / 2, -Math.PI / 2 + 6.283 * Math.max(0, left / 60)); g.stroke();
    g.fillStyle = '#fff'; g.font = '800 12px system-ui'; g.textAlign = 'center'; g.fillText(String(Math.max(0, Math.ceil(left))), 606, 36); g.textAlign = 'left';
    g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(16, 46, 160, 6); const cb = g.createLinearGradient(16, 0, 176, 0); cb.addColorStop(0, '#7c5cff'); cb.addColorStop(1, '#22d3ee'); g.fillStyle = cb; g.fillRect(16, 46, 160 * Math.min(1, run.combo / 10), 6);
    g.fillStyle = '#94a3b8'; g.font = '700 12px system-ui'; g.fillText('combo ×' + run.combo, 16, 68);
    mount(hud, h('span.pill', sym), h('span.pill', t('Score: {s}', { s: run.score })), h('span.pill', t('Best: {s}', { s: Math.max(best, run.score) })));
    if (left <= 0) finish();
  }
  async function finish() {
    cancelAnimationFrame(raf); const sc = run.score; const ms = Math.round(performance.now() - run.t0); run = null;
    end(sc, ms);
    let payout = null; try { payout = await api.post('/api/invest/game', { sym, score: sc, ms }); } catch (e) { toastErr(e); }
    ov.classList.remove('hide');
    mount(ov, h('div.arc-ovc', h('h3', t('Market closed')), h('div.arc-big', fmt.num(sc)),
      payout && payout.shares ? h('p', t('You earned {q} shares of {s} (worth {v} coins). They are in your portfolio.', { q: payout.shares, s: sym, v: fmt.coins(payout.value) })) : h('p.muted', payout && payout.capped ? t('Daily share reward limit reached — come back tomorrow.') : t('No shares this time.')),
      h('div.row', { style: 'gap:8px;justify-content:center' }, h('button.btn.primary', { onClick: begin }, t('Play again')), h('button.btn', { onClick: () => { history.replaceState(history.state, '', '#/invest'); dispatchEvent(new HashChangeEvent('hashchange')); } }, t('Open portfolio')))));
  }
  return () => { alive = false; cancelAnimationFrame(raf); document.removeEventListener('keydown', kd); document.removeEventListener('keyup', ku); };
}

export const THREE_FNS = { ops: opsGame, stocks: stocksGame };

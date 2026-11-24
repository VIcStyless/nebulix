// 3D Casino (optional): walk around a casino hall with your 3D avatar, see who else is there and what they are
// playing, chat with bubbles, and sit at any table to play. Bets use the normal provably-fair casino.
import { h, mount, fmt, ls, parseCoins } from '../util.js';
import { t } from '../i18n.js';
import { api, ws } from '../api.js';
import { S, bus } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, emptyState } from '../ui.js';
import { load3d, buildAvatar, animateAvatar } from '../avatar3d.js';
import { rtxPipeline, softShadows } from '../rtx.js';
import { makeFx3d, motes, damp } from '../fx3d.js';
import { sfx } from '../sfx.js';

const STATIONS = [
  // id (casino game or special), label, x, z, w, d (footprint), kind
  ['slots', 'Slots', -16, -8, 12, 2.2, 'slots'],
  ['roulette', 'Roulette', -6, -14, 5, 3.4, 'roulette'],
  ['blackjack', 'Blackjack', 6, -14, 5.4, 3, 'blackjack'],
  ['crash', 'Crash', 17, -10, 5, 1.5, 'screen'],
  ['plinko', 'Plinko', 17, 0, 3.6, 1.4, 'plinko'],
  ['mines', 'Mines', -6, -3, 3.4, 3.4, 'table'],
  ['dice', 'Dice', 6, -3, 3.4, 3.4, 'table'],
  ['coinflip', 'Coinflip', 0, 6, 2.4, 2.4, 'podium'],
  ['jackpot', 'Jackpot', 0, -22, 6, 3, 'vault'],
  ['bar', 'Bar', -18, 8, 8, 2.4, 'bar'],
  // 13.8: the new card tables
  ['baccarat', 'Baccarat', -6, 15, 5, 3, 'blackjack'],
  ['hilo', 'Hi-Lo', 7, 15, 3.4, 3.4, 'table'],
  ['videopoker', 'Video Poker', 18, 12, 4, 1.5, 'screen'],
];
const GAME_LABEL = Object.fromEntries(STATIONS.map((s) => [s[0], s[1]]));
const HALF = 26;

export default {
  full: true,
  title: () => t('3D Casino'),
  async mount(root, ctx) {
    const wrap = h('div.c3d'); mount(root, wrap, loading(t('Opening the doors of the casino…')));
    let THREE;
    try { ({ THREE } = await load3d()); } catch (e) { mount(wrap, emptyState('alert', t('3D is not available'), e.message)); return () => {}; }
    const test = document.createElement('canvas'); if (!(test.getContext('webgl2') || test.getContext('webgl'))) { mount(wrap, emptyState('alert', t('Your browser has WebGL turned off'), t('Turn on hardware acceleration to enter the 3D casino. The normal casino still works.'), h('button.btn.primary', { onClick: () => ctx.go('casino') }, t('Open the casino')))); return () => {}; }

    let rtx = ls('c3d.rtx') !== false; let alive = true;
    // ---------- renderer ----------
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#07060f'); scene.fog = new THREE.Fog('#0b0818', 34, 80);
    const fx3 = makeFx3d(THREE, scene); const dust3 = motes(THREE, scene, { count: 320, area: 56, height: 9, color: '#ffe7b0', size: 0.06 }); const camS = { x: 0, y: 3, z: 8, ready: false };
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 140);
    const canvasHost = h('div.c3d-canvas'); canvasHost.appendChild(renderer.domElement);
    const hud = h('div.c3d-hud'); const prompt = h('div.c3d-prompt'); prompt.style.display = 'none';
    const chatIn = h('input.input.c3d-chat', { maxlength: 90, placeholder: t('Say something… (Enter)'), onKeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') { const v = chatIn.value.trim(); if (v) { ws.send({ t: 'c3d_say', text: v }); bubble(meId, v); } chatIn.value = ''; chatIn.blur(); } if (e.key === 'Escape') chatIn.blur(); } });
    const emotes = h('div.c3d-emotes', ['👋', '🎉', '😂', '🔥', '💸', '😭'].map((e) => h('button', { type: 'button', onClick: () => { ws.send({ t: 'c3d_emote', e }); bubble(meId, e, true); } }, e)));
    const rtxBtn = h('button.btn.sm', { onClick: () => { rtx = !rtx; ls('c3d.rtx', rtx); applyQuality(); paintTop(); } });
    const countEl = h('span.pill');
    const top = h('div.c3d-top', h('button.btn.sm', { onClick: () => ctx.go('casino') }, icon('back', 14), t('Classic casino')), h('b.grow', t('3D Casino')), countEl, h('span.coin', fmt.coins(S.me.coins)), rtxBtn, h('button.btn.sm', { onClick: () => ctx.go('avatar') }, icon('user', 14), t('Avatar')));
    const help = h('div.c3d-help.tiny', t('WASD / arrows to walk · drag to look · E to play · Enter to chat'));
    const joy = h('div.c3d-joy', h('i')); // mobile joystick
    const overlay = h('div.c3d-ov'); overlay.style.display = 'none';
    mount(wrap, canvasHost, top, hud, prompt, h('div.c3d-bottom', chatIn, emotes), help, joy, overlay);
    const paintTop = () => { rtxBtn.textContent = rtx ? 'RTX ON' : 'RTX OFF'; rtxBtn.classList.toggle('primary', rtx); countEl.textContent = t('{n} here', { n: players.size + 1 }); };

    // ---------- lights ----------
    const hemi = new THREE.HemisphereLight('#c7d2fe', '#3b2a5c', 1.6); scene.add(hemi); scene.add(new THREE.AmbientLight('#ffffff', 0.35));
    const sun = new THREE.DirectionalLight('#ffe8c7', 2.2); sun.position.set(10, 22, 8); sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 60 }); scene.add(sun);
    const pointLights = [];
    for (const [x, z, c] of [[-14, -10, '#ff3cac'], [14, -10, '#22d3ee'], [0, -20, '#facc15'], [-14, 6, '#7c5cff'], [14, 6, '#3ddc84'], [0, 0, '#ffffff']]) { const l = new THREE.PointLight(c, 90, 26, 1.4); l.position.set(x, 7, z); scene.add(l); pointLights.push(l); }

    // ---------- textures (canvas) ----------
    const canvasTex = (w, h_, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h_; const g = c.getContext('2d'); draw(g, w, h_); const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4; return tx; };
    const carpet = canvasTex(512, 512, (g, w) => { g.fillStyle = '#2a0f2f'; g.fillRect(0, 0, w, w); for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) { g.fillStyle = (i + j) % 2 ? '#3b1342' : '#22102a'; g.beginPath(); g.arc(i * 32 + 16, j * 32 + 16, 10, 0, 7); g.fill(); g.strokeStyle = '#f5b84a33'; g.strokeRect(i * 32, j * 32, 32, 32); } });
    carpet.wrapS = carpet.wrapT = THREE.RepeatWrapping; carpet.repeat.set(10, 10);
    // 8.4: richer art-deco carpet (fans and diamonds), wood grain and felt, all drawn on canvases (no downloads)
    const deco = canvasTex(512, 512, (g, w) => {
      g.fillStyle = '#2b0d2e'; g.fillRect(0, 0, w, w);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const cx = i * 128 + 64, cy = j * 128 + 64;
        g.save(); g.translate(cx, cy);
        for (let r = 58; r > 8; r -= 10) { g.strokeStyle = r % 20 ? 'rgba(245,184,74,.55)' : 'rgba(124,58,237,.6)'; g.lineWidth = 3; g.beginPath(); g.arc(0, 26, r, Math.PI, 2 * Math.PI); g.stroke(); }
        g.fillStyle = '#5b1d4f'; g.beginPath(); g.moveTo(0, -60); g.lineTo(18, -40); g.lineTo(0, -20); g.lineTo(-18, -40); g.closePath(); g.fill();
        g.restore();
      }
      const n = g.getImageData(0, 0, w, w); for (let k = 0; k < n.data.length; k += 4) { const v = (Math.random() - 0.5) * 18; n.data[k] += v; n.data[k + 1] += v; n.data[k + 2] += v; } g.putImageData(n, 0, 0);
    });
    deco.wrapS = deco.wrapT = THREE.RepeatWrapping; deco.repeat.set(9, 9);
    const wood = canvasTex(256, 256, (g, w) => {
      g.fillStyle = '#4a2c14'; g.fillRect(0, 0, w, w);
      for (let y = 0; y < w; y += 2) { const v = Math.sin(y * 0.09) * 10 + Math.sin(y * 0.31) * 6 + (Math.random() - 0.5) * 10; g.fillStyle = `rgba(${v > 0 ? '255,210,160' : '20,8,0'},${Math.min(0.18, Math.abs(v) / 90)})`; g.fillRect(0, y, w, 2); }
    });
    wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
    const feltTex = canvasTex(256, 256, (g, w) => { g.fillStyle = '#808080'; g.fillRect(0, 0, w, w); const n = g.getImageData(0, 0, w, w); for (let k = 0; k < n.data.length; k += 4) { const v = 128 + (Math.random() - 0.5) * 50; n.data[k] = n.data[k + 1] = n.data[k + 2] = v; } g.putImageData(n, 0, 0); });
    feltTex.wrapS = feltTex.wrapT = THREE.RepeatWrapping; feltTex.repeat.set(3, 2);
    const glowTex = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
    const halo = (x, y, z, color, size = 2.2, parent = scene) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85 })); sp.position.set(x, y, z); sp.scale.set(size, size, 1); parent.add(sp); return sp; };
    const label = (text, color = '#fff', bg = 'rgba(0,0,0,.55)', scale = 1) => {
      const c = document.createElement('canvas'); const g = c.getContext('2d'); g.font = '700 44px system-ui, sans-serif'; const w = Math.ceil(g.measureText(text).width) + 40; c.width = w; c.height = 72;
      g.font = '700 44px system-ui, sans-serif'; g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, w, 72, 30); g.fill(); g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 20, 38);
      const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, depthWrite: false, transparent: true })); sp.scale.set((w / 72) * 0.42 * scale, 0.42 * scale, 1); sp.renderOrder = 10; return sp;
    };
    const M = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.5, metalness: 0.1 }, o));
    const add = (geo, mat, x, y, z, parent = scene) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };

    // ---------- hall ----------
    const floorMat = M('#ffffff', { map: deco, roughness: 0.82 });
    const floor = add(new THREE.PlaneGeometry(HALF * 2 + 4, HALF * 2 + 4), floorMat, 0, 0, 0); floor.rotation.x = -Math.PI / 2;
    // polished marble walkway (reflective in RTX mode through the environment map)
    const marble = M('#3d3552', { roughness: 0.12, metalness: 0.3 });
    const walk = add(new THREE.PlaneGeometry(6, HALF * 2), marble, 0, 0.01, 0); walk.rotation.x = -Math.PI / 2;
    const wallM = M('#2a1f4d', { roughness: 0.85 });
    for (const [x, z, w, r] of [[0, -HALF - 1, HALF * 2 + 4, 0], [0, HALF + 1, HALF * 2 + 4, 0], [-HALF - 1, 0, HALF * 2 + 4, Math.PI / 2], [HALF + 1, 0, HALF * 2 + 4, Math.PI / 2]]) {
      const wl = add(new THREE.BoxGeometry(w, 10, 0.6), wallM, x, 5, z); wl.rotation.y = r;
      const strip = add(new THREE.BoxGeometry(w, 0.12, 0.1), M('#ff3cac', { emissive: '#ff3cac', emissiveIntensity: 2.2 }), x, 6.5, z); strip.rotation.y = r;
      const strip2 = add(new THREE.BoxGeometry(w, 0.08, 0.1), M('#22d3ee', { emissive: '#22d3ee', emissiveIntensity: 2 }), x, 1.2, z); strip2.rotation.y = r;
    }
    const ceil = add(new THREE.PlaneGeometry(HALF * 2 + 4, HALF * 2 + 4), M('#0b0716', { roughness: 1 }), 0, 10, 0); ceil.rotation.x = Math.PI / 2;
    // coffered ceiling: a grid of gold beams and a soft glowing cove in every square
    const gold = M('#c9973c', { metalness: 1, roughness: 0.28 });
    for (let k = -HALF; k <= HALF; k += 6.5) { add(new THREE.BoxGeometry(HALF * 2 + 2, 0.35, 0.3), gold, 0, 9.8, k); add(new THREE.BoxGeometry(0.3, 0.35, HALF * 2 + 2), gold, k, 9.8, 0); }
    const cove = M('#2a1650', { emissive: '#6d3fd6', emissiveIntensity: 0.55, roughness: 1 });
    for (let i = -HALF + 3.25; i < HALF; i += 6.5) for (let j = -HALF + 3.25; j < HALF; j += 6.5) { const c = add(new THREE.PlaneGeometry(5.6, 5.6), cove, i, 9.95, j); c.rotation.x = Math.PI / 2; c.castShadow = false; }
    // wall panels with gold mouldings and warm sconces
    for (const [axis, sgn] of [['z', -1], ['z', 1], ['x', -1], ['x', 1]]) {
      for (let k = -HALF + 3; k < HALF - 1; k += 6) {
        const px = axis === 'z' ? k : sgn * (HALF + 0.65); const pz = axis === 'z' ? sgn * (HALF + 0.65) : k; const ry = axis === 'z' ? 0 : Math.PI / 2;
        const panel = add(new THREE.BoxGeometry(4.6, 3.4, 0.08), M('#3a2766', { roughness: 0.6, metalness: 0.15 }), px, 3.4, pz); panel.rotation.y = ry;
        for (const [dy, hh] of [[1.75, 0.08], [-1.75, 0.08]]) { const tr = add(new THREE.BoxGeometry(4.8, hh, 0.12), gold, px, 3.4 + dy, pz); tr.rotation.y = ry; }
        const sx = axis === 'z' ? k + 3 : px - sgn * 0.25; const sz = axis === 'z' ? pz - sgn * 0.25 : k + 3;
        if (Math.abs((axis === 'z' ? sx : sz)) < HALF - 1) { add(new THREE.CylinderGeometry(0.16, 0.08, 0.5, 12), M('#fde68a', { emissive: '#f59e0b', emissiveIntensity: 2.4 }), sx, 4.6, sz).castShadow = false; halo(sx, 4.75, sz, '#ffcc66', 1.8); }
      }
    }
    for (const [x, z] of [[-10, -6], [10, -6], [-10, 10], [10, 10], [-10, -18], [10, -18]]) { add(new THREE.CylinderGeometry(0.5, 0.6, 10, 16), M('#2a1d4a', { metalness: 0.6, roughness: 0.3 }), x, 5, z); add(new THREE.TorusGeometry(0.62, 0.06, 8, 30), M('#f5b84a', { emissive: '#f5b84a', emissiveIntensity: 1.5, metalness: 1 }), x, 3, z).rotation.x = Math.PI / 2; }
    // chandeliers
    const chand = [];
    for (const [x, z] of [[0, -10], [0, 4]]) { const g = new THREE.Group(); g.position.set(x, 8.4, z); scene.add(g); add(new THREE.TorusGeometry(2, 0.08, 8, 40), M('#f5b84a', { metalness: 1, roughness: 0.2 }), 0, 0, 0, g).rotation.x = Math.PI / 2; for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; add(new THREE.SphereGeometry(0.14, 10, 8), M('#fff7d6', { emissive: '#ffe9a8', emissiveIntensity: 3 }), Math.cos(a) * 2, -0.3, Math.sin(a) * 2, g); } chand.push(g); }
    for (const [x, z] of [[0, -10], [0, 4]]) { halo(x, 8.1, z, '#ffe4a8', 5.5); halo(x, 8.1, z, '#c084fc', 9); }
    // entrance sign
    const sign = label('NEBULIX CASINO', '#f5b84a', 'rgba(20,8,30,.85)', 3.4); sign.position.set(0, 8.2, HALF - 1); scene.add(sign);

    // ---------- stations ----------
    const colliders = []; const anim = [];
    // floating dust in the light (cheap: one Points object)
    { const n = 700; const geo = new THREE.BufferGeometry(); const pos = new Float32Array(n * 3); for (let k = 0; k < n; k++) { pos[k * 3] = (Math.random() - 0.5) * HALF * 2; pos[k * 3 + 1] = Math.random() * 9 + 0.3; pos[k * 3 + 2] = (Math.random() - 0.5) * HALF * 2; } geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const dust = new THREE.Points(geo, new THREE.PointsMaterial({ map: glowTex, color: '#ffe9c4', size: 0.09, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending })); scene.add(dust);
      anim.push((tt) => { dust.rotation.y = tt * 0.01; dust.position.y = Math.sin(tt * 0.3) * 0.15; }); }
    const stationLabel = (txt, x, y, z) => { const l = label(txt, '#ffffff', 'rgba(124,92,255,.85)', 1.3); l.position.set(x, y, z); scene.add(l); };
    for (const [id, name, x, z, w, d, kind] of STATIONS) {
      colliders.push({ id, x, z, w: w + 0.4, d: d + 0.4 });
      const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
      if (kind === 'slots') {
        for (let i = 0; i < 6; i++) {
          const mx = -w / 2 + 1 + i * (w - 2) / 5;
          add(new THREE.BoxGeometry(1.4, 2.4, 1.2), M('#4c1d95', { metalness: 0.5, roughness: 0.3 }), mx, 1.2, 0, g);
          const SYM = ['🍒', '💎', '7️⃣', '🔔', '🍋', '⭐', '🍀', '💰'];
          const reels = [0, 1, 2].map((rI) => { const tx = canvasTex(64, 512, (c) => { const gr = c.createLinearGradient(0, 0, 64, 0); gr.addColorStop(0, '#d9d9d9'); gr.addColorStop(0.5, '#ffffff'); gr.addColorStop(1, '#d9d9d9'); c.fillStyle = gr; c.fillRect(0, 0, 64, 512); c.font = '42px serif'; c.textAlign = 'center'; for (let k = 0; k < 8; k++) c.fillText(SYM[(k * 3 + rI + i) % 8], 32, k * 64 + 48); }); tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(1, 0.375); return tx; });
          reels.forEach((tx, rI) => add(new THREE.PlaneGeometry(0.34, 0.6), new THREE.MeshBasicMaterial({ map: tx }), mx - 0.37 + rI * 0.37, 1.72, 0.61, g));
          const spin = { until: 0, speed: [0, 0, 0] };
          anim.push((tt) => { if (tt > spin.until + 3 + (i % 3)) { spin.until = tt + 1.6; spin.speed = [6 + Math.random() * 3, 7 + Math.random() * 3, 8 + Math.random() * 3]; }
            reels.forEach((tx, rI) => { const left = spin.until + rI * 0.35 - tt; if (left > 0) tx.offset.y = (tx.offset.y + spin.speed[rI] * 0.016) % 1; else tx.offset.y = Math.round(tx.offset.y * 8) / 8; }); });
          add(new THREE.BoxGeometry(1.2, 0.04, 0.1), M('#f5b84a', { metalness: 1, roughness: 0.2 }), mx, 2.03, 0.62, g);
          const top_ = add(new THREE.BoxGeometry(1.4, 0.3, 1.2), M('#f5b84a', { emissive: '#f59e0b', emissiveIntensity: 1.4 }), mx, 2.55, 0, g); anim.push((t) => { top_.material.emissiveIntensity = 1 + Math.sin(t * 5 + i) * 0.8; });
          add(new THREE.CylinderGeometry(0.06, 0.06, 0.8), M('#e5e7eb', { metalness: 1, roughness: 0.2 }), mx + 0.78, 1.6, 0.2, g);
        }
        stationLabel(name, x, 3.4, z);
      } else if (kind === 'roulette' || kind === 'blackjack' || kind === 'table') {
        const felt = M(kind === 'roulette' ? '#1f7a4d' : kind === 'blackjack' ? '#1d6b3c' : '#2a4a9a', { roughness: 0.95, map: feltTex });
        const tbl = add(new THREE.BoxGeometry(w, 0.9, d), M('#ffffff', { map: wood, roughness: 0.35, metalness: 0.05 }), 0, 0.45, 0, g);
        add(new THREE.BoxGeometry(w + 0.12, 0.12, d + 0.12), M('#2b1a0c', { roughness: 0.3 }), 0, 0.92, 0, g); // padded rail
        halo(x, 3.6, z, '#fff1c4', 3.4);
        add(new THREE.BoxGeometry(w - 0.3, 0.06, d - 0.3), felt, 0, 0.93, 0, g); void tbl;
        if (kind === 'roulette') {
          const wheel = new THREE.Group(); wheel.position.set(-w / 2 + 1.2, 1.05, 0); g.add(wheel);
          add(new THREE.CylinderGeometry(0.9, 0.95, 0.18, 37), M('#7f1d1d', { metalness: 0.4, roughness: 0.3 }), 0, 0, 0, wheel);
          for (let i = 0; i < 37; i++) { const a = (i / 37) * Math.PI * 2; add(new THREE.BoxGeometry(0.12, 0.02, 0.36), M(i === 0 ? '#16a34a' : i % 2 ? '#dc2626' : '#111'), Math.cos(a) * 0.72, 0.1, Math.sin(a) * 0.72, wheel).rotation.y = -a; }
          add(new THREE.ConeGeometry(0.12, 0.3, 8), M('#f5b84a', { metalness: 1, roughness: 0.2 }), 0, 0.22, 0, wheel);
          const ball = add(new THREE.SphereGeometry(0.06, 10, 8), M('#ffffff', { roughness: 0.1 }), 0.6, 0.16, 0, wheel);
          anim.push((t) => { wheel.rotation.y = t * 0.9; ball.position.set(Math.cos(-t * 2.4) * 0.62, 0.16, Math.sin(-t * 2.4) * 0.62); });
        }
        if (kind === 'blackjack') for (let i = 0; i < 5; i++) { const card = add(new THREE.BoxGeometry(0.3, 0.01, 0.42), M('#ffffff'), -1.4 + i * 0.7, 0.97, 0.4, g); card.rotation.y = (i - 2) * 0.12; }
        // chips
        for (let i = 0; i < 6; i++) add(new THREE.CylinderGeometry(0.12, 0.12, 0.05 + i * 0.03, 16), M(['#ef4444', '#3b82f6', '#22c55e', '#f5b84a', '#a855f7', '#111'][i]), (i - 2.5) * 0.35, 1.0 + i * 0.015, -d / 2 + 0.5, g);
        // stools
        for (let i = 0; i < 4; i++) add(new THREE.CylinderGeometry(0.28, 0.22, 0.75, 14), M('#7c2d12', { roughness: 0.5 }), (i - 1.5) * (w / 4), 0.38, d / 2 + 0.6, g);
        stationLabel(name, x, 2.6, z);
      } else if (kind === 'screen') {
        add(new THREE.BoxGeometry(w, 3.2, 0.3), M('#111827', { metalness: 0.6, roughness: 0.3 }), 0, 2.6, 0, g);
        const cv = document.createElement('canvas'); cv.width = 512; cv.height = 320; const cg = cv.getContext('2d'); const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace;
        add(new THREE.PlaneGeometry(w - 0.3, 2.9), new THREE.MeshBasicMaterial({ map: tx }), 0, 2.6, 0.16, g);
        let last = 0;
        anim.push((t) => { if (t - last < 0.1) return; last = t; const p = (t % 8) / 8; const m = Math.pow(1.0, 1) * Math.exp(p * 2.4); cg.fillStyle = '#0b0c14'; cg.fillRect(0, 0, 512, 320); cg.strokeStyle = '#3ddc84'; cg.lineWidth = 6; cg.beginPath(); for (let i = 0; i <= 60 * p; i++) { const q = i / 60; cg.lineTo(20 + q * 470, 300 - (Math.exp(q * 2.4) - 1) * 26); } cg.stroke(); cg.fillStyle = p > 0.92 ? '#ef4444' : '#fff'; cg.font = '800 72px system-ui'; cg.fillText(p > 0.92 ? 'CRASH' : m.toFixed(2) + '×', 40, 100); tx.needsUpdate = true; });
        stationLabel(name, x, 4.8, z);
      } else if (kind === 'plinko') {
        add(new THREE.BoxGeometry(w, 4, 0.3), M('#1e1b4b', { metalness: 0.3 }), 0, 2.2, 0, g);
        for (let r = 0; r < 8; r++) for (let c = 0; c <= r; c++) add(new THREE.SphereGeometry(0.06, 8, 6), M('#e5e7eb', { emissive: '#94a3b8', emissiveIntensity: 0.6 }), (c - r / 2) * 0.38, 3.8 - r * 0.38, 0.2, g);
        const ballP = add(new THREE.SphereGeometry(0.1, 12, 10), M('#f472b6', { emissive: '#f472b6', emissiveIntensity: 1.2 }), 0, 3.9, 0.25, g);
        anim.push((t) => { const p = (t % 3) / 3; ballP.position.set(Math.sin(t * 7) * p * 0.9, 3.9 - p * 3.2, 0.25); });
        stationLabel(name, x, 4.8, z);
      } else if (kind === 'podium') {
        add(new THREE.CylinderGeometry(1.1, 1.3, 0.9, 32), M('#312e81', { metalness: 0.6, roughness: 0.25 }), 0, 0.45, 0, g);
        const c = add(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 40), M('#facc15', { metalness: 1, roughness: 0.15, emissive: '#7c5a00', emissiveIntensity: 0.4 }), 0, 1.8, 0, g); anim.push((t) => { c.rotation.x = t * 4; c.position.y = 1.8 + Math.abs(Math.sin(t * 2)) * 0.4; });
        stationLabel(name, x, 3.0, z);
      } else if (kind === 'vault') {
        add(new THREE.BoxGeometry(w, 4.5, d), M('#1f2937', { metalness: 0.7, roughness: 0.3 }), 0, 2.25, 0, g);
        const ring = add(new THREE.TorusGeometry(1.4, 0.16, 16, 48), M('#facc15', { metalness: 1, roughness: 0.15, emissive: '#b45309', emissiveIntensity: 0.6 }), 0, 2.4, d / 2 + 0.1, g); anim.push((t) => { ring.rotation.z = t * 0.6; });
        const pot = label('JACKPOT', '#facc15', 'rgba(0,0,0,.7)', 1.6); pot.position.set(x, 5.3, z + d / 2); scene.add(pot);
      } else if (kind === 'bar') {
        add(new THREE.BoxGeometry(w, 1.1, d), M('#ffffff', { map: wood, roughness: 0.3, metalness: 0.05 }), 0, 0.55, 0, g);
        add(new THREE.BoxGeometry(w, 0.08, d + 0.2), M('#111', { roughness: 0.05, metalness: 0.6 }), 0, 1.14, 0, g);
        for (let i = 0; i < 10; i++) add(new THREE.CylinderGeometry(0.08, 0.1, 0.5, 10), M(['#22c55e', '#f59e0b', '#ef4444', '#3b82f6', '#a855f7'][i % 5], { transparent: true, opacity: 0.75, roughness: 0.05 }), -w / 2 + 0.6 + i * 0.75, 2.2, -d / 2 - 0.3, g);
        add(new THREE.BoxGeometry(w, 0.08, 0.6), M('#2a1d4a'), 0, 1.92, -d / 2 - 0.3, g);
        stationLabel('Bar Nebula', x, 3.2, z);
      }
    }

    // ---------- donation booths (from the Plaza; featured ones first) ----------
    const boothGroup = new THREE.Group(); scene.add(boothGroup); let boothList = [];
    async function loadBooths() {
      try { const d = await api.get('/api/plaza', { quiet: true }); boothList = d.booths.slice(0, 8); } catch { boothList = []; }
      boothGroup.clear(); colliders.splice(0, colliders.length, ...colliders.filter((c) => !c.booth));
      boothList.forEach((b, i) => {
        const x = 20; const z = 8 + i * 2.6 - (boothList.length > 4 ? 4 : 0); if (z > HALF - 2) return;
        const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = -Math.PI / 2; boothGroup.add(g);
        add(new THREE.BoxGeometry(2, 1, 0.8), M(b.color, { roughness: 0.6 }), 0, 0.5, 0, g);
        add(new THREE.BoxGeometry(2.1, 0.12, 0.9), M('#f8fafc'), 0, 1.06, 0, g);
        for (const sx of [-0.95, 0.95]) add(new THREE.CylinderGeometry(0.05, 0.05, 1.8), M('#e5e7eb'), sx, 1.9, -0.3, g);
        add(new THREE.BoxGeometry(2.1, 0.5, 0.06), M(b.boosted ? '#f5b84a' : b.color, { emissive: b.boosted ? '#f59e0b' : b.color, emissiveIntensity: 0.7 }), 0, 2.7, -0.3, g);
        const l = label(b.emoji + ' ' + b.title.slice(0, 26), '#fff', b.boosted ? 'rgba(180,120,0,.9)' : 'rgba(0,0,0,.65)', 0.9); l.position.set(0, 3.25, -0.3); g.add(l);
        const l2 = label('@' + b.user.username + ' · ' + fmt.compact(b.raised) + ' / ' + fmt.compact(b.goal), '#fde68a', 'rgba(0,0,0,.6)', 0.7); l2.position.set(0, 1.5, 0.5); g.add(l2);
        colliders.push({ id: 'booth:' + b.user.username, booth: b, x, z, w: 1.4, d: 2.4 });
      });
      const area = label(t('Donation booths'), '#fff', 'rgba(236,72,153,.85)', 1.4); area.position.set(22, 4.5, 8); boothGroup.add(area);
    }
    loadBooths();

    // ---------- me & others ----------
    const meId = S.me.id; let me = null;
    const players = new Map(); // id -> { obj, tag, playTag, x, z, ry, tx, tz, try, w, g, info }
    const meObj = buildAvatar(S.me.av3 || null); scene.add(meObj);
    const pos = { x: 0, z: 14, ry: Math.PI }; let camYaw = 0; let camPitch = 0.42;
    const myTag = label('@' + S.me.username, '#a5f3fc', 'rgba(0,0,0,.5)', 0.8); myTag.position.y = 2.55; meObj.add(myTag);
    function addPlayer(p) {
      if (p.id === meId || players.has(p.id)) return;
      const obj = buildAvatar(p.av3 || null); scene.add(obj);
      const tag = label((p.role === 'owner' ? '👑 ' : p.pro ? '⭐ ' : '') + '@' + p.username, '#fff', 'rgba(0,0,0,.55)', 0.8); tag.position.y = 2.55; obj.add(tag);
      const st = { obj, tag, playTag: null, x: p.x, z: p.z, ry: p.ry, tx: p.x, tz: p.z, tr: p.ry, w: p.w, g: p.g || '', info: p };
      obj.position.set(p.x, 0, p.z); players.set(p.id, st); setPlaying(st, p.g); paintTop();
    }
    function setPlaying(st, g) {
      if (st.playTag) { st.obj.remove(st.playTag); st.playTag = null; } st.g = g || '';
      if (g && GAME_LABEL[g]) { st.playTag = label(t('Playing {g}', { g: GAME_LABEL[g] }), '#1a1205', 'rgba(245,184,74,.95)', 0.6); st.playTag.position.y = 2.95; st.obj.add(st.playTag); }
    }
    function removePlayer(id) { const st = players.get(id); if (!st) return; scene.remove(st.obj); players.delete(id); paintTop(); }
    // floating text (chat bubbles, wins)
    const floats = [];
    function bubble(id, text, big) {
      const obj = id === meId ? meObj : players.get(id) && players.get(id).obj; if (!obj) return;
      const b = label(text, '#111', 'rgba(255,255,255,.95)', big ? 1.6 : 0.9); b.position.y = 3.3; obj.add(b); floats.push({ s: b, parent: obj, t0: performance.now(), life: big ? 2500 : 5000, rise: 0.15 });
    }
    function winFx(id, net, g) {
      const obj = id === meId ? meObj : players.get(id) && players.get(id).obj; if (!obj) return;
      const s = label((net > 0 ? '+' : '') + fmt.compact(net), net > 0 ? '#3ddc84' : '#f87171', 'rgba(0,0,0,.6)', net > 0 ? 1.2 : 0.8); s.position.y = 3.1; obj.add(s); floats.push({ s, parent: obj, t0: performance.now(), life: 2200, rise: 0.9 });
      if (net > 0) { burst(obj.position, net >= 1000 ? 60 : 24); fx3.ring(obj.position, net >= 1000 ? '#facc15' : '#3ddc84', { r: net >= 1000 ? 5 : 2.6 }); if (net >= 1000) { fx3.burst({ x: obj.position.x, y: 2.4, z: obj.position.z }, '#facc15', { n: 60, speed: 7 }); if (id === meId) fx3.kick(0.35); } }
      void g;
    }
    const bursts = [];
    function burst(at, n) {
      const geo = new THREE.BufferGeometry(); const p = new Float32Array(n * 3); const v = [];
      for (let i = 0; i < n; i++) { p[i * 3] = at.x; p[i * 3 + 1] = 2; p[i * 3 + 2] = at.z; v.push([(Math.random() - 0.5) * 4, 3 + Math.random() * 4, (Math.random() - 0.5) * 4]); }
      geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
      const col = new Float32Array(n * 3); const cc = new THREE.Color(); for (let i = 0; i < n; i++) { cc.setHSL(n > 30 ? Math.random() : 0.12 + Math.random() * 0.05, 1, 0.6); col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b; } geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ vertexColors: true, size: n > 30 ? 0.2 : 0.14, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); scene.add(pts); bursts.push({ pts, v, t0: performance.now() });
    }

    // ---------- light show (Nebulix 9): sweeping coloured spotlights with visible beams, giant spinning coins and,
    // every minute, a 7-second show: beams meet in the middle, strobes and a shower of gold coins from the ceiling ----------
    const show = (() => {
      const spots = []; const beamGeo = new THREE.ConeGeometry(2.2, 9, 24, 1, true); beamGeo.translate(0, -4.5, 0);
      [['#ff3cac', -18, -18], ['#22d3ee', 18, -18], ['#facc15', -18, 16], ['#7c5cff', 18, 16]].forEach(([c, x, z], i) => {
        const sp = new THREE.SpotLight(c, 60, 34, 0.32, 0.6, 1.4); sp.position.set(x, 9.2, z); scene.add(sp, sp.target);
        const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); beam.position.copy(sp.position); scene.add(beam);
        const head = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 0.6, 16), new THREE.MeshStandardMaterial({ color: '#111', metalness: 0.9, roughness: 0.3, emissive: c, emissiveIntensity: 0.6 })); head.position.copy(sp.position); scene.add(head);
        spots.push({ sp, beam, head, ph: i * 1.7, c });
      });
      const coins = []; const coinM = new THREE.MeshStandardMaterial({ color: '#f5c542', metalness: 1, roughness: 0.22, emissive: '#7a5600', emissiveIntensity: 0.35 });
      for (const [x, z, s] of [[-8, -4, 1], [8, -4, 0.8], [0, -14, 1.2], [0, 10, 0.9]]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.9 * s, 0.9 * s, 0.14 * s, 40), coinM); c.rotation.x = Math.PI / 2; c.position.set(x, 6.6, z); scene.add(c); coins.push(c); }
      const N = 260; const rain = new Float32Array(N * 3); const rv = new Float32Array(N); for (let i = 0; i < N; i++) { rain[i * 3] = (Math.random() - 0.5) * 30; rain[i * 3 + 1] = -5; rain[i * 3 + 2] = (Math.random() - 0.5) * 30; rv[i] = 3 + Math.random() * 4; }
      const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rain, 3));
      const rainPts = new THREE.Points(rg, new THREE.PointsMaterial({ map: glowTex, color: '#ffd76a', size: 0.32, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); rainPts.visible = false; scene.add(rainPts);
      let nextShow = performance.now() + 25000; let showUntil = 0; const tmp = new THREE.Vector3();
      return (tt, dt) => {
        const now = performance.now(); if (now > nextShow) { showUntil = now + 7000; nextShow = now + 60000; rainPts.visible = true; for (let i = 0; i < N; i++) rain[i * 3 + 1] = 9 + Math.random() * 6; try { sfx.big(); } catch {} }
        const on = now < showUntil; const k = on ? Math.min(1, (showUntil - now) / 1000, (now - (showUntil - 7000)) / 800) : 0;
        for (const s of spots) {
          const a = tt * 0.45 + s.ph; tmp.set(Math.cos(a) * 12 * (1 - k) + Math.sin(a * 1.7) * 3, 0, Math.sin(a * 0.8) * 10 * (1 - k)); s.sp.target.position.copy(tmp);
          s.beam.lookAt(tmp); s.beam.rotateX(-Math.PI / 2); s.head.lookAt(tmp); s.head.rotateX(Math.PI / 2);
          const strobe = on ? (Math.sin(tt * 30 + s.ph) > 0 ? 1.6 : 0.2) : 1; s.sp.intensity = 60 * strobe; s.beam.material.opacity = (on ? 0.14 : 0.07) * strobe;
          if (on) { const hue = (tt * 0.3 + s.ph * 0.2) % 1; s.sp.color.setHSL(hue, 1, 0.6); s.beam.material.color.setHSL(hue, 1, 0.6); } else { s.sp.color.set(s.c); s.beam.material.color.set(s.c); }
        }
        coins.forEach((c, i) => { c.rotation.z = tt * (1.2 + i * 0.2); c.position.y = 6.6 + Math.sin(tt * 1.4 + i) * 0.25; });
        if (rainPts.visible) { let alive2 = false; for (let i = 0; i < N; i++) { const y = rain[i * 3 + 1]; if (y > -1) { rain[i * 3 + 1] = y - rv[i] * dt; alive2 = true; } } rg.attributes.position.needsUpdate = true; if (!alive2 && !on) rainPts.visible = false; }
      };
    })();

    // ---------- network ----------
    const offs = [
      bus.on('ws:c3d_hello', (m) => { me = m.me; pos.x = m.me.x; pos.z = m.me.z; for (const p of m.players) addPlayer(p); paintTop(); }),
      bus.on('ws:c3d_join', (m) => { addPlayer(m.p); toast(t('@{u} came into the casino', { u: m.p.username }), 'info', 2500); }),
      bus.on('ws:c3d_leave', (m) => removePlayer(m.id)),
      bus.on('ws:c3d_pos', (m) => { for (const p of m.list) { const st = players.get(p.id); if (!st) continue; st.tx = p.x; st.tz = p.z; st.tr = p.ry; st.w = p.w; if ((p.g || '') !== st.g) setPlaying(st, p.g); } }),
      bus.on('ws:c3d_say', (m) => { if (m.id !== meId) bubble(m.id, m.text); }),
      bus.on('ws:c3d_emote', (m) => { if (m.id !== meId) bubble(m.id, m.text, true); }),
      bus.on('ws:c3d_fx', (m) => winFx(m.id, m.net, m.g)),
      bus.on('ws:c3d_full', () => toast(t('The 3D casino is full right now. You can still walk around on your own.'), 'info')),
      bus.on('ws:open', () => ws.send({ t: 'c3d_join' })),
      bus.on('ws:coins', (m) => { top.querySelector('.coin').textContent = fmt.coins(m.coins); }),
    ];
    ws.send({ t: 'c3d_join' });

    // ---------- quality (RTX) ----------
    let envRT = null; let post = null; let postBusy = false;
    async function setPost() {
      if (rtx && !post && !postBusy) { postBusy = true; softShadows(THREE, renderer, scene, { size: 4096 }); const p = await rtxPipeline(THREE, renderer, scene, cam, { bloom: 0.75, threshold: 0.8, radius: 0.55, aoRadius: 0.7 }); postBusy = false; if (!alive || !rtx) { if (p) p.dispose(); return; } post = p; resize(); }
      else if (!rtx && post) { post.dispose(); post = null; }
    }
    function applyQuality() {
      renderer.setPixelRatio(rtx ? Math.min(2, devicePixelRatio || 1) : Math.min(1, devicePixelRatio || 1));
      renderer.shadowMap.enabled = rtx; renderer.shadowMap.type = THREE.PCFSoftShadowMap; sun.castShadow = rtx;
      scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
      if (!envRT) { // reflections: an environment map baked from a neon "room" (also used without RTX since 8.4)
        const pm = new THREE.PMREMGenerator(renderer); const env = new THREE.Scene();
        env.add(new THREE.Mesh(new THREE.BoxGeometry(40, 20, 40), new THREE.MeshBasicMaterial({ color: '#120a24', side: THREE.BackSide })));
        for (const [x, y, z, c] of [[-15, 8, 0, '#ff3cac'], [15, 8, 0, '#22d3ee'], [0, 9, -15, '#facc15'], [0, 9, 15, '#7c5cff']]) { const m = new THREE.Mesh(new THREE.BoxGeometry(6, 1, 6), new THREE.MeshBasicMaterial({ color: c })); m.position.set(x, y, z); env.add(m); }
        envRT = pm.fromScene(env, 0.04); pm.dispose();
      }
      scene.environment = envRT.texture; scene.environmentIntensity = rtx ? 0.8 : 0.35; marble.roughness = rtx ? 0.08 : 0.32;
      for (const l of pointLights) l.intensity = rtx ? 110 : 80;
      scene.fog.near = rtx ? 30 : 20;
      resize(); setPost();
    }

    // ---------- input ----------
    const keys = new Set(); let drag = null; let joyV = null;
    const onKey = (e) => {
      if (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      if (overlay.style.display !== 'none') { if (e.type === 'keydown' && e.key === 'Escape') closeGame(); return; }
      const k = e.key.toLowerCase();
      if (e.type === 'keydown') { if (k === 'enter') { e.preventDefault(); chatIn.focus(); return; } if (k === 'e' && near) { interact(near); return; } keys.add(k); } else keys.delete(k);
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey);
    const cvs = renderer.domElement;
    cvs.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw: camYaw, pitch: camPitch }; cvs.setPointerCapture(e.pointerId); });
    cvs.addEventListener('pointermove', (e) => { if (!drag) return; camYaw = drag.yaw - (e.clientX - drag.x) * 0.006; camPitch = Math.max(0.05, Math.min(1.1, drag.pitch + (e.clientY - drag.y) * 0.004)); });
    cvs.addEventListener('pointerup', () => { drag = null; });
    joy.addEventListener('pointerdown', (e) => { joy.setPointerCapture(e.pointerId); const r = joy.getBoundingClientRect(); const upd = (ev) => { const dx = (ev.clientX - (r.left + r.width / 2)) / (r.width / 2); const dy = (ev.clientY - (r.top + r.height / 2)) / (r.height / 2); const l = Math.min(1, Math.hypot(dx, dy)); const a = Math.atan2(dy, dx); joyV = { x: Math.cos(a) * l, y: Math.sin(a) * l }; joy.firstChild.style.transform = `translate(${joyV.x * 30}px,${joyV.y * 30}px)`; }; upd(e); joy.onpointermove = upd; joy.onpointerup = () => { joyV = null; joy.firstChild.style.transform = ''; joy.onpointermove = null; }; });

    // ---------- playing a game in an overlay ----------
    let near = null; let gameCleanup = null;
    async function interact(st) {
      if (st.booth) { const b = st.booth; if (b.uid === S.me.id) { ctx.go('plaza'); return; } openDonate(b); return; }
      if (st.id === 'bar') { const drinks = ['🍹', '🥤', '🧃', '☕', '🍸']; const d = drinks[Math.floor(Math.random() * drinks.length)]; ws.send({ t: 'c3d_emote', e: d }); bubble(meId, d, true); toast(t('Cheers! The bar is on the house.'), 'good', 2000); return; }
      overlay.style.display = 'flex'; ws.send({ t: 'c3d_at', g: st.id });
      const box_ = h('div.c3d-game'); const close = h('button.btn.sm.c3d-x', { onClick: closeGame }, icon('x', 16), t('Back to the floor'));
      mount(overlay, h('div.c3d-gwrap', close, box_)); mount(box_, loading());
      try { const mod = (await import('./casino.js')).default; gameCleanup = await mod.mount(box_, { params: [st.id], query: new URLSearchParams(), go: (n, q) => { closeGame(); ctx.go(n, q); }, setTitle: () => {} }); } catch (e) { mount(box_, emptyState('alert', t('Could not open the game'), e.message)); }
    }
    function closeGame() { if (typeof gameCleanup === 'function') try { gameCleanup(); } catch {} gameCleanup = null; overlay.style.display = 'none'; mount(overlay); ws.send({ t: 'c3d_at', g: '' }); }
    async function openDonate(b) {
      const { modal, field } = await import('../ui.js');
      const amt = h('input.input', { type: 'text', inputmode: 'decimal', placeholder: '100, 10k', value: 100 });
      const ok = await modal({ title: b.emoji + ' ' + b.title, cls: 'narrow', body: h('div.col.gap', h('p.small.muted', t('Booth of @{u} · {a} of {g} coins', { u: b.user.username, a: fmt.coins(b.raised), g: fmt.coins(b.goal) })), field(t('Coins to donate'), amt)), actions: [{ label: t('Cancel'), value: false }, { label: t('Donate'), kind: 'primary', value: true }] });
      if (!ok) return;
      try { await api.post('/api/donate', { to: b.user.username, amount: parseCoins(amt.value) }); toast(t('Thank you! You donated {n} coins.', { n: fmt.coins(parseCoins(amt.value)) }), 'coin'); burst(meObj.position, 40); ws.send({ t: 'c3d_emote', e: '💸' }); loadBooths(); } catch (e) { toastErr(e); }
    }

    // ---------- loop ----------
    function resize() { const w = canvasHost.clientWidth || 800; const hh = canvasHost.clientHeight || 500; renderer.setSize(w, hh, false); if (post) post.setSize(w, hh); cam.aspect = w / hh; cam.updateProjectionMatrix(); }
    const ro = new ResizeObserver(resize); ro.observe(canvasHost);
    const collide = (x, z) => { if (Math.abs(x) > HALF - 0.6 || Math.abs(z) > HALF - 0.6) return true; for (const c of colliders) if (Math.abs(x - c.x) < c.w / 2 + 0.3 && Math.abs(z - c.z) < c.d / 2 + 0.3) return true; return false; };
    let last = performance.now(); let sent = 0; let walking = false; let raf = 0; let lastSent = '';
    function frame() {
      if (!alive) return; raf = requestAnimationFrame(frame);
      const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now; const t_ = now / 1000;
      // movement relative to the camera
      let fx = 0, fz = 0;
      if (overlay.style.display === 'none') {
        if (keys.has('w') || keys.has('arrowup')) fz -= 1; if (keys.has('s') || keys.has('arrowdown')) fz += 1; if (keys.has('a') || keys.has('arrowleft')) fx -= 1; if (keys.has('d') || keys.has('arrowright')) fx += 1;
        if (joyV) { fx += joyV.x; fz += joyV.y; }
      }
      const len = Math.hypot(fx, fz); walking = len > 0.1;
      if (walking) {
        fx /= Math.max(1, len); fz /= Math.max(1, len);
        const sp = (keys.has('shift') ? 9 : 5.5) * dt; const s = Math.sin(camYaw), c = Math.cos(camYaw);
        const mx = (fx * c + fz * s) * sp; const mz = (-fx * s + fz * c) * sp;
        if (!collide(pos.x + mx, pos.z)) pos.x += mx; if (!collide(pos.x, pos.z + mz)) pos.z += mz;
        const target = Math.atan2(mx, mz); let d = target - pos.ry; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; pos.ry += d * Math.min(1, dt * 12);
      }
      meObj.position.set(pos.x, 0, pos.z); meObj.rotation.y = pos.ry; animateAvatar(meObj, t_, walking ? 1 : 0);
      try { show(t_, dt); } catch {}
      // camera follows behind
      const dist = 7; const tx = pos.x + Math.sin(camYaw) * dist * Math.cos(camPitch), ty = 1.6 + Math.sin(camPitch) * dist + (walking ? Math.sin(t_ * 9) * 0.04 : 0), tz = pos.z + Math.cos(camYaw) * dist * Math.cos(camPitch);
      if (!camS.ready) { camS.x = tx; camS.y = ty; camS.z = tz; camS.ready = true; } camS.x = damp(camS.x, tx, 10, dt); camS.y = damp(camS.y, ty, 10, dt); camS.z = damp(camS.z, tz, 10, dt);
      cam.position.set(camS.x, camS.y, camS.z); cam.lookAt(pos.x, 1.4, pos.z); dust3.update(t_); fx3.update(dt); fx3.shake(cam);
      // network: send at most ~8/s, only when changed
      if (now - sent > 120) { const k = pos.x.toFixed(2) + pos.z.toFixed(2) + pos.ry.toFixed(2) + walking; if (k !== lastSent) { ws.send({ t: 'c3d_move', x: pos.x, z: pos.z, ry: pos.ry, w: walking }); lastSent = k; } sent = now; }
      // others: interpolate
      for (const st of players.values()) { st.x += (st.tx - st.x) * Math.min(1, dt * 8); st.z += (st.tz - st.z) * Math.min(1, dt * 8); let d = st.tr - st.ry; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; st.ry += d * Math.min(1, dt * 10); st.obj.position.set(st.x, 0, st.z); st.obj.rotation.y = st.ry; animateAvatar(st.obj, t_ + st.x, st.w ? 1 : 0); }
      // nearest station
      let best = null, bd = 3.2; for (const c of colliders) { const d = Math.max(0, Math.hypot(pos.x - c.x, pos.z - c.z) - Math.max(c.w, c.d) / 2); if (d < bd) { bd = d; best = c; } }
      if (best !== near) { near = best; if (near) { prompt.style.display = 'flex'; mount(prompt, h('kbd', 'E'), near.booth ? t('Donate to @{u}', { u: near.booth.user.username }) : near.id === 'bar' ? t('Order a drink') : t('Play {g}', { g: GAME_LABEL[near.id] }), h('button.btn.sm.primary', { onClick: () => interact(near) }, t('Go'))); } else prompt.style.display = 'none'; }
      for (const f of anim) f(t_);
      for (const g of chand) g.rotation.y = t_ * 0.1;
      for (let i = floats.length - 1; i >= 0; i--) { const f = floats[i]; const p = (now - f.t0) / f.life; if (p >= 1) { f.parent.remove(f.s); f.s.material.map.dispose(); floats.splice(i, 1); continue; } f.s.position.y = 3.1 + p * f.rise * 3; f.s.material.opacity = 1 - Math.max(0, (p - 0.7) / 0.3); }
      for (let i = bursts.length - 1; i >= 0; i--) { const b = bursts[i]; const el = (now - b.t0) / 1000; if (el > 1.6) { scene.remove(b.pts); b.pts.geometry.dispose(); bursts.splice(i, 1); continue; } const a = b.pts.geometry.attributes.position; for (let j = 0; j < b.v.length; j++) { a.array[j * 3] += b.v[j][0] * dt; a.array[j * 3 + 1] += (b.v[j][1] - 9 * el) * dt; a.array[j * 3 + 2] += b.v[j][2] * dt; } a.needsUpdate = true; b.pts.material.opacity = 1 - el / 1.6; }
      if (post) post.render(); else renderer.render(scene, cam);
    }
    applyQuality(); paintTop(); frame();
    const boothTimer = setInterval(loadBooths, 60000);
    ws.send({ t: 'act', kind: 'casino', label: t('In the 3D casino') });

    return () => { if (post) { post.dispose(); post = null; }
      alive = false; try { fx3.dispose(); dust3.dispose(); } catch {} cancelAnimationFrame(raf); clearInterval(boothTimer); ro.disconnect(); offs.forEach((f) => f && f());
      window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey);
      if (typeof gameCleanup === 'function') try { gameCleanup(); } catch {}
      ws.send({ t: 'c3d_leave' });
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
      if (envRT) envRT.dispose(); renderer.dispose(); try { renderer.forceContextLoss(); } catch {}
    };
  },
};

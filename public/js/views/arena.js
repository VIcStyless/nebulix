// Nebulix Arena (12.0, 13.0, 13.6): online play for five original modes. #/arena (lobby) · #/arena/ops · #/arena/royale · #/arena/duel
//   #/arena/real (Realistics 1v1) · #/arena/box (Box fight 1v1): build fights on an open field, first to 5.
//   13.6: roof (cone) piece, wall edits (door / window / arch), turbo building, settings (sensitivity, FOV, quality,
//   key binds), compass and a new HUD.
//   ?ranked=1 joins the ranked queue · #/arena/duel?room=<id> joins a private duel from a challenge
//   Nebula Ops "Assault" — first person, 5 vs 5 rounds, buy menu (B), plant / defuse the plasma core (hold E).
//   Nebula Royale — third person, drop ship (Space), glide, closing storm, chests (E), harvest with the pickaxe,
//   build walls / floors / ramps (G build mode · 1/2/3 piece · R rotate), last one standing wins.
import { h, mount, fmt, ls } from '../util.js';
import { t, getLang } from '../i18n.js';
import { api, ws } from '../api.js';
import { S, bus } from '../state.js';
import { icon } from '../icons.js';
import { toast, loading } from '../ui.js';
import { sfx } from '../sfx.js';
import { load3d } from '../avatar3d.js';
import { autoTier, rtxPipeline } from '../rtx.js';
import { buildHero, animateHero, lerpAngle, glowTex } from '../worlds-engine.js';
import * as SH from '../arena-shared.js';
import { outfitAv, dressHero, poseEmote, resetEmote, EMOTE_LEN, elimBurst, trailPuff, stepFx } from '../locker3d.js';
import { rankPill } from './ranked.js';

const L2 = (pair) => (getLang() === 'es' ? pair[1] : pair[0]);
const snd = (k) => { try { sfx[k] && sfx[k](); } catch {} };
const TEAM = { atk: ['Raiders', 'Saqueadores', '#f97316'], def: ['Guardians', 'Guardianes', '#38bdf8'] };
// ---------- player settings (13.6), saved in this browser ----------
const CFG_DEF = { sens: 1, ads: 1, fov: 78, invert: false, fps: false, fx: true, quality: 'auto', turbo: true, dmgNums: true, keys: { wall: 'z', floor: 'x', ramp: 'v', cone: 'b', edit: 'f', build: 'g', pickaxe: 'q' } };
export function arCfg() { let c = {}; try { c = JSON.parse(localStorage.getItem('nbx.ar.cfg') || '{}') || {}; } catch {} const old = Number(ls('ar.sens')); const out = Object.assign({}, CFG_DEF, c, { keys: Object.assign({}, CFG_DEF.keys, c.keys || {}) }); if (!c.sens && old) out.sens = old; return out; }
function saveCfg(c) { try { localStorage.setItem('nbx.ar.cfg', JSON.stringify(c)); } catch {} }
const keyName = (k) => (k === ' ' ? 'SPACE' : String(k || '').toUpperCase());
const PIECES = [['wall', ['Wall', 'Pared']], ['floor', ['Floor', 'Suelo']], ['ramp', ['Ramp', 'Rampa']], ['cone', ['Roof', 'Tejado']]];
const timeLeft = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

export default {
  title: () => 'Nebulix Arena', full: true,
  async mount(root, ctx) {
    const game = ['ops', 'royale', 'duel', 'real', 'box'].includes(ctx.params[0]) ? ctx.params[0] : null;
    if (!game) return lobby(root, ctx);
    const opts = { ranked: ctx.query.get('ranked') === '1', room: ctx.query.get('room') || null };
    // "Play again" restarts the match inside the same view (no page reload)
    let stop = () => {}; let live = true;
    opts.again = async () => { if (!live) return; stop(); opts.room = null; stop = await play(root, ctx, game, opts); };
    stop = await play(root, ctx, game, opts);
    return () => { live = false; stop(); };
  },
};

// ---------------- lobby: a game front-end with your character on stage ----------------
const MODES_L = [
  { id: 'royale', n: 'Nebula Royale', sub: ['Solo · up to 20 players', 'Solitario · hasta 20 jugadores'], d: ['Jump from the ship, loot, build and be the last one standing.', 'Salta de la nave, consigue botín, construye y sé el último en pie.'], ic: 'storm', c: ['#4c1d95', '#0e7490'] },
  { id: 'ops', n: 'Nebula Ops', sub: ['Assault · 5 vs 5', 'Asalto · 5 contra 5'], d: ['Plant or defuse the plasma core. First to 7 rounds.', 'Planta o desactiva el núcleo de plasma. Gana quien llegue a 7 rondas.'], ic: 'target', c: ['#7c2d12', '#1e3a8a'] },
  { id: 'duel', n: 'Prism Court', sub: ['Duels · 1 vs 1', 'Duelos · 1 contra 1'], d: ['Same weapon for both each round. First to 5.', 'La misma arma para los dos en cada ronda. Gana quien llegue a 5.'], ic: 'swords', c: ['#831843', '#312e81'] },
  { id: 'real', n: 'Realistics 1v1', sub: ['Build fight · 1 vs 1', 'Construcción · 1 contra 1'], d: ['Spawn close in the open with a shotgun, a rifle, an SMG and 500 materials. Build, edit and outplay. First to 5.', 'Apareces cerca de tu rival en campo abierto con escopeta, rifle, subfusil y 500 materiales. Construye, edita y gana. Gana quien llegue a 5.'], ic: 'crate', c: ['#166534', '#0e7490'] },
  { id: 'box', n: 'Box Fight 1v1', sub: ['Box fight · 1 vs 1', 'Pelea en caja · 1 contra 1'], d: ['Each round starts inside your own box. Edit out and take the fight. First to 5.', 'Cada ronda empiezas dentro de tu propia caja. Edita para salir y gana el combate. Gana quien llegue a 5.'], ic: 'cube', c: ['#92400e', '#4c1d95'] },
];
async function lobby(root, ctx) {
  const L = (p) => (getLang() === 'es' ? p[1] : p[0]);
  let on = { ops: 0, royale: 0, duel: 0, real: 0, box: 0 }; let rk = null; let pick = ls('ar.mode') || 'royale'; let ranked = !!ls('ar.ranked');
  const stage = h('div.fl-stage'); const right = h('div.fl-right'); const top = h('div.fl-top'); const bottom = h('div.fl-bottom');
  const box = h('div.fl', h('div.fl-bg'), top, h('div.fl-mid', stage, right), bottom); mount(root, box);
  try { [on, rk] = await Promise.all([api.get('/api/arena').catch(() => on), api.get('/api/ranked').catch(() => null)]); } catch {}
  mount(top, h('div.fl-brand', h('b', 'NEBULIX'), h('span', 'ARENA')), h('nav.fl-tabs', [['arena', t('Lobby'), 'play'], ['shop/locker', t('Locker'), 'user'], ['shop', t('Shop'), 'bag'], ['shop/trade', t('Marketplace'), 'tag'], ['ranked', t('Competitive'), 'trophy']].map(([r, l, ic], i) => h('button' + (i === 0 ? '.on' : ''), { onClick: () => { if (i) { const [n, ...rest] = r.split('/'); ctx.go(n, rest.join('/') || undefined); } } }, icon(ic, 15), h('span', l)))),
    h('span.grow'), rk ? h('div.fl-season', icon('flag', 14), ' ', t('Season {n}', { n: rk.season.n })) : null, h('div.fl-coins', icon('coins', 15), ' ', fmt.coins(S.me.coins)));
  const bfPick = () => pick === 'real' || pick === 'box';
  const buildHint = () => { const K = arCfg().keys; return PIECES.map(([p, n]) => keyName(K[p]) + ' ' + L(n)).join(' · ') + ' · ' + keyName(K.edit) + ' ' + t('edit') + ' · ' + t('P settings'); };
  function paint() {
    const m = MODES_L.find((x) => x.id === pick) || MODES_L[0]; const r = rk && rk.modes[m.id];
    mount(right, h('div.fl-modes', MODES_L.map((x) => h('button.fl-mode' + (x.id === pick ? '.on' : ''), { style: { '--c1': x.c[0], '--c2': x.c[1] }, onClick: () => { pick = x.id; ls('ar.mode', pick); paint(); } }, h('span.fl-mic', icon(x.ic, 26)), h('div.grow', h('b', x.n), h('span', L(x.sub))), on[x.id] ? h('span.fl-live', t('{n} playing', { n: on[x.id] })) : null))),
      h('div.fl-info', h('p', L(m.d)), r && r.g ? h('div.fl-rank', rankPill(r, true), h('span.tiny', `${r.rp} RP`)) : h('p.tiny.muted', t('Ranked: unranked — play to get placed'))));
    mount(bottom, h('div.fl-queue', h('div.fl-q', h('button' + (!ranked ? '.on' : ''), { onClick: () => { ranked = false; ls('ar.ranked', false); paint(); } }, t('Casual')), h('button' + (ranked ? '.on' : ''), { onClick: () => { ranked = true; ls('ar.ranked', true); paint(); } }, icon('trophy', 13), ' ', t('Ranked'))),
      h('button.fl-play', { onClick: () => ctx.go('arena/' + pick, ranked && !bfPick() ? { ranked: 1 } : undefined) }, h('b', t('PLAY')), h('span', m.n + (ranked && !bfPick() ? ' · ' + t('Ranked') : bfPick() ? ' · ' + t('Casual') : ''))),
      h('div.tiny.fl-hint', bfPick() ? buildHint() : pick === 'royale' ? t('WASD move · Space jump/glide · G build · E open · H/J heal · T emote') : pick === 'ops' ? t('B buy · E plant/defuse · R reload') : t('Right click aim · R reload · C crouch'))));
  }
  paint();
  let st = null; import('./shop.js').then(async (mod) => { try { const lk = await api.get('/api/locker/of/' + encodeURIComponent(S.me.username)); if (stage.isConnected) st = await mod.heroStage(stage, lk.lk || {}); } catch {} });
  const iv = setInterval(() => { if (!box.isConnected) return clearInterval(iv); if (st && Math.random() < 0.25) st.emote(['wave', 'dance', 'flex', 'hop'][Math.floor(Math.random() * 4)]); }, 6000);
  return () => { clearInterval(iv); if (st) st.stop(); };
}

// ---------------- game ----------------
async function play(root, ctx, game, opts = {}) {
  const ops = game === 'ops'; const duel = game === 'duel'; const royale = game === 'royale'; const bf = game === 'real' || game === 'box'; const duelish = duel || bf; const tp = royale || bf; const canBuild = royale || bf; const fp = !tp;
  let cfg = arCfg(); let cfgOpen = false;
  const box = h('div.ar-game' + (fp ? '.ops-mode' : '.royale-mode') + (duelish ? '.duel-mode' : '') + (bf ? '.bf-mode' : '')); const hud = h('div.ar-hud'); const feedEl = h('div.ar-feed'); const center = h('div.ar-center'); const overlay = h('div.ar-ov'); const cross = h('div.ar-cross'); const hitm = h('div.ar-hitm'); const hurt = h('div.ar-hurt'); const mini = h('canvas.ar-mini', { width: 170, height: 170 });
  mount(root, h('div.ar-wrap', h('div.ar-top', h('button.btn.sm.ghost', { onClick: () => ctx.go('arena') }, icon('back', 14), 'Arena'), h('b.grow.ar-title', ops ? 'Nebula Ops · ' + t('Assault') : duel ? t('Duels') + ' · Prism Court' : bf ? (game === 'box' ? 'Box Fight 1v1' : 'Realistics 1v1') : 'Nebula Royale', opts.ranked ? h('span.pill.ar-rkq', icon('trophy', 11), ' ' + t('Ranked')) : null), h('span.tiny.muted', t('Esc frees the mouse')), h('button.btn.sm.ghost', { title: t('Full screen'), onClick: () => { try { if (document.fullscreenElement) document.exitFullscreen(); else box.requestFullscreen({ navigationUI: 'hide' }).then(() => { try { renderer.domElement.requestPointerLock(); } catch {} }).catch(() => {}); } catch {} } }, icon('fullscreen', 15), t('Full screen')), h('button.btn.sm.ghost', { title: t('Settings') + ' (P)', onClick: () => openCfg() }, icon('gear', 15), t('Settings'))), box));
  const qcEl = h('div.ar-qcw.hide'); let qcOpen = false; const specEl = h('div.ar-spec.hide');
  const compass = h('canvas.ar-compass', { width: 420, height: 40 }); const fpsEl = h('div.ar-fps'); const cfgEl = h('div.ar-cfg.hide');
  box.append(hud, center, feedEl, cross, hitm, hurt, mini, compass, fpsEl, qcEl, specEl, overlay, cfgEl);
  let THREE, AV; try { ({ THREE, AV } = await load3d()); } catch (e) { mount(box, h('p', e.message)); return () => {}; }
  let renderer; try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); } catch { mount(box, h('p', t('3D is not available'))); return () => {}; }
  const tier = cfg.quality !== 'auto' ? cfg.quality : autoTier(renderer);
  let pipe = null; /* 13.8: bloom, ambient occlusion and SMAA on high quality */ const shadows = tier !== 'low';
  renderer.setPixelRatio(tier === 'high' ? Math.min(1.6, devicePixelRatio || 1) : tier === 'med' ? 1 : 0.75); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.shadowMap.enabled = shadows; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  box.prepend(renderer.domElement); renderer.domElement.className = 'ar-cv';
  const scene = new THREE.Scene(); const cam = new THREE.PerspectiveCamera(fp ? 74 : 70, 16 / 9, 0.05, 1400); scene.add(cam);
  // sky + light
  { const c = document.createElement('canvas'); c.width = 4; c.height = 256; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 256); if (ops) { gr.addColorStop(0, '#1b1440'); gr.addColorStop(0.45, '#6d3f8f'); gr.addColorStop(0.7, '#f0a070'); gr.addColorStop(1, '#f7d4a8'); } else if (duel) { gr.addColorStop(0, '#020617'); gr.addColorStop(0.5, '#1e1b4b'); gr.addColorStop(0.8, '#7c3aed'); gr.addColorStop(1, '#f0abfc'); } else { gr.addColorStop(0, '#1d4ed8'); gr.addColorStop(0.45, '#60a5fa'); gr.addColorStop(0.8, '#bae6fd'); gr.addColorStop(1, '#fef3c7'); } g.fillStyle = gr; g.fillRect(0, 0, 4, 256); const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; scene.background = tx; }
  scene.fog = new THREE.Fog(ops ? '#e9b48f' : duel ? '#2e1065' : '#d6ecff', ops ? 50 : duel ? 30 : 110, ops ? 160 : duel ? 110 : 520);
  scene.add(new THREE.HemisphereLight(ops ? '#c7b8ff' : duel ? '#c4b5fd' : '#e0f2fe', ops ? '#8a6a48' : duel ? '#1e1b4b' : '#4d7c0f', duel ? 1.0 : 1.25));
  const sun = new THREE.DirectionalLight(ops ? '#ffd9a8' : '#fffbeb', 2.6); sun.castShadow = shadows; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, far: 220 }); sun.shadow.bias = -0.0005; scene.add(sun, sun.target);
  // materials (procedural)
  // 13.8 textures: drawn at 256 px (the drawing code works in a 128 grid, scaled ×2), sharp at grazing angles
  // (anisotropic filtering) and with a bump map from the same picture so mortar, planks and panel lines have depth
  const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1); const TS = tier === 'low' ? 128 : 256;
  const tex = (draw, rep = 1) => { const c = document.createElement('canvas'); c.width = c.height = TS; const g = c.getContext('2d'); g.scale(TS / 128, TS / 128); draw(g); const tx = new THREE.CanvasTexture(c); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(rep, rep); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = ANISO; return tx; };
  const bump = (tx) => { const b2 = tx.clone(); b2.colorSpace = THREE.NoColorSpace; b2.needsUpdate = true; return b2; };
  const noise = (g, base, n, a) => { g.fillStyle = base; g.fillRect(0, 0, 128, 128); for (let i = 0; i < n; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * a})`; g.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 2, 1 + Math.random() * 2); } for (let i = 0; i < n / 3; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * a * 0.5})`; g.fillRect(Math.random() * 128, Math.random() * 128, 1, 1); } };
  const stdTex = (draw, o = {}) => { const tx = tex(draw); return new THREE.MeshStandardMaterial(Object.assign({ map: tx, bumpMap: bump(tx), bumpScale: 0.6 }, o)); };
  const MAT = {
    wall: stdTex((g) => { noise(g, '#d6c09a', 1400, 0.14); for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(120,90,50,.08)'; g.beginPath(); g.ellipse(Math.random() * 128, Math.random() * 128, 10 + Math.random() * 20, 6 + Math.random() * 12, 0, 0, 7); g.fill(); } g.fillStyle = 'rgba(80,55,30,.45)'; g.fillRect(0, 116, 128, 12); g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(0, 116, 128, 1); }, { roughness: 0.92 }),
    brick: stdTex((g) => { g.fillStyle = '#7d6b58'; g.fillRect(0, 0, 128, 128); for (let r = 0; r < 8; r++) for (let c = -1; c < 4; c++) { const l = 125 + Math.random() * 55; const x = c * 42 + (r % 2) * 21 + 1.5, y = r * 16 + 1.5; g.fillStyle = `rgb(${l},${l * 0.62},${l * 0.45})`; g.fillRect(x, y, 39, 13); for (let k = 0; k < 14; k++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.18})`; g.fillRect(x + Math.random() * 38, y + Math.random() * 12, 2, 1.5); } g.fillStyle = 'rgba(255,255,255,.10)'; g.fillRect(x, y, 39, 1); } }, { roughness: 0.88 }),
    crate: stdTex((g) => { noise(g, '#9b6a3a', 500, 0.18); for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(50,28,10,.55)'; g.fillRect(0, i * 21.3, 128, 1.6); } g.strokeStyle = '#4e3117'; g.lineWidth = 11; g.strokeRect(5.5, 5.5, 117, 117); g.beginPath(); g.moveTo(10, 10); g.lineTo(118, 118); g.stroke(); g.fillStyle = '#2b2b2b'; for (const [x, y] of [[9, 9], [119, 9], [9, 119], [119, 119]]) { g.beginPath(); g.arc(x, y, 2, 0, 7); g.fill(); } }, { roughness: 0.82 }),
    metal: stdTex((g) => { g.fillStyle = '#6b7280'; g.fillRect(0, 0, 128, 128); for (let y = 0; y < 128; y += 1) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.07})`; g.fillRect(0, y, 128, 1); } g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1.5; g.strokeRect(1, 1, 126, 62); g.strokeRect(1, 65, 126, 62); g.fillStyle = 'rgba(0,0,0,.45)'; for (const y of [5, 59, 69, 123]) for (const x of [5, 123]) { g.beginPath(); g.arc(x, y, 1.6, 0, 7); g.fill(); } }, { metalness: 0.75, roughness: 0.38, bumpScale: 0.3 }),
    roof: new THREE.MeshStandardMaterial({ color: '#7c2d12', roughness: 0.8 }),
    wood: stdTex((g) => { noise(g, '#a16207', 300, 0.2); for (let i = 0; i < 8; i++) { g.fillStyle = 'rgba(60,30,10,.4)'; g.fillRect(0, i * 16, 128, 1.6); for (let k = 0; k < 3; k++) { g.strokeStyle = 'rgba(70,40,15,.25)'; g.beginPath(); g.moveTo(0, i * 16 + 4 + k * 4); g.bezierCurveTo(40, i * 16 + 2 + k * 4, 80, i * 16 + 7 + k * 4, 128, i * 16 + 4 + k * 4); g.stroke(); } } }, { roughness: 0.8 }),
    glass: new THREE.MeshStandardMaterial({ color: '#a5f3fc', emissive: '#22d3ee', emissiveIntensity: 0.25, transparent: true, opacity: 0.45, roughness: 0.03, metalness: 0.4, envMapIntensity: 1.6 }),
    cont: ['#a8322a', '#2a5aa8', '#3f7d3a', '#c48a22'].map((c) => stdTex((g) => { g.fillStyle = c; g.fillRect(0, 0, 128, 128); for (let x = 0; x < 128; x += 10) { g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(x, 0, 3, 128); g.fillStyle = 'rgba(255,255,255,.10)'; g.fillRect(x + 3, 0, 1, 128); } for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(90,50,20,${Math.random() * 0.25})`; g.fillRect(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 5, 1 + Math.random() * 3); } g.fillStyle = 'rgba(255,255,255,.65)'; g.font = 'bold 9px system-ui'; g.fillText('NBX 4512 08', 12, 18); }, { roughness: 0.5, metalness: 0.45, bumpScale: 0.4 })),
  };
  const matOf = (m) => (m && m.startsWith('cont') ? MAT.cont[Number(m.slice(4)) || 0] : MAT[m] || MAT.wall);
  // ---------- world ----------
  let map = ops ? SH.opsMap() : duel ? SH.duelMap() : bf ? SH.bfMap(game) : null; let mapSeed = ops ? 'depot' : duel ? 'court' : null; const mapMeshes = []; let rmap = null; const solidList = []; // { x,z,w,d,h,y, bid? }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(fp ? 200 : 900, fp ? 200 : 900), new THREE.MeshStandardMaterial({ map: tex((g) => { if (duel) { g.fillStyle = '#1e1b4b'; g.fillRect(0, 0, 128, 128); g.strokeStyle = '#7c3aed88'; g.lineWidth = 2; for (let i = 0; i <= 128; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); } } else if (ops) { noise(g, '#b9a07a', 1600, 0.11); g.strokeStyle = 'rgba(60,45,30,.35)'; g.lineWidth = 1; for (let i = 0; i <= 128; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); } for (let k = 0; k < 5; k++) { g.strokeStyle = 'rgba(40,30,20,.3)'; g.beginPath(); let x = Math.random() * 128, y = Math.random() * 128; g.moveTo(x, y); for (let j = 0; j < 5; j++) { x += (Math.random() - 0.5) * 20; y += (Math.random() - 0.5) * 20; g.lineTo(x, y); } g.stroke(); } } else { g.fillStyle = '#4d7c0f'; g.fillRect(0, 0, 128, 128); for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '20,60,10' : '120,170,60'},${Math.random() * 0.35})`; g.fillRect(Math.random() * 128, Math.random() * 128, 2, 3); } } }, fp ? 40 : 120), roughness: duel ? 0.18 : ops ? 0.8 : 0.97, metalness: duel ? 0.45 : 0 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = shadows; scene.add(ground);
  function addBoxes(list) { for (const b of list) { const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), matOf(b.m)); mesh.position.set(b.x, (b.y || 0) + b.h / 2, b.z); mesh.castShadow = shadows; mesh.receiveShadow = shadows; scene.add(mesh); mapMeshes.push(mesh); solidList.push(b); } }
  let chestMeshes = []; let treeData = []; let rockData = [];
  let water = null; const clouds = []; let grassMesh = null;
  function buildRoyale(seed) {
    rmap = SH.royaleMap(seed); addBoxes(rmap.boxes);
    // 13.0: house details — a pitched roof on every roof slab and windows on the long walls
    const roofM = [new THREE.MeshStandardMaterial({ color: '#9a3412', roughness: 0.75 }), new THREE.MeshStandardMaterial({ color: '#1e3a8a', roughness: 0.7 }), new THREE.MeshStandardMaterial({ color: '#365314', roughness: 0.8 }), new THREE.MeshStandardMaterial({ color: '#57534e', roughness: 0.7 })];
    const winM = new THREE.MeshStandardMaterial({ color: '#0c4a6e', emissive: '#38bdf8', emissiveIntensity: 0.35, roughness: 0.1, metalness: 0.6 }); const frameM = new THREE.MeshStandardMaterial({ color: '#f5f5f4', roughness: 0.6 });
    rmap.boxes.forEach((bx, i) => {
      if (bx.m === 'roof') { const along = bx.w >= bx.d; const len = (along ? bx.w : bx.d) + 0.5; const span = (along ? bx.d : bx.w) / 2 + 0.35; const sh = new THREE.Shape(); sh.moveTo(-span, 0); sh.lineTo(span, 0); sh.lineTo(0, span * 0.62); sh.closePath(); const geo = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false }); geo.translate(0, 0, -len / 2); if (along) geo.rotateY(Math.PI / 2);
        const roof = new THREE.Mesh(geo, roofM[i % roofM.length]); roof.position.set(bx.x, bx.y + bx.h, bx.z); roof.castShadow = shadows; scene.add(roof);
        const chim = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.6, 0.6), MAT.brick); chim.position.set(bx.x + (along ? bx.w * 0.25 : 0.6), bx.y + bx.h + 0.9, bx.z + (along ? 0.6 : bx.d * 0.25)); chim.castShadow = shadows; scene.add(chim); }
      else if (bx.h > 3 && bx.h < 4 && Math.min(bx.w, bx.d) <= 0.5 && Math.max(bx.w, bx.d) >= 3.5) {
        const along = bx.w > bx.d; const len = along ? bx.w : bx.d; const n = Math.max(1, Math.floor(len / 3.2));
        for (let k = 0; k < n; k++) { const off = (k + 0.5) * (len / n) - len / 2; for (const sd of [-1, 1]) { const f = new THREE.Mesh(new THREE.BoxGeometry(along ? 1.2 : 0.06, 1.1, along ? 0.06 : 1.2), frameM); const w = new THREE.Mesh(new THREE.BoxGeometry(along ? 1 : 0.07, 0.9, along ? 0.07 : 1), winM); const px = bx.x + (along ? off : sd * (bx.w / 2 + 0.02)), pz = bx.z + (along ? sd * (bx.d / 2 + 0.02) : off); f.position.set(px, 1.9, pz); w.position.set(px + (along ? 0 : sd * 0.01), 1.9, pz + (along ? sd * 0.01 : 0)); scene.add(f, w); } }
      }
    });
    // island: sandy beach rim, animated sea with foam
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(rmap.size + 36, rmap.size + 36), new THREE.MeshStandardMaterial({ color: '#e7d3a1', roughness: 1 })); sand.rotation.x = -Math.PI / 2; sand.position.y = -0.06; sand.receiveShadow = shadows; scene.add(sand);
    const wtex = tex((g) => { g.fillStyle = '#0ea5e9'; g.fillRect(0, 0, 128, 128); for (let i = 0; i < 260; i++) { g.strokeStyle = `rgba(255,255,255,${Math.random() * 0.22})`; g.lineWidth = 1 + Math.random() * 1.5; const x = Math.random() * 128, y = Math.random() * 128; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 6, y - 3, x + 12, y); g.stroke(); } }, 160);
    water = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ map: wtex, color: '#7dd3fc', roughness: 0.15, metalness: 0.35, transparent: true, opacity: 0.94 })); water.rotation.x = -Math.PI / 2; water.position.y = -0.45; scene.add(water);
    const foam = new THREE.Mesh(new THREE.RingGeometry((rmap.size + 36) * 0.7, (rmap.size + 36) * 0.76, 4, 1), new THREE.MeshBasicMaterial({ color: '#f0f9ff', transparent: true, opacity: 0.35, depthWrite: false })); foam.rotation.set(-Math.PI / 2, 0, Math.PI / 4); foam.position.y = -0.4; foam.name = 'foam'; scene.add(foam);
    ground.geometry = new THREE.PlaneGeometry(rmap.size + 20, rmap.size + 20);
    // instanced trees: round broadleaf and layered pines with colour variety; rocks
    treeData = rmap.trees; rockData = rmap.rocks; const dummy = new THREE.Object3D(); const col = new THREE.Color();
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.45, 1, 7), new THREE.MeshStandardMaterial({ color: '#6b4423', roughness: 0.9 }), treeData.length);
    const pinesIdx = treeData.map((_, i) => i).filter((i) => i % 3 === 0); const roundIdx = treeData.map((_, i) => i).filter((i) => i % 3 !== 0);
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true }), roundIdx.length);
    const pine = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1.6, 8), new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }), pinesIdx.length * 3);
    treeData.forEach((tr, i) => { dummy.position.set(tr.x, tr.h * 0.3, tr.z); dummy.scale.set(1, tr.h * 0.6, 1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); trunk.setMatrixAt(i, dummy.matrix); });
    roundIdx.forEach((ti, j) => { const tr = treeData[ti]; dummy.position.set(tr.x, tr.h * 0.7, tr.z); dummy.scale.set(tr.h * 0.34, tr.h * 0.3, tr.h * 0.34); dummy.rotation.set(0, ti, 0); dummy.updateMatrix(); crown.setMatrixAt(j, dummy.matrix); crown.setColorAt(j, col.setHSL(0.27 + ((ti * 37) % 10) / 100, 0.55, 0.28 + ((ti * 13) % 10) / 100)); });
    pinesIdx.forEach((ti, j) => { const tr = treeData[ti]; for (let k = 0; k < 3; k++) { dummy.position.set(tr.x, tr.h * (0.45 + k * 0.2), tr.z); dummy.scale.setScalar(tr.h * (0.3 - k * 0.07)); dummy.rotation.set(0, ti + k, 0); dummy.updateMatrix(); pine.setMatrixAt(j * 3 + k, dummy.matrix); pine.setColorAt(j * 3 + k, col.setHSL(0.36, 0.45, 0.2 + k * 0.04)); } });
    trunk.castShadow = crown.castShadow = pine.castShadow = shadows; scene.add(trunk, crown, pine);
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: '#78716c', roughness: 0.95, flatShading: true }), rockData.length);
    rockData.forEach((rk, i) => { dummy.position.set(rk.x, rk.r * 0.35, rk.z); dummy.scale.set(rk.r, rk.r * 0.75, rk.r); dummy.rotation.set(i, i * 2, 0); dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix); rocks.setColorAt(i, col.setHSL(0.07, 0.06, 0.38 + (i % 5) * 0.04)); }); rocks.castShadow = shadows; scene.add(rocks);
    // grass tufts (not on low-end devices) and flowers
    if (tier !== 'low') { const n = tier === 'high' ? 9000 : 4500; const blade = new THREE.ConeGeometry(0.07, 0.5, 3); blade.translate(0, 0.25, 0); grassMesh = new THREE.InstancedMesh(blade, new THREE.MeshStandardMaterial({ roughness: 1 }), n); const R = SH.rng(seed + '-grass'); let k = 0;
      for (let i = 0; i < n * 2 && k < n; i++) { const x = (R() - 0.5) * (rmap.size - 6), z = (R() - 0.5) * (rmap.size - 6); if (rmap.boxes.some((bx) => Math.abs(bx.x - x) < bx.w / 2 + 0.5 && Math.abs(bx.z - z) < bx.d / 2 + 0.5)) continue; dummy.position.set(x, 0, z); dummy.rotation.set((R() - 0.5) * 0.4, R() * 6, (R() - 0.5) * 0.4); dummy.scale.setScalar(0.6 + R() * 0.9); dummy.updateMatrix(); grassMesh.setMatrixAt(k, dummy.matrix); grassMesh.setColorAt(k, R() < 0.03 ? col.set(['#f472b6', '#fde047', '#f8fafc', '#a78bfa'][Math.floor(R() * 4)]) : col.setHSL(0.24 + R() * 0.08, 0.55, 0.3 + R() * 0.15)); k++; }
      grassMesh.count = k; scene.add(grassMesh); }
    // clouds and a sun
    const cloudM = new THREE.SpriteMaterial({ map: glowTex(THREE), color: '#ffffff', transparent: true, opacity: 0.75, depthWrite: false, fog: false });
    for (let i = 0; i < 26; i++) { const c = new THREE.Group(); const R = SH.rng(seed + 'c' + i); for (let k = 0; k < 6; k++) { const sp = new THREE.Sprite(cloudM); sp.scale.set(40 + R() * 40, 20 + R() * 12, 1); sp.position.set((R() - 0.5) * 60, (R() - 0.5) * 8, (R() - 0.5) * 30); c.add(sp); } c.position.set((R() - 0.5) * 900, 140 + R() * 60, (R() - 0.5) * 900); c.userData.v = 1.5 + R() * 2; scene.add(c); clouds.push(c); }
    const sunS = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(THREE), color: '#fff7d6', transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending })); sunS.scale.setScalar(160); sunS.position.set(500, 420, -600); scene.add(sunS);
    // chests with a golden light beam
    const chestM = new THREE.MeshStandardMaterial({ color: '#f59e0b', emissive: '#b45309', emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.35 }); const lidM = new THREE.MeshStandardMaterial({ color: '#78350f', roughness: 0.6 });
    chestMeshes = rmap.chests.map((c) => { const g = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(1, 0.7, 0.7), chestM); b.position.y = 0.35; const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(THREE), color: '#fde68a', transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending })); glow.scale.setScalar(2.4); glow.position.y = 0.6; const lid = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.16, 0.74), lidM); lid.position.y = 0.75; const beam = lightBeam('#fde68a', 0.25); g.add(b, glow, lid, beam); g.position.set(c.x, 0, c.z); scene.add(g); return g; });
  }
  function lightBeam(color, op = 0.35) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.5, 14, 10, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })); m.position.y = 7; m.name = 'beam'; return m; }
  if (map) addBoxes(map.boxes);
  if (duel) { for (const [x, z, c] of [[-19, 0, '#f97316'], [19, 0, '#38bdf8'], [0, 0, '#e879f9']]) { const l = new THREE.PointLight(c, 30, 26); l.position.set(x, 4, z); scene.add(l); } }
  // storm wall (royale)
  const stormTex = tex((g) => { const gr = g.createLinearGradient(0, 128, 0, 0); gr.addColorStop(0, 'rgba(168,85,247,.85)'); gr.addColorStop(0.6, 'rgba(124,58,237,.35)'); gr.addColorStop(1, 'rgba(76,29,149,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(240,171,252,${Math.random() * 0.5})`; g.lineWidth = 1 + Math.random() * 2; const x = Math.random() * 128; g.beginPath(); g.moveTo(x, 128); g.lineTo(x + (Math.random() - 0.5) * 30, 0); g.stroke(); } }); stormTex.repeat.set(24, 1);
  const stormWall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 160, 96, 1, true), new THREE.MeshBasicMaterial({ map: stormTex, color: '#d8b4fe', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, fog: false })); stormWall.visible = false; scene.add(stormWall);
  // drop ship
  const ship = new THREE.Group(); { const hull = new THREE.Mesh(new THREE.CapsuleGeometry(2.2, 9, 6, 14), new THREE.MeshStandardMaterial({ color: '#334155', metalness: 0.7, roughness: 0.3 })); hull.rotation.z = Math.PI / 2; const wing = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 16), new THREE.MeshStandardMaterial({ color: '#7c3aed', metalness: 0.5, roughness: 0.4, emissive: '#4c1d95', emissiveIntensity: 0.4 })); const eng = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(THREE), color: '#22d3ee', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); eng.scale.setScalar(5); eng.position.x = -8; const dome = new THREE.Mesh(new THREE.SphereGeometry(1.4, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#67e8f9', emissive: '#0891b2', emissiveIntensity: 0.6, transparent: true, opacity: 0.7, metalness: 0.4, roughness: 0.1 })); dome.position.set(4, 1.6, 0); const stripe = new THREE.Mesh(new THREE.BoxGeometry(12, 0.2, 4.6), new THREE.MeshStandardMaterial({ color: '#f0abfc', emissive: '#e879f9', emissiveIntensity: 1.2 })); for (const zz of [-6, 6]) { const e2 = eng.clone(); e2.position.set(-3, -0.4, zz); e2.scale.setScalar(3); ship.add(e2); } ship.add(hull, wing, eng, dome, stripe); ship.visible = false; scene.add(ship); }
  // builds
  const buildMeshes = new Map(); const builds = new Map();
  const buildMat = new THREE.MeshStandardMaterial({ color: '#b45309', roughness: 0.8, map: MAT.wood.map }); const ghostMat = new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.35, depthWrite: false });
  function pieceMesh(p, mat) {
    const C = SH.CELL; let mesh;
    if (p.k === 'ramp') { mesh = new THREE.Mesh(new THREE.BoxGeometry(C, 0.25, C * Math.SQRT2), mat); mesh.position.set(p.gx * C, p.gy * C + C / 2, p.gz * C); mesh.rotation.order = 'YXZ'; mesh.rotation.y = -(p.dir) * Math.PI / 2; mesh.rotation.x = Math.PI / 4; }
    else if (p.k === 'cone') { mesh = new THREE.Mesh(new THREE.ConeGeometry(C / Math.SQRT2, SH.CONE_H, 4), mat); mesh.rotation.y = Math.PI / 4; mesh.position.set(p.gx * C, p.gy * C + SH.CONE_H / 2, p.gz * C); }
    else { const bs = SH.pieceBoxes(p); mesh = new THREE.Group(); for (const b of bs) { const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mat); m.position.set(b.x, b.y + b.h / 2, b.z); m.castShadow = shadows; m.receiveShadow = shadows; mesh.add(m); } }
    mesh.castShadow = shadows; mesh.receiveShadow = shadows; return mesh;
  }
  function addBuild(p) { if (builds.has(p.id)) return; builds.set(p.id, p); const m = pieceMesh(p, buildMat); m.userData.bid = p.id; scene.add(m); buildMeshes.set(p.id, m); for (const b of SH.pieceBoxes(p)) solidList.push(Object.assign({ bid: p.id }, b)); }
  function removeBuild(id) { builds.delete(id); const m = buildMeshes.get(id); if (m) { scene.remove(m); m.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); } buildMeshes.delete(id); for (let i = solidList.length - 1; i >= 0; i--) if (solidList[i].bid === id) solidList.splice(i, 1); }
  function editBuild(id, ed) { const p = builds.get(id); if (!p) return; removeBuild(id); if (ed) p.ed = ed; else delete p.ed; addBuild(p); }
  // ---------- people ----------
  const ents = new Map(); // id -> { meta, obj, tx,ty,tz,tyaw, hp, alive, w, a }
  const tagSprite = (text, color) => { const c = document.createElement('canvas'); const g = c.getContext('2d'); g.font = '700 38px system-ui'; const tw = Math.ceil(g.measureText(text).width) + 30; c.width = tw; c.height = 56; g.font = '700 38px system-ui'; g.fillStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.roundRect(0, 0, tw, 56, 22); g.fill(); g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 15, 30); const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, depthWrite: false, transparent: true, depthTest: false })); sp.scale.set((tw / 56) * 0.32, 0.32, 1); sp.renderOrder = 10; return sp; };
  // 13.8 realistic weapon models (pistol, SMG, pump shotgun, assault rifle, sniper rifle) built from parts
  const GM = { metal: new THREE.MeshStandardMaterial({ color: '#2b2f36', metalness: 0.85, roughness: 0.32 }), poly: new THREE.MeshStandardMaterial({ color: '#16181c', metalness: 0.2, roughness: 0.7 }), wood: new THREE.MeshStandardMaterial({ color: '#6b4226', metalness: 0, roughness: 0.6 }), glass: new THREE.MeshStandardMaterial({ color: '#0ea5e9', metalness: 0.9, roughness: 0.05, emissive: '#0369a1', emissiveIntensity: 0.4 }) };
  // 13.8 weapon finishes bought with gems (gold, neon, carbon, camo, ice)
  const SKIN_MAT = { gold: new THREE.MeshStandardMaterial({ color: '#d4a017', metalness: 1, roughness: 0.22 }), neon: new THREE.MeshStandardMaterial({ color: '#111827', metalness: 0.6, roughness: 0.3, emissive: '#22d3ee', emissiveIntensity: 0.9 }), carbon: new THREE.MeshStandardMaterial({ color: '#0b0b0d', metalness: 0.4, roughness: 0.45 }), camo: new THREE.MeshStandardMaterial({ color: '#4d5b35', metalness: 0.2, roughness: 0.8 }), ice: new THREE.MeshStandardMaterial({ color: '#bae6fd', metalness: 0.7, roughness: 0.08, emissive: '#7dd3fc', emissiveIntensity: 0.25 }) };
  function gunModel(w, skin) {
    const g = new THREE.Group(); const B = (x, y, z, sx, sy, sz, m, rx = 0) => { const k = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); k.position.set(x, y, z); k.rotation.x = rx; k.castShadow = shadows; g.add(k); return k; };
    const C = (x, y, z, r, len, m) => { const k = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), m); k.rotation.x = Math.PI / 2; k.position.set(x, y, z); g.add(k); return k; };
    if (w === 'pistol') { B(0, 0.03, -0.02, 0.04, 0.045, 0.2, GM.metal); B(0, 0, -0.01, 0.035, 0.03, 0.17, GM.poly); B(0, -0.06, 0.05, 0.034, 0.11, 0.045, GM.poly, -0.25); C(0, 0.03, -0.13, 0.008, 0.04, GM.metal); }
    else if (w === 'smg') { B(0, 0, -0.04, 0.05, 0.07, 0.32, GM.metal); C(0, 0.01, -0.26, 0.012, 0.12, GM.metal); B(0, -0.1, -0.05, 0.03, 0.14, 0.035, GM.poly); B(0, -0.07, 0.07, 0.035, 0.1, 0.04, GM.poly, -0.2); B(0, 0, 0.22, 0.02, 0.05, 0.16, GM.metal); B(0, 0.045, -0.06, 0.02, 0.02, 0.06, GM.metal); }
    else if (w === 'shotgun') { B(0, 0, 0, 0.055, 0.07, 0.28, GM.metal); C(0, 0.012, -0.38, 0.014, 0.5, GM.metal); C(0, -0.024, -0.33, 0.012, 0.42, GM.metal); B(0, -0.026, -0.3, 0.062, 0.05, 0.13, GM.wood); B(0, -0.03, 0.26, 0.05, 0.09, 0.28, GM.wood, 0.12); }
    else if (w === 'lance') { B(0, 0, 0, 0.05, 0.07, 0.4, GM.poly); C(0, 0.012, -0.5, 0.011, 0.6, GM.metal); C(0, 0.085, -0.02, 0.024, 0.3, GM.metal); C(0, 0.085, -0.175, 0.03, 0.03, GM.glass); B(0, 0.055, -0.08, 0.014, 0.03, 0.02, GM.metal); B(0, 0.055, 0.05, 0.014, 0.03, 0.02, GM.metal); B(0, -0.08, -0.02, 0.03, 0.09, 0.06, GM.poly); B(0, -0.03, 0.32, 0.05, 0.11, 0.3, GM.poly, 0.1); B(0, -0.06, -0.42, 0.012, 0.1, 0.012, GM.metal, 0.4); }
    else { B(0, 0, -0.02, 0.055, 0.08, 0.36, GM.metal); B(0, 0, -0.3, 0.06, 0.065, 0.24, GM.poly); C(0, 0.01, -0.5, 0.01, 0.2, GM.metal); B(0, -0.11, -0.07, 0.035, 0.15, 0.06, GM.metal, 0.3); B(0, -0.08, 0.07, 0.035, 0.1, 0.04, GM.poly, -0.2); B(0, -0.01, 0.3, 0.045, 0.1, 0.26, GM.poly, 0.06); B(0, 0.06, -0.05, 0.02, 0.03, 0.05, GM.metal); }
    if (skin && SKIN_MAT[skin]) g.traverse((k) => { if (k.isMesh && (k.material === GM.metal || k.material === GM.poly)) k.material = SKIN_MAT[skin]; });
    return g;
  }
  function swapGun(o, w, skin) { const old = o.userData.gun; if (!old || !old.parent || o.userData.gunW === w || !w) return; const g = gunModel(w, skin); g.rotation.y = Math.PI; g.scale.setScalar(1.15); g.position.copy(old.position); g.visible = old.visible; old.parent.add(g); old.parent.remove(old); o.userData.gun = g; o.userData.gunW = w; }
  let vmW = null; let mySkin = null; function setVm(w) { if (!fp || w === vmW) return; vmW = w; vm.clear(); if (w) { const g = gunModel(w, mySkin); vm.add(g); } }
  const gunGeo = new THREE.BoxGeometry(0.08, 0.1, 0.5); const gunMat = new THREE.MeshStandardMaterial({ color: '#1f2937', metalness: 0.7, roughness: 0.35 });
  let myId = null; let myTeam = null;
  function addEnt(m) {
    if (ents.has(m.id) || m.id === myId) return; const obj = buildHero(THREE, tp ? outfitAv(m.av3 || null, m.lk) : m.av3 || null, AV, { shadows }); const lkd = dressHero(THREE, obj, tp ? m.lk : null);
    const gun = new THREE.Mesh(gunGeo, (tp && lkd.wrap) || gunMat); gun.position.set(0, -0.32, 0.2); obj.userData.R.el.add(gun); obj.userData.gun = gun;
    const friend = ops && m.team === myTeam; const rk = m.user && m.user.rk; const tg = tagSprite((m.bot ? '' : rk ? '[' + L2(rk.n).split(' ')[0].slice(0, 3).toUpperCase() + '] ' : '') + m.name, ops ? (friend ? '#7dd3fc' : '#fca5a5') : duel ? '#fca5a5' : '#ffffff'); tg.position.y = 2.15; tg.visible = friend || royale || duelish; obj.add(tg);
    if (ops) { const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 24), new THREE.MeshBasicMaterial({ color: TEAM[m.team] ? TEAM[m.team][2] : '#fff', transparent: true, opacity: 0.8, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; ring.visible = friend; obj.add(ring); }
    scene.add(obj); ents.set(m.id, { meta: m, obj, tag: tg, tx: 0, ty: 0, tz: 0, tyaw: 0, hp: 100, alive: true, w: 'pistol', a: 0, vy: 0, emote: null, trailT: 0 });
  }
  function delEnt(id) { const e = ents.get(id); if (e) { scene.remove(e.obj); ents.delete(id); } }
  // ---------- me ----------
  const me = { x: 0, y: 0, z: 0, vy: 0, yaw: 0, pitch: 0, hp: 100, armor: 0, alive: true, onGround: true, crouch: 0, inv: [{ w: 'pistol', r: 0 }], slot: 0, money: 800, mats: 0, kit: false, ammo: {}, reloading: 0, cd: 0, inShip: false, falling: false, gliding: false, recoil: 0, scoped: false, buildMode: false, piece: 'wall', rot: 0, pickaxe: royale, heals: { med: 0, sh: 0 }, emote: null, emoteI: 0, lk: null };
  let ranked = !!opts.ranked; let pot = 0; let roundW = null; const drops = new Map(); const lfx = [];
  let phase = 'warm', until = 0, score = { atk: 0, def: 0 }, round = 0, carrier = null, core = null, coreDrop = null, plantBy = null, defuseBy = null, storm = null, shipInfo = null, chestsOpen = new Set(), dead = false, spectate = null, ended = null, kills = 0;
  let myObj = null;
  function makeMe(lk) { if (!tp) return; if (myObj) scene.remove(myObj); me.lk = lk || null; myObj = buildHero(THREE, outfitAv(S.me.av3 || null, lk), AV, { shadows }); const lkd = dressHero(THREE, myObj, lk); const g = new THREE.Mesh(gunGeo, lkd.wrap || gunMat); g.position.set(0, -0.32, 0.2); myObj.userData.R.el.add(g); myObj.userData.gun = g; scene.add(myObj); }
  // first-person viewmodel (ops)
  const vm = new THREE.Group(); if (fp) { cam.add(vm); vm.position.set(0.2, -0.2, -0.42); }
  const flash = new THREE.PointLight('#ffcf6b', 0, 6); cam.add(flash); flash.position.set(0.2, -0.15, -0.9);
  const curW = () => (me.pickaxe && canBuild ? null : (me.inv[me.slot] || me.inv[0] || {}).w || null);
  const curR = () => (me.inv[me.slot] || {}).r || 0;
  const ammoOf = (w) => (me.ammo[w] === undefined ? (me.ammo[w] = SH.WEAPONS[w].mag) : me.ammo[w]);
  // ---------- network ----------
  const offs = [];
  const onWs = (k, fn) => offs.push(bus.on('ws:' + k, fn));
  onWs('ar_hello', (m) => {
    myId = m.you; phase = m.phase; until = m.until; score = m.score || score; round = m.round || 0; carrier = m.carrier; core = m.core; coreDrop = m.coreDrop; storm = m.storm; shipInfo = m.ship;
    const mine = m.ents.find((x) => x.id === myId); myTeam = mine ? mine.team : null; ranked = !!m.ranked; pot = m.pot || 0;
    if (royale) { if (!rmap) buildRoyale(m.seed); (m.chests || []).forEach((i) => openChestMesh(i)); (m.builds || []).forEach(addBuild); (m.drops || []).forEach(addDrop); makeMe(mine && mine.lk); } else if (bf) { (m.builds || []).forEach(addBuild); makeMe(mine && mine.lk); }
    mySkin = (mine && mine.skin) || null; vmW = null;
    if ((ops || duel) && m.seed && m.seed !== mapSeed && (ops ? SH.OPS_MAPS : SH.DUEL_MAPS).includes(m.seed)) rebuildMap(m.seed);
    setTimeout(buildEnv, 300);
    for (const x of m.ents) addEnt(x); Object.assign(me, { x: m.me.x, z: m.me.z, yaw: m.me.yaw || 0, hp: m.me.hp, alive: m.me.alive, inv: m.me.inv, money: m.me.money, armor: m.me.armor, mats: m.me.mats || 0, inShip: !!m.me.inShip, heals: m.me.heals || { med: 0, sh: 0 } }); me.slot = 0; dead = !me.alive; paintHud();
  });
  onWs('ar_ent', (m) => addEnt(m.e)); onWs('ar_gone', (m) => delEnt(m.id));
  onWs('ar_s', (m) => { for (const r of m.l) { const [id, x, y, z, yaw, pitch, hp, alive, w, a] = r; if (id === myId) { me.hp = hp; if (!alive && me.alive) die(); if (alive && !me.alive && royale === false) { me.alive = true; dead = false; } continue; } const e = ents.get(id); if (!e) continue; e.vy = (y - e.ty) * 7; e.tx = x; e.ty = y; e.tz = z; e.tyaw = yaw; e.hp = hp; e.alive = !!alive; e.w = w; e.a = a; } if (m.pl !== undefined) plantBy = m.pl; if (m.st && storm) { storm.cx = m.st[0]; storm.cz = m.st[1]; storm.r = m.st[2]; } });
  onWs('ar_you', (m) => { if (m.money !== undefined) me.money = m.money; if (m.inv) { me.inv = m.inv; if (me.slot >= me.inv.length) me.slot = 0; } if (m.armor !== undefined) me.armor = m.armor; if (m.kit !== undefined) me.kit = m.kit; if (m.mats !== undefined) me.mats = m.mats; if (m.x !== undefined) { me.x = m.x; me.z = m.z; me.y = 0; me.vy = 0; me.yaw = m.yaw || 0; me.pitch = 0; me.hp = m.hp || 100; me.alive = true; dead = false; spectate = null; me.ammo = {}; me.slot = 0; } if (m.heals) me.heals = m.heals; if (m.got) { const R = SH.RARITY[m.got.r]; toast(L2(SH.WEAPONS[m.got.w].n) + ' · ' + L2(R.n), 'good', 1800); snd('coin'); } if (m.gotHeal) toast(L2(SH.HEALS[m.gotHeal].n), 'good', 1500); if (m.healed) snd('coin'); paintHud(); });
  onWs('ar_pos', (m) => { me.x = m.x; me.z = m.z; if (m.y !== undefined) me.y = m.y; });
  onWs('ar_hurt', (m) => { me.hp = m.hp; me.armor = m.armor; if (m.heal) { paintHud(); return; } hurt.classList.remove('on'); void hurt.offsetWidth; hurt.classList.add('on'); snd('lose'); if (m.by) { const e = ents.get(m.by); if (e) showDir(e); } });
  onWs('ar_hit', (m) => { if (m.dmg) dmgNumber(m.id, m.dmg, m.head, m.shield); hitm.className = 'ar-hitm on' + (m.head ? ' head' : '') + (m.kill ? ' kill' : ''); setTimeout(() => { hitm.className = 'ar-hitm'; }, 160); snd(m.kill ? 'coin' : 'tick'); });
  onWs('ar_kill', (m) => { const el = h('div.ar-k', m.an ? h('b', { style: colorOf(m.a) }, m.an) : h('span', icon(m.w === 'storm' ? 'storm' : 'zap', 13)), h('span.ar-kw', ' ' + (m.head ? '[HS] ' : '') + (m.w && SH.WEAPONS[m.w] ? L2(SH.WEAPONS[m.w].n) : m.w === 'storm' ? t('Storm') : m.w === 'core' ? t('Core') : '') + ' '), h('b', { style: colorOf(m.b) }, m.bn)); feedEl.prepend(el); setTimeout(() => el.remove(), 5000); while (feedEl.children.length > 6) feedEl.lastChild.remove(); if (m.a === myId) { kills++; } if (m.x !== undefined && m.w !== 'storm') elimBurst(THREE, scene, lfx, { x: m.x, y: m.y || 0, z: m.z }, m.fx || (m.a === myId && me.lk && me.lk.elim) || null); });
  const colorOf = (id) => { if (id === myId) return 'color:#fde047'; const e = ents.get(id); return ops && e ? 'color:' + (TEAM[e.meta.team] || TEAM.atk)[2] : ''; };
  onWs('ar_round', (m) => { round = m.round; score = m.score; phase = 'buy'; until = m.until; carrier = m.carrier; core = null; coreDrop = null; defuseBy = null; ended = null; roundW = m.weapon || null; me.ammo = {}; if (bf) { me.slot = 0; me.pickaxe = false; me.buildMode = false; } if (duelish) banner(t('Round {n}', { n: m.round }), m.weapon ? L2(SH.WEAPONS[m.weapon].n) : t('Build and fight!'), '#fde68a'); else banner(t('Round {n}', { n: m.round }), t('Buy phase — press B'), '#fde68a'); });
  onWs('ar_phase', (m) => { phase = m.phase; if (m.until) until = m.until; if (m.phase === 'live' && fp) banner(t('Go!'), carrier === myId ? t('You carry the plasma core') : '', '#86efac'); if (m.phase === 'live' && royale) storm && banner(t('Storm incoming'), '', '#c4b5fd'); });
  onWs('ar_rend', (m) => { score = m.score; phase = 'post'; const won = m.winner === myTeam; if (duelish) { banner(!m.winner ? t('Draw') : won ? t('Point for you') : t('Point for your rival'), `${score[myTeam] || 0} : ${score[myTeam === 'atk' ? 'def' : 'atk'] || 0}`, !m.winner ? '#e5e7eb' : won ? '#86efac' : '#fca5a5'); snd(won ? 'win' : 'lose'); return; } banner(won ? t('Round won') : t('Round lost'), L2(TEAM[m.winner]) + ' · ' + ({ elim: t('team eliminated'), time: t('time is up'), core: t('the core exploded'), defused: t('the core was defused') }[m.why] || ''), won ? '#86efac' : '#fca5a5'); snd(won ? 'win' : 'lose'); });
  onWs('ar_core', (m) => { if (m.core) { core = m.core; until = m.core.boom; carrier = null; banner(t('Core planted'), t('Site {s}', { s: m.core.site }), '#f87171'); snd('spin'); } if (m.carrier) { carrier = m.carrier; coreDrop = null; } if (m.drop) { coreDrop = m.drop; carrier = null; } if (m.defused) { core = null; defuseBy = null; } if (m.boom) { coreBoom(m.boom); core = null; } });
  onWs('ar_defuse', (m) => { defuseBy = m.id; });
  onWs('ar_end', (m) => { ended = m; showEnd(m); });
  onWs('ar_ship', (m) => { shipInfo = m.ship; storm = m.storm; phase = 'ship'; me.inShip = true; me.alive = true; dead = false; me.inv = []; me.slot = 0; me.pickaxe = true; me.mats = 100; me.heals = { med: 0, sh: 0 }; for (const x of m.ents) addEnt(x); banner(t('Jump from the ship'), t('Press Space when you want to drop'), '#c4b5fd'); });
  onWs('ar_jumped', (m) => { if (m.id === myId) { me.inShip = false; me.falling = true; me.y = 88; const p = shipPos(); me.x = p.x; me.z = p.z; me.vy = 0; snd('click'); } });
  onWs('ar_storm', (m) => { storm = m.storm; if (m.storm.shrinking) banner(t('The storm is closing in'), '', '#c4b5fd'); });
  onWs('ar_chest', (m) => openChestMesh(m.i));
  onWs('ar_build', (m) => { addBuild(m.p); }); onWs('ar_unbuild', (m) => removeBuild(m.id)); onWs('ar_bhp', () => {}); onWs('ar_bedit', (m) => editBuild(m.id, m.ed)); onWs('ar_bclear', () => { for (const id of [...builds.keys()]) removeBuild(id); });
  onWs('ar_out', (m) => { dead = true; me.alive = false; banner(t('Eliminated'), t('Place #{n}', { n: m.place }) + (m.by ? ' · ' + t('by {n}', { n: m.by }) : '') + (m.rk ? ` · ${m.rk.delta > 0 ? '+' : ''}${m.rk.delta} RP` : ''), '#fca5a5'); });
  onWs('ar_drop', (m) => addDrop(m)); onWs('ar_undrop', (m) => { const d = drops.get(m.id); if (d) { scene.remove(d.g); drops.delete(m.id); } });
  onWs('ar_qc', (m) => { const q = SH.QUICK[m.i]; if (!q) return; const el = h('div.ar-k.ar-qc', h('b', { style: colorOf(m.id) }, m.n), h('span', ' ' + L2(q))); feedEl.prepend(el); setTimeout(() => el.remove(), 6000); while (feedEl.children.length > 7) feedEl.lastChild.remove(); if (m.id !== myId) snd('tick'); });
  onWs('ar_emote', (m) => { if (m.id === myId) return; const e = ents.get(m.id); if (e) e.emote = { k: m.k, t: 0 }; });
  onWs('ar_closed', (m) => { if (ended && royale) return; toast(m && m.why === 'gone' ? t('That duel is not available any more.') : t('The match is over.'), 'info'); ctx.go('arena'); });
  onWs('ar_fx', (m) => { const e = ents.get(m.id); if (!e) return; if (m.to) tracer(new THREE.Vector3(e.obj.position.x, e.obj.position.y + 1.4, e.obj.position.z), new THREE.Vector3(m.to[0], m.to[1], m.to[2]), '#fde68a'); const d = Math.hypot(e.obj.position.x - me.x, e.obj.position.z - me.z); if (d < 60 && Math.random() < 0.7) snd('tick'); });
  const joinMsg = () => ({ t: 'ar_join', game, ranked: !!opts.ranked, room: opts.room || undefined });
  onWs('open', () => ws.send(joinMsg()));
  ws.send(joinMsg());
  function addDrop(d) { if (drops.has(d.id)) return; const g = new THREE.Group(); const c = SH.RARITY[d.r || 0].c; const bx = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.4, 0.6), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.5, metalness: 0.4, roughness: 0.4 })); bx.position.y = 0.2; g.add(bx, lightBeam(c, 0.4)); g.position.set(d.x, 0, d.z); scene.add(g); drops.set(d.id, { g, x: d.x, z: d.z }); }
  function openChestMesh(i) { chestsOpen.add(i); const g = chestMeshes[i]; if (g) { g.children[0].material = new THREE.MeshStandardMaterial({ color: '#57534e' }); g.children[1].visible = false; if (g.children[2]) { g.children[2].rotation.x = -1.2; g.children[2].position.set(0, 0.95, -0.35); } if (g.children[3]) g.children[3].visible = false; } }
  function shipPos() { if (!shipInfo) return { x: 0, z: 0, k: 0 }; const k = Math.min(1, (Date.now() - shipInfo.at) / shipInfo.dur); return { x: shipInfo.x0 + (shipInfo.x1 - shipInfo.x0) * k, z: shipInfo.z0 + (shipInfo.z1 - shipInfo.z0) * k, k }; }
  // ---------- fx ----------
  const fxList = [];
  function tracer(a, b, color) { const g = new THREE.BufferGeometry().setFromPoints([a, b]); const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 })); scene.add(l); fxList.push({ o: l, t: performance.now(), life: 90 }); }
  function spark(p, color = '#ffc06b') { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(THREE), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); s.scale.setScalar(0.35); s.position.copy(p); scene.add(s); fxList.push({ o: s, t: performance.now(), life: 160 }); }
  function coreBoom(c) { for (let i = 0; i < 30; i++) spark(new THREE.Vector3(c.x + (Math.random() - 0.5) * 6, Math.random() * 5, c.z + (Math.random() - 0.5) * 6), i % 2 ? '#f97316' : '#fde047'); snd('big'); }
  const coreMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), new THREE.MeshStandardMaterial({ color: '#f472b6', emissive: '#ec4899', emissiveIntensity: 1.5 })); coreMesh.visible = false; scene.add(coreMesh);
  const siteMarks = []; const siteLabels = []; if (ops) for (const [k, s] of Object.entries(map.sites)) { const ring = new THREE.Mesh(new THREE.RingGeometry(s.r - 0.2, s.r, 48), new THREE.MeshBasicMaterial({ color: '#f472b6', transparent: true, opacity: 0.5, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.set(s.x, 0.04, s.z); scene.add(ring); const lab = tagSprite(k, '#f472b6'); lab.position.set(s.x, 3.4, s.z); lab.scale.multiplyScalar(2.2); scene.add(lab); siteMarks.push(ring); siteLabels.push(lab); }
  // 13.8: rooms pick a map (Ops: Depot / Harbor · Duels: Prism Court / Neon Yard / Stone Temple); rebuild when it differs
  function rebuildMap(seed) {
    for (const m2 of mapMeshes) { scene.remove(m2); m2.geometry.dispose(); } mapMeshes.length = 0;
    for (let i = solidList.length - 1; i >= 0; i--) if (!solidList[i].bid) solidList.splice(i, 1);
    map = ops ? SH.opsMap(seed) : SH.duelMap(seed); mapSeed = seed; addBoxes(map.boxes);
    if (ops) { for (const r2 of siteMarks) scene.remove(r2); for (const l2 of siteLabels) scene.remove(l2); siteMarks.length = 0; siteLabels.length = 0;
      for (const [k, s2] of Object.entries(map.sites)) { const ring = new THREE.Mesh(new THREE.RingGeometry(s2.r - 0.2, s2.r, 48), new THREE.MeshBasicMaterial({ color: '#f472b6', transparent: true, opacity: 0.5, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.set(s2.x, 0.04, s2.z); scene.add(ring); const lab = tagSprite(k, '#f472b6'); lab.position.set(s2.x, 3.4, s2.z); lab.scale.multiplyScalar(2.2); scene.add(lab); siteMarks.push(ring); siteLabels.push(lab); } }
    const tt = root.querySelector('.ar-title'); if (tt && tt.firstChild) tt.firstChild.textContent = (ops ? 'Nebula Ops · ' + map.name : t('Duels') + ' · ' + map.name);
  }
  // 13.8 reflections: the scene is captured once into an environment map, so polished floors, metal and glass reflect it
  let envTex = null;
  function buildEnv() {
    try { const pm = new THREE.PMREMGenerator(renderer); const rt = new THREE.WebGLCubeRenderTarget(tier === 'low' ? 64 : 256); const cc = new THREE.CubeCamera(0.3, 600, rt); cc.position.set(royale ? me.x : 0, royale ? 6 : 2.4, royale ? me.z : 0); scene.add(cc); const vis = vm.visible; vm.visible = false; cc.update(renderer, scene); vm.visible = vis; scene.remove(cc);
      if (envTex) envTex.dispose(); envTex = pm.fromCubemap(rt.texture).texture; scene.environment = envTex; rt.dispose(); pm.dispose(); } catch (e) { console.warn('[arena] env map', e); }
  }
  // floating damage numbers over the target (shield hits in blue, headshots in yellow)
  const tmpP = new THREE.Vector3();
  function dmgNumber(id, n, head, sh) { const e = ents.get(id); if (!e || !cfg.dmgNums) return; tmpP.set(e.obj.position.x + (Math.random() - 0.5) * 0.6, e.obj.position.y + 2, e.obj.position.z).project(cam); if (tmpP.z > 1) return; const el = h('div.ar-dmg' + (head ? '.head' : '') + (sh ? '.sh' : ''), String(Math.round(n))); el.style.left = ((tmpP.x + 1) / 2 * 100) + '%'; el.style.top = ((1 - tmpP.y) / 2 * 100) + '%'; box.append(el); setTimeout(() => el.remove(), 900); }
  function banner(title, sub, color) { const b = h('div.ar-banner', { style: { '--bc': color } }, h('b', title), sub ? h('span', sub) : null); center.append(b); setTimeout(() => b.remove(), 2600); }
  let dirT = 0; function showDir(e) { const ang = Math.atan2(e.obj.position.x - me.x, e.obj.position.z - me.z) - (me.yaw + Math.PI); const el = h('div.ar-dir', { style: { transform: `rotate(${-ang}rad)` } }); box.append(el); clearTimeout(dirT); setTimeout(() => el.remove(), 900); }
  // ---------- input ----------
  const keys = new Set(); let mouseDown = false; let aim = false; const cv = renderer.domElement; const locked = () => document.pointerLockElement === cv;
  cv.addEventListener('click', () => { if (!locked() && !ended) { try { const p = cv.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch {} } });
  cv.addEventListener('mousedown', (e) => { if (!locked()) return; if (e.button === 0) { mouseDown = true; if (me.buildMode) placeBuild(); else tryShoot(); } if (e.button === 2) { aim = true; if (curW() && SH.WEAPONS[curW()].scope) me.scoped = true; } });
  const onUp = (e) => { if (e.button === 0) mouseDown = false; if (e.button === 2) { aim = false; me.scoped = false; } }; document.addEventListener('mouseup', onUp);
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  const sens = () => (me.scoped ? 0.0006 * cfg.ads : aim ? 0.0013 * cfg.ads : 0.0022) * cfg.sens;
  const onMove = (e) => { if (!locked()) return; me.yaw -= e.movementX * sens(); me.pitch = Math.max(-1.45, Math.min(1.45, me.pitch - e.movementY * sens() * (cfg.invert ? -1 : 1))); }; document.addEventListener('mousemove', onMove);
  const onWheel = (e) => { if (!locked() || !canBuild) return; const n = me.inv.length; if (!n) return; if (me.pickaxe) { me.pickaxe = false; me.slot = e.deltaY > 0 ? 0 : n - 1; } else { me.slot = (me.slot + (e.deltaY > 0 ? 1 : -1) + n) % n; } me.reloading = 0; paintHud(); }; cv.addEventListener('wheel', onWheel, { passive: true });
  let holdE = null; let buyOpen = false;
  const onKey = (e) => {
    if (!box.isConnected || cfgOpen) return; const k = String(e.key || '').toLowerCase();
    if (e.type === 'keyup') { keys.delete(k); if (k === 'e') holdE = null; return; }
    if (/^f[1-9]$/.test(k) && locked()) e.preventDefault();
    if (k === 'p' && !e.repeat) { openCfg(); return; }
    if (['w', 'a', 's', 'd', ' ', 'shift', 'c'].includes(k) && locked()) e.preventDefault(); keys.add(k);
    if (k === 'r') { if (me.buildMode) { me.rot = (me.rot + 1) % 4; } else reload(); }
    // quick chat wheel (13.8): N opens it, 1–8 sends a preset phrase
    if (qcOpen && /^[1-8]$/.test(k)) { ws.send({ t: 'ar_qc', i: Number(k) - 1 }); qcOpen = false; qcEl.classList.add('hide'); return; }
    if (k === 'n' && !e.repeat) { qcOpen = !qcOpen; mount(qcEl, h('b', t('Quick chat')), SH.QUICK.map((q, i) => h('div', h('i', String(i + 1)), L2(q)))); qcEl.classList.toggle('hide', !qcOpen); return; }
    if (dead && tp && !ended && (k === ' ' || k === 'arrowright')) { specNext(1); return; }
    if (dead && tp && !ended && k === 'arrowleft') { specNext(-1); return; }
    if (k === ' ') { if (me.inShip) ws.send({ t: 'ar_jump' }); else if (me.onGround && me.alive) { me.vy = 7; me.onGround = false; } }
    if (k === 'e') { holdE = holdE || performance.now(); if (royale) openNearChest(); }
    if (royale && (k === 'h' || k === 'j') && me.alive && !me.inShip) { const kk = k === 'h' ? 'med' : 'sh'; if (me.heals[kk] > 0) { ws.send({ t: 'ar_use', k: kk }); snd('click'); } else toast(t('You have none — find them in chests'), 'info', 1300); }
    if (k === 't' && tp && me.alive && !me.inShip && myObj) { const list = ['wave'].concat(((me.lk && me.lk.emotes) || []).map((x) => x.k)); const em = list[me.emoteI++ % list.length]; me.emote = { k: em, t: 0 }; ws.send({ t: 'ar_emote', k: em }); }
    if (ops && k === 'b') toggleBuy(); if (fp && /^[1-3]$/.test(k)) { me.slot = Math.min(Number(k) - 1, me.inv.length - 1); me.reloading = 0; paintHud(); }
    if (canBuild) {
      const K = cfg.keys; const pk = PIECES.map((x) => x[0]).find((p) => K[p] === k);
      if (k === K.build) { me.buildMode = !me.buildMode; paintHud(); }
      else if (pk && me.alive && !me.inShip) { me.buildMode = true; me.pickaxe = false; me.piece = pk; paintHud(); }
      else if (k === K.edit && !e.repeat) tryEdit();
      if (me.buildMode && /^[1-4]$/.test(k)) { me.piece = PIECES[Number(k) - 1][0]; paintHud(); }
      else if (/^[1-5]$/.test(k) && me.inv[Number(k) - 1]) { me.buildMode = false; me.pickaxe = false; me.slot = Number(k) - 1; me.reloading = 0; ws.send({ t: 'ar_slot', i: me.slot }); paintHud(); }
      if (k === '0' || k === K.pickaxe) { me.pickaxe = true; me.buildMode = false; paintHud(); }
    }
    if (k === 'tab') { e.preventDefault(); showBoard(true); }
  };
  const onKeyUp2 = (e) => { if (e.key === 'Tab') showBoard(false); };
  document.addEventListener('keydown', onKey); document.addEventListener('keyup', onKey); document.addEventListener('keyup', onKeyUp2);
  // ---------- buy menu (ops) ----------
  const buyEl = h('div.ar-buy.hide'); box.append(buyEl);
  function toggleBuy(force) { buyOpen = force === undefined ? !buyOpen : force; if (buyOpen && !(phase === 'buy' || (phase === 'live' && Date.now() < until - 90000))) { buyOpen = false; toast(t('You can only buy at the start of the round.'), 'info', 1500); } buyEl.classList.toggle('hide', !buyOpen); if (buyOpen) { if (locked()) document.exitPointerLock(); paintBuy(); } }
  function paintBuy() {
    const item = (id, name, price, desc) => h('button.ar-bi' + (me.money < price ? '.no' : ''), { onClick: () => { ws.send({ t: 'ar_buy', item: id }); snd('coin'); setTimeout(paintBuy, 250); } }, h('b', name), h('span.coin', '$' + fmt.num(price)), h('span.tiny.muted', desc));
    mount(buyEl, h('div.ar-buyh', h('b.grow', t('Buy')), h('span.ar-money', '$' + fmt.num(me.money)), h('button.btn.sm', { onClick: () => toggleBuy(false) }, t('Close') + ' (B)')),
      h('div.ar-buyg', ['smg', 'shotgun', 'rifle', 'lance'].map((w) => item(w, L2(SH.WEAPONS[w].n), SH.WEAPONS[w].price, `${SH.WEAPONS[w].dmg}${SH.WEAPONS[w].pellets ? '×' + SH.WEAPONS[w].pellets : ''} ${t('dmg')} · ${SH.WEAPONS[w].mag} ${t('rounds')}`)),
        item('armor', t('Armor'), SH.ARMOR_PRICE, t('Halves the damage you take')), myTeam === 'def' ? item('kit', t('Defuse kit'), SH.KIT_PRICE, t('Defuse in 3 s instead of 5')) : null));
  }
  // ---------- shooting ----------
  const ray = new THREE.Ray(); const tmpV = new THREE.Vector3(); const tmpB = new THREE.Box3();
  function rayHit(origin, dir, maxD) {
    ray.set(origin, dir); let best = { d: maxD, kind: null };
    for (const b of solidList) { tmpB.min.set(b.x - b.w / 2, b.y || 0, b.z - b.d / 2); tmpB.max.set(b.x + b.w / 2, (b.y || 0) + b.h, b.z + b.d / 2); if (ray.intersectBox(tmpB, tmpV)) { const d = tmpV.distanceTo(origin); if (d < best.d) best = { d, kind: b.bid ? 'build' : 'wall', bid: b.bid, p: tmpV.clone() }; } }
    if (royale) { for (const [i, tr] of treeData.entries()) { const dx = tr.x - origin.x, dz = tr.z - origin.z; const along = dx * dir.x + dz * dir.z; if (along <= 0 || along > best.d) continue; const px = origin.x + dir.x * along, pz = origin.z + dir.z * along; const py = origin.y + dir.y * along; if (Math.hypot(px - tr.x, pz - tr.z) < 0.5 && py < tr.h) best = { d: along, kind: 'tree', i, p: new THREE.Vector3(px, py, pz) }; } }
    if (dir.y < 0) { const d = (origin.y) / -dir.y; if (d < best.d) best = { d, kind: 'ground', p: origin.clone().addScaledVector(dir, d) }; }
    for (const [id, e] of ents) { if (!e.alive || (ops && e.meta.team === myTeam)) continue; const p = e.obj.position; for (const [cy, r, head] of [[1.62, 0.26, true], [1.08, 0.4, false], [0.5, 0.32, false]]) { const c = tmpV.set(p.x, p.y + cy, p.z); const toC = c.clone().sub(origin); const along = toC.dot(dir); if (along < 0 || along > best.d) continue; const dd = toC.lengthSq() - along * along; if (dd < r * r) { best = { d: along, kind: 'ent', id, head, p: origin.clone().addScaledVector(dir, along) }; break; } } }
    return best;
  }
  function tryShoot() {
    if (!me.alive || me.inShip || buyOpen || phase === 'buy' || phase === 'warm' && ops) return;
    if (canBuild && me.pickaxe) return swingPickaxe();
    const w = curW(); if (!w) return; const W = SH.WEAPONS[w]; if (me.reloading > 0 || me.cd > 0) return;
    if (ammoOf(w) <= 0) return reload();
    me.ammo[w]--; me.cd = W.rate; flash.intensity = 6; setTimeout(() => { flash.intensity = 0; }, 50); snd('click');
    const moving = keys.has('w') || keys.has('a') || keys.has('s') || keys.has('d');
    let spread = W.spread * (moving ? 1.9 : 1) * (me.crouch > 0.5 ? 0.6 : 1) * (aim ? 0.55 : 1) * (me.onGround ? 1 : 2.5); if (W.scope && me.scoped) spread = moving ? 0.012 : W.scopeSpread;
    const origin = cam.getWorldPosition(new THREE.Vector3()); const hits = []; const blds = []; let lastP = null;
    for (let i = 0; i < (W.pellets || 1); i++) {
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion); dir.x += (Math.random() - 0.5) * 2 * spread; dir.y += (Math.random() - 0.5) * 2 * spread; dir.z += (Math.random() - 0.5) * 2 * spread; dir.normalize();
      const r = rayHit(origin, dir, W.range); const end = r.p || origin.clone().addScaledVector(dir, W.range); lastP = end;
      if (r.kind === 'ent') { hits.push({ id: r.id, head: r.head }); spark(end, r.head ? '#f472b6' : '#a78bfa'); } else { if (r.kind === 'build') blds.push(r.bid); if (r.p) spark(end); }
      if (i === 0 || i % 3 === 0) tracer(origin.clone().add(new THREE.Vector3(0.2, -0.15, -0.4).applyQuaternion(cam.quaternion)), end, '#ffe08a');
    }
    ws.send({ t: 'ar_shot', w, hits, builds: [...new Set(blds)], to: lastP ? [lastP.x, lastP.y, lastP.z] : null });
    me.recoil = Math.min(0.1, me.recoil + (W.pellets ? 0.04 : W.rate > 0.5 ? 0.05 : 0.012)); me.pitch = Math.min(1.45, me.pitch + me.recoil * 0.25); if (W.scope) me.scoped = false;
  }
  function reload() { const w = curW(); if (!w) return; const W = SH.WEAPONS[w]; if (me.reloading > 0 || ammoOf(w) >= W.mag) return; me.reloading = W.reload; me.scoped = false; }
  function swingPickaxe() {
    if (me.cd > 0) return; me.cd = 0.45; snd('click'); const origin = cam.getWorldPosition(new THREE.Vector3()); const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion); const r = rayHit(origin, dir, tp ? 7.5 : 3);
    const near = r.p && Math.hypot(r.p.x - me.x, r.p.z - me.z) < 3.2; if (!near) return; spark(r.p, '#fde68a');
    if (r.kind === 'tree') ws.send({ t: 'ar_harvest', i: r.i }); else if (r.kind === 'build') ws.send({ t: 'ar_hitbuild', id: r.bid }); else if (r.kind === 'ent') ws.send({ t: 'ar_shot', w: 'pistol', hits: [] });
    else { const ri = rockData.findIndex((k) => Math.hypot(k.x - r.p.x, k.z - r.p.z) < k.r + 0.6); if (ri >= 0) ws.send({ t: 'ar_harvest', rock: ri }); }
  }
  function openNearChest() { if (!rmap) return; for (const [id, d] of drops) if (Math.hypot(d.x - me.x, d.z - me.z) < 2.6) { ws.send({ t: 'ar_pick', id }); return; } let bi = -1, bd = 2.6; rmap.chests.forEach((c, i) => { if (chestsOpen.has(i)) return; const d = Math.hypot(c.x - me.x, c.z - me.z); if (d < bd) { bd = d; bi = i; } }); if (bi >= 0) ws.send({ t: 'ar_open', i: bi }); }
  // ---------- building (royale) ----------
  const ghost = new THREE.Group(); scene.add(ghost); let ghostPiece = null;
  function aimPiece() {
    const C = SH.CELL; const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw); const gx0 = Math.round(me.x / C), gz0 = Math.round(me.z / C); const zMajor = Math.abs(fz) >= Math.abs(fx);
    const lvl = Math.max(0, Math.floor((me.y + 0.2) / C)); const up = me.pitch > 0.45 ? 1 : 0;
    if (me.piece === 'wall') return zMajor ? { k: 'wall', gx: gx0, gy: lvl, gz: fz < 0 ? gz0 : gz0 + 1, dir: 0 } : { k: 'wall', gx: fx < 0 ? gx0 : gx0 + 1, gy: lvl, gz: gz0, dir: 1 };
    const gx = gx0 + (zMajor ? 0 : Math.sign(fx)), gz = gz0 + (zMajor ? Math.sign(fz) : 0);
    if (me.piece === 'floor') return { k: 'floor', gx, gy: lvl + up, gz, dir: 0 };
    if (me.piece === 'cone') return { k: 'cone', gx, gy: lvl + up, gz, dir: 0 };
    const face = zMajor ? (fz < 0 ? 0 : 2) : (fx > 0 ? 1 : 3); return { k: 'ramp', gx, gy: lvl, gz, dir: (face + me.rot) % 4 };
  }
  function paintGhost() { ghost.clear(); ghostPiece = null; if (!canBuild || !me.buildMode || !me.alive || me.inShip) return; const p = aimPiece(); ghostPiece = p; ghost.add(pieceMesh(p, ghostMat)); }
  // turbo building: holding the button keeps placing as the aimed spot changes
  let lastPlace = { key: '', t: 0 };
  function placeBuild(turbo) {
    if (!ghostPiece) return; const key = [ghostPiece.k, ghostPiece.gx, ghostPiece.gy, ghostPiece.gz, ghostPiece.dir].join(','); const tn = performance.now();
    if (turbo && (key === lastPlace.key || tn - lastPlace.t < 90)) return;
    if (bf && phase !== 'live') return;
    if (me.mats < SH.BUILD_COST) { if (!turbo) toast(bf ? t('Not enough materials.') : t('Not enough materials. Hit trees and rocks with the pickaxe.'), 'info', 1600); return; }
    if ([...builds.values()].some((q) => q.k === ghostPiece.k && q.gx === ghostPiece.gx && q.gy === ghostPiece.gy && q.gz === ghostPiece.gz && (q.k !== 'wall' || q.dir === ghostPiece.dir))) { lastPlace = { key, t: tn }; return; }
    lastPlace = { key, t: tn }; ws.send(Object.assign({ t: 'ar_build' }, ghostPiece)); snd('tick');
  }
  // edit the wall you are looking at (your own): full → door → window → arch → full
  function tryEdit() {
    if (!me.alive || me.inShip) return; const origin = cam.getWorldPosition(new THREE.Vector3()); const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion); const r = rayHit(origin, dir, 10);
    if (r.kind !== 'build') return; const p = builds.get(r.bid); if (!p) return;
    if (p.k !== 'wall') { toast(t('Only walls can be edited'), 'info', 1200); return; } if (p.owner !== myId) { toast(t('You can only edit your own builds'), 'info', 1200); return; }
    const order = [null].concat(SH.WALL_EDITS); const next = order[(order.indexOf(p.ed || null) + 1) % order.length]; ws.send({ t: 'ar_edit', id: p.id, ed: next }); snd('tick');
  }
  // ---------- physics ----------
  function groundAt(x, z, y) {
    let g = 0; for (const b of solidList) { const top = (b.y || 0) + b.h; if (top <= y + 0.5 && Math.abs(x - b.x) < b.w / 2 + 0.25 && Math.abs(z - b.z) < b.d / 2 + 0.25) g = Math.max(g, top); }
    if (canBuild) { for (const p of builds.values()) { const ry = p.k === 'ramp' ? SH.rampY(p, x, z) : p.k === 'cone' ? SH.coneY(p, x, z) : null; if (ry !== null && ry <= y + 0.6) g = Math.max(g, ry); } }
    return g;
  }
  function hitsWall(x, z, y) {
    const r = SH.PLAYER_R; const hgt = me.crouch > 0.5 ? 1.2 : 1.75;
    for (const b of solidList) { const by = b.y || 0; if (y + hgt > by && y < by + b.h - 0.45 && Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r) return true; }
    if (royale) { for (const tr of treeData) if (Math.abs(tr.x - x) < 1 && Math.abs(tr.z - z) < 1 && Math.hypot(tr.x - x, tr.z - z) < tr.r + r) return true; for (const k of rockData) if (y < k.r * 0.7 && Math.hypot(k.x - x, k.z - z) < k.r * 0.9 + r) return true; if (Math.abs(x) > rmap.half || Math.abs(z) > rmap.half) return true; }
    else if (Math.abs(x) > map.size.w - 1 || Math.abs(z) > map.size.d - 1) return true;
    return false;
  }
  // ---------- HUD ----------
  function paintHud() {
    const w = curW(); const W = w && SH.WEAPONS[w];
    const hpBar = h('div.ar-bars', h('div.ar-bar.hp', h('i', { style: { width: Math.max(0, me.hp) + '%' } }), h('b', icon('cross', 12), ' ' + Math.max(0, Math.ceil(me.hp)))), me.armor > 0 || tp ? h('div.ar-bar.sh', h('i', { style: { width: Math.max(0, me.armor) + '%' } }), h('b', icon('shield', 12), ' ' + Math.ceil(me.armor))) : null);
    const ammo = W ? h('div.ar-ammo', h('b', me.reloading > 0 ? '…' : ammoOf(w)), h('span', ' / ' + W.mag), h('div.tiny', L2(W.n))) : canBuild ? h('div.ar-ammo', h('b', icon('wrench', 26)), h('div.tiny', t('Pickaxe'))) : null;
    const K = cfg.keys;
    const hotbar = () => [h('div.ar-hot', h('span.ar-hs.pick' + (me.pickaxe && !me.buildMode ? '.on' : ''), icon('wrench', 18), h('i', keyName(K.pickaxe))), me.inv.map((it, i) => h('span.ar-hs' + (!me.pickaxe && !me.buildMode && i === me.slot ? '.on' : ''), { style: { '--rc': SH.RARITY[it.r].c } }, h('em', L2(SH.WEAPONS[it.w].n).split(' ')[0]), h('i', String(i + 1)), h('u', String(it.w === curW() ? ammoOf(it.w) : SH.WEAPONS[it.w].mag)))), Array.from({ length: Math.max(0, 5 - me.inv.length) }, () => h('span.ar-hs.empty'))),
      h('div.ar-build' + (me.buildMode ? '.on' : ''), PIECES.map(([p, n]) => h('span' + (me.buildMode && me.piece === p ? '.on' : ''), h('i', keyName(K[p])), L2(n))), h('span.ed', h('i', keyName(K.edit)), t('Edit')))];
    if (duelish) {
      const foe = [...ents.values()][0]; const other = myTeam === 'atk' ? 'def' : 'atk';
      mount(hud, h('div.ar-score.duel', h('span.ar-t', { style: { color: '#fde047' } }, t('You') + ' ', h('b', String(score[myTeam] || 0))), h('span.ar-time', phase === 'wait' ? '⏳ ' + t('Waiting for a rival') : phase === 'buy' ? '⏱ ' + timeLeft(until - Date.now()) : phase === 'live' ? timeLeft(until - Date.now()) : '…'), h('span.ar-t', { style: { color: '#fca5a5' } }, h('b', String(score[other] || 0)), ' ' + (foe ? foe.meta.name : t('Rival')))),
        h('div.ar-alive', t('First to {n}', { n: SH.DUEL_WIN }), pot ? ' · ' + t('Pot') + ' ' + fmt.coins(pot) : '', ranked ? ' · ' + t('Ranked') : ''),
        foe ? h('div.ar-foe', h('span.tiny', foe.meta.name), h('div.ar-bar.hp', h('i', { style: { width: Math.max(0, foe.hp) + '%' } }))) : null,
        h('div.ar-bl', hpBar, bf ? h('span.ar-mats', icon('crate', 13), ' ' + me.mats) : null), bf ? h('div.ar-br', ammo, hotbar()) : h('div.ar-br', ammo, roundW ? h('div.tiny.muted', t('Round {n}', { n: round })) : null));
    } else if (ops) {
      const left = (tm) => [...ents.values()].filter((e) => e.meta.team === tm && e.alive).length + (myTeam === tm && me.alive ? 1 : 0);
      mount(hud, h('div.ar-score', h('span.ar-t', { style: { color: TEAM.atk[2] } }, L2(TEAM.atk) + ' ', h('b', String(score.atk))), h('span.ar-time' + (core ? '.core' : ''), core ? [icon('alert', 14), ' ' + timeLeft(until - Date.now())] : phase === 'buy' ? [icon('cart', 14), ' ' + timeLeft(until - Date.now())] : phase === 'live' ? timeLeft(until - Date.now()) : phase === 'warm' ? t('Warm-up') : '…'), h('span.ar-t', { style: { color: TEAM.def[2] } }, h('b', String(score.def)), ' ' + L2(TEAM.def))),
        h('div.ar-alive', h('span', { style: { color: TEAM.atk[2] } }, '● ' + left('atk')), ' ', h('span', { style: { color: TEAM.def[2] } }, '● ' + left('def'))),
        h('div.ar-bl', hpBar, h('span.ar-money', '$' + fmt.num(me.money)), carrier === myId ? h('span.pill', icon('cube', 12), ' ' + t('You carry the core')) : null, me.kit ? h('span.pill', icon('wrench', 12)) : null),
        h('div.ar-br', ammo, h('div.ar-slots', me.inv.map((it, i) => h('span' + (i === me.slot ? '.on' : ''), (i + 1) + ' ' + L2(SH.WEAPONS[it.w].n))))),
        myTeam ? h('div.ar-teamtag', { style: { color: TEAM[myTeam][2] } }, L2(TEAM[myTeam])) : null);
    } else {
      const aliveN = [...ents.values()].filter((e) => e.alive).length + (me.alive ? 1 : 0);
      mount(hud, h('div.ar-rtop', h('span', icon('users', 14), ' ' + aliveN), h('span', icon('target', 14), ' ' + kills), storm ? h('span', icon('storm', 14), ' ' + (storm.shrinking ? t('Closing') : t('Next')) + ' ' + timeLeft(storm.until - Date.now())) : null, phase === 'lobby' ? h('span', '⏳ ' + timeLeft(until - Date.now())) : null),
        h('div.ar-bl', hpBar, h('span.ar-mats', icon('crate', 13), ' ' + me.mats), h('span.ar-heal' + (me.heals.med ? '' : '.no'), { title: t('Med kit (H)') }, icon('cross', 12), ' ' + me.heals.med, h('i', 'H')), h('span.ar-heal.sh' + (me.heals.sh ? '' : '.no'), { title: t('Shield cell (J)') }, icon('shield', 12), ' ' + me.heals.sh, h('i', 'J'))),
        h('div.ar-br', ammo, hotbar()));
    }
  }
  let boardEl = null; function showBoard(on) { if (!on) { if (boardEl) boardEl.remove(); boardEl = null; return; } if (boardEl) return; const rows = [...ents.values()].map((e) => ({ n: e.meta.name, team: e.meta.team, alive: e.alive })).concat([{ n: S.me.displayName || S.me.username, team: myTeam, alive: me.alive, me: true }]); boardEl = h('div.ar-board', ops ? ['atk', 'def'].map((tm) => h('div', h('b', { style: { color: TEAM[tm][2] } }, L2(TEAM[tm]) + ' · ' + score[tm]), rows.filter((r) => r.team === tm).map((r) => h('div' + (r.alive ? '' : '.dead') + (r.me ? '.me' : ''), r.n)))) : h('div', h('b', t('Players')), rows.map((r) => h('div' + (r.alive ? '' : '.dead') + (r.me ? '.me' : ''), r.n)))); box.append(boardEl); }
  function showEnd(m) {
    if (locked()) document.exitPointerLock();
    overlay.classList.add('show');
    const rkEl = m.rk ? h('div.ar-rkres' + (m.rk.delta > 0 ? '.up' : m.rk.delta < 0 ? '.down' : ''), rankPill(m.rk.rank, true), h('b', (m.rk.delta > 0 ? '+' : '') + m.rk.delta + ' RP'), m.rk.shield ? h('span.tiny', icon('shield', 12), ' ' + t('Your shield saved your points')) : null, m.rk.promoted ? h('span.tiny', icon('up', 12), ' ' + t('Promoted!')) : m.rk.demoted ? h('span.tiny', icon('down', 12), ' ' + t('Demoted')) : null) : null;
    const again = h('button.btn.primary', { onClick: () => { overlay.classList.remove('show'); if (opts.again) opts.again(); } }, t('Play again'));
    const arenaBtn = h('button.btn', { onClick: () => ctx.go('arena') }, 'Arena');
    let body;
    if (duelish) body = [h('h1', m.won ? t('Victory') : t('Defeat')), h('div.ar-big', `${m.score[myTeam] || 0} : ${m.score[myTeam === 'atk' ? 'def' : 'atk'] || 0}`), m.why === 'forfeit' ? h('p.muted', m.won ? t('Your rival left the duel.') : t('You left the duel.')) : null, m.prize ? h('p.coin', '+' + fmt.coins(m.prize)) : m.pot && !m.won ? h('p.muted', t('You lost the bet.')) : null, m.coins ? h('p.coin', '+' + fmt.coins(m.coins)) : null, rkEl, h('div.row', { style: 'gap:8px;justify-content:center' }, opts.room ? null : again, h('button.btn', { onClick: () => ctx.go('ranked') }, t('Competitive')), arenaBtn)];
    else if (ops) body = [h('h1', m.won ? t('Victory') : t('Defeat')), h('div.ar-big', `${m.score.atk} : ${m.score.def}`), h('table.ar-tab', h('tr', h('th', t('Player')), h('th', 'K'), h('th', 'D')), m.board.slice(0, 10).map((r) => h('tr' + (r.id === myId ? '.me' : ''), h('td', { style: { color: TEAM[r.team][2] } }, (r.bot ? 'BOT · ' : '') + r.name), h('td', String(r.k)), h('td', String(r.d))))), m.coins ? h('p.coin', '+' + fmt.coins(m.coins)) : null, rkEl, h('p.tiny.muted', t('A new match starts in a few seconds.'))];
    else body = [h('h1', m.place === 1 ? t('Nebula Victory!') : t('Place #{n}', { n: m.place })), h('p', t('{n} eliminations', { n: m.kills })), m.win && m.place !== 1 ? h('p.muted', t('Winner: {n}', { n: m.win.name })) : null, m.coins ? h('p.coin', '+' + fmt.coins(m.coins)) : null, rkEl, h('div.row', { style: 'gap:8px;justify-content:center' }, again, arenaBtn)];
    mount(overlay, h('div.ar-endc', body));
    if (ops) setTimeout(() => { overlay.classList.remove('show'); ended = null; }, 11000);
    snd(m.won || m.place === 1 ? 'big' : 'lose');
  }
  function die() { me.alive = false; dead = true; me.buildMode = false; if (ops) banner(t('You were eliminated'), t('Spectating your team'), '#fca5a5'); }
  function specNext(d) { const alive = [...ents.values()].filter((e) => e.alive); if (!alive.length) return; const i = alive.findIndex((e) => e.meta.id === spectate); spectate = alive[(i + d + alive.length) % alive.length].meta.id; snd('tick'); }
  // ---------- compass (13.6) ----------
  const cg = compass.getContext('2d'); const DIRS = getLang() === 'es' ? ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'] : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  function paintCompass() {
    const W = 420, H = 40; cg.clearRect(0, 0, W, H); const hd = (((-me.yaw * 180) / Math.PI) % 360 + 360) % 360; const px = 2.2;
    const gr = cg.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.15, 'rgba(0,0,0,.45)'); gr.addColorStop(0.85, 'rgba(0,0,0,.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); cg.fillStyle = gr; cg.fillRect(0, 4, W, 24);
    cg.textAlign = 'center'; cg.textBaseline = 'middle';
    for (let d = Math.floor((hd - 100) / 15) * 15; d <= hd + 100; d += 15) {
      const x = W / 2 + (d - hd) * px; const dd = ((d % 360) + 360) % 360; const a = Math.max(0, 1 - Math.abs(x - W / 2) / (W / 2));
      if (dd % 45 === 0) { cg.fillStyle = 'rgba(255,255,255,' + a + ')'; cg.font = '800 15px system-ui'; cg.fillText(DIRS[dd / 45], x, 16); }
      else { cg.fillStyle = 'rgba(255,255,255,' + a * 0.75 + ')'; cg.fillRect(x - 0.75, 9, 1.5, 9); cg.font = '600 9px system-ui'; cg.fillText(String(dd), x, 24); }
    }
    cg.fillStyle = '#fde047'; cg.beginPath(); cg.moveTo(W / 2, 30); cg.lineTo(W / 2 - 5, 38); cg.lineTo(W / 2 + 5, 38); cg.fill();
    cg.font = '800 11px system-ui'; cg.fillStyle = '#fff'; cg.fillText(String(Math.round(hd) % 360), W / 2, 2.5 + 0);
  }
  // ---------- settings (13.6): P or the gear button ----------
  function openCfg() {
    if (locked()) document.exitPointerLock(); cfgOpen = true; keys.clear(); mouseDown = false; cfgEl.classList.remove('hide'); let waiting = null;
    const set = (k, v) => { cfg[k] = v; saveCfg(cfg); apply(); };
    const apply = () => { const tr = cfg.quality !== 'auto' ? cfg.quality : autoTier(renderer); renderer.setPixelRatio(tr === 'high' ? Math.min(1.6, devicePixelRatio || 1) : tr === 'med' ? 1 : 0.75); resize(); };
    const slider = (k, lo, hi, step, fmtv) => { const out = h('b', fmtv(cfg[k])); return h('span.ar-cf-ctl', h('input', { type: 'range', min: lo, max: hi, step, value: cfg[k], onInput: (e) => { set(k, Number(e.target.value)); out.textContent = fmtv(cfg[k]); } }), out); };
    const row = (label, ctl) => h('div.ar-cf-row', h('span', label), ctl);
    const check = (k) => h('input', { type: 'checkbox', checked: !!cfg[k], onChange: (e) => set(k, e.target.checked) });
    const keyBtn = (k) => h('button.ar-key' + (waiting === k ? '.wait' : ''), { onClick: () => { waiting = k; paint(); } }, waiting === k ? t('Press a key…') : keyName(cfg.keys[k]));
    const onBind = (e) => { if (!waiting) { if (e.key === 'Escape') close(); return; } e.preventDefault(); e.stopPropagation(); const k = String(e.key || '').toLowerCase(); if (k !== 'escape' && !['w', 'a', 's', 'd', ' ', 'e', 'r', 'c', 'tab', 'shift', 'p'].includes(k)) { for (const [kk, v] of Object.entries(cfg.keys)) if (v === k && kk !== waiting) cfg.keys[kk] = ''; cfg.keys[waiting] = k; saveCfg(cfg); } waiting = null; paint(); };
    window.addEventListener('keydown', onBind, true);
    function close() { cfgOpen = false; window.removeEventListener('keydown', onBind, true); cfgEl.classList.add('hide'); paintHud(); }
    function paint() {
      mount(cfgEl, h('div.ar-cf', h('div.ar-cf-h', icon('gear', 18), h('b.grow', t('Settings')), h('button.btn.sm.primary', { onClick: close }, t('Done'))),
        h('div.ar-cf-grid',
          h('section', h('h4', t('Mouse')), row(t('Sensitivity'), slider('sens', 0.2, 3, 0.05, (v) => v.toFixed(2))), row(t('Aim / scope sensitivity'), slider('ads', 0.2, 2, 0.05, (v) => v.toFixed(2))), row(t('Invert vertical look'), check('invert'))),
          h('section', h('h4', t('Video')), row(t('Field of view'), slider('fov', 60, 100, 1, (v) => v + '°')), row(t('Quality'), h('select', { onChange: (e) => set('quality', e.target.value) }, [['auto', t('Automatic')], ['low', t('Low')], ['med', t('Medium')], ['high', t('High')]].map(([v, n]) => h('option', { value: v, selected: cfg.quality === v }, n)))), row(t('Show FPS'), check('fps')), row(t('Effects (bloom, ambient occlusion) — high quality, reload'), check('fx')), row(t('Damage numbers'), check('dmgNums'))),
          canBuild ? h('section', h('h4', t('Building')), row(t('Turbo building (hold to keep placing)'), check('turbo')), PIECES.map(([p, n]) => row(L2(n), keyBtn(p))), row(t('Edit'), keyBtn('edit')), row(t('Build mode'), keyBtn('build')), row(t('Pickaxe'), keyBtn('pickaxe'))) : null),
        h('p.tiny.muted', t('Settings are saved in this browser. Click the game to lock the mouse again.'))));
    }
    paint();
  }
  // ---------- minimap ----------
  const mg = mini.getContext('2d');
  function paintMini() {
    const S2 = 170; mg.clearRect(0, 0, S2, S2); mg.save(); mg.beginPath(); mg.arc(S2 / 2, S2 / 2, S2 / 2 - 2, 0, 7); mg.clip(); mg.fillStyle = fp ? 'rgba(20,14,30,.7)' : 'rgba(20,60,30,.7)'; mg.fillRect(0, 0, S2, S2);
    const sc = duel ? 2.6 : bf ? 1.7 : ops ? 1.6 : 0.5; mg.translate(S2 / 2, S2 / 2); mg.rotate(me.yaw); mg.translate(-me.x * sc, -me.z * sc);
    mg.fillStyle = 'rgba(230,210,170,.6)'; for (const b of solidList) if (b.h > 1.3 || b.bid) mg.fillRect((b.x - b.w / 2) * sc, (b.z - b.d / 2) * sc, Math.max(1, b.w * sc), Math.max(1, b.d * sc));
    if (ops) for (const [k, s] of Object.entries(map.sites)) { mg.strokeStyle = '#f472b6'; mg.lineWidth = 2; mg.beginPath(); mg.arc(s.x * sc, s.z * sc, s.r * sc, 0, 7); mg.stroke(); mg.fillStyle = '#f472b6'; mg.font = 'bold 12px system-ui'; mg.fillText(k, s.x * sc - 4, s.z * sc + 4); }
    if (royale && storm) { mg.strokeStyle = '#a855f7'; mg.lineWidth = 3; mg.beginPath(); mg.arc(storm.cx * sc, storm.cz * sc, storm.r * sc, 0, 7); mg.stroke(); if (storm.to) { mg.strokeStyle = '#fff'; mg.lineWidth = 1.5; mg.beginPath(); mg.arc(storm.to.cx * sc, storm.to.cz * sc, storm.to.r * sc, 0, 7); mg.stroke(); } }
    if (royale && rmap) { mg.fillStyle = '#fff'; mg.font = '10px system-ui'; for (const p of rmap.pois) mg.fillText(L2(p.n), p.x * sc - 20, p.z * sc); }
    for (const e of ents.values()) { if (!e.alive) continue; const friend = ops && e.meta.team === myTeam; if (ops && !friend) continue; if (!ops) continue; mg.fillStyle = friend ? '#38bdf8' : '#f87171'; mg.beginPath(); mg.arc(e.obj.position.x * sc, e.obj.position.z * sc, 3.2, 0, 7); mg.fill(); }
    if (ops && core) { mg.fillStyle = '#f472b6'; mg.fillRect(core.x * sc - 3, core.z * sc - 3, 6, 6); } if (ops && coreDrop && myTeam === 'atk') { mg.fillStyle = '#f472b6'; mg.fillRect(coreDrop.x * sc - 3, coreDrop.z * sc - 3, 6, 6); }
    mg.restore(); mg.fillStyle = '#fde047'; mg.beginPath(); mg.moveTo(S2 / 2, S2 / 2 - 7); mg.lineTo(S2 / 2 - 5, S2 / 2 + 5); mg.lineTo(S2 / 2 + 5, S2 / 2 + 5); mg.fill();
  }
  // ---------- loop ----------
  // 13.8: the game fills the window (and the whole screen with the Full screen button)
  const resize = () => { const W = box.clientWidth || 900; const fs = document.fullscreenElement === box; const top = box.getBoundingClientRect().top; const H = fs ? innerHeight : Math.max(360, innerHeight - Math.max(0, top) - 16); box.style.height = H + 'px'; renderer.setSize(W, H, false); if (pipe) pipe.setSize(W, H); cam.aspect = W / H; cam.updateProjectionMatrix(); };
  if (tier === 'high' && cfg.fx !== false) rtxPipeline(THREE, renderer, scene, cam, { bloom: 0.32, threshold: 0.9, radius: 0.35, ao: true, aoRadius: 0.5 }).then((p) => { if (!live) { p && p.dispose(); return; } pipe = p; resize(); }).catch(() => {});
  const ro = new ResizeObserver(resize); ro.observe(box); resize(); addEventListener('resize', resize); document.addEventListener('fullscreenchange', resize);
  let fpsN = 0, fpsT = performance.now();
  let last = performance.now(); let raf = 0; let live = true; let sendT = 0; let hudT = 0; let miniT = 0;
  function frame() {
    if (!live) return; raf = requestAnimationFrame(frame); const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now; const ts = now / 1000;
    if (!myId || (royale && !rmap)) { renderer.render(scene, cam); return; } // wait for the server's hello (map, team, position)
    me.cd = Math.max(0, me.cd - dt); me.recoil = Math.max(0, me.recoil - dt * 0.25);
    if (me.reloading > 0) { me.reloading -= dt; if (me.reloading <= 0) { const w = curW(); if (w) me.ammo[w] = SH.WEAPONS[w].mag; paintHud(); } }
    if (mouseDown && curW() && SH.WEAPONS[curW()].auto && !me.buildMode) tryShoot();
    if (mouseDown && me.buildMode && cfg.turbo) placeBuild(true);
    // ---- movement ----
    const frozen = (fp || bf) && phase === 'buy';
    if (me.inShip) { const p = shipPos(); me.x = p.x; me.z = p.z; me.y = 90; }
    else if (me.alive) {
      let fx = 0, fz = 0; if (!buyOpen) { if (keys.has('w')) fz += 1; if (keys.has('s')) fz -= 1; if (keys.has('a')) fx -= 1; if (keys.has('d')) fx += 1; }
      const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
      me.crouch += ((keys.has('c') ? 1 : 0) - me.crouch) * Math.min(1, dt * 10);
      let speed = fp ? (keys.has('shift') ? 2.8 : 5.2) : (keys.has('shift') ? 7.4 : 5.6); if (me.crouch > 0.5) speed *= 0.5; if (aim) speed *= 0.7; if (me.gliding) speed = 9;
      if (frozen) speed = 0;
      // forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw)
      const vx = (-Math.sin(me.yaw) * fz + Math.cos(me.yaw) * fx) * speed * dt, vz = (-Math.cos(me.yaw) * fz - Math.sin(me.yaw) * fx) * speed * dt;
      const nx = me.x + vx; const nz = me.z + vz;
      if (!hitsWall(nx, me.z, me.y)) me.x = nx; if (!hitsWall(me.x, nz, me.y)) me.z = nz;
      // gravity, gliding
      const g = groundAt(me.x, me.z, me.y);
      if (me.falling) { me.gliding = me.y - g > 30 ? false : true; me.vy = Math.max(me.gliding ? -7 : -32, me.vy - (me.gliding ? 12 : 26) * dt); }
      else me.vy -= 18 * dt;
      me.y += me.vy * dt; if (me.y <= g) { if (me.falling && me.vy < -8) snd('tick'); me.y = g; me.vy = 0; me.onGround = true; me.falling = false; me.gliding = false; } else me.onGround = me.y - g < 0.05;
      if (me.y > g && me.y - g < 0.5 && me.vy <= 0 && !me.falling) { me.y = g; me.onGround = true; } // step down smoothly
    }
    // ---- camera ----
    const eye = (me.crouch > 0.5 ? 1.15 : SH.EYE);
    // spectating after being eliminated (13.8): follow the other players in third person; Space / arrows switch
    let spec = false;
    if (dead && tp && !ended && !me.alive) {
      const alive = [...ents.values()].filter((e) => e.alive); const s = alive.find((e) => e.meta.id === spectate) || alive[0];
      if (s) { spec = true; spectate = s.meta.id; const o = s.obj.position; const yaw = s.obj.rotation.y - Math.PI; cam.position.set(o.x + Math.sin(yaw) * 4.6, o.y + 2.6, o.z + Math.cos(yaw) * 4.6); cam.lookAt(o.x, o.y + 1.5, o.z); specEl.classList.remove('hide'); specEl.textContent = t('Spectating {n}', { n: s.meta.name }) + ' · ' + t('Space: next player'); }
      else specEl.classList.add('hide');
    } else specEl.classList.add('hide');
    if (spec) { if (myObj) myObj.visible = false; }
    else if (dead && ops) { const mates = [...ents.values()].filter((e) => e.alive && e.meta.team === myTeam); const s = mates.find((e) => e.meta.id === spectate) || mates[0]; if (s) { spectate = s.meta.id; cam.position.set(s.obj.position.x, s.obj.position.y + SH.EYE, s.obj.position.z); cam.rotation.set(0, s.obj.rotation.y + Math.PI, 0, 'YXZ'); } }
    else if (fp) { cam.position.set(me.x, me.y + eye, me.z); cam.rotation.set(me.pitch, me.yaw, 0, 'YXZ'); vm.visible = me.alive && !me.scoped; vm.position.y = -0.22 + Math.sin(ts * 8) * 0.006 * (keys.size ? 1 : 0); vm.position.z = -0.45 + me.cd * 0.3; }
    else {
      const dist2 = aim ? 2.2 : 4.4; const back = new THREE.Vector3(Math.sin(me.yaw) * Math.cos(me.pitch), Math.sin(me.pitch) * -1 + 0.25, Math.cos(me.yaw) * Math.cos(me.pitch));
      const target = new THREE.Vector3(me.x, me.y + 1.65, me.z); const right = new THREE.Vector3(Math.cos(me.yaw), 0, -Math.sin(me.yaw)).multiplyScalar(0.7);
      if (me.inShip) { const p = shipPos(); cam.position.set(p.x + 18, 100, p.z + 18); cam.lookAt(p.x, 88, p.z); }
      else { cam.position.copy(target).addScaledVector(back, dist2).add(right); cam.rotation.set(me.pitch, me.yaw, 0, 'YXZ'); }
      if (myObj) { myObj.visible = !me.inShip && me.alive; myObj.position.set(me.x, me.y, me.z); myObj.rotation.y = me.yaw + Math.PI; animateHero(myObj, dt, ts, { speed: (keys.has('w') || keys.has('a') || keys.has('s') || keys.has('d')) && me.onGround ? (keys.has('shift') ? 1.3 : 1) : 0, ground: me.onGround, vy: me.gliding ? -1 : me.vy }); myObj.userData.gun.visible = !me.pickaxe && !me.emote; const lkd = myObj.userData.lk; lkd.pickaxe.visible = me.pickaxe && !me.emote; lkd.glider.visible = me.gliding;
        if (me.emote) { const moving = keys.has('w') || keys.has('a') || keys.has('s') || keys.has('d') || !me.onGround; me.emote.t += dt; if (moving || me.emote.t > EMOTE_LEN) { me.emote = null; resetEmote(myObj); } else poseEmote(myObj, me.emote.k, me.emote.t); }
        if (me.lk && me.lk.trail && (me.gliding || (me.falling && me.vy < -3)) && Math.random() < dt * 30) trailPuff(THREE, scene, lfx, myObj.position, me.lk.trail); }
    }
    cam.fov += (((me.scoped ? 22 : aim ? cfg.fov * 0.68 : fp ? cfg.fov : cfg.fov - 4)) - cam.fov) * Math.min(1, dt * 12); cam.updateProjectionMatrix();
    box.classList.toggle('scoped', !!me.scoped);
    // ---- others ----
    if (fp) setVm(curW()); if (myObj && curW()) swapGun(myObj, curW(), mySkin);
    for (const e of ents.values()) {
      const o = e.obj; if (e.w) swapGun(o, e.w, e.meta.skin); const k = Math.min(1, dt * 12); const px = o.position.x, pz = o.position.z;
      o.position.x += (e.tx - o.position.x) * k; o.position.y += (e.ty - o.position.y) * k; o.position.z += (e.tz - o.position.z) * k; o.rotation.y = lerpAngle(o.rotation.y, e.tyaw + Math.PI, k);
      o.visible = e.alive && !(royale && phase === 'ship' && e.ty > 80); const v = Math.hypot(o.position.x - px, o.position.z - pz) / Math.max(dt, 0.001);
      animateHero(o, dt, ts + e.meta.name.length, { speed: v / 5, ground: Math.abs(e.vy) < 1.5 && e.ty < 70, vy: (e.a & 8) ? -1 : e.vy });
      if (tp && o.userData.lk) { const gl = !!(e.a & 8); o.userData.lk.glider.visible = gl && e.alive; o.userData.lk.pickaxe.visible = !!(e.a & 16); if (o.userData.gun) o.userData.gun.visible = !(e.a & 16) && !e.emote;
        if (e.emote) { e.emote.t += dt; if (v > 0.5 || e.emote.t > EMOTE_LEN) { e.emote = null; resetEmote(o); } else poseEmote(o, e.emote.k, e.emote.t); }
        const tr = e.meta.lk && e.meta.lk.trail; if (tr && e.alive && (gl || e.vy < -3) && o.position.y > 2 && Math.random() < dt * 20) trailPuff(THREE, scene, lfx, o.position, tr); }
      if (royale && e.tag) e.tag.visible = Math.hypot(o.position.x - me.x, o.position.z - me.z) < 35;
    }
    // ---- objective visuals ----
    if (ops) { const c = core || coreDrop; coreMesh.visible = !!c || false; if (c) { coreMesh.position.set(c.x, 0.4 + Math.sin(ts * 4) * 0.08, c.z); coreMesh.rotation.y = ts * 2; coreMesh.material.emissiveIntensity = core ? 1 + Math.sin(ts * (8 + (Date.now() > until - 10000 ? 12 : 0))) * 0.8 : 1.2; } siteMarks.forEach((r) => { r.material.opacity = 0.35 + Math.sin(ts * 3) * 0.15; }); }
    if (royale) { ship.visible = phase === 'ship'; if (ship.visible) { const p = shipPos(); ship.position.set(p.x, 92, p.z); ship.rotation.y = Math.atan2(shipInfo.x1 - shipInfo.x0, shipInfo.z1 - shipInfo.z0) - Math.PI / 2; }
      if (storm) { stormWall.visible = true; stormWall.scale.set(Math.max(0.1, storm.r), 1, Math.max(0.1, storm.r)); stormWall.position.set(storm.cx, 40, storm.cz); const out = Math.hypot(me.x - storm.cx, me.z - storm.cz) > storm.r; box.classList.toggle('in-storm', out && !me.inShip && me.alive); }
      chestMeshes.forEach((g, i) => { if (!chestsOpen.has(i)) g.children[1].material.opacity = 0.45 + Math.sin(ts * 3 + i) * 0.2; }); paintGhost(); } else if (bf) paintGhost();
    // plant / defuse with E held
    if (ops && holdE && me.alive && phase === 'live') { if (carrier === myId && !core) { if (!plantBy) ws.send({ t: 'ar_plant' }); } else if (myTeam === 'def' && core && Math.hypot(me.x - core.x, me.z - core.z) < 1.8 && defuseBy !== myId) ws.send({ t: 'ar_defuse' }); }
    const prog = ops && phase === 'live' ? (plantBy === myId ? Math.min(1, (performance.now() - holdE) / 3000) : defuseBy === myId ? Math.min(1, (performance.now() - (holdE || performance.now())) / (me.kit ? 3000 : 5000)) : 0) : 0;
    box.style.setProperty('--prog', prog); box.classList.toggle('acting', prog > 0);
    // fx
    for (let i = fxList.length - 1; i >= 0; i--) { const f = fxList[i]; if (now - f.t > f.life) { scene.remove(f.o); if (f.o.geometry) f.o.geometry.dispose(); f.o.material.dispose(); fxList.splice(i, 1); } }
    sun.position.set(me.x + 30, 60, me.z + 20); sun.target.position.set(me.x, 0, me.z);
    stepFx(scene, lfx, now, dt);
    if (royale) {
      if (water) { water.material.map.offset.set((ts * 0.01) % 1, (ts * 0.006) % 1); const f = scene.getObjectByName('foam'); if (f) f.material.opacity = 0.25 + Math.sin(ts * 1.3) * 0.1; }
      for (const c of clouds) { c.position.x += c.userData.v * dt; if (c.position.x > 520) c.position.x = -520; }
      stormTex.offset.x = (ts * 0.02) % 1; stormTex.offset.y = Math.sin(ts * 0.7) * 0.02;
      for (const d of drops.values()) { d.g.children[0].rotation.y = ts * 1.5; const bm = d.g.children[1]; if (bm) bm.material.opacity = 0.3 + Math.sin(ts * 3) * 0.12; }
    }
    // network
    if (now - sendT > 66 && me.alive && !me.inShip && myId) { sendT = now; ws.send({ t: 'ar_state', x: me.x, y: me.y, z: me.z, yaw: me.yaw, pitch: me.pitch, w: curW(), a: (keys.has('w') || keys.has('a') || keys.has('s') || keys.has('d') ? 1 : 0) | (me.crouch > 0.5 ? 2 : 0) | (!me.onGround ? 4 : 0) | (me.gliding ? 8 : 0) | (canBuild && me.pickaxe ? 16 : 0) }); }
    if (now - hudT > 200) { hudT = now; paintHud(); }
    if (now - miniT > 100) { miniT = now; paintMini(); }
    paintCompass(); fpsN++; if (now - fpsT > 500) { fpsEl.textContent = cfg.fps ? Math.round(fpsN * 1000 / (now - fpsT)) + ' FPS' : ''; fpsN = 0; fpsT = now; }
    // hints
    const hint = ops ? (carrier === myId && !core && Object.values(map.sites).some((s) => Math.hypot(me.x - s.x, me.z - s.z) < s.r) ? t('Hold E to plant the core') : myTeam === 'def' && core && Math.hypot(me.x - core.x, me.z - core.z) < 1.8 ? t('Hold E to defuse') : '') : me.inShip ? t('Press Space to jump') : rmap && rmap.chests.some((c, i) => !chestsOpen.has(i) && Math.hypot(c.x - me.x, c.z - me.z) < 2.6) ? t('Press E to open the chest') : royale && [...drops.values()].some((d) => Math.hypot(d.x - me.x, d.z - me.z) < 2.6) ? t('Press E to pick up the loot') : '';
    box.dataset.hint = hint;
    if (pipe) pipe.render(); else renderer.render(scene, cam);
  }
  frame();
  return () => { live = false; cancelAnimationFrame(raf); ro.disconnect(); removeEventListener('resize', resize); document.removeEventListener('fullscreenchange', resize); if (document.fullscreenElement === box) document.exitFullscreen().catch(() => {}); ws.send({ t: 'ar_leave' }); if (locked()) document.exitPointerLock(); offs.forEach((f) => f()); document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onKey); document.removeEventListener('keyup', onKeyUp2); document.removeEventListener('mouseup', onUp); document.removeEventListener('mousemove', onMove); scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); renderer.dispose(); try { renderer.forceContextLoss(); } catch {} };
}

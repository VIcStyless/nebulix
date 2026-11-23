// Nebula Worlds: original 3D multiplayer worlds — obby (parkour) courses with checkpoints and best times, and
// hangouts. Your 3D avatar, everyone else in the same world live, chat bubbles, and gear bought with coins
// (speed, higher jump, double jump, glider, trails, hats). #/worlds · #/worlds/<id>
import { h, mount, fmt, ls } from '../util.js';
import { t, pick2 } from '../i18n.js';
import { api, ws } from '../api.js';
import { S, bus } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, emptyState, busy, confirmBox, confetti } from '../ui.js';
import { load3d } from '../avatar3d.js';
import { autoTier, rtxPipeline } from '../rtx.js';
import { buildHero, animateHero, makeBlock, makeWorldEnv, themeOf, glowTex, lerpAngle, engineReset } from '../worlds-engine.js';
import { sfx } from '../sfx.js';
import { builder } from './worlds-builder.js';

const L = pick2;
const DIFF = { easy: ['Easy', '#22c55e'], medium: ['Medium', '#f59e0b'], hard: ['Hard', '#ef4444'] };
const tms = (ms) => { const s = ms / 1000; const m = Math.floor(s / 60); return (m ? m + ':' + String(Math.floor(s % 60)).padStart(2, '0') : Math.floor(s)) + '.' + String(Math.floor((ms % 1000) / 100)); };
const snd = (k) => { try { sfx[k] && sfx[k](); } catch {} };
function rng(seed) { let a = 0; for (const c of seed) a = (a * 31 + c.charCodeAt(0)) >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }

// ---------- level layouts (the same for everyone: seeded) ----------
// block: { x, y, z, w, h, d, k: 'n'|'move'|'bounce'|'kill'|'check'|'finish'|'deco', c: colour, mx/mz amplitude, sp speed }
function layout(id) {
  const R = rng('nebula-world-' + id); const r = (a, b) => a + R() * (b - a); const B = [];
  const add = (o) => { B.push(Object.assign({ k: 'n', h: 1 }, o)); return o; };
  add({ x: 0, y: -0.5, z: 0, w: 10, d: 10, k: 'n', c: '#5b5f97', spawn: true });
  if (id === 'plaza' || id === 'palace') {
    const vip = id === 'palace';
    add({ x: 0, y: -0.5, z: 0, w: 90, d: 90, c: vip ? '#f8fafc' : '#334155' });
    add({ x: 0, y: 0.4, z: 0, w: 8, h: 0.8, d: 8, k: 'deco', c: vip ? '#fbbf24' : '#38bdf8' }); add({ x: 0, y: 1.6, z: 0, w: 2, h: 1.6, d: 2, k: 'deco', c: vip ? '#fde68a' : '#7dd3fc' });
    for (const [x, z] of [[-18, -12], [18, -12], [-18, 14], [18, 14]]) add({ x, y: 0.15, z, w: 4, h: 0.3, d: 4, k: 'bounce', c: '#ec4899' });
    for (let i = 0; i < 7; i++) add({ x: -30 + i * 2.2, y: i * 0.9, z: -30, w: 2.2, h: 0.6, d: 4, c: '#a78bfa' }); // stairs to a deck
    add({ x: -12, y: 6, z: -30, w: 12, h: 0.6, d: 8, c: '#7c3aed' }); add({ x: 6, y: 3, z: -30, w: 20, h: 0.4, d: 3, c: '#f472b6' }); // slide-ish ramp deck
    add({ x: 24, y: 0.5, z: 24, w: 14, h: 1, d: 8, c: vip ? '#fbbf24' : '#0ea5e9' }); // stage
    for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; add({ x: Math.cos(a) * 40, y: 3, z: Math.sin(a) * 40, w: 1.4, h: 6, d: 1.4, k: 'deco', c: vip ? '#fde68a' : '#64748b' }); }
    if (vip) { add({ x: 0, y: 2.5, z: -20, w: 3, h: 5, d: 2, k: 'deco', c: '#b45309' }); add({ x: 0, y: 12, z: 0, w: 30, h: 0.6, d: 30, c: '#fef3c7' }); for (let i = 0; i < 10; i++) add({ x: 12 + (i % 2) * 3, y: 1 + i * 1.2, z: 12 - i * 1.6, w: 2.4, h: 0.5, d: 2.4, c: '#fcd34d' }); }
    return { blocks: B, kind: 'hangout', killY: -20, sky: vip ? ['#fde68a', '#93c5fd'] : ['#1e1b4b', '#7c3aed'], fog: vip ? '#dbeafe' : '#312e81' };
  }
  const cfg = { tower: { n: 46, gap: [2.6, 3.6], rise: [0.3, 1.1], sz: [2.4, 3.6], mv: 0.1, bn: 0.06, kl: 0.08, fl: 0.06, sp: 0.04, sky: ['#0b1026', '#4c1d95'], col: ['#8b5cf6', '#6366f1', '#a78bfa'] },
    neon: { n: 60, gap: [3, 4.4], rise: [-0.4, 0.9], sz: [2, 3.2], mv: 0.28, bn: 0.1, kl: 0.12, fl: 0.08, sp: 0.12, sky: ['#020617', '#be185d'], col: ['#22d3ee', '#f472b6', '#a3e635', '#facc15'] },
    void: { n: 70, gap: [3.2, 4.6], rise: [0, 1.4], sz: [1.2, 2], mv: 0.25, bn: 0.08, kl: 0.15, fl: 0.14, sp: 0, sky: ['#000000', '#1e1b4b'], col: ['#e2e8f0', '#94a3b8', '#c4b5fd'] },
    lava: { n: 58, gap: [2.8, 4.2], rise: [-0.3, 0.8], sz: [1.8, 3], mv: 0.22, bn: 0.12, kl: 0.3, fl: 0.1, sp: 0.08, sky: ['#1c0a00', '#ea580c'], col: ['#57534e', '#78716c', '#a8a29e'] } }[id];
  let x = 0, y = 0, z = 0, ang = 0;
  for (let i = 1; i <= cfg.n; i++) {
    if (id === 'tower') { ang += 0.42; const rad = 9; x = Math.cos(ang) * rad - rad; z = Math.sin(ang) * rad; y += r(cfg.rise[0], cfg.rise[1]); }
    else { ang += r(-0.55, 0.55); ang = Math.max(-1, Math.min(1, ang)); const g = r(cfg.gap[0], cfg.gap[1]); const s0 = r(cfg.sz[0], cfg.sz[1]); x += Math.sin(ang) * (g + s0 / 2); z += Math.cos(ang) * (g + s0 / 2); y += r(cfg.rise[0], cfg.rise[1]); }
    const s = r(cfg.sz[0], cfg.sz[1]); const c = cfg.col[i % cfg.col.length];
    if (i % 10 === 0) { add({ x, y: y - 0.5, z, w: 4, d: 4, k: 'check', c: '#22c55e', n: i / 10 }); continue; }
    if (i === cfg.n) { add({ x, y: y - 0.5, z, w: 6, d: 6, k: 'finish', c: '#fbbf24' }); add({ x: x - 2.6, y: y + 1.5, z, w: 0.6, h: 4, d: 0.6, k: 'deco', c: '#fde68a' }); add({ x: x + 2.6, y: y + 1.5, z, w: 0.6, h: 4, d: 0.6, k: 'deco', c: '#fde68a' }); add({ x, y: y + 3.7, z, w: 5.8, h: 0.6, d: 0.6, k: 'deco', c: '#fde68a' }); break; }
    const roll = R();
    if (roll < cfg.bn && i > 3) { add({ x, y: y - 0.3, z, w: s, h: 0.6, d: s, k: 'bounce', c: '#ec4899' }); y += 2.5; continue; }
    if (roll < cfg.bn + cfg.mv && i > 3) { add({ x, y: y - 0.5, z, w: s, d: s, k: 'move', c, mx: id === 'tower' ? 0 : r(1.5, 3), my: id === 'tower' ? r(0.6, 1.4) : 0, sp: r(0.6, 1.3), ph: r(0, 6) }); continue; }
    if (roll < cfg.bn + cfg.mv + cfg.fl && i > 3) { add({ x, y: y - 0.5, z, w: s, d: s, k: 'fall', c: '#f59e0b' }); continue; }
    add({ x, y: y - 0.5, z, w: s, d: s, c });
    if (roll > 1 - cfg.sp && s > 2.3 && i > 5) { add({ x, y: y + 0.45, z, w: s * 0.92, h: 0.3, d: 0.3, k: 'spin', c: '#ef4444', sp: R() < 0.5 ? 1.6 : -1.6 }); continue; }
    if (roll > 1 - cfg.kl && s > 1.9 && i > 3) add({ x, y: y + 0.35, z, w: s * 0.9, h: 0.7, d: 0.35, k: 'kill', c: '#ef4444' });
  }
  return { blocks: B, kind: 'obby', killY: (id === 'lava' ? -2 : Math.min(...B.map((b) => b.y)) - 18), lava: id === 'lava', sky: cfg.sky, fog: cfg.sky[1] };
}

// community worlds (World Builder): grid blocks → 3D blocks. A cell is 2 units; gy is the top of the block.
const SKY = { night: [['#0b1026', '#4c1d95'], '#312e81'], sunset: [['#1e1b4b', '#f97316'], '#7c2d12'], day: [['#38bdf8', '#e0f2fe'], '#bae6fd'], neon: [['#020617', '#be185d'], '#500724'], void: [['#000000', '#1e1b4b'], '#0f0a2a'], lava: [['#1c0a00', '#ea580c'], '#7c2d12'], candy: [['#f9a8d4', '#c4b5fd'], '#fbcfe8'] };
function ugcLayout(x) {
  let n = 0; const CELL = 2;
  const B = x.blocks.map(([gx, gy, gz, s, k, c]) => {
    const w = s * CELL; const o = { x: gx * CELL, y: gy - 0.5, z: gz * CELL, w, h: 1, d: w, c, k: k === 'spawn' || k === 'ice' ? 'n' : k === 'lift' ? 'move' : k };
    if (k === 'spawn') o.spawn = true; if (k === 'ice') o.ice = true; if (k === 'check') o.n = ++n;
    if (k === 'move') { o.mx = 3; o.my = 0; o.sp = 0.9; o.ph = (gx + gz) * 0.7; } if (k === 'lift') { o.mx = 0; o.my = 2; o.sp = 0.8; o.ph = gx * 0.5; }
    if (k === 'kill') { o.h = 0.9; o.y = gy - 0.45; }
    return o;
  });
  if (!B.some((b) => b.spawn)) B.push({ x: 0, y: -0.5, z: 0, w: 6, h: 1, d: 6, k: 'n', c: '#22c55e', spawn: true });
  const sk = SKY[x.sky] || SKY.night;
  return { blocks: B, kind: x.kind, killY: Math.min(...B.map((b) => b.y)) - 15, sky: sk[0], fog: sk[1], lava: x.sky === 'lava' };
}
let lastD = null;

export default {
  title: () => t('Worlds'),
  async mount(root, ctx) {
    const inner = h('div.inner.wd'); mount(root, inner); let stopGame = null; const offs = [];
    async function lobby() {
      if (stopGame) { stopGame(); stopGame = null; } history.replaceState(history.state, '', '#/worlds'); mount(inner, loading());
      let d; try { d = await api.get('/api/worlds'); } catch (e) { mount(inner, emptyState('alert', t('Could not load this'), e.message)); return; }
      lastD = d; const set = (v) => { d = v; lastD = v; paint2(); };
      const comm = h('section.wd-comm'); let usort = 'top';
      const loadComm = async () => { try { const u = await api.get('/api/worlds/ugc?sort=' + usort); paintComm(u); } catch (e) { mount(comm, h('p.small.muted', e.message)); } };
      const ucard = (x, u) => h('div.wd-card.wd-ucard', h('div.wd-art', { style: { background: `linear-gradient(160deg, ${(SKY[x.sky] || SKY.night)[0][0]}, ${(SKY[x.sky] || SKY.night)[0][1]})` } }, x.kind === 'obby' ? '🧱' : '🎪', x.online ? h('span.wd-on', '● ' + t('{n} online', { n: x.online })) : null, !x.pub ? h('span.wd-draft', t('Draft')) : null),
        h('div.wd-body', h('b', x.name), h('span.tiny.muted', t('by @{u}', { u: x.owner ? x.owner.username : '?' }) + ' · ' + t(x.kind === 'obby' ? 'Obby' : 'Hangout')),
          h('div.row.tiny.muted', { style: 'gap:10px;flex-wrap:wrap' }, h('span', '❤ ' + x.likes), h('span', '👤 ' + x.players), x.kind === 'obby' ? h('span', '🏁 ' + x.finishes) : null),
          x.best && x.best[0] ? h('div.tiny', '🥇 ' + x.best[0].user.displayName + ' · ' + tms(x.best[0].ms)) : null,
          h('div.row', { style: 'gap:6px;flex-wrap:wrap;margin-top:auto' }, h('button.btn.sm.primary', { onClick: (e) => busy(e.currentTarget, async () => { try { const full = await api.get('/api/worlds/ugc/' + x.id); playUgc(full); } catch (er) { toastErr(er); } }) }, icon('play', 13), t('Play now')),
            x.pub && !x.mine ? h('button.btn.sm' + (x.liked ? '.primary' : '.ghost'), { onClick: (e) => busy(e.currentTarget, async () => { try { await api.post('/api/worlds/ugc/' + x.id + '/like'); loadComm(); } catch (er) { toastErr(er); } }) }, x.liked ? '❤' : '♡') : null,
            x.mine ? h('button.btn.sm', { onClick: (e) => busy(e.currentTarget, async () => { try { const full = await api.get('/api/worlds/ugc/' + x.id); edit(full); } catch (er) { toastErr(er); } }) }, icon('edit', 13), t('Edit')) : null,
            x.mine ? h('button.btn.sm.ghost', { 'aria-label': t('Delete'), onClick: async () => { if (!(await confirmBox(t('Delete “{n}” forever?', { n: x.name })))) return; try { await api.del('/api/worlds/ugc/' + x.id); loadComm(); } catch (er) { toastErr(er); } } }, icon('trash', 13)) : null)));
      function paintComm(u) {
        mount(comm, h('div.wd-h.row', { style: 'gap:8px;flex-wrap:wrap' }, h('h3.grow', { style: 'margin:0' }, '🧱 ', t('Community worlds')),
          h('div.seg', ['top', 'new'].map((k) => h('button' + (usort === k ? '.on' : ''), { onClick: () => { usort = k; loadComm(); } }, t(k === 'top' ? 'Popular' : 'Newest')))),
          h('button.btn.primary', { onClick: () => edit(null) }, icon('plus', 14), t('Create a world'))),
          h('p.small.muted', t('Worlds made by players with the World Builder. Creators earn {n} coins each time someone finishes their obby (once per player a day).', { n: u.earn })),
          u.mine.length ? [h('div.wd-sub', t('My worlds') + ' (' + u.mine.length + '/' + u.perUser + ')'), h('div.wd-grid', u.mine.map((x) => ucard(x, u)))] : null,
          u.worlds.length ? h('div.wd-grid', u.worlds.filter((x) => !x.mine).map((x) => ucard(x, u))) : h('p.muted', t('No community worlds yet. Be the first to build one!')));
      }
      const paint2 = () => { paint(); inner.append(comm); };
      const paint = () => mount(inner,
        h('section.wd-hero', h('div.grow', h('h2', '🌍 ', t('Nebula Worlds')), h('p', t('3D worlds you play with everyone online: parkour courses with checkpoints and hangouts to chat and jump around. Finishing a course pays coins once a day.')))),
        h('div.wd-grid', d.worlds.map((w) => h('div.wd-card.wd-' + w.id, h('div.wd-art', w.icon, w.online ? h('span.wd-on', '● ' + t('{n} online', { n: w.online })) : null),
          h('div.wd-body', h('b', L(w.n)), h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, w.kind === 'obby' ? h('span.pill', { style: { color: DIFF[w.diff][1] } }, t(DIFF[w.diff][0])) : h('span.pill', t('Hangout')), w.reward ? h('span.pill' + (w.claimedToday ? '.muted' : ''), (w.claimedToday ? '✓ ' : '') + fmt.coins(w.reward) + ' 🪙') : null),
            w.myBest ? h('div.tiny.muted', t('Your best: {t}', { t: tms(w.myBest) })) : null,
            w.best.length ? h('div.wd-best', w.best.slice(0, 3).map((b, i) => h('div.tiny', ['🥇', '🥈', '🥉'][i] + ' ' + b.user.displayName + ' · ' + tms(b.ms)))) : null,
            w.unlocked ? h('button.btn.primary', { onClick: () => play(w, d) }, icon('play', 14), t('Play now')) : h('button.btn', { disabled: S.me.coins < w.price, onClick: async (e) => { const b = e.currentTarget; if (!(await confirmBox(t('Buy the pass for {n} coins? It is forever.', { n: fmt.num(w.price) })))) return; busy(b, async () => { try { set(await api.post('/api/worlds/pass', { id: w.id })); toast(t('Welcome to {w}!', { w: L(w.n) }), 'good'); } catch (er) { toastErr(er); } }); } }, icon('lock', 14), t('Pass'), ' · ', h('span.coin', fmt.coins(w.price))))))),
        h('h3.wd-h', icon('bag', 17), ' ', t('Gear shop'), h('span.tiny.muted', ' · ' + t('works in every world'))),
        h('div.wd-gear', d.gear.map((g) => h('div.wd-g' + (g.on ? '.on' : ''), h('span.wd-gi', g.icon), h('b', L(g.n)), h('span.tiny.muted', L(g.d)),
          g.owned ? h('button.btn.sm' + (g.on ? '.primary' : ''), { onClick: (e) => busy(e.currentTarget, async () => { try { set(await api.post('/api/worlds/gear/equip', { id: g.id })); } catch (er) { toastErr(er); } }) }, g.on ? '✓ ' + t('Equipped') : t('Equip'))
            : h('button.btn.sm.primary', { disabled: S.me.coins < g.price, onClick: (e) => busy(e.currentTarget, async () => { try { set(await api.post('/api/worlds/gear/buy', { id: g.id })); toast(g.icon + ' ' + L(g.n), 'good'); } catch (er) { toastErr(er); } }) }, t('Buy'), ' · ', h('span.coin', fmt.coins(g.price)))))));
      paint2(); loadComm();
      const w0 = ctx.params && ctx.params[0]; if (w0 && !play._auto) { play._auto = true; const w = d.worlds.find((x) => x.id === w0 && x.unlocked); if (w) play(w, d); }
    }

    function edit(full) {
      if (stopGame) { stopGame(); stopGame = null; } history.replaceState(history.state, '', '#/worlds');
      const draft = full ? { id: full.id, name: full.name, desc: full.desc, kind: full.kind, sky: full.sky, pub: full.pub, blocks: full.blocks } : null;
      const stopB = builder(inner, draft, { onExit: () => lobby(), onTest: (dr) => { const back = () => { if (stopGame) { stopGame(); stopGame = null; } edit(Object.assign({}, full || {}, dr, { id: dr.id })); }; play({ id: 'test', n: [dr.name || 'Test', dr.name || 'Prueba'], icon: '🧪', ugc: dr }, lastD, { test: true, back }); } });
      stopGame = stopB;
    }
    async function playUgc(x) {
      if (!lastD) { try { lastD = await api.get('/api/worlds'); } catch (e) { toastErr(e); return; } }
      api.post('/api/worlds/ugc/' + x.id + '/play', {}, { quiet: true }).catch(() => {});
      play({ id: 'u_' + x.id, n: [x.name, x.name], icon: x.kind === 'obby' ? '🧱' : '🎪', ugc: x }, lastD, { back: () => lobby(), edit: x.mine ? () => edit(x) : null });
    }
    async function play(w, d, opts = {}) {
      const back = opts.back || (() => lobby());
      if (stopGame) { stopGame(); stopGame = null; }
      history.replaceState(history.state, '', '#/worlds' + (opts.test ? '' : '/' + w.id));
      let THREE, AVD; try { ({ THREE, AV: AVD } = await load3d()); } catch (e) { toastErr(e); return; }
      const lv = w.ugc ? ugcLayout(w.ugc) : layout(w.id); const meGear = new Set(d.me.move);
      const box = h('div.wd-game'); const hud = h('div.wd-hud'); const ov = h('div.wd-ov.hide'); const say = h('input.input.wd-say', { maxlength: 90, placeholder: t('Say something… (Enter)') });
      const emotes = h('div.wd-emotes', ['👋', '😂', '🔥', '🎉', '😎', 'GG'].map((e) => h('button', { type: 'button', onClick: () => { ws.send({ t: 'w3_emote', e }); bubble(S.me.id, e); } }, e)));
      const stick = h('div.wd-stick', h('i')); const jumpB = h('button.wd-jump', { type: 'button' }, '⤒'); const dashB = h('button.wd-jump.wd-dashb', { type: 'button' }, '»');
      const lockHint = h('div.wd-lockhint', '🖱 ' + t('Click the game to look around with the mouse (Esc to free it)')); const speedFx = h('div.wd-speed'); const splitEl = h('div.wd-split');
      mount(inner, h('div.wd-top', h('button.btn.sm.ghost', { onClick: () => back() }, icon('back', 14), opts.test ? t('Back to the editor') : t('Worlds')), h('b.grow', w.icon + ' ' + L(w.n)), opts.test ? h('span.pill', '🧪 ' + t('Test mode')) : null, opts.edit ? h('button.btn.sm', { onClick: () => opts.edit() }, icon('edit', 13), t('Edit')) : null,
        h('button.btn.sm.ghost', { title: t('Photo mode') + ' (P)', onClick: () => togglePhoto() }, '📷'), h('button.btn.sm.ghost', { title: t('Settings'), onClick: () => settingsPanel() }, icon('gear', 13)), h('span.small.muted.wd-count')), box);
      box.append(hud, ov, speedFx, splitEl, lockHint, h('div.wd-chat', say, emotes), stick, jumpB, dashB);
      let renderer; try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); } catch { try { renderer = new THREE.WebGLRenderer(); } catch { mount(box, emptyState('alert', t('3D is not available'), '')); return; } }
      const tier = autoTier(renderer); const shadows = tier !== 'low';
      renderer.setPixelRatio(tier === 'high' ? Math.min(2, devicePixelRatio || 1) : tier === 'med' ? 1 : 0.8); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.shadowMap.enabled = shadows; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      box.prepend(renderer.domElement); renderer.domElement.className = 'wd-cv';
      const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(lv.fog, lv.kind === 'hangout' ? 0.007 : 0.0042);
      const cam = new THREE.PerspectiveCamera(66, 16 / 9, 0.1, 900);
      scene.add(new THREE.HemisphereLight(new THREE.Color(lv.sky[0]).lerp(new THREE.Color('#ffffff'), 0.65), new THREE.Color(lv.fog).multiplyScalar(0.6), 1.25));
      const sun = new THREE.DirectionalLight(lv.lava ? '#ffd2a8' : '#fff4e0', 2.6); sun.castShadow = shadows; sun.shadow.mapSize.set(tier === 'high' ? 2048 : 1024, tier === 'high' ? 2048 : 1024); Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, far: 140 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; scene.add(sun, sun.target);
      const rim = new THREE.DirectionalLight(new THREE.Color(lv.sky[1]).lerp(new THREE.Color('#ffffff'), 0.3), 0.9); scene.add(rim);
      const env = makeWorldEnv(THREE, scene, lv, { tier });
      let lavaM = null; if (lv.lava) { lavaM = new THREE.MeshStandardMaterial({ color: '#ea580c', emissive: '#f97316', emissiveIntensity: 1.3, roughness: 0.4 }); const lava = new THREE.Mesh(new THREE.PlaneGeometry(900, 900, 1, 1), lavaM); lava.rotation.x = -Math.PI / 2; lava.position.y = lv.killY + 0.5; scene.add(lava); }
      const theme = themeOf(lv); const solids = [];
      const blocks = lv.blocks.map((b) => { const v = makeBlock(THREE, b, theme, shadows); scene.add(v.obj); if (b.k !== 'kill' && b.k !== 'spin') v.obj.traverse((o) => { if (o.isMesh && o.geometry.type === 'ExtrudeGeometry') solids.push(o); }); return Object.assign({}, b, { m: v.obj, tick: v.tick, glow: v.glow, x0: b.x, y0: b.y, z0: b.z, dx: 0, dy: 0, dz: 0 }); });
      const animated = blocks.filter((b) => b.tick);
      const falls = blocks.filter((b) => b.k === 'fall'); const spins = blocks.filter((b) => b.k === 'spin'); const solidB = (b) => b.k !== 'kill' && b.k !== 'spin' && !b.gone;
      // post-processing (bloom + ambient occlusion) on capable devices
      let post = null; const wantPost = ls('wd.post') !== false && tier === 'high';
      // avatars
      const tag = (text, color = '#fff') => { const c = document.createElement('canvas'); const g = c.getContext('2d'); g.font = '700 40px system-ui'; const tw = Math.ceil(g.measureText(text).width) + 36; c.width = tw; c.height = 64; g.font = '700 40px system-ui'; g.fillStyle = 'rgba(0,0,0,.5)'; g.beginPath(); g.roundRect(0, 0, tw, 64, 26); g.fill(); g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 18, 34); const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, depthWrite: false, transparent: true })); sp.scale.set((tw / 64) * 0.36, 0.36, 1); return sp; };
      const hatOf = (looks, obj) => { if (!looks || !looks.hat) return; const hm = looks.hat === 'hat_crown' ? new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.23, 0.18, 10, 1, true), new THREE.MeshStandardMaterial({ color: '#fbbf24', metalness: 0.9, roughness: 0.2, side: THREE.DoubleSide, emissive: '#b45309', emissiveIntensity: 0.3 })) : new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 8, 28), new THREE.MeshBasicMaterial({ color: '#fef08a' })); if (looks.hat === 'hat_halo') hm.rotation.x = Math.PI / 2; hm.position.y = looks.hat === 'hat_halo' ? 0.45 : 0.3; obj.userData.head.add(hm); };
      const TRAIL = { trail_rainbow: null, trail_fire: ['#f97316', '#facc15', '#ef4444'], trail_stars: ['#ffffff', '#c4b5fd', '#fde68a'] };
      const people = new Map(); const bubbles = [];
      const hero = (av, o = {}) => buildHero(THREE, av, AVD, Object.assign({ shadows }, o));
      const meObj = hero(S.me.av3 || null); scene.add(meObj); hatOf(d.me.looks, meObj);
      function addP(p) { if (p.id === S.me.id || people.has(p.id)) return; const obj = hero(p.av3 || null); const nt = tag((p.clan ? '[' + p.clan.tag + '] ' : '') + p.displayName, p.pro ? '#fde68a' : '#fff'); nt.position.y = 2.2; obj.add(nt); hatOf(p.looks, obj); obj.position.set(p.x, p.y, p.z); scene.add(obj); people.set(p.id, { obj, tx: p.x, ty: p.y, tz: p.z, tr: p.ry, a: p.a, looks: p.looks || {}, name: p.displayName, last: performance.now(), vy: 0 }); paintCount(); }
      function delP(id) { const p = people.get(id); if (p) { scene.remove(p.obj); people.delete(id); paintCount(); } }
      const paintCount = () => { const el = inner.querySelector('.wd-count'); if (el) el.textContent = t('{n} players here', { n: people.size + 1 }); };
      function bubble(id, text) { const obj = id === S.me.id ? meObj : people.get(id) && people.get(id).obj; if (!obj) return; const b = tag(text.length > 40 ? text.slice(0, 40) + '…' : text, '#fde68a'); b.position.y = 2.65; obj.add(b); bubbles.push({ b, obj, t: performance.now() }); }
      // particles: trails, dust, dash streaks
      const sparks = []; const sparkTex = glowTex();
      function spark(col, pos, { life = 700, size = 0.35, vx = 0, vy = 0.6, vz = 0, spread = 0.3 } = {}) { if (sparks.length > 320) return; const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); s.scale.setScalar(size); s.position.set(pos.x + (Math.random() - 0.5) * spread, pos.y + Math.random() * spread, pos.z + (Math.random() - 0.5) * spread); scene.add(s); sparks.push({ s, t: performance.now(), life, vx, vy, vz, size }); }
      function trail(looks, pos, now) { if (!looks || !looks.trail) return; const cols = TRAIL[looks.trail]; const col = cols ? cols[Math.floor(Math.random() * cols.length)] : new THREE.Color().setHSL((now / 1500) % 1, 0.9, 0.6); spark(col, { x: pos.x, y: pos.y + 0.3, z: pos.z }, { spread: 0.5 }); }
      const dust = (pos, n = 10, col = '#e2e8f0') => { for (let i = 0; i < n; i++) { const a = Math.random() * 6.28; spark(col, pos, { life: 500, size: 0.45, vx: Math.cos(a) * 2.2, vy: 0.4 + Math.random() * 0.6, vz: Math.sin(a) * 2.2, spread: 0.2 }); } };
      // ---- ghost of your best run (saved on this device) ----
      const GKEY = 'wd.ghost.' + w.id; let ghostOn = ls('wd.ghostOn') !== false; let ghost = null; try { ghost = JSON.parse(localStorage.getItem(GKEY) || 'null'); } catch {}
      const ghostObj = hero(S.me.av3 || null, { ghost: true, shadows: false }); ghostObj.visible = false; scene.add(ghostObj); let rec = []; let recT = 0;
      const SKEY = 'wd.splits.' + w.id; let bestSplits = {}; try { bestSplits = JSON.parse(localStorage.getItem(SKEY) || '{}') || {}; } catch {} let runSplits = {};
      // ---- state ----
      const spawn = blocks.find((b) => b.spawn); const me = { x: spawn.x, y: spawn.y + spawn.h / 2, z: spawn.z, vx: 0, vz: 0, vy: 0, ry: 0, ground: null, lastGround: 0, jumps: 0, check: spawn, cp: 0, dashT: 0, dashCd: 0, canDash: true, airVy: 0 };
      let camYaw = Math.PI, camPitch = 0.32, camDist = ls('wd.dist') || 7.5; const keys = new Set(); let t0 = 0, done = false, started = lv.kind === 'obby' ? false : true; let raf = 0, live = true, sendT = 0, hudT = 0, lastSent = ''; let jumpBuf = 0; let shake = 0; let photo = false; let sens = Number(ls('wd.sens')) || 1; let fov = 66;
      const SPEED = meGear.has('speed') ? 9.6 : 7.6; const JUMP = meGear.has('gravity') ? 12.6 : 11; const GRAV = meGear.has('gravity') ? -24 : -30;
      const RAD = 0.35, HGT = 1.7; const COYOTE = 0.12; const BUFFER = 0.14;
      const respawn = (quiet) => { const c = me.check; me.x = c.x; me.y = c.y + c.h / 2 + 0.05; me.z = c.z; me.vy = 0; me.vx = me.vz = 0; me.dashT = 0; if (!quiet) { snd('lose'); dust({ x: me.x, y: me.y, z: me.z }, 14, '#a5b4fc'); } };
      const restartRun = () => { ov.classList.add('hide'); done = false; started = false; me.check = spawn; me.cp = 0; runSplits = {}; rec = []; blocks.forEach((b) => b.glow && b.glow(false)); respawn(true); };
      const onKey = (e) => {
        if (!box.isConnected || e.target === say) return; const k = String(e.key || '').toLowerCase();
        if (e.type === 'keydown') {
          if (k === 'enter') { say.focus(); e.preventDefault(); return; } if (['w', 'a', 's', 'd', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', 'f'].includes(k)) e.preventDefault();
          if (k === ' ' && !keys.has(' ')) jumpBuf = BUFFER; if (k === 'f' && !keys.has('f')) dash(); if (k === 'r') respawn(); if (k === 't' && lv.kind === 'obby') restartRun(); if (k === 'g') { ghostOn = !ghostOn; ls('wd.ghostOn', ghostOn); toast(ghostOn ? t('Ghost on') : t('Ghost off'), 'info', 1000); } if (k === 'p') togglePhoto();
          keys.add(k);
        } else { keys.delete(k); if (k === ' ' && me.vy > 4 && !me.dashT) me.vy *= 0.55; } // short hop when Space is released early
      };
      document.addEventListener('keydown', onKey); document.addEventListener('keyup', onKey);
      say.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { const v = say.value.trim(); if (v) { ws.send({ t: 'w3_say', text: v }); bubble(S.me.id, v); } say.value = ''; say.blur(); } if (e.key === 'Escape') say.blur(); });
      function tryJump() {
        const now = performance.now() / 1000; const canGround = me.ground || now - me.lastGround < COYOTE;
        if (canGround && me.jumps === 0) { me.vy = JUMP; me.ground = null; me.jumps = 1; me.lastGround = -9; snd('click'); meObj.userData.squash = -0.6; dust({ x: me.x, y: me.y, z: me.z }, 5); if (!started) { started = true; t0 = performance.now(); } return true; }
        if (meGear.has('double') && me.jumps < 2 && !me.ground) { me.vy = JUMP * 0.92; me.jumps = 2; snd('click'); for (let i = 0; i < 10; i++) spark('#c4b5fd', { x: me.x, y: me.y, z: me.z }, { life: 450, vy: -1, spread: 0.6 }); return true; }
        return false;
      }
      function dash() {
        if (done || photo || me.dashCd > 0 || !me.canDash) return; const fwdX = -Math.sin(camYaw), fwdZ = -Math.cos(camYaw); const hv = Math.hypot(me.vx, me.vz); const dx = hv > 1 ? me.vx / hv : fwdX, dz = hv > 1 ? me.vz / hv : fwdZ;
        me.vx = dx * 19; me.vz = dz * 19; me.vy = Math.max(me.vy, 2.5); me.dashT = 0.18; me.dashCd = 0.7; if (!me.ground) me.canDash = false; snd('spin'); shake = Math.max(shake, 0.15); if (!started && lv.kind === 'obby') { started = true; t0 = performance.now(); }
      }
      // mouse: click to capture (free 360° look), or drag; wheel zooms
      const cv = renderer.domElement; let drag = null; const locked = () => document.pointerLockElement === cv;
      cv.addEventListener('click', () => { if (!locked() && !photo && matchMedia('(pointer: fine)').matches) { try { const p = cv.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => { try { cv.requestPointerLock(); } catch {} }); } catch { try { cv.requestPointerLock(); } catch {} } } });
      const onLock = () => { lockHint.classList.toggle('hide', locked()); box.classList.toggle('locked', locked()); }; document.addEventListener('pointerlockchange', onLock);
      cv.addEventListener('mousedown', (e) => { if (!locked()) drag = { x: e.clientX, y: e.clientY }; if (e.button === 2 && locked()) dash(); }); const onUp = () => { drag = null; }; document.addEventListener('mouseup', onUp);
      const look = (dx, dy) => { camYaw -= dx * 0.0032 * sens; camPitch = Math.max(-0.75, Math.min(1.35, camPitch + dy * 0.0028 * sens)); };
      const onMove = (e) => { if (locked()) look(e.movementX, e.movementY); else if (drag) { look((e.clientX - drag.x) * 1.8, (e.clientY - drag.y) * 1.8); drag = { x: e.clientX, y: e.clientY }; } }; document.addEventListener('mousemove', onMove);
      cv.addEventListener('wheel', (e) => { e.preventDefault(); camDist = Math.max(2.5, Math.min(18, camDist + Math.sign(e.deltaY) * 0.8)); ls('wd.dist', camDist); }, { passive: false });
      cv.addEventListener('contextmenu', (e) => e.preventDefault());
      // touch: joystick + jump + dash + drag to look
      let tStick = null, tLook = null; const knob = stick.firstChild;
      stick.addEventListener('touchstart', (e) => { const tc = e.changedTouches[0]; const r = stick.getBoundingClientRect(); tStick = { id: tc.identifier, cx: r.left + r.width / 2, cy: r.top + r.height / 2, dx: 0, dy: 0 }; e.preventDefault(); }, { passive: false });
      stick.addEventListener('touchmove', (e) => { for (const tc of e.changedTouches) if (tStick && tc.identifier === tStick.id) { let dx = tc.clientX - tStick.cx, dy = tc.clientY - tStick.cy; const l = Math.hypot(dx, dy); if (l > 44) { dx *= 44 / l; dy *= 44 / l; } tStick.dx = dx / 44; tStick.dy = dy / 44; knob.style.transform = `translate(${dx}px,${dy}px)`; } e.preventDefault(); }, { passive: false });
      stick.addEventListener('touchend', () => { tStick = null; knob.style.transform = ''; });
      jumpB.addEventListener('touchstart', (e) => { e.preventDefault(); jumpBuf = BUFFER; keys.add(' '); }, { passive: false }); jumpB.addEventListener('touchend', () => { keys.delete(' '); if (me.vy > 4) me.vy *= 0.55; }); jumpB.addEventListener('click', () => { jumpBuf = BUFFER; });
      dashB.addEventListener('touchstart', (e) => { e.preventDefault(); dash(); }, { passive: false }); dashB.addEventListener('click', dash);
      cv.addEventListener('touchstart', (e) => { const tc = e.changedTouches[0]; tLook = { id: tc.identifier, x: tc.clientX, y: tc.clientY }; }, { passive: true });
      cv.addEventListener('touchmove', (e) => { for (const tc of e.changedTouches) if (tLook && tc.identifier === tLook.id) { look((tc.clientX - tLook.x) * 2.4, (tc.clientY - tLook.y) * 2.2); tLook.x = tc.clientX; tLook.y = tc.clientY; } e.preventDefault(); }, { passive: false });
      const resize = () => { const W = box.clientWidth || 800; const H = photo || document.fullscreenElement === box ? box.clientHeight || innerHeight : Math.round(Math.min(W * 9 / 16, innerHeight * 0.74)); if (!document.fullscreenElement) box.style.height = H + 'px'; renderer.setSize(W, H, false); cam.aspect = W / H; cam.updateProjectionMatrix(); if (post) post.setSize(W, H); };
      const ro = new ResizeObserver(resize); ro.observe(box); resize();
      if (wantPost) rtxPipeline(THREE, renderer, scene, cam, { bloom: 0.5, threshold: 0.82, radius: 0.5, aoRadius: 0.7 }).then((p) => { if (!live) { if (p) p.dispose(); return; } post = p; resize(); });
      // photo mode: hide the HUD, orbit freely, save a picture
      function togglePhoto() { photo = !photo; box.classList.toggle('photo', photo); if (photo && locked()) document.exitPointerLock(); if (photo) toast(t('Photo mode: drag to orbit, wheel to zoom, P to exit. Press the camera button to save.'), 'info', 3500); paintPhoto(); }
      const photoBar = h('div.wd-photobar'); box.append(photoBar);
      function paintPhoto() { mount(photoBar, photo ? [h('button.btn.primary', { onClick: () => { (post ? post.render() : renderer.render(scene, cam)); renderer.domElement.toBlob((b) => { if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'nebula-world-' + Date.now() + '.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast(t('Picture saved'), 'good'); }); } }, '📸 ' + t('Save picture')), h('button.btn', { onClick: togglePhoto }, t('Exit'))] : null); }
      function settingsPanel() {
        const wrap = h('div.wd-set');
        const row = (label, input) => h('label.row', { style: 'gap:10px;align-items:center;margin:8px 0' }, h('span.grow', label), input);
        mount(wrap, row(t('Mouse sensitivity'), h('input', { type: 'range', min: '0.3', max: '2.5', step: '0.1', value: String(sens), onInput: (e) => { sens = Number(e.target.value); ls('wd.sens', sens); } })),
          row(t('Camera distance'), h('input', { type: 'range', min: '2.5', max: '18', step: '0.5', value: String(camDist), onInput: (e) => { camDist = Number(e.target.value); ls('wd.dist', camDist); } })),
          row(t('Ghost of your best run') + ' (G)', h('input', { type: 'checkbox', checked: ghostOn, onChange: (e) => { ghostOn = e.target.checked; ls('wd.ghostOn', ghostOn); } })),
          tier === 'high' ? row(t('Bloom and ambient occlusion (reload the world)'), h('input', { type: 'checkbox', checked: ls('wd.post') !== false, onChange: (e) => ls('wd.post', e.target.checked) })) : null,
          h('p.tiny.muted', t('WASD move · Space jump (hold for higher) · Shift sprint · F or right-click dash · click the game for mouse look · G ghost · T restart · R respawn · P photo mode · Enter chat')));
        import('../ui.js').then((ui) => ui.modal({ title: t('World settings'), body: wrap, actions: [{ label: t('Close') }] }));
      }
      // ---- network ----
      offs.push(bus.on('ws:w3_hello', (m) => { if (m.w !== w.id) return; for (const p of m.players) addP(p); }), bus.on('ws:w3_join', (m) => { addP(m.p); toast(t('@{u} joined the world', { u: m.p.username }), 'info', 2000); }), bus.on('ws:w3_leave', (m) => delP(m.id)),
        bus.on('ws:w3_pos', (m) => { for (const p of m.list) { const q = people.get(p.id); if (q) { q.vy = (p.y - q.ty) * 10; q.tx = p.x; q.ty = p.y; q.tz = p.z; q.tr = p.ry; q.a = p.a; } } }),
        bus.on('ws:w3_say', (m) => { if (m.id !== S.me.id) bubble(m.id, m.text); }), bus.on('ws:w3_emote', (m) => { if (m.id !== S.me.id) bubble(m.id, m.text); }),
        bus.on('ws:w3_full', () => toast(t('This world is full right now. You can still play on your own.'), 'info')), bus.on('ws:open', () => { if (!opts.test) ws.send({ t: 'w3_join', w: w.id }); }));
      if (!opts.test) ws.send({ t: 'w3_join', w: w.id });
      // ---- physics ----
      const overlaps = (b, x, y, z) => Math.abs(x - b.x) < b.w / 2 + RAD && Math.abs(z - b.z) < b.d / 2 + RAD && y < b.y + b.h / 2 && y + HGT > b.y - b.h / 2;
      async function finishRun() {
        done = true; const ms = Math.round(performance.now() - t0); snd('win'); confetti(innerWidth / 2, innerHeight / 3, 90); if (locked()) document.exitPointerLock();
        // ghost + best splits for this device
        let localPb = false; if (!ghost || ms < ghost.ms) { localPb = true; try { localStorage.setItem(GKEY, JSON.stringify({ ms, f: rec.slice(0, 7000) })); ghost = { ms, f: rec.slice(0, 7000) }; } catch {} }
        const ns = Object.assign({}, bestSplits); for (const [k, v] of Object.entries(runSplits)) if (!ns[k] || v < ns[k]) ns[k] = v; bestSplits = ns; try { localStorage.setItem(SKEY, JSON.stringify(ns)); } catch {}
        ov.classList.remove('hide'); mount(ov, h('div.wd-ovc', h('h2', '🏁 ' + t('Finished!')), h('div.wd-big', tms(ms)), h('p.muted', t('Saving your time…'))));
        let r = null; if (!opts.test) { try { r = await api.post(w.ugc ? '/api/worlds/ugc/' + w.ugc.id + '/finish' : '/api/worlds/finish', w.ugc ? { ms } : { w: w.id, ms }); } catch (e) { toastErr(e); } }
        mount(ov, h('div.wd-ovc', h('h2', '🏁 ' + t('Finished!')), h('div.wd-big', tms(ms)), r ? h('p', r.pb ? '⭐ ' + t('New personal best! Rank #{r}', { r: r.rank }) : t('Your best: {t} · rank #{r}', { t: tms(r.best), r: r.rank })) : null, r && r.coins ? h('p.coin', '+' + fmt.coins(r.coins)) : opts.test ? h('p.tiny.muted', t('Test run: times are not saved. Save your world to publish it.')) : null,
          localPb ? h('p.tiny.muted', '👻 ' + t('Your ghost was saved. Race against it next time!')) : null,
          h('div.row', { style: 'gap:8px;justify-content:center' }, h('button.btn.primary', { onClick: restartRun }, t('Play again')), h('button.btn', { onClick: () => back() }, opts.test ? t('Back to the editor') : t('Worlds')))));
      }
      let last = performance.now(); const tmpV = new THREE.Vector3(); const headV = new THREE.Vector3(); const ray = new THREE.Raycaster(); const dirV = new THREE.Vector3();
      function frame() {
        if (!live) return; raf = requestAnimationFrame(frame); const now = performance.now(); const dt = Math.min(0.033, (now - last) / 1000); last = now; const ts = now / 1000;
        for (const b of blocks) if (b.k === 'move') { const nx = b.x0 + Math.sin(ts * b.sp + b.ph) * (b.mx || 0); const ny = b.y0 + Math.sin(ts * b.sp + b.ph) * (b.my || 0); b.dx = nx - b.x; b.dy = ny - b.y; b.x = nx; b.y = ny; b.m.position.set(b.x, b.y, b.z); }
        for (const b of animated) b.tick(ts, dt);
        for (const b of falls) { if (b.gone) { if (ts > b.back) { b.gone = false; b.touched = 0; b.m.visible = true; b.m.position.set(b.x0, b.y0, b.z0); b.m.scale.setScalar(1); } else { b.m.position.y -= dt * 9; } continue; } if (b.touched) { const k = ts - b.touched; b.m.position.set(b.x0 + (Math.random() - 0.5) * k * 0.25, b.y0, b.z0 + (Math.random() - 0.5) * k * 0.25); if (k > 0.55) { b.gone = true; b.back = ts + 3; snd('tick'); dust({ x: b.x, y: b.y + 0.4, z: b.z }, 10, '#fbbf24'); setTimeout(() => { if (!b.gone) return; b.m.visible = false; }, 600); } } }
        for (const b of spins) b.m.rotation.y = -ts * b.sp;
        if (me.ground && me.ground.k === 'move') { me.x += me.ground.dx; me.y += me.ground.dy; }
        // ---- input → target velocity, relative to the camera ----
        let fx = 0, fz = 0; if (!photo) { if (keys.has('w') || keys.has('arrowup')) fz += 1; if (keys.has('s') || keys.has('arrowdown')) fz -= 1; if (keys.has('a') || keys.has('arrowleft')) fx -= 1; if (keys.has('d') || keys.has('arrowright')) fx += 1; if (tStick) { fx += tStick.dx; fz -= tStick.dy; } }
        const l = Math.hypot(fx, fz); if (l > 1) { fx /= l; fz /= l; }
        const sprint = keys.has('shift') || (tStick && Math.hypot(tStick.dx, tStick.dy) > 0.95);
        const fwdX = -Math.sin(camYaw), fwdZ = -Math.cos(camYaw); const rx = -fwdZ, rz = fwdX; const ice = me.ground && me.ground.ice;
        const maxS = SPEED * (sprint ? 1.42 : 1) * (ice ? 1.25 : 1); const tvx = done ? 0 : (fwdX * fz + rx * fx) * maxS, tvz = done ? 0 : (fwdZ * fz + rz * fx) * maxS;
        me.dashCd = Math.max(0, me.dashCd - dt);
        if (me.dashT > 0) me.dashT -= dt; else {
          const accel = me.ground ? (ice ? 9 : l > 0.1 ? 70 : 55) : l > 0.1 ? 22 : 4; const kx = tvx - me.vx, kz = tvz - me.vz; const kl = Math.hypot(kx, kz); const step = Math.min(kl, accel * dt);
          if (kl > 1e-4) { me.vx += (kx / kl) * step; me.vz += (kz / kl) * step; }
        }
        const hv = Math.hypot(me.vx, me.vz); const moving = hv > 0.4;
        if (moving && (l > 0.1 || me.dashT > 0)) { me.ry = lerpAngle(me.ry, Math.atan2(me.vx, me.vz), 1 - Math.exp(-dt * 14)); if (!started && lv.kind === 'obby') { started = true; t0 = now; } }
        // horizontal movement with step-up onto small ledges
        const tryMove = (nx, nz) => { const hit = blocks.find((b) => solidB(b) && overlaps(b, nx, me.y + 0.05, nz)); if (!hit) return true; const top = hit.y + hit.h / 2; if (me.ground && top - me.y > 0 && top - me.y < 0.5 && !blocks.some((b) => solidB(b) && b !== hit && overlaps(b, nx, top + 0.02, nz))) { me.y = top + 0.01; return true; } return false; };
        let nx = me.x + me.vx * dt; if (tryMove(nx, me.z)) me.x = nx; else me.vx = 0; let nz = me.z + me.vz * dt; if (tryMove(me.x, nz)) me.z = nz; else me.vz = 0;
        // gravity (stronger on the way down), glider, terminal speed
        const fallMul = me.vy < 0 ? 1.4 : 1; if (me.dashT <= 0) me.vy += GRAV * fallMul * dt; else me.vy += GRAV * 0.2 * dt;
        if (meGear.has('glider') && keys.has(' ') && me.vy < -2.5 && !me.ground) me.vy = -2.5; me.vy = Math.max(-42, me.vy);
        if (jumpBuf > 0) { if (tryJump()) jumpBuf = 0; else jumpBuf -= dt; }
        const wasGround = me.ground; const prevVy = me.vy; const ny = me.y + me.vy * dt; me.ground = null;
        for (const b of blocks) { if (!solidB(b)) continue; if (Math.abs(me.x - b.x) < b.w / 2 + RAD - 0.05 && Math.abs(me.z - b.z) < b.d / 2 + RAD - 0.05) { const top = b.y + b.h / 2, bot = b.y - b.h / 2; if (me.vy <= 0 && me.y >= top - 0.3 && ny <= top) { me.y = top; me.vy = 0; me.ground = b; me.jumps = 0; me.canDash = true; } else if (me.vy > 0 && me.y + HGT <= bot + 0.1 && ny + HGT > bot) { me.vy = 0; } } }
        if (!me.ground) me.y = ny; else me.lastGround = ts;
        if (me.ground && !wasGround) { const impact = -prevVy; if (impact > 6) { meObj.userData.squash = Math.min(1, impact / 26); dust({ x: me.x, y: me.y, z: me.z }, Math.min(16, Math.round(impact / 2))); if (impact > 18) { shake = Math.max(shake, 0.12); snd('tick'); } } }
        if (me.ground) {
          const g = me.ground;
          if (g.k === 'fall' && !g.touched) g.touched = ts;
          if (g.k === 'bounce') { me.vy = 19; me.ground = null; me.jumps = 1; snd('coin'); meObj.userData.squash = -0.8; for (let i = 0; i < 12; i++) spark('#f472b6', { x: me.x, y: me.y, z: me.z }, { life: 600, vy: 2, spread: 0.8 }); }
          if (g.k === 'check' && me.check !== g) {
            me.check = g; me.cp = g.n; snd('coin'); g.glow && g.glow(true); for (let i = 0; i < 24; i++) spark('#4ade80', { x: g.x, y: g.y + 0.6, z: g.z }, { life: 900, vy: 3 + Math.random() * 2, spread: 1.6 });
            if (started && lv.kind === 'obby' && !done) { const tt = now - t0; runSplits[g.n] = tt; const bs = bestSplits[g.n]; const diff = bs ? tt - bs : null; mount(splitEl, h('div.wd-sp' + (diff === null ? '' : diff <= 0 ? '.good' : '.bad'), h('b', '🚩 ' + g.n), ' ' + tms(tt), diff === null ? null : h('span', ' ' + (diff <= 0 ? '−' : '+') + tms(Math.abs(diff))))); splitEl.classList.remove('show'); void splitEl.offsetWidth; splitEl.classList.add('show'); }
            else toast(t('Checkpoint {n}', { n: g.n }), 'good', 1200);
          }
          if (g.k === 'finish' && started && !done && lv.kind === 'obby') finishRun();
        }
        // spinning lasers: a bar of length w turning around its block centre
        const spinHit = blocks.some((b) => { if (b.k !== 'spin') return false; if (me.y > b.y + 0.4 || me.y + HGT < b.y - 0.3) return false; const a = ts * b.sp; const cx = Math.cos(a), cz = Math.sin(a); const px = me.x - b.x, pz = me.z - b.z; const tt = Math.max(-b.w / 2, Math.min(b.w / 2, px * cx + pz * cz)); return Math.hypot(px - cx * tt, pz - cz * tt) < RAD + 0.12; });
        if (spinHit || blocks.some((b) => b.k === 'kill' && overlaps(b, me.x, me.y, me.z))) { shake = 0.25; respawn(); }
        if (me.y < lv.killY) respawn();
        // ---- record the run (ghost) and play the saved ghost ----
        if (started && !done && lv.kind === 'obby' && now - recT > 50) { recT = now; rec.push([Math.round(now - t0), +me.x.toFixed(2), +me.y.toFixed(2), +me.z.toFixed(2), +me.ry.toFixed(2)]); }
        if (ghost && ghostOn && started && !done && lv.kind === 'obby' && ghost.f && ghost.f.length > 1) { const tt = now - t0; const f = ghost.f; let i = 1; while (i < f.length && f[i][0] < tt) i++; if (i < f.length) { const a = f[i - 1], b2 = f[i]; const k = (tt - a[0]) / Math.max(1, b2[0] - a[0]); const gx = a[1] + (b2[1] - a[1]) * k, gy = a[2] + (b2[2] - a[2]) * k, gz = a[3] + (b2[3] - a[3]) * k; const gm = Math.hypot(b2[1] - a[1], b2[3] - a[3]) / Math.max(0.001, (b2[0] - a[0]) / 1000); ghostObj.visible = true; ghostObj.position.set(gx, gy, gz); ghostObj.rotation.y = lerpAngle(ghostObj.rotation.y, b2[4], 0.3); animateHero(ghostObj, dt, ts, { speed: Math.min(1.4, gm / SPEED), ground: Math.abs(b2[2] - a[2]) < 0.05, vy: (b2[2] - a[2]) * 20 }); } else ghostObj.visible = false; } else ghostObj.visible = false;
        // ---- avatars ----
        meObj.position.set(me.x, me.y, me.z); meObj.rotation.y = me.ry; animateHero(meObj, dt, ts, { speed: me.ground ? hv / SPEED : 0, ground: !!me.ground, vy: me.vy, dash: me.dashT > 0 });
        const blob = meObj.getObjectByName('blob'); if (blob) blob.visible = !!me.ground;
        if (moving && me.ground && sprint && Math.random() < 0.35) dust({ x: me.x, y: me.y + 0.05, z: me.z }, 1);
        if (me.dashT > 0) for (let i = 0; i < 3; i++) spark('#a5f3fc', { x: me.x, y: me.y + 0.9, z: me.z }, { life: 300, size: 0.5, vy: 0, spread: 0.6 });
        if (moving && d.me.looks && d.me.looks.trail && Math.random() < 0.6) trail(d.me.looks, meObj.position, now);
        for (const [, p] of people) { const o = p.obj; const px = o.position.x, pz = o.position.z; const kk = Math.min(1, dt * 10); o.position.x += (p.tx - o.position.x) * kk; o.position.y += (p.ty - o.position.y) * kk; o.position.z += (p.tz - o.position.z) * kk; o.rotation.y = lerpAngle(o.rotation.y, p.tr, kk); const v = Math.hypot(o.position.x - px, o.position.z - pz) / Math.max(dt, 0.001); animateHero(o, dt, ts + o.id, { speed: v / SPEED, ground: Math.abs(p.vy) < 1.5, vy: p.vy }); if (v > 1 && p.looks.trail && Math.random() < 0.4) trail(p.looks, o.position, now); }
        for (let i = sparks.length - 1; i >= 0; i--) { const s = sparks[i]; const a = (now - s.t) / s.life; if (a > 1) { scene.remove(s.s); s.s.material.dispose(); sparks.splice(i, 1); } else { s.s.material.opacity = 1 - a; s.s.position.x += s.vx * dt; s.s.position.y += s.vy * dt; s.s.position.z += s.vz * dt; s.vx *= 0.94; s.vz *= 0.94; s.s.scale.setScalar(s.size * (1 + a * 0.6)); } }
        for (let i = bubbles.length - 1; i >= 0; i--) if (now - bubbles[i].t > 4500) { bubbles[i].obj.remove(bubbles[i].b); bubbles.splice(i, 1); }
        if (lavaM) lavaM.emissiveIntensity = 1.2 + Math.sin(ts * 1.3) * 0.25;
        // ---- camera: orbit around the hero, never through walls, FOV kick when fast ----
        if (keys.has('q')) camYaw += dt * 2.2; if (keys.has('e')) camYaw -= dt * 2.2;
        headV.set(me.x, me.y + 1.45, me.z);
        dirV.set(Math.sin(camYaw) * Math.cos(camPitch), Math.sin(camPitch), Math.cos(camYaw) * Math.cos(camPitch)).normalize();
        let dist = camDist; ray.set(headV, dirV); ray.far = camDist + 0.3; const near = solids.filter((m) => { const p = m.parent.position; return Math.abs(p.x - me.x) < camDist + 8 && Math.abs(p.z - me.z) < camDist + 8 && Math.abs(p.y - me.y) < camDist + 8; }); const hits = ray.intersectObjects(near, false); if (hits.length) dist = Math.max(0.6, hits[0].distance - 0.35);
        tmpV.copy(headV).addScaledVector(dirV, dist); cam.position.lerp(tmpV, Math.min(1, dt * (dist < camDist ? 30 : 14)));
        if (shake > 0) { shake = Math.max(0, shake - dt); cam.position.x += (Math.random() - 0.5) * shake; cam.position.y += (Math.random() - 0.5) * shake; }
        cam.lookAt(headV.x, headV.y, headV.z);
        const wantFov = 66 + Math.min(14, Math.max(0, hv - SPEED) * 1.6) + (me.dashT > 0 ? 6 : 0); fov += (wantFov - fov) * Math.min(1, dt * 6); if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = fov; cam.updateProjectionMatrix(); }
        speedFx.style.opacity = String(Math.min(0.9, Math.max(0, (hv - SPEED * 1.15) / 8)));
        sun.position.set(me.x + 22, me.y + 42, me.z + 12); sun.target.position.set(me.x, me.y, me.z); rim.position.set(me.x - 20, me.y + 10, me.z - 25);
        env.tick(ts, me);
        // network
        if (now - sendT > 100) { sendT = now; const s = [me.x.toFixed(2), me.y.toFixed(2), me.z.toFixed(2), me.ry.toFixed(2)].join(); if (s !== lastSent) { lastSent = s; ws.send({ t: 'w3_move', x: me.x, y: me.y, z: me.z, ry: me.ry, a: moving ? 1 : 0 }); } }
        if (now - hudT > 100) { hudT = now; const help = t('WASD · Space jump · Shift sprint · F dash · click: mouse look · ⚙ controls');
          if (lv.kind === 'obby') mount(hud, h('span.wd-time', started ? tms(done ? 0 : now - t0) : t('Move to start the timer')), h('span.pill', '🚩 ' + me.cp + '/' + Math.floor(blocks.filter((b) => b.k === 'check').length)), ghost ? h('span.pill' + (ghostOn ? '' : '.muted'), '👻 ' + tms(ghost.ms)) : null, h('span.wd-dash' + (me.dashCd > 0 || !me.canDash ? '.cd' : ''), '» ' + t('Dash')), h('span.tiny.wd-help', help));
          else mount(hud, h('span.wd-dash' + (me.dashCd > 0 || !me.canDash ? '.cd' : ''), '» ' + t('Dash')), h('span.tiny.wd-help', help)); }
        if (post) post.render(); else renderer.render(scene, cam);
      }
      frame();
      stopGame = () => { live = false; cancelAnimationFrame(raf); ro.disconnect(); ws.send({ t: 'w3_leave' }); if (locked()) document.exitPointerLock(); document.removeEventListener('pointerlockchange', onLock); document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onKey); document.removeEventListener('mouseup', onUp); document.removeEventListener('mousemove', onMove); offs.splice(0).forEach((f) => f()); if (post) post.dispose(); env.dispose(); scene.traverse((o) => { if (o.geometry && o.geometry.type !== 'ExtrudeGeometry') o.geometry.dispose(); }); engineReset(); renderer.dispose(); try { renderer.forceContextLoss(); } catch {} };
    }
    lobby();
    return () => { if (stopGame) stopGame(); offs.forEach((f) => f()); };
  },
};

// Nebulix Arena (12.0): data shared by the browser and the server — weapons, the Nebula Ops map "Nebula Depot",
// the Nebula Royale island, storm phases and building pieces. All original designs. Plain data + pure functions,
// no DOM, so the server can import it too.

// dmg per body hit, rate = seconds between shots, range in metres, spread in radians, head = headshot multiplier
export const WEAPONS = {
  pistol: { n: ['Pulse pistol', 'Pistola de pulso'], dmg: 26, rate: 0.17, mag: 12, reload: 1.3, range: 60, spread: 0.008, auto: false, head: 2.4, price: 0, slot: 2 },
  smg: { n: ['Comet SMG', 'Subfusil Cometa'], dmg: 17, rate: 0.075, mag: 30, reload: 1.8, range: 45, spread: 0.022, auto: true, head: 1.8, price: 1200, slot: 1 },
  shotgun: { n: ['Breaker shotgun', 'Escopeta Rompe'], dmg: 11, pellets: 8, rate: 0.85, mag: 6, reload: 2.4, range: 22, spread: 0.07, auto: false, head: 1.6, price: 1100, slot: 1 },
  rifle: { n: ['Nova rifle', 'Rifle Nova'], dmg: 30, rate: 0.1, mag: 30, reload: 2.2, range: 120, spread: 0.012, auto: true, head: 3.6, price: 2700, slot: 1 },
  lance: { n: ['Lance sniper', 'Francotirador Lanza'], dmg: 92, rate: 1.3, mag: 5, reload: 2.8, range: 260, spread: 0.035, scopeSpread: 0.0006, auto: false, head: 2.2, price: 4500, slot: 1, scope: true },
};
export const ARMOR_PRICE = 650; export const KIT_PRICE = 400;
// Royale rarities: damage multiplier and colour
export const RARITY = [{ n: ['Common', 'Común'], c: '#9ca3af', m: 1 }, { n: ['Uncommon', 'Poco común'], c: '#22c55e', m: 1.06 }, { n: ['Rare', 'Rara'], c: '#3b82f6', m: 1.12 }, { n: ['Epic', 'Épica'], c: '#a855f7', m: 1.19 }, { n: ['Legendary', 'Legendaria'], c: '#f59e0b', m: 1.27 }];

// ---------- tiny seeded RNG ----------
export function rng(seed) { let a = typeof seed === 'number' ? seed >>> 0 : [...String(seed)].reduce((x, c) => (x * 31 + c.charCodeAt(0)) >>> 0, 7); return () => { a = (a + 0x6d2b79f5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }

// ---------- Nebula Ops: "Nebula Depot" (attackers spawn south, defenders north, sites A west and B east) ----------
// box: { x, z, w, d, h, y?, m: material }   m: wall | brick | crate | cont0..3 | metal | glass
export function opsMap() {
  const B = []; const box = (x, z, w, d, h, m = 'wall', y = 0) => B.push({ x, z, w, d, h, y, m });
  const W = 46, D = 38;
  box(0, -D, W * 2, 1.2, 7, 'brick'); box(0, D, W * 2, 1.2, 7, 'brick'); box(-W, 0, 1.2, D * 2, 7, 'brick'); box(W, 0, 1.2, D * 2, 7, 'brick');
  // spawns: walls around each base with two exits
  box(-14, 24, 18, 1, 4); box(14, 24, 18, 1, 4); box(-14, -26, 18, 1, 4); box(14, -26, 18, 1, 4);
  // mid: long hall with windows (two halves) and a central container stack
  box(-6, 0, 1, 18, 4.5, 'brick'); box(6, 0, 1, 18, 4.5, 'brick'); box(0, 3, 2.6, 6.2, 2.7, 'cont1'); box(0, 3, 2.6, 6.2, 2.7, 'cont3', 2.7);
  // A site (west): warehouse with two doors + crates
  box(-30, -24, 16, 1, 5, 'wall'); box(-38, -16, 1, 16, 5, 'wall'); box(-22, -12, 1, 8, 5, 'wall'); box(-34, -8, 8, 1, 5, 'wall');
  box(-30, -17, 1.4, 1.4, 1.4, 'crate'); box(-27, -19, 1.4, 1.4, 1.4, 'crate'); box(-27, -19, 1.2, 1.2, 1.2, 'crate', 1.4); box(-33, -12, 2.6, 6.2, 2.7, 'cont0');
  // A long corridor and A short (connector from mid)
  box(-24, 10, 1, 22, 4, 'wall'); box(-36, 6, 12, 1, 4, 'wall'); box(-16, -4, 10, 1, 4, 'wall');
  // B site (east): open yard with containers and a raised platform
  box(28, -16, 2.6, 6.2, 2.7, 'cont2'); box(22, -20, 6.2, 2.6, 2.7, 'cont0'); box(34, -10, 1.4, 1.4, 1.4, 'crate'); box(25, -11, 1.4, 1.4, 1.4, 'crate');
  box(36, -22, 8, 6, 1.2, 'metal'); box(20, -8, 1, 10, 4.5, 'brick'); box(38, -2, 16, 1, 4.5, 'brick');
  // B tunnels (east lane) and side rooms
  box(26, 10, 1, 20, 4, 'wall'); box(38, 14, 1, 12, 4, 'wall'); box(32, 20, 12, 1, 4, 'wall'); box(14, 12, 6, 6, 3.4, 'brick');
  box(-12, 14, 2.6, 6.2, 2.7, 'cont2'); box(12, -14, 6.2, 2.6, 2.7, 'cont1'); box(-4, -16, 1.4, 1.4, 1.4, 'crate'); box(4, 16, 1.4, 1.4, 1.4, 'crate');
  const spawns = { atk: [], def: [] };
  for (let i = 0; i < 5; i++) { spawns.atk.push({ x: -8 + i * 4, z: 31, yaw: 0 }); spawns.def.push({ x: -8 + i * 4, z: -32, yaw: Math.PI }); }
  return { boxes: B, spawns, sites: { A: { x: -29, z: -16, r: 6 }, B: { x: 28, z: -15, r: 6.5 } }, size: { w: W, d: D }, name: 'Nebula Depot' };
}

// ---------- Nebula Royale island ----------
export const ROYALE_SIZE = 300; // square island from -150 to 150
export const POIS = [['Nebula Crater', 'Cráter Nébula'], ['Rust Harbor', 'Puerto Óxido'], ['Prism Village', 'Villa Prisma'], ['Echo Towers', 'Torres Eco'], ['Lumen Woods', 'Bosque Lumen'], ['Cobalt Mine', 'Mina Cobalto'], ['Sunset Farm', 'Granja Ocaso']];
export function royaleMap(seed = 'nebula-royale-1') {
  const R = rng(seed); const H = ROYALE_SIZE / 2; const boxes = []; const trees = []; const chests = []; const pois = []; const rocks = [];
  const box = (x, z, w, d, h, m = 'wall', y = 0) => { boxes.push({ x, z, w, d, h, y, m }); };
  // a hollow house: four walls with a door gap, a roof slab and a chest inside
  const house = (cx, cz, w, d, m) => { const hh = 3.6; box(cx, cz - d / 2, w, 0.4, hh, m); box(cx - w / 2, cz, 0.4, d, hh, m); box(cx + w / 2, cz, 0.4, d, hh, m); box(cx - w / 4 - 0.6, cz + d / 2, w / 2 - 1.2, 0.4, hh, m); box(cx + w / 4 + 0.6, cz + d / 2, w / 2 - 1.2, 0.4, hh, m); box(cx, cz, w + 0.6, d + 0.6, 0.35, 'roof', hh); chests.push({ x: cx + (R() - 0.5) * (w - 3), z: cz - d / 4, door: { x: cx, z: cz + d / 2 + 1.2 }, box: { x: cx, z: cz, w, d } }); };
  const spots = [[0, 0], [-95, -85], [90, -95], [-100, 70], [95, 85], [-20, 110], [10, -115]];
  POIS.forEach((n, i) => {
    const [px, pz] = spots[i]; pois.push({ n, x: px, z: pz });
    const kind = i === 3 ? 'tower' : i === 4 ? 'woods' : i === 5 ? 'mine' : 'town'; const mats = ['wall', 'brick', 'wood', 'metal'];
    if (kind === 'tower') { for (let k = 0; k < 3; k++) { const x = px + (k - 1) * 14; box(x, pz, 7, 7, 14 + k * 4, 'metal'); chests.push({ x: x + 5, z: pz + 5 }); } }
    else if (kind === 'mine') { for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2; rocks.push({ x: px + Math.cos(a) * 14, z: pz + Math.sin(a) * 14, r: 3 + R() * 3 }); } box(px, pz, 10, 3, 3, 'metal'); chests.push({ x: px, z: pz + 4 }); chests.push({ x: px + 6, z: pz - 6 }); }
    else if (kind === 'woods') { for (let k = 0; k < 40; k++) trees.push({ x: px + (R() - 0.5) * 50, z: pz + (R() - 0.5) * 50, r: 0.6, h: 7 + R() * 5 }); house(px, pz, 8, 7, 'wood'); }
    else { const n2 = 4 + Math.floor(R() * 3); for (let k = 0; k < n2; k++) { const a = (k / n2) * Math.PI * 2 + R(); const r = 12 + R() * 10; house(px + Math.cos(a) * r, pz + Math.sin(a) * r, 8 + Math.floor(R() * 3) * 2, 7 + Math.floor(R() * 2) * 2, mats[(i + k) % mats.length]); } }
  });
  // trees and rocks everywhere else, keeping clear of towns
  const near = (x, z, d) => pois.some((p) => Math.hypot(p.x - x, p.z - z) < d);
  for (let k = 0; k < 260; k++) { const x = (R() - 0.5) * (ROYALE_SIZE - 20), z = (R() - 0.5) * (ROYALE_SIZE - 20); if (!near(x, z, 26)) trees.push({ x, z, r: 0.6, h: 6 + R() * 6 }); }
  for (let k = 0; k < 40; k++) { const x = (R() - 0.5) * (ROYALE_SIZE - 30), z = (R() - 0.5) * (ROYALE_SIZE - 30); if (!near(x, z, 24)) { rocks.push({ x, z, r: 1.5 + R() * 2.5 }); if (R() < 0.25) chests.push({ x: x + 3, z: z + 3 }); } }
  return { boxes, trees, rocks, chests, pois, size: ROYALE_SIZE, half: H };
}
// storm: wait (s) at the current circle, then shrink (s) to radius r; damage per second outside
export const STORM = [{ wait: 50, shrink: 40, r: 110, dps: 1 }, { wait: 40, shrink: 35, r: 70, dps: 2 }, { wait: 35, shrink: 30, r: 40, dps: 4 }, { wait: 30, shrink: 25, r: 20, dps: 6 }, { wait: 25, shrink: 25, r: 6, dps: 9 }, { wait: 20, shrink: 20, r: 0, dps: 12 }];
// building: 4 m grid. wall on a cell edge (dir 0 = north/south edge along x, 1 = along z), floor at a level, ramp rising toward dir 0..3
export const CELL = 4; export const BUILD_HP = 150; export const BUILD_COST = 10;
// collision boxes for a piece (ramps are handled with a height function)
export function pieceBox(p) {
  const x = p.gx * CELL, z = p.gz * CELL, y = p.gy * CELL;
  if (p.k === 'wall') return p.dir === 0 ? { x, z: z - CELL / 2, w: CELL, d: 0.3, h: CELL, y } : { x: x - CELL / 2, z, w: 0.3, d: CELL, h: CELL, y };
  if (p.k === 'floor') return { x, z, w: CELL, d: CELL, h: 0.3, y: y - 0.15 };
  return null; // ramp
}
// height of a ramp at (x, z), or null when outside it
export function rampY(p, x, z) {
  const cx = p.gx * CELL, cz = p.gz * CELL; if (Math.abs(x - cx) > CELL / 2 || Math.abs(z - cz) > CELL / 2) return null;
  const u = p.dir === 0 ? (cz + CELL / 2 - z) : p.dir === 1 ? (x - (cx - CELL / 2)) : p.dir === 2 ? (z - (cz - CELL / 2)) : (cx + CELL / 2 - x);
  return p.gy * CELL + Math.max(0, Math.min(CELL, u));
}
export const PLAYER_R = 0.4; export const EYE = 1.6;
// line of sight in 2D+height against boxes (true when nothing blocks the segment)
export function losBoxes(boxes, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  for (const b of boxes) {
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, y0 = b.y || 0, y1 = (b.y || 0) + b.h, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2; let t0 = 0, t1 = 1; let miss = false;
    for (const [p, d, lo, hi] of [[ax, dx, x0, x1], [ay, dy, y0, y1], [az, dz, z0, z1]]) { if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) { miss = true; break; } } else { let ta = (lo - p) / d, tb = (hi - p) / d; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) { miss = true; break; } } }
    if (!miss && t0 < 0.999 && t1 > 0.001) return false;
  }
  return true;
}

// ---------- Duels (13.0): "Prism Court", a small symmetric arena for 1 vs 1 ----------
// every round both players get the same weapon, in this order; first to 5 wins
export const DUEL_ROT = ['pistol', 'smg', 'shotgun', 'rifle', 'lance'];
export const DUEL_WIN = 5;
export function duelMap() {
  const B = []; const box = (x, z, w, d, h, m = 'wall', y = 0) => B.push({ x, z, w, d, h, y, m });
  const W = 22, D = 15;
  box(0, -D, W * 2, 1, 6, 'metal'); box(0, D, W * 2, 1, 6, 'metal'); box(-W, 0, 1, D * 2, 6, 'metal'); box(W, 0, 1, D * 2, 6, 'metal');
  // mirrored cover: pillars, low walls and containers (everything has a twin on the other side)
  for (const s of [-1, 1]) {
    box(s * 14, -7, 1.4, 1.4, 3.2, 'brick'); box(s * 14, 7, 1.4, 1.4, 3.2, 'brick');
    box(s * 9, 0, 1, 6, 1.2, 'wall'); box(s * 5, -10, 6.2, 2.6, 2.7, s < 0 ? 'cont0' : 'cont1'); box(s * 5, 10, 6.2, 2.6, 2.7, s < 0 ? 'cont2' : 'cont3');
    box(s * 17, 0, 1.4, 1.4, 1.4, 'crate'); box(s * 3, -4, 1.4, 1.4, 1.4, 'crate'); box(s * 3, 4, 1.2, 1.2, 1.2, 'crate');
  }
  box(0, 0, 2.6, 2.6, 2.6, 'glass'); box(0, -7, 1, 4, 3.4, 'brick'); box(0, 7, 1, 4, 3.4, 'brick');
  return { boxes: B, spawns: { atk: [{ x: -19, z: 0, yaw: -Math.PI / 2 }], def: [{ x: 19, z: 0, yaw: Math.PI / 2 }] }, sites: {}, size: { w: W, d: D }, name: 'Prism Court' };
}
// Royale consumables (13.0): med kit heals 50 (up to 100), shield cell adds 50 armor (up to 100)
export const HEALS = { med: { n: ['Med kit', 'Botiquín'], hp: 50, cd: 2.5, ic: '✚', key: 'h' }, sh: { n: ['Shield cell', 'Célula de escudo'], armor: 50, cd: 2.5, ic: '🛡', key: 'j' } };

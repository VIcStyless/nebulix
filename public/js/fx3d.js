// 14.0: shared effects for every 3D game (three.js is passed in, nothing is loaded here).
//   const fx = makeFx3d(THREE, scene);
//   fx.burst(pos, '#a78bfa')      sparks that fly out, fall and fade (additive glow)
//   fx.ring(pos, '#22d3ee')       a shockwave ring that grows on the ground and fades
//   fx.text(pos, '-42', '#fff')   a floating number / word that rises and fades
//   fx.kick(.3)                   camera shake (adds up, decays by itself)
//   fx.update(dt); fx.shake(cam)  once per frame, after the camera is placed
//   const dust = motes(THREE, scene, { area: 40, height: 10 }); dust.update(t)  floating dust in the light
// Everything is pooled per call and disposed when it ends; no textures are loaded from the network.
const reduced = () => typeof document !== 'undefined' && (document.documentElement.dataset.reduce === '1' || (document.documentElement.dataset.reduce !== '0' && matchMedia('(prefers-reduced-motion: reduce)').matches));

let dotTex = null;
function dot(THREE) {
  if (dotTex) return dotTex; const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(255,255,255,.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); dotTex = new THREE.CanvasTexture(c); return dotTex;
}

export function makeFx3d(THREE, scene) {
  const live = []; let shakeAmt = 0; let shakeT = 0; let rollOff = 0; const calm = reduced();
  function burst(pos, color = '#ffffff', { n = 26, speed = 5, life = .9, size = .16, gravity = -7, up = 2 } = {}) {
    const geo = new THREE.BufferGeometry(); const p = new Float32Array(n * 3); const v = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { p[i * 3] = pos.x; p[i * 3 + 1] = pos.y; p[i * 3 + 2] = pos.z; const a = Math.random() * Math.PI * 2; const e = Math.random() * Math.PI - Math.PI / 2; const s = speed * (.35 + Math.random() * .65); v[i * 3] = Math.cos(a) * Math.cos(e) * s; v[i * 3 + 1] = Math.abs(Math.sin(e)) * s + up * Math.random(); v[i * 3 + 2] = Math.sin(a) * Math.cos(e) * s; }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const mat = new THREE.PointsMaterial({ color: new THREE.Color(color), size, map: dot(THREE), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; scene.add(pts);
    live.push({ t: 0, life, step(dt, k) { const a = geo.attributes.position.array; for (let i = 0; i < n; i++) { v[i * 3 + 1] += gravity * dt; a[i * 3] += v[i * 3] * dt; a[i * 3 + 1] += v[i * 3 + 1] * dt; a[i * 3 + 2] += v[i * 3 + 2] * dt; if (a[i * 3 + 1] < 0.02) { a[i * 3 + 1] = 0.02; v[i * 3 + 1] *= -.35; v[i * 3] *= .7; v[i * 3 + 2] *= .7; } } geo.attributes.position.needsUpdate = true; mat.opacity = 1 - k * k; mat.size = size * (1 - k * .5); }, end() { scene.remove(pts); geo.dispose(); mat.dispose(); } });
  }
  function ring(pos, color = '#ffffff', { r = 2.2, life = .65, y = .04 } = {}) {
    const geo = new THREE.RingGeometry(.82, 1, 48); const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.set(pos.x, (pos.y || 0) * 0 + y, pos.z); scene.add(m);
    live.push({ t: 0, life, step(dt, k) { const s = .2 + (1 - (1 - k) ** 3) * r; m.scale.set(s, s, s); mat.opacity = (1 - k) * .9; }, end() { scene.remove(m); geo.dispose(); mat.dispose(); } });
  }
  function text(pos, str, color = '#ffffff', { life = .9, size = .55, rise = 1.4 } = {}) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 96; const g = c.getContext('2d'); g.font = '900 64px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,.65)'; g.strokeText(String(str), 128, 50); g.fillStyle = color; g.fillText(String(str), 128, 50);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    const s = new THREE.Sprite(mat); s.renderOrder = 999; s.position.set(pos.x, pos.y, pos.z); s.scale.set(size * 2.6, size, 1); scene.add(s); const y0 = pos.y; const dx = (Math.random() - .5) * .6;
    live.push({ t: 0, life, step(dt, k) { s.position.y = y0 + (1 - (1 - k) ** 2) * rise; s.position.x = pos.x + dx * k; const pop = k < .15 ? 1 + (1 - k / .15) * .6 : 1; s.scale.set(size * 2.6 * pop, size * pop, 1); mat.opacity = k > .6 ? 1 - (k - .6) / .4 : 1; }, end() { scene.remove(s); tex.dispose(); mat.dispose(); } });
  }
  function kick(a) { if (!calm) shakeAmt = Math.min(1, shakeAmt + a); }
  function update(dt) {
    shakeAmt = Math.max(0, shakeAmt - dt * 2.4); shakeT += dt;
    for (let i = live.length - 1; i >= 0; i--) { const e = live[i]; e.t += dt; const k = Math.min(1, e.t / e.life); e.step(dt, k); if (k >= 1) { e.end(); live.splice(i, 1); } }
  }
  // call after the game has placed the camera this frame
  function shake(cam) { cam.rotation.z -= rollOff; rollOff = 0; if (shakeAmt <= 0.001) return; const a = shakeAmt * shakeAmt; cam.position.x += (Math.sin(shakeT * 91) + Math.sin(shakeT * 37)) * .05 * a; cam.position.y += Math.sin(shakeT * 73) * .06 * a; rollOff = Math.sin(shakeT * 59) * .025 * a; cam.rotation.z += rollOff; }
  function dispose() { for (const e of live) e.end(); live.length = 0; }
  return { burst, ring, text, kick, update, shake, dispose };
}

// floating dust that catches the light (slow drift, gentle twinkle)
export function motes(THREE, scene, { count = 260, area = 40, height = 10, color = '#fff4d6', size = .07, center = { x: 0, z: 0 } } = {}) {
  const geo = new THREE.BufferGeometry(); const p = new Float32Array(count * 3); const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) { p[i * 3] = center.x + (Math.random() - .5) * area; p[i * 3 + 1] = .3 + Math.random() * height; p[i * 3 + 2] = center.z + (Math.random() - .5) * area; seed[i] = Math.random() * 100; }
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const mat = new THREE.PointsMaterial({ color: new THREE.Color(color), size, map: dot(THREE), transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; scene.add(pts); const base = p.slice();
  return {
    obj: pts,
    update(t) { const a = geo.attributes.position.array; for (let i = 0; i < count; i++) { const s = seed[i]; a[i * 3] = base[i * 3] + Math.sin(t * .13 + s) * .8; a[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * .21 + s * 1.7) * .5; a[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * .11 + s) * .8; } geo.attributes.position.needsUpdate = true; mat.opacity = .4 + Math.sin(t * .7) * .12; },
    dispose() { scene.remove(pts); geo.dispose(); mat.dispose(); },
  };
}
// frame-rate independent smoothing: move cur towards target (k ≈ how fast, per second)
export const damp = (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt));

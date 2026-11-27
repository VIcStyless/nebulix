// Nebulix 3.0 phase 23 — 3D model viewer: open GLB / glTF / STL / OBJ files from your device (or from Drive) and look
// at them with orbit controls, wireframe, lighting and background options, glTF animations, model statistics and a PNG
// screenshot. Everything runs in this tab with three.js (MIT, r170, vendored with its official loaders); files are not
// uploaded anywhere. #/model3d?src=<same-origin url>&name=<file name>
import { h, mount, fmt, ls } from '../util.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { toast, segEl, switchEl, emptyState } from '../ui.js';

const EXT = ['glb', 'gltf', 'stl', 'obj'];
const MAX = 200 << 20;
const extOf = (n) => (String(n).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';

export default {
  title: () => t('3D viewer'),
  async mount(root, ctx) {
    const [THREE, { OrbitControls }] = await Promise.all([import('../vendor/three.module.min.js'), import('../vendor/three-addons/controls/OrbitControls.js')]);
    const stage = h('div.m3-stage'); const info = h('div.m3-info'); const anim = h('div.m3-anim'); const drop = h('div.m3-drop', emptyState('cube', t('Open a 3D model'), t('GLB, glTF, STL or OBJ. Drop the file here or choose it. For a .gltf with separate .bin and texture files, select them all together.')));
    const file = h('input', { type: 'file', multiple: true, accept: '.glb,.gltf,.stl,.obj,.bin,.png,.jpg,.jpeg,.webp,.mtl', style: 'display:none', onChange: (e) => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) openFiles(fs); } });
    let bg = ls('m3.bg') || 'dark', light = ls('m3.light') || 'studio', wire = false, spin = false, grid = ls('m3.grid') !== false;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
    const gridH = new THREE.GridHelper(10, 20, 0x888888, 0x444444); gridH.material.transparent = true; gridH.material.opacity = 0.35; scene.add(gridH);
    const lights = new THREE.Group(); scene.add(lights);
    let model = null, mixer = null, clips = [], action = null, radius = 1; const clock = new THREE.Clock(); const blobs = [];
    stage.append(renderer.domElement, drop);

    function setLights() {
      lights.clear();
      if (light === 'flat') lights.add(new THREE.AmbientLight(0xffffff, 2.2));
      else if (light === 'sun') { lights.add(new THREE.HemisphereLight(0xbfdfff, 0x403020, 1.2)); const d = new THREE.DirectionalLight(0xfff2dd, 2.6); d.position.set(5, 10, 4); lights.add(d); }
      else { lights.add(new THREE.AmbientLight(0xffffff, 0.5)); const k = new THREE.DirectionalLight(0xffffff, 2.2); k.position.set(4, 6, 5); const f = new THREE.DirectionalLight(0xbcd4ff, 1.0); f.position.set(-5, 2, -3); const r = new THREE.DirectionalLight(0xffffff, 0.8); r.position.set(0, 4, -6); lights.add(k, f, r); }
    }
    function setBg() { stage.dataset.bg = bg; scene.background = bg === 'light' ? new THREE.Color(0xf2f3f5) : bg === 'dark' ? new THREE.Color(0x15161a) : null; }
    function setWire() { if (model) model.traverse((o) => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.wireframe = wire; }); }); }
    setLights(); setBg();

    function resize() { const w = stage.clientWidth || 600, hh = stage.clientHeight || 400; renderer.setSize(w, hh, false); camera.aspect = w / hh; camera.updateProjectionMatrix(); }
    const ro = new ResizeObserver(resize); ro.observe(stage);
    let raf = 0; const loop = () => { raf = requestAnimationFrame(loop); const dt = clock.getDelta(); if (mixer) mixer.update(dt); controls.autoRotate = spin; controls.update(); renderer.render(scene, camera); };
    loop();

    function frame() {
      if (!model) return; const box = new THREE.Box3().setFromObject(model); const size = box.getSize(new THREE.Vector3()); const c = box.getCenter(new THREE.Vector3());
      model.position.sub(c); model.position.y += size.y / 2; // centre it and stand it on the grid
      radius = Math.max(size.x, size.y, size.z) || 1; gridH.scale.setScalar(radius / 4); gridH.visible = grid;
      camera.near = radius / 1000; camera.far = radius * 100; camera.position.set(radius * 1.2, radius * 0.9, radius * 1.6); camera.updateProjectionMatrix();
      controls.target.set(0, size.y / 2, 0); controls.update();
      return size;
    }
    function stats(name, bytes, size) {
      let meshes = 0, verts = 0, tris = 0; const mats = new Set(), tex = new Set();
      model.traverse((o) => { if (!o.isMesh) return; meshes++; const g = o.geometry; const n = g.attributes.position ? g.attributes.position.count : 0; verts += n; tris += g.index ? g.index.count / 3 : n / 3; (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { mats.add(m); for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) if (m[k]) tex.add(m[k]); }); });
      const f = (n) => fmt.num(Math.round(n));
      mount(info, h('b', name), h('span', fmt.bytes(bytes)), h('span', t('{n} meshes', { n: meshes })), h('span', t('{n} vertices', { n: f(verts) })), h('span', t('{n} triangles', { n: f(tris) })), h('span', t('{n} materials', { n: mats.size })), h('span', t('{n} textures', { n: tex.size })), h('span', t('Size: {x} × {y} × {z} units', { x: size.x.toPrecision(3), y: size.y.toPrecision(3), z: size.z.toPrecision(3) })));
    }
    function paintAnim() {
      if (!clips.length) return mount(anim);
      const sel = h('select.input', { style: 'width:auto', 'aria-label': t('Animation'), onChange: (e) => play(Number(e.target.value)) }, clips.map((c, i) => h('option', { value: i }, (c.name || t('Animation {n}', { n: i + 1 })) + ' · ' + c.duration.toFixed(1) + ' s')));
      mount(anim, icon('play', 14), sel, h('button.btn.sm', { onClick: (e) => { if (!action) return; action.paused = !action.paused; e.currentTarget.textContent = action.paused ? t('Play') : t('Pause'); } }, t('Pause')));
    }
    function play(i) { if (!mixer) return; mixer.stopAllAction(); action = mixer.clipAction(clips[i]); action.play(); }
    function clear() { if (model) { scene.remove(model); model.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); }); }); } model = null; mixer = null; clips = []; action = null; blobs.splice(0).forEach((u) => URL.revokeObjectURL(u)); }

    async function load(name, buf, resolve) {
      const ext = extOf(name);
      if (!EXT.includes(ext)) return toast(t('Unsupported file. Open a GLB, glTF, STL or OBJ file.'), 'error');
      const busyEl = h('div.m3-busy', t('Loading…')); stage.append(busyEl);
      try {
        let obj, anims = [];
        if (ext === 'stl') {
          const { STLLoader } = await import('../vendor/three-addons/loaders/STLLoader.js'); const g = new STLLoader().parse(buf); g.computeVertexNormals();
          obj = new THREE.Mesh(g, g.hasColors ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }) : new THREE.MeshStandardMaterial({ color: 0x9aa4b5, roughness: 0.55, metalness: 0.1 }));
          obj.rotation.x = -Math.PI / 2; const grp = new THREE.Group(); grp.add(obj); obj = grp; // STL is usually Z-up
        } else if (ext === 'obj') {
          const { OBJLoader } = await import('../vendor/three-addons/loaders/OBJLoader.js'); obj = new OBJLoader().parse(new TextDecoder().decode(buf));
          obj.traverse((o) => { if (o.isMesh && (!o.material || o.material.type === 'MeshPhongMaterial')) o.material = new THREE.MeshStandardMaterial({ color: (o.material && o.material.color) || 0x9aa4b5, roughness: 0.6 }); });
        } else {
          const { GLTFLoader } = await import('../vendor/three-addons/loaders/GLTFLoader.js'); const mgr = new THREE.LoadingManager(); if (resolve) mgr.setURLModifier(resolve);
          const g = await new Promise((res, rej) => new GLTFLoader(mgr).parse(ext === 'gltf' ? new TextDecoder().decode(buf) : buf, '', res, rej));
          obj = g.scene; anims = g.animations || [];
        }
        clear(); model = obj; clips = anims; scene.add(model); if (clips.length) { mixer = new THREE.AnimationMixer(model); play(0); }
        const size = frame(); setWire(); stats(name, buf.byteLength, size); paintAnim(); drop.style.display = 'none'; ctx.setTitle && ctx.setTitle(name);
      } catch (e) { toast(t('Could not open this model: {e}', { e: (e && e.message) || String(e) }).slice(0, 220), 'error'); }
      finally { busyEl.remove(); }
    }
    async function openFiles(fs) {
      const main = fs.find((f) => EXT.includes(extOf(f.name))); if (!main) return toast(t('Unsupported file. Open a GLB, glTF, STL or OBJ file.'), 'error');
      if (main.size > MAX) return toast(t('That model is too big (over 200 MB)'), 'error');
      const map = new Map(fs.filter((f) => f !== main).map((f) => [f.name, f])); const urls = new Map();
      const resolve = (url) => { const n = decodeURIComponent(url.split(/[\\/]/).pop().split('?')[0]); const f = map.get(n); if (!f) return url; if (!urls.has(n)) { const u = URL.createObjectURL(f); urls.set(n, u); } return urls.get(n); };
      await load(main.name, await main.arrayBuffer(), resolve); for (const u of urls.values()) blobs.push(u);
    }
    async function openUrl(src, name) {
      let u; try { u = new URL(src, location.href); } catch { return; }
      if (u.origin !== location.origin) return toast(t('Only files from your Nebulix Drive can be opened by link'), 'error');
      try { const r = await fetch(u, { credentials: 'same-origin' }); if (!r.ok) throw new Error(r.status); const buf = await r.arrayBuffer(); if (buf.byteLength > MAX) return toast(t('That model is too big (over 200 MB)'), 'error'); await load(name || u.pathname.split('/').pop(), buf); } catch (e) { toast(t('Could not open this model: {e}', { e: e.message }), 'error'); }
    }

    stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('over'); });
    stage.addEventListener('dragleave', () => stage.classList.remove('over'));
    stage.addEventListener('drop', (e) => { e.preventDefault(); stage.classList.remove('over'); const fs = [...(e.dataTransfer.files || [])]; if (fs.length) openFiles(fs); });

    const shot = () => { renderer.render(scene, camera); renderer.domElement.toBlob((b) => { if (!b) return; const a = h('a', { href: URL.createObjectURL(b), download: 'model.png' }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }, 'image/png'); };
    mount(root, h('div.inner.m3',
      h('div.page-title', h('div', h('h2', icon('box3d', 22), ' ', t('3D viewer')), h('p', t('Look at GLB, glTF, STL and OBJ models in your browser. Files stay on your device.'))),
        h('button.btn.primary', { onClick: () => file.click() }, icon('upload', 16), t('Open model')), file),
      h('div.toolbar.m3-bar',
        segEl([['dark', t('Dark')], ['light', t('Light')], ['clear', t('Theme')]], bg, (v) => { bg = v; ls('m3.bg', v); setBg(); }),
        segEl([['studio', t('Studio')], ['sun', t('Sun')], ['flat', t('Flat')]], light, (v) => { light = v; ls('m3.light', v); setLights(); }),
        h('label.row', { style: 'gap:6px;align-items:center' }, switchEl(false, (v) => { wire = v; setWire(); }), h('span.small', t('Wireframe'))),
        h('label.row', { style: 'gap:6px;align-items:center' }, switchEl(false, (v) => { spin = v; }), h('span.small', t('Auto-rotate'))),
        h('label.row', { style: 'gap:6px;align-items:center' }, switchEl(grid, (v) => { grid = v; ls('m3.grid', v); gridH.visible = v; }), h('span.small', t('Grid'))),
        h('button.btn.sm', { onClick: () => frame() }, icon('refresh', 14), t('Reset view')),
        h('button.btn.sm', { onClick: shot }, icon('camera', 14), t('Screenshot'))),
      stage, anim, info,
      h('p.tiny.muted', t('Drag to rotate, right-drag or two fingers to move, scroll or pinch to zoom.'))));
    resize();
    if (ctx.query && ctx.query.get && ctx.query.get('src')) openUrl(ctx.query.get('src'), ctx.query.get('name'));
    return () => { cancelAnimationFrame(raf); ro.disconnect(); clear(); controls.dispose(); renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss(); };
  },
};

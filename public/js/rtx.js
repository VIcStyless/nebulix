// "RTX" mode for the 3D games: a WebGL post-processing chain built from the official three.js addons (vendored, r170).
//   ambient occlusion (GTAO: contact shadows in corners and under objects) → bloom (neon, lights and emissive glow)
//   → filmic output (tone mapping + colour space) → SMAA antialiasing.
// It also upgrades the shadows of every shadow-casting light (bigger maps, soft PCF, no acne).
// Turned off, or when the device cannot do it, the plain renderer.render() path is used.
import { ls } from './util.js';

// Chromebooks, phones and small laptops: post-processing is off by default there (it can still be turned on).
export const lowEnd = () => /CrOS/.test(navigator.userAgent) || (navigator.hardwareConcurrency || 4) <= 4 || matchMedia('(pointer: coarse)').matches || (navigator.deviceMemory || 8) <= 4;
export const rtxOn = () => { const v = ls('c3d.rtx'); return v === null ? !lowEnd() : v !== false; };
export const rtxSet = (v) => ls('c3d.rtx', !!v);
const weak = lowEnd;
// GPU name as reported by WebGL ('' if hidden by the browser)
export function gpuName(renderer) { try { const gl = renderer.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info'); return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); } catch { return ''; } }
// 'low' | 'med' | 'high' for the current device and GPU
export function autoTier(renderer) {
  const g = gpuName(renderer).toLowerCase();
  if (/swiftshader|llvmpipe|softpipe|software|basic render|mali|powervr|videocore|vivante|adreno \(tm\) [1-5]/.test(g)) return 'low';
  if (/CrOS/.test(navigator.userAgent)) return /nvidia|radeon rx|geforce|arc a/.test(g) ? 'med' : 'low';
  if (lowEnd() || /intel|uhd|hd graphics|mesa/.test(g)) return 'med';
  return 'high';
}

export function softShadows(THREE, renderer, scene, { size = 2048 } = {}) {
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene.traverse((o) => {
    if (!o.isLight || !o.castShadow || !o.shadow) return;
    if (o.shadow.mapSize.x < size) { o.shadow.mapSize.set(size, size); if (o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; } }
    o.shadow.bias = -0.0004; o.shadow.normalBias = 0.03; o.shadow.radius = 4;
  });
}

// Returns { render(), setSize(w, h), dispose() } or null if post-processing is not available.
export async function rtxPipeline(THREE, renderer, scene, camera, { bloom = 0.55, threshold = 0.85, radius = 0.45, ao = true, aoRadius = 0.6 } = {}) {
  try {
    const base = './vendor/three-addons/postprocessing/';
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }, { SMAAPass }, gt] = await Promise.all([
      import(base + 'EffectComposer.js'), import(base + 'RenderPass.js'), import(base + 'UnrealBloomPass.js'), import(base + 'OutputPass.js'), import(base + 'SMAAPass.js'),
      ao && !weak() ? import(base + 'GTAOPass.js') : Promise.resolve(null)]);
    const sz = renderer.getSize(new THREE.Vector2()); const w = Math.max(2, sz.x); const h = Math.max(2, sz.y);
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    let gtao = null;
    if (gt) { gtao = new gt.GTAOPass(scene, camera, w, h); gtao.output = gt.GTAOPass.OUTPUT.Default; gtao.blendIntensity = 0.85; gtao.updateGtaoMaterial({ radius: aoRadius, distanceExponent: 1.5, thickness: 1.5, scale: 1, samples: 12 }); gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 }); composer.addPass(gtao); }
    const bl = new UnrealBloomPass(new THREE.Vector2(w, h), bloom, radius, threshold); composer.addPass(bl);
    composer.addPass(new OutputPass());
    const pr = renderer.getPixelRatio(); const smaa = new SMAAPass(w * pr, h * pr); composer.addPass(smaa);
    return {
      render: () => composer.render(),
      setSize: (W, H) => { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(W, H); },
      dispose: () => { try { for (const p of composer.passes) p.dispose && p.dispose(); composer.dispose(); } catch { /* already gone */ } },
    };
  } catch (e) { console.warn('[rtx] post-processing unavailable', e); return null; }
}

// Animated backgrounds: a Hub upload of kind "wall" (video, image/GIF or an animated web page) shown behind the whole
// app. Videos are muted and loop; pages run sandboxed and cannot be clicked. Saved in settings.ui.livebg.
import { h } from './util.js';
import { api } from './api.js';
import { S, bus } from './state.js';

let layer = null; let current = '';
const reduced = () => document.documentElement.dataset.reduce === '1' || matchMedia('(prefers-reduced-motion: reduce)').matches;
export const liveBgCfg = () => Object.assign({ id: '', dim: 0.25, blur: 0, speed: 1 }, (S.me && S.me.settings && S.me.settings.ui && S.me.settings.ui.livebg) || {});

function clear() { if (layer) { layer.remove(); layer = null; } current = ''; document.documentElement.classList.remove('has-livebg'); }
export async function applyLiveBg(cfg = liveBgCfg()) {
  if (!cfg.id) { clear(); return; }
  const key = cfg.id;
  if (key !== current || !layer) {
    let w; try { w = await api.get('/api/hub/' + encodeURIComponent(cfg.id) + '/wall', { quiet: true }); } catch { clear(); return; }
    clear(); current = key;
    let media;
    if (w.wtype === 'video' && !reduced()) { media = h('video.lbg-media', { src: w.src, autoplay: true, muted: true, loop: true, playsinline: true, poster: w.thumb || null }); media.muted = true; media.play().catch(() => {}); }
    else if (w.wtype === 'video') media = h('img.lbg-media', { src: w.thumb || '', alt: '' });
    else if (w.wtype === 'image') media = h('img.lbg-media', { src: w.src, alt: '' });
    else media = h('iframe.lbg-media', { src: w.src, title: w.title, tabindex: -1, 'aria-hidden': 'true', loading: 'eager' });
    layer = h('div#nbx-livebg', { 'aria-hidden': 'true' }, media, h('div.lbg-dim'));
    const app = document.getElementById('app'); if (app && app.parentNode) app.parentNode.insertBefore(layer, app); else document.body.prepend(layer); // above the theme background, below the app
    document.documentElement.classList.add('has-livebg');
  }
  const m = layer.querySelector('.lbg-media'); m.style.filter = cfg.blur ? `blur(${cfg.blur}px)` : ''; m.style.transform = cfg.blur ? 'scale(1.06)' : '';
  if (m.tagName === 'VIDEO') m.playbackRate = cfg.speed || 1;
  layer.querySelector('.lbg-dim').style.background = `rgba(0,0,0,${cfg.dim})`;
}
// save + apply
export async function setLiveBg(patch) {
  const next = Object.assign(liveBgCfg(), patch);
  S.me.settings = S.me.settings || {}; S.me.settings.ui = Object.assign({}, S.me.settings.ui || {}, { livebg: next });
  await applyLiveBg(next);
  await api.patch('/api/profile', { settings: { ui: { livebg: patch } } });
  bus.emit('livebg', next);
}
// pause the video while the tab is hidden (saves battery)
document.addEventListener('visibilitychange', () => { const v = layer && layer.querySelector('video'); if (!v) return; if (document.hidden) v.pause(); else v.play().catch(() => {}); });

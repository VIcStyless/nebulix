// Nebulix 3.0 release trailer: one shared player used by the sign-in page, Home and #/trailer.
// The video is a static file streamed with Range requests (public/media), so it seeks instantly and needs no login.
import { h } from './util.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import { modal } from './ui.js';

export const TRAILER = { src: '/media/nebulix-3.0-trailer.mp4', poster: '/media/nebulix-3.0-trailer.jpg', duration: '0:54' };
export function trailerVideo(autoplay = false) {
  return h('video.tr-video', { src: TRAILER.src, poster: TRAILER.poster, controls: true, playsInline: true, preload: 'metadata', autoplay, 'aria-label': t('Nebulix 3.0 trailer') });
}
export function openTrailer() {
  const v = trailerVideo(true);
  const m = modal({ title: t('Nebulix 3.0 trailer'), body: h('div.tr-frame', v), cls: 'tr-modal' });
  m.then(() => { try { v.pause(); } catch {} });
  return m;
}
// small banner for Home; hides itself for good once dismissed
export function trailerCard() {
  let seen = false; try { seen = localStorage.getItem('nbx.trailer.hide') === '1'; } catch {}
  if (seen) return null;
  const card = h('section.tr-card', h('button.tr-thumb', { type: 'button', 'aria-label': t('Watch the trailer'), onClick: openTrailer, style: { backgroundImage: `url(${TRAILER.poster})` } }, h('span.tr-play', icon('play', 26))),
    h('div.grow', h('div.eyebrow', t('New')), h('b', t('Watch the Nebulix 3.0 trailer')), h('p.small.muted', t('A one-minute tour of what is new: Nebulix OS, Cloud PC, live documents, Game Maker and more.')),
      h('div.row', { style: 'gap:8px' }, h('button.btn.primary.sm', { type: 'button', onClick: openTrailer }, icon('play', 14), t('Watch the trailer') + ' · ' + TRAILER.duration),
        h('button.btn.ghost.sm', { type: 'button', onClick: () => { try { localStorage.setItem('nbx.trailer.hide', '1'); } catch {} card.remove(); } }, t('Hide')))));
  return card;
}

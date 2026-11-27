// #/trailer — the Nebulix 3.0 release trailer on its own page.
import { h, mount } from '../util.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { trailerVideo, TRAILER } from '../trailer.js';

export default {
  title: () => t('Nebulix 3.0 trailer'),
  mount(root) {
    mount(root, h('div.inner.tr-page', h('div.page-title', h('div', h('h2', icon('play', 22), ' ', t('Nebulix 3.0 trailer')), h('p', t('A one-minute tour of what is new: Nebulix OS, Cloud PC, live documents, Game Maker and more.')))),
      h('div.tr-frame', trailerVideo(false)),
      h('p.tiny.muted', t('Recorded from the real Nebulix interface. Nebulix Android is shown on a test compute node and arrives on the public site when a KVM server is connected. Original music made for Nebulix.')),
      h('div.row', { style: 'gap:8px' }, h('a.btn.sm', { href: TRAILER.src, download: 'nebulix-3.0-trailer-en.mp4' }, icon('download', 14), t('Download MP4')), h('a.btn.sm.ghost', { href: '#/changelog' }, icon('list', 14), t('What changed')))));
  },
};

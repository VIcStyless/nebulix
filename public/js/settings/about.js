// Settings → About: credits, version, keyboard shortcuts and quick links.
import { h, mount } from '../util.js';
import { t } from '../i18n.js';
import { S } from '../state.js';
import { icon } from '../icons.js';

const SHORTCUTS = [
  ['Ctrl / ⌘ + K', 'Open search & jump-to'], ['Enter', 'Send a message'], ['Shift + Enter', 'New line in a message'], ['Esc', 'Close a dialog or menu'],
];

export default {
  mount(host, ctx) {
    const cfg = S.cfg || {};
    const link = (label, ic, nav) => h('button.btn', { onClick: () => ctx.go(nav) }, icon(ic, 16), t(label));
    mount(host,
      h('section.card.set-about',
        h('div.set-logo', h('div.boot-logo'), h('div', h('h2', { style: 'margin:0' }, cfg.brand || 'Nebulix'), h('div.muted', t('A fast, private, gaming-first web proxy.')))),
        h('div.set-credit', t('Created by'), ' ', h('b.grad-text', cfg.creator || 'VicStyles')),
        h('div.nl-pills', { style: 'margin-top:10px' }, h('span.pill', 'v' + (cfg.version || '3.0.0')), h('span.pill', t('Proxy')), h('span.pill', t('Community')), h('span.pill', t('E2EE DMs')), h('span.pill', t('Casino')), h('span.pill', t('Themes')), h('span.pill', 'Nova AI'), h('span.pill', t('Nerd Lab')), h('span.pill', 'Pulse'), h('span.pill', t('DJ mode')), h('span.pill', t('Desktop mode')), h('span.pill', t('Arcade')), h('span.pill', t('Roles')), h('span.pill', t('Achievements')))),
      h('section.card', h('h3', icon('keyboard', 18), t('Keyboard shortcuts')),
        h('div.col', { style: 'gap:4px' }, SHORTCUTS.map(([k, d]) => h('div.setting', { style: 'padding:7px 0' }, h('span.grow', t(d)), h('kbd', k))))),
      h('section.card', h('h3', icon('link', 18), t('Jump to')),
        h('div.row.wrap', link('Nerd Lab', 'flask', 'nerd'), link('Themes', 'palette', 'themes'), link('Market', 'bag', 'market'), link('Nova AI', 'spark', 'nova'), link('Go PRO', 'crown', 'pro'))),
      h('p.tiny.muted', { style: 'text-align:center;margin-top:16px' }, t('Nebulix is a personal project for the gaming community. Use it responsibly and respect the rules of your school or network.')));
    return () => {};
  },
};

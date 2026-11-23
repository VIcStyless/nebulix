// Settings: profile, appearance, browsing, privacy, security and about — each a lazily-loaded module under ../settings/.
import { h, mount } from '../util.js';
import { t } from '../i18n.js';
import { tabsEl } from '../ui.js';

const TABS = [
  ['profile', 'Profile', 'user', () => import('../settings/profile.js')],
  ['appearance', 'Appearance', 'palette', () => import('../settings/appearance.js')],
  ['proxy', 'Browsing', 'globe', () => import('../settings/proxy.js')],
  ['privacy', 'Privacy', 'eyeoff', () => import('../settings/privacy.js')],
  ['safety', 'Safety', 'alert', () => import('../settings/panic.js')],
  ['security', 'Security', 'shield', () => import('../settings/security.js')],
  ['about', 'About', 'info', () => import('../settings/about.js')],
];

export default {
  title: () => t('Settings'),
  mount(root, ctx) {
    let token = 0, cleanup = null;
    const first = TABS.some((x) => x[0] === ctx.params[0]) ? ctx.params[0] : 'profile';
    const body = h('div.set-body');
    async function show(id) {
      const my = ++token; if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
      history.replaceState(null, '', '#/settings/' + id);
      mount(body, h('div.empty', h('span.spinner')));
      try {
        const mod = (await TABS.find((x) => x[0] === id)[3]()).default; if (my !== token) return;
        const box = h('div.set-tab', { dataset: { tab: id } }); mount(body, box);
        const c = await mod.mount(box, ctx); if (my !== token) { if (typeof c === 'function') c(); return; } cleanup = typeof c === 'function' ? c : null;
      } catch (e) { console.error(e); if (my === token) mount(body, h('div.empty', h('div.empty-art.ea-mark'), h('h3', t('This section failed to load')), h('p.muted', String(e.message || e)))); }
    }
    const tabs = tabsEl(TABS.map(([id, l, ic]) => [id, t(l), ic]), first, show);
    mount(root, h('div.page.settings',
      h('div.page-title', h('div', h('h2', t('Settings')), h('p', t('Make Nebulix yours — your look, your privacy and your account.')))),
      h('div.set-tabs', tabs), body));
    show(first);
    return () => { token++; if (cleanup) { try { cleanup(); } catch {} } };
  },
};

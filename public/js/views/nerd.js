// Nerd Lab: system info, benchmarks, input/display tests, network lab, Linux Lab (DistroSea) and a toy console.
// Each tab lives in its own module under ../nerd/ and is only loaded when opened.
import { h, mount } from '../util.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { tabsEl } from '../ui.js';

const TABS = [
  ['sys', 'System', 'cpu', () => import('../nerd/sys.js')],
  ['bench', 'Benchmarks', 'bolt', () => import('../nerd/bench.js')],
  ['input', 'Input & display', 'gamepad', () => import('../nerd/input.js')],
  ['net', 'Network', 'wifi', () => import('../nerd/net.js')],
  ['linux', 'Linux Lab', 'cube', () => import('../nerd/linux.js')],
  ['term', 'Console', 'terminal', () => import('../nerd/term.js')],
];

export default {
  title: () => t('Nerd Lab'),
  mount(root, ctx) {
    let token = 0, cleanup = null;
    const first = TABS.some((x) => x[0] === ctx.params[0]) ? ctx.params[0] : 'sys';
    const body = h('div.nl-body');
    async function show(id) {
      const my = ++token; if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
      history.replaceState(null, '', '#/nerd/' + id + (ctx.query && [...ctx.query.keys()].length && id === first ? '?' + ctx.query.toString() : ''));
      mount(body, h('div.empty', h('span.spinner')));
      try {
        const mod = (await TABS.find((x) => x[0] === id)[3]()).default; if (my !== token) return;
        const box = h('div.nl-tab', { dataset: { tab: id } }); mount(body, box);
        const c = await mod.mount(box, ctx); if (my !== token) { if (typeof c === 'function') c(); return; } cleanup = typeof c === 'function' ? c : null;
      } catch (e) { console.error(e); if (my === token) mount(body, h('div.empty', h('div.empty-art.ea-mark'), h('h3', t('This lab failed to load')), h('p.muted', String(e.message || e)))); }
    }
    const tabs = tabsEl(TABS.map(([id, l, ic]) => [id, t(l), ic]), first, show);
    mount(root, h('div.page.nerd',
      h('div.page-title', h('div', h('h2', '', t('Nerd Lab')), h('p', t('Benchmark your PC, test your keyboard, mouse, controller and screen, check your network and try Linux right in the browser.')))),
      h('div.nl-tabs', tabs), body));
    show(first);
    return () => { token++; if (cleanup) { try { cleanup(); } catch {} } };
  },
};

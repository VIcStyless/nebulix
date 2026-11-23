// Settings → Browsing: how the Nebulix proxy behaves — search engine, ad/tracker shield, JS rewriting, cache and the identity sites see.
import { h, mount } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S, patchMe } from '../state.js';
import { icon } from '../icons.js';
import { toastErr, settingRow, switchEl, segEl } from '../ui.js';

const ENGINES = [['nebulix', 'Nebulix Search'], ['ddg', 'DuckDuckGo'], ['brave', 'Brave'], ['bing', 'Bing'], ['google', 'Google']];
const UAS = [['auto', t('Automatic')], ['chrome', 'Chrome'], ['firefox', 'Firefox'], ['safari', 'Safari'], ['mobile', t('Mobile')]];

export default {
  mount(host) {
    const p = Object.assign({ engine: 'nebulix', adblock: true, jsRewrite: true, stripTracking: true, cache: true, ua: 'auto' }, (S.me.settings && S.me.settings.proxy) || {});
    const save = async (patch) => {
      Object.assign(p, patch);
      try { const r = await api.patch('/api/profile', { settings: { proxy: patch } }); patchMe({ settings: r.user.settings }); } catch (e) { toastErr(e); }
    };
    const tog = (k) => switchEl(p[k], (v) => save({ [k]: v }));

    mount(host,
      h('section.card', h('h3', icon('search', 18), t('Search & identity')),
        settingRow(t('Search engine'), t('Used when you type words instead of a web address.'), segEl(ENGINES, p.engine, (v) => save({ engine: v }))),
        settingRow(t('Appear as'), t('Which browser the sites you visit think you are using. "Automatic" matches your real browser.'), segEl(UAS, p.ua, (v) => save({ ua: v })))),
      h('section.card', h('h3', icon('shield', 18), t('Privacy shield')),
        settingRow(t('Block ads & trackers'), t('Filters known ad, tracker and miner domains while you browse. Pages load faster and cleaner.'), tog('adblock')),
        settingRow(t('Strip tracking data'), t('Removes tracking parameters from links and blocks cross-site cookies and referrers.'), tog('stripTracking')),
        settingRow(t('Rewrite JavaScript'), t('Lets more complex sites work through the proxy. Turn off only if a site misbehaves.'), tog('jsRewrite')),
        settingRow(t('Cache static files'), t('Keeps images, fonts and scripts briefly so pages you revisit load instantly.'), tog('cache'))),
      h('p.tiny.muted', { style: 'margin-top:12px' }, t('Through the proxy, websites see the Nebulix server instead of your own computer, and your browsing stays inside Nebulix. These settings apply the next time you open or reload a tab.')));
    return () => {};
  },
};

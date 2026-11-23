// Nebulix 13.3 — Links: every address of Nebulix (mirrors of the same server) with live status, and a link generator
// for short links to any page inside Nebulix that work on every mirror. #/links
import { h, mount, fmt } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, busy, loading, emptyState, confirmBox } from '../ui.js';

const DESTS = [['', 'Home'], ['arena', 'Nebulix Arena'], ['browse', 'Browser'], ['vault', 'Nebula Vault'], ['shop', 'Shop & Locker'], ['casino', 'Casino'], ['nova', 'Nova AI'], ['terminal', 'Terminal'], ['vm', 'Virtual machines'], ['security', 'Security Lab'], ['vpn', 'Nebulix VPN'], ['chat', 'Community']];
const copy = (txt) => navigator.clipboard.writeText(txt).then(() => toast(t('Copied!'), 'good', 1000));
// open Nebulix inside a blank tab (the address bar and history only show about:blank)
function openHidden(url) { const w = window.open('about:blank', '_blank'); if (!w) return toast(t('Allow pop-ups to open the hidden tab'), 'err'); w.document.title = t('New tab'); const f = w.document.createElement('iframe'); f.src = url; f.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0'; f.allow = 'fullscreen; autoplay; clipboard-write; microphone; camera; gamepad'; w.document.body.style.margin = '0'; w.document.body.appendChild(f); }
export default {
  title: () => t('Links'),
  async mount(root) {
    const inner = h('div.inner.ln'); mount(root, inner, loading()); let d;
    async function load() { try { d = await api.get('/api/links'); paint(); check(); } catch (e) { mount(inner, emptyState('alert', t('Could not load this'), e.message)); } }
    async function check() { try { const r = await api.post('/api/links/check', {}); d.mirrors = r.mirrors; paintMirrors(); } catch {} }
    const mirrorsEl = h('div.ln-mirrors'); const outEl = h('div'); const mineEl = h('div');
    const paintMirrors = () => mount(mirrorsEl, d.mirrors.map((m) => h('div.ln-m', h('span.nv2-mdot' + (m.status ? (m.status.ok ? '.ok' : '.bad') : '')), h('div.grow', h('b', m.host), h('div.tiny.muted', (m.main ? t('Main address') : m.custom ? t('Custom domain') : t('Mirror')) + (m.status ? ' · ' + (m.status.ok ? m.status.ms + ' ms' : t('not answering')) : ''))),
      h('button.btn.sm', { onClick: () => copy(m.url) }, icon('copy', 13), t('Copy')), h('button.btn.sm', { onClick: () => openHidden(m.url) }, icon('eyeoff', 13), t('Hidden tab')), h('a.btn.sm', { href: m.url, target: '_blank', rel: 'noopener' }, icon('external', 13)))));
    const paintMine = () => mount(mineEl, d.mine.length ? d.mine.map((l) => h('div.ln-m', h('div.grow', h('b', '/l/' + l.code), h('div.tiny.muted', '→ #/' + (l.path || '') + ' · ' + t('{n} visits', { n: l.hits || 0 }) + ' · ' + fmt.date(l.t))),
      h('button.btn.sm', { onClick: () => copy(d.mirrors.map((m) => m.url + '/l/' + l.code).join('\n')) }, icon('copy', 13), t('Copy all')), h('button.btn.sm.ghost', { onClick: async () => { if (!(await confirmBox(t('Delete this link?'), { danger: true }))) return; await api.del('/api/links/' + l.code); d.mine = d.mine.filter((x) => x.code !== l.code); paintMine(); } }, icon('trash', 13)))) : h('p.small.muted', t('You have not created links yet.')));
    function paint() {
      const dest = h('select.input', DESTS.map(([v, l]) => h('option', { value: v }, t(l)))); const custom = h('input.input', { placeholder: t('…or paste a Nebulix link (for example a game or a profile)') }); const code = h('input.input', { placeholder: t('Link name (optional, e.g. my-game)') });
      const gen = (btn) => busy(btn, async () => { try { const r = await api.post('/api/links', { path: custom.value.trim() || dest.value, code: code.value.trim() }); d.mine.unshift(r.link); paintMine(); code.value = '';
        mount(outEl, h('div.ln-out', h('div.row', h('b.grow', t('Your link works on every address:')), h('button.btn.sm.primary', { onClick: () => copy(r.urls.join('\n')) }, icon('copy', 13), t('Copy all'))), r.urls.map((u) => h('div.ln-url', h('code.grow', u), h('button.btn.sm', { onClick: () => copy(u) }, icon('copy', 12)), h('button.btn.sm', { onClick: () => openHidden(u) }, icon('eyeoff', 12)))))); } catch (e) { toastErr(e); } });
      mount(inner, h('div.page-title', h('div', h('h2', t('Links')), h('p', t('All the addresses of Nebulix. They are the same server: your account, coins and data are the same on every one.')))),
        h('div.card', h('div.row', h('h3.grow', icon('link', 18), ' ', t('Nebulix addresses')), h('button.btn.sm', { onClick: (e) => busy(e.currentTarget, check) }, icon('refresh', 13), t('Check'))), mirrorsEl, h('p.tiny.muted', t('If one address does not open on your network, try another. You may need to sign in again on a new address.'))),
        h('div.card', h('h3', icon('zap', 18), ' ', t('Link generator')), h('p.small.muted', t('Make a short link to any page of Nebulix. It works on every address, and you can open it in a hidden tab.')), h('div.ln-form', dest, custom, code, h('button.btn.primary', { onClick: (e) => gen(e.currentTarget) }, t('Generate'))), outEl),
        h('div.card', h('h3', t('Your links')), mineEl));
      paintMirrors(); paintMine();
    }
    load(); void S;
    return () => {};
  },
};

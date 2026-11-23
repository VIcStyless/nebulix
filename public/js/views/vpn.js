// Nebulix 13.3 — Nebulix VPN: one switch for maximum privacy while browsing inside Nebulix. #/vpn
// Websites opened in the Nebulix browser already see the server instead of you. VPN mode adds a generic identity
// (browser, language, time zone), the ad and tracker shield and a WebRTC block so pages cannot discover your real IP.
// It protects browsing inside Nebulix; it does not change the connection of other apps on your device.
import { h, mount } from '../util.js';
import { t, pick2 } from '../i18n.js';
import { api } from '../api.js';
import { S, patchMe } from '../state.js';
import { icon } from '../icons.js';
import { toastErr, loading, emptyState } from '../ui.js';
import { sfx } from '../sfx.js';

// which addresses this browser reveals through WebRTC outside Nebulix (a local test, nothing is sent anywhere)
function webrtcLeak() {
  return new Promise((res) => {
    const ips = new Set(); let pc; try { pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }); } catch { return res({ blocked: true, ips: [] }); }
    pc.createDataChannel('x'); pc.onicecandidate = (e) => { if (!e.candidate) return; const m = /(\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){2,7})/i.exec(e.candidate.candidate); if (m && !/\.local$/.test(e.candidate.candidate)) ips.add(m[1]); };
    pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => {}); setTimeout(() => { try { pc.close(); } catch {} res({ blocked: false, ips: [...ips] }); }, 2500);
  });
}
export default {
  title: () => 'Nebulix VPN',
  async mount(root, ctx) {
    const inner = h('div.inner.vpn'); mount(root, inner, loading()); let d;
    async function load() { try { d = await api.get('/api/vpn'); paint(); } catch (e) { mount(inner, emptyState('alert', t('Could not load this'), e.message)); } }
    async function toggle() {
      const on = !d.on; try { const patch = on ? { vpn: true, adblock: true, stripTracking: true } : { vpn: false }; const r = await api.patch('/api/profile', { settings: { proxy: patch } }); patchMe({ settings: r.user.settings }); d.on = on; sfx.click(); paint(); } catch (e) { toastErr(e); }
    }
    function paint() {
      const ex = d.exit || {}; const where = d.regionName ? pick2(d.regionName) : [ex.city, ex.country].filter(Boolean).join(', ') || '—';
      const leakEl = h('div.small.muted', t('Not tested'));
      mount(inner,
        h('div.vpn-hero' + (d.on ? '.on' : ''), h('button.vpn-btn', { onClick: toggle, 'aria-pressed': String(d.on) }, icon('power', 46)), h('h2', d.on ? t('Protected') : t('Not protected')), h('p.muted', d.on ? t('Browsing in Nebulix goes out through {w}. Sites see the server, a generic browser and no real IP.', { w: where }) : t('Turn it on for maximum privacy while you browse inside Nebulix.')),
          h('button.btn.primary', { onClick: () => ctx.go('browse') }, icon('globe', 15), t('Open the protected browser'))),
        h('div.vpn-grid',
          h('div.card', h('h4', icon('globe', 15), ' ', t('What websites see')), kv(t('IP address'), ex.ip || '—'), kv(t('Location'), where), kv(t('Network'), ex.org || '—'), kv(t('Browser'), d.on ? 'Chrome (' + t('generic') + ')' : t('Your real browser')), kv(t('Language & time zone'), d.on ? 'en-US · UTC' : t('Your own'))),
          h('div.card', h('h4', icon('user', 15), ' ', t('Your connection')), kv(t('Your IP (only you see this)'), d.you.ip || '—'), h('p.tiny.muted', t('Inside Nebulix, websites never receive this address.'))),
          h('div.card', h('h4', icon('shield', 15), ' ', t('Protections')), [[d.on || d.shield.adblock, t('Ads and trackers blocked')], [d.on || d.shield.strip, t('Tracking data and cross-site cookies removed')], [d.on, t('WebRTC IP leak blocked')], [d.on, t('Generic browser identity, language and time zone')], [true, t('Encrypted between you and Nebulix (HTTPS)')]].map(([ok, l]) => h('div.vpn-p.' + (ok ? 'ok' : 'off'), icon(ok ? 'check' : 'x', 14), ' ', l))),
          h('div.card', h('h4', icon('activity', 15), ' ', t('Leak test')), h('p.small.muted', t('Checks which IP addresses this browser reveals through WebRTC outside Nebulix.')), leakEl, h('button.btn.sm', { onClick: async (e) => { e.currentTarget.disabled = true; const r = await webrtcLeak(); e.currentTarget.disabled = false; mount(leakEl, r.blocked ? h('span.sl-good', icon('check', 13), ' ', t('WebRTC is blocked in this browser')) : r.ips.length ? h('span', { style: 'color:#f59e0b' }, t('This browser reveals: {ips}. Inside the Nebulix browser with VPN on, this is blocked.', { ips: r.ips.join(', ') })) : h('span.sl-good', t('No addresses revealed'))); } }, t('Run test')))),
        h('p.tiny.muted', t('Nebulix VPN protects what you browse inside Nebulix. It does not change the connection of other apps or the rest of your device.')));
    }
    const kv = (k, v) => h('div.vb-kv', h('span', k), h('b', v));
    load(); void S;
    return () => {};
  },
};

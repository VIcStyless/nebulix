// Nerd Lab → System: what your browser can tell about your machine, a gaming-readiness check, and a shareable report.
import { h, mount, fmt, download, copyText } from '../util.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { toast } from '../ui.js';
import { card, kv, pill, sysInfo, measureRefresh, reportText, hwTip } from './common.js';

export default {
  async mount(host) {
    let alive = true; let info = null; let hz = 0;
    const grid = h('div.nl-grid'); const bar = h('div.row.wrap', { style: 'margin-bottom:12px' });
    mount(host, bar, grid, h('p.tiny.muted', { style: 'margin-top:12px' }, t('Everything on this page is read by your own browser and never leaves your device unless you copy the report yourself.')));
    mount(grid, h('div.empty', h('span.spinner'), h('p', { style: 'margin-top:10px' }, t('Scanning your setup…'))));

    async function run() {
      info = await sysInfo(); if (!alive) return; paint();
      const r = await measureRefresh(900); if (!alive) return; hz = r.hz; paint();
    }
    const yn = (v) => (v ? pill(t('Yes'), 'ok') : pill(t('No'), 'bad'));
    function paint() {
      const i = info; const s = i.screen; const g = i.gl;
      const gaming = [
        [t('At least 4 CPU threads'), i.threads >= 4, t('{n} threads', { n: i.threads || '?' })],
        [t('Hardware-accelerated graphics'), !!g && !g.software, g ? (g.software ? t('Software rendering') : t('GPU in use')) : t('No WebGL')],
        [t('WebGL 2'), !!(g && g.gl2), ''],
        [t('Screen at 60 Hz or better'), hz >= 58, hz ? hz + ' Hz' : t('Measuring…')],
        [t('Gamepad support'), i.feats.find((f) => f[0] === 'Gamepad API')[1], ''],
        [t('Fullscreen + mouse capture'), i.feats.find((f) => f[0] === 'Fullscreen')[1] && i.feats.find((f) => f[0] === 'Pointer Lock')[1], ''],
        [t('Sound (Web Audio)'), i.feats.find((f) => f[0] === 'Web Audio')[1], ''],
      ];
      const okN = gaming.filter((x) => x[1]).length; const tip = hwTip(i);
      const verdict = okN === gaming.length ? t('Looks great for browser gaming.') : okN >= gaming.length - 2 ? t('Good to go — a couple of things could be better.') : t('Your setup may struggle with heavier games.');
      mount(grid,
        card(t('Gaming readiness'), 'gamepad',
          h('div.nl-verdict', h('b', verdict), h('span.muted.small', ` ${okN}/${gaming.length}`)),
          gaming.map(([l, ok, d]) => h('div.nl-check' + (ok ? '.ok' : '.bad'), icon(ok ? 'check' : 'x', 16), h('span.grow', l), h('span.muted.small', d))),
          tip ? h('div.nl-warn', icon('alert', 16), h('span', tip)) : null),
        card(t('Your machine'), 'cpu',
          kv(t('Operating system'), i.os), kv(t('Browser'), i.browser), i.arch ? kv(t('Architecture'), i.arch) : null,
          kv(t('CPU threads'), i.threads || null), kv(t('Memory (browser-reported)'), i.memGB ? (i.memGB >= 8 ? '8+ GB' : i.memGB + ' GB') : null, t('Browsers round this value on purpose to protect your privacy')),
          kv(t('Touch points'), i.touch), kv(t('Language'), i.languages.slice(0, 3).join(', ')), kv(t('Time zone'), i.tz),
          i.jsHeap ? kv(t('Browser memory in use'), `${fmt.bytes(i.jsHeap.used)} / ${fmt.bytes(i.jsHeap.limit)}`) : null),
        card(t('Graphics & display'), 'monitor',
          kv(t('GPU'), g ? g.renderer : t('Not available')), g ? kv(t('GPU vendor'), g.vendor) : null, kv('WebGL', g ? (g.gl2 ? '2' : '1') : t('No')), kv('WebGPU', i.gpuApi ? t('Yes') : t('No')),
          kv(t('Screen'), `${s.w} × ${s.h}`), kv(t('Real pixels'), `${s.pw} × ${s.ph}  (@${s.dpr}x)`), kv(t('Window'), `${s.vw} × ${s.vh}`),
          kv(t('Refresh rate'), hz ? `${hz} Hz` : t('Measuring…')), kv(t('HDR'), i.hdr ? t('Yes') : t('No')), kv(t('Wide colour (P3)'), i.p3 ? t('Yes') : t('No')), kv(t('Colour depth'), s.depth + ' bit')),
        card(t('Connection, power & storage'), 'wifi',
          kv(t('Online'), i.online ? t('Yes') : t('No')),
          i.conn ? [kv(t('Connection type'), (i.conn.type || '?').toUpperCase()), kv(t('Reported bandwidth'), i.conn.down ? i.conn.down + ' Mbps' : null), kv(t('Reported latency'), i.conn.rtt ? i.conn.rtt + ' ms' : null), kv(t('Data saver'), i.conn.save ? t('On') : t('Off'))] : kv(t('Connection details'), t('Hidden by your browser')),
          i.battery ? kv(t('Battery'), `${i.battery.level}%${i.battery.charging ? '' : ''}`) : null,
          i.storage ? kv(t('Browser storage'), `${fmt.bytes(i.storage.used)} / ${fmt.bytes(i.storage.quota)}`) : null, kv(t('Cookies enabled'), i.cookies ? t('Yes') : t('No')), kv(t('Cross-origin isolated'), i.isolated ? t('Yes') : t('No'))),
        card(t('Browser features'), 'puzzle', h('div.nl-pills', i.feats.map(([k, v]) => h('span.pill' + (v ? '.ok' : '.bad'), (v ? '' : '') + k)))),
        card(t('Preferences your browser reports'), 'sliders', kv(t('Dark mode'), yn(i.dark)), kv(t('Reduced motion'), yn(i.reduceMotion))));
    }
    bar.appendChild(h('button.btn', { onClick: async () => { mount(grid, h('div.empty', h('span.spinner'))); hz = 0; await run(); toast(t('Scan complete'), 'good', 2000); } }, icon('refresh', 16), t('Scan again')));
    bar.appendChild(h('button.btn', { onClick: () => { if (info) copyText(reportText(info, { hz })).then(() => toast(t('Report copied'), 'good', 2000)); } }, icon('copy', 16), t('Copy report')));
    bar.appendChild(h('button.btn', { onClick: () => { if (info) download('nebulix-system-report.json', JSON.stringify(Object.assign({}, info, { refreshHz: hz }), null, 2)); } }, icon('download', 16), t('Download .json')));
    await run();
    return () => { alive = false; };
  },
};

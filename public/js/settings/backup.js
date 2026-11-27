// Settings → Backup: export your account settings (theme, layout, privacy, browsing…) and this device's preferences
// (desktop layout, tool choices, saved crosshair…) to a JSON file, and import them on another device. Account settings
// go back through PATCH /api/profile, where the server validates every field; device preferences are restored into
// localStorage. Nothing secret is included: no session, no password, no vault.
import { h, mount, fmt } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S, patchMe } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, confirmBox, switchEl } from '../ui.js';

const PREFIX = 'nbx.';
const SKIP = /token|secret|passw|session|vault|cache|draft|^nbx\.vfs/i; // never exported
const MAX = 4 << 20;
function deviceKeys() {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!k || !k.startsWith(PREFIX) || SKIP.test(k)) continue; const v = localStorage.getItem(k); if (v != null && v.length < 400000) out[k.slice(PREFIX.length)] = v; }
  return out;
}

export default {
  async mount(box) {
    let incAccount = true, incDevice = true;
    const dev = deviceKeys(); const devSize = Object.values(dev).reduce((a, v) => a + v.length, 0);
    const file = h('input', { type: 'file', accept: 'application/json,.json', style: 'display:none', onChange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) doImport(f); } });
    function doExport() {
      const data = { app: 'nebulix', kind: 'settings-backup', v: 1, at: new Date().toISOString(), user: S.me ? S.me.username : null };
      if (incAccount && S.me) data.account = S.me.settings || {};
      if (incDevice) data.device = deviceKeys();
      const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: 'nebulix-settings-' + new Date().toISOString().slice(0, 10) + '.json' }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(t('Settings exported'));
    }
    async function doImport(f) {
      if (f.size > MAX) return toast(t('That file is too big to be a Nebulix backup'), 'error');
      let d; try { d = JSON.parse(await f.text()); } catch { return toast(t('That is not a valid JSON file'), 'error'); }
      if (!d || d.app !== 'nebulix' || d.kind !== 'settings-backup') return toast(t('That is not a Nebulix settings backup'), 'error');
      const nAcc = d.account && typeof d.account === 'object' ? Object.keys(d.account).length : 0; const nDev = d.device && typeof d.device === 'object' ? Object.keys(d.device).length : 0;
      if (!(await confirmBox(t('Import {a} account settings and {b} device preferences from {d}? Current values are replaced.', { a: nAcc, b: nDev, d: d.at ? fmt.dt(Date.parse(d.at)) : '?' })))) return;
      try {
        if (nAcc) { const r = await api.patch('/api/profile', { settings: d.account }); patchMe({ settings: r.user.settings }); }
        if (nDev) for (const [k, v] of Object.entries(d.device)) { if (typeof v !== 'string' || SKIP.test(PREFIX + k) || !/^[\w.:-]{1,80}$/.test(k)) continue; try { JSON.parse(v); localStorage.setItem(PREFIX + k, v); } catch {} }
        toast(t('Settings imported. Reloading…'), 'good'); setTimeout(() => location.reload(), 900);
      } catch (e) { toastErr(e); }
    }
    mount(box, h('div.col', { style: 'gap:14px' },
      h('section.card', h('h3', icon('download', 16), ' ', t('Export settings')), h('p.small.muted', t('Save your settings to a file to keep a copy or move them to another device.')),
        h('div.setting', h('div.grow', h('b', t('Account settings')), h('div.sd', t('Theme, layout, privacy, browsing and notification choices (synced to your account).'))), switchEl(true, (v) => { incAccount = v; })),
        h('div.setting', h('div.grow', h('b', t('This device’s preferences')), h('div.sd', t('{n} saved preferences ({s}): desktop layout, last tabs, tool settings, saved designs.', { n: Object.keys(dev).length, s: fmt.bytes(devSize) }))), switchEl(true, (v) => { incDevice = v; })),
        h('button.btn.primary', { onClick: doExport }, icon('download', 15), t('Export to a file'))),
      h('section.card', h('h3', icon('upload', 16), ' ', t('Import settings')), h('p.small.muted', t('Load a file exported from Nebulix. Account settings are checked by the server; passwords, sessions and your password vault are never part of a backup.')),
        h('button.btn', { onClick: () => file.click() }, icon('upload', 15), t('Import from a file')), file)));
  },
};

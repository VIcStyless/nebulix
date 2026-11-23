// Chrome extensions: import a content-script extension (folder, .zip or .crx), toggle and remove them.
// Nebulix runs an extension's content scripts and CSS inside proxied pages. It is not full Chrome, so background
// workers, popups and most chrome.* APIs won't run — the importer says what it skipped.
import { h, mount, fmt, readFile } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S, isPro } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, switchEl, confirmBox, loading, modal, busy } from '../ui.js';
import { readCrx, zipSupported } from '../ext/zip.js';
import { parseExtension } from '../ext/parse.js';

export default {
  title: () => t('Extensions'),
  async mount(root, ctx) {
    const wrap = h('div.page.ext', loading()); mount(root, wrap);
    let data; const load = async () => { data = await api.get('/api/extensions'); };
    try { await load(); } catch (e) { mount(wrap, h('span.error', e.message)); return () => {}; }

    // ---- import flow ----
    async function importFiles(fileList) {
      const files = [...fileList]; if (!files.length) return;
      let bundle;
      try {
        if (files.length === 1 && /\.(zip|crx)$/i.test(files[0].name)) {
          const buf = new Uint8Array(await readFile(files[0], 'buffer')); const map = await readCrx(buf); bundle = parseExtension(map);
        } else {
          const map = new Map();
          for (const f of files) { const rel = f.webkitRelativePath || f.name; if (f.size > 2 << 20 && !/\.(js|css|json)$/i.test(f.name)) continue; map.set(rel, new Uint8Array(await readFile(f, 'buffer'))); }
          bundle = parseExtension(map);
        }
      } catch (e) {
        const msg = { 'no-manifest': t('No manifest.json found. Pick the extension\'s folder (the one with manifest.json) or its .zip/.crx file.'), 'bad-manifest': t('The manifest.json could not be read.'),
          'no-content-scripts': t('This extension has no content scripts, so there is nothing Nebulix can run. Nebulix supports content-script extensions (ad blockers, site tweaks, themes), not ones that need a background page or popup.'),
          'no-runnable': t('This extension\'s content scripts are empty or missing.'), 'not-a-zip': t('That file is not a valid .zip/.crx.'), 'deflate-unsupported': t('Your browser cannot unzip here — upload the unpacked folder instead.') }[e.message] || e.message;
        return toast(msg, 'err', 6000);
      }
      confirmImport(bundle);
    }
    function confirmImport(bundle) {
      const { extension: ext, warnings, stats } = bundle;
      const body = h('div',
        h('div.row', icon('puzzle', 22), h('div.grow', h('b', ext.name), h('div.tiny.muted', 'v' + ext.version + (ext.description ? ' · ' + ext.description.slice(0, 80) : '')))),
        h('div.nl-pills', { style: 'margin:10px 0' }, h('span.pill', t('{n} scripts', { n: stats.scripts })), h('span.pill', t('{n} styles', { n: stats.styles })), h('span.pill', fmt.bytes(stats.bytes)), h('span.pill', ext.runAt)),
        h('div.small.muted', t('Runs on:'), ' ', ext.matches.slice(0, 6).join(', ') + (ext.matches.length > 6 ? '…' : '')),
        warnings.length ? h('div.nl-warn', { style: 'margin-top:10px' }, icon('alert', 16), h('div', h('b', t('Nebulix will skip:')), ' ', warnings.join(', '), h('div.tiny', t('The content scripts and styles will still run.')))) : null);
      modal({ title: t('Import this extension?'), body, actions: [{ label: t('Cancel'), value: false }, { label: t('Import'), kind: 'primary', value: true }] }).then(async (ok) => {
        if (!ok) return;
        try { await api.post('/api/extensions', { extension: ext }); await load(); render(); toast(t('Extension added. Open or reload a tab to see it in action.'), 'good', 4000); }
        catch (e) { toastErr(e); }
      });
    }
    const pickFolder = () => { const i = h('input', { type: 'file', style: 'display:none' }); i.webkitdirectory = true; i.multiple = true; i.onchange = () => { importFiles(i.files); i.remove(); }; document.body.appendChild(i); i.click(); };
    const pickZip = () => { const i = h('input', { type: 'file', accept: '.zip,.crx', style: 'display:none' }); i.onchange = () => { importFiles(i.files); i.remove(); }; document.body.appendChild(i); i.click(); };

    // ---- list ----
    function extRow(e) {
      const sw = switchEl(e.on, async (v) => { try { await api.patch('/api/extensions/' + e.id, { on: v }); e.on = v; } catch (err) { toastErr(err); sw.input.checked = e.on; } }, e.name);
      return h('div.card.ext-item',
        h('div.ext-ic', icon('puzzle', 20)),
        h('div.grow', h('b', e.name), h('div.tiny.muted', 'v' + e.version + ' · ' + t('{s} scripts, {c} styles', { s: e.scripts, c: e.styles }) + ' · ' + fmt.bytes(e.size)),
          e.matches && e.matches.length ? h('div.tiny.muted.ellipsis', t('Runs on:') + ' ' + e.matches.join(', ')) : null),
        h('div.row', sw, h('button.btn.sm.ghost.icon', { 'aria-label': t('Remove'), onClick: async () => { if (await confirmBox(t('Remove "{n}"?', { n: e.name }), { danger: true })) { try { await api.del('/api/extensions/' + e.id); await load(); render(); } catch (err) { toastErr(err); } } } }, icon('trash', 15))));
    }

    function render() {
      const full = data.extensions.length >= data.limit;
      mount(wrap,
        h('div.page-title', h('div', h('h2', '', t('Chrome extensions')), h('p', t('Add content-script extensions — ad blockers, site tweaks, custom themes — and they run inside your Nebulix tabs.')))),
        h('div.card.ext-import',
          h('div.row.wrap', h('button.btn.primary', { disabled: full, onClick: pickFolder }, icon('upload', 16), t('Import a folder')),
            h('button.btn', { disabled: full || !zipSupported(), onClick: pickZip }, icon('upload', 16), t('Import .zip / .crx')),
            h('div.grow'), h('span.small.muted', t('{a} of {b} used', { a: data.extensions.length, b: data.limit }), isPro() ? '' : ' · ' + t('PRO allows 20'))),
          full ? h('div.nl-warn', icon('alert', 16), h('span', t('You have reached your extension limit. Remove one or go PRO for more.'))) : null,
          h('details.ext-help', h('summary', t('How do I get an extension\'s files?')),
            h('ol.ext-steps',
              h('li', t('Open chrome://extensions, turn on Developer mode.')),
              h('li', t('Find the extension and click "Pack extension" to get a .crx, or locate its folder and zip it.')),
              h('li', t('Or download an unpacked extension (a folder with manifest.json) and import the folder here.')),
              h('li', t('Content-script extensions work best. Ones that need a background page, popup or special Chrome permissions will be partly or fully skipped.'))))),
        data.extensions.length ? h('div.ext-list', data.extensions.map(extRow)) : h('div.empty', h('div.empty-art.ea-mark'), h('h3', t('No extensions yet')), h('p.muted', t('Import a folder or a .zip/.crx to get started.'))));
    }
    render();
    return () => {};
  },
};

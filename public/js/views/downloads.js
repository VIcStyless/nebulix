// Nebulix Downloads (3.0 phase 20): paste a link and the Nebulix server downloads it into your Drive (SSRF-protected,
// within your storage quota). Shows progress, lets you cancel, retry and open the file in Drive. #/downloads
import { h, mount, fmt } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { toastErr } from '../ui.js';

const ST = { running: ['Downloading…', 'warn'], done: ['Done', 'good'], error: ['Failed', 'bad'], cancelled: ['Cancelled', 'idle'] };
export default {
  title: () => t('Downloads'),
  async mount(root) {
    const url = h('input.input', { type: 'url', placeholder: 'https://…/archivo.zip', 'aria-label': t('Link to download') }); const go = h('button.btn.primary', icon('download', 15), t('Download to Drive'));
    const list = h('div.dl-list'); const usage = h('div.tiny.muted'); let timer = 0; let alive = true;
    async function load() {
      let r; try { r = await api.get('/api/downloads', { quiet: true }); } catch (e) { mount(list, h('p.error', e.message)); return; }
      mount(usage, t('Drive: {a} of {b} used', { a: fmt.bytes(r.usage.used), b: fmt.bytes(r.usage.quota) }));
      mount(list, r.downloads.length ? r.downloads.map((d) => { const s = ST[d.status] || [d.status, '']; const pct = d.total ? Math.min(100, d.bytes / d.total * 100) : 0;
        return h('article.dl-item', h('div.grow', h('b', d.name || d.url), h('div.tiny.muted', d.url), d.status === 'running' ? h('div.dl-bar', h('i', { style: 'width:' + (d.total ? pct : 30) + '%', class: d.total ? '' : 'indet' })) : null,
          h('div.tiny', h('span.an-state.' + s[1], t(s[0])), ' ', fmt.bytes(d.bytes) + (d.total ? ' / ' + fmt.bytes(d.total) : ''), d.error ? h('span.error', ' · ' + d.error) : null)),
          h('div.row', { style: 'gap:4px' }, d.status === 'done' ? h('a.btn.sm', { href: '#/drive' }, icon('folder', 13), t('Open Drive')) : null,
            d.status === 'error' || d.status === 'cancelled' ? h('button.btn.sm', { onClick: () => start(d.url) }, icon('refresh', 13), t('Retry')) : null,
            h('button.btn.sm.ghost', { 'aria-label': d.status === 'running' ? t('Cancel') : t('Remove'), onClick: async () => { await api.del('/api/downloads/' + d.id).catch(toastErr); load(); } }, icon(d.status === 'running' ? 'x' : 'trash', 13)))); })
        : h('p.muted.small', t('Paste a link to a file (a PDF, a ZIP, an image…) and Nebulix saves it in your Drive.')));
      clearTimeout(timer); if (alive && r.downloads.some((d) => d.status === 'running')) timer = setTimeout(load, 1000);
    }
    async function start(u) { go.disabled = true; try { await api.post('/api/downloads', { url: u }); url.value = ''; } catch (e) { toastErr(e); } finally { go.disabled = false; load(); } }
    go.onclick = () => url.value.trim() && start(url.value.trim()); url.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.onclick(); });
    mount(root, h('div.inner.dl', h('div.page-title', h('div', h('h2', icon('download', 22), ' ', t('Downloads')), h('p', t('Save files from the internet straight into your Drive — the Nebulix server downloads them for you.')))),
      h('div.row', { style: 'gap:8px' }, url, go), usage, h('p.tiny.muted', t('Only public http(s) links; private networks are blocked. Your storage quota and file-size limit apply; up to 3 downloads at a time.')), list));
    load();
    return () => { alive = false; clearTimeout(timer); };
  },
};

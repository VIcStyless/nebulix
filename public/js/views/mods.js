// Nebulix Mods (13.8): change how Nebulix looks with mods. #/mods
// Official mods (switches, kept on this device) and community mods (CSS only, cleaned by the server, installed per
// account). Up to 10 community mods at once; remove any of them with one click.
import { h, mount, ls } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, modal, confirmBox } from '../ui.js';

export const OFFICIAL = [
  ['compact', 'Compact', 'Less padding everywhere: more on screen.', '.card,.page section{padding:10px!important}.btn{padding-block:5px!important}'],
  ['bigtext', 'Big text', 'Larger, easier-to-read text.', 'html{font-size:118%!important}'],
  ['rounded', 'Extra round', 'Softer, rounder corners on cards and buttons.', '.card,.btn,.input,.modal{border-radius:22px!important}'],
  ['still', 'No animations', 'Turns off movement and transitions (also kinder to old computers).', '*{animation:none!important;transition:none!important}'],
  ['neon', 'Neon glow', 'A glowing outline on cards and buttons in your accent colour.', '.card{box-shadow:0 0 0 1px var(--accent),0 0 18px color-mix(in oklab,var(--accent) 35%,transparent)!important}.btn.primary{box-shadow:0 0 16px var(--accent)!important}'],
  ['mono', 'Hacker font', 'Everything in a monospace terminal font.', 'body,button,input,textarea,select{font-family:ui-monospace,"Cascadia Mono",Consolas,monospace!important}'],
  ['contrast', 'High contrast', 'Stronger borders and brighter text.', ':root{--muted:#d1d5db!important}.card,.btn,.input{border:1px solid #fff8!important}'],
  ['nobg', 'Plain background', 'Hides the animated background for a calm, solid one.', '#livebg,.livebg,canvas.bg3d,.starfield{display:none!important}body{background:var(--bg)!important}'],
];
const onList = () => ls('mods.official') || [];
// apply official (this device) + installed community mods
export async function applyMods() {
  let el = document.getElementById('nbx-mods'); if (!el) { el = document.createElement('style'); el.id = 'nbx-mods'; document.head.append(el); }
  const off = OFFICIAL.filter((m) => onList().includes(m[0])).map((m) => m[3]);
  let comm = []; try { comm = (await api.get('/api/mods/installed', { quiet: true })).mods.map((m) => m.css); } catch {}
  el.textContent = off.concat(comm).join('\n');
}

export default {
  title: () => t('Mods'),
  async mount(root) {
    const wrap = h('div.page.mods'); mount(root, wrap); let tab = 'official'; let q = '';
    const body = h('div');
    const tabs = h('div.mods-tabs');
    const paintTabs = () => mount(tabs, [['official', t('Official')], ['community', t('Community')], ['mine', t('My mods')]].map(([k, n]) => h('button' + (tab === k ? '.on' : ''), { onClick: () => { tab = k; paintTabs(); paint(); } }, n)), h('span.grow'), h('button.btn.primary.sm', { onClick: () => edit() }, icon('plus', 14), t('Create a mod')));
    mount(wrap, h('div.page-title', h('div', h('h2', icon('puzzle', 22), ' ', t('Mods')), h('p', t('Change how Nebulix looks. Mods are only CSS (no code runs) and only affect you.')))), tabs, body);
    async function paint() {
      if (tab === 'official') {
        const list = onList();
        return mount(body, h('div.mods-grid', OFFICIAL.map(([id, n, d]) => h('div.card.mod-card' + (list.includes(id) ? '.on' : ''), h('b', t(n)), h('p.small.muted', t(d)), h('button.btn.sm' + (list.includes(id) ? '' : '.primary'), { onClick: () => { const l = onList(); ls('mods.official', l.includes(id) ? l.filter((x) => x !== id) : l.concat(id)); applyMods(); paint(); } }, list.includes(id) ? t('Remove') : t('Install'))))));
      }
      mount(body, loading());
      let r; try { r = await api.get('/api/mods?' + new URLSearchParams({ q, mine: tab === 'mine' ? '1' : '', sort: tab === 'mine' ? 'new' : 'top' })); } catch (e) { mount(body, h('span.error', e.message)); return; }
      const search = h('input.input', { placeholder: t('Search mods…'), value: q, onChange: () => { q = search.value; paint(); } });
      mount(body, tab === 'community' ? search : null, r.mods.length ? h('div.mods-grid', r.mods.map((m) => h('div.card.mod-card' + (m.installed ? '.on' : ''), h('b', m.name), h('p.small.muted', m.desc || '—'), h('div.tiny.muted', (m.author ? '@' + m.author.username + ' · ' : '') + t('{n} installs', { n: m.installs })),
        h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, h('button.btn.sm' + (m.installed ? '' : '.primary'), { onClick: async () => { try { await api.post(`/api/mods/${m.id}/install`); await applyMods(); paint(); } catch (e) { toastErr(e); } } }, m.installed ? t('Remove') : t('Install')),
          h('button.btn.sm.ghost', { onClick: () => preview(m) }, icon('eye', 13), t('Try')), m.mine ? h('button.btn.sm.ghost', { onClick: () => edit(m) }, icon('edit', 13)) : null, m.mine ? h('button.btn.sm.ghost', { onClick: async () => { if (await confirmBox(t('Delete this mod?'), { danger: true })) { try { await api.del('/api/mods/' + m.id); applyMods(); paint(); } catch (e) { toastErr(e); } } } }, icon('trash', 13)) : null))))
        : h('div.empty', h('h3', tab === 'mine' ? t('You have not made any mods') : t('No mods yet')), h('p.muted', t('Create one: change colours, sizes, fonts… with CSS.'))));
    }
    // try a mod for 15 seconds without installing it
    function preview(m) { const el = document.createElement('style'); el.textContent = m.css; document.head.append(el); toast(t('Trying “{n}” for 15 seconds…', { n: m.name }), 'info', 3000); setTimeout(() => el.remove(), 15000); }
    async function edit(m) {
      const name = h('input.input', { value: m ? m.name : '', placeholder: t('Mod name'), maxlength: 40 }); const desc = h('input.input', { value: m ? m.desc : '', placeholder: t('What does it change?'), maxlength: 200 });
      const css = h('textarea.input', { rows: 12, spellcheck: 'false', style: 'font:13px ui-monospace,monospace' }); css.value = m ? m.css : '/* ' + t('Example: purple accent and bigger buttons') + ' */\n:root { --accent: #a855f7; }\n.btn { font-size: 15px; padding: 10px 16px; }\n';
      const ok = await modal({ title: m ? t('Edit mod') : t('Create a mod'), cls: 'wide', body: h('div.col', { style: 'gap:8px' }, name, desc, css, h('div.row', { style: 'gap:8px' }, h('button.btn.sm', { onClick: () => preview({ name: name.value || 'Mod', css: css.value }) }, icon('eye', 13), t('Try for 15 s'))), h('p.tiny.muted', t('Only CSS. @import and outside addresses are removed for everyone’s safety; you can use images from Nebulix or data: images.'))), actions: [{ label: t('Cancel'), value: false }, { label: t('Publish'), value: true, kind: 'primary' }] });
      if (ok !== true) return; try { await api.post('/api/mods', { id: m && m.id, name: name.value, desc: desc.value, css: css.value }); toast(t('Mod published'), 'good'); tab = 'mine'; paintTabs(); paint(); } catch (e) { toastErr(e); }
    }
    paintTabs(); paint();
    return () => {};
  },
};

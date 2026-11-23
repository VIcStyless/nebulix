// Custom status ("Grinding ranked") + live activity privacy.
import { h } from './util.js';
import { t } from './i18n.js';
import { api } from './api.js';
import { S, setMe } from './state.js';
import { icon } from './icons.js';
import { modal, emojiPicker, switchEl, settingRow, toastErr, toast } from './ui.js';

export const ACT_ICON = { music: 'music', dj: 'sliders', arcade: 'gamepad', duel: 'target', browse: 'globe', casino: 'dice', nerd: 'flask', os: 'desktop', voice: 'volume' };
export const actText = (a) => (a ? a.label || '' : '');
export const statusText = (s) => (s && (s.text || s.emoji) ? `${s.emoji || ''} ${s.text || ''}`.trim() : '');
const PRESETS = ['Gaming', 'Listening to music', 'Studying', 'Away', 'Do not disturb', 'Eating', 'Exploring Nebulix'];

export function statusModal() {
  const cur = S.me.status || {}; let emoji = cur.emoji || '';
  const ebtn = h('button.btn.icon', { type: 'button', title: t('Pick an emoji'), onClick: (e) => emojiPicker(e.currentTarget, (x) => { emoji = x; ebtn.textContent = x; }) }, emoji || icon('smile', 17));
  const text = h('input.input', { value: cur.text || '', maxlength: 80, placeholder: t('What are you up to?') });
  const clear = h('select.select', { style: 'width:auto' }, [[0, t('Don\'t clear')], [30, t('30 minutes')], [60, t('1 hour')], [240, t('4 hours')], [1440, t('Today')]].map(([v, l]) => h('option', { value: v }, l)));
  const showAct = !(S.me.settings && S.me.settings.showActivity === false);
  const presets = h('div.row.wrap.gap-s', PRESETS.map((l) => h('button.chip', { type: 'button', onClick: () => { text.value = t(l); text.focus(); } }, t(l))));
  return modal({ title: t('Set a status'), body: h('div.col', h('div.row', ebtn, text), presets, settingRow(t('Clear after'), null, clear),
    settingRow(t('Show my activity'), t('Friends and servers see what you are doing in Nebulix (music, games, browsing).'), switchEl(showAct, async (v) => { try { const r = await api.patch('/api/profile', { settings: { showActivity: v } }); setMe(r.user); } catch (e) { toastErr(e); } }))),
  actions: [{ label: t('Clear status'), onClick: async () => { try { const r = await api.patch('/api/profile', { status: null }); setMe(r.user); toast(t('Status cleared')); } catch (e) { toastErr(e); } } },
    { label: t('Save'), kind: 'primary', onClick: async () => { try { const r = await api.patch('/api/profile', { status: { text: text.value.trim(), emoji, clearAfter: Number(clear.value) } }); setMe(r.user); toast(t('Status updated'), 'good'); } catch (e) { toastErr(e); return false; } } }] });
}

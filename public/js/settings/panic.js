// Settings → Safety: the panic button, quick-exit key, tab disguise and the about:blank launcher.
// Everything here is stored on this device only.
import { h, mount } from '../util.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { toast, segEl, switchEl, settingRow, field } from '../ui.js';
import * as panic from '../panic.js';

const KEY_CHOICES = [['`', '` / º'], ['\\', '\\'], ['Escape', 'Esc'], ['F2', 'F2'], ['F4', 'F4'], ['F8', 'F8'], ['F9', 'F9'], ['Pause', 'Pause'], ['', t('Off')]];

export default {
  mount(host) {
    const s = panic.settings();
    let url = s.url;
    const presetSel = h('select.select', panic.PRESETS.map(([k, label, u]) => h('option', { value: u, selected: u === url }, t(label))).concat(h('option', { value: '__custom', selected: !panic.PRESETS.some(([, , u]) => u === url) }, t('Custom address…'))));
    const custom = h('input.input', { value: url, placeholder: 'https://…', spellcheck: 'false' });
    const customWrap = h('div', { style: 'margin-top:8px' + (panic.PRESETS.some(([, , u]) => u === url) ? ';display:none' : '') }, custom);
    presetSel.addEventListener('change', () => { if (presetSel.value === '__custom') { customWrap.style.display = ''; custom.focus(); } else { customWrap.style.display = 'none'; url = presetSel.value; panic.save({ url }); } });
    custom.addEventListener('change', () => { let v = custom.value.trim(); if (v && !/^https?:\/\//i.test(v) && v !== 'about:blank') v = 'https://' + v; url = v || panic.PRESETS[0][2]; panic.save({ url }); });

    const keySeg = h('div.seg', KEY_CHOICES.map(([k, label]) => { const b = h('button', { type: 'button', class: k === s.key ? 'on' : '', onClick: () => { [...keySeg.children].forEach((x) => x.classList.remove('on')); b.classList.add('on'); panic.save({ key: k }); } }, label); return b; }));

    const cloakSel = h('select.select', panic.CLOAKS.map(([k, label]) => h('option', { value: k, selected: k === s.cloak }, t(label))));
    cloakSel.addEventListener('change', () => { panic.save({ cloak: cloakSel.value }); toast(t('Tab disguise updated'), 'good', 1500); });

    mount(host,
      h('section.card',
        h('h3', icon('alert', 18), t('Panic button')),
        h('p.muted.small', t('One tap — or your chosen key — instantly replaces this tab with a safe page. Back will not return to Nebulix. The button is the alert icon in the top bar; it also works while you are browsing a website.')),
        field(t('Jump to'), presetSel), customWrap,
        h('div.field', { style: 'margin-top:12px' }, h('label', t('Quick-exit key')), keySeg, h('div.hint', t('Pressed anywhere except while typing. The ` key is next to the 1 on most keyboards.'))),
        h('div.row', { style: 'margin-top:14px;gap:8px' }, h('button.btn', { onClick: () => { toast(t('Test: jumping in 1 second…'), 'info', 1200); setTimeout(() => panic.panic(), 1000); } }, icon('external', 15), t('Test it')))),
      h('section.card',
        h('h3', icon('eyeoff', 18), t('Tab disguise')),
        h('p.muted.small', t('Show a different name and icon on the browser tab, so a glance at your tabs does not reveal Nebulix.')),
        field(t('Show the tab as'), cloakSel)),
      h('section.card',
        h('h3', icon('window', 18), t('Open in a blank tab')),
        h('p.muted.small', t('Opens Nebulix inside an about:blank tab, so the address bar and history only show a blank page. Keep this Nebulix tab open in the background.')),
        h('button.btn', { onClick: openBlank }, icon('window', 15), t('Open blank tab'))));
    return () => {};
  },
};

// Open an about:blank window and write a tiny loader that embeds Nebulix full-screen.
function openBlank() {
  const w = window.open('about:blank', '_blank');
  if (!w) return toast(t('Your browser blocked the pop-up. Allow pop-ups for Nebulix and try again.'), 'err');
  try {
    const d = w.document; const origin = location.origin;
    d.open();
    d.write('<!doctype html><html><head><meta charset="utf-8"><title> </title><link rel="icon" href="data:,"><style>html,body{margin:0;height:100%;background:#0b0c0e;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}</style></head><body><iframe src="' + origin + '" allow="camera;microphone;display-capture;fullscreen;autoplay;clipboard-write"></iframe></body></html>');
    d.close();
    toast(t('Opened in a blank tab. You can close this one.'), 'good', 4000);
  } catch (e) { try { w.location = location.origin; } catch {} }
}

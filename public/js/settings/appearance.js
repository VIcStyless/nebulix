// Settings → Appearance: pick a built-in theme, open the Theme Studio, and tune personal UI preferences (motion, density, text size, sounds…).
import { h, mount, ls } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S, patchMe } from '../state.js';
import { icon, LOGOS, logoMark, setLogo } from '../icons.js';
import { LAYOUTS, setLayout, DESIGNS, setDesign, designNow } from '../app.js';
import { toast, toastErr, settingRow, switchEl, segEl } from '../ui.js';
import * as theme from '../theme.js';
import { sfx } from '../sfx.js';

export default {
  mount(host, ctx) {
    // preset swatches
    const cur = theme.getTheme();
    const swatch = (p) => {
      const c = p.colors && p.colors.bg ? p.colors : null; const nt = theme.fromPreset(p);
      const el = h('button.set-swatch', { dataset: { name: p.name }, title: p.name, onClick: async () => {
        const applied = theme.apply(nt); mark(p.name);
        try { await api.patch('/api/profile', { settings: { activeTheme: applied } }); patchMe({ settings: Object.assign({}, S.me.settings, { activeTheme: applied }) }); sfx.click(); } catch (e) { toastErr(e); }
      } }, h('span.set-sw-prev', { style: { '--a': nt.colors.accent, '--b': nt.colors.accent2, '--bg': nt.colors.bg, '--s': nt.colors.surface } }, h('i'), h('i'), h('i')), h('span.small', p.name));
      return el;
    };
    const grid = h('div.set-swatches', theme.PRESETS.map(swatch));
    function mark(name) { [...grid.children].forEach((b) => b.classList.toggle('on', b.dataset.name === name)); }
    mark(cur && cur.name);

    // UI preferences
    const ui = Object.assign({ sounds: true, reduceMotion: false, compact: false, highContrast: false, showCoinsBar: true, fontScale: 1 }, (S.me.settings && S.me.settings.ui) || {});
    const saveUi = async (patch) => {
      Object.assign(ui, patch); theme.applyUi(ui);
      try { const r = await api.patch('/api/profile', { settings: { ui: patch } }); patchMe({ settings: r.user.settings }); } catch (e) { toastErr(e); }
    };
    const tog = (key) => switchEl(ui[key], (v) => saveUi({ [key]: v }));

    mount(host,
      h('section.card', h('h3', icon('palette', 18), t('Design')),
        h('p.muted.small', t('Change the whole look of Nebulix — shapes, fonts and depth — on top of any colour theme.')),
        (() => { const row = h('div.set-designs', DESIGNS.map(([k, l]) => h('button.set-design' + (designNow() === k ? '.on' : ''), { type: 'button', dataset: { d: k }, onClick: (e) => { setDesign(k); row.querySelectorAll('.on').forEach((x) => x.classList.remove('on')); e.currentTarget.classList.add('on'); } }, h('span.sd-prev', h('i'), h('i'), h('i')), h('b.small', t(l))))); return row; })()),
      h('section.card', h('h3', icon('layout', 18), t('Menu layout & logo')),
        settingRow(t('Nova button'), t('The floating AI button in the corner. It never shows over games. Alt+N opens Nova at any time.'), switchEl(ls('nova.float') !== false, (v) => { ls('nova.float', !!v); })),
        settingRow(t('Studio design'), t('A calm, flat look: neutral greys, one accent colour, no glows or animated backgrounds. It replaces your theme colours while it is on.'), switchEl(designNow() === 'studio', (v) => { setDesign(v ? 'studio' : 'seven'); toast(v ? t('Studio design on') : t('Studio design off'), 'good', 1500); })),
        settingRow(t('Menu layout'), t('Where the navigation lives on desktop: sidebar left or right, a top bar, a floating dock or compact icons.'),
          segEl(LAYOUTS.map(([k, l]) => [k, t(l)]), (() => { try { return JSON.parse(localStorage.getItem('nbx.layout')) || 'left'; } catch { return 'left'; } })(), (v) => setLayout(v))),
        h('div.eyebrow', { style: 'margin-top:12px' }, t('App logo')),
        (() => { const cur = (() => { try { return JSON.parse(localStorage.getItem('nbx.logo')) || 'classic'; } catch { return 'classic'; } })(); const row = h('div.set-logos', LOGOS.map(([k, l]) => h('button.set-logo' + (k === cur ? '.on' : ''), { type: 'button', title: t(l), onClick: (e) => { setLogo(k); row.querySelectorAll('.on').forEach((x) => x.classList.remove('on')); e.currentTarget.classList.add('on'); } }, logoMark(40, null, k), h('span.tiny', t(l))))); return row; })()),
      h('section.card', h('h3', icon('palette', 18), t('Theme')),
        h('p.muted.small', t('Pick a starting point, then open the Studio to craft your own — change colours, background, animations, fonts and chat bubbles, and share your creation with other players.')),
        grid,
        settingRow(t('Surface style'), t('Give any theme a glassy, glossy or Windows 11 feel. Glass styles need an animated background to shine.'),
          segEl([['flat', t('Flat')], ['glass', t('Glass')], ['aero', 'Aero'], ['mica', 'Mica'], ['neo', 'Neo']], (theme.getTheme().ui.surface) || 'flat', async (v) => {
            const base = theme.getTheme(); const nt = theme.apply(Object.assign({}, base, { ui: Object.assign({}, base.ui, { surface: v, blur: v === 'flat' ? base.ui.blur : Math.max(base.ui.blur, v === 'mica' ? 30 : 18) }) }));
            try { await api.patch('/api/profile', { settings: { activeTheme: nt } }); patchMe({ settings: Object.assign({}, S.me.settings, { activeTheme: nt }) }); } catch (e) { toastErr(e); }
          })),
        h('div.row.wrap', { style: 'margin-top:14px' }, h('button.btn.primary', { onClick: () => ctx.go('themes') }, icon('spark', 16), t('Open Theme Studio')), h('button.btn', { onClick: () => ctx.go('themes', { tab: 'gallery' }) }, icon('globe', 16), t('Browse community themes')))),
      h('section.card', h('h3', icon('sliders', 18), t('Interface')),
        settingRow(t('Interface sounds'), t('Little clicks and coin chimes as you play.'), tog('sounds')),
        settingRow(t('Reduce motion'), t('Calms the animated background and transitions. Great for weaker PCs.'), tog('reduceMotion')),
        settingRow(t('Compact mode'), t('Tightens spacing so more fits on screen.'), tog('compact')),
        settingRow(t('High contrast'), t('Stronger borders and text for better readability.'), tog('highContrast')),
        settingRow(t('Show coin balance'), t('Hide the coin counter in the top bar if you prefer.'), tog('showCoinsBar')),
        settingRow(t('Text size'), null, segEl([[0.9, 'A−'], [1, t('Normal')], [1.1, 'A+'], [1.25, 'A++']], ui.fontScale || 1, (v) => saveUi({ fontScale: v }))),
        settingRow(t('Animations'), t('How lively transitions, hovers and animated backgrounds are. "Off" stops all motion.'), segEl([['off', t('Off')], ['subtle', t('Subtle')], ['normal', t('Normal')], ['extra', t('Extra')]], ui.anim || 'normal', (v) => saveUi({ anim: v })))),
      h('section.card', h('h3', icon('desktop', 18), t('Desktop mode (Nebulix OS)')),
        h('p.muted.small', t('An optional desktop with windows, a taskbar, widgets and animated wallpapers. It opens in its own tab, so this interface stays exactly as it is. Close it any time to come back here.')),
        h('div.row.wrap', h('button.btn.primary', { onClick: () => window.__nbx && window.__nbx.openDesktop() }, icon('desktop', 16), t('Start system')))));
    return () => {};
  },
};

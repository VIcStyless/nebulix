// My 3D avatar: the character that walks around the 3D casino and shows on your profile.
// Basic parts are free; premium ones cost coins or gems (paid once, then yours).
import { h, mount, fmt } from '../util.js';
import { t, getLang } from '../i18n.js';
import { api } from '../api.js';
import { S, patchMe } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, emptyState, busy, tabsEl, confirmBox } from '../ui.js';
import { load3d, avatarStage } from '../avatar3d.js';

const L = (pair) => (Array.isArray(pair) ? (getLang() === 'es' ? pair[1] : pair[0]) : pair);

export default {
  title: () => t('My 3D avatar'),
  async mount(root, ctx) {
    const inner = h('div.inner.avx'); mount(root, inner, loading(t('Loading your avatar…')));
    let AV, d;
    try { [{ AV }, d] = await Promise.all([load3d(), api.get('/api/avatar3d')]); } catch (e) { mount(inner, emptyState('alert', t('3D is not available'), e.message)); return () => {}; }
    let av = Object.assign({}, d.av3); const owned = new Set(d.owned); const saved = JSON.stringify(av);
    const stage = avatarStage(av, { size: Math.min(380, Math.max(240, innerWidth - 60)) });
    let cat = 'hair';
    const CATS = [['skin', t('Skin')], ['hair', t('Hair')], ['eyes', t('Eyes')], ['top', t('Top')], ['pants', t('Trousers')], ['hat', t('Hat')], ['acc', t('Accessory')], ['aura', t('Aura')]];
    const tabs = tabsEl(CATS.map(([k, l]) => [k, l]), cat, (v) => { cat = v; paintOpts(); });
    const opts = h('div.avx-opts'); const costEl = h('div.avx-cost');
    const saveBtn = h('button.btn.primary', { onClick: (e) => busy(e.currentTarget, save) }, icon('check', 16), t('Save avatar'));
    const sw = (list, key) => h('div.avx-sw', list.map((c, i) => h('button.avx-c' + (av[key] === i ? '.on' : ''), { type: 'button', style: 'background:' + c, 'aria-label': c, onClick: () => { av[key] = i; changed(); } })));
    function priceTag(k, p) {
      if (!p.coins && !p.gems) return null; if (owned.has(k + ':' + p.id)) return h('span.tiny.good', t('Owned'));
      return p.gems ? h('span.gem.tiny', fmt.coins(p.gems)) : h('span.coin.tiny', fmt.coins(p.coins));
    }
    function paintOpts() {
      if (cat === 'skin') return mount(opts, h('div.eyebrow', t('Skin tone')), sw(AV.skin, 'skin'));
      if (cat === 'pants') return mount(opts, h('div.eyebrow', t('Trousers colour')), sw(AV.color, 'pants'));
      const list = AV.parts[cat];
      mount(opts, h('div.avx-grid', list.map((p) => h('button.avx-p' + (av[cat] === p.id ? '.on' : ''), { type: 'button', onClick: () => { av[cat] = p.id; changed(); } }, h('b', L(p.n)), priceTag(cat, p)))),
        cat === 'hair' ? [h('div.eyebrow', { style: 'margin-top:14px' }, t('Hair colour')), sw(AV.hairColor, 'hairColor')] : null,
        cat === 'top' ? [h('div.eyebrow', { style: 'margin-top:14px' }, t('Colour')), sw(AV.color, 'topColor')] : null);
    }
    function cost() { let c = 0, g = 0; for (const k of Object.keys(AV.parts)) { const p = AV.parts[k].find((x) => x.id === av[k]); if (p && (p.coins || p.gems) && !owned.has(k + ':' + p.id)) { c += p.coins || 0; g += p.gems || 0; } } return { c, g }; }
    function changed() { stage.update(Object.assign({}, av)); paintOpts(); const { c, g } = cost(); mount(costEl, c || g ? [h('span.small.muted', t('New parts cost:')), c ? h('span.coin', fmt.coins(c)) : null, g ? h('span.gem', fmt.coins(g)) : null] : h('span.small.muted', JSON.stringify(av) === saved ? t('This is your saved avatar.') : t('All these parts are free or already yours.'))); }
    async function save() {
      try {
        let r = await api.put('/api/avatar3d', av);
        if (r.needsPurchase) { const { c, g } = cost(); if (!(await confirmBox(t('Buy the new parts for {x}?', { x: [c ? fmt.coins(c) + ' ' + t('coins') : '', g ? fmt.coins(g) + ' ' + t('gems') : ''].filter(Boolean).join(' + ') })))) return; r = await api.put('/api/avatar3d', Object.assign({}, av, { confirmBuy: true })); }
        for (const o of r.owned || []) owned.add(o); patchMe({ coins: r.coins, gems: r.gems, av3: r.av3 }); toast(t('Avatar saved! Others see it in the 3D casino and on your profile.'), 'good'); changed();
      } catch (e) { toastErr(e); }
    }
    mount(inner, h('div.page-title', h('h2', t('My 3D avatar')), h('p.muted', t('Your character in the 3D casino and on your profile. Drag it to turn it around.'))),
      h('div.avx-wrap', h('div.avx-left', stage, h('div.row.wrap', { style: 'justify-content:center;gap:8px' }, saveBtn, h('button.btn', { onClick: () => ctx.go('casino3d') }, icon('box3d', 16), t('Go to the 3D casino')), h('button.btn.ghost', { onClick: () => ctx.go('profile') }, icon('user', 16), t('See my profile'))), costEl),
        h('div.card.avx-right', tabs, opts)));
    changed();
    return () => stage.destroy();
  },
};

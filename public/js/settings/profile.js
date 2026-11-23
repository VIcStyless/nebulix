// Settings → Profile: display name, bio, avatar and banner (GIF allowed with the right perk/PRO), language, and a live preview.
import { h, mount, pickFile, debounce } from '../util.js';
import { t, getLang, setLang, langName, LANGS } from '../i18n.js';
import { api } from '../api.js';
import { S, setMe, patchMe, isPro } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, field, settingRow, segEl, busy } from '../ui.js';
import { avatarEl, bannerEl, profileCard } from '../cosmetics.js';

const PERK_HINT = {
  avatar: ['Custom Profile Picture', 100], avatar_gif: ['Animated Profile Picture', 300],
  banner_img: ['Custom Banner Image', 120], banner_gif: ['Animated Banner', 350],
};

export default {
  mount(host, ctx) {
    const preview = h('div.set-prev');
    const drawPreview = () => mount(preview, profileCard(S.me, { compact: true }));

    // ---- images ----
    function imageRow(kind) {
      const label = kind === 'avatar' ? t('Profile picture') : t('Banner');
      const thumb = h('div.set-img' + (kind === 'banner' ? '.wide' : ''));
      const paint = () => { if (kind === 'avatar') mount(thumb, avatarEl(S.me, { size: 72, frame: false })); else mount(thumb, bannerEl(S.me, { height: 80 })); };
      paint();
      const up = h('button.btn.sm', {}, icon('upload', 15), t('Upload'));
      up.onclick = () => busy(up, async () => {
        const file = await pickFile('image/png,image/jpeg,image/webp,image/gif'); if (!file) return;
        if (file.size > 12 << 20) return toast(t('That image is too big (max ~10 MB).'), 'err');
        try {
          const r = await api.upload(kind, file);
          const patch = {}; patch[kind] = r.url; const res = await api.patch('/api/profile', patch);
          setMe(res.user); paint(); drawPreview();
          toast(r.animated ? t('Animated {k} set!', { k: label.toLowerCase() }) : t('{k} updated', { k: label }), 'good', 2500);
        } catch (e) {
          if (e.code === 'perk_required') return showLocked(kind, file);
          toastErr(e);
        }
      });
      const clear = h('button.btn.sm.ghost', { onClick: async () => { const patch = {}; patch[kind] = null; try { const r = await api.patch('/api/profile', patch); setMe(r.user); paint(); drawPreview(); } catch (e) { toastErr(e); } } }, icon('trash', 15));
      const lockNote = h('div.tiny.muted');
      function showLocked(k, file) {
        const animated = /gif/i.test(file.type) || file.type === 'image/webp';
        const key = k === 'avatar' ? (animated ? 'avatar_gif' : 'avatar') : (animated ? 'banner_gif' : 'banner_img');
        const [name, price] = PERK_HINT[key];
        mount(lockNote, icon('lock', 13), ' ', t('Unlock "{n}" in the Market ({p} coins) or get PRO to use this.', { n: t(name), p: price }), ' ', h('a.link', { onClick: () => ctx.go('market') }, t('Open Market')));
      }
      return h('div.set-imgrow', h('div.grow', h('label', label), thumb), h('div.col', { style: 'gap:6px' }, h('div.row', up, S.me[kind] ? clear : null), lockNote));
    }

    // ---- text fields ----
    const name = h('input.input', { value: S.me.displayName || '', maxlength: 32, placeholder: S.me.username });
    const nameCount = h('span.tiny.muted');
    const bio = h('textarea.input', { rows: 3, maxlength: 190, placeholder: t('Tell the community a bit about you…') }, S.me.bio || '');
    const bioCount = h('span.tiny.muted');
    const saveName = debounce(async () => { try { const r = await api.patch('/api/profile', { displayName: name.value.trim() || S.me.username }); setMe(r.user); drawPreview(); } catch (e) { toastErr(e); } }, 700);
    const saveBio = debounce(async () => { try { const r = await api.patch('/api/profile', { bio: bio.value }); setMe(r.user); drawPreview(); } catch (e) { toastErr(e); } }, 700);
    name.oninput = () => { nameCount.textContent = `${name.value.length}/32`; saveName(); };
    bio.oninput = () => { bioCount.textContent = `${bio.value.length}/190`; saveBio(); };
    nameCount.textContent = `${(S.me.displayName || '').length}/32`; bioCount.textContent = `${(S.me.bio || '').length}/190`;

    const lang = h('select.select', { style: 'width:auto', 'aria-label': t('Language'), onChange: async () => {
      const l = lang.value;
      try { await api.patch('/api/profile', { lang: l }); patchMe({ lang: l }); setLang(l); toast(t('Reloading in {l}…', { l: langName(l) }), 'good', 1500); setTimeout(() => location.reload(), 500); } catch (e) { toastErr(e); }
    } }, LANGS.map(([code, name, flag]) => h('option', { value: code, selected: code === getLang() }, `${flag} ${name}`)));

    mount(host, h('div.set-split',
      h('div.set-main',
        h('section.card', h('h3', icon('user', 18), t('Public profile')),
          imageRow('avatar'), imageRow('banner'),
          field(h('span', t('Display name'), ' ', nameCount), name),
          field(h('span', t('Bio'), ' ', bioCount), bio),
          settingRow(t('Language'), t('Changes the whole interface. You can also use the language button in the top bar.'), lang)),
        h('section.card', h('h3', icon('palette', 18), t('Cosmetics')),
          h('p.muted.small', t('Frames, name effects, banners, chat bubbles, titles and badges live in the Market. Buy them with coins, then equip them there.')),
          h('div.row.wrap', h('button.btn.primary', { onClick: () => ctx.go('market') }, icon('bag', 16), t('Open the Market')), h('button.btn', { onClick: () => ctx.go('profile', S.me.username) }, icon('eye', 16), t('View my public profile'))))),
      h('div.set-side', h('div.set-prev-wrap', h('div.tiny.muted', { style: 'margin-bottom:8px' }, t('Live preview')), preview))));
    drawPreview();
    return () => {};
  },
};

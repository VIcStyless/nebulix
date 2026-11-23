// Nebulix Lens: an original photo network — photo posts with filters, likes, comments, profile grids and 24-hour stories.
// #/lens · #/lens/u/<name> · #/lens/tag/<tag>
import { h, mount, fmt } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, emptyState, busy, confirmBox, openModal, segEl } from '../ui.js';
import { avatarEl } from '../cosmetics.js';
import { richText, followBtn } from '../media.js';
import { putFile } from './hub.js';

const FILTER_CSS = { none: '', vivid: 'saturate(1.6) contrast(1.1)', warm: 'sepia(.35) saturate(1.3) hue-rotate(-10deg)', cool: 'saturate(1.1) hue-rotate(15deg) brightness(1.05)', mono: 'grayscale(1)', fade: 'contrast(.85) brightness(1.1) saturate(.75)', noir: 'grayscale(1) contrast(1.5) brightness(.9)', dream: 'saturate(1.4) brightness(1.08) blur(.4px) hue-rotate(-20deg)', retro: 'sepia(.6) contrast(1.15) saturate(1.2)' };
const FILTER_NAME = { none: 'Normal', vivid: 'Vivid', warm: 'Warm', cool: 'Cool', mono: 'Mono', fade: 'Fade', noir: 'Noir', dream: 'Dream', retro: 'Retro' };
const tagHref = (x) => '#/lens/tag/' + encodeURIComponent(x); const userHref = (x) => '#/lens/u/' + x;
const rich = (s) => richText(s, { tagHref, userHref });
const STORY_COLORS = ['#7c5cff', '#ec4899', '#f59e0b', '#10b981', '#0ea5e9', '#ef4444', '#111827'];

async function pickImage() {
  return new Promise((res) => { const inp = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif' }); inp.onchange = () => res(inp.files[0] || null); inp.click(); });
}
async function upload(file) { if (file.size > 6 * 1048576) throw new Error(t('Images up to 6 MB')); return (await putFile(`/api/hub/upload?kind=app&thumb=1&name=${encodeURIComponent(file.name)}`, file)).upload; }

function composer(onDone) {
  return async () => {
    const f = await pickImage(); if (!f) return; const url = URL.createObjectURL(f); let filter = 'none';
    const img = h('img.ln-prev', { src: url, alt: '' }); const cap = h('textarea.input', { rows: 3, maxlength: 600, placeholder: t('Write a caption… #tags work') });
    const strip = h('div.lz-filters', Object.keys(FILTER_CSS).map((k) => h('button.lz-f' + (k === filter ? '.on' : ''), { type: 'button', onClick: (e) => { filter = k; img.style.filter = FILTER_CSS[k]; strip.querySelectorAll('.on').forEach((x) => x.classList.remove('on')); e.currentTarget.classList.add('on'); } }, h('img', { src: url, alt: '', style: { filter: FILTER_CSS[k] } }), h('span', t(FILTER_NAME[k])))));
    const go = h('button.btn.primary', { onClick: () => busy(go, async () => { try { const up = await upload(f); const r = await api.post('/api/lens', { img: up, caption: cap.value, filter }); m.close(); URL.revokeObjectURL(url); toast(t('Posted!'), 'good'); onDone && onDone(r.post); } catch (e) { toastErr(e); } }) }, icon('send', 15), t('Share'));
    const m = openModal([h('h2', t('New photo')), h('div.lz-compose', h('div.lz-sq', img), h('div.col', strip, cap, h('div.actions', h('button.btn', { onClick: () => { m.close(); URL.revokeObjectURL(url); } }, t('Cancel')), go)))], { cls: 'lz-modal' });
  };
}
async function storyComposer(onDone) {
  let file = null; let url = null; let color = STORY_COLORS[0];
  const stage = h('div.lz-story-stage', { style: { background: color } }); const txt = h('input.input', { maxlength: 160, placeholder: t('Say something…') });
  const paintStage = () => { stage.style.background = url ? `center/cover url(${url}) ${color}` : color; mount(stage, h('div.lz-story-txt', txt.value)); };
  txt.addEventListener('input', paintStage);
  const colors = h('div.row', { style: 'gap:6px' }, STORY_COLORS.map((c) => h('button.lz-col', { type: 'button', style: { background: c }, onClick: () => { color = c; paintStage(); } })));
  const go = h('button.btn.primary', { onClick: () => busy(go, async () => { try { let img = null; if (file) img = await upload(file); const r = await api.post('/api/lens/stories', { img, text: txt.value, color }); m.close(); toast(t('Story shared for 24 hours'), 'good'); onDone && onDone(r.stories); } catch (e) { toastErr(e); } }) }, t('Share story'));
  const m = openModal([h('h2', t('New story')), stage, h('div.row', { style: 'gap:8px;margin:10px 0;flex-wrap:wrap' }, h('button.btn.sm', { onClick: async () => { const f = await pickImage(); if (f) { file = f; if (url) URL.revokeObjectURL(url); url = URL.createObjectURL(f); paintStage(); } } }, icon('image', 14), t('Photo')), colors), txt, h('div.actions', h('button.btn', { onClick: () => m.close() }, t('Cancel')), go)], { cls: 'lz-modal' });
  paintStage();
}
function storyViewer(groups, gi, onSeen) {
  let i = 0; let raf = 0; let start = 0; const DUR = 5000;
  const bar = h('div.lz-sv-bars'); const media = h('div.lz-sv-media'); const head = h('div.lz-sv-head');
  const close = () => { cancelAnimationFrame(raf); m.close(); onSeen && onSeen(); };
  const show = () => {
    const g = groups[gi]; if (!g) return close(); const s = g.items[i]; if (!s) { gi++; i = 0; return show(); }
    mount(bar, g.items.map((_, k) => h('i', h('b', { style: { width: k < i ? '100%' : '0%' } }))));
    mount(head, avatarEl(g.user, { size: 32 }), h('b', g.user.displayName), h('span.muted.small', fmt.rel(s.created)), g.mine && s.views !== undefined ? h('span.small.muted', ' · 👁 ' + s.views) : null, h('div.grow'),
      g.mine ? h('button.btn.ghost.icon.sm', { 'aria-label': t('Delete'), onClick: async () => { cancelAnimationFrame(raf); if (await confirmBox(t('Delete this story?'), { danger: true })) { try { await api.del('/api/lens/stories/' + s.id); g.items.splice(i, 1); } catch (e) { toastErr(e); } } start = performance.now(); show(); tick(); } }, icon('trash', 15)) : null,
      h('button.btn.ghost.icon.sm', { 'aria-label': t('Close'), onClick: close }, icon('x', 16)));
    media.style.background = s.img ? `center/contain no-repeat url(${s.img}) ${s.color}` : s.color; mount(media, s.text ? h('div.lz-story-txt', s.text) : null);
    if (!g.mine) api.post('/api/lens/stories/' + s.id + '/view', {}, { quiet: true }).catch(() => {});
    start = performance.now();
  };
  const next = () => { i++; show(); }; const prev = () => { if (i > 0) i--; else if (gi > 0) { gi--; i = 0; } show(); };
  const tick = () => { raf = requestAnimationFrame(tick); const p = (performance.now() - start) / DUR; const b = bar.children[i] && bar.children[i].firstChild; if (b) b.style.width = Math.min(100, p * 100) + '%'; if (p >= 1) next(); };
  const box = h('div.lz-sv', bar, head, media, h('button.lz-sv-nav.l', { 'aria-label': t('Previous'), onClick: prev }), h('button.lz-sv-nav.r', { 'aria-label': t('Next'), onClick: next }));
  const m = openModal(box, { cls: 'lz-svm', onClose: () => cancelAnimationFrame(raf) });
  show(); tick();
}

export default {
  title: () => 'Nebulix Lens',
  async mount(root, ctx) {
    const inner = h('div.inner.lz'); mount(root, inner);
    const [mode, arg] = ctx.params || []; let feed = 'for';
    async function openPost(p) {
      const list = h('div.lz-cm'); const inp = h('input.input', { maxlength: 400, placeholder: t('Add a comment…') });
      const load = async () => { try { const r = await api.get('/api/lens/' + p.id + '/comments'); mount(list, r.comments.length ? r.comments.map((c) => h('div.lz-c', avatarEl(c.owner, { size: 28 }), h('div.grow', h('a', { href: userHref(c.owner.username) }, h('b', c.owner.displayName)), ' ', rich(c.text), h('div.tiny.muted', fmt.rel(c.created))), c.mine ? h('button.btn.ghost.icon.sm', { 'aria-label': t('Delete'), onClick: async () => { await api.del('/api/lens/' + p.id + '/comments/' + c.id); load(); } }, icon('trash', 13)) : null)) : h('p.muted.small', t('No comments yet.'))); } catch (e) { toastErr(e); } };
      const send = h('button.btn.primary', { onClick: () => busy(send, async () => { if (!inp.value.trim()) return; try { await api.post('/api/lens/' + p.id + '/comments', { text: inp.value }); inp.value = ''; load(); } catch (e) { toastErr(e); } }) }, icon('send', 14));
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') send.click(); });
      openModal(h('div.lz-detail', h('div.lz-sq', h('img', { src: p.img, alt: '', style: { filter: FILTER_CSS[p.filter] || '' } })), h('div.lz-dside', h('div.lz-head', avatarEl(p.owner, { size: 34 }), h('a', { href: userHref(p.owner.username) }, h('b', p.owner.displayName)), h('div.grow'), followBtn(p.owner.username, false, { small: true })),
        p.caption ? h('div.lz-cap', rich(p.caption)) : null, list, h('div.row', { style: 'gap:6px' }, inp, send))), { cls: 'lz-dm' });
      load();
    }
    function card(p, refresh) {
      const likeB = h('button.lz-act' + (p.liked ? '.on' : ''), { 'aria-label': t('Like'), onClick: async () => { try { const r = await api.post('/api/lens/' + p.id + '/like'); p.liked = r.liked; p.likes = r.likes; likeB.classList.toggle('on', r.liked); cnt.textContent = t('{n} likes', { n: fmt.num(r.likes) }); } catch (e) { toastErr(e); } } }, icon('heart', 22));
      const cnt = h('b.small', t('{n} likes', { n: fmt.num(p.likes) }));
      const imgEl = h('img', { src: p.img, alt: p.caption || '', loading: 'lazy', style: { filter: FILTER_CSS[p.filter] || '' } });
      imgEl.addEventListener('dblclick', () => { if (!p.liked) likeB.click(); const hrt = h('div.lz-pop', '❤'); imgEl.parentElement.appendChild(hrt); setTimeout(() => hrt.remove(), 800); });
      return h('article.lz-card', h('div.lz-head', avatarEl(p.owner, { size: 34 }), h('div.grow', h('a', { href: userHref(p.owner.username) }, h('b', p.owner.displayName)), h('div.tiny.muted', fmt.rel(p.created))), p.mine ? h('button.btn.ghost.icon.sm', { 'aria-label': t('Delete'), onClick: async () => { if (await confirmBox(t('Delete this photo?'), { danger: true })) { await api.del('/api/lens/' + p.id); refresh(); } } }, icon('trash', 15)) : null),
        h('div.lz-sq', imgEl), h('div.lz-acts', likeB, h('button.lz-act', { 'aria-label': t('Comments'), onClick: () => openPost(p) }, icon('chat', 21)), h('span.small.muted', p.comments ? t('{n} comments', { n: p.comments }) : '')), h('div.lz-meta', cnt, p.caption ? h('div.lz-cap', h('a', { href: userHref(p.owner.username) }, h('b', p.owner.username)), ' ', rich(p.caption)) : null));
    }
    async function home() {
      const storiesEl = h('div.lz-stories'); const feedEl = h('div.lz-feed'); const head = h('div.lz-top');
      const load = async () => {
        mount(feedEl, loading());
        try {
          const r = await api.get('/api/lens?feed=' + (mode === 'tag' ? 'tag&tag=' + encodeURIComponent(arg) : feed));
          if (r.stories) mount(storiesEl, h('button.lz-st.add', { onClick: () => storyComposer(load) }, h('span.lz-ring', h('span.lz-plus', icon('plus', 20))), h('span.tiny', t('Your story'))), r.stories.map((g, gi) => h('button.lz-st' + (g.seen ? '.seen' : ''), { onClick: () => storyViewer(r.stories, gi, load) }, h('span.lz-ring', avatarEl(g.user, { size: 58 })), h('span.tiny', g.mine ? t('You') : g.user.username))));
          mount(feedEl, r.posts.length ? r.posts.map((p) => card(p, load)) : emptyState('image', feed === 'following' ? t('Nothing from people you follow yet') : t('No photos yet'), t('Be the first to share one!')));
        } catch (e) { mount(feedEl, emptyState('alert', t('Could not load this'), e.message)); }
      };
      mount(head, h('div.grow', h('h2.lz-logo', 'Lens'), h('div.small.muted', mode === 'tag' ? '#' + arg : t('Photos and stories from the community'))),
        mode === 'tag' ? h('a.btn', { href: '#/lens' }, icon('back', 14), t('Back')) : segEl([['for', t('For you')], ['following', t('Following')]], feed, (v) => { feed = v; load(); }),
        h('button.btn.primary', { onClick: composer(() => load()) }, icon('plus', 15), t('New photo')), h('a.btn', { href: userHref(S.me.username) }, icon('user', 15), t('My profile')));
      mount(inner, head, mode === 'tag' ? null : storiesEl, feedEl); load();
    }
    async function profile(name) {
      mount(inner, loading());
      let r; try { r = await api.get('/api/lens/u/' + encodeURIComponent(name)); } catch (e) { mount(inner, emptyState('alert', t('Could not load this'), e.message)); return; }
      const grid = h('div.lz-grid', r.posts.map((p) => h('button.lz-cell', { onClick: () => openPost(p) }, h('img', { src: p.img, alt: '', loading: 'lazy', style: { filter: FILTER_CSS[p.filter] || '' } }), h('span.lz-cell-ov', '❤ ' + fmt.compact(p.likes) + '   💬 ' + fmt.compact(p.comments)))));
      const mine = r.user.username.toLowerCase() === S.me.username.toLowerCase();
      mount(inner, h('a.btn.ghost.sm', { href: '#/lens' }, icon('back', 14), 'Lens'),
        h('section.lz-prof', avatarEl(r.user, { size: 96 }), h('div.grow', h('div.row', { style: 'gap:10px;flex-wrap:wrap;align-items:center' }, h('h2', r.user.displayName), h('span.muted', '@' + r.user.username), mine ? h('button.btn.sm.primary', { onClick: composer(() => profile(name)) }, icon('plus', 14), t('New photo')) : followBtn(r.user.username, r.isFollowing, { small: true })),
          h('div.lz-stats', h('span', h('b', fmt.num(r.count)), ' ' + t('posts')), h('span', h('b', fmt.num(r.followers)), ' ' + t('followers')), h('span', h('b', fmt.num(r.following)), ' ' + t('following')), h('span', h('b', fmt.num(r.likes)), ' ' + t('likes'))), r.bio ? h('p.small', r.bio) : null)),
        r.posts.length ? grid : emptyState('image', t('No photos yet'), mine ? t('Share your first photo!') : ''));
    }
    if (mode === 'u' && arg) profile(arg); else home();
    return () => {};
  },
};

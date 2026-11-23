// Clips: Nebulix's own vertical short-video feed. #/clips · #/clips/following · #/clips/v/<id> · #/clips/u/<name>
import { h, mount, fmt, ls } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, emptyState, confirmBox } from '../ui.js';
import { avatarEl, nameEl } from '../cosmetics.js';
import { richText, followBtn, commentsPanel, uploadVideo } from '../media.js';

export default {
  full: true,
  title: () => 'Clips',
  async mount(root, ctx) {
    const [a, b] = ctx.params;
    const wrap = h('div.cl'); mount(root, wrap);
    if (a === 'u' && b) { userGrid(b); return () => {}; }
    const tab = a === 'following' ? 'following' : 'foryou';
    let muted = ls('clips.muted') !== false; let io = null; let active = null; const viewed = new Set();
    const feed = h('div.cl-feed', { tabIndex: 0 });
    const drawer = h('aside.cl-drawer');
    const top = h('div.cl-top',
      h('a.cl-brand', { href: '#/clips' }, icon('zap', 18), h('b', 'Clips')),
      h('div.cl-tabs', h('a' + (tab === 'following' ? '.on' : ''), { href: '#/clips/following' }, t('Following')), h('a' + (tab === 'foryou' ? '.on' : ''), { href: '#/clips' }, t('For you'))),
      h('div.cl-top-r', h('a.cl-ic', { href: '#/clips/u/' + S.me.username, title: t('My clips') }, icon('user', 18)), h('button.btn.primary.sm', { onClick: async () => { const it = await uploadVideo('clip'); if (it) ctx.go('clips', 'v/' + it.id); } }, icon('plus', 15), t('Upload'))));
    mount(wrap, top, feed, drawer);
    mount(feed, loading());
    let items;
    try { items = (await api.get(`/api/clips?tab=${tab}&seed=${Math.floor(Math.random() * 1e6)}${a === 'v' && b ? '&start=' + encodeURIComponent(b) : ''}`)).items; }
    catch (e) { mount(feed, emptyState('alert', t('Could not load this'), e.message)); return () => {}; }
    if (!items.length) {
      mount(feed, h('div.cl-empty', emptyState('zap', tab === 'following' ? t('No clips from people you follow') : t('No clips yet'), tab === 'following' ? t('Follow creators to see their clips here.') : t('Upload the very first clip of Nebulix!'),
        h('button.btn.primary', { onClick: async () => { const it = await uploadVideo('clip'); if (it) ctx.go('clips', 'v/' + it.id); } }, icon('upload', 15), t('Upload a clip')))));
      return () => {};
    }
    function slide(c) {
      const v = h('video.cl-video', { src: c.src, loop: true, playsinline: true, muted, preload: 'none', poster: c.thumb || null });
      const heart = h('div.cl-burst', icon('heart', 90));
      const likeCount = h('span', fmt.compact(c.likes));
      const likeB = h('button.cl-act' + (c.liked ? '.on' : ''), { onClick: () => toggleLike() }, h('i', icon('heart', 28)), likeCount);
      async function toggleLike(forceOn) {
        if (forceOn && c.liked) return;
        try { const r = await api.post(`/api/hub/${c.id}/like`); c.liked = r.liked; likeB.classList.toggle('on', r.liked); likeCount.textContent = fmt.compact(r.likes); } catch (e) { toastErr(e); }
      }
      const cmtCount = h('span', fmt.compact(c.comments));
      const prog = h('div.cl-prog', h('i'));
      const pauseIc = h('div.cl-paused', icon('play', 64));
      let lastTap = 0;
      const stage = h('div.cl-stage', { onClick: (e) => {
        const n = Date.now(); if (n - lastTap < 280) { heart.style.left = e.offsetX + 'px'; heart.style.top = e.offsetY + 'px'; heart.classList.remove('go'); void heart.offsetWidth; heart.classList.add('go'); toggleLike(true); lastTap = 0; clearTimeout(stage.tm); return; }
        lastTap = n; clearTimeout(stage.tm); stage.tm = setTimeout(() => { if (v.paused) v.play().catch(() => {}); else v.pause(); el.classList.toggle('paused', v.paused); }, 280);
      } }, v, heart, pauseIc, prog);
      v.addEventListener('timeupdate', () => { if (v.duration) prog.firstChild.style.width = (v.currentTime / v.duration * 100) + '%'; });
      const el = h('section.cl-slide', { dataset: { id: c.id } }, stage,
        h('div.cl-rail',
          c.owner ? h('div.cl-av', h('a', { href: '#/clips/u/' + c.owner.username }, avatarEl(c.owner, { size: 48 })), !c.mine && !c.following ? h('button.cl-plus', { title: t('Follow'), onClick: async (e) => { const btn = e.currentTarget; try { const r = await api.post('/api/follow/' + c.owner.username); if (r.following) { btn.remove(); toast(t('Following @{u}', { u: c.owner.username }), 'good'); } } catch (er) { toastErr(er); } } }, icon('plus', 12)) : null) : null,
          likeB,
          h('button.cl-act', { onClick: () => openComments(c, cmtCount) }, h('i', icon('chat', 26)), cmtCount),
          h('button.cl-act', { onClick: async () => { const url = location.origin + '/#/clips/v/' + c.id; try { if (navigator.share) await navigator.share({ url, title: c.title }); else { await navigator.clipboard.writeText(url); toast(t('Link copied'), 'good'); } } catch {} } }, h('i', icon('share', 24)), h('span', t('Share'))),
          h('button.cl-act', { onClick: () => { muted = !muted; ls('clips.muted', muted); for (const x of feed.querySelectorAll('video')) x.muted = muted; paintMute(); } }, h('i.cl-mute', icon(muted ? 'micoff' : 'volume', 24)), h('span', '')),
          c.mine ? h('button.cl-act', { onClick: async () => { if (!(await confirmBox(t('Delete this clip?'), { danger: true }))) return; try { await api.del('/api/hub/' + c.id); el.remove(); toast(t('Deleted'), 'good'); } catch (e) { toastErr(e); } } }, h('i', icon('trash', 22)), h('span', '')) : null),
        h('div.cl-info', c.owner ? h('a.cl-user', { href: '#/clips/u/' + c.owner.username }, '@' + c.owner.username) : null, c.game ? h('a.cl-game', { href: '#/hub/' + c.game.id }, '🎮 ' + c.game.title) : null, h('div.cl-cap', richText(c.title + (c.desc ? '\n' + c.desc : ''), { tagHref: (x) => '#/echo/tag/' + encodeURIComponent(x), userHref: (x) => '#/clips/u/' + x })),
          h('div.tiny.cl-meta', icon('eye', 12), ' ' + t('{n} views', { n: fmt.compact(c.views) }) + ' · ' + fmt.rel(c.created))));
      el._v = v; el._c = c; return el;
    }
    function paintMute() { for (const i of feed.querySelectorAll('.cl-mute')) mount(i, icon(muted ? 'micoff' : 'volume', 24)); }
    function openComments(c, countEl) {
      wrap.classList.add('drawer-on');
      mount(drawer, h('div.cl-dhead', h('b', t('Comments')), h('button.btn.ghost.sm', { onClick: () => wrap.classList.remove('drawer-on') }, icon('x', 16))), commentsPanel(c.id, { ownerId: c.owner && c.owner.id, onCount: (n) => { c.comments = n; countEl.textContent = fmt.compact(n); } }));
    }
    for (const c of items) feed.appendChild(slide(c));
    [...feed.children].forEach((x) => { if (!x.classList.contains('cl-slide')) x.remove(); });
    io = new IntersectionObserver((ents) => {
      for (const en of ents) {
        const el = en.target; const v = el._v;
        if (en.isIntersecting && en.intersectionRatio > 0.6) {
          active = el; v.preload = 'auto'; v.muted = muted; v.play().catch(() => { muted = true; v.muted = true; paintMute(); v.play().catch(() => {}); }); el.classList.remove('paused');
          const nx = el.nextElementSibling; if (nx && nx._v) nx._v.preload = 'auto';
          if (!viewed.has(el._c.id)) { viewed.add(el._c.id); api.post(`/api/clips/${el._c.id}/view`, {}, { quiet: true }).catch(() => {}); }
          if (history.replaceState) history.replaceState(history.state, '', '#/clips/v/' + el._c.id);
        } else { v.pause(); }
      }
    }, { root: feed, threshold: [0, 0.6, 1] });
    for (const el of feed.children) io.observe(el);
    const onKey = (e) => {
      if (/INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || '')) return;
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); (active && active.nextElementSibling || feed.firstElementChild).scrollIntoView({ behavior: 'smooth' }); }
      else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); (active && active.previousElementSibling || feed.firstElementChild).scrollIntoView({ behavior: 'smooth' }); }
      else if (e.key === 'm') { muted = !muted; ls('clips.muted', muted); if (active) active._v.muted = muted; paintMute(); }
    };
    document.addEventListener('keydown', onKey);
    feed.focus({ preventScroll: true });
    return () => { document.removeEventListener('keydown', onKey); if (io) io.disconnect(); for (const v of feed.querySelectorAll('video')) { v.pause(); v.removeAttribute('src'); v.load(); } };

    async function userGrid(name) {
      mount(wrap, loading());
      let d; try { d = await api.get('/api/creator/' + encodeURIComponent(name)); } catch (e) { mount(wrap, emptyState('user', t('User not found'), e.message)); return; }
      const u = d.user; const followers = h('b', fmt.compact(d.followers));
      const likes = d.clips.reduce((s, x) => s + x.likes, 0);
      mount(wrap, h('div.cl-prof',
        h('div.cl-top.static', h('button.btn.ghost.sm', { onClick: () => ctx.go('clips') }, icon('back', 16), 'Clips'), h('span.grow'), d.me ? h('button.btn.primary.sm', { onClick: async () => { const it = await uploadVideo('clip'); if (it) ctx.go('clips', 'v/' + it.id); } }, icon('plus', 15), t('Upload')) : null),
        h('div.cl-prof-head', avatarEl(u, { size: 96 }), h('h2', nameEl(u)), h('div.muted', '@' + u.username),
          h('div.cl-prof-stats', h('div', h('b', fmt.compact(d.following)), h('span', t('following'))), h('div', followers, h('span', t('followers'))), h('div', h('b', fmt.compact(likes)), h('span', t('likes')))),
          h('div.row', { style: 'gap:8px;justify-content:center' }, d.me ? null : followBtn(u.username, d.isFollowing, { onChange: (r) => { followers.textContent = fmt.compact(r.followers); } }), h('a.btn', { href: '#/echo/u/' + u.username }, 'Echo'), d.totals.videos ? h('a.btn', { href: '#/tv/c/' + u.username }, 'Nebulix TV') : null),
          u.bio ? h('p.small', richText(u.bio)) : null),
        d.clips.length ? h('div.cl-grid', d.clips.map((c) => h('a.cl-cell', { href: '#/clips/v/' + c.id }, c.thumb ? h('img', { src: c.thumb, alt: '', loading: 'lazy' }) : h('span.cl-ph', icon('zap', 30)), h('span.cl-cell-v', icon('play', 12), ' ' + fmt.compact(c.views)), c.public ? null : h('span.cl-cell-p', icon('lock', 12)))))
          : emptyState('zap', t('No clips yet'))));
    }
  },
};

// Echo: Nebulix's own short-post network. #/echo · #/echo/following · #/echo/p/<id> · #/echo/u/<name> · #/echo/tag/<tag> · #/echo/search?q=
import { h, mount, fmt } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, emptyState, busy, confirmBox, openModal, openMenu } from '../ui.js';
import { avatarEl, nameEl, bannerEl } from '../cosmetics.js';
import { richText, followBtn } from '../media.js';
import { putFile } from './hub.js';

const MAX = 500;

export default {
  full: true,
  title: () => 'Echo',
  async mount(root, ctx) {
    const [a, b] = ctx.params; const tab = a === 'following' ? 'following' : a === 'p' ? 'post' : a === 'u' ? 'user' : a === 'tag' ? 'tag' : a === 'search' ? 'search' : 'foryou';
    const center = h('main.ec-center'); const side = h('aside.ec-side');
    const navBtn = (route, ic, label, on) => h('a.ec-nav' + (on ? '.on' : ''), { href: '#/echo' + route }, icon(ic, 20), h('span', label));
    const left = h('nav.ec-left', h('div.ec-logo', h('span.ec-mark', icon('activity', 20)), h('b', 'Echo')),
      navBtn('', 'home', t('For you'), tab === 'foryou'), navBtn('/following', 'users', t('Following'), tab === 'following'), navBtn('/search', 'search', t('Explore'), tab === 'search' || tab === 'tag'),
      navBtn('/u/' + S.me.username, 'user', t('My profile'), tab === 'user' && b && b.toLowerCase() === S.me.username.toLowerCase()),
      h('button.btn.primary.ec-post-btn', { onClick: () => composeModal({}) }, icon('edit', 16), h('span', t('Post'))),
      h('div.ec-apps', h('a.ec-app', { href: '#/clips' }, icon('zap', 14), 'Clips'), h('a.ec-app', { href: '#/tv' }, icon('play', 14), 'Nebulix TV')));
    mount(root, h('div.ec', left, center, side));
    sidePanel();

    // ---------- post card ----------
    function card(p, { big = false, onGone } = {}) {
      if (!p) return null;
      if (p.repostedBy) { const inner = card(p.post, { onGone }); return inner && h('div.ec-repost-wrap', h('div.ec-reposted', icon('repeat', 13), h('a', { href: '#/echo/u/' + p.repostedBy.username }, t('{u} reposted', { u: p.repostedBy.displayName }))), inner); }
      const el = h('article.ec-card' + (big ? '.big' : ''), { onClick: (e) => { if (big || e.target.closest('a,button,video,img.ec-img,.ec-quote')) return; ctx.go('echo', 'p/' + p.id); } });
      const likeB = h('button.ec-act.like' + (p.liked ? '.on' : ''), { title: t('Like'), onClick: () => busy(likeB, async () => { const r = await api.post(`/api/echo/${p.id}/like`); p.liked = r.liked; likeB.classList.toggle('on', r.liked); likeB.lastChild.textContent = r.likes ? fmt.compact(r.likes) : ''; if (r.liked) { likeB.classList.remove('pop'); void likeB.offsetWidth; likeB.classList.add('pop'); } }) }, icon('heart', 17), h('span', p.likes ? fmt.compact(p.likes) : ''));
      const rpB = h('button.ec-act.rp' + (p.reposted ? '.on' : ''), { title: t('Repost'), onClick: (e) => openMenu([
        { label: p.reposted ? t('Undo repost') : t('Repost'), icon: 'repeat', onClick: async () => { try { const r = await api.post(`/api/echo/${p.id}/repost`); p.reposted = r.reposted; rpB.classList.toggle('on', r.reposted); rpB.lastChild.textContent = r.reposts ? fmt.compact(r.reposts) : ''; toast(r.reposted ? t('Reposted') : t('Repost removed'), 'good'); } catch (er) { toastErr(er); } } },
        { label: t('Quote'), icon: 'edit', onClick: () => composeModal({ quote: p }) }], e.currentTarget) }, icon('repeat', 17), h('span', p.reposts ? fmt.compact(p.reposts) : ''));
      const more = [];
      more.push({ label: t('Copy link'), icon: 'link', onClick: async () => { try { await navigator.clipboard.writeText(location.origin + '/#/echo/p/' + p.id); toast(t('Link copied'), 'good'); } catch {} } });
      if (p.canDelete) more.push({ label: t('Delete'), icon: 'trash', danger: true, onClick: async () => { if (!(await confirmBox(t('Delete this post?'), { danger: true }))) return; try { await api.del('/api/echo/' + p.id); el.remove(); onGone && onGone(); toast(t('Deleted'), 'good'); } catch (er) { toastErr(er); } } });
      mount(el,
        h('a.ec-ava', { href: '#/echo/u/' + p.owner.username }, avatarEl(p.owner, { size: big ? 48 : 42 })),
        h('div.ec-body',
          h('div.ec-head', h('a.ec-name', { href: '#/echo/u/' + p.owner.username }, nameEl(p.owner), p.owner.pro ? h('span.ec-pro', 'PRO') : null), h('span.muted', '@' + p.owner.username + ' · '), h('a.muted.ec-time', { href: '#/echo/p/' + p.id, title: fmt.dt(p.created) }, fmt.rel(p.created)),
            h('span.grow'), h('button.ec-more', { title: t('More'), onClick: (e) => openMenu(more, e.currentTarget) }, icon('more', 16))),
          p.replyTo && p.replyTo.username ? h('div.tiny.muted', t('Replying to'), ' ', h('a.md-at', { href: '#/echo/p/' + p.replyTo.id }, '@' + p.replyTo.username)) : null,
          p.text ? h('div.ec-text', richText(p.text)) : null,
          p.img ? h('img.ec-img', { src: p.img, alt: '', loading: 'lazy', onClick: () => openModal(h('img.ec-full', { src: p.img, alt: '' }), { cls: 'ec-lightbox' }) }) : null,
          p.quote ? (p.quote.gone ? h('div.ec-quote.muted.small', t('This post was deleted')) : h('a.ec-quote', { href: '#/echo/p/' + p.quote.id }, h('div.ec-head', avatarEl(p.quote.owner, { size: 20 }), h('b', p.quote.owner.displayName), h('span.muted', ' @' + p.quote.owner.username + ' · ' + fmt.rel(p.quote.created))), p.quote.text ? h('div.ec-text.small', richText(p.quote.text)) : null, p.quote.img ? h('img.ec-img.sm', { src: p.quote.img, alt: '', loading: 'lazy' }) : null)) : null,
          big ? h('div.tiny.muted.ec-stamp', fmt.dt(p.created) + ' · ' + t('{n} views', { n: fmt.num(p.views) })) : null,
          h('div.ec-acts', h('button.ec-act.rep', { title: t('Reply'), onClick: () => composeModal({ reply: p }) }, icon('reply', 17), h('span', p.replies ? fmt.compact(p.replies) : '')), rpB, likeB,
            h('button.ec-act', { title: t('Share'), onClick: async () => { const url = location.origin + '/#/echo/p/' + p.id; try { if (navigator.share) await navigator.share({ url, text: p.text.slice(0, 80) }); else { await navigator.clipboard.writeText(url); toast(t('Link copied'), 'good'); } } catch {} } }, icon('share', 16)))));
      return el;
    }

    // ---------- composer ----------
    function composer({ reply, quote, onDone, autofocus } = {}) {
      let imgFile = null; let imgUrl = null;
      const ta = h('textarea.ec-ta', { rows: 2, maxlength: MAX, placeholder: reply ? t('Post your reply') : quote ? t('Add a comment') : t('What’s happening?'), onInput: () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; paint(); }, onKeydown: (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') post(); } });
      const ring = h('span.ec-ring'); const prev = h('div.ec-prev');
      const postB = h('button.btn.primary.sm', { onClick: () => post() }, reply ? t('Reply') : t('Post'));
      const imgIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', style: 'display:none', onChange: () => { const f = imgIn.files[0]; if (!f) return; if (f.size > 3 * 1048576) { toast(t('Images up to 3 MB'), 'err'); return; } imgFile = f; if (imgUrl) URL.revokeObjectURL(imgUrl); imgUrl = URL.createObjectURL(f); mount(prev, h('div.ec-prev-in', h('img', { src: imgUrl, alt: '' }), h('button.ec-prev-x', { onClick: () => { imgFile = null; mount(prev); paint(); } }, icon('x', 14)))); paint(); } });
      function paint() { const n = ta.value.length; const pct = Math.min(1, n / MAX); ring.style.setProperty('--p', pct * 360 + 'deg'); ring.classList.toggle('warn', n > MAX - 40); ring.textContent = n > MAX - 40 ? String(MAX - n) : ''; postB.disabled = !ta.value.trim() && !imgFile && !quote; }
      async function post() {
        if (postB.disabled) return;
        await busy(postB, async () => {
          let img = null; if (imgFile) img = (await putFile(`/api/hub/upload?kind=app&thumb=1&name=${encodeURIComponent(imgFile.name)}`, imgFile)).upload;
          const r = await api.post('/api/echo', { text: ta.value, img, reply: reply && reply.id, quote: quote && quote.id });
          ta.value = ''; imgFile = null; mount(prev); ta.style.height = ''; paint(); toast(reply ? t('Reply sent') : t('Posted!'), 'good'); onDone && onDone(r.post);
        });
      }
      paint(); if (autofocus) setTimeout(() => ta.focus(), 30);
      return h('div.ec-compose', avatarEl(S.me, { size: 42 }), h('div.grow', { style: 'min-width:0' }, ta, prev,
        quote ? h('div.ec-quote.small', h('b', quote.owner.displayName), h('span.muted', ' @' + quote.owner.username), h('div', quote.text.slice(0, 200))) : null,
        h('div.ec-tools', h('button.ec-tool', { title: t('Image'), onClick: () => imgIn.click() }, icon('image', 18)), h('button.ec-tool', { title: t('Hashtag'), onClick: () => { ta.value += (ta.value && !/\s$/.test(ta.value) ? ' ' : '') + '#'; ta.focus(); paint(); } }, icon('hash', 18)), imgIn, h('span.grow'), ring, postB)));
    }
    function composeModal({ reply, quote }) {
      let m;
      const body = h('div.ec-modal', reply ? h('div.ec-modal-ctx', card(reply)) : null, composer({ reply, quote, autofocus: true, onDone: (p) => { m.close(); if (tab === 'post' && reply) render(); else if (!reply) ctx.go('echo', 'p/' + p.id); } }));
      m = openModal(body, { cls: 'ec-modal-wrap' });
    }

    // ---------- feeds ----------
    async function feedPage(apiTab, header, { withComposer = false, empty } = {}) {
      const list = h('div.ec-list'); const moreB = h('button.btn.ghost.ec-moreb.hidden', t('Load more'));
      let cursor = null; let page = 0;
      mount(center, header, withComposer ? composer({ onDone: (p) => list.prepend(card(p)) }) : null, list, moreB);
      async function load(next) {
        if (!next) mount(list, loading());
        try {
          const q = apiTab === 'foryou' ? `page=${page}` : (cursor ? `before=${cursor}` : '');
          const r = await api.get(`/api/echo?tab=${encodeURIComponent(apiTab)}&${q}${apiTab === 'search' ? '&q=' + encodeURIComponent(ctx.query.get('q') || '') : ''}`);
          if (!next) mount(list);
          if (!r.items.length && !next) mount(list, empty || emptyState('chat', t('Nothing here yet'), t('Be the first to post something!')));
          for (const p of r.items) list.appendChild(card(p));
          const last = r.items[r.items.length - 1]; cursor = last ? last.created : cursor; page++;
          moreB.classList.toggle('hidden', !r.more);
        } catch (e) { mount(list, emptyState('alert', t('Could not load this'), e.message)); }
      }
      moreB.onclick = () => busy(moreB, () => load(true));
      load();
    }
    const header = (title, sub, extra) => h('div.ec-top', h('div.grow', h('h2', title), sub ? h('div.tiny.muted', sub) : null), extra || null);
    const tabsTop = () => h('div.ec-tabs', h('a.ec-tab' + (tab === 'foryou' ? '.on' : ''), { href: '#/echo' }, t('For you')), h('a.ec-tab' + (tab === 'following' ? '.on' : ''), { href: '#/echo/following' }, t('Following')));

    async function render() {
      if (tab === 'foryou' || tab === 'following') return feedPage(tab, h('div.ec-top.sticky', tabsTop()), { withComposer: true, empty: tab === 'following' ? emptyState('users', t('Your timeline is empty'), t('Follow people to see their posts here.'), h('a.btn.primary', { href: '#/echo/search' }, t('Find people'))) : null });
      if (tab === 'tag') return feedPage('tag:' + b, header('#' + b, t('Posts with this hashtag')));
      if (tab === 'search') {
        const q = ctx.query.get('q') || '';
        const inp = h('input.input.ec-search', { value: q, placeholder: t('Search Echo'), onKeydown: (e) => { if (e.key === 'Enter' && inp.value.trim()) ctx.go('echo/search', { q: inp.value.trim() }); } });
        if (!q) { mount(center, h('div.ec-top', h('div.grow', inp)), h('div.ec-explore', h('div.eyebrow', t('Trending')), h('div.ec-trend-big'))); fillTrends(center.querySelector('.ec-trend-big')); setTimeout(() => inp.focus(), 30); return; }
        await feedPage('search', h('div.ec-top', h('div.grow', inp))); return;
      }
      if (tab === 'post') {
        mount(center, header(t('Post')), loading());
        try {
          const r = await api.get('/api/echo/' + encodeURIComponent(b));
          mount(center, h('div.ec-top.sticky', h('button.btn.ghost.sm', { onClick: () => ctx.go('echo') }, icon('back', 16)), h('h2', t('Post'))),
            r.parents.length ? h('div.ec-thread', r.parents.map((x) => card(x))) : null, card(r.post, { big: true, onGone: () => ctx.go('echo') }),
            composer({ reply: r.post, onDone: () => render() }), h('div.ec-list', r.replies.map((x) => card(x))));
        } catch (e) { mount(center, emptyState('alert', t('Post not found'), e.message, h('a.btn', { href: '#/echo' }, t('Back')))); }
        return;
      }
      if (tab === 'user') return profile(b);
    }
    async function profile(name) {
      mount(center, loading());
      let d; try { d = await api.get('/api/creator/' + encodeURIComponent(name)); } catch (e) { mount(center, emptyState('user', t('User not found'), e.message)); return; }
      const u = d.user; const sub = ctx.query.get('tab') || 'posts';
      const followers = h('b', fmt.compact(d.followers));
      const top = h('div.ec-prof', bannerEl(u, { height: 150, cls: 'ec-banner' }),
        h('div.ec-prof-row', avatarEl(u, { size: 92, cls: 'ec-prof-ava' }), h('span.grow'), d.me ? h('a.btn', { href: '#/settings/profile' }, t('Edit profile')) : followBtn(u.username, d.isFollowing, { onChange: (r) => { followers.textContent = fmt.compact(r.followers); } })),
        h('h2', nameEl(u)), h('div.muted', '@' + u.username), u.bio ? h('div.ec-text', richText(u.bio)) : null,
        h('div.ec-stats', h('span', followers, ' ', t('followers')), h('span', h('b', fmt.compact(d.following)), ' ', t('following')), h('span', h('b', fmt.compact(d.totals.echoes)), ' ', t('posts')),
          d.totals.videos ? h('a', { href: '#/tv/c/' + u.username }, icon('play', 13), ' ', t('{n} videos', { n: d.totals.videos })) : null, d.totals.clips ? h('a', { href: '#/clips/u/' + u.username }, icon('zap', 13), ' ', t('{n} clips', { n: d.totals.clips })) : null),
        h('div.ec-tabs', [['posts', t('Posts')], ['replies', t('Replies')], ['likes', t('Likes')]].map(([k, l]) => h('a.ec-tab' + (sub === k ? '.on' : ''), { href: `#/echo/u/${u.username}?tab=${k}` }, l))));
      const list = h('div.ec-list'); mount(center, h('div.ec-top.sticky', h('button.btn.ghost.sm', { onClick: () => ctx.go('echo') }, icon('back', 16)), h('div', h('b', u.displayName), h('div.tiny.muted', t('{n} posts', { n: d.totals.echoes })))), top, list);
      mount(list, loading());
      try { const r = await api.get(`/api/echo?tab=${sub === 'likes' ? 'likes:' : 'user:'}${encodeURIComponent(u.username)}${sub === 'replies' ? '&replies=1' : ''}`); mount(list, r.items.length ? r.items.map((x) => card(x)) : emptyState('chat', t('No posts yet'))); } catch (e) { mount(list, emptyState('alert', e.message)); }
    }
    async function fillTrends(box) {
      try { const r = await api.get('/api/echo/side'); mount(box, r.trends.length ? r.trends.map((x, i) => h('a.ec-trend', { href: '#/echo/tag/' + encodeURIComponent(x.tag) }, h('div.tiny.muted', t('{n}. Trending', { n: i + 1 })), h('b', '#' + x.tag), h('div.tiny.muted', t('{n} posts', { n: x.n })))) : h('div.muted.small', t('No trends yet. Use #hashtags in your posts!'))); } catch {}
    }
    async function sidePanel() {
      const trends = h('div'); const who = h('div');
      const sInp = h('input.input.ec-search', { placeholder: t('Search Echo'), onKeydown: (e) => { if (e.key === 'Enter' && sInp.value.trim()) ctx.go('echo/search', { q: sInp.value.trim() }); } });
      mount(side, sInp, h('div.ec-box', h('h3', t('Trending')), trends), h('div.ec-box', h('h3', t('Who to follow')), who), h('div.tiny.muted.ec-foot', t('Echo is part of Nebulix. Be kind: posts are public.')));
      try {
        const r = await api.get('/api/echo/side');
        mount(trends, r.trends.length ? r.trends.slice(0, 6).map((x) => h('a.ec-trend', { href: '#/echo/tag/' + encodeURIComponent(x.tag) }, h('b', '#' + x.tag), h('div.tiny.muted', t('{n} posts', { n: x.n })))) : h('div.muted.small', t('No trends yet. Use #hashtags in your posts!')));
        mount(who, r.who.length ? r.who.map((u) => h('div.ec-who', h('a', { href: '#/echo/u/' + u.username }, avatarEl(u, { size: 38 })), h('a.grow.ec-who-n', { href: '#/echo/u/' + u.username }, h('b', u.displayName), h('div.tiny.muted', '@' + u.username)), followBtn(u.username, false, { small: true }))) : h('div.muted.small', t('You follow everyone active. Nice!')));
      } catch {}
    }
    render();
    return () => {};
  },
};

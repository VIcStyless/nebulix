// Nebulix Foros: original community forums — communities (n/name), posts with up/down votes, hot/new/top and
// threaded comments. #/forum · #/forum/n/<sub> · #/forum/p/<id>
import { navHash } from '../app.js';
import { h, mount, fmt } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, emptyState, busy, confirmBox, modal, segEl, field } from '../ui.js';
import { avatarEl } from '../cosmetics.js';
import { richText } from '../media.js';
import { putFile } from './hub.js';

const rich = (s) => richText(s, { tagHref: (x) => '#/forum?q=' + encodeURIComponent(x), userHref: (x) => '#/profile/' + x });
function voter(score, vote, url, small) {
  let s = score, v = vote; const el = h('div.fr-vote' + (small ? '.sm' : ''));
  const paint = () => mount(el, h('button.fr-up' + (v === 1 ? '.on' : ''), { 'aria-label': t('Upvote'), onClick: (e) => { e.stopPropagation(); cast(v === 1 ? 0 : 1); } }, '▲'), h('b', fmt.compact(s)), h('button.fr-down' + (v === -1 ? '.on' : ''), { 'aria-label': t('Downvote'), onClick: (e) => { e.stopPropagation(); cast(v === -1 ? 0 : -1); } }, '▼'));
  const cast = async (nv) => { const old = [s, v]; s += nv - v; v = nv; paint(); try { const r = await api.post(url, { v: nv }); s = r.score; v = r.vote; paint(); } catch (e) { [s, v] = old; paint(); toastErr(e); } };
  paint(); return el;
}

export default {
  title: () => 'Nebulix Foros',
  async mount(root, ctx) {
    const inner = h('div.inner.fr'); mount(root, inner);
    const [mode, arg] = ctx.params || []; let sort = 'hot'; let subs = [];
    try { subs = (await api.get('/api/forum/subs')).subs; } catch {}
    const subOf = (id) => subs.find((s) => s.id === id);
    async function newPost(preSub) {
      let file = null; let created = null;
      const sub = h('select.select', subs.map((s) => h('option', { value: s.id, selected: s.id === preSub }, s.icon + ' n/' + s.id)));
      const title = h('input.input', { maxlength: 140, placeholder: t('An interesting title') }); const body = h('textarea.input', { rows: 6, maxlength: 6000, placeholder: t('Text (optional)') });
      const link = h('input.input', { placeholder: 'https://… ' + t('(optional)') }); const imgLbl = h('span.small.muted', '');
      const r = await modal({ title: t('New post'), cls: 'fr-modal', body: h('div.col', { style: 'gap:10px' }, field(t('Community'), sub), field(t('Title'), title), body, field(t('Link'), link), h('div.row', { style: 'gap:8px' }, h('button.btn.sm', { type: 'button', onClick: () => { const inp = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif' }); inp.onchange = () => { file = inp.files[0] || null; imgLbl.textContent = file ? file.name : ''; }; inp.click(); } }, icon('image', 14), t('Image')), imgLbl)),
        actions: [{ label: t('Cancel') }, { label: t('Post'), kind: 'primary', onClick: async (e) => { const b = e.currentTarget; let out = false; await busy(b, async () => { try { let img = null; if (file) { if (file.size > 6 * 1048576) throw new Error(t('Images up to 6 MB')); img = (await putFile(`/api/hub/upload?kind=app&thumb=1&name=${encodeURIComponent(file.name)}`, file)).upload; } const res = await api.post('/api/forum', { sub: sub.value, title: title.value, body: body.value, link: link.value, img }); out = res.post.id; } catch (er) { toastErr(er); } }); if (!out) return false; created = out; return true; } }] });
      if (r && created) { toast(t('Posted!'), 'good'); ctx.go('forum', 'p/' + created); }
    }
    async function newSub() {
      const id = h('input.input', { maxlength: 20, placeholder: 'mi_comunidad' }); const title = h('input.input', { maxlength: 40 }); const desc = h('input.input', { maxlength: 160 }); const ic = h('input.input', { maxlength: 4, value: '🌐', style: 'width:70px' }); let made = null;
      const r = await modal({ title: t('New community'), body: h('div.col', { style: 'gap:10px' }, field(t('Name (n/…)'), id), field(t('Title'), title), field(t('Description'), desc), field(t('Emoji'), ic)),
        actions: [{ label: t('Cancel') }, { label: t('Create'), kind: 'primary', onClick: async () => { try { const x = await api.post('/api/forum/subs', { id: id.value, title: title.value, desc: desc.value, icon: ic.value }); made = x.id; return true; } catch (e) { toastErr(e); return false; } } }] });
      if (r && made) { subs = (await api.get('/api/forum/subs')).subs; ctx.go('forum', 'n/' + made); }
    }
    function postRow(p, refresh) {
      return h('article.fr-post', { onClick: (e) => { if (e.target.closest('a,button')) return; ctx.go('forum', 'p/' + p.id); } }, voter(p.score, p.vote, '/api/forum/p/' + p.id + '/vote'),
        h('div.grow', h('div.fr-meta', h('a', { href: '#/forum/n/' + p.sub }, p.subIcon + ' n/' + p.sub), h('span.muted', ' · ' + (p.owner ? '@' + p.owner.username : t('deleted')) + ' · ' + fmt.rel(p.created))),
          h('h3.fr-title', p.title), p.img ? h('img.fr-img', { src: p.img, alt: '', loading: 'lazy' }) : null, p.link ? h('a.fr-link', { href: p.link, target: '_blank', rel: 'noopener noreferrer nofollow' }, icon('external', 13), ' ', p.link.replace(/^https?:\/\//, '').slice(0, 60)) : null,
          p.body ? h('div.fr-body', rich(p.body), p.more ? '…' : null) : null,
          h('div.fr-bar', h('span', icon('chat', 14), ' ' + t('{n} comments', { n: p.comments })), p.canDelete ? h('button.btn.ghost.sm', { onClick: async () => { if (await confirmBox(t('Delete this post?'), { danger: true })) { await api.del('/api/forum/p/' + p.id); refresh(); } } }, icon('trash', 13), t('Delete')) : null)));
    }
    async function list() {
      const sub = mode === 'n' ? arg : ''; const feed = h('div.fr-feed'); const side = h('aside.fr-side');
      const q = new URLSearchParams(navHash().split('?')[1] || '').get('q') || '';
      const load = async () => { mount(feed, loading()); try { const r = await api.get(`/api/forum?sort=${sort}${sub ? '&sub=' + encodeURIComponent(sub) : ''}${q ? '&q=' + encodeURIComponent(q) : ''}`); mount(feed, r.posts.length ? r.posts.map((p) => postRow(p, load)) : emptyState('chat', t('No posts here yet'), t('Start the conversation!'))); } catch (e) { mount(feed, emptyState('alert', t('Could not load this'), e.message)); } };
      const s = sub ? subOf(sub) : null;
      mount(side, h('div.card', s ? [h('div.fr-subhead', h('span.fr-subic', s.icon), h('div', h('b', s.title), h('div.small.muted', 'n/' + s.id))), h('p.small', s.desc), h('div.tiny.muted', t('{n} posts', { n: s.posts || 0 }))] : [h('b', t('Communities')), h('p.small.muted', t('Pick a community or browse everything.'))],
        h('button.btn.primary', { style: 'width:100%;margin-top:10px', onClick: () => newPost(sub) }, icon('plus', 15), t('New post'))),
        h('div.card.fr-subs', subs.map((x) => h('a.fr-sublink' + (x.id === sub ? '.on' : ''), { href: '#/forum/n/' + x.id }, h('span', x.icon), h('span.grow', 'n/' + x.id), h('span.tiny.muted', String(x.posts || 0)))), h('button.btn.ghost.sm', { style: 'width:100%;margin-top:6px', onClick: newSub }, icon('plus', 13), t('Create a community'))));
      mount(inner, h('div.fr-top', h('div.grow', h('h2.fr-logo', h('span', 'Foros'), sub ? h('span.muted', ' · n/' + sub) : null), h('div.small.muted', q ? t('Search: {q}', { q }) : t('Communities, votes and conversations'))),
        sub || q ? h('a.btn.sm', { href: '#/forum' }, icon('back', 14), t('All')) : null, segEl([['hot', '🔥 ' + t('Hot')], ['new', '✨ ' + t('New')], ['top', '🏆 ' + t('Top')]], sort, (v) => { sort = v; load(); })),
        h('div.fr-layout', feed, side));
      load();
    }
    async function thread(id) {
      mount(inner, loading());
      let p; try { p = (await api.get('/api/forum/p/' + id)).post; } catch (e) { mount(inner, emptyState('alert', t('Could not load this'), e.message)); return; }
      const box = h('textarea.input', { rows: 3, maxlength: 2000, placeholder: t('Add a comment…') });
      const send = h('button.btn.primary', { onClick: () => busy(send, async () => { if (!box.value.trim()) return; try { p = (await api.post('/api/forum/p/' + id + '/comment', { text: box.value })).post; box.value = ''; paintThread(); } catch (e) { toastErr(e); } }) }, t('Comment'));
      const tree = h('div.fr-tree');
      const paintThread = () => {
        const kids = new Map(); for (const c of p.thread) { const k = c.parent || ''; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(c); }
        for (const l of kids.values()) l.sort((a, b) => b.score - a.score || a.created - b.created);
        const node = (c, depth) => { const replyBox = h('div'); return h('div.fr-c' + (depth ? '.nested' : ''),
          h('div.fr-chead', c.owner ? avatarEl(c.owner, { size: 22 }) : null, h('b', c.owner ? c.owner.displayName : t('deleted')), h('span.tiny.muted', fmt.rel(c.created))),
          h('div.fr-ctext', rich(c.text)),
          h('div.fr-cbar', voter(c.score, c.vote, `/api/forum/p/${id}/c/${c.id}/vote`, true), depth < 6 ? h('button.btn.ghost.sm', { onClick: () => { if (replyBox.firstChild) { mount(replyBox); return; } const ta = h('textarea.input', { rows: 2, maxlength: 2000 }); const go = h('button.btn.sm.primary', { onClick: () => busy(go, async () => { if (!ta.value.trim()) return; try { p = (await api.post('/api/forum/p/' + id + '/comment', { text: ta.value, parent: c.id })).post; paintThread(); } catch (e) { toastErr(e); } }) }, t('Reply')); mount(replyBox, ta, go); ta.focus(); } }, icon('reply', 13), t('Reply')) : null,
            c.canDelete && c.owner ? h('button.btn.ghost.sm', { onClick: async () => { if (await confirmBox(t('Delete this comment?'), { danger: true })) { p = (await api.del(`/api/forum/p/${id}/c/${c.id}`)).post; paintThread(); } } }, icon('trash', 13)) : null),
          replyBox, (kids.get(c.id) || []).map((k) => node(k, depth + 1))); };
        mount(tree, (kids.get('') || []).length ? kids.get('').map((c) => node(c, 0)) : h('p.muted.small', t('No comments yet. Be the first!')));
      };
      mount(inner, h('a.btn.ghost.sm', { href: '#/forum/n/' + p.sub }, icon('back', 14), 'n/' + p.sub),
        h('article.fr-post.full', voter(p.score, p.vote, '/api/forum/p/' + p.id + '/vote'), h('div.grow', h('div.fr-meta', h('a', { href: '#/forum/n/' + p.sub }, p.subIcon + ' n/' + p.sub), h('span.muted', ' · ' + (p.owner ? '@' + p.owner.username : t('deleted')) + ' · ' + fmt.rel(p.created))),
          h('h2.fr-title', p.title), p.img ? h('img.fr-img.full', { src: p.img, alt: '' }) : null, p.link ? h('a.fr-link', { href: p.link, target: '_blank', rel: 'noopener noreferrer nofollow' }, icon('external', 13), ' ', p.link) : null, p.body ? h('div.fr-body', rich(p.body)) : null,
          p.canDelete ? h('div.fr-bar', h('button.btn.ghost.sm', { onClick: async () => { if (await confirmBox(t('Delete this post?'), { danger: true })) { await api.del('/api/forum/p/' + p.id); ctx.go('forum', 'n/' + p.sub); } } }, icon('trash', 13), t('Delete'))) : null)),
        h('div.card.fr-reply', box, h('div.actions', send)), tree);
      paintThread();
    }
    if (mode === 'p' && arg) thread(arg); else list();
    return () => {};
  },
};

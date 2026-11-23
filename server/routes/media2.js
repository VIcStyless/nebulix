'use strict';
// Nebulix 9.2: reviews (1–5 stars with text, helpful votes and a reply from the creator) for everything in
// Nebulix Hub, screenshots for games and apps, clips linked to a game, and new-upload alerts for subscribers.
const { S, hub: wsHub, publicUser, isStaff } = require('../state');
const { HttpError, rid, now } = require('../util');

const T = (n) => S.store.table(n);
const reviews = () => T('hubreviews');
const H = () => require('./hub').internals;
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f‪-‮⁦-⁩]/g, '').trim().slice(0, n);
const itemOr404 = (id, u) => { const it = H().items()[id]; if (!it || (it.public === false && (!u || it.owner !== u.id))) throw new HttpError(404, 'no_item', 'Not found'); return it; };
const revView = (r, me, it) => ({ id: r.id, owner: S.users[r.owner] ? publicUser(S.users[r.owner]) : null, stars: r.stars, text: r.text, created: r.created, edited: r.edited || 0, helpful: (r.helpful || []).length, voted: !!(me && (r.helpful || []).includes(me.id)), mine: !!(me && me.id === r.owner), reply: r.reply || null, canReply: !!(me && it && it.owner === me.id) });

// followers get a notice when someone they follow publishes something public
function onPublish(it, u) {
  if (it.public === false || !['video', 'clip', 'game', 'app'].includes(it.kind)) return;
  const ids = require('./media').followersOf(u.id).slice(0, 2000);
  const what = { video: ['a new video', 'un vídeo nuevo'], clip: ['a new clip', 'un clip nuevo'], game: ['a new game', 'un juego nuevo'], app: ['a new app', 'una app nueva'] }[it.kind];
  if (ids.length) wsHub.pushMany(ids, { t: 'notice', text: `🔔 @${u.username} uploaded ${what[0]}: “${it.title}”`, es: `🔔 @${u.username} ha subido ${what[1]}: «${it.title}»`, link: it.kind === 'video' ? '/tv/w/' + it.id : it.kind === 'clip' ? '/clips/v/' + it.id : '/hub/' + it.id });
}

module.exports = function register(r) {
  // ---- reviews ----
  r.get('/api/hub/:id/reviews', { auth: true, limit: [120, 60000, 'user'] }, async (c) => {
    const it = itemOr404(c.params.id, c.user); const list = (reviews()[it.id] || []).slice();
    const sort = String(c.query.sort || 'helpful');
    list.sort((a, b) => (sort === 'new' ? b.created - a.created : sort === 'high' ? b.stars - a.stars || b.created - a.created : sort === 'low' ? a.stars - b.stars || b.created - a.created : (b.helpful || []).length - (a.helpful || []).length || b.created - a.created));
    const dist = [0, 0, 0, 0, 0]; for (const x of list) dist[x.stars - 1]++;
    const mine = list.find((x) => x.owner === c.user.id);
    return { rating: H().ratingOf(it.id), dist, mine: mine ? revView(mine, c.user, it) : null, canReview: it.owner !== c.user.id, items: list.slice(0, 200).map((x) => revView(x, c.user, it)) };
  });
  r.put('/api/hub/:id/reviews', { auth: true, verified: true, limit: [20, 600000, 'user'] }, async (c) => {
    const it = itemOr404(c.params.id, c.user); if (it.owner === c.user.id) throw new HttpError(400, 'own', 'You cannot review your own upload');
    const stars = Math.trunc(Number(c.body.stars)); if (!(stars >= 1 && stars <= 5)) throw new HttpError(400, 'bad_stars', 'Pick 1 to 5 stars');
    const text = clean(c.body.text, 1500);
    const all = reviews(); const list = (all[it.id] = all[it.id] || []); let rv = list.find((x) => x.owner === c.user.id);
    if (rv) { rv.stars = stars; rv.text = text; rv.edited = now(); } else { if (list.length >= 5000) throw new HttpError(400, 'full', 'Too many reviews'); rv = { id: rid(8), owner: c.user.id, stars, text, created: now(), helpful: [] }; list.push(rv); if (it.owner !== c.user.id) wsHub.push(it.owner, { t: 'notice', text: `⭐ @${c.user.username} rated “${it.title}” ${stars}/5`, es: `⭐ @${c.user.username} ha valorado «${it.title}» con ${stars}/5` }); }
    S.store.touch('hubreviews'); return { review: revView(rv, c.user, it), rating: H().ratingOf(it.id) };
  });
  r.delete('/api/hub/:id/reviews/:rid', { auth: true, verified: true }, async (c) => {
    const it = itemOr404(c.params.id, c.user); const list = reviews()[it.id] || []; const i = list.findIndex((x) => x.id === c.params.rid);
    if (i < 0 || !(list[i].owner === c.user.id || isStaff(c.user))) throw new HttpError(404, 'no_review', 'Not found');
    list.splice(i, 1); S.store.touch('hubreviews'); return { ok: true, rating: H().ratingOf(it.id) };
  });
  r.post('/api/hub/:id/reviews/:rid/helpful', { auth: true, verified: true, limit: [120, 60000, 'user'] }, async (c) => {
    const it = itemOr404(c.params.id, c.user); const rv = (reviews()[it.id] || []).find((x) => x.id === c.params.rid); if (!rv) throw new HttpError(404, 'no_review', 'Not found');
    if (rv.owner === c.user.id) throw new HttpError(400, 'own', 'You cannot vote on your own review');
    rv.helpful = rv.helpful || []; const i = rv.helpful.indexOf(c.user.id); if (i >= 0) rv.helpful.splice(i, 1); else rv.helpful.push(c.user.id); S.store.touch('hubreviews');
    return { voted: i < 0, helpful: rv.helpful.length };
  });
  r.post('/api/hub/:id/reviews/:rid/reply', { auth: true, verified: true, limit: [30, 60000, 'user'] }, async (c) => {
    const it = itemOr404(c.params.id, c.user); if (it.owner !== c.user.id) throw new HttpError(403, 'forbidden', 'Only the creator can reply');
    const rv = (reviews()[it.id] || []).find((x) => x.id === c.params.rid); if (!rv) throw new HttpError(404, 'no_review', 'Not found');
    const text = clean(c.body.text, 800); rv.reply = text ? { text, at: now() } : null; S.store.touch('hubreviews');
    if (text) wsHub.push(rv.owner, { t: 'notice', text: `💬 The creator of “${it.title}” replied to your review`, es: `💬 El creador de «${it.title}» ha respondido a tu reseña` });
    return { reply: rv.reply };
  });

  // ---- screenshots (up to 8) ----
  r.post('/api/hub/:id/shots', { auth: true, verified: true, limit: [40, 3600000, 'user'] }, async (c) => {
    const it = H().items()[c.params.id]; if (!it || it.owner !== c.user.id) throw new HttpError(404, 'no_item', 'Not found');
    const th = H().pending.get(String(c.body.upload || '')); if (!th || th.uid !== c.user.id || th.kind !== 'thumb') throw new HttpError(400, 'no_upload', 'Upload the image first');
    it.shots = it.shots || []; if (it.shots.length >= 8) throw new HttpError(400, 'too_many', 'Up to 8 screenshots');
    it.shots.push(th.sha); H().pending.delete(c.body.upload); H().touch(); return { item: H().view(it, c.user) };
  });
  r.delete('/api/hub/:id/shots/:n', { auth: true, verified: true }, async (c) => {
    const it = H().items()[c.params.id]; if (!it || it.owner !== c.user.id) throw new HttpError(404, 'no_item', 'Not found');
    const n = Number(c.params.n); if (!it.shots || !it.shots[n]) throw new HttpError(404, 'no_shot', 'Not found'); it.shots.splice(n, 1); H().touch(); return { item: H().view(it, c.user) };
  });

  // ---- clips of a game ----
  r.get('/api/hub/:id/clips', { auth: true, limit: [120, 60000, 'user'] }, async (c) => {
    const it = itemOr404(c.params.id, c.user);
    const list = Object.values(H().items()).filter((x) => x.kind === 'clip' && x.game === it.id && (x.public !== false || x.owner === c.user.id)).sort((a, b) => ((b.likes || []).length * 5 + (b.views || 0)) - ((a.likes || []).length * 5 + (a.views || 0)));
    return { items: list.slice(0, 40).map((x) => H().view(x, c.user)) };
  });

  // ---- video chapters (set by the creator: "0:00 Intro" lines) ----
  r.put('/api/hub/:id/chapters', { auth: true, verified: true, limit: [30, 600000, 'user'] }, async (c) => {
    const it = H().items()[c.params.id]; if (!it || it.owner !== c.user.id || it.kind !== 'video') throw new HttpError(404, 'no_item', 'Not found');
    const list = (Array.isArray(c.body.chapters) ? c.body.chapters : []).map((x) => ({ t: Math.max(0, Math.round(Number(x.t) || 0)), n: clean(x.n, 60) })).filter((x) => x.n).sort((a, b) => a.t - b.t).slice(0, 50);
    it.chapters = list.length ? list : null; H().touch(); return { chapters: it.chapters };
  });
};
module.exports.onPublish = onPublish;

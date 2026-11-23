'use strict';
// More original Nebulix social networks (they share the Echo follow graph):
//   Lens   — a photo network: square photo posts with filters, likes, comments, profile grids and 24-hour stories
//   Foros  — communities (n/name) with posts, up/down votes, hot/new/top sorting and threaded comments
// Images go through /api/hub/upload like Echo images.
const { S, publicUser, isStaff, hub: wsHub } = require('../state');
const blobs = require('../blobs');
const hubMod = require('./hub');
const prog = require('../progress');
const { HttpError, now, rid } = require('../util');

const T = (n) => S.store.table(n);
const lens = () => T('lens'); const stories = () => T('stories'); const forum = () => T('forum'); const fsubs = () => T('forumsubs');
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f‪-‮⁦-⁩]/g, '').replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, n);
const notify = (uid, from, text) => { if (uid && from && uid !== from.id) wsHub.push(uid, { t: 'notice', text }); };
const userByName = (n) => { const id = S.byName.get(String(n || '').replace(/^@/, '').toLowerCase()); const u = id && S.users[id]; return u && !u.deleted ? u : null; };
const followingOf = (uid) => (T('follows')[uid] || []);
const followers = (uid) => { let n = 0; for (const l of Object.values(T('follows'))) if (l.includes(uid)) n++; return n; };
const FILTERS = ['none', 'vivid', 'warm', 'cool', 'mono', 'fade', 'noir', 'dream', 'retro'];
const TAG_RE = /(^|[^\p{L}\p{N}_])#([\p{L}\p{N}_]{2,32})/gu;
const DAY = 86400000;
function takeImg(me, id) { const img = hubMod.take(String(id || ''), me.id, 'thumb'); if (!img) throw new HttpError(400, 'no_upload', 'Upload the image again'); blobs.charge(me, img.size); return img; }

// ---------------- Lens ----------------
function lensView(p, me) {
  const o = S.users[p.owner]; if (!o || o.deleted) return null;
  return { id: p.id, owner: publicUser(o), img: `/x/lens/i/${p.id}`, caption: p.caption, filter: p.filter || 'none', created: p.created, likes: p.likes.length, liked: p.likes.includes(me.id), comments: (p.comments || []).length, tags: p.tags || [], mine: p.owner === me.id };
}
function storyGroups(me) {
  const t = now(); const all = Object.values(stories()).filter((s) => t - s.created < DAY);
  const f = new Set(followingOf(me.id)); const by = new Map();
  for (const s of all.sort((a, b) => a.created - b.created)) { if (!by.has(s.owner)) by.set(s.owner, []); by.get(s.owner).push(s); }
  const rows = [];
  for (const [uid, list] of by) { const o = S.users[uid]; if (!o || o.deleted) continue; rows.push({ user: publicUser(o), mine: uid === me.id, following: f.has(uid), seen: list.every((s) => (s.views || []).includes(me.id)), items: list.map((s) => ({ id: s.id, img: s.img ? `/x/lens/s/${s.id}` : null, text: s.text, color: s.color, created: s.created, views: uid === me.id ? (s.views || []).length : undefined })) }); }
  return rows.sort((a, b) => (b.mine - a.mine) || (b.following - a.following) || (a.seen - b.seen) || (b.items[b.items.length - 1].created - a.items[a.items.length - 1].created)).slice(0, 60);
}

// ---------------- Foros ----------------
const DEFAULT_SUBS = [['general', 'General', 'Anything goes', '💬'], ['gaming', 'Gaming', 'Games, clips and high scores', '🎮'], ['memes', 'Memes', 'Make Nebulix laugh', '😂'], ['tech', 'Tech', 'Code, gadgets and the internet', '💻'], ['music', 'Music', 'Share what you are listening to', '🎵'], ['economy', 'Economy', 'Casino, investing and the coin economy', '📈'], ['art', 'Art', 'Drawings, photos and creations', '🎨'], ['help', 'Help', 'Questions about Nebulix', '🛟']];
function subsList() { const own = fsubs(); const out = DEFAULT_SUBS.map(([id, title, desc, icon]) => ({ id, title, desc, icon, official: true })); for (const s of Object.values(own)) out.push({ id: s.id, title: s.title, desc: s.desc, icon: s.icon || '🌐', owner: s.owner }); return out; }
const subExists = (id) => DEFAULT_SUBS.some((s) => s[0] === id) || !!fsubs()[id];
const scoreOf = (x) => (x.up || []).length - (x.down || []).length;
const hot = (p) => { const s = scoreOf(p); const hrs = (now() - p.created) / 3600000; return (s + (p.comments || []).length * 0.5 + 1) / Math.pow(hrs + 2, 1.4); };
function postView(p, me, full) {
  const o = S.users[p.owner]; const sub = subsList().find((s) => s.id === p.sub);
  const v = { id: p.id, sub: p.sub, subIcon: sub ? sub.icon : '🌐', title: p.title, body: full ? p.body : p.body.slice(0, 280), more: !full && p.body.length > 280, img: p.img ? `/x/forum/i/${p.id}` : null, link: p.link || null, owner: o && !o.deleted ? publicUser(o) : null, created: p.created, score: scoreOf(p), vote: (p.up || []).includes(me.id) ? 1 : (p.down || []).includes(me.id) ? -1 : 0, comments: (p.comments || []).length, mine: p.owner === me.id, canDelete: p.owner === me.id || isStaff(me) };
  if (full) v.thread = (p.comments || []).map((c) => { const co = S.users[c.owner]; return { id: c.id, parent: c.parent || null, text: c.text, created: c.created, owner: co && !co.deleted ? publicUser(co) : null, score: scoreOf(c), vote: (c.up || []).includes(me.id) ? 1 : (c.down || []).includes(me.id) ? -1 : 0, canDelete: c.owner === me.id || isStaff(me) }; });
  return v;
}
function vote(x, uid, v) { x.up = (x.up || []).filter((i) => i !== uid); x.down = (x.down || []).filter((i) => i !== uid); if (v === 1) x.up.push(uid); else if (v === -1) x.down.push(uid); }

module.exports = function register(r) {
  const W = (n, ms = 60000) => ({ auth: true, verified: true, limit: [n, ms, 'user'] });
  const R = { auth: true, limit: [120, 60000, 'user'] };
  // ---- Lens ----
  r.get('/api/lens', R, async (c) => {
    const me = c.user; const feed = String(c.query.feed || 'for'); let list = Object.values(lens());
    if (feed === 'following') { const f = new Set(followingOf(me.id)); f.add(me.id); list = list.filter((p) => f.has(p.owner)); }
    else if (feed === 'user') { const u = userByName(c.query.u); if (!u) throw new HttpError(404, 'no_user', 'User not found'); list = list.filter((p) => p.owner === u.id); }
    else if (feed === 'tag') { const tg = String(c.query.tag || '').toLowerCase(); list = list.filter((p) => (p.tags || []).includes(tg)); }
    if (feed === 'for') { const t = now(); list.sort((a, b) => (b.likes.length * 3 + (b.comments || []).length * 2 + 20) / Math.pow((t - b.created) / 3600000 + 2, 1.2) - (a.likes.length * 3 + (a.comments || []).length * 2 + 20) / Math.pow((t - a.created) / 3600000 + 2, 1.2)); }
    else list.sort((a, b) => b.created - a.created);
    return { posts: list.slice(0, 90).map((p) => lensView(p, me)).filter(Boolean), stories: feed === 'user' ? undefined : storyGroups(me), filters: FILTERS };
  });
  r.get('/api/lens/u/:name', R, async (c) => {
    const me = c.user; const u = userByName(c.params.name); if (!u) throw new HttpError(404, 'no_user', 'User not found');
    const posts = Object.values(lens()).filter((p) => p.owner === u.id).sort((a, b) => b.created - a.created);
    return { user: publicUser(u), bio: (u.bio || '').slice(0, 300), posts: posts.map((p) => lensView(p, me)), count: posts.length, followers: followers(u.id), following: followingOf(u.id).length, isFollowing: followingOf(me.id).includes(u.id), likes: posts.reduce((a, p) => a + p.likes.length, 0) };
  });
  r.post('/api/lens', W(20, 600000), async (c) => {
    const me = c.user; if (!c.body.img) throw new HttpError(400, 'no_img', 'Choose a photo first');
    const img = takeImg(me, c.body.img); const caption = clean(c.body.caption, 600);
    const p = { id: rid(9), owner: me.id, img: img.sha, imgType: blobs.typeOf(img.name), imgSize: img.size, caption, filter: FILTERS.includes(c.body.filter) ? c.body.filter : 'none', created: now(), likes: [], comments: [], tags: [...new Set([...caption.matchAll(TAG_RE)].map((m) => m[2].toLowerCase()))].slice(0, 10) };
    lens()[p.id] = p; S.store.touch('lens'); prog.award(me, 'social');
    return { post: lensView(p, me) };
  });
  r.post('/api/lens/:id/like', W(120), async (c) => {
    const p = lens()[c.params.id]; if (!p) throw new HttpError(404, 'no_post', 'Not found'); const i = p.likes.indexOf(c.user.id);
    if (i >= 0) p.likes.splice(i, 1); else { p.likes.push(c.user.id); notify(p.owner, c.user, `@${c.user.username} liked your Lens photo`); }
    S.store.touch('lens'); return { liked: i < 0, likes: p.likes.length };
  });
  r.get('/api/lens/:id/comments', R, async (c) => {
    const p = lens()[c.params.id]; if (!p) throw new HttpError(404, 'no_post', 'Not found');
    return { post: lensView(p, c.user), comments: (p.comments || []).map((x) => { const o = S.users[x.owner]; return o && !o.deleted ? { id: x.id, text: x.text, created: x.created, owner: publicUser(o), mine: x.owner === c.user.id || isStaff(c.user) } : null; }).filter(Boolean) };
  });
  r.post('/api/lens/:id/comments', W(30), async (c) => {
    const p = lens()[c.params.id]; if (!p) throw new HttpError(404, 'no_post', 'Not found'); const text = clean(c.body.text, 400); if (!text) throw new HttpError(400, 'empty', 'Write something first');
    p.comments = p.comments || []; if (p.comments.length >= 500) throw new HttpError(400, 'full', 'Too many comments');
    p.comments.push({ id: rid(6), owner: c.user.id, text, created: now() }); S.store.touch('lens'); notify(p.owner, c.user, `@${c.user.username} commented on your photo: “${text.slice(0, 50)}”`);
    return { ok: true, comments: p.comments.length };
  });
  r.delete('/api/lens/:id/comments/:cid', W(30), async (c) => {
    const p = lens()[c.params.id]; if (!p) throw new HttpError(404, 'no_post', 'Not found'); const i = (p.comments || []).findIndex((x) => x.id === c.params.cid);
    if (i < 0 || (p.comments[i].owner !== c.user.id && p.owner !== c.user.id && !isStaff(c.user))) throw new HttpError(404, 'no_comment', 'Not found');
    p.comments.splice(i, 1); S.store.touch('lens'); return { ok: true };
  });
  r.delete('/api/lens/:id', W(30), async (c) => {
    const p = lens()[c.params.id]; if (!p || (p.owner !== c.user.id && !isStaff(c.user))) throw new HttpError(404, 'no_post', 'Not found');
    const o = S.users[p.owner]; if (o) blobs.charge(o, -(p.imgSize || 0)); delete lens()[p.id]; S.store.touch('lens'); return { ok: true };
  });
  r.get('/x/lens/i/:id', {}, async (c) => { const p = lens()[c.params.id]; if (!p) throw new HttpError(404, 'no_img', 'Not found'); blobs.send(c.req, c.res, p.img, { type: /^image\//.test(p.imgType || '') ? p.imgType : 'image/jpeg', name: 'lens', inline: true, maxAge: 604800 }); });
  // stories (24 h)
  r.post('/api/lens/stories', W(20, 600000), async (c) => {
    const me = c.user; const text = clean(c.body.text, 160); let img = null; if (c.body.img) img = takeImg(me, c.body.img);
    if (!img && !text) throw new HttpError(400, 'empty', 'Add a photo or some text');
    const color = /^#[0-9a-f]{6}$/i.test(c.body.color || '') ? c.body.color : '#7c5cff';
    const all = stories(); const t = now(); for (const [id, s] of Object.entries(all)) if (t - s.created > DAY * 2) { const o = S.users[s.owner]; if (o && s.imgSize) blobs.charge(o, -s.imgSize); delete all[id]; }
    const s = { id: rid(9), owner: me.id, text, color, created: t, views: [] }; if (img) { s.img = img.sha; s.imgType = blobs.typeOf(img.name); s.imgSize = img.size; }
    all[s.id] = s; S.store.touch('stories'); prog.award(me, 'social'); return { ok: true, stories: storyGroups(me) };
  });
  r.post('/api/lens/stories/:id/view', { auth: true, limit: [300, 60000, 'user'] }, async (c) => { const s = stories()[c.params.id]; if (s && s.owner !== c.user.id) { s.views = s.views || []; if (!s.views.includes(c.user.id)) { s.views.push(c.user.id); S.store.touch('stories'); } } return { ok: true }; });
  r.delete('/api/lens/stories/:id', W(30), async (c) => { const s = stories()[c.params.id]; if (!s || (s.owner !== c.user.id && !isStaff(c.user))) throw new HttpError(404, 'no_story', 'Not found'); const o = S.users[s.owner]; if (o && s.imgSize) blobs.charge(o, -s.imgSize); delete stories()[s.id]; S.store.touch('stories'); return { ok: true }; });
  r.get('/x/lens/s/:id', {}, async (c) => { const s = stories()[c.params.id]; if (!s || !s.img) throw new HttpError(404, 'no_img', 'Not found'); blobs.send(c.req, c.res, s.img, { type: /^image\//.test(s.imgType || '') ? s.imgType : 'image/jpeg', name: 'story', inline: true, maxAge: 86400 }); });

  // ---- Foros ----
  r.get('/api/forum/subs', R, async () => {
    const counts = {}; for (const p of Object.values(forum())) counts[p.sub] = (counts[p.sub] || 0) + 1;
    return { subs: subsList().map((s) => Object.assign(s, { posts: counts[s.id] || 0 })) };
  });
  r.post('/api/forum/subs', W(5, 3600000), async (c) => {
    const id = String(c.body.id || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20); if (id.length < 3) throw new HttpError(400, 'bad_name', 'Use 3-20 letters, numbers or _');
    if (subExists(id)) throw new HttpError(400, 'taken', 'That community already exists');
    if (Object.values(fsubs()).filter((s) => s.owner === c.user.id).length >= 3 && !isStaff(c.user)) throw new HttpError(400, 'too_many', 'You can create up to 3 communities');
    fsubs()[id] = { id, title: clean(c.body.title, 40) || id, desc: clean(c.body.desc, 160), icon: clean(c.body.icon, 4) || '🌐', owner: c.user.id, created: now() }; S.store.touch('forumsubs');
    return { ok: true, id };
  });
  r.get('/api/forum', R, async (c) => {
    const me = c.user; const sub = String(c.query.sub || ''); const sort = ['hot', 'new', 'top'].includes(c.query.sort) ? c.query.sort : 'hot';
    let list = Object.values(forum()); if (sub) list = list.filter((p) => p.sub === sub);
    const q = String(c.query.q || '').toLowerCase().slice(0, 60); if (q) list = list.filter((p) => p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q));
    if (sort === 'new') list.sort((a, b) => b.created - a.created); else if (sort === 'top') list.sort((a, b) => scoreOf(b) - scoreOf(a) || b.created - a.created); else list.sort((a, b) => hot(b) - hot(a));
    return { posts: list.slice(0, 80).map((p) => postView(p, me, false)), sub: sub ? subsList().find((s) => s.id === sub) || null : null };
  });
  r.get('/api/forum/p/:id', R, async (c) => { const p = forum()[c.params.id]; if (!p) throw new HttpError(404, 'no_post', 'This post was deleted'); return { post: postView(p, c.user, true) }; });
  r.post('/api/forum', W(10, 600000), async (c) => {
    const me = c.user; const sub = String(c.body.sub || ''); if (!subExists(sub)) throw new HttpError(404, 'no_sub', 'Pick a community');
    const title = clean(c.body.title, 140); if (title.length < 3) throw new HttpError(400, 'no_title', 'Write a title');
    const p = { id: rid(9), sub, owner: me.id, title, body: clean(c.body.body, 6000), created: now(), up: [me.id], down: [], comments: [] };
    const link = String(c.body.link || '').trim(); if (link) { if (!/^https?:\/\/[^\s]{3,300}$/i.test(link)) throw new HttpError(400, 'bad_link', 'Links must start with http:// or https://'); p.link = link; }
    if (c.body.img) { const img = takeImg(me, c.body.img); p.img = img.sha; p.imgType = blobs.typeOf(img.name); p.imgSize = img.size; }
    forum()[p.id] = p; S.store.touch('forum'); prog.award(me, 'social');
    return { post: postView(p, me, true) };
  });
  r.post('/api/forum/p/:id/vote', W(200), async (c) => {
    const p = forum()[c.params.id]; if (!p) throw new HttpError(404, 'no_post', 'Not found'); const v = Math.sign(Number(c.body.v) || 0);
    vote(p, c.user.id, v); S.store.touch('forum'); return { score: scoreOf(p), vote: v };
  });
  r.post('/api/forum/p/:id/comment', W(30), async (c) => {
    const p = forum()[c.params.id]; if (!p) throw new HttpError(404, 'no_post', 'Not found'); const text = clean(c.body.text, 2000); if (!text) throw new HttpError(400, 'empty', 'Write something first');
    p.comments = p.comments || []; if (p.comments.length >= 800) throw new HttpError(400, 'full', 'This thread is full');
    const parent = c.body.parent ? p.comments.find((x) => x.id === String(c.body.parent)) : null;
    p.comments.push({ id: rid(6), owner: c.user.id, text, created: now(), parent: parent ? parent.id : null, up: [c.user.id], down: [] }); S.store.touch('forum');
    notify(parent ? parent.owner : p.owner, c.user, parent ? `@${c.user.username} replied to your comment in Foros` : `@${c.user.username} commented on “${p.title.slice(0, 40)}”`);
    return { post: postView(p, c.user, true) };
  });
  r.post('/api/forum/p/:id/c/:cid/vote', W(200), async (c) => {
    const p = forum()[c.params.id]; const cm = p && (p.comments || []).find((x) => x.id === c.params.cid); if (!cm) throw new HttpError(404, 'no_comment', 'Not found');
    const v = Math.sign(Number(c.body.v) || 0); vote(cm, c.user.id, v); S.store.touch('forum'); return { score: scoreOf(cm), vote: v };
  });
  r.delete('/api/forum/p/:id/c/:cid', W(30), async (c) => {
    const p = forum()[c.params.id]; const cm = p && (p.comments || []).find((x) => x.id === c.params.cid); if (!cm || (cm.owner !== c.user.id && !isStaff(c.user))) throw new HttpError(404, 'no_comment', 'Not found');
    cm.text = '[deleted]'; cm.owner = null; S.store.touch('forum'); return { post: postView(p, c.user, true) };
  });
  r.delete('/api/forum/p/:id', W(30), async (c) => {
    const p = forum()[c.params.id]; if (!p || (p.owner !== c.user.id && !isStaff(c.user))) throw new HttpError(404, 'no_post', 'Not found');
    const o = S.users[p.owner]; if (o && p.imgSize) blobs.charge(o, -p.imgSize); delete forum()[p.id]; S.store.touch('forum'); return { ok: true };
  });
  r.get('/x/forum/i/:id', {}, async (c) => { const p = forum()[c.params.id]; if (!p || !p.img) throw new HttpError(404, 'no_img', 'Not found'); blobs.send(c.req, c.res, p.img, { type: /^image\//.test(p.imgType || '') ? p.imgType : 'image/jpeg', name: 'forum', inline: true, maxAge: 604800 }); });
};

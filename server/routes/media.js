'use strict';
// Nebulix community media (all original Nebulix services):
//   Echo        — short public posts with images, replies, reposts, quotes, likes, #tags and @mentions
//   Clips       — vertical short videos in a full-screen swipe feed
//   Nebulix TV  — channels for long videos, with subscriptions and comments
// One follow graph is shared by the three (following someone on Echo = subscribing to their channel).
// Videos and clips are Hub items, uploaded through /api/hub/upload like any other Hub video.
const { S, publicUser, isStaff, hub: wsHub } = require('../state');
const blobs = require('../blobs');
const hubMod = require('./hub');
const { HttpError, now, rid } = require('../util');

const T = (n) => S.store.table(n);
const echoes = () => T('echoes'); const follows = () => T('follows'); const comments = () => T('comments');
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f‪-‮⁦-⁩]/g, '').replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, n);
const MAX_ECHO = 500;
const seenAt = new Map(); // `${item}:${user}` → time of the last counted view
const countView = (it, uid) => { const k = it.id + ':' + uid; const t0 = Date.now(); if (t0 - (seenAt.get(k) || 0) < 6 * 3600000) return false; seenAt.set(k, t0); if (seenAt.size > 200000) seenAt.clear(); it.views = (it.views || 0) + 1; S.store.touch('hubitems'); return true; };
const notify = (uid, from, text) => { if (uid && from && uid !== from.id) wsHub.push(uid, { t: 'notice', text }); };
const userByName = (n) => { const id = S.byName.get(String(n || '').replace(/^@/, '').toLowerCase()); const u = id && S.users[id]; return u && !u.deleted ? u : null; };

// ---------------- follow graph ----------------
const followingOf = (uid) => follows()[uid] || [];
function followerCount(uid) { let n = 0; for (const list of Object.values(follows())) if (list.includes(uid)) n++; return n; }
function toggleFollow(me, target) {
  if (target.id === me.id) throw new HttpError(400, 'self', 'You cannot follow yourself');
  const f = follows(); const list = f[me.id] = f[me.id] || []; const i = list.indexOf(target.id);
  if (i >= 0) list.splice(i, 1); else { if (list.length >= 2000) throw new HttpError(400, 'too_many', 'You follow too many people'); list.push(target.id); notify(target.id, me, `@${me.username} started following you`); }
  S.store.touch('follows'); return i < 0;
}

// ---------------- Echo ----------------
const TAG_RE = /(^|[^\p{L}\p{N}_])#([\p{L}\p{N}_]{2,32})/gu;
const MENTION_RE = /(^|[^\p{L}\p{N}_])@([A-Za-z0-9_.]{2,24})/g;
function counts() { // replies / reposts per echo, computed once per request
  const rep = new Map(); const rp = new Map(); const q = new Map();
  for (const e of Object.values(echoes())) { if (e.reply) rep.set(e.reply, (rep.get(e.reply) || 0) + 1); if (e.repost) rp.set(e.repost, (rp.get(e.repost) || 0) + 1); if (e.quote) q.set(e.quote, (q.get(e.quote) || 0) + 1); }
  return { rep, rp, q };
}
function echoView(e, me, cn, depth = 0) {
  if (!e) return null; const o = S.users[e.owner]; if (!o) return null;
  if (e.repost) { const orig = echoes()[e.repost]; if (!orig) return null; return { id: e.id, repostedBy: publicUser(o), created: e.created, post: echoView(orig, me, cn, depth) }; }
  const all = echoes();
  return {
    id: e.id, owner: publicUser(o), text: e.text, img: e.img ? `/x/echo/i/${e.id}` : null, created: e.created, edited: e.edited || null,
    likes: (e.likes || []).length, liked: !!(me && (e.likes || []).includes(me.id)),
    replies: cn.rep.get(e.id) || 0, reposts: (cn.rp.get(e.id) || 0) + (cn.q.get(e.id) || 0),
    reposted: !!(me && Object.values(all).some((x) => x.repost === e.id && x.owner === me.id)),
    replyTo: e.reply ? (() => { const p = all[e.reply]; const pu = p && S.users[p.owner]; return { id: e.reply, username: pu ? pu.username : null }; })() : null,
    quote: e.quote && depth < 1 ? (echoView(all[e.quote], me, cn, depth + 1) || { gone: true }) : null,
    mine: !!(me && me.id === e.owner), canDelete: !!(me && (me.id === e.owner || isStaff(me))), views: e.views || 0,
  };
}
const score = (e, cn, t) => ((e.likes || []).length * 2 + (cn.rp.get(e.id) || 0) * 3 + (cn.rep.get(e.id) || 0) * 2 + 1) / Math.pow((t - e.created) / 3600000 + 2, 1.35);

// ---------------- comments (on Hub videos and clips) ----------------
function commentView(c, me) { const o = S.users[c.owner]; return { id: c.id, owner: publicUser(o), text: c.text, created: c.created, reply: c.reply || null, likes: (c.likes || []).length, liked: !!(me && (c.likes || []).includes(me.id)), mine: !!(me && me.id === c.owner), pinned: !!c.pin, heart: !!c.heart, edited: c.edited || 0 }; }
const commentCount = (id) => (comments()[id] || []).length;

module.exports = function register(r) {
  // ---- follow / creator profile ----
  r.post('/api/follow/:name', { auth: true, verified: true, limit: [60, 60000, 'user'] }, async (c) => {
    const u = userByName(c.params.name); if (!u) throw new HttpError(404, 'no_user', 'User not found');
    const on = toggleFollow(c.user, u); return { following: on, followers: followerCount(u.id) };
  });
  r.get('/api/creator/:name', { auth: true, limit: [120, 60000, 'user'] }, async (c) => {
    const u = userByName(c.params.name); if (!u) throw new HttpError(404, 'no_user', 'User not found');
    const mine = u.id === c.user.id; const its = Object.values(hubMod.items()).filter((x) => x.owner === u.id && (x.public !== false || mine)).sort((a, b) => b.created - a.created);
    const vids = its.filter((x) => x.kind === 'video'); const clips = its.filter((x) => x.kind === 'clip');
    return {
      user: publicUser(u), followers: followerCount(u.id), following: followingOf(u.id).length, isFollowing: followingOf(c.user.id).includes(u.id), me: mine,
      totals: { echoes: Object.values(echoes()).filter((e) => e.owner === u.id && !e.repost).length, videos: vids.length, clips: clips.length, views: its.reduce((s, x) => s + (x.views || 0), 0) },
      videos: vids.slice(0, 60).map((x) => Object.assign(hubMod.view(x, c.user), { comments: commentCount(x.id) })),
      clips: clips.slice(0, 60).map((x) => Object.assign(hubMod.view(x, c.user), { comments: commentCount(x.id) })),
    };
  });

  // ---- Echo ----
  r.get('/api/echo', { auth: true, limit: [120, 60000, 'user'] }, async (c) => {
    const me = c.user; const tab = String(c.query.tab || 'foryou'); const before = Number(c.query.before) || Infinity; const q = clean(c.query.q, 60).toLowerCase(); const t = now(); const cn = counts();
    let list = Object.values(echoes());
    if (tab === 'following') { const f = new Set([...followingOf(me.id), me.id]); list = list.filter((e) => f.has(e.owner) && !e.reply); }
    else if (tab.startsWith('user:')) { const u = userByName(tab.slice(5)); if (!u) throw new HttpError(404, 'no_user', 'User not found'); const withReplies = c.query.replies === '1'; list = list.filter((e) => e.owner === u.id && (withReplies || !e.reply)); }
    else if (tab.startsWith('likes:')) { const u = userByName(tab.slice(6)); if (!u) throw new HttpError(404, 'no_user', 'User not found'); list = list.filter((e) => !e.repost && (e.likes || []).includes(u.id)); }
    else if (tab.startsWith('tag:')) { const tg = tab.slice(4).toLowerCase(); list = list.filter((e) => !e.repost && (e.tags || []).includes(tg)); }
    else if (tab === 'search') { list = q ? list.filter((e) => !e.repost && ((e.text || '').toLowerCase().includes(q) || ((S.users[e.owner] || {}).username || '').toLowerCase().includes(q))) : []; }
    else { // for you: best recent posts (last 14 days) ranked, then everything else newest first
      list = list.filter((e) => !e.reply && !e.repost);
      const recent = list.filter((e) => t - e.created < 14 * 86400000).sort((a, b) => score(b, cn, t) - score(a, cn, t));
      const rest = list.filter((e) => t - e.created >= 14 * 86400000).sort((a, b) => b.created - a.created);
      const page = Math.max(0, Number(c.query.page) || 0); const all = [...recent, ...rest];
      return { items: all.slice(page * 40, page * 40 + 40).map((e) => echoView(e, me, cn)).filter(Boolean), more: all.length > page * 40 + 40 };
    }
    list = list.filter((e) => e.created < before).sort((a, b) => b.created - a.created);
    return { items: list.slice(0, 40).map((e) => echoView(e, me, cn)).filter(Boolean), more: list.length > 40 };
  });
  r.get('/api/echo/side', { auth: true, limit: [60, 60000, 'user'] }, async (c) => {
    const t = now(); const tags = new Map();
    for (const e of Object.values(echoes())) if (t - e.created < 7 * 86400000) for (const tg of e.tags || []) tags.set(tg, (tags.get(tg) || 0) + 1);
    const mine = new Set([...followingOf(c.user.id), c.user.id]); const fc = new Map();
    for (const list of Object.values(follows())) for (const id of list) fc.set(id, (fc.get(id) || 0) + 1);
    const active = new Map(); for (const e of Object.values(echoes())) active.set(e.owner, (active.get(e.owner) || 0) + 1);
    const who = Object.values(S.users).filter((u) => !u.deleted && !mine.has(u.id) && (active.get(u.id) || fc.get(u.id))).sort((a, b) => ((fc.get(b.id) || 0) * 3 + (active.get(b.id) || 0)) - ((fc.get(a.id) || 0) * 3 + (active.get(a.id) || 0))).slice(0, 5);
    return { trends: [...tags].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag, n]) => ({ tag, n })), who: who.map((u) => Object.assign(publicUser(u), { followers: fc.get(u.id) || 0 })) };
  });
  r.get('/api/echo/:id', { auth: true, limit: [120, 60000, 'user'] }, async (c) => {
    const all = echoes(); let e = all[c.params.id]; if (!e) throw new HttpError(404, 'no_echo', 'This post was deleted');
    if (e.repost) e = all[e.repost] || e;
    e.views = (e.views || 0) + 1; S.store.touch('echoes'); const cn = counts();
    const up = []; let p = e.reply && all[e.reply]; while (p && up.length < 12) { up.unshift(p); p = p.reply && all[p.reply]; }
    const replies = Object.values(all).filter((x) => x.reply === e.id).sort((a, b) => (b.likes || []).length - (a.likes || []).length || a.created - b.created).slice(0, 200);
    return { post: echoView(e, c.user, cn), parents: up.map((x) => echoView(x, c.user, cn)).filter(Boolean), replies: replies.map((x) => echoView(x, c.user, cn)).filter(Boolean) };
  });
  r.post('/api/echo', { auth: true, verified: true, limit: [30, 600000, 'user'] }, async (c) => {
    const me = c.user; const all = echoes(); const text = clean(c.body.text, MAX_ECHO);
    const reply = c.body.reply ? all[String(c.body.reply)] : null; if (c.body.reply && !reply) throw new HttpError(404, 'no_echo', 'That post was deleted');
    const quote = c.body.quote ? all[String(c.body.quote)] : null; if (c.body.quote && !quote) throw new HttpError(404, 'no_echo', 'That post was deleted');
    let img = null; if (c.body.img) { img = hubMod.take(String(c.body.img), me.id, 'thumb'); if (!img) throw new HttpError(400, 'no_upload', 'Upload the image again'); }
    if (!text && !img && !quote) throw new HttpError(400, 'empty', 'Write something first');
    const e = { id: rid(9), owner: me.id, text, created: now(), likes: [] };
    if (reply) e.reply = reply.repost || reply.id; if (quote) e.quote = quote.repost || quote.id;
    if (img) { e.img = img.sha; e.imgType = blobs.typeOf(img.name); e.imgSize = img.size; blobs.charge(me, img.size); }
    e.tags = [...new Set([...text.matchAll(TAG_RE)].map((m) => m[2].toLowerCase()))].slice(0, 10);
    const mentions = [...new Set([...text.matchAll(MENTION_RE)].map((m) => m[2].toLowerCase()))].slice(0, 10);
    all[e.id] = e; S.store.touch('echoes'); if (!reply) require('../progress').award(me, 'social');
    if (reply) notify(all[e.reply].owner, me, `@${me.username} replied to your Echo: “${text.slice(0, 60)}”`);
    if (quote) notify(all[e.quote].owner, me, `@${me.username} quoted your Echo`);
    for (const m of mentions) { const u = userByName(m); if (u && (!reply || u.id !== all[e.reply].owner)) notify(u.id, me, `@${me.username} mentioned you on Echo: “${text.slice(0, 60)}”`); }
    try { require('../progress').award(me, 'msg'); } catch {}
    return { post: echoView(e, me, counts()) };
  });
  r.post('/api/echo/:id/like', { auth: true, verified: true, limit: [120, 60000, 'user'] }, async (c) => {
    const e = echoes()[c.params.id]; if (!e || e.repost) throw new HttpError(404, 'no_echo', 'This post was deleted');
    e.likes = e.likes || []; const i = e.likes.indexOf(c.user.id);
    if (i >= 0) e.likes.splice(i, 1); else { e.likes.push(c.user.id); notify(e.owner, c.user, `@${c.user.username} liked your Echo: “${(e.text || '').slice(0, 60)}”`); }
    S.store.touch('echoes'); return { liked: i < 0, likes: e.likes.length };
  });
  r.post('/api/echo/:id/repost', { auth: true, verified: true, limit: [60, 60000, 'user'] }, async (c) => {
    const all = echoes(); let e = all[c.params.id]; if (!e) throw new HttpError(404, 'no_echo', 'This post was deleted'); if (e.repost) e = all[e.repost];
    const mine = Object.values(all).find((x) => x.repost === e.id && x.owner === c.user.id);
    if (mine) delete all[mine.id]; else { const id = rid(9); all[id] = { id, owner: c.user.id, repost: e.id, created: now() }; notify(e.owner, c.user, `@${c.user.username} reposted your Echo`); }
    S.store.touch('echoes'); const cn = counts(); return { reposted: !mine, reposts: (cn.rp.get(e.id) || 0) + (cn.q.get(e.id) || 0) };
  });
  r.delete('/api/echo/:id', { auth: true, verified: true }, async (c) => {
    const all = echoes(); const e = all[c.params.id]; if (!e || (e.owner !== c.user.id && !isStaff(c.user))) throw new HttpError(404, 'no_echo', 'Not found');
    if (e.img) { const o = S.users[e.owner]; if (o) blobs.charge(o, -(e.imgSize || 0)); }
    delete all[e.id]; for (const x of Object.values(all)) if (x.repost === e.id) delete all[x.id];
    S.store.touch('echoes'); return { ok: true };
  });
  r.get('/x/echo/i/:id', {}, async (c) => { const e = echoes()[c.params.id]; if (!e || !e.img) throw new HttpError(404, 'no_img', 'Not found'); blobs.send(c.req, c.res, e.img, { type: /^image\//.test(e.imgType || '') ? e.imgType : 'image/jpeg', name: 'echo-image', inline: true, maxAge: 604800 }); });

  // ---- comments on videos / clips ----
  r.get('/api/comments/:target', { auth: true, limit: [120, 60000, 'user'] }, async (c) => {
    const list = comments()[c.params.target] || [];
    const sortNew = c.query.sort === 'new'; const top = list.filter((x) => !x.reply).sort((a, b) => (b.pin ? 1 : 0) - (a.pin ? 1 : 0) || (sortNew ? b.created - a.created : (b.likes || []).length - (a.likes || []).length || b.created - a.created));
    return { total: list.length, items: top.slice(0, 200).map((x) => Object.assign(commentView(x, c.user), { replies: list.filter((y) => y.reply === x.id).sort((a, b) => a.created - b.created).map((y) => commentView(y, c.user)) })) };
  });
  r.post('/api/comments/:target', { auth: true, verified: true, limit: [20, 60000, 'user'] }, async (c) => {
    const it = hubMod.items()[c.params.target]; if (!it || (it.public === false && it.owner !== c.user.id)) throw new HttpError(404, 'no_item', 'Not found');
    const text = clean(c.body.text, 600); if (!text) throw new HttpError(400, 'empty', 'Write something first');
    const all = comments(); const list = all[it.id] = all[it.id] || []; if (list.length >= 5000) throw new HttpError(400, 'full', 'Too many comments here');
    const parent = c.body.reply ? list.find((x) => x.id === String(c.body.reply)) : null;
    const cm = { id: rid(8), owner: c.user.id, text, created: now(), likes: [] }; if (parent) cm.reply = parent.reply || parent.id;
    list.push(cm); S.store.touch('comments');
    notify(it.owner, c.user, `@${c.user.username} commented on “${it.title}”: ${text.slice(0, 60)}`);
    if (parent && parent.owner !== it.owner) notify(parent.owner, c.user, `@${c.user.username} replied to your comment: ${text.slice(0, 60)}`);
    return { comment: commentView(cm, c.user), total: list.length };
  });
  const findComment = (target, id) => { const list = comments()[target] || []; return { list, cm: list.find((x) => x.id === id) }; };
  r.post('/api/comments/:target/:cid/like', { auth: true, verified: true, limit: [120, 60000, 'user'] }, async (c) => {
    const { cm } = findComment(c.params.target, c.params.cid); if (!cm) throw new HttpError(404, 'no_comment', 'Not found');
    cm.likes = cm.likes || []; const i = cm.likes.indexOf(c.user.id); if (i >= 0) cm.likes.splice(i, 1); else cm.likes.push(c.user.id);
    S.store.touch('comments'); return { liked: i < 0, likes: cm.likes.length };
  });
  // the creator can pin one comment and give hearts; authors can edit their comment
  const creatorOf = (target) => { const it = hubMod.items()[target]; return it ? it.owner : null; };
  r.post('/api/comments/:target/:cid/pin', { auth: true, verified: true, limit: [60, 60000, 'user'] }, async (c) => {
    const { list, cm } = findComment(c.params.target, c.params.cid); if (!cm || cm.reply) throw new HttpError(404, 'no_comment', 'Not found');
    if (creatorOf(c.params.target) !== c.user.id) throw new HttpError(403, 'forbidden', 'Only the creator can pin comments');
    const on = !cm.pin; for (const x of list) delete x.pin; if (on) cm.pin = 1; S.store.touch('comments'); return { pinned: on };
  });
  r.post('/api/comments/:target/:cid/heart', { auth: true, verified: true, limit: [120, 60000, 'user'] }, async (c) => {
    const { cm } = findComment(c.params.target, c.params.cid); if (!cm) throw new HttpError(404, 'no_comment', 'Not found');
    if (creatorOf(c.params.target) !== c.user.id) throw new HttpError(403, 'forbidden', 'Only the creator can give hearts');
    cm.heart = cm.heart ? 0 : 1; S.store.touch('comments'); if (cm.heart) notify(cm.owner, c.user, `❤️ @${c.user.username} loved your comment`); return { heart: !!cm.heart };
  });
  r.patch('/api/comments/:target/:cid', { auth: true, verified: true, limit: [30, 60000, 'user'] }, async (c) => {
    const { cm } = findComment(c.params.target, c.params.cid); if (!cm || cm.owner !== c.user.id) throw new HttpError(404, 'no_comment', 'Not found');
    const text = clean(c.body.text, 600); if (!text) throw new HttpError(400, 'empty', 'Write something first'); cm.text = text; cm.edited = now(); S.store.touch('comments'); return { comment: commentView(cm, c.user) };
  });
  r.delete('/api/comments/:target/:cid', { auth: true, verified: true }, async (c) => {
    const { list, cm } = findComment(c.params.target, c.params.cid); const it = hubMod.items()[c.params.target];
    if (!cm || !(cm.owner === c.user.id || isStaff(c.user) || (it && it.owner === c.user.id))) throw new HttpError(404, 'no_comment', 'Not found');
    for (let i = list.length - 1; i >= 0; i--) if (list[i].id === cm.id || list[i].reply === cm.id) list.splice(i, 1);
    S.store.touch('comments'); return { ok: true, total: list.length };
  });

  // ---- Clips feed ----
  r.get('/api/clips', { auth: true, limit: [120, 60000, 'user'] }, async (c) => {
    const me = c.user; const tab = c.query.tab === 'following' ? 'following' : 'foryou'; const t = now(); const f = new Set(followingOf(me.id));
    let list = Object.values(hubMod.items()).filter((x) => x.kind === 'clip' && (x.public !== false || x.owner === me.id));
    if (tab === 'following') list = list.filter((x) => f.has(x.owner)).sort((a, b) => b.created - a.created);
    else { const seed = Number(c.query.seed) || 1; const jitter = (id) => { let x = seed; for (const ch of id) x = (x * 31 + ch.charCodeAt(0)) % 1000003; return (x % 1000) / 1000; };
      const sc = (x) => (((x.likes || []).length * 3 + (x.views || 0) * 0.2 + commentCount(x.id) * 2 + 2) / Math.pow((t - x.created) / 3600000 + 4, 0.8)) * (0.55 + jitter(x.id));
      list.sort((a, b) => sc(b) - sc(a)); }
    const start = c.query.start && list.findIndex((x) => x.id === c.query.start); if (start > 0) list.unshift(...list.splice(start, 1));
    else if (c.query.start && start < 0) { const x = hubMod.items()[c.query.start]; if (x && x.kind === 'clip' && x.public !== false) list.unshift(x); }
    return { items: list.slice(0, 80).map((x) => Object.assign(hubMod.view(x, me), { src: `/x/hub/v/${x.id}`, comments: commentCount(x.id), following: f.has(x.owner) })) };
  });
  r.post('/api/clips/:id/view', { auth: true, limit: [300, 60000, 'user'] }, async (c) => { const it = hubMod.items()[c.params.id]; if (it && (it.kind === 'clip' || it.kind === 'video')) countView(it, c.user.id); return { ok: true }; });

  // ---- Nebulix TV ----
  r.get('/api/tv', { auth: true, limit: [120, 60000, 'user'] }, async (c) => {
    const me = c.user; const tab = String(c.query.tab || 'home'); const q = clean(c.query.q, 60).toLowerCase(); const t = now(); const f = new Set(followingOf(me.id));
    let list = Object.values(hubMod.items()).filter((x) => x.kind === 'video' && (x.public !== false || x.owner === me.id));
    if (q) list = list.filter((x) => x.title.toLowerCase().includes(q) || (x.desc || '').toLowerCase().includes(q) || (x.tags || []).some((tg) => tg.includes(q)) || ((S.users[x.owner] || {}).username || '').toLowerCase().includes(q));
    const dur = String(c.query.dur || ''); if (dur === 'short') list = list.filter((x) => (x.duration || 0) < 240); else if (dur === 'long') list = list.filter((x) => (x.duration || 0) >= 1200);
    if (tab === 'subs') list = list.filter((x) => f.has(x.owner)).sort((a, b) => b.created - a.created);
    else if (tab === 'trending') list = list.filter((x) => t - x.created < 30 * 86400000).sort((a, b) => ((b.views || 0) + (b.likes || []).length * 8) / ((t - b.created) / 86400000 + 1) - ((a.views || 0) + (a.likes || []).length * 8) / ((t - a.created) / 86400000 + 1));
    else if (tab === 'mine') list = list.filter((x) => x.owner === me.id).sort((a, b) => b.created - a.created);
    else list.sort((a, b) => ((b.views || 0) + (b.likes || []).length * 10 + (f.has(b.owner) ? 200 : 0)) / Math.pow((t - b.created) / 86400000 + 2, 0.7) - ((a.views || 0) + (a.likes || []).length * 10 + (f.has(a.owner) ? 200 : 0)) / Math.pow((t - a.created) / 86400000 + 2, 0.7));
    if (c.query.sort === 'new') list.sort((a, b) => b.created - a.created); else if (c.query.sort === 'views') list.sort((a, b) => (b.views || 0) - (a.views || 0));
    const tags = new Map(); for (const x of Object.values(hubMod.items())) if (x.kind === 'video' && x.public !== false) for (const tg of x.tags || []) tags.set(tg, (tags.get(tg) || 0) + 1);
    const subs = [...f].map((id) => S.users[id]).filter((u) => u && !u.deleted).slice(0, 30).map(publicUser);
    return { items: list.slice(0, 120).map((x) => Object.assign(hubMod.view(x, me), { comments: commentCount(x.id) })), tags: [...tags].sort((a, b) => b[1] - a[1]).slice(0, 12).map((x) => x[0]), subs };
  });
  r.get('/api/tv/watch/:id', { auth: true, limit: [120, 60000, 'user'] }, async (c) => {
    const me = c.user; const it = hubMod.items()[c.params.id]; if (!it || it.kind !== 'video' || (it.public === false && it.owner !== me.id)) throw new HttpError(404, 'no_item', 'This video is not available');
    countView(it, me.id);
    const all = Object.values(hubMod.items()).filter((x) => x.kind === 'video' && x.id !== it.id && x.public !== false);
    const tg = new Set(it.tags || []);
    const next = all.map((x) => [x, (x.owner === it.owner ? 30 : 0) + (x.tags || []).filter((y) => tg.has(y)).length * 20 + Math.log1p(x.views || 0) * 4]).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([x]) => hubMod.view(x, me));
    return { item: Object.assign(hubMod.view(it, me), { src: `/x/hub/v/${it.id}`, comments: commentCount(it.id) }), channel: { followers: followerCount(it.owner), isFollowing: followingOf(me.id).includes(it.owner) }, next };
  });
};
module.exports.followerCount = followerCount;
module.exports.followersOf = (uid) => Object.entries(follows()).filter(([, l]) => l.includes(uid)).map(([id]) => id);
module.exports.commentCount = (id) => commentCount(id);

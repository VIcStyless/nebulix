'use strict';
// Nebulix Live: a public log of notable moments (bosses, tournament winners, new worlds, clans, league champions,
// round levels, Arcade records). Kept in meta (last 150), pushed live to everyone online as { t: 'feed', e }.
const { S, hub, publicUser } = require('./state');
const { now, rid } = require('./util');

const MAX = 150;
const KINDS = ['boss', 'tournament', 'world', 'clan', 'league', 'level', 'record', 'casino'];
const list = () => (S.meta.feed = Array.isArray(S.meta.feed) ? S.meta.feed : []);
// text: [en, es]; uid: the main person (shown with their avatar); link: a hash route
function add(kind, icon, text, { uid = null, link = null } = {}) {
  try {
    if (!KINDS.includes(kind)) return;
    const u = uid && S.users[uid]; if (uid && (!u || u.deleted)) return;
    const e = { id: rid(8), at: now(), kind, icon, text, uid, link };
    const l = list(); l.unshift(e); if (l.length > MAX) l.length = MAX; S.store.touch('meta');
    hub.pushMany([...hub.conns.keys()], { t: 'feed', e: view(e) });
  } catch (err) { console.error('[feed]', err); }
}
function view(e) { const u = e.uid && S.users[e.uid]; return { id: e.id, at: e.at, kind: e.kind, icon: e.icon, text: e.text, link: e.link, user: u && !u.deleted ? publicUser(u) : null }; }
function recent(kind, n = 60) { return list().filter((e) => !kind || e.kind === kind).slice(0, Math.min(150, n)).map(view); }
module.exports = { add, recent, KINDS };

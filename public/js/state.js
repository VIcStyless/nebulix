// Global app state + a tiny event bus.
const listeners = new Map();
export const bus = {
  on(evt, fn) { if (!listeners.has(evt)) listeners.set(evt, new Set()); listeners.get(evt).add(fn); return () => listeners.get(evt).delete(fn); },
  emit(evt, data) { const s = listeners.get(evt); if (s) for (const fn of [...s]) { try { fn(data); } catch (e) { console.error('[bus]', evt, e); } } },
};
export const S = {
  me: null, cfg: null, announcements: [], friends: { friends: [], incoming: [], outgoing: [], blocked: [] },
  servers: [], unread: {}, mentions: {}, dmUnread: 0, activeChannel: null, activePeer: null, proxy: { sid: null, origin: null }, ws: false, online: new Set(), acts: {}, statuses: {}, userCache: {},
};
export const isPro = () => !!(S.me && (S.me.pro || S.me.role === 'owner'));
export const isStaff = () => !!(S.me && ['owner', 'admin', 'mod'].includes(S.me.role));
export const isAdmin = () => !!(S.me && ['owner', 'admin'].includes(S.me.role));
export function setMe(u) { S.me = u; bus.emit('me', u); }
export function patchMe(p) { if (S.me) { Object.assign(S.me, p); bus.emit('me', S.me); } }
// Record a user's online flag from an API payload so S.online stays the single source of truth for presence dots.
export function seen(u) { if (u && u.id && u.username) S.userCache[u.id] = u; if (u && u.online !== undefined) { if (u.online) S.online.add(u.id); else S.online.delete(u.id); } return u; }
export const withPresence = (u) => Object.assign({}, u, { online: S.online.has(u.id) });

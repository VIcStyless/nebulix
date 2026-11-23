// Shared community state: the joined servers list, last-read markers and unread counters (the server keeps no read state, so it lives in this browser).
import { api } from './api.js';
import { S, bus } from './state.js';
import { ls } from './util.js';

const readMap = () => ls('cr') || {};
export async function loadServers() {
  const r = await api.get('/api/servers', { quiet: true }); S.servers = r.servers; syncUnread(); bus.emit('servers', S.servers); return S.servers;
}
export function syncUnread() {
  const m = readMap();
  for (const sv of S.servers) for (const ch of sv.channels) if (ch.last && !(m[ch.id] >= ch.last) && !(S.unread[ch.id] > 0)) S.unread[ch.id] = 1;
  bus.emit('badges');
}
export function markRead(chId, msgId) {
  if (msgId) { const m = readMap(); if (!(m[chId] >= msgId)) { m[chId] = msgId; ls('cr', m); } }
  if (S.unread[chId] || S.mentions[chId]) { S.unread[chId] = 0; S.mentions[chId] = 0; }
  bus.emit('badges'); bus.emit('unread', chId);
}
export const serverUnread = (sv) => sv.channels.reduce((n, ch) => n + (S.unread[ch.id] || 0), 0);
export const serverMentions = (sv) => sv.channels.reduce((n, ch) => n + (S.mentions[ch.id] || 0), 0);

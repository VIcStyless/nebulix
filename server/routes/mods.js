'use strict';
// Nebulix Mods (13.8): community mods that change how Nebulix looks (CSS only — no scripts, ever).
// The CSS is cleaned on the server: no @import, no outside addresses in url() (only this site's own files and inline
// images), no legacy script hooks. A mod only affects the people who install it, and they can remove it any time.
const { S, publicUser } = require('../state');
const { HttpError, rid, now } = require('../util');

const T = () => S.store.table('mods');
function cleanCss(css) {
  let s = String(css || '').slice(0, 20000).replace(/\\/g, ''); // no CSS escapes: they could hide url( or expression(
  s = s.replace(/<\/?\s*style/gi, '').replace(/@import[^;]*;?/gi, '').replace(/@charset[^;]*;?/gi, '')
    .replace(/expression\s*\(/gi, 'x(').replace(/behavior\s*:/gi, 'x:').replace(/-moz-binding/gi, 'x').replace(/javascript\s*:/gi, 'x:');
  // url(): keep only data:image/... and our own absolute paths (/assets, /uploads …)
  s = s.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (m, q, u) => (/^data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]/i.test(u) || /^\/(?!\/)[\w./-]*$/.test(u) ? `url("${u.replace(/"/g, '')}")` : 'none'));
  return s;
}
const view = (m, u, withCss) => ({ id: m.id, name: m.name, desc: m.desc, installs: m.installs || 0, author: S.users[m.uid] ? publicUser(S.users[m.uid]) : null, mine: !!u && m.uid === u.id, installed: !!u && (u.mods || []).includes(m.id), created: m.created, css: withCss ? m.css : undefined });

module.exports = function register(r) {
  r.get('/api/mods', { auth: true }, async (c) => {
    let list = Object.values(T()).filter((m) => !m.hidden); const q = String(c.query.q || '').toLowerCase().slice(0, 40);
    if (q) list = list.filter((m) => (m.name + ' ' + m.desc).toLowerCase().includes(q));
    if (c.query.mine === '1') list = list.filter((m) => m.uid === c.user.id);
    list.sort(c.query.sort === 'new' ? (a, b) => b.created - a.created : (a, b) => (b.installs || 0) - (a.installs || 0));
    return { mods: list.slice(0, 80).map((m) => view(m, c.user, true)) };
  });
  r.get('/api/mods/installed', { auth: true }, async (c) => ({ mods: (c.user.mods || []).map((id) => T()[id]).filter(Boolean).map((m) => ({ id: m.id, css: m.css })) }));
  r.post('/api/mods', { auth: true, verified: true, limit: [10, 600000, 'user'] }, async (c) => {
    const name = String(c.body.name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40); const desc = String(c.body.desc || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
    const css = cleanCss(c.body.css); if (name.length < 3) throw new HttpError(400, 'bad_name', 'Give the mod a name'); if (css.trim().length < 10) throw new HttpError(400, 'bad_css', 'The mod has no CSS');
    if (Object.values(T()).filter((m) => m.uid === c.user.id).length >= 30) throw new HttpError(400, 'too_many', 'You have published too many mods');
    const id = c.body.id && T()[c.body.id] && T()[c.body.id].uid === c.user.id ? c.body.id : rid(8);
    const m = Object.assign(T()[id] || { id, uid: c.user.id, installs: 0, created: now() }, { name, desc, css, updated: now() }); T()[id] = m; S.store.touch('mods');
    return { mod: view(m, c.user, true) };
  });
  r.delete('/api/mods/:id', { auth: true, limit: [20, 600000, 'user'] }, async (c) => {
    const m = T()[c.params.id]; if (!m || (m.uid !== c.user.id && !['admin', 'owner', 'mod'].includes(c.user.role))) throw new HttpError(404, 'gone', 'Mod not found');
    delete T()[m.id]; S.store.touch('mods'); return { ok: true };
  });
  r.post('/api/mods/:id/install', { auth: true, limit: [60, 60000, 'user'] }, async (c) => {
    const m = T()[c.params.id]; if (!m) throw new HttpError(404, 'gone', 'Mod not found');
    const u = c.user; u.mods = (u.mods || []).filter((x) => T()[x]); const i = u.mods.indexOf(m.id);
    if (i >= 0) { u.mods.splice(i, 1); m.installs = Math.max(0, (m.installs || 0) - 1); }
    else { if (u.mods.length >= 10) throw new HttpError(400, 'too_many', 'You can have up to 10 mods at once'); u.mods.push(m.id); m.installs = (m.installs || 0) + 1; }
    S.store.touch('users'); S.store.touch('mods'); return { installed: i < 0, installs: m.installs };
  });
};
module.exports.cleanCss = cleanCss;

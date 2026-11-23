// Safe inline formatting for chat text (no innerHTML): links open in the Nebulix browser, @mentions, `code`, **bold**, *italic*, ~~strike~~.
import { h, safeUrl } from './util.js';
const RE = /(https?:\/\/[^\s<>"')\]]+)|(@[A-Za-z0-9_]{3,20})|(`[^`\n]{1,200}`)|(\*\*[^*\n]{1,200}\*\*)|(\*[^*\n]{1,200}\*)|(~~[^~\n]{1,200}~~)/g;
// Link preview card for the first link in a community message (cached; fetched once per URL).
const previews = new Map(); // url -> preview | null | Promise
export function linkCard(text, go, onLoad) {
  const m = /(https?:\/\/[^\s<>"')\]]+)/.exec(String(text || '')); if (!m) return null;
  const url = safeUrl(m[1].replace(/[.,;:!?]+$/, '')); if (!url) return null;
  const build = (p) => (p ? h('a.lp', { href: url, rel: 'noopener noreferrer', onClick: (e) => { e.preventDefault(); if (go) go('browse', { go: url }); } },
    h('div.lp-txt', h('div.lp-site', p.site), h('b.lp-title', p.title || p.site), p.desc ? h('div.lp-desc', p.desc) : null),
    p.img ? h('img.lp-img', { src: p.img, alt: '', loading: 'lazy', onError: (e) => e.target.remove() }) : null) : null);
  const got = previews.get(url);
  if (got !== undefined && !(got instanceof Promise)) return build(got);
  const slot = h('span.lp-slot');
  const pr = got instanceof Promise ? got : fetch('/api/unfurl?url=' + encodeURIComponent(url), { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).then((j) => (j && j.preview) || null).catch(() => null);
  if (!(got instanceof Promise)) { previews.set(url, pr); pr.then((p) => previews.set(url, p)); }
  pr.then((p) => { const card = build(p); if (card && slot.isConnected) { slot.replaceWith(card); if (onLoad) onLoad(); } });
  return slot;
}

const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const reCache = new Map();
// roles: [{ names: [...], color, icon }] — role mentions may contain spaces, so they are matched by exact (case-insensitive) name.
function regexFor(roles) {
  const names = [...new Set((roles || []).flatMap((r) => r.names || []).filter(Boolean))].sort((a, b) => b.length - a.length);
  const key = names.join('\u0001'); if (reCache.has(key)) return reCache.get(key);
  const role = names.length ? '(@(?:' + names.map(esc).join('|') + ')(?![\\p{L}\\p{N}_]))|' : '()';
  const re = new RegExp('(https?:\\/\\/[^\\s<>"\')\\]]+)|' + role + '(@[A-Za-z0-9_]{3,20})|(`[^`\\n]{1,200}`)|(\\*\\*[^*\\n]{1,200}\\*\\*)|(\\*[^*\\n]{1,200}\\*)|(~~[^~\\n]{1,200}~~)', 'giu');
  if (reCache.size > 20) reCache.clear(); reCache.set(key, re); return re;
}

export function richText(text, { go, me, roles, myRoles } = {}) {
  const out = []; let last = 0; text = String(text || '');
  const re = roles && roles.length ? regexFor(roles) : null;
  const find = (name) => (roles || []).find((r) => (r.names || []).some((n) => n.toLowerCase() === name.toLowerCase()));
  const handler = (m, url, rmen, men, code, bold, ital, strike, idx) => {
    if (rmen) {
      if (idx > last) out.push(text.slice(last, idx)); last = idx + m.length;
      const r = find(rmen.slice(1)) || {}; const mine = myRoles && myRoles.has(rmen.slice(1).toLowerCase());
      out.push(h('span.mention.role' + (mine ? '.me' : ''), { style: r.color ? { '--rc': r.color } : null }, r.icon ? r.icon + ' ' : null, rmen)); return m;
    }
    return base(m, url, men, code, bold, ital, strike, idx);
  };
  const base = (m, url, men, code, bold, ital, strike, idx) => {
    if (idx > last) out.push(text.slice(last, idx));
    last = idx + m.length;
    if (url) {
      const clean = url.replace(/[.,;:!?]+$/, ''); const extra = url.slice(clean.length); const safe = safeUrl(clean);
      if (safe) { out.push(h('a.rt-link', { href: safe, rel: 'noopener noreferrer', title: 'Open in Nebulix browser', onClick: (e) => { e.preventDefault(); if (go) go('browse', { go: safe }); else window.open(safe, '_blank', 'noopener,noreferrer'); } }, clean.length > 64 ? clean.slice(0, 61) + '…' : clean)); if (extra) out.push(extra); }
      else out.push(m);
    } else if (men) out.push(h('span.mention' + (me && men.slice(1).toLowerCase() === String(me).toLowerCase() ? '.me' : ''), men));
    else if (code) out.push(h('code', code.slice(1, -1)));
    else if (bold) out.push(h('b', bold.slice(2, -2)));
    else if (ital) out.push(h('i', ital.slice(1, -1)));
    else if (strike) out.push(h('s', strike.slice(2, -2)));
    return m;
  };
  if (re) text.replace(re, handler); else text.replace(RE, (m, url, men, code, bold, ital, strike, idx) => base(m, url, men, code, bold, ital, strike, idx));
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Safe Markdown → DOM (no innerHTML): headings, paragraphs, lists, task lists, code blocks, quotes, tables,
// rules, bold/italic/strike/inline code, links (http(s) and in-app #/ only) and images.
import { h } from './util.js';

const safeHref = (u) => (/^(https?:\/\/|#\/|mailto:)/i.test(u) ? u : null);
export function inline(text) {
  const out = []; let s = String(text);
  const re = /(!\[([^\]]*)\]\(([^)\s]+)\))|(\[([^\]]+)\]\(([^)\s]+)\))|(`([^`]+)`)|(\*\*([^*]+)\*\*)|(__([^_]+)__)|(\*([^*\s][^*]*)\*)|(_([^_\s][^_]*)_)|(~~([^~]+)~~)|(https?:\/\/[^\s<>()]+)/g;
  let last = 0; let m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1]) { const src = safeHref(m[3]); out.push(src && /^https?:|^\//.test(m[3]) ? h('img.md-img', { src: m[3], alt: m[2], loading: 'lazy', referrerpolicy: 'no-referrer' }) : m[0]); }
    else if (m[4]) { const href = safeHref(m[6]); out.push(href ? h('a', { href, target: href.startsWith('#') ? null : '_blank', rel: 'noopener noreferrer' }, inline(m[5])) : m[5]); }
    else if (m[7]) out.push(h('code', m[8]));
    else if (m[9] || m[11]) out.push(h('b', inline(m[10] || m[12])));
    else if (m[13] || m[15]) out.push(h('i', inline(m[14] || m[16])));
    else if (m[17]) out.push(h('s', inline(m[18])));
    else if (m[19]) out.push(h('a', { href: m[19], target: '_blank', rel: 'noopener noreferrer' }, m[19]));
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
export function mdToEls(src) {
  const lines = String(src || '').replace(/\r/g, '').split('\n'); const out = []; let i = 0;
  const isList = (l) => /^\s*([-*+]|\d+[.)])\s+/.test(l);
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) { const lang = l.slice(3).trim(); const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; out.push(h('pre.md-pre', { dataset: { lang } }, h('code', buf.join('\n')))); continue; }
    const hm = /^(#{1,6})\s+(.*)$/.exec(l); if (hm) { out.push(h('h' + hm[1].length, inline(hm[2]))); i++; continue; }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(l)) { out.push(h('hr')); i++; continue; }
    if (/^>\s?/.test(l)) { const buf = []; while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, '')); out.push(h('blockquote', mdToEls(buf.join('\n')))); continue; }
    if (/^\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const row = (x) => x.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = row(l); i += 2; const body = []; while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) body.push(row(lines[i++]));
      out.push(h('div.md-tw', h('table.md-table', h('thead', h('tr', head.map((c) => h('th', inline(c))))), h('tbody', body.map((r) => h('tr', r.map((c) => h('td', inline(c))))))))); continue;
    }
    if (isList(l)) {
      const ordered = /^\s*\d/.test(l); const items = [];
      while (i < lines.length && isList(lines[i])) { const txt = lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, ''); const tm = /^\[([ xX])\]\s+(.*)$/.exec(txt); items.push(tm ? h('li.md-task', h('input', { type: 'checkbox', checked: tm[1] !== ' ', disabled: true }), ' ', inline(tm[2])) : h('li', inline(txt))); }
      out.push(h(ordered ? 'ol' : 'ul', items)); continue;
    }
    if (!l.trim()) { i++; continue; }
    const buf = []; while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+[.)])\s)/.test(lines[i])) buf.push(lines[i++]);
    out.push(h('p', inline(buf.join(' '))));
  }
  return h('div.md', out);
}

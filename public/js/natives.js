// Native clients for the Nebulix browser: addresses that open a built-in page instead of the proxied site.
// Nebulix Search (also takes over google.com/search, which blocks proxied searches), Tube (YouTube),
// Wikipedia, Hacker News and Twitch. Each renderer gets (el, url, { open, setTitle }).
import { h, mount, fmt } from './util.js';
import { t, getLang } from './i18n.js';
import { api } from './api.js';
import { icon } from './icons.js';
import { tubeRoute, renderTube } from './tube.js';

export const SEARCH_URL = 'https://search.nebulix/?q=';
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const qs = (u) => { try { return new URL(u).searchParams; } catch { return new URLSearchParams(); } };

export function nativeFor(url) {
  let u; try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'search.nebulix') return { kind: 'search', render: renderSearch };
  // Google blocks searches that come through a proxy (captcha page) — answer them with Nebulix Search
  if (/^google\.[a-z.]+$/.test(host) && u.pathname === '/search' && u.searchParams.get('q')) return { kind: 'search', render: (el, x, o) => renderSearch(el, SEARCH_URL + encodeURIComponent(u.searchParams.get('q')) + '&from=google', o) };
  if (/^bing\.com$/.test(host) && u.pathname === '/search' && u.searchParams.get('q')) return { kind: 'search', render: (el, x, o) => renderSearch(el, SEARCH_URL + encodeURIComponent(u.searchParams.get('q')), o) };
  if (/^(duckduckgo\.com|search\.brave\.com)$/.test(host) && u.searchParams.get('q')) return { kind: 'search', render: (el, x, o) => renderSearch(el, SEARCH_URL + encodeURIComponent(u.searchParams.get('q')), o) };
  if (tubeRoute(url)) return { kind: 'tube', render: renderTube };
  if (/(^|\.)wikipedia\.org$/.test(host)) return { kind: 'wiki', render: renderWiki };
  if (host === 'news.ycombinator.com') return { kind: 'hn', render: renderHN };
  if (host === 'twitch.tv' || host === 'm.twitch.tv') return { kind: 'twitch', render: renderTwitch };
  return null;
}

const shell = (el, logo, cls, searchPh, onSearch, value = '') => {
  const inp = h('input.input', { placeholder: searchPh, value, onKeydown: (e) => { if (e.key === 'Enter' && e.target.value.trim()) onSearch(e.target.value.trim()); } });
  const body = h('div.nat-body');
  mount(el, h('div.nat.' + cls, h('div.nat-head', logo, h('div.nat-search', inp, h('button.btn', { type: 'button', onClick: () => inp.value.trim() && onSearch(inp.value.trim()) }, icon('search', 16)))), body));
  return { body, inp };
};
const spin = () => h('div.empty', h('span.spinner'));
const fail = (e) => h('div.empty', h('div.empty-art', icon('alert', 24)), h('h3', t('Could not load this')), h('p.muted', String((e && e.message) || e)));

// ================= Nebulix Search =================
function renderSearch(el, url, { open, setTitle }) {
  const p = qs(url); const q = (p.get('q') || '').trim(); const type = p.get('type') || 'web'; const page = Math.max(1, parseInt(p.get('p'), 10) || 1);
  const go = (nq, nt = 'web', np = 1) => open(SEARCH_URL + encodeURIComponent(nq) + (nt !== 'web' ? '&type=' + nt : '') + (np > 1 ? '&p=' + np : ''));
  const logo = h('button.ns-logo', { type: 'button', onClick: () => open(SEARCH_URL) }, h('span.ns-n', 'N'), h('b', 'Nebulix'), h('span', ' Search'));
  if (!q) {
    setTitle && setTitle('Nebulix Search');
    const inp = h('input.input.ns-big', { placeholder: t('Search the web'), autofocus: true, onKeydown: (e) => { if (e.key === 'Enter' && e.target.value.trim()) go(e.target.value.trim()); } });
    mount(el, h('div.nat.ns-home', h('div.ns-hero', h('div.ns-biglogo', h('span.ns-n', 'N'), h('b', 'Nebulix'), ' Search'), inp, h('div.row.wrap', { style: 'gap:6px;justify-content:center' }, ['Minecraft', t('news today'), 'lofi', 'NVIDIA', t('weather Madrid')].map((x) => h('button.chip', { type: 'button', onClick: () => go(x) }, x))), h('p.tiny.muted', t('Private: searches run on Nebulix servers, not in your browser. Web results from Bing, encyclopedia from Wikipedia.')))));
    setTimeout(() => inp.focus(), 50); return;
  }
  setTitle && setTitle(q + ' — Nebulix Search');
  const { body, inp } = shell(el, logo, 'ns', t('Search the web'), (x) => go(x), q);
  // suggestions under the box
  let st = 0; const sug = h('div.ns-sug'); inp.parentNode.appendChild(sug);
  inp.addEventListener('input', () => { clearTimeout(st); const v = inp.value.trim(); if (v.length < 2) { mount(sug); return; } st = setTimeout(async () => { try { const r = await api.get('/api/search/suggest?q=' + encodeURIComponent(v), { quiet: true }); if (inp.value.trim() !== v) return; mount(sug, r.list.map((s) => h('button', { type: 'button', onMousedown: (e) => { e.preventDefault(); go(s); } }, icon('search', 13), s))); } catch {} }, 160); });
  inp.addEventListener('blur', () => setTimeout(() => mount(sug), 150));
  const tabs = h('div.ns-tabs', [['web', t('All'), 'search'], ['images', t('Images'), 'image'], ['videos', t('Videos'), 'play'], ['news', t('News'), 'book']].map(([k, l, ic]) => h('button' + (k === type ? '.on' : ''), { type: 'button', onClick: () => go(q, k) }, icon(ic, 14), l)));
  const res = h('div', spin());
  mount(body, p.get('from') === 'google' ? h('div.ns-note', icon('info', 14), t('Google blocks searches made through a proxy, so Nebulix Search answers instead.')) : null, tabs, res);
  api.get(`/api/search?q=${encodeURIComponent(q)}&type=${type}&p=${page}&hl=${getLang() || 'es'}`, { quiet: true }).then((d) => {
    if (type === 'images') return mount(res, d.images.length ? h('div.ns-imgs', d.images.map((im) => h('button.ns-img', { type: 'button', title: im.title, onClick: () => im.page && open(im.page) }, h('img', { src: im.thumb, alt: im.title, loading: 'lazy', referrerpolicy: 'no-referrer' }), h('span.tiny.ellipsis', im.host)))) : none());
    if (type === 'news') return mount(res, d.news.length ? h('div.ns-list', d.news.map((n) => h('div.ns-news', n.image ? h('img', { src: n.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null, h('div.grow', h('div.tiny.muted', [n.source || n.host, n.date ? fmt.rel(Date.parse(n.date)) : ''].filter(Boolean).join(' · ')), h('a.ns-t', { href: n.url, onClick: (e) => { e.preventDefault(); open(n.url); } }, n.title), h('p.small.muted', n.snippet))))) : none());
    if (type === 'videos') return mount(res, d.videos.length ? h('div.tube-grid', d.videos.map((v) => vid(v))) : none());
    const main = h('div.ns-main',
      d.answer ? h('div.card.ns-ans', h('div.tiny.muted', d.answer.title), h('div.ns-ansv', d.answer.value), d.answer.sub ? h('div.small', d.answer.sub) : null) : null,
      d.images && d.images.length ? h('div.ns-strip', d.images.map((im) => h('button.ns-img', { type: 'button', onClick: () => go(q, 'images') }, h('img', { src: im.thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })))) : null,
      d.results.length ? h('div.ns-list', d.results.map((x, i) => [h('div.ns-r', h('div.ns-src', h('img.ns-fav', { src: '/api/favicon?host=' + encodeURIComponent(x.host), alt: '', loading: 'lazy', onError: (e) => { e.target.style.visibility = 'hidden'; } }), h('span.small', x.host)), h('a.ns-t', { href: x.url, onClick: (e) => { e.preventDefault(); open(x.url); } }, x.title), h('p.small.ns-snip', x.snippet)),
        i === 2 && d.videos && d.videos.length ? h('div.ns-vids', h('div.eyebrow', t('Videos')), h('div.tube-grid', d.videos.map((v) => vid(v)))) : null])) : none(),
      h('div.row', { style: 'gap:8px;margin:18px 0' }, page > 1 ? h('button.btn', { onClick: () => go(q, 'web', page - 1) }, icon('back', 14), t('Previous')) : null, d.results.length >= 8 ? h('button.btn', { onClick: () => go(q, 'web', page + 1) }, t('Next'), icon('fwd', 14)) : null));
    const side = d.card ? h('aside.card.ns-card', d.card.image ? h('img', { src: d.card.image, alt: '', referrerpolicy: 'no-referrer' }) : null, h('h3', d.card.title), d.card.desc ? h('div.small.muted', d.card.desc) : null, h('p.small', d.card.text), d.card.url ? h('button.btn.sm', { onClick: () => open(d.card.url) }, icon('book', 14), 'Wikipedia') : null) : null;
    mount(res, h('div.ns-cols', main, side));
  }).catch((e) => mount(res, fail(e)));
  function vid(v) { return h('button.tube-card', { type: 'button', onClick: () => open('https://www.youtube.com/watch?v=' + v.id) }, h('div.tube-thumb', h('img', { src: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }), v.duration ? h('span.tube-dur', v.duration) : null), h('div.tube-meta', h('b.tube-title', v.title), h('span.tiny.muted', v.channel))); }
  function none() { return h('div.empty', h('h3', t('No results')), h('p.muted', t('Try other words.'))); }
}

// ================= Wikipedia =================
function renderWiki(el, url, { open, setTitle }) {
  let u; try { u = new URL(url); } catch { return; }
  const lang = (u.hostname.split('.')[0] || 'es').replace(/^(www|m)$/, 'es');
  const m = /^\/wiki\/(.+)$/.exec(u.pathname); const title = m ? decodeURIComponent(m[1]).replace(/_/g, ' ') : ''; const q = u.searchParams.get('search') || '';
  const base = `https://${lang}.wikipedia.org`;
  const logo = h('button.wk-logo', { type: 'button', onClick: () => open(base + '/') }, h('b', 'W'), h('span', 'Wikipedia'));
  const { body } = shell(el, logo, 'wk', t('Search Wikipedia'), (x) => open(base + '/w/index.php?search=' + encodeURIComponent(x)), q || title);
  mount(body, spin());
  if (q) { setTitle && setTitle(q + ' — Wikipedia'); api.get(`/api/apps/wiki?lang=${lang}&q=${encodeURIComponent(q)}`, { quiet: true }).then((d) => mount(body, h('div.ns-list', d.results.map((x) => h('div.ns-r', h('a.ns-t', { href: '#', onClick: (e) => { e.preventDefault(); open(base + '/wiki/' + encodeURIComponent(x.title.replace(/ /g, '_'))); } }, x.title), h('p.small.ns-snip', x.snippet)))))).catch((e) => mount(body, fail(e))); return; }
  if (!title) { setTitle && setTitle('Wikipedia'); mount(body, h('div.empty', h('h3', t('The free encyclopedia')), h('p.muted', t('Search for any topic above.')), h('button.btn', { onClick: async () => { try { const r = await api.get('/api/apps/wiki?lang=' + lang, { quiet: true }); if (r.random) open(base + '/wiki/' + encodeURIComponent(r.random.replace(/ /g, '_'))); } catch {} } }, t('Random article')))); return; }
  api.get(`/api/apps/wiki?lang=${lang}&title=${encodeURIComponent(title)}`, { quiet: true }).then((d) => {
    setTitle && setTitle(d.title + ' — Wikipedia');
    const blocks = []; const toc = [];
    for (const raw of d.text.split(/\n+/)) {
      const hm = /^(={2,4})\s*(.+?)\s*\1$/.exec(raw.trim());
      if (hm) { const id = 'wk-' + toc.length; toc.push([hm[2], id, hm[1].length]); blocks.push(h(hm[1].length === 2 ? 'h2' : 'h3', { id }, hm[2])); } else if (raw.trim()) blocks.push(h('p', raw.trim()));
    }
    mount(body, h('article.wk-art', h('h1', d.title), d.image ? h('img.wk-img', { src: d.image, alt: '', referrerpolicy: 'no-referrer' }) : null,
      toc.length > 2 ? h('nav.wk-toc', h('b', t('Contents')), toc.filter((x) => x[2] === 2).map(([n, id]) => h('a', { href: '#', onClick: (e) => { e.preventDefault(); body.querySelector('#' + id).scrollIntoView({ behavior: 'smooth' }); } }, n))) : null,
      blocks, h('p.tiny.muted', t('Text from Wikipedia, available under CC BY-SA 4.0.'))));
  }).catch((e) => mount(body, fail(e)));
}

// ================= Hacker News =================
function renderHN(el, url, { open, setTitle }) {
  const u = new URL(url); const id = u.searchParams.get('id'); const list = { '/newest': 'new', '/best': 'best', '/ask': 'ask', '/show': 'show' }[u.pathname] || 'top';
  const logo = h('button.hn-logo', { type: 'button', onClick: () => open('https://news.ycombinator.com/') }, h('b', 'Y'), h('span', 'Hacker News'));
  const { body } = shell(el, logo, 'hn', t('Search the web'), (x) => open(SEARCH_URL + encodeURIComponent(x + ' site:news.ycombinator.com')));
  const tabs = h('div.ns-tabs', [['top', 'Top', '/'], ['new', 'New', '/newest'], ['best', 'Best', '/best'], ['ask', 'Ask', '/ask'], ['show', 'Show', '/show']].map(([k, l, p]) => h('button' + (!id && k === list ? '.on' : ''), { type: 'button', onClick: () => open('https://news.ycombinator.com' + p) }, l)));
  const res = h('div', spin()); mount(body, tabs, res);
  const row = (x, i) => h('div.hn-row', h('span.hn-n', i != null ? (i + 1) + '.' : ''), h('div.grow', h('a.ns-t', { href: '#', onClick: (e) => { e.preventDefault(); open(x.url || 'https://news.ycombinator.com/item?id=' + x.id); } }, x.title), x.url ? h('span.tiny.muted', ' (' + hostOf(x.url) + ')') : null,
    h('div.tiny.muted', `${x.score} ${t('points')} · ${x.by} · ${fmt.rel(x.time)} · `, h('a', { href: '#', onClick: (e) => { e.preventDefault(); open('https://news.ycombinator.com/item?id=' + x.id); } }, t('{n} comments', { n: x.comments })))));
  if (id) {
    api.get('/api/apps/hn/item/' + encodeURIComponent(id), { quiet: true }).then((d) => {
      setTitle && setTitle(d.item.title || 'Hacker News');
      const com = (c, lvl) => h('div.hn-c', { style: '--l:' + lvl }, h('div.tiny.muted', c.by + ' · ' + fmt.rel(c.time)), h('div.small.hn-txt', c.text), (c.replies || []).map((r) => com(r, lvl + 1)));
      mount(res, row(d.item), d.item.text ? h('p.small.hn-txt', d.item.text) : null, h('div.hn-cs', d.comments.map((c) => com(c, 0))));
    }).catch((e) => mount(res, fail(e)));
    return;
  }
  setTitle && setTitle('Hacker News');
  api.get('/api/apps/hn/' + list, { quiet: true }).then((d) => mount(res, h('div', d.items.map((x, i) => row(x, i))))).catch((e) => mount(res, fail(e)));
}

// ================= Twitch =================
const TW_POPULAR = ['ibai', 'auronplay', 'elxokas', 'illojuan', 'thegrefg', 'rubius', 'kaicenat', 'xqc', 'shroud', 'pokimane', 'tarik', 'zeling'];
function renderTwitch(el, url, { open, setTitle }) {
  const u = new URL(url); const ch = u.pathname.split('/').filter(Boolean)[0] || '';
  const logo = h('button.tw-logo', { type: 'button', onClick: () => open('https://www.twitch.tv/') }, h('b', '▶'), h('span', 'Twitch'));
  const { body } = shell(el, logo, 'tw', t('Channel name'), (x) => open('https://www.twitch.tv/' + encodeURIComponent(x.replace(/^@/, '').trim())), ch);
  if (!/^[a-zA-Z0-9_]{2,25}$/.test(ch)) {
    setTitle && setTitle('Twitch');
    mount(body, h('div.eyebrow', t('Popular channels')), h('div.tw-grid', TW_POPULAR.map((c) => h('button.tw-ch', { type: 'button', onClick: () => open('https://www.twitch.tv/' + c) }, h('span.tw-av', c[0].toUpperCase()), h('b', c)))), h('p.tiny.muted', t('Type any channel name above to watch it live.')));
    return;
  }
  setTitle && setTitle(ch + ' — Twitch');
  const parent = location.hostname;
  mount(body, h('div.tw-watch', h('div.tube-player', h('iframe', { src: `https://player.twitch.tv/?channel=${encodeURIComponent(ch)}&parent=${encodeURIComponent(parent)}&autoplay=true`, allow: 'autoplay; fullscreen', allowfullscreen: '', title: 'Twitch' })),
    h('div.tw-chat', h('iframe', { src: `https://www.twitch.tv/embed/${encodeURIComponent(ch)}/chat?parent=${encodeURIComponent(parent)}&darkpopout`, title: 'Twitch chat' }))));
}

// Nebulix Tube: how the Nebulix browser shows YouTube. youtube.com itself breaks inside the rewriting proxy,
// so YouTube addresses open this native page: search (read server-side) + YouTube's official privacy embed.
import { h, mount } from './util.js';
import { t, getLang } from './i18n.js';
import { api } from './api.js';
import { icon } from './icons.js';

const ID = /^[A-Za-z0-9_-]{11}$/;
// Which YouTube page an address is, or null when it is not YouTube.
export function tubeRoute(url) {
  let u; try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  if (host === 'youtu.be') { const id = u.pathname.slice(1, 12); return ID.test(id) ? { kind: 'watch', id } : { kind: 'home' }; }
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;
  const p = u.pathname;
  let m;
  if (p === '/watch' && ID.test(u.searchParams.get('v') || '')) return { kind: 'watch', id: u.searchParams.get('v'), list: u.searchParams.get('list') || '' };
  if ((m = /^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/.exec(p))) return { kind: 'watch', id: m[1] };
  if (p === '/results') return { kind: 'search', q: u.searchParams.get('search_query') || u.searchParams.get('q') || '' };
  if ((m = /^\/(@[\w.-]+|c\/[\w.-]+|channel\/[\w-]+|user\/[\w.-]+)/.exec(p))) return { kind: 'search', q: decodeURIComponent(m[1].replace(/^(c|channel|user)\//, '')) };
  return { kind: 'home' };
}
export const watchUrl = (id) => 'https://www.youtube.com/watch?v=' + id;
export const searchUrl = (q) => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
const known = new Map(); // id → video info seen in results, so a watch page has its title without another lookup
const thumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

const HOME_TOPICS = (lang) => [[t('Trending'), lang === 'es' ? 'videos populares hoy' : 'popular videos today'], [t('Music'), 'music hits'], [t('Gaming'), 'gaming'], [t('Lo-fi'), 'lofi hip hop'], [t('News'), 'news today'], [t('Sports'), 'sports highlights'], [t('Learning'), 'how to']];

// Renders the page for `url` into `el`. `open(url)` sends a new address through the browser tab (history, title…).
export function renderTube(el, url, { open, setTitle }) {
  const r = tubeRoute(url) || { kind: 'home' };
  const lang = getLang() || 'es';
  const searchIn = h('input.input.tube-q', { placeholder: t('Search YouTube'), 'aria-label': t('Search YouTube'), value: r.kind === 'search' ? r.q : '', onKeydown: (e) => { if (e.key === 'Enter' && e.target.value.trim()) open(searchUrl(e.target.value.trim())); } });
  const head = h('div.tube-head',
    h('button.tube-logo', { type: 'button', onClick: () => open('https://www.youtube.com/') }, h('span.tube-play', icon('play', 14)), h('b', 'Tube')),
    h('div.tube-search', searchIn, h('button.btn', { type: 'button', onClick: () => searchIn.value.trim() && open(searchUrl(searchIn.value.trim())) }, icon('search', 16))));
  const body = h('div.tube-body');
  mount(el, h('div.tube', head, body));

  const card = (v, small) => h('button.tube-card' + (small ? '.sm' : ''), { type: 'button', onClick: () => open(watchUrl(v.id)), title: v.title },
    h('div.tube-thumb', h('img', { src: thumb(v.id), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }), v.duration ? h('span.tube-dur', v.duration) : v.live ? h('span.tube-dur.live', t('LIVE')) : null),
    h('div.tube-meta', h('b.tube-title', v.title), h('span.tiny.muted', v.channel), h('span.tiny.muted', [v.views, v.ago].filter(Boolean).join(' · '))));
  const grid = (items, small) => h('div.tube-grid' + (small ? '.sm' : ''), items.map((v) => card(v, small)));
  const loadingEl = () => h('div.tube-grid', Array.from({ length: 8 }, () => h('div.tube-card.skel', h('div.tube-thumb'), h('div.tube-meta', h('i'), h('i')))));
  const fail = (e) => h('div.empty', h('div.empty-art', icon('alert', 24)), h('h3', t('YouTube is not answering')), h('p.muted', String((e && e.message) || e)));
  const find = (q) => api.get('/api/tube/search?hl=' + encodeURIComponent(lang) + '&q=' + encodeURIComponent(q), { quiet: true }).then((x) => { for (const v of x.items) if (!known.has(v.id)) known.set(v.id, v); if (known.size > 600) known.clear(); return x.items; });

  if (r.kind === 'watch') {
    setTitle && setTitle('YouTube');
    const src = 'https://www.youtube-nocookie.com/embed/' + r.id + '?autoplay=1&rel=0&modestbranding=1&playsinline=1' + (r.list ? '&list=' + encodeURIComponent(r.list) : '');
    const player = h('div.tube-player', h('iframe', { src, title: 'YouTube', allow: 'autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write', allowfullscreen: '', referrerpolicy: 'strict-origin-when-cross-origin' }));
    const info = h('div.tube-info'); const side = h('div.tube-side', loadingEl());
    mount(body, h('div.tube-watch', h('div.tube-main', player, info), side));
    const paintInfo = (me) => { setTitle && setTitle(me.title); mount(info, h('h2.tube-h', me.title), h('div.row.wrap', h('b', me.channel), h('span.muted.small', [me.views, me.ago].filter(Boolean).join(' · ')), h('span.grow'), h('a.btn.sm.ghost', { href: watchUrl(r.id), target: '_blank', rel: 'noopener noreferrer' }, icon('external', 14), t('Open on YouTube')))); };
    const words = (x) => String(x || '').replace(/[^\p{L}\p{N} ]+/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 5).join(' ');
    const related = async (me) => {
      try {
        let items = me ? await find(me.channel || words(me.title)) : await find(r.id);
        const m2 = me || items.find((x) => x.id === r.id); if (!me && m2) paintInfo(m2);
        items = items.filter((x) => x.id !== r.id);
        if (items.length < 4 && m2) items = items.concat((await find(words(m2.title))).filter((x) => x.id !== r.id && !items.some((y) => y.id === x.id)));
        mount(side, grid(items.slice(0, 14), true));
      } catch { mount(side); }
    };
    const me = known.get(r.id);
    if (me) { paintInfo(me); related(me); }
    else api.get('/api/tube/video/' + r.id, { quiet: true }).then((x) => { known.set(r.id, x.video); paintInfo(x.video); related(x.video); }).catch(() => related(null));
    return;
  }
  const q = r.kind === 'search' && r.q ? r.q : null;
  setTitle && setTitle(q ? q + ' - YouTube' : 'YouTube');
  const chips = h('div.tube-chips', HOME_TOPICS(lang).map(([label, query], i) => h('button.chip' + (!q && i === 0 ? '.on' : ''), { type: 'button', onClick: () => open(searchUrl(query)) }, label)));
  const list = h('div', loadingEl());
  mount(body, chips, list);
  find(q || (lang === 'es' ? 'videos populares hoy' : 'popular videos today')).then((items) => mount(list, items.length ? grid(items) : h('div.empty', h('h3', t('No results')), h('p.muted', t('Try other words.'))))).catch((e) => mount(list, fail(e)));
}

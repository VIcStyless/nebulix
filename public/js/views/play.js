// Games — a portal of web games that open through the proxy. Real logos (siteLogo), categories,
// instant search, favourites and a "jump back in" row. Favourites + recents live in this browser only.
import { h, mount, ls, debounce } from '../util.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { siteLogo } from '../sites.js';
import { GAME_CATS, GAME_BY_URL } from '../games.js';

const FAVS = 'play.favs';     // [url, …]
const RECENT = 'play.recent'; // [{ url, name, at }, …]

const getFavs = () => { try { return ls(FAVS) || []; } catch { return []; } };
const getRecent = () => { try { return ls(RECENT) || []; } catch { return []; } };

export default {
  title: () => t('Games'),
  async mount(root, ctx) {
    const go = ctx.go;
    let favs = getFavs();
    let query = (ctx.query.get('q') || '').trim();

    const launch = (url, name) => {
      const list = getRecent().filter((x) => x.url !== url);
      list.unshift({ url, name, at: Date.now() });
      try { ls(RECENT, list.slice(0, 12)); } catch {}
      go('browse', { go: url });
    };
    const toggleFav = (url, btn) => {
      favs = getFavs();
      if (favs.includes(url)) favs = favs.filter((x) => x !== url); else favs = [url, ...favs].slice(0, 60);
      try { ls(FAVS, favs); } catch {}
      btn.classList.toggle('on', favs.includes(url));
      btn.title = favs.includes(url) ? t('Remove from favourites') : t('Add to favourites');
      const grid = root.querySelector('[data-favrow]'); if (grid) paintFavs();
    };

    // One game tile: logo + name, a favourite star, opens through the proxy.
    const tile = (name, url) => {
      const star = h('button.gt-fav' + (favs.includes(url) ? '.on' : ''), { type: 'button', title: favs.includes(url) ? t('Remove from favourites') : t('Add to favourites'), 'aria-label': t('Favourite'), onClick: (e) => { e.stopPropagation(); toggleFav(url, star); } }, icon('star', 15));
      return h('button.site-tile.gt', { title: name, onClick: () => launch(url, name) }, star, siteLogo(url, name, name.slice(0, 2), 40), h('span.ellipsis', name));
    };

    const favRowWrap = h('section.card.s12', { style: 'display:none', 'data-favrow': '1' });
    function paintFavs() {
      favs = getFavs();
      const games = favs.map((u) => ({ url: u, name: (GAME_BY_URL.get(u) || {}).name || u })).filter((g) => GAME_BY_URL.has(g.url));
      favRowWrap.style.display = games.length ? '' : 'none';
      mount(favRowWrap, games.length ? [h('div.card-head', h('h3', icon('star', 16), t('Favourites')), h('span.tiny.muted', t('{n} saved', { n: games.length }))), h('div.site-grid', games.map((g) => tile(g.name, g.url)))] : []);
    }

    const recentWrap = h('section.card.s12', { style: 'display:none' });
    function paintRecent() {
      const games = getRecent().filter((x) => GAME_BY_URL.has(x.url)).slice(0, 8);
      recentWrap.style.display = games.length ? '' : 'none';
      mount(recentWrap, games.length ? [h('div.card-head', h('h3', icon('back', 16), t('Jump back in')), h('button.btn.ghost.sm', { onClick: () => { try { ls(RECENT, []); } catch {} paintRecent(); } }, t('Clear'))), h('div.site-grid', games.map((g) => tile(g.name, g.url)))] : []);
    }

    const catsWrap = h('div.col', { style: 'gap:18px' });
    function paintCats() {
      const q = query.toLowerCase();
      const sections = [];
      for (const [key, label, ic, list] of GAME_CATS) {
        const games = q ? list.filter(([n, u]) => n.toLowerCase().includes(q) || u.toLowerCase().includes(q)) : list;
        if (!games.length) continue;
        sections.push(h('section.card.s12', { 'data-cat': key },
          h('div.card-head', h('h3', icon(ic, 16), t(label)), h('span.tiny.muted', t('Opens through the proxy'))),
          h('div.site-grid', games.map(([n, u]) => tile(n, u)))));
      }
      mount(catsWrap, sections.length ? sections : h('div.empty', { style: 'padding:40px 0' }, h('p.muted.center', t('No games match "{q}".', { q: query }))));
    }

    const searchIn = h('input.input.play-search', { type: 'search', placeholder: t('Search {n} games…', { n: GAME_BY_URL.size }), value: query, 'aria-label': t('Search games'),
      onInput: debounce(() => { query = searchIn.value.trim(); paintCats(); }, 140) });
    const hero = h('section.card.s12.play-hero',
      h('div.play-hero-txt', h('div.eyebrow', t('Play')), h('h2', t('Games')), h('p.muted', t('Hundreds of web games, launched through the isolated proxy so they load on locked-down networks.'))),
      h('div.play-hero-search', icon('search', 18), searchIn));

    mount(root, h('div.view-wrap.play-wrap', hero, favRowWrap, recentWrap, catsWrap));
    paintFavs(); paintRecent(); paintCats();
    setTimeout(() => { try { searchIn.focus(); } catch {} }, 30);
    return () => {};
  },
};

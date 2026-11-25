// Nebulix 3.0 — Discover games on official platforms: free-to-play games (FreeToGame API) and current deals in official
// stores (CheapShark API). Nebulix only links out; it never hosts or distributes these games. #/discover
import { h, mount, debounce } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { loading, emptyState, tabsEl } from '../ui.js';

const CATS = [['', 'All genres'], ['shooter', 'Shooter'], ['mmorpg', 'MMORPG'], ['moba', 'MOBA'], ['strategy', 'Strategy'], ['battle-royale', 'Battle royale'], ['racing', 'Racing'], ['sports', 'Sports'], ['card', 'Card games'], ['fantasy', 'Fantasy'], ['sci-fi', 'Sci-fi'], ['survival', 'Survival'], ['anime', 'Anime'], ['fighting', 'Fighting']];
const ext = (url) => ({ href: url, target: '_blank', rel: 'noopener noreferrer nofollow' });
const img = (src, alt) => (src ? h('img', { src, alt, loading: 'lazy', referrerPolicy: 'no-referrer', onError: (e) => e.target.remove() }) : null);

export default {
  title: () => t('Discover games'),
  async mount(root, ctx) {
    let tab = ctx.params[0] === 'deals' ? 'deals' : 'free'; let alive = true;
    const body = h('div.dg-body'); const controls = h('div.dg-controls');
    const q = h('input.input', { type: 'search', placeholder: t('Search games'), 'aria-label': t('Search games') });

    const tabs = tabsEl([['free', t('Free to play'), 'gamepad'], ['deals', t('Deals'), 'tag']], tab, (v) => { tab = v; q.value = ''; history.replaceState(null, '', '#/discover/' + v); show(); }); // each tab searches different things
    const st = { free: { platform: 'all', category: '', sort: 'popularity' }, deals: { sort: 'Deal Rating', upper: '', store: '', free: false } };
    const sel = (opts, val, on, label) => h('select.input', { 'aria-label': label, onChange: (e) => on(e.target.value) }, opts.map(([v, l]) => h('option', { value: v, selected: v === val }, t(l))));
    let token = 0; let ctl = ''; // which tab the filter bar was built for (rebuilding it while typing would steal focus)
    async function show() {
      const my = ++token; mount(body, loading());
      if (tab === 'free') {
        const f = st.free;
        if (ctl !== 'free') { ctl = 'free'; mount(controls, q, sel([['all', 'All platforms'], ['pc', 'PC (Windows)'], ['browser', 'Web browser']], f.platform, (v) => { f.platform = v; show(); }, t('Platform')), sel(CATS, f.category, (v) => { f.category = v; show(); }, t('Genre')), sel([['popularity', 'Most popular'], ['release-date', 'Newest'], ['alphabetical', 'A–Z']], f.sort, (v) => { f.sort = v; show(); }, t('Sort'))); }
        let r; try { r = await api.get('/api/discover/free?' + new URLSearchParams({ ...f, q: q.value })); } catch (e) { if (my === token) mount(body, emptyState('alert', t('Could not load games'), e.message)); return; }
        if (my !== token || !alive) return;
        mount(body, r.games.length ? h('div.dg-grid', r.games.map((g) => h('a.dg-card', ext(g.url), h('div.dg-art', img(g.thumb, g.title)), h('div.dg-info', h('b', g.title), h('p.small.muted', g.text), h('div.dg-tags', h('span', g.genre), h('span', g.platform), h('span.free', t('Free'))))))) : emptyState('search', t('No games match'), ''),
          h('p.tiny.muted.dg-src', t('{n} free games · data by', { n: r.total }), ' ', h('a', ext(r.source.url), r.source.name), '. ', t('Games open on their official sites.')));
      } else {
        const f = st.deals;
        let r; try { r = await api.get('/api/discover/deals?' + new URLSearchParams({ sort: f.sort, upper: f.upper, store: f.store, free: f.free ? '1' : '', q: q.value })); } catch (e) { if (my === token) mount(body, emptyState('alert', t('Could not load deals'), e.message)); return; }
        if (my !== token || !alive) return;
        if (ctl !== 'deals') { ctl = 'deals'; mount(controls, q, sel([['', 'All stores'], ...r.stores.map((s) => [s.id, s.name])], f.store, (v) => { f.store = v; show(); }, t('Store')), sel([['', 'Any price'], ['5', 'Under 5 $'], ['10', 'Under 10 $'], ['20', 'Under 20 $']], f.upper, (v) => { f.upper = v; show(); }, t('Price')),
          sel([['Deal Rating', 'Best deals'], ['Savings', 'Biggest discount'], ['Price', 'Cheapest'], ['Metacritic', 'Best reviewed'], ['recent', 'Newest deals']], f.sort, (v) => { f.sort = v; show(); }, t('Sort')),
          h('label.dg-chk', h('input', { type: 'checkbox', checked: f.free, onChange: (e) => { f.free = e.target.checked; show(); } }), t('Free right now'))); }
        mount(body, r.deals.length ? h('div.dg-grid.deals', r.deals.map((d) => h('a.dg-card.deal', ext(d.url), h('div.dg-art', img(d.thumb, d.title), d.savings ? h('span.dg-off', '−' + d.savings + '%') : null), h('div.dg-info', h('b', d.title),
          h('div.dg-price', d.price === 0 ? h('strong.free', t('Free')) : h('strong', '$' + d.price.toFixed(2)), d.normal > d.price ? h('s.muted', '$' + d.normal.toFixed(2)) : null),
          h('div.dg-tags', h('span', d.store), d.metacritic ? h('span', 'Metacritic ' + d.metacritic) : null, d.steam ? h('span', 'Steam: ' + d.steam) : null))))) : emptyState('search', t('No deals match'), ''),
          h('p.tiny.muted.dg-src', t('Prices in US dollars from official stores · data by'), ' ', h('a', ext(r.source.url), r.source.name), '. ', t('Buying happens on the store’s own site.')));
      }
    }
    q.addEventListener('input', debounce(() => show(), 450));
    mount(root, h('div.inner.dg', h('div.page-title', h('div', h('h2', icon('gamepad', 22), ' ', t('Discover games')), h('p', t('Free-to-play games and the best current deals from official stores. Nebulix links to them; it does not host them.')))), tabs, controls, body));
    show();
    return () => { alive = false; };
  },
};

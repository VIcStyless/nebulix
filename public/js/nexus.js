// Nexus navigation (default since 8.0): a slim orbit bar with five big categories, Favourites and More. Hovering or
// tapping a category opens a drawer with that category's apps as rich rows (colour tile, name, description, live
// badges, a star to pin favourites) and a search box. The drawer can be pinned open. On phones the bar becomes a
// bottom tab bar and the drawer a bottom sheet.
import { h, mount, ls } from './util.js';
import { t } from './i18n.js';
import { icon, logoMark } from './icons.js';
import { S, bus } from './state.js';
import { avatarEl } from './cosmetics.js';
import { appTile, metaOf } from './apps-meta.js';

const CAT_IC = { '': 'home', Social: 'users', Play: 'gamepad', Economy: 'coins', Create: 'edit' };
const CAT_NAME = { '': 'Home', Social: 'Social', Play: 'Games', Economy: 'Economy', Create: 'Create' };

export function buildNexus({ groups, more, go, palette, accountMenu, badgeFor }) {
  const cats = groups.map(([g, items]) => ({ id: g || 'home', name: CAT_NAME[g] || g, ic: CAT_IC[g] || 'grid', items }));
  cats.push({ id: 'more', name: 'More', ic: 'more', items: more });
  const all = cats.flatMap((c) => c.items.map((x) => ({ k: x[0], l: x[1], ic: x[2], cat: c.id })));
  const catOf = (k) => (all.find((x) => x.k === k) || {}).cat || null;
  let open = null; let pinned = !!ls('nx.pin'); let lastCat = ls('nx.cat') || 'Play'; let active = 'home'; let closeT = 0; let openT = 0; let q = ''; let bossLive = false; let openedAt = 0; let built = false;
  const favs = () => (Array.isArray(ls('nx.favs')) ? ls('nx.favs') : ['games', 'worlds', 'chat']);
  const P = () => pinned && innerWidth > 760; // pinning only applies on wide screens
  const coarse = () => matchMedia('(pointer: coarse)').matches || innerWidth <= 760;

  const bar = h('div.nx-bar'); const drawer = h('div.nx-drawer', { role: 'dialog', 'aria-label': t('Apps') }); const el = h('nav.nexus', { 'aria-label': 'Main' }, bar, drawer);
  const search = h('input.input.nx-q', { placeholder: t('Filter apps…'), 'aria-label': t('Filter apps'), onInput: (e) => { q = e.target.value.trim().toLowerCase(); paintDrawer(); } });

  function catBtn(c) {
    return h('button.nx-cat', { type: 'button', 'data-cat': c.id, 'aria-label': t(c.name), 'aria-expanded': 'false',
      onClick: () => { if (c.id === 'home' && !coarse()) { go('home'); show(null); return; } if (open === c.id && Date.now() - openedAt < 600) return; show(open === c.id && !P() ? null : c.id); },
      onPointerenter: () => { if (coarse()) return; clearTimeout(closeT); clearTimeout(openT); openT = setTimeout(() => show(c.id), open || P() ? 0 : 140); },
    }, h('span.nx-ci', icon(c.ic, 21)), h('span.nx-cl', t(c.name)), h('span.nx-mark'));
  }
  function updateBar() {
    for (const b of bar.querySelectorAll('.nx-cat[data-cat]')) {
      const c = cats.find((x) => x.id === b.dataset.cat); if (!c) continue;
      b.classList.toggle('on', catOf(active) === c.id); b.classList.toggle('open', open === c.id); b.setAttribute('aria-expanded', String(open === c.id));
      const unread = c.items.reduce((a, x) => a + (badgeFor(x[0]) || 0), 0); const live = c.id === 'Play' && bossLive;
      const m = b.querySelector('.nx-mark'); const want = unread ? 'nx-dot' : live ? 'nx-live' : ''; const txt = unread ? (unread > 99 ? '99+' : String(unread)) : '';
      if (m.className !== 'nx-mark ' + want || m.textContent !== txt) { m.className = 'nx-mark ' + want; m.textContent = txt; }
    }
    const fb = bar.querySelector('.nx-fav'); if (fb) fb.classList.toggle('open', open === 'fav');
  }
  function paintBar() {
    if (built) return updateBar(); built = true;
    mount(bar,
      h('a.nx-brand', { href: '#/home', title: 'Nebulix', 'aria-label': 'Nebulix' }, logoMark(30, 'nx-logo')),
      h('div.nx-cats', cats.filter((c) => c.id !== 'more').map(catBtn)),
      h('div.nx-sep'),
      h('button.nx-cat.nx-fav', { type: 'button', 'aria-label': t('Favourites'), onClick: () => show(open === 'fav' && !P() ? null : 'fav'), onPointerenter: () => { if (!coarse()) { clearTimeout(closeT); show('fav'); } } }, h('span.nx-ci', icon('star', 20)), h('span.nx-cl', t('Favourites'))),
      h('div.grow'),
      h('button.nx-cat.nx-search', { type: 'button', 'aria-label': t('Search'), title: t('Search') + ' (Ctrl K)', onClick: () => { show(null); palette(); } }, h('span.nx-ci', icon('search', 20)), h('span.nx-cl', t('Search'))),
      catBtn(cats.find((c) => c.id === 'more')),
      h('button.nx-me', { type: 'button', 'aria-label': t('Account'), onClick: (e) => accountMenu(e.currentTarget) }, avatarEl(S.me, { size: 36, status: true, frame: false })));
    updateBar();
  }
  function row(x) {
    const [, , desc] = metaOf(x.k); const n = badgeFor(x.k); const fav = favs().includes(x.k);
    return h('a.nx-app' + (x.k === active ? '.on' : ''), { href: '#/' + x.k, onClick: () => { if (!P()) setTimeout(() => show(null), 0); } },
      appTile(x.k, x.ic, 38), h('span.nx-at', h('b', t(x.l)), desc ? h('span', t(desc)) : null),
      x.k === 'boss' && bossLive ? h('span.nx-badge.live', t('Live')) : n ? h('span.nx-badge', n > 99 ? '99+' : String(n)) : null,
      h('button.nx-star' + (fav ? '.on' : ''), { type: 'button', 'aria-label': fav ? t('Remove from favourites') : t('Add to favourites'), title: fav ? t('Remove from favourites') : t('Add to favourites'),
        onClick: (e) => { e.preventDefault(); e.stopPropagation(); const f = favs().filter((k) => k !== x.k); if (!fav) f.push(x.k); ls('nx.favs', f); paintDrawer(); } }, fav ? '★' : '☆'));
  }
  function paintDrawer() {
    const id = open || (P() ? lastCat : null); if (!id) { mount(drawer); return; }
    let title, list;
    if (q) { title = t('Results'); list = all.filter((x) => t(x.l).toLowerCase().includes(q) || x.k.includes(q) || t(metaOf(x.k)[2]).toLowerCase().includes(q)); }
    else if (id === 'fav') { title = t('Favourites'); list = favs().map((k) => all.find((x) => x.k === k)).filter(Boolean); }
    else { const c = cats.find((x) => x.id === id); title = t(c.name); list = c.items.map((x) => all.find((y) => y.k === x[0])); }
    mount(drawer,
      h('div.nx-dh', h('b.grow', title), h('button.nx-ib.nx-pin' + (P() ? '.on' : ''), { type: 'button', title: pinned ? t('Unpin the panel') : t('Keep the panel open'), 'aria-label': pinned ? t('Unpin the panel') : t('Keep the panel open'), onClick: () => { pinned = !pinned; ls('nx.pin', pinned); if (!pinned) show(null); else { lastCat = id === 'fav' ? lastCat : id; layout(); paintDrawer(); } } }, icon('pin', 15)),
        P() ? null : h('button.nx-ib', { type: 'button', 'aria-label': t('Close'), onClick: () => show(null) }, icon('x', 15))),
      search,
      list.length ? h('div.nx-list', list.map(row)) : h('p.nx-empty', id === 'fav' && !q ? t('Tap ☆ on any app to keep it here.') : t('No apps match.')));
  }
  function layout() { el.classList.toggle('pinned', P()); el.classList.toggle('drawer-open', !!(open || P())); document.documentElement.classList.toggle('nx-pinned', P()); }
  addEventListener('resize', () => { layout(); paintDrawer(); });
  function show(id) {
    clearTimeout(openT); if (id && id !== open) openedAt = Date.now(); open = id; if (id && id !== 'fav' && id !== 'more') { lastCat = id; ls('nx.cat', id); }
    if (!id) { q = ''; search.value = ''; }
    layout(); paintBar(); paintDrawer();
    if (id && !coarse()) setTimeout(() => { if (open === id && document.activeElement && !el.contains(document.activeElement)) search.focus({ preventScroll: true }); }, 30);
  }
  el.addEventListener('pointerleave', () => { if (coarse() || P()) { if (P() && open) { open = null; paintBar(); } return; } clearTimeout(openT); closeT = setTimeout(() => show(null), 280); });
  el.addEventListener('pointerenter', () => clearTimeout(closeT));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open && !P()) show(null); });
  document.addEventListener('pointerdown', (e) => { if (open && !P() && !el.contains(e.target)) show(null); });
  bus.on('ws:boss', (m) => { const was = bossLive; bossLive = m.ev === 'spawn' || m.ev === 'hp' || m.ev === 'power'; if (was !== bossLive) { paintBar(); paintDrawer(); } });
  layout(); paintBar(); paintDrawer();
  return {
    el,
    setActive(name) { active = name; paintBar(); if (open || P()) paintDrawer(); },
    refresh() { paintBar(); if (open || P()) paintDrawer(); },
    setBoss(v) { bossLive = !!v; paintBar(); },
    catName: (name) => { const c = cats.find((x) => x.id === catOf(name)); return c ? t(c.name) : ''; },
  };
}

// Game library: a personal backlog board. Drag games between Backlog / Playing / Finished / Dropped,
// rate them, log hours and keep a short note. Stats on top.
import { h, mount, fmt } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { toastErr, modal, field, promptBox, confirmBox, openMenu, loading } from '../ui.js';

const COLS = () => [['backlog', t('Backlog'), 'inbox'], ['playing', t('Playing'), 'play'], ['done', t('Finished'), 'check'], ['dropped', t('Dropped'), 'x']];

export default {
  title: () => t('Game library'),
  async mount(root) {
    let games = []; let q = '';
    const stats = h('div.kpis'); const board = h('div.lib-cols', loading());
    const name = h('input.input', { placeholder: t('Add a game… (press Enter)'), maxlength: 60, onKeydown: (e) => { if (e.key === 'Enter') add(); } });
    const search = h('input.input', { type: 'search', placeholder: t('Search your library'), onInput: (e) => { q = e.target.value.trim().toLowerCase(); paint(); } });
    mount(root, h('div.inner', { style: 'max-width:1280px' },
      h('div.page-title', h('div', h('h2', t('Game library')), h('p', t('Track what you are playing, what is next and what you finished.')))),
      stats, h('div.toolbar', { style: 'margin-top:16px' }, name, h('button.btn.primary', { onClick: add }, icon('plus', 16), t('Add')), search, h('button.btn', { onClick: pickForMe, title: t('Pick a random game from your backlog') }, icon('dice', 16), t('Pick for me'))), board));

    async function load() { try { games = (await api.get('/api/library')).games; } catch (e) { toastErr(e); } paint(); }
    function paintStats() {
      const k = (l, v) => h('div.kpi', h('span', l), h('b', v));
      const hrs = games.reduce((a, g) => a + (g.hours || 0), 0); const rated = games.filter((g) => g.rating); const avg = rated.length ? (rated.reduce((a, g) => a + g.rating, 0) / rated.length).toFixed(1) : '—';
      stats.replaceChildren(k(t('Games'), fmt.num(games.length)), k(t('Playing now'), String(games.filter((g) => g.status === 'playing').length)), k(t('Finished'), String(games.filter((g) => g.status === 'done').length)), k(t('Hours logged'), fmt.num(Math.round(hrs))), k(t('Average rating'), avg));
      stats.style.gridTemplateColumns = 'repeat(5, minmax(0, 1fr))';
    }
    function paint() {
      paintStats();
      const vis = games.filter((g) => !q || g.name.toLowerCase().includes(q));
      mount(board, COLS().map(([k, label, ic]) => {
        const items = vis.filter((g) => g.status === k);
        const col = h('div.lib-col', { dataset: { k } }, h('h4', icon(ic, 14), label, h('span.n', String(items.length))), items.map(card),
          !items.length ? h('div.tiny.muted', { style: 'padding:8px 4px' }, t('Drop games here')) : null);
        col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
        col.addEventListener('dragleave', () => col.classList.remove('drop'));
        col.addEventListener('drop', (e) => { e.preventDefault(); col.classList.remove('drop'); const id = e.dataTransfer.getData('text/plain'); const g = games.find((x) => x.id === id); if (g && g.status !== k) update(g, { status: k }); });
        return col;
      }));
    }
    function stars(g) {
      return h('span.stars', [1, 2, 3, 4, 5].map((n) => h('button' + (n <= g.rating ? '.on' : ''), { type: 'button', title: n + '/5', onClick: (e) => { e.stopPropagation(); update(g, { rating: g.rating === n ? 0 : n }); } }, icon('star', 13))));
    }
    function card(g) {
      const el = h('div.game-card', { draggable: 'true', onContextmenu: (e) => { e.preventDefault(); menu(g, e); } },
        h('div.row', h('b.grow.ellipsis', g.name), h('button.btn.ghost.icon.sm', { 'aria-label': t('More'), onClick: (e) => menu(g, e.currentTarget) }, icon('more', 14))),
        h('div.row', stars(g), h('div.grow'), h('span.hours', g.hours ? t('{n} h', { n: g.hours }) : '')),
        g.note ? h('div.tiny.muted', g.note) : null);
      el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', g.id); el.classList.add('dragging'); });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
      return el;
    }
    function menu(g, at) {
      openMenu([
        ...COLS().filter(([k]) => k !== g.status).map(([k, l, ic]) => ({ label: t('Move to {c}', { c: l }), icon: ic, onClick: () => update(g, { status: k }) })),
        { hr: true },
        { label: t('Log hours'), icon: 'clock', onClick: async () => { const v = await promptBox(t('Hours played'), { type: 'number', value: String(g.hours || 0) }); if (v !== null) update(g, { hours: +v }); } },
        { label: t('Edit note'), icon: 'edit', onClick: async () => { const v = await promptBox(t('Note'), { value: g.note || '', multiline: true }); if (v !== null) update(g, { note: v }); } },
        { label: t('Rename'), icon: 'edit', onClick: async () => { const v = await promptBox(t('Rename'), { value: g.name }); if (v) update(g, { name: v }); } },
        { hr: true },
        { label: t('Remove'), icon: 'trash', danger: true, onClick: async () => { if (await confirmBox(t('Remove {g} from your library?', { g: g.name }), { danger: true, ok: t('Remove') })) { try { await api.del('/api/library/' + g.id); games = games.filter((x) => x.id !== g.id); paint(); } catch (e) { toastErr(e); } } } },
      ], at);
    }
    // "Pick for me": a short slot-machine style shuffle over the backlog that settles on one game
    function pickForMe() {
      const pool = games.filter((g) => g.status === 'backlog'); const list = pool.length ? pool : games.filter((g) => g.status !== 'done' && g.status !== 'dropped');
      if (!list.length) return toastErr(new Error(t('Add some games to your backlog first.')));
      const name = h('div.pick-name', list[0].name); const sub = h('div.small.muted', t('Shuffling…'));
      let p; let i = 0; const total = 18 + Math.floor(Math.random() * list.length * 2); const choice = list[Math.floor(Math.random() * list.length)];
      const step = () => {
        i++; const g = i >= total ? choice : list[Math.floor(Math.random() * list.length)]; name.textContent = g.name; name.animate([{ transform: 'translateY(-8px)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 90 });
        if (i < total) setTimeout(step, 40 + i * i * 0.6); else { name.classList.add('done'); sub.textContent = t('Tonight you play this.'); btns.style.visibility = 'visible'; }
      };
      const btns = h('div.row', { style: 'justify-content:center;gap:8px;visibility:hidden' },
        h('button.btn', { onClick: () => { p.close(); pickForMe(); } }, icon('refresh', 15), t('Again')),
        h('button.btn.primary', { onClick: () => { p.close(); update(choice, { status: 'playing' }); } }, icon('play', 15), t('Start playing')));
      p = modal({ title: t('Pick for me'), cls: 'narrow', body: h('div.col.center', { style: 'gap:14px;padding:10px 0' }, h('div.pick-box', name), sub, btns), actions: [{ label: t('Close') }] });
      setTimeout(step, 120);
    }
    async function add() {
      const v = name.value.trim(); if (!v) return name.focus();
      try { const r = await api.post('/api/library', { name: v }); games.unshift(r.game); name.value = ''; paint(); } catch (e) { toastErr(e); }
    }
    async function update(g, patch) {
      Object.assign(g, patch); paint();
      try { const r = await api.patch('/api/library/' + g.id, patch); Object.assign(g, r.game); paint(); } catch (e) { toastErr(e); load(); }
    }
    await load();
    return () => {};
  },
};

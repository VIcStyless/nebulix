// Squads: "looking for group" board. Post what you are playing and how many players you need; slots fill up live.
import { h, mount, fmt } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S, bus } from '../state.js';
import { icon } from '../icons.js';
import { avatarEl, nameEl } from '../cosmetics.js';
import { toast, toastErr, modal, field, segEl, switchEl, emptyState, loading, confirmBox } from '../ui.js';
import { sendToFriend } from '../share.js';

const PLAT = () => ({ any: t('Any platform'), pc: 'PC', console: t('Console'), mobile: t('Mobile') });

export default {
  title: () => t('Squads'),
  async mount(root, ctx) {
    let list = []; let filter = 'all'; let q = '';
    const search = h('input.input', { type: 'search', placeholder: t('Filter by game or title'), 'aria-label': t('Filter by game or title'), onInput: (e) => { q = e.target.value.trim().toLowerCase(); paint(); } });
    const filters = h('div.filters', [['all', t('All')], ['open', t('Has space')], ['mine', t('Mine')], ['mic', t('Voice chat')]].map(([k, l]) => h('button.chip', { dataset: { k }, onClick: () => { filter = k; paint(); } }, l)));
    const grid = h('div.squad-grid', loading());
    mount(root, h('div.inner',
      h('div.page-title', h('div', h('h2', t('Squads')), h('p', t('Find teammates for right now. Squads close automatically after 6 hours.'))), h('button.btn.primary', { onClick: create }, icon('plus', 16), t('New squad'))),
      h('div.toolbar', search, filters), grid));

    async function load() { try { list = (await api.get('/api/squads')).squads; } catch (e) { toastErr(e); } paint(); }
    function paint() {
      [...filters.children].forEach((b) => b.classList.toggle('on', b.dataset.k === filter));
      const rows = list.filter((s) => (filter === 'all' || (filter === 'open' && !s.full) || (filter === 'mine' && (s.mine || s.joined)) || (filter === 'mic' && s.mic)) && (!q || (s.game + ' ' + s.title).toLowerCase().includes(q)));
      if (!rows.length) return mount(grid, h('div', { style: 'grid-column:1/-1' }, emptyState('target', t('No squads here yet'), t('Start one: pick a game, say how many players you need and others can jump in.'), h('button.btn.primary', { onClick: create }, t('New squad')))));
      mount(grid, rows.map(card));
    }
    function card(s) {
      const left = Math.max(0, s.expires - Date.now());
      const act = s.mine ? h('div.row', { style: 'gap:6px' }, h('button.btn.sm', { onClick: () => run(`/api/squads/${s.id}/bump`) }, icon('refresh', 14), t('Bump')), h('button.btn.sm.ghost', { onClick: async () => { if (await confirmBox(t('Close this squad?'), { danger: true, ok: t('Close') })) run(`/api/squads/${s.id}`, 'del'); } }, t('Close')))
        : s.joined ? h('button.btn.sm', { onClick: () => run(`/api/squads/${s.id}/leave`) }, t('Leave'))
          : h('button.btn.sm.primary', { disabled: s.full, onClick: () => run(`/api/squads/${s.id}/join`, 'post', t('You joined the squad. Say hi to the leader.')) }, s.full ? t('Full') : t('Join'));
      return h('article.card.squad' + (s.mine || s.joined ? '.mine' : ''),
        h('div.squad-top', h('div.squad-game', s.game.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2) || '?'), h('div.grow',
          h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, h('span.tag', s.game), h('span.tag', PLAT()[s.platform] || s.platform), s.mic ? h('span.tag.acc', icon('mic', 11), t('Voice')) : null, s.region ? h('span.tag', s.region) : null),
          h('h3', { style: 'margin-top:6px' }, s.title))),
        s.desc ? h('p', s.desc) : null,
        h('div.row', { style: 'gap:10px' }, h('div.slots', Array.from({ length: s.size }, (_, i) => h('i' + (i < s.members.length ? '.on' : '')))), h('span.tiny.muted', t('{a}/{b} players', { a: s.members.length, b: s.size }))),
        h('div.squad-foot', h('div.avstack', s.members.slice(0, 6).map((m) => avatarEl(m, { size: 26 }))), h('div.grow.tiny.muted', t('led by {n}', { n: s.owner.displayName || s.owner.username }) + ' · ' + t('closes in {t}', { t: fmt.dur(left / 1000) })),
          h('button.btn.ghost.icon.sm', { title: t('Invite a friend'), 'aria-label': t('Invite a friend'), onClick: () => sendToFriend(t('Join my squad in Nebulix: {s} ({g}) · Squads', { s: s.title, g: s.game })) }, icon('send', 15)),
          !s.mine && s.owner ? h('button.btn.ghost.icon.sm', { title: t('Message the leader'), 'aria-label': t('Message the leader'), onClick: () => ctx.go('dm', s.owner.id) }, icon('mail', 15)) : null, act));
    }
    async function run(path, method = 'post', ok) {
      try { if (method === 'del') await api.del(path); else await api.post(path); if (ok) toast(ok, 'good'); await load(); } catch (e) { toastErr(e); }
    }
    function create() {
      const game = h('input.input', { maxlength: 40, placeholder: 'Valorant, Minecraft, Rocket League…' });
      const title = h('input.input', { maxlength: 80, placeholder: t('Ranked duo, chill builds, need a healer…') });
      const desc = h('textarea.input', { maxlength: 300, rows: 3, placeholder: t('Rank, rules, how to reach you (optional)') });
      let size = 4; const sizeSeg = segEl([2, 3, 4, 5, 6, 8, 10].map((n) => [n, String(n)]), size, (v) => { size = v; });
      let plat = 'any'; const platSeg = segEl(Object.entries(PLAT()), plat, (v) => { plat = v; });
      const region = h('input.input', { maxlength: 20, placeholder: 'EU, NA, LATAM…' }); let mic = false;
      modal({ title: t('New squad'), body: h('div.col', field(t('Game'), game), field(t('Title'), title), field(t('Players needed (including you)'), sizeSeg), field(t('Platform'), platSeg),
        h('div.grid.cols-2', field(t('Region (optional)'), region), field(t('Voice chat'), h('div.row', switchEl(false, (v) => { mic = v; }), h('span.small.muted', t('Mic recommended'))))), field(t('Details'), desc)),
        actions: [{ label: t('Cancel') }, { label: t('Post squad'), kind: 'primary', onClick: async () => { try { await api.post('/api/squads', { game: game.value, title: title.value, desc: desc.value, size, platform: plat, region: region.value, mic }); toast(t('Squad posted. Others can join now.'), 'good'); load(); } catch (e) { toastErr(e); return false; } } }] });
    }
    const off = bus.on('ws:squads', () => load());
    const timer = setInterval(paint, 60000);
    await load();
    return () => { off(); clearInterval(timer); };
  },
};

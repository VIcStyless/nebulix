// Nebulix Live: everything notable happening on Nebulix, as it happens (bosses, tournaments, worlds, clans, leagues,
// levels and Arcade records). #/live
import { h, mount } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { bus } from '../state.js';
import { loading, emptyState } from '../ui.js';
import { feedItem } from '../widgets/feed.js';

const KINDS = [['', 'All', '✨'], ['boss', 'World Boss', '👹'], ['tournament', 'Tournaments', '🏆'], ['world', 'Worlds', '🧱'], ['clan', 'Clans', '🛡️'], ['league', 'Leagues', '🏅'], ['level', 'Levels', '⭐'], ['record', 'Records', '👑']];

export default {
  title: () => t('Nebulix Live'),
  async mount(root) {
    const inner = h('div.inner.fd-page'); mount(root, inner, loading()); let kind = ''; let items = []; const list = h('div.fd-list');
    const load = async () => { try { items = (await api.get('/api/feed?n=100' + (kind ? '&kind=' + kind : ''))).items; paint(); } catch (e) { mount(list, emptyState('alert', t('Could not load this'), e.message)); } };
    const chips = h('div.gh-chips');
    const paintChips = () => mount(chips, KINDS.map(([k, l, e]) => h('button.chip' + (k === kind ? '.on' : ''), { type: 'button', onClick: () => { kind = k; paintChips(); load(); } }, e + ' ' + t(l))));
    function paint(fresh) { mount(list, items.length ? items.map((e) => feedItem(e, { fresh: fresh === e.id })) : emptyState('activity', t('Nothing yet'), t('Big moments on Nebulix appear here as they happen.'))); }
    mount(inner, h('div.page-title', h('div', h('h2', h('span.fd-dot'), ' ', t('Nebulix Live')), h('p', t('Every big moment on Nebulix, as it happens: bosses, tournament winners, new worlds, clans, league champions, levels and records.')))), chips, list);
    paintChips(); await load();
    const off = bus.on('ws:feed', (m) => { if (kind && m.e.kind !== kind) return; items.unshift(m.e); items = items.slice(0, 100); paint(m.e.id); });
    const tick = setInterval(() => paint(), 30000);
    return () => { off(); clearInterval(tick); };
  },
};

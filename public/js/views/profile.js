// Public profile: #/profile/<username> — shows a user's card, badges, stats and actions (message, add friend, block, report).
import { h, mount, fmt } from '../util.js';
import { roleChip, SITE_ROLES } from '../roles.js';
import { t, pick2 } from '../i18n.js';
import { api } from '../api.js';
import { S } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, promptBox, confirmBox, loading } from '../ui.js';
import { profileCard, badgeGlyph } from '../cosmetics.js';
import { progressDefs, RARITY } from '../progress-fx.js';
import { actText, statusText } from '../status.js';
import { avatarStage } from '../avatar3d.js';

export default {
  title: () => t('Profile'),
  async mount(root, ctx) {
    const go = ctx.go;
    const name = ctx.params[0] || (S.me && S.me.username);
    if (!name) { mount(root, h('div.page', h('div.empty', h('div.empty-art.ea-mark'), h('h3', t('No user named'))))); return () => {}; }
    const wrap = h('div.page.profile', loading(t('Loading profile…'))); mount(root, wrap);

    let data, rel;
    try {
      data = (await api.get('/api/users/by-name/' + encodeURIComponent(name)));
      rel = await api.get('/api/users/' + data.user.id).catch(() => ({ friend: false }));
    } catch (e) {
      mount(wrap, h('div.empty', h('div.empty-art.ea-mark'), h('h3', t('User not found')), h('p.muted', t('No player named "{n}".', { n: name })), h('button.btn', { onClick: () => go('chat') }, t('Back to community'))));
      return () => {};
    }
    const u = data.user; const me = u.id === S.me.id;
    const [prog, defs, pcard] = await Promise.all([api.get('/api/users/' + u.id + '/progress', { quiet: true }).catch(() => null), progressDefs(), api.get('/api/players/' + u.id + '/card', { quiet: true }).catch(() => null)]);

    let stage = null;
    function paint() {
      if (stage) { stage.destroy(); stage = null; }
      const actions = h('div.row.wrap.pf-actions');
      if (me) actions.appendChild(h('button.btn.primary', { onClick: () => go('settings') }, icon('edit', 16), t('Edit my profile')));
      else {
        actions.appendChild(h('button.btn.primary', { onClick: () => go('dm', u.id) }, icon('mail', 16), t('Message')));
        if (rel.friend) actions.appendChild(h('button.btn', { onClick: async () => { if (await confirmBox(t('Remove {n} from your friends?', { n: u.displayName || u.username }))) { try { await api.del('/api/friends/' + u.id); rel.friend = false; toast(t('Removed.'), 'good'); paint(); } catch (e) { toastErr(e); } } } }, icon('users', 16), t('Friends')));
        else if (rel.incoming) actions.appendChild(h('button.btn.primary', { onClick: () => reqFriend() }, icon('check', 16), t('Accept friend request')));
        else if (rel.pending) actions.appendChild(h('button.btn', { disabled: true }, t('Request sent')));
        else actions.appendChild(h('button.btn', { onClick: () => reqFriend() }, icon('plus', 16), t('Add friend')));
        actions.appendChild(h('button.btn.ghost', { onClick: () => block() }, icon('eyeoff', 16), t('Block')));
        actions.appendChild(h('button.btn.ghost', { onClick: () => report() }, icon('flag', 16), t('Report')));
      }
      const joined = u.created ? fmt.date(u.created) : null;
      const stats = h('div.pf-stats',
        statCard(icon('crown', 18), u.pro ? 'PRO' : t('Free'), t('Membership')),
        joined ? statCard(icon('clock', 18), joined, t('Joined')) : null,
        statCard(icon('dice', 18), fmt.compact(data.stats ? data.stats.wagered || 0 : 0), t('Coins wagered')),
        statCard(icon(u.online ? 'wifi' : 'clock', 18), u.online ? t('Online') : t('Offline'), t('Status')));
      const lv = prog && prog.level; const show = ((prog && prog.showcase) || []).map((id) => defs.achievements.find((a) => a.id === id)).filter(Boolean);
      const st = statusText(S.statuses[u.id] || u.status); const ac = S.acts[u.id] || u.act;
      const extra = h('div.col.gap-s',
        st || ac ? h('div.card.tight.pf-now', st ? h('div', st) : null, ac ? h('div.small.muted', actText(ac)) : null) : null,
        lv ? h('div.card.tight.pf-lvl', h('span.lvl-ring', { style: `--p:${Math.round(lv.into / Math.max(1, lv.need) * 100)}` }, h('b', String(lv.level))), h('div.grow', h('b', t('Level {n}', { n: lv.level })), h('div.xpbar.sm', h('i', { style: `width:${Math.round(lv.into / Math.max(1, lv.need) * 100)}%` }))), h('span.tiny.muted', t('{n} achievements', { n: (prog.achievements || []).length }))) : null,
        (u.groles || []).length || SITE_ROLES[u.role] ? h('div.row.wrap.gap-s', SITE_ROLES[u.role] ? roleChip(SITE_ROLES[u.role], { title: t('Staff role') }) : null, (u.groles || []).map((g) => roleChip(g, { title: t('Community role') }))) : null,
        show.length ? h('div.pf-show', show.map((a) => h('div.pf-ach', { style: `--rc:${RARITY[a.rarity] || RARITY.common}`, title: t(a.desc) }, h('span', badgeGlyph(a.icon)), h('b.small', t(a.name))))) : null,
        gamesCard(data.games));
      // their 3D avatar (the character they use in the 3D casino)
      const av3card = u.av3 ? h('div.card.tight.pf-av3', (stage = avatarStage(u.av3, { size: 220 })), h('div.tiny.muted', t('3D avatar · drag to turn'))) : me ? h('div.card.tight.pf-av3', h('p.small.muted', t('You do not have a 3D avatar yet.')), h('button.btn.sm.primary', { onClick: () => go('avatar') }, t('Create my 3D avatar'))) : null;
      if (av3card) extra.prepend(av3card);
      if (pcard) extra.prepend(playerCard(pcard));
      mount(wrap, h('div.pf-wrap', h('div.pf-card', profileCard(u)), h('div.pf-side', actions, extra, stats)));
    }
    // what they are playing, from their Game library (hidden when they turned it off in Privacy)
    function gamesCard(g) {
      if (!g || (!g.playing.length && !g.favorites.length)) return null;
      const row = (x, ic) => h('div.row', { style: 'gap:8px' }, h('span.muted', icon(ic, 14)), h('span.grow.ellipsis', x.name), x.hours ? h('span.tiny.muted', t('{n} h', { n: x.hours })) : null);
      return h('div.card.tight', h('div.card-head', { style: 'margin-bottom:8px' }, h('h3', icon('layers', 15), t('Game library'))),
        g.playing.length ? h('div.col', { style: 'gap:6px' }, h('div.eyebrow', t('Playing now')), g.playing.map((x) => row(x, 'play'))) : null,
        g.favorites.length ? h('div.col', { style: 'gap:6px;margin-top:10px' }, h('div.eyebrow', t('Favorites')), g.favorites.map((x) => row(x, 'star'))) : null,
        h('div.tiny.muted', { style: 'margin-top:10px' }, t('{a} games · {b} finished · {c} h played', { a: g.total, b: g.done, c: g.hours })));
    }
    // player card: league, clan, level and the big numbers from the 6.0+ features
    function playerCard(c) {
      const cell = (e, v, l, href) => h(href ? 'a.pc-cell' : 'div.pc-cell', href ? { href } : {}, h('span.pc-e', /^[a-z]+$/.test(e) ? icon(e, 18) : e), h('b', v), h('span', l));
      return h('div.pc', { style: { '--lg': c.league.color } },
        h('div.pc-top', h('div.pc-badge', c.league.icon), h('div.grow', h('div.tiny.pc-k', t('Player card')), h('b.pc-lg', t('League') + ' ' + pick2(c.league.n)), c.clan ? h('a.pc-clan', { href: '#/clans', style: { '--cl': c.clan.color } }, h('span.pc-tag', c.clan.tag), ' ' + c.clan.emoji + ' ' + c.clan.name) : h('span.tiny.muted', t('No clan')), u.rk ? h('a', { href: '#/ranked', style: 'margin-left:8px', title: t('Competitive') }, h('span.rk-pill', { style: { '--rc': u.rk.c } }, pick2(u.rk.n))) : null),
          h('div.pc-lvl', h('b', String(c.level)), h('span', t('Level')))),
        h('div.pc-grid', cell('zap', fmt.num(c.boss.kills), t('Bosses defeated'), '#/boss'), cell('target', fmt.compact(c.boss.best), t('Best boss damage')), cell('trophy', fmt.num(c.tournaments), t('Tournaments won'), '#/tournaments'),
          cell('cube', fmt.num(c.worlds.made), t('Worlds published'), '#/worlds'), cell('user', fmt.num(c.worlds.players), t('Players in their worlds')), cell('star', c.season ? c.season.tier + '/' + c.season.tiers : '—', t('Season tier'))),
        c.arcade.length ? h('div.pc-arc', h('div.tiny.pc-k', t('Arcade bests')), c.arcade.map((a) => h('span.pc-ag', h('a', { href: '#/arcade?play=' + a.game, style: 'color:inherit;text-decoration:none' }, a.name + ' ', h('b', fmt.num(a.best))),
          me ? null : h('button', { type: 'button', title: t('Challenge them to beat your best'), onClick: async () => { try { const r = await api.post('/api/challenges', { to: u.id, game: a.game }); toast(t('Challenge sent: beat {s} in {g}', { s: fmt.num(r.score), g: r.gname }), 'good'); } catch (e) { toastErr(e); } } }, icon('swords', 13), ' ' + t('Challenge'))))) : null);
    }
    const statCard = (ic, v, l) => h('div.pf-stat', h('div.pf-stat-ic', ic), h('div', h('b', v), h('div.tiny.muted', l)));

    async function reqFriend() { try { const r = await api.post('/api/friends/request', { username: u.username }); rel.pending = !r.accepted; rel.friend = !!r.accepted; rel.incoming = false; toast(r.accepted ? t('You are now friends!') : t('Friend request sent.'), 'good'); paint(); } catch (e) { toastErr(e); } }
    async function block() { if (!(await confirmBox(t('Block {n}? They will not be able to message or add you.', { n: u.displayName || u.username }), { danger: true }))) return; try { await api.post('/api/block/' + u.id); toast(t('Blocked.'), 'good'); go('chat'); } catch (e) { toastErr(e); } }
    async function report() { const reason = await promptBox(t('Report {n}', { n: u.username }), { label: t('What is wrong?'), multiline: true, placeholder: t('Describe the problem…') }); if (!reason || !reason.trim()) return; try { await api.post('/api/reports', { type: 'user', target: u.id, reason: reason.trim() }); toast(t('Thanks — the moderators will take a look.'), 'good'); } catch (e) { toastErr(e); } }

    paint();
    return () => { if (stage) stage.destroy(); };
  },
};

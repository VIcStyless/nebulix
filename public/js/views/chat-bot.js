// Community, part 3 (Nebulix 9.1): how bot messages look (embeds, buttons, rank cards, giveaways) and the
// "Bot & moderation" panel: bot, welcome, levels, AutoMod, custom commands, tickets, role buttons, mod log and bans.
import { h, mount, fmt, download } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S } from '../state.js';
import { icon } from '../icons.js';
import { avatarEl } from '../cosmetics.js';
import { richText } from '../rich.js';
import { modal, field, switchEl, toast, toastErr, tabsEl, loading, emptyState, confirmBox } from '../ui.js';
import { can, roleChip } from './chat-roles.js';

export const botUser = (m) => ({ id: 'bot', username: (m.b && m.b.n) || 'Nebubot', displayName: (m.b && m.b.n) || 'Nebubot', badges: [], eq: {}, system: true, bot: true, icon: (m.b && m.b.i) || '🤖' });
// "<t:1700000000000>" in bot text → a local date
const timeTok = (s) => String(s || '').replace(/<t:(\d+)>/g, (_, n) => { const v = Number(n); return v ? fmt.dt(v) : '—'; });

export function botExtras(m, { chId, go, onChannel, userOf }) {
  const out = [];
  if (m.rank) {
    const r = m.rank; const pct = Math.max(2, Math.min(100, Math.round((r.into / Math.max(1, r.need)) * 100))); const u = userOf(r.uid);
    out.push(h('div.bt-rank', avatarEl(u, { size: 64 }), h('div.grow', h('div.row', { style: 'align-items:baseline;gap:8px' }, h('b.bt-rname', r.name), h('span.grow'), h('span.bt-rk', '#' + r.rank), h('span.bt-lv', t('Level') + ' ', h('b', String(r.lvl)))),
      h('div.bt-bar', h('i', { style: { width: pct + '%' } })), h('div.tiny.muted', `${fmt.num(r.into)} / ${fmt.num(r.need)} XP · ${fmt.num(r.xp)} XP ${t('in total')} · ${fmt.num(r.msgs)} ${t('messages')}`))));
  }
  if (m.lv) out.push(h('div.bt-lvup', h('span.bt-lvn', String(m.lv.lvl)), h('span', t('Level up!')), m.lv.role ? h('span.pill', '🎁 ' + m.lv.role) : null));
  if (m.em) {
    const e = m.em;
    out.push(h('div.bt-embed', { style: { '--ec': e.color || '#5865f2' } },
      e.title ? h('div.bt-etitle', timeTok(e.title)) : null, e.desc ? h('div.bt-edesc', richText(timeTok(e.desc), { go, me: S.me.username })) : null,
      e.fields && e.fields.length ? h('div.bt-fields' + (e.fields.length > 6 ? '.list' : ''), e.fields.map(([k, v]) => h('div.bt-field', h('b', timeTok(k)), h('span', richText(timeTok(v), { go, me: S.me.username }))))) : null,
      e.thumb ? h('div.bt-thumb', avatarEl(userOf(e.thumb), { size: 56 })) : null, e.footer ? h('div.bt-foot.tiny.muted', e.footer) : null));
  }
  if (m.bt && m.bt.length) {
    out.push(h('div.bt-btns', m.bt.map((b) => {
      const isGw = b.id === 'gw_join'; const label = isGw && m.gw ? (m.gw.me ? '✓ ' + t('Entered') : b.label) + ' · ' + (m.gw.n || 0) : b.label;
      return h('button.btn.sm.bt-b.' + (b.style || 'ghost') + (isGw && m.gw && m.gw.me ? '.on' : ''), { type: 'button', style: b.color ? { '--rc': b.color } : null, onClick: async (ev) => {
        const el = ev.currentTarget; el.disabled = true;
        try {
          const r = await api.post(`/api/channels/${chId}/messages/${m.id}/button`, { id: b.id });
          if (r.channel) { toast(r.existing ? t('You already have an open ticket.') : t('Ticket created'), 'good'); onChannel && onChannel(r.channel); }
          else if (r.role) toast((r.added ? t('Role added: {r}', { r: r.role }) : t('Role removed: {r}', { r: r.role })), 'good');
          else if (isGw) { m.gw = Object.assign({}, m.gw, { me: r.joined, n: r.entries }); toast(r.joined ? t('You entered the giveaway. Good luck!') : t('You left the giveaway.'), 'good'); el.textContent = (r.joined ? '✓ ' + t('Entered') : b.label) + ' · ' + r.entries; el.classList.toggle('on', r.joined); }
          else if (r.deleted) toast(t('Channel deleted'), 'good');
        } catch (e) { toastErr(e); }
        el.disabled = false;
      } }, label);
    })));
  }
  if (m.eph) out.push(h('div.bt-eph.tiny', icon('eyeoff', 12), ' ' + t('Only you can see this')));
  return out;
}

// ---------------- Bot & moderation panel ----------------
export async function communityPanel(sv, { start = 'bot', onChannel } = {}) {
  const isMgr = can(sv, 'manage_server'); const isMod = ['kick', 'ban', 'timeout', 'manage_messages'].some((p) => can(sv, p));
  const tabsList = [isMgr ? ['bot', t('Bot'), 'spark'] : null, isMgr ? ['welcome', t('Welcome'), 'smile'] : null, ['levels', t('Levels'), 'trophy'], isMgr ? ['automod', 'AutoMod', 'shield'] : null, isMgr ? ['cmds', t('Commands'), 'terminal'] : null,
    ['tickets', t('Tickets'), 'mail'], can(sv, 'manage_roles') ? ['roles', t('Role buttons'), 'users'] : null, isMod ? ['log', t('Mod log'), 'clock'] : null, can(sv, 'ban') ? ['bans', t('Bans'), 'lock'] : null].filter(Boolean);
  let tab = tabsList.some((x) => x[0] === start) ? start : tabsList[0][0];
  const body = h('div.col.bt-panel'); let cfg = null; let help = [];
  if (isMgr) { try { const r = await api.get(`/api/servers/${sv.id}/bot`); cfg = r.bot; help = r.help; } catch (e) { toastErr(e); } }
  const chans = () => sv.channels.filter((c) => !c.private);
  const chSel = (val, onChange, none = t('First text channel')) => h('select.input', { onChange: (e) => onChange(e.target.value) }, h('option', { value: '' }, none), chans().map((c) => h('option', { value: c.id, selected: c.id === val }, '#' + c.name)));
  const roleSel = (val, onChange, none = t('None')) => h('select.input', { onChange: (e) => onChange(e.target.value) }, h('option', { value: '' }, none), (sv.roles || []).map((r) => h('option', { value: r.id, selected: r.id === val }, (r.icon ? r.icon + ' ' : '') + r.name)));
  const save = async (patch, msg = t('Saved')) => { try { const r = await api.patch(`/api/servers/${sv.id}/bot`, patch); cfg = r.bot; toast(msg, 'good'); paint(); } catch (e) { toastErr(e); } };
  const row = (label, input, hint) => h('div.bt-row', h('div.grow', h('b', label), hint ? h('div.tiny.muted', hint) : null), input);
  const roleChecks = (selected, onToggle) => h('div.bt-chips', (sv.roles || []).map((r) => h('button.bt-chip' + (selected.includes(r.id) ? '.on' : ''), { type: 'button', onClick: () => onToggle(r.id) }, roleChip(r))));

  async function paint() {
    if (tab === 'bot') {
      const name = h('input.input', { value: cfg.name, maxlength: 24 }); const ic = h('input.input', { value: cfg.icon, maxlength: 8, style: 'width:70px;text-align:center;font-size:20px' });
      mount(body, row(t('Server bot'), switchEl(cfg.on, (v) => save({ on: v })), t('Slash commands, welcome messages, levels, tickets and giveaways.')),
        h('div.row', { style: 'gap:8px;align-items:flex-end' }, field(t('Icon'), ic), h('div.grow', field(t('Name'), name)), h('button.btn.primary', { onClick: () => save({ name: name.value, icon: ic.value }) }, t('Save'))),
        row(t('Bot language'), h('select.input', { onChange: (e) => save({ lang: e.target.value }) }, [['es', 'Español'], ['en', 'English']].map(([v, l]) => h('option', { value: v, selected: (cfg.lang || 'es') === v }, l))), t('The language the bot writes in for everyone.')),
        row(t('Moderation log channel'), chSel(cfg.logCh, (v) => save({ logCh: v }), t('Off')), t('The bot posts every kick, ban, timeout, warning and AutoMod action there.')),
        h('h4', t('Commands')), h('div.bt-help', help.map(([k, d]) => h('div', h('code', k), h('span.muted', t(d))))));
    } else if (tab === 'welcome') {
      const wt = h('textarea.input', { rows: 3, maxlength: 500 }, cfg.welcome.text); const gt = h('textarea.input', { rows: 2, maxlength: 500 }, cfg.goodbye.text);
      mount(body, row(t('Welcome message'), switchEl(cfg.welcome.on, (v) => save({ welcome: { on: v } }))), field(t('Channel'), chSel(cfg.welcome.ch, (v) => save({ welcome: { ch: v } }))), field(t('Text'), wt), h('div.tiny.muted', t('Use {user}, {name}, {server} and {count}.')), h('button.btn.primary', { style: 'align-self:flex-start', onClick: () => save({ welcome: { text: wt.value } }) }, t('Save')),
        h('hr'), row(t('Goodbye message'), switchEl(cfg.goodbye.on, (v) => save({ goodbye: { on: v } }))), field(t('Channel'), chSel(cfg.goodbye.ch, (v) => save({ goodbye: { ch: v } }))), field(t('Text'), gt), h('button.btn.primary', { style: 'align-self:flex-start', onClick: () => save({ goodbye: { text: gt.value } }) }, t('Save')),
        h('hr'), row(t('Auto-role'), roleSel(cfg.autorole, (v) => save({ autorole: v })), t('Given to everyone who joins (roles without moderator permissions).')));
    } else if (tab === 'levels') {
      mount(body, loading()); let r; try { r = await api.get(`/api/servers/${sv.id}/levels`); } catch (e) { mount(body, emptyState('alert', e.message)); return; }
      const rewards = cfg ? cfg.levels.rewards.slice() : []; const lvIn = h('input.input', { type: 'number', min: 1, max: 200, value: 5, style: 'width:90px' }); let pickRole = '';
      mount(body,
        isMgr ? [row(t('Levels and XP'), switchEl(cfg.levels.on, (v) => save({ levels: { on: v } })), t('Members get 15–25 XP per minute of chatting.')), row(t('Announce level ups'), switchEl(cfg.levels.announce, (v) => save({ levels: { announce: v } })))] : null,
        h('div.bt-me', t('Your level'), ' ', h('b', String(r.me.lvl)), ' · #' + r.me.rank + ' · ' + fmt.num(r.me.xp) + ' XP', h('div.bt-bar', h('i', { style: { width: Math.max(2, Math.round((r.me.into / r.me.need) * 100)) + '%' } }))),
        h('ol.bt-top', r.top.map((x) => h('li', h('span.bt-pos', '#' + x.rank), avatarEl(x.user, { size: 30 }), h('b.grow', x.user.displayName), h('span.muted', t('Level') + ' ' + x.lvl), h('span.tiny.muted', fmt.num(x.xp) + ' XP')))),
        !r.top.length ? h('p.muted', t('Nobody has XP yet. Start chatting!')) : null,
        isMgr ? [h('h4', t('Role rewards')), h('div.col', { style: 'gap:6px' }, rewards.map((rw, i) => h('div.row', { style: 'gap:8px;align-items:center' }, h('span.pill', t('Level') + ' ' + rw.lvl), roleChip((sv.roles || []).find((x) => x.id === rw.role) || { name: '?' }), h('span.grow'), h('button.btn.sm.ghost', { onClick: () => { rewards.splice(i, 1); save({ levels: { rewards } }); } }, icon('trash', 13))))),
          h('div.row', { style: 'gap:8px;align-items:center;margin-top:6px' }, lvIn, roleSel('', (v) => { pickRole = v; }, t('Pick a role')), h('button.btn', { onClick: () => { if (!pickRole) return toast(t('Pick a role'), 'info'); rewards.push({ lvl: Number(lvIn.value) || 1, role: pickRole }); save({ levels: { rewards } }); } }, icon('plus', 13), t('Add')))] : null);
    } else if (tab === 'automod') {
      const a = cfg.automod; const words = h('textarea.input', { rows: 4, placeholder: t('One word or phrase per line') }, a.words.join('\n'));
      const mins = h('input.input', { type: 'number', min: 1, max: 10080, value: a.minutes, style: 'width:100px' }); const ment = h('input.input', { type: 'number', min: 0, max: 50, value: a.mentions, style: 'width:100px' });
      mount(body, row('AutoMod', switchEl(a.on, (v) => save({ automod: { on: v } })), t('Blocks messages before anyone sees them. Moderators are never affected.')),
        row(t('Block invite links'), switchEl(a.invites, (v) => save({ automod: { invites: v } }))), row(t('Block all links'), switchEl(a.links, (v) => save({ automod: { links: v } }))),
        row(t('Block shouting (CAPS)'), switchEl(a.caps, (v) => save({ automod: { caps: v } }))), row(t('Block spam and flooding'), switchEl(a.spam, (v) => save({ automod: { spam: v } })), t('The same message 3 times in 30 s, or 5 messages in 5 s.')),
        row(t('Max mentions per message'), h('div.row', { style: 'gap:6px' }, ment, h('button.btn.sm', { onClick: () => save({ automod: { mentions: Number(ment.value) } }) }, t('Save'))), t('0 = no limit')),
        field(t('Blocked words'), words), h('div.tiny.muted', t('It also catches common tricks like 0 for o or accents.')), h('button.btn', { style: 'align-self:flex-start', onClick: () => save({ automod: { words: words.value.split('\n') } }) }, t('Save words')),
        h('hr'), row(t('Action'), h('select.input', { onChange: (e) => save({ automod: { action: e.target.value } }) }, [['delete', t('Block the message')], ['warn', t('Block and warn')], ['timeout', t('Block and time out')]].map(([v, l]) => h('option', { value: v, selected: a.action === v }, l)))),
        a.action === 'timeout' ? row(t('Timeout minutes'), h('div.row', { style: 'gap:6px' }, mins, h('button.btn.sm', { onClick: () => save({ automod: { minutes: Number(mins.value) } }) }, t('Save')))) : null,
        row(t('3 warnings = 1 hour timeout'), switchEl(a.escalate, (v) => save({ automod: { escalate: v } }))),
        h('div.field', h('label', t('Roles AutoMod ignores')), roleChecks(a.exempt, (id) => save({ automod: { exempt: a.exempt.includes(id) ? a.exempt.filter((x) => x !== id) : [...a.exempt, id] } }))));
    } else if (tab === 'cmds') {
      const list = Object.entries(cfg.cmds); const nm = h('input.input', { placeholder: 'reglas', maxlength: 32 }); const tx = h('textarea.input', { rows: 3, maxlength: 1500, placeholder: t('What the bot answers. Use {user}, {server} and {args}.') }); let asEmbed = false;
      const write = (obj) => save({ cmds: obj });
      mount(body, h('p.small.muted', t('Members type !name and the bot answers. Great for rules, links, FAQs and memes.')),
        list.length ? h('div.col', { style: 'gap:6px' }, list.map(([k, v]) => h('div.bt-cmd', h('code', '!' + k), h('span.grow.small', v.text.slice(0, 120)), v.embed ? h('span.pill', 'embed') : null, h('button.btn.sm.ghost', { onClick: () => { const o = Object.assign({}, cfg.cmds); delete o[k]; write(o); } }, icon('trash', 13))))) : h('p.muted', t('No custom commands yet.')),
        h('h4', t('New command')), h('div.row', { style: 'gap:8px;align-items:center' }, h('span', '!'), nm), tx, h('label.row', { style: 'gap:8px;align-items:center' }, switchEl(false, (v) => { asEmbed = v; }), t('Show as a card')),
        h('button.btn.primary', { style: 'align-self:flex-start', onClick: () => { const k = nm.value.trim().toLowerCase().replace(/^!/, ''); if (!k || !tx.value.trim()) return toast(t('Write a name and an answer'), 'info'); write(Object.assign({}, cfg.cmds, { [k]: { text: tx.value, embed: asEmbed } })); } }, icon('plus', 13), t('Add command')));
    } else if (tab === 'tickets') {
      mount(body, loading()); let r; try { r = await api.get(`/api/servers/${sv.id}/tickets`); } catch (e) { mount(body, emptyState('alert', e.message)); return; }
      const pt = h('input.input', { placeholder: t('Support'), maxlength: 100 }); const px = h('textarea.input', { rows: 2, maxlength: 1000, placeholder: t('Need help from the staff? Press the button to open a private ticket.') }); let pch = '';
      const staff = cfg ? cfg.tickets.staff : [];
      mount(body,
        h('p.small.muted', t('A ticket is a private channel between one member and the staff. Members open one with the panel button or /ticket.')),
        h('div.bt-tks', r.tickets.length ? r.tickets.slice().reverse().map((x) => h('button.bt-tk' + (x.open ? '.open' : ''), { type: 'button', onClick: () => { onChannel && onChannel(x.id); mPromise.close(); } }, h('span', x.open ? '🎫' : '🔒'), h('b', '#' + x.name), h('span.grow.small.muted', r.users[x.by] ? '@' + r.users[x.by].username : ''), h('span.tiny.muted', fmt.dt(x.at)),
          r.staff ? h('button.btn.sm.ghost', { title: t('Download transcript'), onClick: async (e) => { e.stopPropagation(); try { const tr = await api.get(`/api/channels/${x.id}/transcript`); download(tr.name + '.txt', tr.text, 'text/plain'); } catch (er) { toastErr(er); } } }, icon('download', 13)) : null)) : h('p.muted', t('No tickets yet.'))),
        h('button.btn', { style: 'align-self:flex-start', onClick: async () => { try { const msg = await api.post(`/api/channels/${sv.channels.find((c) => !c.private && !c.readOnly).id}/messages`, { content: '/ticket' }); if (msg.channel) { onChannel && onChannel(msg.channel); mPromise.close(); } } catch (e) { toastErr(e); } } }, '🎫 ' + t('Open a ticket')),
        isMgr ? [h('hr'), h('h4', t('Ticket settings')), h('div.field', h('label', t('Staff roles that see every ticket')), roleChecks(staff, (id) => save({ tickets: { staff: staff.includes(id) ? staff.filter((x) => x !== id) : [...staff, id] } }))),
          h('h4', t('Post a ticket panel')), field(t('Channel'), chSel('', (v) => { pch = v; }, t('Pick a channel'))), field(t('Title'), pt), field(t('Text'), px),
          h('button.btn.primary', { style: 'align-self:flex-start', onClick: async () => { if (!pch) return toast(t('Pick a channel'), 'info'); try { await api.post(`/api/servers/${sv.id}/panels`, { kind: 'ticket', ch: pch, title: pt.value, text: px.value }); toast(t('Panel posted'), 'good'); } catch (e) { toastErr(e); } } }, t('Post panel'))] : null);
    } else if (tab === 'roles') {
      let pch = ''; const sel = []; const pt = h('input.input', { placeholder: t('Pick your roles'), maxlength: 100 }); const px = h('textarea.input', { rows: 2, maxlength: 1000 });
      const chips = h('div'); const paintChips = () => mount(chips, roleChecks(sel, (id) => { const i = sel.indexOf(id); if (i >= 0) sel.splice(i, 1); else if (sel.length < 10) sel.push(id); paintChips(); }));
      paintChips();
      mount(body, h('p.small.muted', t('Members press a button to give themselves a role (colours, games, pings…). Roles with moderator permissions cannot be used.')),
        field(t('Channel'), chSel('', (v) => { pch = v; }, t('Pick a channel'))), field(t('Title'), pt), field(t('Text'), px), h('div.field', h('label', t('Roles (up to 10)')), chips),
        h('button.btn.primary', { style: 'align-self:flex-start', onClick: async () => { if (!pch) return toast(t('Pick a channel'), 'info'); try { await api.post(`/api/servers/${sv.id}/panels`, { kind: 'roles', ch: pch, title: pt.value, text: px.value, roles: sel }); toast(t('Panel posted'), 'good'); } catch (e) { toastErr(e); } } }, t('Post panel')));
    } else if (tab === 'log') {
      mount(body, loading()); let r; try { r = await api.get(`/api/servers/${sv.id}/modlog`); } catch (e) { mount(body, emptyState('alert', e.message)); return; }
      const nm = (id) => (id === 'bot' ? (cfg ? cfg.name : 'Bot') : r.users[id] ? '@' + r.users[id].username : '?');
      const IC = { kick: '👢', ban: '🔨', unban: '♻️', timeout: '⏳', warn: '⚠️', automod: '🛡️', purge: '🧹', clearwarns: '🧽', ticket_open: '🎫', ticket_close: '🔒', slowmode: '🐢', lock: '🔐', unlock: '🔓', voice_disconnect: '🔇', voice_mute: '🎙', voice_unmute: '🎙' };
      mount(body, r.log.length ? h('div.bt-log', r.log.map((e) => h('div.bt-le', h('span.bt-li', IC[e.act] || '📝'), h('div.grow', h('div', h('b', nm(e.by)), ' · ', h('span', e.act.replace(/_/g, ' ')), e.target ? [' → ', h('b', nm(e.target))] : null), e.reason ? h('div.small.muted', e.reason) : null, e.text ? h('div.tiny.muted', '“' + e.text + '”') : null), h('span.tiny.muted', fmt.dt(e.t))))) : h('p.muted', t('Nothing here yet.')));
    } else if (tab === 'bans') {
      mount(body, loading()); let r; try { r = await api.get(`/api/servers/${sv.id}/bans`); } catch (e) { mount(body, emptyState('alert', e.message)); return; }
      mount(body, r.bans.length ? h('div.col', { style: 'gap:6px' }, r.bans.map((b) => h('div.row', { style: 'gap:8px;align-items:center' }, avatarEl(b.user, { size: 30 }), h('b.grow', b.user.displayName || b.user.username), h('span.tiny.muted', fmt.dt(b.at)),
        h('button.btn.sm', { onClick: async () => { if (!(await confirmBox(t('Unban {n}?', { n: b.user.displayName || b.user.username })))) return; try { await api.post(`/api/servers/${sv.id}/bans/${b.user.id}/unban`, {}); toast(t('Unbanned'), 'good'); paint(); } catch (e) { toastErr(e); } } }, t('Unban'))))) : h('p.muted', t('Nobody is banned.')));
    }
  }
  const tabs = tabsEl(tabsList.map(([id, l, ic]) => [id, l, ic]), tab, (id) => { tab = id; paint(); });
  const mPromise = modal({ title: (cfg ? cfg.icon + ' ' : '🤖 ') + t('Bot & moderation') + ' · ' + sv.name, cls: 'wide', body: h('div.col', tabs, body), actions: [{ label: t('Close') }] });
  paint();
  return mPromise;
}

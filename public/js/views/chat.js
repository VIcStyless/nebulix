// Community: servers, channels and live chat — replies, reactions, image attachments, @mentions, invites and moderation tools.
import { h, mount, fmt, debounce, pickFile, ls, clamp } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S, bus, seen, withPresence } from '../state.js';
import { icon, logoMark } from '../icons.js';
import { avatarEl, nameEl, badgesEl, bubbleStyle } from '../cosmetics.js';
import { richText, linkCard } from '../rich.js';
import { roleName, roleAliases, SITE_ROLES } from '../roles.js';
import { toast, toastErr, confirmBox, promptBox, modal, openMenu, emptyState, loading, emojiPicker, switchEl, field, copyBtn, segEl } from '../ui.js';
import { loadServers, markRead, serverUnread, serverMentions } from '../servers.js';
import { serverSettingsModal, assignRolesModal, privacyFields, can, outranks, roleIdx } from './chat-roles.js';
import { botUser, botExtras, communityPanel } from './chat-bot.js';
import { actText, statusText } from '../status.js';
import * as voice from '../voice.js';
import * as vroom from '../voice-room.js';
import { translate } from '../translator.js';

const ICONS = ['🎮', '🚀', '🌌', '🐉', '⚔️', '🏆', '🎲', '👾', '🔥', '🦄', '🐺', '🧪', '🛸', '🎯', '💎', '🌈'];
const QUICK = ['👍', '❤️', '😂'];
const SLOW = [[0, 'Off'], [5, '5 seconds'], [10, '10 seconds'], [30, '30 seconds'], [60, '1 minute'], [300, '5 minutes']];
const SYSTEM = { id: 'system', username: 'Nebulix', displayName: 'Nebulix', badges: [], eq: {}, system: true };
let inst = null;
// Servers are shown with a monogram of their name (emoji icons are no longer displayed).
const svMono = (sv) => { const w = String(sv.name || '?').replace(/[^\p{L}\p{N}\s]/gu, '').trim().split(/\s+/); return ((w[0] || '?')[0] + (w[1] ? w[1][0] : (w[0] || '')[1] || '')).toUpperCase(); };

function build(root, go) {
  const unsubs = [];
  let svId = ls('cm.sv') || null; let chId = ls('cm.ch') || null;
  const logs = new Map();   // channel id -> { msgs, more, loaded }
  const users = new Map();  // user id -> public user
  const typers = new Map(); // user id -> { n, until }
  // on a phone the member list covers the chat, so it starts closed
  let membersOpen = ls('cm.members') !== false && innerWidth > 760; let members = null; let membersFor = null; let groles = [];
  let shown = false; let replyTo = null; let editing = null; let pending = []; let sending = false; let stick = true;
  let lastSig = ''; const chSig = (ch) => [ch.id, ch.name, ch.topic, ch.readOnly, ch.slow, ch.private].join('|');
  let msgsEl = null, typingEl = null, composerBox = null, newPill = null, ta = null, sendBtn = null, extraBox = null;
  const msgSeen = new Set(); let msgPrimed = false; // animate only messages that arrive after the first paint

  const serversCol = h('nav.cm-servers', { 'aria-label': t('Servers') });
  const chanCol = h('aside.cm-chans');
  const mainCol = h('section.cm-main');
  const memCol = h('aside.cm-members');
  const wrap = h('div.cm-wrap', serversCol, chanCol, mainCol, memCol);
  mount(root, wrap);

  const curSv = () => S.servers.find((s) => s.id === svId) || null;
  // ---- roles shown in messages: @ServerRole, @CommunityRole, @everyone/@here ----
  api.get('/api/community/roles', { quiet: true }).then((r) => { groles = r.roles || []; if (membersOpen && members) paintMembersPanel(); if (chId) paintMsgs('keep'); }).catch(() => {});
  function mentionRoles() {
    const sv = curSv(); const out = [{ names: ['everyone', 'here'], color: null, icon: '', all: true }];
    for (const r of (sv && sv.roles) || []) out.push({ names: [r.name], color: r.color, icon: r.icon, id: r.id });
    for (const g of groles) out.push({ names: roleAliases(g), color: g.color, icon: g.icon, id: g.id });
    return out;
  }
  function myRoleNames() {
    const sv = curSv(); const mine = new Set((sv && sv.myRoles) || []); (S.me.groles || []).forEach((g) => mine.add(g.id || g));
    const names = new Set(['everyone', 'here']);
    for (const r of (sv && sv.roles) || []) if (mine.has(r.id)) names.add(r.name.toLowerCase());
    for (const g of groles) if (mine.has(g.id)) roleAliases(g).forEach((n) => names.add(n.toLowerCase()));
    return names;
  }
  const curCh = () => { const sv = curSv(); return sv ? sv.channels.find((c) => c.id === chId) || null : null; };
  const userOf = (id) => (id === 'system' ? SYSTEM : users.get(id) || { id, username: 'unknown', displayName: t('Deleted user'), badges: [], eq: {} });
  const remember = (u) => { if (u && u.id) { seen(u); users.set(u.id, u); } return u; };
  const logOf = (id) => { let l = logs.get(id); if (!l) logs.set(id, (l = { msgs: [], more: false, loaded: false })); return l; };
  const chMap = () => ls('cm.chs') || {};
  const styles = new Map(); // server id -> Map(user id -> { color, icon, top })
  const styleOf = (uid) => { const m = styles.get(svId); return (m && m.get(uid)) || null; };
  const setStyle = (sid, uid, st) => { let m = styles.get(sid); if (!m) styles.set(sid, (m = new Map())); if (st) m.set(uid, st); else m.delete(uid); };

  // ---------------- servers rail ----------------
  function paintServers() {
    mount(serversCol,
      S.servers.map((sv) => {
        const men = serverMentions(sv); const unread = serverUnread(sv);
        return h('button.cm-sv' + (sv.id === svId ? '.on' : ''), { type: 'button', title: sv.name, 'aria-label': sv.name, 'data-sv': sv.id, onClick: () => selectServer(sv.id) },
          h('span.sv-mono', svMono(sv)), men ? h('span.nb', men > 99 ? '99+' : men) : unread ? h('span.nd') : null);
      }),
      h('div.cm-sep'),
      h('button.cm-sv.add', { type: 'button', title: t('Add a server'), 'aria-label': t('Add a server'), id: 'cm-add', onClick: addServer }, icon('plus', 22)),
      h('button.cm-sv.add', { type: 'button', title: t('Discover servers'), 'aria-label': t('Discover servers'), onClick: discover }, icon('globe', 22)));
  }

  // ---------------- channel list ----------------
  function paintChannels() {
    const sv = curSv();
    if (!sv) return mount(chanCol, h('div.cm-nosv', h('p.small.muted', t('No server selected.'))));
    mount(chanCol,
      h('button.cm-svhead', { type: 'button', 'aria-label': t('Server menu'), onClick: (e) => serverMenu(e.currentTarget) }, h('span.cm-svname', sv.name), sv.official ? h('span.pill.pro', t('Official')) : null, icon('more', 18)),
      sv.desc ? h('div.tiny.muted.cm-svdesc', sv.desc) : null,
      h('div.cm-chlist', sv.channels.map((ch) => {
        const men = S.mentions[ch.id] || 0; const un = S.unread[ch.id] > 0;
        const row = h('div.cm-ch' + (ch.id === chId ? '.on' : '') + (un ? '.unread' : ''), { 'data-ch': ch.id },
          h('button.cm-chbtn', { type: 'button', title: ch.topic || ch.name, onClick: () => selectChannel(ch.id) }, icon(ch.readOnly ? 'lock' : 'hash', 15), h('span.grow', ch.name), ch.private ? h('span.cm-priv', { title: t('Private channel') }, icon('lock', 12)) : null, men ? h('span.nb.inl', men) : null),
          can(sv, 'manage_channels') ? h('button.cm-chcfg', { type: 'button', 'aria-label': t('Channel settings'), onClick: () => channelSettings(ch) }, icon('gear', 14)) : null);
        const vu = vroom.rooms.get(ch.id) || [];
        return [row, vu.length ? h('div.cm-vc', { onClick: () => vroom.join(ch.id, ch.name), title: t('Join voice') }, vu.map((x) => { const pu = S.userCache[x.id] || { id: x.id, username: '?' }; return h('span.cm-vcu' + (vroom.isSpeaking(x.id) ? '.talk' : ''), avatarEl(pu, { size: 18, frame: false }), h('span.ellipsis', pu.displayName || pu.username), x.muted ? icon('micoff', 11) : null); })) : null];
      })),
      can(sv, 'manage_channels') ? h('button.btn.sm.ghost.cm-addch', { type: 'button', onClick: createChannel }, icon('plus', 15), t('Add channel')) : null);
  }

  async function loadVoice(id) {
    try { const r = await api.get(`/api/servers/${id}/voice`, { quiet: true }); for (const u of Object.values(r.users)) if (u) seen(u); for (const [ch, list] of Object.entries(r.rooms)) vroom.rooms.set(ch, list); paintChannels(); } catch {}
  }
  function serverMenu(anchor) {
    const sv = curSv(); if (!sv) return;
    openMenu([
      { label: t('Invite people'), icon: 'users', onClick: invite },
      { label: t('Members'), icon: 'user', onClick: () => { membersOpen = true; ls('cm.members', true); wrap.classList.add('mem-open'); paintMembersPanel(); } },
      { label: t('Mark all as read'), icon: 'check', onClick: () => { sv.channels.forEach((c) => markRead(c.id, c.last)); paintServers(); paintChannels(); } },
      { label: t('Levels'), icon: 'trophy', onClick: () => communityPanel(sv, { start: 'levels', onChannel: openChannelSoon }) },
      { label: t('Tickets'), icon: 'mail', onClick: () => communityPanel(sv, { start: 'tickets', onChannel: openChannelSoon }) },
      can(sv, 'manage_server') || can(sv, 'manage_messages') || can(sv, 'ban') || can(sv, 'kick') || can(sv, 'timeout') ? { label: t('Bot & moderation'), icon: 'spark', onClick: () => communityPanel(sv, { onChannel: openChannelSoon }) } : null,
      can(sv, 'manage_channels') || can(sv, 'manage_server') || can(sv, 'manage_roles') ? { hr: true } : null,
      can(sv, 'manage_channels') ? { label: t('Add channel'), icon: 'plus', onClick: createChannel } : null,
      can(sv, 'manage_server') || can(sv, 'manage_roles') ? { label: t('Server settings'), icon: 'gear', onClick: serverSettings } : null,
      can(sv, 'manage_roles') ? { label: t('Roles'), icon: 'shield', onClick: serverSettings } : null,
      sv.myRole !== 'owner' && !sv.official ? { hr: true } : null,
      sv.myRole !== 'owner' && !sv.official ? { label: t('Leave server'), icon: 'logout', danger: true, onClick: leaveServer } : null,
    ], anchor);
  }

  // ---------------- selection ----------------
  async function selectServer(id) {
    const sv = S.servers.find((s) => s.id === id); if (!sv) return;
    svId = id; ls('cm.sv', id); members = null;
    const want = chMap()[id]; const ch = sv.channels.find((c) => c.id === want) || sv.channels.find((c) => c.name === 'general') || sv.channels[0];
    paintServers(); paintChannels(); loadVoice(id);
    if (ch) await selectChannel(ch.id); else { chId = null; paintMain(); }
    if (membersOpen) loadMembers();
  }
  async function selectChannel(id) {
    const sv = curSv(); const ch = sv && sv.channels.find((c) => c.id === id); if (!ch) return;
    chId = id; S.activeChannel = id; lastSig = chSig(ch); ls('cm.ch', id); const cm = chMap(); cm[svId] = id; ls('cm.chs', cm);
    replyTo = null; editing = null; pending = []; typers.clear(); msgSeen.clear(); msgPrimed = false;
    wrap.classList.add('open'); paintChannels(); paintMain();
    const l = logOf(id);
    if (!l.loaded) {
      mount(msgsEl, loading(t('Loading messages…')));
      try { const r = await api.get(`/api/channels/${id}/messages?limit=50`); Object.values(r.users).forEach(remember); Object.entries(r.styles || {}).forEach(([uid, st]) => setStyle(svId, uid, st)); l.msgs = r.messages; l.more = r.more; l.loaded = true; }
      catch (e) { if (chId === id) mount(msgsEl, emptyState('⚠️', t('Could not load messages'), e.message, h('button.btn', { onClick: () => { l.loaded = false; selectChannel(id); } }, t('Retry')))); return; }
    }
    if (chId !== id) return;
    paintMsgs('bottom');
    if (shown) { const last = l.msgs[l.msgs.length - 1]; markRead(id, last && last.id); paintServers(); paintChannels(); }
  }

  // ---------------- main column ----------------
  function paintMain() {
    const sv = curSv(); const ch = curCh();
    if (!sv || !ch) {
      mount(mainCol, h('div.dm-empty', emptyState('🌌', t('Welcome to the community'), t('Pick a server on the left, create your own, or join with an invite code.'), h('div.row', { style: 'gap:8px;justify-content:center' }, h('button.btn.primary', { onClick: addServer }, t('Add a server')), h('button.btn', { onClick: discover }, t('Discover servers'))))));
      return;
    }
    msgsEl = h('div.cm-msgs', { role: 'log', 'aria-live': 'polite', 'aria-label': t('Messages'), onScroll: () => { stick = nearBottom(); if (stick && newPill) newPill.classList.add('hide'); } });
    typingEl = h('div.cm-typing', { 'aria-live': 'polite' });
    newPill = h('button.btn.sm.primary.cm-newpill.hide', { type: 'button', onClick: () => { scrollBottom(); } }, icon('back', 14, 'rot'), t('New messages'));
    composerBox = h('div.cm-composer');
    mount(mainCol,
      h('div.dm-head.cm-head',
        h('button.btn.ghost.icon.dm-back', { type: 'button', 'aria-label': t('Back'), onClick: () => wrap.classList.remove('open') }, icon('back', 20)),
        icon(ch.readOnly ? 'lock' : 'hash', 20), h('div.grow', { style: 'min-width:0' }, h('b', ch.name), ch.topic ? h('div.tiny.muted.cm-topic', ch.topic) : null),
        ch.slow ? h('span.pill', { title: t('Slowmode') }, icon('clock', 13), ' ' + ch.slow + 's') : null,
        vcBtn(ch),
        h('button.btn.ghost.icon', { type: 'button', 'aria-label': t('Search messages'), title: t('Search messages'), onClick: () => searchModal(ch) }, icon('search', 18)),
        h('button.btn.ghost.icon', { type: 'button', 'aria-label': t('Pinned messages'), title: t('Pinned messages'), onClick: () => pinsModal(ch) }, icon('pin', 18)),
        h('button.btn.ghost.icon', { type: 'button', 'aria-label': t('Members'), 'aria-pressed': String(membersOpen), onClick: toggleMembers }, icon('users', 20))),
      h('div.cm-stream', msgsEl, newPill), typingEl, composerBox);
    paintComposer(); paintTyping();
  }

  const nearBottom = () => !msgsEl || msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 140;
  const scrollBottom = () => { if (msgsEl) { msgsEl.scrollTop = msgsEl.scrollHeight; stick = true; if (newPill) newPill.classList.add('hide'); } };
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  const dayLabel = (ms) => { const d = new Date(ms); const n = new Date(); if (d.toDateString() === n.toDateString()) return t('Today'); const y = new Date(n - 86400000); if (d.toDateString() === y.toDateString()) return t('Yesterday'); return fmt.date(ms); };

  function paintMsgs(mode = 'keep') {
    if (!msgsEl) return; const l = logOf(chId); const sv = curSv();
    const wasNear = nearBottom(); const prevH = msgsEl.scrollHeight; const prevTop = msgsEl.scrollTop;
    const kids = [];
    if (l.more) kids.push(h('button.btn.sm.ghost.cm-older', { type: 'button', onClick: loadOlder }, t('Load older messages')));
    if (!l.more && l.msgs.length) { const c0 = curCh() || {}; kids.push(h('div.cm-intro', h('span.cm-intro-ic', icon('hash', 26)), h('h3', t('Welcome to #{c}', { c: c0.name || '' })), h('p.muted', c0.topic || t('This is the very beginning of this channel.')))); }
    if (!l.msgs.length) kids.push(h('div.dm-hello', h('div.empty-art', icon('hash', 26)), h('h3', '#' + (curCh() || {}).name), h('p.small.muted', t('This is the start of the channel. Say hi!'))));
    l.msgs.forEach((m, i) => {
      const prev = l.msgs[i - 1];
      if (!prev || !sameDay(prev.t, m.t)) kids.push(h('div.cm-day', h('span', dayLabel(m.t))));
      const el = msgEl(m, prev && sameDay(prev.t, m.t) ? prev : null, sv);
      if (msgPrimed && !msgSeen.has(m.id)) el.classList.add('cm-in'); // one-time slide-in for newly arrived messages
      msgSeen.add(m.id);
      kids.push(el);
    });
    msgPrimed = true;
    mount(msgsEl, kids);
    if (mode === 'bottom' || (mode === 'keep' && wasNear)) { msgsEl.scrollTop = msgsEl.scrollHeight; stick = true; }
    else if (mode === 'prepend') msgsEl.scrollTop = prevTop + (msgsEl.scrollHeight - prevH);
    else msgsEl.scrollTop = prevTop;
  }
  async function loadOlder() {
    const l = logOf(chId); if (!l.msgs.length) return; const id = chId;
    try { const r = await api.get(`/api/channels/${id}/messages?limit=50&before=${encodeURIComponent(l.msgs[0].id)}`); Object.values(r.users).forEach(remember); if (id !== chId) return; l.msgs = r.messages.concat(l.msgs); l.more = r.more; paintMsgs('prepend'); } catch (e) { toastErr(e); }
  }

  function replyRef(id) {
    const l = logOf(chId); const o = l.msgs.find((x) => x.id === id);
    if (!o) return h('div.cm-reply.muted', icon('reply', 13), h('span', t('Original message is not loaded')));
    const u = userOf(o.a);
    return h('button.cm-reply', { type: 'button', onClick: () => { const el = msgsEl.querySelector(`[data-id="${CSS.escape(id)}"]`); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400); } } },
      icon('reply', 13), h('b', u.displayName || u.username), h('span.cm-rtxt', (o.c || t('Image')).slice(0, 90)));
  }

  function msgEl(m, prev, sv) {
    const bot = m.a === 'bot'; const u = bot ? botUser(m) : userOf(m.a); const sys = m.a === 'system'; const mine = m.a === S.me.id;
    const grouped = !!prev && prev.a === m.a && m.t - prev.t < 300000 && !m.r && !m.cmd && !(m.a === 'bot' && (m.em || m.rank));
    const mentioned = (m.m || []).includes(S.me.id);
    const canDel = mine || can(sv, 'manage_messages');
    const open = (e) => userMenu(u, e);
    const act = h('div.cm-act', { role: 'toolbar', 'aria-label': t('Message actions') },
      QUICK.map((e) => h('button.cm-ab', { type: 'button', 'aria-label': t('React with {e}', { e }), onClick: () => toggleReact(m, e) }, e)),
      h('button.cm-ab', { type: 'button', 'aria-label': t('Add reaction'), onClick: (ev) => emojiPicker(ev.currentTarget, (e) => toggleReact(m, e)) }, icon('smile', 16)),
      h('button.cm-ab', { type: 'button', 'aria-label': t('Reply'), onClick: () => startReply(m) }, icon('reply', 16)),
      m.c && !sys ? h('button.cm-ab', { type: 'button', 'aria-label': t('Translate'), title: t('Translate'), onClick: () => toggleTranslate(m) }, icon('translate', 16)) : null,
      mine ? h('button.cm-ab', { type: 'button', 'aria-label': t('Edit'), onClick: () => { editing = { id: m.id, text: m.c }; paintMsgs('keep'); const ed = msgsEl.querySelector('.cm-edit textarea'); if (ed) { ed.focus(); ed.setSelectionRange(ed.value.length, ed.value.length); } } }, icon('edit', 16)) : null,
      !sys && can(sv, 'manage_messages') ? h('button.cm-ab', { type: 'button', 'aria-label': m.pin ? t('Unpin') : t('Pin'), title: m.pin ? t('Unpin') : t('Pin'), onClick: () => togglePin(m) }, icon('pin', 16)) : null,
      canDel ? h('button.cm-ab', { type: 'button', 'aria-label': t('Delete'), onClick: () => delMsg(m) }, icon('trash', 16)) : null,
      !mine && !sys ? h('button.cm-ab', { type: 'button', 'aria-label': t('Report'), onClick: () => report(m) }, icon('flag', 16)) : null);
    const body = editing && editing.id === m.id ? editBox(m) : (m.c ? h('div.cm-text', richText(m._tr && !m._tr.orig ? m._tr.text : m.c, { go, me: S.me.username, roles: mentionRoles(), myRoles: myRoleNames() }), m.e ? h('span.tiny.muted', ' (' + t('edited') + ')') : null) : null);
    if (body && body.classList && body.classList.contains('cm-text') && !sys) { const bs = bubbleStyle(u); if (bs) { Object.assign(body.style, bs); body.classList.add('cm-bubbled'); } }
    const trNote = m._tr ? h('div.cm-trnote', icon('translate', 11), m._tr.loading ? t('Translating…') : m._tr.orig ? t('Original') : t('Translated'), m._tr.loading ? null : h('button', { type: 'button', onClick: () => { m._tr.orig = !m._tr.orig; paintMsgs('keep'); } }, m._tr.orig ? t('Show translation') : t('Show original'))) : null;
    const imgs = (m.at || []).length ? h('div.cm-imgs', m.at.map((a) => { const im = h('img.cm-img', { src: a.url, alt: t('Image'), loading: 'lazy', onClick: () => viewImage(a.url) }); im.addEventListener('load', () => { if (stick && msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight; }); return im; })) : null;
    const rx = Object.entries(m.rx || {}).length ? h('div.cm-rxs', Object.entries(m.rx).map(([e, ids]) => h('button.cm-rx' + (ids.includes(S.me.id) ? '.me' : ''), { type: 'button', title: ids.map((i) => userOf(i).displayName || userOf(i).username).slice(0, 12).join(', '), onClick: () => toggleReact(m, e) }, h('span', e), h('b', ids.length)))) : null;
    const head = grouped ? null : h('div.cm-meta',
      bot ? [h('b.cm-sysname.cm-botname', u.displayName), h('span.pill.cm-botpill', '✓ BOT')] : sys ? h('b.cm-sysname', 'Nebulix') : (() => { const st = styleOf(m.a); return h('button.cm-uname', { type: 'button', onClick: open, style: st && st.color ? `color:${st.color}` : null }, nameEl(u), st && st.icon ? h('span.cm-ricon', { title: t('Role') }, st.icon) : null); })(),
      bot ? null : sys ? h('span.pill.pro', t('System')) : badgesEl(u, { max: 4 }), h('span.tiny.muted.cm-time', { title: fmt.dt(m.t) }, fmt.time(m.t)));
    return h('div.cm-msg' + (grouped ? '.grouped' : '') + (mentioned ? '.mentioned' : '') + (mine ? '.mine' : '') + (bot ? '.bot' : '') + (m.eph ? '.eph' : ''), { 'data-id': m.id, onClick: (e) => { if (matchMedia('(pointer: coarse)').matches && !e.target.closest('button, a, img')) e.currentTarget.classList.toggle('sel'); } },
      grouped ? h('div.cm-gutter', h('span.tiny.muted.cm-time', { title: fmt.dt(m.t) }, fmt.time(m.t))) : h('button.cm-ava', { type: 'button', 'aria-label': u.displayName || u.username, onClick: open }, bot ? h('span.ava.sysava.botava', u.icon) : sys ? h('span.ava.sysava', logoMark(26)) : avatarEl(u, { size: 40 })),
      h('div.cm-body', m.pin ? h('div.tiny.cm-pinned', icon('pin', 11), t('Pinned')) : null, m.r ? replyRef(m.r) : null, m.cmd ? h('div.cm-cmdline', icon('reply', 12), h('b', '@' + (userOf(m.cmd.by).username || '?')), ' ' + t('used') + ' ', h('code', m.cmd.n)) : null, head, body, trNote, imgs, bot ? botExtras(m, { chId, go, userOf, onChannel: openChannelSoon }) : null, m.v ? voice.player(() => m.v.url, m.v.dur, m.v.url) : null, m.pl ? pollEl(m) : null, m.c && !(editing && editing.id === m.id) ? linkCard(m.c, go, () => { if (stick && msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight; }) : null, rx), act);
  }
  function pollEl(m) {
    const p = m.pl; const total = p.total || 0; const voted = p.mine !== null && p.mine !== undefined;
    return h('div.poll', h('b', p.q), p.options.map((o, i) => {
      const n = p.counts[i] || 0; const pct = total ? Math.round((n / total) * 100) : 0;
      return h('button.poll-opt' + (p.mine === i ? '.mine' : ''), { type: 'button', onClick: async () => { try { const r = await api.post(`/api/polls/${p.id}/vote`, { option: i }); m.pl = r.poll; paintMsgs('keep'); } catch (e) { toastErr(e); } } },
        h('span.pf', { style: `width:${voted ? pct : 0}%` }), h('span', o), h('span.tiny.muted', voted ? `${pct}% · ${n}` : ''));
    }), h('div.tiny.muted', { style: 'margin-top:8px' }, t('{n} votes', { n: total }) + (voted ? '' : ' · ' + t('Vote to see results'))));
  }

  function editBox(m) {
    const e = h('textarea.input', { rows: '2', maxlength: '2000', value: editing.text, 'aria-label': t('Edit message'), onInput: (ev) => { editing.text = ev.target.value; }, onKeydown: (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); save(); } else if (ev.key === 'Escape') cancel(); } });
    const cancel = () => { editing = null; paintMsgs('keep'); };
    const save = async () => {
      const text = e.value.trim(); if (!text) return toast(t('Messages cannot be empty.'), 'err');
      if (text === m.c) return cancel();
      try { await api.patch(`/api/channels/${chId}/messages/${m.id}`, { content: text }); m.c = text; m.e = Date.now(); editing = null; paintMsgs('keep'); } catch (er) { toastErr(er); }
    };
    return h('div.cm-edit', e, h('div.tiny.muted', t('Enter to save · Esc to cancel')), h('div.row', { style: 'gap:6px' }, h('button.btn.sm.primary', { type: 'button', onClick: save }, t('Save')), h('button.btn.sm', { type: 'button', onClick: cancel }, t('Cancel'))));
  }

  // ---------------- message actions ----------------
  function addMessage(ch, m, u) {
    if (u) remember(u); const l = logOf(ch);
    if (l.msgs.some((x) => x.id === m.id)) return false;
    l.msgs.push(m); if (l.msgs.length > 600) l.msgs.splice(0, l.msgs.length - 500);
    return true;
  }
  async function toggleReact(m, emoji) {
    const had = ((m.rx || {})[emoji] || []).includes(S.me.id);
    try { const r = await (had ? api.del : api.put)(`/api/channels/${chId}/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`); m.rx = r.rx; paintMsgs('keep'); } catch (e) { toastErr(e); }
  }
  function startReply(m) { replyTo = m; paintExtras(); if (ta) ta.focus(); }
  async function delMsg(m) {
    if (!(await confirmBox(t('Delete this message for everyone?'), { danger: true, ok: t('Delete') }))) return;
    try { await api.del(`/api/channels/${chId}/messages/${m.id}`); const l = logOf(chId); l.msgs = l.msgs.filter((x) => x.id !== m.id); paintMsgs('keep'); } catch (e) { toastErr(e); }
  }
  async function report(m) {
    const reason = await promptBox(t('Report message'), { label: t('What is wrong with this message?'), multiline: true, ok: t('Send report'), validate: (v) => (v.trim().length < 3 ? t('Please tell us briefly what happened.') : v.length > 300 ? t('Up to 300 characters.') : '') });
    if (reason === null) return;
    try { await api.post('/api/reports', { type: 'message', target: m.id, ref: chId, reason: reason.trim() }); toast(t('Thanks — the moderators will take a look.'), 'good'); } catch (e) { toastErr(e); }
  }
  function vcBtn(ch) {
    const inIt = vroom.current() === ch.id; const n = (vroom.rooms.get(ch.id) || []).length;
    return h('button.btn.sm' + (inIt ? '.danger' : '') + '.cm-vcbtn', { type: 'button', title: inIt ? t('Leave voice') : t('Join voice'), onClick: () => (inIt ? vroom.leave() : vroom.join(ch.id, ch.name)) }, icon(inIt ? 'phoneoff' : 'mic', 15), h('span.cm-vcl', inIt ? t('Leave') : t('Voice')), n && !inIt ? h('span.tiny', String(n)) : null);
  }
  async function toggleTranslate(m) {
    if (m._tr && !m._tr.loading) { m._tr = null; return paintMsgs('keep'); }
    m._tr = { loading: true }; paintMsgs('keep');
    try { const r = await translate(m.c); m._tr = { text: r.text, engine: r.engine }; } catch (e) { m._tr = null; toastErr(e); }
    paintMsgs('keep');
  }
  async function togglePin(m) {
    try { await api.put(`/api/channels/${chId}/pins/${m.id}`, { pinned: !m.pin }); m.pin = !m.pin; paintMsgs('keep'); toast(m.pin ? t('Message pinned') : t('Message unpinned'), 'good', 1800); } catch (e) { toastErr(e); }
  }
  // a compact, read-only rendering of a message for the search and pins dialogs
  function miniMsg(m, users, onJump) {
    const u = users[m.a] || userOf(m.a);
    return h('button.cm-mini', { type: 'button', onClick: onJump },
      avatarEl(u, { size: 28 }), h('div.grow', { style: 'min-width:0;text-align:left' }, h('div.row', { style: 'gap:6px' }, h('b.small', u.displayName || u.username), h('span.tiny.muted', fmt.dt(m.t))),
        h('div.small.cm-mini-t', m.c || (m.pl ? m.pl.q : m.v ? t('Voice message') : (m.at || []).length ? t('Image') : ''))));
  }
  function jumpTo(id) {
    const el = msgsEl && msgsEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400); }
    else toast(t('That message is further back in the history. Scroll up to load it.'));
  }
  function searchModal(ch) {
    const q = h('input.input', { type: 'search', placeholder: t('Search in #{n}… (from:@name works too)', { n: ch.name }), autocomplete: 'off' });
    const box = h('div.col', { style: 'gap:2px;max-height:52vh;overflow:auto;min-height:60px' });
    let p;
    const run = debounce(async () => {
      let v = q.value.trim(); let from = null; const fm = /(?:^|\s)from:@?([A-Za-z0-9_]{3,20})/.exec(v); if (fm) { from = fm[1]; v = v.replace(fm[0], '').trim(); }
      if (v.length < 2) return mount(box, h('div.tiny.muted', { style: 'padding:8px' }, t('Type at least 2 characters.')));
      try {
        const r = await api.get(`/api/channels/${ch.id}/search?q=${encodeURIComponent(v)}${from ? '&from=' + encodeURIComponent(from) : ''}`);
        mount(box, r.messages.length ? r.messages.map((m) => miniMsg(m, r.users, () => { p.close(); jumpTo(m.id); })) : h('div.tiny.muted', { style: 'padding:8px' }, t('No messages match.')));
      } catch (e) { mount(box, h('span.error', e.message)); }
    }, 250);
    q.addEventListener('input', run);
    p = modal({ title: t('Search messages'), body: h('div.col', q, box), actions: [{ label: t('Close') }] });
  }
  async function pinsModal(ch) {
    const box = h('div.col', { style: 'gap:2px;max-height:56vh;overflow:auto' }, loading()); let p;
    p = modal({ title: t('Pinned messages'), body: box, actions: [{ label: t('Close') }] });
    try {
      const r = await api.get(`/api/channels/${ch.id}/pins`);
      mount(box, r.messages.length ? r.messages.map((m) => miniMsg(m, r.users, () => { p.close(); jumpTo(m.id); })) : emptyState('pin', t('No pinned messages'), t('Moderators can pin important messages from the message menu.')));
    } catch (e) { mount(box, h('span.error', e.message)); }
  }
  function viewImage(url) { modal({ cls: 'wide cm-lightbox', body: h('img.cm-big', { src: url, alt: t('Image') }), actions: [{ label: t('Close'), kind: 'primary' }] }); }

  // ---------------- composer ----------------
  function paintComposer() {
    const sv = curSv(); const ch = curCh(); if (!composerBox || !sv || !ch) return;
    const canPost = (!ch.readOnly || can(sv, 'post_readonly')) && can(sv, 'send');
    if (!canPost) { mount(composerBox, h('div.cm-ro', icon('lock', 16), !can(sv, 'send') ? t('You do not have permission to send messages here.') : t('Only moderators can post in this channel.'))); return; }
    extraBox = h('div.cm-extra');
    ta = h('textarea.input.dm-ta.cm-ta', { rows: '1', maxlength: '2000', placeholder: t('Message #{n}', { n: ch.name }), 'aria-label': t('Message'),
      onInput: () => { autosize(); typingPing(); cmdHint(); }, onKeydown: (e) => { if (e.key === 'Tab' && hintEl && hintEl._pick) { e.preventDefault(); hintEl._pick(); return; } if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { if (hintEl && hintEl._pick) { e.preventDefault(); hintEl._pick(); return; } e.preventDefault(); send(); } else if (e.key === 'Escape') { if (hintEl) { hintEl.remove(); hintEl = null; } else if (replyTo) { replyTo = null; paintExtras(); } } },
      onPaste: (e) => { const f = [...(e.clipboardData ? e.clipboardData.files : [])].find((x) => x.type.startsWith('image/')); if (f) { e.preventDefault(); attach(f); } } });
    sendBtn = h('button.btn.primary.icon', { type: 'button', 'aria-label': t('Send'), onClick: send }, icon('send', 19));
    mount(composerBox, extraBox, h('div.dm-compose.cm-compose',
      h('button.btn.ghost.icon', { type: 'button', 'aria-label': t('Attach an image'), title: t('Attach an image'), onClick: async () => { const f = await pickFile('image/png,image/jpeg,image/gif,image/webp'); if (f) attach(f); } }, icon('image', 20)),
      h('div.grow', ta),
      h('button.btn.ghost.icon', { type: 'button', 'aria-label': t('Emoji'), onClick: (e) => emojiPicker(e.currentTarget, (em) => { ta.value += em; ta.focus(); autosize(); }) }, icon('smile', 20)),
      can(sv, 'attach') ? h('button.btn.ghost.icon', { type: 'button', 'aria-label': t('Create a poll'), title: t('Create a poll'), onClick: createPoll }, icon('chart', 19)) : null,
      can(sv, 'attach') ? h('button.btn.ghost.icon', { type: 'button', 'aria-label': t('Record a voice message'), title: t('Record a voice message'), onClick: recordVoice }, icon('mic', 19)) : null, sendBtn),
      ch.slow && !can(sv, 'manage_messages') ? h('div.tiny.muted.cm-slow', icon('clock', 12), ' ' + t('Slowmode: {n}s between messages', { n: ch.slow })) : null);
    paintExtras();
  }
  const autosize = () => { if (!ta) return; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; };
  function paintExtras() {
    if (!extraBox) return;
    mount(extraBox,
      replyTo ? h('div.cm-replying', icon('reply', 14), h('span', t('Replying to {n}', { n: (userOf(replyTo.a).displayName || userOf(replyTo.a).username) })), h('span.cm-rtxt.grow', (replyTo.c || '').slice(0, 80)), h('button.btn.ghost.icon.sm', { type: 'button', 'aria-label': t('Cancel reply'), onClick: () => { replyTo = null; paintExtras(); } }, icon('x', 14))) : null,
      pending.length ? h('div.cm-pending', pending.map((p, i) => h('div.cm-chip', h('img', { src: p.url, alt: '' }), h('button', { type: 'button', 'aria-label': t('Remove'), onClick: () => { pending.splice(i, 1); paintExtras(); } }, icon('x', 12))))) : null);
  }
  async function attach(file) {
    if (pending.length >= 4) return toast(t('You can attach up to 4 images.'), 'err');
    try { const r = await api.upload('chat', file); pending.push({ url: r.url }); paintExtras(); } catch (e) { toastErr(e); }
  }
  async function recordVoice() {
    const comp = composerBox && composerBox.querySelector('.cm-compose'); if (!comp) return; const id = chId;
    const rec = await voice.record(comp); if (!rec) return;
    try {
      const up = await api.upload('voice', rec.blob);
      const r = await api.post(`/api/channels/${id}/messages`, { content: '', voice: { url: up.url, dur: rec.dur }, reply: replyTo ? replyTo.id : undefined });
      replyTo = null; paintExtras(); addMessage(id, r.message, S.me); markRead(id, r.message.id); if (id === chId) paintMsgs('bottom');
    } catch (e) { toastErr(e); }
  }
  function createPoll() {
    const q = h('input.input', { maxlength: 140, placeholder: t('What should we play tonight?') });
    const opts = h('div.col', { style: 'gap:6px' });
    const addOpt = (v = '') => { if (opts.children.length >= 6) return; opts.appendChild(h('input.input', { maxlength: 60, value: v, placeholder: t('Option {n}', { n: opts.children.length + 1 }) })); };
    addOpt(); addOpt();
    const id = chId;
    modal({ title: t('Create a poll'), cls: 'narrow', body: h('div.col', field(t('Question'), q), h('div.field', h('label', t('Options')), opts, h('button.btn.ghost.sm', { type: 'button', style: 'align-self:flex-start', onClick: () => addOpt() }, icon('plus', 14), t('Add option')))),
      actions: [{ label: t('Cancel') }, { label: t('Post poll'), kind: 'primary', onClick: async () => {
        try { const r = await api.post(`/api/channels/${id}/messages`, { content: '', poll: { q: q.value, options: [...opts.children].map((i) => i.value).filter((x) => x.trim()) } }); addMessage(id, r.message, S.me); if (id === chId) paintMsgs('bottom'); } catch (e) { toastErr(e); return false; }
      } }] });
  }
  const pingAt = { t: 0 };
  function typingPing() { if (!ta || !ta.value.trim() || Date.now() - pingAt.t < 2500) return; pingAt.t = Date.now(); api.post(`/api/channels/${chId}/typing`, {}, { quiet: true }).catch(() => {}); }
  const COMMANDS = [['/roll', 'Roll dice, e.g. /roll 2d6'], ['/flip', 'Flip a coin'], ['/poll', 'Create a poll'], ['/tr', 'Translate your text, e.g. /tr en hola'], ['/me', 'Describe an action'], ['/shrug', '¯\\_(ツ)_/¯'], ['/tableflip', '(╯°□°)╯︵ ┻━┻']];
  let hintEl = null; let svCmds = []; let botInfo = null; let cmdsFor = null;
  async function loadCmds() { const sv = curSv(); if (!sv || cmdsFor === sv.id) return; cmdsFor = sv.id; try { const r = await api.get(`/api/servers/${sv.id}/commands`, { quiet: true }); botInfo = r.bot; svCmds = r.on ? r.builtin.map(([c, d]) => [c, d, r.bot.i]).concat(r.custom.map((k) => ['!' + k, t('Custom command'), r.bot.i])) : r.custom.map((k) => ['!' + k, t('Custom command'), r.bot.i]); } catch { svCmds = []; } }
  function cmdHint() {
    loadCmds();
    if (hintEl) { hintEl.remove(); hintEl = null; }
    const v = ta.value; if (mentionHint()) return; if (!/^[/!]\w*$/.test(v)) return;
    const q = v.slice(1).toLowerCase(); const all = COMMANDS.concat(svCmds.filter(([c]) => !COMMANDS.some(([x]) => x === c.split(' ')[0]))); const list = all.filter(([c]) => c.slice(1).startsWith(q)).slice(0, 12); if (!list.length) return;
    hintEl = h('div.cm-cmds', list.map(([c, d, bot]) => h('button.cm-cmd', { type: 'button', onMousedown: (e) => { e.preventDefault(); ta.value = c.split(' ')[0] + ' '; ta.focus(); cmdHint(); autosize(); } }, bot ? h('span.cm-cmdbot', bot) : null, h('b', c), h('span.muted', t(d)))));
    extraBox.appendChild(hintEl);
  }
  // @ autocomplete: members (from the member list or anyone seen in this chat) and roles you can mention.
  function mentionHint() {
    const pos = ta.selectionStart; const before = ta.value.slice(0, pos);
    const m = /(^|\s)@([\p{L}\p{N}_]{0,24})$/u.exec(before); if (!m) return false;
    const q = m[2].toLowerCase(); const sv = curSv(); const opts = [];
    const pool = new Map(); (members && membersFor === svId ? members.members.map((x) => x.user) : []).forEach((u) => pool.set(u.id, u)); users.forEach((u) => { if (!pool.has(u.id)) pool.set(u.id, u); });
    for (const u of pool.values()) { if (!u.username || u.deleted || u.system) continue; if (u.username.toLowerCase().startsWith(q) || (u.displayName || '').toLowerCase().startsWith(q)) opts.push({ k: 'u', ins: u.username, u }); if (opts.length >= 6) break; }
    const canAll = sv && can(sv, 'mention_everyone');
    for (const r of (sv && sv.roles) || []) if ((r.mentionable || canAll) && r.name.toLowerCase().startsWith(q)) opts.push({ k: 'r', ins: r.name, r });
    for (const g of groles) { const n = roleAliases(g).find((x) => x.toLowerCase().startsWith(q)); if (n) opts.push({ k: 'r', ins: n, r: g }); }
    if (canAll) ['everyone', 'here'].filter((x) => x.startsWith(q)).forEach((x) => opts.push({ k: 'r', ins: x, r: { name: x } }));
    if (!opts.length) return false;
    const pick = (o) => { const start = pos - m[2].length - 1; ta.value = ta.value.slice(0, start) + '@' + o.ins + ' ' + ta.value.slice(pos); const c = start + o.ins.length + 2; ta.setSelectionRange(c, c); ta.focus(); if (hintEl) { hintEl.remove(); hintEl = null; } autosize(); };
    hintEl = h('div.cm-cmds.cm-mentions', opts.slice(0, 10).map((o, i) => h('button.cm-cmd' + (i === 0 ? '.on' : ''), { type: 'button', onMousedown: (e) => { e.preventDefault(); pick(o); } },
      o.k === 'u' ? [avatarEl(o.u, { size: 22 }), h('b', o.u.displayName || o.u.username), h('span.muted', '@' + o.u.username)]
        : [h('span.cm-mrole', { style: o.r.color ? { '--rc': o.r.color } : null }, (o.r.icon ? o.r.icon + ' ' : '') + '@' + o.ins), h('span.muted', t('Role'))])));
    hintEl._pick = () => pick(opts[0]);
    extraBox.appendChild(hintEl); return true;
  }
  // Slash commands typed in the composer. Some are sent as normal text, some (/poll, /tr) do something local.
  async function runCommand(raw) {
    const m = /^\/(\w+)\s*([\s\S]*)$/.exec(raw); if (!m) return false;
    const cmd = m[1].toLowerCase(); const arg = m[2].trim();
    const dice = (n, s) => Array.from({ length: Math.min(n, 20) }, () => 1 + Math.floor(Math.random() * s));
    if (cmd === 'shrug') { ta.value = (arg ? arg + ' ' : '') + '¯\\_(ツ)_/¯'; return true; }
    if (cmd === 'tableflip') { ta.value = (arg ? arg + ' ' : '') + '(╯°□°)╯︵ ┻━┻'; return true; }
    if (cmd === 'unflip') { ta.value = (arg ? arg + ' ' : '') + '┬─┬ ノ( ゜-゜ノ)'; return true; }
    if (cmd === 'me') { ta.value = '*' + (arg || '…') + '*'; return true; }
    if (cmd === 'flip') { ta.value = t('flips a coin: {r}', { r: Math.random() < 0.5 ? t('Heads') : t('Tails') }); return true; }
    if (cmd === 'roll') { const d = /(\d*)d(\d+)/i.exec(arg) || [0, 1, 6]; const n = Math.max(1, +(d[1] || 1)); const s = Math.max(2, Math.min(1000, +d[2])); const r = dice(n, s); ta.value = t('rolls {n}d{s}: {r} (total {t})', { n, s, r: r.join(', '), t: r.reduce((a, b) => a + b, 0) }); return true; }
    if (cmd === 'poll') { ta.value = ''; autosize(); createPoll(); return true; }
    if (cmd === 'tr' || cmd === 'translate') {
      const to = /^([a-z]{2})\s+/i.exec(arg); const text = to ? arg.slice(to[0].length) : arg; if (!text.trim()) return true;
      ta.disabled = true; try { const { translate } = await import('../translator.js'); const r = await translate(text, to ? to[1].toLowerCase() : undefined); ta.value = r.text; } catch (e) { toastErr(e); } finally { ta.disabled = false; ta.focus(); autosize(); }
      return true;
    }
    return false;
  }
  async function send() {
    if (!ta || sending) return; let text = ta.value.trim(); if (!text && !pending.length) return;
    if (text.startsWith('/') && await runCommand(text)) { autosize(); ta.focus(); if (!ta.value.trim()) return; text = ta.value.trim(); if (!text) return; }
    sending = true; sendBtn.disabled = true; const id = chId;
    try {
      const r = await api.post(`/api/channels/${id}/messages`, { content: text, attachments: pending.map((p) => p.url), reply: replyTo ? replyTo.id : undefined });
      ta.value = ''; autosize(); pending = []; replyTo = null; pingAt.t = 0; paintExtras();
      if (r.command) { // a bot command: show its answer (public) or a note only you can see
        if (r.ephemeral) addMessage(id, { id: 'eph' + Date.now(), a: 'bot', b: botInfo || { n: 'Nebubot', i: '🤖' }, c: r.ephemeral, t: Date.now(), eph: 1, cmd: { by: S.me.id, n: text.split(/\s/)[0] } });
        if (r.message) addMessage(id, r.message);
        if (id === chId) paintMsgs('bottom'); if (r.channel) openChannelSoon(r.channel); return;
      }
      addMessage(id, r.message, S.me); markRead(id, r.message.id); if (id === chId) { paintMsgs('bottom'); } paintServers(); paintChannels();
    } catch (e) { toastErr(e); }
    finally { sending = false; if (sendBtn) sendBtn.disabled = false; if (ta) ta.focus(); }
  }

  function paintTyping() {
    if (!typingEl) return; const now = Date.now();
    for (const [k, v] of typers) if (v.until < now) typers.delete(k);
    const names = [...typers.values()].map((x) => x.n);
    mount(typingEl, names.length ? [h('span.cm-dots', h('i'), h('i'), h('i')), names.length === 1 ? t('{a} is typing…', { a: names[0] }) : names.length === 2 ? t('{a} and {b} are typing…', { a: names[0], b: names[1] }) : t('Several people are typing…')] : ' ');
  }

  // ---------------- members ----------------
  function toggleMembers() { membersOpen = !membersOpen; ls('cm.members', membersOpen); wrap.classList.toggle('mem-open', membersOpen); if (membersOpen) loadMembers(); paintMembersPanel(); const b = mainCol.querySelector('.cm-head [aria-pressed]'); if (b) b.setAttribute('aria-pressed', String(membersOpen)); }
  async function loadMembers() {
    const sv = curSv(); if (!sv) return; const id = sv.id;
    try { const r = await api.get(`/api/servers/${id}/members`); r.members.forEach((m) => remember(m.user)); if (id !== svId) return; members = r; membersFor = id; paintMembersPanel(); if (chId) paintMsgs('keep'); } catch (e) { /* not fatal */ }
  }
  function paintMembersPanel() {
    wrap.classList.toggle('mem-open', membersOpen);
    if (!membersOpen) return mount(memCol);
    if (!members || membersFor !== svId) return mount(memCol, loading());
    const sv = curSv(); const roles = (sv && sv.roles) || [];
    const isOn = (m) => S.online.has(m.user.id) || m.user.id === S.me.id;
    const row = (m) => {
      const u = withPresence(m.user); const st = m.style; const sub = (S.acts[u.id] && actText(S.acts[u.id])) || statusText(S.statuses[u.id] || u.status) || (u.act ? actText(u.act) : '');
      return h('button.cm-mem' + (isOn(m) ? '' : '.off'), { type: 'button', onClick: (e) => userMenu(u, e) }, avatarEl(Object.assign({}, u, { online: isOn(m) }), { size: 32, status: true }),
        h('div.grow', { style: 'min-width:0' }, h('div.cm-mname', { style: st && st.color ? `color:${st.color}` : null }, nameEl(u), st && st.icon ? h('span.cm-ricon', st.icon) : null, (u.groles || []).filter((g) => g.icon).slice(0, 2).map((g) => h('span.cm-ricon', { title: '@' + roleName(g) }, g.icon)), m.role === 'owner' ? h('span.cm-crown', { title: t('Owner') }, icon('crown', 12)) : null), sub ? h('div.tiny.muted.ellipsis.cm-msub', sub) : null),
        m.muted ? h('span', { title: t('Timed out') }, icon('micoff', 13)) : null);
    };
    // Discord-style groups: site staff (official server), hoisted server roles, hoisted community roles, then everyone else online, then offline.
    const groups = []; const used = new Set(); const online = members.members.filter(isOn);
    const take = (r, test) => { const list = online.filter((m) => !used.has(m.user.id) && test(m)); list.forEach((m) => used.add(m.user.id)); if (list.length) groups.push([r, list]); };
    if (sv && sv.official) for (const k of ['owner', 'admin', 'mod']) take(SITE_ROLES[k], (m) => m.user.role === k);
    for (const r of roles) if (r.hoist) take(r, (m) => (m.roles || []).includes(r.id));
    for (const g of groles) if (g.hoist !== false) take(g, (m) => (m.user.groles || []).some((x) => x.id === g.id));
    const restOn = online.filter((m) => !used.has(m.user.id)); const off = members.members.filter((m) => !isOn(m));
    const sep = (r, n) => h('div.cm-rolesep', { style: r.color ? { '--rc': r.color } : null }, r.icon ? h('span.rc-ic', r.icon) : null, h('span.cm-rsname', '@' + roleName(r)), h('span.cm-rscount', '— ' + n));
    mount(memCol, h('div.cm-memhead', h('b', t('Members')), h('span.tiny.muted', ' · ' + t('{a} online of {b}', { a: online.length, b: members.total }))),
      groups.map(([r, list]) => [sep(r, list.length), list.map(row)]),
      restOn.length ? [h('div.cm-rolesep.plain', h('span.cm-rsname', t('Online')), h('span.cm-rscount', '— ' + restOn.length)), restOn.map(row)] : null,
      off.length ? [h('div.cm-rolesep.plain', h('span.cm-rsname', t('Offline')), h('span.cm-rscount', '— ' + off.length)), off.map(row)] : null);
  }

  // after a ticket is created the server list refreshes; wait for the new channel and open it
  async function openChannelSoon(id) { for (let i = 0; i < 12; i++) { const sv = curSv(); if (sv && sv.channels.some((c) => c.id === id)) { selectChannel(id); return; } await loadServers().catch(() => {}); paintChannels(); await new Promise((r) => setTimeout(r, 250)); } }
  const inVoice = (uid) => { const sv = curSv(); if (!sv) return null; for (const c of sv.channels) if ((vroom.rooms.get(c.id) || []).some((x) => x.id === uid)) return c.id; return null; };
  function userMenu(u, ev) {
    if (!u || u.system) return; const sv = curSv(); const mem = members && members.members.find((m) => m.user.id === u.id);
    const me = u.id === S.me.id; const isFriend = (S.friends.friends || []).some((f) => f.id === u.id);
    const above = sv && mem && outranks(sv, mem);
    const st = S.statuses[u.id] || u.status; const ac = S.acts[u.id] || u.act;
    openMenu([
      st && statusText(st) ? { label: statusText(st), icon: 'smile', disabled: true } : null,
      ac ? { label: actText(ac), icon: 'spark', disabled: true } : null,
      { label: t('View profile'), icon: 'user', onClick: () => go('profile', u.username) },
      !me ? { label: t('Message'), icon: 'mail', onClick: () => go('dm', u.id) } : null,
      !me && !isFriend ? { label: t('Add friend'), icon: 'plus', onClick: async () => { try { const r = await api.post('/api/friends/request', { username: u.username }); toast(r.accepted ? t('You are now friends!') : t('Friend request sent.'), 'good'); } catch (e) { toastErr(e); } } } : null,
      !me ? { label: t('Challenge to a duel'), icon: 'gamepad', onClick: () => go('arcade', { tab: 'duels' }) } : null,
      sv && mem && (can(sv, 'manage_roles') && (above || (me && sv.myRole === 'owner'))) ? { hr: true } : null,
      sv && mem && (can(sv, 'manage_roles') && (above || (me && sv.myRole === 'owner'))) ? { label: t('Roles…'), icon: 'shield', onClick: () => assignRolesModal(sv, mem, () => { loadMembers(); loadServers().catch(() => {}); }) } : null,
      above && (can(sv, 'timeout') || can(sv, 'kick') || can(sv, 'ban')) ? { hr: true } : null,
      above && can(sv, 'timeout') ? { label: t('Timeout 10 minutes'), icon: 'clock', onClick: () => modAct(u, 'timeout', { minutes: 10 }) } : null,
      above && can(sv, 'timeout') ? { label: t('Timeout 1 day'), icon: 'clock', onClick: () => modAct(u, 'timeout', { minutes: 1440 }) } : null,
      above && can(sv, 'timeout') ? { label: t('Warn…'), icon: 'alert', onClick: async () => { const { promptBox } = await import('../ui.js'); const reason = await promptBox(t('Warn {n}', { n: u.displayName || u.username }), { label: t('Reason'), placeholder: t('Spam in #general') }); if (reason === null) return; try { const r = await api.post(`/api/servers/${sv.id}/members/${u.id}/warn`, { reason }); toast(t('Warning #{n} sent', { n: r.count }), 'good'); } catch (e) { toastErr(e); } } } : null,
      above && can(sv, 'timeout') ? { label: t('Warnings'), icon: 'clock', onClick: async () => { try { const r = await api.get(`/api/servers/${sv.id}/members/${u.id}/warns`); modal({ title: t('Warnings') + ' · ' + (u.displayName || u.username), cls: 'narrow', body: r.warns.length ? h('ol', r.warns.map((w) => h('li', h('b', fmt.dt(w.t)), ' — ', w.reason || t('No reason'), h('span.tiny.muted', ' · ' + (w.by === 'bot' ? 'AutoMod' : r.users[w.by] ? '@' + r.users[w.by].username : '?'))))) : h('p.muted', t('No warnings.')), actions: [r.warns.length ? { label: t('Clear all'), kind: 'danger', onClick: async () => { await api.del(`/api/servers/${sv.id}/members/${u.id}/warns`); toast(t('Warnings cleared'), 'good'); } } : null, { label: t('Close') }].filter(Boolean) }); } catch (e) { toastErr(e); } } } : null,
      above && can(sv, 'timeout') && inVoice(u.id) ? { label: t('Mute in voice'), icon: 'micoff', onClick: async () => { try { const v = (vroom.rooms.get(inVoice(u.id)) || []).find((x) => x.id === u.id); await api.post(`/api/servers/${sv.id}/voice/${u.id}/mute`, { on: !(v && v.smute) }); } catch (e) { toastErr(e); } } } : null,
      above && can(sv, 'kick') && inVoice(u.id) ? { label: t('Disconnect from voice'), icon: 'phoneoff', onClick: async () => { try { await api.post(`/api/servers/${sv.id}/voice/${u.id}/disconnect`, {}); } catch (e) { toastErr(e); } } } : null,
      above && can(sv, 'kick') ? { label: t('Kick'), icon: 'logout', danger: true, onClick: () => modAct(u, 'kick', {}, true) } : null,
      above && can(sv, 'ban') ? { label: t('Ban'), icon: 'shield', danger: true, onClick: () => modAct(u, 'ban', {}, true) } : null,
    ], ev.currentTarget || ev);
  }
  async function modAct(u, action, body, confirm) {
    const sv = curSv(); const name = u.displayName || u.username;
    if (confirm && !(await confirmBox(action === 'ban' ? t('Ban {n} from this server?', { n: name }) : t('Kick {n} from this server?', { n: name }), { danger: true, ok: action === 'ban' ? t('Ban') : t('Kick') }))) return;
    try { await api.post(`/api/servers/${sv.id}/members/${u.id}/${action}`, body); toast(t('Done.'), 'good'); loadMembers(); } catch (e) { toastErr(e); }
  }

  // ---------------- server / channel management ----------------
  // Server icons are now monograms generated from the name; the stored icon field is kept for older clients.
  function iconPicker(initial) { const el = h('span', { style: 'display:none' }); el.get = () => initial || ICONS[0]; el.hidden = true; return el; }
  async function addServer() {
    let mode = 'create'; let out = null;
    const name = h('input.input', { maxlength: '32', placeholder: t('My awesome squad'), 'aria-label': t('Server name') }); const desc = h('input.input', { maxlength: '200', placeholder: t('What is this server about?'), 'aria-label': t('Description') });
    const ic = iconPicker('🎮'); const code = h('input.input', { placeholder: t('Paste an invite code'), 'aria-label': t('Invite code'), spellcheck: 'false' });
    const createBox = h('div.col', field(t('Server name'), name), ic, field(t('Description (optional)'), desc));
    const joinBox = h('div.col', { style: 'display:none' }, field(t('Invite code'), code), h('p.small.muted', t('Ask a friend for an invite from their server menu. Codes last 7 days.')));
    const seg = segEl([['create', t('Create')], ['join', t('Join with a code')]], 'create', (v) => { mode = v; createBox.style.display = v === 'create' ? '' : 'none'; joinBox.style.display = v === 'join' ? '' : 'none'; });
    const err = h('div.error.small');
    await modal({ title: t('Add a server'), body: h('div.col', seg, createBox, joinBox, err), actions: [{ label: t('Cancel'), value: null }, { label: t('Continue'), kind: 'primary', onClick: async () => {
      err.textContent = '';
      try {
        if (mode === 'create') { if (name.value.trim().length < 2) { err.textContent = t('Server name must be 2-32 characters'); return false; } out = (await api.post('/api/servers', { name: name.value.trim(), icon: ic.get(), desc: desc.value.trim() })).server; }
        else { if (!code.value.trim()) { err.textContent = t('Paste an invite code'); return false; } out = (await api.post('/api/servers/join', { code: code.value.trim() })).server; }
      } catch (e) { err.textContent = e.message; return false; }
    } }] });
    if (out) { await loadServers(); toast(mode === 'create' ? t('Server created!') : t('Joined {n}!', { n: out.name }), 'good'); await selectServer(out.id); }
  }
  async function discover() {
    let list = []; let p;
    const box = h('div.col', { style: 'gap:8px;max-height:60vh;overflow:auto' }, loading());
    const paint = () => mount(box, list.length ? list.map((s) => h('div.cm-disc', h('span.cm-sv.static', h('span.sv-mono', svMono(s))), h('div.grow', { style: 'min-width:0' }, h('b', s.name), h('div.small.muted', s.desc || t('No description.')), h('div.tiny.muted', t('{n} members', { n: s.members }))),
      h('button.btn.sm.primary', { type: 'button', onClick: async (e) => { const b = e.currentTarget; b.disabled = true; try { const r = await api.post(`/api/servers/${s.id}/join`); await loadServers(); toast(t('Joined {n}!', { n: r.server.name }), 'good'); p.close(); selectServer(r.server.id); } catch (er) { toastErr(er); b.disabled = false; } } }, t('Join')))) : emptyState('🔭', t('Nothing to discover yet'), t('Public servers will show up here. Create one and make it public!')));
    p = modal({ title: t('Discover servers'), cls: 'wide', body: box, actions: [{ label: t('Close'), kind: 'primary' }] });
    try { list = (await api.get('/api/servers/discover')).servers; } catch (e) { toastErr(e); } paint(); await p;
  }
  async function invite() {
    const sv = curSv(); if (!sv) return;
    try {
      const r = await api.post(`/api/servers/${sv.id}/invites`); const link = `${location.origin}/#/chat?join=${r.code}`;
      modal({ title: t('Invite people to {n}', { n: sv.name }), cls: 'narrow', body: h('div.col', h('p.small.muted', t('Share this code or link. It works for 7 days and up to 50 people.')),
        h('div.row', { style: 'gap:8px' }, h('code.cm-code.grow', r.code), copyBtn(r.code, t('Copy code'))), h('div.row', { style: 'gap:8px' }, h('code.cm-code.grow.small', link), copyBtn(link, t('Copy link')))), actions: [{ label: t('Done'), kind: 'primary' }] });
    } catch (e) { toastErr(e); }
  }
  async function leaveServer() {
    const sv = curSv(); if (!sv || !(await confirmBox(t('Leave {n}?', { n: sv.name }), { danger: true, ok: t('Leave') }))) return;
    try { await api.post(`/api/servers/${sv.id}/leave`); await afterServerGone(sv.id); toast(t('You left {n}.', { n: sv.name })); } catch (e) { toastErr(e); }
  }
  async function afterServerGone(id) {
    await loadServers(); if (svId === id || !curSv()) { svId = null; chId = null; wrap.classList.remove('open'); const first = S.servers[0]; if (first) await selectServer(first.id); else { paintServers(); paintChannels(); paintMain(); mount(memCol); } }
  }
  async function serverSettings() {
    const sv = curSv(); if (!sv) return;
    await serverSettingsModal(sv, { iconPicker, onSaved: async () => { await loadServers().catch(() => {}); paintServers(); paintChannels(); if (membersOpen) loadMembers(); }, onDeleted: () => afterServerGone(sv.id) });
  }
  async function createChannel() {
    const sv = curSv(); if (!sv) return; let made = null;
    const name = h('input.input', { maxlength: '24', placeholder: t('new-channel'), 'aria-label': t('Channel name') }); const topic = h('input.input', { maxlength: '120', placeholder: t('What is this channel for?'), 'aria-label': t('Topic') }); const ro = switchEl(false, null, t('Read-only')); const err = h('div.error.small');
    const pv = privacyFields(sv, {});
    await modal({ title: t('Create a channel'), cls: 'narrow', body: h('div.col', field(t('Channel name'), name), field(t('Topic (optional)'), topic), h('div.setting', h('div.grow', t('Read-only (only moderators can post)')), ro), pv, err),
      actions: [{ label: t('Cancel'), value: null }, { label: t('Create'), kind: 'primary', onClick: async () => { try { made = (await api.post(`/api/servers/${sv.id}/channels`, Object.assign({ name: name.value, topic: topic.value.trim(), readOnly: ro.input.checked }, pv.get()))).channel; } catch (e) { err.textContent = e.message; return false; } } }] });
    if (made) { await loadServers(); selectChannel(made.id); }
  }
  async function channelSettings(ch) {
    const sv = curSv(); let gone = false; let p;
    const topic = h('input.input', { value: ch.topic || '', maxlength: '120', 'aria-label': t('Topic') }); const ro = switchEl(ch.readOnly, null, t('Read-only'));
    const slow = h('select.select', { 'aria-label': t('Slowmode') }, SLOW.map(([v, l]) => h('option', { value: v, selected: v === ch.slow }, t(l)))); const err = h('div.error.small');
    const pv = privacyFields(sv, ch);
    p = modal({ title: '# ' + ch.name, cls: 'narrow', body: h('div.col', field(t('Topic'), topic), h('div.setting', h('div.grow', t('Read-only (only moderators can post)')), ro), field(t('Slowmode'), slow), pv,
      sv.channels.length > 1 ? h('div.cm-danger', h('div.grow', h('b', t('Delete channel'))), h('button.btn.danger.sm', { type: 'button', onClick: async () => { if (await confirmBox(t('Delete #{n} and all its messages?', { n: ch.name }), { danger: true, ok: t('Delete') })) { try { await api.del(`/api/channels/${ch.id}`); gone = true; p.close(); } catch (e) { toastErr(e); } } } }, icon('trash', 15), t('Delete'))) : null, err),
      actions: [{ label: t('Cancel'), value: null }, { label: t('Save'), kind: 'primary', onClick: async () => { try { await api.patch(`/api/channels/${ch.id}`, Object.assign({ topic: topic.value.trim(), readOnly: ro.input.checked, slow: Number(slow.value) }, pv.get())); } catch (e) { err.textContent = e.message; return false; } }, value: 'saved' }] });
    const r = await p;
    if (gone) { await loadServers(); if (chId === ch.id) { const f = curSv() && curSv().channels[0]; if (f) selectChannel(f.id); } else { paintChannels(); } return; }
    if (r === 'saved') { await loadServers(); paintChannels(); paintMain(); paintMsgs('bottom'); }
  }

  // ---------------- realtime ----------------
  unsubs.push(
    bus.on('ws:msg', (m) => {
      if (m.sv) setStyle(m.sv, m.m.a, m.st || null);
      const added = addMessage(m.ch, m.m, m.u); if (!added) return;
      if (m.ch === chId && shown) {
        const near = nearBottom(); paintMsgs('keep');
        if (document.hasFocus()) { markRead(m.ch, m.m.id); } if (!near && m.m.a !== S.me.id && newPill) newPill.classList.remove('hide');
        paintServers(); paintChannels(); typers.delete(m.m.a); paintTyping();
      } else { const sv = S.servers.find((s) => s.id === m.sv); const ch = sv && sv.channels.find((c) => c.id === m.ch); if (ch) ch.last = m.m.id; }
      if (m.ch !== chId || !shown) { paintServers(); paintChannels(); }
    }),
    bus.on('ws:msg_edit', (m) => { const x = logOf(m.ch).msgs.find((y) => y.id === m.id); if (x) { x.c = m.c; x.e = m.e; if (m.em !== undefined) x.em = m.em; if (m.bt !== undefined) x.bt = m.bt; if (m.ch === chId) paintMsgs('keep'); } }),
    bus.on('ws:msg_del', (m) => { const l = logOf(m.ch); const n = l.msgs.length; l.msgs = l.msgs.filter((y) => y.id !== m.id); if (n !== l.msgs.length && m.ch === chId) paintMsgs('keep'); }),
    bus.on('vc', () => { paintChannels(); const old = mainCol && mainCol.querySelector('.cm-vcbtn'); const ch = curCh(); if (old && ch) old.replaceWith(vcBtn(ch)); }),
    bus.on('ws:pins', (m) => { const l = logOf(m.ch); for (const x of l.msgs) x.pin = m.pins.includes(x.id); if (m.ch === chId) paintMsgs('keep'); }),
    bus.on('ws:poll', (m) => { const x = logOf(m.ch).msgs.find((y) => y.pl && y.pl.id === m.id); if (x) { x.pl = Object.assign({}, x.pl, { counts: m.counts, total: m.total }); if (m.ch === chId) paintMsgs('keep'); } }),
    bus.on('ws:react', (m) => { const x = logOf(m.ch).msgs.find((y) => y.id === m.id); if (x) { x.rx = m.rx; if (m.ch === chId) paintMsgs('keep'); } }),
    bus.on('ws:typing', (m) => { if (m.ch !== chId) return; typers.set(m.u, { n: m.n, until: Date.now() + 4500 }); paintTyping(); setTimeout(paintTyping, 4700); }),
    bus.on('servers', async () => {
      if (!S.servers.length) { svId = null; chId = null; paintServers(); paintChannels(); paintMain(); mount(memCol); return; }
      if (!curSv()) { await selectServer(S.servers[0].id); return; }
      paintServers(); paintChannels();
      const ch = curCh();
      if (!ch) { const f = curSv().channels[0]; if (f) selectChannel(f.id); return; }
      const sig = chSig(ch); if (sig !== lastSig) { lastSig = sig; if (shown) { const keep = ta ? ta.value : ''; paintMain(); paintMsgs('bottom'); if (ta && keep) ta.value = keep; } }
      if (membersOpen) loadMembers();
    }),
    bus.on('badges', debounce(() => { if (shown) { paintServers(); paintChannels(); } }, 50)),
    bus.on('presence', debounce(() => { if (membersOpen && members) paintMembersPanel(); }, 150)),
    bus.on('ws:open', () => { loadServers().catch(() => {}); logs.forEach((l) => { l.loaded = false; }); if (chId && shown) { const id = chId; logOf(id).loaded = false; selectChannel(id); } }),
  );
  const onFocus = () => { if (shown && chId) { const l = logOf(chId); const last = l.msgs[l.msgs.length - 1]; if (last) { markRead(chId, last.id); paintServers(); paintChannels(); } } };
  window.addEventListener('focus', onFocus);
  const tick = setInterval(() => { if (shown) paintTyping(); }, 1500);

  async function openFromRoute(ctx) {
    const want = ctx && ctx.params && ctx.params[0]; const jc = ctx && ctx.query && ctx.query.get('join');
    if (jc) {
      history.replaceState(null, '', '#/chat');
      if (await confirmBox(t('Join the server with invite code {c}?', { c: jc }), { ok: t('Join') })) {
        try { const r = await api.post('/api/servers/join', { code: jc }); await loadServers(); toast(t('Joined {n}!', { n: r.server.name }), 'good'); await selectServer(r.server.id); return; } catch (e) { toastErr(e); }
      }
    }
    if (want) { for (const sv of S.servers) { if (sv.channels.some((c) => c.id === want)) { if (svId !== sv.id) { svId = sv.id; paintServers(); paintChannels(); } return selectChannel(want); } } }
  }

  return {
    async init(ctx) {
      paintServers(); mount(chanCol); mount(mainCol, loading(t('Loading the community…')));
      if (!S.servers.length) { try { await loadServers(); } catch (e) { toastErr(e); } }
      if (!curSv()) svId = S.servers[0] ? S.servers[0].id : null;
      const sv = curSv();
      if (!sv) { paintServers(); paintChannels(); paintMain(); return; }
      if (!sv.channels.some((c) => c.id === chId)) chId = (chMap()[sv.id] && sv.channels.some((c) => c.id === chMap()[sv.id]) ? chMap()[sv.id] : null) || (sv.channels.find((c) => c.name === 'general') || sv.channels[0] || {}).id || null;
      paintServers(); paintChannels(); loadVoice(sv.id); if (membersOpen) { wrap.classList.add('mem-open'); loadMembers(); }
      shown = true; if (chId) await selectChannel(chId); else paintMain();
      wrap.classList.remove('open');
    },
    async activate(ctx) {
      shown = true; S.activeChannel = chId; await openFromRoute(ctx);
      if (chId) { const l = logOf(chId); const last = l.msgs[l.msgs.length - 1]; if (last) markRead(chId, last.id); paintServers(); paintChannels(); if (msgsEl) { msgsEl.scrollTop = msgsEl.scrollHeight; stick = true; } }
      loadServers().catch(() => {});
    },
    deactivate() { shown = false; S.activeChannel = null; },
    destroy() { shown = false; S.activeChannel = null; unsubs.forEach((f) => f()); window.removeEventListener('focus', onFocus); clearInterval(tick); },
  };
}

export default {
  title: () => t('Community'), full: true,
  async mount(root, ctx) { inst = build(root, ctx.go); await inst.init(ctx); await inst.activate(ctx); return () => { if (inst) inst.destroy(); inst = null; }; },
  activate(ctx) { if (inst) inst.activate(ctx); },
  deactivate() { if (inst) inst.deactivate(); },
};

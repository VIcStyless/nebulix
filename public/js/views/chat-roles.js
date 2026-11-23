// Community server roles UI: server settings (overview, roles, members, @everyone), role assignment and private channels.
import { h, mount } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S } from '../state.js';
import { icon } from '../icons.js';
import { avatarEl, nameEl } from '../cosmetics.js';
import { modal, field, switchEl, toast, toastErr, confirmBox, emojiPicker, tabsEl, loading, emptyState } from '../ui.js';

export const PERM_GROUPS = [
  ['General', [['send', 'Send messages', 'Write in channels.'], ['attach', 'Attach images', 'Upload pictures to messages.'], ['react', 'Add reactions', 'React to messages with emoji.'], ['invite', 'Create invites', 'Invite new people to the server.']]],
  ['Moderation', [['manage_messages', 'Manage messages', 'Delete anyone\'s messages and skip slowmode.'], ['timeout', 'Timeout members', 'Temporarily mute members below them.'], ['kick', 'Kick members', 'Remove members below them.'], ['ban', 'Ban members', 'Ban members below them.'], ['mention_everyone', 'Mention all roles', 'Ping any role, even non-mentionable ones.'], ['post_readonly', 'Post in read-only channels', 'Write in announcement channels.']]],
  ['Management', [['manage_channels', 'Manage channels', 'Create, edit, delete and make channels private.'], ['manage_roles', 'Manage roles', 'Create and assign roles below their own.'], ['manage_server', 'Manage server', 'Change the name, icon and description.'], ['admin', 'Administrator', 'Every permission. Give it only to people you trust.']]],
];
const SWATCHES = ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#94a3b8'];
export const can = (sv, p) => !!(sv && sv.myPerms && (sv.myPerms.includes(p) || sv.myPerms.includes('admin')));
export const roleIdx = (sv, id) => (sv.roles || []).findIndex((r) => r.id === id);
// position of a member's highest role (0 = top); owner = -2
export function topOf(sv, mem) { if (!mem) return Infinity; if (mem.role === 'owner') return -2; let best = Infinity; for (const id of mem.roles || []) { const i = roleIdx(sv, id); if (i >= 0 && i < best) best = i; } return best; }
export const myTop = (sv) => (sv.myTop === null || sv.myTop === undefined ? Infinity : sv.myTop);
export const outranks = (sv, mem) => mem && mem.user && mem.user.id !== S.me.id && mem.role !== 'owner' && myTop(sv) < topOf(sv, mem);
export const editable = (sv, role) => can(sv, 'manage_roles') && myTop(sv) < roleIdx(sv, role.id);
export function roleChip(r) { return h('span.role-chip', { style: r.color ? `--rc:${r.color}` : null }, h('i'), r.icon ? r.icon + ' ' : '', r.name); }

// ---------------- server settings ----------------
export async function serverSettingsModal(sv, { onSaved, onDeleted, iconPicker }) {
  let tab = can(sv, 'manage_server') ? 'overview' : 'roles'; let p; let deleted = false;
  const body = h('div.col.rl-body');
  const tabs = tabsEl([can(sv, 'manage_server') ? ['overview', t('Overview'), 'gear'] : null, can(sv, 'manage_roles') ? ['roles', t('Roles'), 'shield'] : null, can(sv, 'manage_roles') ? ['members', t('Members'), 'users'] : null, can(sv, 'manage_roles') ? ['everyone', '@everyone', 'globe'] : null].filter(Boolean), tab, (v) => { tab = v; paint(); });
  const refresh = async () => { const r = await api.get('/api/servers'); const n = r.servers.find((x) => x.id === sv.id); if (n) Object.assign(sv, n); };
  function paint() { ({ overview: paintOverview, roles: paintRoles, members: paintMembers, everyone: paintEveryone }[tab] || paintRoles)(); }

  function paintOverview() {
    const name = h('input.input', { value: sv.name, maxlength: '32', 'aria-label': t('Server name') }); const desc = h('input.input', { value: sv.desc || '', maxlength: '200', 'aria-label': t('Description') }); const ic = iconPicker(sv.icon || '🎮');
    const pub = switchEl(sv.public, null, t('Public server')); const err = h('div.error.small');
    mount(body, field(t('Server name'), name), ic, field(t('Description'), desc),
      sv.official ? null : h('div.setting', h('div.grow', h('div', { style: 'font-weight:600' }, t('Public server')), h('div.sd', t('Listed in Discover so anyone can join without an invite.'))), pub), err,
      h('div.row', h('button.btn.primary', { onClick: async () => { try { await api.patch(`/api/servers/${sv.id}`, Object.assign({ name: name.value.trim(), desc: desc.value.trim(), icon: ic.get() }, sv.official ? {} : { public: pub.input.checked })); toast(t('Server updated.'), 'good'); onSaved && onSaved(); } catch (e) { err.textContent = e.message; } } }, t('Save changes'))),
      !sv.official && sv.myRole === 'owner' ? h('div.cm-danger', h('div.grow', h('b', t('Delete server')), h('div.small.muted', t('This removes every channel and message. It cannot be undone.'))), h('button.btn.danger.sm', { type: 'button', onClick: async () => { if (await confirmBox(t('Delete {n} forever?', { n: sv.name }), { danger: true, ok: t('Delete server') })) { try { await api.del(`/api/servers/${sv.id}`); deleted = true; p.close(); } catch (e) { toastErr(e); } } } }, icon('trash', 15), t('Delete'))) : null);
  }

  let selRole = null;
  function paintRoles() {
    const list = h('div.rl-list'); const ed = h('div.rl-ed');
    const roles = sv.roles || [];
    const move = async (i, d) => { const ids = roles.map((r) => r.id); const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; try { await api.put(`/api/servers/${sv.id}/roles/order`, { ids }); await refresh(); paintRoles(); } catch (e) { toastErr(e); } };
    mount(list, h('div.row.between', h('b.small', t('Roles') + ` (${roles.length}/25)`), h('button.btn.sm.primary', { disabled: roles.length >= 25, onClick: async () => { try { const r = await api.post(`/api/servers/${sv.id}/roles`, { name: t('New role'), color: SWATCHES[roles.length % SWATCHES.length] }); await refresh(); selRole = r.role.id; paintRoles(); } catch (e) { toastErr(e); } } }, icon('plus', 14), t('Create role'))),
      h('p.tiny.muted', t('Roles higher in the list outrank the ones below. You can only edit roles below your own.')),
      roles.length ? roles.map((r, i) => h('div.rl-item' + (selRole === r.id ? '.on' : '') + (editable(sv, r) ? '' : '.locked'), { onClick: () => { selRole = r.id; paintRoles(); } },
        h('span.rl-dot', { style: `background:${r.color || '#94a3b8'}` }), h('span.grow.ellipsis', (r.icon ? r.icon + ' ' : '') + r.name), editable(sv, r) ? null : h('span.tiny.muted', '🔒'),
        editable(sv, r) && i > 0 && editable(sv, roles[i - 1]) ? h('button.btn.ghost.icon.sm', { title: t('Move up'), onClick: (e) => { e.stopPropagation(); move(i, -1); } }, '▲') : null,
        editable(sv, r) && i < roles.length - 1 ? h('button.btn.ghost.icon.sm', { title: t('Move down'), onClick: (e) => { e.stopPropagation(); move(i, 1); } }, '▼') : null)) : emptyState('🛡️', t('No roles yet'), t('Create roles like "Moderator" or "VIP", give them colours and permissions, then assign them to members.')));
    const r = roles.find((x) => x.id === selRole) || null;
    if (!r) mount(ed, h('div.empty', h('div.empty-art.ea-mark'), h('p.muted', t('Pick a role to edit it.'))));
    else {
      const lock = !editable(sv, r);
      const name = h('input.input', { value: r.name, maxlength: 32, disabled: lock });
      let color = r.color; let ic = r.icon || '';
      const sw = h('div.rl-sw', [...SWATCHES, null].map((c) => h('button.rl-swb' + (color === c ? '.on' : ''), { type: 'button', disabled: lock, title: c || t('No colour'), style: c ? `background:${c}` : null, onClick: (e) => { color = c; sw.querySelectorAll('.rl-swb').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); } }, c ? '' : '∅')), h('input', { type: 'color', value: color || '#8b5cf6', disabled: lock, title: t('Custom colour'), onInput: (e) => { color = e.target.value; } }));
      const icb = h('button.btn.sm', { type: 'button', disabled: lock, onClick: (e) => emojiPicker(e.currentTarget, (x) => { ic = x; icb.textContent = x; }) }, ic || t('Pick an icon'));
      const hoist = switchEl(r.hoist, null, t('Show separately')); const ment = switchEl(r.mentionable, null, t('Mentionable'));
      if (lock) { hoist.input.disabled = true; ment.input.disabled = true; }
      const perms = new Set(r.perms);
      const permEls = PERM_GROUPS.map(([g, list2]) => h('div.rl-pg', h('div.rl-pgh', t(g)), list2.map(([id, label, desc]) => { const sw2 = switchEl(perms.has(id), (v) => { if (v) perms.add(id); else perms.delete(id); }); const mine = can(sv, id) || sv.myRole === 'owner'; if (lock || !mine) sw2.input.disabled = true; return h('div.setting.rl-perm' + (id === 'admin' ? '.danger' : ''), h('div.grow', h('div', { style: 'font-weight:600' }, t(label)), h('div.sd', t(desc) + (!mine && !lock ? ' · ' + t('You don\'t have this permission yourself') : ''))), sw2); })));
      const count = h('span.tiny.muted');
      mount(ed, h('div.row', roleChip(Object.assign({}, r, { color })), h('div.grow'), count),
        field(t('Role name'), name), h('div.field', h('label', t('Colour')), sw), h('div.field', h('label', t('Icon')), h('div.row', icb, ic ? h('button.btn.ghost.sm', { disabled: lock, onClick: () => { ic = ''; icb.textContent = t('Pick an icon'); } }, t('Remove')) : null)),
        h('div.setting', h('div.grow', h('div', { style: 'font-weight:600' }, t('Show members separately')), h('div.sd', t('Members with this role get their own group in the member list.'))), hoist),
        h('div.setting', h('div.grow', h('div', { style: 'font-weight:600' }, t('Allow anyone to @mention this role'))), ment),
        h('h4', t('Permissions')), permEls,
        lock ? h('p.small.muted', t('This role is at or above your highest role, so you cannot change it.')) : h('div.row', h('button.btn.primary', { onClick: async () => { try { await api.patch(`/api/servers/${sv.id}/roles/${r.id}`, { name: name.value.trim(), color, icon: ic, hoist: hoist.input.checked, mentionable: ment.input.checked, perms: [...perms] }); await refresh(); toast(t('Role saved'), 'good'); paintRoles(); onSaved && onSaved(); } catch (e) { toastErr(e); } } }, t('Save role')), h('div.grow'),
          h('button.btn.danger.sm', { onClick: async () => { if (!(await confirmBox(t('Delete the role "{r}"? Members keep everything else.', { r: r.name }), { danger: true, ok: t('Delete') }))) return; try { await api.del(`/api/servers/${sv.id}/roles/${r.id}`); selRole = null; await refresh(); paintRoles(); onSaved && onSaved(); } catch (e) { toastErr(e); } } }, icon('trash', 14), t('Delete role'))));
      api.get(`/api/servers/${sv.id}/members`, { quiet: true }).then((m) => { count.textContent = t('{n} members', { n: m.members.filter((x) => (x.roles || []).includes(r.id)).length }); }).catch(() => {});
    }
    mount(body, h('div.rl-split', list, ed));
  }

  async function paintMembers() {
    mount(body, loading());
    let data; try { data = await api.get(`/api/servers/${sv.id}/members`); } catch (e) { mount(body, emptyState('⚠️', e.message)); return; }
    const q = h('input.input', { placeholder: t('Search members') }); const list = h('div.rl-mems');
    const paintList = () => mount(list, data.members.filter((m) => !q.value || (m.user.displayName + ' ' + m.user.username).toLowerCase().includes(q.value.toLowerCase())).map((m) => h('div.rl-mem', avatarEl(m.user, { size: 34, status: true }), h('div.grow', h('div', { style: m.style && m.style.color ? `color:${m.style.color};font-weight:700` : 'font-weight:700' }, (m.style && m.style.icon ? m.style.icon + ' ' : ''), nameEl(m.user)), h('div.row.wrap.gap-s', m.role === 'owner' ? h('span.role-chip.owner', t('Owner')) : null, (m.roles || []).map((id) => (sv.roles || []).find((r) => r.id === id)).filter(Boolean).map(roleChip))),
      m.role !== 'owner' && (outranks(sv, m) || m.user.id === S.me.id && sv.myRole === 'owner') ? h('button.btn.sm', { onClick: () => assignRolesModal(sv, m, async () => { data = await api.get(`/api/servers/${sv.id}/members`); paintList(); onSaved && onSaved(); }) }, icon('shield', 14), t('Roles')) : null)));
    q.oninput = paintList; mount(body, q, list); paintList();
  }

  function paintEveryone() {
    const perms = new Set(sv.everyone || []);
    mount(body, h('p.small.muted', t('What everyone in the server can do by default. Roles add permissions on top of these.')),
      PERM_GROUPS.map(([g, list2]) => h('div.rl-pg', h('div.rl-pgh', t(g)), list2.filter(([id]) => id !== 'admin').map(([id, label, desc]) => { const sw2 = switchEl(perms.has(id), (v) => { if (v) perms.add(id); else perms.delete(id); }); if (!can(sv, id) && sv.myRole !== 'owner') sw2.input.disabled = true; return h('div.setting', h('div.grow', h('div', { style: 'font-weight:600' }, t(label)), h('div.sd', t(desc))), sw2); }))),
      h('button.btn.primary', { onClick: async () => { try { await api.patch(`/api/servers/${sv.id}/everyone`, { perms: [...perms] }); await refresh(); toast(t('Saved'), 'good'); onSaved && onSaved(); } catch (e) { toastErr(e); } } }, t('Save')));
  }

  p = modal({ title: t('Server settings') + ' · ' + sv.name, cls: 'wide rl-modal', body: h('div.col', tabs, body), actions: [{ label: t('Close'), kind: 'primary' }] });
  paint(); await p;
  if (deleted) onDeleted && onDeleted(); else onSaved && onSaved();
}

export function assignRolesModal(sv, mem, onDone) {
  const have = new Set(mem.roles || []);
  const rows = (sv.roles || []).map((r) => { const ok = editable(sv, r) || sv.myRole === 'owner'; const sw = switchEl(have.has(r.id), (v) => { if (v) have.add(r.id); else have.delete(r.id); }); if (!ok) sw.input.disabled = true; return h('div.setting', h('div.grow', roleChip(r), ok ? null : h('div.sd', t('Above your highest role'))), sw); });
  return modal({ title: t('Roles for {u}', { u: mem.user.displayName || mem.user.username }), cls: 'narrow', body: h('div.col', rows.length ? rows : h('p.muted', t('This server has no roles yet. Create them in Server settings → Roles.'))),
    actions: [{ label: t('Cancel') }, { label: t('Save'), kind: 'primary', onClick: async () => { try { await api.put(`/api/servers/${sv.id}/members/${mem.user.id}/roles`, { roles: [...have] }); toast(t('Roles updated'), 'good'); onDone && onDone(); } catch (e) { toastErr(e); return false; } } }] });
}

// "Private channel" switch + which roles can see it (used when creating or editing a channel)
export function privacyFields(sv, ch = {}) {
  const sel = new Set(ch.roles || []);
  const roleBox = h('div.rl-chroles', (sv.roles || []).length ? (sv.roles || []).map((r) => { const sw = switchEl(sel.has(r.id), (v) => { if (v) sel.add(r.id); else sel.delete(r.id); }); return h('div.setting', h('div.grow', roleChip(r)), sw); }) : h('p.tiny.muted', t('Create roles first to choose who can see private channels.')));
  const priv = switchEl(!!ch.private, (v) => { roleBox.style.display = v ? '' : 'none'; });
  roleBox.style.display = ch.private ? '' : 'none';
  const el = h('div.col', h('div.setting', h('div.grow', h('div', { style: 'font-weight:600' }, t('Private channel')), h('div.sd', t('Only the selected roles (and admins) can see it.'))), priv), roleBox);
  el.get = () => ({ private: priv.input.checked, roles: [...sel] });
  return el;
}

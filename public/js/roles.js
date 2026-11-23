// Shared look for roles everywhere (member list, profiles, admin, mentions): "@Name" with the role's icon and colour.
import { h } from './util.js';
import { getLang } from './i18n.js';

// Community roles may carry an English name; Spanish speakers see the main name, everyone else nameEn when set.
export const roleName = (r) => (r ? (getLang() === 'es' || !r.nameEn ? r.name : r.nameEn) : '');
// Every name the role answers to in a mention (both languages).
export const roleAliases = (r) => [...new Set([r.name, r.nameEn].filter(Boolean))];

export function roleChip(r, { at = true, small = false, title } = {}) {
  return h('span.role-chip' + (small ? '.sm' : ''), { style: r.color ? `--rc:${r.color}` : null, title: title || null },
    h('i'), r.icon ? h('span.rc-ic', r.icon) : null, (at ? '@' : '') + roleName(r));
}

// Site staff roles (account roles), shown as groups and chips like Discord roles.
export const SITE_ROLES = {
  owner: { id: 'site:owner', name: 'Fundador', nameEn: 'Founder', icon: '👑', color: '#f5b301' },
  admin: { id: 'site:admin', name: 'Admin', nameEn: 'Admin', icon: '🛡️', color: '#ef4444' },
  mod: { id: 'site:mod', name: 'Moderador', nameEn: 'Moderator', icon: '🔨', color: '#22c55e' },
};

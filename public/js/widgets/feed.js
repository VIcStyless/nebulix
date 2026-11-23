// Nebulix Live items: one shared renderer for the Home card and the #/live page.
import { h, fmt } from '../util.js';
import { getLang } from '../i18n.js';
import { avatarEl } from '../cosmetics.js';

export const FEED_COLORS = { boss: '#ef4444', tournament: '#f59e0b', world: '#14b8a6', clan: '#a855f7', league: '#6366f1', level: '#eab308', record: '#ec4899' };
export function feedItem(e, { fresh = false } = {}) {
  const text = Array.isArray(e.text) ? (getLang() === 'es' ? e.text[1] : e.text[0]) : String(e.text || '');
  return h('a.fd-item' + (fresh ? '.fresh' : ''), { href: e.link || '#/live', style: { '--fc': FEED_COLORS[e.kind] || 'var(--accent)' } },
    h('span.fd-ic', e.icon), e.user ? avatarEl(e.user, { size: 26, frame: false }) : null, h('span.fd-t', text), h('span.fd-time', fmt.rel(e.at)));
}

// Ctrl+K command palette: jump anywhere, run actions, or type a URL / search to browse.
import { h, clear, $ } from './util.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import { openModal } from './ui.js';
import { S, isStaff } from './state.js';
import { api } from './api.js';

export function openPalette(go, actions = []) {
  const nav = [
    ['home', 'Home', 'home'], ['browse', 'Browser', 'globe'], ['chat', 'Community', 'users'], ['dm', 'Messages', 'mail'], ['squads', 'Squads', 'target'], ['events', 'Events', 'calendar'],
    ['library', 'Game library', 'layers'], ['notes', 'Notes', 'note'], ['translate', 'Translator', 'translate'], ['casino', 'Casino', 'dice'], ['market', 'Market', 'bag'],
    ['themes', 'Themes', 'palette'], ['nova', 'Nova AI', 'spark'], ['nerd', 'Nerd Lab', 'flask'], ['music', 'Pulse', 'music'], ['dj', 'DJ mode', 'sliders'], ['arcade', 'Arcade', 'gamepad'], ['progress', 'Achievements', 'trophy'],
    ['ext', 'Extensions', 'puzzle'], ['pro', 'PRO', 'crown'], ['settings', 'Settings', 'gear'], ['profile', 'My profile', 'user'],
  ].map(([r, l, i]) => ({ label: t(l), hint: t('Go to'), icon: i, run: () => go(r) }));
  if (isStaff()) nav.push({ label: t('Admin panel'), hint: t('Go to'), icon: 'shield', run: () => go('admin') });
  const all = nav.concat(actions);
  const input = h('input.input', { placeholder: t('Type a command, a website or a search…'), autocomplete: 'off', spellcheck: 'false' });
  const list = h('div.pal-list'); let sel = 0, shown = [], m; let people = []; let pq = ''; let ptimer = 0;
  // people search (debounced): "vic" finds @VicStyles and opens the profile
  const findPeople = (q) => { clearTimeout(ptimer); if (q.length < 2 || /[.:/]/.test(q)) { people = []; return; } ptimer = setTimeout(async () => { try { const r = await api.get('/api/users/search?q=' + encodeURIComponent(q), { quiet: true }); if (input.value.trim().toLowerCase() !== q) return; people = r.users.slice(0, 5).map((u) => ({ label: (u.displayName || u.username) + '  @' + u.username, hint: t('Profile'), icon: 'user', run: () => go('profile', u.username) })); pq = q; render(); } catch {} }, 180); };
  const looksUrl = (q) => /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(q) || /^localhost(:\d+)?/i.test(q);
  const render = () => {
    const q = input.value.trim().toLowerCase(); clear(list);
    shown = [];
    if (input.value.trim()) {
      const raw = input.value.trim();
      shown.push({ label: looksUrl(raw) ? t('Open {u} in the browser', { u: raw }) : t('Search the web for "{q}"', { q: raw }), hint: t('Browser'), icon: 'globe', run: () => go('browse', { go: raw }) });
    }
    shown.push(...all.filter((a) => !q || a.label.toLowerCase().includes(q)).slice(0, 12));
    if (q && pq === q) shown.push(...people);
    if (sel >= shown.length) sel = 0;
    shown.forEach((a, i) => list.appendChild(h('div.pal-item' + (i === sel ? '.on' : ''), { onClick: () => run(a), onMouseenter: () => { sel = i; paint(); } }, icon(a.icon || 'spark', 18), h('span', a.label), h('span.pk', a.hint || ''))));
    if (!shown.length) list.appendChild(h('div.empty', t('Nothing found')));
  };
  const paint = () => [...list.children].forEach((c, i) => c.classList.toggle('on', i === sel));
  const run = (a) => { m.close(); setTimeout(() => a.run(), 20); };
  input.addEventListener('input', () => { sel = 0; render(); findPeople(input.value.trim().toLowerCase()); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = (sel + 1) % Math.max(1, shown.length); paint(); e.preventDefault(); } else if (e.key === 'ArrowUp') { sel = (sel - 1 + shown.length) % Math.max(1, shown.length); paint(); e.preventDefault(); } else if (e.key === 'Enter' && shown[sel]) run(shown[sel]);
  });
  const box = h('div.pal', input, list); render();
  m = openModal(box, { cls: 'pal-wrap' }); m.el.style.cssText = 'background:none;border:0;box-shadow:none;padding:0;width:min(620px,100%);align-self:start;overflow:visible';
  m.el.parentElement.style.alignItems = 'start';
}

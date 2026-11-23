// Guided tours: a spotlight that walks through the interface, one element at a time.
// Steps can switch pages first (route) and wait for their element to appear. Arrow keys / Esc work.
import { navHash } from './app.js';
import { h, ls } from './util.js';
import { t } from './i18n.js';
import { icon } from './icons.js';

export const TOURS = {
  welcome: { name: 'Welcome tour', steps: [
    { title: 'Welcome to Nebulix', text: 'A quick tour of the essentials. It takes about a minute — you can skip it any time.' },
    { sel: '.rail', title: 'Your sidebar', text: 'Every part of Nebulix lives here, grouped into Social, Play and Create. Press [ to collapse it.', route: 'home', place: 'right' },
    { sel: '.side-search', title: 'Search and commands', text: 'Ctrl K opens a command bar: jump to any page, find people, open a website or run an action.', place: 'right' },
    { sel: '.launch', title: 'Go anywhere', text: 'Type a website or a search here. Everything opens through the private, isolated proxy.', place: 'bottom' },
    { sel: '.apps', title: 'All the apps', text: 'Community, encrypted messages, squads, events, music, games, notes, the translator and more.', place: 'top' },
    { sel: '#panic', title: 'Panic button', text: 'In a hurry? One tap jumps the whole tab to a safe page. Set it up (and a disguise) in Settings → Safety.', place: 'bottom' },
    { sel: '#bell', title: 'Notifications', text: 'Mentions, messages, friend requests, invites and reminders collect here.', place: 'bottom' },
    { sel: '.top-coin', title: 'Coins', text: 'Claim the daily reward and spend coins on profile cosmetics in the Market. Play money only.', place: 'bottom' },
    { sel: '.side-acct', title: 'Your account', text: 'Profile, status, light or dark mode, Do not disturb and settings.', place: 'right' },
    { title: 'You are ready', text: 'Press ? any time for keyboard shortcuts. More tours are in the account menu and in Ctrl K.' },
  ] },
  chat: { name: 'Community tour', steps: [
    { sel: '.cm-servers', title: 'Servers', text: 'Your servers. Create your own or join one with an invite code.', route: 'chat', place: 'right' },
    { sel: '.cm-chlist', title: 'Channels', text: 'Text channels. People talking in a channel\'s voice room show up under it.', place: 'right' },
    { sel: '.cm-vcbtn', title: 'Voice rooms', text: 'Every channel has a voice room for up to 8 people. Ctrl+Shift+M mutes you from any page.', place: 'bottom' },
    { sel: '.cm-composer', title: 'Write', text: 'Send messages, images, polls and voice notes. Type / for commands like /roll or /poll.', place: 'top' },
  ] },
  browse: { name: 'Browser tour', steps: [
    { sel: '.omni', title: 'Address bar', text: 'Type an address or a search. Pages load through the proxy, so the site never sees your real connection.', route: 'browse', place: 'bottom' },
    { sel: '.btool', title: 'Toolbar', text: 'Back, forward, the ad & tracker shield, bookmarks, and a menu to send the page to a friend.', place: 'bottom' },
  ] },
  dm: { name: 'Messages tour', steps: [
    { sel: '.dm-side', title: 'Chats and friends', text: 'Add friends by username. Requests and blocked people are in the tabs.', route: 'dm', place: 'right' },
    { sel: '.dm-main', title: 'End-to-end encrypted', text: 'Messages, images and voice notes are encrypted on your device. Open a chat to share your screen, too.', place: 'left' },
  ] },
  squads: { name: 'Squads tour', steps: [
    { sel: '.page-title .btn.primary', title: 'Start a squad', text: 'Say what you are playing and how many players you need. Slots fill up live.', route: 'squads', place: 'left' },
    { sel: '.filters', title: 'Filters', text: 'Show squads with space, yours, or the ones using voice chat.', place: 'bottom' },
  ] },
};

let active = null;
export const tourSeen = (id) => !!ls('tour.' + id);
export function startTour(id, go) {
  const tour = TOURS[id]; if (!tour) return;
  if (active) active.end();
  let i = 0; let target = null;
  const shade = h('div.tour-shade'); const spot = h('div.tour-spot'); const card = h('div.tour-card', { role: 'dialog', 'aria-live': 'polite' });
  const layer = h('div.tour', shade, spot, card); document.body.appendChild(layer);
  const onResize = () => place();
  const end = (done) => { document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onResize); layer.remove(); active = null; if (done) ls('tour.' + id, Date.now()); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); end(true); } else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next(); } else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); } };
  document.addEventListener('keydown', onKey, true); window.addEventListener('resize', onResize);
  shade.addEventListener('click', () => end(true));
  active = { end };

  async function waitFor(sel, ms = 2500) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const el = [...document.querySelectorAll(sel)].find((x) => x.offsetParent !== null || x.getClientRects().length); if (el) return el; await new Promise((r) => setTimeout(r, 80)); } return null; }
  function place() {
    const s = tour.steps[i]; const pad = 6;
    if (!target) { spot.style.cssText = 'opacity:0'; card.classList.add('center'); card.style.cssText = ''; return; }
    const r = target.getBoundingClientRect();
    spot.style.cssText = `opacity:1;left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px`;
    card.classList.remove('center');
    const cw = Math.min(330, innerWidth - 24); const ch = card.offsetHeight || 170; let x, y; const where = s.place || 'bottom';
    if (where === 'right') { x = r.right + 16; y = r.top; } else if (where === 'left') { x = r.left - cw - 16; y = r.top; } else if (where === 'top') { x = r.left; y = r.top - ch - 16; } else { x = r.left; y = r.bottom + 16; }
    if (x + cw > innerWidth - 12) x = innerWidth - cw - 12; if (x < 12) x = 12; if (y + ch > innerHeight - 12) y = Math.max(12, innerHeight - ch - 12); if (y < 12) y = 12;
    card.style.cssText = `left:${x}px;top:${y}px;width:${cw}px`;
  }
  async function show() {
    const s = tour.steps[i];
    if (s.route && go && !navHash().startsWith('#/' + s.route)) { go(s.route); await new Promise((r) => setTimeout(r, 350)); }
    target = s.sel ? await waitFor(s.sel) : null;
    if (target) target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const last = i === tour.steps.length - 1;
    card.replaceChildren(
      h('div.tour-k', h('span', icon('spark', 13), t(tour.name)), h('span', `${i + 1} / ${tour.steps.length}`)),
      h('b.tour-title', t(s.title)), h('p.tour-text', t(s.text)),
      h('div.tour-dots', tour.steps.map((_, k) => h('i' + (k === i ? '.on' : k < i ? '.done' : '')))),
      h('div.row', { style: 'gap:6px;margin-top:4px' },
        h('button.btn.ghost.sm', { onClick: () => end(true) }, last ? t('Close') : t('Skip')),
        h('div.grow'),
        i > 0 ? h('button.btn.sm', { onClick: prev }, icon('back', 14)) : null,
        h('button.btn.sm.primary', { onClick: next }, last ? t('Done') : t('Next'), last ? null : icon('fwd', 14))));
    requestAnimationFrame(place);
  }
  const next = () => { if (i >= tour.steps.length - 1) return end(true); i++; show(); };
  const prev = () => { if (i <= 0) return; i--; show(); };
  show();
}

// Offer the welcome tour once, shortly after What's New, for a new or returning player.
export function maybeWelcomeTour(go) { if (!tourSeen('welcome')) setTimeout(() => { if (!document.querySelector('.modal')) startTour('welcome', go); }, 1200); }

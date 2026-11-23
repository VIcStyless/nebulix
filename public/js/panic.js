// Panic button, quick-exit key and tab cloaking. All settings are per device (localStorage): this is about the
// computer you are on, not your account. "Panic" replaces the whole tab with a chosen safe URL using
// location.replace, so pressing Back does not return to Nebulix.
import { h, ls } from './util.js';
import { t } from './i18n.js';
import { icon } from './icons.js';

const KEY = 'nbx.panic';
export const PRESETS = [
  ['classroom', 'Google Classroom', 'https://classroom.google.com/'],
  ['docs', 'Google Docs', 'https://docs.google.com/'],
  ['drive', 'Google Drive', 'https://drive.google.com/'],
  ['slides', 'Google Slides', 'https://slides.google.com/'],
  ['gmail', 'Gmail', 'https://mail.google.com/'],
  ['wikipedia', 'Wikipedia', 'https://en.wikipedia.org/'],
  ['blank', 'Blank page', 'about:blank'],
];
// Tab disguises: the page title and favicon shown in the browser tab.
export const CLOAKS = [
  ['off', 'Off (Nebulix)', ''],
  ['classroom', 'Google Classroom', 'https://ssl.gstatic.com/classroom/favicon.png'],
  ['docs', 'Google Docs', 'https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico'],
  ['drive', 'Google Drive', 'https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png'],
  ['classroom2', 'Classes', 'https://ssl.gstatic.com/classroom/favicon.png'],
  ['canvas', 'Dashboard', 'https://canvas.instructure.com/favicon.ico'],
];
const CLOAK_TITLE = { classroom: 'Classes', docs: 'Untitled document - Google Docs', drive: 'My Drive - Google Drive', classroom2: 'Home', canvas: 'Dashboard' };

const defaults = { url: PRESETS[0][2], key: '`', cloak: 'off', newKey: true };
export const settings = () => Object.assign({}, defaults, ls(KEY) || {});
export const save = (s) => { ls(KEY, Object.assign(settings(), s)); applyCloak(); };

export function panic() {
  const url = settings().url || PRESETS[0][2];
  try { localStorage.setItem('nbx.panicked', '1'); } catch {}
  try { location.replace(url); } catch { location.href = url; }
  // if replace is blocked, hard-stop the page so nothing of Nebulix remains on screen
  setTimeout(() => { try { document.documentElement.innerHTML = ''; location.href = url; } catch {} }, 150);
}

let origTitle = null; let link = null;
export function applyCloak() {
  const c = settings().cloak;
  if (origTitle === null) origTitle = document.title;
  const def = CLOAKS.find((x) => x[0] === c);
  document.documentElement.dataset.cloaked = !def || c === 'off' ? '0' : '1';
  if (!def || c === 'off') {
    document.title = origTitle === null ? 'Nebulix' : origTitle;
    if (link) { link.href = '/assets/logo.svg?v=3'; }
    import('./icons.js').then((m) => m.paintFavicon()).catch(() => {});
    return;
  }
  document.title = CLOAK_TITLE[c] || def[1];
  if (!link) link = document.querySelector('link[rel="icon"]') || (() => { const l = document.createElement('link'); l.rel = 'icon'; document.head.appendChild(l); return l; })();
  if (def[2]) link.href = def[2];
}

// A key pressed while Nebulix (not a text field) has focus. The proxied browser forwards the same key
// via the 'panic-key' bus event (see browser.js), so it works while a website has focus too.
export function matchesKey(e) {
  const k = settings().key; if (!k) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const tag = (e.target && e.target.tagName) || ''; if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable)) return false;
  return e.key === k;
}

export function panicButton() {
  const b = h('button.btn.ghost.icon.panic-btn', { id: 'panic', title: t('Panic — jump to a safe page ({k})', { k: settings().key || '—' }), 'aria-label': t('Panic button'), onClick: panic }, icon('alert', 18));
  return b;
}

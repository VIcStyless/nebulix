// Nebulix 13.4 — Retro: play console games in the browser with EmulatorJS (open source). #/retro
// Your game files stay in this browser (IndexedDB). The emulator itself runs on the separate games domain, so the
// emulator code never touches your Nebulix account. Gamepads, save states, fast-forward and touch controls are built in.
import { h, mount, fmt } from '../util.js';
import { t, getLang } from '../i18n.js';
import { S } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, emptyState, confirmBox, modal } from '../ui.js';
const pickSystem = (name, cands) => modal({ title: t('Which console is “{n}” for?', { n: name }), cls: 'narrow', body: h('p.small.muted', t('This file type is used by several consoles.')), actions: [{ label: t('Cancel'), value: null }].concat(cands.map((c) => ({ label: c[1], value: c[0] }))) }).then((v) => v || null);

const SYSTEMS = [
  ['nes', 'NES / Famicom', ['nes', 'fds', 'unf', 'unif']], ['snes', 'Super Nintendo', ['smc', 'sfc', 'fig', 'swc']], ['gb', 'Game Boy / Color', ['gb', 'gbc', 'dmg']], ['gba', 'Game Boy Advance', ['gba']],
  ['nds', 'Nintendo DS', ['nds']], ['n64', 'Nintendo 64', ['n64', 'z64', 'v64']], ['vb', 'Virtual Boy', ['vb', 'vboy']],
  ['psx', 'PlayStation', ['cue', 'chd', 'pbp', 'iso', 'bin']], ['segaSaturn', 'Sega Saturn', ['cue', 'chd', 'iso']], ['segaCD', 'Sega CD / Mega CD', ['cue', 'chd', 'iso']], ['3do', '3DO', ['iso', 'chd', 'cue']],
  ['segaMD', 'Mega Drive / Genesis', ['md', 'gen', 'smd', 'bin']], ['sega32x', 'Sega 32X', ['32x']], ['segaMS', 'Master System', ['sms']], ['segaGG', 'Game Gear', ['gg']],
  ['atari2600', 'Atari 2600', ['a26']], ['atari5200', 'Atari 5200', ['a52']], ['atari7800', 'Atari 7800', ['a78']], ['lynx', 'Atari Lynx', ['lnx']], ['jaguar', 'Atari Jaguar', ['j64', 'jag']],
  ['pce', 'PC Engine / TurboGrafx', ['pce']], ['ngp', 'Neo Geo Pocket / Color', ['ngp', 'ngc']], ['ws', 'WonderSwan', ['ws', 'wsc']], ['coleco', 'ColecoVision', ['col']],
  ['c64', 'Commodore 64', ['d64', 't64', 'prg', 'crt']], ['amiga', 'Amiga', ['adf', 'hdf', 'ipf']], ['arcade', 'Arcade (MAME/FBNeo)', ['zip']],
];
// all systems that use this file type (disc images can belong to several consoles: the player picks)
const coresFor = (name) => { const ext = String(name).split('.').pop().toLowerCase(); return SYSTEMS.filter((x) => x[2].includes(ext)); };
function db() { return new Promise((res, rej) => { const r = indexedDB.open('nbx-retro', 1); r.onupgradeneeded = () => r.result.createObjectStore('g'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function op(mode, fn) { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction('g', mode); const r = fn(tx.objectStore('g')); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); }); }
const listGames = async () => { const d = await db(); return new Promise((res) => { const out = []; const c = d.transaction('g').objectStore('g').openCursor(); c.onsuccess = () => { const cur = c.result; if (!cur) return res(out); out.push(Object.assign({ key: cur.key }, cur.value, { file: undefined })); cur.continue(); }; c.onerror = () => res(out); }); };

export default {
  title: () => t('Retro consoles'), full: true,
  async mount(root, ctx) {
    const box = h('div.rt'); mount(root, box); let onMsg = null;
    const gamesOrigin = S.cfg && S.cfg.gamesOrigin;
    async function library() {
      if (onMsg) { removeEventListener('message', onMsg); onMsg = null; }
      const games = await listGames().catch(() => []); const fileIn = h('input', { type: 'file', multiple: true, hidden: true, onChange: () => add([...fileIn.files]) });
      mount(box, h('div.rt-wrap', h('div.rt-head', h('div', h('h1', icon('gamepad', 26), ' ', t('Retro consoles')), h('p.muted', t('Play your own game files from classic consoles. Gamepad, keyboard and touch controls, save states and fast-forward are built in.'))), h('button.btn.primary', { onClick: () => fileIn.click() }, icon('upload', 15), t('Add games')), fileIn),
        !gamesOrigin ? h('div.sl-alert.warn', t('The games domain is not configured on this server, so the emulator cannot start.')) : null,
        games.length ? h('div.rt-grid', games.sort((a, b) => (b.played || 0) - (a.played || 0) || b.added - a.added).map((g) => h('div.rt-card', { onClick: () => play(g.key) }, h('div.rt-cart', h('span', (SYSTEMS.find((s) => s[0] === g.core) || ['', '?'])[1])), h('b', g.name), h('div.tiny.muted', fmt.bytes(g.size) + (g.played ? ' · ' + t('played {d}', { d: fmt.date(g.played) }) : '')),
          h('button.btn.sm.ghost.rt-del', { title: t('Delete'), onClick: async (e) => { e.stopPropagation(); if (!(await confirmBox(t('Remove “{n}” from this browser?', { n: g.name }), { danger: true }))) return; await op('readwrite', (s) => s.delete(g.key)); library(); } }, icon('trash', 13)))))
          : emptyState('gamepad', t('No games yet'), t('Add game files (.nes, .sfc, .gba, .n64, .md, PlayStation or Saturn .cue/.chd, Amiga .adf…). Use games you own or free homebrew games.'), h('button.btn.primary', { onClick: () => fileIn.click() }, t('Add games'))),
        h('div.rt-sys', h('h4', t('Supported systems')), h('div.rt-chips', SYSTEMS.map((s) => h('span.pill', s[1] + ' · .' + s[2].join(' .'))))),
        h('p.tiny.muted', t('Emulation by EmulatorJS (open source, GPLv3). Nebulix does not provide games: only play files you are allowed to use. Free, legal homebrew games are on sites like itch.io.'))));
      async function add(files) { let n = 0; for (const f of files) { const cands = coresFor(f.name); if (!cands.length) { toast(t('Unknown game type: {n}', { n: f.name }), 'err'); continue; } const core = cands.length === 1 ? cands[0][0] : await pickSystem(f.name, cands); if (!core) continue; if (f.size > 1024 ** 3) { toast(t('Too big: {n}', { n: f.name }), 'err'); continue; } await op('readwrite', (s) => s.put({ name: f.name.replace(/\.[^.]+$/, ''), core, size: f.size, added: Date.now(), file: f }, 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6))); n++; } if (n) toast(t('{n} games added', { n }), 'good'); library(); }
    }
    async function play(key) {
      const g = await op('readonly', (s) => s.get(key)); if (!g) return;
      g.played = Date.now(); await op('readwrite', (s) => s.put(g, key));
      const ifr = h('iframe.rt-frame', { src: gamesOrigin + '/emu/', allow: 'gamepad; fullscreen; autoplay', allowfullscreen: '' });
      mount(box, h('div.rt-run', h('div.vm-bar', h('button.btn.sm.ghost', { onClick: library }, icon('back', 14), t('Library')), h('b', g.name), h('span.tiny.muted', (SYSTEMS.find((s) => s[0] === g.core) || ['', ''])[1]), h('span.grow'), h('button.btn.sm', { onClick: () => { try { ifr.requestFullscreen(); } catch {} } }, icon('fullscreen', 14))), ifr));
      onMsg = (e) => { if (e.source !== ifr.contentWindow || !e.data || e.data.nxEmuReady !== 1) return; ifr.contentWindow.postMessage({ nxEmu: 1, core: g.core, name: g.name, file: g.file, lang: getLang() }, gamesOrigin); };
      addEventListener('message', onMsg);
    }
    library().catch(toastErr);
    void ctx;
    return () => { if (onMsg) removeEventListener('message', onMsg); };
  },
};

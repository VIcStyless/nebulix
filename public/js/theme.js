// Theme engine: schema (mirrors the server sanitizer), presets, apply, share codes.
import { ls, b64url, unb64url, clamp } from './util.js';
import { setBackground, setMotion } from './starfield.js';

export const FONTS = {
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif', rounded: 'ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", "Segoe UI", system-ui, sans-serif',
  mono: 'ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace', serif: 'ui-serif, Georgia, "Times New Roman", serif', pixel: '"Courier New", Courier, monospace',
};
export const COLOR_KEYS = ['bg', 'surface', 'surface2', 'text', 'muted', 'accent', 'accent2', 'success', 'warn', 'danger', 'border'];
export const BG_TYPES = ['stars', 'nebula', 'aurora', 'grid', 'particles', 'waves', 'matrix', 'bokeh', 'bubbles', 'blobs', 'mesh', 'lava', 'gradient', 'solid', 'image', 'space3d', 'tunnel3d', 'crystals3d', 'city3d'];
// Surface treatment for panels, buttons and menus. "glass"/"aero"/"mica" are translucent and need a bg behind.
export const SURFACES = ['flat', 'glass', 'aero', 'mica', 'neo'];
export const DEFAULT = {
  v: 1, name: 'Graphite', mode: 'dark',
  colors: { bg: '#0b0c0e', surface: '#131418', surface2: '#1a1c21', text: '#ececef', muted: '#8a8f98', accent: '#d4ff3f', accent2: '#5eead4', success: '#4ade80', warn: '#fbbf24', danger: '#f87171', border: '#24262c' },
  bg: { type: 'solid', c1: '#0b0c0e', c2: '#0b0c0e', c3: '#0b0c0e', angle: 160, dim: 0, image: '', stars: { density: .6, speed: .5, twinkle: .7, color: '#ffffff' } },
  ui: { radius: 10, blur: 0, glow: 0, shadow: .35, density: 1, font: 'system', fontScale: 1, anim: 1, border: 1, surface: 'flat' }, chat: { bubble: 'flat' }, customCss: '',
};
// The 2.0 default, kept as a preset; saved copies of it are upgraded to Graphite on load (see loadSaved).
const OLD_DEFAULT = { bg: '#0a0719', accent: '#8b5cf6', name: 'Nebula Dark' };
const LIGHT = { bg: '#f6f6f4', surface: '#ffffff', surface2: '#efefec', text: '#16171a', muted: '#6b6f76', accent: '#1f6feb', accent2: '#0f9d8a', success: '#15803d', warn: '#b45309', danger: '#dc2626', border: '#e2e2de' };
const mk = (name, mode, colors, bg, ui, extra) => ({ name, mode, colors, bg, ui: ui || {}, ...(extra || {}) });
const FLAT = { radius: 10, blur: 0, glow: 0, shadow: .35 };
export const PRESETS = [
  mk('Graphite', 'dark', {}, {}, {}),
  mk('Paper', 'light', LIGHT, { type: 'solid', c1: '#f6f6f4', c2: '#f6f6f4', c3: '#f6f6f4' }, Object.assign({}, FLAT, { shadow: .5 }), { chat: { bubble: 'flat' } }),
  mk('Carbon Orange', 'dark', { bg: '#0d0d0d', surface: '#151515', surface2: '#1d1d1d', text: '#f2f0ed', muted: '#8f8a84', accent: '#ff6a2b', accent2: '#ffb86b', border: '#282725' }, { type: 'solid', c1: '#0d0d0d', c2: '#0d0d0d', c3: '#0d0d0d' }, FLAT, { chat: { bubble: 'flat' } }),
  mk('Arctic', 'dark', { bg: '#0a0e14', surface: '#10161f', surface2: '#161e2a', text: '#e6edf5', muted: '#7d8a9c', accent: '#7cc4ff', accent2: '#a5f3fc', border: '#1f2a38' }, { type: 'solid', c1: '#0a0e14', c2: '#0a0e14', c3: '#0a0e14' }, FLAT, { chat: { bubble: 'flat' } }),
  mk('Rose Ink', 'dark', { bg: '#0f0b0d', surface: '#181215', surface2: '#21181c', text: '#f3e9ec', muted: '#9a8a90', accent: '#ff5d8f', accent2: '#ffc2d4', border: '#2c2226' }, { type: 'solid', c1: '#0f0b0d', c2: '#0f0b0d', c3: '#0f0b0d' }, FLAT, { chat: { bubble: 'flat' } }),
  mk('Nebula Dark', 'dark', { bg: '#0a0719', surface: '#141032', surface2: '#1c1745', text: '#ece9ff', muted: '#9b94d1', accent: '#8b5cf6', accent2: '#38bdf8', success: '#34d399', warn: '#fbbf24', danger: '#fb7185', border: '#2d2766' }, { type: 'stars', c1: '#1b1050', c2: '#0a0719', c3: '#3b0f6b' }, { radius: 14, blur: 14, glow: .5, shadow: .5 }),
  mk('Aurora', 'dark', { bg: '#04130f', surface: '#082a22', surface2: '#0c3a2f', text: '#e6fff6', muted: '#86c9b1', accent: '#10b981', accent2: '#6366f1', border: '#14584a' }, { type: 'aurora', c1: '#052e24', c2: '#03110d', c3: '#7c3aed', stars: { density: .4, speed: .3, twinkle: .6, color: '#d1fae5' } }, { glow: .7 }),
  mk('Synthwave', 'dark', { bg: '#12041f', surface: '#240a3d', surface2: '#34104f', text: '#ffe9fb', muted: '#d19adf', accent: '#f0abfc', accent2: '#22d3ee', border: '#6b2a8f' }, { type: 'grid', c1: '#2a0a4a', c2: '#12041f', c3: '#fb923c' }, { glow: .9, radius: 8 }),
  mk('Matrix', 'dark', { bg: '#010a03', surface: '#04170a', surface2: '#072410', text: '#c8ffd6', muted: '#4ade80', accent: '#22c55e', accent2: '#a3e635', border: '#0f5a24' }, { type: 'matrix', c1: '#021a09', c2: '#010a03', c3: '#052e12', dim: .35, stars: { density: .9, speed: 1.2, twinkle: .3, color: '#4ade80' } }, { font: 'mono', radius: 4, glow: .8 }),
  mk('Sunset Drive', 'dark', { bg: '#1a0b1f', surface: '#2c1233', surface2: '#3b1840', text: '#fff0e6', muted: '#e6a9a0', accent: '#fb923c', accent2: '#ec4899', border: '#6b2a52' }, { type: 'gradient', c1: '#fb923c', c2: '#be185d', c3: '#312e81', angle: 170, dim: .45 }, { radius: 20 }),
  mk('Deep Ocean', 'dark', { bg: '#02121f', surface: '#062b43', surface2: '#08395a', text: '#e0f7ff', muted: '#7cc4e0', accent: '#0ea5e9', accent2: '#2dd4bf', border: '#0f5a80' }, { type: 'nebula', c1: '#0c4a6e', c2: '#02121f', c3: '#0e7490' }, { blur: 18 }),
  mk('Crimson Void', 'dark', { bg: '#0d0305', surface: '#240a10', surface2: '#34101a', text: '#ffe9ec', muted: '#d19aa4', accent: '#ef4444', accent2: '#f59e0b', border: '#6b1f2a' }, { type: 'stars', c1: '#3a0a12', c2: '#0d0305', c3: '#7f1d1d', stars: { density: .5, speed: .6, twinkle: .8, color: '#fecaca' } }, { glow: .8 }),
  mk('Cyber Lime', 'dark', { bg: '#07090b', surface: '#10151a', surface2: '#18202a', text: '#f0ffe0', muted: '#9bb08a', accent: '#a3e635', accent2: '#22d3ee', border: '#2c3a2a' }, { type: 'grid', c1: '#14210a', c2: '#07090b', c3: '#a3e635' }, { radius: 2, glow: .6, font: 'mono' }),
  mk('Midnight Gold', 'dark', { bg: '#060914', surface: '#0e1430', surface2: '#161d44', text: '#fff8e1', muted: '#b9b08a', accent: '#fbbf24', accent2: '#f472b6', border: '#2d3466' }, { type: 'nebula', c1: '#1e1b4b', c2: '#060914', c3: '#854d0e' }, {}),
  mk('Monochrome', 'dark', { bg: '#0b0b0c', surface: '#161618', surface2: '#202024', text: '#f4f4f5', muted: '#9a9aa2', accent: '#e4e4e7', accent2: '#a1a1aa', border: '#33333a' }, { type: 'solid', c1: '#0b0b0c', c2: '#0b0b0c', c3: '#0b0b0c' }, { glow: 0, shadow: .3 }),
  mk('Daylight', 'light', LIGHT, { type: 'gradient', c1: '#efeaff', c2: '#e0f2fe', c3: '#fdf2f8', angle: 135, stars: { density: 0, speed: 0, twinkle: 0, color: '#7c3aed' } }, { glow: .2, shadow: .6 }),
  mk('Sakura', 'light', Object.assign({}, LIGHT, { bg: '#fff1f5', surface: '#ffffff', surface2: '#ffe4ec', text: '#4a1730', muted: '#8f4a66', accent: '#ec4899', accent2: '#a855f7', border: '#f8c7da' }), { type: 'gradient', c1: '#ffe4ec', c2: '#fff1f5', c3: '#f3e8ff', angle: 150 }, { radius: 20, glow: .25 }),

  // ---- Beloved editor colour schemes (flat, minimal). ----
  mk('Dracula', 'dark', { bg: '#282a36', surface: '#343746', surface2: '#3c3f54', text: '#f8f8f2', muted: '#9ea3bd', accent: '#bd93f9', accent2: '#ff79c6', success: '#50fa7b', warn: '#f1fa8c', danger: '#ff5555', border: '#44475a' }, { type: 'solid', c1: '#282a36', c2: '#282a36', c3: '#282a36' }, FLAT, { chat: { bubble: 'flat' } }),
  mk('Nord', 'dark', { bg: '#2e3440', surface: '#3b4252', surface2: '#434c5e', text: '#eceff4', muted: '#a7b0c0', accent: '#88c0d0', accent2: '#81a1c1', success: '#a3be8c', warn: '#ebcb8b', danger: '#e88b94', border: '#4c566a' }, { type: 'solid', c1: '#2e3440', c2: '#2e3440', c3: '#2e3440' }, FLAT, { chat: { bubble: 'flat' } }),
  mk('Tokyo Night', 'dark', { bg: '#1a1b26', surface: '#24283b', surface2: '#2f344d', text: '#c0caf5', muted: '#9099c2', accent: '#7aa2f7', accent2: '#bb9af7', success: '#9ece6a', warn: '#e0af68', danger: '#f7768e', border: '#343a52' }, { type: 'solid', c1: '#1a1b26', c2: '#1a1b26', c3: '#1a1b26' }, FLAT, { chat: { bubble: 'flat' } }),
  mk('Gruvbox', 'dark', { bg: '#282828', surface: '#32302f', surface2: '#3c3836', text: '#ebdbb2', muted: '#a89984', accent: '#fabd2f', accent2: '#fe8019', success: '#b8bb26', warn: '#fabd2f', danger: '#fb4934', border: '#504945' }, { type: 'solid', c1: '#282828', c2: '#282828', c3: '#282828' }, FLAT, { chat: { bubble: 'flat' } }),
  mk('Catppuccin', 'dark', { bg: '#1e1e2e', surface: '#28283e', surface2: '#313244', text: '#cdd6f4', muted: '#a6adc8', accent: '#cba6f7', accent2: '#f5c2e7', success: '#a6e3a1', warn: '#f9e2af', danger: '#f38ba8', border: '#45475a' }, { type: 'solid', c1: '#1e1e2e', c2: '#1e1e2e', c3: '#1e1e2e' }, FLAT, { chat: { bubble: 'flat' } }),
  mk('Solarized Light', 'light', { bg: '#fdf6e3', surface: '#fffbf0', surface2: '#eee8d5', text: '#073642', muted: '#586e75', accent: '#268bd2', accent2: '#2aa198', success: '#859900', warn: '#b58900', danger: '#dc322f', border: '#e3dcc4' }, { type: 'solid', c1: '#fdf6e3', c2: '#fdf6e3', c3: '#fdf6e3' }, Object.assign({}, FLAT, { shadow: .5 }), { chat: { bubble: 'flat' } }),
  mk('One Dark', 'dark', { bg: '#21252b', surface: '#282c34', surface2: '#2f343e', text: '#d7dae0', muted: '#9299a6', accent: '#61afef', accent2: '#c678dd', success: '#98c379', warn: '#e5c07b', danger: '#e06c75', border: '#3b4048' }, { type: 'solid', c1: '#21252b', c2: '#21252b', c3: '#21252b' }, FLAT, { chat: { bubble: 'flat' } }),
  mk('GitHub Dark', 'dark', { bg: '#0d1117', surface: '#161b22', surface2: '#1f2630', text: '#e6edf3', muted: '#8d96a0', accent: '#4493f8', accent2: '#3fb950', success: '#3fb950', warn: '#d29922', danger: '#f85149', border: '#30363d' }, { type: 'solid', c1: '#0d1117', c2: '#0d1117', c3: '#0d1117' }, Object.assign({}, FLAT, { radius: 6 }), { chat: { bubble: 'flat' } }),
  mk('Rose Pine', 'dark', { bg: '#191724', surface: '#1f1d2e', surface2: '#26233a', text: '#e0def4', muted: '#908caa', accent: '#ebbcba', accent2: '#c4a7e7', success: '#9ccfd8', warn: '#f6c177', danger: '#eb6f92', border: '#393552' }, { type: 'solid', c1: '#191724', c2: '#191724', c3: '#191724' }, Object.assign({}, FLAT, { radius: 12 }), { chat: { bubble: 'flat' } }),
  mk('Ubuntu', 'dark', { bg: '#2c001e', surface: '#3a0a2a', surface2: '#481436', text: '#ffffff', muted: '#c9aebf', accent: '#e95420', accent2: '#f6a04d', success: '#4ec06e', warn: '#f5b83d', danger: '#ff6b6b', border: '#5e2750' }, { type: 'gradient', c1: '#77216f', c2: '#2c001e', c3: '#e95420', angle: 150, dim: .5 }, { radius: 8, blur: 0, glow: .2, shadow: .45, font: 'system' }, { chat: { bubble: 'flat' } }),
  mk('GitHub Light', 'light', { bg: '#f6f8fa', surface: '#ffffff', surface2: '#eef1f4', text: '#1f2328', muted: '#59636e', accent: '#0969da', accent2: '#1a7f37', success: '#1a7f37', warn: '#9a6700', danger: '#d1242f', border: '#d1d9e0' }, { type: 'solid', c1: '#f6f8fa', c2: '#f6f8fa', c3: '#f6f8fa' }, Object.assign({}, FLAT, { radius: 6, shadow: .45 }), { chat: { bubble: 'flat' } }),

  // ---- Surface styles: glass / aero / mica. These are translucent, so the animated background shows through. ----
  mk('Frutiger Aero', 'light', { bg: '#bfe6ff', surface: '#ffffff', surface2: '#e9f7ff', text: '#09344f', muted: '#3d6880', accent: '#0a8f5a', accent2: '#1487b8', border: '#bfe3f7' },
    { type: 'bubbles', c1: '#7ec8f0', c2: '#cfeffb', c3: '#5fd0a0', angle: 160 }, { surface: 'aero', radius: 18, blur: 14, glow: .5, shadow: .4, border: 1 }, { chat: { bubble: 'glass' } }),
  mk('Liquid Glass', 'dark', { bg: '#0a0e1a', surface: '#1a2338', surface2: '#232d47', text: '#eaf0ff', muted: '#9fb0d0', accent: '#a9b7ff', accent2: '#8be9ff', border: '#38456b' },
    { type: 'blobs', c1: '#3b2f78', c2: '#0a0e1a', c3: '#1e5a8a', angle: 150 }, { surface: 'glass', radius: 20, blur: 24, glow: .4, shadow: .5 }, { chat: { bubble: 'glass' } }),
  mk('Liquid Glass Light', 'light', { bg: '#dfe8ff', surface: '#ffffff', surface2: '#eef3ff', text: '#182440', muted: '#4e5c80', accent: '#5b7cfa', accent2: '#22b8cf', border: '#cdd8f5' },
    { type: 'blobs', c1: '#bcd0ff', c2: '#e6ecff', c3: '#c8f0e8', angle: 150 }, { surface: 'glass', radius: 20, blur: 22, glow: .3, shadow: .35 }, { chat: { bubble: 'glass' } }),
  mk('Windows 11', 'dark', { bg: '#1f1f1f', surface: '#2b2b2b', surface2: '#333333', text: '#ffffff', muted: '#a6a6a6', accent: '#60cdff', accent2: '#4cc2ff', border: '#3a3a3a' },
    { type: 'mesh', c1: '#1b2733', c2: '#1f1f1f', c3: '#273445', angle: 135 }, { surface: 'mica', radius: 8, blur: 30, glow: .15, shadow: .45 }),
  mk('Windows 11 Light', 'light', { bg: '#f3f3f3', surface: '#fbfbfb', surface2: '#efefef', text: '#1a1a1a', muted: '#616161', accent: '#0067c0', accent2: '#0078d4', border: '#e2e2e2' },
    { type: 'mesh', c1: '#e8eef6', c2: '#f3f3f3', c3: '#eaf1fb', angle: 135 }, { surface: 'mica', radius: 8, blur: 30, glow: .1, shadow: .3 }),
  mk('Vapor Glass', 'dark', { bg: '#140826', surface: '#241046', surface2: '#311a5c', text: '#ffe9ff', muted: '#c79fe0', accent: '#ff7ad9', accent2: '#5ef1ff', border: '#4a2a7a' },
    { type: 'grid', c1: '#2a0a4a', c2: '#140826', c3: '#ff7ad9' }, { surface: 'glass', radius: 16, blur: 20, glow: .8, shadow: .5 }, { chat: { bubble: 'glass' } }),
  mk('Bubblegum', 'light', { bg: '#ffe3f1', surface: '#ffffff', surface2: '#ffeef7', text: '#5a1140', muted: '#8f4a72', accent: '#d81b7a', accent2: '#7c5cff', border: '#ffc8e2' },
    { type: 'bubbles', c1: '#ffc2e0', c2: '#ffe3f1', c3: '#c8b0ff' }, { surface: 'aero', radius: 20, blur: 14, glow: .45, shadow: .35 }, { chat: { bubble: 'glass' } }),
  mk('Mint Aero', 'light', { bg: '#cdfbe8', surface: '#ffffff', surface2: '#e2fbf2', text: '#0a3b2e', muted: '#3a705f', accent: '#067a4a', accent2: '#0f8a99', border: '#b6ecd8' },
    { type: 'bubbles', c1: '#9fe8cf', c2: '#d8fbef', c3: '#7fd8e0' }, { surface: 'aero', radius: 18, blur: 14, glow: .4, shadow: .35 }, { chat: { bubble: 'glass' } }),
  mk('Obsidian Glass', 'dark', { bg: '#060608', surface: '#141418', surface2: '#1c1c22', text: '#f0f0f3', muted: '#8f8f99', accent: '#e4e4e7', accent2: '#a1a1aa', border: '#2a2a31' },
    { type: 'blobs', c1: '#1a1a22', c2: '#060608', c3: '#2a2a38' }, { surface: 'glass', radius: 16, blur: 26, glow: .1, shadow: .5 }),
  mk('Sunset Glass', 'dark', { bg: '#1a0a10', surface: '#2e121c', surface2: '#3d1826', text: '#ffeede', muted: '#d79fa6', accent: '#ff8a5b', accent2: '#ff5d8f', border: '#5a2838' },
    { type: 'blobs', c1: '#7c2d12', c2: '#1a0a10', c3: '#9d174d', angle: 170 }, { surface: 'glass', radius: 20, blur: 22, glow: .5, shadow: .5 }, { chat: { bubble: 'glass' } }),
  // ---- Gran actualización: more themes ----
  mk('Emerald', 'dark', { bg: '#04130d', surface: '#0a2018', surface2: '#103024', text: '#e7fff4', muted: '#86b8a2', accent: '#34d399', accent2: '#a3e635', border: '#16402f' }, { type: 'aurora', c1: '#022c22', c2: '#04130d', c3: '#065f46', angle: 160 }, { radius: 14, glow: .3 }),
  mk('Lavender Dream', 'light', { bg: '#f5f3ff', surface: '#ffffff', surface2: '#ede9fe', text: '#1e1b4b', muted: '#6d6a8a', accent: '#7c3aed', accent2: '#db2777', border: '#ddd6fe' }, { type: 'bubbles', c1: '#ede9fe', c2: '#f5f3ff', c3: '#fbcfe8', angle: 160 }, { radius: 18, shadow: .3 }),
  mk('Coffee', 'dark', { bg: '#17110c', surface: '#211812', surface2: '#2c2018', text: '#f4e9de', muted: '#ad9a88', accent: '#d4a373', accent2: '#e9c46a', border: '#3a2b20' }, { type: 'solid', c1: '#17110c', c2: '#17110c', c3: '#17110c' }, FLAT),
  mk('Glacier', 'light', { bg: '#eef7fb', surface: '#ffffff', surface2: '#e2f1f8', text: '#0b2533', muted: '#5b7684', accent: '#0284c7', accent2: '#06b6d4', border: '#cfe6f0' }, { type: 'waves', c1: '#dbeef7', c2: '#eef7fb', c3: '#bae6fd', angle: 180 }, { radius: 12 }),
  mk('Blood Moon', 'dark', { bg: '#0d0405', surface: '#1a0809', surface2: '#260c0e', text: '#ffe4e4', muted: '#b88a8a', accent: '#ef4444', accent2: '#f97316', border: '#3b1214' }, { type: 'nebula', c1: '#450a0a', c2: '#0d0405', c3: '#7f1d1d', angle: 200 }, { radius: 10, glow: .45 }),
  mk('Pastel Pop', 'light', { bg: '#fff7fb', surface: '#ffffff', surface2: '#fdeef6', text: '#2b1d2a', muted: '#8a6f86', accent: '#ec4899', accent2: '#8b5cf6', border: '#f7d6e8' }, { type: 'blobs', c1: '#fbcfe8', c2: '#fff7fb', c3: '#c7d2fe', angle: 160 }, { radius: 22, shadow: .25 }),
  // ---- 3D themes (WebGL backgrounds) ----
  mk('Cosmos 3D', 'dark', { bg: '#03030a', surface: '#0d0d1c', surface2: '#151530', text: '#eef0ff', muted: '#8f93b8', accent: '#8b5cf6', accent2: '#22d3ee', border: '#23234a' }, { type: 'space3d', c1: '#0b0b24', c2: '#7c3aed', c3: '#38bdf8', angle: 160 }, { surface: 'glass', radius: 16, blur: 18, glow: .4, shadow: .5 }, { chat: { bubble: 'glass' } }),
  mk('Neon Tunnel 3D', 'dark', { bg: '#05010d', surface: '#110722', surface2: '#1b0d33', text: '#fdf4ff', muted: '#b39ccf', accent: '#f0abfc', accent2: '#22d3ee', border: '#2e1650' }, { type: 'tunnel3d', c1: '#12052a', c2: '#e879f9', c3: '#22d3ee', angle: 160 }, { surface: 'glass', radius: 14, blur: 20, glow: .6, shadow: .5 }, { chat: { bubble: 'glass' } }),
  mk('Crystal Cave 3D', 'dark', { bg: '#020c12', surface: '#071923', surface2: '#0c2533', text: '#e6fbff', muted: '#86aebb', accent: '#2dd4bf', accent2: '#a78bfa', border: '#123544' }, { type: 'crystals3d', c1: '#042f3a', c2: '#2dd4bf', c3: '#a78bfa', angle: 160 }, { surface: 'glass', radius: 16, blur: 18, glow: .35, shadow: .5 }, { chat: { bubble: 'glass' } }),
  mk('Synth City 3D', 'dark', { bg: '#0a0216', surface: '#150628', surface2: '#200a3a', text: '#fff1fb', muted: '#c59ad6', accent: '#ff3cac', accent2: '#ffb000', border: '#36125a' }, { type: 'city3d', c1: '#1a0533', c2: '#ff3cac', c3: '#ffb000', angle: 160 }, { surface: 'glass', radius: 12, blur: 16, glow: .5, shadow: .5 }, { chat: { bubble: 'glass' } }),
];
const num = (v, a, b, d) => { v = Number(v); return Number.isFinite(v) ? clamp(v, a, b) : d; };
const col = (v, d) => (typeof v === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v) ? v : d);
export function normalize(t) {
  t = t || {}; const d = DEFAULT; const c = t.colors || {}; const b = t.bg || {}; const u = t.ui || {}; const s = b.stars || {};
  const out = {
    v: 1, name: String(t.name || 'Untitled theme').slice(0, 40), mode: t.mode === 'light' ? 'light' : 'dark', colors: {},
    bg: { type: BG_TYPES.includes(b.type) ? b.type : 'solid', c1: col(b.c1, d.bg.c1), c2: col(b.c2, d.bg.c2), c3: col(b.c3, d.bg.c3), angle: Math.round(num(b.angle, 0, 360, 160)), dim: num(b.dim, 0, .9, 0), image: typeof b.image === 'string' ? b.image : '', stars: { density: num(s.density, 0, 1, .6), speed: num(s.speed, 0, 3, .5), twinkle: num(s.twinkle, 0, 1, .7), color: col(s.color, '#ffffff') } },
    ui: { radius: Math.round(num(u.radius, 0, 28, 10)), blur: Math.round(num(u.blur, 0, 40, 0)), glow: num(u.glow, 0, 1, 0), shadow: num(u.shadow, 0, 1, .35), density: num(u.density, .85, 1.15, 1), font: FONTS[u.font] ? u.font : 'system', fontScale: num(u.fontScale, .9, 1.2, 1), anim: num(u.anim, 0, 2, 1), border: Math.round(num(u.border, 0, 3, 1)), surface: SURFACES.includes(u.surface) ? u.surface : 'flat' },
    chat: { bubble: ['flat', 'rounded', 'glass'].includes((t.chat || {}).bubble) ? t.chat.bubble : 'rounded' }, customCss: typeof t.customCss === 'string' ? t.customCss.slice(0, 4000) : '',
  };
  const base = out.mode === 'light' ? LIGHT : d.colors; // a light theme that leaves a colour out must not inherit the dark defaults
  for (const k of COLOR_KEYS) out.colors[k] = col(c[k], base[k]);
  if (out.bg.type === 'image' && !out.bg.image) out.bg.type = 'solid';
  return out;
}
export const fromPreset = (p) => normalize({ name: p.name, mode: p.mode, colors: p.colors, bg: p.bg, ui: p.ui, chat: p.chat });
export function cleanCss(s) { return String(s || '').slice(0, 4000).replace(/[<>\u0000]/g, '').replace(/@import[^;]*;?/gi, '').replace(/url\s*\(/gi, '(').replace(/expression\s*\(/gi, '(').replace(/javascript\s*:/gi, '').replace(/behaviou?r\s*:/gi, ''); }

// Readable text colour on top of a filled accent (WCAG relative luminance).
export function onColor(hex) {
  const n = parseInt(String(hex).slice(1, 7), 16); if (!Number.isFinite(n)) return '#ffffff';
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  const L = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return L > 0.19 ? '#0b0c0e' : '#ffffff'; // whichever of near-black / white contrasts more (crossover is L = 0.179)
}
// Filled accents are painted as a gradient from the accent towards accent2 (see --grad), so the text on top
// has to stay readable at both ends: pick the ink whose worst-case contrast is best.
const relLum = (hex) => { const n = parseInt(String(hex).slice(1, 7), 16); const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]; };
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
export function onAccent(accent, accent2) {
  const la = relLum(accent); const lb = Number.isFinite(relLum(accent2)) ? la * 0.45 + relLum(accent2) * 0.55 : la; if (!Number.isFinite(la)) return '#ffffff';
  const dark = relLum('#0b0c0e'); const score = (ink) => Math.min(ratio(ink, la), ratio(ink, lb));
  return score(dark) >= score(1) ? '#0b0c0e' : '#ffffff';
}
const isOldDefault =(t) => t && t.colors && t.colors.bg === OLD_DEFAULT.bg && t.colors.accent === OLD_DEFAULT.accent && t.name === OLD_DEFAULT.name;
// Saved light themes made before 4.2 carry the dark status colours (unreadable on white): swap them for the light set.
function fixLightStatus(t) {
  if (!t || t.mode !== 'light' || !t.colors) return t;
  for (const k of ['success', 'warn', 'danger']) if (t.colors[k] === DEFAULT.colors[k]) t.colors[k] = LIGHT[k];
  return t;
}
export const upgrade = (t) => (isOldDefault(t) ? normalize(DEFAULT) : fixLightStatus(t));

let current = normalize(DEFAULT);
export const getTheme = () => current;
export function varsOf(t) {
  const c = t.colors; const u = t.ui; const v = {};
  for (const k of COLOR_KEYS) v['--' + k] = c[k];
  v['--on-accent'] = onAccent(c.accent, c.accent2);
  Object.assign(v, { '--radius': u.radius + 'px', '--blur': u.blur + 'px', '--glow': String(u.glow), '--shadow': String(u.shadow), '--density': String(u.density), '--fscale': String(u.fontScale), '--anim': String(u.anim), '--bw': u.border + 'px', '--font': FONTS[u.font] });
  return v;
}
export function apply(theme, { persist = true } = {}) {
  const t = normalize(theme); current = t; const root = document.documentElement; const v = varsOf(t);
  for (const [k, x] of Object.entries(v)) root.style.setProperty(k, x);
  root.dataset.mode = t.mode; root.dataset.bubble = t.chat.bubble; root.dataset.surface = t.ui.surface;
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', t.colors.bg);
  let st = document.getElementById('nbx-custom-css');
  if (!st) { st = document.createElement('style'); st.id = 'nbx-custom-css'; document.head.appendChild(st); }
  st.textContent = cleanCss(t.customCss);
  setBackground(t.bg, { accent: t.colors.accent, accent2: t.colors.accent2, anim: t.ui.anim });
  if (persist) { try { localStorage.setItem('nbx.vars', JSON.stringify(v)); localStorage.setItem('nbx.mode', t.mode); ls('theme', t); } catch {} }
  return t;
}
export const loadSaved = () => { const s = ls('theme'); return s ? upgrade(normalize(s)) : normalize(DEFAULT); };
export const toShare = (t) => 'NBX1.' + b64url(JSON.stringify(normalize(Object.assign({}, t, { customCss: '' }))));
export function fromShare(str) {
  str = String(str || '').trim();
  try {
    if (str.startsWith('NBX1.')) return normalize(JSON.parse(unb64url(str.slice(5))));
    const j = JSON.parse(str); return normalize(j.data || j.theme || j);
  } catch { return null; }
}

// Hand a theme to the Studio (used by Nova's theme suggestions and gallery remixes).
let pending = null;
export const setPending = (t) => { pending = normalize(t); };
export const takePending = () => { const p = pending; pending = null; return p; };

// Personal UI preferences (stored in the account, independent of the active theme).
export function applyUi(ui = {}) {
  const root = document.documentElement;
  root.dataset.reduce = ui.reduceMotion ? '1' : (ls('reduce') === '1' ? '1' : '');
  root.dataset.contrast = ui.highContrast ? '1' : '';
  root.dataset.compact = ui.compact ? '1' : '';
  if (ui.fontScale && ui.fontScale !== 1) root.style.setProperty('--uscale', String(ui.fontScale)); else root.style.removeProperty('--uscale');
  root.dataset.nocoins = ui.showCoinsBar === false ? '1' : '';
  const anim = ['off', 'subtle', 'normal', 'extra'].includes(ui.anim) ? ui.anim : 'normal';
  root.dataset.anim = anim; setMotion(anim);
}

// Nebulix 13.3 — Virtual machine manager (in the style of a desktop VM manager) and a real terminal.
// A whole x86 PC is emulated in your browser (v86, WebAssembly). Create machines from templates or your own .iso/.img,
// give them memory and an empty virtual hard disk to install on, take named snapshots, clone, export and delete.
// Machines, disks and snapshots live in this browser (IndexedDB); nothing reaches the server and there is no network
// inside the machines. Large OS images stream in pieces (HTTP ranges), so only the sectors the machine reads download.
// #/vm · #/vm/terminal (Linux straight in the terminal)
import { h, mount, fmt, ls } from '../util.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { toast, toastErr, modal, confirmBox, promptBox } from '../ui.js';

const L = (p) => (document.documentElement.lang === 'es' ? p[1] : p[0]);
const TEMPLATES = [
  { id: 'linux', n: 'Linux (terminal)', os: 'Linux 4.16 · BusyBox', d: ['A real Linux shell in a real terminal.', 'Un shell de Linux real en un terminal de verdad.'], ic: 'terminal', disks: { cdrom: '/vm/linux4.iso' }, mem: 64, serial: true },
  { id: 'dsl', n: 'Damn Small Linux', os: 'Linux 2.4 · desktop', d: ['A complete Linux desktop with windows, a file manager, an editor and old-school apps.', 'Un escritorio Linux completo con ventanas, gestor de archivos, editor y apps de la vieja escuela.'], ic: 'monitor', disks: { cdrom: '/vm/dsl-4.11.rc2.iso' }, mem: 256, async: true },
  { id: 'linux-vga', n: 'Linux (screen)', os: 'Linux 4.16', d: ['The small Linux on the emulated screen and keyboard.', 'El Linux pequeño en la pantalla y el teclado emulados.'], ic: 'monitor', disks: { cdrom: '/vm/linux4.iso' }, mem: 64 },
  { id: 'freedos', n: 'FreeDOS', os: 'DOS', d: ['A free DOS with a virtual hard disk you can install programs on.', 'Un DOS libre con un disco duro virtual donde instalar programas.'], ic: 'cpu', disks: { fda: '/vm/freedos722.img' }, mem: 32, hddMb: 64 },
  { id: 'kolibri', n: 'KolibriOS', os: 'KolibriOS', d: ['A tiny graphical OS in assembly, with desktop, apps and games.', 'Un sistema gráfico diminuto en ensamblador, con escritorio, apps y juegos.'], ic: 'window', disks: { fda: '/vm/kolibri.img' }, mem: 128 },
  { id: 'openbsd', n: 'OpenBSD (installer)', os: 'OpenBSD', d: ['Boots the OpenBSD installer: practise installing a Unix on a virtual disk.', 'Arranca el instalador de OpenBSD: practica a instalar un Unix en un disco virtual.'], ic: 'shield', disks: { fda: '/vm/openbsd-floppy.img' }, mem: 128, hddMb: 256 },
  { id: 'oberon', n: 'Oberon', os: 'Native Oberon', d: ['The classic research OS from ETH Zürich, with its unusual tiled interface.', 'El sistema clásico de investigación de la ETH de Zúrich, con su curiosa interfaz en mosaico.'], ic: 'layers', disks: { hda: '/vm/oberon.img' }, mem: 128, async: true },
  { id: 'android', n: 'Android-x86 4.4', os: 'Android 4.4 KitKat (x86, 32-bit)', d: ['Android for PCs, downloaded from the official project. Experimental and slow in a browser: choose “Live CD” in its menu and wait a few minutes. 1 GB of memory recommended.', 'Android para PC, descargado del proyecto oficial. Experimental y lento en un navegador: elige «Live CD» en su menú y espera unos minutos. Se recomienda 1 GB de memoria.'], ic: 'phone', disks: { cdrom: '/vmd/android-x86-4.4-r5.iso' }, mem: 1024, hddMb: 4096, vga: 32, async: true, boot: 'cd' },
  { id: 'win98', n: 'Windows 98', os: 'Windows 98 SE', d: ['Bring your own Windows 98 ISO. Recommended settings are filled in: 128 MB, 2 GB disk.', 'Trae tu propia ISO de Windows 98. Ya vienen los ajustes recomendados: 128 MB y disco de 2 GB.'], ic: 'window', needsIso: true, mem: 128, hddMb: 2048, vga: 16, boot: 'cd' },
  { id: 'win2k', n: 'Windows 2000', os: 'Windows 2000', d: ['Bring your own Windows 2000 ISO: 256 MB, 4 GB disk.', 'Trae tu propia ISO de Windows 2000: 256 MB y disco de 4 GB.'], ic: 'window', needsIso: true, mem: 256, hddMb: 4096, vga: 16, boot: 'cd' },
  { id: 'winxp', n: 'Windows XP', os: 'Windows XP', d: ['Bring your own Windows XP ISO: 512 MB, 8 GB disk. Installing takes a long time in a browser — be patient.', 'Trae tu propia ISO de Windows XP: 512 MB y disco de 8 GB. Instalarlo tarda bastante en un navegador: ten paciencia.'], ic: 'window', needsIso: true, mem: 512, hddMb: 8192, vga: 32, boot: 'cd', acpi: true },
  { id: 'reactos', n: 'ReactOS', os: 'ReactOS (open-source, Windows-compatible)', d: ['A free operating system that runs Windows programs. Download its ISO from reactos.org and choose it here.', 'Un sistema libre que ejecuta programas de Windows. Descarga su ISO en reactos.org y elígela aquí.'], ic: 'window', needsIso: true, mem: 512, hddMb: 4096, vga: 32, boot: 'cd', link: 'https://reactos.org/download/' },
  { id: 'custom', n: t('Custom (.iso / .img)'), os: '—', d: ['Boot any image from your computer. It is kept in this browser.', 'Arranca cualquier imagen de tu ordenador. Se guarda en este navegador.'], ic: 'upload', custom: true, mem: 128 },
];
TEMPLATES.forEach((x) => { x.disks = x.disks || {}; });
const TPL = (id) => TEMPLATES.find((x) => x.id === id) || TEMPLATES[0];
const MAX_MEM = 2048; const MAX_HDD = 32768;
// a virtual hard disk of any size that takes no memory until something is written: reads of untouched sectors are zeros,
// writes live in the emulator's block cache (and in snapshots)
class SparseDisk extends File { constructor(size, name) { super([], name || 'disk.img'); this._sz = size; } get size() { return this._sz; } slice(a = 0, b = this._sz) { a = Math.max(0, a | 0); b = Math.min(this._sz, b); return new Blob([new Uint8Array(Math.max(0, b - a))]); } }
const BOOT = { auto: null, cd: 0x213, hdd: 0x312, fda: 0x321 };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
let libP = null; const lib = () => (libP = libP || import('/vm/libv86.mjs'));
let xtP = null; const xterm = () => (xtP = xtP || Promise.all([import('../vendor/xterm/xterm.mjs'), import('../vendor/xterm/addon-fit.mjs')]).then(([a, b]) => { if (!document.getElementById('xterm-css')) document.head.append(h('link', { id: 'xterm-css', rel: 'stylesheet', href: '/js/vendor/xterm/xterm.css' })); return { Terminal: a.Terminal, FitAddon: b.FitAddon }; }));
// ---------- storage: machine list in localStorage, big data (images, snapshots) in IndexedDB ----------
function idb() { return new Promise((res, rej) => { const r = indexedDB.open('nbx-vm', 2); r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('s')) r.result.createObjectStore('s'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function dbSet(k, v) { const d = await idb(); return new Promise((res, rej) => { const tx = d.transaction('s', 'readwrite'); tx.objectStore('s').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }
async function dbGet(k) { const d = await idb(); return new Promise((res, rej) => { const r = d.transaction('s').objectStore('s').get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function dbDel(k) { const d = await idb(); return new Promise((res) => { const tx = d.transaction('s', 'readwrite'); tx.objectStore('s').delete(k); tx.oncomplete = res; tx.onerror = res; }); }
const loadVms = () => { const l = ls('vm.list'); if (Array.isArray(l)) return l; const first = ['linux', 'dsl', 'freedos', 'kolibri'].map((id) => newVm(TPL(id))); ls('vm.list', first); return first; };
const saveVms = (l) => ls('vm.list', l);
function newVm(tp, o = {}) { return Object.assign({ id: uid(), name: tp.n, tpl: tp.id, mem: tp.mem, vga: tp.vga || 8, boot: tp.boot || 'auto', acpi: !!tp.acpi, hddMb: tp.hddMb || 0, serial: !!tp.serial, created: Date.now(), snaps: [], notes: '' }, o); }

export default {
  title: () => t('Virtual machines'), full: true,
  async mount(root, ctx) {
    const box = h('div.vm'); mount(root, box); let stop = null; let vms = loadVms(); let sel = (vms[0] || {}).id;
    const byId = (id) => vms.find((v) => v.id === id);
    function manager() {
      if (stop) { stop(); stop = null; }
      const v = byId(sel) || vms[0]; if (v) sel = v.id;
      const list = h('aside.vb-list', h('div.vb-tools', h('button.vb-tool', { onClick: wizard }, icon('plus', 20), h('span', t('New'))), h('button.vb-tool', { disabled: !v, onClick: () => v && settings(v) }, icon('gear', 20), h('span', t('Settings'))), h('button.vb-tool.go', { disabled: !v, onClick: () => v && run(v) }, icon('play', 20), h('span', t('Start')))),
        vms.map((m) => h('button.vb-item' + (m.id === sel ? '.on' : ''), { onClick: () => { sel = m.id; manager(); } }, h('span.vb-os', icon(TPL(m.tpl).ic, 22)), h('div.grow', h('b', m.name), h('div.tiny.muted', m.snaps.length ? t('Saved state') + ' · ' + m.snaps.length + ' ' + t('snapshots') : t('Powered off'))))),
        !vms.length ? h('p.small.muted', { style: 'padding:12px' }, t('No machines yet. Create one with New.')) : null);
      const tp = v ? TPL(v.tpl) : null;
      const detail = v ? h('section.vb-detail',
        h('div.vb-head', h('span.vb-big', icon(tp.ic, 34)), h('div', h('h2', v.name), h('div.small.muted', tp.os + ' · ' + L(tp.d)))),
        h('div.vb-boxes',
          h('div.vb-box', h('h4', icon('cpu', 15), ' ', t('System')), kv(t('Memory'), v.mem + ' MB'), v.acpi ? kv('ACPI', t('On')) : null, kv(t('Processor'), 'x86 (i686), 1 CPU'), kv(t('Boot order'), [tp.disks.cdrom || v.isoName && /iso$/i.test(v.isoName) ? t('Optical') : null, tp.disks.fda ? t('Floppy') : null, t('Hard disk')].filter(Boolean).join(', '))),
          h('div.vb-box', h('h4', icon('monitor', 15), ' ', t('Display')), kv(t('Video memory'), v.vga + ' MB'), kv(t('Console'), v.serial ? t('Serial terminal') : 'VGA')),
          h('div.vb-box', h('h4', icon('save', 15), ' ', t('Storage')), tp.disks.cdrom ? kv(t('Optical drive'), tp.disks.cdrom.split('/').pop()) : null, tp.disks.fda ? kv(t('Floppy'), tp.disks.fda.split('/').pop()) : null, tp.disks.hda ? kv(t('Hard disk'), tp.disks.hda.split('/').pop()) : null, v.hddMb ? kv(t('Virtual hard disk'), v.hddMb + ' MB') : null, v.isoName ? kv(t('Your image'), v.isoName) : null),
          h('div.vb-box', h('h4', icon('globe', 15), ' ', t('Network')), kv(t('Adapter'), t('Not attached (isolated)'))),
          h('div.vb-box', h('h4', icon('layers', 15), ' ', t('Snapshots')), v.snaps.length ? v.snaps.slice().reverse().map((s) => h('div.vb-snap', icon('clock', 13), h('span.grow', s.name + ' · ' + fmt.dt(s.t)), h('button.btn.sm', { onClick: () => run(v, s) }, t('Restore')), h('button.btn.sm.ghost', { onClick: async () => { if (!(await confirmBox(t('Delete snapshot “{n}”?', { n: s.name }), { danger: true }))) return; await dbDel('snap:' + v.id + ':' + s.id); v.snaps = v.snaps.filter((x) => x.id !== s.id); saveVms(vms); manager(); } }, icon('trash', 13)))) : h('p.small.muted', t('Take a snapshot while the machine runs to come back to that exact moment later.')))),
        h('div.row', { style: 'gap:8px;flex-wrap:wrap' }, h('button.btn.primary', { onClick: () => run(v) }, icon('play', 15), t('Start')), h('button.btn', { onClick: () => settings(v) }, icon('gear', 15), t('Settings')), h('button.btn', { onClick: () => clone(v) }, icon('copy', 15), t('Clone')), h('button.btn.ghost', { onClick: () => remove(v) }, icon('trash', 15), t('Delete'))),
        h('p.tiny.muted', t('Runs on the open-source v86 emulator (x86 in WebAssembly). Everything stays on this device; machines have no network. Sources and licenses: '), h('a', { href: '/vm/SOURCES.txt', target: '_blank' }, 'SOURCES.txt')))
        : h('section.vb-detail', h('div.empty', h('h3', t('Create your first virtual machine')), h('button.btn.primary', { onClick: wizard }, icon('plus', 15), t('New'))));
      mount(box, h('div.vb', h('div.vb-top', h('b', icon('cpu', 18), ' ', t('Virtual machines')), h('span.grow'), h('button.btn.sm', { onClick: () => run(newVm(TPL('linux'), { temp: true })) }, icon('terminal', 14), t('Quick terminal'))), h('div.vb-main', list, detail)));
    }
    const kv = (k, v) => h('div.vb-kv', h('span', k), h('b', v));
    async function wizard() {
      let tp = TEMPLATES[0]; const name = h('input.input', { value: tp.n }); const mem = h('input.input', { type: 'number', min: 16, max: MAX_MEM, value: tp.mem }); const hdd = h('input.input', { type: 'number', min: 0, max: MAX_HDD, value: tp.hddMb || 0 }); let file = null; const fileName = h('span.small.muted');
      const fileIn = h('input', { type: 'file', accept: '.iso,.img,.ima,.bin', hidden: true, onChange: () => { file = fileIn.files[0] || null; fileName.textContent = file ? file.name + ' · ' + fmt.bytes(file.size) : ''; if (file && name.value === tp.n) name.value = file.name.replace(/\.[^.]+$/, ''); } });
      const grid = h('div.vb-tpls'); const paintT = () => mount(grid, TEMPLATES.map((x) => h('button.vb-tpl' + (x === tp ? '.on' : ''), { onClick: () => { tp = x; name.value = x.n; mem.value = x.mem; hdd.value = x.hddMb || 0; paintT(); customRow.style.display = x.custom || x.needsIso ? '' : 'none'; hint.textContent = x.needsIso ? L(x.d) : ''; } }, icon(x.ic, 20), h('b', x.n), h('span.tiny.muted', x.os)))); paintT();
      const hint = h('p.tiny.muted'); const customRow = h('div.col', { style: 'display:none;gap:6px' }, h('div.row', { style: 'gap:8px' }, h('button.btn', { onClick: () => fileIn.click() }, icon('upload', 14), t('Choose image')), fileName, fileIn), hint, h('p.tiny.muted', t('Windows is not included: use an ISO you have a licence for. The image stays in this browser and is read in pieces, so even big ISOs work.')));
      const ok = await modal({ title: t('New virtual machine'), body: h('div.col', { style: 'gap:10px' }, h('label.small', t('Operating system')), grid, customRow, h('label.small', t('Name')), name, h('div.row', { style: 'gap:10px' }, h('label.col.grow.small', t('Memory (MB)'), mem), h('label.col.grow.small', t('Empty virtual hard disk (MB, 0 = none)'), hdd))), actions: [{ label: t('Cancel'), value: false }, { label: t('Create'), kind: 'primary', value: true }] });
      if (ok !== true) return; if ((tp.custom || tp.needsIso) && !file) return toast(t('Choose an image first'), 'err'); if (file && file.size > 8 * 1024 ** 3) return toast(t('Max 8 GB'), 'err');
      const vm = newVm(tp, { name: name.value.trim() || tp.n, mem: Math.max(16, Math.min(MAX_MEM, Number(mem.value) || tp.mem)), hddMb: Math.max(0, Math.min(MAX_HDD, Number(hdd.value) || 0)) });
      if (file) { await dbSet('img:' + vm.id, file); vm.isoName = file.name; vm.isoKind = /\.iso$/i.test(file.name) ? 'cdrom' : file.size <= 2949120 ? 'fda' : 'hda'; }
      vms.push(vm); saveVms(vms); sel = vm.id; manager(); toast(t('Machine created'), 'good');
    }
    async function settings(v) {
      const name = h('input.input', { value: v.name }); const mem = h('input.input', { type: 'number', min: 16, max: MAX_MEM, value: v.mem }); const vga = h('input.input', { type: 'number', min: 2, max: 128, value: v.vga }); const hdd = h('input.input', { type: 'number', min: 0, max: MAX_HDD, value: v.hddMb }); const boot = h('select.input', [['auto', t('Automatic')], ['cd', t('CD/DVD first')], ['hdd', t('Hard disk first')], ['fda', t('Floppy first')]].map(([k, l]) => h('option', { value: k, selected: (v.boot || 'auto') === k }, l))); const acpi = h('input', { type: 'checkbox', checked: !!v.acpi }); const notes = h('textarea.input', { rows: 3 }); notes.value = v.notes || '';
      const ok = await modal({ title: t('Settings · {n}', { n: v.name }), body: h('div.col', { style: 'gap:8px' }, h('label.small', t('Name')), name, h('label.small', t('Memory (MB)')), mem, h('label.small', t('Video memory (MB)')), vga, h('label.small', t('Empty virtual hard disk (MB, 0 = none)')), hdd, h('p.tiny.muted', t('Changing the disk size starts with a new empty disk; snapshots keep the old one.')), h('label.small', t('Boot order')), boot, h('label.row.small', { style: 'gap:6px' }, acpi, t('ACPI (needed by Windows XP and newer)')), h('p.tiny.muted', t('After installing an OS from the CD, switch to “Hard disk first”. Up to {m} MB of memory: big values need a powerful computer.', { m: MAX_MEM })), h('label.small', t('Notes')), notes), actions: [{ label: t('Cancel'), value: false }, { label: t('Save'), kind: 'primary', value: true }] });
      if (ok !== true) return; Object.assign(v, { name: name.value.trim() || v.name, mem: Math.max(16, Math.min(MAX_MEM, Number(mem.value) || v.mem)), vga: Math.max(2, Math.min(128, Number(vga.value) || 8)), hddMb: Math.max(0, Math.min(MAX_HDD, Number(hdd.value) || 0)), boot: boot.value, acpi: acpi.checked, notes: notes.value.slice(0, 2000) }); saveVms(vms); manager();
    }
    async function clone(v) { const n = await promptBox(t('Clone “{n}”', { n: v.name }), { value: v.name + ' (2)' }); if (!n) return; const c = Object.assign(JSON.parse(JSON.stringify(v)), { id: uid(), name: n, created: Date.now(), snaps: [] }); if (v.isoName) { const img = await dbGet('img:' + v.id); if (img) await dbSet('img:' + c.id, img); } const last = v.snaps[v.snaps.length - 1]; if (last) { const st = await dbGet('snap:' + v.id + ':' + last.id); if (st) { const sid = uid(); await dbSet('snap:' + c.id + ':' + sid, st); c.snaps = [{ id: sid, name: last.name, t: last.t }]; } } vms.push(c); saveVms(vms); sel = c.id; manager(); toast(t('Machine cloned'), 'good'); }
    async function remove(v) { if (!(await confirmBox(t('Delete “{n}” with its disk and snapshots? This cannot be undone.', { n: v.name }), { danger: true, ok: t('Delete') }))) return; for (const s of v.snaps) await dbDel('snap:' + v.id + ':' + s.id); await dbDel('img:' + v.id); vms = vms.filter((x) => x.id !== v.id); saveVms(vms); sel = (vms[0] || {}).id; manager(); }

    // ---------- running a machine ----------
    async function run(v, snap) {
      if (stop) { stop(); stop = null; }
      const tp = TPL(v.tpl); const serial = v.serial;
      const screenEl = h('div.vm-screen', h('div', { style: 'white-space:pre;font:14px monospace;line-height:14px' }), h('canvas', { style: 'display:none' }));
      const termEl = h('div.vm-term'); const status = h('span.tiny.muted', t('Starting…')); const ips = h('span.tiny.muted'); let paused = false;
      const pauseBtn = h('button.btn.sm', { onClick: () => { if (!emu) return; if (paused) { emu.run(); paused = false; mount(pauseBtn, icon('pause', 14)); status.textContent = t('Running'); } else { emu.stop(); paused = true; mount(pauseBtn, icon('play', 14)); status.textContent = t('Paused'); } }, title: t('Pause') }, icon('pause', 14));
      mount(box, h('div.vm-run', h('div.vm-bar', h('button.btn.sm.ghost', { onClick: () => powerOff() }, icon('back', 14), t('Machines')), h('b', v.name), status, h('span.grow'), ips, pauseBtn,
        serial ? null : h('button.btn.sm', { title: 'Ctrl+Alt+Del', onClick: () => emu && emu.keyboard_send_scancodes([0x1d, 0x38, 0x53, 0xd3, 0xb8, 0x9d]) }, 'Ctrl+Alt+Del'),
        serial ? null : h('button.btn.sm', { title: t('Capture the mouse (Esc releases it)'), onClick: () => { try { emu.lock_mouse(); } catch {} } }, icon('mouse', 14)),
        serial ? null : h('button.btn.sm', { title: t('Change CD'), onClick: () => changeCd() }, icon('save', 14), t('CD')),
        v.temp ? null : h('button.btn.sm', { onClick: () => snapshot() }, icon('layers', 14), t('Snapshot')),
        h('button.btn.sm', { onClick: () => emu && emu.restart() }, icon('refresh', 14), t('Reset')), serial ? null : h('button.btn.sm', { onClick: () => { try { emu.screen_go_fullscreen(); } catch {} } }, icon('fullscreen', 14)),
        h('button.btn.sm.ghost', { title: t('Power off'), onClick: () => powerOff() }, icon('power', 14))),
        serial ? termEl : screenEl, h('div.tiny.muted.vm-foot', serial ? t('Real Linux shell. Try: ls /, uname -a, cat /proc/cpuinfo, vi hello.txt, top. Paste with Ctrl+Shift+V.') : t('Click the screen to type. Your keyboard and mouse go to the virtual machine.'))));
      let emu = null; let term = null; let fit = null; let tm = 0; let lastIc = 0;
      try {
        const [{ V86 }, xt] = await Promise.all([lib(), serial ? xterm() : Promise.resolve(null)]);
        const disks = {}; for (const [k, url] of Object.entries(tp.disks || {})) disks[k] = { url, async: !!tp.async };
        if (v.isoName) { const img = await dbGet('img:' + v.id); if (!img) throw new Error(t('The image of this machine is missing')); const f = img instanceof File ? img : new File([img], v.isoName); disks[v.isoKind] = f.size > 64 * 1048576 ? { buffer: f, async: true } : { buffer: await f.arrayBuffer() }; }
        if (v.hddMb && !disks.hda) disks.hda = { buffer: new SparseDisk(v.hddMb * 1048576, 'hdd.img'), async: true };
        emu = new V86(Object.assign({ wasm_path: '/vm/v86.wasm', memory_size: v.mem * 1048576, vga_memory_size: v.vga * 1048576, bios: { url: '/vm/seabios.bin' }, vga_bios: { url: '/vm/vgabios.bin' }, autostart: !snap, disable_speaker: true, acpi: !!v.acpi }, BOOT[v.boot || 'auto'] ? { boot_order: BOOT[v.boot] } : {}, serial ? { disable_keyboard: true, disable_mouse: true } : { screen_container: screenEl }, disks));
        if (serial) {
          term = new xt.Terminal({ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 14, cursorBlink: true, theme: { background: '#0b0d14', foreground: '#d6deeb', cursor: '#7fdbca', selectionBackground: '#33467c' }, scrollback: 5000 });
          fit = new xt.FitAddon(); term.loadAddon(fit); term.open(termEl); fit.fit(); term.focus();
          term.writeln('\x1b[1;36mNebulix VM\x1b[0m — ' + t('booting Linux… (10–30 s the first time)') + '\r\n');
          emu.add_listener('serial0-output-byte', (b) => term.write(new Uint8Array([b]))); term.onData((d) => emu.serial0_send(d));
          new ResizeObserver(() => { try { fit.fit(); } catch {} }).observe(termEl);
        }
        emu.add_listener('emulator-ready', async () => { status.textContent = t('Running'); if (snap) { try { const st = await dbGet('snap:' + v.id + ':' + snap.id); if (st) { await emu.restore_state(st); toast(t('Snapshot restored: {n}', { n: snap.name }), 'good'); } emu.run(); } catch (e) { toastErr(e); } } });
        emu.add_listener('download-progress', (e) => { if (e.total && !tp.async) status.textContent = t('Downloading {p}%', { p: Math.round((e.loaded / e.total) * 100) }); });
        tm = setInterval(() => { if (!box.isConnected) return cleanup(); try { const ic = emu.get_instruction_counter(); const d = ic - lastIc; lastIc = ic; ips.textContent = d > 1e6 ? fmt.num(d / 1e6) + ' MIPS' : ''; } catch {} }, 1000);
      } catch (e) { status.textContent = t('Could not start'); toastErr(e); }
      function changeCd() { const fi = h('input', { type: 'file', accept: '.iso', onChange: async () => { const f = fi.files[0]; if (!f || !emu) return; try { await emu.set_cdrom({ buffer: f, async: f.size > 64 * 1048576 }); toast(t('CD inserted: {n}', { n: f.name }), 'good'); } catch (e) { toastErr(e); } } }); modal({ title: t('CD/DVD drive'), cls: 'narrow', body: h('p.small', t('Insert another ISO (for example drivers or programs) or eject the current one.')), actions: [{ label: t('Eject'), value: 'e', onClick: () => { try { emu.eject_cdrom(); toast(t('CD ejected'), 'good'); } catch {} } }, { label: t('Insert ISO…'), kind: 'primary', onClick: () => fi.click() }] }); }
      async function snapshot() { if (!emu) return; const n = await promptBox(t('Snapshot name'), { value: t('Snapshot {n}', { n: v.snaps.length + 1 }) }); if (!n) return; try { const st = await emu.save_state(); const sid = uid(); await dbSet('snap:' + v.id + ':' + sid, st); v.snaps.push({ id: sid, name: n.slice(0, 60), t: Date.now(), size: st.byteLength }); saveVms(vms); toast(t('Snapshot taken ({s})', { s: fmt.bytes(st.byteLength) }), 'good'); } catch (e) { toastErr(e); } }
      async function powerOff() {
        if (emu && !v.temp) { const choice = await modal({ title: t('Close virtual machine'), body: h('p', t('Do you want to save the machine state, so it continues exactly where it is next time?')), actions: [{ label: t('Cancel'), value: 'cancel' }, { label: t('Power off'), value: 'off' }, { label: t('Save the machine state'), kind: 'primary', value: 'save' }] });
          if (choice === 'cancel' || choice === undefined || choice === false) return;
          if (choice === 'save') { try { const st = await emu.save_state(); const sid = uid(); await dbSet('snap:' + v.id + ':' + sid, st); v.snaps.push({ id: sid, name: t('Saved state'), t: Date.now(), size: st.byteLength }); saveVms(vms); } catch (e) { toastErr(e); } } }
        cleanup(); manager();
      }
      function cleanup() { clearInterval(tm); try { emu && emu.destroy(); } catch {} try { term && term.dispose(); } catch {} emu = null; }
      stop = cleanup;
    }
    if (ctx.params[0] === 'terminal') run(newVm(TPL('linux'), { temp: true, name: 'Terminal' })); else manager();
    return () => { if (stop) stop(); };
  },
};

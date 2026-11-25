// Nebulix Android (3.0) — real Android devices (official Android Emulator, AOSP images, no Google Play) running on
// separate compute nodes. The screen arrives as H.264 over a WebSocket straight from the node and is decoded here
// with WebCodecs; touches, keys, text and the clipboard go back the same way. #/android, #/android/<id>
import { h, mount } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { S } from '../state.js';
import { toast, toastErr, modal, confirmBox, loading, emptyState, field, segEl, tabsEl, promptBox } from '../ui.js';

const STATE = { running: ['Running', 'good'], starting: ['Starting…', 'warn'], stopping: ['Stopping…', 'warn'], stopped: ['Stopped', ''], unreachable: ['Node offline', 'bad'] };
const PROFILE = { phone: 'Phone', tablet: 'Tablet', small: 'Compact phone' };
const stateChip = (s) => { const x = STATE[s] || [s, '']; return h('span.an-state.' + (x[1] || 'idle'), t(x[0])); };
const isStaff = () => S.me && (S.me.role === 'owner' || S.me.role === 'admin');

export default {
  full: true,
  title: () => 'Nebulix Android',
  async mount(root, ctx) {
    const id = ctx.params[0];
    return id ? devicePage(root, ctx, id) : homePage(root, ctx);
  },
};

// ---------------- device list ----------------
async function homePage(root, ctx) {
  const wrap = h('div.an'); mount(root, wrap, loading());
  let st, list;
  const load = async () => {
    try { [st, list] = await Promise.all([api.get('/api/android/status'), api.get('/api/android/devices')]); } catch (e) { mount(wrap, emptyState('alert', t('Could not load Nebulix Android'), e.message)); return; }
    render();
  };
  function render() {
    const online = st.nodes.filter((n) => n.online); const imgs = new Map(); for (const n of online) for (const i of n.images) imgs.set(i.api, i);
    const head = h('header.an-hero',
      h('div.an-hero-txt', h('div.eyebrow', t('Real Android in your browser')), h('h1', 'Nebulix Android'),
        h('p', t('Real Android devices running on Nebulix compute servers with hardware virtualisation. Install APKs, use apps, test your projects. Open-source Android (AOSP): there is no Google Play.')),
        h('div.an-status', !st.configured ? h('span.an-state.bad', t('No compute node connected')) : !online.length ? h('span.an-state.bad', t('Compute nodes offline')) : !imgs.size ? h('span.an-state.bad', t('No connected server can run Android')) : h('span.an-state.good', t('{n} compute node(s) online', { n: online.filter((n) => n.images.length).length })),
          h('span.tiny.muted', t('{a} of {b} devices', { a: st.used, b: st.quota })))),
      h('div.an-hero-actions', h('button.btn.primary', { disabled: !online.length || st.used >= st.quota, onClick: () => createDialog([...imgs.values()].sort((a, b) => b.api - a.api)) }, icon('plus', 16), t('New device')),
        h('a.btn', { href: '#/vm/android' }, icon('monitor', 16), t('Android in this browser (offline)'))));
    let body;
    if (!st.configured) body = emptyState('phone', t('Nebulix Android is not connected yet'), t('Real devices run on separate servers with KVM, not on the Nebulix web server. Until a compute node is connected you can use the in-browser Android (Android-x86 4.4, emulated in WebAssembly).'), isStaff() ? h('a.btn.primary', { href: '#/admin/compute' }, icon('gear', 15), t('Connect a compute node')) : null);
    else if (online.length && !imgs.size && !list.devices.length) body = emptyState('phone', t('No connected server can run Android'), t('Android needs a server with hardware virtualisation (KVM). The current Nebulix compute servers do not have it — they run Cloud PC machines instead. Until a KVM server is added you can use the in-browser Android.'), h('a.btn', { href: '#/cloudpc' }, icon('monitor', 15), 'Cloud PC'));
    else if (!list.devices.length) body = emptyState('phone', t('No devices yet'), t('Create a phone or tablet with the Android version you need. It keeps its apps and data between sessions.'));
    else body = h('div.an-grid', list.devices.map((d) => h('article.an-card', { tabIndex: 0, onKeydown: (e) => { if (e.key === 'Enter') ctx.go('android/' + d.id); } },
      h('div.an-card-art.' + d.profile, h('div.an-mini', icon('phone', 26))),
      h('div.an-card-body', h('div.row', h('b.grow', d.name), stateChip(d.state)),
        h('div.tiny.muted', [d.android ? 'Android ' + d.android : 'API ' + d.api, t(PROFILE[d.profile] || d.profile), d.cpu + ' CPU', (d.ram / 1024).toFixed(1) + ' GB RAM', d.storage + ' GB'].join(' · ')),
        h('div.row.an-card-actions',
          h('button.btn.sm.primary', { onClick: () => ctx.go('android/' + d.id) }, icon('play', 14), t('Open')),
          d.state === 'running' ? h('button.btn.sm', { onClick: () => act(d, 'stop') }, icon('stop', 14), t('Stop')) : d.state === 'stopped' ? h('button.btn.sm', { onClick: () => act(d, 'start') }, icon('power', 14), t('Start')) : null,
          h('button.btn.sm.ghost', { title: t('Delete'), 'aria-label': t('Delete'), onClick: () => del(d) }, icon('trash', 14)))))));
    mount(wrap, head, body);
  }
  async function act(d, op) { try { await api.post('/api/android/devices/' + d.id + '/' + op, {}); await load(); } catch (e) { toastErr(e); } }
  async function del(d) { if (!await confirmBox(t('Delete “{n}” and everything inside it? This cannot be undone.', { n: d.name }), { danger: true, ok: t('Delete') })) return; try { await api.delete('/api/android/devices/' + d.id); toast(t('Device deleted'), 'good'); load(); } catch (e) { toastErr(e); } }
  function createDialog(imgs) {
    const name = h('input', { value: '', placeholder: t('My phone'), maxLength: 40 });
    const ver = h('select', imgs.map((i) => h('option', { value: i.api }, 'Android ' + i.android + ' (API ' + i.api + ')')));
    let profile = 'phone'; const prof = segEl([['phone', t('Phone')], ['tablet', t('Tablet')], ['small', t('Compact phone')]], profile, (v) => { profile = v; });
    const pro = S.me && (S.me.pro || S.me.role === 'owner');
    const cpu = h('select', [1, 2, 3, 4].filter((n) => pro || n <= 2).map((n) => h('option', { value: n, selected: n === 2 }, n + ' CPU')));
    const ram = h('select', [1536, 2048, 3072, 4096, 6144].filter((n) => pro || n <= 3072).map((n) => h('option', { value: n, selected: n === 2048 }, (n / 1024).toFixed(1) + ' GB')));
    const sto = h('select', [2, 4, 6, 8, 16].filter((n) => pro || n <= 6).map((n) => h('option', { value: n, selected: n === 4 }, n + ' GB')));
    modal({ title: t('New Android device'), body: h('div.col', { style: 'gap:12px' }, field(t('Name'), name), field(t('Android version'), ver), field(t('Type'), prof), h('div.an-hw', field(t('Processor'), cpu), field(t('Memory'), ram), field(t('Storage'), sto)), h('p.tiny.muted', t('Open-source Android (AOSP) — Google Play and Google apps are not included. Install apps from APK files.'))),
      actions: [{ label: t('Cancel'), value: false }, { label: t('Create'), kind: 'primary', onClick: async () => {
        try { const r = await api.post('/api/android/devices', { name: name.value, api: Number(ver.value), profile, cpu: Number(cpu.value), ram: Number(ram.value), storage: Number(sto.value) }); toast(t('Device created'), 'good'); ctx.go('android/' + r.device.id); } catch (e) { toastErr(e); return false; }
      } }] });
  }
  await load();
  const iv = setInterval(() => { if (list && list.devices.some((d) => d.state === 'starting' || d.state === 'stopping')) load(); }, 4000);
  return () => clearInterval(iv);
}

// ---------------- one device ----------------
async function devicePage(root, ctx, id) {
  const wrap = h('div.an.an-dev'); mount(root, wrap, loading());
  let dev; let tk = null; let tkAt = 0; let player = null; let alive = true;
  const base = '/api/android/devices/' + id;
  const ticket = async () => { if (!tk || Date.now() - tkAt > 5 * 60000) { tk = await api.post(base + '/ticket', {}); tkAt = Date.now(); } return tk; };
  async function refresh() { const r = await api.get('/api/android/devices'); dev = r.devices.find((d) => d.id === id); if (!dev) throw new Error(t('Device not found')); }
  try { await refresh(); } catch (e) { mount(wrap, emptyState('alert', t('Device not found'), e.message, h('a.btn', { href: '#/android' }, t('Back')))); return () => {}; }
  ctx.setTitle && ctx.setTitle(dev.name);

  const chip = h('span'); const title = h('h2', dev.name);
  const powerBtn = h('button.btn.sm.an-power'); const restartBtn = h('button.btn.sm', { onClick: () => op('restart') }, icon('refresh', 14), t('Restart'));
  const screen = h('div.an-screen'); const side = h('div.an-side');
  const nav = h('div.an-nav',
    navBtn('back', t('Back'), () => player && player.key(4)), navBtn('home', t('Home'), () => player && player.key(3)), navBtn('grid', t('Recent apps'), () => player && player.key(187)),
    h('i.an-sep'), navBtn(null, t('Volume down'), () => player && player.key(25), '−'), navBtn(null, t('Volume up'), () => player && player.key(24), '+'), navBtn('power', t('Power button'), () => player && player.key(26)),
    h('i.an-sep'), navBtn('refresh', t('Rotate'), () => op('rotate')), navBtn('camera', t('Screenshot'), shot), navBtn('layers', t('Notifications'), () => player && player.send({ t: 'panel', which: 'notifications' })));
  function navBtn(ic, label, fn, txt) { return h('button.an-nb', { type: 'button', title: label, 'aria-label': label, onClick: fn }, ic ? icon(ic, 17) : h('b', txt)); }
  function header() {
    mount(chip, stateChip(dev.state));
    const running = dev.state === 'running'; const busy = dev.state === 'starting' || dev.state === 'stopping';
    mount(powerBtn, icon(running ? 'stop' : 'power', 14), running ? t('Stop') : t('Start')); powerBtn.disabled = busy || dev.state === 'unreachable'; powerBtn.onclick = () => op(running ? 'stop' : 'start');
    restartBtn.disabled = !running;
  }
  async function op(name, body = {}, quiet) {
    try { const r = await api.post(base + '/' + name, body); if (r.device) { Object.assign(dev, r.device); header(); } if (!quiet) toast(t('Done'), 'good'); if (name === 'start' || name === 'restart') { startPolling(); if (player) player.reattach(); } return r; } catch (e) { toastErr(e); return null; }
  }
  let pollT = 0; function startPolling() { clearInterval(pollT); pollT = setInterval(async () => { try { await refresh(); header(); if (dev.state === 'running' || dev.state === 'stopped') clearInterval(pollT); } catch {} }, 3000); }
  async function shot() { try { const k = await ticket(); const r = await fetch(k.base + '/v1/screenshot?t=' + encodeURIComponent(k.t)); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status); dl(await r.blob(), 'android-' + Date.now() + '.png'); } catch (e) { toastErr(e); } }
  const dl = (blob, name) => { const a = h('a', { href: URL.createObjectURL(blob), download: name }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };

  // ----- side panels -----
  const panes = {
    apps: appsPane, files: filesPane, device: devicePane, snapshots: snapsPane, shell: shellPane, logs: logsPane,
  };
  const paneBox = h('div.an-pane'); let cur = 'apps';
  const tabs = tabsEl([['apps', t('Apps'), 'grid'], ['files', t('Files'), 'folder'], ['device', t('Device'), 'gear'], ['snapshots', t('Snapshots'), 'layers'], ['shell', 'Shell', 'terminal'], ['logs', t('Logs'), 'note']], cur, (v) => { cur = v; showPane(); });
  function showPane() { mount(paneBox, panes[cur]()); }
  const needRun = (fn) => (dev.state === 'running' ? fn() : h('p.muted.small', t('Start the device to use this.')));

  function appsPane() {
    const box = h('div.col', { style: 'gap:10px' }); const listEl = h('div.an-list', loading());
    const drop = h('label.an-drop', { tabIndex: 0 }, icon('upload', 22), h('b', t('Install an APK')), h('span.tiny.muted', t('Drop an .apk file here or click to choose one (up to 500 MB)')), h('input', { type: 'file', accept: '.apk,application/vnd.android.package-archive', hidden: true, onChange: (e) => e.target.files[0] && install(e.target.files[0]) }));
    for (const ev of ['dragover', 'dragenter']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('on'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('on')); drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('on'); const f = e.dataTransfer.files[0]; if (f) install(f); });
    async function install(f) {
      if (!/\.apk$/i.test(f.name)) return toast(t('Choose an .apk file'), 'err');
      const prog = h('div.an-prog', h('i')); drop.after(prog); const label = h('div.tiny.muted', t('Uploading {n}…', { n: f.name })); prog.after(label);
      try {
        const k = await ticket(); await xhrPut(k.base + '/v1/upload?kind=apk&t=' + encodeURIComponent(k.t), f, (p) => { prog.firstChild.style.width = Math.round(p * 100) + '%'; if (p >= 1) label.textContent = t('Installing…'); });
        toast(t('{n} installed', { n: f.name }), 'good'); loadApps();
      } catch (e) { toast(t('Could not install: {e}', { e: e.message }), 'err'); } finally { prog.remove(); label.remove(); }
    }
    async function loadApps() {
      try { const r = await api.get(base + '/apps'); mount(listEl, r.apps.length ? r.apps.map((p) => h('div.an-row', h('code.grow', p), h('button.btn.sm', { onClick: () => op('app-launch', { pkg: p }, true) }, icon('play', 13), t('Open')), h('button.btn.sm.ghost', { title: t('Force stop'), onClick: () => op('app-stop', { pkg: p }, true) }, icon('stop', 13)), h('button.btn.sm.ghost', { title: t('Uninstall'), onClick: async () => { if (await confirmBox(t('Uninstall {p}?', { p }), { danger: true })) { await op('app-uninstall', { pkg: p }); loadApps(); } } }, icon('trash', 13)))) : h('p.muted.small', t('No apps installed yet. Install an APK above.'))); } catch (e) { mount(listEl, h('p.muted.small', e.message)); }
    }
    return needRun(() => { loadApps(); mount(box, drop, h('div.eyebrow', t('Installed apps')), listEl); return box; });
  }
  function filesPane() {
    const listEl = h('div.an-list', loading());
    const up = h('label.btn.sm', icon('upload', 14), t('Send a file to the device'), h('input', { type: 'file', hidden: true, onChange: async (e) => { const f = e.target.files[0]; if (!f) return; try { const k = await ticket(); await xhrPut(k.base + '/v1/upload?kind=file&name=' + encodeURIComponent(f.name) + '&t=' + encodeURIComponent(k.t), f); toast(t('Saved in Download'), 'good'); load(); } catch (er) { toastErr(er); } } }));
    async function load() { try { const r = await api.get(base + '/files'); mount(listEl, r.files.length ? r.files.map((f) => h('div.an-row', icon('folder', 14), h('span.grow', f.name), h('span.tiny.muted', fmtSize(f.size)), h('button.btn.sm', { onClick: async () => { try { const k = await ticket(); const res = await fetch(k.base + '/v1/pull?name=' + encodeURIComponent(f.name) + '&t=' + encodeURIComponent(k.t)); if (!res.ok) throw new Error(t('Download failed')); dl(await res.blob(), f.name); } catch (e) { toastErr(e); } } }, icon('download', 13)))) : h('p.muted.small', t('The Download folder is empty.'))); } catch (e) { mount(listEl, h('p.muted.small', e.message)); } }
    return needRun(() => { load(); return h('div.col', { style: 'gap:10px' }, h('p.small.muted', t('Files go to the device’s Download folder, and you can download anything saved there.')), up, listEl); });
  }
  function devicePane() {
    const lat = h('input', { type: 'number', step: 'any', value: '40.4168', 'aria-label': t('Latitude') }); const lon = h('input', { type: 'number', step: 'any', value: '-3.7038', 'aria-label': t('Longitude') });
    const places = [['Madrid', 40.4168, -3.7038], ['Ciudad de México', 19.4326, -99.1332], ['Buenos Aires', -34.6037, -58.3816], ['New York', 40.7128, -74.006], ['Tokyo', 35.6762, 139.6503]];
    const clip = h('textarea', { rows: 3, placeholder: t('Text to paste on the device') });
    const rec = h('div.row', { style: 'gap:6px;flex-wrap:wrap' });
    const recUi = (on) => mount(rec, h('button.btn.sm' + (on ? '.danger' : ''), { onClick: async () => { try { const k = await ticket(); const r = await fetch(k.base + '/v1/record?op=' + (on ? 'stop' : 'start') + '&t=' + encodeURIComponent(k.t), { method: 'POST' }); if (!r.ok) throw new Error((await r.json()).error); recUi(!on); if (on) toast(t('Recording saved — download it below'), 'good'); } catch (e) { toastErr(e); } } }, icon(on ? 'stop' : 'video', 14), on ? t('Stop recording') : t('Record screen')),
      h('button.btn.sm', { onClick: async () => { try { const k = await ticket(); const r = await fetch(k.base + '/v1/record?t=' + encodeURIComponent(k.t)); if (!r.ok) throw new Error(t('No recording yet')); dl(await r.blob(), 'android-' + Date.now() + '.mp4'); } catch (e) { toastErr(e); } } }, icon('download', 14), t('Download last recording')));
    recUi(!!dev.recording);
    const hw = h('div.col', { style: 'gap:8px' },
      h('div.small', [t(PROFILE[dev.profile] || dev.profile), dev.cpu + ' CPU', (dev.ram / 1024).toFixed(1) + ' GB RAM', dev.storage + ' GB', t('on {n}', { n: dev.node })].join(' · ')),
      dev.state === 'stopped' ? h('button.btn.sm', { onClick: hwDialog }, icon('cpu', 14), t('Change hardware')) : h('p.tiny.muted', t('Stop the device to change its processor, memory or storage.')));
    return h('div.col.an-dev-pane', { style: 'gap:14px' },
      h('section', h('div.eyebrow', t('Hardware')), hw),
      needRun(() => h('div.col', { style: 'gap:14px' },
        h('section', h('div.eyebrow', t('Screen')), rec, h('div.row', { style: 'gap:6px;flex-wrap:wrap;margin-top:6px' },
          ...[['720×1280', 720, 1280, 320], ['1080×1920', 1080, 1920, 420], ['1280×800', 1280, 800, 160]].map(([l, w, hh, dpi]) => h('button.btn.sm', { onClick: () => op('resolution', { w, h: hh, dpi }) }, l)),
          h('button.btn.sm.ghost', { onClick: () => op('resolution', { reset: true }) }, t('Default')))),
        h('section', h('div.eyebrow', t('Location (GPS)')), h('div.row', { style: 'gap:6px' }, lat, lon, h('button.btn.sm.primary', { onClick: () => op('gps', { lat: Number(lat.value), lon: Number(lon.value) }) }, t('Set'))),
          h('div.row', { style: 'gap:6px;flex-wrap:wrap;margin-top:6px' }, places.map(([n, a, b]) => h('button.btn.sm.ghost', { onClick: () => { lat.value = a; lon.value = b; op('gps', { lat: a, lon: b }); } }, n)))),
        h('section', h('div.eyebrow', t('Clipboard')), clip, h('div.row', { style: 'gap:6px;margin-top:6px' }, h('button.btn.sm', { onClick: () => { player && player.send({ t: 'setclip', text: clip.value, paste: false }); toast(t('Copied to the device clipboard'), 'good'); } }, icon('copy', 14), t('Copy to device')), h('button.btn.sm', { onClick: () => player && player.send({ t: 'setclip', text: clip.value, paste: true }) }, t('Paste on device'))),
          h('p.tiny.muted', t('What you copy on the device appears here automatically.'))))));
    function hwDialog() {
      const cpu = h('input', { type: 'number', min: 1, max: 4, value: dev.cpu }); const ram = h('input', { type: 'number', min: 1536, max: 6144, step: 512, value: dev.ram }); const sto = h('input', { type: 'number', min: dev.storage, max: 16, value: dev.storage });
      modal({ title: t('Change hardware'), body: h('div.an-hw', field(t('Processor (cores)'), cpu), field(t('Memory (MB)'), ram), field(t('Storage (GB, can only grow)'), sto)), actions: [{ label: t('Cancel'), value: false }, { label: t('Save'), kind: 'primary', onClick: async () => { const r = await op('config', { cpu: Number(cpu.value), ram: Number(ram.value), storage: Number(sto.value) }); if (!r) return false; showPane(); } }] });
    }
    // device → browser clipboard
  }
  function snapsPane() {
    const listEl = h('div.an-list');
    const draw = () => mount(listEl, (dev.snapshots || []).length ? dev.snapshots.slice().reverse().map((s) => h('div.an-row', icon('layers', 14), h('span.grow', s.name), h('span.tiny.muted', new Date(s.at).toLocaleString()),
      h('button.btn.sm', { onClick: async () => { if (await confirmBox(t('Go back to “{n}”? What happened after it will be lost.', { n: s.name }))) { const r = await op('snapshot-load', { name: s.name }); if (r && player) setTimeout(() => player.reattach(), 1500); } } }, t('Restore')),
      h('button.btn.sm.ghost', { title: t('Delete'), onClick: async () => { const r = await op('snapshot-delete', { name: s.name }, true); if (r) { dev.snapshots = r.snapshots; draw(); } } }, icon('trash', 13)))) : h('p.muted.small', t('No snapshots yet.')));
    draw();
    return h('div.col', { style: 'gap:10px' }, h('p.small.muted', t('A snapshot saves the whole device (apps, data and what is on screen) so you can go back to that moment. Stopping the device also saves where you left off.')),
      needRun(() => h('button.btn.sm.primary', { onClick: async () => { const n = await promptBox(t('Snapshot name'), { value: 'snap-' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '') }); if (!n) return; toast(t('Saving snapshot…')); const r = await op('snapshot-save', { name: n }); if (r) { dev.snapshots = r.snapshots; draw(); } } }, icon('plus', 14), t('Save snapshot'))), listEl);
  }
  function shellPane() {
    const out = h('pre.an-term', t('Commands run inside the Android device as the shell user (adb shell). Try: getprop ro.build.version.release · pm list packages · df -h')); const inp = h('input.an-cmd', { placeholder: 'adb shell …', spellcheck: false, autocomplete: 'off' });
    const hist = []; let hi = 0;
    inp.addEventListener('keydown', async (e) => {
      if (e.key === 'ArrowUp') { hi = Math.max(0, hi - 1); inp.value = hist[hi] || ''; return; } if (e.key === 'ArrowDown') { hi = Math.min(hist.length, hi + 1); inp.value = hist[hi] || ''; return; }
      if (e.key !== 'Enter' || !inp.value.trim()) return; const cmd = inp.value; hist.push(cmd); hi = hist.length; inp.value = ''; out.textContent += '\n$ ' + cmd + '\n';
      try { const r = await api.post(base + '/shell', { cmd }); out.textContent += r.output || (r.code ? '(exit ' + r.code + ')' : ''); } catch (er) { out.textContent += er.message; }
      out.scrollTop = out.scrollHeight;
    });
    return needRun(() => h('div.col', { style: 'gap:8px' }, out, inp));
  }
  function logsPane() {
    const out = h('pre.an-term.an-log', loading()); const filter = h('input', { placeholder: t('Filter'), onInput: () => draw() }); let text = '';
    const draw = () => { const q = filter.value.toLowerCase(); out.textContent = q ? text.split('\n').filter((l) => l.toLowerCase().includes(q)).join('\n') : text; out.scrollTop = out.scrollHeight; };
    const load = async () => { try { text = (await api.get(base + '/logcat?lines=600')).log; draw(); } catch (e) { out.textContent = e.message; } };
    return needRun(() => { load(); return h('div.col', { style: 'gap:8px' }, h('div.row', { style: 'gap:6px' }, filter, h('button.btn.sm', { onClick: load }, icon('refresh', 14), t('Refresh')), h('button.btn.sm', { onClick: () => dl(new Blob([text]), 'logcat.txt') }, icon('download', 14))), out); });
  }

  // ----- layout -----
  mount(wrap,
    h('header.an-bar', h('a.btn.sm.ghost', { href: '#/android', 'aria-label': t('Back') }, icon('back', 16)), h('div.grow', title, h('div.row', { style: 'gap:8px' }, chip, h('span.tiny.muted', (dev.android ? 'Android ' + dev.android : 'API ' + dev.api) + ' · ' + t(PROFILE[dev.profile] || dev.profile)))), restartBtn, powerBtn),
    h('div.an-main', h('div.an-stage', screen, nav), h('div.an-panel', tabs, paneBox)));
  header(); showPane();
  player = makePlayer(screen, ticket, (state) => { if (state !== dev.state) { dev.state = state; header(); if (cur !== 'snapshots') showPane(); } }, (txt) => { const ta = wrap.querySelector('.an-dev-pane textarea'); if (ta) ta.value = txt; toast(t('Device clipboard: {t}', { t: txt.slice(0, 60) })); });
  if (dev.state === 'starting' || dev.state === 'stopping') startPolling();
  return () => { alive = false; clearInterval(pollT); player && player.destroy(); };
}

const fmtSize = (n) => (n > 1 << 20 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');
function xhrPut(url, file, onProgress) {
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest(); x.open('PUT', url); x.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
    x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch {} if (x.status >= 200 && x.status < 300) res(j); else rej(new Error(j.message || j.error || 'HTTP ' + x.status)); };
    x.onerror = () => rej(new Error(t('Could not reach the compute node'))); x.send(file);
  });
}

// ---------------- the screen ----------------
// H.264 (Annex B) packets: first byte flags (1 = codec config SPS/PPS, 2 = key frame), then the NAL units.
function makePlayer(host, getTicket, onState, onClip) {
  const canvas = h('canvas.an-canvas', { tabIndex: 0, 'aria-label': t('Android screen — click to use it, type to write') });
  const overlay = h('div.an-overlay', h('span.spinner'), h('p', t('Connecting to the device…')));
  const frame = h('div.an-frame', canvas, overlay); mount(host, frame);
  const g = canvas.getContext('2d'); let sock = null; let dec = null; let cfg = null; let codec = ''; let needKey = true; let size = { w: 0, h: 0 }; let dead = false; let retry = 0; let rT = 0; let lastFrame = 0;
  const supported = typeof VideoDecoder !== 'undefined';
  const say = (txt, spin) => { mount(overlay, spin ? h('span.spinner') : null, h('p', txt)); overlay.hidden = false; };
  function codecOf(sps) { let i = 0; while (i + 4 < sps.length && !(sps[i] === 0 && sps[i + 1] === 0 && sps[i + 2] === 1)) i++; const n = sps.subarray(i + 3); return 'avc1.' + [n[1], n[2], n[3]].map((x) => x.toString(16).padStart(2, '0')).join(''); }
  function setup(nextCodec) {
    try { dec && dec.state !== 'closed' && dec.close(); } catch {}
    dec = new VideoDecoder({ output: (f) => { if (canvas.width !== f.displayWidth || canvas.height !== f.displayHeight) { canvas.width = f.displayWidth; canvas.height = f.displayHeight; host.style.setProperty('--ar', f.displayWidth + '/' + f.displayHeight); } size = { w: f.displayWidth, h: f.displayHeight }; g.drawImage(f, 0, 0); f.close(); overlay.hidden = true; lastFrame = Date.now(); }, error: () => { needKey = true; try { send({ t: 'keyframe' }); } catch {} } });
    dec.configure({ codec: nextCodec, optimizeForLatency: true }); codec = nextCodec; needKey = true;
  }
  async function connect() {
    if (dead) return; if (!supported) { say(t('This browser cannot decode the video stream (WebCodecs). Use a recent Chrome, Edge, Firefox or Safari.')); return; }
    say(t('Connecting to the device…'), true);
    let k; try { k = await getTicket(); } catch (e) { say(e.message); return; }
    sock = new WebSocket(k.ws); sock.binaryType = 'arraybuffer';
    sock.onopen = () => { retry = 0; };
    sock.onmessage = (e) => {
      if (typeof e.data === 'string') { const m = JSON.parse(e.data); if (m.t === 'state') { onState(m.state); if (m.state === 'starting' && Date.now() - lastFrame < 3000) return; if (m.state !== 'running') say(m.state === 'starting' ? t('Android is starting… (this takes up to a minute the first time)') : m.state === 'stopping' ? t('Stopping…') : t('The device is off. Press Start.'), m.state === 'starting'); } else if (m.t === 'meta') { size = { w: m.w, h: m.h }; } else if (m.t === 'clip') onClip(m.text); else if (m.t === 'error') say(t('The video stream could not start. Try restarting the device.')); return; }
      const b = new Uint8Array(e.data); const flags = b[0]; const data = b.subarray(1);
      if (flags & 1) { cfg = data.slice(); const c = codecOf(cfg); if (c !== codec || !dec || dec.state === 'closed') setup(c); needKey = true; return; }
      if (!dec || dec.state !== 'configured') return; const key = !!(flags & 2);
      if (needKey && !key) return;
      let chunkData = data; if (key && cfg) { chunkData = new Uint8Array(cfg.length + data.length); chunkData.set(cfg); chunkData.set(data, cfg.length); }
      needKey = false;
      try { if (dec.decodeQueueSize > 30) { needKey = true; send({ t: 'keyframe' }); return; } dec.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: performance.now() * 1000, data: chunkData })); } catch { needKey = true; send({ t: 'keyframe' }); }
    };
    sock.onclose = () => { sock = null; if (dead) return; say(t('Reconnecting…'), true); clearTimeout(rT); rT = setTimeout(connect, Math.min(8000, 800 * 2 ** retry++)); };
  }
  const send = (m) => { if (sock && sock.readyState === 1) sock.send(JSON.stringify(m)); };
  // input
  const pt = (e) => { const r = canvas.getBoundingClientRect(); return { x: Math.round((e.clientX - r.left) / r.width * size.w), y: Math.round((e.clientY - r.top) / r.height * size.h), w: size.w, h: size.h }; };
  const down = new Set();
  canvas.addEventListener('pointerdown', (e) => { if (!size.w) return; canvas.focus(); canvas.setPointerCapture(e.pointerId); down.add(e.pointerId); send({ t: 'touch', a: 0, id: e.pointerType === 'touch' ? e.pointerId & 15 : undefined, ...pt(e) }); e.preventDefault(); });
  canvas.addEventListener('pointermove', (e) => { if (down.has(e.pointerId)) send({ t: 'touch', a: 2, id: e.pointerType === 'touch' ? e.pointerId & 15 : undefined, ...pt(e) }); });
  const up = (e) => { if (!down.delete(e.pointerId)) return; send({ t: 'touch', a: 1, id: e.pointerType === 'touch' ? e.pointerId & 15 : undefined, ...pt(e) }); };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { if (!size.w) return; e.preventDefault(); send({ t: 'scroll', ...pt(e), hs: -Math.sign(e.deltaX), vs: -Math.sign(e.deltaY) }); }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); send({ t: 'back', a: 0 }); send({ t: 'back', a: 1 }); });
  const KEYS = { Enter: 66, Backspace: 67, Delete: 112, Tab: 61, ArrowUp: 19, ArrowDown: 20, ArrowLeft: 21, ArrowRight: 22, Escape: 4, Home: 122, End: 123, PageUp: 92, PageDown: 93 };
  canvas.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'v') { e.preventDefault(); navigator.clipboard && navigator.clipboard.readText().then((txt) => send({ t: 'setclip', text: txt, paste: true })).catch(() => {}); return; }
    if (KEYS[e.key]) { e.preventDefault(); key(KEYS[e.key]); return; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); send({ t: 'text', text: e.key }); }
  });
  function key(code) { send({ t: 'key', a: 0, code }); send({ t: 'key', a: 1, code }); }
  const watch = setInterval(() => { if (sock && sock.readyState === 1 && lastFrame && Date.now() - lastFrame > 20000) send({ t: 'keyframe' }); }, 10000);
  connect();
  return { send, key, reattach() { if (sock && sock.readyState === 1) send({ t: 'attach' }); else connect(); }, destroy() { dead = true; clearInterval(watch); clearTimeout(rT); try { sock && sock.close(); } catch {} try { dec && dec.state !== 'closed' && dec.close(); } catch {} } };
}

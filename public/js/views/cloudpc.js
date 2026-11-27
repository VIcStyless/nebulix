// Nebulix Cloud PC (3.0, phase 10) — Linux virtual machines (QEMU/KVM) on Nebulix compute nodes. The screen comes over
// VNC through the node's WebSocket and is drawn by noVNC (MPL-2.0, vendored in /js/vendor/novnc). #/cloudpc, #/cloudpc/<id>
import { h, mount } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { toast, toastErr, modal, confirmBox, loading, emptyState, field, promptBox } from '../ui.js';
import { S } from '../state.js';

const STATE = { running: ['Running', 'good'], starting: ['Starting…', 'warn'], stopping: ['Stopping…', 'warn'], stopped: ['Stopped', ''], unreachable: ['Node offline', 'bad'] };
const chip = (s) => { const x = STATE[s] || [s, '']; return h('span.an-state.' + (x[1] || 'idle'), t(x[0])); };
const B = '/api/cloudpc';
const gb = (mb) => (mb / 1024).toFixed(mb % 1024 ? 1 : 0) + ' GB';

export default {
  full: true,
  title: () => 'Nebulix Cloud PC',
  async mount(root, ctx) { return ctx.params[0] ? machinePage(root, ctx, ctx.params[0]) : homePage(root, ctx); },
};

async function homePage(root, ctx) {
  const wrap = h('div.an'); mount(root, wrap, loading()); let st, list;
  async function load() { try { [st, list] = await Promise.all([api.get(B + '/status'), api.get(B + '/devices')]); render(); } catch (e) { mount(wrap, emptyState('alert', t('Could not load Cloud PC'), e.message)); } }
  function render() {
    const online = st.nodes.filter((n) => n.online); const imgs = new Map(); for (const n of online) for (const i of n.vmImages) imgs.set(i.id, i);
    const head = h('header.an-hero.cpc-hero',
      h('div.an-hero-txt', h('div.eyebrow', t('Your computer in the cloud')), h('h1', 'Nebulix Cloud PC'),
        h('p', t('Full Linux virtual machines on Nebulix compute servers. Use them from any browser; they keep their disk between sessions.')),
        h('div.an-status', !st.configured ? h('span.an-state.bad', t('No compute node connected')) : online.length ? h('span.an-state.good', t('{n} compute node(s) online', { n: online.length })) : h('span.an-state.bad', t('Compute nodes offline')), h('span.tiny.muted', t('{a} of {b} machines', { a: st.used, b: st.quota }))),
        online.length && online.every((n) => n.accel === 'tcg') ? h('p.tiny.muted.cpc-tcg', icon('alert', 12), ' ', t('These servers have no hardware virtualisation, so machines run in software emulation: they work, but start and run more slowly.')) : null),
      h('div.an-hero-actions', h('button.btn.primary', { disabled: !imgs.size || st.used >= st.quota, onClick: () => create([...imgs.values()]) }, icon('plus', 16), t('New machine')), h('a.btn', { href: '#/vm' }, icon('monitor', 16), t('Machines in this browser (offline)'))));
    let body;
    if (!st.configured) body = emptyState('monitor', t('Cloud PC is not connected yet'), t('Virtual machines run on separate servers with KVM, not on the Nebulix web server. Until a compute node is connected you can run small systems inside your browser.'), S.me && (S.me.role === 'owner' || S.me.role === 'admin') ? h('a.btn.primary', { href: '#/admin/compute' }, icon('gear', 15), t('Connect a compute node')) : null);
    else if (!list.devices.length) body = emptyState('monitor', t('No machines yet'), t('Create a machine from a ready-made system or from an installer (ISO).'));
    else body = h('div.an-grid', list.devices.map((d) => h('article.an-card', h('div.an-card-art.cpc', icon('monitor', 26)),
      h('div.an-card-body', h('div.row', h('b.grow', d.name), chip(d.state)), h('div.tiny.muted', [d.cpu + ' CPU', gb(d.ram) + ' RAM', d.storage + ' GB'].join(' · ')),
        h('div.row.an-card-actions', h('button.btn.sm.primary', { onClick: () => ctx.go('cloudpc/' + d.id) }, icon('play', 14), t('Open')),
          d.state === 'stopped' ? h('button.btn.sm', { onClick: () => act(d, 'start') }, icon('power', 14), t('Start')) : null,
          h('button.btn.sm.ghost', { title: t('Delete'), 'aria-label': t('Delete'), onClick: () => del(d) }, icon('trash', 14)))))));
    mount(wrap, head, body);
  }
  async function act(d, op) { try { await api.post(B + '/devices/' + d.id + '/' + op, {}); load(); } catch (e) { toastErr(e); } }
  async function del(d) { if (!await confirmBox(t('Delete “{n}” and its disk? This cannot be undone.', { n: d.name }), { danger: true, ok: t('Delete') })) return; try { await api.del(B + '/devices/' + d.id); toast(t('Machine deleted'), 'good'); load(); } catch (e) { toastErr(e); } }
  function create(imgs) {
    const cap = st.caps; const name = h('input', { placeholder: t('My Linux PC'), maxLength: 40 });
    const img = h('select', imgs.map((i) => h('option', { value: i.id }, (i.os === 'windows' ? '🪟 ' : '🐧 ') + i.name + (i.kind === 'iso' ? ' — ' + t('installer / live (ISO)') : ''))));
    const winNote = h('div');
    const opts = (vals, def, fmt) => vals.map((v) => h('option', { value: v, selected: v === def }, fmt(v)));
    const cpu = h('select', opts([1, 2, 4, 6, 8].filter((v) => v <= cap.cpu), 2, (v) => v + ' CPU'));
    const ram = h('select', opts([1024, 2048, 4096, 8192, 16384].filter((v) => v <= cap.ram), 2048, gb));
    const sto = h('select', opts([10, 20, 30, 50, 64, 100, 200].sort((a, b) => a - b).filter((v) => v <= cap.storage), 20, (v) => v + ' GB'));
    const paintWin = () => { const sel = imgs.find((i) => i.id === img.value) || {}; const nd = st.nodes.find((n) => n.online && n.vmImages.some((x) => x.id === img.value)) || {}; const w = nd.windows || {};
      if (sel.os !== 'windows') return mount(winNote);
      if (cap.storage < 64 || cap.ram < 4096) return mount(winNote, h('p.an-warn', t('Windows needs 4 GB of memory and a 64 GB disk — available with PRO.')));
      ram.value = String(Math.max(4096, +ram.value)); sto.value = String(Math.max(64, +sto.value)); cpu.value = String(Math.max(2, +cpu.value));
      mount(winNote, h('div.an-win', h('b', '🪟 Windows'), h('ul.tiny', h('li', t('You need your own Windows licence; Nebulix does not include one.')),
        h('li', (w.memory === false ? '⛔ ' + t('This server is too small for Windows (it needs at least 6 GB of RAM)') : '✅ ' + t('Enough memory on the server'))),
        h('li', (w.uefi ? '✅ ' : '⚠️ ') + t('UEFI firmware')), h('li', (w.tpm ? '✅ ' : '⚠️ ') + t('TPM 2.0 (Windows 11)') + (w.tpm ? '' : ' — ' + t('missing: Windows 11 setup will refuse; Windows 10 works'))),
        h('li', (nd.kvm ? '✅ ' + t('Hardware acceleration (KVM)') : '⚠️ ' + t('No KVM on this server: Windows will be extremely slow'))), w.drivers ? h('li', '✅ ' + t('virtio drivers disc attached')) : null))); };
    img.addEventListener('change', paintWin); setTimeout(paintWin, 0);
    modal({ title: t('New machine'), body: h('div.col', { style: 'gap:12px' }, field(t('Name'), name), field(t('System'), img), winNote, h('div.an-hw', field(t('Processor'), cpu), field(t('Memory'), ram), field(t('Disk'), sto)),
      h('p.tiny.muted', t('Ready-made systems start with a fresh copy of that system. ISO machines get an empty disk: install the system from the ISO or use it live.'))),
      actions: [{ label: t('Cancel'), value: false }, { label: t('Create'), kind: 'primary', onClick: async () => { try { const r = await api.post(B + '/devices', { name: name.value, image: img.value, cpu: +cpu.value, ram: +ram.value, storage: +sto.value }); toast(t('Machine created'), 'good'); ctx.go('cloudpc/' + r.device.id); } catch (e) { toastErr(e); return false; } } }] });
  }
  await load();
}

async function machinePage(root, ctx, id) {
  const wrap = h('div.an.an-dev'); mount(root, wrap, loading()); let m; let rfb = null; let alive = true;
  const base = B + '/devices/' + id;
  const refresh = async () => { m = (await api.get(B + '/devices')).devices.find((x) => x.id === id); if (!m) throw new Error(t('Machine not found')); };
  try { await refresh(); } catch (e) { mount(wrap, emptyState('alert', t('Machine not found'), e.message, h('a.btn', { href: '#/cloudpc' }, t('Back')))); return () => {}; }
  ctx.setTitle && ctx.setTitle(m.name);
  const stateBox = h('span'); const power = h('button.btn.sm.an-power'); const off = h('button.btn.sm.ghost', { title: t('Force off (like pulling the plug)') }, t('Force off'));
  const reset = h('button.btn.sm', { onClick: () => op('restart') }, icon('refresh', 14), t('Restart'));
  const screen = h('div.cpc-screen'); const overlay = h('div.an-overlay', h('p', '')); const stage = h('div.cpc-stage', screen, overlay);
  const stats = h('div.cpc-stats'); const snapsEl = h('div.an-list');
  const say = (txt, spin) => { mount(overlay, spin ? h('span.spinner') : null, h('p', txt)); overlay.hidden = false; };
  const hwText = h('div.small');
  function head() {
    mount(stateBox, chip(m.state)); const run = m.state === 'running';
    mount(power, icon(run ? 'stop' : 'power', 14), run ? t('Shut down') : t('Start')); power.disabled = m.state === 'starting' || m.state === 'stopping' || m.state === 'unreachable'; power.onclick = () => op(run ? 'stop' : 'start');
    off.hidden = !run; off.onclick = async () => { if (await confirmBox(t('Force the machine off? Unsaved work inside it is lost.'), { danger: true })) op('stop', { force: true }); };
    reset.disabled = !run; hwText.textContent = [m.cpu + ' CPU', gb(m.ram) + ' RAM', m.storage + ' GB', t('on {n}', { n: m.node })].join(' · ');
  }
  async function op(name, body = {}) {
    try { if (name === 'stop' || name === 'start') { m.state = name === 'stop' ? 'stopping' : 'starting'; head(); } const r = await api.post(base + '/' + name, body); if (r.device) Object.assign(m, r.device); await refresh().catch(() => {}); head(); connect(); return r; } catch (e) { toastErr(e); await refresh().catch(() => {}); head(); return null; }
  }
  async function connect() {
    if (rfb) { try { rfb.disconnect(); } catch {} rfb = null; }
    if (m.state !== 'running') { say(m.state === 'stopped' ? t('The machine is off. Press Start.') : m.state === 'unreachable' ? t('The compute node is not reachable right now.') : t('Please wait…'), m.state !== 'stopped' && m.state !== 'unreachable'); return; }
    say(t('Connecting to the screen…'), true);
    let tk; try { tk = await api.post(base + '/ticket', {}); } catch (e) { say(e.message); return; }
    const { default: RFB } = await import('../vendor/novnc/core/rfb.js');
    if (!alive) return;
    screen.replaceChildren(); rfb = new RFB(screen, tk.ws, {}); rfb.scaleViewport = true; rfb.resizeSession = false; rfb.focusOnClick = true; rfb.background = '#020617';
    rfb.addEventListener('connect', () => { overlay.hidden = true; });
    rfb.addEventListener('disconnect', async (e) => { if (!alive) return; await refresh().catch(() => {}); head(); if (m.state === 'running') { say(t('Connection lost — reconnecting…'), true); setTimeout(() => alive && connect(), 2500); } else connect(); });
    rfb.addEventListener('clipboard', (e) => { clip.value = e.detail.text; });
  }
  const clip = h('textarea', { rows: 3, placeholder: t('Text to send to the machine’s clipboard') });
  async function shot() { try { const tk = await api.post(base + '/ticket', {}); const r = await fetch(tk.base + '/v1/screenshot?t=' + encodeURIComponent(tk.t)); if (!r.ok) throw new Error(t('Screenshot failed')); const a = h('a', { href: URL.createObjectURL(await r.blob()), download: 'cloudpc-' + Date.now() + '.png' }); a.click(); } catch (e) { toastErr(e); } }
  function drawSnaps() {
    mount(snapsEl, (m.snapshots || []).length ? m.snapshots.slice().reverse().map((s) => h('div.an-row', icon('layers', 14), h('span.grow', s.name), h('span.tiny.muted', new Date(s.at).toLocaleString()),
      h('button.btn.sm', { onClick: async () => { if (await confirmBox(t('Go back to “{n}”? What happened after it will be lost.', { n: s.name }))) { toast(t('Restoring…')); await op('snapshot-load', { name: s.name }); } } }, t('Restore')),
      h('button.btn.sm.ghost', { title: t('Delete'), onClick: async () => { const r = await op('snapshot-delete', { name: s.name }); if (r) { m.snapshots = r.snapshots; drawSnaps(); } } }, icon('trash', 13)))) : h('p.muted.small', t('No snapshots yet.')));
  }
  let statT = 0;
  async function pollStats() { if (!alive) return; if (m.state === 'running') { try { const r = await api.get(base + '/info'); const s2 = r.stats || {}; mount(stats, h('div.cpc-meter', h('span', 'CPU'), h('b', s2.cpu == null ? '…' : s2.cpu + '%'), h('i', h('em', { style: 'width:' + Math.min(100, (s2.cpu || 0) / m.cpu) + '%' }))), h('div.cpc-meter', h('span', 'RAM'), h('b', ((s2.rss || 0) / 1073741824).toFixed(2) + ' / ' + gb(m.ram)), h('i', h('em', { style: 'width:' + Math.min(100, (s2.rss || 0) / (m.ram * 1048576) * 100) + '%' }))), h('div.tiny.muted', t('Up for {m} min', { m: Math.round((s2.uptime || 0) / 60) }))); } catch { mount(stats, h('p.tiny.muted', '—')); } } else mount(stats, h('p.tiny.muted', t('Off'))); statT = setTimeout(pollStats, 3000); }
  const side = h('div.an-panel.col', { style: 'gap:16px' },
    h('section', h('div.eyebrow', t('Resources')), stats),
    h('section', h('div.eyebrow', t('Keys')), h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, [['cad', 'Ctrl+Alt+Supr'], ['cab', 'Ctrl+Alt+⌫'], ['cf1', 'Ctrl+Alt+F1'], ['cf2', 'Ctrl+Alt+F2'], ['cf7', 'Ctrl+Alt+F7']].map(([k, l]) => h('button.btn.sm', { onClick: () => op('keys', { combo: k }) }, l)))),
    h('section', h('div.eyebrow', t('Clipboard')), clip, h('button.btn.sm', { onClick: () => { if (rfb) { rfb.clipboardPasteFrom(clip.value); toast(t('Sent to the machine — paste it there')); } } }, icon('copy', 14), t('Send to machine')), h('p.tiny.muted', t('Works on systems with a VNC clipboard agent; text copied in the machine appears here.'))),
    h('section', h('div.eyebrow', t('Screen')), h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, h('button.btn.sm', { onClick: shot }, icon('camera', 14), t('Screenshot')), h('button.btn.sm', { onClick: () => stage.requestFullscreen && stage.requestFullscreen() }, icon('monitor', 14), t('Full screen')))),
    h('section', h('div.eyebrow', t('Snapshots')), h('p.tiny.muted', t('A snapshot saves the whole machine — disk, memory and what is on screen.')),
      h('button.btn.sm.primary', { onClick: async () => { if (m.state !== 'running') return toast(t('Start the machine first'), 'err'); const n = await promptBox(t('Snapshot name'), { value: 'snap-' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '') }); if (!n) return; toast(t('Saving snapshot…')); const r = await op('snapshot-save', { name: n }); if (r) { m.snapshots = r.snapshots; drawSnaps(); toast(t('Snapshot saved'), 'good'); } } }, icon('plus', 14), t('Save snapshot')), snapsEl),
    h('section', h('div.eyebrow', t('Hardware')), hwText,
      h('button.btn.sm', { onClick: hw }, icon('cpu', 14), t('Change hardware')), m.iso ? h('button.btn.sm.ghost', { onClick: async () => { if (m.state !== 'stopped') return toast(t('Turn the machine off first'), 'err'); await op('config', { eject: true }); toast(t('Installer removed — the machine now starts from its disk'), 'good'); } }, t('Remove installer (ISO)')) : null));
  function hw() {
    if (m.state !== 'stopped') return toast(t('Turn the machine off to change its hardware'), 'err');
    const cpu = h('input', { type: 'number', min: 1, max: 8, value: m.cpu }); const ram = h('input', { type: 'number', min: 512, max: 16384, step: 512, value: m.ram });
    modal({ title: t('Change hardware'), body: h('div.an-hw', field(t('Processor (cores)'), cpu), field(t('Memory (MB)'), ram)), actions: [{ label: t('Cancel'), value: false }, { label: t('Save'), kind: 'primary', onClick: async () => { const r = await op('config', { cpu: +cpu.value, ram: +ram.value }); if (!r) return false; head(); } }] });
  }
  mount(wrap, h('header.an-bar', h('a.btn.sm.ghost', { href: '#/cloudpc', 'aria-label': t('Back') }, icon('back', 16)), h('div.grow', h('h2', m.name), h('div.row', { style: 'gap:8px' }, stateBox, h('span.tiny.muted', m.image || ''))), reset, off, power),
    h('div.cpc-main', stage, side));
  head(); drawSnaps(); connect(); pollStats();
  return () => { alive = false; clearTimeout(statT); if (rfb) try { rfb.disconnect(); } catch {} };
}

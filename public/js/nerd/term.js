// Nerd Lab → Console: a pretend terminal with real commands (neofetch, ping, speed, theme, reach, distro…). It never touches your files.
import { h, mount, fmt, pick, rand } from '../util.js';
import { t, getLang } from '../i18n.js';
import { api } from '../api.js';
import { S, isPro } from '../state.js';
import * as theme from '../theme.js';
import { sysInfo, measureRefresh, mean, median, round, sleep } from './common.js';
import { DISTROS, findDistro, distroUrl } from './linux.js';

const ART = [
  '      _.-""""-._      ',
  '   .-\'  *   .   \'-.   ',
  ' ~(   .   ()    *  )~ ',
  '   \'-.  *    .  .-\'   ',
  '      \'-.____.-\'      ',
];
const COW = (s) => { const line = ' ' + '-'.repeat(s.length + 2); return [line, `< ${s} >`, line, '        \\   ^__^', '         \\  (oo)\\_______', '            (__)\\       )\\/\\', '                ||----w |', '                ||     ||'].join('\n'); };

export default {
  mount(host, ctx) {
    let alive = true; const hist = []; let hi = 0; let rainStop = null;
    const out = h('div.term-out', { role: 'log', 'aria-live': 'polite', tabindex: 0 });
    const input = h('input.term-input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': t('Terminal input'), placeholder: t('type "help" and press Enter') });
    const ps = h('span.term-ps', (S.me.username || 'player') + '@nebulix:~$');
    const print = (s = '', cls = '') => { const l = h('div.term-l' + (cls ? '.' + cls : ''), String(s)); out.appendChild(l); while (out.children.length > 500) out.firstChild.remove(); out.scrollTop = out.scrollHeight; return l; };
    const node = (el) => { out.appendChild(el); out.scrollTop = out.scrollHeight; };
    const io = { print, node, clear: () => mount(out) };
    const num = (s, d) => { const n = parseInt(s, 10); return Number.isFinite(n) ? n : d; };

    const C = {
      help: ['List the commands', async () => { print(t('Commands:'), 'dim'); for (const [k, v] of Object.entries(C)) print('  ' + k.padEnd(10) + t(v[0]), ''); print(t('Tip: Tab completes, ↑/↓ browse history.'), 'dim'); }],
      neofetch: ['Show your machine, Nebulix style', async () => {
        const [i, r] = await Promise.all([sysInfo(), measureRefresh(450)]); const th = theme.getTheme();
        const rows = [[`${S.me.username}@nebulix`, ''], ['─'.repeat(18), ''], ['OS', i.os], ['Browser', i.browser], ['CPU', `${i.threads || '?'} threads`], ['Memory', i.memGB ? (i.memGB >= 8 ? '8+ GB' : i.memGB + ' GB') : '?'],
          ['GPU', i.gl ? i.gl.renderer.replace(/ANGLE \(|\)$/g, '').slice(0, 44) : 'n/a'], ['Screen', `${i.screen.pw}×${i.screen.ph}${r.hz ? ' @ ' + r.hz + ' Hz' : ''}`], ['Language', i.languages[0] || '?'], ['Theme', (th && th.name) || 'Nebulix'], ['Coins', fmt.num(S.me.coins)], ['Plan', isPro() ? 'PRO' : 'Free']];
        node(h('div.term-fetch', h('pre.art', ART.join('\n')), h('pre', rows.map(([k, v]) => (v === '' ? k : `${k.padEnd(9)}${v}`)).join('\n'))));
      }],
      whoami: ['Who are you?', async () => print(`${S.me.displayName || S.me.username} (@${S.me.username}) · ${S.me.role}${isPro() ? ' · PRO' : ''}${S.me.verified ? ' · ✔ verified' : ''}`)],
      coins: ['Your coin balance', async () => print(fmt.num(S.me.coins))],
      date: ['Date and time', async () => print(new Date().toString())],
      echo: ['Repeat what you type', async (a) => print(a.join(' '))],
      clear: ['Clear the screen', async () => io.clear()],
      history: ['Commands you ran', async () => hist.forEach((c, k) => print(String(k + 1).padStart(3) + '  ' + c))],
      ping: ['Latency to the Nebulix server', async (a) => {
        const n = Math.max(1, Math.min(10, num(a[0], 4))); const s = [];
        for (let k = 1; k <= n && alive; k++) { const t0 = performance.now(); try { await (await fetch('/api/nerd/ping?x=' + Date.now() + k, { cache: 'no-store' })).json(); const ms = performance.now() - t0; s.push(ms); print(`reply from nebulix: seq=${k} time=${ms.toFixed(1)} ms`); } catch { print(`seq=${k} timed out`, 'err'); } await sleep(150); }
        if (s.length) print(`--- ${s.length}/${n} replies · min/avg/max = ${Math.min(...s).toFixed(1)}/${mean(s).toFixed(1)}/${Math.max(...s).toFixed(1)} ms`, 'dim');
      }],
      speed: ['Quick download test (4 MB)', async () => {
        print(t('Downloading 4 MB from the server…'), 'dim'); const t0 = performance.now(); const res = await fetch('/api/nerd/blob?mb=4', { cache: 'no-store' });
        if (!res.ok) return print(t('The server refused the test ({s}).', { s: res.status }), 'err'); const b = await res.arrayBuffer(); const secs = (performance.now() - t0) / 1000;
        print(`↓ ${(((b.byteLength * 8) / secs) / 1e6).toFixed(1)} Mbps  (${fmt.bytes(b.byteLength)} in ${secs.toFixed(2)} s)`);
      }],
      fps: ['Measure your screen refresh rate', async () => { print(t('Measuring…'), 'dim'); const r = await measureRefresh(900); print(r.hz ? `${r.hz} Hz  (${r.raw.toFixed(1)} measured)` : t('Could not measure — keep this tab visible.')); }],
      theme: ['theme list | set <name> | random', async (a) => {
        const sub = (a[0] || 'list').toLowerCase();
        if (sub === 'list') return print(theme.PRESETS.map((p) => p.name).join(' · '));
        const p = sub === 'random' ? pick(theme.PRESETS) : theme.PRESETS.find((x) => x.name.toLowerCase() === a.slice(sub === 'set' ? 1 : 0).join(' ').toLowerCase());
        if (!p) return print(t('No theme with that name. Try "theme list".'), 'err');
        const th = theme.apply(theme.fromPreset(p)); try { await api.patch('/api/profile', { settings: { activeTheme: th } }); } catch {} print(t('Theme applied: {n}', { n: p.name }));
      }],
      open: ['open <address or search>', async (a) => { if (!a.length) return print(t('Usage: open <address or search>'), 'err'); print(t('Opening in the Nebulix browser…'), 'dim'); ctx.go('browse', { go: a.join(' ') }); }],
      distro: ['distro list | <name>  (try a Linux online)', async (a) => {
        if (!a.length || a[0] === 'list') { print(t('{n} systems available via DistroSea:', { n: DISTROS.length }), 'dim'); return print(DISTROS.map((d) => d.slug).join('  ')); }
        const d = findDistro(a.join(' ')); if (!d) return print(t('Unknown system. Try "distro list".'), 'err'); print(t('Opening {n} on DistroSea through Nebulix…', { n: d.name }), 'dim'); ctx.go('browse', { go: distroUrl(d.slug) });
      }],
      reach: ['reach <url>  (can the server reach it?)', async (a) => {
        let u = (a[0] || '').trim(); if (!u) return print(t('Usage: reach <url>'), 'err'); if (!/^[a-z]+:\/\//i.test(u)) u = 'https://' + u;
        try { const r = await api.get('/api/nerd/reach?url=' + encodeURIComponent(u), { quiet: true }); print(r.ok ? `OK ${r.url} → HTTP ${r.status} in ${r.ms} ms (DNS ${r.dns ?? '?'} · connect ${r.connect ?? '?'} · TLS ${r.tls ?? '—'})` : `✘ ${r.url} → ${r.error}`, r.ok ? '' : 'err'); } catch (e) { print(e.message, 'err'); }
      }],
      uptime: ['Server uptime and load', async () => { const s = await api.get('/api/nerd/server'); print(`up ${fmt.dur(s.uptime)} · load ${s.load.join(' ')} · ${s.cpus} cores · ${s.rssMB} MB · ${s.online} online · Nebulix v${s.version}`); }],
      roll: ['roll 2d6  (dice)', async (a) => {
        const m = /^(\d{1,2})?d(\d{1,3})$/i.exec(a[0] || 'd20'); if (!m) return print(t('Usage: roll 2d6'), 'err'); const n = +(m[1] || 1), s = +m[2]; if (s < 2) return print(t('A die needs at least 2 sides.'), 'err');
        const r = Array.from({ length: n }, () => 1 + Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 * s)); print(`${n}d${s}: ${r.join(' + ')}${n > 1 ? ' = ' + r.reduce((x, y) => x + y, 0) : ''}`);
      }],
      flip: ['Flip a coin', async () => print(crypto.getRandomValues(new Uint8Array(1))[0] & 1 ? 'Heads' : 'Tails')],
      cowsay: ['cowsay <text>', async (a) => node(h('pre.term-pre', COW(a.join(' ') || 'moo')))],
      matrix: ['Digital rain (any key stops it)', async () => {
        if (rainStop) rainStop(); const cv = h('canvas.term-rain'); const box = out.parentElement; box.appendChild(cv); cv.width = box.clientWidth; cv.height = box.clientHeight; const g = cv.getContext('2d'); const cols = Math.floor(cv.width / 14); const drops = Array.from({ length: cols }, () => rand(-30, 0)); const chars = '01ABCDEFGHIJKLMNOPQRSTUVWXYZ+=*<>'; let raf = 0;
        const stop = () => { cancelAnimationFrame(raf); cv.remove(); document.removeEventListener('keydown', stop, true); rainStop = null; }; rainStop = stop; document.addEventListener('keydown', stop, true); setTimeout(() => rainStop === stop && stop(), 7000);
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--success').trim() || '#34d399';
        const tick = () => { g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(0, 0, cv.width, cv.height); g.fillStyle = accent; g.font = '14px monospace'; for (let i = 0; i < cols; i++) { g.fillText(chars[Math.floor(Math.random() * chars.length)], i * 14, drops[i] * 14); if (drops[i] * 14 > cv.height && Math.random() > 0.975) drops[i] = 0; drops[i]++; } raf = requestAnimationFrame(tick); }; tick();
      }],
      sudo: ['Try it ;)', async () => print(t('Nice try. This is a toy terminal: nothing here can touch your files.'), 'dim')],
      exit: ['Back to Home', async () => ctx.go('home')],
    };
    C.rm = C.sudo; C.ls = ['List the secrets', async () => print('coins/  themes/  nova/  casino/  linux-lab/  README.nerd')];

    const parse = (line) => [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => (m[1] !== undefined ? m[1] : m[2]));
    let busy = false;
    async function run(line) {
      line = line.trim(); print(`${ps.textContent} ${line}`, 'cmd'); if (!line) return; if (hist[hist.length - 1] !== line) hist.push(line); if (hist.length > 60) hist.shift(); hi = hist.length;
      const [name, ...args] = parse(line); const cmd = C[(name || '').toLowerCase()];
      if (!cmd) return print(t('command not found: {c}. Try "help".', { c: name }), 'err');
      busy = true; input.disabled = true;
      try { await cmd[1](args); } catch (e) { print((e && e.message || e), 'err'); } finally { busy = false; input.disabled = false; if (alive) input.focus(); }
    }
    function complete() {
      const v = input.value; const parts = v.split(/\s+/); if (parts.length === 1) { const m = Object.keys(C).filter((k) => k.startsWith(parts[0].toLowerCase())); if (m.length === 1) input.value = m[0] + ' '; else if (m.length > 1) print(m.join('  '), 'dim'); }
      else if (parts[0] === 'distro') { const m = DISTROS.filter((d) => d.slug.startsWith(parts[1].toLowerCase())); if (m.length === 1) input.value = 'distro ' + m[0].slug; else if (m.length > 1 && m.length < 30) print(m.map((d) => d.slug).join('  '), 'dim'); }
      else if (parts[0] === 'theme' && parts.length >= 2) { const q = parts.slice(parts[1] === 'set' ? 2 : 1).join(' ').toLowerCase(); const m = theme.PRESETS.filter((p) => p.name.toLowerCase().startsWith(q)); if (m.length === 1) input.value = 'theme set ' + m[0].name; }
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (busy) return; const v = input.value; input.value = ''; run(v); }
      else if (e.key === 'Tab') { e.preventDefault(); complete(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (hist.length) { hi = Math.max(0, hi - 1); input.value = hist[hi] || ''; } }
      else if (e.key === 'ArrowDown') { e.preventDefault(); hi = Math.min(hist.length, hi + 1); input.value = hist[hi] || ''; }
      else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); io.clear(); }
    });
    const box = h('div.term', { onClick: (e) => { if (!window.getSelection().toString() && e.target !== input) input.focus(); } }, out, h('div.term-in', ps, input));
    mount(host, box, h('p.tiny.muted', { style: 'margin-top:8px' }, t('This console only runs the commands listed in "help". It cannot read or change anything on your computer.')));
    print('Nebulix console · ' + t('type "help" to see what you can do.'), 'dim'); print('');
    setTimeout(() => alive && input.focus({ preventScroll: true }), 50);
    return () => { alive = false; if (rainStop) rainStop(); };
  },
};

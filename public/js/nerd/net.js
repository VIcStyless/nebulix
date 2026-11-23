// Nerd Lab → Network: latency (HTTP + WebSocket), download/upload speed to the Nebulix server, "can the server reach X?" checks and a privacy mirror.
import { h, mount, fmt } from '../util.js';
import { t } from '../i18n.js';
import { api, ws } from '../api.js';
import { S, bus } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr } from '../ui.js';
import { card, kv, stat, pill, sparkline, mean, round, sleep } from './common.js';

const TARGETS = [
  ['Gaming', [['Steam', 'https://store.steampowered.com/'], ['Epic Games', 'https://www.epicgames.com/'], ['Xbox', 'https://www.xbox.com/'], ['PlayStation', 'https://www.playstation.com/'], ['Riot Games', 'https://www.riotgames.com/'], ['Battle.net', 'https://battle.net/'], ['Roblox', 'https://www.roblox.com/'], ['Minecraft', 'https://www.minecraft.net/']]],
  ['Community', [['Discord', 'https://discord.com/'], ['Twitch', 'https://www.twitch.tv/'], ['YouTube', 'https://www.youtube.com/'], ['Reddit', 'https://www.reddit.com/']]],
  ['Browser games', [['Poki', 'https://poki.com/'], ['CrazyGames', 'https://www.crazygames.com/'], ['itch.io', 'https://itch.io/'], ['Lichess', 'https://lichess.org/']]],
  ['Tools', [['DistroSea', 'https://distrosea.com/'], ['Cloudflare', 'https://1.1.1.1/'], ['Google', 'https://www.google.com/'], ['Wikipedia', 'https://www.wikipedia.org/']]],
];
const ERRS = { ENOTFOUND: 'DNS lookup failed', EAI_AGAIN: 'DNS lookup failed', timeout: 'Timed out', ETIMEDOUT: 'Timed out', ECONNREFUSED: 'Connection refused', ECONNRESET: 'Connection reset', blocked: 'Blocked (private address)', CERT_HAS_EXPIRED: 'Certificate expired', DEPTH_ZERO_SELF_SIGNED_CERT: 'Bad certificate', UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'Bad certificate' };

const stats = (a) => { if (!a.length) return null; let j = 0; for (let i = 1; i < a.length; i++) j += Math.abs(a[i] - a[i - 1]); return { min: Math.min(...a), avg: mean(a), max: Math.max(...a), jitter: a.length > 1 ? j / (a.length - 1) : 0 }; };

export default {
  mount(host) {
    let alive = true; const stop = { v: false };

    // ---------------- latency ----------------
    const lat = { http: stat(t('Server latency'), '—', ' ms'), jit: stat(t('Jitter'), '—', ' ms'), loss: stat(t('Packet loss'), '—', '%'), ws: stat(t('Live link (WebSocket)'), '—', ' ms') };
    const chart = sparkline({ h: 90 }); let latBusy = false; const latBtn = h('button.btn.primary', { onClick: runLatency }, icon('wifi', 16), t('Run latency test'));
    async function runLatency() {
      if (latBusy) return; latBusy = true; latBtn.disabled = true; const out = []; let lost = 0; const N = 20;
      for (let i = 0; i <= N && alive; i++) {
        const t0 = performance.now();
        try { const r = await fetch('/api/nerd/ping?x=' + i + '-' + Date.now(), { cache: 'no-store', credentials: 'same-origin' }); await r.json(); if (!r.ok) throw new Error('bad'); if (i > 0) out.push(performance.now() - t0); } catch { if (i > 0) lost++; }
        if (i > 0) { const s = stats(out); if (s) { lat.http.set(round(s.avg, 1)); lat.jit.set(round(s.jitter, 1)); } lat.loss.set(round((lost / i) * 100, 0)); chart.draw(out, { min: 0 }); }
        await sleep(90);
      }
      // WebSocket round trips (the same link chat and DMs use)
      if (alive) {
        if (!S.ws) lat.ws.set('—', undefined, t('Not connected'));
        else {
          const w = []; for (let i = 1; i <= 8 && alive; i++) {
            const ms = await new Promise((res) => { const t0 = performance.now(); const off = bus.on('ws:pong', (m) => { if (m.n === i) { off(); clearTimeout(to); res(performance.now() - t0); } }); const to = setTimeout(() => { off(); res(null); }, 2000); ws.send({ t: 'ping', n: i }); });
            if (ms !== null) w.push(ms); await sleep(80);
          }
          lat.ws.set(w.length ? round(mean(w), 1) : '—', undefined, w.length ? t('{n}/8 replies', { n: w.length }) : t('No reply'));
        }
      }
      latBusy = false; latBtn.disabled = false;
    }

    // ---------------- throughput ----------------
    let dlMB = 16; let spBusy = false; const dl = stat(t('Download'), '—', ' Mbps'), ul = stat(t('Upload'), '—', ' Mbps'); const spChart = sparkline({ h: 90 });
    const dlBtn = h('button.btn.primary', { onClick: runDown }, icon('download', 16), t('Test download')); const ulBtn = h('button.btn', { onClick: runUp }, icon('upload', 16), t('Test upload'));
    const sizeSel = h('select.select', { 'aria-label': t('Test size'), style: 'width:auto', onChange: (e) => { dlMB = +e.target.value; } }, [8, 16, 32].map((n) => h('option', { value: n, selected: n === dlMB }, n + ' MB')));
    const lock = (b) => { spBusy = b; dlBtn.disabled = b; ulBtn.disabled = b; };
    async function runDown() {
      if (spBusy) return; lock(true); dl.set('…'); const samples = [];
      try {
        const t0 = performance.now(); const res = await fetch('/api/nerd/blob?mb=' + dlMB, { cache: 'no-store', credentials: 'same-origin' });
        if (!res.ok) { let j = {}; try { j = await res.json(); } catch {} throw new Error(j.message || t('The speed test was refused ({s}).', { s: res.status })); }
        const rd = res.body.getReader(); let got = 0, lastT = t0, lastB = 0;
        for (;;) {
          const { value, done } = await rd.read(); if (done || !alive) break; got += value.length; const now = performance.now();
          if (now - lastT > 120) { const mbps = ((got - lastB) * 8) / ((now - lastT) / 1000) / 1e6; samples.push(mbps); lastT = now; lastB = got; dl.set(round(((got * 8) / ((now - t0) / 1000)) / 1e6, 1)); spChart.draw(samples, { min: 0 }); }
        }
        const secs = (performance.now() - t0) / 1000; dl.set(round(((got * 8) / secs) / 1e6, 1), undefined, `${fmt.bytes(got)} · ${secs.toFixed(2)} s`);
      } catch (e) { dl.set('—'); toast(e.message || t('Download test failed'), 'err'); } finally { lock(false); }
    }
    async function runUp() {
      if (spBusy) return; lock(true); ul.set('…');
      try {
        const MB = Math.min(dlMB, 16); const buf = new Uint8Array(MB * 1048576); for (let o = 0; o < buf.length; o += 65536) crypto.getRandomValues(buf.subarray(o, Math.min(o + 65536, buf.length)));
        const t0 = performance.now(); const res = await fetch('/api/nerd/upload', { method: 'POST', body: new Blob([buf]), headers: { 'Content-Type': 'application/octet-stream' }, credentials: 'same-origin' });
        const j = await res.json().catch(() => ({})); if (!res.ok) throw new Error(j.message || t('The speed test was refused ({s}).', { s: res.status }));
        const secs = (performance.now() - t0) / 1000; ul.set(round(((buf.length * 8) / secs) / 1e6, 1), undefined, `${fmt.bytes(buf.length)} · ${secs.toFixed(2)} s`);
      } catch (e) { ul.set('—'); toast(e.message || t('Upload test failed'), 'err'); } finally { lock(false); }
    }

    // ---------------- reachability ----------------
    const rows = new Map(); const custom = h('input.input', { placeholder: 'https://example.com', 'aria-label': t('Address to check'), onKeydown: (e) => { if (e.key === 'Enter') checkCustom(); } });
    const customOut = h('div.small', { style: 'margin-top:8px' }); let reachBusy = false;
    async function reach(url) {
      try { return await api.get('/api/nerd/reach?url=' + encodeURIComponent(url), { quiet: true }); }
      catch (e) { return { ok: false, error: e.status === 429 ? 'rate' : e.status === 403 ? 'blocked' : e.code || 'error', message: e.message }; }
    }
    function verdict(r) {
      if (!r.ok) return [t(r.error === 'rate' ? 'Slow down a little' : ERRS[r.error] || 'Unreachable'), 'bad'];
      if (r.status >= 500) return [t('Server error ({s})', { s: r.status }), 'bad']; if (r.status >= 400) return [t('Reachable (HTTP {s})', { s: r.status }), 'ok']; if (r.status >= 300) return [t('Reachable · redirects'), 'ok']; return [t('Reachable'), 'ok'];
    }
    const timing = (r) => (r.ok ? `${r.ms} ms` : r.ms ? `${r.ms} ms` : '');
    const tip = (r) => (r.ok ? `DNS ${r.dns ?? '?'} ms · connect ${r.connect ?? '?'} ms · TLS ${r.tls ?? '—'} ms · HTTP ${r.status}${r.server ? ' · ' + r.server : ''}` : '');
    function rowFor(name, url) {
      const st = h('span.pill', '—'); const tm = h('span.small.muted.mono'); const el = h('div.nl-reach', { dataset: { url } }, h('div.grow', h('b', name), h('div.tiny.muted', new URL(url).host)), tm, st, h('button.btn.sm.ghost', { 'aria-label': t('Check') + ' ' + name, onClick: () => one(o) }, icon('refresh', 14)));
      const o = { el, name, url, set(r) { const [txt, kind] = verdict(r); st.className = 'pill ' + kind; st.textContent = txt; tm.textContent = timing(r); tm.title = tip(r); el.title = r.ok ? tip(r) : (r.message || ''); }, busy() { st.className = 'pill'; st.textContent = '…'; tm.textContent = ''; } };
      rows.set(url, o); return o;
    }
    async function one(o) { o.busy(); o.set(await reach(o.url)); }
    async function checkAll() {
      if (reachBusy) return; reachBusy = true; allBtn.disabled = true; const list = [...rows.values()]; let i = 0;
      const worker = async () => { while (i < list.length && alive && !stop.v) { const o = list[i++]; await one(o); } };
      await Promise.all([worker(), worker(), worker(), worker()]); reachBusy = false; allBtn.disabled = false;
    }
    async function checkCustom() {
      let v = custom.value.trim(); if (!v) return; if (!/^[a-z]+:\/\//i.test(v)) v = 'https://' + v;
      try { new URL(v); } catch { return toast(t('That address does not look right.'), 'err'); }
      customOut.textContent = t('Checking…'); const r = await reach(v); const [txt, kind] = verdict(r);
      mount(customOut, pill(txt, kind), ' ', h('span.mono.small', timing(r)), ' ', h('span.tiny.muted', tip(r) || (r.message || '')));
    }
    const allBtn = h('button.btn.primary', { onClick: checkAll }, icon('globe', 16), t('Check all'));
    const groups = TARGETS.map(([g, list]) => h('div', h('div.nl-grp', t(g)), list.map(([n, u]) => rowFor(n, u).el)));

    // ---------------- privacy mirror + server ----------------
    const echoBox = h('div'); const srvBox = h('div');
    async function loadEcho() {
      mount(echoBox, h('span.spinner'));
      try {
        const e = await api.get('/api/nerd/echo'); const pick = ['user-agent', 'accept-language', 'sec-ch-ua', 'sec-ch-ua-platform', 'sec-gpc', 'dnt', 'referer', 'x-forwarded-for']; const hd = e.headers || {};
        mount(echoBox, kv(t('Your address (as Nebulix sees it)'), e.ip), kv(t('Protocol'), `HTTP/${e.http}${e.tls ? ' · TLS' : ' · ' + t('not encrypted (local)')}`),
          pick.filter((k) => hd[k]).map((k) => kv(k, String(hd[k]).slice(0, 90))));
      } catch (e) { mount(echoBox, h('span.error', e.message)); }
    }
    async function loadServer() {
      mount(srvBox, h('span.spinner'));
      try {
        const s = await api.get('/api/nerd/server');
        mount(srvBox, kv('Nebulix', 'v' + s.version), kv('Node.js', s.node), kv(t('Host'), s.platform), kv(t('CPU cores'), s.cpus), kv(t('Load (1/5/15 min)'), s.load.join(' · ')), kv(t('Server uptime'), fmt.dur(s.uptime)), kv(t('Server memory'), `${s.rssMB} MB (${t('heap')} ${s.heapMB} MB)`), kv(t('Players online'), s.online));
      } catch (e) { mount(srvBox, h('span.error', e.message)); }
    }

    mount(host,
      h('div.nl-grid',
        card(t('Latency'), 'wifi', h('div.nl-tiles.sm', lat.http, lat.jit, lat.loss, lat.ws), chart, h('div.row.wrap', { style: 'margin-top:10px' }, latBtn), h('p.tiny.muted', t('20 quick requests to the Nebulix server, then 8 round trips over the live WebSocket used by chat and DMs.'))),
        card(t('Speed'), 'bolt', h('div.nl-tiles.sm', dl, ul), spChart, h('div.row.wrap', { style: 'margin-top:10px' }, dlBtn, ulBtn, sizeSel),
          h('p.tiny.muted', t('This measures the path between your browser and the Nebulix server. Running Nebulix on your own PC shows your machine speed; through a public link it shows your connection to the PC that hosts it.')))),
      h('div.card.nl-card', { style: 'margin-top:14px' }, h('div.row.wrap', h('h3.grow', { style: 'margin:0' }, icon('globe', 18), t('Can Nebulix reach it?')), allBtn),
        h('p.small.muted', t('Checks run from the Nebulix server, so they show what the proxy can reach. "Reachable (HTTP 403)" still means the site answered.')),
        h('div.nl-reach-grid', groups), h('div.row', { style: 'margin-top:12px' }, h('div.grow', custom), h('button.btn', { onClick: checkCustom }, t('Check'))), customOut),
      h('div.nl-grid', { style: 'margin-top:14px' },
        card(t('What the server sees'), 'eye', echoBox, h('div.row.wrap', { style: 'margin-top:8px' }, h('button.btn.sm', { onClick: loadEcho }, icon('refresh', 14), t('Refresh'))),
          h('p.tiny.muted', t('Through the proxy, sites see the address of the PC running Nebulix — not your own. Cookies, referrers and trackers are cleaned before they reach the site.'))),
        card(t('Nebulix server'), 'server', srvBox, h('div.row.wrap', { style: 'margin-top:8px' }, h('button.btn.sm', { onClick: loadServer }, icon('refresh', 14), t('Refresh'))))));
    loadEcho(); loadServer();
    return () => { alive = false; stop.v = true; };
  },
};

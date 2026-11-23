// Pulse — the Nebulix music player: your files, Nebula Synth (generated music), internet radio and Spotify links,
// with skinnable visualizers, a 10-band EQ, 8D audio, sleep timer and a queue. DJ mode lives in views/dj.js.
import { h, mount, fmt, ls, debounce, copyText, download } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { bus } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, openMenu, modal, promptBox, confirmBox, segEl, switchEl, settingRow, loading, emptyState } from '../ui.js';
import * as P from '../pulse/engine.js';
import * as lib from '../pulse/library.js';
import { Viz, SKINS, eqIcon } from '../pulse/viz.js';

const VIZ_DEF = { skin: 'orbit', colors: 'theme', c1: '#8b5cf6', c2: '#38bdf8', glow: 0.7, sens: 1, bars: 96, mirror: true, cover: true, blur: true };
const time = (s) => { if (!Number.isFinite(s) || s < 0) return '0:00'; s = Math.floor(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const phMark = (tr) => { const k = tr && tr.kind; if (k === 'radio') return icon('wifi', 18); if (k === 'soundcloud') return icon('wifi', 18); if (k === 'ytmusic') return icon('play', 18); if (k === 'spotify') return icon('music', 18); if (k === 'gen') return icon('spark', 18); return h('span', '♪'); };
const coverEl = (tr, size = 44, cls = '') => tr && (tr.cover || tr.thumb) ? h('img.pl-cover' + cls, { src: tr.cover || tr.thumb, alt: '', width: size, height: size, loading: 'lazy' }) : h('span.pl-cover.ph' + cls, { style: `width:${size}px;height:${size}px` }, phMark(tr));
const kindLabel = (tr) => ({ file: t('Your file'), gen: 'Nebula Synth', radio: t('Radio'), stream: t('Stream'), spotify: 'Spotify', soundcloud: 'SoundCloud', ytmusic: 'YouTube Music' }[tr.kind] || '');

export default {
  title: () => 'Pulse',
  full: true,
  async mount(root, ctx) {
    let section = ctx.query.get('s') || 'now'; let plId = ctx.query.get('pl') || null;
    let tracks = [], pls = [], search = '', sort = ls('pulse.sort') || 'added';
    const vo = Object.assign({}, VIZ_DEF, ls('pulse.viz') || {});
    const offs = []; let viz = null;

    const side = h('nav.pl-side'); const main = h('div.pl-main'); const queueEl = h('aside.pl-queue'); const bar = h('div.pl-bar');
    const wrap = h('div.pl-wrap', h('div.pl-cols', side, main, queueEl), bar);
    mount(root, wrap);

    // ---------- data ----------
    async function reload() { [tracks, pls] = await Promise.all([lib.allTracks(), lib.playlists()]); }
    await reload();

    // ---------- sidebar ----------
    function paintSide() {
      const item = (id, ic, label, extra) => h('button.pl-nav' + (section === id && (!plId || id !== 'playlist') ? '.on' : ''), { onClick: () => { section = id; plId = null; paint(); } }, h('span.pl-ni', ic), h('span.grow.ellipsis', label), extra || null);
      mount(side,
        h('div.pl-brand', h('span.pl-logo', '◉'), h('b', 'Pulse'), h('span.pill', 'beta')),
        item('now', icon('play', 15), t('Now playing')), item('library', icon('layers', 15), t('Library'), h('span.tiny.muted', tracks.filter((x) => x.kind === 'file').length || '')), item('liked', '💜', t('Liked')),
        item('synth', icon('spark', 15), 'Nebula Synth'), item('radio', icon('wifi', 15), t('Radio')),
        h('div.pl-sh', h('span', t('Streaming'))),
        item('spotify', icon('music', 15), 'Spotify'), item('soundcloud', icon('wifi', 15), 'SoundCloud'), item('ytmusic', icon('play', 15), 'YouTube Music'),
        h('div.pl-sh', h('span', t('Playlists')), h('button.btn.ghost.icon.sm', { title: t('New playlist'), onClick: newPlaylist }, icon('plus', 15))),
        pls.map((p) => h('button.pl-nav' + (section === 'playlist' && plId === p.id ? '.on' : ''), { onClick: () => { section = 'playlist'; plId = p.id; paint(); }, onContextmenu: (e) => { e.preventDefault(); plMenu(p, e); } }, h('span.pl-ni', icon('music', 15)), h('span.grow.ellipsis', p.name), h('span.tiny.muted', p.ids.length))),
        pls.length ? null : h('p.tiny.muted', { style: 'padding:0 10px' }, t('Make playlists from your library or Nebula Synth.')),
        h('div.grow'),
        h('a.btn.block.pl-djbtn', { href: '#/dj' }, '', t('DJ mode')),
        h('div.pl-usage.tiny.muted', { id: 'pl-usage' }, ''),
      );
      lib.usage().then((u) => { const el = side.querySelector('#pl-usage'); if (el && u.quota) el.textContent = t('Stored in this browser: {n}', { n: fmt.bytes(u.used) }); });
    }

    // ---------- main sections ----------
    function paint() { paintSide(); if (viz && section !== 'now') { viz.destroy(); viz = null; } ({ now: paintNow, library: paintList, liked: paintList, playlist: paintList, synth: paintSynth, radio: paintRadio, spotify: paintSpotify, soundcloud: paintSoundcloud, ytmusic: paintYoutube }[section] || paintNow)(); }

    function paintNow() {
      const s = P.snapshot(); const tr = s.track;
      if (viz) { viz.destroy(); viz = null; }
      const cv = h('canvas.pl-viz'); const bg = h('div.pl-stagebg');
      const info = h('div.pl-info',
        h('div.pl-t', tr ? (s.now || tr.title) : t('Nothing playing')),
        h('div.pl-a', tr ? (s.now ? tr.title : (tr.artist || kindLabel(tr))) : t('Add music to your library, start a radio or compose a track with Nebula Synth.')),
        tr ? h('div.row.gap-s', { style: 'justify-content:center;margin-top:6px' }, h('span.pill', kindLabel(tr)), tr.bpm ? h('span.pill', Math.round(tr.bpm) + ' BPM') : null, s.live ? h('span.pill.bad', '● LIVE') : null) : null);
      const tools = h('div.pl-stagetools',
        segEl(SKINS.map(([id, name]) => [id, t(name)]), vo.skin, (v) => { vo.skin = v; saveViz(); viz && viz.setSkin(v); }),
        h('button.btn.sm', { onClick: customize }, icon('sliders', 15), t('Customize')),
        h('button.btn.sm.icon', { title: t('Full screen'), onClick: () => { const st = main.querySelector('.pl-stage'); if (st && st.requestFullscreen) st.requestFullscreen().catch(() => {}); } }, icon('fullscreen', 15)));
      let body;
      if (s.spotify) { const svc = { spotify: 'Spotify', soundcloud: 'SoundCloud', ytmusic: 'YouTube Music' }[s.spotify.kind] || 'Spotify'; body = h('div.pl-spot', embedFrame(s.spotify.embed, s.spotify.kind), h('p.tiny.muted', t('Playing in {s}\'s official player. Visualizers and DJ mode can only use Nebulix audio sources.', { s: svc }))); }
      else body = cv;
      const stage = h('div.pl-stage' + (vo.blur ? '.blur' : ''), bg, tools, body, info);
      if (tr && (tr.cover || tr.thumb) && vo.blur) bg.style.backgroundImage = `url("${tr.cover || tr.thumb}")`;
      mount(main, stage);
      if (!s.spotify) {
        viz = new Viz(cv, { freq: P.freq, wave: P.wave, playing: () => P.snapshot().playing, progress: () => { const x = P.snapshot(); return x.duration ? x.time / x.duration : 0; } });
        viz.setSkin(vo.skin); viz.setOpts(vo); viz.setCover(tr && (tr.cover || tr.thumb)); viz.start();
        if (tr && tr.kind === 'file' && !tr.cover) lib.getTrack(tr.id).then((full) => { if (full && full.cover && viz) { viz.setCover(full.cover); bg.style.backgroundImage = vo.blur ? `url("${full.cover}")` : ''; } });
      }
    }
    function saveViz() { ls('pulse.viz', vo); }
    function customize() {
      const c1 = h('input', { type: 'color', value: vo.c1, onInput: () => { vo.c1 = c1.value; upd(); } }); const c2 = h('input', { type: 'color', value: vo.c2, onInput: () => { vo.c2 = c2.value; upd(); } });
      const upd = () => { saveViz(); if (viz) viz.setOpts(vo); };
      const rng = (k, min, max, step) => { const i = h('input', { type: 'range', min, max, step, value: vo[k], onInput: () => { vo[k] = Number(i.value); upd(); } }); return i; };
      modal({ title: t('Customize the player'), body: h('div.col',
        settingRow(t('Colours'), t('Follow your theme, the cover art, or pick two colours.'), segEl([['theme', t('Theme')], ['cover', t('Cover art')], ['custom', t('Custom')]], vo.colors, (v) => { vo.colors = v; upd(); })),
        settingRow(t('Custom colours'), null, h('div.row', c1, c2)),
        settingRow(t('Glow'), null, rng('glow', 0, 1.5, 0.05)), settingRow(t('Sensitivity'), t('How strongly the visuals react.'), rng('sens', 0.4, 2, 0.05)),
        settingRow(t('Bars'), null, rng('bars', 32, 160, 8)),
        settingRow(t('Mirror'), null, switchEl(vo.mirror, (v) => { vo.mirror = v; upd(); })),
        settingRow(t('Show cover art'), null, switchEl(vo.cover, (v) => { vo.cover = v; upd(); })),
        settingRow(t('Blurred cover background'), null, switchEl(vo.blur, (v) => { vo.blur = v; saveViz(); if (section === 'now') paintNow(); })),
        settingRow(t('Animated wallpaper reacts to music'), t('Theme backgrounds and OS mode wallpapers pulse with the beat.'), switchEl(P.reacts(), (v) => P.setReact(v))),
      ), actions: [{ label: t('Done'), kind: 'primary' }] });
    }

    function listFor() {
      let list = section === 'liked' ? tracks.filter((x) => x.liked) : section === 'playlist' ? ((pls.find((p) => p.id === plId) || { ids: [] }).ids.map((id) => tracks.find((x) => x.id === id)).filter(Boolean)) : tracks.filter((x) => x.kind === 'file' || x.kind === 'gen');
      if (search) { const q = search.toLowerCase(); list = list.filter((x) => [x.title, x.artist, x.album, x.genre].some((v) => (v || '').toLowerCase().includes(q))); }
      if (section !== 'playlist') list = list.slice().sort((a, b) => sort === 'title' ? (a.title || '').localeCompare(b.title || '') : sort === 'artist' ? (a.artist || '').localeCompare(b.artist || '') : sort === 'plays' ? (b.plays || 0) - (a.plays || 0) : sort === 'bpm' ? (a.bpm || 999) - (b.bpm || 999) : b.added - a.added);
      return list;
    }
    function paintList() {
      const pl = section === 'playlist' ? pls.find((p) => p.id === plId) : null;
      if (section === 'playlist' && !pl) { section = 'library'; return paint(); }
      const list = listFor(); const cur = P.snapshot().track;
      const title = section === 'liked' ? t('Liked') : pl ? pl.name : t('Library');
      const searchIn = h('input.input.pl-search', { placeholder: t('Search title, artist, album…'), value: search, onInput: debounce(() => { search = searchIn.value; paintList(); setTimeout(() => { const i = main.querySelector('.pl-search'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 0); }, 180) });
      const head = h('div.pl-listhead',
        h('div.pl-hero', pl ? h('span.pl-bigemoji', icon('music', 34)) : h('span.pl-bigemoji', icon(section === 'liked' ? 'heart' : 'layers', 34)), h('div', h('h2', title), h('div.muted.small', t('{n} tracks', { n: list.length }) + ' · ' + time(list.reduce((a, x) => a + (x.duration || 0), 0))))),
        h('div.row.wrap',
          h('button.btn.primary', { disabled: !list.length, onClick: () => P.playList(list, 0) }, icon('play', 16), t('Play')),
          h('button.btn', { disabled: !list.length, onClick: () => { P.setShuffle(true); P.playList(list, Math.floor(Math.random() * list.length)); } }, '', t('Shuffle')),
          section === 'library' ? h('button.btn', { onClick: addMusic }, icon('upload', 16), t('Add music')) : null,
          pl ? h('button.btn.ghost.icon', { title: t('More'), onClick: (e) => plMenu(pl, e.currentTarget) }, icon('more', 18)) : null,
          h('div.grow'), searchIn,
          section !== 'playlist' ? h('select.select.pl-sort', { onChange: (e) => { sort = e.target.value; ls('pulse.sort', sort); paintList(); } }, [['added', t('Recently added')], ['title', t('Title')], ['artist', t('Artist')], ['plays', t('Most played')], ['bpm', 'BPM']].map(([v, l]) => h('option', { value: v, selected: v === sort }, l))) : null));
      const rows = h('div.pl-rows', list.map((tr, i) => {
        const on = cur && cur.id === tr.id;
        return h('div.pl-row' + (on ? '.on' : ''), { draggable: section === 'playlist' ? 'true' : null, dataset: { i: String(i) }, onClick: (e) => { if (e.target.closest('.pl-like, .pl-more')) return; P.playList(list, i); }, onContextmenu: (e) => { e.preventDefault(); trackMenu(tr, e, pl); } },
          h('span.pl-idx', on && P.snapshot().playing ? eqIcon() : String(i + 1)), coverEl(tr, 40),
          h('div.grow.pl-tt', h('div.ellipsis.pl-tn', tr.title), h('div.ellipsis.small.muted', tr.artist || kindLabel(tr))),
          h('span.small.muted.ellipsis.pl-alb', tr.album || ''), h('span.small.muted.pl-bpm', tr.bpm ? Math.round(tr.bpm) : ''), h('span.small.muted.pl-dur', time(tr.duration)),
          h('button.btn.ghost.icon.sm.pl-like' + (tr.liked ? '.on' : ''), { title: t('Like'), onClick: async () => { await lib.updateTrack(tr.id, { liked: !tr.liked }); } }, icon('heart', 16)),
          h('button.btn.ghost.icon.sm.pl-more', { title: t('More'), onClick: (e) => trackMenu(tr, e.currentTarget, pl) }, icon('more', 16)));
      }));
      if (section === 'playlist') dragSort(rows, async (from, to) => { const ids = pl.ids.slice(); const [x] = ids.splice(from, 1); ids.splice(to, 0, x); await lib.savePlaylist(Object.assign(pl, { ids })); });
      const empty = !list.length ? (section === 'library' && !search ? h('div.pl-drop', h('div.empty-art.ea-mark'), h('h3', t('Drop your music here')), h('p.muted', t('MP3, M4A, FLAC, OGG, WAV… Files stay in this browser — nothing is uploaded.')), h('button.btn.primary', { onClick: addMusic }, icon('upload', 16), t('Choose files'))) : emptyState('🔎', search ? t('No matches') : t('Nothing here yet'), section === 'liked' ? t('Tap the heart on any track to like it.') : section === 'playlist' ? t('Add songs from the library with the ⋯ menu.') : null)) : null;
      mount(main, h('div.pl-list', head, empty || rows));
    }
    function dragSort(container, onMove) {
      let from = -1;
      container.addEventListener('dragstart', (e) => { const r = e.target.closest('.pl-row, .pl-q'); if (!r) return; from = Number(r.dataset.i); e.dataTransfer.effectAllowed = 'move'; r.classList.add('drag'); });
      container.addEventListener('dragover', (e) => { if (from < 0) return; e.preventDefault(); const r = e.target.closest('.pl-row, .pl-q'); container.querySelectorAll('.dropat').forEach((x) => x.classList.remove('dropat')); if (r) r.classList.add('dropat'); });
      container.addEventListener('drop', (e) => { e.preventDefault(); const r = e.target.closest('.pl-row, .pl-q'); const to = r ? Number(r.dataset.i) : -1; if (from >= 0 && to >= 0 && to !== from) onMove(from, to); from = -1; });
      container.addEventListener('dragend', () => { from = -1; container.querySelectorAll('.drag, .dropat').forEach((x) => x.classList.remove('drag', 'dropat')); });
    }
    function trackMenu(tr, anchor, pl) {
      openMenu([
        { label: t('Play next'), icon: 'play', onClick: () => { P.enqueue(tr, true); toast(t('Playing next: {t}', { t: tr.title })); } },
        { label: t('Add to queue'), icon: 'plus', onClick: () => { P.enqueue(tr); toast(t('Added to queue')); } },
        { label: t('Add to playlist…'), icon: 'layers', onClick: () => pickPlaylist([tr.id]) },
        { label: t('Load on deck A'), icon: 'sliders', onClick: () => ctx.go('dj', { load: tr.id, deck: 'A' }) },
        { label: t('Load on deck B'), icon: 'sliders', onClick: () => ctx.go('dj', { load: tr.id, deck: 'B' }) },
        { hr: true },
        tr.kind === 'file' ? { label: t('Edit info'), icon: 'edit', onClick: () => editInfo(tr) } : null,
        tr.kind === 'gen' ? { label: t('Download WAV'), icon: 'download', onClick: () => downloadGen(tr) } : null,
        tr.kind === 'gen' ? { label: t('Copy recipe code'), icon: 'copy', onClick: () => copyRecipe(tr.recipe) } : null,
        pl ? { label: t('Remove from playlist'), icon: 'x', onClick: () => lib.savePlaylist(Object.assign(pl, { ids: pl.ids.filter((x) => x !== tr.id) })) } : null,
        { label: t('Remove from library'), icon: 'trash', danger: true, onClick: async () => { if (await confirmBox(t('Remove "{t}" from this browser?', { t: tr.title }), { danger: true, ok: t('Remove') })) lib.removeTrack(tr.id); } },
      ], anchor);
    }
    async function editInfo(tr) {
      const f = (k, label) => h('div.field', h('label', label), h('input.input', { value: tr[k] || '', dataset: { k } }));
      const body = h('div.col', f('title', t('Title')), f('artist', t('Artist')), f('album', t('Album')), f('bpm', 'BPM'));
      const ok = await modal({ title: t('Edit info'), body, actions: [{ label: t('Cancel'), value: false }, { label: t('Save'), kind: 'primary', value: true }] });
      if (!ok) return; const patch = {}; body.querySelectorAll('input').forEach((i) => { patch[i.dataset.k] = i.value.trim().slice(0, 200); });
      patch.bpm = parseFloat(patch.bpm) > 40 && parseFloat(patch.bpm) < 260 ? parseFloat(patch.bpm) : undefined; patch.bpmSet = !!patch.bpm;
      if (!patch.title) patch.title = tr.title; await lib.updateTrack(tr.id, patch);
    }
    async function pickPlaylist(ids) {
      const list = await lib.playlists();
      const body = h('div.col', list.map((p) => h('button.btn.block', { style: 'justify-content:flex-start', onClick: async () => { await lib.addToPlaylist(p.id, ids); m.close(); toast(t('Added to {p}', { p: p.name }), 'good'); } }, (p.emoji || '🎧') + ' ' + p.name)), h('button.btn.primary.block', { onClick: async () => { m.close(); const p = await newPlaylist(); if (p) { await lib.addToPlaylist(p.id, ids); toast(t('Added to {p}', { p: p.name }), 'good'); } } }, icon('plus', 15), t('New playlist')));
      const m = modal({ title: t('Add to playlist'), body, cls: 'narrow' });
    }
    async function newPlaylist() {
      const name = await promptBox(t('New playlist'), { label: t('Name'), placeholder: t('My mix'), validate: (v) => (v.trim().length < 1 || v.length > 40 ? t('1-40 characters') : null) });
      if (!name) return null; const p = await lib.savePlaylist({ name: name.trim(), emoji: ['🎧', '🔥', '🌙', '🚀', '💜', '🎮', '🌊', '⚡'][Math.floor(Math.random() * 8)] }); section = 'playlist'; plId = p.id; return p;
    }
    function plMenu(p, anchor) {
      openMenu([
        { label: t('Rename'), icon: 'edit', onClick: async () => { const n = await promptBox(t('Rename playlist'), { value: p.name, validate: (v) => (v.trim().length < 1 || v.length > 40 ? t('1-40 characters') : null) }); if (n) lib.savePlaylist(Object.assign(p, { name: n.trim() })); } },
        { label: t('Change emoji'), icon: 'smile', onClick: async () => { const e = await promptBox(t('Playlist emoji'), { value: p.emoji || '🎧' }); if (e) lib.savePlaylist(Object.assign(p, { emoji: [...e.trim()].slice(0, 2).join('') || '🎧' })); } },
        { label: t('Export (song list)'), icon: 'download', onClick: () => download(`${p.name}.json`, JSON.stringify({ nebulix: 'playlist', name: p.name, tracks: p.ids.map((id) => tracks.find((x) => x.id === id)).filter(Boolean).map((x) => ({ title: x.title, artist: x.artist, album: x.album, recipe: x.recipe })) }, null, 2)) },
        { hr: true },
        { label: t('Delete playlist'), icon: 'trash', danger: true, onClick: async () => { if (await confirmBox(t('Delete the playlist "{p}"? The songs stay in your library.', { p: p.name }), { danger: true, ok: t('Delete') })) { await lib.deletePlaylist(p.id); if (plId === p.id) { section = 'library'; plId = null; } } } },
      ], anchor);
    }
    async function addMusic() {
      const inp = h('input', { type: 'file', multiple: true, accept: 'audio/*,.mp3,.m4a,.flac,.ogg,.opus,.wav,.webm', style: 'display:none' });
      inp.onchange = () => { importFiles(inp.files); inp.remove(); }; document.body.appendChild(inp); inp.click();
    }
    async function importFiles(files) {
      const list = [...files].filter(lib.isAudio); if (!list.length) { toast(t('Those are not audio files'), 'err'); return; }
      const tst = h('div.small'); const m = modal({ title: t('Adding music…'), body: h('div.col', loading(), tst), dismissable: false });
      try { const added = await lib.addFiles(list, (i, n, name) => { tst.textContent = `${i + 1}/${n} · ${name}`; }); m.close(); toast(added.length === 1 ? t('1 song added') : t('{n} songs added', { n: added.length }), 'good'); if (added.length < list.length) toast(t('Some files could not be read by your browser.'), 'err'); }
      catch (e) { m.close(); toastErr(e); }
    }

    // ---------- Nebula Synth ----------
    async function paintSynth() {
      const G = await import('../pulse/gen.js'); if (section !== 'synth') return;
      const o = Object.assign({ style: 'synthwave', length: 'normal', bpm: 0, root: -1, seed: G.newSeed() }, ls('pulse.synth') || {});
      const save = () => ls('pulse.synth', o);
      const seedIn = h('input.input.mono', { value: String(o.seed), style: 'width:140px', onChange: () => { o.seed = (parseInt(seedIn.value, 10) >>> 0) || 1; save(); } });
      const bpmOut = h('span.mono'); const bpmIn = h('input', { type: 'range', min: 0, max: 1, step: 0.01 });
      const syncBpm = () => { const st = G.STYLES[o.style]; bpmIn.min = st.bpm[0]; bpmIn.max = st.bpm[1]; bpmIn.step = 1; bpmIn.value = o.bpm || Math.round((st.bpm[0] + st.bpm[1]) / 2); bpmOut.textContent = o.bpm ? o.bpm + ' BPM' : t('Auto'); };
      bpmIn.oninput = () => { o.bpm = Number(bpmIn.value); save(); bpmOut.textContent = o.bpm + ' BPM'; };
      const styles = h('div.syn-styles', Object.entries(G.STYLES).map(([id, s]) => h('button.syn-style' + (o.style === id ? '.on' : ''), { style: `--h:${s.hue}`, onClick: (e) => { o.style = id; o.bpm = 0; save(); styles.querySelectorAll('.syn-style').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); syncBpm(); } }, h('span.syn-e', icon('music', 18)), h('b', t(s.name)), h('span.tiny.muted', `${s.bpm[0]}–${s.bpm[1]} BPM`))));
      const keySel = h('select.select', { style: 'width:auto', onChange: () => { o.root = Number(keySel.value); save(); } }, h('option', { value: -1 }, t('Auto')), ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map((k, i) => h('option', { value: i, selected: o.root === i }, k)));
      const recent = h('div.syn-recent');
      const recipe = () => G.recipeFor(o.style, o.seed, { bpm: o.bpm || undefined, root: o.root >= 0 ? o.root : undefined, length: o.length });
      const go = async (btn, n = 1) => {
        const list = []; for (let i = 0; i < n; i++) { const rc = G.recipeFor(o.style, (o.seed + i) >>> 0, { bpm: o.bpm || undefined, root: o.root >= 0 ? o.root : undefined, length: o.length }); list.push(G.trackFor(rc)); }
        btn.disabled = true; const label = btn.textContent; btn.textContent = t('Composing…');
        try { P.enqueue(list, true); const s = P.snapshot(); const i = s.queue.findIndex((x) => x.id === list[0].id); P.jump(i); remember(list); } finally { setTimeout(() => { btn.disabled = false; btn.textContent = label; }, 800); }
      };
      const remember = (list) => { const r = ls('pulse.synthRecent') || []; for (const tr of list) { const i = r.findIndex((x) => x.id === tr.id); if (i >= 0) r.splice(i, 1); r.unshift({ id: tr.id, recipe: tr.recipe }); } ls('pulse.synthRecent', r.slice(0, 12)); paintRecent(); };
      const paintRecent = () => {
        const r = ls('pulse.synthRecent') || [];
        mount(recent, r.length ? r.map((x) => { const tr = G.trackFor(x.recipe); const saved = tracks.some((y) => y.id === tr.id); return h('div.syn-card', h('img', { src: tr.cover, alt: '' }), h('div.grow', h('b.ellipsis', tr.title), h('div.tiny.muted', `${t(G.STYLES[tr.recipe.style].name)} · ${tr.recipe.bpm} BPM · ${G.keyName(tr.recipe)}`)),
          h('div.row.gap-s', h('button.btn.sm.icon', { title: t('Play'), onClick: () => P.playOne(tr) }, icon('play', 14)), h('button.btn.sm.icon' + (saved ? '.on' : ''), { title: saved ? t('In your library') : t('Save to library'), onClick: async () => { if (!saved) { await lib.addTrack(tr); toast(t('Saved to your library'), 'good'); } } }, icon(saved ? 'check' : 'plus', 14)), h('button.btn.sm.icon', { title: t('More'), onClick: (e) => trackMenu(tr, e.currentTarget) }, icon('more', 14)))); }) : h('p.muted.small', t('Your compositions will show up here.')));
      };
      const composeBtn = h('button.btn.primary.lg', { onClick: (e) => go(e.currentTarget, 1) }, '', t('Compose & play'));
      mount(main, h('div.pl-list',
        h('div.syn-hero', h('div', h('h2', 'Nebula Synth'), h('p.muted', t('Original music composed live in your browser from a seed — drums, bass, chords and melodies. Every seed is a new song, and it is yours to use.')))),
        h('div.card', h('h3', t('Style')), styles,
          h('div.syn-opts',
            h('div.field', h('label', t('Length')), segEl([['short', t('Short')], ['normal', t('Normal')], ['long', t('Long')]], o.length, (v) => { o.length = v; save(); })),
            h('div.field', h('label', t('Tempo')), h('div.row', bpmIn, bpmOut, h('button.btn.ghost.sm', { onClick: () => { o.bpm = 0; save(); syncBpm(); } }, t('Auto')))),
            h('div.field', h('label', t('Key')), keySel),
            h('div.field', h('label', t('Seed')), h('div.row', seedIn, h('button.btn.icon', { title: t('Random seed'), onClick: () => { o.seed = G.newSeed(); seedIn.value = String(o.seed); save(); } }, '🎲')))),
          h('div.row.wrap', { style: 'margin-top:14px' }, composeBtn, h('button.btn', { onClick: (e) => { go(e.currentTarget, 5); } }, '', t('Compose an album (5)')),
            h('button.btn', { onClick: () => copyRecipe(recipe()) }, icon('copy', 15), t('Share recipe')), h('button.btn.ghost', { onClick: importRecipe }, t('Import recipe')))),
        h('div.card', h('h3', t('Recent compositions')), recent)));
      syncBpm(); paintRecent();
    }
    function copyRecipe(rc) { const code = 'NBXS1.' + btoa(JSON.stringify(rc)).replace(/=+$/, ''); copyText(code).then(() => toast(t('Recipe copied — anyone can paste it into Nebula Synth to hear the same song.'), 'good')); }
    async function importRecipe() {
      const v = await promptBox(t('Import recipe'), { label: t('Paste a recipe code'), placeholder: 'NBXS1.…' }); if (!v) return;
      try { const G = await import('../pulse/gen.js'); const j = JSON.parse(atob(v.trim().replace(/^NBXS1\./, ''))); const rc = G.recipeFor(j.style, j.seed >>> 0, { bpm: j.bpm, root: j.root, length: j.length }); P.playOne(G.trackFor(rc)); } catch { toast(t('That recipe code is not valid'), 'err'); }
    }
    async function downloadGen(tr) {
      const m = modal({ title: t('Rendering…'), body: loading(t('Composing the WAV file')), dismissable: false });
      try { const G = await import('../pulse/gen.js'); const { blob } = await G.renderBlob(tr.recipe); m.close(); const url = URL.createObjectURL(blob); const a = h('a', { href: url, download: `${tr.title} (Nebula Synth).wav` }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000); }
      catch (e) { m.close(); toastErr(e); }
    }

    // ---------- radio ----------
    async function paintRadio() {
      mount(main, loading());
      let stations = []; try { stations = (await api.get('/api/music/stations')).stations; } catch (e) { if (section === 'radio') mount(main, emptyState('📻', t('Radio is unavailable'), e.message)); return; }
      if (section !== 'radio') return;
      const custom = ls('pulse.stations') || [];
      const cur = P.snapshot().track;
      const card = (s, kind) => h('button.rd-card' + (cur && ((cur.kind === 'radio' && cur.station === s.id) || (cur.kind === 'stream' && cur.url === s.url)) ? '.on' : ''), { style: `--c:${s.color || '#8b5cf6'}`, onClick: () => P.playOne(kind === 'radio' ? { id: 'radio-' + s.id, kind: 'radio', station: s.id, title: s.name, artist: s.genre, color: s.color } : { id: 'stream-' + s.url, kind: 'stream', url: s.url, title: s.name, artist: t('Custom stream') }), onContextmenu: kind === 'stream' ? (e) => { e.preventDefault(); openMenu([{ label: t('Remove station'), icon: 'trash', danger: true, onClick: () => { ls('pulse.stations', custom.filter((x) => x.url !== s.url)); paintRadio(); } }], e); } : null },
        h('span.rd-wave', h('i'), h('i'), h('i'), h('i')), h('b.ellipsis', s.name), h('span.small.muted.ellipsis', s.genre || t('Custom stream')), s.now ? h('span.tiny.ellipsis.rd-now', s.now) : null);
      const urlIn = h('input.input', { placeholder: 'https://… (Icecast / Shoutcast / MP3 / AAC)' }); const nameIn = h('input.input', { placeholder: t('Station name'), style: 'max-width:200px' });
      mount(main, h('div.pl-list',
        h('div.syn-hero', h('div', h('h2', t('Radio')), h('p.muted', t('Live internet radio, streamed through Nebulix so the visualizers and the equalizer can react to it.')))),
        h('div.rd-grid', stations.map((s) => card(s, 'radio'))),
        h('div.card', { style: 'margin-top:16px' }, h('h3', t('Your own stream')), h('p.small.muted', t('Paste the direct address of any internet radio stream.')),
          h('div.row.wrap', nameIn, urlIn, h('button.btn.primary', { onClick: () => { const url = urlIn.value.trim(); if (!/^https?:\/\//i.test(url)) return toast(t('Use an http(s) stream address'), 'err'); const s = { name: nameIn.value.trim().slice(0, 40) || t('My station'), url }; ls('pulse.stations', [s, ...custom.filter((x) => x.url !== url)].slice(0, 20)); P.playOne({ id: 'stream-' + url, kind: 'stream', url, title: s.name, artist: t('Custom stream') }); paintRadio(); } }, icon('play', 15), t('Play'))),
          custom.length ? h('div.rd-grid', { style: 'margin-top:12px' }, custom.map((s) => card(s, 'stream'))) : null),
        h('p.tiny.muted', { style: 'margin-top:10px' }, t('Stations: Nightride FM and SomaFM — listener-supported radio. Visit their sites to support them.'))));
    }

    // ---------- external players (Spotify / SoundCloud / YouTube Music) ----------
    function embedFrame(embed, kind, compact) {
      const src = kind === 'spotify' ? embed + '?utm_source=nebulix&theme=0' : embed;
      const title = { spotify: 'Spotify', soundcloud: 'SoundCloud', ytmusic: 'YouTube Music' }[kind] || 'Player';
      const tall = kind === 'ytmusic';
      return h('iframe.pl-spframe' + (tall ? '.pl-ytframe' : ''), { src, allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture', loading: 'lazy', title, style: compact ? 'height:' + (tall ? '200px' : '152px') : null, referrerpolicy: 'strict-origin-when-cross-origin' });
    }
    function spotifyFrame(embed, compact) { return embedFrame(embed, 'spotify', compact); }
    // Reusable "paste a link → play in official embed" section builder.
    function paintEmbedService({ kind, name, api: apiPath, blurb, placeholder, example, idFor, titleFor }) {
      const saved = tracks.filter((x) => x.kind === kind);
      const inp = h('input.input', { placeholder });
      const add = async (btn) => {
        const url = inp.value.trim(); if (!url) return;
        btn.disabled = true;
        try {
          const r = await api.get(apiPath + '?url=' + encodeURIComponent(url));
          const tr = { id: idFor(r), kind, embed: r.embed, title: titleFor(r), artist: r.author || name, thumb: r.thumb || null };
          if (!tracks.some((x) => x.id === tr.id)) await lib.addTrack(tr);
          P.playOne(tr); inp.value = ''; section = 'now'; paint();
        } catch (e) { toastErr(e); } finally { btn.disabled = false; }
      };
      mount(main, h('div.pl-list',
        h('div.syn-hero', h('div', h('h2', name), h('p.muted', blurb))),
        h('div.card', h('div.row', inp, h('button.btn.primary', { onClick: (e) => add(e.currentTarget) }, icon('play', 15), t('Open'))),
          example ? h('p.tiny.muted', { style: 'margin-top:8px' }, example) : null),
        h('h3', { style: 'margin-top:16px' }, t('Saved links')),
        saved.length ? h('div.sp-grid', saved.map((tr) => h('div.sp-card', coverEl(tr, 56), h('div.grow', h('b.ellipsis', tr.title), h('div.tiny.muted', tr.artist || name)), h('button.btn.sm.icon', { title: t('Play'), onClick: () => { P.playOne(tr); section = 'now'; paint(); } }, icon('play', 14)), h('button.btn.sm.icon.ghost', { title: t('Remove'), onClick: () => lib.removeTrack(tr.id) }, icon('trash', 14))))) : h('p.muted.small', t('Links you open are saved here.'))));
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const b = e.target.parentNode.querySelector('.btn.primary'); if (b) add(b); } });
    }
    function paintSoundcloud() {
      paintEmbedService({ kind: 'soundcloud', name: 'SoundCloud', api: '/api/music/soundcloud',
        blurb: t('Paste a SoundCloud track, set or artist link. It plays in SoundCloud\'s official widget inside Pulse.'),
        placeholder: 'https://soundcloud.com/artist/track', example: t('Tracks, playlists (sets) and profiles all work.'),
        idFor: (r) => 'sc-' + r.url, titleFor: (r) => r.title || 'SoundCloud' });
    }
    function paintYoutube() {
      paintEmbedService({ kind: 'ytmusic', name: 'YouTube Music', api: '/api/music/youtube',
        blurb: t('Paste a YouTube Music or YouTube link (song, video or playlist). It plays in YouTube\'s official player inside Pulse.'),
        placeholder: 'https://music.youtube.com/watch?v=…', example: t('music.youtube.com, youtube.com and youtu.be links all work.'),
        idFor: (r) => 'yt-' + r.type + '-' + (r.v || r.list), titleFor: (r) => r.title || (r.type === 'playlist' ? 'YouTube playlist' : 'YouTube Music') });
    }
    async function paintSpotify() {
      const saved = tracks.filter((x) => x.kind === 'spotify');
      const inp = h('input.input', { placeholder: 'https://open.spotify.com/track/…' });
      const prev = h('div');
      const add = async (btn) => {
        const url = inp.value.trim(); if (!url) return;
        btn.disabled = true;
        try {
          const r = await api.get('/api/music/spotify?url=' + encodeURIComponent(url));
          const tr = { id: 'sp-' + r.type + '-' + r.id, kind: 'spotify', embed: r.embed, title: r.title || `Spotify ${r.type}`, artist: 'Spotify', thumb: r.thumb || null, genre: r.type };
          if (!tracks.some((x) => x.id === tr.id)) await lib.addTrack(tr);
          P.playOne(tr); inp.value = ''; section = 'now'; paint();
        } catch (e) { toastErr(e); } finally { btn.disabled = false; }
      };
      mount(main, h('div.pl-list',
        h('div.syn-hero', h('div', h('h2', 'Spotify'), h('p.muted', t('Paste a Spotify link (song, album, playlist, artist or podcast). It plays in Spotify\'s official player inside Pulse — log in to Spotify in the player for full songs.')))),
        h('div.card', h('div.row', inp, h('button.btn.primary', { onClick: (e) => add(e.currentTarget) }, icon('play', 15), t('Open'))), prev,
          h('p.tiny.muted', { style: 'margin-top:8px' }, t('Spotify audio is protected, so it cannot be mixed in DJ mode or shown in visualizers. Use your own files or Nebula Synth for that.'))),
        h('h3', { style: 'margin-top:16px' }, t('Saved links')),
        saved.length ? h('div.sp-grid', saved.map((tr) => h('div.sp-card', coverEl(tr, 56), h('div.grow', h('b.ellipsis', tr.title), h('div.tiny.muted', tr.genre || 'Spotify')), h('button.btn.sm.icon', { title: t('Play'), onClick: () => { P.playOne(tr); section = 'now'; paint(); } }, icon('play', 14)), h('button.btn.sm.icon.ghost', { title: t('Remove'), onClick: () => lib.removeTrack(tr.id) }, icon('trash', 14))))) : h('p.muted.small', t('Links you open are saved here.'))));
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(e.target.nextSibling || e.target); });
    }

    // ---------- queue ----------
    function paintQueue() {
      const s = P.snapshot();
      const list = h('div.pl-qlist', s.queue.map((tr, i) => h('div.pl-q' + (i === s.index ? '.on' : '') + (i < s.index ? '.past' : ''), { draggable: 'true', dataset: { i: String(i) }, onClick: (e) => { if (e.target.closest('button')) return; P.jump(i); } },
        coverEl(tr, 34), h('div.grow', h('div.ellipsis.small', { style: 'font-weight:600' }, tr.title), h('div.ellipsis.tiny.muted', tr.artist || kindLabel(tr))),
        h('button.btn.ghost.icon.sm', { title: t('Remove'), onClick: () => P.removeAt(i) }, icon('x', 13)))));
      dragSort(list, (from, to) => P.move(from, to));
      mount(queueEl, h('div.pl-qhead', h('b', t('Up next')), h('span.tiny.muted', s.queue.length ? `${s.index + 1}/${s.queue.length}` : ''), h('div.grow'),
        s.queue.length ? h('button.btn.ghost.sm', { title: t('Save as playlist'), onClick: async () => { const p = await newPlaylist(); if (p) { const ids = s.queue.filter((x) => x.kind === 'file' || x.kind === 'gen').map((x) => x.id); for (const x of s.queue) if (x.kind === 'gen' && !tracks.some((y) => y.id === x.id)) await lib.addTrack(x); await lib.addToPlaylist(p.id, ids); } } }, icon('bookmark', 14)) : null,
        s.queue.length ? h('button.btn.ghost.sm', { title: t('Clear queue'), onClick: () => P.clearQueue() }, icon('trash', 14)) : null),
      s.queue.length ? list : h('p.tiny.muted', { style: 'padding:10px' }, t('Songs you play appear here. Drag to reorder.')));
      const on = list.querySelector('.pl-q.on'); if (on) on.scrollIntoView({ block: 'nearest' });
    }

    // ---------- transport bar ----------
    const seekIn = h('input.pl-seek', { type: 'range', min: 0, max: 1000, value: 0, 'aria-label': t('Seek') });
    const tCur = h('span.mono.tiny'), tDur = h('span.mono.tiny');
    let seeking = false;
    seekIn.addEventListener('input', () => { seeking = true; const s = P.snapshot(); tCur.textContent = time(seekIn.value / 1000 * s.duration); });
    seekIn.addEventListener('change', () => { const s = P.snapshot(); P.seek(seekIn.value / 1000 * s.duration); seeking = false; });
    const volIn = h('input.pl-vol', { type: 'range', min: 0, max: 1, step: 0.01, value: P.snapshot().volume, 'aria-label': t('Volume'), onInput: () => P.setVolume(Number(volIn.value)) });
    function paintBar() {
      const s = P.snapshot(); const tr = s.track;
      const playBtn = h('button.pl-play', { title: t('Play / pause (Space)'), onClick: () => P.toggle(), disabled: !s.queue.length || !!s.spotify }, s.buffering ? h('span.spinner', { style: 'width:20px;height:20px;border-width:3px;border-top-color:#fff' }) : icon(s.playing ? 'pause' : 'play', 22));
      mount(bar,
        h('div.pl-now', tr ? coverEl(tr, 48) : null, h('div.grow', h('div.ellipsis.pl-bt', tr ? (s.now || tr.title) : 'Pulse'), h('div.ellipsis.tiny.muted', tr ? (s.now ? tr.title : tr.artist || kindLabel(tr)) : t('Ready when you are'))),
          tr && (tr.kind === 'file' || tr.kind === 'gen') ? h('button.btn.ghost.icon.sm.pl-like' + (tracks.find((x) => x.id === tr.id && x.liked) ? '.on' : ''), { title: t('Like'), onClick: async () => { const full = tracks.find((x) => x.id === tr.id); if (full) await lib.updateTrack(tr.id, { liked: !full.liked }); else if (tr.kind === 'gen') { await lib.addTrack(Object.assign({}, tr, { liked: true })); } } }, icon('heart', 16)) : null),
        h('div.pl-ctl',
          h('div.row.gap-s', { style: 'justify-content:center' },
            h('button.btn.ghost.icon.sm' + (s.shuffle ? '.on' : ''), { title: t('Shuffle'), onClick: () => P.setShuffle(!s.shuffle) }, icon('shuffle', 16)),
            h('button.btn.ghost.icon', { title: t('Previous'), onClick: () => P.prev() }, icon('back', 18)), playBtn,
            h('button.btn.ghost.icon', { title: t('Next'), onClick: () => P.next() }, icon('fwd', 18)),
            h('button.btn.ghost.icon.sm' + (s.repeat !== 'off' ? '.on' : ''), { title: t('Repeat: {m}', { m: { off: t('off'), all: t('all'), one: t('one') }[s.repeat] }), onClick: () => P.cycleRepeat() }, s.repeat === 'one' ? '🔂' : '🔁')),
          h('div.row.gap-s.pl-seekrow', tCur, s.live ? h('div.pl-live', h('span'), t('Live')) : seekIn, tDur)),
        h('div.pl-right',
          h('button.btn.ghost.sm' + (s.eqOn && s.eqPreset !== 'flat' ? '.on' : ''), { title: t('Equalizer'), onClick: openEq }, 'EQ'),
          h('button.btn.ghost.sm' + (s.spatial === '8d' ? '.on' : ''), { title: t('8D audio (use headphones)'), onClick: () => { P.setSpatial(s.spatial === '8d' ? 'off' : '8d'); if (s.spatial !== '8d') toast(t('8D audio on — best with headphones')); } }, '8D'),
          h('button.btn.ghost.sm' + (s.sleepAt || s.sleepEnd ? '.on' : ''), { title: t('Sleep timer'), onClick: (e) => sleepMenu(e.currentTarget) }, icon('moon', 16)),
          h('button.btn.ghost.sm', { title: t('Speed'), onClick: (e) => speedMenu(e.currentTarget) }, (s.rate === 1 ? '1×' : s.rate + '×')),
          h('button.btn.ghost.icon.sm', { title: s.muted ? t('Unmute') : t('Mute'), onClick: () => P.setMuted(!s.muted) }, icon('volume', 17)), volIn));
      volIn.value = s.muted ? 0 : s.volume; tick();
    }
    function tick() { const s = P.snapshot(); if (!seeking) { seekIn.value = s.duration ? Math.round(s.time / s.duration * 1000) : 0; tCur.textContent = time(s.time); } tDur.textContent = s.live ? '' : time(s.duration); }
    function sleepMenu(anchor) {
      const s = P.snapshot();
      openMenu([s.sleepAt || s.sleepEnd ? { label: t('Turn off sleep timer') + (s.sleepAt ? ` (${Math.ceil((s.sleepAt - Date.now()) / 60000)} min)` : ''), icon: 'x', onClick: () => P.sleep(0) } : null, ...[15, 30, 45, 60, 90].map((m) => ({ label: t('{n} minutes', { n: m }), icon: 'moon', onClick: () => { P.sleep(m); toast(t('Music stops in {n} minutes', { n: m })); } })), { label: t('End of this track'), icon: 'moon', onClick: () => P.sleep('track') }], anchor);
    }
    function speedMenu(anchor) { openMenu([0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2].map((r) => ({ label: (r === 1 ? t('Normal') : r + '×'), icon: P.snapshot().rate === r ? 'check' : null, onClick: () => P.setRate(r) })), anchor); }
    function openEq() {
      const s = P.snapshot(); const sliders = [];
      const presetSel = h('select.select', { style: 'width:auto', onChange: () => { P.setEqPreset(presetSel.value); const x = P.snapshot(); sliders.forEach((sl, i) => { sl.value = x.eq[i]; }); preIn.value = x.preamp; } }, Object.keys(P.EQ_NAMES).map((k) => h('option', { value: k, selected: k === s.eqPreset, disabled: k === 'custom' }, t(P.EQ_NAMES[k]))));
      const preIn = h('input.eq-v', { type: 'range', min: -12, max: 6, step: 0.5, value: s.preamp, onInput: () => P.setPreamp(Number(preIn.value)) });
      const bands = h('div.eq-bands', h('div.eq-band', preIn, h('span.tiny', t('Pre'))), P.BANDS.map((f, i) => { const sl = h('input.eq-v', { type: 'range', min: -12, max: 12, step: 0.5, value: s.eq[i], onInput: () => { const g = P.snapshot().eq.slice(); g[i] = Number(sl.value); P.setEq(g, 'custom'); presetSel.value = 'custom'; } }); sliders.push(sl); return h('div.eq-band', sl, h('span.tiny', f >= 1000 ? f / 1000 + 'k' : f)); }));
      modal({ title: t('Equalizer'), cls: 'wide', body: h('div.col', h('div.row.wrap', presetSel, h('div.grow'), h('span.small', t('EQ on')), switchEl(s.eqOn, (v) => P.setEqOn(v))), bands,
        settingRow(t('Loudness boost'), t('Evens out quiet and loud parts and adds volume headroom.'), switchEl(s.loud, (v) => P.setLoud(v)))), actions: [{ label: t('Reset'), onClick: () => { P.setEqPreset('flat'); sliders.forEach((sl) => { sl.value = 0; }); preIn.value = 0; presetSel.value = 'flat'; return false; } }, { label: t('Done'), kind: 'primary' }] });
    }

    // ---------- keyboard & drop ----------
    const isFocused = () => { const w = root.closest('.os-win'); return !w || w.classList.contains('focused'); };
    const onKey = (e) => {
      if (!root.isConnected || !isFocused() || e.target.closest('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Space') { e.preventDefault(); P.toggle(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); e.shiftKey ? P.next() : P.seekRel(5); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.shiftKey ? P.prev() : P.seekRel(-5); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); P.setVolume(P.snapshot().volume + 0.05); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); P.setVolume(P.snapshot().volume - 0.05); }
      else if (e.key.toLowerCase() === 'm') P.setMuted(!P.snapshot().muted);
    };
    document.addEventListener('keydown', onKey);
    root.addEventListener('dragover', (e) => { if ([...(e.dataTransfer.types || [])].includes('Files')) { e.preventDefault(); wrap.classList.add('dropping'); } });
    root.addEventListener('dragleave', (e) => { if (e.target === root || !root.contains(e.relatedTarget)) wrap.classList.remove('dropping'); });
    root.addEventListener('drop', (e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); wrap.classList.remove('dropping'); importFiles(e.dataTransfer.files); });

    // ---------- live updates ----------
    let lastTrackKey = '', barKey = '', queueKey = '';
    offs.push(bus.on('pulse', (s) => {
      const key = (s.track ? s.track.kind + ':' + s.track.id : '') + '|' + (s.spotify ? 1 : 0);
      const bk = [key, s.playing, s.buffering, s.shuffle, s.repeat, s.eqOn, s.eqPreset, s.spatial, s.sleepAt, s.sleepEnd, s.rate, s.muted, s.live, s.now].join('|');
      if (bk !== barKey) { barKey = bk; paintBar(); } else volIn.value = s.muted ? 0 : s.volume;
      const qk = s.index + ':' + s.queue.map((x) => x.id).join(',');
      if (qk !== queueKey) { queueKey = qk; paintQueue(); }
      if (key !== lastTrackKey) { lastTrackKey = key; if (section === 'now') paintNow(); else if (['library', 'liked', 'playlist'].includes(section)) paintList(); }
      else if (section === 'now') { const ti = main.querySelector('.pl-t'); if (ti && s.track) ti.textContent = s.now || s.track.title; }
      else if (['library', 'liked', 'playlist'].includes(section)) main.querySelectorAll('.pl-row').forEach((r) => { const idx = r.querySelector('.pl-idx'); if (r.classList.contains('on') && idx) mount(idx, s.playing ? eqIcon() : String(Number(r.dataset.i) + 1)); });
    }));
    offs.push(bus.on('pulse:time', () => tick()));
    offs.push(bus.on('pulse:library', async () => { await reload(); paintSide(); if (['library', 'liked', 'playlist', 'spotify', 'soundcloud', 'ytmusic'].includes(section)) paint(); paintBar(); }));
    offs.push(bus.on('pulse:error', (msg) => toast(msg, 'err')));
    offs.push(bus.on('pulse:composing', (x) => {
      const el = main.querySelector('.pl-info .pl-a'); if (x.on && !x.p) toast(t('Nebula Synth is composing your track…'), 'info', 2500);
      if (el) el.textContent = x.on ? t('Composing… {p}%', { p: Math.round((x.p || 0) * 100) }) : (P.snapshot().track ? P.snapshot().track.artist || '' : '');
      const bt = bar.querySelector('.pl-now .tiny'); if (bt && x.on) bt.textContent = t('Composing… {p}%', { p: Math.round((x.p || 0) * 100) });
    }));
    lastTrackKey = (P.snapshot().track ? P.snapshot().track.kind + ':' + P.snapshot().track.id : '') + '|' + (P.snapshot().spotify ? 1 : 0);
    paint(); paintBar(); paintQueue();
    return () => { offs.forEach((f) => f()); document.removeEventListener('keydown', onKey); if (viz) viz.destroy(); };
  },
};

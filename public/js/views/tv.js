// Nebulix TV: community channels for long videos. #/tv · #/tv/subs · #/tv/trending · #/tv/mine · #/tv/later · #/tv/w/<id> · #/tv/c/<name> · #/tv?q=
// Nebulix 9.2: hover previews, watch progress and "continue watching", search filters, a player with speed / theater /
// loop / picture-in-picture / keyboard shortcuts, chapters, resume, watch later and thumbnails the creator can change.
import { h, mount, fmt, ls } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, emptyState, busy, confirmBox, modal, openMenu, field } from '../ui.js';
import { avatarEl, nameEl, bannerEl } from '../cosmetics.js';
import { richText, followBtn, commentsPanel, uploadVideo, durTxt, chaptersFrom, framesOf, parseTime } from '../media.js';
import { putFile } from './hub.js';

// watch progress lives in this browser: { id: { t: seconds, d: duration, at: time, title, thumb, owner } }
const prog = () => ls('tv.progress') || {};
const saveProg = (id, sec, dur, meta) => { const p = prog(); if (dur && sec > dur - 8) delete p[id]; else p[id] = Object.assign({}, p[id] || {}, meta || {}, { t: Math.floor(sec), d: Math.floor(dur || 0), at: Date.now() }); const keys = Object.keys(p).sort((a, b) => p[b].at - p[a].at); for (const k of keys.slice(60)) delete p[k]; ls('tv.progress', p); };

export default {
  title: () => 'Nebulix TV',
  async mount(root, ctx) {
    const [a, b] = ctx.params;
    const page = a === 'w' ? 'watch' : a === 'c' ? 'channel' : ['subs', 'trending', 'mine', 'later'].includes(a) ? a : 'home';
    const q = ctx.query.get('q') || ''; const fSort = ctx.query.get('sort') || ''; const fDur = ctx.query.get('dur') || '';
    const body = h('div.tv-body');
    const search = h('input.input.tv-search', { value: q, placeholder: t('Search Nebulix TV'), onKeydown: (e) => { if (e.key === 'Enter') ctx.go('tv', e.target.value.trim() ? { q: e.target.value.trim() } : undefined); } });
    const upload = async () => { const it = await uploadVideo('video'); if (it) ctx.go('tv', 'w/' + it.id); };
    mount(root, h('div.tv', h('header.tv-top', h('a.tv-logo', { href: '#/tv' }, h('span.tv-mark', icon('play', 14)), h('b', 'Nebulix'), h('span', 'TV')), h('div.tv-sbox', search, h('button.btn.ghost.sm', { onClick: () => ctx.go('tv', search.value.trim() ? { q: search.value.trim() } : undefined) }, icon('search', 16))),
      h('div.row', { style: 'gap:8px' }, h('a.btn.ghost.sm', { href: '#/clips', title: 'Clips' }, icon('zap', 15), h('span.tv-hide', 'Clips')), h('button.btn.primary.sm', { onClick: upload }, icon('upload', 15), h('span.tv-hide', t('Upload'))))), body));

    // card with a hover preview (muted, from the middle of the video) and the red "watched" bar
    const card = (v, { row = false } = {}) => {
      const pr = prog()[v.id]; let timer = 0; let pv = null;
      const thumb = h('div.tv-thumb', v.thumb ? h('img', { src: v.thumb, alt: '', loading: 'lazy' }) : h('span.hb-ph', icon('play', 30)), v.duration ? h('span.tv-dur', durTxt(v.duration)) : null, v.public ? null : h('span.tv-priv', icon('lock', 11), t('Private')),
        pr && pr.d ? h('div.tv-watched', h('i', { style: { width: Math.min(100, Math.round((pr.t / pr.d) * 100)) + '%' } })) : null);
      const el = h('a.tv-card' + (row ? '.row' : ''), { href: '#/tv/w/' + v.id,
        onMouseenter: () => { if (matchMedia('(pointer: coarse)').matches) return; timer = setTimeout(() => { pv = h('video.tv-pv', { src: '/x/hub/v/' + v.id + '#t=' + Math.floor((v.duration || 20) * 0.3), muted: true, autoplay: true, playsinline: true, loop: true }); pv.muted = true; thumb.append(pv); pv.play().catch(() => {}); }, 550); },
        onMouseleave: () => { clearTimeout(timer); if (pv) { pv.pause(); pv.removeAttribute('src'); pv.load(); pv.remove(); pv = null; } } },
        thumb,
        h('div.tv-meta', row ? null : (v.owner ? h('span.tv-cava', avatarEl(v.owner, { size: 36 })) : null),
          h('div.grow', { style: 'min-width:0' }, h('b.tv-title', v.title), h('div.tiny.muted', v.owner ? v.owner.displayName : '?'), h('div.tiny.muted', t('{n} views', { n: fmt.compact(v.views) }) + ' · ' + fmt.rel(v.created)))));
      return el;
    };

    if (page === 'watch') return watch(b);
    if (page === 'channel') return channel(b);

    // ---------- home / subscriptions / trending / mine / watch later ----------
    const chips = h('div.tv-chips', [['home', t('Home'), 'home'], ['subs', t('Subscriptions'), 'users'], ['trending', t('Trending'), 'bolt'], ['later', t('Watch later'), 'clock'], ['mine', t('My videos'), 'user']].map(([k, l, ic]) => h('a.tv-chip' + (page === k && !q ? '.on' : ''), { href: k === 'home' ? '#/tv' : '#/tv/' + k }, icon(ic, 14), l)));
    const grid = h('div.tv-grid'); const subsRow = h('div.tv-subs'); const contRow = h('div');
    const filt = q ? h('div.tv-filters', h('span.tiny.muted', t('Sort')), [['', t('Relevance')], ['new', t('Upload date')], ['views', t('View count')]].map(([k, l]) => h('a.tv-chip.sm' + (fSort === k ? '.on' : ''), { href: '#/tv?' + new URLSearchParams(Object.assign({ q }, k ? { sort: k } : {}, fDur ? { dur: fDur } : {})) }, l)),
      h('span.tiny.muted', { style: 'margin-left:10px' }, t('Duration')), [['', t('Any')], ['short', t('Under 4 minutes')], ['long', t('Over 20 minutes')]].map(([k, l]) => h('a.tv-chip.sm' + (fDur === k ? '.on' : ''), { href: '#/tv?' + new URLSearchParams(Object.assign({ q }, fSort ? { sort: fSort } : {}, k ? { dur: k } : {})) }, l))) : null;
    mount(body, chips, contRow, subsRow, q ? h('h3.tv-h', t('Results for “{q}”', { q })) : null, filt, grid);
    mount(grid, loading());
    try {
      let r;
      if (page === 'later') { const x = await api.get('/api/hub?saved=1&kind=video'); r = { items: x.items, tags: [], subs: [] }; }
      else r = await api.get(`/api/tv?tab=${page}&q=${encodeURIComponent(q)}&sort=${fSort}&dur=${fDur}`);
      if (r.tags.length && page === 'home' && !q) chips.append(...r.tags.slice(0, 8).map((tg) => h('a.tv-chip.tag', { href: '#/tv?q=' + encodeURIComponent(tg) }, '#' + tg)));
      if (page === 'subs' && r.subs.length) mount(subsRow, r.subs.map((u) => h('a.tv-sub', { href: '#/tv/c/' + u.username }, avatarEl(u, { size: 54 }), h('span.tiny', u.displayName))));
      if (page === 'home' && !q) { const p = prog(); const cont = Object.entries(p).filter(([, x]) => x.title && x.t > 5).sort((x, y) => y[1].at - x[1].at).slice(0, 8);
        if (cont.length) mount(contRow, h('h3.tv-h', icon('play', 16), ' ', t('Continue watching')), h('div.tv-cont', cont.map(([id, x]) => h('a.tv-card', { href: '#/tv/w/' + id }, h('div.tv-thumb', x.thumb ? h('img', { src: x.thumb, alt: '', loading: 'lazy' }) : h('span.hb-ph', icon('play', 30)), h('span.tv-dur', durTxt(x.t) + ' / ' + durTxt(x.d)), h('div.tv-watched', h('i', { style: { width: Math.round((x.t / Math.max(1, x.d)) * 100) + '%' } }))), h('b.tv-title', x.title), h('div.tiny.muted', x.owner || ''))))); }
      mount(grid, r.items.length ? r.items.map((v) => card(v)) : emptyState('play', page === 'subs' ? t('No videos from your subscriptions') : page === 'mine' ? t('You have not uploaded videos yet') : page === 'later' ? t('Nothing saved yet') : t('No videos yet'), page === 'subs' ? t('Subscribe to channels to see their new videos here.') : page === 'later' ? t('Press “Save” under a video to watch it later.') : t('Upload the first one and start your channel!')));
    } catch (e) { mount(grid, emptyState('alert', t('Could not load this'), e.message)); }
    return () => {};

    // ---------- watch ----------
    async function watch(id) {
      mount(body, loading());
      let d; try { d = await api.get('/api/tv/watch/' + encodeURIComponent(id)); } catch (e) { mount(body, emptyState('alert', t('Video not available'), e.message, h('a.btn', { href: '#/tv' }, t('Back')))); return () => {}; }
      const v = d.item; ctx.setTitle && ctx.setTitle(v.title);
      const video = h('video.tv-video', { src: v.src, controls: true, autoplay: true, playsinline: true, poster: v.thumb || null, preload: 'metadata' });
      const seek = (sec) => { video.currentTime = sec; video.play().catch(() => {}); video.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
      // resume where you left it
      const pr = prog()[v.id]; let resumed = false;
      video.addEventListener('loadedmetadata', () => { if (pr && pr.t > 5 && pr.t < (video.duration || 0) - 8 && !resumed) { resumed = true; video.currentTime = pr.t; toast(t('Resumed at {t}', { t: durTxt(pr.t) }), 'info', 2500); } });
      let lastSave = 0; const meta = { title: v.title, thumb: v.thumb, owner: v.owner ? v.owner.displayName : '' };
      video.addEventListener('timeupdate', () => { if (Date.now() - lastSave > 4000) { lastSave = Date.now(); saveProg(v.id, video.currentTime, video.duration, meta); } paintChapter(); });
      video.addEventListener('pause', () => saveProg(v.id, video.currentTime, video.duration, meta));
      // chapters: set by the creator, or read from the description
      const chapters = (v.chapters && v.chapters.length ? v.chapters : chaptersFrom(v.desc)).filter((c, i, arr) => arr.length >= 2 || i < 0);
      const chapEl = h('div.tv-chapters'); const chapNow = h('span.tv-chapnow');
      function paintChapter() { if (!chapters.length) return; const cur = [...chapters].reverse().find((c) => video.currentTime >= c.t); chapNow.textContent = cur ? '· ' + cur.n : ''; chapEl.querySelectorAll('.tv-chap').forEach((el, i) => el.classList.toggle('on', chapters[i] === cur)); }
      if (chapters.length) mount(chapEl, h('div.eyebrow', t('Chapters')), h('div.tv-chaprow', chapters.map((c) => h('button.tv-chap', { type: 'button', onClick: () => seek(c.t) }, h('b', durTxt(c.t) || '0:00'), h('span', c.n)))));
      // player tools
      let theater = !!ls('tv.theater'); let loop = false;
      const speedB = h('button.btn.tv-pill', { title: t('Playback speed'), onClick: (e) => openMenu([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((s) => ({ label: (s === 1 ? t('Normal') : s + '×'), icon: video.playbackRate === s ? 'check' : null, onClick: () => { video.playbackRate = s; speedB.lastChild.textContent = ' ' + (s === 1 ? '1×' : s + '×'); } })), e.currentTarget) }, icon('clock', 15), ' 1×');
      const loopB = h('button.btn.tv-pill', { title: t('Loop'), onClick: () => { loop = !loop; video.loop = loop; loopB.classList.toggle('on', loop); } }, icon('refresh', 15));
      const theaterB = h('button.btn.tv-pill' + (theater ? '.on' : ''), { title: t('Theater mode') + ' (T)', onClick: () => toggleTheater() }, icon('fullscreen', 15));
      const pipB = document.pictureInPictureEnabled ? h('button.btn.tv-pill', { title: t('Picture in picture') + ' (I)', onClick: () => togglePip() }, icon('layers', 15)) : null;
      const toggleTheater = () => { theater = !theater; ls('tv.theater', theater); body.querySelector('.tv-watch').classList.toggle('theater', theater); theaterB.classList.toggle('on', theater); };
      const togglePip = () => { try { if (document.pictureInPictureElement) document.exitPictureInPicture(); else video.requestPictureInPicture(); } catch {} };
      const subsN = h('span.tiny.muted', t('{n} subscribers', { n: fmt.compact(d.channel.followers) }));
      const likeB = h('button.btn.tv-pill' + (v.liked ? '.on' : ''), { onClick: () => busy(likeB, async () => { const r = await api.post(`/api/hub/${v.id}/like`); likeB.classList.toggle('on', r.liked); likeB.lastChild.textContent = ' ' + fmt.compact(r.likes); }) }, icon('heart', 15), ' ' + fmt.compact(v.likes));
      const laterB = h('button.btn.tv-pill' + (v.saved ? '.on' : ''), { onClick: () => busy(laterB, async () => { const r = await api.post(`/api/hub/${v.id}/save`); laterB.classList.toggle('on', r.saved); laterB.lastChild.textContent = ' ' + (r.saved ? t('Saved') : t('Save')); toast(r.saved ? t('Saved to Watch later') : t('Removed from Watch later'), 'good'); }) }, icon('bookmark', 15), ' ' + (v.saved ? t('Saved') : t('Save')));
      const descOpen = { v: false }; const descEl = h('div.tv-desc', { onClick: (e) => { if (e.target.closest('a, button')) return; descOpen.v = !descOpen.v; descEl.classList.toggle('open', descOpen.v); } },
        h('b.small', t('{n} views', { n: fmt.num(v.views) }) + ' · ' + fmt.date(v.created) + ' '), v.tags.length ? h('span.small', v.tags.map((x) => h('a.md-tag', { href: '#/tv?q=' + encodeURIComponent(x) }, '#' + x + ' '))) : null,
        v.desc ? h('div.small.tv-desc-t', timeLinks(v.desc)) : null);
      function timeLinks(text) { const out = []; let last = 0; for (const m of String(text).matchAll(/(^|[\s(])((?:\d{1,2}:)?\d{1,2}:\d{2})(?=$|[\s),.!?-])/g)) { const i = m.index + m[1].length; out.push(...richText(text.slice(last, i), { tagHref: (x) => '#/tv?q=' + encodeURIComponent(x), userHref: (x) => '#/tv/c/' + x })); const s = parseTime(m[2]); out.push(h('button.md-time', { type: 'button', onClick: () => seek(s) }, m[2])); last = i + m[2].length; } out.push(...richText(text.slice(last), { tagHref: (x) => '#/tv?q=' + encodeURIComponent(x), userHref: (x) => '#/tv/c/' + x })); return out; }
      const next = d.next; let autoNext = ls('tv.autoplay') !== false;
      const autoB = h('label.tv-auto', h('input', { type: 'checkbox', checked: autoNext, onChange: (e) => { autoNext = e.target.checked; ls('tv.autoplay', autoNext); } }), ' ', t('Autoplay'));
      video.addEventListener('ended', () => { saveProg(v.id, video.duration, video.duration); if (next[0] && autoNext && !loop) { toast(t('Up next: {t}', { t: next[0].title }), 'info', 3000); setTimeout(() => { if (body.isConnected) ctx.go('tv', 'w/' + next[0].id); }, 3000); } });
      // creator tools: thumbnail from a frame or an image, chapters
      async function editThumb() {
        const grid = h('div.md-thumbs.big', h('div.tiny.muted', t('Loading frames…'))); let pick = null;
        const r = await framesOf(v.src, [0.1, 0.25, 0.4, 0.55, 0.7, 0.85]).catch(() => ({ frames: [] }));
        const paint = () => mount(grid, r.frames.map((f) => h('button.md-th' + (pick === f.blob ? '.on' : ''), { type: 'button', onClick: () => { pick = f.blob; paint(); } }, h('img', { src: f.url, alt: '' }), h('span.tiny', durTxt(f.at)))),
          h('button.md-th.up', { type: 'button', onClick: async () => { video.pause(); const c = document.createElement('canvas'); c.width = 1280; c.height = Math.round(1280 * (video.videoHeight / video.videoWidth || 0.5625)); try { c.getContext('2d').drawImage(video, 0, 0, c.width, c.height); c.toBlob((bb) => { if (bb) { r.frames.unshift({ blob: bb, url: URL.createObjectURL(bb), at: video.currentTime }); pick = bb; paint(); } }, 'image/jpeg', 0.9); } catch { toast(t('Could not read this frame'), 'err'); } } }, icon('video', 18), h('span.tiny', t('Current frame'))),
          h('label.md-th.up', icon('image', 18), h('span.tiny', t('Upload')), h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, onChange: (e) => { const f = e.target.files[0]; if (f) { r.frames.unshift({ blob: f, url: URL.createObjectURL(f), at: 0 }); pick = f; paint(); } } })));
        if (r.frames.length) { pick = r.frames[1] ? r.frames[1].blob : r.frames[0].blob; } paint();
        await modal({ title: t('Change thumbnail'), cls: 'wide', body: grid, actions: [{ label: t('Cancel'), value: false }, { label: t('Save'), kind: 'primary', onClick: async () => { if (!pick) return false; try { const up = await putFile(`/api/hub/upload?kind=video&thumb=1&name=thumb.jpg`, new File([pick], 'thumb.jpg', { type: pick.type || 'image/jpeg' })); await api.post(`/api/hub/${v.id}/cover`, { thumb: up.upload }); toast(t('Thumbnail updated'), 'good'); ctx.go('tv', 'w/' + v.id); } catch (e) { toastErr(e); return false; } } }] });
      }
      async function editChapters() {
        const ta = h('textarea.input', { rows: 8, placeholder: '0:00 Intro\n1:30 …' }); ta.value = chapters.map((c) => (durTxt(c.t) || '0:00') + ' ' + c.n).join('\n');
        await modal({ title: t('Chapters'), body: h('div.col.gap', h('p.small.muted', t('One chapter per line: time and name. Start with 0:00.')), ta, h('button.btn.sm', { style: 'align-self:flex-start', onClick: () => { ta.value += (ta.value ? '\n' : '') + (durTxt(video.currentTime) || '0:00') + ' '; ta.focus(); } }, icon('plus', 13), t('Add the current time'))),
          actions: [{ label: t('Cancel'), value: false }, { label: t('Save'), kind: 'primary', onClick: async () => { try { await api.put(`/api/hub/${v.id}/chapters`, { chapters: chaptersFrom(ta.value) }); toast(t('Saved'), 'good'); ctx.go('tv', 'w/' + v.id); } catch (e) { toastErr(e); return false; } } }] });
      }
      async function editInfo() {
        const ti = h('input.input', { maxlength: 90, value: v.title }); const de = h('textarea.input', { rows: 5, maxlength: 2000 }); de.value = v.desc || ''; const tg = h('input.input', { value: (v.tags || []).join(', ') });
        const ok = await modal({ title: t('Edit'), body: h('div.col.gap', field(t('Title'), ti), field(t('Description'), de), field(t('Tags'), tg)), actions: [{ label: t('Cancel'), value: false }, { label: t('Save'), kind: 'primary', value: true }] });
        if (!ok) return; try { await api.patch('/api/hub/' + v.id, { title: ti.value, desc: de.value, tags: tg.value.split(',').map((x) => x.trim()).filter(Boolean) }); ctx.go('tv', 'w/' + v.id); } catch (e) { toastErr(e); }
      }
      mount(body, h('div.tv-watch' + (theater ? '.theater' : ''),
        h('div.tv-main', h('div.tv-player', video), h('div.tv-ptools', speedB, loopB, theaterB, pipB, chapters.length ? chapNow : null, h('span.grow'), autoB),
          h('h1.tv-wtitle', v.title),
          h('div.tv-chan-row', v.owner ? h('a.tv-chan', { href: '#/tv/c/' + v.owner.username }, avatarEl(v.owner, { size: 42 }), h('div', h('b', v.owner.displayName), subsN)) : null,
            v.owner ? followBtn(v.owner.username, d.channel.isFollowing, { labels: [t('Subscribe'), t('Subscribed')], onChange: (r) => { subsN.textContent = t('{n} subscribers', { n: fmt.compact(r.followers) }); } }) : null,
            h('span.grow'), likeB, laterB,
            h('button.btn.tv-pill', { onClick: async () => { try { await navigator.clipboard.writeText(location.origin + '/#/tv/w/' + v.id); toast(t('Link copied'), 'good'); } catch {} } }, icon('share', 15), ' ', t('Share')),
            h('button.btn.tv-pill', { title: t('Share at the current time'), onClick: async () => { try { await navigator.clipboard.writeText(`${location.origin}/#/tv/w/${v.id}?t=${Math.floor(video.currentTime)}`); toast(t('Link copied at {t}', { t: durTxt(video.currentTime) || '0:00' }), 'good'); } catch {} } }, icon('clock', 15)),
            v.mine ? h('button.btn.tv-pill', { onClick: (e) => openMenu([{ label: t('Edit title and description'), icon: 'edit', onClick: editInfo }, { label: t('Change thumbnail'), icon: 'image', onClick: editThumb }, { label: t('Chapters'), icon: 'list', onClick: editChapters }, { hr: true },
              { label: t('Delete'), icon: 'trash', danger: true, onClick: async () => { if (!(await confirmBox(t('Delete “{t}”?', { t: v.title }), { danger: true }))) return; try { await api.del('/api/hub/' + v.id); ctx.go('tv', 'mine'); } catch (e) { toastErr(e); } } }], e.currentTarget) }, icon('more', 15)) : null),
          descEl, chapEl,
          commentsPanel(v.id, { ownerId: v.owner && v.owner.id, onTime: seek })),
        h('aside.tv-next', h('div.eyebrow', t('Up next')), next.length ? next.map((x) => card(x, { row: true })) : h('div.muted.small', t('No other videos yet.')))));
      const st = Number(ctx.query.get('t')); if (st > 0) video.addEventListener('loadedmetadata', () => { video.currentTime = st; resumed = true; }, { once: true });
      // YouTube-style shortcuts: K / Space play, J / L ±10 s, ← → ±5 s, F fullscreen, M mute, T theater, I picture-in-picture, 0–9 jump
      const onKey = (e) => {
        if (!video.isConnected || e.ctrlKey || e.metaKey || e.altKey || (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) return; const k = e.key.toLowerCase();
        if (k === 'k' || (k === ' ' && e.target === document.body)) { e.preventDefault(); video.paused ? video.play() : video.pause(); }
        else if (k === 'j') video.currentTime -= 10; else if (k === 'l') video.currentTime += 10; else if (k === 'arrowleft' && e.target === document.body) video.currentTime -= 5; else if (k === 'arrowright' && e.target === document.body) video.currentTime += 5;
        else if (k === 'f') { if (document.fullscreenElement) document.exitFullscreen(); else video.requestFullscreen().catch(() => {}); } else if (k === 'm') video.muted = !video.muted; else if (k === 't') toggleTheater(); else if (k === 'i' && pipB) togglePip();
        else if (/^[0-9]$/.test(k) && video.duration) video.currentTime = (video.duration * Number(k)) / 10;
      };
      document.addEventListener('keydown', onKey);
      return () => { saveProg(v.id, video.currentTime, video.duration, meta); video.pause(); document.removeEventListener('keydown', onKey); };
    }

    // ---------- channel ----------
    async function channel(name) {
      mount(body, loading());
      let d; try { d = await api.get('/api/creator/' + encodeURIComponent(name)); } catch (e) { mount(body, emptyState('user', t('Channel not found'), e.message)); return () => {}; }
      const u = d.user; const subsN = h('span', t('{n} subscribers', { n: fmt.compact(d.followers) }));
      const sub = ctx.query.get('tab') || 'videos'; const order = ctx.query.get('order') || 'new';
      let list = (sub === 'clips' ? d.clips : d.videos).slice();
      if (order === 'popular') list.sort((x, y) => (y.views || 0) - (x.views || 0)); else if (order === 'old') list.sort((x, y) => x.created - y.created); else list.sort((x, y) => y.created - x.created);
      const ord = (k, l) => h('a.tv-chip.sm' + (order === k ? '.on' : ''), { href: `#/tv/c/${u.username}?tab=${sub}&order=${k}` }, l);
      mount(body, h('div.tv-channel', bannerEl(u, { height: 170, cls: 'tv-banner' }),
        h('div.tv-ch-head', avatarEl(u, { size: 104 }), h('div.grow', h('h1', nameEl(u)), h('div.muted.small', '@' + u.username + ' · ', subsN, ' · ' + t('{n} videos', { n: d.totals.videos }) + ' · ' + t('{n} views', { n: fmt.compact(d.totals.views) })), u.bio ? h('div.small.tv-bio', richText(u.bio)) : null,
          h('div.row', { style: 'gap:8px;margin-top:10px' }, d.me ? h('button.btn.primary', { onClick: upload }, icon('upload', 15), t('Upload a video')) : followBtn(u.username, d.isFollowing, { labels: [t('Subscribe'), t('Subscribed')], onChange: (r) => { subsN.textContent = t('{n} subscribers', { n: fmt.compact(r.followers) }); } }),
            h('a.btn', { href: '#/echo/u/' + u.username }, 'Echo'), d.totals.clips ? h('a.btn', { href: '#/clips/u/' + u.username }, 'Clips') : null))),
        h('div.tv-ch-tabs', [['videos', t('Videos')], ['clips', 'Clips'], ['about', t('About')]].map(([k, l]) => h('a' + (sub === k ? '.on' : ''), { href: `#/tv/c/${u.username}?tab=${k}` }, l))),
        sub === 'about' ? h('div.card.tv-about', h('h3', t('About')), u.bio ? h('p', richText(u.bio)) : h('p.muted', t('No description yet.')), h('div.tv-stats', [[t('Subscribers'), fmt.num(d.followers)], [t('Videos'), fmt.num(d.totals.videos)], ['Clips', fmt.num(d.totals.clips || 0)], [t('Total views'), fmt.num(d.totals.views)], [t('Joined'), fmt.date(u.created || 0)]].map(([k2, v2]) => h('div', h('b', v2), h('span.tiny.muted', k2)))))
          : [h('div.tv-filters', ord('new', t('Latest')), ord('popular', t('Popular')), ord('old', t('Oldest'))),
            list.length ? h('div.tv-grid', list.map((v) => (sub === 'clips' ? h('a.tv-card', { href: '#/clips/v/' + v.id }, h('div.tv-thumb.tall', v.thumb ? h('img', { src: v.thumb, alt: '', loading: 'lazy' }) : h('span.hb-ph', icon('zap', 30))), h('b.tv-title', v.title), h('div.tiny.muted', t('{n} views', { n: fmt.compact(v.views) }))) : card(v))))
              : emptyState('play', t('This channel has no videos yet'))]));
      return () => {};
    }
  },
};

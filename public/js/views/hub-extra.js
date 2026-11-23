// Nebulix Hub, part 2 (Nebulix 9.2): reviews with stars, screenshots, clips of a game (record one while you play)
// and the shared comments panel. Mounted under the player on an item page.
import { h, mount, fmt } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, busy, modal, confirmBox, promptBox } from '../ui.js';
import { avatarEl } from '../cosmetics.js';
import { commentsPanel, uploadVideo, durTxt } from '../media.js';
import { putFile } from './hub.js';

export const starsEl = (v, size = 14) => h('span.hb-stars', { style: { '--s': size + 'px' }, title: v ? v.toFixed(1) : '' }, [1, 2, 3, 4, 5].map((i) => h('i' + (v >= i - 0.25 ? '.on' : v >= i - 0.75 ? '.half' : ''), '★')));

// ---- reviews ----
export function reviewsPanel(it) {
  const box = h('section.hb-reviews'); let sort = 'helpful';
  async function load() {
    let r; try { r = await api.get(`/api/hub/${it.id}/reviews?sort=${sort}`); } catch (e) { mount(box, h('p.small.muted', e.message)); return; }
    const total = r.items.length; const avg = r.rating ? r.rating.avg : 0;
    const bars = h('div.hb-rbars', [5, 4, 3, 2, 1].map((n) => { const c = r.dist[n - 1]; return h('div.hb-rbar', h('span', String(n)), h('div', h('i', { style: { width: total ? Math.round((c / total) * 100) + '%' : '0' } })), h('span.tiny.muted', String(c))); }));
    let pick = r.mine ? r.mine.stars : 0; const ta = h('textarea.input', { rows: 2, maxlength: 1500, placeholder: t('What did you like? What could be better? (optional)') }); if (r.mine) ta.value = r.mine.text || '';
    const starPick = h('div.hb-pick'); const paintPick = (hover) => mount(starPick, [1, 2, 3, 4, 5].map((i) => h('button' + ((hover || pick) >= i ? '.on' : ''), { type: 'button', 'aria-label': i + ' ★', onMouseenter: () => paintPick(i), onMouseleave: () => paintPick(0), onClick: () => { pick = i; paintPick(0); } }, '★')), h('span.small.muted', (hover || pick) ? [t('Bad'), t('Meh'), t('OK'), t('Good'), t('Amazing!')][(hover || pick) - 1] : t('Tap a star')));
    paintPick(0);
    const write = r.canReview ? h('div.hb-rwrite', h('b', r.mine ? t('Your review') : t('Rate this')), starPick, ta, h('div.row', { style: 'gap:8px' }, h('button.btn.primary.sm', { onClick: (e) => busy(e.currentTarget, async () => { if (!pick) return toast(t('Tap a star first'), 'info'); try { await api.put(`/api/hub/${it.id}/reviews`, { stars: pick, text: ta.value }); toast(r.mine ? t('Review updated') : t('Thanks for your review!'), 'good'); load(); } catch (er) { toastErr(er); } }) }, r.mine ? t('Update') : t('Publish review')),
      r.mine ? h('button.btn.sm.ghost', { onClick: async () => { if (!(await confirmBox(t('Delete your review?'), { danger: true }))) return; try { await api.del(`/api/hub/${it.id}/reviews/${r.mine.id}`); load(); } catch (er) { toastErr(er); } } }, t('Delete')) : null)) : null;
    const one = (x) => h('div.hb-rv', avatarEl(x.owner, { size: 34 }), h('div.grow', { style: 'min-width:0' },
      h('div.row', { style: 'gap:8px;align-items:center;flex-wrap:wrap' }, h('b', x.owner ? x.owner.displayName : '?'), starsEl(x.stars, 13), h('span.tiny.muted', fmt.rel(x.created) + (x.edited ? ' · ' + t('edited') : ''))),
      x.text ? h('div.small.hb-rtext', x.text) : null,
      h('div.row', { style: 'gap:8px;align-items:center;margin-top:4px' }, !x.mine ? h('button.md-mini' + (x.voted ? '.on' : ''), { onClick: async (e) => { const b = e.currentTarget; try { const q = await api.post(`/api/hub/${it.id}/reviews/${x.id}/helpful`); b.classList.toggle('on', q.voted); b.lastChild.textContent = ' ' + t('Helpful') + (q.helpful ? ' (' + q.helpful + ')' : ''); } catch (er) { toastErr(er); } } }, icon('check', 12), ' ' + t('Helpful') + (x.helpful ? ' (' + x.helpful + ')' : '')) : (x.helpful ? h('span.tiny.muted', t('{n} found it helpful', { n: x.helpful })) : null),
        x.canReply ? h('button.md-mini', { onClick: async () => { const txt = await promptBox(t('Reply to this review'), { value: x.reply ? x.reply.text : '', multiline: true }); if (txt === null) return; try { await api.post(`/api/hub/${it.id}/reviews/${x.id}/reply`, { text: txt }); load(); } catch (er) { toastErr(er); } } }, x.reply ? t('Edit reply') : t('Reply')) : null,
        ['owner', 'admin', 'mod'].includes(S.me.role) && !x.mine ? h('button.md-mini', { onClick: async () => { if (!(await confirmBox(t('Delete this review?'), { danger: true }))) return; try { await api.del(`/api/hub/${it.id}/reviews/${x.id}`); load(); } catch (er) { toastErr(er); } } }, t('Delete')) : null),
      x.reply ? h('div.hb-rreply', h('b.tiny', '↳ ' + t('Reply from the creator')), h('div.small', x.reply.text)) : null));
    mount(box, h('h3.hb-sh', '⭐ ', t('Reviews'), h('span.tiny.muted', ' (' + total + ')')),
      h('div.hb-rtop', h('div.hb-ravg', h('b', total ? avg.toFixed(1) : '—'), starsEl(avg, 18), h('span.tiny.muted', t('{n} reviews', { n: total }))), bars, write),
      total ? h('div.seg.md-sort', { style: 'margin:10px 0' }, [['helpful', t('Most helpful')], ['new', t('Newest')], ['high', t('Highest')], ['low', t('Lowest')]].map(([k, l]) => h('button' + (sort === k ? '.on' : ''), { onClick: () => { sort = k; load(); } }, l))) : null,
      total ? h('div.hb-rlist', r.items.map(one)) : h('p.small.muted', it.mine ? t('No reviews yet. Share your upload so people can rate it.') : t('No reviews yet. Be the first!')));
  }
  mount(box, loading()); load(); return box;
}

// ---- screenshots ----
export function shotsPanel(it, onChange) {
  const shots = it.shots || []; if (!shots.length && !it.mine) return null;
  const view = (i) => { const img = h('img.hb-lb-img', { src: shots[i], alt: '' }); let k = i; const nav = (d) => { k = (k + d + shots.length) % shots.length; img.src = shots[k]; };
    modal({ cls: 'hb-lightbox', body: h('div.hb-lb', shots.length > 1 ? h('button.btn.ghost', { onClick: () => nav(-1) }, '‹') : null, img, shots.length > 1 ? h('button.btn.ghost', { onClick: () => nav(1) }, '›') : null), actions: [{ label: t('Close') }] }); };
  const add = () => { const i = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', multiple: true, onChange: async () => { for (const f of [...i.files].slice(0, 8 - shots.length)) { try { const up = await putFile(`/api/hub/upload?kind=${it.kind}&thumb=1&name=${encodeURIComponent(f.name)}`, f); const r = await api.post(`/api/hub/${it.id}/shots`, { upload: up.upload }); Object.assign(it, { shots: r.item.shots }); } catch (e) { toastErr(e); break; } } onChange && onChange(); } }); i.click(); };
  return h('section.hb-shots', h('h3.hb-sh', '🖼 ', t('Screenshots')), h('div.hb-shotrow', shots.map((s, i) => h('div.hb-shot', h('img', { src: s, alt: '', loading: 'lazy', onClick: () => view(i) }), it.mine ? h('button.hb-shotx', { title: t('Delete'), onClick: async () => { try { const r = await api.del(`/api/hub/${it.id}/shots/${i}`); it.shots = r.item.shots; onChange && onChange(); } catch (e) { toastErr(e); } } }, icon('x', 12)) : null)),
    it.mine && shots.length < 8 ? h('button.hb-shot.add', { onClick: add }, icon('plus', 22), h('span.tiny', t('Add screenshots'))) : null));
}

// ---- clips of this game: watch them, upload one, or record the game while you play ----
export function clipsPanel(it, { frame } = {}) {
  const box = h('section.hb-clips'); const game = { id: it.id, title: it.title };
  async function load() {
    let r; try { r = await api.get(`/api/hub/${it.id}/clips`); } catch { mount(box); return; }
    mount(box, h('div.row', { style: 'gap:8px;align-items:center;flex-wrap:wrap' }, h('h3.hb-sh.grow', '🎬 ', t('Clips of this game'), h('span.tiny.muted', ' (' + r.items.length + ')')),
      navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && window.MediaRecorder ? h('button.btn.sm.primary', { onClick: record }, h('span.hb-rec'), t('Record a clip')) : null,
      h('button.btn.sm', { onClick: async () => { const x = await uploadVideo('clip', { game }); if (x) load(); } }, icon('upload', 13), t('Upload a clip'))),
      r.items.length ? h('div.hb-cliprow', r.items.map((c) => h('a.hb-clip', { href: '#/clips/v/' + c.id }, c.thumb ? h('img', { src: c.thumb, alt: '', loading: 'lazy' }) : h('span.hb-ph', icon('zap', 24)), h('span.hb-clipv', icon('play', 11), ' ' + fmt.compact(c.views)), h('b.tiny', c.title)))) : h('p.small.muted', t('No clips yet. Record your best moment!')));
  }
  // records this tab (the game) for up to 60 s, then opens the clip upload with the recording
  async function record() {
    let stream; try { stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true, preferCurrentTab: true, selfBrowserSurface: 'include' }); } catch { return toast(t('Recording was cancelled.'), 'info'); }
    const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((x) => MediaRecorder.isTypeSupported(x)) || '';
    const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 4e6 } : undefined); const parts = []; rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    // crop to the game area when the browser supports Region Capture
    try { if (frame && window.CropTarget && stream.getVideoTracks()[0].cropTo) { const ct = await window.CropTarget.fromElement(frame); await stream.getVideoTracks()[0].cropTo(ct); } } catch {}
    const t0 = Date.now(); const pill = h('div.hb-recpill', h('span.hb-rec'), h('b', '0:00'), h('button.btn.sm.danger', { onClick: () => stop() }, t('Stop')));
    document.body.append(pill); const tick = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); pill.querySelector('b').textContent = durTxt(s) || '0:00'; if (s >= 60) stop(); }, 250);
    let done = false; const stop = () => { if (done) return; done = true; clearInterval(tick); pill.remove(); try { rec.stop(); } catch {} stream.getTracks().forEach((x) => x.stop()); };
    stream.getVideoTracks()[0].addEventListener('ended', stop);
    rec.onstop = async () => { if (!parts.length) return; const blob = new Blob(parts, { type: type.split(';')[0] || 'video/webm' }); const file = new File([blob], 'clip-' + Date.now() + (type.includes('mp4') ? '.mp4' : '.webm'), { type: blob.type }); const x = await uploadVideo('clip', { game, file }); if (x) { toast(t('Clip published!'), 'good'); load(); } };
    rec.start(1000); toast(t('Recording… up to 60 seconds. Press Stop when you are done.'), 'info', 3000);
  }
  if (!['game', 'app'].includes(it.kind)) return null;
  mount(box, loading()); load(); return box;
}

export const hubComments = (it) => h('section.hb-cmts2', commentsPanel(it.id, { ownerId: it.owner && it.owner.id, userHref: (x) => '#/profile/' + x }));

// Shared pieces of the community media apps (Echo, Clips, Nebulix TV): rich text, follow button,
// comments panel and the video/clip upload dialog.
import { h, mount, fmt } from './util.js';
import { t } from './i18n.js';
import { api } from './api.js';
import { S } from './state.js';
import { icon } from './icons.js';
import { toast, toastErr, loading, busy, field, modal, switchEl, confirmBox } from './ui.js';
import { avatarEl, nameEl } from './cosmetics.js';
import { putFile, videoThumb } from './views/hub.js';

// Text → DOM with clickable #tags, @mentions and links (never innerHTML).
const TOKEN = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])|(^|[^\p{L}\p{N}_])#([\p{L}\p{N}_]{2,32})|(^|[^\p{L}\p{N}_])@([A-Za-z0-9_.]{2,24})/gu;
export function richText(text, { tagHref = (x) => '#/echo/tag/' + encodeURIComponent(x), userHref = (x) => '#/echo/u/' + x } = {}) {
  const out = []; let last = 0; const s = String(text || '');
  for (const m of s.matchAll(TOKEN)) {
    let i = m.index;
    if (m[1]) { out.push(s.slice(last, i)); out.push(h('a.md-link', { href: m[1], target: '_blank', rel: 'noopener noreferrer nofollow' }, m[1].replace(/^https?:\/\/(www\.)?/, '').slice(0, 48))); }
    else if (m[3]) { i += m[2].length; out.push(s.slice(last, i)); out.push(h('a.md-tag', { href: tagHref(m[3]) }, '#' + m[3])); }
    else { i += m[4].length; out.push(s.slice(last, i)); out.push(h('a.md-at', { href: userHref(m[5]) }, '@' + m[5])); }
    last = m.index + m[0].length;
  }
  out.push(s.slice(last)); return out;
}

export function followBtn(username, following, { onChange, small = false, labels = [t('Follow'), t('Following')] } = {}) {
  if (!username || (S.me && username.toLowerCase() === S.me.username.toLowerCase())) return null;
  let on = !!following;
  const b = h('button.btn' + (small ? '.sm' : '') + (on ? '.md-following' : '.primary'), { onClick: (e) => { e.preventDefault(); e.stopPropagation(); busy(b, async () => { const r = await api.post('/api/follow/' + encodeURIComponent(username)); on = r.following; paint(); onChange && onChange(r); }); } });
  const paint = () => { b.classList.toggle('primary', !on); b.classList.toggle('md-following', on); mount(b, on ? icon('check', 14) : icon('plus', 14), on ? labels[1] : labels[0]); };
  paint(); return b;
}

// "1:23" / "1:02:03" in text → seconds
export const parseTime = (s) => { const p = String(s).split(':').map(Number); return p.some(isNaN) ? null : p.reduce((a, x) => a * 60 + x, 0); };
// rich text where timestamps like 1:23 become buttons that seek the video
function timedText(text, onTime, opts) {
  if (!onTime) return richText(text, opts);
  const out = []; let last = 0; const s = String(text || '');
  for (const m of s.matchAll(/(^|[\s(])((?:\d{1,2}:)?\d{1,2}:\d{2})(?=$|[\s),.!?])/g)) { const i = m.index + m[1].length; out.push(...richText(s.slice(last, i), opts)); const sec = parseTime(m[2]); out.push(h('button.md-time', { type: 'button', onClick: () => onTime(sec) }, m[2])); last = i + m[2].length; }
  out.push(...richText(s.slice(last), opts)); return out;
}
// Comments for a Hub item, video or clip: top / newest, the creator can pin one and give hearts, authors edit,
// timestamps jump in the video. Returns an element; onCount(n) is told the new total.
export function commentsPanel(target, { onCount, ownerId, onTime, userHref = (x) => '#/tv/c/' + x } = {}) {
  const list = h('div.md-cmts'); const head = h('div.md-cmt-head'); let replyTo = null; let sort = 'top';
  const isCreator = () => S.me && ownerId && S.me.id === ownerId;
  const input = h('textarea.input.md-cmt-in', { rows: 1, maxlength: 600, placeholder: t('Add a comment…'), onKeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }, onInput: () => { input.style.height = 'auto'; input.style.height = Math.min(140, input.scrollHeight) + 'px'; } });
  const replyChip = h('div.md-reply-chip.hidden');
  const sendBtn = h('button.btn.primary.sm', { onClick: () => send() }, icon('send', 14));
  const box = h('div.md-cmt-box', avatarEl(S.me, { size: 30 }), h('div.grow.col', replyChip, input), sendBtn);
  async function send() {
    const text = input.value.trim(); if (!text) return;
    await busy(sendBtn, async () => { const r = await api.post('/api/comments/' + target, { text, reply: replyTo && replyTo.id }); input.value = ''; input.style.height = ''; setReply(null); onCount && onCount(r.total); await load(); });
  }
  function setReply(c) { replyTo = c; replyChip.classList.toggle('hidden', !c); if (c) { mount(replyChip, t('Replying to @{u}', { u: c.owner.username }), h('button.md-x', { onClick: () => setReply(null) }, icon('x', 12))); input.focus(); } }
  function row(c, isReply) {
    const like = h('button.md-mini' + (c.liked ? '.on' : ''), { onClick: () => busy(like, async () => { const r = await api.post(`/api/comments/${target}/${c.id}/like`); like.classList.toggle('on', r.liked); like.lastChild.textContent = r.likes || ''; }) }, icon('heart', 13), h('span', c.likes || ''));
    const canDel = c.mine || isCreator() || (S.me && ['owner', 'admin', 'mod'].includes(S.me.role));
    const textEl = h('div.md-cmt-text', timedText(c.text, onTime, { userHref }));
    const edit = () => { const ta = h('textarea.input', { rows: 2, maxlength: 600 }); ta.value = c.text; mount(textEl, ta, h('div.row', { style: 'gap:6px;margin-top:4px' }, h('button.btn.sm.primary', { onClick: async () => { try { const r = await api.patch(`/api/comments/${target}/${c.id}`, { text: ta.value }); Object.assign(c, r.comment); load(); } catch (e) { toastErr(e); } } }, t('Save')), h('button.btn.sm', { onClick: () => load() }, t('Cancel')))); ta.focus(); };
    return h('div.md-cmt' + (isReply ? '.reply' : '') + (c.pinned ? '.pinned' : ''), avatarEl(c.owner, { size: isReply ? 24 : 32 }),
      h('div.grow', { style: 'min-width:0' }, c.pinned ? h('div.md-pin', icon('pin', 11), t('Pinned by the creator')) : null,
        h('div.tiny', h('a.md-at' + (c.owner && c.owner.id === ownerId ? '.creator' : ''), { href: userHref(c.owner.username) }, '@' + c.owner.username), h('span.muted', ' · ' + fmt.rel(c.created) + (c.edited ? ' · ' + t('edited') : ''))), textEl,
        h('div.row', { style: 'gap:6px;align-items:center' }, like, isReply ? null : h('button.md-mini', { onClick: () => setReply(c) }, t('Reply')),
          c.heart ? h('span.md-heart', { title: t('The creator loved this') }, '❤️') : null,
          isCreator() ? h('button.md-mini' + (c.heart ? '.on' : ''), { title: t('Give a heart'), onClick: async () => { try { await api.post(`/api/comments/${target}/${c.id}/heart`); load(); } catch (e) { toastErr(e); } } }, '♡') : null,
          isCreator() && !isReply ? h('button.md-mini', { onClick: async () => { try { await api.post(`/api/comments/${target}/${c.id}/pin`); load(); } catch (e) { toastErr(e); } } }, c.pinned ? t('Unpin') : t('Pin')) : null,
          c.mine ? h('button.md-mini', { onClick: edit }, t('Edit')) : null,
          canDel ? h('button.md-mini', { onClick: async () => { if (!(await confirmBox(t('Delete this comment?'), { danger: true }))) return; try { const r = await api.del(`/api/comments/${target}/${c.id}`); onCount && onCount(r.total); load(); } catch (e) { toastErr(e); } } }, t('Delete')) : null),
        (c.replies || []).length ? h('div.md-replies', c.replies.map((r) => row(r, true))) : null));
  }
  async function load() {
    try {
      const r = await api.get('/api/comments/' + target + '?sort=' + sort);
      mount(head, h('b', t('{n} comments', { n: fmt.num(r.total) })), h('span.grow'), h('div.seg.md-sort', [['top', t('Top')], ['new', t('Newest')]].map(([k, l]) => h('button' + (sort === k ? '.on' : ''), { onClick: () => { sort = k; load(); } }, l))));
      mount(list, r.items.length ? r.items.map((c) => row(c)) : h('div.muted.small.md-none', t('No comments yet. Say something nice!')));
    } catch (e) { mount(list, h('div.muted.small', e.message)); }
  }
  mount(list, loading()); load();
  return h('div.md-cmt-wrap', head, box, list);
}

// frames of a local video file at the given fractions of its length → [{ blob, url, at }]
export function framesOf(src, fracs = [0.15, 0.4, 0.65, 0.9]) {
  return new Promise((resolve) => {
    const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.crossOrigin = 'anonymous'; v.src = typeof src === 'string' ? src : URL.createObjectURL(src); const out = []; let i = 0; let dur = 0;
    const fin = () => { if (typeof src !== 'string') URL.revokeObjectURL(v.src); resolve({ frames: out, duration: dur }); };
    v.onloadedmetadata = () => { dur = v.duration || 0; if (!dur) return fin(); v.currentTime = Math.max(0.1, dur * fracs[0]); };
    v.onseeked = () => { try { const c = document.createElement('canvas'); c.width = 640; c.height = Math.round(640 * (v.videoHeight / v.videoWidth || 0.5625)); c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); c.toBlob((b) => { if (b) out.push({ blob: b, url: URL.createObjectURL(b), at: v.currentTime }); i++; if (i < fracs.length) v.currentTime = Math.max(0.1, dur * fracs[i]); else fin(); }, 'image/jpeg', 0.85); } catch { fin(); } };
    v.onerror = fin; setTimeout(fin, 15000);
  });
}
// a picker with automatic frames + "upload your own"; returns { el, get: () => Blob | null }
function thumbPicker() {
  let frames = []; let pick = 0; let custom = null; const el = h('div.md-thumbs');
  const paint = () => mount(el, frames.length || custom ? [h('div.tiny.muted', { style: 'grid-column:1/-1' }, t('Thumbnail')), ...frames.map((f, i) => h('button.md-th' + (pick === i && !custom ? '.on' : ''), { type: 'button', onClick: () => { pick = i; custom = null; paint(); } }, h('img', { src: f.url, alt: '' }))),
    custom ? h('button.md-th.on', { type: 'button' }, h('img', { src: custom.url, alt: '' })) : null,
    h('label.md-th.up', icon('image', 18), h('span.tiny', t('Upload')), h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, onChange: (e) => { const f = e.target.files[0]; if (f) { custom = { blob: f, url: URL.createObjectURL(f) }; paint(); } } }))] : null);
  return { el, async load(file) { frames = []; custom = null; pick = 1; mount(el, h('div.tiny.muted', t('Making thumbnails…'))); const r = await framesOf(file); frames = r.frames; this.duration = r.duration; if (pick >= frames.length) pick = 0; paint(); }, get: () => (custom ? custom.blob : frames[pick] ? frames[pick].blob : null), duration: 0 };
}

// Upload a long video (Nebulix TV) or a vertical clip (Clips). Resolves to the published Hub item, or null.
export async function uploadVideo(kind = 'video', { game = null, file: preFile = null } = {}) {
  const isClip = kind === 'clip'; let file = null; let preview = null;
  const max = isClip ? (S.me.pro ? 300 : 100) : (S.me.pro ? 1024 : 200);
  const vid = h('video.md-up-prev', { muted: true, playsinline: true, loop: true, autoplay: true });
  const tp = thumbPicker();
  const useFile = (f) => { file = f; if (!file) return; if (preview) URL.revokeObjectURL(preview); preview = URL.createObjectURL(file); vid.src = preview; vid.classList.add('on'); if (!title.value) title.value = (file.name || '').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 90); tp.load(file); };
  const fileIn = h('input', { type: 'file', accept: 'video/mp4,video/webm,.mp4,.webm,.mov,.m4v', onChange: () => useFile(fileIn.files[0]) });
  const title = h('input.input', { maxlength: 90, placeholder: isClip ? t('Caption') : t('Title') });
  const desc = h('textarea.input', { rows: 3, maxlength: 2000, placeholder: isClip ? t('Describe your clip, add #tags') : t('Description (optional). Lines like “1:30 Boss fight” become chapters.') });
  const tags = h('input.input', { placeholder: t('Tags, separated by commas') });
  let pub = true; const sw = switchEl(true, (v) => { pub = v; });
  let gameId = game ? game.id : ''; const gameSel = isClip ? h('select.input', { onChange: (e) => { gameId = e.target.value; } }, h('option', { value: '' }, t('No game')), game ? h('option', { value: game.id, selected: true }, game.title) : null) : null;
  if (isClip && !game) api.get('/api/hub?kind=game&sort=top', { quiet: true }).then((r) => { for (const g of r.items.slice(0, 60)) gameSel.append(h('option', { value: g.id }, g.title)); }).catch(() => {});
  const bar = h('div.hb-prog', h('i')); bar.style.display = 'none'; const status = h('div.tiny.muted');
  let result = null;
  if (preFile) setTimeout(() => useFile(preFile), 0);
  await modal({ title: isClip ? t('New clip') : t('Upload a video'), cls: 'md-up-modal', body: h('div.md-up' + (isClip ? '.clip' : ''), h('div.col', h('label.md-drop', vid, h('div.md-drop-in', icon('upload', 26), h('b', t('Choose a video')), h('div.tiny.muted', (isClip ? t('Vertical video (9:16) works best.') + ' ' : '') + t('MP4 or WEBM, up to {n} MB.', { n: max }))), fileIn), tp.el),
    h('div.col.gap', field(isClip ? t('Caption') : t('Title'), title), field(t('Description'), desc), field(t('Tags'), tags), isClip ? field(t('Game'), gameSel) : null, h('div.row', h('span.grow', t('Public')), sw), bar, status)),
    actions: [{ label: t('Cancel'), value: false }, { label: t('Publish'), kind: 'primary', onClick: async (ev, m) => {
      const btn = ev.currentTarget;
      if (!file) { toast(t('Choose a file first'), 'err'); return false; }
      if (file.size > max * 1048576) { toast(t('That file is bigger than {n} MB', { n: max }), 'err'); return false; }
      if (title.value.trim().length < 2) { toast(t('Give it a title'), 'err'); return false; }
      btn.disabled = true; bar.style.display = 'block';
      try {
        let thBlob = tp.get(); let duration = tp.duration; if (!thBlob) { status.textContent = t('Making a thumbnail…'); const v = await videoThumb(file); thBlob = v.blob; duration = v.duration; }
        let th = null; if (thBlob) th = (await putFile(`/api/hub/upload?kind=${kind}&thumb=1&name=thumb.jpg`, new File([thBlob], 'thumb.jpg', { type: thBlob.type || 'image/jpeg' }))).upload;
        const up = await putFile(`/api/hub/upload?kind=${kind}&name=${encodeURIComponent(file.name || (isClip ? 'clip.webm' : 'video.webm'))}`, file, (p) => { bar.firstChild.style.width = Math.round(p * 100) + '%'; status.textContent = t('Uploading… {p}%', { p: Math.round(p * 100) }); });
        status.textContent = t('Publishing…');
        const tagList = [...tags.value.split(','), ...[...(desc.value + ' ' + title.value).matchAll(/#([\p{L}\p{N}_]{2,24})/gu)].map((x) => x[1])].map((x) => x.trim().replace(/^#/, '')).filter(Boolean);
        const r = await api.post('/api/hub', { upload: up.upload, thumb: th, title: title.value, desc: desc.value, tags: [...new Set(tagList)].slice(0, 8), public: pub, duration, game: gameId || undefined });
        const ch = chaptersFrom(desc.value); if (!isClip && ch.length >= 2) await api.put(`/api/hub/${r.item.id}/chapters`, { chapters: ch }).catch(() => {});
        result = r.item; toast(t('Published!'), 'good'); m.close(true);
      } catch (e) { toastErr(e); btn.disabled = false; status.textContent = ''; bar.style.display = 'none'; }
      return false;
    } }] });
  if (preview) URL.revokeObjectURL(preview);
  return result;
}
// "0:00 Intro" lines in a description → [{ t, n }]
export function chaptersFrom(text) { const out = []; for (const line of String(text || '').split('\n')) { const m = /^\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[-–—:]?\s*(.+)$/.exec(line); if (m) { const s = parseTime(m[1]); if (s !== null) out.push({ t: s, n: m[2].trim().slice(0, 60) }); } } return out.sort((a, b) => a.t - b.t); }

export const durTxt = (s) => { s = Math.round(s || 0); if (!s) return ''; const hh = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const ss = String(s % 60).padStart(2, '0'); return hh ? `${hh}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`; };
export { avatarEl, nameEl };

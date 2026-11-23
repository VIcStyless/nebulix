// Messages: friends, requests, and end-to-end encrypted one-to-one chats. The server only ever sees ciphertext.
import { h, mount, clear, fmt, debounce, pickFile, ls } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S, bus, seen, withPresence } from '../state.js';
import { icon } from '../icons.js';
import { avatarEl, nameEl, badgesEl, bubbleStyle } from '../cosmetics.js';
import { richText } from '../rich.js';
import { toast, toastErr, openMenu, promptBox, confirmBox, modal, tabsEl, emptyState, loading, emojiPicker, copyBtn } from '../ui.js';
import { sfx } from '../sfx.js';
import * as cx from '../crypto.js';
import * as voice from '../voice.js';
import * as rtc from '../rtc.js';
import { translate } from '../translator.js';

let inst = null;
const MAX_LEN = 1500;

function build(root, go) {
  let convs = []; let side = 'chats'; let peerId = null; let peer = null; let convId = null; let peerPub = null; let msgs = []; let peerRead = null; let typedAt = 0; let typingUntil = 0; let typingTimer = 0; let more = false; let shown = false; let keyChanged = false; let token = 0;
  const unsubs = [];
  const list = h('div.dm-list'); const main = h('section.dm-main'); const tabsHost = h('div'); const search = h('input.input', { placeholder: t('Search chats and friends'), 'aria-label': t('Search chats and friends'), onInput: () => paintList() });
  const addBtn = h('button.btn.sm.primary', { onClick: addFriend }, icon('plus', 15), t('Add friend'));
  const aside = h('aside.dm-side', h('div.row', { style: 'padding:12px 12px 4px' }, h('h3.grow', { style: 'margin:0' }, t('Messages')), addBtn), h('div', { style: 'padding:6px 12px' }, search), tabsHost, list);
  mount(root, h('div.dm-wrap', aside, main));

  const online = (u) => withPresence(u);
  const pending = () => (S.friends.incoming || []).length;
  function paintTabs() { mount(tabsHost, tabsEl([['chats', t('Chats'), 'chat'], ['friends', t('Friends'), 'users'], ['requests', t('Requests') + (pending() ? ` (${pending()})` : ''), 'bell']], side, (id) => { side = id; paintList(); })); tabsHost.firstChild.style.margin = '0 8px'; }
  const unreadTotal = () => convs.reduce((n, c) => n + (c.unread || 0), 0);
  function syncBadge() { S.dmUnread = unreadTotal(); bus.emit('badges'); }

  async function loadConvs() { try { const r = await api.get('/api/dm'); convs = r.conversations; convs.forEach((c) => seen(c.peer)); syncBadge(); } catch (e) { toastErr(e); } paintList(); }

  function row(u, { sub, time, unread, onClick, actions } = {}) {
    return h('div.dm-item' + (u.id === peerId ? '.on' : ''), { role: 'button', tabindex: '0', onClick, onKeydown: (e) => { if (e.key === 'Enter') onClick(); }, onContextmenu: (e) => { e.preventDefault(); userMenu(u, e); } },
      avatarEl(online(u), { size: 40, status: true }), h('div.grow', { style: 'min-width:0' }, h('div', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, nameEl(u)), sub ? h('div.tiny.muted', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, sub) : null),
      time ? h('span.tiny.muted', time) : null, unread ? h('span.nb.inl', unread > 99 ? '99+' : unread) : null, actions || null);
  }
  function paintList() {
    paintTabs(); const q = search.value.trim().toLowerCase(); const match = (u) => !q || (u.displayName + ' ' + u.username).toLowerCase().includes(q);
    const kids = [];
    if (side === 'chats') {
      const cs = convs.filter((c) => match(c.peer));
      const ids = new Set(cs.map((c) => c.peer.id));
      cs.forEach((c) => kids.push(row(c.peer, { sub: c.last ? t('Encrypted message') : t('Say hi!'), time: c.last ? fmt.rel(c.updated) : '', unread: c.unread, onClick: () => open(c.peer.id) })));
      const fr = (S.friends.friends || []).filter((f) => !ids.has(f.id) && match(f));
      if (fr.length) { kids.push(h('div.tiny.muted.dm-sep', t('Start a chat'))); fr.forEach((f) => kids.push(row(f, { sub: S.online.has(f.id) ? t('Online') : t('Offline'), onClick: () => open(f.id) }))); }
      if (!kids.length) kids.push(emptyState('💬', t('No chats yet'), t('Add a friend by username and start talking — messages are end-to-end encrypted.'), h('button.btn.primary', { onClick: addFriend }, t('Add friend'))));
    } else if (side === 'friends') {
      const fr = (S.friends.friends || []).filter(match).sort((a, b) => Number(S.online.has(b.id)) - Number(S.online.has(a.id)) || a.username.localeCompare(b.username));
      fr.forEach((f) => kids.push(row(f, { sub: S.online.has(f.id) ? t('Online') : t('Offline'), onClick: () => open(f.id), actions: h('button.btn.ghost.icon.sm', { 'aria-label': t('More'), onClick: (e) => { e.stopPropagation(); userMenu(f, e); } }, icon('more', 16)) })));
      if (!fr.length) kids.push(emptyState('🧑‍🤝‍🧑', t('No friends yet'), t('Send a friend request to get started.'), h('button.btn.primary', { onClick: addFriend }, t('Add friend'))));
    } else {
      const inc = S.friends.incoming || []; const out = S.friends.outgoing || []; const blk = S.friends.blocked || [];
      if (inc.length) kids.push(h('div.tiny.muted.dm-sep', t('Incoming')));
      inc.forEach((u) => kids.push(row(u, { sub: '@' + u.username, onClick: () => {}, actions: h('div.row', { style: 'gap:4px' }, h('button.btn.sm.primary', { onClick: (e) => { e.stopPropagation(); answer(u, true); } }, t('Accept')), h('button.btn.sm', { onClick: (e) => { e.stopPropagation(); answer(u, false); } }, t('Decline'))) })));
      if (out.length) kids.push(h('div.tiny.muted.dm-sep', t('Sent')));
      out.forEach((u) => kids.push(row(u, { sub: t('Waiting for them…'), onClick: () => {}, actions: h('button.btn.sm', { onClick: (e) => { e.stopPropagation(); answer(u, false); } }, t('Cancel')) })));
      if (blk.length) kids.push(h('div.tiny.muted.dm-sep', t('Blocked')));
      blk.forEach((u) => kids.push(row(u, { sub: '@' + u.username, onClick: () => {}, actions: h('button.btn.sm', { onClick: async (e) => { e.stopPropagation(); await api.del('/api/block/' + u.id).catch(toastErr); await refreshFriends(); } }, t('Unblock')) })));
      if (!kids.length) kids.push(emptyState('📭', t('Nothing pending'), t('Friend requests will show up here.')));
    }
    mount(list, ...kids);
  }
  async function refreshFriends() { try { S.friends = await api.get('/api/friends'); S.friends.friends.forEach(seen); } catch {} paintList(); }
  async function answer(u, accept) { try { await api.post('/api/friends/' + (accept ? 'accept' : 'decline'), { id: u.id }); if (accept) toast(t('You and {n} are now friends!', { n: u.displayName || u.username }), 'good'); await refreshFriends(); } catch (e) { toastErr(e); } }
  async function addFriend() {
    const name = await promptBox(t('Add a friend'), { label: t('Their username'), placeholder: 'username', ok: t('Send request'), validate: (v) => (/^[A-Za-z0-9_]{3,20}$/.test(v.trim().replace(/^@/, '')) ? '' : t('Usernames are 3-20 letters, numbers or _')) });
    if (!name) return;
    try { const r = await api.post('/api/friends/request', { username: name.trim().replace(/^@/, '') }); toast(r.accepted ? t('You are now friends!') : t('Friend request sent.'), 'good'); await refreshFriends(); side = r.accepted ? 'friends' : 'requests'; paintList(); } catch (e) { toastErr(e); }
  }
  function userMenu(u, e) {
    const isFriend = (S.friends.friends || []).some((f) => f.id === u.id);
    openMenu([{ label: t('Message'), icon: 'chat', onClick: () => open(u.id) }, { label: t('View profile'), icon: 'user', onClick: () => go('profile', u.username) }, { hr: true },
      isFriend ? { label: t('Remove friend'), icon: 'x', onClick: async () => { if (await confirmBox(t('Remove {n} from your friends?', { n: u.displayName || u.username }), { danger: true, ok: t('Remove') })) { await api.del('/api/friends/' + u.id).catch(toastErr); await refreshFriends(); } } } : null,
      { label: t('Block'), icon: 'shield', danger: true, onClick: async () => { if (await confirmBox(t('Block {n}? They will not be able to message you.', { n: u.displayName || u.username }), { danger: true, ok: t('Block') })) { await api.post('/api/block/' + u.id).catch(toastErr); await refreshFriends(); if (peerId === u.id) close(); } } },
      { label: t('Report'), icon: 'flag', onClick: () => report(u) }], e);
  }
  async function report(u) {
    const reason = await promptBox(t('Report {n}', { n: u.displayName || u.username }), { label: t('What happened?'), multiline: true, ok: t('Send report'), validate: (v) => (v.trim().length < 3 ? t('Tell us briefly what happened') : v.length > 300 ? t('Up to 300 characters') : '') });
    if (!reason) return;
    try { await api.post('/api/reports', { type: 'user', target: u.id, reason: reason.trim() }); toast(t('Thanks — a moderator will take a look.'), 'good'); } catch (e) { toastErr(e); }
  }

  // ---------- conversation pane ----------
  function close() { peerId = null; peer = null; S.activePeer = null; paintMain(); paintList(); history.replaceState(null, '', '#/dm'); }
  async function open(id) {
    peerId = id; S.activePeer = shown ? id : null; const my = ++token;
    try { history.replaceState(null, '', '#/dm/' + id); } catch {}
    paintList(); mount(main, loading(t('Opening chat…')));
    let ks; try { ks = await ensureKeys(); } catch (e) { toastErr(e); return; }
    if (my !== token) return;
    if (ks.s !== 'ready') return gate(ks, () => open(id));
    try {
      const r = await api.get(`/api/dm/${id}/messages`); if (my !== token) return;
      peer = seen(r.peer); convId = r.id; peerPub = r.key ? r.key.pub : null; more = r.more; msgs = []; peerRead = r.peerRead || null;
      keyChanged = false;
      if (r.key) { const c = cx.checkPeerKey(peer.id, r.key.fp); keyChanged = c === 'changed'; peer._fp = r.key.fp; }
      msgs = await decryptAll(r.messages);
    } catch (e) { toastErr(e); close(); return; }
    paintMain(); markRead();
  }
  async function ensureKeys() {
    if (!cx.supported()) return { s: 'unsupported' };
    const s = await cx.state();
    if (s.s === 'none') { await cx.createKeys(); S.me.hasKey = true; return { s: 'ready' }; }
    if (s.s === 'ready-unpublished') { await cx.publishLocal(); return { s: 'ready' }; }
    return s;
  }
  const unpack = async (m) => { const p = peerPub ? await cx.openMsg(convId, peerPub, m) : null; return { id: m.id, f: m.f, t: m.t, text: p ? p.text : null, v: p ? p.v : null, img: p ? p.img : null }; };
  const decryptAll = (arr) => Promise.all(arr.map(unpack));

  function gate(ks, retry) {
    const pass = h('input.input', { type: 'password', placeholder: t('Backup passphrase'), autocomplete: 'off' }); const err = h('div.error');
    const restore = h('button.btn.primary.block', { onClick: async () => { err.textContent = ''; try { await cx.restore(pass.value); toast(t('Encryption key restored'), 'good'); retry(); } catch (e) { err.textContent = e.code === 'bad_pass' ? t('That passphrase is not right.') : e.message; } } }, icon('key', 16), t('Restore my key'));
    const fresh = h('button.btn.block', { onClick: async () => { if (await confirmBox(t('A new key makes your old messages unreadable on every device. Continue?'), { danger: true, ok: t('Start fresh') })) { try { await cx.resetKeys(); S.me.hasKey = true; retry(); } catch (e) { toastErr(e); } } } }, t('Start fresh with a new key'));
    let body;
    if (ks.s === 'unsupported') body = [h('h3', t('Encryption needs a secure connection')), h('p.muted', t('Your browser only allows encryption on https:// sites or on localhost. Open Nebulix through its https link, or on the computer running it.'))];
    else body = [h('h3', t('Unlock your encrypted messages')), h('p.muted', ks.s === 'restore' ? t('Your messages are protected by a key that lives on your devices. This device does not have it yet.') : t('This device has a different key than your account. It was probably reset somewhere else.')),
      ks.hasBackup ? h('div.col', pass, err, restore) : h('p.small.muted', t('You have no key backup, so the old key cannot be recovered.')), fresh];
    mount(main, h('div.dm-gate', h('div.card.col', { style: 'max-width:440px;margin:auto' }, body)));
  }

  function paintMain() {
    const wrap = root.querySelector('.dm-wrap'); if (wrap) wrap.classList.toggle('chat-open', !!peerId);
    if (!peerId || !peer) { mount(main, h('div.dm-empty', emptyState('🔒', t('Private by design'), t('Pick a chat or add a friend. Messages are encrypted on your device and only your friend can read them — not even the server can.')))); return; }
    const canSend = !!peerPub;
    const ta = h('textarea.input.dm-ta', { rows: '1', placeholder: canSend ? t('Message {n}', { n: peer.displayName || peer.username }) : t('{n} has not enabled encryption yet', { n: peer.displayName || peer.username }), maxlength: String(MAX_LEN), disabled: !canSend, 'aria-label': t('Message') });
    const sendBtn = h('button.btn.primary.icon', { 'aria-label': t('Send'), disabled: !canSend, onClick: send }, icon('send', 18));
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; if (ta.value.trim() && Date.now() - typedAt > 2500) { typedAt = Date.now(); api.post(`/api/dm/${peerId}/typing`, {}, { quiet: true }).catch(() => {}); } });
    const emoji = h('button.btn.ghost.icon', { 'aria-label': t('Emoji'), disabled: !canSend, onClick: (e) => emojiPicker(e.currentTarget, (em) => { ta.value += em; ta.focus(); }) }, icon('smile', 20));
    const pic = h('button.btn.ghost.icon', { 'aria-label': t('Send an image'), title: t('Send an image'), disabled: !canSend, onClick: async () => { const f = await pickFile('image/png,image/jpeg,image/gif,image/webp'); if (f) sendImage(f); } }, icon('image', 19));
    ta.addEventListener('paste', (e) => { const f = [...(e.clipboardData ? e.clipboardData.files : [])].find((x) => x.type.startsWith('image/')); if (f) { e.preventDefault(); sendImage(f); } });
    const mic = h('button.btn.ghost.icon', { 'aria-label': t('Record a voice message'), title: t('Record a voice message'), disabled: !canSend, onClick: recordVoice }, icon('mic', 19));
    const head = h('div.dm-head', h('button.btn.ghost.icon.dm-back', { 'aria-label': t('Back'), onClick: close }, icon('back', 20)), avatarEl(online(peer), { size: 40, status: true }), h('div.grow', h('div.row', { style: 'gap:8px' }, nameEl(peer, { size: '1.05rem' }), badgesEl(peer)), h('div.tiny.muted', S.online.has(peer.id) ? t('Online') : t('Offline'))),
      h('button.btn.ghost.icon', { title: t('Share your screen'), 'aria-label': t('Share your screen'), onClick: () => rtc.startShare(peer) }, icon('share', 18)),
      h('button.btn.sm', { onClick: showSafety, title: t('Verify encryption') }, icon('lock', 15), t('Encrypted')), h('button.btn.ghost.icon', { 'aria-label': t('More'), onClick: (e) => userMenu(peer, e) }, icon('more', 18)));
    const banner = keyChanged ? h('div.ann.dm-warn', h('div.grow', h('b', t('{n}\'s encryption key changed', { n: peer.displayName || peer.username })), h('div.small', t('This happens when they reset their key or sign in on a new device. Compare the safety number before sharing anything private.'))),
      h('div.col', { style: 'gap:6px' }, h('button.btn.sm', { onClick: showSafety }, t('Safety number')), h('button.btn.sm.primary', { onClick: () => { cx.trustPeerKey(peer.id, peer._fp); keyChanged = false; paintMain(); } }, t('Trust new key')))) : null;
    const box = h('div.dm-msgs', { role: 'log', 'aria-live': 'polite' }); box._ta = ta;
    mount(main, head, banner, box, h('div.dm-compose', emoji, pic, ta, mic, sendBtn), h('div.tiny.muted.center', { style: 'padding:2px 0 6px' }, t('End-to-end encrypted')));
    paintMsgs(true); if (shown) setTimeout(() => ta.focus(), 30);
  }
  function msgEl(m, prev) {
    const mine = m.f === S.me.id; const author = mine ? S.me : peer; const gap = !prev || prev.f !== m.f || m.t - prev.t > 300000;
    const content = m.text === null ? h('i.muted', t('Cannot be decrypted on this device'))
      : m.v ? voice.player(() => decryptVoice(m), m.v.dur, m.v.url)
        : m.img ? imgEl(m)
        : [richText(m._tr && m._tr.text ? m._tr.text : m.text, { go, me: S.me.username }), m._tr ? h('div.cm-trnote', icon('translate', 11), m._tr.loading ? t('Translating…') : t('Translated'), m._tr.loading ? null : h('button', { type: 'button', onClick: () => { m._tr = null; paintMsgs(false); } }, t('Show original'))) : null];
    const bub = h('div.bub' + (m.v || m.img ? '.bub-voice' : ''), { style: m.v || m.img ? null : bubbleStyle(author) || null, onContextmenu: (e) => { e.preventDefault(); msgMenu(m, e); } }, content);
    return h('div.dm-msg' + (mine ? '.me' : '.them') + (gap ? '.gap' : ''), { dataset: { id: m.id } }, !mine && gap ? avatarEl(peer, { size: 34 }) : h('span', { style: 'width:34px;flex:none' }), h('div.col', { style: 'gap:2px;min-width:0;align-items:' + (mine ? 'flex-end' : 'flex-start') }, gap ? h('div.tiny.muted', (mine ? t('You') : peer.displayName || peer.username) + ' · ' + fmt.time(m.t)) : null, bub));
  }
  function msgMenu(m, e) {
    openMenu([m.text !== null ? { label: t('Copy text'), icon: 'copy', onClick: () => navigator.clipboard && navigator.clipboard.writeText(m.text) } : null,
      m.text ? { label: t('Translate'), icon: 'translate', onClick: () => translateMsg(m) } : null,
      m.f === S.me.id ? { label: t('Delete for everyone'), icon: 'trash', danger: true, onClick: async () => { try { await api.del(`/api/dm/${peerId}/messages/${m.id}`); } catch (er) { toastErr(er); } } } : null].filter(Boolean), e);
  }
  function paintMsgs(bottom) {
    const box = main.querySelector('.dm-msgs'); if (!box) return; const near = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    clear(box);
    if (more) box.appendChild(h('button.btn.sm.ghost', { style: 'align-self:center', onClick: loadOlder }, t('Load older messages')));
    if (!msgs.length) box.appendChild(h('div.dm-hello', avatarEl(peer, { size: 72 }), h('b', peer.displayName || peer.username), h('div.small.muted', t('This is the start of your encrypted chat.'))));
    msgs.forEach((m, i) => box.appendChild(msgEl(m, msgs[i - 1])));
    const lastMine = [...msgs].reverse().find((m) => m.f === S.me.id);
    if (lastMine && peerRead && lastMine.id <= peerRead && msgs[msgs.length - 1] === lastMine) box.appendChild(h('div.dm-seen', icon('check', 12), t('Seen')));
    if (bottom || near) box.scrollTop = box.scrollHeight;
  }
  async function loadOlder() {
    if (!msgs.length) return; try { const r = await api.get(`/api/dm/${peerId}/messages?before=${encodeURIComponent(msgs[0].id)}`); more = r.more; msgs = (await decryptAll(r.messages)).concat(msgs); const box = main.querySelector('.dm-msgs'); const h0 = box.scrollHeight; paintMsgs(false); box.scrollTop = box.scrollHeight - h0; } catch (e) { toastErr(e); }
  }
  async function send() {
    const ta = main.querySelector('.dm-ta'); if (!ta || ta.disabled) return; const text = ta.value.replace(/\s+$/, ''); if (!text.trim()) return;
    if (text.length > MAX_LEN) return toast(t('Messages can be up to {n} characters.', { n: MAX_LEN }), 'err');
    ta.disabled = true;
    try { const s = await cx.seal(convId, peerPub, text); const r = await api.post(`/api/dm/${peerId}/messages`, s); addMsg(r.message, text); ta.value = ''; ta.style.height = 'auto'; sfx.click(); }
    catch (e) { toastErr(e); if (e.code === 'peer_no_key') { peerPub = null; paintMain(); } }
    finally { ta.disabled = false; ta.focus(); }
  }
  function paintTyping() {
    const el = main.querySelector('.dm-head .tiny'); if (!el || !peer) return;
    el.textContent = Date.now() < typingUntil ? t('{n} is typing…', { n: peer.displayName || peer.username }) : (S.online.has(peer.id) ? t('Online') : t('Offline'));
    el.classList.toggle('dm-typing', Date.now() < typingUntil);
  }
  function addMsg(m, text, v, img) { if (msgs.some((x) => x.id === m.id)) return; msgs.push({ id: m.id, f: m.f, t: m.t, text, v: v || null, img: img || null }); paintMsgs(true); }
  // ----- images: re-encoded on this device (drops EXIF/location data), encrypted, uploaded as opaque bytes -----
  const imgUrls = new Map();
  function imgEl(m) {
    const w = Math.min(320, m.img.w || 320); const hh = m.img.w && m.img.h ? Math.round(w * m.img.h / m.img.w) : 200;
    const el = h('div.dm-img', { style: `width:${w}px;height:${hh}px` });
    const show = (url) => { el.replaceChildren(h('img', { src: url, alt: '', onClick: () => modal({ cls: 'wide cm-lightbox', body: h('img.cm-big', { src: url, alt: '' }), actions: [{ label: t('Close'), kind: 'primary' }] }) })); };
    if (imgUrls.has(m.id)) show(imgUrls.get(m.id));
    else decryptFile(m, m.img).then((url) => { imgUrls.set(m.id, url); show(url); }).catch(() => el.replaceChildren(h('i.muted.small', t('Cannot be decrypted on this device'))));
    return el;
  }
  async function decryptFile(m, d) {
    const res = await fetch(d.url, { credentials: 'same-origin' }); if (!res.ok) throw new Error('fetch');
    const plain = await cx.openBytes(convId, peerPub, m.f, d.iv, new Uint8Array(await res.arrayBuffer()));
    return URL.createObjectURL(new Blob([plain], { type: String(d.mime || 'image/jpeg') }));
  }
  async function prepImage(file) {
    if (file.type === 'image/gif' && file.size < 4 << 20) { const bmp = await createImageBitmap(file); return { blob: file, w: bmp.width, h: bmp.height, mime: 'image/gif' }; } // keep animations
    const bmp = await createImageBitmap(file); const k = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86)); return { blob, w: c.width, h: c.height, mime: 'image/jpeg' };
  }
  async function sendImage(file) {
    if (!peerPub) return;
    try {
      const p = await prepImage(file); if (p.blob.size > 4 << 20) return toast(t('That image is too large (max 4 MB).'), 'err');
      const enc = await cx.sealBytes(convId, peerPub, new Uint8Array(await p.blob.arrayBuffer()));
      const up = await api.upload('blob', new Blob([enc.data], { type: 'application/octet-stream' }));
      const img = { url: up.url, iv: enc.iv, mime: p.mime, w: p.w, h: p.h };
      const r = await api.post(`/api/dm/${peerId}/messages`, await cx.seal(convId, peerPub, '', { img })); addMsg(r.message, '', null, img); sfx.click();
    } catch (e) { toastErr(e); }
  }
  // ----- voice notes: recorded here, encrypted with the chat key, uploaded as opaque bytes -----
  const voiceUrls = new Map();
  async function decryptVoice(m) {
    if (voiceUrls.has(m.id)) return voiceUrls.get(m.id);
    const res = await fetch(m.v.url, { credentials: 'same-origin' }); if (!res.ok) throw new Error('fetch');
    const plain = await cx.openBytes(convId, peerPub, m.f, m.v.iv, new Uint8Array(await res.arrayBuffer()));
    const url = URL.createObjectURL(new Blob([plain], { type: String(m.v.mime || 'audio/webm').split(';')[0] })); voiceUrls.set(m.id, url); return url;
  }
  async function recordVoice() {
    const comp = main.querySelector('.dm-compose'); if (!comp || !peerPub) return;
    const rec = await voice.record(comp); if (!rec) return;
    try {
      const enc = await cx.sealBytes(convId, peerPub, new Uint8Array(await rec.blob.arrayBuffer()));
      const up = await api.upload('blob', new Blob([enc.data], { type: 'application/octet-stream' }));
      const v = { url: up.url, iv: enc.iv, dur: rec.dur, mime: rec.mime };
      const s = await cx.seal(convId, peerPub, '', { v });
      const r = await api.post(`/api/dm/${peerId}/messages`, s); addMsg(r.message, '', v); sfx.click();
    } catch (e) { toastErr(e); }
  }
  // Translating a DM sends that one message (decrypted on your device) to the server's translator, so ask once.
  async function translateMsg(m) {
    if (!ls('dmTranslateOk')) { if (!(await confirmBox(t('To translate, this message is sent to the translator (your Nebulix server and, if no AI is connected, MyMemory). It leaves the end-to-end encryption for that moment. Continue?'), { ok: t('Translate') }))) return; ls('dmTranslateOk', true); }
    m._tr = { loading: true }; paintMsgs(false);
    try { const r = await translate(m.text); m._tr = { text: r.text }; } catch (e) { m._tr = null; toastErr(e); }
    paintMsgs(false);
  }
  async function markRead() { if (!peerId) return; try { await api.post(`/api/dm/${peerId}/read`); const c = convs.find((x) => x.peer.id === peerId); if (c) c.unread = 0; syncBadge(); paintList(); } catch {} }
  async function showSafety() {
    if (!peerPub) return; let num = ''; try { num = await cx.safetyNumber(peerPub); } catch { return; }
    modal({ title: t('Safety number'), cls: 'narrow', body: h('div.col', h('p.small.muted', t('If this number is the same on your screen and on {n}\'s screen, nobody is intercepting your messages. Compare it in person or over a call.', { n: peer.displayName || peer.username })),
      h('div.safety', num.split(' ').map((g) => h('span', g))), h('div.row', { style: 'justify-content:center' }, copyBtn(num, t('Copy number')))), actions: [{ label: t('Done'), kind: 'primary' }] });
  }

  // ---------- realtime ----------
  unsubs.push(
    bus.on('ws:dm', async (m) => {
      const other = m.from === S.me.id ? m.to : m.from;
      if (other === peerId && convId === m.conv) {
        if (m.from === peerId) { typingUntil = 0; paintTyping(); }
        const p = await unpack(m.m); addMsg(m.m, p.text, p.v, p.img);
        if (m.from !== S.me.id && shown && document.hasFocus()) markRead();
      }
      loadConvsSoon();
    }),
    bus.on('ws:dm_typing', (m) => { if (m.from !== peerId) return; typingUntil = Date.now() + 4000; paintTyping(); clearTimeout(typingTimer); typingTimer = setTimeout(paintTyping, 4100); }),
    bus.on('ws:dm_read', (m) => { if (m.conv === convId) { peerRead = m.id; paintMsgs(false); } }),
    bus.on('ws:dm_del', (m) => { if (m.conv === convId) { msgs = msgs.filter((x) => x.id !== m.id); paintMsgs(false); } }),
    bus.on('ws:key', (m) => { if (m.id === peerId) open(peerId); }),
    bus.on('friends', () => { paintList(); }),
    bus.on('presence', () => { paintList(); const hd = main.querySelector('.dm-head .tiny'); if (hd && peer) hd.textContent = S.online.has(peer.id) ? t('Online') : t('Offline'); }),
    bus.on('ws:open', () => { loadConvs(); }),
  );
  const loadConvsSoon = debounce(loadConvs, 300);
  const onFocus = () => { if (shown && peerId) markRead(); };
  window.addEventListener('focus', onFocus);

  return {
    async init(ctx) { paintTabs(); paintMain(); await Promise.all([loadConvs(), refreshFriends()]); },
    activate(ctx) {
      shown = true; const want = ctx && ctx.params && ctx.params[0]; S.activePeer = peerId;
      if (want && want !== peerId) open(want); else if (peerId) markRead(); loadConvs();
    },
    deactivate() { shown = false; S.activePeer = null; },
    destroy() { shown = false; S.activePeer = null; unsubs.forEach((f) => f()); window.removeEventListener('focus', onFocus); cx.forget(); },
  };
}

export default {
  title: () => t('Messages'), full: true,
  async mount(root, ctx) { inst = build(root, ctx.go); await inst.init(ctx); inst.activate(ctx); return () => { if (inst) inst.destroy(); inst = null; }; },
  activate(ctx) { if (inst) inst.activate(ctx); },
  deactivate() { if (inst) inst.deactivate(); },
};

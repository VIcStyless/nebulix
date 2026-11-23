// Screen sharing between friends over WebRTC. The server only relays the handshake (ring/accept/offer/answer/ICE)
// through the realtime socket; the video itself flows peer-to-peer and is encrypted by WebRTC (DTLS-SRTP).
import { h } from './util.js';
import { t } from './i18n.js';
import { ws } from './api.js';
import { S, bus } from './state.js';
import { icon } from './icons.js';
import { toast, modal } from './ui.js';
import { sfx } from './sfx.js';

const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }];
let call = null; // { id, peer, role: 'host'|'viewer', pc, stream, ui, ringModal, timer }
const send = (to, d) => ws.send({ t: 'rtc', to, d });
const nameOf = (u) => (u && (u.displayName || u.username)) || t('Your friend');

export const supported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && window.RTCPeerConnection);
export const busy = () => !!call;

function newPc(peerId) {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  pc.onicecandidate = (e) => { if (e.candidate && call) send(peerId, { kind: 'ice', call: call.id, c: e.candidate.toJSON() }); };
  pc.onconnectionstatechange = () => { if (!call) return; if (pc.connectionState === 'failed') { toast(t('The connection failed. Your networks may block direct connections.'), 'err', 7000); end(true); } else if (pc.connectionState === 'disconnected') { setTimeout(() => { if (call && call.pc === pc && pc.connectionState === 'disconnected') end(true); }, 4000); } };
  return pc;
}

// ---------- host ----------
export async function startShare(peer) {
  if (!supported()) return toast(t('Your browser cannot share the screen here. Use Chrome, Edge or Firefox over https or localhost.'), 'err');
  if (call) return toast(t('You are already in a screen share.'), 'err');
  let stream;
  try { stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 60 } }, audio: true }); } catch (e) { if (e && e.name !== 'NotAllowedError') toast(t('Could not start screen capture.'), 'err'); return; }
  call = { id: Math.random().toString(36).slice(2, 12), peer, role: 'host', stream, pc: null };
  stream.getVideoTracks()[0].addEventListener('ended', () => end(true));
  send(peer.id, { kind: 'ring', call: call.id, mode: 'screen' });
  hostPill(t('Waiting for {n} to accept…', { n: nameOf(peer) }));
  call.timer = setTimeout(() => { if (call && !call.pc) { toast(t('{n} did not answer.', { n: nameOf(peer) }), 'info'); end(true); } }, 45000);
}
function hostPill(text) {
  if (call.ui) call.ui.remove();
  const preview = h('video', { muted: true, autoplay: true, playsinline: true, style: 'width:56px;height:32px;border-radius:5px;object-fit:cover;background:#000' }); preview.srcObject = call.stream;
  call.ui = h('div.share-pill', h('span.rdot'), preview, h('span', text), h('button.btn.sm.danger', { onClick: () => end(true) }, icon('stop', 13), t('Stop')));
  document.body.appendChild(call.ui);
}
async function onAccept(from) {
  if (!call || call.role !== 'host' || call.peer.id !== from) return;
  clearTimeout(call.timer);
  const pc = call.pc = newPc(from);
  call.stream.getTracks().forEach((tr) => pc.addTrack(tr, call.stream));
  const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
  send(from, { kind: 'offer', call: call.id, sdp: pc.localDescription.toJSON() });
  hostPill(t('Sharing your screen with {n}', { n: nameOf(call.peer) }));
}

// ---------- viewer ----------
function onRing(from, d, u) {
  if (call) return send(from, { kind: 'decline', call: d.call, why: 'busy' });
  if ((S.friends.blocked || []).some((b) => b.id === from)) return send(from, { kind: 'decline', call: d.call });
  sfx.msg();
  const p = modal({ title: t('Screen share request'), cls: 'narrow', dismissable: false,
    body: h('div.call-card', h('div.empty-art', icon('share', 24)), h('div', h('b', nameOf(u)), h('div.small.muted', t('wants to share their screen with you.')))),
    actions: [{ label: t('Decline'), value: false }, { label: t('Watch'), kind: 'primary', value: true }] });
  const tm = setTimeout(() => p.close(false), 40000);
  p.then((ok) => {
    clearTimeout(tm);
    if (!ok) return send(from, { kind: 'decline', call: d.call });
    call = { id: d.call, peer: u || { id: from }, role: 'viewer', pc: newPc(from) };
    call.pc.ontrack = (e) => showVideo(e.streams[0]);
    send(from, { kind: 'accept', call: d.call });
  });
}
async function onOffer(from, d) {
  if (!call || call.role !== 'viewer' || call.id !== d.call) return;
  await call.pc.setRemoteDescription(d.sdp);
  const ans = await call.pc.createAnswer(); await call.pc.setLocalDescription(ans);
  send(from, { kind: 'answer', call: call.id, sdp: call.pc.localDescription.toJSON() });
}
function showVideo(stream) {
  if (!call) return; if (call.ui) call.ui.remove();
  const v = h('video', { autoplay: true, playsinline: true }); v.srcObject = stream;
  const win = h('div.share-win', v, h('div.sw-bar', icon('share', 14), h('span.grow', t('{n} is sharing their screen', { n: nameOf(call.peer) })),
    h('button.btn.ghost.icon.sm', { title: t('Full screen'), 'aria-label': t('Full screen'), onClick: () => (v.requestFullscreen ? v.requestFullscreen() : null) }, icon('fullscreen', 15)),
    h('button.btn.ghost.icon.sm', { title: t('Close'), 'aria-label': t('Close'), onClick: () => end(true) }, icon('x', 15))));
  // drag the window by its bar
  const bar = win.querySelector('.sw-bar'); let sx, sy, ox, oy;
  bar.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; sx = e.clientX; sy = e.clientY; const r = win.getBoundingClientRect(); ox = r.left; oy = r.top; bar.setPointerCapture(e.pointerId); });
  bar.addEventListener('pointermove', (e) => { if (sx === undefined) return; win.style.left = Math.max(0, ox + e.clientX - sx) + 'px'; win.style.top = Math.max(0, oy + e.clientY - sy) + 'px'; win.style.right = 'auto'; win.style.bottom = 'auto'; });
  bar.addEventListener('pointerup', () => { sx = undefined; });
  call.ui = win; document.body.appendChild(win);
}

// ---------- shared ----------
function end(notify) {
  if (!call) return; const c = call; call = null;
  clearTimeout(c.timer);
  if (notify) send(c.peer.id, { kind: 'end', call: c.id });
  try { c.pc && c.pc.close(); } catch {}
  if (c.stream) c.stream.getTracks().forEach((tr) => tr.stop());
  if (c.ui) c.ui.remove();
}
export const stop = () => end(true);

export function wire() {
  bus.on('ws:rtc', async (m) => {
    const d = m.d || {};
    try {
      if (d.kind === 'ring') onRing(m.from, d, m.u);
      else if (d.kind === 'accept') await onAccept(m.from);
      else if (d.kind === 'decline') { if (call && call.id === d.call) { toast(d.why === 'busy' ? t('{n} is busy right now.', { n: nameOf(call.peer) }) : t('{n} declined.', { n: nameOf(call.peer) })); end(false); } }
      else if (d.kind === 'offer') await onOffer(m.from, d);
      else if (d.kind === 'answer') { if (call && call.id === d.call && call.pc) await call.pc.setRemoteDescription(d.sdp); }
      else if (d.kind === 'ice') { if (call && call.id === d.call && call.pc && d.c) await call.pc.addIceCandidate(d.c).catch(() => {}); }
      else if (d.kind === 'end') { if (call && call.id === d.call) { toast(t('The screen share ended.')); end(false); } }
    } catch (e) { console.warn('[rtc]', e); }
  });
  bus.on('ws:rtc_err', (m) => { if (call && (!m.call || m.call === call.id)) { toast(m.error === 'offline' ? t('{n} is offline.', { n: nameOf(call.peer) }) : t('You cannot share your screen with this person.'), 'err'); end(false); } });
  window.addEventListener('beforeunload', () => end(true));
}

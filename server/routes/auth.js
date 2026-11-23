'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const cfg = require('../config');
const { S, hub, selfUser, publicUser, audit, hasOwner } = require('../state');
const econ = require('../economy');
const mail = require('../mail');
const totp = require('../totp');
const { HttpError, rid, sha256, hmac, now, safeEqual, parseCookies, cookieStr, Limiter, Semaphore, V, WEAK, maskEmail } = require('../util');

const scrypt = promisify(crypto.scrypt);
const hashSem = new Semaphore(3);
const COOKIE = () => (cfg.secureCookies ? '__Host-nx_sid' : 'nx_sid');
const RESERVED = new Set(['vicstyles', 'nebulix', 'admin', 'administrator', 'mod', 'moderator', 'system', 'support', 'staff', 'nova', 'owner', 'root', 'official', 'everyone', 'here', 'null', 'undefined']);

async function hashPw(pw) {
  return hashSem.run(async () => {
    const salt = crypto.randomBytes(16);
    const h = await scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    return `s1$${salt.toString('base64')}$${h.toString('base64')}`;
  });
}
async function checkPw(pw, stored) {
  return hashSem.run(async () => {
    const [v, s, h] = String(stored).split('$');
    if (v !== 's1') return false;
    const hh = await scrypt(pw, Buffer.from(s, 'base64'), 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const want = Buffer.from(h, 'base64');
    return want.length === hh.length && crypto.timingSafeEqual(hh, want);
  });
}
let DUMMY = null;

function isLocalReq(req) {
  const ra = req.socket.remoteAddress;
  const loop = ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1';
  return loop && !req.headers['x-forwarded-for'] && !req.headers['cf-connecting-ip'] && cfg.isLoopbackHost(req.headers.host);
}

// On a private local server with no mail configured, the owner sees the code on screen instead of hunting the terminal.
function devCode(req, code) {
  if (cfg.devShowCode && !cfg.isPublic) return code;
  if (mail.mode() === 'console' && !cfg.isPublic && isLocalReq(req)) return code;
  return undefined;
}

// True on a public server that has no way to deliver email (codes would only reach the server log).
const noMail = () => mail.mode() === 'console' && cfg.isPublic;

function newUser({ username, email, pass, lang }) {
  const id = 'u' + rid(8);
  return {
    id, username, usernameLower: username.toLowerCase(), email, emailLower: (email || '').toLowerCase(), pass, verified: false,
    created: now(), lang, role: 'user', coins: 0, tx: [], inv: {}, eq: {}, daily: { last: 0, streak: 0 },
    displayName: username, bio: '', avatar: null, banner: null, bannerColor: null, proUntil: 0,
    friends: [], incoming: [], outgoing: [], blocked: [], settings: { dm: 'everyone' }, bookmarks: [], stats: {},
    uploadBytes: 0, themesPublished: 0, pub: null, keyBackup: null,
  };
}

function issueCode(u, kind) {
  const slot = kind === 'verify' ? 'vcode' : 'rcode';
  const prev = u[slot];
  if (prev && now() - prev.sent < 45000) throw new HttpError(429, 'too_soon', 'Wait a few seconds before requesting another code');
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  u[slot] = { h: hmac(cfg.secret, u.id + ':' + kind + ':' + code), exp: now() + 10 * 60000, tries: 0, sent: now() };
  S.store.touch('users');
  return code;
}
function checkCode(u, kind, code) {
  const slot = kind === 'verify' ? 'vcode' : 'rcode';
  const c = u[slot];
  if (!c || c.exp < now()) throw new HttpError(400, 'code_expired', 'This code expired. Request a new one.');
  if (c.tries >= 5) throw new HttpError(429, 'too_many_tries', 'Too many wrong codes. Request a new one.');
  c.tries++; S.store.touch('users');
  if (!/^\d{6}$/.test(String(code)) || !safeEqual(c.h, hmac(cfg.secret, u.id + ':' + kind + ':' + code))) throw new HttpError(400, 'bad_code', 'Wrong code');
  u[slot] = null;
}

// The emailed link carries the same one-time code, so opening it is the same as typing the code.
const linkFor = (kind, u, code) => `${cfg.appOrigin}/#/link?a=${kind}&u=${u.id}&c=${code}`;

// Alt accounts: besides the active session cookie, the browser keeps an HttpOnly list of the other accounts it is
// signed in to (their session tokens, max 5). Switching only swaps which of those sessions is active; every
// account still had to sign in with its own password (and 2FA) once.
const ALTS = () => (cfg.secureCookies ? '__Host-nx_alts' : 'nx_alts');
const MAX_ALTS = 5;
function sessionOf(tok) {
  if (!tok || tok.length > 80) return null;
  const s = S.sessions[sha256(tok)]; if (!s || now() - s.created > 30 * 86400000) return null;
  const u = S.users[s.uid]; if (!u || u.deleted || (u.banned && (!u.banned.until || u.banned.until > now()))) return null;
  return u;
}
function altTokens(req) { return String(parseCookies(req.headers.cookie)[ALTS()] || '').split('.').filter((x) => /^[\w-]{20,80}$/.test(x)); }
function setCookies(c, active, alts) {
  const out = [];
  if (active !== undefined) out.push(cookieStr(COOKIE(), active || '', { maxAge: active ? 30 * 86400 : 0, secure: cfg.secureCookies }));
  if (alts !== undefined) out.push(cookieStr(ALTS(), alts.join('.'), { maxAge: alts.length ? 30 * 86400 : 0, secure: cfg.secureCookies }));
  c.res.setHeader('Set-Cookie', out);
}
function createSession(c, u) {
  const token = rid(32);
  S.sessions[sha256(token)] = { uid: u.id, created: now(), last: now(), ua: String(c.req.headers['user-agent'] || '').slice(0, 140), ip: sha256(c.ip + cfg.secret).slice(0, 8) };
  S.store.touch('sessions');
  // remember it next to the other accounts of this browser (one entry per account, newest first)
  const alts = [token, ...altTokens(c.req).filter((x) => { const o = sessionOf(x); return o && o.id !== u.id; })].slice(0, MAX_ALTS);
  setCookies(c, token, alts);
}

function fromRequest(req) {
  const tok = parseCookies(req.headers.cookie)[COOKIE()];
  if (!tok || tok.length > 80) return null;
  const sh = sha256(tok); const s = S.sessions[sh];
  if (!s) return null;
  if (now() - s.created > 30 * 86400000) { delete S.sessions[sh]; return null; }
  const u = S.users[s.uid];
  if (!u || u.deleted) return null;
  if (u.banned && (!u.banned.until || u.banned.until > now())) return null;
  if (now() - s.last > 300000) { s.last = now(); S.store.touch('sessions'); }
  return { user: u, session: s, sh };
}

function revokeUserSessions(uid, exceptHash) {
  for (const [h, s] of Object.entries(S.sessions)) if (s.uid === uid && h !== exceptHash) delete S.sessions[h];
  S.store.touch('sessions');
}

// Sign-in history (last 12): shown in Settings → Security so the owner can spot a login that was not theirs.
const devKey = (c) => sha256(c.ip + cfg.secret).slice(0, 8);
function noteLogin(c, u, ok) {
  const ua = String(c.req.headers['user-agent'] || '').slice(0, 140); const ip = devKey(c);
  const seen = (u.logins || []).some((l) => l.ok && l.ip === ip && l.ua === ua);
  u.logins = [{ t: now(), ua, ip, ok: !!ok }, ...(u.logins || [])].slice(0, 12); S.store.touch('users');
  if (ok && !seen && (u.logins.filter((l) => l.ok).length > 1) && u.email && !u.noEmail && mail.mode() !== 'console') mail.sendAlert(u.email, u.lang || 'en', { ua, when: new Date().toUTCString() }).catch((e) => console.error('[mail]', e.message));
}

function onVerified(u, req) {
  if (u.verified) return;
  u.verified = true;
  if (!u.welcomed) { u.welcomed = true; econ.adjust(u, 50, 'welcome'); }
  S.meta.verifiedCount = (S.meta.verifiedCount || 0) + 1;
  if (S.meta.verifiedCount <= 100) u.early = true;
  if (cfg.adminEmails.includes(u.emailLower)) u.role = 'owner';
  else if (!hasOwner() && isLocalReq(req)) u.role = 'owner';
  S.store.touch('meta'); S.store.touch('users');
  try { require('./chat').joinOfficial(u); } catch (e) { console.error('[auth] joinOfficial failed', e.message); }
  try { require('../progress').checkAchievements(u); } catch {}
}

module.exports = function register(r) {
  const loginIp = new Limiter(30, 600000); const loginId = new Limiter(8, 600000);

  r.get('/api/me', async (c) => {
    const p = require('./pay');
    return {
      user: c.user ? selfUser(c.user) : null,
      config: {
        brand: cfg.brand, creator: cfg.creator, version: cfg.VERSION, proxyOrigin: cfg.proxyOrigin, appOrigin: cfg.appOrigin,
        payments: p.enabled(), proLabels: p.labelsFor(c.user),
        ai: require('./ai').mode(), mail: mail.mode(), canMail: !noMail(), guestProxy: cfg.allowGuestProxy, signups: cfg.signupsOpen,
        fairNote: true, gamesDomain: !!cfg.gamesOrigin, gamesOrigin: cfg.gamesOrigin,
      },
    };
  });

  r.post('/api/auth/signup', { limit: [8, 3600000] }, async (c) => {
    if (!cfg.signupsOpen) throw new HttpError(403, 'closed', 'Sign-ups are closed');
    const { username, password } = c.body; let email = String(c.body.email || '').trim(); const lang = ['es', 'pt', 'fr', 'de', 'it'].includes(c.body.lang) ? c.body.lang : 'en';
    if (!V.username(username)) throw new HttpError(400, 'bad_username', 'Username must be 3-20 characters: letters, numbers or _');
    if (email && !V.email(email)) throw new HttpError(400, 'bad_email', 'Enter a valid email address');
    if (email && noMail()) email = ''; // a public server with no mail service cannot confirm addresses: create the account without one
    if (!V.password(password)) throw new HttpError(400, 'bad_password', 'Password must be 8-128 characters');
    if (WEAK.has(password.toLowerCase())) throw new HttpError(400, 'weak_password', 'That password is too easy to guess');
    const ul = username.toLowerCase(); const el = email.toLowerCase();
    const mayReserve = cfg.adminEmails.includes(el) || (!hasOwner() && isLocalReq(c.req));
    if (RESERVED.has(ul) && !mayReserve) throw new HttpError(409, 'username_taken', 'That username is reserved');
    // Email is optional. Without one the account works straight away; adding and confirming an email later earns the welcome coins and the Verified badge.
    if (!email) {
      if (S.byName.has(ul)) throw new HttpError(409, 'username_taken', 'That username is already taken');
      const nu = newUser({ username, email: '', pass: await hashPw(password), lang });
      nu.verified = true; nu.noEmail = true;
      if (!hasOwner() && isLocalReq(c.req)) nu.role = 'owner';
      S.users[nu.id] = nu; S.byName.set(ul, nu.id); S.store.touch('users');
      try { require('./chat').joinOfficial(nu); } catch (e) { console.error('[auth] joinOfficial failed', e.message); }
      createSession(c, nu); audit('signup_noemail', nu.id, nu.username);
      return { ok: true, user: selfUser(nu) };
    }
    const existing = S.byEmail.get(el);
    if (existing) {
      const ex = S.users[existing];
      if (ex.verified) { mail.sendExists(email, lang).catch((e) => console.error('[mail]', e.message)); }
      else {
        const code = issueCode(ex, 'verify');
        await mail.sendCode(ex.email, 'verify', ex.lang || lang, code, linkFor('verify', ex, code)).catch((e) => { console.error('[mail]', e.message); throw new HttpError(502, 'mail_failed', 'We could not send the email'); });
        return { ok: true, verify: true, email: maskEmail(email), emailRaw: email, dev: devCode(c.req, code) };
      }
      return { ok: true, verify: true, email: maskEmail(email), emailRaw: email };
    }
    if (S.byName.has(ul)) throw new HttpError(409, 'username_taken', 'That username is already taken');
    const pass = await hashPw(password);
    const u = newUser({ username, email, pass, lang });
    S.users[u.id] = u; S.byName.set(ul, u.id); S.byEmail.set(el, u.id);
    S.store.touch('users');
    const code = issueCode(u, 'verify');
    try { await mail.sendCode(email, 'verify', lang, code, linkFor('verify', u, code)); } catch (e) {
      console.error('[mail] send failed:', e.message);
      delete S.users[u.id]; S.byName.delete(ul); S.byEmail.delete(el); S.store.touch('users');
      throw new HttpError(502, 'mail_failed', 'We could not send the verification email. The server owner must configure email (see README).');
    }
    return { ok: true, verify: true, email: maskEmail(email), emailRaw: email, dev: devCode(c.req, code) };
  });

  r.post('/api/auth/resend', { limit: [6, 3600000] }, async (c) => {
    const email = String(c.body.email || '').toLowerCase();
    const u = S.users[S.byEmail.get(email)];
    let dev;
    if (u && !u.verified) {
      const code = issueCode(u, 'verify');
      await mail.sendCode(u.email, 'verify', u.lang || 'en', code, linkFor('verify', u, code)).catch((e) => console.error('[mail]', e.message));
      dev = devCode(c.req, code);
    }
    return { ok: true, dev };
  });

  r.post('/api/auth/verify', { limit: [20, 600000] }, async (c) => {
    const email = String(c.body.email || '').toLowerCase();
    const u = S.users[S.byEmail.get(email)];
    if (!u) throw new HttpError(400, 'bad_code', 'Wrong code');
    if (u.verified) throw new HttpError(400, 'already_verified', 'This account is already verified. Log in.');
    checkCode(u, 'verify', String(c.body.code || '').trim());
    onVerified(u, c.req);
    createSession(c, u);
    audit('verify', u.id, u.username);
    return { ok: true, welcome: 50, user: selfUser(u) };
  });

  // Add an email to an account that was created without one (step 1: send the code).
  r.post('/api/auth/email', { auth: true, limit: [6, 3600000, 'user'] }, async (c) => {
    const u = c.user; const email = String(c.body.email || '').trim(); const el = email.toLowerCase();
    if (!u.noEmail) throw new HttpError(400, 'has_email', 'This account already has an email');
    if (noMail()) throw new HttpError(503, 'mail_off', 'Email is not set up on this server yet. Try again later.');
    if (!V.email(email)) throw new HttpError(400, 'bad_email', 'Enter a valid email address');
    if (S.byEmail.has(el)) throw new HttpError(409, 'email_taken', 'That email is already used by another account');
    const code = issueCode(u, 'verify'); u.pendEmail = { email, at: now() }; S.store.touch('users');
    try { await mail.sendCode(email, 'verify', u.lang || 'en', code, linkFor('addmail', u, code)); } catch (e) {
      console.error('[mail] send failed:', e.message); u.pendEmail = null; u.vcode = null; S.store.touch('users');
      throw new HttpError(502, 'mail_failed', 'We could not send the verification email. Try again later.');
    }
    return { ok: true, email: maskEmail(email), dev: devCode(c.req, code) };
  });
  // Step 2: confirm the code → the email is saved and the reward is paid once.
  const completeEmail = (u, code) => {
    const p = u.pendEmail;
    if (!u.noEmail || !p) throw new HttpError(400, 'bad_code', 'Wrong code');
    const el = p.email.toLowerCase();
    if (S.byEmail.has(el)) { u.pendEmail = null; S.store.touch('users'); throw new HttpError(409, 'email_taken', 'That email is already used by another account'); }
    checkCode(u, 'verify', code);
    u.email = p.email; u.emailLower = el; u.pendEmail = null; u.noEmail = false; S.byEmail.set(el, u.id);
    let welcome = 0;
    if (!u.welcomed) { u.welcomed = true; welcome = 50; econ.adjust(u, 50, 'welcome'); }
    S.meta.verifiedCount = (S.meta.verifiedCount || 0) + 1; if (S.meta.verifiedCount <= 100) u.early = true;
    if (cfg.adminEmails.includes(el)) u.role = 'owner';
    S.store.touch('meta'); S.store.touch('users');
    try { require('../progress').checkAchievements(u); } catch {}
    audit('email_added', u.id, u.username);
    return { ok: true, welcome, user: selfUser(u) };
  };
  r.post('/api/auth/email/verify', { auth: true, limit: [20, 600000, 'user'] }, async (c) => completeEmail(c.user, String(c.body.code || '').trim()));

  // The link in the email: confirms a new account (and signs it in) or an added email, with the same one-time code.
  r.post('/api/auth/link', { limit: [20, 600000] }, async (c) => {
    const u = S.users[String(c.body.u || '')]; const code = String(c.body.c || '').trim(); const a = c.body.a;
    if (!u || u.deleted) throw new HttpError(400, 'bad_code', 'This link is no longer valid. Request a new one.');
    if (a === 'addmail') { const r2 = completeEmail(u, code); return { ok: true, welcome: r2.welcome, user: c.user && c.user.id === u.id ? r2.user : undefined }; }
    if (a !== 'verify') throw new HttpError(400, 'bad_request', 'This link is no longer valid. Request a new one.');
    if (u.verified) throw new HttpError(400, 'already_verified', 'This account is already verified. Log in.');
    checkCode(u, 'verify', code);
    onVerified(u, c.req); createSession(c, u); audit('verify', u.id, u.username);
    return { ok: true, welcome: 50, user: selfUser(u) };
  });

  r.post('/api/auth/login', async (c) => {
    const id = String(c.body.id || '').trim().toLowerCase(); const password = String(c.body.password || '');
    if (!id || !password || id.length > 254 || password.length > 128) throw new HttpError(400, 'bad_request', 'Enter your username/email and password');
    if (!loginIp.hit(c.ip) || !loginId.hit(id)) { const e = new HttpError(429, 'rate_limited', 'Too many attempts. Try again in a few minutes.'); e.retryAfter = 300; throw e; }
    const uid = S.byEmail.get(id) || S.byName.get(id);
    const u = uid ? S.users[uid] : null;
    if (!DUMMY) DUMMY = await hashPw('dummy-password');
    const ok = await checkPw(password, u ? u.pass : DUMMY);
    if (u && !ok) noteLogin(c, u, false);
    if (!u || !ok) throw new HttpError(401, 'bad_login', 'Wrong username/email or password');
    if (u.banned && (!u.banned.until || u.banned.until > now())) throw new HttpError(403, 'banned', 'This account is suspended' + (u.banned.reason ? ': ' + u.banned.reason : ''));
    if (!u.verified) {
      loginId.reset(id);
      let sent = true; let dev;
      try { const code = issueCode(u, 'verify'); await mail.sendCode(u.email, 'verify', u.lang || 'en', code, linkFor('verify', u, code)); dev = devCode(c.req, code); } catch (e) { sent = e.status !== 429 ? false : true; }
      return { needsVerify: true, email: maskEmail(u.email), emailRaw: u.email, sent, dev };
    }
    // Two-step verification: the password alone is not enough. The attempt limiter is only cleared after the code is right,
    // so knowing the password does not allow unlimited guesses at the 6 digits.
    if (u.tfa && u.tfa.on) {
      const code = String(c.body.code || '').trim();
      if (!code) return { needs2fa: true };
      if (!totp.check(u, code)) { noteLogin(c, u, false); throw new HttpError(401, 'bad_2fa', 'Wrong verification code'); }
      S.store.touch('users');
    }
    loginId.reset(id);
    createSession(c, u); noteLogin(c, u, true);
    return { ok: true, user: selfUser(u) };
  });

  // ----- two-step verification -----
  r.post('/api/auth/2fa/setup', { auth: true, limit: [10, 3600000, 'user'] }, async (c) => {
    const u = c.user;
    if (u.tfa && u.tfa.on) throw new HttpError(400, 'tfa_on', 'Two-step verification is already on');
    if (!(await checkPw(String(c.body.password || ''), u.pass))) throw new HttpError(403, 'bad_password', 'Wrong password');
    const secret = totp.newSecret(); u.tfa = { on: false, pend: totp.seal(secret) }; S.store.touch('users');
    return { secret, uri: totp.uri(u.username, secret) };
  });
  r.post('/api/auth/2fa/enable', { auth: true, limit: [20, 600000, 'user'] }, async (c) => {
    const u = c.user; const t = u.tfa;
    if (!t || t.on || !t.pend) throw new HttpError(400, 'bad_request', 'Start the setup again');
    const step = totp.verify(totp.open(t.pend), c.body.code);
    if (!step) throw new HttpError(400, 'bad_2fa', 'Wrong verification code');
    const codes = totp.newBackupCodes();
    u.tfa = { on: true, enc: t.pend, last: step, backup: codes.map(totp.hashBackup), since: now() };
    revokeUserSessions(u.id, c.sh); S.store.touch('users'); audit('tfa_on', u.id, u.username);
    return { ok: true, codes, user: selfUser(u) };
  });
  r.post('/api/auth/2fa/disable', { auth: true, limit: [10, 600000, 'user'] }, async (c) => {
    const u = c.user;
    if (!u.tfa || !u.tfa.on) throw new HttpError(400, 'bad_request', 'Two-step verification is not on');
    if (!(await checkPw(String(c.body.password || ''), u.pass))) throw new HttpError(403, 'bad_password', 'Wrong password');
    if (!totp.check(u, String(c.body.code || ''))) throw new HttpError(400, 'bad_2fa', 'Wrong verification code');
    delete u.tfa; S.store.touch('users'); audit('tfa_off', u.id, u.username);
    return { ok: true, user: selfUser(u) };
  });
  r.get('/api/auth/logins', { auth: true }, async (c) => {
    const me = devKey(c); const ua = String(c.req.headers['user-agent'] || '').slice(0, 140);
    return { logins: (c.user.logins || []).map((l) => ({ t: l.t, ua: l.ua, ok: l.ok, here: l.ip === me && l.ua === ua })), backupLeft: c.user.tfa && c.user.tfa.on ? (c.user.tfa.backup || []).length : 0 };
  });

  r.post('/api/auth/logout', { noOrigin: false }, async (c) => {
    if (c.sh) { delete S.sessions[c.sh]; S.store.touch('sessions'); }
    // sign out of this account only; if the browser has other accounts, continue as the most recent one
    const rest = altTokens(c.req).filter((x) => sha256(x) !== c.sh && sessionOf(x));
    if (c.body && c.body.all) { for (const x of rest) delete S.sessions[sha256(x)]; S.store.touch('sessions'); setCookies(c, '', []); return { ok: true }; }
    setCookies(c, rest[0] || '', rest);
    return { ok: true, switched: !!rest[0] };
  });

  // ----- alt accounts -----
  r.get('/api/auth/accounts', { auth: true }, async (c) => {
    const list = []; const seen = new Set();
    for (const tok of altTokens(c.req)) { const u = sessionOf(tok); if (!u || seen.has(u.id)) continue; seen.add(u.id); list.push({ id: u.id, username: u.username, displayName: u.displayName, avatar: u.avatar || null, current: u.id === c.user.id }); }
    if (!seen.has(c.user.id)) list.unshift({ id: c.user.id, username: c.user.username, displayName: c.user.displayName, avatar: c.user.avatar || null, current: true });
    return { accounts: list, max: MAX_ALTS };
  });
  r.post('/api/auth/switch', { auth: true, limit: [30, 60000, 'user'] }, async (c) => {
    const target = String(c.body.id || '');
    const toks = altTokens(c.req); const tok = toks.find((x) => { const u = sessionOf(x); return u && u.id === target; });
    if (!tok) throw new HttpError(404, 'no_account', 'That account is not signed in on this browser. Add it again.');
    const cur = parseCookies(c.req.headers.cookie)[COOKIE()];
    const alts = [tok, ...toks.filter((x) => x !== tok)]; if (cur && !alts.includes(cur) && sessionOf(cur)) alts.push(cur);
    setCookies(c, tok, alts.slice(0, MAX_ALTS));
    return { ok: true, user: selfUser(sessionOf(tok)) };
  });
  // "Add account": leave the current account signed in (kept in the list) and show the login screen.
  r.post('/api/auth/add-account', { auth: true }, async (c) => {
    const toks = altTokens(c.req);
    if (toks.filter((x) => sessionOf(x)).length >= MAX_ALTS) throw new HttpError(400, 'too_many', `Up to ${MAX_ALTS} accounts per browser. Sign out of one first.`);
    const cur = parseCookies(c.req.headers.cookie)[COOKIE()];
    const alts = cur && !toks.includes(cur) ? [cur, ...toks] : toks;
    setCookies(c, '', alts);
    return { ok: true };
  });

  r.post('/api/auth/forgot', { limit: [6, 3600000] }, async (c) => {
    const email = String(c.body.email || '').toLowerCase();
    const u = S.users[S.byEmail.get(email)];
    if (u && u.verified) {
      try { const code = issueCode(u, 'reset'); await mail.sendCode(u.email, 'reset', u.lang || 'en', code, linkFor('reset', u, code)); } catch (e) { if (e.status !== 429) console.error('[mail]', e.message); }
    }
    return { ok: true };
  });

  r.post('/api/auth/reset', { limit: [12, 3600000] }, async (c) => {
    const email = String(c.body.email || '').toLowerCase(); const password = c.body.password;
    const u = c.body.uid ? S.users[String(c.body.uid)] : S.users[S.byEmail.get(email)]; // uid: opened from the emailed link
    if (!u || !u.verified || u.deleted) throw new HttpError(400, 'bad_code', 'Wrong code');
    if (!V.password(password) || WEAK.has(String(password).toLowerCase())) throw new HttpError(400, 'bad_password', 'Choose a stronger password (8+ characters)');
    checkCode(u, 'reset', String(c.body.code || '').trim());
    u.pass = await hashPw(password);
    revokeUserSessions(u.id);
    S.store.touch('users');
    audit('pw_reset', u.id, u.username);
    return { ok: true };
  });

  r.post('/api/auth/password', { auth: true, limit: [10, 600000, 'user'] }, async (c) => {
    const { current, next } = c.body;
    if (!(await checkPw(String(current || ''), c.user.pass))) throw new HttpError(403, 'bad_password', 'Current password is wrong');
    if (!V.password(next) || WEAK.has(String(next).toLowerCase())) throw new HttpError(400, 'bad_password', 'Choose a stronger password (8+ characters)');
    c.user.pass = await hashPw(next);
    revokeUserSessions(c.user.id, c.sh);
    S.store.touch('users');
    return { ok: true };
  });

  r.get('/api/auth/sessions', { auth: true }, async (c) => {
    return {
      sessions: Object.entries(S.sessions).filter(([, s]) => s.uid === c.user.id)
        .map(([h, s]) => ({ id: h.slice(0, 12), current: h === c.sh, created: s.created, last: s.last, ua: s.ua }))
        .sort((a, b) => b.last - a.last),
    };
  });

  r.post('/api/auth/sessions/revoke', { auth: true }, async (c) => {
    if (c.body.all) { revokeUserSessions(c.user.id, c.sh); return { ok: true }; }
    const id = String(c.body.id || '');
    for (const h of Object.keys(S.sessions)) if (S.sessions[h].uid === c.user.id && h.startsWith(id) && h !== c.sh && id.length >= 8) delete S.sessions[h];
    S.store.touch('sessions');
    return { ok: true };
  });

  r.get('/api/auth/export', { auth: true, limit: [5, 3600000, 'user'] }, async (c) => {
    const u = c.user;
    const themes = Object.values(S.themes).filter((t) => t.owner === u.id).map((t) => ({ id: t.id, name: t.name, data: t.data }));
    const { pass, vcode, rcode, tfa, logins, ...rest } = u; void tfa; void logins;
    c.res.setHeader('Content-Disposition', 'attachment; filename="nebulix-data.json"');
    return { exportedAt: new Date().toISOString(), account: rest, publishedThemes: themes };
  });

  r.post('/api/auth/delete', { auth: true, limit: [5, 3600000, 'user'] }, async (c) => {
    const u = c.user;
    if (!(await checkPw(String(c.body.password || ''), u.pass))) throw new HttpError(403, 'bad_password', 'Wrong password');
    if (u.role === 'owner') throw new HttpError(403, 'owner', 'The owner account cannot be deleted from here');
    for (const o of Object.values(S.users)) {
      for (const k of ['friends', 'incoming', 'outgoing', 'blocked']) { const i = (o[k] || []).indexOf(u.id); if (i >= 0) o[k].splice(i, 1); }
    }
    for (const sv of Object.values(S.servers)) { if (sv.members[u.id]) delete sv.members[u.id]; }
    S.byName.delete(u.usernameLower); S.byEmail.delete(u.emailLower);
    revokeUserSessions(u.id);
    Object.assign(u, { deleted: true, email: 'deleted:' + u.id, emailLower: 'deleted:' + u.id, username: 'deleted_' + u.id.slice(1, 6), usernameLower: 'deleted_' + u.id.slice(1, 6), displayName: 'Deleted User', bio: '', avatar: null, banner: null, pub: null, keyBackup: null, pass: '', bookmarks: [], coins: 0, inv: {}, eq: {} });
    S.store.touch('users'); S.store.touch('servers');
    audit('delete_account', u.id, '');
    c.res.setHeader('Set-Cookie', cookieStr(COOKIE(), '', { maxAge: 0, secure: cfg.secureCookies }));
    return { ok: true };
  });
};

module.exports.fromRequest = fromRequest;
module.exports.isLocalReq = isLocalReq;
module.exports.hashPw = hashPw;
module.exports.checkPw = checkPw;
module.exports.COOKIE = COOKIE;

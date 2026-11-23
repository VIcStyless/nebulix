'use strict';
// Outgoing email: SMTP (built-in client), Resend HTTP API, or console fallback for local use.
const net = require('net');
const tls = require('tls');
const cfg = require('./config');
const { rid, escapeHtml } = require('./util');

const outbox = []; // in-memory copy of the last emails (console mode / tests)

function mode() {
  if (cfg.mailMode) return cfg.mailMode;
  if (cfg.resendKey) return 'resend';
  if (cfg.smtp.host) return 'smtp';
  return 'console';
}

function makeSession(socket) {
  let buf = ''; let lines = []; const waiters = []; const queue = []; let err = null;
  const flush = () => {
    while (waiters.length && (queue.length || err)) {
      const w = waiters.shift();
      if (queue.length) w.res(queue.shift()); else w.rej(err);
    }
  };
  const onData = (d) => {
    buf += d.toString('utf8'); let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2); lines.push(line);
      if (/^\d{3}( |$)/.test(line)) { queue.push({ code: +line.slice(0, 3), text: lines.join('\n') }); lines = []; flush(); }
    }
  };
  socket.on('data', onData);
  socket.on('error', (e) => { err = e; flush(); });
  socket.on('close', () => { err = err || new Error('SMTP connection closed'); flush(); });
  return {
    read: () => new Promise((res, rej) => { waiters.push({ res, rej }); flush(); }),
    write: (s) => socket.write(s),
    detach: () => socket.removeListener('data', onData),
  };
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const wrap76 = (s) => s.replace(/(.{76})/g, '$1\r\n');
const encSubject = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const addrOf = (s) => (s.match(/<([^>]+)>/) || [null, s])[1].trim();

function buildMessage({ from, to, subject, text, html }) {
  const boundary = '=_nbx_' + rid(12);
  const domain = (addrOf(from).split('@')[1] || 'localhost');
  const head = [
    `From: ${from}`, `To: <${to}>`, `Subject: ${encSubject(subject)}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${rid(14)}@${domain}>`, 'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].join('\r\n');
  const part = (type, body) => `--${boundary}\r\nContent-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64(body))}\r\n`;
  return `${head}\r\n\r\n${part('text/plain', text)}${part('text/html', html)}--${boundary}--\r\n`;
}

async function smtpSend(c, msg) {
  const { host, port, secure, user, pass, insecureTls } = c;
  const from = msg.from;
  const connect = () => new Promise((resolve, reject) => {
    const s = secure
      ? tls.connect({ host, port, servername: host, rejectUnauthorized: !insecureTls }, () => resolve(s))
      : net.connect({ host, port }, () => resolve(s));
    s.once('error', reject);
    s.setTimeout(20000, () => s.destroy(new Error('SMTP socket timeout')));
  });
  let socket = await connect();
  let ses = makeSession(socket);
  const expect = async (ok) => { const r = await ses.read(); if (!ok.includes(r.code)) throw new Error('SMTP: ' + r.text); return r; };
  const cmd = async (line, ok) => { ses.write(line + '\r\n'); return expect(ok); };
  try {
    await expect([220]);
    let ehlo = await cmd('EHLO nebulix.local', [250]);
    if (!secure && /STARTTLS/i.test(ehlo.text)) {
      await cmd('STARTTLS', [220]);
      ses.detach();
      socket = tls.connect({ socket, servername: host, rejectUnauthorized: !insecureTls });
      await new Promise((res, rej) => { socket.once('secureConnect', res); socket.once('error', rej); });
      ses = makeSession(socket);
      ehlo = await cmd('EHLO nebulix.local', [250]);
    }
    if (user) {
      if (/AUTH[^\n]*PLAIN/i.test(ehlo.text)) await cmd('AUTH PLAIN ' + b64('\0' + user + '\0' + pass), [235]);
      else { await cmd('AUTH LOGIN', [334]); await cmd(b64(user), [334]); await cmd(b64(pass), [235]); }
    }
    await cmd(`MAIL FROM:<${addrOf(from)}>`, [250]);
    await cmd(`RCPT TO:<${msg.to}>`, [250, 251]);
    await cmd('DATA', [354]);
    const body = buildMessage(msg).replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    ses.write(body + '\r\n.\r\n');
    await expect([250]);
    ses.write('QUIT\r\n');
  } finally {
    try { socket.end(); } catch {}
  }
}

async function resendSend(msg) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + cfg.resendKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: msg.from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error('Resend ' + r.status + ' ' + (await r.text()).slice(0, 200));
}

async function sendMail({ to, subject, text, html, code, link }) {
  const m = mode();
  const from = cfg.mailFrom || (cfg.smtp.user ? `${cfg.brand} Bot <${cfg.smtp.user}>` : `${cfg.brand} Bot <no-reply@nebulix.local>`);
  const msg = { from, to, subject, text, html };
  outbox.push({ to, subject, text, code, link, t: Date.now() }); if (outbox.length > 50) outbox.shift();
  if (m === 'smtp') return smtpSend(cfg.smtp, msg);
  if (m === 'resend') return resendSend(msg);
  // console mode: the owner of a local server sees the code in the terminal
  const bar = '='.repeat(58);
  if (!process.env.NX_QUIET_MAIL) console.log(`\n${bar}\n  [MAIL - console mode] To: ${to}\n  Subject: ${subject}\n  ${code ? 'CODE: ' + code : text.split('\n').slice(0, 3).join('\n  ')}\n  (Configure SMTP_* or RESEND_API_KEY in .env to send real emails)\n${bar}\n`);
}

// ---- templates ----
const T = {
  en: {
    verifySubject: (b) => `${b}: your verification code`,
    verifyIntro: 'Welcome to the galaxy! Confirm your email with the button below to claim your 50 welcome coins and Verified badge:',
    resetSubject: (b) => `${b}: reset your password`,
    resetIntro: 'Use the button below to choose a new password. If you did not ask for it, you can ignore this email:',
    expires: 'The link and the code expire in 10 minutes.',
    exists: 'Someone tried to create an account with this email, but you already have one. If it was you, just log in or reset your password.',
    existsSubject: (b) => `${b}: you already have an account`,
    btnVerify: 'Confirm my email', btnReset: 'Choose a new password',
    orCode: 'Or type this code in Nebulix:',
    auto: 'This is an automatic message from the Nebulix bot. Please do not reply.',
    byline: 'Created by VicStyles',
  },
  es: {
    verifySubject: (b) => `${b}: tu código de verificación`,
    verifyIntro: '¡Bienvenido a la galaxia! Confirma tu correo con el botón de abajo para reclamar tus 50 monedas de bienvenida y la insignia de Verificado:',
    resetSubject: (b) => `${b}: restablece tu contraseña`,
    resetIntro: 'Usa el botón de abajo para elegir una contraseña nueva. Si no lo pediste, ignora este correo:',
    expires: 'El enlace y el código caducan en 10 minutos.',
    exists: 'Alguien intentó crear una cuenta con este email, pero ya tienes una. Si fuiste tú, inicia sesión o restablece tu contraseña.',
    existsSubject: (b) => `${b}: ya tienes una cuenta`,
    btnVerify: 'Confirmar mi correo', btnReset: 'Elegir una contraseña nueva',
    orCode: 'O escribe este código en Nebulix:',
    auto: 'Este es un mensaje automático del bot de Nebulix. No respondas a este correo.',
    byline: 'Creado por VicStyles',
  },
  pt: {
    verifySubject: (b) => `${b}: seu código de verificação`,
    verifyIntro: 'Bem-vindo à galáxia! Confirme seu e-mail com o botão abaixo para receber suas 50 moedas de boas-vindas e o selo de Verificado:',
    resetSubject: (b) => `${b}: redefina sua senha`,
    resetIntro: 'Use o botão abaixo para escolher uma nova senha. Se você não pediu, ignore este e-mail:',
    expires: 'O link e o código expiram em 10 minutos.',
    exists: 'Alguém tentou criar uma conta com este e-mail, mas você já tem uma. Se foi você, basta entrar ou redefinir sua senha.',
    existsSubject: (b) => `${b}: você já tem uma conta`,
    btnVerify: 'Confirmar meu e-mail', btnReset: 'Escolher uma nova senha',
    orCode: 'Ou digite este código no Nebulix:',
    auto: 'Esta é uma mensagem automática do bot do Nebulix. Não responda a este e-mail.',
    byline: 'Criado por VicStyles',
  },
  fr: {
    verifySubject: (b) => `${b} : votre code de vérification`,
    verifyIntro: 'Bienvenue dans la galaxie ! Confirmez votre e-mail avec le bouton ci-dessous pour recevoir vos 50 pièces de bienvenue et le badge Vérifié :',
    resetSubject: (b) => `${b} : réinitialisez votre mot de passe`,
    resetIntro: 'Utilisez le bouton ci-dessous pour choisir un nouveau mot de passe. Si vous ne l’avez pas demandé, ignorez cet e-mail :',
    expires: 'Le lien et le code expirent dans 10 minutes.',
    exists: 'Quelqu’un a essayé de créer un compte avec cet e-mail, mais vous en avez déjà un. Si c’était vous, connectez-vous ou réinitialisez votre mot de passe.',
    existsSubject: (b) => `${b} : vous avez déjà un compte`,
    btnVerify: 'Confirmer mon e-mail', btnReset: 'Choisir un nouveau mot de passe',
    orCode: 'Ou saisissez ce code dans Nebulix :',
    auto: 'Ceci est un message automatique du bot Nebulix. Merci de ne pas y répondre.',
    byline: 'Créé par VicStyles',
  },
  de: {
    verifySubject: (b) => `${b}: dein Bestätigungscode`,
    verifyIntro: 'Willkommen in der Galaxie! Bestätige deine E-Mail mit dem Button unten und erhalte 50 Willkommensmünzen und das Verifiziert-Abzeichen:',
    resetSubject: (b) => `${b}: Passwort zurücksetzen`,
    resetIntro: 'Mit dem Button unten wählst du ein neues Passwort. Wenn du das nicht angefordert hast, ignoriere diese E-Mail:',
    expires: 'Link und Code laufen in 10 Minuten ab.',
    exists: 'Jemand hat versucht, mit dieser E-Mail ein Konto zu erstellen, aber du hast bereits eins. Wenn du das warst, melde dich einfach an oder setze dein Passwort zurück.',
    existsSubject: (b) => `${b}: du hast bereits ein Konto`,
    btnVerify: 'E-Mail bestätigen', btnReset: 'Neues Passwort wählen',
    orCode: 'Oder gib diesen Code in Nebulix ein:',
    auto: 'Dies ist eine automatische Nachricht des Nebulix-Bots. Bitte nicht antworten.',
    byline: 'Erstellt von VicStyles',
  },
  it: {
    verifySubject: (b) => `${b}: il tuo codice di verifica`,
    verifyIntro: 'Benvenuto nella galassia! Conferma la tua email con il pulsante qui sotto per ricevere 50 monete di benvenuto e il badge Verificato:',
    resetSubject: (b) => `${b}: reimposta la password`,
    resetIntro: 'Usa il pulsante qui sotto per scegliere una nuova password. Se non l’hai richiesto, ignora questa email:',
    expires: 'Il link e il codice scadono tra 10 minuti.',
    exists: 'Qualcuno ha provato a creare un account con questa email, ma ne hai già uno. Se eri tu, accedi o reimposta la password.',
    existsSubject: (b) => `${b}: hai già un account`,
    btnVerify: 'Conferma la mia email', btnReset: 'Scegli una nuova password',
    orCode: 'Oppure digita questo codice in Nebulix:',
    auto: 'Questo è un messaggio automatico del bot di Nebulix. Non rispondere.',
    byline: 'Creato da VicStyles',
  },
};

function shell(lang, title, bodyHtml) {
  const t = T[lang] || T.en;
  return `<!doctype html><html><body style="margin:0;background:#0b0820;font-family:Segoe UI,Roboto,Arial,sans-serif;color:#e8e6ff">
<div style="max-width:480px;margin:0 auto;padding:32px 20px">
<div style="background:linear-gradient(135deg,#1b1450,#2a1065);border:1px solid #4b3aa8;border-radius:16px;padding:28px">
<div style="font-size:22px;font-weight:800;letter-spacing:2px;background:linear-gradient(90deg,#8ec5ff,#c58bff);-webkit-background-clip:text;color:#b9a7ff">&#10022; ${escapeHtml(cfg.brand.toUpperCase())}</div>
<h2 style="margin:18px 0 8px;font-size:18px">${escapeHtml(title)}</h2>${bodyHtml}
</div><p style="text-align:center;color:#8d86c9;font-size:12px;margin-top:16px">${t.byline}</p></div></body></html>`;
}

function codeEmail(kind, lang, code, link) {
  const t = T[lang] || T.en;
  const subject = kind === 'verify' ? t.verifySubject(cfg.brand) : t.resetSubject(cfg.brand);
  const intro = kind === 'verify' ? t.verifyIntro : t.resetIntro;
  const btn = link ? `<div style="text-align:center;margin:22px 0 6px"><a href="${escapeHtml(link)}" style="display:inline-block;background:linear-gradient(90deg,#6d8bff,#b06bff);color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 28px;border-radius:12px">${escapeHtml(kind === 'verify' ? t.btnVerify : t.btnReset)}</a></div>
<p style="color:#9d97d8;font-size:13px;text-align:center;margin:16px 0 0">${escapeHtml(t.orCode)}</p>` : '';
  const html = shell(lang, subject, `<p style="line-height:1.5;color:#cfc9ff">${escapeHtml(intro)}</p>${btn}
<div style="font-size:36px;letter-spacing:10px;font-weight:800;text-align:center;background:#0b0820;border-radius:12px;padding:16px;margin:18px 0;color:#fff">${code}</div>
<p style="color:#9d97d8;font-size:13px">${t.expires}</p>
<p style="color:#7d77b8;font-size:12px;margin-bottom:0">${escapeHtml(t.auto)}</p>`);
  return { subject, text: `${intro}\n\n${link ? link + '\n\n' + t.orCode + ' ' : ''}${code}\n\n${t.expires}\n\n${t.auto}\n${t.byline}`, html, code, link };
}

async function sendCode(to, kind, lang, code, link) {
  return sendMail(Object.assign({ to }, codeEmail(kind, lang, code, link)));
}
async function sendExists(to, lang) {
  const t = T[lang] || T.en;
  return sendMail({ to, subject: t.existsSubject(cfg.brand), text: t.exists + '\n\n' + t.byline, html: shell(lang, t.existsSubject(cfg.brand), `<p style="line-height:1.5;color:#cfc9ff">${escapeHtml(t.exists)}</p>`) });
}

// "New sign-in" notice, sent when an account is opened from a browser it has not used before.
const ALERT = {
  en: ['new sign-in to your account', 'Your account was just opened from a browser we had not seen before:', 'If this was you, there is nothing to do. If not, change your password now and turn on two-step verification in Settings → Security.'],
  es: ['nuevo inicio de sesión en tu cuenta', 'Se acaba de entrar en tu cuenta desde un navegador que no habíamos visto antes:', 'Si has sido tú, no tienes que hacer nada. Si no, cambia tu contraseña ahora y activa la verificación en dos pasos en Ajustes → Seguridad.'],
};
async function sendAlert(to, lang, info) {
  const a = ALERT[lang] || ALERT.en; const t = T[lang] || T.en; const subject = cfg.brand + ': ' + a[0];
  const detail = info.ua + ' · ' + info.when;
  return sendMail({ to, subject, text: a[1] + '\n\n' + detail + '\n\n' + a[2] + '\n\n' + t.auto + '\n' + t.byline,
    html: shell(lang, subject, `<p style="line-height:1.5;color:#cfc9ff">${escapeHtml(a[1])}</p><div style="background:#0b0820;border-radius:12px;padding:14px;margin:14px 0;color:#fff;font-size:13px">${escapeHtml(detail)}</div><p style="line-height:1.5;color:#cfc9ff">${escapeHtml(a[2])}</p><p style="color:#7d77b8;font-size:12px;margin-bottom:0">${escapeHtml(t.auto)}</p>`) });
}

module.exports = { sendAlert, sendMail, sendCode, sendExists, codeEmail, outbox, mode, buildMessage, smtpSend };

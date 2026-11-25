'use strict';
// Nebulix configuration. Everything can be overridden with environment variables or a .env file.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

function loadEnvFile(file) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of txt.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnvFile(path.join(ROOT, '.env'));

const env = process.env;
const str = (k, d = '') => (env[k] !== undefined && env[k] !== '' ? env[k] : d);
const int = (k, d) => { const n = parseInt(env[k], 10); return Number.isFinite(n) ? n : d; };
const bool = (k, d) => (env[k] === undefined || env[k] === '' ? d : /^(1|true|yes|on)$/i.test(env[k]));

const cfg = {
  ROOT,
  VERSION: '15.0.0',
  brand: str('BRAND_NAME', 'Nebulix'),
  creator: 'VicStyles',
  host: str('HOST', '127.0.0.1'),
  port: int('PORT', 3000),
  portExplicit: env.PORT !== undefined && env.PORT !== '',
  dataDir: path.resolve(ROOT, str('DATA_DIR', 'data')),
  publicDir: path.join(ROOT, 'public'),
  trustProxy: bool('TRUST_PROXY', false),
  // mail
  mailMode: str('MAIL_MODE', ''), // console | smtp | resend (auto-detected when empty)
  mailFrom: str('MAIL_FROM', ''),
  smtp: {
    host: str('SMTP_HOST'), port: int('SMTP_PORT', 587), user: str('SMTP_USER'), pass: str('SMTP_PASS'),
    secure: bool('SMTP_SECURE', false), insecureTls: bool('SMTP_INSECURE_TLS', false),
  },
  resendKey: str('RESEND_API_KEY'),
  // stripe
  stripe: {
    secret: str('STRIPE_SECRET_KEY'), webhook: str('STRIPE_WEBHOOK_SECRET'),
    priceMonthly: str('STRIPE_PRICE_MONTHLY'), priceYearly: str('STRIPE_PRICE_YEARLY'),
    api: str('STRIPE_API_BASE', 'https://api.stripe.com'),
  },
  proPriceMonthly: str('PRO_PRICE_MONTHLY_LABEL', '$4.99 / month'),
  proPriceYearly: str('PRO_PRICE_YEARLY_LABEL', '$39.99 / year'),
  // AI
  ai: {
    provider: str('AI_PROVIDER', 'auto'), // auto | anthropic | openai | local
    anthropicKey: str('ANTHROPIC_API_KEY'), openaiKey: str('OPENAI_API_KEY'),
    openaiBase: str('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
    anthropicBase: str('ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),
    model: str('AI_MODEL', ''),
    ollamaBase: str('OLLAMA_BASE_URL', 'http://127.0.0.1:11434'), ollamaModel: str('OLLAMA_MODEL', ''),
    // free, always-on online model used when there is no API key and no Ollama (OpenAI-compatible, no key needed)
    freeOn: bool('FREE_AI', true), freeDirect: bool('FREE_AI_DIRECT', false), // off: the free service asks browsers for a Cloudflare Turnstile check freeUrl: str('FREE_AI_URL', 'https://text.pollinations.ai/openai'), freeModel: str('FREE_AI_MODEL', 'openai'),
    ollamaAuto: bool('OLLAMA_AUTO', true), // use a local Ollama automatically when no API key is configured
    freeDaily: int('AI_FREE_DAILY', 50), proDaily: int('AI_PRO_DAILY', 400),
  },
  adminEmails: str('ADMIN_EMAILS').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  requireVerify: bool('REQUIRE_EMAIL_VERIFY', true),
  devShowCode: bool('DEV_SHOW_CODE', false), // NEVER enable on a public server
  allowGuestProxy: env.ALLOW_GUEST_PROXY === undefined ? null : bool('ALLOW_GUEST_PROXY', false),
  allowPrivateTargets: bool('NX_TEST_ALLOW_PRIVATE', false), // tests only
  rateLimitMul: Math.max(1, int('NX_TEST_RATE_MULT', 1)), // tests only: multiply route rate limits so bulk account setup from one IP doesn't trip them
  maxProxySessionsPerUser: int('PROXY_MAX_SESSIONS', 6),
  proxyCacheMB: int('PROXY_CACHE_MB', 96),
  signupsOpen: bool('SIGNUPS_OPEN', true),
  secret: '',
  appOrigin: '', proxyOrigin: '', appHost: '', proxyHost: '', gamesOrigin: '', gamesHost: '', isPublic: false, secureCookies: false,
};

function isLoopbackHost(h) {
  h = String(h || '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost');
}
cfg.isLoopbackHost = isLoopbackHost;

cfg.finalize = function finalize(port) {
  cfg.port = port;
  cfg.appOrigin = str('APP_ORIGIN', `http://localhost:${port}`).replace(/\/+$/, '');
  cfg.proxyOrigin = str('PROXY_ORIGIN', `http://127.0.0.1:${port}`).replace(/\/+$/, '');
  cfg.appHost = new URL(cfg.appOrigin).host;
  cfg.proxyHost = new URL(cfg.proxyOrigin).host;
  cfg.isPublic = !isLoopbackHost(cfg.appHost);
  // third hostname for Hub games that run "like in Chrome": their own origin, never the app's (see routes/hub.js)
  cfg.gamesOrigin = str('GAMES_ORIGIN', cfg.isPublic ? '' : `http://games.localhost:${port}`).replace(/\/+$/, '');
  cfg.gamesHost = cfg.gamesOrigin ? new URL(cfg.gamesOrigin).host : '';
  cfg.secureCookies = cfg.appOrigin.startsWith('https:');
  // 13.3: mirror links — more public hostnames that serve the very same Nebulix (each one is a tiny forwarder app, or a
  // custom domain). MIRROR_HOSTS=nebulix-play.fly.dev,nebulix-zone.fly.dev
  cfg.mirrorHosts = str('MIRROR_HOSTS', '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  cfg.appHosts = () => [cfg.appHost].concat(cfg.mirrorHosts, extraMirrors());
  cfg.appOrigins = () => cfg.appHosts().map((h) => (h === cfg.appHost ? cfg.appOrigin : 'https://' + h));
  if (cfg.allowGuestProxy === null) cfg.allowGuestProxy = !cfg.isPublic;
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  // persistent secret
  cfg.secret = str('SECRET');
  if (!cfg.secret) {
    const f = path.join(cfg.dataDir, 'secret.key');
    try { cfg.secret = fs.readFileSync(f, 'utf8').trim(); } catch {}
    if (!cfg.secret || cfg.secret.length < 32) {
      cfg.secret = crypto.randomBytes(48).toString('base64url');
      fs.writeFileSync(f, cfg.secret, { mode: 0o600 });
    }
  }
  return cfg;
};

// mirrors added by the owner in Admin (custom domains); read lazily so config has no dependency on state
function extraMirrors() { try { const S = require('./state').S; return (S.meta && Array.isArray(S.meta.mirrors) ? S.meta.mirrors : []).map((m) => String(m.host || '').toLowerCase()).filter(Boolean); } catch { return []; } }
module.exports = cfg;

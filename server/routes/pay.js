'use strict';
// PRO subscription: Stripe Checkout + billing portal + signed webhook, and redeemable PRO codes.
// PRO never sells coins and gives no casino advantage: it is cosmetic/limits only.
const crypto = require('crypto');
const cfg = require('../config');
const { S, isPro, selfUser, audit } = require('../state');
const { HttpError, now, safeEqual, Limiter } = require('../util');

const DAY = 86400000;

// ---------- automatic Stripe setup ----------
// Only STRIPE_SECRET_KEY is required. On boot the server finds or creates the "Nebulix PRO" product, a monthly and a yearly
// price (by lookup key) and its own webhook endpoint, and keeps the ids + webhook signing secret in /data/stripe.json
// (one entry per test/live mode). STRIPE_PRICE_* / STRIPE_WEBHOOK_SECRET env vars still override everything.
const CUR = String(process.env.PRO_CURRENCY || 'eur').toLowerCase();
const CENTS = { monthly: parseInt(process.env.PRO_MONTHLY_CENTS || '499', 10), yearly: parseInt(process.env.PRO_YEARLY_CENTS || '3999', 10) };
// 13.8 higher tiers (Premium is the original PRO price above)
const TIER_CENTS = { pro: { monthly: parseInt(process.env.TIER_PRO_MONTHLY_CENTS || '999', 10), yearly: parseInt(process.env.TIER_PRO_YEARLY_CENTS || '8999', 10) }, ultimate: { monthly: parseInt(process.env.TIER_ULT_MONTHLY_CENTS || '1999', 10), yearly: parseInt(process.env.TIER_ULT_YEARLY_CENTS || '17999', 10) } };
const TIER_NAMES = { premium: 'Nebulix Premium', pro: 'Nebulix Premium Pro', ultimate: 'Nebulix Premium Ultimate' };
const tierLookup = (tier, plan) => (tier === 'premium' ? LOOKUP[plan] : `nebulix_tier_${tier}_${plan}`);
const tierPrice = (tier, plan) => (tier === 'premium' ? priceIds()[plan] : ((auto().tiers || {})[tier] || {})[plan] || '');
const tierOfPrice = (id) => { if (!id) return null; const t = auto().tiers || {}; for (const k of ['pro', 'ultimate']) if (t[k] && (t[k].monthly === id || t[k].yearly === id)) return k; const p = priceIds(); return p.monthly === id || p.yearly === id ? 'premium' : null; };
const EVENTS = ['checkout.session.completed', 'invoice.paid', 'customer.subscription.updated', 'customer.subscription.deleted'];
const LOOKUP = { monthly: 'nebulix_pro_monthly', yearly: 'nebulix_pro_yearly' };
const smode = () => (/_live_/.test(cfg.stripe.secret || '') ? 'live' : 'test');
const autoTbl = () => S.store.table('stripe');
const auto = () => (cfg.stripe.secret ? autoTbl()[smode()] || {} : {});
const priceIds = () => ({ monthly: cfg.stripe.priceMonthly || auto().monthly || '', yearly: cfg.stripe.priceYearly || auto().yearly || '' });
const whSecret = () => cfg.stripe.webhook || auto().whsec || '';

// The owner can switch card payments off (PRO then only through redeem codes) without removing the Stripe setup.
const cardsOff = () => !!(S.meta && S.meta.cardsOff);
function enabled() {
  const p = priceIds();
  return { stripe: !cardsOff() && !!(cfg.stripe.secret && (p.monthly || p.yearly)), cardsOff: cardsOff(), webhook: !!whSecret(), plans: { monthly: !!p.monthly, yearly: !!p.yearly }, redeem: true, mode: cfg.stripe.secret ? smode() : null };
}
function tierLabels(u) {
  const es = !u || (u.lang || 'es') === 'es'; const t = auto().tiers || {}; const cur = (auto().currency || CUR).toUpperCase();
  const f = (c) => { try { return new Intl.NumberFormat(es ? 'es-ES' : 'en-US', { style: 'currency', currency: cur }).format(c / 100); } catch { return (c / 100).toFixed(2) + ' ' + cur; } };
  const out = { premium: labelsFor(u) };
  for (const k of ['pro', 'ultimate']) { const a = (t[k] && t[k].amounts) || TIER_CENTS[k]; out[k] = { monthly: f(a.monthly) + (es ? ' / mes' : ' / month'), yearly: f(a.yearly) + (es ? ' / año' : ' / year') }; }
  return out;
}
function labelsFor(u) {
  const a = auto(); const es = !u || (u.lang || 'es') === 'es';
  if (!a.amounts || (process.env.PRO_PRICE_MONTHLY_LABEL && process.env.PRO_PRICE_YEARLY_LABEL)) return { monthly: cfg.proPriceMonthly, yearly: cfg.proPriceYearly };
  const f = (c) => { try { return new Intl.NumberFormat(es ? 'es-ES' : 'en-US', { style: 'currency', currency: a.currency.toUpperCase() }).format(c / 100); } catch { return (c / 100).toFixed(2) + ' ' + a.currency.toUpperCase(); } };
  return { monthly: process.env.PRO_PRICE_MONTHLY_LABEL || f(a.amounts.monthly) + (es ? ' / mes' : ' / month'), yearly: process.env.PRO_PRICE_YEARLY_LABEL || f(a.amounts.yearly) + (es ? ' / año' : ' / year') };
}

let setupRunning = false;
async function autoSetup() {
  if (!cfg.stripe.secret || setupRunning) return;
  setupRunning = true;
  const tbl = autoTbl(); const m = smode(); const st = (tbl[m] = tbl[m] || {});
  try {
    if (!cfg.stripe.priceMonthly || !cfg.stripe.priceYearly) {
      const q = Object.values(LOOKUP).map((k) => 'lookup_keys%5B%5D=' + k).join('&');
      const found = await stripe('GET', '/v1/prices?active=true&limit=10&' + q);
      const pick = (k) => (found.data || []).find((p) => p.lookup_key === LOOKUP[k]);
      let mo = pick('monthly'); let yr = pick('yearly');
      if (!mo || !yr) {
        let product = (mo || yr) ? ((mo || yr).product.id || (mo || yr).product) : null;
        if (!product) product = (await stripe('POST', '/v1/products', { name: 'Nebulix PRO', description: 'PRO membership for Nebulix: cosmetics, bigger uploads and more AI. Virtual coins are never sold.', metadata: { app: 'nebulix' } })).id;
        if (!mo) mo = await stripe('POST', '/v1/prices', { product, currency: CUR, unit_amount: CENTS.monthly, recurring: { interval: 'month' }, lookup_key: LOOKUP.monthly, nickname: 'PRO monthly' });
        if (!yr) yr = await stripe('POST', '/v1/prices', { product, currency: CUR, unit_amount: CENTS.yearly, recurring: { interval: 'year' }, lookup_key: LOOKUP.yearly, nickname: 'PRO yearly' });
      }
      st.monthly = mo.id; st.yearly = yr.id; st.currency = mo.currency; st.amounts = { monthly: mo.unit_amount, yearly: yr.unit_amount };
    }
    // 13.8: the Premium Pro and Premium Ultimate products and prices
    st.tiers = st.tiers || {};
    for (const tier of ['pro', 'ultimate']) {
      const want = TIER_CENTS[tier]; const keys = ['monthly', 'yearly'].map((p) => tierLookup(tier, p));
      const found = await stripe('GET', '/v1/prices?active=true&limit=10&' + keys.map((k) => 'lookup_keys%5B%5D=' + k).join('&'));
      let mo = (found.data || []).find((p) => p.lookup_key === keys[0]); let yr = (found.data || []).find((p) => p.lookup_key === keys[1]);
      if (!mo || !yr) { let product = (mo || yr) ? ((mo || yr).product.id || (mo || yr).product) : (await stripe('POST', '/v1/products', { name: TIER_NAMES[tier], description: TIER_NAMES[tier] + ' membership: cosmetics, more AI, bigger uploads. Virtual coins are never sold.', metadata: { app: 'nebulix', tier } })).id;
        if (!mo) mo = await stripe('POST', '/v1/prices', { product, currency: CUR, unit_amount: want.monthly, recurring: { interval: 'month' }, lookup_key: keys[0], nickname: TIER_NAMES[tier] + ' monthly' });
        if (!yr) yr = await stripe('POST', '/v1/prices', { product, currency: CUR, unit_amount: want.yearly, recurring: { interval: 'year' }, lookup_key: keys[1], nickname: TIER_NAMES[tier] + ' yearly' }); }
      st.tiers[tier] = { monthly: mo.id, yearly: yr.id, amounts: { monthly: mo.unit_amount, yearly: yr.unit_amount } };
    }
    // Stripe only delivers webhooks to public https addresses
    if (!cfg.stripe.webhook && /^https:\/\//.test(cfg.appOrigin) && !/\/\/(localhost|127\.|\[::1\])/.test(cfg.appOrigin)) {
      const url = cfg.appOrigin + '/api/stripe/webhook';
      const list = await stripe('GET', '/v1/webhook_endpoints?limit=100');
      const ours = (list.data || []).filter((w) => w.url === url && w.metadata && w.metadata.app === 'nebulix');
      if (!st.whsec || !ours.some((w) => w.id === st.whId)) {
        // the signing secret is only shown when an endpoint is created, so replace our old endpoint(s) we no longer have a secret for
        for (const w of ours) await stripe('DELETE', '/v1/webhook_endpoints/' + w.id);
        const w = await stripe('POST', '/v1/webhook_endpoints', { url, enabled_events: EVENTS, description: 'Nebulix PRO', metadata: { app: 'nebulix' } });
        st.whId = w.id; st.whsec = w.secret;
      }
    }
    st.ok = now(); st.error = null;
    console.log(`[stripe] ready (${m} mode): monthly ${st.monthly || cfg.stripe.priceMonthly}, yearly ${st.yearly || cfg.stripe.priceYearly}, webhook ${whSecret() ? 'on' : 'off'}`);
  } catch (e) { st.error = e.message; st.failed = now(); console.error('[stripe] automatic setup failed:', e.message); }
  finally { setupRunning = false; S.store.touch('stripe'); }
}
function startAutoSetup() {
  if (!cfg.stripe.secret) return;
  setTimeout(autoSetup, 1500).unref();
  // retry while something is missing (e.g. Stripe was unreachable at boot)
  setInterval(() => { const a = auto(); if (a.error || !enabled().stripe || !enabled().webhook) autoSetup(); }, 10 * 60000).unref();
}

function flatten(obj, prefix, out) {
  out = out || new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object' ? flatten(x, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else if (typeof v === 'object') flatten(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripe(method, path, params) {
  if (!cfg.stripe.secret) throw new HttpError(501, 'payments_off', 'Card payments are not configured on this server');
  const opts = { method, headers: { Authorization: `Bearer ${cfg.stripe.secret}`, 'Stripe-Version': '2024-06-20' } };
  if (params) { opts.body = flatten(params); opts.headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  let res; let j;
  try { res = await fetch(cfg.stripe.api + path, Object.assign(opts, { signal: AbortSignal.timeout(20000) })); j = await res.json(); } catch (e) { throw new HttpError(502, 'stripe_unreachable', 'The payment provider could not be reached'); }
  if (!res.ok) { console.error('[stripe]', path, res.status, j && j.error && j.error.message); throw new HttpError(502, 'stripe_error', (j && j.error && j.error.message) || 'The payment provider returned an error'); }
  return j;
}

function grant(u, untilMs, why, tier) {
  const before = u.proUntil || 0;
  if (tier && ['premium', 'pro', 'ultimate'].includes(tier)) u.tier = tier;
  u.proUntil = Math.max(before, untilMs);
  u.proSince = u.proSince || now();
  try { require('../progress').checkAchievements(u); } catch {}
  S.store.touch('users');
  try { S.hub.push(u.id, { t: 'me', user: selfUser(u) }); } catch {}
  audit('pro.grant', u.id, `${why} until ${new Date(u.proUntil).toISOString()}`);
}

// Stripe signature: header "t=...,v1=..." ; HMAC-SHA256 of `${t}.${payload}` with the endpoint secret
function verifySignature(raw, header, secret, tolerance = 300) {
  if (!header || !secret) return false;
  const parts = {}; const v1 = [];
  for (const p of String(header).split(',')) { const i = p.indexOf('='); if (i < 0) continue; const k = p.slice(0, i).trim(); const v = p.slice(i + 1).trim(); if (k === 'v1') v1.push(v); else parts[k] = v; }
  const t = parseInt(parts.t, 10);
  if (!t || Math.abs(Math.floor(Date.now() / 1000) - t) > tolerance) return false;
  const want = crypto.createHmac('sha256', secret).update(`${t}.`).update(raw).digest('hex');
  return v1.some((s) => safeEqual(s, want));
}

function userFor(obj) {
  const ref = obj.client_reference_id || (obj.metadata && obj.metadata.uid);
  if (ref && S.users[ref] && !S.users[ref].deleted) return S.users[ref];
  const cust = obj.customer;
  if (cust) for (const u of Object.values(S.users)) if (u.stripeCustomer === cust && !u.deleted) return u;
  return null;
}

async function onEvent(ev) {
  const o = ev.data && ev.data.object; if (!o) return;
  switch (ev.type) {
    case 'checkout.session.completed': {
      const u = userFor(o); if (!u) return;
      if (o.customer) u.stripeCustomer = o.customer;
      if (o.subscription) u.stripeSub = o.subscription;
      // access is extended by the invoice.paid event; give a short head start in case it arrives later
      grant(u, now() + 2 * DAY, 'checkout', o.metadata && o.metadata.tier);
      break;
    }
    case 'invoice.paid': {
      const u = userFor(o); if (!u) return;
      let end = 0;
      let tier = null; for (const l of (o.lines && o.lines.data) || []) { if (l.period && l.period.end) end = Math.max(end, l.period.end * 1000); tier = tier || tierOfPrice(l.price && (l.price.id || l.price)) || (l.pricing && l.pricing.price_details && tierOfPrice(l.pricing.price_details.price)); }
      grant(u, (end || now() + 31 * DAY) + 2 * DAY, 'invoice', tier);
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const u = userFor(o); if (!u) return;
      const end = (o.current_period_end || 0) * 1000;
      if (o.status === 'canceled' || ev.type === 'customer.subscription.deleted') { u.proUntil = Math.min(u.proUntil || 0, Math.max(end, now())); u.stripeSub = null; }
      else if (end) { u.proUntil = Math.max(u.proUntil || 0, end); u.cancelAtEnd = !!o.cancel_at_period_end; const it = o.items && o.items.data && o.items.data[0]; const tr = it && tierOfPrice(it.price && it.price.id); if (tr) u.tier = tr; }
      S.store.touch('users');
      try { S.hub.push(u.id, { t: 'me', user: selfUser(u) }); } catch {}
      break;
    }
    default: break;
  }
}

const redeemLim = new Limiter(10, 3600000);
const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
const fmtCode = (s) => s.replace(/(.{4})(?=.)/g, '$1-');

module.exports = function register(r) {
  startAutoSetup();
  r.put('/api/admin/payments', { auth: true, role: 'owner', limit: [20, 600000, 'user'] }, async (c) => {
    S.meta.cardsOff = !c.body.cards; S.store.touch('meta');
    require('../state').audit('payments.cards', c.user.id, S.meta.cardsOff ? 'off' : 'on');
    return enabled();
  });
  r.get('/api/pro/state', { auth: true }, async (c) => {
    const u = c.user;
    return {
      pro: isPro(u), tier: require('../state').tierOf(u), proUntil: u.proUntil || 0, owner: u.role === 'owner', tierLabels: tierLabels(u), tierPlans: { pro: !!tierPrice('pro', 'monthly'), ultimate: !!tierPrice('ultimate', 'monthly') }, cancelAtEnd: !!u.cancelAtEnd, manage: !!u.stripeCustomer,
      payments: enabled(), labels: labelsFor(u),
      stripeStatus: u.role === 'owner' ? { mode: cfg.stripe.secret ? smode() : null, ready: enabled().stripe, webhook: enabled().webhook, error: auto().error || null } : undefined,
      perks: ['animated_avatar', 'big_uploads', 'pro_cosmetics', 'ai_quota', 'extensions', 'badge', 'custom_css', 'early_access'],
    };
  });

  r.post('/api/pro/checkout', { auth: true, verified: true, limit: [10, 600000, 'user'] }, async (c) => {
    const plan = c.body.plan === 'yearly' ? 'yearly' : 'monthly'; const tier = ['pro', 'ultimate'].includes(c.body.tier) ? c.body.tier : 'premium';
    const price = tierPrice(tier, plan);
    if (cardsOff() || !cfg.stripe.secret || !price) throw new HttpError(501, 'payments_off', 'Card payments are not configured on this server. You can still redeem a PRO code.');
    const u = c.user;
    const params = {
      mode: 'subscription', 'line_items': [{ price, quantity: 1 }], client_reference_id: u.id, allow_promotion_codes: 'true',
      success_url: `${cfg.appOrigin}/#/pro?paid=1`, cancel_url: `${cfg.appOrigin}/#/pro?canceled=1`,
      subscription_data: { metadata: { uid: u.id, tier } }, metadata: { uid: u.id, tier },
    };
    // accounts without a (valid) email simply type it in Stripe's own checkout page
    if (u.stripeCustomer) params.customer = u.stripeCustomer; else if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(u.email || ''))) params.customer_email = u.email;
    const s = await stripe('POST', '/v1/checkout/sessions', params);
    return { url: s.url };
  });

  r.post('/api/pro/portal', { auth: true, verified: true, limit: [10, 600000, 'user'] }, async (c) => {
    if (!c.user.stripeCustomer) throw new HttpError(400, 'no_customer', 'You do not have a subscription to manage');
    const s = await stripe('POST', '/v1/billing_portal/sessions', { customer: c.user.stripeCustomer, return_url: `${cfg.appOrigin}/#/pro` });
    return { url: s.url };
  });

  r.post('/api/pro/redeem', { auth: true, verified: true }, async (c) => {
    if (!redeemLim.hit(c.user.id)) { const e = new HttpError(429, 'rate_limited', 'Too many attempts. Try again later.'); e.retryAfter = redeemLim.retryAfter(c.user.id); throw e; }
    const key = normCode(c.body.code);
    const rec = key && S.codes[key];
    if (!rec || rec.disabled || (rec.expires && rec.expires < now()) || (rec.max && (rec.used || []).length >= rec.max)) throw new HttpError(400, 'bad_code', 'That code is not valid');
    rec.used = rec.used || [];
    if (rec.used.includes(c.user.id)) throw new HttpError(400, 'used_code', 'You already used this code');
    rec.used.push(c.user.id);
    const u = c.user;
    const base = Math.max(now(), u.proUntil || 0);
    grant(u, base + rec.days * DAY, 'code ' + key.slice(0, 4), rec.tier || (isPro(u) ? null : 'premium'));
    S.store.touch('codes');
    return { ok: true, days: rec.days, proUntil: u.proUntil, user: selfUser(u) };
  });

  // Stripe -> us. No cookies, no Origin header: authenticity comes from the signature.
  r.post('/api/stripe/webhook', { raw: true, noOrigin: true, bodyLimit: 512 * 1024 }, async (c) => {
    if (!whSecret()) throw new HttpError(501, 'webhook_off', 'Webhook is not configured');
    if (!verifySignature(c.raw, c.req.headers['stripe-signature'], whSecret())) throw new HttpError(400, 'bad_signature', 'Invalid signature');
    let ev; try { ev = JSON.parse(c.raw.toString('utf8')); } catch { throw new HttpError(400, 'bad_json', 'Invalid JSON'); }
    S.meta.stripeEvents = S.meta.stripeEvents || [];
    if (ev.id && S.meta.stripeEvents.includes(ev.id)) return { received: true, duplicate: true };
    await onEvent(ev);
    if (ev.id) { S.meta.stripeEvents.unshift(ev.id); if (S.meta.stripeEvents.length > 300) S.meta.stripeEvents.length = 300; S.store.touch('meta'); }
    return { received: true };
  });
};

module.exports.enabled = enabled;
module.exports.labelsFor = labelsFor;
module.exports.autoSetup = autoSetup;
module.exports.verifySignature = verifySignature;
module.exports.fmtCode = fmtCode;
module.exports.normCode = normCode;

'use strict';
// Nebulix 13.3 — Nebulix VPN status: what the websites you open through Nebulix can see about you.
// Browsing in Nebulix already goes through the server (sites see the server, not you). VPN mode adds a generic browser
// identity, a neutral language and time zone, the ad/tracker shield and a WebRTC block so pages cannot find your real IP.
const { HttpError } = require('../util');
let exit = { at: 0, data: null };
async function exitInfo() {
  if (exit.data && Date.now() - exit.at < 6 * 3600000) return exit.data;
  let data = { ip: null, country: null, city: null, org: null };
  try { const r = await fetch('https://ipwho.is/', { headers: { 'user-agent': 'NebulixVPN' }, signal: AbortSignal.timeout(6000) }); const j = await r.json(); if (j && j.success !== false) data = { ip: j.ip, country: j.country, cc: j.country_code, city: j.city, org: j.connection && (j.connection.org || j.connection.isp) }; } catch {}
  if (!data.ip) { try { const r = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(6000) }); data.ip = (await r.json()).ip; } catch {} }
  exit = { at: Date.now(), data }; return data;
}
const REGIONS = { cdg: ['Paris, France', 'París, Francia'], mad: ['Madrid, Spain', 'Madrid, España'], ams: ['Amsterdam, Netherlands', 'Ámsterdam, Países Bajos'], fra: ['Frankfurt, Germany', 'Fráncfort, Alemania'], lhr: ['London, United Kingdom', 'Londres, Reino Unido'], iad: ['Virginia, USA', 'Virginia, EE. UU.'], ord: ['Chicago, USA', 'Chicago, EE. UU.'], sjc: ['California, USA', 'California, EE. UU.'], gru: ['São Paulo, Brazil', 'São Paulo, Brasil'], nrt: ['Tokyo, Japan', 'Tokio, Japón'], sin: ['Singapore', 'Singapur'], syd: ['Sydney, Australia', 'Sídney, Australia'] };
module.exports = function register(r) {
  r.get('/api/vpn', { auth: true, limit: [30, 60000, 'user'] }, async (c) => {
    const ex = await exitInfo(); const region = process.env.FLY_REGION || null;
    const p = (c.user.settings && c.user.settings.proxy) || {};
    return { on: !!p.vpn, you: { ip: c.ip || null }, exit: ex, region, regionName: region && REGIONS[region] ? REGIONS[region] : null, shield: { adblock: p.adblock !== false, strip: p.stripTracking !== false } };
  });
  void HttpError;
};

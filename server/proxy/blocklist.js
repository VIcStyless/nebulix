'use strict';
// Ad / tracker shield + operator blocklist.
const { S } = require('../state');

const ADS = `doubleclick.net googlesyndication.com googleadservices.com adservice.google.com 2mdn.net adnxs.com adsrvr.org advertising.com
amazon-adsystem.com criteo.com criteo.net outbrain.com taboola.com pubmatic.com rubiconproject.com openx.net casalemedia.com moatads.com
scorecardresearch.com quantserve.com adform.net smartadserver.com media.net yieldmo.com teads.tv sharethrough.com indexww.com contextweb.com
bidswitch.net lijit.com 33across.com sovrn.com zedo.com adcolony.com applovin.com mopub.com popads.net propellerads.com exoclick.com juicyads.com
trafficjunky.net adsterra.com hilltopads.net clickadu.com google-analytics.com hotjar.com crazyegg.com mouseflow.com stats.g.doubleclick.net
adition.com adscale.de serving-sys.com yandexadexchange.net admixer.net tapad.com bluekai.com demdex.net krxd.net rlcdn.com agkn.com`.split(/\s+/).filter(Boolean);
const adSet = new Set(ADS);

function hostChain(host) {
  const out = []; const p = host.toLowerCase().split('.');
  for (let i = 0; i < p.length - 1; i++) out.push(p.slice(i).join('.'));
  return out;
}
function isAd(host) { return hostChain(host).some((h) => adSet.has(h)); }
function isBlocked(host) {
  const list = S.meta && S.meta.blocklist;
  if (!list || !list.length) return false;
  const chain = hostChain(host);
  return list.some((h) => chain.includes(h));
}

const TRACK = /^(utm_[a-z_]+|fbclid|gclid|gclsrc|dclid|msclkid|mc_eid|mc_cid|igshid|yclid|_hsenc|_hsmi|vero_id|ref_src|ref_url|twclid|ttclid|li_fat_id)$/i;
function stripTracking(search) {
  if (!search || search.length < 2) return search;
  const sp = new URLSearchParams(search);
  let changed = false;
  for (const k of [...sp.keys()]) if (TRACK.test(k)) { sp.delete(k); changed = true; }
  if (!changed) return search;
  const s = sp.toString();
  return s ? '?' + s : '';
}

module.exports = { isAd, isBlocked, stripTracking };

'use strict';
// Compatibility layer injected into Hub games/apps. They run sandboxed on an opaque origin (so they can never touch
// the user's account), and in that mode the browser blocks localStorage, sessionStorage, document.cookie and service
// workers — many games then crash on start. This shim gives them working versions: storage lives in memory, starts
// from the player's saved snapshot (injected by the server) and every change is sent to the Hub page, which saves it
// to the player's account. Service workers and Cache Storage report "unavailable" instead of throwing.
const SHIM = `(function(){
var S=window.__nxSave||{ls:{},ck:''};S.ls=S.ls||{};S.ck=S.ck||'';var own=Object.prototype.hasOwnProperty;var tm=0;
function sync(){clearTimeout(tm);tm=setTimeout(function(){try{parent.postMessage({nxHubSave:1,ls:S.ls,ck:S.ck},'*')}catch(e){}},700)}
function mk(store,persist){var api={getItem:function(k){k=String(k);return own.call(store,k)?store[k]:null},setItem:function(k,v){store[String(k)]=String(v);if(persist)sync()},removeItem:function(k){delete store[String(k)];if(persist)sync()},clear:function(){for(var k in store)delete store[k];if(persist)sync()},key:function(i){var ks=Object.keys(store);return i<ks.length?ks[i]:null}};
Object.defineProperty(api,'length',{get:function(){return Object.keys(store).length}});
return new Proxy(api,{get:function(t,p){if(p in t)return t[p];if(typeof p==='string'&&own.call(store,p))return store[p];return undefined},set:function(t,p,v){if(p in t)return true;store[String(p)]=String(v);if(persist)sync();return true},deleteProperty:function(t,p){delete store[p];if(persist)sync();return true},has:function(t,p){return p in t||own.call(store,p)},ownKeys:function(){return Object.keys(store)},getOwnPropertyDescriptor:function(t,p){if(own.call(store,p))return{value:store[p],enumerable:true,configurable:true,writable:true};return undefined}})}
function blocked(get){try{var x=get();if(x&&x.length!==undefined)void x.length;return false}catch(e){return true}}
if(blocked(function(){return window.localStorage}))try{Object.defineProperty(window,'localStorage',{value:mk(S.ls,true),configurable:true})}catch(e){}
if(blocked(function(){return window.sessionStorage}))try{Object.defineProperty(window,'sessionStorage',{value:mk({},false),configurable:true})}catch(e){}
if(blocked(function(){return document.cookie}))try{Object.defineProperty(document,'cookie',{configurable:true,get:function(){return S.ck},set:function(v){v=String(v);var kv=v.split(';')[0].trim();var n=kv.split('=')[0].trim();var rest=S.ck?S.ck.split('; ').filter(function(c){return c.split('=')[0]!==n}):[];if(!/max-age=0|expires=thu, 01 jan 1970/i.test(v))rest.push(kv);S.ck=rest.join('; ');sync()}})}catch(e){}
var no=function(){return Promise.reject(new DOMException('Not available here','SecurityError'))};
if(blocked(function(){return navigator.serviceWorker}))try{Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{register:no,getRegistration:function(){return Promise.resolve(undefined)},getRegistrations:function(){return Promise.resolve([])},ready:new Promise(function(){}),controller:null,addEventListener:function(){},removeEventListener:function(){},startMessages:function(){}}})}catch(e){}
if(blocked(function(){return window.caches}))try{Object.defineProperty(window,'caches',{configurable:true,value:{open:no,match:function(){return Promise.resolve(undefined)},has:function(){return Promise.resolve(false)},keys:function(){return Promise.resolve([])},delete:function(){return Promise.resolve(false)}}})}catch(e){}
var rq={},rn=0;window.addEventListener('message',function(e){var d=e.data;if(d&&d.nxHubRes===1&&rq[d.req]){rq[d.req](d.data);delete rq[d.req]}});function ask(m){return new Promise(function(res){var id=++rn;rq[id]=res;m.req=id;try{parent.postMessage(m,'*')}catch(e){res(null)}setTimeout(function(){if(rq[id]){delete rq[id];res(null)}},8000)})}
window.Nebulix=window.Nebulix||{version:1,submitScore:function(score,label){return ask({nxHubApi:1,op:'score',score:Number(score)||0,label:String(label||'').slice(0,40)})},leaderboard:function(){return ask({nxHubApi:1,op:'board'})},me:function(){return ask({nxHubApi:1,op:'me'})},unlock:function(id,title,desc){return ask({nxHubApi:1,op:'unlock',id:String(id||'').slice(0,40),title:String(title||'').slice(0,60),desc:String(desc||'').slice(0,140)})},achievements:function(){return ask({nxHubApi:1,op:'achs'})}};
})();`;
// returns the HTML with the shim (and the player's snapshot) as the very first script of the page
function inject(html, save) {
  const snap = JSON.stringify(save || { ls: {}, ck: '' }).replace(/</g, '\\u003c');
  const tag = `<script>window.__nxSave=${snap};${SHIM}</script>`;
  const s = html.toString('utf8');
  const m = s.match(/<head[^>]*>/i);
  if (m) return Buffer.from(s.slice(0, m.index + m[0].length) + tag + s.slice(m.index + m[0].length));
  const d = s.match(/<!doctype[^>]*>/i);
  if (d) return Buffer.from(s.slice(0, d.index + d[0].length) + tag + s.slice(d.index + d[0].length));
  return Buffer.from(tag + s);
}
module.exports = { inject, SHIM };

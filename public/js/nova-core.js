// One way to talk to Nova from anywhere (Nebulix 11). In free mode the browser streams straight from the free model,
// so each person has their own free quota; the server still writes the instructions and counts the daily limit.
// If that fails (busy, blocked network…) it falls back to the server path without counting twice.
import { api, streamPost } from './api.js';

async function* sseLines(resp) {
  const reader = resp.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); if (line.startsWith('data:')) yield line.slice(5).trim(); } }
}

// opts: { messages, mode: 'chat'|'code'|'copilot', web, signal, onText(d), onReason(d), onSources(list) } → { model, mode, fallback, left }
export async function askNova({ messages, mode = 'chat', web = false, model = 'auto', agent = '', signal, onText = () => {}, onReason = () => {}, onSources = () => {} }) {
  const body = { messages, mode, web: !!web, model, agent: !!agent, tools: agent || undefined };
  let prep = null; try { prep = await api.post('/api/ai/prepare', body, { quiet: true, signal }); } catch (e) { if (e && (e.code === 'ai_quota' || e.name === 'AbortError')) throw e; prep = null; }
  if (prep && prep.reply) { onText(prep.reply); return { model: null, mode: 'local' }; }
  if (prep && prep.direct) {
    const d = prep.direct; if (prep.sources && prep.sources.length) onSources(prep.sources);
    let got = false; const calls = [];
    try {
      const resp = await fetch(d.url, { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: d.model, max_tokens: d.maxTokens, stream: true, messages: [{ role: 'system', content: d.system }, ...d.messages] }) });
      if (!resp.ok || !resp.body) throw Object.assign(new Error('free ' + resp.status), { status: resp.status });
      for await (const line of sseLines(resp)) {
        if (!line || line === '[DONE]') continue; let j; try { j = JSON.parse(line); } catch { continue; }
        if (j.error) throw new Error('free error');
        const dl = j.choices && j.choices[0] && j.choices[0].delta; if (!dl) continue;
        if (dl.reasoning || dl.reasoning_content) onReason(dl.reasoning || dl.reasoning_content);
        if (dl.content) { got = true; onText(dl.content); }
        for (const tc of dl.tool_calls || []) { const k = tc.index || 0; calls[k] = calls[k] || { name: '', args: '' }; if (tc.function && tc.function.name) calls[k].name += tc.function.name; if (tc.function && tc.function.arguments) calls[k].args += tc.function.arguments; }
      }
      const call = calls.find(Boolean); if (call && call.name) { let args = {}; try { args = JSON.parse(call.args || '{}'); } catch {} got = true; onText('\n```nbx-action\n' + JSON.stringify({ tool: call.name, args }) + '\n```'); }
      if (got) return { model: d.label, modelId: d.id, mode: 'free', left: prep.left, direct: true };
    } catch (e) { if (e && e.name === 'AbortError') throw e; if (got) return { model: d.label, mode: 'free', left: prep.left, direct: true }; }
    body.prepaid = prep.token; // the direct call failed before answering: let the server answer, already counted
  }
  let out = { model: null, mode: null };
  await streamPost('/api/ai/chat', body, { signal, onData: (ev) => {
    if (ev.src) onSources(ev.src); else if (ev.r) onReason(ev.r); else if (ev.d) onText(ev.d);
    else if (ev.error) out.error = ev.error; else if (ev.done) out = Object.assign(out, { model: ev.model, modelId: ev.modelId, mode: ev.mode, fallback: ev.fallback, left: ev.left });
  } });
  if (out.error) throw Object.assign(new Error(out.error), { soft: true });
  return out;
}

// a one-shot rewrite (no streaming UI): returns the full text
// strict: refuse answers from the built-in helper (used when rewriting someone's text, which must never be replaced by an unrelated answer)
export async function novaOnce(prompt, { mode = 'chat', signal, strict = true } = {}) { let txt = ''; const r = await askNova({ messages: [{ role: 'user', content: prompt }], mode, signal, onText: (d) => { txt += d; } }); if (strict && (r.mode === 'local' || r.fallback)) throw Object.assign(new Error('busy'), { busy: true }); return txt.trim(); }

// free image generation (loaded straight by the browser, safe filter on)
export const STYLES = { none: ['Auto', ''], photo: ['Realistic', ', ultra realistic photo, detailed, natural light'], anime: ['Anime', ', anime style, vibrant, detailed illustration'], pixel: ['Pixel art', ', pixel art, 16-bit, retro game sprite'], render: ['3D', ', 3D render, octane, soft lighting, high detail'], water: ['Watercolor', ', watercolor painting, soft colors'], neon: ['Neon', ', cyberpunk neon, glowing, night'] };
export const SIZES = { square: [1024, 1024], wide: [1280, 720], tall: [720, 1280] };
export function imageUrl(prompt, { style = 'none', size = 'square', seed } = {}) {
  const [w, hh] = SIZES[size] || SIZES.square; const s = seed || Math.floor(Math.random() * 1e9);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(String(prompt).slice(0, 600) + (STYLES[style] || STYLES.none)[1])}?width=${w}&height=${hh}&seed=${s}&nologo=true&safe=true&model=flux`;
}

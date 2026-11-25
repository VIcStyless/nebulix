// Nebulix 3.0 — Python playground worker: CPython (Pyodide, WebAssembly) running in this browser tab only, inside a
// Web Worker so a long or endless program never freezes the page (Stop terminates the worker). Nothing runs on the server.
import { loadPyodide } from './vendor/pyodide/pyodide.mjs';
let py = null;
const post = (type, data) => self.postMessage({ type, ...data });
self.onmessage = async (e) => {
  const { id, code, stdin } = e.data;
  try {
    if (!py) { const t0 = performance.now(); py = await loadPyodide({ indexURL: '/js/vendor/pyodide/', stdout: (s) => post('out', { text: s }), stderr: (s) => post('err', { text: s }) }); post('ready', { ms: Math.round(performance.now() - t0), version: py.version }); }
    const lines = String(stdin || '').split('\n'); let i = 0;
    py.setStdin({ stdin: () => (i < lines.length && (i < lines.length - 1 || lines[i] !== '') ? lines[i++] : null) });
    const t0 = performance.now(); const r = await py.runPythonAsync(code);
    post('done', { id, result: r === undefined || r === null ? null : String(r), ms: Math.round(performance.now() - t0) });
  } catch (err) { post('error', { id, message: String(err && err.message || err) }); }
};

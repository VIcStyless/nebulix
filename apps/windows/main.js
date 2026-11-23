'use strict';
// Nebulix for Windows: a hardened desktop window for Nebulix.
// Security: the page has NO access to Node.js or your files (contextIsolation + sandbox, no preload, no remote code),
// only Nebulix's own addresses open inside the app (any other link opens in your normal browser), downloads ask where
// to save, and camera / microphone / notifications are allowed only for Nebulix. If the main address does not answer,
// the app tries the mirror addresses of the same server.
const { app, BrowserWindow, shell, session, Menu, dialog } = require('electron');
const path = require('path');

const ADDRESSES = ['https://nebulix.fly.dev', 'https://nebulix-play.fly.dev', 'https://nebulix-zone.fly.dev', 'https://nebulix-hq.fly.dev'];
const isNebulix = (url) => { try { const u = new URL(url); const h = u.hostname.toLowerCase(); return u.protocol === 'https:' && (h === 'nebulix.fly.dev' || (h.startsWith('nebulix-') && h.endsWith('.fly.dev'))); } catch { return false; } };
const openOutside = (url) => { try { const u = new URL(url); if (u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:') shell.openExternal(u.href); } catch {} };

if (!app.requestSingleInstanceLock()) app.quit();
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('ignore-gpu-blocklist'); // smoother 3D games and emulators

let win = null; let index = 0;
function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600, backgroundColor: '#0b0c14', title: 'Nebulix', icon: path.join(__dirname, 'build', 'icon.png'), autoHideMenuBar: true, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, spellcheck: true, backgroundThrottling: false },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (isNebulix(url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: '#0b0c14', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } } }; openOutside(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!isNebulix(url)) { e.preventDefault(); openOutside(url); } });
  win.webContents.on('did-fail-load', (e, code, desc, url, isMain) => { if (isMain && code !== -3 && index < ADDRESSES.length - 1) { index++; win.loadURL(ADDRESSES[index]); } });
  win.webContents.on('before-input-event', (e, input) => { if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); } });
  win.loadURL(ADDRESSES[0]);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Nebulix', submenu: [{ role: 'reload', label: 'Reload' }, { role: 'togglefullscreen', label: 'Full screen' }, { type: 'separator' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'quit', label: 'Quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  ]));
  const ses = session.defaultSession;
  // only Nebulix pages (and its own frames) may use the camera, microphone, notifications, full screen or the clipboard
  const ALLOWED = new Set(['media', 'notifications', 'fullscreen', 'clipboard-sanitized-write', 'clipboard-read', 'pointerLock']);
  ses.setPermissionRequestHandler((wc, perm, cb, details) => cb(ALLOWED.has(perm) && isNebulix(details.requestingUrl || wc.getURL())));
  ses.setPermissionCheckHandler((wc, perm, origin) => ALLOWED.has(perm) && isNebulix(origin));
  ses.on('will-download', (e, item) => { const p = dialog.showSaveDialogSync(win, { defaultPath: item.getFilename() }); if (p) item.setSavePath(p); else item.cancel(); });
  createWindow();
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
app.on('web-contents-created', (e, wc) => { wc.on('will-attach-webview', (ev) => ev.preventDefault()); }); // no <webview> tags

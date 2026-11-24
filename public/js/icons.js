import { h } from './util.js';
const P = {
  down: 'M6 9l6 6 6-6', up: 'M6 15l6-6 6 6',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', camera: 'M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', widget: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z', agents: 'M12 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM5 15a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM19 15a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM12 9v3M12 12l-5 3M12 12l5 3', gauge: 'M4 16a8 8 0 1 1 16 0M12 16l4-6M8 20h8',
  video: 'M3 7a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM16 10l5-3v10l-5-3', videooff: 'M3 3l18 18M8 5h6a2 2 0 0 1 2 2v4l5-3v10M16 17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 1-1.7', list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01', sound: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  gem: 'M6 3h12l4 6-10 12L2 9zM2 9h20M12 21 8 9l4-6 4 6z', box3d: 'M12 2l9 5v10l-9 5-9-5V7zM12 22V12M21 7l-9 5-9-5',
  home: 'M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z', globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  book: 'M6 3h9l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM15 3v5h5M9 13h7M9 17h5',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z', users: 'M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 20v-1.5a4 4 0 0 0-3-3.9M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
  mail: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 7l9 6 9-6', dice: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01',
  bag: 'M6 7h12l1 13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1zM9 7V6a3 3 0 0 1 6 0v1', palette: 'M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2s-1-1.6-1-2.6c0-.9.8-1.4 1.7-1.4H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3zM7.5 11h.01M10 7.5h.01M14.5 7.5h.01M17 11h.01',
  spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z', flask: 'M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2.2h12.4a1.5 1.5 0 0 0 1.3-2.2L14 9V3M7.5 15h9',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  crown: 'M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5z', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3', plus: 'M12 5v14M5 12h14', x: 'M6 6l12 12M18 6L6 18',
  send: 'M21 3L10 14M21 3l-7 18-4-7-7-4z', image: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM20 16l-5-5L5 20',
  smile: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 14a5 5 0 0 0 8 0M9 9.5h.01M15 9.5h.01', heart: 'M12 20s-8-4.6-8-10.2A4.8 4.8 0 0 1 12 7a4.8 4.8 0 0 1 8 2.8C20 15.4 12 20 12 20z',
  lock: 'M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V8a4 4 0 0 1 8 0v3', key: 'M15 8.5a4.5 4.5 0 1 1-3.3 4.4L4 20.6V22h2v-2h2v-2h2l1.8-1.8M16.5 8h.01',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7', back: 'M19 12H5M11 6l-6 6 6 6', fwd: 'M5 12h14M13 6l6 6-6 6', star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  bookmark: 'M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z', download: 'M12 3v12M7 10l5 5 5-5M4 20h16', upload: 'M12 15V3M7 8l5-5 5 5M4 20h16',
  copy: 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1', trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4', bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4', logout: 'M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M16 8l4 4-4 4M20 12H9', user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1', external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  fullscreen: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', zoomin: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3M11 8v6M8 11h6', zoomout: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3M8 11h6',
  trophy: 'M8 4h8v6a4 4 0 0 1-8 0zM8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 14v4M8 21h8M10 18h4', cpu: 'M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
  wifi: 'M2.5 9a15 15 0 0 1 19 0M5.5 12.5a10.5 10.5 0 0 1 13 0M8.5 16a6 6 0 0 1 7 0M12 19.5h.01', monitor: 'M3 4h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 21h8M12 17v4',
  gamepad: 'M6 8h12a4 4 0 0 1 4 4v1a3 3 0 0 1-5 2l-1-1H8l-1 1a3 3 0 0 1-5-2v-1a4 4 0 0 1 4-4zM8 10v4M6 12h4M15.5 11h.01M17.5 13h.01', keyboard: 'M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10',
  mouse: 'M12 3a6 6 0 0 0-6 6v6a6 6 0 0 0 12 0V9a6 6 0 0 0-6-6zM12 3v6', terminal: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM7 10l3 2-3 2M12 15h5', check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 3l10 18H2zM12 10v5M12 18h.01', eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', eyeoff: 'M3 3l18 18M10.6 6.2A9.6 9.6 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.6 7.7A17 17 0 0 0 2 12s3.6 6 10 6a9.6 9.6 0 0 0 3.2-.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  hash: 'M5 9h15M4 15h15M10 3L8 21M16 3l-2 18', volume: 'M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12', clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2', play: 'M7 4l13 8-13 8z', pause: 'M8 5v14M16 5v14',
  puzzle: 'M10 4a2 2 0 1 1 4 0v1h4a1 1 0 0 1 1 1v4h-1a2 2 0 1 0 0 4h1v4a1 1 0 0 1-1 1h-4v-1a2 2 0 1 0-4 0v1H6a1 1 0 0 1-1-1v-4h1a2 2 0 1 0 0-4H5V6a1 1 0 0 1 1-1h4z', info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5h.01',
  flag: 'M5 21V4M5 4h12l-2 4 2 4H5', menu: 'M4 6h16M4 12h16M4 18h16', more: 'M5 12h.01M12 12h.01M19 12h.01', reply: 'M9 14L4 9l5-5M4 9h9a7 7 0 0 1 7 7v3', pin: 'M9 4h6l-1 6 3 3H7l3-3zM12 13v8', window: 'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM2 9h20',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z', sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4', bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  gift: 'M4 11h16v10H4zM3 7h18v4H3zM12 7v14M12 7S10 3 8 3a2 2 0 0 0 0 4h4zM12 7s2-4 4-4a2 2 0 0 1 0 4h-4z', server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01', clip: 'M20 12l-7.5 7.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7',
  power: 'M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3M9 21h6', micoff: 'M3 3l18 18M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.9-.8M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.7 3M12 18v3M9 21h6',
  stop: 'M6 6h12v12H6z', translate: 'M4 5h9M8.5 3v2M6 5c.6 3 2.8 5.6 5.5 7M11 5c-.7 3.3-3.4 6.4-7 8M13 21l4-10 4 10M14.6 17.5h4.8', swap: 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7', save: 'M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z', shuffle: 'M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5', repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
  rock: 'M7 9.5a2 2 0 0 1 4 0V8a2 2 0 0 1 4 0v1a2 2 0 0 1 4 0v5a7 7 0 0 1-7 7h-1a6 6 0 0 1-6-6v-3a2 2 0 0 1 4 0', paper: 'M8 13V5a1.5 1.5 0 0 1 3 0v6M11 10V3.5a1.5 1.5 0 0 1 3 0V10M14 10V5a1.5 1.5 0 0 1 3 0v8a8 8 0 0 1-8 8h-.5a6 6 0 0 1-5-2.7L2.4 15a1.6 1.6 0 0 1 2.6-1.8L8 16',
  scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12', medal: 'M7 3h10l-3 6h-4zM12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 12.5v4', snake: 'M4 18c0-3 3-3 5-3s5 0 5-3-3-3-5-3-5 0-5-3 3-3 5-3h8M18 3h2v2', type: 'M4 7V5h16v2M9 19h6M12 5v14', sidebar: 'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM9 4v16', grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z', note: 'M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M8 13h8M8 17h5', target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z', calendar: 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 10h16M8 3v4M16 3v4', chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2', zap: 'M13 2L4 14h7l-1 8 9-12h-7z', command: 'M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z', inbox: 'M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM3 13h5l1 3h6l1-3h5', activity: 'M3 12h4l3-8 4 16 3-8h4', layout: 'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM3 10h18M10 10v10', share: 'M3 4h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 21h8M12 17v4M12 13V8M9.5 10.5L12 8l2.5 2.5', phoneoff: 'M3 3l18 18M10.7 13.3a13 13 0 0 1-2.4-3.3l1.6-1.6a1 1 0 0 0 .2-1.1L9 4.6A1 1 0 0 0 8 4H4.5A1.5 1.5 0 0 0 3 5.6 17 17 0 0 0 7.6 16.4M13.4 15.9a13 13 0 0 0 2.3 1.2l1.6-1.6a1 1 0 0 1 1.1-.2l2.7 1.2a1 1 0 0 1 .6.9v3.5a1.5 1.5 0 0 1-1.6 1.5 17 17 0 0 1-7.6-2.4',
  music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z', desktop: 'M3 4h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM6 8h3M6 11h3M8 21h8M12 17v4M13 8h5v5h-5z',
  cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12L4 7.5M12 12v9', sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M10 10v4M16 16v4', layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5', coins: 'M8 8a5 3 0 1 0 0-6 5 3 0 0 0 0 6zM3 5v4c0 1.7 2.2 3 5 3s5-1.3 5-3V5M13 12c0 1.7-2.2 3-5 3s-5-1.3-5-3M3 12v4c0 1.7 2.2 3 5 3 1.4 0 2.7-.3 3.6-.9M16 21a5 3 0 1 0 0-6 5 3 0 0 0 0 6z',
  // 13.1
  phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2',
  thumbup: 'M7 10v11M3 10h4v11H3zM7 10l4-7a2 2 0 0 1 3 2l-1 5h6a2 2 0 0 1 2 2.3l-1.4 7A2 2 0 0 1 17.6 21H7', thumbdown: 'M17 14V3M21 14h-4V3h4zM17 14l-4 7a2 2 0 0 1-3-2l1-5H5a2 2 0 0 1-2-2.3l1.4-7A2 2 0 0 1 6.4 3H17',
  bot: 'M12 3v3M8 6h8a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3zM9 12h.01M15 12h.01M9 16h6M2 12v3M22 12v3', branch: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  fork: 'M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 9v1a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9M12 12v3', issue: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 12a1 1 0 1 0 0-.01',
  tag: 'M3 12V3h9l9 9-9 9zM7.5 7.5h.01', cart: 'M3 3h2l2.4 12.4a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.6L21 7H6M9 21h.01M18 21h.01', storm: 'M4 14a8 8 0 1 1 16 0M2 18h20M6 22h12M12 6v4', wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z',
  cross: 'M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z', crate: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10', swords: 'M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 6.5L14 2h3v3l-4.5 4.5M5 14l-2 2 4 4 2-2'
};
export function icon(name, size = 20, extra) {
  return h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: extra || null, style: 'flex:none' }, h('path', { d: P[name] || P.info }));
}
export const iconNames = Object.keys(P);

// The Nebulix mark as inline SVG, so it can animate (stroke draws on hover; nodes pulse). `cls` lets callers
// add e.g. 'logo-draw' (draw once on mount). Colours come from CSS (.nx-logo rules in app.css).
// Swappable app logos (Settings → Appearance, or the account menu). Each draws inside the same 64×64 tile.
export const LOGOS = [
  ['classic', 'Classic N', [['path', { d: 'M20 46V24.5a2.5 2.5 0 0 1 4.3-1.7L39.7 41.2a2.5 2.5 0 0 0 4.3-1.7V18' }], ['node', 20, 46], ['node', 44, 18]]],
  ['orbit', 'Orbit', [['path', { d: 'M12 36c6 10 34 10 40-6M52 28C46 18 18 18 12 34' }], ['node', 32, 32, 7], ['node', 50, 24]]],
  ['bolt', 'Bolt', [['path', { d: 'M36 10 18 36h14l-4 18 18-26H32z' }]]],
  ['pixel', 'Pixel', [['path', { d: 'M18 46V18h8v8h6v8h6v-16h8v28h-8v-8h-6v-8h-6v16z' }]]],
  ['cube', 'Cube', [['path', { d: 'M32 12 50 22v20L32 52 14 42V22zM32 32 50 22M32 32v20M32 32 14 22' }]]],
  ['star', 'Star', [['path', { d: 'M32 12l5.8 12.6 13.8 1.5-10.3 9.3 2.9 13.6L32 42l-12.2 7 2.9-13.6-10.3-9.3 13.8-1.5z' }]]],
  ['planet', 'Planet', [['node', 32, 32, 11], ['path', { d: 'M10 40c8 4 36-6 44-16' }]]],
  ['ghost', 'Ghost', [['path', { d: 'M18 50V28a14 14 0 0 1 28 0v22l-5-4-4.5 4-4.5-4-4.5 4-4.5-4zM26 30h.01M38 30h.01' }]]],
];
const logoId = () => { try { return JSON.parse(localStorage.getItem('nbx.logo')) || 'classic'; } catch { return 'classic'; } };
export function logoMark(size = 28, cls, id) {
  const def = LOGOS.find((l) => l[0] === (id || logoId())) || LOGOS[0];
  return h('svg.nx-logo' + (cls ? '.' + cls : ''), { viewBox: '0 0 64 64', width: size, height: size, 'aria-hidden': 'true', style: 'flex:none', dataset: { logo: def[0] } },
    h('rect.nl-tile', { x: 2, y: 2, width: 60, height: 60, rx: Math.round(size * 0.23) }),
    def[2].map((p) => (p[0] === 'path' ? h('path.nl-path', Object.assign({ fill: 'none' }, p[1])) : h('circle.nl-node', { cx: p[1], cy: p[2], r: p[3] || 4.5 }))));
}
// Re-draws every logo on the page and the favicon with the chosen design.
export function setLogo(id) {
  try { localStorage.setItem('nbx.logo', JSON.stringify(id)); } catch {}
  for (const el of document.querySelectorAll('svg.nx-logo')) { const n = logoMark(Number(el.getAttribute('width')) || 28, [...el.classList].filter((c) => c !== 'nx-logo').join('.'), id); el.replaceWith(n); }
  paintFavicon();
}
export function paintFavicon() {
  try {
    if (document.documentElement.dataset.cloaked === '1') return;
    const svg = logoMark(64); const cs = getComputedStyle(document.documentElement);
    const acc = cs.getPropertyValue('--accent').trim() || '#d4ff3f'; const ink = cs.getPropertyValue('--on-accent').trim() || '#0b0c0e';
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.querySelector('.nl-tile').setAttribute('fill', acc);
    svg.querySelectorAll('.nl-path').forEach((p) => { p.setAttribute('stroke', ink); p.setAttribute('stroke-width', '5'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round'); });
    svg.querySelectorAll('.nl-node').forEach((c) => c.setAttribute('fill', ink));
    let link = document.querySelector('link[rel="icon"]'); if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.type = 'image/svg+xml'; link.href = 'data:image/svg+xml,' + encodeURIComponent(svg.outerHTML);
  } catch {}
}

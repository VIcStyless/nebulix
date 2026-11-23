// Nerd Lab → Linux Lab: try Linux (and a few other operating systems) in your browser with DistroSea, straight from Nebulix.
// DistroSea is an independent third-party service. Nebulix only links to it and can open it through its own proxy.
import { h, mount, hueOf, initial } from '../util.js';
import { t, getLang, pick2 } from '../i18n.js';
import { icon } from '../icons.js';
import { copyBtn, tabsEl } from '../ui.js';
import { api, ws } from '../api.js';
import { card, pill } from './common.js';

// [slug, name, family, tags]
export const DISTROS = [
  ['aerynos', 'AerynOS', 'Independent', 'advanced immutable'], ['alma', 'AlmaLinux', 'Red Hat family', 'server'], ['alpine', 'Alpine Linux', 'Independent', 'light advanced server'], ['anduinos', 'AnduinOS', 'Ubuntu-based', 'beginner'],
  ['antix', 'antiX', 'Debian-based', 'light'], ['archcraft', 'Archcraft', 'Arch-based', 'light'], ['archlinux', 'Arch Linux', 'Independent', 'advanced popular'], ['arcolinux', 'ArcoLinux', 'Arch-based', 'advanced'],
  ['artixlinux', 'Artix Linux', 'Arch-based', 'advanced'], ['bazzite', 'Bazzite', 'Fedora-based', 'gaming immutable popular'], ['biglinux', 'BigLinux', 'Arch-based', 'beginner'], ['blendos', 'blendOS', 'Arch-based', 'immutable'],
  ['bodhi', 'Bodhi Linux', 'Ubuntu-based', 'light'], ['bunsenlabs', 'BunsenLabs', 'Debian-based', 'light'], ['cachyos', 'CachyOS', 'Arch-based', 'gaming popular'], ['centosstream', 'CentOS Stream', 'Red Hat family', 'server'],
  ['chimeralinux', 'Chimera Linux', 'Independent', 'advanced'], ['debian', 'Debian', 'Independent', 'popular server'], ['deepin', 'Deepin', 'Debian-based', 'beginner'], ['devuan', 'Devuan', 'Debian-based', 'advanced'],
  ['dragonflybsd', 'DragonFly BSD', 'BSD', 'other'], ['edubuntu', 'Edubuntu', 'Ubuntu-based', 'beginner'], ['elementary', 'elementary OS', 'Ubuntu-based', 'beginner'], ['emmabuntus', 'Emmabuntüs', 'Debian-based', 'light'],
  ['endeavouros', 'EndeavourOS', 'Arch-based', 'popular'], ['endless', 'Endless OS', 'Debian-based', 'beginner immutable'], ['fedora', 'Fedora Linux', 'Independent', 'popular'], ['freebsd', 'FreeBSD', 'BSD', 'other server'],
  ['garuda', 'Garuda Linux', 'Arch-based', 'gaming'], ['gentoo', 'Gentoo Linux', 'Independent', 'advanced'], ['haiku', 'Haiku', 'Own OS', 'other'], ['holoiso', 'HoloISO', 'Arch-based', 'gaming'],
  ['kdeneon', 'KDE neon', 'Ubuntu-based', ''], ['kolibrios', 'KolibriOS', 'Own OS', 'other light'], ['kubuntu', 'Kubuntu', 'Ubuntu-based', 'beginner'], ['linuxlite', 'Linux Lite', 'Ubuntu-based', 'light beginner'],
  ['linuxmint', 'Linux Mint', 'Ubuntu-based', 'beginner popular'], ['lmde', 'LMDE', 'Debian-based', 'beginner'], ['lubuntu', 'Lubuntu', 'Ubuntu-based', 'light'], ['mageia', 'Mageia', 'Independent', ''],
  ['manjaro', 'Manjaro', 'Arch-based', 'popular beginner'], ['mxlinux', 'MX Linux', 'Debian-based', 'popular light'], ['nitrux', 'Nitrux', 'Debian-based', 'immutable'], ['nixos', 'NixOS', 'Independent', 'advanced'],
  ['nobara', 'Nobara', 'Fedora-based', 'gaming'], ['openindiana', 'OpenIndiana', 'Own OS', 'other'], ['openmandriva', 'OpenMandriva', 'Independent', ''], ['opensuse', 'openSUSE', 'SUSE', 'popular'],
  ['pclinuxos', 'PCLinuxOS', 'Independent', 'beginner'], ['pearos', 'pearOS', '', ''], ['peppermint', 'PeppermintOS', 'Debian-based', 'light'], ['pikaos', 'PikaOS', 'Debian-based', 'gaming'],
  ['popos', 'Pop!_OS', 'Ubuntu-based', 'gaming popular'], ['porteus', 'Porteus', 'Slackware-based', 'light'], ['primtux', 'PrimTux', '', 'beginner'], ['puppylinux', 'Puppy Linux', 'Independent', 'light'],
  ['pureos', 'PureOS', 'Debian-based', 'privacy'], ['q4os', 'Q4OS', 'Debian-based', 'light beginner'], ['reactos', 'ReactOS', 'Own OS', 'other'], ['rebornos', 'RebornOS', 'Arch-based', ''],
  ['redox', 'Redox OS', 'Own OS', 'other'], ['rockylinux', 'Rocky Linux', 'Red Hat family', 'server'], ['siduction', 'Siduction', 'Debian-based', 'advanced'], ['slackware', 'Slackware', 'Independent', 'advanced'],
  ['slax', 'Slax', 'Debian-based', 'light'], ['slitaz', 'SliTaz', 'Independent', 'light'], ['solus', 'Solus', 'Independent', 'beginner'], ['sparkylinux', 'SparkyLinux', 'Debian-based', 'light'],
  ['spirallinux', 'SpiralLinux', 'Debian-based', 'beginner'], ['tails', 'Tails', 'Debian-based', 'privacy'], ['tinycore', 'Tiny Core Linux', 'Independent', 'light'], ['trisquel', 'Trisquel', 'Ubuntu-based', 'privacy'],
  ['tuxedoos', 'TUXEDO OS', 'Ubuntu-based', 'beginner'], ['ubuntu', 'Ubuntu', 'Debian-based', 'popular beginner'], ['ubuntubudgie', 'Ubuntu Budgie', 'Ubuntu-based', 'beginner'], ['ubuntucinnamon', 'Ubuntu Cinnamon', 'Ubuntu-based', 'beginner'],
  ['ubuntukylin', 'Ubuntu Kylin', 'Ubuntu-based', ''], ['ubuntumate', 'Ubuntu MATE', 'Ubuntu-based', 'beginner light'], ['ubuntustudio', 'Ubuntu Studio', 'Ubuntu-based', ''], ['ubuntuunity', 'Ubuntu Unity', 'Ubuntu-based', 'beginner'],
  ['vanillaos', 'Vanilla OS', 'Debian-based', 'immutable'], ['void', 'Void Linux', 'Independent', 'advanced light'], ['voyager', 'Voyager Live', '', ''], ['xubuntu', 'Xubuntu', 'Ubuntu-based', 'light'], ['zorin', 'Zorin OS', 'Ubuntu-based', 'beginner popular'],
].map(([slug, name, family, tags]) => ({ slug, name, family, tags: tags ? tags.split(' ') : [] }));

// Why gamers like them (EN / ES). Short and factual.
const PICKS = {
  bazzite: ['Console-like Fedora image built for gaming and handhelds — Steam, drivers and controller support ready from the first boot.', 'Imagen de Fedora tipo consola hecha para jugar y para portátiles — Steam, drivers y mandos listos desde el primer arranque.'],
  nobara: ['Fedora tweaked by GloriousEggroll: gaming patches, media codecs and Steam/Lutris tools preinstalled.', 'Fedora retocado por GloriousEggroll: parches para juegos, códecs y herramientas como Steam/Lutris preinstaladas.'],
  popos: ['Ubuntu-based and friendly with NVIDIA GPUs — a popular first gaming install.', 'Basado en Ubuntu y amigable con las GPU NVIDIA — una primera instalación muy popular para jugar.'],
  cachyos: ['Arch-based and tuned for speed: optimised kernels and gaming packages a click away.', 'Basado en Arch y afinado para rendir: kernels optimizados y paquetes para juegos a un clic.'],
  garuda: ['Arch-based with a gaming edition, Btrfs snapshots and a flashy desktop.', 'Basado en Arch con edición gaming, instantáneas Btrfs y un escritorio llamativo.'],
  linuxmint: ['Rock-solid and simple — a great starting point if you are coming from Windows.', 'Estable y sencillo — un gran punto de partida si vienes de Windows.'],
  fedora: ['Fresh kernels and drivers; popular with developers and gamers alike.', 'Kernels y drivers recientes; popular entre desarrolladores y jugadores.'],
  ubuntu: ['The most widely supported desktop Linux — most game and driver guides assume it.', 'El Linux de escritorio con más soporte — casi todas las guías de juegos y drivers lo asumen.'],
  pikaos: ['Debian-based with gaming in mind: Steam-ready setup and fresh graphics stacks.', 'Basado en Debian pensando en juegos: Steam listo para usar y pilas gráficas recientes.'],
  holoiso: ['A community build that imitates SteamOS on regular PCs (Steam Deck-style interface).', 'Una versión de la comunidad que imita SteamOS en PCs normales (interfaz estilo Steam Deck).'],
  reactos: ['An open-source system that aims to run Windows programs — a curiosity worth poking at.', 'Un sistema de código abierto que busca ejecutar programas de Windows — una curiosidad para trastear.'],
};
const FILTERS = [['all', 'All'], ['popular', 'Popular'], ['gaming', 'Gaming'], ['beginner', 'Beginner'], ['light', 'Lightweight'], ['privacy', 'Privacy'], ['advanced', 'Advanced'], ['immutable', 'Immutable'], ['server', 'Server'], ['other', 'Other OS']];

export const distroUrl = (slug, lang = getLang()) => `https://distrosea.com/${lang === 'es' ? 'es/' : ''}${slug ? `select/${slug}/` : ''}`;
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Best match for what someone typed: exact slug/name, then prefix, then substring (popular systems win ties).
export const findDistro = (q) => {
  q = norm(q); if (!q) return null;
  const rank = (list) => list.sort((a, b) => b.tags.includes('popular') - a.tags.includes('popular'))[0] || null;
  return DISTROS.find((d) => d.slug === q || norm(d.name) === q) || rank(DISTROS.filter((d) => d.slug.startsWith(q) || norm(d.name).startsWith(q))) || rank(DISTROS.filter((d) => d.slug.includes(q) || norm(d.name).includes(q)));
};

export default {
  mount(host, ctx) {
    const open = (url, name) => { api.post('/api/progress/event', { type: 'distro' }, { quiet: true }).catch(() => {}); ws.send({ t: 'act', kind: 'nerd', label: name ? t('Trying {n}', { n: name }) : 'DistroSea' }); ctx.go('browse', { go: url }); };
    const out = (url) => window.open(url, '_blank', 'noopener,noreferrer');
    let q = '', f = 'all';
    const grid = h('div.nl-distros'); const count = h('span.small.muted');
    const dcard = (d, big) => {
      const url = distroUrl(d.slug); const blurb = PICKS[d.slug] ? pick2(PICKS[d.slug]) : '';
      return h('div.card.nl-distro' + (big ? '.big' : ''), { dataset: { slug: d.slug } },
        h('div.row', h('div.nl-dlogo', { style: { '--h': hueOf(d.slug) } }, initial(d.name)), h('div.grow', h('b.ellipsis', d.name), h('div.tiny.muted', d.family ? t(d.family) : '')),
          h('button.btn.sm.ghost.icon', { title: t('Open outside Nebulix'), 'aria-label': t('Open {n} outside Nebulix', { n: d.name }), onClick: () => out(url) }, icon('external', 15))),
        blurb ? h('p.small', blurb) : h('div.nl-tags', d.tags.map((x) => h('span.pill', t(FILTERS.find((e) => e[0] === x)?.[1] || x)))),
        h('button.btn.primary.sm.block', { onClick: () => open(url, d.name) }, icon('play', 14), t('Try {n}', { n: d.name })));
    };
    function paint() {
      const s = q.trim().toLowerCase(); const list = DISTROS.filter((d) => (f === 'all' || d.tags.includes(f)) && (!s || d.name.toLowerCase().includes(s) || d.slug.includes(s) || (d.family || '').toLowerCase().includes(s)));
      count.textContent = t('Showing {a} of {b} systems', { a: list.length, b: DISTROS.length });
      mount(grid, ...(list.length ? list.map((d) => dcard(d)) : [h('div.empty', h('div.empty-art.ea-mark'), h('p', t('No system matches that search.')))]));
    }
    const search = h('input.input', { type: 'search', placeholder: t('Search systems (e.g. Mint, Arch, gaming…)'), 'aria-label': t('Search systems'), onInput: (e) => { q = e.target.value; paint(); } });
    const chips = tabsEl(FILTERS.map(([id, l]) => [id, t(l)]), f, (id) => { f = id; paint(); });
    const picks = Object.keys(PICKS).map((slug) => DISTROS.find((d) => d.slug === slug)).filter(Boolean);
    const wsl = [['wsl --list --online', t('See every distro you can install')], ['wsl --install -d Ubuntu', t('Install Ubuntu next to Windows')], ['wsl --install -d Debian', t('Or Debian')]];

    mount(host,
      h('div.card.nl-card.nl-hero', h('div.row.wrap', h('div.grow', h('h3', { style: 'margin:0' }, '', t('Linux Lab')), h('p.muted', { style: 'margin:6px 0 0' }, t('Try Ubuntu, Arch, Fedora, Mint and dozens more without installing anything. DistroSea runs the virtual machine on its servers and streams it to your browser.'))),
        h('div.col', { style: 'gap:8px' }, h('button.btn.primary.lg', { onClick: () => open(distroUrl('')) }, icon('globe', 18), t('Open DistroSea in Nebulix')), h('button.btn', { onClick: () => out(distroUrl('')) }, icon('external', 16), t('Open outside Nebulix')))),
        h('ul.nl-notes', h('li', t('DistroSea is a separate website and is not made by Nebulix. Sessions are temporary and nothing you do there is saved.')),
          h('li', t('If the screen stays black through the proxy, use "Open outside Nebulix" — streaming VMs do not always like being proxied.')),
          h('li', t('The machines have no graphics card, so this is for exploring desktops, installers and the terminal — not for 3D games.')))),
      h('h3', { style: 'margin:18px 0 8px' }, icon('gamepad', 18), ' ', t('Picks for gamers')),
      h('div.nl-distros', picks.map((d) => dcard(d, true))),
      h('h3', { style: 'margin:22px 0 8px' }, icon('layers', 18), ' ', t('All systems')),
      h('div.row.wrap', h('div.grow', { style: 'min-width:220px' }, search), count), chips, grid,
      card(t('Prefer to run Linux on your own PC?'), 'terminal',
        h('p.small.muted', t('On Windows 10/11 you can install Linux inside Windows with WSL. Open PowerShell as administrator and run:')),
        wsl.map(([cmd, d]) => h('div.nl-cmd', h('code.grow', cmd), h('span.tiny.muted', d), copyBtn(cmd))),
        h('p.tiny.muted', t('Want a full desktop and real graphics instead? A virtual machine (VirtualBox, VMware, Hyper-V) or a USB live stick works too.'))));
    paint();
    return () => {};
  },
};

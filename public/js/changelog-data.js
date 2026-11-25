// Central changelog. Add a new release object to the TOP of this array for every update.
// Each change: { type: 'new' | 'improved' | 'fixed', en: '…', es: '…' }. The view shows es for Spanish, en otherwise.
export const CHANGELOG = [
  {
    "v": "15.7",
    "date": "2026-11-25",
    "title": { "en": "Nebulix 3.0, phase 15: discover free games and deals", "es": "Nebulix 3.0, fase 15: descubre juegos gratis y ofertas" },
    "changes": [
      { "type": "new", "en": "Discover games: hundreds of free-to-play PC and browser games (with genres, platforms and search) and the best current deals from official stores like Steam, GOG and Epic — with discounts, prices and reviews. Nebulix links to the official sites; it does not host these games.", "es": "Descubrir juegos: cientos de juegos gratuitos para PC y navegador (con géneros, plataformas y búsqueda) y las mejores ofertas actuales de tiendas oficiales como Steam, GOG y Epic, con descuentos, precios y valoraciones. Nebulix enlaza a las webs oficiales; no aloja estos juegos." }
    ]
  },
  {
    "v": "15.6.1",
    "date": "2026-11-25",
    "title": { "en": "Fixes from a full quality sweep", "es": "Correcciones tras una revisión completa" },
    "changes": [
      { "type": "fixed", "en": "The old #/fps link showed “This page could not be loaded”; it now opens the Arena (Nebula Ops 3D).", "es": "El antiguo enlace #/fps mostraba «Esta página no se pudo cargar»; ahora abre el Arena (Nebula Ops 3D)." },
      { "type": "fixed", "en": "The server no longer re-parses the shared Arena code with a warning on every start.", "es": "El servidor ya no vuelve a analizar el código compartido del Arena con un aviso en cada arranque." }
    ]
  },
  {
    "v": "15.6",
    "date": "2026-11-25",
    "title": { "en": "Cloud PC is live on Nebulix's own compute server", "es": "Cloud PC ya funciona en el servidor de cómputo de Nebulix" },
    "changes": [
      { "type": "new", "en": "Nebulix now has its own compute server: create Debian 12 or Alpine Linux machines in Cloud PC and use them from your browser. The server has no hardware virtualisation, so machines run in software emulation — they work, but boot in about a minute and run slower.", "es": "Nebulix ya tiene su propio servidor de cómputo: crea máquinas con Debian 12 o Alpine Linux en Cloud PC y úsalas desde el navegador. El servidor no tiene virtualización por hardware, así que las máquinas funcionan con emulación por software: van bien, pero tardan alrededor de un minuto en arrancar y son más lentas." },
      { "type": "improved", "en": "Nebulix Android explains clearly that it needs a server with hardware virtualisation, which the current compute server does not have.", "es": "Nebulix Android explica claramente que necesita un servidor con virtualización por hardware, que el servidor de cómputo actual no tiene." }
    ]
  },
  {
    "v": "15.5",
    "date": "2026-11-25",
    "title": { "en": "Nebulix 3.0, phase 14: Python in the browser", "es": "Nebulix 3.0, fase 14: Python en el navegador" },
    "changes": [
      { "type": "new", "en": "Developer Toolbox → Python: real CPython 3 (WebAssembly) running only in your tab. Standard library, input(), tracebacks, and a Stop button that always works because programs run in a separate worker.", "es": "Caja de herramientas → Python: CPython 3 real (WebAssembly) que funciona solo en tu pestaña. Biblioteca estándar, input(), trazas de error y un botón Detener que siempre funciona porque los programas se ejecutan en un proceso aparte." }
    ]
  },
  {
    "v": "15.4",
    "date": "2026-11-25",
    "title": { "en": "Nebulix 3.0, phase 13: no more lost edits when you write in the same place", "es": "Nebulix 3.0, fase 13: ya no se pierden cambios al escribir en el mismo sitio" },
    "changes": [
      { "type": "improved", "en": "Docs: when two people type in the same paragraph at the same time, both texts are kept (merged letter by letter), and your cursor moves with text others add before it.", "es": "Docs: cuando dos personas escriben a la vez en el mismo párrafo se conservan los dos textos (se combinan letra a letra) y tu cursor se desplaza con lo que otros añaden antes." },
      { "type": "improved", "en": "Sheets: two edits to the same cell are combined — a format from one person and a new value from another both stay, and text edits in different parts of a cell are merged.", "es": "Sheets: dos cambios en la misma celda se combinan: el formato de una persona y el valor nuevo de otra se mantienen, y los textos editados en partes distintas se fusionan." },
      { "type": "improved", "en": "Slides: moving an element while someone else edits its text keeps both changes; new elements added at the same time are all kept.", "es": "Slides: mover un elemento mientras otra persona edita su texto conserva los dos cambios; los elementos nuevos añadidos a la vez se mantienen todos." }
    ]
  },
  {
    "v": "15.3",
    "date": "2026-11-25",
    "title": { "en": "Nebulix 3.0, phase 12: real-time co-editing in Sheets and Slides", "es": "Nebulix 3.0, fase 12: edición en tiempo real en Sheets y Slides" },
    "changes": [
      { "type": "new", "en": "Sheets: edit a spreadsheet with others at the same time — cells, formats, formulas and column widths update live, and each person’s selected cell is outlined with their name.", "es": "Sheets: edita una hoja de cálculo con otras personas a la vez; las celdas, los formatos, las fórmulas y el ancho de las columnas se actualizan en directo y la celda seleccionada de cada persona aparece marcada con su nombre." },
      { "type": "new", "en": "Slides: build a presentation together — new slides, text, shapes, images and the slide order sync live, with coloured dots on the slide each person is viewing.", "es": "Slides: haced una presentación juntos; las diapositivas nuevas, los textos, las formas, las imágenes y el orden se sincronizan en directo, con puntos de color en la diapositiva que ve cada persona." }
    ]
  },
  {
    "v": "15.2",
    "date": "2026-11-25",
    "title": { "en": "Nebulix 3.0, phase 11: PDFs, ZIP archives, startup apps and new developer tools", "es": "Nebulix 3.0, fase 11: PDF, archivos ZIP, apps de inicio y nuevas herramientas para desarrolladores" },
    "changes": [
      { "type": "new", "en": "Nebulix OS Files: open PDFs in a viewer window, browse ZIP archives and extract them (one file or everything), and compress any file or folder into a ZIP.", "es": "Archivos de Nebulix OS: abre PDF en una ventana de visor, explora archivos ZIP y extráelos (un archivo o todo) y comprime cualquier archivo o carpeta en un ZIP." },
      { "type": "new", "en": "Startup apps: right-click an app in Start and choose “Open at startup”; manage the list in the Task Manager.", "es": "Apps de inicio: haz clic derecho en una app de Inicio y elige «Abrir al iniciar»; gestiona la lista en el Administrador de tareas." },
      { "type": "new", "en": "Developer Toolbox: QR code generator (UTF-8, colours, PNG), HTTP request tester sent from the server with SSRF protection, and a SQL playground with a real SQLite database in your browser (open and download .sqlite files).", "es": "Caja de herramientas: generador de códigos QR (UTF-8, colores, PNG), probador de peticiones HTTP enviado desde el servidor con protección contra SSRF y zona de pruebas SQL con una base de datos SQLite real en tu navegador (abre y descarga archivos .sqlite)." },
      { "type": "fixed", "en": "Files: importing a PDF, ZIP or other binary file no longer corrupts it (it used to be read as text).", "es": "Archivos: importar un PDF, un ZIP u otro archivo binario ya no lo estropea (antes se leía como texto)." }
    ]
  },
  {
    "v": "15.1",
    "date": "2026-11-25",
    "title": { "en": "Nebulix 3.0, phase 10: Nebulix Cloud PC", "es": "Nebulix 3.0, fase 10: Nebulix Cloud PC" },
    "changes": [
      { "type": "new", "en": "Nebulix Cloud PC: full Linux virtual machines (QEMU with hardware virtualisation) on Nebulix compute servers. Start from a ready-made system such as Debian 12 or boot an installer / live ISO, and use the screen, keyboard and mouse from the browser.", "es": "Nebulix Cloud PC: máquinas virtuales Linux completas (QEMU con virtualización por hardware) en los servidores de cómputo de Nebulix. Empieza con un sistema listo para usar, como Debian 12, o arranca un instalador o una ISO live, y usa la pantalla, el teclado y el ratón desde el navegador." },
      { "type": "new", "en": "Shut down cleanly or force off, restart, Ctrl+Alt+Del and other key combinations, screenshots, full screen, snapshots of disk and memory, live CPU and memory usage, and adjustable processor and memory.", "es": "Apaga correctamente o fuerza el apagado, reinicia, envía Ctrl+Alt+Supr y otras combinaciones, haz capturas, pantalla completa, instantáneas de disco y memoria, uso de CPU y memoria en directo y procesador y memoria ajustables." }
    ]
  },
  {
    "v": "15.0",
    "date": "2026-11-25",
    "title": {
      "en": "Nebulix 3.0, phase 9: Nebulix Android — real Android devices",
      "es": "Nebulix 3.0, fase 9: Nebulix Android, dispositivos Android reales"
    },
    "changes": [
      {
        "type": "new",
        "en": "Nebulix Android: create real Android phones and tablets (official Android Emulator, open-source Android 5–16, hardware virtualisation) and use them from the browser with mouse, touch and keyboard. They run on separate Nebulix compute servers, so the website stays fast.",
        "es": "Nebulix Android: crea móviles y tablets con Android real (el emulador oficial de Android, Android de código abierto del 5 al 16, virtualización por hardware) y úsalos desde el navegador con el ratón, la pantalla táctil y el teclado. Funcionan en servidores de cómputo aparte, así la web sigue rápida."
      },
      {
        "type": "new",
        "en": "Install APKs by dragging them in, open, stop and uninstall apps, send files to the device and download them, take screenshots and record the screen, share the clipboard both ways, set the GPS location, rotate and change the resolution.",
        "es": "Instala APK arrastrándolos, abre, detén y desinstala apps, envía archivos al dispositivo y descárgalos, haz capturas y graba la pantalla, comparte el portapapeles en los dos sentidos, fija la ubicación GPS, gira la pantalla y cambia la resolución."
      },
      {
        "type": "new",
        "en": "Snapshots: save the whole device and go back to that moment. Stopping a device saves where you left off. Plus adb shell commands, logs and adjustable processor, memory and storage.",
        "es": "Instantáneas: guarda todo el dispositivo y vuelve a ese momento. Al detener un dispositivo se guarda dónde lo dejaste. Además, comandos adb shell, registros y procesador, memoria y almacenamiento ajustables."
      },
      {
        "type": "new",
        "en": "Admin → Compute: connect and monitor compute nodes. Nebulix shows honestly when no node is connected — Google Play is not included.",
        "es": "Admin → Cómputo: conecta y supervisa los nodos de cómputo. Nebulix indica claramente cuándo no hay ningún nodo conectado. No incluye Google Play."
      }
    ]
  },
  {
    "v": "14.9",
    "date": "2026-11-25",
    "title": {
      "en": "Nebulix 3.0, phase 8: real-time co-editing in Docs",
      "es": "Nebulix 3.0, fase 8: edición en tiempo real en Docs"
    },
    "changes": [
      {
        "type": "new",
        "en": "Docs: write together. Everyone with edit access sees each other's changes as they type, paragraph by paragraph, with no reloads.",
        "es": "Docs: escribid juntos. Todos los que pueden editar ven los cambios de los demás mientras escriben, párrafo a párrafo y sin recargar."
      },
      {
        "type": "new",
        "en": "Docs: see who is in the document and where they are writing — each person has a coloured cursor with their name, and their selection is highlighted.",
        "es": "Docs: mira quién está en el documento y dónde escribe: cada persona tiene un cursor de color con su nombre y se resalta lo que selecciona."
      },
      {
        "type": "improved",
        "en": "Docs: if your connection drops you can keep writing; your changes are sent when it comes back, even after a server update.",
        "es": "Docs: si se corta la conexión puedes seguir escribiendo; tus cambios se envían al volver, incluso después de una actualización del servidor."
      }
    ]
  },
  {
    "v": "14.8",
    "date": "2026-11-24",
    "title": {
      "en": "Nebulix 3.0, phase 7: Word export and comments in Docs, and live spectating",
      "es": "Nebulix 3.0, fase 7: exportar a Word y comentarios en Docs, y duelos en directo"
    },
    "changes": [
      {
        "type": "new",
        "en": "Docs: download any document as a Word file (.docx) with its headings, formatting, colours, lists, tables, links and images.",
        "es": "Docs: descarga cualquier documento como archivo de Word (.docx) con sus títulos, formato, colores, listas, tablas, enlaces e imágenes."
      },
      {
        "type": "new",
        "en": "Docs: comments. Select a sentence and comment on it (Ctrl+Alt+M); reply, resolve and reopen threads. The commented text is highlighted, and the owner and everyone in the thread get a notification. New comments appear live.",
        "es": "Docs: comentarios. Selecciona una frase y coméntala (Ctrl+Alt+M); responde, resuelve y reabre hilos. El texto comentado se resalta y el propietario y todos los del hilo reciben un aviso. Los comentarios nuevos aparecen en directo."
      },
      {
        "type": "improved",
        "en": "Watching a friend's duel is now live: every move arrives instantly instead of every few seconds.",
        "es": "Ver el duelo de un amigo ahora es en directo: cada jugada llega al instante en vez de cada pocos segundos."
      }
    ]
  },
  {
    "v": "14.7",
    "date": "2026-11-24",
    "title": {
      "en": "Nebulix 3.0, phase 6: Bubble Shooter, Tower Defense, Word Search, Elo ratings and watching duels",
      "es": "Nebulix 3.0, fase 6: Lanzaburbujas, Defensa de torres, Sopa de letras, puntuación Elo y ver duelos"
    },
    "changes": [
      {
        "type": "new",
        "en": "Arcade: Bubble Shooter (bounce shots, falling clusters, a new row every six shots), Tower Defense (three towers, waves and bosses) and Word Search (Spanish and English themes, words in every direction).",
        "es": "Arcade: Lanzaburbujas (disparos con rebote, grupos que caen, una fila nueva cada seis disparos), Defensa de torres (tres torres, oleadas y jefes) y Sopa de letras (temas en español e inglés, palabras en todas las direcciones)."
      },
      {
        "type": "new",
        "en": "Chess and Checkers duels are rated: everyone starts at 1200 and wins and losses move your Elo rating. The Duels tab shows the ranking and each player's rating, with the points won or lost after every game.",
        "es": "Los duelos de Ajedrez y Damas puntúan: todos empezáis en 1200 y las victorias y derrotas mueven tu puntuación Elo. La pestaña Duelos muestra la clasificación y la puntuación de cada jugador, con los puntos ganados o perdidos tras cada partida."
      },
      {
        "type": "new",
        "en": "Watch your friends' live duels: the Duels tab lists the games they are playing and you can follow them move by move.",
        "es": "Mira los duelos de tus amigos en directo: la pestaña Duelos muestra las partidas que están jugando y puedes seguirlas jugada a jugada."
      }
    ]
  },
  {
    "v": "14.6",
    "date": "2026-11-24",
    "title": {
      "en": "Nebulix 3.0, phase 5: online Chess and Checkers duels, and Create games",
      "es": "Nebulix 3.0, fase 5: duelos online de Ajedrez y Damas, y Crear juegos"
    },
    "changes": [
      {
        "type": "new",
        "en": "Duels: play Chess (2 minutes per move) and Checkers (90 seconds per move) online against your friends, with or without a coin wager. The server checks every move with the same rules as the Arcade games.",
        "es": "Duelos: juega al Ajedrez (2 minutos por jugada) y a las Damas (90 segundos por jugada) online contra tus amigos, con o sin apuesta de monedas. El servidor comprueba cada jugada con las mismas reglas que los juegos del Arcade."
      },
      {
        "type": "new",
        "en": "Create games (#/gamedev): a guide for Hub creators and a starter template that already uses the player name, a leaderboard, an achievement and a multiplayer room. The template is also an official Hub game you can play, read and remix.",
        "es": "Crear juegos (#/gamedev): una guía para creadores del Hub y una plantilla inicial que ya usa el nombre del jugador, una clasificación, un logro y una sala multijugador. La plantilla también es un juego oficial del Hub que puedes jugar, leer y remezclar."
      }
    ]
  },
  {
    "v": "14.5",
    "date": "2026-11-24",
    "title": {
      "en": "Nebulix 3.0, phase 4: invitations, multiplayer rooms for Hub games and app permissions",
      "es": "Nebulix 3.0, fase 4: invitaciones, salas multijugador para juegos del Hub y permisos de apps"
    },
    "changes": [
      {
        "type": "new",
        "en": "Calendar: invite friends to your events. They get a notification, the event appears in their calendar and they answer going, maybe or not going; you see every answer, and guests who are going also get the reminder.",
        "es": "Calendario: invita a amigos a tus eventos. Reciben una notificación, el evento aparece en su calendario y responden voy, quizá o no voy; tú ves cada respuesta, y los invitados que van también reciben el recordatorio."
      },
      {
        "type": "new",
        "en": "Game API: multiplayer rooms for Hub games (Nebulix.room.join, send, leave and events), up to 16 players per room, over the Nebulix connection.",
        "es": "API de juegos: salas multijugador para los juegos del Hub (Nebulix.room.join, send, leave y eventos), hasta 16 jugadores por sala, sobre la conexión de Nebulix."
      },
      {
        "type": "new",
        "en": "App permissions: a game can ask for camera, microphone, location or MIDI in a nebulix.json file. Players see the request before installing or playing and the game only gets what they allow.",
        "es": "Permisos de apps: un juego puede pedir cámara, micrófono, ubicación o MIDI en un archivo nebulix.json. Los jugadores ven la petición antes de instalar o jugar y el juego solo recibe lo que permitan."
      }
    ]
  },
  {
    "v": "14.4",
    "date": "2026-11-24",
    "title": {
      "en": "Nebulix 3.0, phase 3: Solitaire, Checkers, achievements for Hub games and exams in the calendar",
      "es": "Nebulix 3.0, fase 3: Solitario, Damas, logros para juegos del Hub y exámenes en el calendario"
    },
    "changes": [
      {
        "type": "new",
        "en": "Arcade: Solitaire (Klondike, draw 1 or 3, undo, auto-complete) and Checkers against the computer at three levels (compulsory captures, multi-jumps, kings).",
        "es": "Arcade: Solitario (Klondike, robar 1 o 3, deshacer, autocompletar) y Damas contra el ordenador en tres niveles (comer obligatorio, saltos múltiples, damas)."
      },
      {
        "type": "new",
        "en": "Game API: Hub games can unlock achievements with Nebulix.unlock(id, title, description). Each game page lists its achievements with the share of players who have them.",
        "es": "API de juegos: los juegos del Hub pueden desbloquear logros con Nebulix.unlock(id, título, descripción). La página de cada juego muestra sus logros con el porcentaje de jugadores que los tiene."
      },
      {
        "type": "new",
        "en": "Your Study exams appear in the calendar (month, week and agenda).",
        "es": "Tus exámenes de Estudio aparecen en el calendario (mes, semana y agenda)."
      },
      {
        "type": "improved",
        "en": "Nebulix OS: installed apps show a badge and a notice when they get a new version, and their desktop icon has Open, Open in Nebulix Hub and Uninstall.",
        "es": "Nebulix OS: las apps instaladas muestran una marca y un aviso cuando tienen versión nueva, y su icono del escritorio tiene Abrir, Abrir en Nebulix Hub y Desinstalar."
      }
    ]
  },
  {
    "v": "14.3",
    "date": "2026-11-24",
    "title": {
      "en": "Nebulix 3.0, phase 2: Calendar & Tasks, App Store installs, game leaderboards and Chess",
      "es": "Nebulix 3.0, fase 2: Calendario y tareas, instalar apps, clasificaciones de juegos y Ajedrez"
    },
    "changes": [
      {
        "type": "new",
        "en": "Calendar & Tasks (#/calendar): month, week and agenda views, events that repeat (daily, weekdays, weekly, monthly, yearly) with reminders that arrive as notifications, and tasks with projects, priorities, due dates, reminders and subtasks. Quick add with !1 !2 !3 for priority.",
        "es": "Calendario y tareas (#/calendar): vistas de mes, semana y agenda, eventos que se repiten (diario, laborables, semanal, mensual, anual) con recordatorios que llegan como notificaciones, y tareas con proyectos, prioridades, fechas, recordatorios y subtareas. Añadido rápido con !1 !2 !3 para la prioridad."
      },
      {
        "type": "new",
        "en": "App Store: install any Hub game or app into Nebulix OS. Installed apps get their own window, a start-menu category and a desktop icon; the Hub has an “Installed” tab.",
        "es": "Tienda de apps: instala cualquier juego o app del Hub en Nebulix OS. Las apps instaladas tienen su propia ventana, una categoría en el menú de inicio y un icono en el escritorio; el Hub tiene una pestaña «Instalado»."
      },
      {
        "type": "new",
        "en": "Game API for Hub creators: games can call Nebulix.submitScore(points), Nebulix.leaderboard() and Nebulix.me(). Every game gets its own leaderboard on its page (scores never pay coins; owners and moderators can reset it).",
        "es": "API de juegos para creadores del Hub: los juegos pueden llamar a Nebulix.submitScore(puntos), Nebulix.leaderboard() y Nebulix.me(). Cada juego tiene su propia clasificación en su página (las puntuaciones nunca dan monedas; el autor y los moderadores pueden reiniciarla)."
      },
      {
        "type": "new",
        "en": "Chess against the computer at three levels, with every rule (castling, en passant, promotion, checkmate, stalemate, repetition, 50-move rule), undo, board flip and the list of moves.",
        "es": "Ajedrez contra el ordenador en tres niveles, con todas las reglas (enroque, captura al paso, coronación, jaque mate, ahogado, repetición, regla de los 50 movimientos), deshacer, girar el tablero y lista de jugadas."
      },
      {
        "type": "fixed",
        "en": "Hub: the Star and Save buttons on an upload page showed an error and did not update their label.",
        "es": "Hub: los botones Estrella y Guardar de la página de una subida daban error y no actualizaban su texto."
      }
    ]
  },
  {
    "v": "14.2",
    "date": "2026-11-24",
    "title": {
      "en": "Nebulix 3.0, phase 1: 5 new arcade games, OS tools and the Developer Toolbox",
      "es": "Nebulix 3.0, fase 1: 5 juegos nuevos, herramientas del OS y la Caja de herramientas"
    },
    "changes": [
      {
        "type": "new",
        "en": "Arcade: Minesweeper (3 levels, safe first click), Sudoku (generated puzzles, pencil notes), Space Rocks (vector space shooter with waves), Gem Match (60-second match-3 with combos) and Reflex (reaction test). Personal bests and coins like the other games.",
        "es": "Arcade: Buscaminas (3 niveles, primer clic seguro), Sudoku (tableros generados, notas a lápiz), Rocas espaciales (shooter espacial vectorial por oleadas), Gemas (3 en raya de 60 segundos con combos) y Reflejos (test de reacción). Récords y monedas como en los demás juegos."
      },
      {
        "type": "new",
        "en": "Nebulix OS: Task Manager (real windows, end task, memory and FPS), Clipboard history, Screenshot tool and an Alt+` window switcher.",
        "es": "Nebulix OS: Administrador de tareas (ventanas reales, finalizar tarea, memoria y FPS), historial del Portapapeles, herramienta de Captura de pantalla y selector de ventanas con Alt+`."
      },
      {
        "type": "new",
        "en": "Developer Toolbox (#/devtools): JSON formatter and validator, regex tester, encoders with SHA-256, UUID and password generator, timestamps, cron explainer with next runs, colours and gradients with contrast, text diff, Markdown preview and text tools. All in your browser.",
        "es": "Caja de herramientas para desarrolladores (#/devtools): formateador y validador JSON, probador de regex, codificadores con SHA-256, generador de UUID y contraseñas, marcas de tiempo, explicador de cron con próximas ejecuciones, colores y degradados con contraste, comparador de textos, vista previa de Markdown y herramientas de texto. Todo en tu navegador."
      }
    ]
  },
  {
    "v": "14.1",
    "date": "2026-11-24",
    "title": {
      "en": "Nebulix OS 14.1: glass, Linux effects, workspaces and desktop-only apps · a new Hub",
      "es": "Nebulix OS 14.1: cristal, efectos Linux, escritorios y apps exclusivas · un Hub nuevo"
    },
    "changes": [
      {
        "type": "new",
        "en": "Nebulix OS: see-through glass windows (opacity and blur sliders), wobbly windows when you drag them, a magic-lamp minimize, a burning close, zoom/glide/pop open effects, 4 virtual desktops with a 3D cube transition (Ctrl+Alt+←/→, Ctrl+Alt+1-4, move windows from the title bar menu), a hot corner for the overview and a new glass quick settings panel.",
        "es": "Nebulix OS: ventanas de cristal transparentes (opacidad y desenfoque ajustables), ventanas gelatina al arrastrarlas, minimizar con lámpara mágica, cerrar ardiendo, efectos al abrir (zoom, planear, pop), 4 escritorios virtuales con transición de cubo 3D (Ctrl+Alt+←/→, Ctrl+Alt+1-4, mover ventanas desde el menú de la barra de título), esquina activa para la vista general y un nuevo panel de ajustes rápidos de cristal."
      },
      {
        "type": "new",
        "en": "Desktop-only apps in Nebulix OS: Files (folders, text files, pictures, Trash, import and download, kept in your browser), Text editor, Nova Agents (four AI agents — research, analysis, writing and review — work as a team on your goal), Command Center (live status of the server, your device, account, storage and activity), Camera with 9 filters and a self-timer, and Widgets.",
        "es": "Apps exclusivas de Nebulix OS: Archivos (carpetas, textos, imágenes, papelera, importar y descargar, guardado en tu navegador), Editor de texto, Agentes Nova (cuatro agentes de IA — investigación, análisis, redacción y revisión — trabajan en equipo en tu objetivo), Centro de control (estado en directo del servidor, tu dispositivo, cuenta, almacenamiento y actividad), Cámara con 9 filtros y temporizador, y Widgets."
      },
      {
        "type": "new",
        "en": "Glass desktop widgets you can drag anywhere: clock, calendar, sticky note, to-do list, timer, system monitor, photo frame and quote of the moment.",
        "es": "Widgets de cristal para el escritorio que puedes arrastrar donde quieras: reloj, calendario, nota adhesiva, lista de tareas, temporizador, monitor del sistema, marco de fotos y frase del momento."
      },
      {
        "type": "new",
        "en": "6 official apps by Nebulix in the Hub: Pixel Forge (pixel art), Beat Lab (drum machine), Flow Board (kanban), Sketch Board (whiteboard), Markdown Writer and Palette Lab. They can be remixed and downloaded.",
        "es": "6 apps oficiales de Nebulix en el Hub: Pixel Forge (pixel art), Beat Lab (caja de ritmos), Flow Board (kanban), Sketch Board (pizarra), Markdown Writer y Palette Lab. Se pueden remezclar y descargar."
      },
      {
        "type": "improved",
        "en": "Nebulix Hub has a new home: a big rotating showcase of the most played uploads, a shelf of official apps and a trending row.",
        "es": "Nebulix Hub tiene una portada nueva: un gran escaparate giratorio con lo más jugado, una estantería de apps oficiales y una fila de tendencias."
      }
    ]
  },
  {
    "v": "14.0",
    "date": "2026-11-24",
    "title": {
      "en": "Nebulix 14: a fresh new look, total makeovers and a redesigned Hub",
      "es": "Nebulix 14: un look nuevo y fresco, cambios totales y un Hub rediseñado"
    },
    "changes": [
      {
        "type": "new",
        "en": "Nebulix 14 design, the new default: floating glass panels, a living aurora behind everything, glowing markers on the open page, springy buttons and segmented tabs. The previous look is one click away in Appearance (“Classic Nebulix”).",
        "es": "Diseño Nebulix 14, el nuevo por defecto: paneles de cristal flotantes, una aurora viva detrás de todo, marcadores brillantes en la página abierta, botones elásticos y pestañas segmentadas. El look anterior está a un clic en Apariencia («Nebulix clásico»)."
      },
      {
        "type": "new",
        "en": "Total makeovers: 13 one-click looks that change the design, menu layout, colours and screen effect at once (Night City, Cotton Candy, Retro Desktop, Hologram, Bento, Sketchbook, Winter Night, Firefly Forest, Valentine and more).",
        "es": "Cambios totales: 13 looks de un clic que cambian a la vez el diseño, el menú, los colores y el efecto de pantalla (Ciudad nocturna, Algodón de azúcar, Escritorio retro, Holograma, Bento, Cuaderno, Noche de invierno, Bosque de luciérnagas, San Valentín y más)."
      },
      {
        "type": "new",
        "en": "7 new designs that change the whole app: Dev (code site), Cyberpunk, Kawaii, Retro desktop, Bento, Holographic and Sketchbook.",
        "es": "7 diseños nuevos que cambian la app entera: Dev (web de código), Cyberpunk, Kawaii, Escritorio retro, Bento, Holográfico y Cuaderno."
      },
      {
        "type": "new",
        "en": "Theme studio: 8 more fonts and a separate heading font and weight, button styles (solid, outline, soft, pill, 3D, glowing), card styles (outline, floating, accent stripe, gradient border, neon, paper), background textures, hover effects (glow, grow, 3D tilt), page transitions (slide, zoom, unblur, flip), scrollbars and gradient titles.",
        "es": "Estudio de temas: 8 fuentes más y fuente y grosor propios para los títulos, estilos de botón (sólido, contorno, suave, píldora, 3D, brillante), estilos de tarjeta (contorno, flotante, franja, borde degradado, neón, papel), texturas de fondo, efectos al pasar el ratón (brillo, agrandar, inclinación 3D), transiciones de página (deslizar, zoom, desenfoque, giro), barras de desplazamiento y títulos con degradado."
      },
      {
        "type": "new",
        "en": "Palette generator: make a whole theme from one colour with a colour harmony (analogous, complementary, triadic, split, monochrome), take the palette from a picture, swap the accents or turn any theme light or dark. “Surprise me” now mixes all the new styles too.",
        "es": "Generador de paletas: crea un tema entero a partir de un color con una armonía (análogos, complementarios, tríada, divididos, monocromo), saca la paleta de una imagen, intercambia los acentos o convierte cualquier tema en claro u oscuro. «Sorpréndeme» ahora mezcla también todos los estilos nuevos."
      },
      {
        "type": "new",
        "en": "6 new animated backgrounds: snowfall, fireflies, a honeycomb that lights up under the mouse, confetti, rain and orbits. 9 new preset themes.",
        "es": "6 fondos animados nuevos: nevada, luciérnagas, un panal que se ilumina bajo el ratón, confeti, lluvia y órbitas. 9 temas predefinidos nuevos."
      },
      {
        "type": "new",
        "en": "Screen effects over the whole app (snow, sakura petals, autumn leaves, shooting stars, bubbles, hearts, confetti), sparks when you click, a glowing cursor trail, and automatic day/night themes by the time of day.",
        "es": "Efectos de pantalla sobre toda la app (nieve, pétalos de sakura, hojas de otoño, estrellas fugaces, burbujas, corazones, confeti), chispas al hacer clic, estela brillante del cursor y temas automáticos de día y noche según la hora."
      },
      {
        "type": "improved",
        "en": "Nebulix Hub redesigned like a code-hosting site: a dashboard with your uploads and collections, a feed of uploads with topics, stars and kind colours, and a repository page for each upload with Play, Code (file browser with folders, line numbers and README), Releases, Reviews, Discussions, Media and Settings (with a danger zone), plus an About sidebar with a languages bar.",
        "es": "Nebulix Hub rediseñado como una web de código: un panel con tus subidas y colecciones, un feed de subidas con temas, estrellas y colores por tipo, y una página tipo repositorio para cada subida con Jugar, Código (explorador con carpetas, números de línea y README), Versiones, Reseñas, Conversaciones, Medios y Ajustes (con zona de peligro), además de una barra lateral «Acerca de» con barra de lenguajes."
      },
      {
        "type": "fixed",
        "en": "Hub: the code viewer can open the files of games that run on the games domain.",
        "es": "Hub: el visor de código ya abre los archivos de los juegos que se ejecutan en el dominio de juegos."
      },
      {
        "type": "improved",
        "en": "3D games: floating damage numbers, bursts and shockwave rings on eliminations, camera shake when you get hit (Nebula Ops and Arena), a smooth gliding camera and light-catching dust in the 3D Casino, rings and bursts at checkpoints and the finish line in Nebula Worlds.",
        "es": "Juegos 3D: números de daño flotantes, explosiones y ondas expansivas al eliminar, temblor de cámara al recibir daño (Nebula Ops y Arena), cámara suave y polvo que brilla con la luz en el Casino 3D, y anillos y explosiones en los puntos de control y la meta de Nebula Worlds."
      },
      {
        "type": "improved",
        "en": "Market Rush has new graphics: a neon trading floor, glowing candles, a light trail behind your paddle, sparks and floating points, a timer ring and a combo bar.",
        "es": "Market Rush tiene gráficos nuevos: un parqué de neón, velas brillantes, estela de luz detrás de tu barra, chispas y puntos flotantes, un anillo de tiempo y una barra de combo."
      },
      {
        "type": "improved",
        "en": "More animation everywhere: cards come in one after another, buttons shine on hover, windows spring open over a blurred page, and coin and gem counters bounce when they change.",
        "es": "Más animación en todas partes: las tarjetas entran una detrás de otra, los botones brillan al pasar el ratón, las ventanas se abren con rebote sobre la página desenfocada y los contadores de monedas y gemas saltan al cambiar."
      }
    ]
  },
  {
    v: '13.8', date: '2026-11-23', title: { en: 'Nebulix Study, push notifications, installable app and more', es: 'Nebulix Estudio, notificaciones push, app instalable y más' },
    changes: [
      { type: 'new', en: "Nebulix Study: study notes shared by students (by subject and year, search, likes, saves), flashcards with spaced repetition (review, all cards, test and write modes), an AI tutor that guides you step by step, quizzes, flashcards and summaries made with AI from any notes, live class quizzes with a 6-digit PIN and a podium, a grade tracker with averages and \"what do I need\", an exam planner with reminders the day before, and tools (Pomodoro, scientific calculator, unit converter, formulas, word counter). Studying earns up to 120 coins a day.", es: "Nebulix Estudio: apuntes compartidos por estudiantes (por asignatura y curso, búsqueda, me gusta y guardados), tarjetas con repetición espaciada (repaso, todas, test y escribir), un tutor de IA que te guía paso a paso, tests, tarjetas y resúmenes hechos con IA desde cualquier apunte, quizzes en directo para clase con PIN de 6 cifras y podio, control de notas con medias y «¿qué necesito?», planificador de exámenes con aviso el día antes y herramientas (Pomodoro, calculadora científica, conversor de unidades, fórmulas, contador de palabras). Estudiar da hasta 120 monedas al día." },
      { type: 'new', en: "Nebulix Premium in three plans: Premium, Premium Pro and Premium Ultimate, monthly or yearly, each with more AI, bigger uploads and more perks.", es: "Nebulix Premium en tres planes: Premium, Premium Pro y Premium Ultimate, mensual o anual, cada uno con más IA, archivos más grandes y más ventajas." },
      { type: 'new', en: "Nebula Fusion: combine elements to discover new ones; the AI invents each new result once for everyone, and the first to find something earns coins.", es: "Nebula Fusion: combina elementos para descubrir otros; la IA inventa cada resultado nuevo una vez para todos, y el primero en encontrar algo gana monedas." },
      { type: 'new', en: "Nebula Dash: a rhythm runner with four vehicles (Cube, Rocket, Gravi-ball, Dart), three levels, practice mode, a live beat and a level editor with share codes.", es: "Nebula Dash: un runner rítmico con cuatro vehículos (Cubo, Cohete, Gravi-bola, Dardo), tres niveles, modo práctica, música en directo y editor de niveles con códigos para compartir." },
      { type: 'new', en: "Disguise mode (Settings → Safety): Nebulix opens as a study notes page until you type your secret code. Admins can lock everyone onto that page from Admin → Control.", es: "Modo disfraz (Ajustes → Seguridad): Nebulix se abre como una página de apuntes hasta que escribes tu código secreto. Los admins pueden poner a todos en esa página desde Admin → Control." },
      { type: 'new', en: "Nova: choose Claude Opus, Sonnet, Haiku or Fable when a Claude key is set, and the new Nebulix AI personality that knows every corner of Nebulix.", es: "Nova: elige Claude Opus, Sonnet, Haiku o Fable cuando hay una clave de Claude, y la nueva personalidad Nebulix IA que conoce cada rincón de Nebulix." },
      { type: 'new', en: "Mods: change how Nebulix looks with 8 official mods (compact, big text, neon, no animations…) and community mods made with CSS — cleaned by the server so no code or outside content can run.", es: "Mods: cambia el aspecto de Nebulix con 8 mods oficiales (compacto, texto grande, neón, sin animaciones…) y mods de la comunidad hechos con CSS, limpiados por el servidor para que no pueda ejecutarse código ni cargarse nada de fuera." },
      { type: 'new', en: "Weekly coin race (Wallet → Weekly race): earn coins by playing and studying; the top 10 win prizes every Monday. Transfers, trades, the casino and gifts do not count.", es: "Carrera semanal de monedas (Cartera → Carrera semanal): gana monedas jugando y estudiando; los 10 primeros ganan premios cada lunes. Las transferencias, intercambios, el casino y los regalos no cuentan." },
      { type: 'improved', en: "Study notes can include pictures (photos of the board, diagrams). The 3D Casino has Baccarat, Hi-Lo and Video Poker tables.", es: "Los apuntes de Estudio pueden llevar imágenes (fotos de la pizarra, esquemas). El Casino 3D tiene mesas de Bacará, Hi-Lo y Video póker." },
      { type: 'improved', en: "Arena graphics: realistic weapon models (9 mm pistol, submachine gun, pump shotgun, assault rifle, sniper rifle with scope), reflections on floors, metal and glass, and bloom, ambient occlusion and anti-aliasing on high quality. New maps: Harbor (Ops), Neon Yard and Stone Temple (Duels); each match picks one.", es: "Gráficos de la Arena: armas realistas (pistola 9 mm, subfusil, escopeta de corredera, fusil de asalto, fusil de francotirador con mira), reflejos en suelos, metal y cristal, y brillo, oclusión ambiental y antialiasing en calidad alta. Mapas nuevos: Puerto (Asalto), Neon Yard y Templo de Piedra (Duelos); cada partida elige uno." },
      { type: 'improved', en: "Study with AI everywhere: ask the AI about any notes, a day-by-day study plan for each exam, and AI advice on your grades. New achievements and daily quests for Study, Fusion and Dash.", es: "Estudio con IA en todo: pregunta a la IA sobre cualquier apunte, plan de estudio día a día para cada examen y consejos de la IA sobre tus notas. Logros y misiones diarias nuevos para Estudio, Fusion y Dash." },
      { type: 'new', en: "Gem shop (Wallet → Gem shop): spend gems on 24-hour boosts, streak shields, Nebula Fusion hints and permanent Arena weapon finishes (gold, neon, carbon, camo, ice) that everyone sees.", es: "Tienda de gemas (Cartera → Tienda de gemas): gasta gemas en potenciadores de 24 h, protectores de racha, pistas de Nebula Fusion y acabados permanentes de armas para la Arena (oro, neón, carbono, camuflaje, hielo) que ven todos." },
      { type: 'improved', en: "Sharper, more detailed Arena textures (bricks with mortar, brushed metal panels, wooden crates, cracked concrete) with depth and anisotropic filtering. Nebula Dash: two new levels, a trail and a parallax background. ESPN added to the browser shortcuts.", es: "Texturas de la Arena más nítidas y detalladas (ladrillos con juntas, paneles de metal cepillado, cajas de madera, hormigón agrietado) con relieve y filtrado anisotrópico. Nebula Dash: dos niveles nuevos, estela y fondo con parallax. ESPN añadido a los accesos del navegador." },
      { type: 'fixed', en: "Word of the day no longer redraws the whole page on every letter; the Arena fills the window and has full screen; the Nova button no longer covers games; the bank moved to the Wallet.", es: "La palabra del día ya no vuelve a dibujar toda la página con cada letra; la Arena ocupa toda la ventana y tiene pantalla completa; el botón de Nova ya no tapa los juegos; el banco pasa a la Cartera." },
      { type: 'improved', en: "Push notifications: choose which ones you get (messages, 1v1 challenges, gifts and other notices).", es: "Notificaciones push: elige cuáles recibes (mensajes, retos 1v1, regalos y otros avisos)." },
      { type: 'new', en: "Push notifications (Settings → Privacy): messages, 1v1 challenges, gifts and friend requests reach you even with Nebulix closed. Encrypted end to end to your browser; message text is never included.", es: "Notificaciones push (Ajustes → Privacidad): los mensajes, retos 1v1, regalos y solicitudes de amistad te llegan aunque Nebulix esté cerrado. Van cifradas hasta tu navegador y nunca incluyen el texto de los mensajes." },
      { type: 'new', en: "Nebulix is now a full installable app (Install from the browser menu) with a proper offline page.", es: "Nebulix ya es una app instalable completa (Instalar desde el menú del navegador) con su página sin conexión." },
      { type: 'new', en: "Arena: spectate the remaining players after you are eliminated (Space to switch) and a quick chat with preset phrases (N, then 1–8).", es: "Arena: mira a los jugadores que quedan cuando te eliminan (Espacio para cambiar) y chat rápido con frases predefinidas (N y luego 1–8)." },
      { type: 'new', en: "Streak shields: buy up to 2 for 750 coins each; each one saves your daily streak for one missed day.", es: "Protectores de racha: compra hasta 2 por 750 monedas cada uno; cada uno salva tu racha diaria durante un día que no entres." },
      { type: 'improved', en: "Faster loading: the 18 stylesheets now arrive as one compressed file that the browser keeps.", es: "Carga más rápida: las 18 hojas de estilo llegan ahora como un solo archivo comprimido que el navegador guarda." },
    ],
  },
  {
    v: '13.7', date: '2026-11-23', title: { en: 'Baccarat, Video Poker, Hi-Lo, new AI models and better virtual machines', es: 'Bacará, video póker, Hi-Lo, nuevos modelos de IA y mejores máquinas virtuales' },
    changes: [
      { type: 'new', en: "Casino: Baccarat (Player 2×, Banker 1.95×, Tie 9× with the real third-card rules), Video Poker Jacks or Better (deal, hold, draw; royal flush pays 800×) and Hi-Lo (guess higher or lower, the multiplier grows with every right card, cash out any time). All provably fair and dealt by the server.", es: "Casino: Bacará (Jugador 2×, Banca 1,95×, Empate 9× con las reglas reales de la tercera carta), Video póker Jotas o más (reparte, guarda, cambia; la escalera real paga 800×) y Hi-Lo (adivina más alta o más baja, el multiplicador sube con cada acierto y te retiras cuando quieras). Todos con juego justo verificable y repartidos por el servidor." },
      { type: 'new', en: "Nova AI: two more free models, DeepSeek V4 Flash and MiniMax M2.7 (long answers, code and reasoning). If one is busy, Nova moves to the next on its own.", es: "Nova IA: dos modelos gratis más, DeepSeek V4 Flash y MiniMax M2.7 (respuestas largas, código y razonamiento). Si uno está ocupado, Nova pasa sola al siguiente." },
      { type: 'improved', en: "Virtual machines: a Keys menu (Ctrl+Alt+Del, Alt+Tab, Alt+F4, Windows key, F1–F12), type text into the machine from your clipboard, screen size (fit, 1×, 1.5×, 2×) and screenshots for every machine.", es: "Máquinas virtuales: menú de Teclas (Ctrl+Alt+Supr, Alt+Tab, Alt+F4, tecla Windows, F1–F12), escribir texto en la máquina desde tu portapapeles, tamaño de pantalla (ajustar, 1×, 1,5×, 2×) y capturas en todas las máquinas." },
    ],
  },
  {
    v: '13.6', date: '2026-11-23', title: { en: 'Build fights 1v1, a new Arena HUD and BIOS for virtual machines', es: 'Peleas de construcción 1v1, nuevo HUD de la Arena y BIOS en las máquinas virtuales' },
    changes: [
      { type: 'new', en: "Arena: two new 1 vs 1 build-fight modes. Realistics: you spawn close to your rival on an open field. Box Fight: every round starts inside your own box. Shotgun, rifle, SMG, full shield and 500 materials each round; first to 5.", es: "Arena: dos modos nuevos 1 contra 1 con construcción. Realistas: apareces cerca de tu rival en campo abierto. Pelea en caja: cada ronda empiezas dentro de tu propia caja. Escopeta, rifle, subfusil, escudo lleno y 500 materiales por ronda; gana quien llegue a 5." },
      { type: 'new', en: "Building: a roof (cone) piece, wall editing (door, window, arch) on your own walls, direct keys for every piece and turbo building (hold the button to keep placing).", es: "Construcción: pieza de tejado, edición de tus paredes (puerta, ventana, arco), teclas directas para cada pieza y construcción turbo (mantén el botón para seguir colocando)." },
      { type: 'improved', en: "Arena HUD: compass at the top, shield above health, square hotbar slots with the rarity colour and ammo, build bar with your keys. New settings menu (P): sensitivity, aim sensitivity, invert, field of view, quality, FPS counter, damage numbers and key binds.", es: "HUD de la Arena: brújula arriba, escudo encima de la vida, ranuras cuadradas con el color de la rareza y la munición, barra de construcción con tus teclas. Nuevo menú de ajustes (P): sensibilidad, sensibilidad al apuntar, invertir, campo de visión, calidad, contador de FPS, números de daño y teclas." },
      { type: 'new', en: "Admin: a Coins tab to donate up to a trillion coins at once (the person gets a notice), gifts for everyone online or every account, and unlimited wallets that the owner can turn on and off.", es: "Admin: pestaña Monedas para donar hasta un billón de monedas de una vez (la persona recibe un aviso), regalos para todos los conectados o todas las cuentas, y monederos infinitos que el propietario puede activar y desactivar." },
      { type: 'new', en: "Virtual machines: a BIOS setup screen (memory, video memory, ACPI, virtual disk, boot priority). It also explains honestly why 64-bit systems such as Windows 11 cannot run in a browser emulator.", es: "Máquinas virtuales: pantalla de configuración de BIOS (memoria, memoria de vídeo, ACPI, disco virtual, prioridad de arranque). También explica por qué los sistemas de 64 bits como Windows 11 no pueden funcionar en un emulador del navegador." },
      { type: 'new', en: "Android player: Android-x86 opens from the menu in a phone-style frame with Back, Home, Recent apps, Menu and volume buttons, screenshots and full screen.", es: "Reproductor de Android: Android-x86 se abre desde el menú en un marco de móvil con botones de Atrás, Inicio, Apps recientes, Menú y volumen, capturas y pantalla completa." },
    ],
  },
  {
    v: '13.5', date: '2026-11-23', title: { en: 'Android-x86, more consoles and the Nebulix apps', es: 'Android-x86, más consolas y las apps de Nebulix' },
    changes: [
      { type: 'new', en: "Android-x86 4.4 in the virtual machines: Android for PCs, downloaded from the official project (checksum verified) and kept on the server, streamed in pieces. It is experimental and slow in a browser — choose “Live CD” and give it a few minutes.", es: "Android-x86 4.4 en las máquinas virtuales: Android para PC, descargado del proyecto oficial (con la suma de verificación comprobada), guardado en el servidor y cargado por partes. Es experimental y lento en un navegador: elige «Live CD» y dale unos minutos." },
      { type: 'new', en: "More retro consoles: Sega Saturn, Sega CD, 32X, 3DO, Atari Jaguar, Lynx, 5200 and 7800, Neo Geo Pocket, Virtual Boy, ColecoVision, Commodore 64 and Amiga. When a disc image could belong to several consoles, Nebulix asks which one.", es: "Más consolas retro: Sega Saturn, Sega CD, 32X, 3DO, Atari Jaguar, Lynx, 5200 y 7800, Neo Geo Pocket, Virtual Boy, ColecoVision, Commodore 64 y Amiga. Cuando una imagen de disco puede ser de varias consolas, Nebulix pregunta de cuál." },
      { type: 'new', en: "Nebulix apps: an Android app (.apk) and a Windows installer (.exe), built automatically and published in the GitHub Releases. Both are hardened: HTTPS only, only Nebulix addresses open inside the app, no access to your files, camera and microphone only when Nebulix asks, and automatic fallback to the mirror addresses.", es: "Apps de Nebulix: una app para Android (.apk) y un instalador para Windows (.exe), compilados automáticamente y publicados en las Releases de GitHub. Las dos están reforzadas: solo HTTPS, solo se abren dentro las direcciones de Nebulix, sin acceso a tus archivos, cámara y micrófono solo cuando Nebulix lo pide y paso automático a las direcciones espejo." },
    ],
  },
  {
    v: '13.4', date: '2026-11-22', title: { en: 'Windows in virtual machines, retro consoles and cloud gaming', es: 'Windows en máquinas virtuales, consolas retro y juego en la nube' },
    changes: [
      { type: 'improved', en: "Virtual machines: up to 2 GB of memory and virtual hard disks up to 32 GB that only use memory for what is written, so you can install real operating systems. New templates for Windows 98, Windows 2000, Windows XP and ReactOS with recommended settings (bring your own ISO — Windows is not included). Big ISOs are read in pieces straight from your computer. Boot order, ACPI, change/eject the CD while running and mouse capture.", es: "Máquinas virtuales: hasta 2 GB de memoria y discos duros virtuales de hasta 32 GB que solo ocupan memoria con lo que se escribe, para instalar sistemas operativos de verdad. Plantillas nuevas para Windows 98, Windows 2000, Windows XP y ReactOS con los ajustes recomendados (trae tu propia ISO: Windows no viene incluido). Las ISO grandes se leen por partes directamente de tu ordenador. Orden de arranque, ACPI, cambiar o expulsar el CD con la máquina encendida y captura del ratón." },
      { type: 'new', en: "Retro consoles: play your own game files from NES, Super Nintendo, Game Boy / Color / Advance, Nintendo DS, Nintendo 64, PlayStation, Mega Drive, Master System, Game Gear, Atari 2600, PC Engine, WonderSwan and arcade, with gamepad, touch controls, save states and fast-forward (EmulatorJS, open source). Your games stay in your browser.", es: "Consolas retro: juega con tus propios archivos de NES, Super Nintendo, Game Boy / Color / Advance, Nintendo DS, Nintendo 64, PlayStation, Mega Drive, Master System, Game Gear, Atari 2600, PC Engine, WonderSwan y recreativas, con mando, controles táctiles, guardado rápido y avance rápido (EmulatorJS, código abierto). Tus juegos se quedan en tu navegador." },
      { type: 'new', en: "Cloud gaming: quick access to the big streaming services (Xbox Cloud Gaming, GeForce NOW with its free tier, Boosteroid, Amazon Luna) and to everything you can play right now inside Nebulix.", es: "Juego en la nube: acceso rápido a los grandes servicios de streaming (Xbox Cloud Gaming, GeForce NOW con su plan gratis, Boosteroid, Amazon Luna) y a todo lo que puedes jugar ya dentro de Nebulix." },
    ],
  },
  {
    v: '13.3', date: '2026-11-22', title: { en: 'VM manager, Nebulix VPN and more addresses', es: 'Gestor de máquinas virtuales, Nebulix VPN y más direcciones' },
    changes: [
      { type: 'improved', en: "The Nebulix 7 design is back as the default. The clean “Studio” design is now optional: turn it on in Settings → Appearance.", es: "Vuelve el diseño Nebulix 7 por defecto. El diseño limpio «Studio» pasa a ser opcional: actívalo en Ajustes → Apariencia." },
      { type: 'new', en: "Virtual machine manager, in the style of a desktop VM manager: create machines from templates or your own .iso/.img, choose memory and an empty virtual hard disk to install on, take named snapshots, save the machine state when you close it, clone and delete. New systems: Damn Small Linux (a full Linux desktop), OpenBSD (installer) and Oberon, besides Linux, FreeDOS and KolibriOS. Big images load in pieces, only what the machine reads.", es: "Gestor de máquinas virtuales, al estilo de los de escritorio: crea máquinas a partir de plantillas o de tu propio .iso/.img, elige la memoria y un disco duro virtual vacío para instalar, haz instantáneas con nombre, guarda el estado al cerrar, clona y borra. Sistemas nuevos: Damn Small Linux (un escritorio Linux completo), OpenBSD (instalador) y Oberon, además de Linux, FreeDOS y KolibriOS. Las imágenes grandes se cargan por partes, solo lo que la máquina lee." },
      { type: 'new', en: "Nebulix VPN: one switch for maximum privacy while you browse inside Nebulix. Websites see the server (and its location) instead of you, plus a generic browser, language and time zone, the ad and tracker shield and a WebRTC block so pages cannot find your real IP. Includes a leak test.", es: "Nebulix VPN: un solo botón para la máxima privacidad mientras navegas dentro de Nebulix. Las webs ven el servidor (y su ubicación) en lugar de a ti, con un navegador, idioma y zona horaria genéricos, el escudo contra anuncios y rastreadores y un bloqueo de WebRTC para que las páginas no descubran tu IP real. Incluye una prueba de fugas." },
      { type: 'new', en: "More addresses for Nebulix, all on the same server (same account, coins and data): nebulix-play.fly.dev, nebulix-zone.fly.dev and nebulix-hq.fly.dev. The new Links page shows every address with its status, opens any of them in a hidden about:blank tab, and has a link generator for short links to any page that work on every address.", es: "Más direcciones para Nebulix, todas en el mismo servidor (misma cuenta, monedas y datos): nebulix-play.fly.dev, nebulix-zone.fly.dev y nebulix-hq.fly.dev. La nueva página Links muestra cada dirección con su estado, abre cualquiera en una pestaña oculta about:blank y tiene un generador de links cortos a cualquier página que funcionan en todas las direcciones." },
      { type: 'fixed', en: "The about:blank launcher in Settings → Safety works again (the app could not be embedded in the blank tab).", es: "El lanzador about:blank de Ajustes → Seguridad vuelve a funcionar (la app no se podía meter en la pestaña en blanco)." },
      { type: 'fixed', en: "Free AI models that run from your browser (Gemma, Codestral, Mistral Nemo) were blocked by the page’s security policy; they work now.", es: "Los modelos de IA gratis que funcionan desde tu navegador (Gemma, Codestral, Mistral Nemo) estaban bloqueados por la política de seguridad de la página; ya funcionan." },
    ],
  },
  {
    v: '13.2', date: '2026-11-22', title: { en: 'A real terminal, virtual machines, a Security Lab and fast AI models', es: 'Terminal de verdad, máquinas virtuales, laboratorio de seguridad y modelos de IA rápidos' },
    changes: [
      { type: 'new', en: "A real terminal: a genuine Linux (kernel 4.16 with BusyBox) runs inside your browser and opens in a proper terminal with colours, scrollback and copy/paste. ls, cat, vi, top, shell scripts — all real. Find it as Terminal in the menu.", es: "Un terminal de verdad: un Linux auténtico (kernel 4.16 con BusyBox) funciona dentro de tu navegador y se abre en un terminal en condiciones, con colores, historial y copiar y pegar. ls, cat, vi, top, scripts de shell: todo real. Está en el menú como Terminal." },
      { type: 'new', en: "Virtual machines: emulate a whole x86 PC with the open-source v86 emulator — Linux (terminal or screen), FreeDOS, KolibriOS with its graphical desktop, or boot your own .iso / .img. Save a machine and restore it later. Everything runs on your device, with no network inside.", es: "Máquinas virtuales: emula un PC x86 entero con el emulador libre v86: Linux (en terminal o en pantalla), FreeDOS, KolibriOS con su escritorio gráfico, o arranca tu propio .iso / .img. Guarda una máquina y recupérala más tarde. Todo funciona en tu dispositivo, sin red dentro." },
      { type: 'new', en: "Security Lab: an account checkup, password strength and generator, breached-password check (k-anonymity: your password never leaves the browser), website security scan (HTTPS, certificate, security headers, cookies), phishing link detector, hashes and encodings, classic ciphers with brute force, JWT inspector, how 2FA codes work, CVE search and CTF practice challenges that pay coins.", es: "Laboratorio de seguridad: revisión de tu cuenta, fuerza y generador de contraseñas, comprobación de contraseñas filtradas (k-anonimato: tu contraseña no sale del navegador), análisis de seguridad de webs (HTTPS, certificado, cabeceras, cookies), detector de enlaces de phishing, hashes y codificaciones, cifrados clásicos con fuerza bruta, inspector de JWT, cómo funcionan los códigos 2FA, búsqueda de CVE y retos CTF que dan monedas." },
      { type: 'new', en: "Fast, high-quality AI models: the owner can paste free keys from Groq, Cerebras, Google Gemini, Mistral and OpenRouter (one or all). Nebulix discovers their best chat models — GPT-OSS 120B, Llama 3.3 70B, Kimi K2, Qwen 3, Gemini 2.5 Flash and Pro, Mistral Medium… — and adds them all to Nova and the model checker, fastest first, with automatic fallback.", es: "Modelos de IA rápidos y buenos: el dueño puede pegar claves gratis de Groq, Cerebras, Google Gemini, Mistral y OpenRouter (una o todas). Nebulix descubre sus mejores modelos de chat (GPT-OSS 120B, Llama 3.3 70B, Kimi K2, Qwen 3, Gemini 2.5 Flash y Pro, Mistral Medium…) y los añade todos a Nova y al comprobador, primero los más rápidos y con relevo automático." },
      { type: 'improved', en: "New default design “Studio”: calm and flat — neutral greys, one accent colour, no glows, gradients or moving backgrounds, cleaner type. Your theme colours are still there if you pick another design in Appearance.", es: "Nuevo diseño por defecto «Studio»: tranquilo y plano, con grises neutros, un solo color de acento, sin brillos, degradados ni fondos animados y con una tipografía más limpia. Los colores de tu tema siguen ahí si eliges otro diseño en Apariencia." },
    ],
  },
  {
    v: '13.1', date: '2026-11-22', title: { en: 'Nova Agent, more AI models, player Marketplace and a new Vault', es: 'Nova Agente, más modelos de IA, Mercado de jugadores y nuevo Vault' },
    changes: [
      { type: 'new', en: "Nova Agent (PRO): Nova can now work on your Nebulix like a coding agent. Ask it in plain words and it reads and changes your Nebulix Code repositories (creates repos, writes and deletes files as commits, runs JavaScript to test), your notes, Drive, Hub uploads, Vault prices, profile, Shop and Locker. Every change appears as a card you allow or refuse (or turn on auto-approve for the chat), and Nova checks the result and tells you what it did.", es: "Nova Agente (PRO): Nova ya puede trabajar en tu Nebulix como un agente de programación. Pídeselo con tus palabras y lee y cambia tus repositorios de Nebulix Code (crea repositorios, escribe y borra archivos como commits, ejecuta JavaScript para probar), tus notas, Drive, publicaciones del Hub, precios del Vault, perfil, Tienda y Taquilla. Cada cambio aparece en una tarjeta que permites o rechazas (o activas la aprobación automática en ese chat), y Nova comprueba el resultado y te cuenta lo que ha hecho." },
      { type: 'new', en: "More free AI models, no key needed: GPT-OSS 20B, Gemma 3 27B, Codestral (for code), Mistral Nemo 12B, DeepSeek R1 1.5B and TinyLlama. Pick one in the model menu or leave “Auto”: if a model is busy Nova moves to the next one by itself. Some models run straight from your browser so you get your own free allowance.", es: "Más modelos de IA gratis, sin clave: GPT-OSS 20B, Gemma 3 27B, Codestral (para código), Mistral Nemo 12B, DeepSeek R1 1.5B y TinyLlama. Elige uno en el menú de modelos o deja «Automático»: si uno está ocupado, Nova pasa sola al siguiente. Algunos funcionan directamente desde tu navegador, así que tienes tu propio cupo gratis." },
      { type: 'new', en: "Model checker: test every free model with one click and see which ones answer right now, how fast, and which ones work from your browser.", es: "Comprobador de modelos: prueba todos los modelos gratis con un clic y mira cuáles responden ahora, lo rápido que van y cuáles funcionan desde tu navegador." },
      { type: 'new', en: "Player Marketplace: sell the cosmetics you own to other players for coins (Market and Locker items, even Shop exclusives). The seller receives 95%; 5% is the market fee. Every item shows its lowest offer, last sale, 7-day average, trend and a price chart.", es: "Mercado de jugadores: vende a otros jugadores por monedas los cosméticos que tienes (objetos del Mercado y de la Taquilla, incluso exclusivos de la Tienda). El vendedor recibe el 95 %; el 5 % es la comisión. Cada objeto muestra su oferta más baja, última venta, media de 7 días, tendencia y un gráfico de precios." },
      { type: 'improved', en: "The market script now also reads the player Marketplace: it suggests a fair price for every item from real sales and shop prices, blocks prices that are far off, and when players pay more than the shops ask it raises the shop prices a little (and the other way round).", es: "El script del mercado ahora también lee el Mercado de jugadores: sugiere un precio justo para cada objeto a partir de las ventas reales y de la tienda, bloquea precios absurdos y, cuando los jugadores pagan más de lo que pide la tienda, sube un poco los precios de la tienda (y al revés)." },
      { type: 'improved', en: "New Nebula Vault, a full game store: store bar with search, featured carousel with screenshots, special offers, browse by tag, new / top sellers / best rated / free lists, a page for every game (media gallery, purchase box, review summary from player reviews, details, more like this), a library with a big hero for each game, and key art drawn for games without a cover.", es: "Nuevo Nebula Vault, una tienda de juegos completa: barra con buscador, carrusel destacado con capturas, ofertas especiales, explorar por etiqueta, listas de novedades, más vendidos, mejor valorados y gratis, una página por juego (galería, caja de compra, resumen de reseñas, detalles y juegos parecidos), una biblioteca con una portada grande de cada juego y portadas dibujadas para los juegos que no tienen." },
      { type: 'improved', en: "Nebulix Arena has a real game front-end: your character in 3D on stage (it even does emotes), mode cards, Casual / Ranked and a big PLAY button. Damage numbers now pop over the players you hit (blue on shield, yellow on headshots).", es: "Nebulix Arena tiene un menú de juego de verdad: tu personaje en 3D en el escenario (hasta hace gestos), tarjetas de modo, Normal / Clasificatoria y un gran botón JUGAR. Ahora salen números de daño sobre los jugadores a los que das (azules en el escudo, amarillos en la cabeza)." },
      { type: 'improved', en: "Real pictures instead of emojis: every Locker item is rendered in 3D for the Shop, Locker and Marketplace; ranks have their own drawn emblems; icons replace emojis in Nova, Arena, Competitive, Vault and profiles.", es: "Imágenes reales en vez de emojis: cada objeto de la Taquilla se dibuja en 3D para la Tienda, la Taquilla y el Mercado; los rangos tienen emblemas propios; y los iconos sustituyen a los emojis en Nova, el Arena, Competitivo, el Vault y los perfiles." },
      { type: 'improved', en: "Nebulix Code gets its own calm developer look for repositories, files, README, issues and pull requests.", es: "Nebulix Code estrena un aspecto propio y sobrio, para desarrolladores, en repositorios, archivos, README, issues y pull requests." },
    ],
  },
  {
    v: '13.0', date: '2026-11-22', title: { en: 'Competitive season: ranked, duels, a daily Shop and Nebula Vault', es: 'Temporada competitiva: clasificatoria, duelos, Tienda diaria y Nebula Vault' },
    changes: [
      { type: 'new', en: "Shop & Locker: a daily Shop that rotates at midnight (Madrid time) with two featured sets as bundles (25% off), six daily items with a −40% flash deal and limited exclusives with a few copies for everyone that do not come back for 30 days. Gift any item to a friend.", es: "Tienda y Taquilla: una Tienda diaria que cambia a medianoche (hora de Madrid) con dos sets destacados en lote (25 % de descuento), seis objetos diarios con una oferta flash del −40 % y exclusivos limitados, con pocas copias para todos, que no vuelven en 30 días. Puedes regalar cualquier objeto a un amigo." },
      { type: 'new', en: "The Locker (Taquilla): 77 original items to collect — outfits, backpacks, pickaxes, gliders, weapon wraps, trails, emotes and elimination effects — with a 3D preview you can turn and try on. Everything you equip shows up in Nebula Royale.", es: "La Taquilla: 77 objetos originales para coleccionar (atuendos, mochilas, picos, planeadores, camuflajes de arma, estelas, gestos y efectos de eliminación) con una vista previa 3D que puedes girar y probarte. Todo lo que equipas se ve en Nebula Royale." },
      { type: 'new', en: "A live economy: every hour the server studies the coins of all players (how many exist, the typical wealth, how fast coins are created and spent, what people buy) and moves a price index between ×0.75 and ×1.5. The Market, the Advantages and the Shop follow it; popular items cost a bit more and forgotten ones go on sale. See it in Shop → Economy.", es: "Economía en vivo: cada hora el servidor estudia las monedas de todos los jugadores (cuántas hay, la riqueza típica, lo rápido que se crean y se gastan y qué se compra) y mueve un índice de precios entre ×0,75 y ×1,5. El Mercado, las Ventajas y la Tienda lo siguen; los objetos populares cuestan algo más y los olvidados se rebajan. Míralo en Tienda → Economía." },
      { type: 'new', en: "More to do with coins: supply crates, an Arena booster (+50% coins), double XP, a rank shield, duel bets, gifts and Nebula Vault.", es: "Más cosas que hacer con las monedas: cofres de suministro, Potenciador Arena (+50 % de monedas), XP doble, escudo de rango, apuestas en duelos, regalos y Nebula Vault." },
      { type: 'new', en: "Competitive: ranked queues for Nebula Royale, Nebula Ops and Duels with rank points and our own ranks — Bronce, Plata, Oro, Platino, Diamante (I-III), Nebulosa, Supernova and Singularidad (top 100). 30-day seasons with coins and exclusive items for the highest rank you reach, a leaderboard per mode and your rank on your profile and in matches.", es: "Competitivo: colas clasificatorias de Nebula Royale, Nebula Ops y Duelos con puntos de rango y rangos propios: Bronce, Plata, Oro, Platino, Diamante (I-III), Nebulosa, Supernova y Singularidad (top 100). Temporadas de 30 días con monedas y objetos exclusivos según el rango más alto que alcances, clasificación por modo y tu rango en el perfil y en las partidas." },
      { type: 'new', en: "Duels on Prism Court: 1 vs 1, both players get the same weapon each round, first to 5. Quick match, ranked, or challenge a friend by username with an optional coin bet — the winner takes 95% of the pot (refunded if the duel never happens).", es: "Duelos en Prism Court: 1 contra 1, en cada ronda los dos tenéis la misma arma y gana quien llegue a 5. Partida rápida, clasificatoria o reta a un amigo por su usuario con apuesta opcional: el ganador se lleva el 95 % del bote (se devuelve si el duelo no llega a jugarse)." },
      { type: 'new', en: "Nebula Vault, the game store of Nebulix: creators sell their Hub games for coins (with discounts) and keep 85% of every sale; players buy them once and keep them in their library, with a wishlist that warns about discounts, deals, top sellers and refunds for 30 minutes. Paid games only run for their owners.", es: "Nebula Vault, la tienda de juegos de Nebulix: los creadores venden sus juegos del Hub por monedas (con descuentos) y se quedan el 85 % de cada venta; los jugadores los compran una vez y los guardan en su biblioteca, con lista de deseos que avisa de las rebajas, ofertas, más vendidos y reembolso durante 30 minutos. Los juegos de pago solo funcionan para quien los tiene." },
      { type: 'improved', en: "Smarter Nebula Royale bots: reaction time and aim by difficulty, they build walls when shot, jump and strafe, pick the right weapon for the distance, go into houses for chests, pick up loot, heal and move ahead of the storm. Ranked rooms get tougher bots.", es: "Bots de Nebula Royale más listos: tiempo de reacción y puntería según la dificultad, construyen paredes cuando les disparan, saltan y esquivan, eligen el arma según la distancia, entran en las casas a por cofres, recogen botín, se curan y se adelantan a la tormenta. En clasificatoria los bots son más duros." },
      { type: 'improved', en: "Better Nebula Royale graphics: pitched roofs with chimneys and windows, grass and flowers, pines and trees in different greens, a beach and an animated sea, clouds and sun, an animated storm wall, light beams over chests and loot, and a nicer drop ship.", es: "Mejores gráficos en Nebula Royale: tejados a dos aguas con chimenea y ventanas, hierba y flores, pinos y árboles de distintos verdes, playa y mar animado, nubes y sol, muro de tormenta animado, haces de luz sobre cofres y botín y una nave mejor." },
      { type: 'new', en: "Nebula Royale: med kits (H) and shield cells (J) in chests, eliminated players drop their loot (E to pick it up), emotes (T) and elimination effects.", es: "Nebula Royale: botiquines (H) y células de escudo (J) en los cofres, los eliminados sueltan su botín (E para recogerlo), gestos (T) y efectos de eliminación." },
      { type: 'fixed', en: "“Play again” in Nebula Royale starts a new match without reloading the whole page; leaving a match no longer sends you back by mistake.", es: "«Jugar otra vez» en Nebula Royale empieza otra partida sin recargar toda la página, y ya no te saca de la partida por error al terminar." },
      { type: 'improved', en: "Menus reorganised: Shop & Locker in Economy; Competitive and Nebula Vault next to Nebulix Arena in Play.", es: "Menús reorganizados: Tienda y Taquilla en Economía; Competitivo y Nebula Vault junto a Nebulix Arena en Jugar." },
    ],
  },
  {
    v: '12.0', date: '2026-11-21', title: { en: 'Nebulix Arena: online battle royale and 5 vs 5', es: 'Nebulix Arena: battle royale online y 5 contra 5' },
    changes: [
      { type: 'new', en: 'Nebula Royale: an original online battle royale for up to 20 players on a floating island with 7 places to land. Jump from the drop ship, glide down, open chests for weapons by rarity (common to legendary) and shields, harvest materials with the pickaxe and build walls, floors and ramps. The storm closes in 6 phases; the last one standing wins.', es: 'Nebula Royale: un battle royale online original para hasta 20 jugadores en una isla flotante con 7 zonas donde aterrizar. Salta de la nave, planea, abre cofres con armas por rareza (de común a legendaria) y escudos, recoge materiales con el pico y construye paredes, suelos y rampas. La tormenta se cierra en 6 fases y gana el último en pie.' },
      { type: 'new', en: 'Nebula Ops goes online: “Assault”, 5 vs 5 in rounds on the new map Nebula Depot. Raiders plant the plasma core at site A or B, Guardians defend and defuse it. Money and a buy menu between rounds (SMG, shotgun, rifle, sniper, armor, defuse kit), first team to 7 wins, spectate your team when you fall.', es: 'Nebula Ops pasa a ser online: «Asalto», 5 contra 5 por rondas en el nuevo mapa Depósito Nebula. Los Saqueadores plantan el núcleo de plasma en la zona A o B y los Guardianes lo defienden y desactivan. Dinero y menú de compra entre rondas (subfusil, escopeta, rifle, francotirador, blindaje y kit de desactivación), gana el primero en llegar a 7 y, si caes, ves a tu equipo.' },
      { type: 'new', en: 'Bots fill every empty place, so a match always starts. The server checks every shot (fire rate, range, line of sight) and owns health, loot, the storm and the builds. Coins for wins and for eliminating real players (up to 3,000 a day).', es: 'Los bots rellenan los huecos, así que siempre empieza una partida. El servidor comprueba cada disparo (cadencia, alcance y línea de visión) y controla la vida, el botín, la tormenta y las construcciones. Monedas por victorias y por eliminar a jugadores reales (hasta 3000 al día).' },
    ],
  },
  {
    v: '11.0', date: '2026-11-21', title: { en: 'Nova everywhere', es: 'Nova en todas partes' },
    changes: [
      { type: 'improved', en: 'Nova is faster to start: one shared engine for the Nova page, the copilot, the floating Nova and the writing tools, ready to use a free key (Groq, Gemini, OpenRouter) as soon as the owner adds one.', es: 'Nova arranca más rápido: un solo motor para la página de Nova, el copiloto, la Nova flotante y las herramientas de escritura, listo para usar una clave gratuita (Groq, Gemini, OpenRouter) en cuanto el dueño la añada.' },
      { type: 'new', en: 'Web search in Nova (🌐): it searches the internet, reads the top results and answers citing them, with the sources as links under the answer.', es: 'Búsqueda web en Nova (🌐): busca en internet, lee los mejores resultados y responde citándolos, con las fuentes como enlaces debajo de la respuesta.' },
      { type: 'new', en: 'Images with Nova (🎨 or “/imagina …”): free image generation with styles (realistic, anime, pixel art, 3D, watercolor, neon) and formats, saved in your chats, with download and zoom. Safe filter on.', es: 'Imágenes con Nova (🎨 o «/imagina …»): genera imágenes gratis con estilos (realista, anime, píxel art, 3D, acuarela, neón) y formatos; se guardan en tus chats y se pueden descargar y ampliar. Filtro de contenido seguro activado.' },
      { type: 'new', en: 'Talk to Nova: dictate your message with the microphone button (in browsers that support it).', es: 'Habla con Nova: dicta tu mensaje con el botón del micrófono (en los navegadores que lo permiten).' },
      { type: 'new', en: 'Nova everywhere: a floating Nova button on every page (Alt+N) opens a mini-chat that knows the page you are on and the text you selected — explain, summarize, translate or ask anything.', es: 'Nova en todas partes: un botón flotante en todas las páginas (Alt+N) abre un mini-chat que sabe en qué página estás y qué texto has seleccionado: explicar, resumir, traducir o preguntar lo que quieras.' },
      { type: 'new', en: '✨ Write with Nova in any text box (chat, Echo, forums, Docs, notes, descriptions…): improve, fix spelling, shorter, longer, more formal, more fun, translate or continue. Ctrl+Z undoes it.', es: '✨ Escribir con Nova en cualquier caja de texto (chat, Echo, foros, Docs, notas, descripciones…): mejorar, corregir ortografía, acortar, alargar, más formal, más divertido, traducir o continuar. Ctrl+Z lo deshace.' },
    ],
  },
  {
    v: '10.0', date: '2026-11-21', title: { en: 'Nova 10: real AI, ChatGPT-style, and a coding copilot', es: 'Nova 10: IA de verdad, estilo ChatGPT y copiloto de programación' },
    changes: [
      { type: 'new', en: 'Nova now answers with a real AI model, free and always on (GPT-OSS 20B online), with no setup. The owner can switch to a free key (Groq, Gemini, OpenRouter), Claude or Ollama in Admin → AI. If the free model is busy, the built-in helper answers.', es: 'Nova ahora responde con un modelo de IA de verdad, gratis y siempre activo (GPT-OSS 20B en línea), sin configurar nada. El dueño puede cambiar a una clave gratuita (Groq, Gemini, OpenRouter), Claude u Ollama en Admin → IA. Si el modelo gratuito está ocupado, responde el asistente básico.' },
      { type: 'new', en: 'Completely new Nova, like ChatGPT: a sidebar with your chats saved on your account (search, pin, rename, export, delete), the model “thinking” folded away, edit and resend, regenerate, copy, read aloud, 👍/👎, attach code files, drag & drop and keyboard shortcuts.', es: 'Nova completamente nueva, como ChatGPT: barra lateral con tus chats guardados en tu cuenta (buscar, fijar, renombrar, exportar y borrar), el «razonamiento» del modelo plegado, editar y reenviar, regenerar, copiar, leer en voz alta, 👍/👎, adjuntar archivos de código, arrastrar y soltar, y atajos de teclado.' },
      { type: 'new', en: 'Code mode: Nova answers as a senior programmer with complete, runnable code. Code blocks are highlighted and can be copied, downloaded, run in a sandbox (HTML, JS, CSS) or opened in Nebulix Studio.', es: 'Modo Código: Nova responde como un programador experto con código completo que funciona. Los bloques de código salen resaltados y se pueden copiar, descargar, ejecutar aislados (HTML, JS, CSS) o abrir en Nebulix Studio.' },
      { type: 'new', en: 'Customize Nova: tell it about you and how it should answer, pick a personality and manage what it remembers.', es: 'Personaliza Nova: cuéntale cosas de ti y cómo quieres que responda, elige una personalidad y gestiona lo que recuerda.' },
      { type: 'new', en: 'Nova Copilot in Nebulix Studio: suggestions in grey while you type (Tab accepts, needs an AI key), and a panel to explain, fix, refactor, comment, test or optimize the selection or the file, with one-click apply (Ctrl+I, or right-click).', es: 'Nova Copilot en Nebulix Studio: sugerencias en gris mientras escribes (Tab las acepta; necesita una clave de IA) y un panel para explicar, arreglar, refactorizar, comentar, testear u optimizar la selección o el archivo, aplicándolo con un clic (Ctrl+I o clic derecho).' },
    ],
  },
  {
    v: '9.2', date: '2026-11-21', title: { en: 'Better Nebulix TV, reviews and game clips', es: 'Nebulix TV mejorado, reseñas y clips de juegos' },
    changes: [
      { type: 'new', en: 'Nebulix TV: thumbnails play a preview when you hover them, a red bar shows how much you watched, “Continue watching” on the home page, and search filters by date, views and length.', es: 'Nebulix TV: las miniaturas muestran una vista previa al pasar el ratón, una barra roja indica cuánto has visto, «Seguir viendo» en la portada y filtros de búsqueda por fecha, visualizaciones y duración.' },
      { type: 'new', en: 'New player: speed, loop, theater mode, picture in picture, autoplay, resume where you left it and YouTube-style shortcuts (K, J, L, F, M, T, I and 0–9). Chapters from “1:30 Boss fight” lines, clickable timestamps, Watch later and a link at the current time.', es: 'Reproductor nuevo: velocidad, bucle, modo cine, imagen en imagen, reproducción automática, reanudar donde lo dejaste y atajos como en YouTube (K, J, L, F, M, T, I y 0–9). Capítulos a partir de líneas como «1:30 Jefe final», tiempos clicables, Ver más tarde y enlace en el minuto actual.' },
      { type: 'new', en: 'Thumbnails: when uploading, pick one of several frames or upload your own image; creators can change it later, even from the frame on screen.', es: 'Miniaturas: al subir, elige entre varios fotogramas o sube tu propia imagen; el creador puede cambiarla después, incluso usando el fotograma que está en pantalla.' },
      { type: 'improved', en: 'Comments: Top or Newest, the creator can pin a comment and give hearts, authors can edit, and timestamps jump in the video. Views are counted once per person every 6 hours.', es: 'Comentarios: Destacados o Más recientes, el creador puede fijar uno y dar corazones, cada autor puede editar el suyo y los tiempos saltan en el vídeo. Las visitas se cuentan una vez por persona cada 6 horas.' },
      { type: 'new', en: 'Nebulix Hub: 1–5 star reviews with text, helpful votes and a reply from the creator; ratings on every card and a “Best rated” sort. Games and apps can have up to 8 screenshots.', es: 'Nebulix Hub: reseñas de 1 a 5 estrellas con texto, votos de «útil» y respuesta del creador; valoración en cada tarjeta y orden por «Mejor valorados». Juegos y apps pueden tener hasta 8 capturas.' },
      { type: 'new', en: 'Game clips: record up to 60 seconds of a Hub game while you play and publish it as a clip, or upload one. Clips show the game they belong to, and each game page lists its clips. Subscribers get a notice when you upload.', es: 'Clips de juegos: graba hasta 60 segundos de un juego del Hub mientras juegas y publícalo como clip, o sube uno. Los clips muestran a qué juego pertenecen y cada juego lista sus clips. Tus suscriptores reciben un aviso cuando subes algo.' },
    ],
  },
  {
    v: '9.1', date: '2026-11-21', title: { en: 'Community: bots, voice with video, moderation and tickets', es: 'Comunidad: bots, voz con vídeo, moderación y tickets' },
    changes: [
      { type: 'new', en: 'Every server has its own bot (Nebubot, rename it and pick its icon): slash commands like /rank, /top, /8ball, /choose, /dice, /userinfo, /serverinfo and /remind, custom !commands, welcome and goodbye messages, an auto-role and giveaways with an Enter button. It writes in Spanish or English.', es: 'Cada servidor tiene su propio bot (Nebubot, cámbiale el nombre y el icono): comandos como /rank, /top, /8ball, /choose, /dice, /userinfo, /serverinfo y /remind, !comandos personalizados, mensajes de bienvenida y despedida, rol automático y sorteos con botón de participar. Escribe en español o en inglés.' },
      { type: 'new', en: 'Levels: members earn XP by chatting, see their rank card with /rank and the leaderboard with /top, and can unlock roles at chosen levels.', es: 'Niveles: los miembros ganan XP hablando, ven su tarjeta con /rank y el ranking con /top, y pueden desbloquear roles al llegar a ciertos niveles.' },
      { type: 'new', en: 'Moderation: AutoMod (blocked words, invites, links, CAPS, spam and mass mentions, with block, warn or timeout), warnings (3 in a week = 1 hour timeout), a moderation log channel, a ban list with unban, and mod commands /warn, /timeout, /purge, /slowmode, /lock, /say, /embed and /giveaway.', es: 'Moderación: AutoMod (palabras prohibidas, invitaciones, enlaces, MAYÚSCULAS, spam y menciones masivas, con bloquear, avisar o aislar), avisos (3 en una semana = 1 hora aislado), canal de registro de moderación, lista de baneos con opción de quitarlos y comandos /warn, /timeout, /purge, /slowmode, /lock, /say, /embed y /giveaway.' },
      { type: 'new', en: 'Tickets: post a ticket panel and members open private channels with the staff. Close, reopen, delete and download the transcript. Role buttons let members give themselves roles.', es: 'Tickets: publica un panel y los miembros abren canales privados con el staff. Cerrar, reabrir, borrar y descargar la transcripción. Los botones de roles permiten que cada uno se ponga roles.' },
      { type: 'new', en: 'Voice: camera and screen sharing with a video stage, a soundboard everyone hears, push to talk, volume per person, and moderators can mute or disconnect people. Rooms hold up to 10 people.', es: 'Voz: cámara y compartir pantalla con un escenario de vídeo, tablero de sonidos que oyen todos, pulsar para hablar, volumen por persona, y los moderadores pueden silenciar o desconectar. Las salas admiten hasta 10 personas.' },
    ],
  },
  {
    v: '9.0', date: '2026-11-21', title: { en: 'Nebula Worlds 9, new casino games and screen lock', es: 'Nebula Worlds 9, juegos nuevos de casino y bloqueo de pantalla' },
    changes: [
      { type: 'new', en: 'Nebula Worlds rebuilt: click the game to look around 360° with the mouse, a camera that never goes through walls, a new smooth character with real run, jump, fall and landing animations, and polished worlds (rounded platforms, glowing trims, laser fences, checkpoint beacons, a finish portal, a sky with sun, clouds and floating islands).', es: 'Nebula Worlds rehecho: haz clic en el juego para mirar 360° con el ratón, una cámara que nunca atraviesa paredes, un personaje nuevo y suave con animaciones de correr, saltar, caer y aterrizar, y mundos pulidos (plataformas redondeadas, bordes luminosos, vallas láser, balizas en los puntos de control, un portal de meta y un cielo con sol, nubes e islas flotantes).' },
      { type: 'new', en: 'New moves: sprint (Shift), dash (F or right-click), hold Space for higher jumps, and forgiving jumps (a little after leaving a ledge or just before landing still counts). Obbies have crumbling platforms and spinning lasers.', es: 'Movimientos nuevos: correr (Shift), impulso (F o clic derecho), mantener Espacio para saltar más, y saltos más precisos (cuentan un instante después de salir del borde o justo antes de aterrizar). Los obby tienen plataformas que se derrumban y láseres giratorios.' },
      { type: 'new', en: 'Race your ghost: your best run is saved on your device and replayed as a ghost, with split times at every checkpoint (green when you are ahead). Photo mode (P) saves a picture of the world.', es: 'Échale una carrera a tu fantasma: tu mejor carrera se guarda en tu dispositivo y se repite como un fantasma, con tiempos parciales en cada punto de control (en verde si vas por delante). El modo foto (P) guarda una foto del mundo.' },
      { type: 'new', en: 'Casino: three new games — Wheel, Keno and Limbo — with auto-bet, a free daily spin, a BIG / MEGA / EPIC WIN celebration, an animated balance and a live ticker of big wins. There is no bet limit any more: bet as much as you have.', es: 'Casino: tres juegos nuevos (Rueda, Keno y Limbo) con apuesta automática, un giro gratis diario, celebración de BIG / MEGA / EPIC WIN, saldo animado y un marcador en directo de grandes premios. Ya no hay límite de apuesta: apuesta todo lo que tengas.' },
      { type: 'new', en: 'Casino 3D: sweeping coloured spotlights, giant spinning coins, multicolour fireworks on big wins and a light show with a gold coin shower every minute.', es: 'Casino 3D: focos de colores que barren la sala, monedas gigantes girando, fuegos artificiales de colores en los grandes premios y un espectáculo de luces con lluvia de monedas de oro cada minuto.' },
      { type: 'new', en: 'Screen lock: hide Nebulix behind a password with Ctrl+Shift+L, from your account menu, after some idle minutes or every time it opens. It stays locked after reloading, and your account password also unlocks it. Settings → Security.', es: 'Bloqueo de pantalla: oculta Nebulix tras una contraseña con Ctrl+Shift+L, desde el menú de tu cuenta, tras unos minutos sin uso o cada vez que se abre. Sigue bloqueado aunque recargues, y la contraseña de tu cuenta también lo desbloquea. Ajustes → Seguridad.' },
    ],
  },
  {
    v: '8.9', date: '2026-11-20', title: { en: 'Native games inside Nebulix', es: 'Juegos nativos dentro de Nebulix' },
    changes: [
      { type: 'improved', en: 'Native mode now plays the game inside Nebulix: the game’s real page on the games domain, with no sandbox and no proxy, exactly like a Chrome tab — including multithreaded games (SharedArrayBuffer). An “Own window” button is still there if you prefer it.', es: 'El modo nativo ahora abre el juego dentro de Nebulix: la página real del juego en el dominio de juegos, sin aislamiento ni proxy, igual que una pestaña de Chrome, también juegos con varios hilos (SharedArrayBuffer). Sigue habiendo un botón «Ventana propia» si lo prefieres.' },
      { type: 'fixed', en: 'Games on the games domain can now use fullscreen, gamepads, sound autoplay, MIDI, the clipboard and motion sensors inside Nebulix (before, Nebulix blocked them in embedded games).', es: 'Los juegos del dominio de juegos ya pueden usar pantalla completa, mandos, sonido automático, MIDI, el portapapeles y los sensores de movimiento dentro de Nebulix (antes Nebulix se los bloqueaba en los juegos incrustados).' },
    ],
  },
  {
    v: '8.8', date: '2026-11-19', title: { en: '2 GB games for PRO and a native mode', es: 'Juegos de 2 GB para PRO y modo nativo' },
    changes: [
      { type: 'new', en: 'PRO members can upload games and apps of up to 2 GB. Big uploads are unpacked and served in pieces (with seeking), so they load fast and never overload the server; a .zip is removed once unpacked so it does not take double space.', es: 'Los miembros PRO pueden subir juegos y apps de hasta 2 GB. Las subidas grandes se descomprimen y se sirven por partes (con saltos), así que cargan rápido y nunca sobrecargan el servidor; el .zip se borra al descomprimirlo para no ocupar el doble.' },
      { type: 'new', en: 'Third way to run a game: “Native, in its own window”. For games that only work in a new tab: it opens in its own Nebulix window on the games domain, exactly like a Chrome tab — every browser feature, including multithreaded games (SharedArrayBuffer) — with a small bar to go back to Nebulix. Creators choose Sandboxed, Like in Chrome or Native when uploading or with Edit.', es: 'Tercera forma de ejecutar un juego: «Nativo, en su propia ventana». Para juegos que solo funcionan en una pestaña nueva: se abre en su propia ventana de Nebulix en el dominio de juegos, igual que una pestaña de Chrome —todas las funciones del navegador, incluidos los juegos con varios hilos (SharedArrayBuffer)— con una barra pequeña para volver a Nebulix. Los creadores eligen Aislado, Como en Chrome o Nativo al subir o con Editar.' },
    ],
  },
  {
    v: '8.7', date: '2026-11-19', title: { en: 'Games that run like in Chrome', es: 'Juegos que se ejecutan como en Chrome' },
    changes: [
      { type: 'new', en: 'Creators can turn on “Run like in Chrome” for a game or app (when uploading or with Edit). It then runs on the separate games domain (nebulix-games.fly.dev) with its own origin: normal browser storage, IndexedDB, service workers and file loading, exactly like a normal tab — and still no access to anyone’s Nebulix account.', es: 'Los creadores pueden activar «Ejecutar como en Chrome» en un juego o app (al subirlo o con Editar). Entonces se ejecuta en el dominio de juegos aparte (nebulix-games.fly.dev) con su propio origen: almacenamiento normal del navegador, IndexedDB, service workers y carga de archivos, igual que una pestaña normal, y sin acceso a la cuenta de Nebulix de nadie.' },
      { type: 'improved', en: 'On the games domain each game keeps its own saves (they do not mix with other games), and games that use cookies keep working when the browser blocks cookies in embedded frames.', es: 'En el dominio de juegos cada juego guarda sus propias partidas (no se mezclan con las de otros juegos), y los juegos que usan cookies siguen funcionando aunque el navegador bloquee las cookies en marcos incrustados.' },
    ],
  },
  {
    v: '8.6', date: '2026-11-19', title: { en: 'Hub games work like in Chrome', es: 'Los juegos del Hub funcionan como en Chrome' },
    changes: [
      { type: 'fixed', en: 'Many Hub games stopped on start because the safe sandbox blocks browser storage. Games now get working localStorage, sessionStorage and cookies, and their progress is saved on your account (per game). Service workers and the cache report “not available” instead of crashing the game.', es: 'Muchos juegos del Hub se paraban al arrancar porque el aislamiento de seguridad bloquea el almacenamiento del navegador. Ahora los juegos tienen localStorage, sessionStorage y cookies que funcionan, y su progreso se guarda en tu cuenta (por juego). Los service workers y la caché responden «no disponible» en lugar de romper el juego.' },
      { type: 'fixed', en: 'Games can now load their own files with fetch/XHR (levels, music, data), and engine files get the right type: .wasm, .data, .unityweb, glTF models, fonts and audio, plus pre-compressed .br and .gz files.', es: 'Los juegos ya pueden cargar sus propios archivos con fetch/XHR (niveles, música, datos), y los archivos de los motores llevan el tipo correcto: .wasm, .data, .unityweb, modelos glTF, fuentes y audio, además de archivos precomprimidos .br y .gz.' },
      { type: 'improved', en: 'More permissions for Hub games: downloads, gamepad, clipboard, motion sensors, screen orientation and opening links in a new tab. Option to delete your saved game in the More menu.', es: 'Más permisos para los juegos del Hub: descargas, mando, portapapeles, sensores de movimiento, orientación de pantalla y abrir enlaces en una pestaña nueva. Opción para borrar tu partida guardada en el menú Más.' },
    ],
  },
  {
    v: '8.5', date: '2026-11-19', title: { en: 'Animated backgrounds and a much bigger Hub', es: 'Fondos animados y un Hub mucho más completo' },
    changes: [
      { type: 'new', en: 'Animated backgrounds: upload a looping video (MP4/WEBM), a GIF or image, or an animated web page (HTML/JS/ZIP/folder) to the new Backgrounds section of the Hub, and press “Use as background” to play it behind the whole app. Adjust darkness, blur and video speed, or remove it, in Appearance.', es: 'Fondos animados: sube un vídeo en bucle (MP4/WEBM), un GIF o imagen, o una página web animada (HTML/JS/ZIP/carpeta) a la nueva sección Fondos del Hub, y pulsa «Usar como fondo» para que se reproduzca detrás de toda la app. Ajusta oscuridad, desenfoque y velocidad del vídeo, o quítalo, en Apariencia.' },
      { type: 'new', en: 'Hub: save uploads for later, see your history, and make your own collections (they appear as tabs).', es: 'Hub: guarda subidas para más tarde, mira tu historial y crea tus propias colecciones (aparecen como pestañas).' },
      { type: 'new', en: 'Hub: comments under every upload, report button, copy link, copy embed code (to put a game on another website), theater mode, and download or remix when the author allows it (two new switches when uploading).', es: 'Hub: comentarios en cada subida, botón de denunciar, copiar enlace, copiar código para insertar (para poner un juego en otra web), modo cine, y descargar o hacer un remix cuando el autor lo permite (dos interruptores nuevos al subir).' },
      { type: 'new', en: 'Hub: popular tags to filter, more ways to sort (most liked, most commented, recently updated, random) and stats for creators in My uploads (views, likes, comments, remixes).', es: 'Hub: etiquetas populares para filtrar, más formas de ordenar (más gustados, más comentados, actualizados hace poco, al azar) y estadísticas para creadores en Mis subidas (visitas, me gusta, comentarios, remixes).' },
      { type: 'fixed', en: 'The Restart button of Hub games no longer adds an entry to the browser history.', es: 'El botón Reiniciar de los juegos del Hub ya no añade una entrada al historial del navegador.' },
    ],
  },
  {
    v: '8.4', date: '2026-11-19', title: { en: 'Moderators, a calmer Hub and a richer casino', es: 'Moderadores, un Hub más sobrio y un casino más vistoso' },
    changes: [
      { type: 'new', en: 'Moderator tools: warn a user (they see the reason), mute them for 10 minutes to 7 days (they can still read, use private messages and report), see a user’s warnings, remove Hub uploads and community worlds with a reason, and a moderation log for the whole team. The owner gives the moderator role from Admin › Users.', es: 'Herramientas de moderación: avisar a un usuario (ve el motivo), silenciarlo de 10 minutos a 7 días (puede seguir leyendo, usar mensajes privados y denunciar), ver sus avisos, retirar subidas del Hub y mundos de la comunidad con un motivo, y un registro de moderación para todo el equipo. El dueño da el rol de moderador desde Admin › Usuarios.' },
      { type: 'new', en: 'Hub games and apps can now load scripts, images, sounds, fonts and data from the internet (https). They still run sandboxed and can never see your account.', es: 'Los juegos y apps del Hub ya pueden cargar scripts, imágenes, sonidos, fuentes y datos de internet (https). Siguen ejecutándose aislados y nunca pueden ver tu cuenta.' },
      { type: 'improved', en: 'Hub redesign: a quieter, catalogue-like look with plain tabs, covers with initials instead of emoji, a compact “most played this week”, and a new list view with author, type, files, size, views and date.', es: 'Rediseño del Hub: un aspecto más sobrio, de catálogo, con pestañas sencillas, portadas con iniciales en lugar de emojis, un «lo más jugado de la semana» compacto y una nueva vista en lista con autor, tipo, archivos, tamaño, visitas y fecha.' },
      { type: 'improved', en: '3D casino: art-deco carpet, wood tables with felt, panelled walls with gold mouldings and glowing sconces, a coffered ceiling with soft light, light halos, floating dust, slot machines whose reels really spin, and reflections without RTX too.', es: 'Casino 3D: moqueta art déco, mesas de madera con tapete, paredes con paneles y molduras doradas y apliques que brillan, techo de casetones con luz suave, halos de luz, polvo flotando, tragaperras cuyos rodillos giran de verdad y reflejos también sin RTX.' },
    ],
  },
  {
    v: '8.3', date: '2026-11-19', title: { en: 'A new Nebulix Hub', es: 'Un Nebulix Hub nuevo' },
    changes: [
      { type: 'new', en: 'Hub: upload whole folders (choose one or drag it in; it is packed in your browser) and single .js files, besides .html and .zip. The start page is found by itself even if it is not called index.html, and a top folder is removed automatically.', es: 'Hub: sube carpetas enteras (elígelas o arrástralas; se empaquetan en tu navegador) y archivos .js sueltos, además de .html y .zip. La página de inicio se encuentra sola aunque no se llame index.html, y la carpeta superior se quita automáticamente.' },
      { type: 'new', en: 'Versions: publish a new version of your game or app with notes; the link, views and likes stay. A version history is shown under the game.', es: 'Versiones: publica una nueva versión de tu juego o app con notas; el enlace, las visitas y los me gusta se mantienen. Debajo del juego aparece el historial de versiones.' },
      { type: 'new', en: 'Files tab: see every file of a game or app and read its code. Covers for games and apps, an Edit button for title, description, tags and visibility, Restart and Open in a new tab buttons.', es: 'Pestaña Archivos: mira todos los archivos de un juego o app y lee su código. Portadas para juegos y apps, botón Editar para título, descripción, etiquetas y visibilidad, y botones Reiniciar y Abrir en una pestaña nueva.' },
      { type: 'improved', en: 'New Hub design: hero with your storage, a featured upload, filter chips with counts (including Everything) and nicer cards. Games and apps still run in a sandbox and can never touch your account.', es: 'Nuevo diseño del Hub: cabecera con tu espacio, una subida destacada, filtros con contadores (incluido Todo) y tarjetas más bonitas. Los juegos y apps siguen ejecutándose aislados y nunca pueden tocar tu cuenta.' },
      { type: 'fixed', en: 'Opening Nebulix with a different address in a tab where it was used before now opens that address instead of the last app.', es: 'Abrir Nebulix con otra dirección en una pestaña donde ya se había usado abre esa dirección en vez de la última app.' },
    ],
  },
  {
    v: '8.2', date: '2026-11-19', title: { en: 'A fixed address bar and a better desktop', es: 'Dirección fija y un escritorio mejor' },
    changes: [
      { type: 'fixed', en: 'The page address no longer changes while you use Nebulix, so your browser history only records opening it. Nebulix remembers where you are by itself: reloading the tab brings you back to the same app.', es: 'La dirección de la página ya no cambia mientras usas Nebulix, así que el historial del navegador solo apunta cuándo lo abres. Nebulix recuerda por sí mismo dónde estás: al recargar la pestaña vuelves a la misma app.' },
      { type: 'new', en: 'Desktop mode now has every app (59), each with its colour icon, and Start lists all apps by category with descriptions.', es: 'El modo escritorio ya tiene todas las apps (59), cada una con su icono de color, y el menú Inicio las muestra todas por categorías con descripción.' },
      { type: 'new', en: 'Task view: see every open window as a card, switch, close or tile them (button on the taskbar or Alt+Q).', es: 'Vista de tareas: ve todas las ventanas abiertas como tarjetas, cambia entre ellas, ciérralas u organízalas en mosaico (botón en la barra de tareas o Alt+Q).' },
      { type: 'new', en: 'Desktop keyboard shortcuts: Alt+Space Start, Alt+←/→ snap, Alt+↑ maximize, Alt+↓ minimize, Alt+W close, Alt+D desktop, Alt+1…9 pinned apps.', es: 'Atajos de teclado en el escritorio: Alt+Espacio Inicio, Alt+←/→ ajustar a un lado, Alt+↑ maximizar, Alt+↓ minimizar, Alt+W cerrar, Alt+D escritorio, Alt+1…9 apps ancladas.' },
      { type: 'new', en: 'New desktop widgets: World Boss, Word of the day and Nebulix Live.', es: 'Widgets nuevos en el escritorio: jefe mundial, Palabra del día y Nebulix Live.' },
      { type: 'improved', en: 'Desktop mode has its own identity: the Nebulix logo, an original nebula wallpaper and two styles, Nebulix Glass and Nebulix Dock. The desktop shows a tidy set of icons plus your pinned apps.', es: 'El modo escritorio tiene identidad propia: el logotipo de Nebulix, un fondo de nebulosa original y dos estilos, Nebulix Glass y Nebulix Dock. El escritorio muestra una selección ordenada de iconos más tus apps ancladas.' },
      { type: 'fixed', en: 'App icons in the desktop app overview were invisible.', es: 'Los iconos de la vista de apps del escritorio no se veían.' },
    ],
  },
  {
    v: '8.1', date: '2026-11-19', title: { en: 'A cleaner history, a daily word and challenges', es: 'Historial limpio, palabra diaria y retos' },
    changes: [
      { type: 'improved', en: 'Your browser history now only shows the moment you open Nebulix: moving between apps, clicking links inside Nebulix and browsing pages in the Nebulix browser (links, searches, page changes, closing tabs) no longer add entries. The Back and Forward buttons of the Nebulix browser still work.', es: 'El historial de tu navegador ahora solo muestra cuándo abres Nebulix: moverte entre apps, pulsar enlaces dentro de Nebulix y navegar con el navegador de Nebulix (enlaces, búsquedas, cambios de página, cerrar pestañas) ya no añade entradas. Los botones Atrás y Adelante del navegador de Nebulix siguen funcionando.' },
      { type: 'new', en: 'Word of the day: guess the secret 5-letter word in six tries. The same word for everyone, a new one every day, with streaks, stats, a shareable result and coins for winning.', es: 'Palabra del día: adivina la palabra secreta de 5 letras en seis intentos. La misma para todos, una nueva cada día, con rachas, estadísticas, resultado para compartir y monedas si aciertas.' },
      { type: 'new', en: 'Challenges: on someone’s player card, dare them to beat your best in an Arcade game. They get a notice and the challenge shows up in Nebulix Games until they beat it.', es: 'Retos: en la ficha de jugador de otra persona, rétale a superar tu récord en un juego del Arcade. Le llega un aviso y el reto aparece en Nebulix Games hasta que lo supere.' },
    ],
  },
  {
    v: '8.0', date: '2026-11-19', title: { en: 'Nebulix 8 · Horizon', es: 'Nebulix 8 · Horizon' },
    changes: [
      { type: 'new', en: 'Nexus navigation, the new default: a slim bar with five big categories (Home, Social, Games, Economy, Create) plus Favourites and More. Hover or tap a category to open a panel with its apps, each with its own colour icon, a description and live badges. Search inside the panel, star your favourite apps and pin the panel open if you like a permanent sidebar. On phones it becomes a bottom tab bar with sheets.', es: 'Navegación Nexus, la nueva por defecto: una barra estrecha con cinco grandes categorías (Inicio, Social, Juegos, Economía, Crear) más Favoritos y Más. Pasa el ratón o toca una categoría para abrir un panel con sus apps, cada una con su icono de color, una descripción e insignias en directo. Busca dentro del panel, marca tus apps favoritas con la estrella y fija el panel si prefieres una barra lateral permanente. En el móvil se convierte en una barra de pestañas abajo con hojas.' },
      { type: 'new', en: 'Every app has its own colour icon, also in the app launcher and on Home.', es: 'Cada app tiene su propio icono de color, también en el lanzador de apps y en Inicio.' },
      { type: 'new', en: 'New top bar: where you are (Category › App) and a big search box in the middle (Ctrl K).', es: 'Nueva barra superior: dónde estás (Categoría › App) y un buscador grande en el centro (Ctrl K).' },
      { type: 'new', en: 'Nebulix Live: every big moment as it happens — bosses defeated, tournament winners, new worlds, new clans and Clan War winners, league champions, round levels and new all-time Arcade records. On Home and on its own page with filters.', es: 'Nebulix Live: cada gran momento en directo — jefes derrotados, ganadores de torneos, mundos nuevos, clanes nuevos y ganadores de la Guerra de clanes, campeones de liga, niveles redondos y nuevos récords absolutos del Arcade. En Inicio y en su propia página con filtros.' },
      { type: 'new', en: 'Player card on every profile: league, clan, level, bosses defeated, best boss damage, tournaments won, worlds published and their players, season tier and Arcade bests.', es: 'Ficha de jugador en cada perfil: liga, clan, nivel, jefes derrotados, mejor daño a un jefe, torneos ganados, mundos publicados y sus jugadores, nivel de temporada y récords del Arcade.' },
      { type: 'fixed', en: 'The selected item in the classic sidebar was cut off on the left and showed a double border.', es: 'El elemento seleccionado del menú lateral clásico salía recortado por la izquierda y con doble borde.' },
    ],
  },
  {
    v: '7.0', date: '2026-11-19', title: { en: 'Nebulix 7: a whole new look', es: 'Nebulix 7: un aspecto totalmente nuevo' },
    changes: [
      { type: 'new', en: 'Nebulix 7 design, the new default: floating glass side panel and top bar, softly moving colour blooms behind everything, gradient buttons, bigger titles and smooth entrance animations. It works with every colour theme; the previous look is still available as Classic in Appearance.', es: 'Diseño Nebulix 7, el nuevo predeterminado: panel lateral y barra superior flotantes de cristal, destellos de color que se mueven suavemente al fondo, botones con degradado, títulos más grandes y animaciones de entrada suaves. Funciona con todos los temas de color; el aspecto anterior sigue disponible como Clásico en Apariencia.' },
      { type: 'new', en: 'Home is now a command centre: live tiles for the World Boss, the hourly tournament, your league, your clan and Nebula Worlds, updated in real time.', es: 'Inicio es ahora un centro de mando: tarjetas en directo del jefe mundial, el torneo de la hora, tu liga, tu clan y Nebula Worlds, actualizadas en tiempo real.' },
      { type: 'new', en: 'Nebulix Games: one hub for everything you can play, with a featured carousel, what is live now, every Arcade game with your best score, competitions, community worlds and 3D experiences.', es: 'Nebulix Games: un centro para todo lo que se puede jugar, con carrusel de destacados, lo que está en directo, todos los juegos del Arcade con tu récord, competiciones, mundos de la comunidad y experiencias 3D.' },
      { type: 'new', en: 'New Arcade game: Gravity Dash — flip gravity between the floor and the ceiling to dodge spikes while the speed keeps rising.', es: 'Nuevo juego del Arcade: Gravity Dash — invierte la gravedad entre el suelo y el techo para esquivar pinchos mientras la velocidad no para de subir.' },
      { type: 'new', en: 'New Arcade game: Star Stack — drop each floor right on top of the last; perfect drops keep the full width and build combos.', es: 'Nuevo juego del Arcade: Star Stack — deja caer cada piso justo encima del anterior; los encajes perfectos mantienen el ancho y suman combos.' },
      { type: 'improved', en: 'Both new games count for tournaments, personal bests and daily Arcade coins.', es: 'Los dos juegos nuevos cuentan para torneos, récords y monedas diarias del Arcade.' },
    ],
  },
  {
    v: '6.0', date: '2026-11-19', title: { en: 'Build, team up, compete', es: 'Crea, únete y compite' },
    changes: [
      { type: 'new', en: 'World Builder: make your own 3D world on a grid editor with platforms, spawn, finish, checkpoints, bounce pads, lava, moving platforms, lifts, speed floors and glow blocks. Test it in 3D, then publish it. Everyone can play community worlds together, like them and race for the best time; creators earn coins when other players finish their obby.', es: 'Creador de mundos: haz tu propio mundo 3D en un editor de cuadrícula con plataformas, inicio, meta, puntos de control, camas elásticas, lava, plataformas móviles, ascensores, suelos rápidos y bloques brillantes. Pruébalo en 3D y publícalo. Todos pueden jugar juntos a los mundos de la comunidad, darles me gusta y competir por el mejor tiempo; los creadores ganan monedas cuando otros completan su obby.' },
      { type: 'new', en: 'Clans: found a clan with a tag, emblem and colour, or join one. Shared coin bank, clan wall, roles (leader, officers, members), levels that unlock more places, and your tag next to your name in Nebula Worlds and leagues.', es: 'Clanes: funda un clan con etiqueta, emblema y color, o únete a uno. Banco de monedas compartido, muro del clan, rangos (líder, oficiales, miembros), niveles que desbloquean más plazas y tu etiqueta junto a tu nombre en Nebula Worlds y en las ligas.' },
      { type: 'new', en: 'Clan War: every XP point members earn counts for their clan. Each Monday the top 3 clans win 100k, 50k and 25k coins for their bank.', es: 'Guerra de clanes: cada punto de XP que ganan los miembros cuenta para su clan. Cada lunes los 3 mejores clanes ganan 100k, 50k y 25k monedas para su banco.' },
      { type: 'new', en: 'Leagues: weekly divisions from Bronze to Nebula. Your XP this week ranks you in your league; the top players move up, the bottom ones move down, and everyone who played gets coins (top 3 also gems).', es: 'Ligas: divisiones semanales de Bronce a Nébula. Tu XP de la semana te clasifica en tu liga; los primeros ascienden, los últimos descienden y todos los que juegan reciben monedas (los 3 primeros, también gemas).' },
      { type: 'new', en: 'World Boss: every 2 hours a giant monster appears for 20 minutes and everyone online fights it together by tapping. Power attacks cost coins, its health grows with every fighter, and if it falls the reward is shared by damage, with gems for the top 3 and a last-hit bonus. A floating pill on every page shows when a boss is here.', es: 'Jefe mundial: cada 2 horas aparece un monstruo gigante durante 20 minutos y todos los conectados luchan juntos tocándolo. Los ataques especiales cuestan monedas, su vida crece con cada luchador y, si cae, el premio se reparte por daño, con gemas para los 3 primeros y extra por el golpe final. Un aviso flotante en todas las páginas indica cuándo hay un jefe.' },
      { type: 'fixed', en: 'Tournament prize and refund notices are now shown (they were sent but not displayed), in your language.', es: 'Ya se muestran los avisos de premios y devoluciones de los torneos (se enviaban pero no aparecían), en tu idioma.' },
    ],
  },
  {
    v: '5.7', date: '2026-11-19', title: { en: 'Worlds, tournaments and quizzes', es: 'Mundos, torneos y concursos' },
    changes: [
      { type: 'new', en: 'Nebula Worlds: 3D multiplayer worlds with your avatar. Four parkour courses (Nebula Tower, Neon Run, Void Climb, Lava Rush) with checkpoints, moving platforms, bounce pads and best-time rankings, plus Star Plaza and the VIP Sky Palace to hang out and chat. Finishing a course pays coins once a day.', es: 'Nebula Worlds: mundos 3D multijugador con tu avatar. Cuatro circuitos de parkour (Torre Nébula, Carrera Neón, Escalada del Vacío, Fiebre de Lava) con puntos de control, plataformas móviles, camas elásticas y ranking de tiempos, además de la Plaza Estelar y el Palacio del Cielo VIP para quedar y charlar. Completar un circuito paga monedas una vez al día.' },
      { type: 'new', en: 'Gear shop for the worlds: speed coil, gravity coil, double jump, glider, trails and hats, all bought with coins.', es: 'Tienda de equipamiento para los mundos: bobina de velocidad, bobina de gravedad, doble salto, planeador, estelas y gorros, todo con monedas.' },
      { type: 'new', en: 'Tournaments: a new Arcade tournament every hour (free), a daily cup and a weekly championship with entry fees and Nebulix bonuses. Prizes are paid automatically; paid tournaments with fewer than 2 players refund the entry.', es: 'Torneos: un torneo del Arcade nuevo cada hora (gratis), una copa diaria y un campeonato semanal con entrada y bonus de Nebulix. Los premios se pagan solos; los torneos de pago con menos de 2 jugadores devuelven la entrada.' },
      { type: 'new', en: 'Nebulix Quiz: live quiz games with a 6-digit PIN. Host on a big screen, players answer on their device, faster answers and streaks score more, and the podium wins coins. Six ready-made quizzes, a solo practice mode and your own quiz editor.', es: 'Nebulix Quiz: concursos en directo con un PIN de 6 cifras. Presenta en una pantalla grande, los jugadores responden desde su dispositivo, las respuestas rápidas y las rachas dan más puntos y el podio gana monedas. Seis cuestionarios listos, modo práctica y tu propio editor.' },
    ],
  },
  {
    v: '5.6', date: '2026-11-19', title: { en: 'Season pass', es: 'Pase de temporada' },
    changes: [
      { type: 'new', en: 'Season pass: a free 40-tier reward track that restarts every month. Everything you do gives season points; every tier pays coins, with gems every 5 tiers, boosts at 10, 20 and 30, and a season badge at 40. There is no paid track.', es: 'Pase de temporada: un camino de 40 niveles de recompensas gratis que se reinicia cada mes. Todo lo que haces da puntos de temporada; cada nivel paga monedas, con gemas cada 5 niveles, mejoras en el 10, 20 y 30 y una insignia de temporada en el 40. No hay versión de pago.' },
      { type: 'new', en: 'Weekly challenges: 6 new challenges every Monday (Arcade, Work, Life, Lens, pets…) that give lots of season points. Casino bets never count.', es: 'Desafíos semanales: 6 desafíos nuevos cada lunes (Arcade, Trabajo, Vida, Lens, mascotas…) que dan muchos puntos de temporada. Las apuestas del casino nunca cuentan.' },
      { type: 'improved', en: 'Home shows your season tier, weekly challenges and rewards waiting to be claimed.', es: 'Inicio muestra tu nivel de temporada, los desafíos semanales y las recompensas pendientes.' },
    ],
  },
  {
    v: '5.5', date: '2026-11-19', title: { en: 'A whole new life', es: 'Una vida nueva' },
    changes: [
      { type: 'new', en: 'Life: a life simulator. Look after energy, food, health and happiness with 16 daily actions, study from high school to a doctorate, buy homes (live in one, rent the rest out for daily income) and vehicles. A good life raises every salary at Work.', es: 'Vida: un simulador de vida. Cuida tu energía, comida, salud y felicidad con 16 acciones diarias, estudia desde el bachillerato hasta el doctorado, compra casas (vive en una y alquila las demás para cobrar cada día) y vehículos. Una buena vida sube todos tus sueldos en Trabajo.' },
      { type: 'new', en: 'Crypto in Invest: Bitcoin, Ethereum, Solana, BNB, XRP, Cardano, Dogecoin, Litecoin, Avalanche and Polkadot with real prices, 24/7. Trading stays simulated with virtual coins.', es: 'Criptomonedas en Inversiones: Bitcoin, Ethereum, Solana, BNB, XRP, Cardano, Dogecoin, Litecoin, Avalanche y Polkadot con precios reales, 24/7. Las operaciones siguen siendo simuladas con monedas virtuales.' },
      { type: 'new', en: 'Nebulix Lens: our own photo network with filters, likes, comments, profile grids and 24-hour stories.', es: 'Nebulix Lens: nuestra propia red de fotos con filtros, me gusta, comentarios, perfiles en cuadrícula e historias de 24 horas.' },
      { type: 'new', en: 'Nebulix Foros: communities with posts, up and down votes, Hot/New/Top and threaded replies. Anyone can create a community.', es: 'Nebulix Foros: comunidades con publicaciones, votos a favor y en contra, Popular/Nuevo/Mejores y respuestas en hilo. Cualquiera puede crear una comunidad.' },
      { type: 'new', en: 'Appearance page: pick the menu layout with live previews, 10 design skins and every colour theme in one place. New layouts: floating sidebar, top island and an app launcher with no menu bar. New designs: Soft clay, Minimal, Comic and Aurora glow.', es: 'Página de Apariencia: elige la distribución del menú con vistas previas, 10 diseños y todos los temas de colores en un solo sitio. Distribuciones nuevas: barra lateral flotante, isla superior y lanzador de apps sin barra de menú. Diseños nuevos: Arcilla suave, Minimalista, Cómic y Brillo aurora.' },
      { type: 'improved', en: 'Nebula Ops: new map (Nebula Outpost) with textured buildings, a sunset sky, dust in the light, bullet impacts, a radar, crouching and a scoped sniper rifle. Graphics adapt to the device (Low/Medium/RTX) and lower themselves if the game slows down.', es: 'Nebula Ops: mapa nuevo (Puesto Nébula) con edificios con texturas, cielo de atardecer, polvo en la luz, impactos de bala, radar, agacharse y un rifle de francotirador con mira. Los gráficos se adaptan al dispositivo (Bajo/Medio/RTX) y se reducen solos si el juego va lento.' },
      { type: 'fixed', en: 'Nebula Ops now works on Chromebooks: the start screen was invisible, aiming works even when the browser blocks mouse capture, and a lost graphics context no longer freezes the game.', es: 'Nebula Ops ya funciona en Chromebook: la pantalla de inicio era invisible, se puede apuntar aunque el navegador bloquee la captura del ratón y una pérdida del contexto gráfico ya no congela el juego.' },
      { type: 'fixed', en: 'Pets: adopting a pet after naming it did nothing. Fixed (the same bug also affected buying in the Plaza market).', es: 'Mascotas: adoptar una mascota después de ponerle nombre no hacía nada. Arreglado (el mismo fallo afectaba a comprar en el mercado de la Plaza).' },
    ],
  },
  {
    v: '5.4', date: '2026-11-19', title: { en: 'Coins with superpowers', es: 'Monedas con superpoderes' },
    changes: [
      { type: 'new', en: 'Advantages: spend coins on boosts (double XP, overtime pay, motivated staff, casino cashback, lucky wheel, Nova turbo, VIP), permanent upgrades (cloud storage, longer staff shifts, bigger bank vault) and the Nebulix Bank, which pays 0.5% interest a day.', es: 'Ventajas: gasta monedas en mejoras temporales (XP doble, horas extra, plantilla motivada, reembolso del casino, ruleta de la suerte, Nova turbo, VIP), mejoras permanentes (almacenamiento en la nube, turnos más largos, cámara del banco más grande) y el Banco Nebulix, que paga un 0,5 % de interés al día.' },
      { type: 'new', en: 'Nebulix Code is now a full forge: branches, pull requests with automatic three-way merge and conflict detection, issues with labels and comments, commit diffs, Download ZIP, topics, a repository sidebar with languages and contributors, and profiles with pinned repositories and a contribution graph.', es: 'Nebulix Code ahora es una forja completa: ramas, pull requests con fusión automática a tres bandas y detección de conflictos, issues con etiquetas y comentarios, diffs de commits, Descargar ZIP, temas, barra lateral con lenguajes y colaboradores, y perfiles con repositorios destacados y gráfico de contribuciones.' },
      { type: 'improved', en: 'Drive, Docs, Sheets and Slides redesigned: search bar, suggested files, folders and files sections, list view with columns, coloured file badges, a template gallery and cleaner editors.', es: 'Drive, Docs, Sheets y Slides rediseñados: barra de búsqueda, archivos sugeridos, secciones de carpetas y archivos, vista de lista con columnas, iconos de archivo de colores, galería de plantillas y editores más limpios.' },
    ],
  },
  {
    v: '5.3', date: '2026-11-19', title: { en: 'Sharper and shinier', es: 'Más nítido y más brillante' },
    changes: [
      { type: 'improved', en: 'RTX mode for the 3D games: ambient occlusion, bloom on lights and neon, SMAA antialiasing and soft high-resolution shadows in the 3D Casino, Nebula Ops and the 3D casino animations.', es: 'Modo RTX en los juegos 3D: oclusión ambiental, resplandor en luces y neones, antialiasing SMAA y sombras suaves en alta resolución en el Casino 3D, Nebula Ops y las animaciones 3D del casino.' },
      { type: 'improved', en: 'Coins are shortened everywhere: 10k, 27,7k, 1m, 10m (hover the top bar for the exact amount). In the casino, wallet and Plaza you can type amounts like 10k or 1,5m.', es: 'Las monedas se abrevian en todas partes: 10k, 27,7k, 1m, 10m (pasa el ratón por la barra superior para ver la cantidad exacta). En el casino, la cartera y la Plaza puedes escribir cantidades como 10k o 1,5m.' },
      { type: 'improved', en: 'Design polish: smoother page transitions, cards that lift on hover, themed scrollbars, clearer focus rings and a golden coin pill.', es: 'Diseño pulido: transiciones de página más suaves, tarjetas que se elevan al pasar el ratón, barras de desplazamiento a juego, foco más claro y una píldora de monedas dorada.' },
    ],
  },
  {
    v: '5.2', date: '2026-11-19', title: { en: 'Nebulix social', es: 'Nebulix social' },
    changes: [
      { type: 'new', en: 'Echo: our own network for short posts. Images, replies, reposts and quotes, likes, #hashtags and trends, @mentions, profiles and a Following timeline.', es: 'Echo: nuestra propia red de publicaciones cortas. Imágenes, respuestas, reposts y citas, me gusta, #hashtags y tendencias, @menciones, perfiles y cronología de Siguiendo.' },
      { type: 'new', en: 'Clips: vertical short videos in a full-screen swipe feed. Double-tap to like, comments, follow creators, For you and Following tabs.', es: 'Clips: vídeos cortos verticales en un feed a pantalla completa. Doble toque para dar me gusta, comentarios, seguir a creadores y pestañas Para ti y Siguiendo.' },
      { type: 'new', en: 'Nebulix TV: channels for long videos with subscriptions, trending, comments with replies, up next and autoplay.', es: 'Nebulix TV: canales para vídeos largos con suscripciones, tendencias, comentarios con respuestas, siguiente vídeo y reproducción automática.' },
      { type: 'improved', en: 'One follow for everything: following someone on Echo also subscribes you to their channel and shows their clips.', es: 'Un solo seguir para todo: seguir a alguien en Echo también te suscribe a su canal y te muestra sus clips.' },
    ],
  },
  {
    v: '5.1', date: '2026-11-18', title: { en: 'Nebulix for everything', es: 'Nebulix para todo' },
    changes: [
      { type: 'new', en: 'Nebulix Search, our own search engine: web, images, news and videos, a Wikipedia card, instant answers and suggestions. It is the new default and also answers Google searches, which Google blocks through proxies.', es: 'Nebulix Search, nuestro propio buscador: web, imágenes, noticias y vídeos, ficha de Wikipedia, respuestas al instante y sugerencias. Es el buscador por defecto y también responde a las búsquedas de Google, que Google bloquea a través de proxies.' },
      { type: 'new', en: 'Native clients in the browser for Wikipedia, Hacker News and Twitch, next to Nebulix Tube for YouTube.', es: 'Clientes nativos en el navegador para Wikipedia, Hacker News y Twitch, además de Nebulix Tube para YouTube.' },
      { type: 'new', en: 'Nebulix Code: repositories with commits, file uploads, README, stars, forks, collaborators and live previews of web projects.', es: 'Nebulix Code: repositorios con commits, subida de archivos, README, estrellas, forks, colaboradores y vista previa en vivo de proyectos web.' },
      { type: 'new', en: 'Nebulix Studio: a desktop-class code editor (the engine of VS Code) with explorer, tabs, search, source control and a Run button.', es: 'Nebulix Studio: un editor de código de escritorio (el motor de VS Code) con explorador, pestañas, búsqueda, control de código y botón Ejecutar.' },
      { type: 'new', en: 'Nebulix Hub: upload videos (with seeking), browser games and web apps (.html or .zip). Games run sandboxed.', es: 'Nebulix Hub: sube vídeos (con avance y retroceso), juegos de navegador y apps web (.html o .zip). Los juegos se ejecutan aislados.' },
      { type: 'new', en: 'Drive, Docs, Sheets and Slides: cloud storage with folders, sharing and trash; rich documents; spreadsheets with formulas; presentations with a present mode.', es: 'Drive, Docs, Sheets y Slides: almacenamiento en la nube con carpetas, compartir y papelera; documentos con formato; hojas de cálculo con fórmulas; presentaciones con modo presentación.' },
      { type: 'new', en: 'Horse racing in 3D, and 3D animations for every casino game (3D coin, dice, reels, roulette wheel and rocket).', es: 'Carreras de caballos en 3D y animaciones 3D en todos los juegos del casino (moneda, dados, rodillos, ruleta y cohete en 3D).' },
      { type: 'new', en: 'Designs: Glass, Brutalist, Retro terminal, Editorial and Neon change shapes, fonts and depth on top of any theme.', es: 'Diseños: Cristal, Brutalista, Terminal retro, Editorial y Neón cambian formas, fuentes y profundidad sobre cualquier tema.' },
      { type: 'improved', en: 'A new sign-in screen with a 3D background.', es: 'Nueva pantalla de inicio de sesión con fondo 3D.' },
      { type: 'improved', en: 'PRO is unlocked with codes for now; the owner can switch card payments on again from Admin.', es: 'PRO se desbloquea con códigos por ahora; el dueño puede volver a activar los pagos con tarjeta desde Admin.' },
      { type: 'fixed', en: 'Searching in the browser failed because DuckDuckGo does not answer our servers; searches now go through Nebulix Search.', es: 'Buscar en el navegador fallaba porque DuckDuckGo no responde a nuestros servidores; ahora las búsquedas pasan por Nebulix Search.' },
    ],
  },
  {
    v: '5.0', date: '2026-11-18', title: { en: 'The big Nebulix update', es: 'La gran actualización de Nebulix' },
    changes: [
      { type: 'new', en: '3D Casino (optional): walk around a casino hall with your 3D avatar, see who is playing and what, chat with speech bubbles and emotes, and sit at any table to play. RTX mode adds real-time shadows and reflections.', es: 'Casino 3D (opcional): pasea por una sala de casino con tu avatar 3D, mira quién está jugando y a qué, chatea con bocadillos y emotes, y siéntate en cualquier mesa para jugar. El modo RTX añade sombras y reflejos en tiempo real.' },
      { type: 'new', en: 'Your own 3D avatar: hair, eyes, outfits, hats, accessories and auras. It shows on your profile (drag it to turn it) and in the 3D casino.', es: 'Tu propio avatar 3D: pelo, ojos, ropa, sombreros, accesorios y auras. Sale en tu perfil (arrástralo para girarlo) y en el casino 3D.' },
      { type: 'new', en: 'Nebula Ops: a first-person 3D tactical shooter in the Arcade. Rifle and pistol, reloads, headshots, and bot squads that get bigger every round.', es: 'Nebula Ops: un shooter táctico 3D en primera persona en el Arcade. Rifle y pistola, recargas, disparos a la cabeza y escuadrones de bots que crecen cada ronda.' },
      { type: 'new', en: 'Market Rush: an Arcade minigame that pays out in shares of real stocks (AAPL, NVDA, MSFT…).', es: 'Market Rush: un minijuego del Arcade que paga en acciones de empresas reales (AAPL, NVDA, MSFT…).' },
      { type: 'new', en: 'Gems, a second currency: earn them with the daily reward, levels and achievements, or exchange coins. Use them for premium avatar parts and robot or AI staff.', es: 'Gemas, una segunda moneda: se ganan con la recompensa diaria, los niveles y los logros, o cambiando monedas. Sirven para piezas premium del avatar y empleados robot o IA.' },
      { type: 'new', en: 'The Plaza: open a donation booth, donate to other players and pay coins to appear first. Booths also stand in the 3D casino.', es: 'La Plaza: abre un puesto de donaciones, dona a otros jugadores y paga monedas para salir el primero. Los puestos también aparecen en el casino 3D.' },
      { type: 'new', en: 'Player market: sell the cosmetics you own to other players and boost your listing.', es: 'Mercado de jugadores: vende a otros jugadores los cosméticos que tienes y destaca tu anuncio.' },
      { type: 'new', en: 'Staff: hire interns, streamers, programmers, traders, robots and AI assistants who earn coins every hour, even while you are away.', es: 'Empleados: contrata becarios, streamers, programadoras, traders, robots y asistentes IA que ganan monedas cada hora, aunque no estés conectado.' },
      { type: 'new', en: 'Alt accounts: add several accounts and switch between them from the account menu. The browser gets profiles with separate cookies, so you can be signed in to the same website twice.', es: 'Cuentas alt: añade varias cuentas y cambia entre ellas desde el menú de cuenta. El navegador tiene perfiles con cookies separadas, para entrar dos veces en la misma web.' },
      { type: 'new', en: 'YouTube works again inside the Nebulix browser: it opens as Nebulix Tube, with search and YouTube\'s official player.', es: 'YouTube vuelve a funcionar dentro del navegador de Nebulix: se abre como Nebulix Tube, con búsqueda y el reproductor oficial de YouTube.' },
      { type: 'new', en: 'Menu layouts: sidebar left or right, top bar, floating dock or compact icons. Plus 8 swappable app logos that also change the tab icon.', es: 'Distribuciones de menú: barra lateral a la izquierda o a la derecha, barra superior, dock flotante o iconos compactos. Y 8 logos intercambiables que también cambian el icono de la pestaña.' },
      { type: 'new', en: '10 new themes, including four 3D themes with animated WebGL backgrounds: Cosmos, Neon Tunnel, Crystal Cave and Synth City.', es: '10 temas nuevos, entre ellos cuatro temas 3D con fondos animados en WebGL: Cosmos, Túnel neón, Cueva de cristal y Ciudad synth.' },
      { type: 'new', en: 'Nova Brain: Nova knows your coins, gems, level and staff, remembers what you ask it to, does maths, checks stock prices, finds YouTube videos and has personalities (gamer, teacher, pirate…).', es: 'Cerebro de Nova: Nova conoce tus monedas, gemas, nivel y empleados, recuerda lo que le pidas, hace cálculos, mira cotizaciones, busca vídeos de YouTube y tiene personalidades (gamer, profe, pirata…).' },
      { type: 'new', en: 'Casino: crash, plinko, mines, blackjack and a shared jackpot, all provably fair. Arcade: block drop, flap, paddle duel, star defenders, brick breaker and memory.', es: 'Casino: crash, plinko, minas, blackjack y un bote compartido, todos demostrablemente justos. Arcade: bloques, flap, duelo de palas, defensores estelares, rompeladrillos y memoria.' },
      { type: 'new', en: 'Work, Invest (real stock prices, virtual coins), Wallet with transfers, pets, chests, and new missions and achievements.', es: 'Trabajo, Inversiones (precios reales de bolsa, monedas virtuales), Cartera con transferencias, mascotas, cofres, y nuevas misiones y logros.' },
      { type: 'new', en: 'PRO can now be bought with a card (Stripe). Community roles work like Discord: @role mentions, icons, grouped member list, and the new @Donator role.', es: 'PRO ya se puede comprar con tarjeta (Stripe). Los roles de la comunidad funcionan como en Discord: menciones @rol, iconos, lista de miembros agrupada y el nuevo rol @Donador.' },
      { type: 'improved', en: 'Moving between sections no longer fills your browser history: Nebulix appears once, when you open it.', es: 'Moverse entre secciones ya no llena el historial del navegador: Nebulix aparece una sola vez, al abrirlo.' },
      { type: 'improved', en: 'A fresher look: pill tabs, softer cards, gradient titles and thin scrollbars, on every theme.', es: 'Un aspecto más fresco: pestañas tipo píldora, tarjetas más suaves, títulos con degradado y barras de desplazamiento finas, en todos los temas.' },
      { type: 'fixed', en: 'Opening your own profile showed “no user”, and other profiles kept showing “Loading profile…” under the page. Both fixed (the PRO and Extensions pages had the same loader bug).', es: 'Abrir tu propio perfil mostraba «no hay usuario», y en los perfiles de otros se quedaba «Cargando perfil…» debajo de la página. Arreglado (las páginas PRO y Extensiones tenían el mismo fallo).' },
      { type: 'fixed', en: 'Paying for PRO failed for accounts without an email address. Stripe now asks for it on its own page.', es: 'Pagar PRO fallaba en cuentas sin correo. Ahora Stripe lo pide en su propia página.' },
      { type: 'fixed', en: 'Online members in Community, the casino leaderboard and several translations.', es: 'Miembros conectados en Comunidad, la clasificación del casino y varias traducciones.' },
    ],
  },
  {
    v: '4.4', date: '2026-11-11', title: { en: 'Locked down', es: 'A prueba de intrusos' },
    changes: [
      { type: 'new', en: 'Two-step verification: protect your account with a 6-digit code from any authenticator app, plus 8 one-time backup codes.', es: 'Verificación en dos pasos: protege tu cuenta con un código de 6 dígitos de cualquier app autenticadora, más 8 códigos de respaldo de un solo uso.' },
      { type: 'new', en: 'Security check-up in Settings: a score and what to fix (two-step, recovery email, key backup, other devices).', es: 'Revisión de seguridad en Ajustes: una puntuación y qué arreglar (dos pasos, correo de recuperación, copia de la clave, otros dispositivos).' },
      { type: 'new', en: 'Recent sign-ins: see every login and failed attempt on your account, and get an email when a new browser signs in.', es: 'Inicios de sesión recientes: ve cada entrada e intento fallido en tu cuenta, y recibe un correo cuando entra un navegador nuevo.' },
      { type: 'new', en: 'Incognito mode in the browser (Alt+N): its own isolated session with no history, no remembered tabs, and cookies erased when you leave.', es: 'Modo incógnito en el navegador (Alt+N): una sesión aislada sin historial, sin pestañas recordadas y con las cookies borradas al salir.' },
      { type: 'improved', en: 'Your data export no longer includes security internals, and login attempts stay limited even when the password is right.', es: 'La exportación de tus datos ya no incluye datos internos de seguridad, y los intentos de acceso siguen limitados aunque la contraseña sea correcta.' },
    ],
  },
  {
    v: '4.3', date: '2026-11-10', title: { en: 'Polish, phones included', es: 'Pulido, también en el móvil' },
    changes: [
      { type: 'fixed', en: 'Themes: the Apply and Remix buttons on presets did not react to clicks. They work again.', es: 'Temas: los botones Aplicar y Remezclar de los preajustes no respondían al clic. Vuelven a funcionar.' },
      { type: 'fixed', en: 'Community on phones: the member list no longer covers the channels and the chat.', es: 'Comunidad en el móvil: la lista de miembros ya no tapa los canales ni el chat.' },
      { type: 'fixed', en: 'Desktop mode on phones: taskbar apps no longer slide under the coins and the clock.', es: 'Modo escritorio en el móvil: las aplicaciones de la barra de tareas ya no se meten debajo de las monedas y el reloj.' },
      { type: 'new', en: 'Every channel now opens with a welcome header showing its name and topic.', es: 'Cada canal empieza ahora con una cabecera de bienvenida con su nombre y su tema.' },
      { type: 'improved', en: 'Chat details: an accent line on the message you point at, a frosted channel header and smoother member rows.', es: 'Detalles del chat: una línea de color en el mensaje que señalas, cabecera de canal esmerilada y filas de miembros más suaves.' },
      { type: 'fixed', en: 'The Safety tab in Settings is now translated.', es: 'La pestaña Protección de Ajustes ya está traducida.' },
    ],
  },
  {
    v: '4.2', date: '2026-11-10', title: { en: 'A real desktop', es: 'Un escritorio de verdad' },
    changes: [
      { type: 'new', en: 'Desktop mode rebuilt to look like the real thing. Windows 11: centred taskbar, Start with Pinned, All apps and Recommended, 32px title bars with proper caption buttons, system tray and a calendar.', es: 'Modo escritorio reconstruido para parecerse al de verdad. Windows 11: barra de tareas centrada, Inicio con Anclado, Todas las aplicaciones y Recomendado, barras de título de 32 px con sus botones, bandeja del sistema y calendario.' },
      { type: 'new', en: 'An Ubuntu desktop style too: black top bar, dock on the left, the Activities app grid and header bars with round buttons.', es: 'También un estilo de escritorio Ubuntu: barra superior negra, dock a la izquierda, la cuadrícula de Actividades y ventanas con botones redondos.' },
      { type: 'new', en: 'Pin apps to the taskbar or dock, system wallpapers drawn for each style, and solid colour app icons.', es: 'Ancla aplicaciones a la barra de tareas o al dock, fondos del sistema dibujados para cada estilo e iconos de aplicación de color sólido.' },
      { type: 'new', en: 'Emails now come from the Nebulix bot with a button: one click confirms your email or lets you choose a new password (the 6-digit code still works).', es: 'Los correos ahora los envía el bot de Nebulix con un botón: un clic confirma tu correo o te deja elegir una contraseña nueva (el código de 6 dígitos sigue funcionando).' },
      { type: 'fixed', en: 'Themes: button text was hard to read on 20 themes, and light themes showed washed-out success, warning and error colours. Both fixed, including themes you already saved.', es: 'Temas: el texto de los botones se leía mal en 20 temas, y los temas claros mostraban colores de éxito, aviso y error casi invisibles. Corregido, también en los temas que ya tenías guardados.' },
      { type: 'improved', en: 'Better contrast in Solarized Light, Frutiger Aero, Bubblegum, Mint Aero, Sakura, Tokyo Night and Nord; Matrix now has real glyph rain.', es: 'Mejor contraste en Solarized Light, Frutiger Aero, Bubblegum, Mint Aero, Sakura, Tokyo Night y Nord; Matrix ahora tiene lluvia de glifos de verdad.' },
      { type: 'new', en: 'Five new themes: One Dark, GitHub Dark, GitHub Light, Rose Pine and Ubuntu.', es: 'Cinco temas nuevos: One Dark, GitHub Dark, GitHub Light, Rose Pine y Ubuntu.' },
    ],
  },
  {
    v: '4.1', date: '2026-11-10', title: { en: 'Open to the community', es: 'Abierto a la comunidad' },
    changes: [
      { type: 'new', en: 'A cinematic opening animation: the logo draws itself, rings burst out and the app is revealed through an iris.', es: 'Animación de apertura cinematográfica: el logo se dibuja, estallan anillos de luz y la app aparece con un efecto de iris.' },
      { type: 'new', en: 'Email is now optional when you create an account — you are in straight away.', es: 'El correo ahora es opcional al crear la cuenta: entras directamente.' },
      { type: 'new', en: 'Add and confirm an email later to earn 50 coins and the Verified badge (and to be able to recover your password).', es: 'Añade y confirma un correo más tarde para ganar 50 monedas y la insignia de Verificado (y poder recuperar tu contraseña).' },
      { type: 'new', en: 'Nebulix now lives in the cloud at nebulix.fly.dev — always on, with a permanent secure link.', es: 'Nebulix ahora vive en la nube en nebulix.fly.dev: siempre encendido y con un enlace seguro permanente.' },
      { type: 'improved', en: 'The creator\'s wallet is now bottomless (shown as ∞) and no longer appears on the richest leaderboard.', es: 'El monedero del creador ahora no tiene fondo (se muestra como ∞) y ya no aparece en la clasificación de más ricos.' },
    ],
  },
  {
    v: '4.0', date: '2026-11-10', title: { en: 'Aurora — a whole new design', es: 'Aurora: un diseño completamente nuevo' },
    changes: [
      { type: 'new', en: 'Aurora design language across the whole app: a floating glass sidebar, a frosted top bar, and a living aurora glow behind everything that follows your theme colours.', es: 'Lenguaje de diseño Aurora en toda la app: barra lateral flotante de cristal, barra superior esmerilada y un resplandor de aurora vivo de fondo que sigue los colores de tu tema.' },
      { type: 'new', en: 'Cards with luminous gradient edges and a spotlight that follows your cursor.', es: 'Tarjetas con bordes de degradado luminoso y un foco de luz que sigue tu cursor.' },
      { type: 'new', en: 'A new Home hero with drifting light orbs, and a soft light that trails your cursor across the app.', es: 'Nueva cabecera de Inicio con orbes de luz en movimiento, y una luz suave que sigue tu cursor por toda la app.' },
      { type: 'fixed', en: 'The daily wheel now follows your theme colours instantly, and the sign-in tagline no longer shows a stray box.', es: 'La ruleta diaria ahora sigue los colores de tu tema al instante, y el lema del inicio de sesión ya no muestra un recuadro extraño.' },
      { type: 'new', en: 'Scroll-reveal everywhere: sections glide into place as you scroll.', es: 'Revelado al hacer scroll en todas partes: las secciones se deslizan a su sitio según bajas.' },
      { type: 'new', en: '3D tilt on game tiles and theme cards, and ink ripples when you press buttons.', es: 'Inclinación 3D en las fichas de juegos y tarjetas de temas, y ondas de tinta al pulsar botones.' },
      { type: 'improved', en: 'Gradient buttons with glow, animated headings, frosted dialogs and menus, glowing tabs and switches.', es: 'Botones con degradado y brillo, títulos animados, diálogos y menús esmerilados, pestañas e interruptores con resplandor.' },
      { type: 'improved', en: 'A redesigned sign-in screen with a glass card and animated headline.', es: 'Pantalla de inicio de sesión rediseñada, con tarjeta de cristal y titular animado.' },
      { type: 'improved', en: 'Community, Pulse, the browser, Nova and Messages all restyled to match.', es: 'Comunidad, Pulse, el navegador, Nova y Mensajes rediseñados a juego.' },
      { type: 'fixed', en: 'Guided tours now appear in your language (they were stuck in English).', es: 'Los tours guiados ahora salen en tu idioma (antes se quedaban en inglés).' },
      { type: 'fixed', en: 'The What\'s New dialog now highlights the latest features and links to the full changelog.', es: 'El diálogo de Novedades ahora destaca las últimas funciones y enlaza al changelog completo.' },
    ],
  },
  {
    v: '3.5', date: '2026-11-09', title: { en: 'Spectacular redesign', es: 'Rediseño espectacular' },
    changes: [
      { type: 'new', en: 'A What\'s New section — this page — with an animated timeline of every update.', es: 'Un apartado de Novedades — esta página — con una línea de tiempo animada de cada actualización.' },
      { type: 'improved', en: 'Much more powerful animations across the whole app: smoother entrances, richer hovers and motion effects, all respecting Reduce Motion.', es: 'Animaciones mucho más potentes en toda la app: entradas más suaves, hovers más ricos y efectos de movimiento, respetando siempre Reducir movimiento.' },
      { type: 'improved', en: 'A more professional, polished look with new accents, depth and micro-interactions.', es: 'Un aspecto más profesional y pulido con nuevos acentos, profundidad y micro-interacciones.' },
      { type: 'improved', en: 'Redesigned Home dashboard: icon stat cards with numbers that count up, and a glowing search bar.', es: 'Panel de Inicio rediseñado: tarjetas de estadísticas con icono y números que cuentan hacia arriba, y una barra de búsqueda con brillo.' },
      { type: 'improved', en: 'Community chat feels alive: new messages slide in, @mentions flash, reactions pop, and channels respond to hover.', es: 'El chat de Comunidad cobra vida: los mensajes nuevos entran deslizándose, las menciones destellan, las reacciones hacen "pop" y los canales reaccionan al pasar el ratón.' },
      { type: 'new', en: 'Picture-in-picture: pop any proxied video into a floating window.', es: 'Imagen en imagen: saca cualquier vídeo del proxy a una ventana flotante.' },
      { type: 'new', en: 'Media controls for proxied video and audio — speed, skip, mute, play/pause.', es: 'Controles de medios para vídeo y audio del proxy: velocidad, saltar, silenciar, reproducir/pausar.' },
    ],
  },
  {
    v: '3.4', date: '2026-11-09', title: { en: 'Read, translate, focus', es: 'Leer, traducir, concentrarse' },
    changes: [
      { type: 'new', en: 'Reader mode: strip any article down to clean, readable text with themes and font controls.', es: 'Modo lector: deja cualquier artículo en texto limpio y legible, con temas y control de fuente.' },
      { type: 'new', en: 'Read aloud: Reader can read articles to you, highlighting as it goes.', es: 'Lectura en voz alta: el lector te lee los artículos y resalta el párrafo actual.' },
      { type: 'new', en: 'Find in page (Ctrl/Cmd+F) inside the proxy browser.', es: 'Buscar en la página (Ctrl/Cmd+F) dentro del navegador del proxy.' },
      { type: 'new', en: 'Universal dark mode: darken any website, remembered per site.', es: 'Modo oscuro universal: oscurece cualquier web y se recuerda por sitio.' },
      { type: 'new', en: 'Selection toolbar: select text on any page to Translate, Search or Copy it.', es: 'Barra de selección: selecciona texto en cualquier web para Traducir, Buscar o Copiar.' },
      { type: 'new', en: 'Nova conversation history and clickable game recommendations.', es: 'Historial de conversaciones en Nova y recomendaciones de juego clicables.' },
    ],
  },
  {
    v: '3.3', date: '2026-11-09', title: { en: 'Themes & personalisation', es: 'Temas y personalización' },
    changes: [
      { type: 'new', en: 'Live theme preview: hover a preset to re-skin the whole app instantly.', es: 'Vista previa de temas en vivo: pasa el ratón por un tema y toda la app se re-tematiza al instante.' },
      { type: 'new', en: 'Six beloved new themes: Dracula, Nord, Tokyo Night, Gruvbox, Catppuccin and Solarized.', es: 'Seis temas nuevos muy queridos: Dracula, Nord, Tokyo Night, Gruvbox, Catppuccin y Solarized.' },
    ],
  },
  {
    v: '3.2', date: '2026-11-08', title: { en: 'Games & music', es: 'Juegos y música' },
    changes: [
      { type: 'new', en: 'A Games portal: dozens of web games by category, with real logos, search and favourites.', es: 'Un portal de Juegos: decenas de juegos web por categoría, con logos reales, buscador y favoritos.' },
      { type: 'new', en: 'Games now show their real original logos everywhere.', es: 'Los juegos ahora muestran sus logos originales por toda la app.' },
      { type: 'new', en: 'Music streaming from SoundCloud, Spotify and YouTube Music inside Pulse.', es: 'Música en streaming de SoundCloud, Spotify y YouTube Music dentro de Pulse.' },
    ],
  },
  {
    v: '3.0', date: '2026-11-08', title: { en: 'The big revamp', es: 'El gran rediseño' },
    changes: [
      { type: 'new', en: 'A rebuilt, minimalist and professional interface, with a collapsible sidebar and light mode.', es: 'Una interfaz reconstruida, minimalista y profesional, con barra lateral plegable y modo claro.' },
      { type: 'new', en: 'Real AI for Nova — connect Claude or run a free local model.', es: 'IA de verdad para Nova: conecta Claude o usa un modelo local gratis.' },
      { type: 'new', en: 'Voice rooms, voice messages and screen sharing in the community.', es: 'Salas de voz, notas de voz y compartir pantalla en la comunidad.' },
      { type: 'new', en: 'A full translator (19 languages), a panic button and first-run guided tours.', es: 'Un traductor completo (19 idiomas), un botón de pánico y tours guiados la primera vez.' },
      { type: 'new', en: 'A Windows companion app.', es: 'Una app para Windows.' },
    ],
  },
];

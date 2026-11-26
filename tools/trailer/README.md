# Nebulix 3.0 trailer tooling

Produces `public/media/nebulix-3.0-trailer.mp4` (54 s, 1080p30) and its poster.

* `music.py` — the original soundtrack, synthesized with numpy (no samples): `python3 music.py build/music.wav`.
* `cards/cards.html` — title cards and captions (Inter, brand colours). Render each card with headless Chromium at
  1920×1080 with a transparent background (`render({kind, ...})`, then a PNG screenshot) into `cards/<name>.png`.
* `build.py` — the edit: per-shot ffmpeg renders (30 fps, slow push-in, sliding captions, cuts on the 120 BPM bar grid),
  concatenated and muxed with the music. Expects `raw/<scene>.ffconcat` frame lists next to it.

Footage (`raw/`) was captured with CDP `Page.startScreencast` from a **local** copy of the site using test accounts only.
Page-driven scenes ran with the page clock slowed to ¼ (performance.now/Date.now/rAF/timers/CSS animations scaled) and
the frame durations multiplied back, which yields smooth 30 fps from a headless browser that renders ~8 fps at 1080p.
The Game Maker run is a real win found by searching a jump schedule against `gamemaker-runtime.js` in Node and replayed
in the editor through `hooks.onStep`. Android footage needs a KVM compute node; it carries a "Próximamente" badge until
the public site has one.

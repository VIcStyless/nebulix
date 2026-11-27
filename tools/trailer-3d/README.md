# Nebulix 3.0 trailer (English, 3D)

Produces `public/media/nebulix-3.0-trailer-en.mp4` (58 s, 1080p30) — the trailer shown on the site, with Spanish
subtitles in `public/media/nebulix-3.0-trailer.es.vtt`.

1. **Footage** — every scene recorded from a *local* copy of the site with test accounts (interface in English), CDP
   `Page.startScreencast`, page clock slowed to ¼ for smooth 30 fps (see ../trailer/README.md). One folder of JPEG
   frames + an `.ffconcat` timing file per scene.
2. **Frame index** — `python3 scenes.py raw stage/scenes.js` (each scene → `[frame file, seconds]`).
3. **Stage** — `stage.html` is a deterministic timeline: `renderAt(t)` builds the exact frame for time `t` (CSS 3D
   perspective screens with reflections, a ring of screens, a layered 3D logo, Apple-style type). A headless browser
   calls `renderAt(f / 30)` for every frame and saves a screenshot — no real-time capture, so motion is perfectly even.
4. **Music** — `python3 music_en.py music.wav`: original, synthesized with numpy (felt-piano motif, pads, sub bass, soft
   drums; 120 BPM so every cut lands on a bar).
5. **Encode** — `ffmpeg -framerate 30 -i frames/%05d.jpg -i music.wav -c:v libx264 -crf 20 -preset slow -pix_fmt yuv420p
   -movflags +faststart -c:a aac -b:a 192k -shortest nebulix-3.0-trailer-en.mp4`.

Honesty rules used in the copy: Android carries "Coming soon" (needs a KVM server the public site does not have yet),
Windows is "coming soon" for the same reason, the speed claim is the measured best case ("up to 2.7×"), and the casino
is labelled "play money only".

# Nebulix 3.0 trailer ("edit" cut, English, 3D)

Produces `public/media/nebulix-3.0-trailer-edit.mp4` (48 s, 1080p30): a fast, beat-synced edit with Spanish subtitles in
`public/media/nebulix-3.0-trailer-edit.es.vtt`.

1. **Footage**: every scene was recorded from a *local* copy of the site with test accounts (interface in English),
   using CDP `Page.startScreencast` with the page clock slowed to ¼ for smooth 30 fps (see ../trailer/README.md).
   Each scene is one folder of JPEG frames plus an `.ffconcat` timing file.
2. **Frame index**: `python3 scenes.py raw stage/scenes.js` (each scene → `[frame file, seconds]`).
3. **Music**: `python3 music_en.py music.wav stage/hits.js`. It is original and synthesized with numpy only: a 150 BPM
   phonk/trap beat in F# minor (distorted 808 slides, a cowbell lead, hard kick and clap, hi-hat rolls, risers, a beat
   of silence before each drop, impacts). It also writes `hits.js`, the exact time of every kick, snare, roll hit and
   impact.
4. **Stage**: `stage.html` is a deterministic timeline. `renderAt(t)` builds the exact frame for time `t`, and every
   camera punch (kicks), shake (snares and impacts), RGB split and white flash comes from `hits.js`, so the picture hits
   exactly with the drums. It has kinetic word-by-word headlines, whip-pan device shots with a punch-in on the second
   bar, a spinning ring of screens and a rapid-fire montage (one cut per beat, then per 8th note). Strong flashes are
   kept to 3 or fewer a second (photosensitivity). A headless browser calls `renderAt(f / 30)` for every frame and
   saves a screenshot.
5. **Encode**: `ffmpeg -framerate 30 -i frames/%05d.jpg -i music.wav -c:v libx264 -crf 19 -preset slow -pix_fmt yuv420p
   -movflags +faststart -c:a aac -b:a 192k -shortest nebulix-3.0-trailer-edit.mp4`.

Rules for the copy: Android carries "Coming soon" and Windows is "coming soon" (both need a KVM server the public site
does not have yet). The speed claim is the measured best case ("up to 2.7×"), and the casino is "play money only".

## Vertical (TikTok / Reels / Shorts) versions

Both stages have a 9:16 mode: open them with `?v` and render at 1080×1920. Text stays inside the TikTok safe area (below
the top bar, clear of the side buttons and the caption at the bottom). Landscape footage is shown as bigger screens, and
in the edit's rapid montage as a cropped panel over a blurred fill.

- `stage.html?v`: the 48 s edit (music: `music_en.py`).
- `stage-apple.html?v`: the earlier 58 s Apple-style trailer (v16.4), restored with its music (`music_apple.py`).

Encode for TikTok: `ffmpeg -framerate 30 -i frames/%05d.jpg -i music.wav -c:v libx264 -crf 18 -preset slow -profile:v high
-pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 192k -ar 44100 -shortest out.mp4`.

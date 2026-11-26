# Edits the Nebulix 3.0 trailer from the recorded scenes, the title cards and the original soundtrack.
import subprocess, os, sys
T = os.path.dirname(os.path.abspath(__file__)); B = T + '/build'; os.makedirs(B, exist_ok=True)
ENC = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', '30', '-an']
def run(args):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y'] + args, capture_output=True, text=True)
    if r.returncode: print(r.stderr[-1500:]); sys.exit(1)
def zoom(D, z=0.05):  # slow push-in
    return f"scale=w='trunc(1920*(1+{z}*t/{D})/2)*2':h=-2:eval=frame,crop=1920:1080"
def card(name, out, D, fin=0.4, fout=0.4, fin_st=0.0, z=0.06):
    run(['-loop', '1', '-t', str(D), '-i', f'{T}/cards/{name}.png', '-vf',
         f"format=yuv420p,{zoom(D, z)},fade=in:st={fin_st}:d={fin},fade=out:st={D - fout}:d={fout}", '-t', str(D)] + ENC + [out])
def shot(scene, out, start, D, speed=1.0, cap=None, flash=False, dark=None, big=None, z=0.05):
    src = ['-f', 'concat', '-safe', '0', '-i', f'{T}/raw/{scene}.ffconcat']
    v = f"[0]fps=30,trim=start={start}:duration={D * speed},setpts=(PTS-STARTPTS)/{speed},fps=30,format=yuv420p,{zoom(D, z)}"
    if dark: v += f",eq=brightness=-{dark}:saturation=0.8"
    if flash: v += ",fade=in:st=0:d=0.25:color=white"
    v += '[v]'; inputs = src; chain = [v]; last = '[v]'
    for i, (png, kind) in enumerate([(cap, 'cap'), (big, 'big')]):
        if not png: continue
        inputs += ['-loop', '1', '-t', str(D), '-i', f'{T}/cards/{png}.png']; k = len([x for x in inputs if x == '-i']) - 1
        if kind == 'cap':
            chain.append(f"[{k}]format=rgba,fade=in:st=0.15:d=0.3:alpha=1,fade=out:st={D - 0.35}:d=0.3:alpha=1[c{k}]")
            chain.append(f"{last}[c{k}]overlay=x='if(lt(t,0.15),-900,if(lt(t,0.55),-900*pow(1-(t-0.15)/0.4,3),0))':y=0:eval=frame[o{k}]")
        else:
            chain.append(f"[{k}]format=rgba,scale=w='trunc(1920*(1.12-0.12*min(1,t/0.25))/2)*2':h=-2:eval=frame,fade=in:st=0:d=0.15:alpha=1[c{k}]")
            chain.append(f"{last}[c{k}]overlay=x='(W-w)/2':y='(H-h)/2':eval=frame[o{k}]")
        last = f'[o{k}]'
    run(inputs + ['-filter_complex', ';'.join(chain), '-map', last, '-t', str(D)] + ENC + [out])
segs = []
def S(fn, *a, **k):
    out = f'{B}/s{len(segs):02d}.mp4'; fn(a[0], out, *a[1:], **k); segs.append(out); print('built', os.path.basename(out), a[0])
# ---- timeline (120 BPM: one bar = 2 s) ----
S(card, 'logo', 6.0, 1.0, 0.5, 1.2, 0.08)          # 0–6   logo appears on the 2 s hit
S(card, 'tag', 2.0, 0.25, 0.01)                     # 6–8
S(shot, 'home', 0.9, 4.0, cap='c_home', flash=True) # 8–12  drop
S(shot, 'desktop', 0.4, 4.0, cap='c_desktop')
S(shot, 'android', 0.6, 4.0, cap='c_android')
S(shot, 'cloudpc', 5.5, 4.0, cap='c_cloudpc')
S(shot, 'docs', 0.0, 4.0, 1.7, cap='c_docs')
S(shot, 'gamemaker', 1.2, 6.0, 1.05, cap='c_gamemaker')
S(shot, 'arcade', 1.2, 2.0, cap='c_arcade')
S(shot, 'hub', 0.3, 4.0, cap='c_hub')
S(shot, 'devtools', 0.3, 2.0, cap='c_devtools')
M = 4.0 / 6                                          # 42–46 montage, words every 2/3 bar
for i, (sc, st, word) in enumerate([('gamemaker', 4.2, 'b_crea'), ('docs', 5.0, 'b_crea'), ('arcade', 3.0, 'b_juega'), ('android', 3.0, 'b_juega'), ('hub', 2.5, 'b_comparte'), ('desktop', 4.5, 'b_comparte')]):
    S(shot, sc, st, M, dark=0.18, big=word if i % 2 == 0 else None, z=0.03) if i % 2 == 0 else S(shot, sc, st, M, dark=0.18, big=word, z=0.03)
S(card, 'end', 8.0, 0.35, 2.0, 0.0, 0.05)            # 46–54
with open(B + '/list.txt', 'w') as f: f.writelines(f"file '{s}'\n" for s in segs)
run(['-f', 'concat', '-safe', '0', '-i', B + '/list.txt', '-i', B + '/music.wav', '-map', '0:v', '-map', '1:a',
     '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart',
     '-c:a', 'aac', '-b:a', '192k', '-shortest', B + '/nebulix-3.0-trailer.mp4'])
run(['-ss', '47', '-i', B + '/nebulix-3.0-trailer.mp4', '-frames:v', '1', '-q:v', '3', B + '/nebulix-3.0-trailer.jpg'])
print('done')

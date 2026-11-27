# Builds stage/scenes.js: for every recorded scene, the list of [frame file, time in seconds] from its ffconcat.
import os, json, sys
raw = sys.argv[1]; out = {}
for f in sorted(os.listdir(raw)):
    if not f.endswith('.ffconcat'): continue
    t = 0.0; cur = None; lst = []
    for line in open(os.path.join(raw, f)):
        line = line.strip()
        if line.startswith('file '): cur = line[6:-1]
        elif line.startswith('duration ') and cur: lst.append(['file://' + cur, round(t, 4)]); t += float(line.split()[1])
    out[f[:-9]] = lst
open(sys.argv[2], 'w').write('const SC = ' + json.dumps(out) + ';')
print({k: (len(v), round(v[-1][1], 2) if v else 0) for k, v in out.items()})

import json, os, random, sys
import numpy as np
from PIL import Image
import gen
split, n, outdir, seed = sys.argv[1], int(sys.argv[2]), sys.argv[3], int(sys.argv[4])
os.makedirs(outdir, exist_ok=True)
r = random.Random(seed); np.random.seed(seed)
fl = [x for x in gen.fonts if split == 'all' or x['split'] == split]
labels = []
for i in range(n):
    fd = r.choice(fl); text = gen.rnd_line(r)
    a, _, _ = gen.make_line(r, fd, text)
    Image.fromarray(a.astype(np.uint8)).save(f'{outdir}/{i}.png')
    labels.append({'id': i, 'text': text, 'font': fd['family']})
json.dump(labels, open(f'{outdir}/labels.json', 'w'), ensure_ascii=False)
print('done', n)

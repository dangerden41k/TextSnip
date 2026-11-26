import json, random, sys, time
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from glyphfeat import features, line_context, AMBIG

fonts = json.load(open('fonts.json'))
LET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
W_LET = [3 if c in "OIlSBZosz" else 1 for c in LET]
DIG = "0123456789"
W_DIG = [3 if c in "01258" else 1 for c in DIG]

def rnd_word(r):
    n = r.randint(2, 9)
    w = "".join(r.choices(LET, W_LET, k=n))
    t = r.random()
    return w.lower() if t < .4 else w.upper() if t < .7 else w.capitalize()

def rnd_num(r):
    n = r.randint(1, 9)
    s = "".join(r.choices(DIG, W_DIG, k=n))
    if n > 3 and r.random() < .4:
        i = r.randint(1, n - 1); s = s[:i] + r.choice(".,:-/") + s[i:]
    return s

def rnd_code(r):
    n = r.randint(4, 12)
    pool = LET.upper() if r.random() < .7 else LET
    return "".join(r.choice([r.choice(pool), r.choice(DIG)]) if r.random() < .5 else
                   r.choice("O0I1l5S8B2Z") for _ in range(n))

def rnd_line(r):
    t = r.random()
    if t < .28: return " ".join(rnd_word(r) for _ in range(r.randint(1, 3)))
    if t < .52: return " ".join(rnd_num(r) for _ in range(r.randint(1, 3)))
    if t < .82: return rnd_code(r)
    return " ".join(r.choice([rnd_word, rnd_num, rnd_code])(r) for _ in range(r.randint(2, 4)))

def make_line(r, fd, text):
    size = r.randint(11, 36)
    font = ImageFont.truetype(fd['file'], size)
    f = r.choice([2.0, 2.5, 2.5, 3.0])
    gap = r.choice([0, 0, 1])
    pad = 10
    pen = pad; base = pad + int(size * 1.1)
    chars = []
    for ch in text:
        if ch != ' ':
            l, t, rr, b = font.getbbox(ch, anchor='ls')
            chars.append((ch, (pen + l, base + t, pen + rr, base + b)))
        pen += font.getlength(ch) + gap
    Wc, Hc = int(pen + pad), int(base + size * 0.5 + pad)
    im = Image.new('L', (Wc, Hc), 255)
    d = ImageDraw.Draw(im); pen = pad
    for ch in text:
        d.text((pen, base), ch, font=font, fill=0, anchor='ls'); pen += font.getlength(ch) + gap
    im = im.resize((int(Wc * f), int(Hc * f)), Image.LANCZOS)
    if r.random() < .5: im = im.filter(ImageFilter.GaussianBlur(r.uniform(0.2, 0.7)))
    a = np.asarray(im, np.float32)
    if r.random() < .5: a = a + np.random.normal(0, r.uniform(1, 5), a.shape)
    lo, hi = np.percentile(a, 2), np.percentile(a, 98)
    a = np.clip((a - lo) * 255.0 / max(1, hi - lo), 0, 255)
    boxes = []
    for ch, (x0, y0, x1, y1) in chars:
        bx = [int(np.floor(x0 * f)), int(np.floor(y0 * f)), int(np.ceil(x1 * f)), int(np.ceil(y1 * f))]
        boxes.append((ch, bx))
    return a, boxes, base * f

def samples(r, fd, text):
    a, boxes, baseline = make_line(r, fd, text)
    alnum = [(c, b) for c, b in boxes if c.isalnum()]
    if not alnum: return []
    ctx = line_context([b for _, b in alnum], [c for c, _ in alnum])
    out = []
    for c, b in alnum:
        if c not in AMBIG: continue
        b = list(b)
        if r.random() < .5:
            b = [b[0] + r.randint(-1, 1), b[1] + r.randint(-1, 1), b[2] + r.randint(-1, 1), b[3] + r.randint(-1, 1)]
        ft = features(a, b, ctx, baseline + r.uniform(-1, 1))
        if ft is not None: out.append((AMBIG.index(c), ft))
    return out

def run(split, nlines, seed, path):
    r = random.Random(seed); np.random.seed(seed)
    fl = [x for x in fonts if x['split'] in split]
    X, Y, F = [], [], []
    t0 = time.time()
    for i in range(nlines):
        fd = r.choice(fl)
        try:
            for y, x in samples(r, fd, rnd_line(r)):
                X.append(x); Y.append(y); F.append(fd['family'])
        except Exception as e:
            pass
        if i % 1000 == 0: print(split, i, len(X), round(time.time() - t0), 's', flush=True)
    np.savez_compressed(path, X=np.array(X), Y=np.array(Y), F=np.array(F))

if __name__ == '__main__':
    split, n, seed, path = sys.argv[1].split(','), int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    run(split, n, seed, path)

"""Glyph features shared (by spec) with src/glyph.js. Keep both in sync."""
import numpy as np

GW, GH = 12, 16            # shape grid
AMBIG = "0Oo1lI5Ss8B2Zz"
SURE_D = "34679"
_cache = {}

def wmat(L, n):
    key = (L, n)
    if key not in _cache:
        M = np.zeros((n, L), np.float32)
        for k in range(n):
            a, b = k * L / n, (k + 1) * L / n
            for p in range(int(np.floor(a)), int(np.ceil(b))):
                if p >= L: break
                M[k, p] = (min(b, p + 1) - max(a, p)) / (b - a)
        _cache[key] = M
    return _cache[key]

def median(v):
    v = sorted(v); n = len(v)
    return v[n // 2] if n % 2 else 0.5 * (v[n // 2 - 1] + v[n // 2])

def line_context(boxes, chars):
    """boxes: [(x0,y0,x1,y1)], chars: matching text. Returns dict of reference sizes."""
    hs = [b[3] - b[1] for b in boxes]; ws = [b[2] - b[0] for b in boxes]
    refH, refW = median(hs), median(ws)
    dw = [w for w, c in zip(ws, chars) if c in SURE_D]
    dh = [h for h, c in zip(hs, chars) if c in SURE_D]
    return dict(refH=refH, refW=refW,
                dW=median(dw) if dw else refW, dH=median(dh) if dh else refH,
                dflag=1.0 if dw else 0.0)

def clip(v, lo=0.0, hi=4.0):
    return min(hi, max(lo, v))

def features(gray, box, ctx, baseline):
    """gray: 2D float array 0..255 (dark ink on light). box: ints x0,y0,x1,y1 (x1,y1 exclusive)."""
    x0, y0, x1, y1 = box
    H, W = gray.shape
    x0, y0 = max(0, x0), max(0, y0); x1, y1 = min(W, x1), min(H, y1)
    w, h = x1 - x0, y1 - y0
    if w < 1 or h < 1:
        return None
    ink = 1.0 - gray[y0:y1, x0:x1] / 255.0
    shape = wmat(h, GH) @ ink @ wmat(w, GW).T
    sc = [
        clip(w / h), clip(h / ctx["refH"]), clip(w / ctx["refW"]),
        clip(w / ctx["dW"]), clip(h / ctx["dH"]), ctx["dflag"],
        clip((baseline - y0) / ctx["refH"], -1, 3), clip((y1 - baseline) / ctx["refH"], -1, 3),
        float(ink.mean()),
    ]
    return np.concatenate([np.array(sc, np.float32), shape.reshape(-1).astype(np.float32)])

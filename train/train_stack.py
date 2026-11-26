import json, sys, difflib, time
import numpy as np
from sklearn.neural_network import MLPClassifier
AMBIG = "0Oo1lI5Ss8B2Zz"; GROUPS = ["0Oo", "1lI", "5Ss", "8B", "2Zz"]

def aligned(path):
    """yield (x, tess_char, truth_char) for every look-alike glyph that aligns with the ground truth"""
    for ln in open(path):
        r = json.loads(ln)
        t = ''.join(r['text'].split()); syms = r['syms']
        if any(len(s['t']) != 1 for s in syms): continue
        o = ''.join(s['t'] for s in syms)
        sm = difflib.SequenceMatcher(None, t, o, autojunk=False)
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag in ('delete', 'insert') or i2 - i1 != j2 - j1: continue
            for k in range(i2 - i1):
                s = syms[j1 + k]
                if s['x'] is not None: yield s['x'], s['t'], t[i1 + k]

def build(path):
    X, Y, T = [], [], []
    for x, tc, truth in aligned(path):
        X.append(x); T.append(tc); Y.append(AMBIG.index(truth) if truth in AMBIG else -1)
    return np.array(X, np.float32), np.array(Y), np.array(T)

def restricted_pred(P, T):
    out = []
    for p, tc in zip(P, T):
        g = next(g for g in GROUPS if tc in g)
        idx = [AMBIG.index(c) for c in g]
        out.append(AMBIG[idx[int(np.argmax(p[idx]))]])
    return np.array(out)

def report(name, pred, T, Y):
    m = Y >= 0
    truth = np.array([AMBIG[y] for y in Y[m]])
    print(f"{name:10s} accuracy on aligned look-alike glyphs: {(pred[m] == truth).mean():.4f} (n={m.sum()})")
    for g in GROUPS:
        gm = np.array([t in g for t in truth])
        print('    ', g, round(float((pred[m][gm] == truth[gm]).mean()), 4), int(gm.sum()))

if __name__ == '__main__':
    mode, trfile, tefile = sys.argv[1], sys.argv[2], sys.argv[3]
    X, Y, T = build(trfile); print('train samples', len(X))
    keep = Y >= 0
    # only train on glyphs whose truth is in the same group as what Tesseract said
    same = np.array([(y >= 0) and any((AMBIG[y] in g and t in g) for g in GROUPS) for y, t in zip(Y, T)])
    Xt, Yt = X[same], Y[same]
    if mode == 'final':
        X2, Y2, T2 = build(tefile)
        s2 = np.array([(y >= 0) and any((AMBIG[y] in g and t in g) for g in GROUPS) for y, t in zip(Y2, T2)])
        Xt = np.vstack([Xt, X2[s2]]); Yt = np.concatenate([Yt, Y2[s2]])
    mu, sd = Xt.mean(0), Xt.std(0) + 1e-6
    clf = MLPClassifier(hidden_layer_sizes=(192, 96), alpha=1e-3, batch_size=256, max_iter=60, early_stopping=True,
                        n_iter_no_change=8, random_state=0)
    t0 = time.time(); clf.fit((Xt - mu) / sd, Yt); print('trained', round(time.time() - t0), 's iters', clf.n_iter_, 'on', len(Xt))
    if mode == 'eval':
        Xe, Ye, Te = build(tefile)
        P = clf.predict_proba((Xe - mu) / sd)
        report('raw', Te, Te, Ye)
        report('stacked', restricted_pred(P, Te), Te, Ye)
        # confidence-gated override: only change Tesseract when the model is clearly sure
        for thr in (0.6, 0.75, 0.9):
            pred = Te.copy(); ch = restricted_pred(P, Te)
            for i, (p, tc, c) in enumerate(zip(P, Te, ch)):
                if c != tc and p[AMBIG.index(c)] / max(1e-9, sum(p[[AMBIG.index(k) for k in next(g for g in GROUPS if tc in g)]])) >= thr: pred[i] = c
            report(f'gate{thr}', pred, Te, Ye)
    json.dump({'classes': AMBIG, 'groups': GROUPS, 'mean': mu.tolist(), 'std': sd.tolist(),
               'W': [w.tolist() for w in clf.coefs_], 'b': [b.tolist() for b in clf.intercepts_]},
              open(f'/tmp/glyph_stack_{mode}.json', 'w'), separators=(',', ':'))
    print('saved')

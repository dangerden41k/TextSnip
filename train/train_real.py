import json, sys, difflib, time
import numpy as np
from sklearn.neural_network import MLPClassifier
from train_stack import build, AMBIG
CODE_GROUPS = ["0O", "1I", "5S", "8B", "2Z"]
REPEAT = int(sys.argv[2]) if len(sys.argv) > 2 else 3

def real_samples(path):
    out = {}
    for ln in open(path):
        r = json.loads(ln)
        t = ''.join(r['text'].split()); syms = r['syms']
        if any(len(s['t']) != 1 for s in syms): continue
        o = ''.join(s['t'] for s in syms)
        sm = difflib.SequenceMatcher(None, t, o, autojunk=False)
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag in ('delete', 'insert') or i2 - i1 != j2 - j1: continue
            for k in range(i2 - i1):
                s = syms[j1 + k]; tr = t[i1 + k]
                if s['x'] is None: continue
                if any(tr in g and s['t'] in g for g in CODE_GROUPS):
                    out.setdefault(r['font'], []).append((s['x'], s['t'], AMBIG.index(tr)))
    return out

def fit(X, Y):
    mu, sd = X.mean(0), X.std(0) + 1e-6
    clf = MLPClassifier(hidden_layer_sizes=(192, 96), alpha=1e-3, batch_size=256, max_iter=50, early_stopping=True,
                        n_iter_no_change=6, random_state=0)
    clf.fit((X - mu) / sd, Y); return clf, mu, sd

def predict(clf, mu, sd, X, T):
    P0 = clf.predict_proba((X - mu) / sd); out = []
    P = np.zeros((len(P0), len(AMBIG)))
    for j, c in enumerate(clf.classes_): P[:, int(c)] = P0[:, j]
    for p, tc in zip(P, T):
        g = next(g for g in CODE_GROUPS if tc in g); idx = [AMBIG.index(c) for c in g]
        out.append(AMBIG[idx[int(np.argmax(p[idx]))]])
    return np.array(out)

if __name__ == '__main__':
    mode = sys.argv[1]
    Xs, Ys, Ts = build('/tmp/dump_train2.jsonl')
    ok = np.array([(y >= 0) and any(AMBIG[y] in g and t in g for g in CODE_GROUPS) for y, t in zip(Ys, Ts)])
    Xs, Ys = Xs[ok], Ys[ok]
    real = real_samples('/tmp/dump_real.jsonl'); print('real samples per image', {k: len(v) for k, v in real.items()})
    def stack(keys):
        X = np.array([s[0] for k in keys for s in real[k]], np.float32); Y = np.array([s[2] for k in keys for s in real[k]])
        return X, Y
    if mode == 'cv':
        tot_raw = tot_syn = tot_new = n = 0
        clf0, mu0, sd0 = fit(Xs, Ys)
        for hold in real:
            keys = [k for k in real if k != hold]
            Xr, Yr = stack(keys)
            clf, mu, sd = fit(np.vstack([Xs] + [Xr] * REPEAT), np.concatenate([Ys] + [Yr] * REPEAT))
            Xh = np.array([s[0] for s in real[hold]], np.float32); Th = np.array([s[1] for s in real[hold]]); Yh = np.array([AMBIG[s[2]] for s in real[hold]])
            a_raw = (Th == Yh).mean(); a_syn = (predict(clf0, mu0, sd0, Xh, Th) == Yh).mean(); a_new = (predict(clf, mu, sd, Xh, Th) == Yh).mean()
            print(f'held-out image {hold}: Tesseract {a_raw:.3f} | synthetic-only model {a_syn:.3f} | + real data (other images) {a_new:.3f}  (n={len(Yh)})')
            tot_raw += a_raw * len(Yh); tot_syn += a_syn * len(Yh); tot_new += a_new * len(Yh); n += len(Yh)
        print(f'OVERALL Tesseract {tot_raw/n:.4f} | synthetic {tot_syn/n:.4f} | +real {tot_new/n:.4f}')
    else:
        Xr, Yr = stack(list(real))
        X = np.vstack([Xs] + [Xr] * REPEAT); Y = np.concatenate([Ys] + [Yr] * REPEAT)
        clf, mu, sd = fit(X, Y)
        # the output layer only has the classes seen in training: expand it to all 14 (unseen = impossible)
        Wl, bl = clf.coefs_[-1], clf.intercepts_[-1]
        W14 = np.zeros((Wl.shape[0], len(AMBIG))); b14 = np.full(len(AMBIG), -30.0)
        for j, c in enumerate(clf.classes_): W14[:, int(c)] = Wl[:, j]; b14[int(c)] = bl[j]
        Ws = [w.tolist() for w in clf.coefs_[:-1]] + [W14.tolist()]; bs = [b.tolist() for b in clf.intercepts_[:-1]] + [b14.tolist()]
        json.dump({'classes': AMBIG, 'groups': ["0Oo", "1lI", "5Ss", "8B", "2Zz"], 'mean': mu.tolist(), 'std': sd.tolist(),
                   'W': Ws, 'b': bs},
                  open('/tmp/glyph_real_final.json', 'w'), separators=(',', ':'))
        print('saved final', len(X))

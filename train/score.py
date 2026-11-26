import json, sys, difflib, collections
AMBIG = "0Oo1lI5Ss8B2Zz"
GROUPS = ["0Oo", "1lI", "5Ss", "8B", "2Zz"]
res = json.load(open(sys.argv[1] + '/results.json'))
keys = ['raw', 'refined', 'refined_m']
stat = {k: collections.Counter() for k in keys}
perg = {k: collections.defaultdict(lambda: [0, 0]) for k in keys}
unal = 0
for r in res:
    t = ''.join(r['text'].split())
    for k in keys:
        o = ''.join(r[k].split())
        sm = difflib.SequenceMatcher(None, t, o, autojunk=False)
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if i2 - i1 != j2 - j1 or tag == 'delete' or tag == 'insert': 
                # chars dropped/added by OCR: count ambiguous truth chars there as OCR misses
                for c in t[i1:i2]:
                    if c in AMBIG:
                        stat[k]['missed'] += 1
                continue
            for a, b in zip(t[i1:i2], o[j1:j2]):
                if a in AMBIG:
                    g = next(g for g in GROUPS if a in g)
                    perg[k][g][1] += 1
                    ok = (a == b)
                    perg[k][g][0] += ok
                    stat[k]['ok'] += ok; stat[k]['n'] += 1
                    if not ok and b in g: stat[k]['confused_in_group'] += 1
for k in keys:
    s = stat[k]
    print(f"{k:10s} exact-char accuracy on aligned look-alike glyphs: {s['ok']/s['n']:.4f}  (n={s['n']}, missed/dropped={s['missed']})")
    print('   ', {g: round(v[0] / max(1, v[1]), 3) for g, v in perg[k].items()})

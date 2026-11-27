"""Build Tessera's anatomy atlas from BodyParts3D 4.0 (CC BY 4.0, (c) Database Center for Life Science).

Usage: python3 -I build_anatomy.py <bp3d dir> <out dir> [ratio]
  <bp3d dir> holds, from https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/ :
    isa_BP3D_4.0_obj_99/ (unzipped isa_BP3D_4.0_obj_99.zip), raw/isa_parts_list_e.txt,
    raw/isa_element_parts.txt, raw/isa_inclusion_relation_list.txt
  A survey (names + FMA is-a ancestors per mesh) is written to survey2.json on the first run.
Every one of the 2,234 meshes is kept. Large meshes are simplified by vertex clustering to about
`ratio` of their triangles; small ones (thin vessels, nerves, cartilage) keep their detail.
Output: atlas.json + anatomy-N.bin chunks (int16 positions, int8 normals, uint16 per-part indices).
"""
import json, os, re, sys
import numpy as np

SRC, OUT = sys.argv[1], sys.argv[2]
RATIO = float(sys.argv[3]) if len(sys.argv) > 3 else 0.2
FLOOR = 400            # meshes at or below this many triangles are kept as is
CHUNK_BYTES = 3_500_000

# Layer rules: first match wins, tested against "name | ancestors".
LAYERS = [
    ('cartilage', 'Cartilage', r'cartilage|intervertebral dis[ck]|meniscus|articular disc|epiglottis|pubic symphysis'),
    ('ligament', 'Ligaments & tendons', r'ligament|tendon|aponeuros|fascia|retinacul|tendinous|falx|tentorium|membrane of'),
    ('artery', 'Arteries', r'arter|aorta|arterial|truncus|coronary sinus? artery'),
    ('vein', 'Veins', r'\bvein|venous|vena cava|sinus of dura|dural venous|venae'),
    ('heart', 'Heart', r'\bheart\b|cardiac chamber|atrium|ventricle of heart|left ventricle|right ventricle|myocard|valve|papillary muscle|chorda|cardiac'),
    ('cns', 'Brain & spinal cord', r'neuraxis|brain|cerebr|cerebell|gyrus|sulcus|lobe of cerebral|thalam|hippocamp|pons|medulla oblongata|midbrain|spinal cord|corpus callosum|basal nuclei|nucleus|ventricle of brain|lateral ventricle|insula|caudate|putamen|globus|amygdala|cortex'),
    ('nerve', 'Nerves', r'nerve|neural tree|ganglion|plexus|cauda equina|chiasm|optic tract'),
    ('bone', 'Bones', r'bone|vertebra|\brib\b|sternum|skull|cranium|mandible|maxilla|phalanx|tooth|teeth|patella|clavicle|scapula|femur|tibia|fibula|humerus|radius|ulna|pelvis|sacrum|coccyx|hyoid|carpal|tarsal|calcaneus|talus|ossicle|malleus|incus|stapes|gingiva'),
    ('muscle', 'Muscles', r'muscle|musculature|muscul|diaphragm'),
    ('resp', 'Lungs & airway', r'lung|bronch|trache|laryn|pleura|pulmonary segment|alveol|nasal|pharyn'),
    ('gi', 'Digestive', r'liver|hepat|stomach|gastr|intestin|duoden|jejun|ileum|ileal|colon|cecum|caecum|rectum|anal|esophag|oesophag|gall|biliary|bile|tongue|oral cavity|salivary|sublingual|palate|parotid|submandibular gland|appendix|mesent|omentum|pancrea|peritone|digestive'),
    ('endocrine', 'Endocrine', r'thyroid gland|parathyroid|suprarenal|adrenal|pituitary|hypophysis|pineal'),
    ('urinary', 'Kidneys & urinary', r'kidney|renal|ureter|urinary bladder|urethra|nephr'),
    ('sensory', 'Eye & ear', r'eye|ocular|orbit|retina|lens|cornea|sclera|lacrimal|\bear\b|cochlea|labyrinth|tympan|vestibul|semicircular|auricle'),
    ('lymph', 'Lymphatic & immune', r'lymph|spleen|splenic|thymus|tonsil'),
    ('skin', 'Skin', r'\bskin\b|integument|surface of body'),
    ('repro', 'Reproductive', r'prostat|testis|testic|penis|scrot|seminal|ductus deferens|spermatic|epididym|ovary|uter|vagin|clitor'),
]

ANC_FIRST = [  # FMA type in the is-a ancestry beats any word in the name
    ('cartilage', {'cartilage organ', 'intervertebral disk'}),
    ('muscle', {'muscle organ', 'musculature', 'head of muscle organ', 'zone of muscle organ', 'set of muscles'}),
    ('bone', {'bone organ', 'tooth', 'long bone', 'short bone', 'flat bone', 'irregular bone'}),
    ('artery', {'artery', 'segment of arterial tree organ'}),
    ('vein', {'vein', 'segment of venous tree organ'}),
    ('cns', {'segment of neuraxis', 'cell part cluster of neuraxis', 'segment of brain'}),
    ('nerve', {'segment of neural tree organ', 'nerve'}),
]
EXTRA = {'vitreous body': 'sensory', 'linea alba': 'ligament', 'raphe': 'ligament', 'conus elasticus': 'ligament',
         'trapezius': 'muscle', 'deferent duct': 'repro', 'xiphoid': 'bone', 'lip': 'gi', 'gingiva': 'gi', 'tarsal plate': 'ligament', 'iliotibial': 'ligament', 'membrane': 'ligament', 'lacrimal canaliculus': 'sensory', 'ileocecal': 'gi', 'foramen': 'cns', 'fossa': 'cns'}

def classify(name, anc):
    A = set(anc)
    for key, s in ANC_FIRST:
        if A & s:
            return key
    n = name.lower()
    for k, v in EXTRA.items():
        if k in n:
            return v
    text = (n + ' | ' + ' | '.join(anc)).lower()
    for src in (n, text):
        for key, _, rx in LAYERS:
            if re.search(rx, src):
                return key
    return 'other'

def read_obj(path):
    vs, fs = [], []
    with open(path) as f:
        for line in f:
            if line.startswith('v '):
                vs.append(line[2:].split())
            elif line.startswith('f '):
                idx = [int(t.split('/')[0]) - 1 for t in line[2:].split()]
                for k in range(1, len(idx) - 1):
                    fs.append((idx[0], idx[k], idx[k + 1]))
    return np.array(vs, dtype=np.float64), np.array(fs, dtype=np.int64)

def cluster(V, F, cell):
    q = np.floor(V / cell).astype(np.int64)
    keys, inv = np.unique(q, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    cnt = np.bincount(inv)
    NV = np.zeros((len(keys), 3))
    for d in range(3):
        NV[:, d] = np.bincount(inv, weights=V[:, d]) / cnt
    NF = inv[F]
    ok = (NF[:, 0] != NF[:, 1]) & (NF[:, 1] != NF[:, 2]) & (NF[:, 0] != NF[:, 2])
    NF = NF[ok]
    if len(NF):
        s = np.sort(NF, axis=1)
        _, first = np.unique(s, axis=0, return_index=True)
        NF = NF[np.sort(first)]
    used = np.unique(NF)
    remap = -np.ones(len(NV), dtype=np.int64); remap[used] = np.arange(len(used))
    return NV[used], remap[NF]

def simplify(V, F, target):
    if len(F) <= target:
        return V, F
    ext = V.max(0) - V.min(0)
    lo, hi = 1e-3, float(ext.max())
    best = (V, F)
    for _ in range(18):
        mid = (lo * hi) ** 0.5
        NV, NF = cluster(V, F, mid)
        if len(NF) > target:
            lo = mid
        else:
            hi = mid; best = (NV, NF)
        if hi / lo < 1.04:
            break
    if len(best[1]) < 0.25 * target:   # clustering collapsed a thin shape; keep the finer result
        NV, NF = cluster(V, F, lo)
        if len(NF) >= 4: best = (NV, NF)
    return best

def normals(V, F):
    n = np.zeros_like(V)
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    for k in range(3):
        np.add.at(n, F[:, k], fn)
    l = np.linalg.norm(n, axis=1, keepdims=True); l[l == 0] = 1
    return n / l


def survey(src):
    """Read each OBJ header and the FMA is-a lists; cache names and ancestors to survey2.json."""
    import collections
    path = os.path.join(src, 'survey2.json')
    if os.path.exists(path):
        return json.load(open(path))
    d = os.path.join(src, 'isa_BP3D_4.0_obj_99'); raw = os.path.join(src, 'raw')
    par = collections.defaultdict(set); nm = {}; elem = collections.defaultdict(set)
    for i, line in enumerate(open(os.path.join(raw, 'isa_inclusion_relation_list.txt'))):
        p = line.rstrip('\n').split('\t')
        if i and len(p) >= 4: par[p[2]].add(p[0]); nm[p[0]] = p[1]; nm[p[2]] = p[3]
    for i, line in enumerate(open(os.path.join(raw, 'isa_element_parts.txt'))):
        p = line.rstrip('\n').split('\t')
        if i and len(p) >= 3: elem[p[2]].add(p[0]); nm.setdefault(p[0], p[1])
    for i, line in enumerate(open(os.path.join(raw, 'isa_parts_list_e.txt'))):
        p = line.rstrip('\n').split('\t')
        if i and len(p) >= 3: nm.setdefault(p[0], p[2])
    def anc(c, seen):
        for q in par.get(c, ()):
            if q not in seen: seen.add(q); anc(q, seen)
        return seen
    rows = []
    for fn in sorted(os.listdir(d)):
        h = {}
        with open(os.path.join(d, fn)) as f:
            for line in f:
                if not line.startswith('#'): break
                m = re.match(r'# (.+?) : (.*)', line.strip())
                if m: h[m.group(1)] = m.group(2)
        fj = fn[:-4]; fma = h.get('Concept ID')
        cs = ({fma} if fma else set()) | elem.get(fj, set())
        A = set()
        for c in cs: A |= anc(c, set()) | {c}
        name = h.get('English name') or (min((nm.get(c, c) for c in cs), key=len) if cs else fj)
        rows.append({'fj': fj, 'fma': fma, 'name': name, 'vol': float(h.get('Volume(cm3)') or 0), 'anc': sorted(nm.get(a, a) for a in A)})
    json.dump(rows, open(path, 'w'))
    return rows

def main():
    rows = survey(SRC)
    d = os.path.join(SRC, 'isa_BP3D_4.0_obj_99')
    meshes = []
    gmin, gmax = np.full(3, 1e9), np.full(3, -1e9)
    total_in = total_out = 0
    for i, r in enumerate(rows):
        V, F = read_obj(os.path.join(d, r['fj'] + '.obj'))
        if not len(F):
            continue
        target = max(min(len(F), FLOOR), int(len(F) * RATIO))
        V2, F2 = simplify(V, F, target)
        if len(V2) > 65535:
            V2, F2 = simplify(V, F, min(target, 120000) // 2)
        total_in += len(F); total_out += len(F2)
        gmin = np.minimum(gmin, V2.min(0)); gmax = np.maximum(gmax, V2.max(0))
        meshes.append((r, V2, F2, normals(V2, F2)))
        if i % 200 == 0:
            print(i, r['fj'], r['name'], len(F), '->', len(F2), flush=True)
    print('triangles', total_in, '->', total_out)
    span = gmax - gmin
    scale = span / 65534.0
    os.makedirs(OUT, exist_ok=True)
    parts, chunks = [], []
    buf, cur = [], 0
    def flush():
        nonlocal buf, cur
        if not buf: return
        name = f'anatomy-{len(chunks)}.bin'
        with open(os.path.join(OUT, name), 'wb') as f:
            for b in buf: f.write(b)
        chunks.append({'url': name, 'bytes': cur})
        buf, cur = [], 0
    layer_count = {}
    for r, V, F, N in meshes:
        P = np.round((V - gmin) / scale - 32767).astype(np.int16)
        Nq = np.zeros((len(N), 4), dtype=np.int8); Nq[:, :3] = np.round(N * 127).astype(np.int8)
        I = F.astype(np.uint16).reshape(-1)
        pb, nb, ib = P.tobytes(), Nq.tobytes(), I.tobytes()
        pad = (-len(ib)) % 4
        size = len(pb) + len(nb) + len(ib) + pad
        if cur + size > CHUNK_BYTES:
            flush()
        off = cur
        buf += [pb, nb, ib, b'\0' * pad]; cur += size
        layer = classify(r['name'] or '', r['anc'])
        layer_count[layer] = layer_count.get(layer, 0) + 1
        b0, b1 = V.min(0), V.max(0)
        parts.append({'id': r['fj'], 'fma': r['fma'], 'name': r['name'], 'layer': layer, 'vol': r['vol'],
                      'c': len(chunks), 'p': off, 'n': off + len(pb), 'i': off + len(pb) + len(nb),
                      'vc': len(V), 'ic': len(I),
                      'b': [[round(x, 1) for x in b0], [round(x, 1) for x in b1]]})
    flush()
    atlas = {
        'version': 'tessera-anatomy-1', 'source': 'BodyParts3D 4.0 (is-a tree)',
        'attribution': 'BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International',
        'license': 'https://creativecommons.org/licenses/by/4.0/', 'units': 'mm',
        'axes': '+x patient left, -y anterior, +z superior',
        'min': [round(x, 3) for x in gmin], 'scale': [float(x) for x in scale],
        'triangles': int(total_out), 'sourceTriangles': int(total_in),
        'layers': [{'id': k, 'name': n, 'count': layer_count.get(k, 0)} for k, n, _ in LAYERS] + ([{'id': 'other', 'name': 'Other tissue', 'count': layer_count['other']}] if layer_count.get('other') else []),
        'chunks': chunks, 'parts': parts,
    }
    with open(os.path.join(OUT, 'atlas.json'), 'w') as f:
        json.dump(atlas, f, separators=(',', ':'))
    print('layers', layer_count)
    print('chunks', len(chunks), 'bytes', sum(c['bytes'] for c in chunks))

if __name__ == '__main__':
    main()

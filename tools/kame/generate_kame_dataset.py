#!/usr/bin/env python3
"""亀の甲データセット生成スクリプト（標準ライブラリのみ）。

パラメータ（params_50hz.json / params_60hz.json）から、亀の甲の各枠の頂点 (Q, H) を計算し、
src/data/kame/kame_XXhz.json を出力する。

使い方:
    python3 tools/kame/generate_kame_dataset.py            # 50Hz・60Hz とも生成
    python3 tools/kame/generate_kame_dataset.py 50         # 50Hz のみ
    python3 tools/kame/generate_kame_dataset.py --check    # 出力済みのJSONと再生成結果の差を確認

モデルの考え方（図4.3-8/9 の再現）:
  * 亀の甲は、上下が水平、左右が一定の傾き（Q ∝ √H）の平行四辺形。傾きを戻す変換
    u = x + y/S をかけると、すべての枠が長方形になり、1列の幅が一定（P）の格子に並ぶ。
  * 列の位置は (n_s シリーズ, D2) で決まる（columns）。
  * 縦の位置は、枠の中心 H = (N·D2/n11)^2 で決まる（n11 は回転速度ごとの値）。
  * 同じ列で隣り合う枠は、中心の中点を境界にする（離れている場合は中心から ±half）。
"""
import json, math, os, sys, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'src', 'data', 'kame')
ACCURACY = {
    50: "1000 r/min の枠は図とよく重なる（辺との差は中央値で約0.6%）。750 r/min 以下の枠は、位置が数%ずれる可能性がある。"
        "存在する枠の一覧は、表4.3-5 のOCR結果と図の読み取りに基づく暫定で、全数は確認していない。",
    60: "1200・900 r/min の枠は図とよく重なる。720・600 r/min の枠は、図のラベルとずれて見える箇所がある。"
        "列 c1 に図で読み取れた『H400』のもう1枠は、位置の規則に合わないため含めていない。存在する枠の一覧は暫定。",
}

def load(f):
    with open(os.path.join(HERE, f'params_{f}hz.json'), encoding='utf-8') as fh:
        return json.load(fh)

def blocks_for(p):
    cy, cx = p['calibration']['cy'], p['calibration']['cx']
    x0, y0 = p['calibration']['x0'], p['calibration']['y0']
    S, P, U0 = p['shear']['S'], p['lattice']['P'], p['lattice']['U0']
    half, maxgap = p['tiling']['half'], p['tiling']['maxgap']
    n11 = {int(k): v for k, v in p['n11'].items()}
    rpm_val = {int(k): v for k, v in p.get('rpmValue', {}).items()}
    cols = p['columns']
    bl = []
    for N_s, labs in p['frames'].items():
        N = int(N_s)
        for lab in labs:
            s, D = lab[0], int(lab[1:])
            k = cols[s][str(D)]
            Hc = ((rpm_val.get(N, N)) * D / 1000.0 / n11[N]) ** 2
            vc = cy[0] * math.log10(Hc) + cy[1] - y0
            bl.append(dict(label=lab, rpm=N, k=k, vc=vc))
    byk = {}
    for b in bl: byk.setdefault(b['k'], []).append(b)
    for lst in byk.values():
        lst.sort(key=lambda b: b['vc'])
        for i, b in enumerate(lst):
            up = dn = half
            if i > 0 and b['vc'] - lst[i-1]['vc'] < maxgap: up = (b['vc'] - lst[i-1]['vc']) / 2
            if i < len(lst) - 1 and lst[i+1]['vc'] - b['vc'] < maxgap: dn = (lst[i+1]['vc'] - b['vc']) / 2
            b['vt'], b['vb'] = b['vc'] - up, b['vc'] + dn
    out = []
    for b in bl:
        ul = U0 + P * b['k']; ur = ul + P
        verts = []
        for (u, v) in ((ul, b['vt']), (ur, b['vt']), (ur, b['vb']), (ul, b['vb'])):
            xi = (u - v / S) + x0; yi = v + y0
            Q = 10 ** ((xi - cx[1]) / cx[0]); H = 10 ** ((yi - cy[1]) / cy[0])
            verts.append({"q": round(Q, 4), "h": round(H, 3)})
        out.append({"id": f"{b['label']}@{b['rpm']}", "label": b['label'], "series": b['label'][0],
                    "d2mm": int(b['label'][1:]), "rpm": b['rpm'], "vertices": verts})
    order = sorted(out, key=lambda b: (-b['rpm'], b['label']))
    return order

def dataset(f):
    p = load(f)
    return {
        "schemaVersion": 1,
        "id": f"kame-{f}hz",
        "frequency": f,
        "title": f"フランシス水車選定図（{f}Hz）",
        "source": p['source'],
        "version": "0.1.0-draft",
        "status": "draft",
        "createdAt": datetime.date.today().isoformat(),
        "method": "図から画像処理で格子と回転速度ごとの n11 を当てはめ、パラメータから各枠の頂点を計算（tools/kame/generate_kame_dataset.py）",
        "accuracy": ACCURACY[f],
        "axes": {"q": {"min": 0.4, "max": 3.0, "scale": "log", "unit": "m3/s"},
                 "h": {"min": 10, "max": 100, "scale": "log", "unit": "m"}},
        "parameters": {"n11": p['n11'], "lattice": p['lattice'], "shearS": p['shear']['S'], "tiling": p['tiling']},
        "blocks": dataset_blocks(p),
    }
def dataset_blocks(p): return blocks_for(p)

def main(argv):
    check = '--check' in argv
    freqs = [int(a) for a in argv if a.isdigit()] or [50, 60]
    os.makedirs(OUT, exist_ok=True)
    rc = 0
    for f in freqs:
        ds = dataset(f); path = os.path.join(OUT, f'kame_{f}hz.json')
        if check:
            with open(path, encoding='utf-8') as fh: cur = json.load(fh)
            a = {b['id']: b for b in cur['blocks']}; mx = 0; miss = 0
            for b in ds['blocks']:
                c = a.get(b['id'])
                if not c: miss += 1; continue
                for v1, v2 in zip(b['vertices'], c['vertices']):
                    mx = max(mx, abs(math.log10(v1['q'] / v2['q'])), abs(math.log10(v1['h'] / v2['h'])))
            extra = len(set(a) - {b['id'] for b in ds['blocks']})
            print(f"{f}Hz: 再生成 {len(ds['blocks'])}枠 / 既存 {len(a)}枠、欠け{miss}、余り{extra}、最大差 {10**mx*100-100:.3f}%")
            rc |= (miss or extra or mx > 0.002)
        else:
            with open(path, 'w', encoding='utf-8') as fh: json.dump(ds, fh, ensure_ascii=False, indent=1)
            print(f"{path}: {len(ds['blocks'])}枠")
    return rc

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))

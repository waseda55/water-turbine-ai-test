// 亀の甲（水車選定図）データの読み込みと判定。
// データ本体は src/data/kame/kame_{50,60}hz.json（出典・版・精度の情報つき）。
// 枠の定義を変えたいときは、JSON を差し替えるか、tools/kame の生成スクリプトを使う。
import ds50 from '@/data/kame/kame_50hz.json'
import ds60 from '@/data/kame/kame_60hz.json'

// ---- データセット（JSON）の形 ----
export interface KameVertex { q: number; h: number }
export interface KameDatasetBlock {
  id: string; label: string; series: string; d2mm: number; rpm: number
  /** 4頂点。順は 上左・上右・下右・下左（時計回り）。上下は水平、左右は一定の傾き */
  vertices: KameVertex[]
}
export interface KameDataset {
  schemaVersion: number
  id: string
  frequency: 50 | 60
  title: string
  source: { document: string; figure: string; page: number; table?: string }
  version: string
  status: 'draft' | 'reviewed' | 'standard'
  createdAt: string
  method: string
  accuracy: string
  axes: { q: { min: number; max: number }; h: { min: number; max: number } }
  blocks: KameDatasetBlock[]
}

// ---- 実行時に使う形（対数座標） ----
export interface KameBlock { label: string; rpm: number; poly: [number, number][] }

export function toKameBlocks(ds: KameDataset): KameBlock[] {
  return ds.blocks.map(b => ({
    label: b.label, rpm: b.rpm,
    poly: b.vertices.map(v => [Math.log10(v.q), Math.log10(v.h)] as [number, number]),
  }))
}

/** データセットの形式を検査し、問題の一覧を返す（空なら問題なし） */
export function validateKameDataset(ds: KameDataset): string[] {
  const errs: string[] = []
  if (ds.schemaVersion !== 1) errs.push(`schemaVersion が未対応: ${ds.schemaVersion}`)
  const seen = new Set<string>()
  for (const b of ds.blocks) {
    if (seen.has(b.id)) errs.push(`id が重複: ${b.id}`)
    seen.add(b.id)
    if (b.id !== `${b.label}@${b.rpm}`) errs.push(`id が label@rpm と不一致: ${b.id}`)
    if (!/^[A-Z]\d{3}$/.test(b.label)) errs.push(`label の形式が不正: ${b.label}`)
    if (b.vertices.length !== 4) { errs.push(`${b.id}: 頂点が4つでない`); continue }
    if (!b.vertices.every(v => Number.isFinite(v.q) && Number.isFinite(v.h) && v.q > 0 && v.h > 0)) errs.push(`${b.id}: 頂点の値が不正`)
    const p = b.vertices.map(v => [Math.log10(v.q), Math.log10(v.h)])
    const area = Math.abs(p.reduce((s, [x, y], i) => { const [x2, y2] = p[(i + 1) % 4]; return s + (x * y2 - x2 * y) }, 0)) / 2
    if (!(area > 1e-4)) errs.push(`${b.id}: 面積が小さすぎる`)
  }
  return errs
}

export const KAME_DATASETS: Record<50 | 60, KameDataset> = {
  50: ds50 as unknown as KameDataset,
  60: ds60 as unknown as KameDataset,
}
export const getKameDataset = (frequency: 50 | 60): KameDataset => KAME_DATASETS[frequency]

if (process.env.NODE_ENV !== 'production') {
  for (const f of [50, 60] as const) {
    const e = validateKameDataset(KAME_DATASETS[f])
    if (e.length) console.warn(`[kameNoKou] ${f}Hz のデータに問題があります:`, e)
  }
}

export const KAME_50HZ: KameBlock[] = toKameBlocks(KAME_DATASETS[50])
export const KAME_60HZ: KameBlock[] = toKameBlocks(KAME_DATASETS[60])

// ---- 判定 ----
export interface KameResult {
  status: 'inside' | 'adjacent' | 'outside'
  primary: KameBlock | null
  adjacent: KameBlock[]
}

function inPoly(x: number, y: number, p: [number, number][]): boolean {
  let c = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}
function distToPoly(x: number, y: number, p: [number, number][]): number {
  let m = Infinity
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [x1, y1] = p[j], [x2, y2] = p[i]
    const dx = x2 - x1, dy = y2 - y1
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    m = Math.min(m, Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)))
  }
  return m
}

/**
 * 有効落差H[m]・流量Q[m3/s]から亀の甲を判定。tolは対数距離（0.02は約4.7パーセント）。
 * blocks を渡すと、既定のデータの代わりにそれを使う（将来のDB読み込み用）。
 */
export function findKame(H: number, Q: number, frequency: 50 | 60 = 50, tol = 0.02, blocks?: KameBlock[]): KameResult {
  const x = Math.log10(Q), y = Math.log10(H)
  const B = blocks ?? (frequency === 60 ? KAME_60HZ : KAME_50HZ)
  const inside = B.filter(b => inPoly(x, y, b.poly))
  const adjacent = B.filter(b => !inside.includes(b) && distToPoly(x, y, b.poly) < tol)
  if (inside.length) return { status: 'inside', primary: inside[0], adjacent: [...inside.slice(1), ...adjacent] }
  if (adjacent.length) return { status: 'adjacent', primary: adjacent[0], adjacent: adjacent.slice(1) }
  return { status: 'outside', primary: null, adjacent: [] }
}

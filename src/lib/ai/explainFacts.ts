// ============================================================
// AI解説用の「事実（facts）」を作る。
// 数値はすべて計算コード（calculate / findKame）の出力から作り、AI には、この事実だけを渡す。
// 利用者からの入力は、数値だけを受け取り、範囲を検査する（自由な文章は受け取らない）。
// ============================================================
import { calculate } from '@/lib/turbine-calc'
import { compareSelection } from '@/lib/selectionComparison'
import type { NsRange, TurbineInputs, TurbineType } from '@/types'

export const TURBINE_TYPES: TurbineType[] = ['ペルトン水車', 'フランシス水車', 'カプラン水車', 'クロスフロー水車', 'チューブラ水車']

type Range = [number, number]
const RANGES: Record<string, Range> = {
  head: [0.5, 2000], flowRate: [0.0001, 500], turbineEff: [30, 99], generatorEff: [30, 99.9],
  suctionHead: [-30, 30], altitude: [-100, 6000], powerFactor: [0.1, 1], operatingHours: [0, 8784],
  capacityFactor: [0, 100], targetNs: [10, 1000], 'penstock.length': [0, 100000],
}

export type ParsedRequest =
  | { ok: true; inputs: TurbineInputs; forcedType: TurbineType | null }
  | { ok: false; error: string }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** リクエストの本文を検査して、計算に使える入力に直す */
export function parseExplainRequest(body: unknown): ParsedRequest {
  if (!body || typeof body !== 'object') return { ok: false, error: '入力が正しくありません' }
  const b = body as Record<string, unknown>
  const i = b.inputs as Record<string, unknown> | undefined
  if (!i || typeof i !== 'object') return { ok: false, error: '入力条件がありません' }
  const pen = i.penstock as Record<string, unknown> | undefined
  const num = (key: string, v: unknown): string | null => {
    const r = RANGES[key]
    return isNum(v) && v >= r[0] && v <= r[1] ? null : `${key} が範囲外です（${r[0]}〜${r[1]}）`
  }
  const errs = [
    num('head', i.head), num('flowRate', i.flowRate), num('turbineEff', i.turbineEff), num('generatorEff', i.generatorEff),
    num('suctionHead', i.suctionHead), num('altitude', i.altitude), num('powerFactor', i.powerFactor),
    num('operatingHours', i.operatingHours), num('capacityFactor', i.capacityFactor), num('targetNs', i.targetNs),
    pen && typeof pen === 'object' ? num('penstock.length', pen.length) : 'penstock がありません',
  ].filter(Boolean)
  if (i.frequency !== 50 && i.frequency !== 60) errs.push('frequency は 50 か 60 です')
  if (pen && !['steel', 'ductile', 'frp'].includes(String(pen.material))) errs.push('penstock.material が不正です')
  if (errs.length) return { ok: false, error: errs[0] as string }
  let forcedType: TurbineType | null = null
  if (b.forcedType != null) {
    if (!TURBINE_TYPES.includes(b.forcedType as TurbineType)) return { ok: false, error: '水車の種類が不正です' }
    forcedType = b.forcedType as TurbineType
  }
  return {
    ok: true, forcedType,
    inputs: {
      head: i.head as number, flowRate: i.flowRate as number, turbineEff: i.turbineEff as number,
      generatorEff: i.generatorEff as number, suctionHead: i.suctionHead as number, altitude: i.altitude as number,
      frequency: i.frequency as 50 | 60, powerFactor: i.powerFactor as number, operatingHours: i.operatingHours as number,
      capacityFactor: i.capacityFactor as number,
      penstock: { length: (pen as Record<string, unknown>).length as number, material: (pen as Record<string, unknown>).material as 'steel' | 'ductile' | 'frp' },
      targetNs: i.targetNs as number,
    },
  }
}

const r1 = (v: number) => Math.round(v * 10) / 10
const r2 = (v: number) => Math.round(v * 100) / 100
const r0 = (v: number) => Math.round(v)

export interface ExplainFacts {
  条件: Record<string, number | string>
  計算結果: Record<string, number | string | null>
  判定: { 項目: string; 結果: string; 内容: string }[]
  マニュアル選定?: Record<string, unknown>
  注記: string[]
}

/** 入力から計算し直して、AI に渡す事実を作る（画面の数値と同じ計算コードを使う） */
export function buildExplainFacts(inputs: TurbineInputs, forcedType: TurbineType | null, nsRanges: NsRange[] = []): ExplainFacts {
  const res = calculate(inputs, forcedType ?? undefined, nsRanges)
  const c = res.checks
  const facts: ExplainFacts = {
    条件: {
      有効落差_m: inputs.head, 設計流量_m3s: inputs.flowRate, 電源周波数_Hz: inputs.frequency,
      水車効率の上限_パーセント: inputs.turbineEff, 発電機効率_パーセント: inputs.generatorEff,
      吸出し高さ_m: inputs.suctionHead, 設置標高_m: inputs.altitude, 導水管の長さ_m: inputs.penstock.length,
      導水管の管種: { steel: '鋼管', ductile: 'ダクタイル鋳鉄管', frp: 'FRP管' }[inputs.penstock.material],
      年間稼働時間_h: inputs.operatingHours, 設備利用率_パーセント: inputs.capacityFactor,
    },
    計算結果: {
      水車の種類: res.turbineType,
      水車出力_kW: r1(res.turbinePower), 発電機出力_kW: r1(res.generatorPower),
      比速度Ns: r1(res.specificSpeed), 定格回転速度_rpm: r0(res.ratedRpm), 極数: res.poles,
      無拘束速度_rpm: r0(res.runawaySpeed),
      推定効率_パーセント: res.predictedEff != null ? r1(res.predictedEff * 100) : null,
      発電機容量_kVA: r0(res.electrical.generatorKva),
      年間発電量_MWh: r0(res.electrical.annualEnergy),
      ランナー径_mm: r0(res.dimensions.runnerDiameter * 1000),
    },
    判定: [
      { 項目: 'キャビテーション', 結果: c.cavitation.result, 内容: c.cavitation.message },
      { 項目: '比速度の妥当性', 結果: c.specificSpeed.result, 内容: c.specificSpeed.message },
      { 項目: '標高・大気圧低下', 結果: c.altitude.result, 内容: c.altitude.message },
      { 項目: '管路損失', 結果: c.headLoss.result, 内容: c.headLoss.message },
      { 項目: '水撃圧', 結果: c.waterHammer.result, 内容: c.waterHammer.message },
      { 項目: '無拘束速度', 結果: 'INFO', 内容: c.runaway.message },
    ],
    注記: [
      '水車の効率は計算モデルによる推定値で、実機の保証値ではない。',
      '概略の検討用。詳細設計や機種の確定には、製造者への確認が必要。',
    ],
  }
  // フランシス水車のときは、マニュアルの亀の甲による選定と、計算のベストケースを並べる
  if (res.turbineType === 'フランシス水車') {
    const cmp = compareSelection(inputs)
    const f = cmp.manual.frame
    facts.マニュアル選定 = {
      出典: `農業用水利施設小水力発電設備 計画設計技術マニュアル 図4.3-${inputs.frequency === 60 ? 9 : 8}（亀の甲）`,
      判定: { inside: '枠内', adjacent: '枠外だが近い', outside: '適用外（図のどの枠にも入らない）', unsupported: '未対応' }[cmp.manual.status],
      選ばれた枠: f ? { 枠番: f.label, 回転速度_rpm: f.rpm, ランナ出口径_mm: f.D2mm, 比速度シリーズ: f.series, シリーズの比速度: f.ns } : null,
      隣接する枠: cmp.manual.adjacent.map(a => `${a.label}（${a.rpm} rpm）`),
      計算のベストケースとの関係: { same: '同じ枠', adjacent: '隣接枠', different: '違う枠', 'n/a': '比較できない' }[cmp.diff.relation],
      ベストケースとの比: cmp.diff.rpmRatio != null && cmp.diff.D2Ratio != null
        ? { 回転速度の比: r2(cmp.diff.rpmRatio), ランナ出口径の比: r2(cmp.diff.D2Ratio) } : null,
      説明の方針: '採用するのは亀の甲で選ばれた枠。計算の結果は、効率を優先した場合の参考値。',
    }
  }
  return facts
}

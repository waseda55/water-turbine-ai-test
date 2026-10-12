// 亀の甲による選定（マニュアル準拠）と、計算によるベストケース参考値を並べて返す。
// 選定の主軸は亀の甲。計算結果は参考値として併記し、差を示す。
import { calculate } from '@/lib/turbine-calc'
import type { TurbineInputs } from '@/types'
import { findKame } from './kameNoKou'

const NS_BY_SERIES: Record<string, number> = {
  B: 266, C: 236, D: 209, E: 186, F: 165, G: 146, H: 130, I: 115, J: 102, K: 90,
}

export interface FrameInfo { label: string; rpm: number; series: string; D2mm: number; ns: number | null }
export interface SelectionComparison {
  input: { H: number; Q: number; frequency: 50 | 60 }
  manual: { status: 'inside' | 'adjacent' | 'outside' | 'unsupported'; frame: FrameInfo | null; adjacent: FrameInfo[] }
  bestCase: { rpm: number; ns: number; D2mm: number; efficiency: number; power: number }
  diff: {
    relation: 'same' | 'adjacent' | 'different' | 'n/a'
    rpmRatio: number | null   // ベストケース / 亀の甲
    D2Ratio: number | null
    nsDelta: number | null
  }
}

function toFrame(label: string, rpm: number): FrameInfo {
  const series = label[0]
  return { label, rpm, series, D2mm: Number(label.slice(1)), ns: NS_BY_SERIES[series] ?? null }
}
const parse = (s: string) => { const [label, rpm] = s.split('@'); return toFrame(label, Number(rpm)) }

export function compareSelection(inputs: TurbineInputs): SelectionComparison {
  const H = inputs.head, Q = inputs.flowRate, frequency = inputs.frequency as 50 | 60
  const r: any = calculate(inputs, 'フランシス水車')
  const bestCase = {
    rpm: Math.round(r.ratedRpm), ns: r.specificSpeed,
    D2mm: (r.dimensions.francisDetail?.D2 ?? NaN) * 1000,
    efficiency: r.predictedEff, power: r.turbinePower,
  }
  const k = findKame(H, Q, frequency)
  const frame = k.primary ? toFrame(k.primary.label, k.primary.rpm) : null
  const adjacent = k.adjacent.map(b => toFrame(b.label, b.rpm))
  let relation: SelectionComparison['diff']['relation'] = 'n/a'
  if (frame) {
    const same = (f: FrameInfo) => f.series === seriesOf(bestCase.ns) && f.rpm === bestCase.rpm && Math.abs(f.D2mm - bestCase.D2mm) <= 50
    relation = same(frame) ? 'same' : adjacent.some(same) ? 'adjacent' : 'different'
  }
  return {
    input: { H, Q, frequency },
    manual: { status: k.status, frame, adjacent },
    bestCase,
    diff: frame ? {
      relation,
      rpmRatio: bestCase.rpm / frame.rpm,
      D2Ratio: bestCase.D2mm / frame.D2mm,
      nsDelta: frame.ns != null ? bestCase.ns - frame.ns : null,
    } : { relation, rpmRatio: null, D2Ratio: null, nsDelta: null },
  }
}
function seriesOf(ns: number): string {
  return Object.entries(NS_BY_SERIES).reduce((a, b) => Math.abs(b[1] - ns) < Math.abs(a[1] - ns) ? b : a)[0]
}
export { parse as parseFrame }

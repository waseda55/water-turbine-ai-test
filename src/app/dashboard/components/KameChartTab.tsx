'use client'
// ============================================================
// 亀の甲（水車選定図）タブ
// 図4.3-8 / 4.3-9 の亀の甲を H-Q 平面に描き、入力点の該当枠と
// 計算のベストケース（参考値）を並べて示す。枠をクリックすると詳細を表示。
// ============================================================
import { useMemo, useState, useEffect } from 'react'
import type { TurbineInputs, TurbineResults } from '@/types'
import { KAME_50HZ, KAME_60HZ, findKame, getKameDataset, type KameBlock } from '@/lib/kameNoKou'
import { predictEfficiencyFrancis } from '@/lib/turbine-calc'

interface Props {
  inputs: TurbineInputs
  results: TurbineResults
  theme: 'dark' | 'light'
  /** 高コントラスト（プロジェクター）表示。ダッシュボードのヘッダーのボタンで切り替える */
  projector?: boolean
  /** 入力（有効落差・流量）を更新する。ダッシュボードの update を渡す */
  onApplyPoint: (head: number, flowRate: number) => void
}

const NS_BY_SERIES: Record<string, number> = { B: 266, C: 236, D: 209, E: 186, F: 165, G: 146, H: 130, I: 115, J: 102, K: 90 }
const QMIN = 0.4, QMAX = 3.0, HMIN = 10, HMAX = 100
const W = 720, HGT = 800, M = { l: 56, r: 16, t: 16, b: 52 }
const PW = W - M.l - M.r, PH = HGT - M.t - M.b
const lg = Math.log10
const lx = (q: number) => M.l + ((lg(q) - lg(QMIN)) / (lg(QMAX) - lg(QMIN))) * PW
const ly = (h: number) => M.t + (1 - (lg(h) - lg(HMIN)) / (lg(HMAX) - lg(HMIN))) * PH
const px2Q = (x: number) => Math.pow(10, lg(QMIN) + ((x - M.l) / PW) * (lg(QMAX) - lg(QMIN)))
const py2H = (y: number) => Math.pow(10, lg(HMIN) + (1 - (y - M.t) / PH) * (lg(HMAX) - lg(HMIN)))
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

// 色分け: 回転速度は色覚の違いに配慮した配色（Okabe-Ito 系）。n_s シリーズは低→高を青→赤の連続色で示す。
const PALETTE = {
  light: ['#0072B2', '#009E73', '#E69F00', '#CC79A7', '#56B4E9'],
  dark:  ['#5aaee6', '#2fc79a', '#f0b429', '#e58fbd', '#8fd0f2'],
}
const PROJ_PALETTE = ['#0b4f9e', '#00794a', '#c25e00', '#a8006b', '#007fb5'] // プロジェクター表示用（白背景で濃く見える色）
const SERIES_ORDER = ['L', 'K', 'J', 'I', 'H', 'G', 'F', 'E', 'D', 'C', 'B'] // n_s の小さい順（低速→高速）
const SERIES_BASE: Record<string, string> = {
  L: '#5b2c83', K: '#3b3f99', J: '#2a6fb0', I: '#1f93a8', H: '#1f9e7a', G: '#5ea84f',
  F: '#a3a52a', E: '#d89a1a', D: '#d9641f', C: '#c43c2a', B: '#8f1d2c',
}
const mix = (hex: string, t: number) => {
  const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => Math.round(v + (255 - v) * t))
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('')
}
const seriesColor = (s: string, theme: 'dark' | 'light') => { const c = SERIES_BASE[s] ?? '#888888'; return theme === 'dark' ? mix(c, 0.35) : c }
const REF_COLOR = { light: '#d6006f', dark: '#ff5fb0' }   // 計算に最も近い枠（マゼンタの点線）
const HILITE = { light: '#d1344b', dark: '#ff6b81' }       // 入力点の十字・状態表示

const seriesOf = (ns: number) =>
  Object.entries(NS_BY_SERIES).reduce((a, b) => (Math.abs(b[1] - ns) < Math.abs(a[1] - ns) ? b : a))[0]
const d2Of = (b: KameBlock) => Number(b.label.slice(1))
const keyOf = (b: KameBlock) => `${b.label}@${b.rpm}`

function inPoly(x: number, y: number, p: [number, number][]) {
  let c = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

function blockDetail(b: KameBlock, frequency: number) {
  const N = b.rpm
  const Qs = b.poly.map(p => Math.pow(10, p[0])), Hs = b.poly.map(p => Math.pow(10, p[1]))
  const Qc = Math.pow(10, b.poly.reduce((s, p) => s + p[0], 0) / 4)
  const Hc = Math.pow(10, b.poly.reduce((s, p) => s + p[1], 0) / 4)
  let eta = 0.9, ns = 0, P = 0
  for (let k = 0; k < 40; k++) {
    P = 9.8 * Qc * Hc * eta
    ns = (N * Math.sqrt(P)) / Math.pow(Hc, 1.25)
    eta = predictEfficiencyFrancis(ns)
  }
  const D = d2Of(b) / 1000
  const pq = b.poly.map(p => Math.pow(10, p[0]) * Math.pow(10, p[1]))
  return {
    Hmin: Math.min(...Hs), Hmax: Math.max(...Hs), Qmin: Math.min(...Qs), Qmax: Math.max(...Qs),
    Qc, Hc, eta, ns, Pmin: 9.8 * Math.min(...pq) * eta, Pmax: 9.8 * Math.max(...pq) * eta,
    n11: (N * D) / Math.sqrt(Hc), Q11: Qc / (D * D * Math.sqrt(Hc)), poles: Math.round((120 * frequency) / N),
  }
}

const row = (k: string, v: React.ReactNode) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 'calc(12.5px * var(--kz, 1))', padding: '2px 0' }}>
    <span style={{ color: 'var(--muted)' }}>{k}</span>
    <span style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{v}</span>
  </div>
)
const grp = (t: string) => <div style={{ margin: '10px 0 2px', fontSize: 'calc(12px * var(--kz, 1))', fontWeight: 700 }}>{t}</div>

export default function KameChartTab({ inputs, results, theme, projector = false, onApplyPoint }: Props) {
  const frequency = inputs.frequency
  const blocks = frequency === 60 ? KAME_60HZ : KAME_50HZ
  const ds = getKameDataset(frequency === 60 ? 60 : 50)
  const [sel, setSel] = useState<KameBlock | null>(null)
  const [mode, setMode] = useState<'sel' | 'pt'>('sel')
  const [labels, setLabels] = useState(true)
  const [colorMode, setColorMode] = useState<'rpm' | 'series'>('rpm')
  const proj = projector
  useEffect(() => { setSel(null) }, [frequency])

  const eff: 'dark' | 'light' = proj ? 'light' : theme   // プロジェクター表示のときは、常に白背景の配色
  const pal = proj ? PROJ_PALETTE : PALETTE[eff], refColor = REF_COLOR[eff], hi = HILITE[eff]
  const S = proj
    ? { fill: 0.55, fillP: 0.92, fillA: 0.72, fillS: 0.8, sw: 2.4, swP: 4.2, swA: 3.2, swS: 5, grid: 0.5, tick: 14.5, axis: 16, lab: 13.5, labP: 16, halo: 4.5, ref: 4.6, pt: 9 }
    : { fill: 0.26, fillP: 0.6, fillA: 0.4, fillS: 0.5, sw: 1.5, swP: 2.8, swA: 2, swS: 3.6, grid: 0.35, tick: 11, axis: 12, lab: 10, labP: 11.5, halo: 3, ref: 3.4, pt: 7 }
  const projVars = (proj
    ? { '--surface': '#ffffff', '--bg': '#ffffff', '--text': '#000000', '--muted': '#1f1f1f', '--border': '#404040', '--accent': '#b00020', '--kz': 1.3 }
    : { '--kz': 1 }) as unknown as React.CSSProperties
  const rpmColor = useMemo(() => {
    const r = Array.from(new Set(blocks.map(b => b.rpm))).sort((a, b) => b - a)
    const m = new Map<number, string>(); r.forEach((v, i) => m.set(v, pal[Math.min(i, 4)])); return m
  }, [blocks, pal])

  const H = clamp(inputs.head, HMIN, HMAX), Q = clamp(inputs.flowRate, QMIN, QMAX)
  const found = useMemo(() => findKame(inputs.head, inputs.flowRate, frequency), [inputs.head, inputs.flowRate, frequency])

  // 計算のベストケース（参考値）: ダッシュボードの計算結果をそのまま使う
  const best = useMemo(() => {
    const D2 = (results.dimensions.francisDetail?.D2 ?? NaN) * 1000
    return { rpm: Math.round(results.ratedRpm), ns: results.specificSpeed, D2, eff: results.predictedEff, P: results.turbinePower }
  }, [results])
  const bestSeries = seriesOf(best.ns)
  const refBlock = useMemo(() => {
    const c = blocks.filter(b => b.label[0] === bestSeries && Math.abs(b.rpm - best.rpm) <= 1)
    if (!c.length) return null
    return c.reduce((a, b) => (Math.abs(d2Of(b) - best.D2) < Math.abs(d2Of(a) - best.D2) ? b : a))
  }, [blocks, bestSeries, best])

  const sameAsBest = (b: KameBlock) => b.label[0] === bestSeries && b.rpm === best.rpm && Math.abs(d2Of(b) - best.D2) <= 50
  const relation = !found.primary ? '–' : sameAsBest(found.primary) ? '同じ枠' : found.adjacent.some(sameAsBest) ? '隣接枠' : '違う枠'

  const shown = sel ?? found.primary
  const detail = shown ? blockDetail(shown, frequency) : null
  const toggle = (b: KameBlock) => setSel(s => (s === b ? null : b))
  const pts = (b: KameBlock) => b.poly.map(([x, y]) => `${lx(Math.pow(10, x)).toFixed(1)},${ly(Math.pow(10, y)).toFixed(1)}`).join(' ')

  const ordered = useMemo(() => (sel ? [...blocks.filter(b => b !== sel), sel] : blocks), [blocks, sel])
  const X = lx(Q), Y = ly(H)
  const btn = (on: boolean): React.CSSProperties => ({
    padding: '4px 12px', fontSize: 'calc(12.5px * var(--kz, 1))', cursor: 'pointer', border: '1px solid var(--border)',
    background: on ? 'var(--accent)' : 'transparent', color: on ? 'var(--bg)' : 'var(--text)',
  })

  return (
    <div className="panel" style={{ padding: 14, color: 'var(--text)', ...projVars }}>
      <div className="sec-hd">亀の甲（水車選定図 図4.3-{frequency === 60 ? '9' : '8'}・<span style={{ textTransform: 'none' }}>{frequency}Hz</span>）</div>
      <p style={{ fontSize: 'calc(12px * var(--kz, 1))', color: 'var(--muted)', margin: '0 0 10px' }}>
        枠をクリックすると詳細を表示します。図から再構成した暫定データのため、枠の位置には誤差があります（特に低い回転速度の枠）。
      </p>
      <p style={{ fontSize: 'calc(11.5px * var(--kz, 1))', color: 'var(--muted)', margin: '0 0 10px' }}>
        データ: {ds.source.figure}（{ds.source.document} p.{ds.source.page}）／版 {ds.version}（{ds.status}）／作成 {ds.createdAt}
        <br />{ds.accuracy}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: `minmax(0,1fr) ${proj ? 390 : 300}px`, gap: 14, alignItems: 'start' }}>
        <div style={{ border: '1px solid var(--border)', background: 'var(--surface)', padding: 6 }}>
          <svg viewBox={`0 0 ${W} ${HGT}`} style={{ display: 'block', width: '100%', height: 'auto' }}
               role="img" aria-label="流量と有効落差の対数グラフに亀の甲を重ねた水車選定図"
               onClick={e => {
                 if (mode !== 'pt') return
                 const r = e.currentTarget.getBoundingClientRect()
                 const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * HGT
                 if (x < M.l || x > M.l + PW || y < M.t || y > M.t + PH) return
                 onApplyPoint(+py2H(y).toFixed(1), +px2Q(x).toFixed(2))
               }}>
            <clipPath id="kame-cp"><rect x={M.l} y={M.t} width={PW} height={PH} /></clipPath>
            {[0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.5, 2, 2.5, 3].map(q => (
              <g key={q}><line x1={lx(q)} x2={lx(q)} y1={M.t} y2={M.t + PH} stroke="var(--border)" strokeOpacity={S.grid} />
                <text x={lx(q)} y={M.t + PH + 16} textAnchor="middle" fontSize={S.tick} fill="var(--muted)">{q.toFixed(1)}</text></g>
            ))}
            {[10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(h => (
              <g key={h}><line x1={M.l} x2={M.l + PW} y1={ly(h)} y2={ly(h)} stroke="var(--border)" strokeOpacity={S.grid} />
                <text x={M.l - 8} y={ly(h)} textAnchor="end" dominantBaseline="central" fontSize={S.tick} fill="var(--muted)">{h}</text></g>
            ))}
            <rect x={M.l} y={M.t} width={PW} height={PH} fill="none" stroke="var(--text)" strokeWidth={1.2} />
            <text x={M.l + PW / 2} y={HGT - 10} textAnchor="middle" fontSize={S.axis} fill="var(--text)">流量 Q（m³/s）</text>
            <text x={16} y={M.t + PH / 2} textAnchor="middle" fontSize={S.axis} fill="var(--text)" transform={`rotate(-90 16 ${M.t + PH / 2})`}>有効落差 H（m）</text>
            <g clipPath="url(#kame-cp)">
              {ordered.map(b => {
                const isP = found.primary === b, isA = found.adjacent.includes(b), isS = sel === b
                const c = colorMode === 'rpm' ? (rpmColor.get(b.rpm) ?? pal[0]) : seriesColor(b.label[0], eff)
                return (
                  <polygon key={keyOf(b)} points={pts(b)} tabIndex={0} role="button"
                    aria-label={`${b.label}（${b.rpm} r/min）の詳細を見る`}
                    style={{ cursor: 'pointer', outline: 'none' }}
                    fill={c} fillOpacity={isS ? S.fillS : isP ? S.fillP : isA ? S.fillA : S.fill}
                    stroke={isS ? 'var(--accent)' : isP || isA ? 'var(--text)' : c} strokeWidth={isS ? S.swS : isP ? S.swP : isA ? S.swA : S.sw}
                    strokeDasharray={isA && !isS ? '6 3' : undefined}
                    onClick={ev => { if (mode === 'sel') { ev.stopPropagation(); toggle(b) } }}
                    onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(b) } }}>
                    <title>{`${b.label}（${b.rpm} r/min）`}</title>
                  </polygon>
                )
              })}
              {refBlock && <polygon points={pts(refBlock)} fill="none" stroke={refColor} strokeWidth={S.ref}
                strokeDasharray="1 6" strokeLinecap="round" pointerEvents="none" />}
            </g>
            {labels && blocks.map(b => {
              const q = b.poly.map(([x, y]) => [lx(Math.pow(10, x)), ly(Math.pow(10, y))])
              const cx = q.reduce((s, a) => s + a[0], 0) / 4, cy = q.reduce((s, a) => s + a[1], 0) / 4
              let rot = (Math.atan2(q[0][1] - q[3][1], q[0][0] - q[3][0]) * 180) / Math.PI
              if (rot > 90 || rot < -90) rot += 180
              const emph = found.primary === b
              return (
                <text key={'l' + keyOf(b)} x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
                  fontSize={emph ? S.labP : S.lab} fontWeight={emph || proj ? 700 : 500} fill="var(--text)" pointerEvents="none"
                  stroke="var(--surface)" strokeWidth={S.halo} strokeLinejoin="round" paintOrder="stroke"
                  transform={`rotate(${rot.toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)})`}>{b.label}</text>
              )
            })}
            <line x1={M.l} x2={X} y1={Y} y2={Y} stroke="var(--text)" strokeOpacity={0.7} strokeDasharray="4 3" />
            <line x1={X} x2={X} y1={Y} y2={M.t + PH} stroke="var(--text)" strokeOpacity={0.7} strokeDasharray="4 3" />
            <circle cx={X} cy={Y} r={S.pt} fill="var(--surface)" stroke="var(--text)" strokeWidth={2.6} />
            <circle cx={X} cy={Y} r={2.5} fill="var(--text)" />
          </svg>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ border: '1px solid var(--border)', background: 'var(--surface)', padding: '10px 12px' }}>
            <div style={{ fontSize: 'calc(12px * var(--kz, 1))', color: 'var(--muted)', marginBottom: 4 }}>図をクリックしたとき</div>
            <div style={{ display: 'inline-flex' }}>
              <button style={btn(mode === 'sel')} onClick={() => setMode('sel')}>枠を選ぶ</button>
              <button style={btn(mode === 'pt')} onClick={() => setMode('pt')}>点を置く</button>
            </div>
            <div style={{ fontSize: 'calc(12px * var(--kz, 1))', color: 'var(--muted)', margin: '10px 0 4px' }}>色分け</div>
            <div style={{ display: 'inline-flex' }}>
              <button style={btn(colorMode === 'rpm')} onClick={() => setColorMode('rpm')}>回転速度</button>
              <button style={btn(colorMode === 'series')} onClick={() => setColorMode('series')}>n_s シリーズ</button>
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, fontSize: 'calc(12.5px * var(--kz, 1))', color: 'var(--muted)' }}>
              <input type="checkbox" checked={labels} onChange={e => setLabels(e.target.checked)} />枠番を表示する
            </label>
          </div>

          <div style={{ border: '1px solid var(--border)', background: 'var(--surface)', padding: '10px 12px' }} aria-live="polite">
            <div className="sec-hd">該当する亀の甲</div>
            {found.primary ? (<>
              <div style={{ fontSize: 'calc(26px * var(--kz, 1))', fontWeight: 700, lineHeight: 1.2 }}>{found.primary.label}
                <span style={{ fontSize: 'calc(11px * var(--kz, 1))', fontWeight: 400, marginLeft: 8, padding: '1px 8px', border: `1px solid ${hi}`, color: hi, borderRadius: 10 }}>
                  {found.status === 'inside' ? '枠内' : '枠外（近い）'}</span></div>
              {row('回転速度', `${found.primary.rpm} r/min`)}
              {row('ランナ出口径 D₂', `${d2Of(found.primary)} mm`)}
              {row('比速度 n_s', `${found.primary.label[0]} シリーズ（${NS_BY_SERIES[found.primary.label[0]]}）`)}
              {found.adjacent.length > 0 && <div style={{ fontSize: 'calc(12px * var(--kz, 1))', color: 'var(--muted)', marginTop: 6 }}>
                隣接する枠: {found.adjacent.map(b => `${b.label}（${b.rpm}）`).join('、')}</div>}
            </>) : <div style={{ fontSize: 'calc(13px * var(--kz, 1))' }}>適用外（どの亀の甲にも入らず、近い枠もありません）</div>}
            <div style={{ marginTop: 8 }}>
              <button style={{ ...btn(false), fontSize: 'calc(12px * var(--kz, 1))' }} disabled={!shown}
                onClick={() => { if (detail) onApplyPoint(+detail.Hc.toFixed(1), +detail.Qc.toFixed(2)) }}>
                {sel ? '選んだ枠の中心を入力に反映' : '枠の中心を入力に反映'}
              </button>
            </div>
          </div>

          <div style={{ border: '1px solid var(--border)', background: 'var(--surface)', padding: '10px 12px' }} aria-live="polite">
            <div className="sec-hd">枠の詳細</div>
            {shown && detail ? (<>
              <div style={{ fontSize: 'calc(11.5px * var(--kz, 1))', color: 'var(--muted)' }}>{sel ? '選択中の枠' : '亀の甲で選ばれた枠'}</div>
              <div style={{ fontSize: 'calc(20px * var(--kz, 1))', fontWeight: 700 }}>{shown.label}</div>
              {row('回転速度', `${shown.rpm} r/min（${detail.poles}極、${frequency}Hz）`)}
              {row('入力した点', inPoly(lg(Q), lg(H), shown.poly) ? 'この枠の中' : 'この枠の外')}
              {grp('適用範囲（図から読み取り）')}
              {row('有効落差 H', `${detail.Hmin.toFixed(1)}〜${detail.Hmax.toFixed(1)} m`)}
              {row('流量 Q', `${detail.Qmin.toFixed(2)}〜${detail.Qmax.toFixed(2)} m³/s`)}
              {row('出力の目安', `${Math.round(detail.Pmin)}〜${Math.round(detail.Pmax)} kW`)}
              {grp('枠の中心での参考値')}
              {row('中心の H、Q', `${detail.Hc.toFixed(1)} m、${detail.Qc.toFixed(2)} m³/s`)}
              {row('単位回転数 n₁₁', detail.n11.toFixed(1))}
              {row('単位流量 Q₁₁', `${detail.Q11.toFixed(3)} m³/s`)}
              {row('推定効率', `${(detail.eta * 100).toFixed(1)} %`)}
              {row('比速度（計算）', detail.ns.toFixed(0))}
              <p style={{ fontSize: 'calc(11.5px * var(--kz, 1))', color: 'var(--muted)', margin: '8px 0 0' }}>
                発電機容量や寸法など、マニュアル表4.3-5／4.3-6 の仕様は、この版には入っていません。</p>
            </>) : <div style={{ fontSize: 'calc(12.5px * var(--kz, 1))', color: 'var(--muted)' }}>枠をクリックすると、その枠の詳細を表示します。</div>}
          </div>

          <div style={{ border: '1px solid var(--border)', background: 'var(--surface)', padding: '10px 12px' }}>
            <div className="sec-hd">計算のベストケース（参考値）</div>
            {row('回転速度', `${best.rpm} r/min`)}
            {row('ランナ出口径 D₂', `${Math.round(best.D2)} mm`)}
            {row('比速度 n_s', `${best.ns.toFixed(0)}（${bestSeries} シリーズ付近）`)}
            {row('推定効率', best.eff != null ? `${(best.eff * 100).toFixed(1)} %` : '–')}
            {row('出力', `${best.P.toFixed(0)} kW`)}
            {row('最も近い枠', refBlock ? `${refBlock.label}（${refBlock.rpm} r/min）` : 'なし（図にない回転速度）')}
            {row('亀の甲との関係', relation)}
            {found.primary && row('亀の甲との比', `回転速度 ×${(best.rpm / found.primary.rpm).toFixed(2)}、D₂ ×${(best.D2 / d2Of(found.primary)).toFixed(2)}`)}
            <p style={{ fontSize: 'calc(11.5px * var(--kz, 1))', color: 'var(--muted)', margin: '8px 0 0' }}>選定には使わず、効率を優先した場合の参考値です。</p>
          </div>

          <div style={{ fontSize: 'calc(12px * var(--kz, 1))', display: 'flex', flexDirection: 'column', gap: 5, border: '1px solid var(--border)', background: 'var(--surface)', padding: '10px 12px' }}>
            <div style={{ fontWeight: 700 }}>{colorMode === 'rpm' ? '色＝回転速度' : '色＝n_s シリーズ（低速→高速）'}</div>
            {colorMode === 'rpm'
              ? Array.from(rpmColor.entries()).map(([r, c]) => (
                  <div key={r}><span style={{ display: 'inline-block', width: 16, height: 12, background: c, opacity: 0.8, border: `1.5px solid ${c}`, marginRight: 8, verticalAlign: 'middle' }} />{r} r/min</div>))
              : SERIES_ORDER.filter(sr => blocks.some(b => b.label[0] === sr)).map(sr => (
                  <div key={sr}><span style={{ display: 'inline-block', width: 16, height: 12, background: seriesColor(sr, eff), opacity: 0.8, border: `1.5px solid ${seriesColor(sr, eff)}`, marginRight: 8, verticalAlign: 'middle' }} />{sr}（n_s {NS_BY_SERIES[sr] ?? '90未満'}）</div>))}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 2, display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div><svg width={22} height={12} style={{ marginRight: 8, verticalAlign: 'middle' }}><rect x={1} y={1} width={20} height={10} fill="var(--muted)" fillOpacity={0.6} stroke="var(--text)" strokeWidth={2.2} /></svg>亀の甲で選ばれた枠（濃い塗り）</div>
              <div><svg width={22} height={12} style={{ marginRight: 8, verticalAlign: 'middle' }}><rect x={1} y={1} width={20} height={10} fill="var(--muted)" fillOpacity={0.4} stroke="var(--text)" strokeWidth={1.6} strokeDasharray="4 2" /></svg>隣接する枠（破線）</div>
              <div><svg width={22} height={12} style={{ marginRight: 8, verticalAlign: 'middle' }}><rect x={1} y={1} width={20} height={10} fill="var(--muted)" fillOpacity={0.5} stroke="var(--accent)" strokeWidth={3} /></svg>クリックして選んだ枠</div>
              <div><svg width={22} height={12} style={{ marginRight: 8, verticalAlign: 'middle' }}><line x1={1} x2={21} y1={6} y2={6} stroke={refColor} strokeWidth={3.4} strokeDasharray="1 6" strokeLinecap="round" /></svg>計算に最も近い枠（マゼンタの点線）</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

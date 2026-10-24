'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { calculate, getEfficiencyCurve, getHillChartData, calcFrancisEfficiencyCurve, evaluateRunnerDiameterCandidates, N11_FRANCIS } from '@/lib/turbine-calc'
import type { RunnerDiameterCandidate } from '@/lib/turbine-calc'
import { exportJSON, exportCSV, exportExcel, exportDXF, importJSON } from '@/lib/export'
import type { TurbineInputs, TurbineResults, TurbineType, HQRange, NsRange } from '@/types'
import { useRouter } from 'next/navigation'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import TurbineSchematic from './components/TurbineSchematic'
import { FrancisMeridionalSvg } from './components/FrancisMeridionalSvg'
import { FrancisBladeProfileSvg } from './components/FrancisBladeProfileSvg'
import { FrancisMeridional } from './components/FrancisMeridional'
import { FrancisBladeProfile } from './components/FrancisBladeProfile'
import FrancisHillChart from './components/FrancisHillChart'
import KameChartTab from './components/KameChartTab'
import { FrancisRunner3D } from './components/FrancisRunner3D'
import { FrancisBlade3D }  from './components/FrancisBlade3D'

// ─── 型 ────────────────────────────────────────────────────────
interface HistoryRow {
  id: string; name: string; turbine_type: string
  turbine_power: number; specific_speed: number; created_at: string
  head: number; flow_rate: number
}
interface ProjectRow { id: string; name: string }

interface Props {}

// ─── 流量単位変換 ──────────────────────────────────────────────
type FlowUnit = 'm3/s' | 'l/s' | 'm3/min' | 'm3/h' | 'l/min' | 'l/h'

const FLOW_UNITS: { key: FlowUnit; label: string; toM3s: number; dec: number; max: number; step: number }[] = [
  { key: 'm3/s',   label: 'm³/s',   toM3s: 1,          dec: 3, max: 200,    step: 0.001 },
  { key: 'l/s',    label: 'l/s',    toM3s: 0.001,      dec: 1, max: 200000, step: 0.1   },
  { key: 'm3/min', label: 'm³/min', toM3s: 1/60,       dec: 2, max: 12000,  step: 0.01  },
  { key: 'm3/h',   label: 'm³/h',   toM3s: 1/3600,     dec: 1, max: 720000, step: 0.1   },
  { key: 'l/min',  label: 'l/min',  toM3s: 1/60000,    dec: 0, max: 12e6,   step: 1     },
  { key: 'l/h',    label: 'l/h',    toM3s: 1/3600000,  dec: 0, max: 720e6,  step: 1     },
]
function toDisplayFlow(m3s: number, unit: FlowUnit): number {
  return m3s / FLOW_UNITS.find(u => u.key === unit)!.toM3s
}
function toM3s(val: number, unit: FlowUnit): number {
  return val * FLOW_UNITS.find(u => u.key === unit)!.toM3s
}

const DEFAULT_INPUTS: TurbineInputs = {
  head: 50, flowRate: 5, turbineEff: 88, generatorEff: 96,
  suctionHead: 2, altitude: 0, frequency: 50,
  powerFactor: 0.85, operatingHours: 8000, capacityFactor: 70,
  penstock: { length: 500, material: 'steel' },
  targetNs: 160,
}

import type { VelocityTriangle } from '@/types'

// ─── 速度三角形 SVG ───────────────────────────────────────────
function VelocityTriangleSVG({ tri, label, color }: { tri: VelocityTriangle; label: string; color: string }) {
  const W = 260, H = 160
  const CX = 40, CY = 110
  const SCALE = Math.min(100 / Math.max(tri.u, tri.c, tri.w, 1), 8)
  const ux = CX + tri.u * SCALE, uy = CY
  const cx2 = CX + tri.cu * SCALE, cy2 = CY - tri.cm * SCALE

  const arrow = (x1: number, y1: number, x2: number, y2: number, col: string, dash = '') => {
    const dx = x2 - x1, dy = y2 - y1
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 2) return null
    const ax = dx / len, ay = dy / len
    const hx = x2 - ax * 8, hy = y2 - ay * 8
    const px = -ay * 4, py = ax * 4
    return (
      <g>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={col} strokeWidth="1.8" strokeDasharray={dash} />
        <polygon points={`${x2},${y2} ${hx + px},${hy + py} ${hx - px},${hy - py}`} fill={col} />
      </g>
    )
  }

  const fmt = (v: number) => v.toFixed(1)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: H, display: 'block' }}>
      <line x1={CX - 10} y1={CY} x2={W - 10} y2={CY} stroke="var(--border)" strokeWidth="0.8" strokeDasharray="3 3" />
      <line x1={CX} y1={10} x2={CX} y2={CY + 10} stroke="var(--border)" strokeWidth="0.8" strokeDasharray="3 3" />
      {arrow(CX, CY, ux, uy, '#60a5fa')}
      <text x={(CX + ux) / 2} y={CY + 14} fill="#60a5fa" fontSize="9" textAnchor="middle" fontFamily="JetBrains Mono">u={fmt(tri.u)}</text>
      {arrow(CX, CY, cx2, cy2, color)}
      <text x={cx2 + 4} y={cy2 - 4} fill={color} fontSize="9" fontFamily="JetBrains Mono">c={fmt(tri.c)}</text>
      {arrow(ux, uy, cx2, cy2, '#fb923c', '4 2')}
      <text x={(ux + cx2) / 2 + 6} y={(uy + cy2) / 2} fill="#fb923c" fontSize="9" fontFamily="JetBrains Mono">w={fmt(tri.w)}</text>
      {tri.cm > 1 && (() => {
        const r = 18
        const x2a = CX + r * Math.cos(-Math.atan2(tri.cm, tri.cu)), y2a = CY + r * Math.sin(-Math.atan2(tri.cm, tri.cu))
        return (
          <g>
            <path d={`M ${CX + r} ${CY} A ${r} ${r} 0 0 1 ${x2a} ${y2a}`} fill="none" stroke={color} strokeWidth="1" opacity="0.5" />
            <text x={CX + r + 6} y={CY - 4} fill={color} fontSize="8" fontFamily="JetBrains Mono">α={fmt(Math.abs(tri.alpha))}°</text>
          </g>
        )
      })()}
      {Math.abs(tri.wu) > 0.5 && (() => {
        const r = 14
        const betaRad = Math.atan2(tri.cm, Math.abs(tri.wu))
        const x1b = ux + r * Math.cos(-betaRad) * Math.sign(tri.wu), y1b = uy + r * Math.sin(-betaRad)
        return (
          <g>
            <path d={`M ${ux + r * Math.sign(tri.wu)} ${uy} A ${r} ${r} 0 0 0 ${x1b} ${y1b}`} fill="none" stroke="#fb923c" strokeWidth="1" opacity="0.5" />
            <text x={ux - 8} y={uy + 22} fill="#fb923c" fontSize="8" fontFamily="JetBrains Mono">β={fmt(Math.abs(tri.beta))}°</text>
          </g>
        )
      })()}
      <text x={W / 2} y={14} fill="var(--muted)" fontSize="9" textAnchor="middle" fontFamily="JetBrains Mono" fontWeight="700" letterSpacing="0.08em">{label}</text>
    </svg>
  )
}

function VelocityTrianglePanel({ results, color }: { results: import('@/types').TurbineResults; color: string }) {
  const vt = results.velocityTriangles
  if (!vt) return (
    <div className="panel" style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
      この水車形式の速度三角形データは未対応です
    </div>
  )
  const eulerHead = (vt.inlet.u * vt.inlet.cu - vt.outlet.u * vt.outlet.cu) / 9.81
  const rows = (tri: VelocityTriangle) => [
    ['周速 u',            `${tri.u.toFixed(2)} m/s`],
    ['絶対速度 c',        `${tri.c.toFixed(2)} m/s`],
    ['相対速度 w',        `${tri.w.toFixed(2)} m/s`],
    ['絶対速度角 α',     `${Math.abs(tri.alpha).toFixed(1)} °`],
    ['相対速度角 β',     `${Math.abs(tri.beta).toFixed(1)} °`],
    ['周方向絶対分速 cu', `${tri.cu.toFixed(2)} m/s`],
    ['子午面分速 cm',     `${tri.cm.toFixed(2)} m/s`],
    ['周方向相対分速 wu', `${tri.wu.toFixed(2)} m/s`],
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ padding: '8px 12px', background: `color-mix(in srgb, ${color} 6%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`, fontSize: 10, color: 'var(--muted)', lineHeight: 1.7 }}>
        <span style={{ color, fontWeight: 700 }}>{results.turbineType}</span> — 設計点（100% 負荷）速度三角形。
        ユーラー理論水頭：<span style={{ color, fontWeight: 700, fontFamily: 'JetBrains Mono' }}>He = {eulerHead.toFixed(1)} m</span>　※概略推算値
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="panel" style={{ padding: 12 }}>
          <div className="sec-hd">ランナー入口（添字 1）</div>
          <VelocityTriangleSVG tri={vt.inlet} label="INLET" color={color} />
          <div style={{ marginTop: 8 }}>
            {rows(vt.inlet).map(([l, v]) => (
              <div key={l} className="data-row"><span className="data-row-label">{l}</span><span className="data-row-val">{v}</span></div>
            ))}
          </div>
        </div>
        <div className="panel" style={{ padding: 12 }}>
          <div className="sec-hd">ランナー出口（添字 2）</div>
          <VelocityTriangleSVG tri={vt.outlet} label="OUTLET" color={color} />
          <div style={{ marginTop: 8 }}>
            {rows(vt.outlet).map(([l, v]) => (
              <div key={l} className="data-row"><span className="data-row-label">{l}</span><span className="data-row-val">{v}</span></div>
            ))}
          </div>
        </div>
      </div>
      <div className="panel" style={{ padding: 10 }}>
        <div className="sec-hd">凡例</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px 16px', fontSize: 10, color: 'var(--muted)', lineHeight: 1.8 }}>
          {[
            ['u', '周速', '#60a5fa'], ['c', '絶対速度', color], ['w', '相対速度', '#fb923c'],
            ['α', '絶対速度角', color], ['β', '相対速度角', '#fb923c'], ['cu', '絶対速度周方向成分', '#60a5fa'],
            ['cm', '子午面成分', 'var(--muted)'], ['wu', '相対速度周方向成分', '#fb923c'], ['He', 'ユーラー水頭', color],
          ].map(([sym, desc, col]) => (
            <div key={sym} style={{ display: 'flex', gap: 6 }}>
              <span style={{ color: col, fontFamily: 'JetBrains Mono', fontWeight: 700, minWidth: 24 }}>{sym}</span>
              <span>{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Badge ────────────────────────────────────────────────────
function Badge({ result }: { result: string }) {
  const cls: Record<string, string> = { OK: 'badge-ok', NG: 'badge-ng', '注意': 'badge-warn', 'N/A': 'badge-info', INFO: 'badge-info' }
  return <span className={`badge ${cls[result] ?? 'badge-info'}`}>{result}</span>
}

// ─── H-Q 選定図 ──────────────────────────────────────────────
function HQChart({ head, flowRate, turbineType, hqRanges, flowUnit }: {
  head: number; flowRate: number; turbineType: string; hqRanges: HQRange[]; flowUnit: FlowUnit
}) {
  const W = 560, H = 380, pad = { top: 20, right: 30, bottom: 50, left: 60 }
  const cw = W - pad.left - pad.right, ch = H - pad.top - pad.bottom
  const Q_MIN = 0.05, Q_MAX = 600, H_MIN = 2, H_MAX = 1200
  const toX = (q: number) => pad.left + Math.log10(q / Q_MIN) / Math.log10(Q_MAX / Q_MIN) * cw
  const toY = (h: number) => pad.top + ch - Math.log10(h / H_MIN) / Math.log10(H_MAX / H_MIN) * ch
  const qTicks = [0.05, 0.1, 0.5, 1, 5, 10, 50, 100, 500]
  const hTicks = [2, 5, 10, 20, 50, 100, 200, 500, 1000]
  const ptStr = (pts: { q: number; h: number }[]) =>
    pts.map(p => `${toX(p.q).toFixed(1)},${toY(p.h).toFixed(1)}`).join(' ')
  const cx = toX(flowRate), cy = toY(head)
  const fu = FLOW_UNITS.find(u => u.key === flowUnit)!

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 380 }}>
      <rect x={pad.left} y={pad.top} width={cw} height={ch} fill="var(--bg)" />
      {qTicks.map(q => <line key={q} x1={toX(q)} y1={pad.top} x2={toX(q)} y2={pad.top+ch} stroke="var(--border)" strokeWidth="1" />)}
      {hTicks.map(h => <line key={h} x1={pad.left} y1={toY(h)} x2={pad.left+cw} y2={toY(h)} stroke="var(--border)" strokeWidth="1" />)}
      {hqRanges.map(r => (
        <polygon key={r.id} points={ptStr(r.boundaryPoints)}
          fill={r.turbineType.color} fillOpacity="0.08"
          stroke={turbineType === r.turbineType.name ? r.turbineType.color : r.turbineType.color + '55'}
          strokeWidth={turbineType === r.turbineType.name ? 1.5 : 1}
          strokeDasharray={turbineType === r.turbineType.name ? '' : '4 3'} />
      ))}
      {hqRanges.map(r => {
        const p = r.boundaryPoints[0]
        return (
          <text key={r.id} x={toX(p.q * 1.3)} y={toY(p.h * 1.8)}
            fill={r.turbineType.color} fontSize="10" fontWeight="700" fontFamily="'JetBrains Mono', monospace"
            opacity={turbineType === r.turbineType.name ? 1 : 0.5}>
            {r.turbineType.name.replace('水車', '')}
          </text>
        )
      })}
      {flowRate >= Q_MIN && flowRate <= Q_MAX && head >= H_MIN && head <= H_MAX && (
        <g>
          <line x1={cx} y1={pad.top} x2={cx} y2={pad.top+ch} stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
          <line x1={pad.left} y1={cy} x2={pad.left+cw} y2={cy} stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
          <polygon points={`${cx},${cy-8} ${cx+8},${cy} ${cx},${cy+8} ${cx-8},${cy}`} fill="var(--accent)" />
          <rect x={cx+12} y={cy-18} width={124} height={28} fill="var(--surface)" stroke="var(--accent)" strokeWidth="1" />
          <text x={cx+19} y={cy-5} fill="var(--accent)" fontSize="10" fontFamily="'JetBrains Mono', monospace" fontWeight="700">
            Q={toDisplayFlow(flowRate, flowUnit).toFixed(fu.dec)} {fu.label}
          </text>
          <text x={cx+19} y={cy+7} fill="var(--accent)" fontSize="10" fontFamily="'JetBrains Mono', monospace">H={head} m</text>
        </g>
      )}
      {qTicks.map(q => <text key={q} x={toX(q)} y={pad.top+ch+16} textAnchor="middle" fill="var(--muted)" fontSize="10" fontFamily="'JetBrains Mono', monospace">{q}</text>)}
      <text x={pad.left+cw/2} y={H-4} textAnchor="middle" fill="var(--muted)" fontSize="11">設計流量 Q [{fu.label}]　※軸はm³/s基準</text>
      {hTicks.map(h => <text key={h} x={pad.left-8} y={toY(h)+4} textAnchor="end" fill="var(--muted)" fontSize="10" fontFamily="'JetBrains Mono', monospace">{h}</text>)}
      <text x={14} y={pad.top+ch/2} textAnchor="middle" fill="var(--muted)" fontSize="11"
        transform={`rotate(-90, 14, ${pad.top+ch/2})`}>有効落差 H [m]</text>
      <rect x={pad.left} y={pad.top} width={cw} height={ch} fill="none" stroke="var(--border)" strokeWidth="1" />
    </svg>
  )
}

// ─── Ns 分布図 ───────────────────────────────────────────────
function NsChart({ ns, turbineType, nsRanges }: { ns: number; turbineType: string; nsRanges: NsRange[] }) {
  const W = 560, H = 220, pad = { top: 24, right: 40, bottom: 40, left: 20 }
  const cw = W - pad.left - pad.right, ch = H - pad.top - pad.bottom
  const NS_MAX = 1000
  const toX = (n: number) => pad.left + (n / NS_MAX) * cw
  const rowH = 36
  const nsTicks = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]
  const nsX = toX(Math.min(Math.max(ns, 0), NS_MAX))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 220 }}>
      <rect x={pad.left} y={pad.top} width={cw} height={ch} fill="var(--bg)" />
      {nsTicks.map(t => <line key={t} x1={toX(t)} y1={pad.top} x2={toX(t)} y2={pad.top+ch} stroke="var(--border)" strokeWidth="1" />)}
      {nsRanges.map((r, i) => {
        const active = turbineType === r.turbineType.name
        const x1 = toX(r.nsMin), x2 = toX(r.nsMax)
        const barY = pad.top + i * rowH + 8
        return (
          <g key={r.id}>
            <rect x={pad.left} y={barY} width={cw} height={rowH - 4} fill={r.turbineType.color} fillOpacity="0.03" />
            <rect x={x1} y={barY + 6} width={x2 - x1} height={rowH - 16}
              fill={r.turbineType.color} fillOpacity={active ? 0.25 : 0.10}
              stroke={r.turbineType.color} strokeWidth={active ? 1.5 : 1} />
            <text x={pad.left + 6} y={barY + rowH/2 - 1}
              fill={active ? r.turbineType.color : 'var(--muted)'} fontSize="11"
              fontWeight={active ? '700' : '400'} dominantBaseline="middle">
              {r.turbineType.name}
            </text>
            <text x={x2 + 6} y={barY + rowH/2 - 1}
              fill={r.turbineType.color} fontSize="10" fontFamily="'JetBrains Mono', monospace"
              dominantBaseline="middle" opacity={active ? 1 : 0.5}>
              {r.nsMin}〜{r.nsMax}
            </text>
          </g>
        )
      })}
      <line x1={nsX} y1={pad.top} x2={nsX} y2={pad.top+ch} stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 2" />
      <polygon points={`${nsX},${pad.top-8} ${nsX+5},${pad.top} ${nsX-5},${pad.top}`} fill="var(--accent)" />
      <rect x={nsX - 30} y={pad.top - 20} width={60} height={14} fill="var(--surface)" stroke="var(--accent)" strokeWidth="1" />
      <text x={nsX} y={pad.top - 9} textAnchor="middle" fill="var(--accent)" fontSize="10" fontFamily="'JetBrains Mono', monospace" fontWeight="700">
        Ns={ns.toFixed(1)}
      </text>
      {nsTicks.map(t => <text key={t} x={toX(t)} y={pad.top+ch+14} textAnchor="middle" fill="var(--muted)" fontSize="10" fontFamily="'JetBrains Mono', monospace">{t}</text>)}
      <text x={pad.left+cw/2} y={H-2} textAnchor="middle" fill="var(--muted)" fontSize="11">比速度 Ns</text>
      <rect x={pad.left} y={pad.top} width={cw} height={ch} fill="none" stroke="var(--border)" strokeWidth="1" />
    </svg>
  )
}

// ─── FlowRateInput ───────────────────────────────────────────
function FlowRateInput({ flowRate, flowUnit, onFlowRateChange, onUnitChange }:
  { flowRate: number; flowUnit: FlowUnit; onFlowRateChange: (m3s: number) => void; onUnitChange: (unit: FlowUnit) => void }
) {
  const u = FLOW_UNITS.find(fu => fu.key === flowUnit)!
  const displayVal = toDisplayFlow(flowRate, flowUnit)
  const [raw, setRaw] = useState(parseFloat(displayVal.toFixed(u.dec)).toString())

  const commit = (rawStr: string) => {
    const num = parseFloat(rawStr)
    if (!isNaN(num) && num > 0) {
      const m3s = Math.max(0.0001, toM3s(num, flowUnit))
      onFlowRateChange(m3s)
      setRaw(parseFloat(toDisplayFlow(m3s, flowUnit).toFixed(u.dec)).toString())
    } else {
      setRaw(parseFloat(displayVal.toFixed(u.dec)).toString())
    }
  }

  return (
    <div className="mb-5">
      <div className="flex justify-between items-center mb-2">
        <span className="text-[11px] font-semibold tracking-wide" style={{ color: 'var(--muted)' }}>設計流量（Q）</span>
        <select value={flowUnit}
          onChange={e => {
            const nu = e.target.value as FlowUnit
            const newU = FLOW_UNITS.find(fu => fu.key === nu)!
            setRaw(parseFloat(toDisplayFlow(flowRate, nu).toFixed(newU.dec)).toString())
            onUnitChange(nu)
          }}
          style={{
            fontSize: 10, background: 'var(--surface2)', border: '1px solid var(--border)',
            color: 'var(--accent)', padding: '2px 6px', outline: 'none', cursor: 'pointer',
            fontFamily: "'JetBrains Mono', monospace",
          }}>
          {FLOW_UNITS.map(fu => <option key={fu.key} value={fu.key}>{fu.label}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <input type="range" min={0} max={u.max} step={u.step} value={displayVal}
          onChange={e => {
            const v = Math.max(0.0001, toM3s(parseFloat(e.target.value), flowUnit))
            setRaw(parseFloat(toDisplayFlow(v, flowUnit).toFixed(u.dec)).toString())
            onFlowRateChange(v)
          }}
          className="flex-1" />
        <input type="text" inputMode="decimal" value={raw}
          onChange={e => setRaw(e.target.value)}
          onBlur={() => commit(raw)}
          onKeyDown={e => e.key === 'Enter' && commit(raw)}
          style={{
            width: 72, background: 'var(--surface2)', border: '1px solid var(--border)',
            color: 'var(--accent)', textAlign: 'right', padding: '4px 6px',
            fontSize: 12, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, outline: 'none',
            flexShrink: 0,
          }} />
      </div>
      <div className="flex justify-between mt-1 pr-20">
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>0 {u.label}</span>
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>{u.max.toLocaleString()} {u.label}</span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'right', marginTop: 2 }}>
        = {flowRate.toFixed(4)} m³/s
      </div>
    </div>
  )
}

// ─── SliderInput ─────────────────────────────────────────────
function SliderInput({ label, id, value, min, max, step, unit, dec = 1, onChange }:
  { label: string; id: string; value: number; min: number; max: number; step: number; unit: string; dec?: number; onChange: (v: number) => void }
) {
  const [raw, setRaw] = useState(parseFloat(value.toFixed(dec)).toString())
  const isFocused = useRef(false)

  useEffect(() => {
    if (!isFocused.current) setRaw(parseFloat(value.toFixed(dec)).toString())
  }, [value, dec])

  const commit = (rawStr: string) => {
    const num = parseFloat(rawStr)
    if (!isNaN(num)) {
      const clamped = Math.min(max, Math.max(min, num))
      setRaw(clamped.toFixed(dec)); onChange(clamped)
    } else { setRaw(parseFloat(value.toFixed(dec)).toString()) }
  }

  const pct = ((value - min) / (max - min)) * 100

  return (
    <div className="mb-5">
      <div className="flex justify-between items-center mb-2">
        <label htmlFor={id} style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.03em', color: 'var(--muted)' }}>{label}</label>
        <div className="flex items-center gap-1.5">
          <input id={id} type="text" inputMode="decimal" value={raw}
            onFocus={() => { isFocused.current = true }}
            onChange={e => setRaw(e.target.value)}
            onBlur={() => { isFocused.current = false; commit(raw) }}
            onKeyDown={e => { if (e.key === 'Enter') commit(raw) }}
            style={{
              width: 66, textAlign: 'right', fontSize: 12, fontWeight: 700,
              background: 'var(--surface2)', border: '1px solid var(--border)',
              color: 'var(--accent)', padding: '3px 6px', outline: 'none',
              fontFamily: "'JetBrains Mono', monospace",
            }} />
          <span style={{ fontSize: 10, color: 'var(--muted)', width: 32, textAlign: 'right', flexShrink: 0 }}>{unit}</span>
        </div>
      </div>
      <div className="relative" style={{ height: 1, background: 'var(--border)' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, width: pct + '%', height: '100%', background: 'var(--accent)', transition: 'width 0.05s' }} />
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ marginTop: -1, display: 'block', width: '100%' }} />
      <div className="flex justify-between" style={{ marginTop: 2 }}>
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>{min} {unit}</span>
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>{max} {unit}</span>
      </div>
    </div>
  )
}

// ─── メインコンポーネント ─────────────────────────────────────
export default function DashboardClient(_props: Props) {
  const [hqRanges, setHqRanges] = useState<HQRange[]>([])
  const [nsRanges, setNsRanges] = useState<NsRange[]>([])
  const [inputs, setInputs] = useState<TurbineInputs>(DEFAULT_INPUTS)
  const [forcedType, setForcedType] = useState<TurbineType | null>(null)
  const [results, setResults] = useState<TurbineResults>(() => calculate(DEFAULT_INPUTS, undefined, []))
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [saving, setSaving] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)
  const [showNspCompare, setShowNspCompare] = useState(false)
  const [diameterEvalKey, setDiameterEvalKey] = useState<string | null>(null)
  const [diameterEvalResult, setDiameterEvalResult] = useState<RunnerDiameterCandidate[] | null>(null)
  const [diameterEvalLoading, setDiameterEvalLoading] = useState(false)
  const [exportName, setExportName] = useState('')
  const [exportLoading, setExportLoading] = useState<string | null>(null)
  const [importMsg, setImportMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const importFileRef = useRef<HTMLInputElement>(null)
  const [sidebarTab, setSidebarTab] = useState<'history' | 'projects'>('history')
  const [rightPaneOpen, setRightPaneOpen] = useState(false)
  const [mainTab, setMainTab] = useState<'result' | 'hq' | 'ns' | 'schematic' | 'velocity' | 'francis_detail' | 'francis_drawings' | 'hill_chart' | 'kame'>('result')
  const [theme, setTheme] = useState<'dark' | 'light'>('light')
  // 高コントラスト（プロジェクター）表示。明るい部屋での投影向け。設定はブラウザに保存する
  const [proj, setProj] = useState(false)
  useEffect(() => { try { setProj(window.localStorage.getItem('hpp.proj') === '1') } catch { /* 保存できない環境では既定のまま */ } }, [])
  const toggleProj = () => setProj(v => { const n = !v; try { window.localStorage.setItem('hpp.proj', n ? '1' : '0') } catch { /* 無視 */ } return n })
  const [flowUnit, setFlowUnit] = useState<FlowUnit>('m3/s')
  const router = useRouter()
  const supabase = createClient()
  const [userEmail, setUserEmail] = useState('')

  // ── クライアント側でデータを非同期取得（SSRのDB待ちを排除）──
  useEffect(() => {
    // ユーザー情報取得
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUserEmail(data.user.email ?? '')
    })

    // 履歴・プロジェクト
    const sb = supabase as any
    sb.from('calculations').select('*').order('created_at', { ascending: false }).limit(20)
      .then(({ data }: any) => { if (data) setHistory(data) })
    sb.from('projects').select('*').order('updated_at', { ascending: false })
      .then(({ data }: any) => { if (data) setProjects(data) })

    // HQ/Ns範囲データ（selection-ranges の fetch をクライアント側で再実装）
    sb.from('hq_ranges').select(`
      id, turbine_type_id, boundary_points,
      h_min, h_max, q_min, q_max, source, note, version,
      turbine_types ( id, name, icon, color, sort_order, is_active )
    `).eq('is_active', true).order('turbine_type_id')
      .then(({ data }: any) => {
        if (!data) return
        setHqRanges(data.map((r: any) => ({
          id: r.id, turbineTypeId: r.turbine_type_id,
          turbineType: {
            id: r.turbine_types.id, name: r.turbine_types.name,
            icon: r.turbine_types.icon, color: r.turbine_types.color,
            sortOrder: r.turbine_types.sort_order, isActive: r.turbine_types.is_active,
          },
          boundaryPoints: r.boundary_points as { q: number; h: number }[],
          hMin: Number(r.h_min), hMax: Number(r.h_max),
          qMin: Number(r.q_min), qMax: Number(r.q_max),
          source: r.source, note: r.note, version: r.version,
        })))
      })

    sb.from('ns_ranges').select(`
      id, turbine_type_id,
      ns_min, ns_max, overlap_note,
      nsp_target_min, nsp_target_max, nsp_target_step,
      source, note, version,
      turbine_types ( id, name, icon, color, sort_order, is_active )
    `).eq('is_active', true).order('turbine_type_id')
      .then(({ data }: any) => {
        if (!data) return
        const ranges = data.map((r: any) => ({
          id: r.id, turbineTypeId: r.turbine_type_id,
          turbineType: {
            id: r.turbine_types.id, name: r.turbine_types.name,
            icon: r.turbine_types.icon, color: r.turbine_types.color,
            sortOrder: r.turbine_types.sort_order, isActive: r.turbine_types.is_active,
          },
          nsMin: Number(r.ns_min), nsMax: Number(r.ns_max),
          overlapNote: r.overlap_note,
          nspTargetMin:  r.nsp_target_min  !== null && r.nsp_target_min  !== undefined ? Number(r.nsp_target_min)  : null,
          nspTargetMax:  r.nsp_target_max  !== null && r.nsp_target_max  !== undefined ? Number(r.nsp_target_max)  : null,
          nspTargetStep: r.nsp_target_step !== null && r.nsp_target_step !== undefined ? Number(r.nsp_target_step) : null,
          source: r.source, note: r.note, version: r.version,
        }))
        setNsRanges(ranges)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const update = useCallback((patch: Partial<TurbineInputs>) => {
    setInputs(prev => {
      const next = { ...prev, ...patch }
      setResults(calculate(next, forcedType ?? undefined, nsRangesRef.current))
      return next
    })
  }, [forcedType])

  const handleForcedType = useCallback((type: TurbineType | null) => {
    setForcedType(type)
    setInputs(prev => { setResults(calculate(prev, type ?? undefined, nsRangesRef.current)); return prev })
  }, [])

  const set = (key: keyof TurbineInputs) => (v: number) => update({ [key]: v })

  const typeColor =
    results.turbineType === 'ペルトン水車'     ? '#a78bfa'
    : results.turbineType === 'フランシス水車' ? '#38bdf8'
    : results.turbineType === 'カプラン水車'   ? '#34d399'
    : results.turbineType === 'クロスフロー水車' ? '#fb923c'
    : '#f472b6'  // チューブラ水車

  const effChartRef = useRef<HTMLDivElement>(null)

  // nsRanges が揃ったら results を1回だけ再計算（フェッチ完了後）
  const nsRangesRef = useRef<typeof nsRanges>([])
  useEffect(() => {
    if (nsRanges.length === 0) return
    nsRangesRef.current = nsRanges
    setResults(calculate(inputs, forcedType ?? undefined, nsRanges))
  // inputsやforcedTypeが変わっても不要に再計算しない（nsRanges到着時の1回のみ）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nsRanges])

  // フランシス水車かつ詳細設計データがある場合は1d損失モデルを非同期で計算
  // 計算中はフォールバック曲線を表示してUIブロックを防ぐ
  const [francis1dData, setFrancis1dData] = useState<Array<Record<string, number>> | null>(null)
  const [eff1dLoading, setEff1dLoading] = useState(false)

  useEffect(() => {
    const detail = results.dimensions.francisDetail
    if (results.turbineType !== 'フランシス水車' || !detail) {
      setFrancis1dData(null)
      return
    }
    setEff1dLoading(true)
    let cancelled = false
    const tid = setTimeout(() => {
      if (cancelled) return
      try {
        const pts = calcFrancisEfficiencyCurve(detail!, inputs.head, results.ratedRpm)
        if (pts.length >= 3) { 
          const mapped = pts.map(p => ({
            Q:    Math.round(p.Q * 1000) / 1000,
             eta:  Math.round(p.eta  * 1000) / 10,
            etah: Math.round(p.etah * 1000) / 10,
            etal: Math.round(p.etal * 1000) / 10,
            etam: Math.round(p.etam * 1000) / 10,
          }))
          console.log('[効率曲線] プロット点 (Q, eta):', mapped.map(p => ({ Q: p.Q, eta: p.eta })))
          setFrancis1dData(mapped)
        } else {
          setFrancis1dData(null)
        }
      } catch(e) {
        console.error('[1d] error:', e)
        setFrancis1dData(null)
      }
      setEff1dLoading(false)
    }, 100)
    return () => { cancelled = true; clearTimeout(tid) }
  }, [results.turbineType, results.dimensions.francisDetail, inputs.head, results.ratedRpm])

  const downloadEffChart = useCallback(async () => {
    if (!effChartRef.current) return
    const { default: html2canvas } = await import('html2canvas')
    const canvas = await html2canvas(effChartRef.current, {
      backgroundColor: '#ffffff',
      scale: 2,
    })
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = 'efficiency_curve.png'
    a.click()
  }, [])

  const effDataFallback = useMemo(() => {
    const fakeResults = { ...results, dimensions: { ...results.dimensions, francisDetail: undefined } }
    return getEfficiencyCurve(fakeResults as unknown as typeof results, inputs.turbineEff / 100)
  }, [results.turbineType, inputs.turbineEff])
  const effData = francis1dData ?? effDataFallback

  const handleSave = async () => {
    if (!saveName.trim()) return
    setSaving(true)
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) { setSaving(false); return }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).from('calculations').insert({
      user_id: authUser.id, project_id: selectedProjectId || null, name: saveName,
      head: inputs.head, flow_rate: inputs.flowRate, turbine_eff: inputs.turbineEff,
      generator_eff: inputs.generatorEff, suction_head: inputs.suctionHead,
      altitude: inputs.altitude, frequency: inputs.frequency,
      turbine_type: results.turbineType, turbine_power: results.turbinePower,
      generator_power: results.generatorPower, specific_speed: results.specificSpeed,
      rated_rpm: results.ratedRpm, poles: results.poles, runaway_speed: results.runawaySpeed,
      cavitation_coef: results.cavitationCoef, hs_max: results.hsMax,
      atm_pressure: results.atmPressure, check_cavitation: results.checks.cavitation.result,
      check_ns: results.checks.specificSpeed.result, check_altitude: results.checks.altitude.result,
    }).select().single()
    if (!error && data) {
      setHistory(prev => [data as unknown as HistoryRow, ...prev.slice(0, 19)])
      setShowSaveModal(false); setSaveName('')
    }
    setSaving(false)
  }

  const handleLogout = async () => { await supabase.auth.signOut(); router.push('/auth/login') }
  const handleExportJSON  = () => { exportJSON(inputs, results, exportName || results.turbineType); setShowExportModal(false) }
  const handleExportCSV   = () => { exportCSV(inputs, results, exportName || results.turbineType);  setShowExportModal(false) }
  const handleExportExcel = async () => {
    setExportLoading('excel')
    try { await exportExcel(inputs, results, exportName || results.turbineType) } catch (e) { console.error(e) }
    finally { setExportLoading(null); setShowExportModal(false) }
  }
  const handleExportDXF = async () => {
    setExportLoading('dxf')
    try { await exportDXF(results, exportName || results.turbineType, inputs) } catch (e) { console.error(e) }
    finally { setExportLoading(null); setShowExportModal(false) }
  }

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setImportMsg(null)
    try {
      const payload = await importJSON(file)
      setInputs(payload.inputs); setResults(calculate(payload.inputs, forcedType ?? undefined, nsRangesRef.current))
      setImportMsg({ type: 'ok', text: `「${payload.caseName}」を読み込みました` })
    } catch (err) {
      setImportMsg({ type: 'err', text: err instanceof Error ? err.message : '読み込みエラー' })
    }
    if (importFileRef.current) importFileRef.current.value = ''
    setTimeout(() => setImportMsg(null), 4000)
  }

  const loadHistory = async (id: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any).from('calculations').select('*').eq('id', id).single()
    if (!data) return
    const restored: TurbineInputs = {
      head: data.head, flowRate: data.flow_rate, turbineEff: data.turbine_eff,
      generatorEff: data.generator_eff, suctionHead: data.suction_head,
      altitude: data.altitude, frequency: data.frequency as 50 | 60,
      powerFactor: data.power_factor ?? 0.85, operatingHours: data.operating_hours ?? 8000,
      capacityFactor: data.capacity_factor ?? 70,
      penstock: { length: data.penstock_length ?? 500, material: data.penstock_material ?? 'steel' },
      targetNs: data.target_ns ?? 160,
    }
    setInputs(restored); setResults(calculate(restored, forcedType ?? undefined, nsRangesRef.current))
  }

  const fu = FLOW_UNITS.find(u => u.key === flowUnit)!

  const ModalBack = ({ children }: { children: React.ReactNode }) => (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16,
    }}>
      <div className="panel" style={{
        background: 'var(--surface)', width: '100%', maxWidth: 380, padding: 24,
        boxShadow: '0 24px 48px rgba(0,0,0,0.4)',
      }}>
        {children}
      </div>
    </div>
  )

  const selStyle: React.CSSProperties = {
    background: 'var(--surface2)', border: '1px solid var(--border)',
    color: 'var(--text)', padding: '6px 10px', fontSize: 12, outline: 'none',
    fontFamily: "'Space Grotesk', sans-serif", cursor: 'pointer', width: '100%',
  }
  const inputStyle: React.CSSProperties = {
    background: 'var(--surface2)', border: '1px solid var(--border)',
    color: 'var(--text)', padding: '6px 10px', fontSize: 12, outline: 'none',
    fontFamily: "'Space Grotesk', sans-serif", width: '100%',
  }

  return (
    <div className={`min-h-screen flex flex-col ${theme}${proj ? ' proj' : ''}`} style={{ background: 'var(--bg)' }}>

      {/* ── Header ── */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0 20px',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, var(--accent), ${typeColor})` }} />
        <div className="flex items-center gap-4" style={{ height: 52 }}>
          <div style={{ width: 32, height: 32, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: 'var(--surface2)' }}>
            <div style={{ width: 14, height: 14, background: typeColor, clipPath: 'polygon(50% 0%,100% 50%,50% 100%,0% 50%)', transition: 'background 0.3s' }} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text)', lineHeight: 1.2 }}>水車選定ツール</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 12px', border: '1px solid var(--border)', background: 'var(--surface2)', marginLeft: 8 }}>
            <div style={{ width: 6, height: 6, background: typeColor, clipPath: 'polygon(50% 0%,100% 50%,50% 100%,0% 50%)' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: typeColor, letterSpacing: '0.04em' }}>{results.turbineType}</span>
            <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: "'JetBrains Mono', monospace" }}>
              {results.turbinePower.toFixed(0)} kW · Ns {results.specificSpeed.toFixed(0)}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <span style={{ fontSize: 11, color: 'var(--muted)', marginRight: 4 }} className="hidden sm:block">{userEmail}</span>
            <button onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} className="btn" style={{ padding: '4px 8px', fontSize: 13 }}>
              {theme === 'dark' ? '☀' : '☾'}
            </button>
            <button onClick={toggleProj} className="btn" aria-pressed={proj} title="プロジェクター表示（高コントラスト）"
              style={{ padding: '4px 8px', fontSize: 12, ...(proj ? { background: '#000000', color: '#ffffff' } : {}) }}>
              🖥 投影
            </button>
            <input ref={importFileRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
            <button onClick={() => importFileRef.current?.click()} className="btn">読込</button>
            <button onClick={() => { setExportName(results.turbineType); setShowExportModal(true) }} className="btn btn-ok">出力</button>
            <button onClick={() => setShowSaveModal(true)} className="btn btn-accent">保存</button>
            <button onClick={handleLogout} className="btn">ログアウト</button>
          </div>
        </div>
      </header>

      {importMsg && (
        <div style={{
          position: 'fixed', top: 60, right: 16, zIndex: 200,
          padding: '8px 14px', border: `1px solid ${importMsg.type === 'ok' ? 'var(--ok)' : 'var(--ng)'}`,
          background: 'var(--surface)', fontSize: 11, fontWeight: 600,
          color: importMsg.type === 'ok' ? 'var(--ok)' : 'var(--ng)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
        }}>
          {importMsg.text}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT: Inputs ── */}
        <aside style={{ width: 310, flexShrink: 0, background: 'var(--surface)', borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '16px 16px 24px' }}>

          {/* 水車種類選択 — GitHubの新機能 */}
          <div className="sec-hd">水車種類</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 18 }}>
            <button onClick={() => handleForcedType(null)}
              style={{
                gridColumn: '1/-1', padding: '7px 0', fontSize: 11, fontWeight: 700,
                border: `1px solid ${forcedType === null ? 'var(--accent)' : 'var(--border)'}`,
                background: forcedType === null ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--surface2)',
                color: forcedType === null ? 'var(--accent)' : 'var(--muted)',
                cursor: 'pointer', transition: 'all 0.15s', letterSpacing: '0.04em',
              }}>
              🔄 自動選択（推奨）
            </button>
            {([
              // is_active な水車形式のみ表示（DBの turbine_types.is_active で制御）
              ...nsRanges
                .filter(r => r.turbineType.isActive)
                .sort((a, b) => a.turbineType.sortOrder - b.turbineType.sortOrder)
                .map(r => ({
                  type: r.turbineType.name as TurbineType,
                  color: r.turbineType.color,
                  note: `Ns ${r.nsMin}〜${r.nsMax}`,
                })),
            ]).map(({ type, color, note }) => (
              <button key={type} onClick={() => handleForcedType(type)}
                style={{
                  padding: '6px 0', fontSize: 10, fontWeight: 600,
                  border: `1px solid ${forcedType === type ? color : 'var(--border)'}`,
                  background: forcedType === type ? `color-mix(in srgb, ${color} 10%, transparent)` : 'var(--surface2)',
                  color: forcedType === type ? color : 'var(--muted)',
                  cursor: 'pointer', transition: 'all 0.15s', lineHeight: 1.4,
                }}>
                <div>{type.replace('水車', '')}</div>
                <div style={{ fontSize: 8, opacity: 0.7, fontWeight: 400 }}>{note}</div>
              </button>
            ))}
          </div>
          {forcedType && (
            <div style={{ marginBottom: 16, padding: '8px 10px', border: '1px solid var(--border)', borderLeft: '2px solid var(--warn)', background: 'color-mix(in srgb, var(--warn) 6%, transparent)', fontSize: 11, color: 'var(--warn)', lineHeight: 1.6 }}>
              ⚠ 強制指定モード：条件に最適でない水車も計算できますが、判定結果にご注意ください。
            </div>
          )}

          <div className="sec-hd">基本パラメータ</div>
          <SliderInput label="有効落差（H）" id="H" value={inputs.head} min={2} max={1000} step={0.1} unit="m" dec={1} onChange={set('head')} />
          <FlowRateInput flowRate={inputs.flowRate} flowUnit={flowUnit}
            onFlowRateChange={v => update({ flowRate: v })} onUnitChange={setFlowUnit} />
          <SliderInput label="水車効率 上限（η_t）" id="eta_t" value={inputs.turbineEff}   min={70}  max={95}   step={0.1} unit="%" dec={1} onChange={set('turbineEff')} />
          {results.predictedEff !== null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: -4, marginBottom: 4, paddingLeft: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>比速度多項式推定：</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#34d399', fontFamily: 'var(--font-mono)' }}>
                η_pred = {(results.predictedEff * 100).toFixed(2)} %
              </span>
              <span style={{ fontSize: 10, color: 'var(--muted)' }}>(実計算に使用)</span>
            </div>
          )}
          <SliderInput label="発電機効率（η_g）" id="eta_g" value={inputs.generatorEff} min={90}  max={99}   step={0.1} unit="%" dec={1} onChange={set('generatorEff')} />

          <div className="sec-hd" style={{ marginTop: 16 }}>回転数選定</div>
          <SliderInput label="目標比速度（Ns_target）" id="targetNs" value={inputs.targetNs} min={50} max={500} step={5} unit="" dec={0} onChange={v => update({ targetNs: v })} />

          <div className="sec-hd" style={{ marginTop: 16 }}>設置条件</div>
          <SliderInput label="吸出し高さ（Hs）" id="Hs"  value={inputs.suctionHead} min={-5} max={15}   step={0.1} unit="m" dec={1} onChange={set('suctionHead')} />
          <SliderInput label="設置標高"          id="alt" value={inputs.altitude}    min={0}  max={3000} step={10}  unit="m" dec={0} onChange={set('altitude')} />

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 8, letterSpacing: '0.03em' }}>電源周波数（f）</div>
            <div className="flex gap-1.5">
              {([50, 60] as const).map(f => (
                <button key={f} onClick={() => update({ frequency: f })}
                  style={{
                    flex: 1, padding: '7px 0', fontSize: 12, fontWeight: 700,
                    border: `1px solid ${inputs.frequency === f ? 'var(--accent)' : 'var(--border)'}`,
                    background: inputs.frequency === f ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--surface2)',
                    color: inputs.frequency === f ? 'var(--accent)' : 'var(--muted)',
                    cursor: 'pointer', transition: 'all 0.15s', fontFamily: "'JetBrains Mono', monospace",
                  }}>
                  {f} Hz<br />
                  <span style={{ fontSize: 9, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 400 }}>{f === 50 ? '東日本' : '西日本'}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="sec-hd" style={{ marginTop: 16 }}>電気系パラメータ</div>
          <SliderInput label="力率（cos φ）" id="pf" value={inputs.powerFactor}    min={0.70} max={1.00} step={0.01} unit=""     dec={2} onChange={v => update({ powerFactor: v })} />
          <SliderInput label="年間稼働時間"   id="oh" value={inputs.operatingHours} min={1000} max={8760} step={100}  unit="h/年" dec={0} onChange={v => update({ operatingHours: v })} />
          <SliderInput label="設備利用率"     id="cf" value={inputs.capacityFactor} min={10}   max={100}  step={1}    unit="%"    dec={0} onChange={v => update({ capacityFactor: v })} />

          <div className="sec-hd" style={{ marginTop: 16 }}>導水管パラメータ</div>
          <SliderInput label="導水管延長" id="pl" value={inputs.penstock.length} min={10} max={5000} step={10} unit="m" dec={0}
            onChange={v => update({ penstock: { ...inputs.penstock, length: v } })} />
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 8, letterSpacing: '0.03em' }}>管種</div>
            <div className="flex gap-1.5">
              {([{ key: 'steel', label: '鋼管' }, { key: 'ductile', label: 'ダクタイル' }, { key: 'frp', label: 'FRP' }] as const).map(m => (
                <button key={m.key} onClick={() => update({ penstock: { ...inputs.penstock, material: m.key } })}
                  style={{
                    flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 600,
                    border: `1px solid ${inputs.penstock.material === m.key ? 'var(--accent)' : 'var(--border)'}`,
                    background: inputs.penstock.material === m.key ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--surface2)',
                    color: inputs.penstock.material === m.key ? 'var(--accent)' : 'var(--muted)',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* ── CENTER: Results ── */}
        <main className="flex-1 overflow-y-auto min-w-0 flex flex-col" style={{ background: 'var(--bg)' }}>
          <div style={{ display: 'flex', gap: 0, padding: '0 16px', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
	{([{ id: 'result', label: '計算結果' }, { id: 'hq', label: 'H-Q 選定図' }, { id: 'ns', label: 'Ns 分布図' }, { id: 'schematic', label: '📐 概略図' }, { id: 'velocity', label: '🔺 速度三角形' }] as const).map(tab => (
              <button key={tab.id} onClick={() => setMainTab(tab.id)} className={`tab ${mainTab === tab.id ? 'active' : ''}`}>{tab.label}</button>
            ))}
            {results.turbineType === 'フランシス水車' && (
              <button onClick={() => setMainTab('francis_detail')} className={`tab ${mainTab === 'francis_detail' ? 'active' : ''}`}
                style={{ color: mainTab === 'francis_detail' ? '#38bdf8' : undefined }}>
                🔩 詳細設計
              </button>
            )}
            {results.turbineType === 'フランシス水車' && (
              <button onClick={() => setMainTab('francis_drawings')} className={`tab ${mainTab === 'francis_drawings' ? 'active' : ''}`}
                style={{ color: mainTab === 'francis_drawings' ? '#38bdf8' : undefined }}>
                📐 設計図面
              </button>
            )}
            {results.turbineType === 'フランシス水車' && (
              <button onClick={() => setMainTab('hill_chart')} className={`tab ${mainTab === 'hill_chart' ? 'active' : ''}`}
                style={{ color: mainTab === 'hill_chart' ? '#38bdf8' : undefined }}>
                📈 性能曲線
              </button>
            )}
            {results.turbineType === 'フランシス水車' && (
              <button onClick={() => setMainTab('kame')} className={`tab ${mainTab === 'kame' ? 'active' : ''}`}
                style={{ color: mainTab === 'kame' ? '#38bdf8' : undefined }}>
                🐢 亀の甲
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto" style={{ padding: 16 }}>

            {/* ══ TAB: 計算結果 ══ */}
            {mainTab === 'result' && (<>
              <div className="panel" style={{ padding: 16, marginBottom: 12 }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${typeColor}, transparent)` }} />
                <div className="flex items-start gap-4 mb-4">
                  <div style={{ width: 48, height: 48, border: `1px solid ${typeColor}40`, background: `${typeColor}10`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' }}>
                    <div style={{ width: 20, height: 20, background: typeColor, clipPath: 'polygon(50% 0%,100% 50%,50% 100%,0% 50%)' }} />
                    {[[0,0],[48,0],[0,48],[48,48]].map(([x,y],i) => (
                      <div key={i} style={{ position: 'absolute', width: 3, height: 3, background: `${typeColor}80`, top: y === 0 ? -1 : 'auto', bottom: y === 48 ? -1 : 'auto', left: x === 0 ? -1 : 'auto', right: x === 48 ? -1 : 'auto' }} />
                    ))}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div style={{ fontSize: 20, fontWeight: 700, color: typeColor, letterSpacing: '0.02em', lineHeight: 1.2 }}>{results.turbineType}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.06em' }}>
                      H={inputs.head}m · Q={toDisplayFlow(inputs.flowRate, flowUnit).toFixed(fu.dec)} {fu.label} · {inputs.frequency}Hz · Ns={results.specificSpeed.toFixed(1)}
                      {forcedType && <span style={{ color: 'var(--warn)', marginLeft: 8 }}>【強制指定】</span>}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 12 }}>
                  {[
                    { label: '水車出力 Pw',  val: results.turbinePower.toFixed(1),   unit: 'kW' },
                    { label: '発電機出力',   val: results.generatorPower.toFixed(1), unit: 'kW' },
                    { label: '比速度 Ns',    val: results.specificSpeed.toFixed(1),  unit: 'm·kW' },
                    { label: '定格回転速度', val: Math.round(results.ratedRpm),      unit: 'rpm' },
                    { label: '極数',         val: results.poles,                     unit: 'P' },
                    { label: '無拘束速度',     val: Math.round(results.runawaySpeed),  unit: 'rpm' },
                    ...(results.predictedEff !== null ? [{ label: '推定最高効率 η_pred', val: (results.predictedEff * 100).toFixed(2), unit: '%' }] : []),
                  ].map(k => (
                    <div key={k.label} className="kpi-tile">
                      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: 'var(--accent)', lineHeight: 1.15 }}>{k.val}</div>
                      <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 3, lineHeight: 1.4 }}>{k.label}<br /><span style={{ fontSize: 8, opacity: 0.7 }}>{k.unit}</span></div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                  {[
                    { label: 'キャビテーション', ...results.checks.cavitation },
                    { label: '比速度の妥当性',   ...results.checks.specificSpeed },
                    { label: '標高・大気圧低下', ...results.checks.altitude },
                    { label: '無拘束速度',         result: 'INFO', message: results.checks.runaway.message },
                  ].map(c => (
                    <div key={c.label} style={{ border: '1px solid var(--border)', background: 'var(--surface2)', padding: '8px 10px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <Badge result={c.result} />
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}>{c.label}</div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.5 }}>{c.message}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {results.nspAlternatives && results.nspAlternatives.length > 0 && (
                <div className="panel" style={{ padding: 14, marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="sec-hd" style={{ marginBottom: 0 }}>🏭 既製品候補（標準Nsp区分）</div>
                    <button
                      onClick={() => setShowNspCompare(v => !v)}
                      style={{
                        fontSize: 10, fontWeight: 700, padding: '4px 10px',
                        border: '1px solid var(--border)', background: showNspCompare ? 'var(--accent)' : 'var(--surface2)',
                        color: showNspCompare ? '#fff' : 'var(--text)', cursor: 'pointer',
                      }}>
                      {showNspCompare ? '表を閉じる' : `比較表を見る（上位${results.nspAlternatives.length}件）`}
                    </button>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', margin: '8px 0 10px', lineHeight: 1.6 }}>
                    特注設計の最適点 Ns={(results.convergedNsp ?? results.specificSpeed).toFixed(1)}（流量 Q={toDisplayFlow(inputs.flowRate, flowUnit).toFixed(fu.dec)} {fu.label}）に対し、既製ラインナップの標準区分（Hs）で近いものをスコア順に表示しています。
                    許容差（±10）以内なら追加設計負担が小さく、既製品での対応が現実的です。理論流量は、その標準区分ちょうどのNspで運転すると仮定した場合に必要な流量です。
                  </div>

                  {!showNspCompare && (
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(results.nspAlternatives.length, 2)}, 1fr)`, gap: 8 }}>
                      {results.nspAlternatives.slice(0, 2).map((alt, i) => {
                        const qDiffPct = alt.targetFlowRate !== null
                          ? ((alt.targetFlowRate - inputs.flowRate) / inputs.flowRate) * 100
                          : null
                        return (
                          <div key={`${alt.turbineType}-${alt.targetNsp}`}
                            style={{
                              border: `1px solid ${alt.withinTolerance ? 'var(--ok, #34d399)' : 'var(--border)'}`,
                              background: alt.withinTolerance ? 'color-mix(in srgb, #34d399 8%, transparent)' : 'var(--surface2)',
                              padding: '10px 12px', position: 'relative',
                            }}>
                            <div style={{ position: 'absolute', top: 8, right: 10, fontSize: 9, fontWeight: 700, color: 'var(--muted)' }}>
                              #{i + 1}
                            </div>
                            <div style={{ fontSize: 9, color: 'var(--muted)', letterSpacing: '0.05em', marginBottom: 2 }}>
                              標準区分 Hs
                            </div>
                            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: alt.withinTolerance ? '#34d399' : 'var(--accent)' }}>
                              {alt.targetNsp}
                            </div>
                            <div style={{ fontSize: 10, marginTop: 6, lineHeight: 1.7 }}>
                              <div>上記実測値との差：<b>{alt.diff.toFixed(1)}</b></div>
                              <div>回転速度：<b>{Math.round(alt.n)}</b> rpm　極数：<b>{alt.poles}</b>P</div>
                              <div>推定効率：<b>{(alt.predictedEff * 100).toFixed(2)}</b> %</div>
                              <div>
                                理論流量：<b>{alt.targetFlowRate !== null ? toDisplayFlow(alt.targetFlowRate, flowUnit).toFixed(fu.dec) : '—'}</b> {fu.label}
                                {qDiffPct !== null && (
                                  <span style={{ color: Math.abs(qDiffPct) > 10 ? 'var(--warn)' : 'var(--muted)' }}>
                                    　（現場流量比 {qDiffPct >= 0 ? '+' : ''}{qDiffPct.toFixed(1)}%）
                                  </span>
                                )}
                              </div>
                            </div>
                            <div style={{ marginTop: 6, fontSize: 9, fontWeight: 700, color: alt.withinTolerance ? '#34d399' : 'var(--warn)' }}>
                              {alt.withinTolerance ? '✓ 許容差内' : '△ 許容差外（要検討）'}
                            </div>

                            {alt.turbineType === 'フランシス水車' && (() => {
                              const key = `${alt.turbineType}-${alt.targetNsp}`
                              const isOpen = diameterEvalKey === key
                              return (
                                <div style={{ marginTop: 8 }}>
                                  <button
                                    onClick={() => {
                                      if (isOpen) { setDiameterEvalKey(null); return }
                                      setDiameterEvalLoading(true)
                                      setDiameterEvalKey(key)
                                      setTimeout(() => {
                                        const d1Theoretical = Math.sqrt(inputs.head) * N11_FRANCIS / alt.n
                                        const candidates = evaluateRunnerDiameterCandidates(
                                          inputs.head, inputs.flowRate, alt.n, alt.targetNsp, d1Theoretical,
                                        )
                                        setDiameterEvalResult(candidates)
                                        setDiameterEvalLoading(false)
                                      }, 0)
                                    }}
                                    style={{
                                      fontSize: 9, fontWeight: 700, padding: '4px 8px', width: '100%',
                                      border: '1px solid var(--border)', background: 'var(--surface2)',
                                      color: 'var(--text)', cursor: 'pointer',
                                    }}>
                                    {isOpen ? '径ごとの性能を閉じる' : '📏 径ごとの性能を見る（±10%）'}
                                  </button>

                                  {isOpen && diameterEvalLoading && (
                                    <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 6 }}>計算中…</div>
                                  )}

                                  {isOpen && !diameterEvalLoading && diameterEvalResult && (
                                    <div style={{ marginTop: 6, overflowX: 'auto' }}>
                                      <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 4, lineHeight: 1.5 }}>
                                        理論径 D1={ (Math.sqrt(inputs.head) * N11_FRANCIS / alt.n).toFixed(3) }m を中心に±10%の径候補で、現場のH・Q・Nでの効率を1次元損失モデルで評価（効率が高い順）。
                                      </div>
                                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9 }}>
                                        <thead>
                                          <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                            {['径D1', '自身の設計H/Q', '現場での効率', '現場での出力', '判定'].map(h => (
                                              <th key={h} style={{ textAlign: 'left', padding: '4px 6px', color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                                            ))}
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {diameterEvalResult.slice(0, 8).map((c, ci) => (
                                            <tr key={ci} style={{ borderBottom: '1px solid var(--border)', background: ci === 0 ? 'color-mix(in srgb, #34d399 8%, transparent)' : 'transparent' }}>
                                              <td style={{ padding: '4px 6px', fontFamily: "'JetBrains Mono', monospace", fontWeight: ci === 0 ? 700 : 400 }}>{c.D1.toFixed(3)}m</td>
                                              <td style={{ padding: '4px 6px' }}>{c.ownRatedHead.toFixed(1)}m / {toDisplayFlow(c.ownRatedFlow, flowUnit).toFixed(fu.dec)}{fu.label}</td>
                                              <td style={{ padding: '4px 6px', fontWeight: ci === 0 ? 700 : 400 }}>{c.siteEta !== null ? (c.siteEta * 100).toFixed(2) + '%' : '—'}</td>
                                              <td style={{ padding: '4px 6px' }}>{c.sitePower !== null ? c.sitePower.toFixed(0) + 'kW' : '—'}</td>
                                              <td style={{ padding: '4px 6px', color: c.outOfRange ? 'var(--warn)' : 'var(--muted)' }}>
                                                {ci === 0 ? '★最適' : c.outOfRange ? '範囲外挿' : ''}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              )
                            })()}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {showNspCompare && (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border)' }}>
                            {['順位', '形式', 'Hs / Ns', '差', '流量Q', '流量差', '回転速度', '極数', '推定効率', '判定'].map(h => (
                              <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
                            <td style={{ padding: '6px 8px', fontWeight: 700 }}>実測</td>
                            <td style={{ padding: '6px 8px' }}>{results.turbineType}</td>
                            <td style={{ padding: '6px 8px', fontFamily: "'JetBrains Mono', monospace" }}>{(results.convergedNsp ?? results.specificSpeed).toFixed(1)}</td>
                            <td style={{ padding: '6px 8px' }}>—</td>
                            <td style={{ padding: '6px 8px', fontFamily: "'JetBrains Mono', monospace" }}>{toDisplayFlow(inputs.flowRate, flowUnit).toFixed(fu.dec)} {fu.label}</td>
                            <td style={{ padding: '6px 8px' }}>—</td>
                            <td style={{ padding: '6px 8px' }}>{Math.round(results.ratedRpm)} rpm</td>
                            <td style={{ padding: '6px 8px' }}>{results.poles}P</td>
                            <td style={{ padding: '6px 8px' }}>{results.predictedEff !== null ? (results.predictedEff * 100).toFixed(2) + '%' : '—'}</td>
                            <td style={{ padding: '6px 8px', fontWeight: 700 }}>基準</td>
                          </tr>
                          {results.nspAlternatives.map((alt, i) => {
                            const qDiffPct = alt.targetFlowRate !== null
                              ? ((alt.targetFlowRate - inputs.flowRate) / inputs.flowRate) * 100
                              : null
                            return (
                              <tr key={`${alt.turbineType}-${alt.targetNsp}`} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '6px 8px', fontWeight: 700 }}>#{i + 1}</td>
                                <td style={{ padding: '6px 8px' }}>{alt.turbineType}</td>
                                <td style={{ padding: '6px 8px', fontFamily: "'JetBrains Mono', monospace", color: alt.withinTolerance ? '#34d399' : 'var(--accent)', fontWeight: 700 }}>{alt.targetNsp}</td>
                                <td style={{ padding: '6px 8px' }}>{alt.diff.toFixed(1)}</td>
                                <td style={{ padding: '6px 8px', fontFamily: "'JetBrains Mono', monospace" }}>
                                  {alt.targetFlowRate !== null ? toDisplayFlow(alt.targetFlowRate, flowUnit).toFixed(fu.dec) : '—'} {fu.label}
                                </td>
                                <td style={{ padding: '6px 8px', color: qDiffPct !== null && Math.abs(qDiffPct) > 10 ? 'var(--warn)' : 'var(--muted)' }}>
                                  {qDiffPct !== null ? `${qDiffPct >= 0 ? '+' : ''}${qDiffPct.toFixed(1)}%` : '—'}
                                </td>
                                <td style={{ padding: '6px 8px' }}>{Math.round(alt.n)} rpm</td>
                                <td style={{ padding: '6px 8px' }}>{alt.poles}P</td>
                                <td style={{ padding: '6px 8px' }}>{(alt.predictedEff * 100).toFixed(2)}%</td>
                                <td style={{ padding: '6px 8px', fontWeight: 700, color: alt.withinTolerance ? '#34d399' : 'var(--warn)' }}>
                                  {alt.withinTolerance ? '✓ 許容差内' : '△ 許容差外'}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
                {[{ label: '管路損失', ...results.checks.headLoss }, { label: '水撃圧', ...results.checks.waterHammer }].map(c => (
                  <div key={c.label} className="panel" style={{ padding: '8px 10px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <Badge result={c.result} />
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}>{c.label}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.5 }}>{c.message}</div>
                    </div>
                  </div>
                ))}
              </div>

              {results.dimensions.pelton && (
                <div className="panel" style={{ padding: 14, marginBottom: 10 }}>
                  <div className="sec-hd">💧 ペルトン水車　専用パラメータ</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
                    {[
                      ['ジェット数 J', `${results.dimensions.pelton.numJets} 本`],
                      ['ジェット径 d', `${(results.dimensions.pelton.jetDiameter * 1000).toFixed(1)} mm`],
                      ['D/d 比', results.dimensions.pelton.dOverD.toFixed(2)],
                      ['バケット内幅 B2', `${(results.dimensions.pelton.bucketWidth * 1000).toFixed(1)} mm`],
                      ['D/B 比', results.dimensions.pelton.dOverB.toFixed(2)],
                      ['バケット数', `${results.dimensions.pelton.numBuckets} 枚`],
                      ['最小流量 Qmin', `${(results.dimensions.pelton.minFlow * 1000).toFixed(2)} l/s`],
                      ['ランナーピッチ径 D1', `${(results.dimensions.runnerDiameter * 1000).toFixed(1)} mm`],
                    ].map(([label, val]) => (
                      <div key={label} className="data-row"><span className="data-row-label">{label}</span><span className="data-row-val">{val}</span></div>
                    ))}
                  </div>
                </div>
              )}
              {results.dimensions.francis && (
                <div className="panel" style={{ padding: 14, marginBottom: 10 }}>
                  <div className="sec-hd">🌊 フランシス水車　専用パラメータ</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
                    {[
                      ['アウトレット径 D2e', `${(results.dimensions.francis.outletDiameter * 1000).toFixed(1)} mm`],
                      ['入口径 D01', `${(results.dimensions.francis.inletDiameter * 1000).toFixed(1)} mm`],
                      ['ガイドベーン高さ Bd', `${(results.dimensions.francis.guideVaneHeight * 1000).toFixed(1)} mm`],
                      ['スパイラルケーシング径', `${(results.dimensions.francis.spiralCaseInlet * 1000).toFixed(1)} mm`],
                      ['ランナーブレード数', `${results.dimensions.francisDetail?.Zr ?? results.dimensions.francis.numBlades} 枚`],
                      ['ガイドベーン数', `${results.dimensions.francisDetail?.Zg ?? results.dimensions.francis.numGuideVanes} 枚`],
                      ['最小流量 Qmin', `${(results.dimensions.francis.minFlow * 1000).toFixed(1)} l/s`],
                      ['無拘束時流量 Qr', `${(results.dimensions.francis.flowAtRunaway * 1000).toFixed(1)} l/s`],
                    ].map(([label, val]) => (
                      <div key={label} className="data-row"><span className="data-row-label">{label}</span><span className="data-row-val">{val}</span></div>
                    ))}
                  </div>
                </div>
              )}
              {results.dimensions.crossflow && (
                <div className="panel" style={{ padding: 14, marginBottom: 10 }}>
                  <div className="sec-hd">🌊 クロスフロー水車（Banki-Michell）　専用パラメータ</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
                    {[
                      ['ランナー径 D',   `${(results.dimensions.runnerDiameter * 1000).toFixed(1)} mm`],
                      ['ランナー幅 B',   `${(results.dimensions.crossflow.runnerWidth * 1000).toFixed(1)} mm`],
                      ['B/D 比',        results.dimensions.crossflow.aspectRatio.toFixed(2)],
                      ['ブレード数',     `${results.dimensions.crossflow.numBlades} 枚`],
                      ['入射角',         `${results.dimensions.crossflow.attackAngle}°`],
                      ['最小流量 Qmin', `${(results.dimensions.crossflow.minFlow * 1000).toFixed(2)} l/s`],
                    ].map(([label, val]) => (
                      <div key={label} className="data-row"><span className="data-row-label">{label}</span><span className="data-row-val">{val}</span></div>
                    ))}
                  </div>
                  <div style={{ marginTop: 10, padding: '7px 10px', background: 'color-mix(in srgb, #fb923c 6%, transparent)', border: '1px solid color-mix(in srgb, #fb923c 30%, transparent)', fontSize: 10, color: 'var(--muted)', lineHeight: 1.6 }}>
                    衝動式・横流れ形式。部分負荷特性に優れ、流量変動が大きい小水力サイトに適する。ランナーは製作が容易でメンテナンス性が高い。適用落差：2〜200 m / 適用流量：0.02〜10 m³/s
                  </div>
                </div>
              )}
              {results.dimensions.tubular && (
                <div className="panel" style={{ padding: 14, marginBottom: 10 }}>
                  <div className="sec-hd">💧 チューブラ水車（貫流型）　専用パラメータ</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
                    {[
                      ['ランナー径 D',         `${(results.dimensions.runnerDiameter * 1000).toFixed(1)} mm`],
                      ['ハブ径 Dh',            `${(results.dimensions.tubular.hubDiameter * 1000).toFixed(1)} mm`],
                      ['ハブ比 Dh/D',          results.dimensions.tubular.hubRatio.toFixed(3)],
                      ['ランナーブレード数',    `${results.dimensions.tubular.numBlades} 枚`],
                      ['ガイドベーン数',        `${results.dimensions.tubular.numGuideVanes} 枚`],
                      ['DTコーン角（半角）',    `${results.dimensions.tubular.coneAngle}°`],
                      ['最小流量 Qmin',         `${(results.dimensions.tubular.minFlow * 1000).toFixed(1)} l/s`],
                    ].map(([label, val]) => (
                      <div key={label} className="data-row"><span className="data-row-label">{label}</span><span className="data-row-val">{val}</span></div>
                    ))}
                  </div>
                  <div style={{ marginTop: 10, padding: '7px 10px', background: 'color-mix(in srgb, #f472b6 6%, transparent)', border: '1px solid color-mix(in srgb, #f472b6 30%, transparent)', fontSize: 10, color: 'var(--muted)', lineHeight: 1.6 }}>
                    反動式・水平軸・軸流型。超低落差大流量に適し、河川・農業用水路に多用される。水平設置により土木コスト低減が期待できる。適用落差：2〜30 m / 適用流量：1〜100 m³/s
                  </div>
                </div>
              )}
              {results.dimensions.kaplan && (
                <div className="panel" style={{ padding: 14, marginBottom: 10 }}>
                  <div className="sec-hd">🌀 カプラン水車　専用パラメータ</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
                    {[
                      ['ランナーブレード数', `${results.dimensions.kaplan.numBlades} 枚`],
                      ['ガイドベーン数', `${results.dimensions.kaplan.numGuideVanes} 枚`],
                      ['ハブ径 Dh', `${(results.dimensions.kaplan.hubDiameter * 1000).toFixed(1)} mm`],
                      ['ハブ比 Dh/D', results.dimensions.kaplan.hubRatio.toFixed(3)],
                      ['最小流量 Qmin', `${(results.dimensions.kaplan.minFlow * 1000).toFixed(1)} l/s`],
                    ].map(([label, val]) => (
                      <div key={label} className="data-row"><span className="data-row-label">{label}</span><span className="data-row-val">{val}</span></div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
                {[
                  { title: '📐 寸法系（共通）', rows: [
                    ['ランナー径 D', `${(results.dimensions.runnerDiameter * 1000).toFixed(1)} mm`],
                    ['吸出し管径', results.dimensions.draftTubeDiameter != null ? `${(results.dimensions.draftTubeDiameter * 1000).toFixed(1)} mm` : '—（衝動式）'],
                    ['ケーシング概略径', results.dimensions.casingDiameter != null ? `${(results.dimensions.casingDiameter * 1000).toFixed(1)} mm` : '—'],
                    ['導水管径', `${(results.dimensions.penstockDiameter * 1000).toFixed(1)} mm`],
                    ['導水管流速', `${results.dimensions.penstockVelocity.toFixed(1)} m/s`],
                  ]},
                  { title: '💧 水理・構造系', rows: [
                    ['GD²', `${results.hydraulics.gd2.toFixed(2)} kN·m²`],
                    ['水撃圧 ΔH', `${results.hydraulics.waterHammerHead.toFixed(1)} m`],
                    ['水撃圧上昇率', `+${results.hydraulics.waterHammerRise.toFixed(1)} %`],
                    ['管路損失 hf', `${results.hydraulics.penstock.headLoss.toFixed(2)} m`],
                    ['管路損失率', `${results.hydraulics.penstock.headLossRatio.toFixed(1)} %`],
                  ]},
                  { title: '⚡ 電気系', rows: [
                    ['発電機容量', `${results.electrical.generatorKva.toFixed(1)} kVA`],
                    ['力率', `${(inputs.powerFactor * 100).toFixed(0)} %`],
                    ['年間稼働時間', `${inputs.operatingHours.toLocaleString()} h/年`],
                    ['設備利用率', `${inputs.capacityFactor} %`],
                    ['年間発電量', `${results.electrical.annualEnergy.toFixed(1)} MWh`],
                  ], highlight: results.electrical.annualEnergy >= 1000
                    ? `${results.electrical.annualEnergyGwh.toFixed(3)} GWh`
                    : `${results.electrical.annualEnergy.toFixed(1)} MWh`
                  },
                ].map(card => (
                  <div key={card.title} className="panel" style={{ padding: 14 }}>
                    <div className="sec-hd" style={{ fontSize: 8 }}>{card.title}</div>
                    {card.rows.map(([label, val]) => (
                      <div key={label} className="data-row"><span className="data-row-label">{label}</span><span className="data-row-val">{val}</span></div>
                    ))}
                    {'highlight' in card && card.highlight && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', textAlign: 'center' }}>
                        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ok)', fontFamily: "'JetBrains Mono', monospace" }}>{card.highlight}</div>
                        <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2, letterSpacing: '0.08em' }}>年間発電量</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="panel" style={{ padding: 14 }}>
                  <div className="sec-hd" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>効率曲線 {francis1dData ? 'η(Q) [1次元損失モデル]' : eff1dLoading ? 'η(Q) [計算中…]' : 'η(Q/Qd)'}</span>
                    {francis1dData && (
                      <button onClick={downloadEffChart} style={{ fontSize: 10, padding: '2px 8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 2, cursor: 'pointer', color: 'var(--muted)', fontFamily: 'JetBrains Mono' }}>
                        ↓ PNG
                      </button>
                    )}
                  </div>
                  <div ref={effChartRef}>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={francis1dData ?? effData} margin={{ top: 4, right: 8, left: -10, bottom: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      {francis1dData ? (
                        <XAxis dataKey="Q" type="number"
                          domain={([dataMin, dataMax]: [number, number]) => [Math.floor(dataMin), Math.ceil(dataMax)]}
                          ticks={(() => {
                            if (!francis1dData || francis1dData.length === 0) return []
                            const vals = francis1dData.map((d: Record<string,number>) => d.Q).filter(isFinite)
                            const lo = Math.floor(Math.min(...vals))
                            const hi = Math.ceil(Math.max(...vals))
                            const t = []
                            for (let v = lo; v <= hi; v++) t.push(v)
                            return t
                          })()}
                          tick={{ fontSize: 10, fill: 'var(--muted)', fontFamily: 'JetBrains Mono' }}
                          tickFormatter={(v: number) => v.toFixed(0)}
                          label={{ value: 'Q [m³/s]', position: 'insideBottom', offset: -6, fontSize: 10, fill: 'var(--muted)' }} />
                      ) : (
                        <XAxis dataKey="q" tick={{ fontSize: 10, fill: 'var(--muted)', fontFamily: 'JetBrains Mono' }} tickFormatter={v => v + '%'}
                          label={{ value: 'Q/Qd [%]', position: 'insideBottom', offset: -6, fontSize: 10, fill: 'var(--muted)' }} />
                      )}
                      <YAxis
                        domain={([dataMin, dataMax]: [number, number]) => {
                          const lo = Math.floor(dataMin / 5) * 5
                          const hi = Math.ceil(dataMax / 5) * 5
                          return [lo, hi]
                        }}
                        ticks={(() => {
                          const data = francis1dData ?? effData
                          if (!data || data.length === 0) return [0,20,40,60,80,100]
                          const vals = data.map((d: Record<string,number>) => d.eta ?? d[Object.keys(d).find(k=>k!=='q'&&k!=='Q')??''] ?? 0).filter(isFinite)
                          const lo = Math.floor(Math.min(...vals) / 5) * 5
                          const hi = Math.ceil(Math.max(...vals) / 5) * 5
                          const t = []
                          for (let v = lo; v <= hi; v += 5) t.push(v)
                          return t
                        })()}
                        tick={{ fontSize: 10, fill: 'var(--muted)', fontFamily: 'JetBrains Mono' }} tickFormatter={v => v + '%'}
                        label={{ value: 'η [%]', angle: -90, position: 'insideLeft', offset: 12, fontSize: 10, fill: 'var(--muted)' }} />
                      <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 0, fontSize: 11, fontFamily: 'JetBrains Mono' }}
                        formatter={(v: number, name: string) => [v.toFixed(1) + '%', name]}
                        labelFormatter={(v: number) => francis1dData ? `Q = ${Number(v).toFixed(3)} m³/s` : `Q/Qd = ${v}%`} />
                      {francis1dData ? (
                        <Line type="monotone" dataKey="eta" stroke="#38bdf8" strokeWidth={2} dot={{ r: 3, fill: '#38bdf8' }} name="Total Efficiency" />
                      ) : (
                        [
                          { key: 'フランシス水車',   color: '#38bdf8', dash: '' },
                          { key: 'カプラン水車',     color: '#34d399', dash: '4 3' },
                          { key: 'ペルトン水車',    color: '#a78bfa', dash: '2 2' },
                          { key: 'クロスフロー水車', color: '#fb923c', dash: '6 2' },
                          { key: 'チューブラ水車',   color: '#f472b6', dash: '1 3' },
                        ].map(({ key, color, dash }) => (
                          <Line key={key} type="monotone" dataKey={key}
                            stroke={results.turbineType === key ? color : color + '44'}
                            strokeWidth={results.turbineType === key ? 2 : 1}
                            strokeDasharray={dash} dot={false} />
                        ))
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                  </div>

                {/* 子午面断面図・翼型断面図・3Dは「📐 設計図面」タブに移動済み */}

                {/* ── フランシス水車 ランナーベーン翼断面図 ── */}
                {/* 翼断面図は「📐 設計図面」タブに移動済み */}

                {/* ランナー3Dビューは「📐 設計図面」タブに移動 */}



                <div className="panel" style={{ padding: 14 }}>
                  <div className="sec-hd">詳細計算値</div>
                  <div style={{ overflowY: 'auto', maxHeight: 220 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          {['項目', '値', '区分'].map(h => (
                            <th key={h} style={{ textAlign: 'left', padding: '3px 4px', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--muted)', textTransform: 'uppercase' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['水車形式', results.turbineType, '静的'],
                          ['定格回転速度', Math.round(results.ratedRpm) + ' rpm', '静的'],
                          ['極数', results.poles + ' P', '静的'],
                          ['比速度 Ns', results.specificSpeed.toFixed(2), '静的'],
                          ['水車出力 Pw', results.turbinePower.toFixed(2) + ' kW', '静的'],
                          ['発電機出力 Pe', results.generatorPower.toFixed(2) + ' kW', '静的'],
                          ['無拘束速度', Math.round(results.runawaySpeed) + ' rpm', '動的'],
                          ['許容吸出し高さ', results.hsMax != null ? results.hsMax.toFixed(2) + ' m' : '—', '動的'],
                          ['大気圧（補正後）', results.atmPressure.toFixed(3) + ' kPa', '動的'],
                          ['σ_c（キャビ係数）', results.cavitationCoef != null ? results.cavitationCoef.toFixed(5) : '—', '導出'],
                          ...(results.dimensions.pelton ? [
                            ['── ペルトン ──', '', ''],
                            ['ジェット数 J', String(results.dimensions.pelton.numJets) + ' 本', '導出'],
                            ['ジェット径 d', (results.dimensions.pelton.jetDiameter * 1000).toFixed(1) + ' mm', '導出'],
                            ['D/d 比', results.dimensions.pelton.dOverD.toFixed(2), '導出'],
                            ['バケット内幅 B2', (results.dimensions.pelton.bucketWidth * 1000).toFixed(1) + ' mm', '導出'],
                            ['バケット数', String(results.dimensions.pelton.numBuckets) + ' 枚', '導出'],
                            ['最小流量 Qmin', (results.dimensions.pelton.minFlow * 1000).toFixed(2) + ' l/s', '導出'],
                          ] : []),
                          ...(results.dimensions.francis ? [
                            ['── フランシス ──', '', ''],
                            ['入口径 D01', (results.dimensions.francis.inletDiameter * 1000).toFixed(1) + ' mm', '導出'],
                            ['ガイドベーン高さ', (results.dimensions.francis.guideVaneHeight * 1000).toFixed(1) + ' mm', '導出'],
                            ['ケーシング入口径', (results.dimensions.francis.spiralCaseInlet * 1000).toFixed(1) + ' mm', '導出'],
                            ['ブレード数', String(results.dimensions.francisDetail?.Zr ?? results.dimensions.francis.numBlades) + ' 枚', '導出'],
                            ['最小流量 Qmin', (results.dimensions.francis.minFlow * 1000).toFixed(1) + ' l/s', '導出'],
                            ['無拘束時流量 Qr', (results.dimensions.francis.flowAtRunaway * 1000).toFixed(1) + ' l/s', '導出'],
                          ] : []),
                          ...(results.dimensions.kaplan ? [
                            ['── カプラン ──', '', ''],
                            ['ブレード数', String(results.dimensions.kaplan.numBlades) + ' 枚', '導出'],
                            ['ハブ径 Dh', (results.dimensions.kaplan.hubDiameter * 1000).toFixed(1) + ' mm', '導出'],
                            ['ハブ比 Dh/D', results.dimensions.kaplan.hubRatio.toFixed(3), '導出'],
                            ['最小流量 Qmin', (results.dimensions.kaplan.minFlow * 1000).toFixed(1) + ' l/s', '導出'],
                          ] : []),
                        ].map(([label, val, type], i) => (
                          <tr key={label + i} style={{ borderBottom: '1px solid color-mix(in srgb, var(--border) 60%, transparent)', background: label.startsWith('──') ? 'transparent' : i % 2 === 0 ? 'color-mix(in srgb, var(--accent) 2%, transparent)' : 'transparent' }}>
                            <td style={{ padding: '4px', fontSize: 10, color: label.startsWith('──') ? 'var(--accent)' : 'var(--muted)', fontStyle: label.startsWith('──') ? 'italic' : 'normal' }}>{label}</td>
                            <td style={{ padding: '4px', fontSize: 11, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: 'var(--accent)' }}>{val}</td>
                            <td style={{ padding: '4px', fontSize: 9, color: 'var(--muted)' }}>{type}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>)}

            {/* ══ TAB: H-Q ══ */}
            {mainTab === 'hq' && (
              <div className="panel" style={{ padding: 16 }}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em' }}>H-Q 形式選定図</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>有効落差 H [m] と設計流量 Q [m³/s] による水車形式の適用範囲</div>
                  </div>
                  <div className="flex gap-4">
                    {hqRanges.map(r => (
                      <div key={r.id} className="flex items-center gap-1.5">
                        <div style={{ width: 8, height: 8, background: r.turbineType.color }} />
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{r.turbineType.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <HQChart head={inputs.head} flowRate={inputs.flowRate} turbineType={results.turbineType} hqRanges={hqRanges} flowUnit={flowUnit} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 14 }}>
                  {hqRanges.map(r => {
                    const inRange = inputs.head >= r.hMin && inputs.head <= r.hMax && inputs.flowRate >= r.qMin && inputs.flowRate <= r.qMax
                    return (
                      <div key={r.id} style={{ padding: '10px 12px', border: `1px solid ${inRange ? r.turbineType.color + '60' : 'var(--border)'}`, background: inRange ? `${r.turbineType.color}08` : 'var(--surface2)', transition: 'all 0.15s' }}>
                        <div className="flex items-center gap-2 mb-2">
                          <div style={{ width: 6, height: 6, background: r.turbineType.color }} />
                          <span style={{ fontSize: 12, fontWeight: 600, color: inRange ? r.turbineType.color : 'var(--muted)' }}>{r.turbineType.name}</span>
                          {inRange && <span className="badge badge-ok" style={{ marginLeft: 'auto' }}>適用可</span>}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.8 }}>
                          H: {r.hMin}〜{r.hMax} m<br />Q: {r.qMin}〜{r.qMax} m³/s
                        </div>
                        {r.note && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>{r.note}</div>}
                        {r.source && <div style={{ fontSize: 9, color: 'var(--muted)', opacity: 0.6, marginTop: 2 }}>出典: {r.source}</div>}
                      </div>
                    )
                  })}
                </div>
                <p style={{ fontSize: 10, color: 'var(--muted)', marginTop: 10, textAlign: 'right' }}>※ 適用範囲は一般的な参考値です。詳細は製造者にご確認ください。</p>
              </div>
            )}

            {/* ══ TAB: Ns ══ */}
            {mainTab === 'ns' && (
              <div className="panel" style={{ padding: 16 }}>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em' }}>比速度 Ns 分布図</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>Ns = n × √Pw ÷ H<sup>1.25</sup>　による形式選定の基準</div>
                </div>
                <NsChart ns={results.specificSpeed} turbineType={results.turbineType} nsRanges={nsRanges} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 14 }}>
                  {nsRanges.map(r => {
                    const inRange = results.specificSpeed >= r.nsMin && results.specificSpeed <= r.nsMax
                    return (
                      <div key={r.id} style={{ padding: '10px 12px', border: `1px solid ${inRange ? r.turbineType.color + '60' : 'var(--border)'}`, background: inRange ? `${r.turbineType.color}08` : 'var(--surface2)', transition: 'all 0.15s' }}>
                        <div className="flex items-center gap-2 mb-2">
                          <span style={{ fontSize: 16 }}>{r.turbineType.icon}</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: inRange ? r.turbineType.color : 'var(--muted)' }}>{r.turbineType.name}</span>
                          {inRange && <span className="badge badge-ok" style={{ marginLeft: 'auto' }}>該当</span>}
                        </div>
                        <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: r.turbineType.color, marginBottom: 8 }}>Ns: {r.nsMin} 〜 {r.nsMax}</div>
                        <div style={{ height: 2, background: 'var(--border)' }}>
                          <div style={{ height: '100%', background: r.turbineType.color, opacity: inRange ? 1 : 0.2, width: '100%' }} />
                        </div>
                        {inRange && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8 }}>現在値 Ns = <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: r.turbineType.color }}>{results.specificSpeed.toFixed(1)}</span></div>}
                        {r.overlapNote && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>{r.overlapNote}</div>}
                        {r.source && <div style={{ fontSize: 9, color: 'var(--muted)', opacity: 0.6, marginTop: 2 }}>出典: {r.source}</div>}
                      </div>
                    )
                  })}
                </div>
                <div style={{ marginTop: 12, padding: '10px 12px', border: '1px solid var(--border)', borderLeft: '2px solid var(--accent)', background: 'var(--surface2)', fontSize: 11, color: 'var(--muted)', lineHeight: 1.7 }}>
                  <strong style={{ color: 'var(--text)' }}>Ns の算出式：</strong>　Ns = n × √Pw ÷ H<sup>1.25</sup><br />
                  ペルトンとフランシスの適用範囲（Ns 60〜100）は重複します。フランシスとカプランの境界（Ns 250〜400）も同様です。
                </div>
                <p style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8, textAlign: 'right' }}>※ Ns範囲は一般的な参考値です。詳細は製造者にご確認ください。</p>
              </div>
            )}

            {/* ══ TAB: 概略図 ══ */}
            {mainTab === 'schematic' && (
              <div className="panel" style={{ padding: 16 }}>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em' }}>水車概略断面図</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>計算パラメータに基づく参考図（設計確認用）</div>
                </div>
                <TurbineSchematic results={results} />
              </div>
            )}

            {mainTab === 'velocity' && (
              <VelocityTrianglePanel results={results} color={typeColor} />
            )}

            {/* ══ TAB: フランシス詳細設計 ══ */}
            {mainTab === 'francis_detail' && results.dimensions.francisDetail && (() => {
              const d = results.dimensions.francisDetail
              const mm = (v: number) => `${(v * 1000).toFixed(1)} mm`
              const ms = (v: number) => `${v.toFixed(3)} m/s`
              const deg = (v: number) => `${v.toFixed(2)} °`
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {/* ランナベーン */}
                  <div className="panel" style={{ padding: 14 }}>
                    <div className="sec-hd">🔄 ランナベーン</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
                      {([
                        ['入口径（クラウン側）D₁',  mm(d.D1)],
                        ['入口径（バンド側）  D₅',  mm(d.D5)],
                        ['出口径（クラウン側）D₆',  mm(d.D6)],
                        ['出口径（バンド側）  D₂',  mm(d.D2)],
                        ['ボス径             D₇',  mm(d.D7)],
                        ['出口高さ           H₂',  mm(d.H2)],
                        ['入口羽根高さ        B₁',  mm(d.B1)],
                        ['入口流速（子午面）Vm₁',   ms(d.Vm1)],
                        ['出口流速（子午面）Vm₂',   ms(d.Vm2)],
                        ['入口絶対角度       α₁',  deg(d.alpha1)],
                        ['入口相対羽根角度  β₁b',  deg(d.beta1b)],
                        ['出口相対羽根角度  β₂b',  deg(d.beta2b)],
                        ['羽根枚数           Zr',  `${d.Zr} 枚`],
                        ['入口羽根厚さ        t₁',  `${(d.t1 * 1000).toFixed(2)} mm`],
                        ['出口羽根厚さ        t₂',  `${(d.t2 * 1000).toFixed(2)} mm`],
                        ['羽根長さ            l',   d.lb != null ? mm(Math.abs(d.lb)) : '— (要確認)'],
                      ] as [string, string][]).map(([label, val]) => (
                        <div key={label} className="data-row">
                          <span className="data-row-label">{label}</span>
                          <span className="data-row-val">{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ガイドベーン */}
                  <div className="panel" style={{ padding: 14 }}>
                    <div className="sec-hd">🔧 ガイドベーン</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
                      {([
                        ['枚数              Zg',  `${d.Zg} 枚`],
                        ['外径              Dg₁', mm(d.Dg1)],
                        ['内径              Dg₂', mm(d.Dg2)],
                        ['ピッチ円半径       Rg',  `${(d.Rg * 1000).toFixed(1)} mm`],
                        ['ピッチ円→出口距離 Dlx', `${(d.Dlx * 1000).toFixed(1)} mm`],
                        ['入口羽根高さ      Bg₁',  mm(d.Bg1)],
                        ['出口羽根高さ      Bg₂',  mm(d.Bg2)],
                        ['入口厚さ          tg₁', `${(d.tg1 * 1000).toFixed(2)} mm`],
                        ['出口厚さ          tg₂', `${(d.tg2 * 1000).toFixed(2)} mm`],
                        ['羽根長さ           lg', mm(d.lg)],
                        ['最大ポート幅      P00', mm(d.P00)],
                      ] as [string, string][]).map(([label, val]) => (
                        <div key={label} className="data-row">
                          <span className="data-row-label">{label}</span>
                          <span className="data-row-val">{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ガイドベーン角度テーブル */}
                  <div className="panel" style={{ padding: 14 }}>
                    <div className="sec-hd">📐 ガイドベーン角度（各開度）</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 10 }}>
                      設計開度 80% / 出口角 α₁={d.alpha1.toFixed(2)}°
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
                        <thead>
                          <tr style={{ borderBottom: '2px solid var(--border)' }}>
                            {['開度[%]', 'ポート[mm]', 'αG1b[°]', 'αG2b[°]', 'δ[°]', 'αG02[°]'].map(h => (
                              <th key={h} style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--accent)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {d.guideVaneTable.map(r => (
                            <tr key={r.op} style={{ borderBottom: '1px solid color-mix(in srgb, var(--border) 50%, transparent)', background: r.op === 80 ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : undefined }}>
                              <td style={{ padding: '5px 8px', textAlign: 'right', color: r.op === 80 ? 'var(--accent)' : undefined, fontWeight: r.op === 80 ? 700 : undefined }}>{r.op}</td>
                              <td style={{ padding: '5px 8px', textAlign: 'right' }}>{(r.port * 1000).toFixed(1)}</td>
                              <td style={{ padding: '5px 8px', textAlign: 'right' }}>{r.alphaG1b.toFixed(3)}</td>
                              <td style={{ padding: '5px 8px', textAlign: 'right' }}>{r.alphaG2b.toFixed(3)}</td>
                              <td style={{ padding: '5px 8px', textAlign: 'right' }}>{r.delta.toFixed(3)}</td>
                              <td style={{ padding: '5px 8px', textAlign: 'right', color: '#38bdf8', fontWeight: 600 }}>{r.alphaG02.toFixed(3)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* ステーベーン */}
                  <div className="panel" style={{ padding: 14 }}>
                    <div className="sec-hd">🏗 ステーベーン</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
                      {([
                        ['枚数              Zs', `${d.Zs} 枚`],
                        ['入口径           Ds₁', mm(d.Ds1)],
                        ['出口径           Ds₂', mm(d.Ds2)],
                        ['入口高さ          Bs₁', mm(d.Bs1)],
                        ['出口高さ          Bs₂', mm(d.Bs2)],
                        ['入口厚さ          ts₁', `${(d.ts1 * 1000).toFixed(2)} mm`],
                        ['出口厚さ          ts₂', `${(d.ts2 * 1000).toFixed(2)} mm`],
                        ['羽根長さ           ls', mm(Math.abs(d.ls))],
                        ['入口角度        αS₁b', deg(d.alphaS1b)],
                        ['出口角度        αS₂b', deg(d.alphaS2b)],
                      ] as [string, string][]).map(([label, val]) => (
                        <div key={label} className="data-row">
                          <span className="data-row-label">{label}</span>
                          <span className="data-row-val">{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ケーシング */}
                  <div className="panel" style={{ padding: 14 }}>
                    <div className="sec-hd">🌀 スパイラルケーシング</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
                      {([
                        ['入口径         Dc',  mm(d.Dc)],
                        ['アプローチ長さ lCa', mm(d.lCa)],
                        ['入口流速       Vc₀', ms(d.Vc0)],
                      ] as [string, string][]).map(([label, val]) => (
                        <div key={label} className="data-row">
                          <span className="data-row-label">{label}</span>
                          <span className="data-row-val">{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ドラフトチューブ */}
                  <div className="panel" style={{ padding: 14 }}>
                    <div className="sec-hd">🌊 ドラフトチューブ</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
                      {([
                        ['入口円筒部長さ    ldc',  mm(d.ldc)],
                        ['入口円筒入口半径 rdc₁',  mm(d.rdc1)],
                        ['入口円筒出口半径 rdc₂',  mm(d.rdc2)],
                        ['曲がり部半径      rdb',  mm(d.rdb)],
                        ['曲がり部出口幅    bdb',  mm(d.bdb)],
                        ['曲がり部出口高さ hdb₂',  mm(d.hdb2)],
                        ['ディフューザ長さ   ldd',  mm(d.ldd)],
                        ['ディフューザ出口幅 bdd',  mm(d.bdd)],
                        ['ディフューザ出口高 hdd',  mm(d.hdd)],
                      ] as [string, string][]).map(([label, val]) => (
                        <div key={label} className="data-row">
                          <span className="data-row-label">{label}</span>
                          <span className="data-row-val">{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ランナーシール */}
                  <div className="panel" style={{ padding: 14 }}>
                    <div className="sec-hd">🔒 ランナーシール</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
                      {([
                        ['シール数',                    `${d.seal}`],
                        ['ギャップ幅（クラウン）bw₁',  `${(d.bw_1 * 1000).toFixed(2)} mm`],
                        ['ギャップ幅（バンド）  bw₂',  `${(d.bw_2 * 1000).toFixed(2)} mm`],
                        ['シール長さ（クラウン）lw₁',  `${(d.lw_1 * 1000).toFixed(0)} mm`],
                        ['シール長さ（バンド）  lw₂',  `${(d.lw_2 * 1000).toFixed(0)} mm`],
                        ['シール半径（クラウン）rl₁',  `${(d.rl_1 * 1000).toFixed(1)} mm`],
                        ['シール半径（バンド）  rl₂',  `${(d.rl_2 * 1000).toFixed(1)} mm`],
                      ] as [string, string][]).map(([label, val]) => (
                        <div key={label} className="data-row">
                          <span className="data-row-label">{label}</span>
                          <span className="data-row-val">{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ステーベーン流入角 16断面 */}
                  <div className="panel" style={{ padding: 14 }}>
                    <div className="sec-hd">📐 ステーベーン流入角（16断面）</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 10 }}>
                      巻き始め角 th₀ = 21.03°　/ 分割数 = 16
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
                        <thead>
                          <tr style={{ borderBottom: '2px solid var(--border)' }}>
                            {['#', 'θ [°]', 'Qn [m³/s]', 'Dcn [mm]', 'α [°]'].map(h => (
                              <th key={h} style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--accent)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {d.stayVaneAngles.map(r => (
                            <tr key={r.no} style={{ borderBottom: '1px solid color-mix(in srgb, var(--border) 50%, transparent)' }}>
                              <td style={{ padding: '5px 10px', textAlign: 'right', color: 'var(--accent)' }}>{r.no}</td>
                              <td style={{ padding: '5px 10px', textAlign: 'right' }}>{r.theta.toFixed(1)}</td>
                              <td style={{ padding: '5px 10px', textAlign: 'right' }}>{r.Qn.toFixed(4)}</td>
                              <td style={{ padding: '5px 10px', textAlign: 'right' }}>{(r.Dcn * 1000).toFixed(1)}</td>
                              <td style={{ padding: '5px 10px', textAlign: 'right', color: '#38bdf8', fontWeight: 600 }}>{r.alpha.toFixed(3)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )
            })()}
            {/* ── TAB: 性能曲線（ヒルチャート） ── */}
                        {/* ── 📐 設計図面タブ ── */}
            {mainTab === 'francis_drawings' && results.dimensions.francisDetail && (
              <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                <div className="panel" style={{ padding:14 }}>
                  <div className="sec-hd">ランナー子午面断面図</div>
                  <FrancisMeridional results={results} />
                </div>
                <div className="panel" style={{ padding:14 }}>
                  <div className="sec-hd">ランナーベーン翼型断面図</div>
                  <FrancisBladeProfile results={results} />
                </div>
                <div className="panel" style={{ padding:14 }}>
                  <div className="sec-hd">ランナー 3Dビュー</div>
                  <FrancisRunner3D results={results} />
                </div>
                <div className="panel" style={{ padding:14 }}>
                  <div className="sec-hd">ランナーベーン単体 3Dビュー</div>
                  <FrancisBlade3D results={results} />
                </div>
              </div>
            )}

            {mainTab === 'kame' && results.turbineType === 'フランシス水車' && (
              <KameChartTab inputs={inputs} results={results} theme={theme} projector={proj}
                onApplyPoint={(head, flowRate) => update({ head, flowRate })} />
            )}

            {mainTab === 'hill_chart' && results.turbineType === 'フランシス水車' && (
              <div className="panel" style={{ padding:14 }}>
                <div className="sec-hd">ヒルチャート（等効率曲線）</div>
                <FrancisHillChart
                  results={results}
                  inputs={{
                    head:            inputs.head,
                    flowRate:        inputs.flowRate,
                    rotationalSpeed: results.ratedRpm,
                    turbineEff:      inputs.turbineEff / 100,
                    N11:             62,
                  }}
                />
              </div>
            )}
          </div>
        </main>

        {/* ── RIGHT: Sidebar ── */}
        {!rightPaneOpen && (
          <button
            onClick={() => setRightPaneOpen(true)}
            title="履歴／プロジェクトを開く"
            style={{
              width: 28, flexShrink: 0, background: 'var(--surface)', borderLeft: '1px solid var(--border)',
              cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'flex-start', paddingTop: 14, gap: 8,
            }}>
            <span style={{ fontSize: 13 }}>◀</span>
            <span style={{
              writingMode: 'vertical-rl', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.1em', marginTop: 4,
            }}>
              履歴／プロジェクト
            </span>
          </button>
        )}
        {rightPaneOpen && (
        <aside style={{ width: 220, flexShrink: 0, background: 'var(--surface)', borderLeft: '1px solid var(--border)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div className="flex" style={{ borderBottom: '1px solid var(--border)' }}>
            {(['history', 'projects'] as const).map(t => (
              <button key={t} onClick={() => setSidebarTab(t)} className={`tab flex-1 ${sidebarTab === t ? 'active' : ''}`} style={{ fontSize: 10 }}>
                {t === 'history' ? '履歴' : 'プロジェクト'}
              </button>
            ))}
            <button onClick={() => setRightPaneOpen(false)} title="閉じる"
              style={{ fontSize: 12, padding: '0 10px', color: 'var(--muted)', cursor: 'pointer', flexShrink: 0 }}>
              ▶
            </button>
          </div>
          {sidebarTab === 'history' && (
            <div style={{ flex: 1, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {history.length === 0 && <p style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', padding: '24px 0' }}>保存された計算がありません</p>}
              {history.map(h => (
                <button key={h.id} onClick={() => loadHistory(h.id)}
                  style={{ textAlign: 'left', padding: '8px 10px', cursor: 'pointer', width: '100%', border: '1px solid var(--border)', background: 'var(--surface2)', transition: 'border-color 0.15s' }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>{h.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.turbine_type} · {h.turbine_power.toFixed(0)} kW</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: "'JetBrains Mono', monospace" }}>H={h.head}m Q={h.flow_rate}</div>
                  <div style={{ fontSize: 9, color: 'var(--muted)', opacity: 0.6, marginTop: 3 }}>{new Date(h.created_at).toLocaleString('ja-JP')}</div>
                </button>
              ))}
            </div>
          )}
          {sidebarTab === 'projects' && (
            <div style={{ flex: 1, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {projects.length === 0 && <p style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', padding: '24px 0' }}>プロジェクトがありません</p>}
              {projects.map(p => (
                <div key={p.id} style={{ padding: '8px 10px', border: '1px solid var(--border)', background: 'var(--surface2)' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                </div>
              ))}
            </div>
          )}
        </aside>
        )}
      </div>

      {/* ── Save Modal ── */}
      {showSaveModal && (
        <ModalBack>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 16 }}>計算結果を保存</div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6, letterSpacing: '0.1em', textTransform: 'uppercase' }}>ケース名 *</div>
            <input autoFocus value={saveName} onChange={e => setSaveName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder="例：A案　H=50m Q=5m³/s" style={{ ...inputStyle }} />
          </div>
          {projects.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6, letterSpacing: '0.1em', textTransform: 'uppercase' }}>プロジェクト（任意）</div>
              <select value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)} style={selStyle}>
                <option value="">なし</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          <div style={{ padding: '8px 10px', marginBottom: 14, border: '1px solid var(--border)', borderLeft: '2px solid var(--accent)', background: 'var(--surface2)', fontSize: 11, color: 'var(--muted)', fontFamily: "'JetBrains Mono', monospace" }}>
            {results.turbineType} · Pw={results.turbinePower.toFixed(1)} kW · Ns={results.specificSpeed.toFixed(1)}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowSaveModal(false)} className="btn flex-1" style={{ justifyContent: 'center' }}>キャンセル</button>
            <button onClick={handleSave} disabled={saving || !saveName.trim()} className="btn btn-accent flex-1" style={{ justifyContent: 'center' }}>
              {saving ? '保存中…' : '保存する'}
            </button>
          </div>
        </ModalBack>
      )}

      {/* ── Export Modal ── */}
      {showExportModal && (
        <ModalBack>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 4 }}>ローカル出力</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>計算結果をお使いのPCに保存します</div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6, letterSpacing: '0.1em', textTransform: 'uppercase' }}>ファイル名</div>
            <input autoFocus value={exportName} onChange={e => setExportName(e.target.value)} placeholder={results.turbineType} style={{ ...inputStyle }} />
          </div>
          <div style={{ padding: '8px 10px', marginBottom: 14, border: '1px solid var(--border)', borderLeft: '2px solid var(--accent)', background: 'var(--surface2)', fontSize: 11, color: 'var(--muted)', fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.8 }}>
            {results.turbineType}<br />H={inputs.head}m · Q={inputs.flowRate} m³/s · {inputs.frequency}Hz<br />Pw={results.turbinePower.toFixed(2)} kW · Ns={results.specificSpeed.toFixed(1)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {[
              { icon: 'xlsx', label: 'Excel (.xlsx)', desc: '全パラメータ・判定結果を2シートで出力', color: 'var(--ok)', action: handleExportExcel, loading: exportLoading === 'excel' },
              { icon: 'json', label: 'JSON (.json)',  desc: '入力値＋全計算結果。「読込」ボタンで再インポート可', color: 'var(--accent)', action: handleExportJSON, loading: false },
              { icon: 'csv',  label: 'CSV (.csv)',    desc: 'Excelで開ける軽量フォーマット', color: 'var(--warn)', action: handleExportCSV, loading: false },
              { icon: 'dxf',  label: 'DXF (.dxf)',   desc: 'CAD用概略断面図（フランシス・カプラン・ペルトン対応）', color: '#22d3ee', action: handleExportDXF, loading: exportLoading === 'dxf' },
            ].map(opt => (
              <button key={opt.label} onClick={opt.action} disabled={opt.loading}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: `1px solid ${opt.color}`, cursor: 'pointer', transition: 'all 0.15s', background: `color-mix(in srgb, ${opt.color} 8%, transparent)`, opacity: opt.loading ? 0.6 : 1 }}
                onMouseEnter={e => (e.currentTarget.style.background = `color-mix(in srgb, ${opt.color} 18%, transparent)`)}
                onMouseLeave={e => (e.currentTarget.style.background = `color-mix(in srgb, ${opt.color} 8%, transparent)`)}>
                <div style={{ width: 32, height: 32, border: `1px solid ${opt.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: opt.color, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.05em', flexShrink: 0 }}>
                  {opt.icon.toUpperCase()}
                </div>
                <div style={{ textAlign: 'left', flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: opt.color }}>{opt.loading ? '生成中…' : opt.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>{opt.desc}</div>
                </div>
                <span style={{ color: opt.color, fontSize: 14, opacity: 0.6 }}>↓</span>
              </button>
            ))}
          </div>
          <button onClick={() => setShowExportModal(false)} className="btn" style={{ width: '100%', justifyContent: 'center' }}>閉じる</button>
        </ModalBack>
      )}
    </div>
  )
}

'use client'
// ============================================================
// 「解説」タブ — 計算結果を、専門家でない人向けにやさしく説明する（AI）
// 数値は、サーバー側で計算し直した結果だけを根拠にする（/api/explain）。
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import type { TurbineInputs, TurbineResults } from '@/types'

interface Props { inputs: TurbineInputs; results: TurbineResults }
interface Done { text: string; mode: 'ai' | 'mock'; key: string }

/** 見出し（##）、箇条書き（-）、太字（**）だけを描く簡易な表示 */
function renderText(text: string) {
  const bold = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>)
  const out: React.ReactNode[] = []
  let items: string[] = []
  const flush = (k: number) => { if (items.length) { out.push(<ul key={'u' + k} style={{ margin: '4px 0 10px 1.4em', padding: 0, listStyle: 'disc' }}>{items.map((t, i) => <li key={i} style={{ margin: '3px 0' }}>{bold(t)}</li>)}</ul>); items = [] } }
  text.split('\n').forEach((line, i) => {
    if (/^\s*[-・]\s+/.test(line)) { items.push(line.replace(/^\s*[-・]\s+/, '')); return }
    flush(i)
    if (/^##\s+/.test(line)) out.push(<h3 key={i} style={{ fontSize: 15, fontWeight: 700, margin: '14px 0 4px', color: 'var(--accent)' }}>{line.replace(/^##\s+/, '')}</h3>)
    else if (line.trim()) out.push(<p key={i} style={{ margin: '4px 0', lineHeight: 1.75 }}>{bold(line)}</p>)
  })
  flush(9999)
  return out
}

export default function ExplainTab({ inputs, results }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const [copied, setCopied] = useState(false)
  const ctrl = useRef<AbortController | null>(null)
  useEffect(() => () => ctrl.current?.abort(), [])

  // 条件が変わったかを見分けるための印
  const key = useMemo(() => JSON.stringify({ inputs, type: results.turbineType }), [inputs, results.turbineType])
  const stale = done != null && done.key !== key

  const run = async () => {
    ctrl.current?.abort()
    const c = new AbortController(); ctrl.current = c
    setLoading(true); setError(null); setCopied(false)
    try {
      const res = await fetch('/api/explain', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: c.signal,
        body: JSON.stringify({ inputs, forcedType: results.turbineType }),
      })
      // ログインの期限切れなどで、ログイン画面へ転送されたときは、JSON ではなく HTML が返る
      if (res.redirected || !(res.headers.get('content-type') ?? '').includes('application/json')) {
        throw new Error('ログインの有効期限が切れた可能性があります。ページを再読み込みして、もう一度お試しください。')
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || '解説を作れませんでした')
      setDone({ text: data.text, mode: data.mode, key })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message || '解説を作れませんでした')
    } finally { if (ctrl.current === c) setLoading(false) }
  }
  const copy = async () => {
    if (!done) return
    try { await navigator.clipboard.writeText(done.text); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* 無視 */ }
  }

  return (
    <div className="panel" style={{ padding: 16, maxWidth: 860 }}>
      <div className="sec-hd">💬 結果のやさしい解説</div>
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 12px', lineHeight: 1.7 }}>
        いまの条件と計算結果を、専門家でない方にも分かる言葉で説明します。数値は、計算コードの結果だけを使います。
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-accent" onClick={run} disabled={loading} style={{ padding: '7px 16px', fontSize: 13 }}>
          {loading ? '解説を作っています…' : done ? '解説を作り直す' : '解説を作る'}
        </button>
        {done && <button className="btn" onClick={copy} style={{ padding: '7px 12px', fontSize: 12 }}>{copied ? 'コピーしました' : 'コピー'}</button>}
        {stale && <span role="status" style={{ fontSize: 12, color: 'var(--warn)' }}>⚠ 条件が変わりました。解説を作り直してください。</span>}
      </div>

      <div aria-live="polite" style={{ marginTop: 14 }}>
        {error && <div role="alert" style={{ padding: '10px 12px', border: '1px solid var(--ng)', color: 'var(--ng)', fontSize: 13 }}>{error}</div>}
        {done && !error && (
          <div style={{ border: '1px solid var(--border)', background: 'var(--surface)', padding: '8px 16px 12px', opacity: stale ? 0.6 : 1 }}>
            {renderText(done.text)}
          </div>
        )}
        {done && (
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: '8px 0 0' }}>
            {done.mode === 'ai' ? 'この解説は AI が作成しました。数値は計算結果にもとづきますが、内容は、必ず画面の結果とあわせてご確認ください。' : 'AI を使わない簡易な解説です（AI 解説の設定前のデモ表示）。'}
          </p>
        )}
      </div>
    </div>
  )
}

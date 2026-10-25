// ============================================================
// POST /api/explain の本体（route.ts からは、これを呼ぶだけ。テストしやすいよう、依存を引数で受け取る）
// 計算結果のやさしい解説を返す
//  1. ログイン確認  2. 回数制限  3. 入力の検査  4. サーバー側で計算し直して事実を作る
//  5. AI（Anthropic Messages API）に事実だけを渡して解説を作る（キー未設定ならひな形）
// API キーはサーバー側の環境変数にだけ置く（ブラウザには渡さない）。
// ============================================================
import { NextResponse } from 'next/server'
import { buildExplainFacts, parseExplainRequest, type ExplainFacts } from './explainFacts'
import { SYSTEM_PROMPT, buildUserMessage, mockExplain } from './explainPrompt'
import type { NsRange } from '@/types'

const MAX_BODY = 20_000          // 本文の上限（バイト）
const LIMIT = 10                 // 1人あたりの回数
const WINDOW_MS = 10 * 60_000    // 上の回数を数える時間（10分）
const MODEL_TIMEOUT_MS = 25_000
const DEFAULT_MODEL = 'claude-sonnet-5-5'

export interface ExplainDeps {
  getUserId: () => Promise<string | null>
  getNsRanges: () => Promise<NsRange[]>
  fetchImpl: typeof fetch
  now: () => number
  env: Record<string, string | undefined>
}

const hits = new Map<string, number[]>()  // 簡易な回数制限（サーバーレスでは、インスタンスごと。本格運用では外部ストアに置く）
export function _resetRateLimit() { hits.clear() }

function rateLimited(key: string, now: number): number | null {
  const list = (hits.get(key) ?? []).filter(t => now - t < WINDOW_MS)
  if (list.length >= LIMIT) { hits.set(key, list); return Math.ceil((WINDOW_MS - (now - list[0])) / 1000) }
  list.push(now); hits.set(key, list)
  return null
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } })

async function callModel(facts: ExplainFacts, deps: ExplainDeps, key: string): Promise<{ text: string; model: string }> {
  const model = deps.env.ANTHROPIC_MODEL || DEFAULT_MODEL
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), MODEL_TIMEOUT_MS)
  try {
    const res = await deps.fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: 1200, system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserMessage(facts) }],
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) throw Object.assign(new Error('upstream'), { status: res.status })
    const data = await res.json() as { content?: { type: string; text?: string }[] }
    const text = (data.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim()
    if (!text) throw Object.assign(new Error('empty'), { status: 502 })
    return { text, model }
  } finally { clearTimeout(timer) }
}

export async function handleExplain(req: Request, deps: ExplainDeps): Promise<Response> {
  // 本文の大きさ
  const raw = await req.text()
  if (raw.length > MAX_BODY) return json({ error: '入力が大きすぎます' }, 413)
  let body: unknown
  try { body = JSON.parse(raw) } catch { return json({ error: '入力が正しくありません' }, 400) }

  // 1. ログイン確認（認証を外せるのは開発時だけ）
  const requireAuth = deps.env.EXPLAIN_REQUIRE_AUTH !== '0'
  let userKey = 'anonymous'
  if (requireAuth) {
    const uid = await deps.getUserId()
    if (!uid) return json({ error: 'ログインが必要です' }, 401)
    userKey = uid
  } else if (deps.env.NODE_ENV === 'production') {
    return json({ error: '本番環境では、ログイン確認を外せません' }, 500)
  }

  // 2. 回数制限
  const wait = rateLimited(userKey, deps.now())
  if (wait != null) return json({ error: `短時間に回数が多すぎます。${Math.ceil(wait / 60)} 分ほど待ってからお試しください。` }, 429, { 'Retry-After': String(wait) })

  // 3. 入力の検査
  const parsed = parseExplainRequest(body)
  if (!parsed.ok) return json({ error: parsed.error }, 400)

  // 4. サーバー側で計算し直して、事実を作る
  let nsRanges: NsRange[] = []
  try { nsRanges = await deps.getNsRanges() } catch { /* 取得できなければ、既定の設定で計算する */ }
  let facts: ExplainFacts
  try { facts = buildExplainFacts(parsed.inputs, parsed.forcedType, nsRanges) }
  catch { return json({ error: 'この条件では、計算できませんでした' }, 422) }

  // 5. 解説を作る
  const key = deps.env.ANTHROPIC_API_KEY
  if (!key) {
    if (deps.env.EXPLAIN_MOCK === '1' || deps.env.NODE_ENV !== 'production') return json({ text: mockExplain(facts), mode: 'mock' })
    return json({ error: 'AI 解説は、まだ設定されていません' }, 503)
  }
  try {
    const { text, model } = await callModel(facts, deps, key)
    return json({ text, mode: 'ai', model })
  } catch (e) {
    const status = (e as { status?: number }).status
    // 詳細（キーや本文）は、ログにも出さない。状態コードだけ残す
    console.error('[explain] model call failed', e instanceof Error && e.name === 'AbortError' ? 'timeout' : status ?? 'error')
    if (e instanceof Error && e.name === 'AbortError') return json({ error: 'AI の応答に時間がかかっています。もう一度お試しください。' }, 504)
    if (status === 429) return json({ error: 'AI が混み合っています。少し待ってからお試しください。' }, 429)
    if (status === 401 || status === 403) return json({ error: 'AI サービスの設定に問題があります。管理者にご連絡ください。' }, 502)
    return json({ error: 'AI の解説を作れませんでした。もう一度お試しください。' }, 502)
  }
}


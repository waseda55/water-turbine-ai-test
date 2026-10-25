// AI解説（/api/explain）のテスト。実行方法は docs/ai-explain.md を参照。
import assert from 'node:assert/strict'
import { parseExplainRequest, buildExplainFacts } from '@/lib/ai/explainFacts'
import { mockExplain, SYSTEM_PROMPT } from '@/lib/ai/explainPrompt'
import { handleExplain, _resetRateLimit, type ExplainDeps } from '@/lib/ai/explainHandler'

let pass = 0, fail = 0
const T = async (n: string, f: () => unknown | Promise<unknown>) => { try { await f(); pass++; console.log('OK  ', n) } catch (e: any) { fail++; console.log('FAIL', n, '-', e.message) } }
const base = { head: 30, flowRate: 1.0, turbineEff: 85, generatorEff: 95, suctionHead: 0, altitude: 0, frequency: 50, powerFactor: 0.9, operatingHours: 8000, capacityFactor: 80, penstock: { length: 100, material: 'steel' }, targetNs: 160 }
const req = (body: unknown) => new Request('http://x/api/explain', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })
const mk = (over: Partial<ExplainDeps> & { env?: Record<string, string | undefined> } = {}): ExplainDeps => ({
  getUserId: async () => 'u1', getNsRanges: async () => [], now: () => 1_000_000,
  fetchImpl: (async () => { throw new Error('fetch should not be called') }) as any,
  env: { NODE_ENV: 'test' }, ...over,
})
const okAi = (text = '## 一言でいうと\nテスト') => (async () => new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200 })) as any

;(async () => {
  // ---- 入力の検査 ----
  await T('検査: 正しい入力は通る', () => { const r = parseExplainRequest({ inputs: base }); assert.ok(r.ok) })
  await T('検査: 異常値・欠落・型違いを拒否', () => {
    for (const bad of [null, 5, {}, { inputs: { ...base, head: NaN } }, { inputs: { ...base, head: -3 } }, { inputs: { ...base, flowRate: 1e9 } },
      { inputs: { ...base, frequency: 55 } }, { inputs: { ...base, penstock: undefined } }, { inputs: { ...base, penstock: { length: 10, material: 'x' } } },
      { inputs: { ...base, head: '30' } }, { inputs: base, forcedType: '存在しない水車' }]) assert.equal(parseExplainRequest(bad).ok, false, JSON.stringify(bad)?.slice(0, 60))
  })
  // ---- 事実の組み立て ----
  await T('事実: フランシスは亀の甲の枠(F475)と比較が入る', () => {
    const r = parseExplainRequest({ inputs: base, forcedType: 'フランシス水車' }); assert.ok(r.ok)
    const f = buildExplainFacts((r as any).inputs, 'フランシス水車')
    const k: any = f.マニュアル選定; assert.equal(k.選ばれた枠.枠番, 'F475'); assert.equal(f.判定.length, 6); assert.ok(k.出典.includes('図4.3-8'))
  })
  await T('事実: 60Hz は図4.3-9 を出典にする', () => { const f: any = buildExplainFacts({ ...base, frequency: 60, head: 45, flowRate: 0.6 } as any, 'フランシス水車'); assert.ok(f.マニュアル選定.出典.includes('図4.3-9')) })
  await T('事実: ペルトンでは亀の甲の項目を付けない', () => { const f = buildExplainFacts({ ...base, head: 300, flowRate: 0.3 } as any, 'ペルトン水車'); assert.equal(f.マニュアル選定, undefined); assert.equal(f.計算結果.水車の種類, 'ペルトン水車') })
  await T('事実: 数値は計算コードの値（出力約250kW）', () => { const f = buildExplainFacts(base as any, 'フランシス水車'); assert.ok(Math.abs((f.計算結果.水車出力_kW as number) - 250.2) < 1) })
  await T('ひな形: 見出し4つと注意書きがある', () => { const t = mockExplain(buildExplainFacts(base as any, 'フランシス水車')); for (const h of ['## 一言でいうと', '## 結果の読み方', '## 注意が必要な点', '## 次にやること', '概略の検討用']) assert.ok(t.includes(h), h); assert.ok(t.includes('F475')) })
  await T('指示文: 数値を作らない・断定しない旨を含む', () => { for (const s of ['FACTS にない数値を作らない', '断定しない', '700 字以内', '亀の甲']) assert.ok(SYSTEM_PROMPT.includes(s), s) })
  // ---- ハンドラー ----
  await T('認証: 未ログインは401', async () => { _resetRateLimit(); const r = await handleExplain(req({ inputs: base }), mk({ getUserId: async () => null })); assert.equal(r.status, 401) })
  await T('認証: 本番でログイン確認を外す設定は拒否', async () => { _resetRateLimit(); const r = await handleExplain(req({ inputs: base }), mk({ env: { NODE_ENV: 'production', EXPLAIN_REQUIRE_AUTH: '0' } })); assert.equal(r.status, 500) })
  await T('認証: 開発時は外せる', async () => { _resetRateLimit(); const r = await handleExplain(req({ inputs: base }), mk({ getUserId: async () => null, env: { NODE_ENV: 'development', EXPLAIN_REQUIRE_AUTH: '0' } })); assert.equal(r.status, 200) })
  await T('キー未設定(開発): ひな形を返す', async () => { _resetRateLimit(); const r = await handleExplain(req({ inputs: base }), mk()); const j: any = await r.json(); assert.equal(r.status, 200); assert.equal(j.mode, 'mock'); assert.ok(j.text.includes('F475')) })
  await T('キー未設定(本番): 503', async () => { _resetRateLimit(); const r = await handleExplain(req({ inputs: base }), mk({ env: { NODE_ENV: 'production' } })); assert.equal(r.status, 503) })
  await T('キー未設定(本番) + EXPLAIN_MOCK=1: ひな形', async () => { _resetRateLimit(); const r = await handleExplain(req({ inputs: base }), mk({ env: { NODE_ENV: 'production', EXPLAIN_MOCK: '1' } })); assert.equal((await r.json() as any).mode, 'mock') })
  await T('AI: 呼び出しの形（URL・ヘッダー・モデル・指示・事実）', async () => {
    _resetRateLimit(); let seen: any
    const fetchImpl = (async (url: string, init: any) => { seen = { url, init, body: JSON.parse(init.body) }; return new Response(JSON.stringify({ content: [{ type: 'text', text: '## 一言でいうと\nOK' }] }), { status: 200 }) }) as any
    const r = await handleExplain(req({ inputs: base, forcedType: 'フランシス水車' }), mk({ fetchImpl, env: { NODE_ENV: 'production', ANTHROPIC_API_KEY: 'sk-test-123' } }))
    const j: any = await r.json(); assert.equal(r.status, 200); assert.equal(j.mode, 'ai'); assert.equal(j.model, 'claude-sonnet-5-5')
    assert.equal(seen.url, 'https://api.anthropic.com/v1/messages'); assert.equal(seen.init.headers['x-api-key'], 'sk-test-123'); assert.equal(seen.init.headers['anthropic-version'], '2023-06-01')
    assert.equal(seen.body.model, 'claude-sonnet-5-5'); assert.ok(seen.body.max_tokens > 0); assert.ok(seen.body.system.includes('解説担当'))
    assert.ok(seen.body.messages[0].content.includes('F475') && seen.body.messages[0].content.includes('"有効落差_m": 30'))
    assert.ok(!JSON.stringify(j).includes('sk-test-123'), 'キーが応答に漏れていない')
  })
  await T('AI: モデルは環境変数で替えられる', async () => { _resetRateLimit(); let m = ''; const fetchImpl = (async (_u: string, init: any) => { m = JSON.parse(init.body).model; return new Response(JSON.stringify({ content: [{ type: 'text', text: 'x' }] })) }) as any; await handleExplain(req({ inputs: base }), mk({ fetchImpl, env: { NODE_ENV: 'production', ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'claude-haiku-5-5' } })); assert.equal(m, 'claude-haiku-5-5') })
  await T('AI: クライアントが結果を偽装しても、事実はサーバー計算', async () => {
    _resetRateLimit(); let content = ''
    const fetchImpl = (async (_u: string, init: any) => { content = JSON.parse(init.body).messages[0].content; return new Response(JSON.stringify({ content: [{ type: 'text', text: 'x' }] })) }) as any
    await handleExplain(req({ inputs: base, results: { turbinePower: 99999 }, facts: { 水車出力_kW: 99999 } }), mk({ fetchImpl, env: { NODE_ENV: 'production', ANTHROPIC_API_KEY: 'k' } }))
    assert.ok(!content.includes('99999'))
  })
  for (const [name, status, expect] of [['上流429', 429, 429], ['上流401', 401, 502], ['上流403', 403, 502], ['上流500', 500, 502], ['上流529', 529, 502]] as const)
    await T(`エラー: ${name} → ${expect}（キーを含まない）`, async () => { _resetRateLimit(); const fetchImpl = (async () => new Response('secret-detail sk-test', { status })) as any; const r = await handleExplain(req({ inputs: base }), mk({ fetchImpl, env: { NODE_ENV: 'production', ANTHROPIC_API_KEY: 'sk-test' } })); assert.equal(r.status, expect); const t = await r.text(); assert.ok(!t.includes('sk-test') && !t.includes('secret-detail')) })
  await T('エラー: 空の応答 → 502', async () => { _resetRateLimit(); const r = await handleExplain(req({ inputs: base }), mk({ fetchImpl: (async () => new Response(JSON.stringify({ content: [] }))) as any, env: { NODE_ENV: 'production', ANTHROPIC_API_KEY: 'k' } })); assert.equal(r.status, 502) })
  await T('エラー: タイムアウト → 504', async () => { _resetRateLimit(); const fetchImpl = (async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e }) as any; const r = await handleExplain(req({ inputs: base }), mk({ fetchImpl, env: { NODE_ENV: 'production', ANTHROPIC_API_KEY: 'k' } })); assert.equal(r.status, 504) })
  await T('回数制限: 11回目は429（Retry-Afterあり）、別ユーザーは別枠', async () => {
    _resetRateLimit(); const d = mk()
    for (let i = 0; i < 10; i++) assert.equal((await handleExplain(req({ inputs: base }), d)).status, 200)
    const r = await handleExplain(req({ inputs: base }), d); assert.equal(r.status, 429); assert.ok(Number(r.headers.get('Retry-After')) > 0)
    assert.equal((await handleExplain(req({ inputs: base }), mk({ getUserId: async () => 'u2' }))).status, 200)
    assert.equal((await handleExplain(req({ inputs: base }), mk({ now: () => 1_000_000 + 11 * 60_000 }))).status, 200)
  })
  await T('入力: 不正なJSON→400 / 大きすぎる→413 / 範囲外→400', async () => {
    _resetRateLimit()
    assert.equal((await handleExplain(req('{not json'), mk())).status, 400)
    assert.equal((await handleExplain(req('x'.repeat(30000)), mk())).status, 413)
    assert.equal((await handleExplain(req({ inputs: { ...base, head: -1 } }), mk())).status, 400)
  })
  await T('DB取得に失敗しても解説は作る', async () => { _resetRateLimit(); const r = await handleExplain(req({ inputs: base }), mk({ getNsRanges: async () => { throw new Error('db') } })); assert.equal(r.status, 200) })
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})()

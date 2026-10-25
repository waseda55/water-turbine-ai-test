// POST /api/explain — 計算結果のやさしい解説を返す（本体は src/lib/ai/explainHandler.ts）
// API キーはサーバー側の環境変数（ANTHROPIC_API_KEY）にだけ置く。ブラウザには渡さない。
import { createClient } from '@/lib/supabase/server'
import { fetchNsRanges } from '@/lib/selection-ranges'
import { handleExplain } from '@/lib/ai/explainHandler'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(req: Request) {
  // Supabase のクライアントは、必要になったときに作る（開発時にログイン確認を外す場合は作らない）
  let sb: ReturnType<typeof createClient> | null = null
  const supabase = () => (sb ??= createClient())
  return handleExplain(req, {
    getUserId: async () => { const { data } = await supabase().auth.getUser(); return data.user?.id ?? null },
    getNsRanges: () => fetchNsRanges(supabase()),
    fetchImpl: fetch,
    now: () => Date.now(),
    env: process.env as Record<string, string | undefined>,
  })
}

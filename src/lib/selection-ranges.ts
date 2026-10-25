import { createClient } from '@/lib/supabase/server'
import type { HQRange, NsRange } from '@/types'

export async function fetchHQRanges(): Promise<HQRange[]> {
  const supabase = createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('hq_ranges')
    .select(`
      id, turbine_type_id, boundary_points,
      h_min, h_max, q_min, q_max,
      source, note, version,
      turbine_types ( id, name, icon, color, sort_order, is_active )
    `)
    .eq('is_active', true)
    .order('turbine_type_id')

  if (error || !data) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((r: any) => ({
    id:             r.id,
    turbineTypeId:  r.turbine_type_id,
    turbineType: {
      id:        r.turbine_types.id,
      name:      r.turbine_types.name,
      icon:      r.turbine_types.icon,
      color:     r.turbine_types.color,
      sortOrder: r.turbine_types.sort_order,
      isActive:  r.turbine_types.is_active,
    },
    boundaryPoints: r.boundary_points as { q: number; h: number }[],
    hMin:    Number(r.h_min),
    hMax:    Number(r.h_max),
    qMin:    Number(r.q_min),
    qMax:    Number(r.q_max),
    source:  r.source,
    note:    r.note,
    version: r.version,
  }))
}

// client を渡すと、サーバー側（API ルートなど）でも同じ取得処理を使える。省略時はブラウザ用のクライアント。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchNsRanges(client?: any): Promise<NsRange[]> {
  const supabase = client ?? createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('ns_ranges')
    .select(`
      id, turbine_type_id,
      ns_min, ns_max, overlap_note,
      nsp_target_min, nsp_target_max, nsp_target_step,
      source, note, version,
      turbine_types ( id, name, icon, color, sort_order, is_active )
    `)
    .eq('is_active', true)
    .order('turbine_type_id')

  if (error || !data) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((r: any) => ({
    id:             r.id,
    turbineTypeId:  r.turbine_type_id,
    turbineType: {
      id:        r.turbine_types.id,
      name:      r.turbine_types.name,
      icon:      r.turbine_types.icon,
      color:     r.turbine_types.color,
      sortOrder: r.turbine_types.sort_order,
      isActive:  r.turbine_types.is_active,
    },
    nsMin:       Number(r.ns_min),
    nsMax:       Number(r.ns_max),
    overlapNote: r.overlap_note,
    nspTargetMin:  r.nsp_target_min  !== null && r.nsp_target_min  !== undefined ? Number(r.nsp_target_min)  : null,
    nspTargetMax:  r.nsp_target_max  !== null && r.nsp_target_max  !== undefined ? Number(r.nsp_target_max)  : null,
    nspTargetStep: r.nsp_target_step !== null && r.nsp_target_step !== undefined ? Number(r.nsp_target_step) : null,
    source:      r.source,
    note:        r.note,
    version:     r.version,
  }))
}

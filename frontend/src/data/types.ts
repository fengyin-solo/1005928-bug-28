/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

// 备品备件的分页查询：额外携带排序方向，便于页面在翻页时保持「现有数量从少到多」。
export type SpareQuery = {
  filters?: Record<string, string>
  page?: number
  size?: number
  sortByQuantity?: 'asc' | 'desc'
}

export type SparePageResult = PageResult & {
  sortByQuantity: 'asc' | 'desc'
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

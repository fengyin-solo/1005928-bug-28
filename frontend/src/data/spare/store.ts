import { storageKey } from '@/data/local-store'
import { buildInitialDomain } from './catalog'
import type { EntryRow } from '@/data/types'
import type { SpareDomain } from './types'

// 备件业务库独立于通用台账存一份；首次进入备件页时，
// 若浏览器里已有旧脚手架的台账，则从既有备件记录并轨。
const SPARE_KEY = 'pv-plant-ops:spare-domain'

function readJson<T>(key: string): T | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

// 首次进入备件页时：浏览器已有旧台账（哪怕里面还没有备件数据，
// 说明用户用过旧脚手架）就走并轨；完全干净的环境播种示例数据。
function legacySpares(): EntryRow[] | null {
  const parsed = readJson<Record<string, EntryRow[]>>(storageKey())
  if (parsed !== null) {
    return Array.isArray(parsed.spare) ? parsed.spare : []
  }
  return null
}

function validateDomain(value: Partial<SpareDomain> | null): value is SpareDomain {
  return (
    !!value &&
    Array.isArray(value.spares) &&
    Array.isArray(value.requisitions) &&
    Array.isArray(value.stocktakes) &&
    Array.isArray(value.ledgerSyncs) &&
    typeof value.seq === 'object'
  )
}

let cache: SpareDomain | null = null

export function getDomain(): SpareDomain {
  if (cache) {
    return cache
  }
  const persisted = readJson<SpareDomain>(SPARE_KEY)
  if (validateDomain(persisted)) {
    cache = persisted
    return cache
  }
  cache = buildInitialDomain(legacySpares())
  persist(cache)
  return cache
}

function persist(domain: SpareDomain): void {
  cache = domain
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(SPARE_KEY, JSON.stringify(domain))
  }
}

// 事务提交：所有校验通过后才一次性落库；
// 任一步骤抛错都不写盘，绝不允许只登记领用而数量没扣。
export function commit(mutate: (draft: SpareDomain) => void): SpareDomain {
  const current = getDomain()
  const draft: SpareDomain = JSON.parse(JSON.stringify(current)) as SpareDomain
  mutate(draft)
  persist(draft)
  return draft
}

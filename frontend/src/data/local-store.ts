import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'pv-plant-ops:entries'
const META_KEY = 'pv-plant-ops:meta'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  saveRowsBatch({ [key]: rows })
}

// 一次动作里要同时写多张台账（如领用出库同时记领用流水、同步缺陷待领用台账）。
// 必须整体落库：任一张台账写不进去就不提交，绝不能只登记领用而不扣库存。
export function saveRowsBatch(patch: Record<string, EntryRow[]>): void {
  const next = { ...allRows(), ...patch }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

// 结构性迁移标记：只做一次的历史数据补全靠它识别，避免每次读取都覆盖用户改后的数据。
export function getMeta(marker: string): string | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  try {
    const raw = window.localStorage.getItem(META_KEY)
    if (!raw) {
      return null
    }
    return (JSON.parse(raw) as Record<string, string>)[marker] ?? null
  } catch {
    return null
  }
}

export function setMeta(marker: string, value: string): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  let current: Record<string, string> = {}
  try {
    const raw = window.localStorage.getItem(META_KEY)
    if (raw) {
      current = JSON.parse(raw) as Record<string, string>
    }
  } catch {
    current = {}
  }
  current[marker] = value
  window.localStorage.setItem(META_KEY, JSON.stringify(current))
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

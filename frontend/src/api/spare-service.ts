import { getMeta, listRows, saveRows, saveRowsBatch, setMeta } from '@/data/local-store'
import type { ActionResult, EntryRow, SparePageResult, SpareQuery } from '@/data/types'

// 备件领域服务：库存页只做渲染，找件、盘点补账、检验放行、领用扣减、库位权限、
// 与缺陷消缺「待领用台账」的同步，业务判断全部收敛在这里。

const SPARE_KEY = 'spare'
const STOCKTAKE_KEY = 'stocktake'
const REQUISITION_KEY = 'requisition'

// 安全存量核定版：统一采用设备管理部《2026 年备件储备定额（2026-V1）》。
// 既有备件记录里已有的有效数字定额照用、只补登版本号；对不上数字的历史格按默认定额兜底。
export const SAFETY_VERSION = '2026-V1'
const SAFETY_VERSION_LABEL = '2026-V1 备件储备定额（设备管理部核定）'
const DEFAULT_SAFETY_STOCK = 5
const DEFAULT_PAGE_SIZE = 3

const SPARE_STATUSES = ['数量充足', '待补充', '待检验', '已停用']
const INSPECTION_PASS = '检验合格'
const INSPECTION_PENDING = '待检验'

const SCHEMA_MARKER = 'spare:schema:v1'
// 没有 localStorage 的运行环境（如 Node 验证脚本）用内存标记兜底，保证迁移只做一次。
let schemaDone = false

type IssueInput = {
  id: number
  领用单号: string
  领用数量: number | string
  领用人: string
  关联缺陷编号?: string
}

type MutationOptions = {
  operator: string
}

function toCount(value: unknown): number | null {
  if (typeof value === 'boolean') {
    return null
  }
  const n = Number(value)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return null
  }
  return n
}

function positiveCount(value: unknown): number | null {
  const n = toCount(value)
  return n !== null && n > 0 ? n : null
}

function isPlaceholder(value: unknown): boolean {
  return typeof value === 'string' && (value.trim() === '' || value.includes('样例'))
}

function dateText(d = new Date()): string {
  const p = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function timeText(d = new Date()): string {
  const p = (v: number) => String(v).padStart(2, '0')
  return `${dateText(d)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function spareCode(row: EntryRow): string {
  return String(row['备件编号'] ?? '')
}

function isDisabled(row: EntryRow): boolean {
  return String(row.status) === '已停用'
}

function isLowStock(row: EntryRow): boolean {
  if (isDisabled(row)) {
    return false
  }
  const qty = toCount(row['现有数量']) ?? 0
  const safety = toCount(row['安全存量']) ?? DEFAULT_SAFETY_STOCK
  return qty < safety
}

// 数量充足/待补充 只随账面对比定额得出；待检验、已停用属于流转状态，优先保留。
function deriveStatus(row: EntryRow): string {
  if (isDisabled(row)) {
    return '已停用'
  }
  if (String(row['检验状态'] ?? '') === INSPECTION_PENDING) {
    return '待检验'
  }
  return isLowStock(row) ? '待补充' : '数量充足'
}

function syncDerived(row: EntryRow): EntryRow {
  const status = deriveStatus(row)
  // 「存量状态」是给人看的告警文案；流转用的 status 由数量/检验统一派生，两者都写避免各读各的。
  const flagText =
    status === '已停用' ? '已停用' : isLowStock(row) ? '低于安全存量' : '正常'
  const next: EntryRow = { ...row, status, pending: status === '待补充' || status === '待检验' }
  next['存量状态'] = flagText
  delete next['备件状态']
  return next
}

function latestStocktake(code: string, rows: EntryRow[]): EntryRow | null {
  let latest: EntryRow | null = null
  for (const row of rows) {
    if (String(row['备件编号'] ?? '') !== code) {
      continue
    }
    if (!latest || String(row['盘点日期'] ?? '') > String(latest['盘点日期'] ?? '')) {
      latest = row
    }
  }
  return latest
}

// 一次性结构补全：历史账面不可信（出库不扣数、定额是占位文字），现有数量从最近一次盘点补起，
// 并扣掉盘点日之后已出库的领用流水；安全存量对不上数字的格按 2026-V1 默认定额兜底。
function ensureSchema(): void {
  if (schemaDone || getMeta(SCHEMA_MARKER) === SAFETY_VERSION) {
    return
  }
  const spares = listRows(SPARE_KEY).map((row) => ({ ...row }))
  const stocktakes = listRows(STOCKTAKE_KEY)
  const requisitions = listRows(REQUISITION_KEY)

  const normalized = spares.map((row) => {
    const safety = toCount(row['安全存量'])
    if (safety === null) {
      row['安全存量'] = DEFAULT_SAFETY_STOCK
    } else {
      row['安全存量'] = safety
    }
    row['安全存量版本'] = SAFETY_VERSION
    if (isPlaceholder(row['存放库位'])) {
      row['存放库位'] = '未分配库位'
    }
    if (isPlaceholder(row['库位保管人'])) {
      row['库位保管人'] = ''
    }
    // 旧版把告警文案塞在「备件状态」列，与流转用的 status 同名打架，迁移时清掉由 status 统一派生。
    delete row['备件状态']

    if (typeof row['检验状态'] !== 'string' || !row['检验状态']) {
      row['检验状态'] =
        String(row.status) === '待检验' ? INSPECTION_PENDING : INSPECTION_PASS
    }

    const code = spareCode(row)
    const latest = latestStocktake(code, stocktakes)
    if (latest) {
      const counted = toCount(latest['盘点数量'])
      if (counted !== null) {
        const issuedAfter = requisitions
          .filter((item) => String(item['备件编号'] ?? '') === code)
          .filter((item) => String(item['出库时间'] ?? '').slice(0, 10) > String(latest['盘点日期'] ?? ''))
          .reduce((sum, item) => sum + (positiveCount(item['领用数量']) ?? 0), 0)
        row['现有数量'] = Math.max(0, counted - issuedAfter)
        row['最近盘点日期'] = String(latest['盘点日期'] ?? '')
      }
    } else if (toCount(row['现有数量']) === null) {
      row['现有数量'] = 0
    }
    return syncDerived(row)
  })

  saveRows(SPARE_KEY, normalized)
  setMeta(SCHEMA_MARKER, SAFETY_VERSION)
  schemaDone = true
}

function loadSpares(): EntryRow[] {
  ensureSchema()
  return listRows(SPARE_KEY)
}

function matchField(row: EntryRow, field: string, keyword: string): boolean {
  return String(row[field] ?? '')
    .toLowerCase()
    .includes(keyword.trim().toLowerCase())
}

// 查不到时逐格点名：返回「按它找了但一条都没对上」的字段名。
export function mismatchedFields(filters: Record<string, string>): string[] {
  const spares = loadSpares()
  return Object.entries(filters)
    .filter(([, value]) => value.trim() !== '')
    .filter(([field, value]) => !spares.some((row) => matchField(row, field, value)))
    .map(([field]) => field)
}

export function listSpares(query: SpareQuery = {}): SparePageResult {
  const { filters = {}, page = 1, size = DEFAULT_PAGE_SIZE, sortByQuantity = 'asc' } = query
  const spares = loadSpares()
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  const matched = spares.filter((row) => pairs.every(([field, value]) => matchField(row, field, value)))
  matched.sort((a, b) => {
    const qa = toCount(a['现有数量']) ?? 0
    const qb = toCount(b['现有数量']) ?? 0
    if (qa !== qb) {
      return sortByQuantity === 'asc' ? qa - qb : qb - qa
    }
    return Number(a.id) - Number(b.id)
  })
  const pageSize = Math.max(1, size)
  const totalPages = Math.max(1, Math.ceil(matched.length / pageSize))
  const current = Math.min(Math.max(1, page), totalPages)
  const start = (current - 1) * pageSize
  return {
    items: matched.slice(start, start + pageSize),
    total: matched.length,
    page: current,
    size: pageSize,
    sortByQuantity,
  }
}

export function getSpare(id: number): EntryRow | null {
  return loadSpares().find((row) => Number(row.id) === id) ?? null
}

export function requisitionsForSpare(code: string): EntryRow[] {
  ensureSchema()
  return listRows(REQUISITION_KEY)
    .filter((row) => String(row['备件编号'] ?? '') === code)
    .sort((a, b) => String(b['出库时间'] ?? '').localeCompare(String(a['出库时间'] ?? '')))
}

export function listRequisitions(): EntryRow[] {
  ensureSchema()
  return [...listRows(REQUISITION_KEY)].sort((a, b) =>
    String(b['出库时间'] ?? '').localeCompare(String(a['出库时间'] ?? '')),
  )
}

// 库存页与缺陷消缺页共用这一份判定，两处低于安全存量的品类必然对得上。
export function lowStockSpares(): EntryRow[] {
  return loadSpares()
    .filter(isLowStock)
    .sort((a, b) => (toCount(a['现有数量']) ?? 0) - (toCount(b['现有数量']) ?? 0))
}

export function spareStats() {
  const spares = loadSpares()
  return {
    备件品类: spares.filter((row) => !isDisabled(row)).length,
    待补充品类: spares.filter((row) => String(row.status) === '待补充').length,
    低于安全存量: spares.filter(isLowStock).length,
  }
}

export function safetyVersionLabel(): string {
  return SAFETY_VERSION_LABEL
}

function fail(message: string): ActionResult {
  return { ok: false, message }
}

// 办理领用（出库）：先把所有关卡校验通过才动笔；扣库存与登记用流水在同一笔批量提交里落库，
// 任一步不成立就整笔回退——绝不允许只写下领用记录而账面不扣数。
export function issueSpare(input: IssueInput): ActionResult {
  ensureSchema()
  const code = input.领用单号?.trim() ?? ''
  if (!code) {
    return fail('领用单号这一格为空：请填写领用单号，同一张单只允许扣减一次')
  }
  const qty = positiveCount(input.领用数量)
  if (qty === null) {
    return fail(`领用数量这一格没对上：「${input.领用数量}」不是大于 0 的整数，扣减前校验未通过`)
  }
  const receiver = input.领用人?.trim() ?? ''
  if (!receiver) {
    return fail('领用人这一格为空：请填写实际领用人员')
  }

  const spares = listRows(SPARE_KEY)
  const index = spares.findIndex((row) => Number(row.id) === input.id)
  if (index < 0) {
    return fail(`备件编号对不上：没有找到编号为 ${input.id} 的备件`)
  }
  const target = spares[index]

  const ledger = listRows(REQUISITION_KEY)
  if (ledger.some((row) => String(row['领用单号'] ?? '') === code)) {
    // 同一张领用单连点两回：第二回在这里被挡住，数量不会再扣第二遍。
    return fail(`领用单「${code}」已办理过出库，系统已扣减过一次，禁止重复扣账`)
  }

  if (isDisabled(target)) {
    return fail(`「${spareCode(target)}」已停用，禁止出库；如需启用请先走补充检验流程`)
  }
  if (String(target['检验状态'] ?? '') !== INSPECTION_PASS) {
    return fail(
      `「${spareCode(target)}」还没走完检验：当前检验状态「${target['检验状态'] || '未登记'}」，` +
        `缺「登记检验合格」这一步，未检验合格的备件不许出库`,
    )
  }

  const currentQty = toCount(target['现有数量']) ?? 0
  if (qty > currentQty) {
    return fail(
      `扣减前数量校验未通过：「${spareCode(target)}」现有数量 ${currentQty}，本次申请领用 ${qty}，库存不足，整笔业务已回退`,
    )
  }

  const defectCode = input.关联缺陷编号?.trim() ?? ''
  if (defectCode) {
    const defectExists = listRows('defect').some(
      (row) => String(row['缺陷编号'] ?? '') === defectCode,
    )
    if (!defectExists) {
      return fail(`关联缺陷编号这一格没对上：缺陷台账里查不到「${defectCode}」`)
    }
  }

  const updated = syncDerived({ ...target, 现有数量: currentQty - qty })
  const entry: EntryRow = {
    id: nextId(ledger),
    status: '待领用',
    pending: true,
    abnormal: false,
    领用单号: code,
    备件编号: spareCode(target),
    备件名称: target['备件名称'] ?? '',
    领用数量: qty,
    领用人: receiver,
    关联缺陷编号: defectCode,
    出库时间: timeText(),
    台账状态: '待领用',
  }

  const nextSpares = [...spares]
  nextSpares[index] = updated
  // 扣账面与写领用流水（即缺陷消缺的待领用台账）一次性提交，要么都成要么都不动。
  saveRowsBatch({ [SPARE_KEY]: nextSpares, [REQUISITION_KEY]: [...ledger, entry] })

  const lowHint = isLowStock(updated) ? '，扣减后已低于安全存量，安全存量告警已点亮' : ''
  return {
    ok: true,
    message: `领用单「${code}」已出库：${spareCode(target)} 扣减 ${qty}，账面现有数量 ${updated['现有数量']}${lowHint}`,
  }
}

// 缺陷消缺页确认到货：待领用台账与备件出库共用同一份流水，这里只收口状态。
export function confirmRequisition(id: number): ActionResult {
  ensureSchema()
  const ledger = listRows(REQUISITION_KEY)
  const index = ledger.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return fail(`待领用台账里没有编号为 ${id} 的记录`)
  }
  const current = ledger[index]
  if (String(current['台账状态'] ?? current.status) !== '待领用') {
    return fail(`领用单「${current['领用单号']}」已确认领用，不能重复确认`)
  }
  const next = [...ledger]
  next[index] = { ...current, status: '已领用', pending: false, 台账状态: '已领用' }
  saveRows(REQUISITION_KEY, next)
  return { ok: true, message: `领用单「${current['领用单号']}」已确认领用并在台账中销项` }
}

export function passInspection(id: number): ActionResult {
  ensureSchema()
  const spares = listRows(SPARE_KEY)
  const index = spares.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return fail(`备件编号对不上：没有找到编号为 ${id} 的备件`)
  }
  const target = spares[index]
  if (isDisabled(target)) {
    return fail(`「${spareCode(target)}」已停用，不能登记检验合格；缺「恢复启用」步骤`)
  }
  if (String(target['检验状态'] ?? '') === INSPECTION_PASS && String(target.status) !== '待检验') {
    return fail(`「${spareCode(target)}」检验状态已是「${INSPECTION_PASS}」，缺的不是检验步骤，无需重复登记`)
  }
  const updated = syncDerived({ ...target, 检验状态: INSPECTION_PASS })
  const next = [...spares]
  next[index] = updated
  saveRows(SPARE_KEY, next)
  return { ok: true, message: `「${spareCode(target)}」已登记检验合格，当前状态「${updated.status}」` }
}

// 调整存放库位：只有该备件「本库位」的保管人本人能操作，其他人当场按越权拦截。
export function relocateSpare(id: number, newLocation: string, options: MutationOptions): ActionResult {
  ensureSchema()
  const location = newLocation.trim()
  if (!location) {
    return fail('新存放库位这一格为空：请填写目标库位编号')
  }
  const spares = listRows(SPARE_KEY)
  const index = spares.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return fail(`备件编号对不上：没有找到编号为 ${id} 的备件`)
  }
  const target = spares[index]
  const keeper = String(target['库位保管人'] ?? '')
  const operator = options.operator.trim()
  if (!keeper || operator !== keeper) {
    return fail(
      `越权拦截：存放库位「${target['存放库位']}」只有本库位保管人「${keeper || '未指定保管人'}」能改，` +
        `当前操作人「${operator || '未登录'}」无权调整`,
    )
  }
  if (location === String(target['存放库位'] ?? '')) {
    return fail(`新库位与当前库位「${location}」相同，无需调整`)
  }
  const updated = { ...target, 存放库位: location }
  const next = [...spares]
  next[index] = updated
  saveRows(SPARE_KEY, next)
  return { ok: true, message: `「${spareCode(target)}」存放库位已由「${target['存放库位']}」调整为「${location}」` }
}

export function replenishSpare(id: number, amount: unknown): ActionResult {
  ensureSchema()
  const add = positiveCount(amount)
  if (add === null) {
    return fail(`补货数量这一格没对上：「${amount}」不是大于 0 的整数`)
  }
  const spares = listRows(SPARE_KEY)
  const index = spares.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return fail(`备件编号对不上：没有找到编号为 ${id} 的备件`)
  }
  const target = spares[index]
  if (isDisabled(target)) {
    return fail(`「${spareCode(target)}」已停用，不能补货入库；缺「恢复启用」步骤`)
  }
  const updated = syncDerived({
    ...target,
    现有数量: (toCount(target['现有数量']) ?? 0) + add,
  })
  const next = [...spares]
  next[index] = updated
  saveRows(SPARE_KEY, next)
  return { ok: true, message: `「${spareCode(target)}」补货入库 ${add}，账面现有数量 ${updated['现有数量']}` }
}

// 盘点登记：写入盘点台账，并把账面数量锚定到本次实盘数——后续出库都在这个基线上增减。
export function recordStocktake(id: number, counted: unknown, options: MutationOptions): ActionResult {
  ensureSchema()
  const count = toCount(counted)
  if (count === null) {
    return fail(`实盘数量这一格没对上：「${counted}」不是非负整数`)
  }
  const spares = listRows(SPARE_KEY)
  const index = spares.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return fail(`备件编号对不上：没有找到编号为 ${id} 的备件`)
  }
  const target = spares[index]
  const stocktakes = listRows(STOCKTAKE_KEY)
  const today = dateText()
  const entry: EntryRow = {
    id: nextId(stocktakes),
    status: '已盘点',
    pending: false,
    abnormal: false,
    盘点单号: `STK-${today.replace(/-/g, '')}-${String(nextId(stocktakes)).padStart(3, '0')}`,
    备件编号: spareCode(target),
    盘点数量: count,
    盘点日期: today,
    盘点人: options.operator.trim() || '未署名',
    备注: '页面登记盘点',
  }
  const updated = syncDerived({ ...target, 现有数量: count, 最近盘点日期: today })
  const nextSpares = [...spares]
  nextSpares[index] = updated
  saveRowsBatch({ [SPARE_KEY]: nextSpares, [STOCKTAKE_KEY]: [...stocktakes, entry] })
  return { ok: true, message: `「${spareCode(target)}」已按盘点 ${count} 重新建账，账面现有数量 ${count}` }
}

export { DEFAULT_PAGE_SIZE, INSPECTION_PASS, INSPECTION_PENDING, SPARE_STATUSES }

import { commit, getDomain } from './store'
import {
  CURRENT_SAFETY_VERSION,
  MANAGER_APPROVE_LIMIT,
  keeperOf,
  safetyStockOf,
  warehouseName,
} from './catalog'
import type { OperatorProfile } from '@/data/types'
import type {
  CommandResult,
  InspectionStatus,
  LedgerSync,
  Requisition,
  Spare,
  SparePage,
  SpareQuery,
  SpareStats,
} from './types'

const WAREHOUSE_CODES = ['A-01', 'A-02']

// ---- 展示与派生 ----

export const INSPECTION_LABELS: Record<InspectionStatus, string> = {
  uninspected: '未送检',
  pending: '检验中',
  qualified: '检验合格',
  rejected: '检验不合格',
}

export const REQUISITION_LABELS: Record<Requisition['status'], string> = {
  submitted: '待保管人初审',
  keeperApproved: '保管人已初审',
  managerApproved: '站长已复核',
  rejected: '已驳回',
  issued: '已出库',
}

export function spareStatus(spare: Spare): string {
  if (spare.disabled) {
    return '已停用'
  }
  if (spare.inspection === 'pending') {
    return '待检验'
  }
  if (spare.inspection === 'uninspected') {
    return '未送检'
  }
  if (spare.inspection === 'rejected') {
    return '检验不合格'
  }
  return spare.onHand < spare.safetyStock ? '待补充' : '数量充足'
}

export function isLowStock(spare: Spare): boolean {
  return !spare.disabled && spare.onHand < spare.safetyStock
}

export function latestStocktake(spareId: number) {
  const domain = getDomain()
  return domain.stocktakes
    .filter((item) => item.spareId === spareId)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0]
}

export function spareRequisitions(spareId: number): Requisition[] {
  return getDomain()
    .requisitions.filter((item) => item.spareId === spareId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

// ---- 查询：按现有数量从少到多，查不到指明哪一格没对上 ----

export function querySpares(query: SpareQuery): SparePage {
  const all = getDomain().spares
  const conditions = [
    { field: '备件编号', key: 'code' as const, keyword: query.code.trim() },
    { field: '备件名称', key: 'name' as const, keyword: query.name.trim() },
    { field: '存放库位', key: 'warehouse' as const, keyword: query.warehouse.trim() },
  ].filter((item) => item.keyword !== '')

  const matched = all
    .filter((spare) =>
      conditions.every((item) => {
        if (item.key === 'warehouse') {
          return (
            spare.warehouse.includes(item.keyword) ||
            warehouseName(spare.warehouse).includes(item.keyword)
          )
        }
        return String(spare[item.key]).toLowerCase().includes(item.keyword.toLowerCase())
      }),
    )
    .sort((a, b) => a.onHand - b.onHand || (a.code < b.code ? -1 : 1))

  const fieldMatches = conditions.map((item) => ({
    field: item.field,
    keyword: item.keyword,
    matched: all.filter((spare) => {
      if (item.key === 'warehouse') {
        return (
          spare.warehouse.includes(item.keyword) ||
          warehouseName(spare.warehouse).includes(item.keyword)
        )
      }
      return String(spare[item.key]).toLowerCase().includes(item.keyword.toLowerCase())
    }).length,
  }))

  const size = query.size > 0 ? query.size : 5
  const pageCount = Math.max(1, Math.ceil(matched.length / size))
  const page = Math.min(Math.max(1, query.page), pageCount)
  return {
    items: matched.slice((page - 1) * size, page * size),
    total: matched.length,
    page,
    size,
    fieldMatches,
  }
}

export function lowStockSpares(): Spare[] {
  return getDomain()
    .spares.filter(isLowStock)
    .sort((a, b) => a.onHand - b.onHand || (a.code < b.code ? -1 : 1))
}

export function spareStats(): SpareStats {
  const domain = getDomain()
  return {
    categories: domain.spares.filter((item) => !item.disabled).length,
    lowStock: domain.spares.filter(isLowStock).length,
    pendingRequisition: domain.requisitions.filter((item) =>
      ['submitted', 'keeperApproved', 'managerApproved'].includes(item.status),
    ).length,
    uninspected: domain.spares.filter(
      (item) => !item.disabled && item.inspection !== 'qualified',
    ).length,
  }
}

// ---- 缺陷消缺待领用台账：与备件库同一事务写入，结论同源 ----

export type LedgerEntry = Requisition & {
  synced: boolean
  syncedAt: string
  lowAfterIssue: boolean
}

export function requisitionLedger(defectCode = ''): LedgerEntry[] {
  const domain = getDomain()
  const syncByReq = new Map(domain.ledgerSyncs.map((item) => [item.requisitionCode, item]))
  return domain.requisitions
    .filter((item) => item.defectCode !== '' && (defectCode === '' || item.defectCode === defectCode))
    .map((item) => {
      const sync = syncByReq.get(item.code)
      const spare = domain.spares.find((spareItem) => spareItem.id === item.spareId)
      return {
        ...item,
        synced: !!sync,
        syncedAt: sync?.syncedAt ?? '',
        lowAfterIssue: spare ? isLowStock(spare) : false,
      }
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

// ---- 事务命令 ----

function ok(message: string): CommandResult {
  return { ok: true, message }
}

function fail(message: string): CommandResult {
  return { ok: false, message }
}

function runCommit(mutate: (draft: ReturnType<typeof getDomain>) => void): CommandResult | undefined {
  try {
    commit(mutate)
    return undefined
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
}

function findSpare(draft: ReturnType<typeof getDomain>, spareId: number): Spare {
  const spare = draft.spares.find((item) => item.id === spareId)
  if (!spare) {
    throw new Error(`没有找到该备件，台账未做任何改动`)
  }
  return spare
}

function nowText(): string {
  const d = new Date()
  const pad = (num: number) => String(num).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 检验环节

export function submitInspection(spareId: number, operator: OperatorProfile): CommandResult {
  const denied = ensureKeeper(spareId, operator, '提交检验')
  if (denied) {
    return denied
  }
  const error = runCommit((draft) => {
    const spare = findSpare(draft, spareId)
    if (spare.disabled) {
      throw new Error('该备件已停用，不能再送检')
    }
    if (spare.inspection === 'qualified') {
      throw new Error('该备件已检验合格，无需重复送检')
    }
    if (spare.inspection === 'pending') {
      throw new Error('该备件已在检验中，等待登记检验结果即可')
    }
    spare.inspection = 'pending'
    spare.inspectionDate = ''
  })
  return error ?? ok('已提交检验，完成检验后须登记检验结果')
}

export function recordInspection(
  spareId: number,
  result: Extract<InspectionStatus, 'qualified' | 'rejected'>,
  operator: OperatorProfile,
): CommandResult {
  const denied = ensureKeeper(spareId, operator, '登记检验结果')
  if (denied) {
    return denied
  }
  const error = runCommit((draft) => {
    const spare = findSpare(draft, spareId)
    if (spare.inspection !== 'pending') {
      throw new Error(`该备件当前为「${INSPECTION_LABELS[spare.inspection]}」，还缺「提交检验」环节，不能直接登记结果`)
    }
    spare.inspection = result
    spare.inspectionDate = nowText().slice(0, 10)
    if (result === 'rejected') {
      spare.disabled = true
    }
  })
  return error ?? ok(result === 'qualified' ? '检验合格，已允许出库' : '检验不合格，已标记停用并禁止出库')
}

// 库位调整：只有本库位保管人能改

export function changeWarehouse(
  spareId: number,
  targetWarehouse: string,
  operator: OperatorProfile,
): CommandResult {
  const spare = getDomain().spares.find((item) => item.id === spareId)
  if (!spare) {
    return fail('没有找到该备件，台账未做任何改动')
  }
  if (operator.role !== 'keeper') {
    return fail(
      `越权拦截：只有备件当前所在库位「${warehouseName(spare.warehouse)}（${spare.warehouse}）」的保管人才能调整存放库位，${operator.name} 不是库位保管人`,
    )
  }
  if (operator.warehouse !== spare.warehouse) {
    return fail(
      `越权拦截：${operator.name} 是 ${warehouseName(operator.warehouse)}（${operator.warehouse}）的保管人，该备件当前在 ${warehouseName(spare.warehouse)}（${spare.warehouse}），跨库位不能改`,
    )
  }
  if (!WAREHOUSE_CODES.includes(targetWarehouse)) {
    return fail('目标库位不存在，请选择系统登记的库位')
  }
  if (targetWarehouse === spare.warehouse) {
    return fail('目标库位与当前库位相同，无需调整')
  }
  const error = runCommit((draft) => {
    const target = findSpare(draft, spareId)
    target.warehouse = targetWarehouse
  })
  return error ?? ok(`存放库位已调整为 ${warehouseName(targetWarehouse)}（${targetWarehouse}），后续由该库位保管人 ${keeperOf(targetWarehouse)} 负责`)
}

// 盘点：备件数量从最近一次盘点补起

export function recordStocktake(
  spareId: number,
  countedQty: number,
  operator: OperatorProfile,
  remark: string,
): CommandResult {
  if (!Number.isInteger(countedQty) || countedQty < 0) {
    return fail('盘点数量必须是不小于 0 的整数')
  }
  const denied = ensureKeeper(spareId, operator, '登记盘点')
  if (denied) {
    return denied
  }
  const error = runCommit((draft) => {
    const spare = findSpare(draft, spareId)
    draft.seq.stocktake += 1
    draft.stocktakes.push({
      id: draft.seq.stocktake,
      spareId: spare.id,
      date: nowText().slice(0, 10),
      countedQty,
      keeper: operator.name,
      remark: remark || '周期盘点',
    })
    // 以最近一次盘点为准重记账面数量。
    spare.onHand = countedQty
  })
  return error ?? ok(`盘点已登记，账面数量从本次盘点补起：现有数量 ${countedQty} 件`)
}

// 备件登记

export type SpareDraft = {
  code: string
  name: string
  applicable: string
  spec: string
  onHand: number
  // 留空时按核定名录取值
  safetyStock?: number
  warehouse: string
}

export function registerSpare(draft: SpareDraft, operator: OperatorProfile): CommandResult {
  if (operator.role === 'crew') {
    return fail('越权拦截：作业班组不能登记备件，请由库位保管人或站长办理')
  }
  const code = draft.code.trim().toUpperCase()
  if (!/^[A-Z0-9-]+$/.test(code)) {
    return fail('备件编号不能为空，且只能包含字母、数字与连字符')
  }
  if (!draft.name.trim()) {
    return fail('备件名称不能为空')
  }
  if (!Number.isInteger(draft.onHand) || draft.onHand < 0) {
    return fail('现有数量必须是不小于 0 的整数')
  }
  const safetyStock = draft.safetyStock ?? safetyStockOf(code)
  if (!Number.isInteger(safetyStock) || safetyStock < 0) {
    return fail('安全存量必须是不小于 0 的整数')
  }
  const warehouse = draft.warehouse || operator.warehouse
  if (!WAREHOUSE_CODES.includes(warehouse)) {
    return fail('存放库位不存在，请选择系统登记的库位')
  }
  const error = runCommit((state) => {
    if (state.spares.some((item) => item.code === code)) {
      throw new Error(`备件编号 ${code} 已存在，不能重复登记`)
    }
    state.seq.spare += 1
    state.spares.push({
      id: state.seq.spare,
      code,
      name: draft.name.trim(),
      applicable: draft.applicable.trim(),
      spec: draft.spec.trim(),
      onHand: draft.onHand,
      safetyStock,
      safetyVersion: CURRENT_SAFETY_VERSION,
      warehouse,
      inspection: 'uninspected',
      inspectionDate: '',
      disabled: false,
      remark: '新登记备件，须先送检合格才能出库',
    })
    state.seq.stocktake += 1
    state.stocktakes.push({
      id: state.seq.stocktake,
      spareId: state.seq.spare,
      date: nowText().slice(0, 10),
      countedQty: draft.onHand,
      keeper: operator.name,
      remark: '登记时初始盘点',
    })
  })
  return error ?? ok(`备件 ${code} 已登记，检验合格前不允许出库`)
}

// ---- 领用单 ----

type RequisitionDraft = {
  spareId: number
  quantity: number
  defectCode: string
  purpose: string
}

export function submitRequisition(draft: RequisitionDraft, operator: OperatorProfile): CommandResult {
  let spare: Spare | undefined
  try {
    spare = findSpare(getDomain(), draft.spareId)
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
  const qtyError = ensureIntegerSafe(draft.quantity, '领用数量')
  if (qtyError) {
    return qtyError
  }
  if (spare.disabled) {
    return fail('该备件已停用，不能发起领用')
  }
  if (spare.inspection !== 'qualified') {
    return fail(`拦截：该备件尚未走完检验，当前为「${INSPECTION_LABELS[spare.inspection]}」，缺少「检验合格」环节，不能领用`)
  }
  if (spare.onHand < draft.quantity) {
    return fail(`数量校验失败：现有数量 ${spare.onHand} 件，不足领用 ${draft.quantity} 件`)
  }
  let code = ''
  const error = runCommit((state) => {
    const target = findSpare(state, draft.spareId)
    state.seq.requisition += 1
    code = nextRequisitionCode(state.seq.requisition)
    state.requisitions.push({
      id: state.seq.requisition,
      code,
      spareId: target.id,
      spareCode: target.code,
      spareName: target.name,
      quantity: draft.quantity,
      warehouse: target.warehouse,
      applicant: operator.name,
      createdAt: nowText(),
      status: 'submitted',
      keeperApprover: '',
      managerApprover: '',
      issuedAt: '',
      defectCode: draft.defectCode.trim().toUpperCase(),
      purpose: draft.purpose.trim(),
    })
  })
  if (error) {
    return error
  }
  const needManager = draft.quantity > MANAGER_APPROVE_LIMIT
  return ok(
    `领用单 ${code} 已提交（领用 ${draft.quantity} 件），下一步：库位保管人初审${needManager ? ' → 站长复核' : ''} → 保管人办理领用`,
  )
}

function nextRequisitionCode(seq: number): string {
  const d = new Date()
  const period = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
  return `LL-${period}-${String(seq).padStart(3, '0')}`
}

function ensureIntegerSafe(value: number, label: string): CommandResult | null {
  if (!Number.isInteger(value) || value <= 0) {
    return fail(`${label}必须是大于 0 的整数`)
  }
  return null
}

export function approveRequisition(
  requisitionId: number,
  operator: OperatorProfile,
): CommandResult {
  const req = getDomain().requisitions.find((item) => item.id === requisitionId)
  if (!req) {
    return fail('没有找到该领用单')
  }
  const spare = getDomain().spares.find((item) => item.id === req.spareId)

  if (req.status === 'issued') {
    return fail(`领用单 ${req.code} 已出库，无需再审批`)
  }
  if (req.status === 'rejected') {
    return fail(`领用单 ${req.code} 已驳回，不能继续审批`)
  }
  if (req.status === 'managerApproved') {
    return fail('该领用单已完成站长复核，等待保管人办理领用')
  }

  if (req.status === 'submitted') {
    if (operator.role === 'crew') {
      return fail('越权拦截：作业班组不能审批领用单，请由备件所在库位的保管人初审')
    }
    if (operator.role === 'manager') {
      return fail(`越级拦截：站长复核排在保管人初审之后，当前还缺「保管人初审」一步，请先由 ${warehouseName(req.warehouse)} 的保管人初审`)
    }
    if (operator.warehouse !== req.warehouse) {
      return fail(`越权拦截：${operator.name} 不是 ${warehouseName(req.warehouse)}（${req.warehouse}）的保管人，不能初审该库位的领用单`)
    }
    const error = runCommit((draft) => {
      const target = draft.requisitions.find((item) => item.id === requisitionId)
      if (!target || target.status !== 'submitted') {
        throw new Error('领用单状态已变化，请刷新后重试')
      }
      target.status = 'keeperApproved'
      target.keeperApprover = operator.name
    })
    if (error) {
      return error
    }
    return req.quantity > MANAGER_APPROVE_LIMIT
      ? ok(`保管人初审已通过，领用 ${req.quantity} 件超过 ${MANAGER_APPROVE_LIMIT} 件阈值，还缺「站长复核」一步`)
      : ok('保管人初审已通过，可由本库位保管人办理领用出库')
  }

  // keeperApproved：只有需要站长复核的大额单才能走到这里
  if (req.quantity <= MANAGER_APPROVE_LIMIT) {
    return fail(`该领用单仅领用 ${req.quantity} 件、未超过 ${MANAGER_APPROVE_LIMIT} 件阈值，不需要站长复核，保管人可直接办理出库`)
  }
  if (operator.role !== 'manager') {
    return fail(`越级拦截：大额领用单还缺「站长复核」一步，${operator.name} 不能代行站长复核`)
  }
  const error = runCommit((draft) => {
    const target = draft.requisitions.find((item) => item.id === requisitionId)
    if (!target || target.status !== 'keeperApproved') {
      throw new Error('领用单状态已变化，请刷新后重试')
    }
    target.status = 'managerApproved'
    target.managerApprover = operator.name
  })
  if (error) {
    return error
  }
  return ok('站长复核已通过，保管人可以办理领用出库')
}

export function rejectRequisition(
  requisitionId: number,
  operator: OperatorProfile,
  reason: string,
): CommandResult {
  const req = getDomain().requisitions.find((item) => item.id === requisitionId)
  if (!req) {
    return fail('没有找到该领用单')
  }
  if (['issued', 'rejected'].includes(req.status)) {
    return fail(`领用单已是「${REQUISITION_LABELS[req.status]}」终态，不能驳回`)
  }
  if (operator.role === 'crew') {
    return fail('越权拦截：作业班组不能驳回领用单')
  }
  if (req.status === 'submitted') {
    if (operator.role !== 'keeper' || operator.warehouse !== req.warehouse) {
      return fail('只有该备件所在库位的保管人能在初审环节驳回此单')
    }
  } else if (operator.role !== 'manager') {
    return fail('保管人初审之后的驳回须由站长决定')
  }
  const error = runCommit((draft) => {
    const target = draft.requisitions.find((item) => item.id === requisitionId)
    if (!target || ['issued', 'rejected'].includes(target.status)) {
      throw new Error('领用单状态已变化，请刷新后重试')
    }
    target.status = 'rejected'
    target.purpose = reason.trim() ? `${target.purpose}（驳回原因：${reason.trim()}）` : target.purpose
  })
  return error ?? ok(`领用单 ${req.code} 已驳回，账面数量未做任何改动`)
}

// 办理领用（销账出库）：扣减与台账登记在同一事务里，同一张单只能扣一次。

export function issueRequisition(requisitionId: number, operator: OperatorProfile): CommandResult {
  const req = getDomain().requisitions.find((item) => item.id === requisitionId)
  if (!req) {
    return fail('没有找到该领用单')
  }
  const spare = getDomain().spares.find((item) => item.id === req.spareId)

  // 幂等：已销账的单再次点击，当场拦住，绝不允许再扣一遍。
  if (req.status === 'issued') {
    return fail(`领用单 ${req.code} 已于 ${req.issuedAt} 销账出库（当时扣减 ${req.quantity} 件），不能重复办理；现有数量 ${spare?.onHand ?? 0} 件`)
  }
  if (req.status === 'rejected') {
    return fail(`领用单 ${req.code} 已驳回，不能出库`)
  }

  if (operator.role === 'crew') {
    return fail('越权拦截：作业班组不能办理出库，请由备件所在库位的保管人办理')
  }
  if (operator.role === 'manager') {
    return fail('越权拦截：站长不能越权直接办理出库，请由备件所在库位的保管人办理')
  }
  if (!spare) {
    return fail('领用单对应的备件已不存在，已整笔回退、未扣减')
  }
  if (operator.warehouse !== spare.warehouse) {
    return fail(`越权拦截：${operator.name} 不是 ${warehouseName(spare.warehouse)}（${spare.warehouse}）的保管人，不能办理该库位出库`)
  }
  if (spare.disabled) {
    return fail('该备件已停用，禁止出库；已整笔回退、未扣减')
  }
  if (spare.inspection !== 'qualified') {
    return fail(`检验拦截：备件 ${spare.code} 当前为「${INSPECTION_LABELS[spare.inspection]}」，还缺「检验合格」环节，不能出库；已整笔回退、未扣减`)
  }
  if (req.status === 'submitted') {
    if (req.quantity > MANAGER_APPROVE_LIMIT) {
      return fail(`越级拦截：领用 ${req.quantity} 件超过 ${MANAGER_APPROVE_LIMIT} 件阈值，当前还缺「保管人初审」「站长复核」两步，不能出库`)
    }
    return fail('越级拦截：该领用单还缺「保管人初审」一步，保管人不能跳过审批直接出库')
  }
  if (req.status === 'keeperApproved' && req.quantity > MANAGER_APPROVE_LIMIT) {
    return fail(`越级拦截：领用 ${req.quantity} 件超过 ${MANAGER_APPROVE_LIMIT} 件阈值，当前还缺「站长复核」一步，不能出库`)
  }

  let message = ''
  const error = runCommit((draft) => {
    const targetReq = draft.requisitions.find((item) => item.id === requisitionId)
    const targetSpare = draft.spares.find((item) => item.id === req.spareId)
    if (!targetReq || !targetSpare) {
      throw new Error('台账数据缺失，已整笔回退、未扣减')
    }
    if (targetReq.status === 'issued') {
      throw new Error('该领用单已被处理，请勿重复提交')
    }
    // 扣减前在事务内再校验一次数量，扣减与领用登记同生共死。
    if (!Number.isInteger(targetSpare.onHand) || targetSpare.onHand < targetReq.quantity) {
      throw new Error(`扣减前数量校验失败：现有数量 ${targetSpare.onHand} 件，不足领用 ${targetReq.quantity} 件，已整笔回退、未扣减`)
    }
    targetSpare.onHand -= targetReq.quantity
    targetReq.status = 'issued'
    targetReq.issuedAt = nowText()
    if (targetReq.defectCode) {
      // 出库结论同步到缺陷消缺待领用台账，与扣减在同一事务里提交。
      const sync: LedgerSync = {
        requisitionCode: targetReq.code,
        defectCode: targetReq.defectCode,
        syncedAt: targetReq.issuedAt,
        spareCode: targetSpare.code,
        spareName: targetSpare.name,
        quantity: targetReq.quantity,
        warehouse: targetSpare.warehouse,
        conclusion: 'issued',
      }
      const index = draft.ledgerSyncs.findIndex((item) => item.requisitionCode === targetReq.code)
      if (index >= 0) {
        draft.ledgerSyncs[index] = sync
      } else {
        draft.ledgerSyncs.push(sync)
      }
    }
    const remain = targetSpare.onHand
    message = `领用单 ${targetReq.code} 销账完成：${targetSpare.code} 扣减 ${targetReq.quantity} 件，现有数量 ${remain} 件`
      + (remain < targetSpare.safetyStock ? `，已低于安全存量 ${targetSpare.safetyStock} 件（按${CURRENT_SAFETY_VERSION}核定）` : '')
      + (targetReq.defectCode ? `，出库结论已同步到缺陷 ${targetReq.defectCode} 的待领用台账` : '')
  })
  return error ?? ok(message)
}

// ---- 权限辅助 ----

function ensureKeeper(
  spareId: number,
  operator: OperatorProfile,
  action: string,
): CommandResult | null {
  const spare = getDomain().spares.find((item) => item.id === spareId)
  if (!spare) {
    return fail('没有找到该备件，台账未做任何改动')
  }
  if (operator.role !== 'keeper') {
    return fail(`越权拦截：${action}须由备件所在库位的保管人办理，${operator.name} 当前身份不是库位保管人`)
  }
  if (operator.warehouse !== spare.warehouse) {
    return fail(`越权拦截：${operator.name} 是 ${warehouseName(operator.warehouse)}（${operator.warehouse}）的保管人，该备件在 ${warehouseName(spare.warehouse)}（${spare.warehouse}），跨库位不能${action}`)
  }
  return null
}

// ---- 导出 ----

export function exportSparesCsv(): { filename: string; content: string } {
  const header = [
    '备件编号',
    '备件名称',
    '适用设备',
    '规格型号',
    '现有数量',
    `安全存量(${CURRENT_SAFETY_VERSION}核定)`,
    '存放库位',
    '检验状态',
    '账面状态',
  ]
  const lines = [header.join(',')]
  const domain = getDomain()
  for (const spare of [...domain.spares].sort((a, b) => a.onHand - b.onHand || (a.code < b.code ? -1 : 1))) {
    lines.push(
      [
        spare.code,
        spare.name,
        spare.applicable,
        spare.spec,
        spare.onHand,
        spare.safetyStock,
        `${spare.warehouse} ${warehouseName(spare.warehouse)}`,
        INSPECTION_LABELS[spare.inspection],
        spareStatus(spare),
      ].join(','),
    )
  }
  return { filename: '备品备件-清单.csv', content: `﻿${lines.join('\n')}` }
}

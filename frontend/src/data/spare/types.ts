import type { OperatorProfile, OperatorRole } from '@/data/types'

// 备件检验环节：未走完检验的备件不允许出库。
export type InspectionStatus = 'uninspected' | 'pending' | 'qualified' | 'rejected'

// 领用单状态：申请 → 库位保管人初审 → （大额）站长复核 → 保管人办理领用扣减。
export type RequisitionStatus = 'submitted' | 'keeperApproved' | 'managerApproved' | 'rejected' | 'issued'

export type Spare = {
  id: number
  code: string
  name: string
  applicable: string
  spec: string
  onHand: number
  safetyStock: number
  safetyVersion: string
  warehouse: string
  inspection: InspectionStatus
  inspectionDate: string
  disabled: boolean
  remark?: string
}

export type Requisition = {
  id: number
  code: string
  spareId: number
  spareCode: string
  spareName: string
  quantity: number
  warehouse: string
  applicant: string
  createdAt: string
  status: RequisitionStatus
  keeperApprover: string
  managerApprover: string
  issuedAt: string
  defectCode: string
  purpose: string
}

export type Stocktake = {
  id: number
  spareId: number
  date: string
  countedQty: number
  keeper: string
  remark: string
}

export type LedgerSync = {
  requisitionCode: string
  defectCode: string
  syncedAt: string
  spareCode: string
  spareName: string
  quantity: number
  warehouse: string
  conclusion: RequisitionStatus
}

export type SpareDomain = {
  schemaVersion: number
  spares: Spare[]
  requisitions: Requisition[]
  stocktakes: Stocktake[]
  ledgerSyncs: LedgerSync[]
  seq: { spare: number; requisition: number; stocktake: number }
  initializedAt: string
}

export type SpareQuery = {
  code: string
  name: string
  warehouse: string
  page: number
  size: number
}

export type SparePage = {
  items: Spare[]
  total: number
  page: number
  size: number
  // 逐条过滤条件的命中情况：查不到时写明是哪一格没对上。
  fieldMatches: { field: string; keyword: string; matched: number }[]
}

export type CommandResult = {
  ok: boolean
  message: string
}

export type SpareStats = {
  categories: number
  lowStock: number
  pendingRequisition: number
  uninspected: number
}

export type { OperatorProfile, OperatorRole }

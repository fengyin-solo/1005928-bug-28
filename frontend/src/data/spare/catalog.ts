import type { OperatorProfile } from '@/data/types'
import type { EntryRow } from '@/data/types'
import type { InspectionStatus, SpareDomain } from './types'

// 库位与保管人：只有本库位的保管人能改自己库位上的备件。
export const WAREHOUSES = [
  { code: 'A-01', name: '一号库房（升压站侧）', keeper: '王库管' },
  { code: 'A-02', name: '二号库房（方阵区侧）', keeper: '李库管' },
]

export const OPERATORS: OperatorProfile[] = [
  { name: '王库管', role: 'keeper', warehouse: 'A-01' },
  { name: '李库管', role: 'keeper', warehouse: 'A-02' },
  { name: '周站长', role: 'manager', warehouse: '' },
  { name: '赵作业', role: 'crew', warehouse: '' },
]

export function warehouseName(code: string): string {
  return WAREHOUSES.find((item) => item.code === code)?.name ?? code
}

export function keeperOf(warehouse: string): string {
  return WAREHOUSES.find((item) => item.code === warehouse)?.keeper ?? ''
}

// 超过该数量的领用单必须站长复核，保管人不得越级直接出库。
export const MANAGER_APPROVE_LIMIT = 5

// 安全存量核定版本：安全存量统一以 2026 年第二版核定数为准，
// 旧版（V1）与既有备件记录一律并轨到 V2；查不到品类名录的按 5 件兜底。
export const CURRENT_SAFETY_VERSION = '2026-V2'
const SAFETY_V2_CATALOG: Record<string, number> = {
  'SPAR-0001': 6,
  'SPAR-0002': 4,
  'SPAR-0003': 8,
}
const LEGACY_SAFETY_FALLBACK = 5

export function safetyStockOf(code: string): number {
  return SAFETY_V2_CATALOG[code] ?? LEGACY_SAFETY_FALLBACK
}

function blankRequisition(id: number) {
  return {
    id,
    code: '',
    spareId: 0,
    spareCode: '',
    spareName: '',
    quantity: 0,
    warehouse: '',
    applicant: '',
    createdAt: '',
    status: 'submitted' as const,
    keeperApprover: '',
    managerApprover: '',
    issuedAt: '',
    defectCode: '',
    purpose: '',
  }
}

// 全新安装时的示例数据：数量从最近一次盘点补起，
// 之后每发生一次领用/补记，账面在盘点数基础上接续滚动。
function nativeDomain(): SpareDomain {
  const STOCKTAKE_DATE = '2026-09-25'
  const spares = [
    { id: 1, code: 'SPAR-0001', name: 'MC4光伏连接器', applicable: '组串阵列', spec: '1500V/30A', onHand: 4, safetyStock: 6, warehouse: 'A-01', inspection: 'qualified' as InspectionStatus, inspectionDate: '2026-09-18', disabled: false },
    { id: 2, code: 'SPAR-0002', name: '直流熔断器', applicable: '直流汇流箱', spec: 'gPV 15A/1000V', onHand: 3, safetyStock: 4, warehouse: 'A-02', inspection: 'qualified' as InspectionStatus, inspectionDate: '2026-09-18', disabled: false },
    { id: 3, code: 'SPAR-0003', name: '逆变器散热风扇', applicable: '集中式逆变器', spec: 'AC220V/120W', onHand: 2, safetyStock: 8, warehouse: 'A-01', inspection: 'qualified' as InspectionStatus, inspectionDate: '2026-09-16', disabled: false },
    { id: 4, code: 'SPAR-0004', name: '组件清洗毛刷', applicable: '清洗设备', spec: '伸缩杆 4m', onHand: 18, safetyStock: 5, warehouse: 'A-02', inspection: 'qualified' as InspectionStatus, inspectionDate: '2026-09-15', disabled: false },
    { id: 5, code: 'SPAR-0005', name: '交流接触器', applicable: '逆变器柜', spec: 'LC1D40 220V', onHand: 12, safetyStock: 5, warehouse: 'A-01', inspection: 'qualified' as InspectionStatus, inspectionDate: '2026-09-12', disabled: false },
    { id: 6, code: 'SPAR-0006', name: '智能光伏组件', applicable: '组串阵列', spec: '550Wp 单晶硅', onHand: 12, safetyStock: 5, warehouse: 'A-02', inspection: 'pending' as InspectionStatus, inspectionDate: '', disabled: false },
    { id: 7, code: 'SPAR-0007', name: '防雷模块', applicable: '直流汇流箱', spec: '1000V/40kA', onHand: 9, safetyStock: 5, warehouse: 'A-01', inspection: 'qualified' as InspectionStatus, inspectionDate: '2026-09-10', disabled: false },
    { id: 8, code: 'SPAR-0008', name: '旧版通讯采集板', applicable: '老式逆变器', spec: 'RS485 V1', onHand: 0, safetyStock: 5, warehouse: 'A-02', inspection: 'rejected' as InspectionStatus, inspectionDate: '2026-09-08', disabled: true },
  ].map((item) => ({ ...item, safetyVersion: CURRENT_SAFETY_VERSION }))

  // 9-25 盘点时 SPAR-0001 实盘 6 件，9-26 领用 2 件后账面接续为 4 件。
  const stocktakes = spares.map((spare, index) => ({
    id: index + 1,
    spareId: spare.id,
    date: STOCKTAKE_DATE,
    countedQty: spare.id === 1 ? 6 : spare.onHand,
    keeper: keeperOf(spare.warehouse),
    remark: '最近一次月度盘点',
  }))

  // 一张已出库领用单：9-26 从盘点数上扣减，账面已经接续到扣后值。
  const issued = {
    ...blankRequisition(1),
    code: 'LL-202609-001',
    spareId: 1,
    spareCode: 'SPAR-0001',
    spareName: 'MC4光伏连接器',
    quantity: 2,
    warehouse: 'A-01',
    applicant: '赵作业',
    createdAt: '2026-09-26 09:12',
    status: 'issued' as const,
    keeperApprover: '王库管',
    issuedAt: '2026-09-26 09:40',
    defectCode: 'DEFE-0002',
    purpose: '组串连接器烧毁消缺',
  }

  // 进行中的领用单，用来演示权限/越级拦截。
  const requisitions = [
    issued,
    {
      ...blankRequisition(2),
      code: 'LL-202609-002',
      spareId: 2,
      spareCode: 'SPAR-0002',
      spareName: '直流熔断器',
      quantity: 1,
      warehouse: 'A-02',
      applicant: '赵作业',
      createdAt: '2026-09-27 14:05',
      status: 'submitted' as const,
      defectCode: 'DEFE-0001',
      purpose: '汇流箱熔断器熔断更换',
    },
    {
      ...blankRequisition(3),
      code: 'LL-202609-003',
      spareId: 5,
      spareCode: 'SPAR-0005',
      spareName: '交流接触器',
      quantity: 8,
      warehouse: 'A-01',
      applicant: '赵作业',
      createdAt: '2026-09-27 15:20',
      status: 'keeperApproved' as const,
      keeperApprover: '王库管',
      defectCode: '',
      purpose: '逆变器柜接触器批量更换',
    },
    {
      ...blankRequisition(4),
      code: 'LL-202609-004',
      spareId: 7,
      spareCode: 'SPAR-0007',
      spareName: '防雷模块',
      quantity: 2,
      warehouse: 'A-01',
      applicant: '赵作业',
      createdAt: '2026-09-28 08:50',
      status: 'submitted' as const,
      defectCode: 'DEFE-0003',
      purpose: '防雷模块裂损消缺',
    },
  ]

  // 已出库领用单同步到缺陷消缺待领用台账的落点。
  const ledgerSyncs = [
    {
      requisitionCode: issued.code,
      defectCode: issued.defectCode,
      syncedAt: issued.issuedAt,
      spareCode: issued.spareCode,
      spareName: issued.spareName,
      quantity: issued.quantity,
      warehouse: issued.warehouse,
      conclusion: 'issued' as const,
    },
  ]

  return {
    schemaVersion: 2,
    spares,
    requisitions,
    stocktakes,
    ledgerSyncs,
    seq: { spare: 8, requisition: 4, stocktake: stocktakes.length },
    initializedAt: '2026-09-25',
  }
}

function toNumber(value: unknown, fallback: number): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

// 兼容既有备件记录：旧脚手架的安全存量/库位是占位文本，按以下规则并轨——
// 数量沿用最近一次盘点（即既有现有数量），安全存量取 V2 核定数，
// 检验默认补登为合格（已停用的除外），库位无对应库位的归入 A-01。
function migrateLegacy(legacyRows: EntryRow[]): SpareDomain {
  const legacy = legacyRows
  const spares = legacy.map((row, index) => {
    const code = String(row['备件编号'] ?? `SPAR-LEG-${index + 1}`)
    const disabled = String(row.status) === '已停用'
    const inspection: InspectionStatus =
      String(row.status) === '待检验' ? 'pending' : disabled ? 'rejected' : 'qualified'
    const onHand = toNumber(row['现有数量'], 0)
    return {
      id: Number(row.id) || index + 1,
      code,
      name: String(row['备件名称'] ?? `既有备件${index + 1}`),
      applicable: String(row['适用设备'] ?? ''),
      spec: String(row['规格型号'] ?? ''),
      onHand,
      safetyStock: safetyStockOf(code),
      safetyVersion: CURRENT_SAFETY_VERSION,
      warehouse: 'A-01',
      inspection,
      inspectionDate: inspection === 'qualified' ? '2026-09-20' : '',
      disabled,
      remark: '由既有备件记录并轨，数量取自最近一次盘点',
    }
  })
  const stocktakes = spares.map((spare, index) => ({
    id: index + 1,
    spareId: spare.id,
    date: '2026-09-20',
    countedQty: spare.onHand,
    keeper: keeperOf(spare.warehouse),
    remark: '既有记录最近一次盘点',
  }))
  return {
    schemaVersion: 2,
    spares,
    requisitions: [],
    stocktakes,
    ledgerSyncs: [],
    seq: { spare: spares.length, requisition: 0, stocktake: stocktakes.length },
    initializedAt: '2026-09-20',
  }
}

export function buildInitialDomain(legacyRows: EntryRow[] | null): SpareDomain {
  return legacyRows && legacyRows.length ? migrateLegacy(legacyRows) : nativeDomain()
}

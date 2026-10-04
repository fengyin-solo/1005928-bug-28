import assert from 'node:assert'
import { listRows } from '@/data/local-store'
import {
  confirmRequisition,
  issueSpare,
  listSpares,
  lowStockSpares,
  mismatchedFields,
  passInspection,
  recordStocktake,
  relocateSpare,
  replenishSpare,
  requisitionsForSpare,
  safetyVersionLabel,
  spareStats,
} from '@/api/spare-service'

// 首次经服务层读取时完成一次性结构迁移（盘点补账 + 安全存量核定）。
listSpares({})

let passed = 0
function check(name, fn) {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

function spareByCode(code) {
  return listRows('spare').find((r) => r['备件编号'] === code)
}
function ledgerCount() {
  return listRows('requisition').length
}

console.log('一、盘点补账 + 安全存量核定（既有占位数据兼容）')
check('安全存量采用 2026-V1 核定版，无法解析的占位格按默认定额 5 兜底并补登版本号', () => {
  const spares = listRows('spare')
  assert.ok(safetyVersionLabel().includes('2026-V1'))
  for (const row of spares) {
    assert.strictEqual(row['安全存量版本'], '2026-V1')
    assert.strictEqual(typeof row['安全存量'], 'number')
  }
})

check('现有数量从最近一次盘点补起：SPAR-0001 取 2026-09-28 实盘 4，旧盘 9 不采用', () => {
  assert.strictEqual(spareByCode('SPAR-0001')['现有数量'], 4)
})

check('盘点基线还要扣掉盘点后已出库的领用流水：SPAR-0004 = 3 - 1 = 2', () => {
  assert.strictEqual(spareByCode('SPAR-0004')['现有数量'], 2)
})

check('账面状态随数量重算：SPAR-0001/0004 低于安全存量并亮线，待检验件仍为待检验', () => {
  assert.strictEqual(spareByCode('SPAR-0001').status, '待补充')
  assert.strictEqual(spareByCode('SPAR-0001')['存量状态'], '低于安全存量')
  assert.strictEqual(spareByCode('SPAR-0004')['存量状态'], '低于安全存量')
  assert.strictEqual(spareByCode('SPAR-0003').status, '待检验')
})

console.log('二、找件：排序、编号检索、逐格报错')
check('默认按现有数量从少到多排序', () => {
  const items = listSpares({}).items
  const qtys = items.map((r) => r['现有数量'])
  const sorted = [...qtys].sort((a, b) => a - b)
  assert.deepStrictEqual(qtys, sorted)
})

check('输入备件编号只查到那一条', () => {
  const res = listSpares({ filters: { 备件编号: 'SPAR-0002' } })
  assert.strictEqual(res.total, 1)
  assert.strictEqual(res.items[0]['备件编号'], 'SPAR-0002')
})

check('查不到时点名是哪一格没对上', () => {
  assert.deepStrictEqual(mismatchedFields({ 备件编号: 'NO-SUCH' }), ['备件编号'])
  assert.deepStrictEqual(
    mismatchedFields({ 备件编号: 'NO-SUCH', 备件名称: '变压器' }).sort(),
    ['备件编号', '备件名称'].sort(),
  )
})

check('翻页时条件与排序不丢（分页结果合计仍是筛选全集）', () => {
  const p1 = listSpares({ filters: {}, page: 1, size: 3 })
  const p2 = listSpares({ filters: {}, page: 2, size: 3 })
  const codes = [...p1.items, ...p2.items].map((r) => r['备件编号'])
  assert.strictEqual(new Set(codes).size, 6)
  assert.strictEqual(p1.sortByQuantity, 'asc')
})

console.log('三、办理领用：未检验拦截、库存校验、账面扣减、流水同源')
check('没走完检验的备件不许出库，并指出缺「登记检验合格」这一步', () => {
  const r = issueSpare({ id: spareByCode('SPAR-0003').id, 领用单号: 'REQ-T-1', 领用数量: 1, 领用人: '张运维' })
  assert.strictEqual(r.ok, false)
  assert.ok(r.message.includes('登记检验合格'))
  assert.strictEqual(spareByCode('SPAR-0003')['现有数量'], 60)
})

check('已停用备件不许出库', () => {
  const r = issueSpare({ id: spareByCode('SPAR-0006').id, 领用单号: 'REQ-T-2', 领用数量: 1, 领用人: '张运维' })
  assert.strictEqual(r.ok, false)
  assert.ok(r.message.includes('已停用'))
})

check('扣减前先校验数量：领用量超过现有数量直接拒绝，账面与流水都不动', () => {
  const before = ledgerCount()
  const r = issueSpare({ id: spareByCode('SPAR-0004').id, 领用单号: 'REQ-T-3', 领用数量: 99, 领用人: '张运维' })
  assert.strictEqual(r.ok, false)
  assert.ok(r.message.includes('扣减前数量校验未通过'))
  assert.strictEqual(spareByCode('SPAR-0004')['现有数量'], 2)
  assert.strictEqual(ledgerCount(), before)
})

check('领用单号、数量、领用人为空/非正数时逐格报错', () => {
  assert.strictEqual(issueSpare({ id: 1, 领用单号: '', 领用数量: 1, 领用人: 'a' }).ok, false)
  assert.strictEqual(issueSpare({ id: 1, 领用单号: 'X', 领用数量: 0, 领用人: 'a' }).ok, false)
  assert.strictEqual(issueSpare({ id: 1, 领用单号: 'X', 领用数量: 'abc', 领用人: 'a' }).ok, false)
  assert.strictEqual(issueSpare({ id: 1, 领用单号: 'X', 领用数量: 1, 领用人: '' }).ok, false)
})

check('正常出库：账面数量立即扣减、安全存量告警同步、领用流水同源登记', () => {
  const before = ledgerCount()
  const r = issueSpare({
    id: spareByCode('SPAR-0005').id,
    领用单号: 'REQ-T-OK',
    领用数量: '2',
    领用人: '张运维',
    关联缺陷编号: 'DEFE-0002',
  })
  assert.strictEqual(r.ok, true, r.message)
  assert.strictEqual(spareByCode('SPAR-0005')['现有数量'], 6)
  assert.strictEqual(ledgerCount(), before + 1)
  const entry = listRows('requisition').find((x) => x['领用单号'] === 'REQ-T-OK')
  assert.ok(entry)
  assert.strictEqual(entry['台账状态'], '待领用')
  assert.strictEqual(entry['关联缺陷编号'], 'DEFE-0002')
})

check('同一张领用单连点两回只扣一次：第二次被去重拦截', () => {
  const payload = { id: spareByCode('SPAR-0002').id, 领用单号: 'REQ-DUP', 领用数量: 1, 领用人: '张运维' }
  const first = issueSpare(payload)
  const qtyAfterFirst = spareByCode('SPAR-0002')['现有数量']
  const second = issueSpare(payload)
  assert.strictEqual(first.ok, true)
  assert.strictEqual(second.ok, false)
  assert.ok(second.message.includes('禁止重复扣账'))
  assert.strictEqual(spareByCode('SPAR-0002')['现有数量'], qtyAfterFirst)
})

check('出库扣到低于安全存量时告警线即时点亮（详情面板看到的数量跟着减）', () => {
  // SPAR-0002 在上面重复单测试后为 11，定额 4，再领 9 件到 2，跌破安全存量线。
  const r = issueSpare({ id: spareByCode('SPAR-0002').id, 领用单号: 'REQ-T-LOW', 领用数量: 9, 领用人: '张运维' })
  assert.strictEqual(r.ok, true, r.message)
  assert.strictEqual(spareByCode('SPAR-0002')['现有数量'], 2)
  assert.strictEqual(spareByCode('SPAR-0002')['存量状态'], '低于安全存量')
  assert.strictEqual(spareByCode('SPAR-0002').status, '待补充')
})

check('关联缺陷编号对不上时拒绝出库（整笔回退）', () => {
  const beforeQty = spareByCode('SPAR-0002')['现有数量']
  const r = issueSpare({ id: spareByCode('SPAR-0002').id, 领用单号: 'REQ-T-DEF', 领用数量: 1, 领用人: '张运维', 关联缺陷编号: 'DEFE-9999' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(spareByCode('SPAR-0002')['现有数量'], beforeQty)
})

console.log('四、检验放行 / 库位权限 / 补货 / 盘点')
check('登记检验合格后才能出库（缺的检验步骤走完即放行）', () => {
  assert.strictEqual(passInspection(spareByCode('SPAR-0003').id).ok, true)
  const r = issueSpare({ id: spareByCode('SPAR-0003').id, 领用单号: 'REQ-T-PASS', 领用数量: 2, 领用人: '张运维' })
  assert.strictEqual(r.ok, true, r.message)
  assert.strictEqual(spareByCode('SPAR-0003')['现有数量'], 58)
})

check('越级：非本库位保管人改库位当场拦截，并指出缺哪一步授权', () => {
  const r = relocateSpare(spareByCode('SPAR-0001').id, 'Z-01-01', { operator: '李保管' })
  assert.strictEqual(r.ok, false)
  assert.ok(r.message.includes('越权拦截') && r.message.includes('王库管'))
  assert.strictEqual(spareByCode('SPAR-0001')['存放库位'], 'A-01-03')
})

check('本库位保管人本人可以改存放库位', () => {
  const r = relocateSpare(spareByCode('SPAR-0001').id, 'A-09-09', { operator: '王库管' })
  assert.strictEqual(r.ok, true, r.message)
  assert.strictEqual(spareByCode('SPAR-0001')['存放库位'], 'A-09-09')
})

check('补货入库后账面增加且状态随安全存量回算', () => {
  const r = replenishSpare(spareByCode('SPAR-0001').id, 10)
  assert.strictEqual(r.ok, true)
  assert.strictEqual(spareByCode('SPAR-0001')['现有数量'], 14)
  assert.strictEqual(spareByCode('SPAR-0001').status, '数量充足')
})

check('盘点登记后账面从本次盘点重新建账，之后领用在新基线上扣', () => {
  assert.strictEqual(recordStocktake(spareByCode('SPAR-0005').id, 20, { operator: '王库管' }).ok, true)
  assert.strictEqual(spareByCode('SPAR-0005')['现有数量'], 20)
  const r = issueSpare({ id: spareByCode('SPAR-0005').id, 领用单号: 'REQ-T-AFT', 领用数量: 3, 领用人: '张运维' })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(spareByCode('SPAR-0005')['现有数量'], 17)
})

console.log('五、缺陷待领用台账与两处低于安全存量对得上')
check('领用流水即缺陷消缺待领用台账，确认领用后销项且不可重复确认', () => {
  const entry = listRows('requisition').find((x) => x['领用单号'] === 'REQ-T-OK')
  assert.strictEqual(confirmRequisition(entry.id).ok, true)
  assert.strictEqual(confirmRequisition(entry.id).ok, false)
  assert.strictEqual(listRows('requisition').find((x) => x.id === entry.id)['台账状态'], '已领用')
})

check('库存页与缺陷页共用同一份低于安全存量清单（品类一致）', () => {
  const codes = lowStockSpares().map((r) => r['备件编号']).sort()
  const stats = spareStats()
  assert.strictEqual(stats.低于安全存量, codes.length)
  // 经上述操作后仍低于线：SPAR-0002（领至 2<4）、SPAR-0004（2<5）
  assert.deepStrictEqual(codes, ['SPAR-0002', 'SPAR-0004'])
})

check('详情面板领用流水按备件编号取同源流水', () => {
  const codes = requisitionsForSpare('SPAR-0005').map((r) => r['领用单号'])
  assert.ok(codes.includes('REQ-T-AFT'))
})

console.log(`\n全部通过：${passed} 项检查`)

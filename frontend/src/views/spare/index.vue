<template>
  <section class="page" data-module="spare">
    <header class="page-head">
      <div>
        <h2>备品备件管理</h2>
        <p class="page-desc">
          备件台账与领用销账一体办理：数量从最近一次盘点补起，安全存量按 {{ safetyVersion }} 核定；
          销账与扣减同一事务提交，未检验合格、越权越级一律拦截。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记备品备件</button>
        <button class="btn" type="button" @click="exportRows">导出备品备件清单</button>
      </div>
    </header>

    <div class="identity-bar">
      <label class="identity-pick">
        <span>当前操作身份</span>
        <select :value="store.operator" @change="switchOperator(($event.target as HTMLSelectElement).value)">
          <option v-for="op in OPERATORS" :key="op.name" :value="op.name">
            {{ op.name }}（{{ roleLabelOf(op.role) }}<template v-if="op.warehouse"> · {{ op.warehouse }} 库位</template>）
          </option>
        </select>
      </label>
      <span class="identity-hint">切换身份可演示越权/越级拦截；办理领用只认备件所在库位的保管人。</span>
    </div>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">备件品类（在库）</span>
        <strong class="stat-value">{{ stats.categories }}</strong>
      </article>
      <article class="stat-card" :class="{ warn: stats.lowStock > 0 }">
        <span class="stat-label">低于安全存量</span>
        <strong class="stat-value">{{ stats.lowStock }}</strong>
      </article>
      <article class="stat-card" :class="{ warn: stats.pendingRequisition > 0 }">
        <span class="stat-label">待办领用单</span>
        <strong class="stat-value">{{ stats.pendingRequisition }}</strong>
      </article>
      <article class="stat-card" :class="{ warn: stats.uninspected > 0 }">
        <span class="stat-label">未走完检验</span>
        <strong class="stat-value">{{ stats.uninspected }}</strong>
      </article>
    </div>

    <p v-if="banner" class="banner" :class="banner.ok ? 'ok' : 'err'">{{ banner.text }}</p>

    <form class="filter-bar" @submit.prevent="search">
      <label class="filter-item">
        <span>备件编号</span>
        <input v-model="filters.code" placeholder="输入备件编号，如 SPAR-0001" />
      </label>
      <label class="filter-item">
        <span>备件名称</span>
        <input v-model="filters.name" placeholder="按备件名称检索" />
      </label>
      <label class="filter-item">
        <span>存放库位</span>
        <select v-model="filters.warehouse">
          <option value="">全部库位</option>
          <option v-for="wh in WAREHOUSES" :key="wh.code" :value="wh.code">
            {{ wh.code }} {{ wh.name }}
          </option>
        </select>
      </label>
      <button class="btn primary" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      <span class="sort-hint">列表固定按「现有数量」从少到多排序</span>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>备件编号</th>
          <th>备件名称</th>
          <th>适用设备</th>
          <th>规格型号</th>
          <th class="num">现有数量 ↑</th>
          <th class="num">安全存量</th>
          <th>存放库位</th>
          <th>检验状态</th>
          <th>账面状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in page.items" :key="row.id" :class="{ 'low-row': isLowStock(row), 'off-row': row.disabled }">
          <td>{{ row.code }}</td>
          <td>{{ row.name }}</td>
          <td>{{ row.applicable || '—' }}</td>
          <td>{{ row.spec || '—' }}</td>
          <td class="num">
            <strong>{{ row.onHand }}</strong>
            <span v-if="isLowStock(row)" class="low-tag">低于安全线</span>
          </td>
          <td class="num">{{ row.safetyStock }}<span class="version-note">（{{ row.safetyVersion }}）</span></td>
          <td>{{ row.warehouse }} {{ warehouseName(row.warehouse) }}</td>
          <td>{{ inspectionLabels[row.inspection] }}</td>
          <td>{{ spareStatus(row) }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row.id)">详情</button>
            <button v-if="!row.disabled" class="link" type="button" @click="openApply(row.id)">申请领用</button>
            <button
              v-if="!row.disabled && row.inspection !== 'qualified' && row.inspection !== 'pending'"
              class="link"
              type="button"
              @click="doSubmitInspection(row.id)"
            >
              提交检验
            </button>
            <button
              v-if="row.inspection === 'pending'"
              class="link"
              type="button"
              @click="openInspectResult(row.id, 'qualified')"
            >
              登记合格
            </button>
            <button
              v-if="row.inspection === 'pending'"
              class="link danger"
              type="button"
              @click="openInspectResult(row.id, 'rejected')"
            >
              登记不合格
            </button>
            <button class="link" type="button" @click="openMove(row.id)">转库位</button>
            <button class="link" type="button" @click="openStocktake(row.id)">盘点补记</button>
          </td>
        </tr>
        <tr v-if="!page.items.length">
          <td colspan="10" class="empty-state">{{ emptyHint }}</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot pager">
      <span>共 {{ page.total }} 条 · 第 {{ page.page }} / {{ pageCount }} 页（每页 {{ page.size }} 条，翻页保留查询条件）</span>
      <span class="pager-actions">
        <button class="btn" type="button" :disabled="page.page <= 1" @click="goPage(page.page - 1)">上一页</button>
        <button class="btn" type="button" :disabled="page.page >= pageCount" @click="goPage(page.page + 1)">下一页</button>
      </span>
      <span class="mismatch" v-if="page.total === 0 && page.fieldMatches.length">
        <template v-for="(item, index) in page.fieldMatches" :key="item.field">
          <span v-if="item.matched === 0" class="mismatch-item">「{{ item.field }}」格填的“{{ item.keyword }}”对不上任何记录</span>
        </template>
        <span v-if="page.fieldMatches.every((item) => item.matched > 0)" class="mismatch-item">
          各格单独都有命中，但组合在一起没有同时满足的记录
        </span>
      </span>
    </footer>

    <!-- 领用台账：审批链与销账都在这里办 -->
    <section class="ledger-block">
      <h3>领用单台账</h3>
      <p class="section-hint">
        申请 → 库位保管人初审{{ `（领用超过 ${MANAGER_APPROVE_LIMIT} 件须站长复核）` }} → 本库位保管人办理领用销账；
        同一张领用单只能销账一次。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>领用单号</th>
            <th>备件</th>
            <th>数量</th>
            <th>库位</th>
            <th>申请人</th>
            <th>关联缺陷</th>
            <th>提交时间</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="req in requisitions" :key="req.id">
            <td>{{ req.code }}</td>
            <td>{{ req.spareCode }} {{ req.spareName }}</td>
            <td class="num">{{ req.quantity }}</td>
            <td>{{ req.warehouse }}</td>
            <td>{{ req.applicant }}</td>
            <td>{{ req.defectCode || '—' }}</td>
            <td>{{ req.createdAt }}</td>
            <td>
              {{ requisitionLabels[req.status] }}
              <span v-if="req.status === 'issued'" class="sync-tag">已扣减 {{ req.quantity }} 件 · {{ req.issuedAt }}</span>
            </td>
            <td class="row-actions">
              <button v-if="req.status === 'submitted'" class="link" type="button" @click="doApprove(req.id)">
                保管人初审
              </button>
              <button
                v-if="req.status === 'keeperApproved' && req.quantity > MANAGER_APPROVE_LIMIT"
                class="link"
                type="button"
                @click="doApprove(req.id)"
              >
                站长复核
              </button>
              <button
                v-if="(req.status === 'managerApproved') || (req.status === 'keeperApproved' && req.quantity <= MANAGER_APPROVE_LIMIT)"
                class="link primary-link"
                type="button"
                :disabled="issuingId === req.id"
                @click="doIssue(req.id)"
              >
                {{ issuingId === req.id ? '销账中…' : '办理领用' }}
              </button>
              <button
                v-if="['submitted', 'keeperApproved'].includes(req.status)"
                class="link danger"
                type="button"
                @click="openReject(req.id)"
              >
                驳回
              </button>
            </td>
          </tr>
          <tr v-if="!requisitions.length">
            <td colspan="9" class="empty-state">暂无领用单</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 详情抽屉 -->
    <div v-if="selectedId !== null" class="drawer-mask" @click.self="selectedId = null">
      <aside class="drawer">
        <template v-if="selected">
          <div class="drawer-head">
            <h3>备件详情 · {{ selected.code }}</h3>
            <button class="btn ghost" type="button" @click="selectedId = null">关闭</button>
          </div>
          <dl class="detail-grid">
            <div><dt>备件名称</dt><dd>{{ selected.name }}</dd></div>
            <div><dt>适用设备</dt><dd>{{ selected.applicable || '—' }}</dd></div>
            <div><dt>规格型号</dt><dd>{{ selected.spec || '—' }}</dd></div>
            <div :class="{ 'detail-low': isLowStock(selected) }">
              <dt>现有数量</dt>
              <dd><strong>{{ selected.onHand }}</strong> 件<span v-if="isLowStock(selected)" class="low-tag">低于安全线</span></dd>
            </div>
            <div><dt>安全存量</dt><dd>{{ selected.safetyStock }} 件（{{ selected.safetyVersion }} 核定）</dd></div>
            <div><dt>存放库位</dt><dd>{{ selected.warehouse }} {{ warehouseName(selected.warehouse) }}</dd></div>
            <div><dt>检验状态</dt><dd>{{ inspectionLabels[selected.inspection] }}<template v-if="selected.inspectionDate"> · {{ selected.inspectionDate }}</template></dd></div>
            <div><dt>账面状态</dt><dd>{{ spareStatus(selected) }}</dd></div>
            <div v-if="selected.remark"><dt>备注</dt><dd>{{ selected.remark }}</dd></div>
            <div v-if="lastStocktake(selected.id)">
              <dt>最近一次盘点</dt>
              <dd>{{ lastStocktake(selected.id)?.date }} 实盘 {{ lastStocktake(selected.id)?.countedQty }} 件（{{ lastStocktake(selected.id)?.keeper }}）</dd>
            </div>
          </dl>

          <h4>本备件领用记录</h4>
          <table class="data-table mini">
            <thead>
              <tr><th>领用单号</th><th>数量</th><th>时间</th><th>状态</th></tr>
            </thead>
            <tbody>
              <tr v-for="req in spareRequisitions(selected.id)" :key="req.id">
                <td>{{ req.code }}</td>
                <td class="num">{{ req.quantity }}</td>
                <td>{{ req.status === 'issued' ? req.issuedAt : req.createdAt }}</td>
                <td>{{ requisitionLabels[req.status] }}</td>
              </tr>
              <tr v-if="!spareRequisitions(selected.id).length">
                <td colspan="4" class="empty-state">暂无领用记录</td>
              </tr>
            </tbody>
          </table>
        </template>
      </aside>
    </div>

    <!-- 统一弹窗 -->
    <div v-if="dialog.type !== ''" class="drawer-mask" @click.self="closeDialog">
      <div class="dialog">
        <h3>{{ dialogTitle }}</h3>

        <template v-if="dialog.type === 'create'">
          <p class="dialog-note">新登记备件须先送检合格才能出库；安全存量留空则按 {{ safetyVersion }} 名录核定（默认 5 件）。</p>
          <label class="form-row"><span>备件编号 *</span><input v-model="form.code" placeholder="如 SPAR-0009" /></label>
          <label class="form-row"><span>备件名称 *</span><input v-model="form.name" /></label>
          <label class="form-row"><span>适用设备</span><input v-model="form.applicable" /></label>
          <label class="form-row"><span>规格型号</span><input v-model="form.spec" /></label>
          <label class="form-row"><span>现有数量 *</span><input v-model.number="form.onHand" type="number" min="0" /></label>
          <label class="form-row"><span>安全存量</span><input v-model.number="form.safetyStock" type="number" min="0" placeholder="留空取核定名录" /></label>
          <label class="form-row">
            <span>存放库位 *</span>
            <select v-model="form.warehouse">
              <option v-for="wh in WAREHOUSES" :key="wh.code" :value="wh.code">{{ wh.code }} {{ wh.name }}</option>
            </select>
          </label>
        </template>

        <template v-else-if="dialog.type === 'apply'">
          <p class="dialog-note">
            领用 {{ dialogSpare?.code }}（现有 {{ dialogSpare?.onHand }} 件，安全存量 {{ dialogSpare?.safetyStock }} 件）。
            数量超过 {{ MANAGER_APPROVE_LIMIT }} 件须站长复核；关联缺陷后出库结论自动同步到缺陷待领用台账。
          </p>
          <label class="form-row"><span>领用数量 *</span><input v-model.number="form.quantity" type="number" min="1" /></label>
          <label class="form-row"><span>关联缺陷编号</span><input v-model="form.defectCode" placeholder="如 DEFE-0001，可留空" /></label>
          <label class="form-row"><span>用途说明</span><input v-model="form.purpose" /></label>
        </template>

        <template v-else-if="dialog.type === 'inspectResult'">
          <p class="dialog-note">登记检验结果：合格后允许出库；不合格将标记停用并禁止出库。</p>
          <p>备件：{{ dialogSpare?.code }} {{ dialogSpare?.name }}，拟登记为
            <strong>{{ form.result === 'qualified' ? '检验合格' : '检验不合格' }}</strong>。
          </p>
        </template>

        <template v-else-if="dialog.type === 'move'">
          <p class="dialog-note">只有该备件当前所在库位的保管人能调整存放库位。</p>
          <p>备件 {{ dialogSpare?.code }} 当前在 {{ dialogSpare?.warehouse }}，转入：</p>
          <label class="form-row">
            <span>目标库位 *</span>
            <select v-model="form.targetWarehouse">
              <option v-for="wh in WAREHOUSES" :key="wh.code" :value="wh.code">{{ wh.code }} {{ wh.name }}</option>
            </select>
          </label>
        </template>

        <template v-else-if="dialog.type === 'stocktake'">
          <p class="dialog-note">盘点登记后，账面数量从本次盘点补起，之后的领用在新账面数上接续。</p>
          <label class="form-row"><span>实盘数量 *</span><input v-model.number="form.countedQty" type="number" min="0" /></label>
          <label class="form-row"><span>盘点说明</span><input v-model="form.remark" placeholder="如 9 月月度盘点" /></label>
        </template>

        <template v-else-if="dialog.type === 'reject'">
          <p class="dialog-note">驳回不扣减账面数量。</p>
          <label class="form-row"><span>驳回原因</span><input v-model="form.remark" placeholder="如 用途不清、库存不足" /></label>
        </template>

        <div class="dialog-actions">
          <button class="btn" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="button" @click="submitDialog">确定</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { useSessionStore, ROLE_LABELS } from '@/stores/session'
import {
  CURRENT_SAFETY_VERSION,
  MANAGER_APPROVE_LIMIT,
  OPERATORS,
  WAREHOUSES,
  warehouseName,
} from '@/data/spare/catalog'
import {
  REQUISITION_LABELS,
  approveRequisition,
  changeWarehouse,
  exportSparesCsv,
  INSPECTION_LABELS,
  isLowStock,
  issueRequisition,
  latestStocktake as getLastStocktake,
  querySpares,
  recordInspection,
  recordStocktake,
  registerSpare,
  rejectRequisition,
  requisitionLedger,
  spareRequisitions as getSpareRequisitions,
  spareStats,
  spareStatus,
  submitInspection,
  submitRequisition,
} from '@/data/spare/service'
import type { InspectionStatus, Requisition, Spare, SparePage } from '@/data/spare/types'

const store = useSessionStore()

const safetyVersion = CURRENT_SAFETY_VERSION
const inspectionLabels = INSPECTION_LABELS
const requisitionLabels = REQUISITION_LABELS

const PAGE_SIZE = 5

const filters = reactive({ code: '', name: '', warehouse: '' })
const pageNo = ref(1)
const page = ref<SparePage>({ items: [], total: 0, page: 1, size: PAGE_SIZE, fieldMatches: [] })
const stats = ref(spareStats())
const requisitions = ref<Requisition[]>([])
const selectedId = ref<number | null>(null)
const issuingId = ref<number | null>(null)
const tick = ref(0)
const banner = ref<{ ok: boolean; text: string } | null>(null)

type DialogType = '' | 'create' | 'apply' | 'inspectResult' | 'move' | 'stocktake' | 'reject'
const dialog = ref<{ type: DialogType; spareId: number; reqId: number }>({
  type: '',
  spareId: 0,
  reqId: 0,
})

const form = reactive({
  code: '',
  name: '',
  applicable: '',
  spec: '',
  onHand: 0,
  safetyStock: undefined as number | undefined,
  warehouse: 'A-01',
  quantity: 1,
  defectCode: '',
  purpose: '',
  targetWarehouse: 'A-02',
  countedQty: 0,
  remark: '',
  result: 'qualified' as Extract<InspectionStatus, 'qualified' | 'rejected'>,
})

const pageCount = computed(() => Math.max(1, Math.ceil(page.value.total / PAGE_SIZE)))

const emptyHint = computed(() => {
  if (filters.code || filters.name || filters.warehouse) {
    return '按当前条件查不到备件，请看下方逐格核对结果'
  }
  return '暂无备品备件数据，可先登记备品备件'
})

const selected = computed<Spare | undefined>(() => {
  tick.value
  if (selectedId.value === null) {
    return undefined
  }
  return querySpares({ code: '', name: '', warehouse: '', page: 1, size: 9999 }).items.find(
    (item) => item.id === selectedId.value,
  )
})

const dialogSpare = computed<Spare | undefined>(() => {
  tick.value
  return querySpares({ code: '', name: '', warehouse: '', page: 1, size: 9999 }).items.find(
    (item) => item.id === dialog.value.spareId,
  )
})

const dialogTitle = computed(() => {
  switch (dialog.value.type) {
    case 'create':
      return '登记备品备件'
    case 'apply':
      return '发起领用申请'
    case 'inspectResult':
      return '登记检验结果'
    case 'move':
      return '调整存放库位'
    case 'stocktake':
      return '盘点补记'
    case 'reject':
      return '驳回领用单'
    default:
      return ''
  }
})

function roleLabelOf(role: keyof typeof ROLE_LABELS): string {
  return ROLE_LABELS[role]
}

function lastStocktake(spareId: number) {
  tick.value
  return getLastStocktake(spareId)
}

function spareRequisitions(spareId: number) {
  tick.value
  return getSpareRequisitions(spareId)
}

function switchOperator(name: string) {
  const profile = OPERATORS.find((item) => item.name === name)
  if (profile) {
    store.setOperator(profile)
    showBanner(true, `已切换为 ${profile.name}（${ROLE_LABELS[profile.role]}${profile.warehouse ? ` · ${profile.warehouse}` : ''}）`)
    reload()
  }
}

function showBanner(ok: boolean, text: string) {
  banner.value = { ok, text }
}

function reload() {
  tick.value += 1
  page.value = querySpares({
    code: filters.code,
    name: filters.name,
    warehouse: filters.warehouse,
    page: pageNo.value,
    size: PAGE_SIZE,
  })
  stats.value = spareStats()
  requisitions.value = requisitionLedger()
}

function search() {
  pageNo.value = 1
  banner.value = null
  reload()
}

function resetFilters() {
  filters.code = ''
  filters.name = ''
  filters.warehouse = ''
  pageNo.value = 1
  reload()
}

function goPage(target: number) {
  pageNo.value = target
  reload()
}

function exportRows() {
  const { filename, content } = exportSparesCsv()
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

// ---- 弹窗 ----

function resetForm() {
  Object.assign(form, {
    code: '',
    name: '',
    applicable: '',
    spec: '',
    onHand: 0,
    safetyStock: undefined,
    warehouse: store.role === 'keeper' ? store.warehouse : 'A-01',
    quantity: 1,
    defectCode: '',
    purpose: '',
    targetWarehouse: 'A-02',
    countedQty: 0,
    remark: '',
    result: 'qualified',
  })
}

function openCreate() {
  resetForm()
  dialog.value = { type: 'create', spareId: 0, reqId: 0 }
}

function openApply(spareId: number) {
  resetForm()
  dialog.value = { type: 'apply', spareId, reqId: 0 }
}

function openInspectResult(
  spareId: number,
  result: Extract<InspectionStatus, 'qualified' | 'rejected'>,
) {
  resetForm()
  form.result = result
  dialog.value = { type: 'inspectResult', spareId, reqId: 0 }
}

function openMove(spareId: number) {
  resetForm()
  const target = querySpares({ code: '', name: '', warehouse: '', page: 1, size: 9999 }).items.find(
    (item) => item.id === spareId,
  )
  form.targetWarehouse = target && target.warehouse !== 'A-01' ? 'A-01' : 'A-02'
  dialog.value = { type: 'move', spareId, reqId: 0 }
}

function openStocktake(spareId: number) {
  resetForm()
  const target = querySpares({ code: '', name: '', warehouse: '', page: 1, size: 9999 }).items.find(
    (item) => item.id === spareId,
  )
  form.countedQty = target?.onHand ?? 0
  dialog.value = { type: 'stocktake', spareId, reqId: 0 }
}

function openReject(reqId: number) {
  resetForm()
  dialog.value = { type: 'reject', spareId: 0, reqId }
}

function openDetail(spareId: number) {
  selectedId.value = spareId
}

function closeDialog() {
  dialog.value = { type: '', spareId: 0, reqId: 0 }
}

function submitDialog() {
  const type = dialog.value.type
  let result: { ok: boolean; message: string } | null = null

  if (type === 'create') {
    result = registerSpare(
      {
        code: form.code,
        name: form.name,
        applicable: form.applicable,
        spec: form.spec,
        onHand: form.onHand,
        safetyStock: form.safetyStock,
        warehouse: form.warehouse,
      },
      store.profile,
    )
  } else if (type === 'apply') {
    result = submitRequisition(
      { spareId: dialog.value.spareId, quantity: form.quantity, defectCode: form.defectCode, purpose: form.purpose },
      store.profile,
    )
  } else if (type === 'inspectResult') {
    result = recordInspection(dialog.value.spareId, form.result, store.profile)
  } else if (type === 'move') {
    result = changeWarehouse(dialog.value.spareId, form.targetWarehouse, store.profile)
  } else if (type === 'stocktake') {
    result = recordStocktake(dialog.value.spareId, form.countedQty, store.profile, form.remark)
  } else if (type === 'reject') {
    result = rejectRequisition(dialog.value.reqId, store.profile, form.remark)
  }

  if (!result) {
    return
  }
  showBanner(result.ok, result.message)
  if (result.ok) {
    closeDialog()
  }
  reload()
}

// ---- 直接动作 ----

function doSubmitInspection(spareId: number) {
  const result = submitInspection(spareId, store.profile)
  showBanner(result.ok, result.message)
  reload()
}

function doApprove(reqId: number) {
  const result = approveRequisition(reqId, store.profile)
  showBanner(result.ok, result.message)
  reload()
}

function doIssue(reqId: number) {
  // 连点防护：同一领用单销账进行中直接忽略，幂等校验在服务层兜底。
  if (issuingId.value !== null) {
    return
  }
  issuingId.value = reqId
  try {
    const result = issueRequisition(reqId, store.profile)
    showBanner(result.ok, result.message)
    reload()
  } finally {
    issuingId.value = null
  }
}

onMounted(reload)
</script>

<style scoped>
.identity-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  font-size: 13px;
}
.identity-pick span { color: var(--muted); margin-right: 6px; }
.identity-pick select { padding: 4px 8px; border: 1px solid var(--border); border-radius: 6px; }
.identity-hint { color: var(--muted); font-size: 12px; }
.warn .stat-value { color: #b42318; }
.banner { border-radius: 8px; padding: 8px 12px; font-size: 13px; margin: 0 0 12px; }
.banner.ok { background: #ecfdf3; border: 1px solid #75e0a7; color: #175c3b; }
.banner.err { background: #fef3f2; border: 1px solid #fda29b; color: #b42318; }
.sort-hint { color: var(--muted); font-size: 12px; }
.num { text-align: right; white-space: nowrap; }
.low-row { background: #fff7f5; }
.low-row .num strong { color: #b42318; }
.off-row { color: var(--muted); background: #f3f4f6; }
.low-tag { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 999px; background: #fee4e2; color: #b42318; font-size: 11px; }
.version-note { color: var(--muted); font-size: 11px; }
.pager { align-items: center; gap: 12px; flex-wrap: wrap; }
.pager-actions { display: flex; gap: 6px; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.mismatch { display: flex; flex-direction: column; gap: 2px; color: #b42318; }
.mismatch-item { font-size: 12px; }
.ledger-block { margin-top: 20px; }
.ledger-block h3 { margin: 0 0 4px; font-size: 15px; }
.section-hint { color: var(--muted); font-size: 12px; margin: 0 0 10px; }
.sync-tag { display: block; color: #175c3b; font-size: 11px; }
.link.danger { color: #b42318; }
.link.primary-link { color: #047857; font-weight: 600; }
.drawer-mask {
  position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45);
  display: flex; justify-content: flex-end; z-index: 50;
}
.drawer {
  width: 560px; max-width: 92vw; background: #fff; height: 100%;
  padding: 16px 20px; overflow-y: auto;
}
.drawer-head { display: flex; justify-content: space-between; align-items: center; }
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; margin: 12px 0; }
.detail-grid dt { color: var(--muted); font-size: 12px; }
.detail-grid dd { margin: 2px 0 0; font-size: 13px; }
.detail-low dd strong { color: #b42318; font-size: 16px; }
.data-table.mini { font-size: 12px; }
.dialog {
  background: #fff; border-radius: 10px; width: 460px; max-width: 92vw;
  padding: 18px 20px; margin: 60px auto 0; align-self: flex-start;
}
.drawer-mask:has(.dialog) { justify-content: center; align-items: flex-start; }
.dialog h3 { margin: 0 0 10px; font-size: 15px; }
.dialog-note { color: var(--muted); font-size: 12px; margin: 0 0 10px; }
.form-row { display: block; margin-bottom: 10px; font-size: 13px; }
.form-row span { display: block; color: var(--muted); font-size: 12px; margin-bottom: 4px; }
.form-row input, .form-row select { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
</style>

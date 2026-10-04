<template>
  <section class="page" data-module="spare">
    <header class="page-head">
      <div>
        <h2>备品备件管理</h2>
        <p class="page-desc">
          围绕备件编号、现有数量与安全存量做找件、盘点补账、检验放行与领用出库。
          安全存量按{{ safetyLabel }}核定，现有数量以最近一次盘点为基线。
        </p>
      </div>
      <div class="page-actions">
        <label class="operator-switch">
          当前操作人
          <select :value="store.operatorName" @change="switchOperator(($event.target as HTMLSelectElement).value)">
            <option v-for="name in operators" :key="name" :value="name">{{ name }}</option>
          </select>
        </label>
        <button class="btn" type="button" @click="exportRows">导出备品备件清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="{ alarm: item.alarm }">{{ item.value }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent="search">
      <label class="filter-item">
        <span>备件编号</span>
        <input v-model="filters['备件编号']" placeholder="输入备件编号，如 SPAR-0001" />
      </label>
      <label class="filter-item">
        <span>备件名称</span>
        <input v-model="filters['备件名称']" placeholder="按备件名称检索" />
      </label>
      <label class="filter-item">
        <span>适用设备</span>
        <input v-model="filters['适用设备']" placeholder="按适用设备检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div class="spare-layout">
      <div class="spare-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>备件编号</th>
              <th>备件名称</th>
              <th>适用设备</th>
              <th>规格型号</th>
              <th class="sortable" @click="toggleSort">
                现有数量
                <span class="sort-arrow">{{ sortByQuantity === 'asc' ? '▲ 少→多' : '▼ 多→少' }}</span>
              </th>
              <th>安全存量<span class="version-tag" :title="`定额版本：${safetyLabel}`">{{ safetyVersion }}</span></th>
              <th>存放库位</th>
              <th>库位保管人</th>
              <th>检验状态</th>
              <th>当前状态</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="String(row.id)" :class="{ 'low-stock': isRowLow(row), selected: selectedId === Number(row.id) }">
              <td>{{ row['备件编号'] }}</td>
              <td>{{ row['备件名称'] }}</td>
              <td>{{ row['适用设备'] }}</td>
              <td>{{ row['规格型号'] }}</td>
              <td>
                <strong>{{ row['现有数量'] }}</strong>
                <span v-if="isRowLow(row)" class="alarm-dot" title="低于安全存量">低于安全存量</span>
              </td>
              <td>{{ row['安全存量'] }}</td>
              <td>{{ row['存放库位'] }}</td>
              <td>{{ row['库位保管人'] || '—' }}</td>
              <td :class="{ 'cell-warn': row['检验状态'] === '待检验' }">{{ row['检验状态'] }}</td>
              <td>{{ row.status }}</td>
              <td><button class="link" type="button" @click="selectRow(row)">查看详情</button></td>
            </tr>
            <tr v-if="!rows.length">
              <td :colspan="11" class="empty-state">{{ emptyHint }}</td>
            </tr>
          </tbody>
        </table>

        <footer class="page-foot pager">
          <span>共 {{ total }} 条备件记录</span>
          <span class="pager-controls">
            <button class="btn" type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
            第 {{ page }} / {{ totalPages }} 页（每页 {{ size }} 条，条件与排序翻页保留）
            <button class="btn" type="button" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
          </span>
        </footer>
      </div>

      <aside v-if="selected" class="detail-panel">
        <header class="detail-head">
          <h3>备件详情 · {{ selected['备件编号'] }}</h3>
          <button class="link" type="button" @click="selectedId = null">关闭</button>
        </header>
        <dl class="detail-grid">
          <template v-for="field in detailFields" :key="field">
            <dt>{{ field }}</dt>
            <dd :class="{ alarm: field === '存量状态' && selected['存量状态'] === '低于安全存量' }">
              {{ selected[field] ?? '—' }}
            </dd>
          </template>
        </dl>

        <div class="detail-actions">
          <button class="btn primary" type="button" @click="openIssue">办理领用（出库）</button>
          <button class="btn" type="button" @click="passInspection">登记检验合格</button>
          <button class="btn" type="button" @click="toggleForm('relocate')">调整库位</button>
          <button class="btn" type="button" @click="toggleForm('replenish')">补货入库</button>
          <button class="btn" type="button" @click="toggleForm('stocktake')">盘点登记</button>
        </div>

        <form v-if="formKind === 'issue'" class="inline-form" @submit.prevent="submitIssue">
          <h4>办理领用</h4>
          <label>领用单号<input v-model="issueForm.领用单号" placeholder="同一张领用单只扣一次" /></label>
          <label>领用数量<input v-model="issueForm.领用数量" type="number" min="1" placeholder="扣减前会先校验库存" /></label>
          <label>领用人<input v-model="issueForm.领用人" /></label>
          <label>关联缺陷编号（选填）<input v-model="issueForm.关联缺陷编号" placeholder="如 DEFE-0002，将同步待领用台账" /></label>
          <button class="btn primary" type="submit" :disabled="submitting">{{ submitting ? '出库中…' : '确认出库' }}</button>
          <button class="btn ghost" type="button" @click="formKind = ''">取消</button>
        </form>

        <form v-else-if="formKind === 'relocate'" class="inline-form" @submit.prevent="submitRelocate">
          <h4>调整存放库位</h4>
          <p class="form-tip">仅本库位保管人「{{ selected['库位保管人'] || '未指定' }}」可操作，当前操作人「{{ store.operatorName }}」。</p>
          <label>新存放库位<input v-model="relocateLocation" placeholder="如 A-03-02" /></label>
          <button class="btn primary" type="submit">确认调整</button>
          <button class="btn ghost" type="button" @click="formKind = ''">取消</button>
        </form>

        <form v-else-if="formKind === 'replenish'" class="inline-form" @submit.prevent="submitReplenish">
          <h4>补货入库</h4>
          <label>补货数量<input v-model="replenishAmount" type="number" min="1" /></label>
          <button class="btn primary" type="submit">确认入库</button>
          <button class="btn ghost" type="button" @click="formKind = ''">取消</button>
        </form>

        <form v-else-if="formKind === 'stocktake'" class="inline-form" @submit.prevent="submitStocktake">
          <h4>盘点登记</h4>
          <label>实盘数量<input v-model="stocktakeCount" type="number" min="0" placeholder="账面将从本次盘点补起" /></label>
          <button class="btn primary" type="submit">确认建账</button>
          <button class="btn ghost" type="button" @click="formKind = ''">取消</button>
        </form>

        <section class="ledger-mini">
          <h4>本备件领用流水</h4>
          <ul v-if="selectedLedger.length">
            <li v-for="item in selectedLedger" :key="String(item.id)">
              {{ item['领用单号'] }} · {{ item['出库时间'] }} · 领 {{ item['领用数量'] }}
              （{{ item['台账状态'] }}<template v-if="item['关联缺陷编号']"> · 缺陷 {{ item['关联缺陷编号'] }}</template>）
            </li>
          </ul>
          <p v-else class="form-tip">暂无领用记录。</p>
        </section>
      </aside>
    </div>

    <footer class="page-foot">
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries, moduleMeta } from '@/api/local-service'
import {
  DEFAULT_PAGE_SIZE,
  getSpare,
  issueSpare,
  listSpares,
  lowStockSpares,
  mismatchedFields,
  passInspection as passInspectionAction,
  recordStocktake,
  relocateSpare,
  replenishSpare,
  requisitionsForSpare,
  safetyVersionLabel,
  spareStats,
  SAFETY_VERSION,
} from '@/api/spare-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('spare')
const store = useSessionStore()
const operators = ['值班管理员', '王库管', '李保管', '赵仓管']

const size = DEFAULT_PAGE_SIZE
const rows = ref<EntryRow[]>([])
const total = ref(0)
const page = ref(1)
const totalPages = ref(1)
const sortByQuantity = ref<'asc' | 'desc'>('asc')
const filters = reactive<Record<string, string>>({ 备件编号: '', 备件名称: '', 适用设备: '' })
const appliedFilters = ref<Record<string, string>>({})

const selectedId = ref<number | null>(null)
const selected = ref<EntryRow | null>(null)
const selectedLedger = ref<EntryRow[]>([])

const message = ref('')
const messageOk = ref(false)
const submitting = ref(false)
const formKind = ref<'' | 'issue' | 'relocate' | 'replenish' | 'stocktake'>('')

const issueForm = reactive({ 领用单号: '', 领用数量: '', 领用人: store.operatorName, 关联缺陷编号: '' })
const relocateLocation = ref('')
const replenishAmount = ref('')
const stocktakeCount = ref('')

const detailFields = [
  '备件编号', '备件名称', '适用设备', '规格型号', '现有数量', '安全存量', '安全存量版本',
  '存放库位', '库位保管人', '最近盘点日期', '检验状态', '存量状态',
]

const safetyVersion = SAFETY_VERSION
const safetyLabel = safetyVersionLabel()

const stats = computed(() => {
  const s = spareStats()
  return [
    { label: '备件品类', value: s.备件品类, alarm: false },
    { label: '待补充品类', value: s.待补充品类, alarm: s.待补充品类 > 0 },
    { label: '低于安全存量', value: s.低于安全存量, alarm: s.低于安全存量 > 0 },
  ]
})

const lowCodes = computed(() => new Set(lowStockSpares().map((row) => String(row['备件编号']))))
function isRowLow(row: EntryRow): boolean {
  return lowCodes.value.has(String(row['备件编号']))
}

const emptyHint = computed(() => {
  const pairs = Object.entries(appliedFilters.value).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return '暂无备品备件数据'
  }
  const missed = mismatchedFields(appliedFilters.value)
  if (missed.length === 0) {
    return '当前页无数据'
  }
  const detail = missed
    .map((field) => `「${field}」填入的「${appliedFilters.value[field]}」`)
    .join('、')
  return `查无记录：按 ${detail} 对不上任何一格，请核对备件编号等条件后重试`
})

function notify(result: { ok: boolean; message: string }) {
  message.value = result.message
  messageOk.value = result.ok
}

function reload(keepPage = true) {
  const payload = listSpares({
    filters: appliedFilters.value,
    page: keepPage ? page.value : 1,
    size,
    sortByQuantity: sortByQuantity.value,
  })
  rows.value = payload.items
  total.value = payload.total
  page.value = payload.page
  totalPages.value = Math.max(1, Math.ceil(payload.total / size))
  if (selectedId.value !== null) {
    const fresh = getSpare(selectedId.value)
    selected.value = fresh
    selectedLedger.value = fresh ? requisitionsForSpare(String(fresh['备件编号'])) : []
    if (!fresh) {
      selectedId.value = null
    }
  }
}

function search() {
  appliedFilters.value = { ...filters }
  page.value = 1
  message.value = ''
  reload(false)
}

function resetFilters() {
  filters.备件编号 = ''
  filters.备件名称 = ''
  filters.适用设备 = ''
  appliedFilters.value = {}
  page.value = 1
  message.value = ''
  reload(false)
}

function toggleSort() {
  sortByQuantity.value = sortByQuantity.value === 'asc' ? 'desc' : 'asc'
  reload()
}

function goPage(target: number) {
  page.value = target
  reload()
}

function selectRow(row: EntryRow) {
  selectedId.value = Number(row.id)
  selected.value = getSpare(Number(row.id))
  selectedLedger.value = requisitionsForSpare(String(row['备件编号']))
  formKind.value = ''
  message.value = ''
}

function refreshAfterAction(result: { ok: boolean; message: string }) {
  notify(result)
  if (result.ok) {
    formKind.value = ''
    reload()
  }
}

function switchOperator(name: string) {
  store.setOperator(name)
  issueForm.领用人 = name
}

function exportRows() {
  downloadEntries(meta.key)
}

function openIssue() {
  if (!selected.value) {
    return
  }
  formKind.value = 'issue'
  issueForm.领用单号 = ''
  issueForm.领用数量 = '1'
  issueForm.领用人 = store.operatorName
  issueForm.关联缺陷编号 = ''
}

function toggleForm(kind: 'relocate' | 'replenish' | 'stocktake') {
  formKind.value = formKind.value === kind ? '' : kind
  relocateLocation.value = ''
  replenishAmount.value = ''
  stocktakeCount.value = ''
}

// 确认出库：本地服务会先把领用单去重、检验放行、库存数量全部校验通过，
// 再在同一笔事务里扣账面并登记领用流水；按钮在途禁用，连点也不会扣第二遍。
function submitIssue() {
  if (!selected.value || submitting.value) {
    return
  }
  submitting.value = true
  try {
    const result = issueSpare({
      id: Number(selected.value.id),
      领用单号: issueForm.领用单号,
      领用数量: issueForm.领用数量,
      领用人: issueForm.领用人,
      关联缺陷编号: issueForm.关联缺陷编号,
    })
    refreshAfterAction(result)
  } finally {
    submitting.value = false
  }
}

function passInspection() {
  if (!selected.value) {
    return
  }
  refreshAfterAction(passInspectionAction(Number(selected.value.id)))
}

function submitRelocate() {
  if (!selected.value) {
    return
  }
  refreshAfterAction(
    relocateSpare(Number(selected.value.id), relocateLocation.value, { operator: store.operatorName }),
  )
}

function submitReplenish() {
  if (!selected.value) {
    return
  }
  refreshAfterAction(replenishSpare(Number(selected.value.id), replenishAmount.value))
}

function submitStocktake() {
  if (!selected.value) {
    return
  }
  refreshAfterAction(
    recordStocktake(Number(selected.value.id), stocktakeCount.value, { operator: store.operatorName }),
  )
}

onMounted(() => reload(false))
</script>

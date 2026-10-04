<template>
  <section class="page" data-module="defect">
    <header class="page-head">
      <div>
        <h2>缺陷消缺管理</h2>
        <p class="page-desc">维护消缺任务，围绕缺陷编号、缺陷类别、发现方式、严重等级做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记消缺任务</button>
        <button class="btn" type="button" @click="exportRows">导出缺陷消缺清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无缺陷消缺数据，可先登记消缺任务</td>
        </tr>
      </tbody>
    </table>

    <section class="ledger-block">
      <h3>备件待领用台账</h3>
      <p class="section-hint">
        备件出库结论由备品备件页在销账事务中同步写入；待办 {{ pendingLedgerCount }} 单、已出库 {{ issuedLedgerCount }} 单。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>缺陷编号</th>
            <th>领用单号</th>
            <th>备件</th>
            <th>数量</th>
            <th>库位</th>
            <th>申请人</th>
            <th>出库结论</th>
            <th>销账时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in ledger" :key="entry.code" :class="{ 'low-row': entry.lowAfterIssue }">
            <td>{{ entry.defectCode }}</td>
            <td>{{ entry.code }}</td>
            <td>{{ entry.spareCode }} {{ entry.spareName }}</td>
            <td class="num">{{ entry.quantity }}</td>
            <td>{{ entry.warehouse }}</td>
            <td>{{ entry.applicant }}</td>
            <td>
              <span :class="entry.status === 'issued' ? 'conclusion-done' : 'conclusion-pending'">
                {{ entry.status === 'issued' ? '已出库（账面已扣减）' : requisitionLabels[entry.status] }}
              </span>
              <span v-if="entry.status === 'issued' && entry.lowAfterIssue" class="low-tag">扣后低于安全存量</span>
            </td>
            <td>{{ entry.syncedAt || '—' }}</td>
          </tr>
          <tr v-if="!ledger.length">
            <td colspan="8" class="empty-state">暂无关联缺陷的领用单；在备品备件页发起领用并填写缺陷编号后会自动同步到这里</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="ledger-block low-block">
      <h3>低于安全存量品类 <span class="low-count">{{ lowStock.length }} 类</span></h3>
      <p class="section-hint">与备品备件页使用同一核定口径（{{ safetyVersion }}），两处品类完全一致。</p>
      <div class="low-chips">
        <span v-for="spare in lowStock" :key="spare.id" class="low-chip">
          {{ spare.code }} {{ spare.name }}：现有 <strong>{{ spare.onHand }}</strong> / 安全存量 {{ spare.safetyStock }}
        </span>
        <span v-if="!lowStock.length" class="section-hint">当前没有低于安全存量的品类。</span>
      </div>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条缺陷消缺记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { CURRENT_SAFETY_VERSION } from '@/data/spare/catalog'
import {
  REQUISITION_LABELS,
  lowStockSpares,
  requisitionLedger,
} from '@/data/spare/service'
import type { Spare } from '@/data/spare/types'

const meta = moduleMeta('defect')
const columns = ["缺陷编号", "缺陷类别", "发现方式", "严重等级", "责任班组", "要求完成日", "消缺措施", "消缺状态"]
const actions = ["派发消缺", "提交验收", "确认闭环"]
const statuses = ["待派发", "消缺中", "待验收", "已闭环"]
const stats = [{"label": "待派发缺陷", "value": 0}, {"label": "消缺中缺陷", "value": 0}, {"label": "超期未闭环", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const safetyVersion = CURRENT_SAFETY_VERSION
const requisitionLabels = REQUISITION_LABELS
const ledger = ref(requisitionLedger())
const lowStock = ref<Spare[]>(lowStockSpares())
const pendingLedgerCount = computed(
  () => ledger.value.filter((entry) => entry.status !== 'issued' && entry.status !== 'rejected').length,
)
const issuedLedgerCount = computed(() => ledger.value.filter((entry) => entry.status === 'issued').length)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '消缺任务登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    ledger.value = requisitionLedger()
    lowStock.value = lowStockSpares()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '缺陷消缺列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.ledger-block { margin-top: 20px; }
.ledger-block h3 { margin: 0 0 4px; font-size: 15px; }
.section-hint { color: var(--muted); font-size: 12px; margin: 0 0 10px; }
.num { text-align: right; }
.low-row { background: #fff7f5; }
.conclusion-done { color: #175c3b; font-weight: 600; }
.conclusion-pending { color: #b54708; }
.low-tag { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 999px; background: #fee4e2; color: #b42318; font-size: 11px; }
.low-count { font-size: 12px; color: #b42318; font-weight: 400; }
.low-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.low-chip { background: #fef3f2; border: 1px solid #fda29b; border-radius: 999px; padding: 4px 12px; font-size: 12px; color: #7a271a; }
.low-chip strong { color: #b42318; }
</style>

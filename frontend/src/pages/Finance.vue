<template>
  <div class="page finance-page">
    <PageLoading v-if="isInitialLoading" />
    <template v-else>
    <section class="page-heading compact-heading finance-heading">
      <div>
        <span class="eyebrow">Etsy Payments / Ledger</span>
        <h1>财务看板</h1>
        <p class="finance-heading-copy">
          <span>{{ financeComparisonSummary.text }}</span>
          <span :class="['finance-change-pill', `is-${financeComparisonSummary.tone}`]">
            {{ financeComparisonSummary.value }}
          </span>
          <span v-if="financeComparisonSummary.detail" class="finance-comparison-detail">
            {{ financeComparisonSummary.detail }}
          </span>
          <span class="finance-range-pill">{{ currentFinance.rangeLabel }}</span>
          <a-tooltip placement="bottomLeft">
            <template #title>
              <div>{{ syncStatusText }}</div>
            </template>
            <span class="finance-source-pill">财务数据 {{ financeStatusText }}</span>
          </a-tooltip>
        </p>
      </div>
      <div class="period-controls">
        <span>店铺</span>
        <a-select
          v-model:value="selectedShopScope"
          :options="shopOptions"
          class="period-select shop-select"
          size="middle"
        />
        <span>统计月份</span>
        <a-select
          v-model:value="selectedMonthScope"
          :options="monthScopeOptions"
          class="period-select ytd-period-select"
          size="middle"
        />
        <span>自然周</span>
        <a-select
          v-model:value="selectedDataDate"
          :options="weekOptions"
          :loading="isSyncing"
          :disabled="selectedMonthScope === 'ytd'"
          class="date-select week-select"
          size="middle"
        />
      </div>
    </section>

    <a-alert
      v-if="syncError"
      class="sync-alert"
      type="warning"
      show-icon
      :message="syncError"
      description="页面会保留当前展示；本地 Etsy API 服务恢复后刷新即可同步。"
    />

    <section class="finance-exchange-strip">
      <span>当前换算汇率</span>
      <strong class="finance-exchange-badge">{{ financeExchangeText }}</strong>
      <em>物流人民币按此折算美元</em>
    </section>

    <section class="etsy-metric-grid finance-metric-grid">
      <article v-for="item in financeMetricCards" :key="item.key" class="etsy-metric-card" :class="`tone-${item.tone}`">
        <span>{{ item.title }}</span>
        <strong>{{ item.value }}</strong>
        <div v-if="item.key === 'logistics'" class="finance-logistics-badges">
          <span class="finance-logistics-usd-badge">折合 {{ formatUsd(financeLogisticsCostUsd) }}</span>
        </div>
        <div v-if="item.key === 'profit'" class="finance-profit-badges">
          <span class="finance-profit-rate-badge">利润率 {{ financeProfitMarginText }}</span>
        </div>
        <p>{{ item.note }}</p>
      </article>
    </section>

    <section class="finance-two-column">
      <a-card class="panel-card finance-panel-card finance-panel-trend" :bordered="false">
        <template #title>收入、费用与估算利润趋势</template>
        <VChart class="chart chart-lg" :option="financeTrendOption" autoresize />
      </a-card>

      <a-card class="panel-card finance-panel-card finance-panel-cost" :bordered="false">
        <template #title>费用构成</template>
        <div v-if="currentFinance.feeBreakdown.length" class="finance-breakdown">
          <VChart class="chart chart-md" :option="feeBreakdownOption" autoresize />
          <div class="finance-breakdown-list">
            <div v-for="item in currentFinance.feeBreakdown" :key="item.key">
              <span>{{ item.name }}</span>
              <strong>{{ formatUsd(item.amount) }}</strong>
            </div>
          </div>
        </div>
        <a-empty v-else description="当前周期暂无费用数据" />
      </a-card>
    </section>

    <a-card class="panel-card finance-table-card finance-panel-card finance-panel-orders" :bordered="false">
      <template #title>订单与物流财务明细</template>
      <template #extra>
        <div class="table-extra-controls">
          <a-input-search
            v-model:value="orderSearchQuery"
            allow-clear
            class="finance-order-search"
            placeholder="搜索订单号"
            size="middle"
          />
          <a-tag color="blue">{{ orderPaymentCountText }} 笔 payment</a-tag>
          <a-tag color="gold">{{ formatNumber(currentFinance.logisticsRows.length) }} 单物流费用</a-tag>
        </div>
      </template>
      <a-table
        :columns="orderColumns"
        :data-source="visibleOrderRows"
        :loading="isSyncing"
        :pagination="{ pageSize: 10, showSizeChanger: false }"
        :scroll="{ x: 1760 }"
        row-key="paymentId"
        size="middle"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'receiptId'">
            #{{ record.receiptId }}
          </template>
          <template v-else-if="column.key === 'amountGross'">
            {{ record.amountGrossText }}
          </template>
          <template v-else-if="column.key === 'amountFees'">
            {{ record.amountFeesText }}
          </template>
          <template v-else-if="column.key === 'amountNet'">
            {{ record.amountNetText }}
          </template>
          <template v-else-if="column.key === 'ledgerGross'">
            {{ record.shopCurrency }} {{ record.ledgerGross.toFixed(2) }}
          </template>
          <template v-else-if="column.key === 'ledgerSalesTax'">
            {{ record.shopCurrency }} {{ record.ledgerSalesTax.toFixed(2) }}
          </template>
          <template v-else-if="column.key === 'logisticsReceivedAt'">
            <span v-if="record.logisticsReceivedAt">{{ record.logisticsReceivedAt }}</span>
            <span v-else class="logistics-unmatched">未匹配</span>
          </template>
          <template v-else-if="column.key === 'logisticsTrackingNo'">
            <span v-if="record.logisticsTrackingNo">{{ record.logisticsTrackingNo }}</span>
            <span v-else class="logistics-unmatched">未匹配</span>
          </template>
          <template v-else-if="column.key === 'logisticsShippingMethod'">
            <span v-if="record.logisticsShippingMethod">{{ record.logisticsShippingMethod }}</span>
            <span v-else class="logistics-unmatched">未匹配</span>
          </template>
          <template v-else-if="column.key === 'logisticsCountry'">
            <span v-if="record.logisticsCountry">{{ record.logisticsCountry }}</span>
            <span v-else class="logistics-unmatched">未匹配</span>
          </template>
          <template v-else-if="column.key === 'logisticsWeight'">
            <span v-if="record.logisticsMatched">{{ record.logisticsWeight.toFixed(3) }} kg</span>
            <span v-else class="logistics-unmatched">未匹配</span>
          </template>
          <template v-else-if="column.key === 'logisticsUnitPrice'">
            <span v-if="record.logisticsMatched">{{ formatCnyMoney(record.logisticsUnitPrice, record.logisticsCurrency) }}/kg</span>
            <span v-else class="logistics-unmatched">未匹配</span>
          </template>
          <template v-else-if="column.key === 'logisticsTotalAmount'">
            <span v-if="record.logisticsMatched">{{ formatCnyMoney(record.logisticsTotalAmount, record.logisticsCurrency) }}</span>
            <span v-else class="logistics-unmatched">未匹配</span>
          </template>
          <template v-else-if="column.key === 'status'">
            <a-tag :color="paymentStatusColor(record.status)">{{ record.status || '未知' }}</a-tag>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-card class="panel-card finance-table-card finance-panel-card finance-panel-ledger" :bordered="false">
      <template #title>Etsy 流水明细</template>
      <template #extra>
        <a-tag>{{ formatNumber(currentFinance.ledgerRows.length) }} 条流水</a-tag>
      </template>
      <a-table
        :columns="ledgerColumns"
        :data-source="visibleLedgerRows"
        :loading="isSyncing"
        :pagination="{ pageSize: 12, showSizeChanger: false }"
        :scroll="{ x: 980 }"
        row-key="entryId"
        size="middle"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'typeLabel'">
            <a-tag :color="ledgerCategoryColor(record.category)">{{ record.typeLabel }}</a-tag>
          </template>
          <template v-else-if="column.key === 'amount'">
            <span :class="record.amount < 0 ? 'negative-text' : 'positive-text'">{{ record.amountText }}</span>
          </template>
          <template v-else-if="column.key === 'reference'">
            <span>{{ record.referenceType || '-' }}</span>
            <small v-if="record.referenceId">#{{ record.referenceId }}</small>
          </template>
        </template>
      </a-table>
    </a-card>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { createFallbackEtsyFinance, fetchEtsyFinance } from '@/api/etsyFinance'
import PageLoading from '@/components/PageLoading.vue'
import type { FinancePeriodKey } from '@/types/business'
import { formatCnyMoney, formatNumber } from '@/utils/format'

use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const financeData = ref(createFallbackEtsyFinance())
const selectedShopScope = ref('grain-and-grace')
const selectedMonthScope = ref(monthScopeValue(financeData.value.latestDate || financeData.value.selectedDate))
const selectedDataDate = ref(defaultWeekEndForScope(selectedMonthScope.value, financeData.value.latestDate || financeData.value.selectedDate))
const isSyncing = ref(false)
const hasLoaded = ref(false)
const syncError = ref('')
const orderSearchQuery = ref('')
let autoRefreshTimer: number | undefined
const DAY_MS = 24 * 60 * 60 * 1000
const ALL_WEEKS_VALUE = 'all'

const selectedPeriod = computed<FinancePeriodKey>(() => {
  if (selectedMonthScope.value === 'ytd') return 'ytd'
  if (selectedDataDate.value === ALL_WEEKS_VALUE) return 'month'
  return 'week'
})
const currentFinance = computed(() => financeData.value.periods[selectedPeriod.value] ?? financeData.value.periods.week)
const isInitialLoading = computed(() => isSyncing.value && !hasLoaded.value)
const shopOptions = computed(() => buildShopOptions(financeData.value.shop))
const monthScopeOptions = computed(() => buildMonthScopeOptions(financeData.value.latestDate || selectedDataDate.value))
const weekOptions = computed(() => buildWeekOptions(selectedMonthScope.value, financeData.value.latestDate || selectedDataDate.value))
const requestEndDate = computed(() => selectedDataDate.value === ALL_WEEKS_VALUE
  ? monthEndDateKey(selectedMonthScope.value, financeData.value.latestDate || financeData.value.selectedDate)
  : selectedDataDate.value)
const filteredOrderRows = computed(() => {
  const keyword = orderSearchQuery.value.trim().replace(/^#/, '').toLowerCase()
  if (!keyword) return currentFinance.value.orderRows

  return currentFinance.value.orderRows.filter((row) => {
    const receiptId = String(row.receiptId || '').toLowerCase()
    return receiptId.includes(keyword)
  })
})
const visibleOrderRows = computed(() => filteredOrderRows.value.slice(0, 80))
const orderPaymentCountText = computed(() => {
  if (!orderSearchQuery.value.trim()) return formatNumber(currentFinance.value.orderRows.length)
  return `${formatNumber(filteredOrderRows.value.length)} / ${formatNumber(currentFinance.value.orderRows.length)}`
})
const visibleLedgerRows = computed(() => currentFinance.value.ledgerRows.slice(0, 120))
const financeExchangeRate = computed(() => Number(currentFinance.value.summary.usdCnyRate || 7.2))
const financeLogisticsCostUsd = computed(() => {
  const summary = currentFinance.value.summary
  if (typeof summary.logisticsCostUsd === 'number') return summary.logisticsCostUsd
  return Number((Number(summary.logisticsCost || 0) / financeExchangeRate.value).toFixed(2))
})
const financeEstimatedProfit = computed(() => {
  const summary = currentFinance.value.summary
  if (typeof summary.estimatedProfit === 'number') return summary.estimatedProfit
  return Number((Number(summary.estimatedProfitExcludingLogistics || 0) - financeLogisticsCostUsd.value).toFixed(2))
})
const financeProfitMargin = computed(() => {
  const summary = currentFinance.value.summary
  if (typeof summary.profitMargin === 'number') return summary.profitMargin
  const orderGross = Number(summary.orderGross || 0)
  return orderGross > 0 ? (financeEstimatedProfit.value / orderGross) * 100 : 0
})
const financeProfitMarginText = computed(() => `${financeProfitMargin.value.toFixed(1)}%`)
const financeExchangeText = computed(() => `USD/CNY ${financeExchangeRate.value.toFixed(4)}`)
const financeMetricCards = computed(() => currentFinance.value.metrics.map((item) => {
  if (item.key === 'logistics') {
    return {
      ...item,
      note: `折合 ${formatUsd(financeLogisticsCostUsd.value)} / ${financeExchangeText.value}`,
    }
  }

  if (item.key !== 'profit') return item

  return {
    ...item,
    value: formatUsd(financeEstimatedProfit.value),
    note: '公式：订单入账 - Etsy扣费 - 销售税 - 广告花费 - 物流折美元；不含商品成本',
  }
}))
const allFinanceLedgerRows = computed(() => {
  if (financeData.value.periods.ytd?.ledgerRows?.length) return financeData.value.periods.ytd.ledgerRows
  if (financeData.value.periods.month?.ledgerRows?.length) return financeData.value.periods.month.ledgerRows
  return currentFinance.value.ledgerRows
})
const syncStatusText = computed(() => {
  const sync = financeData.value.sync
  if (isSyncing.value) return '正在同步 Etsy 财务 API'
  if (sync.status === 'synced' || sync.status === 'cached') return `${sync.message} · 最新 ${financeData.value.latestDate}`
  return sync.message
})
const financeStatusText = computed(() => {
  if (isSyncing.value) return '同步中'
  if (financeData.value.sync.status === 'synced') return '已接入'
  if (financeData.value.sync.status === 'cached') return '使用缓存'
  return '等待同步'
})
const fallbackFinanceComparison = computed(() => {
  const selectedEnd = parseUtcDateKey(selectedDataDate.value || financeData.value.latestDate)
  const currentStart = startOfUtcWeek(selectedEnd)
  const weekEnd = addUtcDays(currentStart, 6)
  const availableDate = latestAvailableFinanceDate(currentStart, weekEnd)
  const effectiveEnd = availableDate || selectedEnd
  const elapsedDays = Math.max(1, Math.round((effectiveEnd.getTime() - currentStart.getTime()) / DAY_MS) + 1)
  const previousStart = addUtcDays(currentStart, -7)
  const previousEnd = addUtcDays(previousStart, elapsedDays - 1)
  const current = sumFinanceOrderGrossBetween(currentStart, effectiveEnd)
  const previous = sumFinanceOrderGrossBetween(previousStart, previousEnd)
  const change = Number((current - previous).toFixed(2))
  const percentChange = previous === 0
    ? current === 0
      ? 0
      : null
    : Number(((change / Math.abs(previous)) * 100).toFixed(1))

  return {
    label: elapsedDays < 7 ? '较上个自然周同期' : '较上个自然周',
    currentRangeLabel: `${formatUtcDateKey(currentStart)} - ${formatUtcDateKey(effectiveEnd)}`,
    previousRangeLabel: `${formatUtcDateKey(previousStart)} - ${formatUtcDateKey(previousEnd)}`,
    current,
    previous,
    change,
    percentChange,
  }
})
const financeComparisonSummary = computed(() => {
  const currentGross = Number(currentFinance.value.summary.orderGross || 0)

  if (selectedMonthScope.value === 'ytd' || selectedDataDate.value === ALL_WEEKS_VALUE) {
    return {
      text: selectedMonthScope.value === 'ytd' ? '订单入账 Year to Date 累计' : '订单入账统计月份累计',
      value: formatUsd(currentGross),
      detail: '',
      tone: 'flat',
    }
  }

  const comparison = currentFinance.value.comparison ?? fallbackFinanceComparison.value

  const detail = `当前 ${formatUsd(comparison.current)} / 上期 ${formatUsd(comparison.previous)}`
  if (comparison.percentChange === null) {
    return {
      text: `订单入账${comparison.label}`,
      value: comparison.current > 0 ? '新增入账' : '持平',
      detail,
      tone: comparison.current > 0 ? 'up' : 'flat',
    }
  }

  return {
    text: `订单入账${comparison.label}`,
    value: `${comparison.percentChange > 0 ? '+' : ''}${comparison.percentChange.toFixed(1)}%`,
    detail,
    tone: comparison.percentChange > 0 ? 'up' : comparison.percentChange < 0 ? 'down' : 'flat',
  }
})

const orderColumns = [
  { title: '订单号', key: 'receiptId', dataIndex: 'receiptId', width: 130 },
  { title: '时间', key: 'date', dataIndex: 'date', width: 120 },
  { title: '买家支付', key: 'amountGross', dataIndex: 'amountGross', width: 130 },
  { title: '支付费用', key: 'amountFees', dataIndex: 'amountFees', width: 120 },
  { title: 'Payment 净额', key: 'amountNet', dataIndex: 'amountNet', width: 130 },
  { title: '账户入账', key: 'ledgerGross', dataIndex: 'ledgerGross', width: 130 },
  { title: '销售税', key: 'ledgerSalesTax', dataIndex: 'ledgerSalesTax', width: 110 },
  { title: '物流计费时间', key: 'logisticsReceivedAt', dataIndex: 'logisticsReceivedAt', width: 160 },
  { title: '转单号', key: 'logisticsTrackingNo', dataIndex: 'logisticsTrackingNo', width: 190 },
  { title: '运输方式', key: 'logisticsShippingMethod', dataIndex: 'logisticsShippingMethod', width: 170 },
  { title: '国家', key: 'logisticsCountry', dataIndex: 'logisticsCountry', width: 90 },
  { title: '重量', key: 'logisticsWeight', dataIndex: 'logisticsWeight', width: 110 },
  { title: '物流单价', key: 'logisticsUnitPrice', dataIndex: 'logisticsUnitPrice', width: 120 },
  { title: '物流总金额', key: 'logisticsTotalAmount', dataIndex: 'logisticsTotalAmount', width: 130 },
  { title: '状态', key: 'status', dataIndex: 'status', width: 110 },
]

const ledgerColumns = [
  { title: '时间', key: 'date', dataIndex: 'date', width: 120 },
  { title: '类型', key: 'typeLabel', dataIndex: 'typeLabel', width: 150 },
  { title: '金额', key: 'amount', dataIndex: 'amount', width: 130 },
  { title: '余额', key: 'balanceText', dataIndex: 'balanceText', width: 130 },
  { title: '关联对象', key: 'reference', dataIndex: 'referenceId', width: 170 },
  { title: '原始类型', key: 'type', dataIndex: 'type', width: 170 },
  { title: '说明', key: 'description', dataIndex: 'description' },
]

async function loadFinance(endDate?: string) {
  isSyncing.value = true
  try {
    const data = await fetchEtsyFinance(endDate)
    financeData.value = data
    const responseDate = data.selectedDate || selectedDataDate.value || data.latestDate
    if (selectedDataDate.value !== ALL_WEEKS_VALUE) {
      selectedDataDate.value = selectedMonthScope.value === 'ytd' ? data.latestDate || responseDate : weekEndDateKey(responseDate)
    }
    syncError.value = ''
  } catch (error) {
    syncError.value = error instanceof Error ? error.message : 'Etsy 财务 API 同步失败'
  } finally {
    hasLoaded.value = true
    isSyncing.value = false
  }
}

onMounted(() => {
  void loadFinance(requestEndDate.value)
  autoRefreshTimer = window.setInterval(() => {
    void loadFinance(requestEndDate.value)
  }, 10 * 60 * 1000)
})

onUnmounted(() => {
  if (autoRefreshTimer) window.clearInterval(autoRefreshTimer)
})

watch(selectedDataDate, (date, oldDate) => {
  if (!date || !oldDate || date === oldDate) return
  void loadFinance(requestEndDate.value)
})

watch(selectedMonthScope, (scope, oldScope) => {
  if (!scope || scope === oldScope) return
  const nextDate = defaultWeekEndForScope(scope, financeData.value.latestDate || selectedDataDate.value)
  if (nextDate === selectedDataDate.value) {
    void loadFinance(requestEndDate.value)
    return
  }
  selectedDataDate.value = nextDate
})

function formatUsd(value: number) {
  return `$${Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function paymentStatusColor(status: string) {
  if (status === 'SETTLED') return 'green'
  if (status === 'PENDING') return 'gold'
  return 'default'
}

function ledgerCategoryColor(category: string) {
  if (category === 'orderGross') return 'green'
  if (category === 'paymentFees' || category === 'listingFees') return 'orange'
  if (category === 'adFees') return 'blue'
  if (category === 'taxes') return 'purple'
  if (category === 'disbursements') return 'cyan'
  return 'default'
}

function parseUtcDateKey(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return new Date()
  return new Date(Date.UTC(year, month - 1, day))
}

function formatUtcDateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addUtcDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

function startOfUtcWeek(date: Date) {
  const day = date.getUTCDay() || 7
  return addUtcDays(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())), 1 - day)
}

function monthScopeValue(dateKey: string) {
  const date = parseUtcDateKey(dateKey)
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${date.getUTCFullYear()}-${month}`
}

function monthScopeLabel(value: string) {
  const [year, month] = value.split('-')
  return `${year}年${Number(month)}月`
}

function buildShopOptions(_shop?: { shopId?: string; shopName?: string }) {
  return [
    { label: 'GrainAndGraceJewelry', value: 'grain-and-grace' },
    { label: '其他店铺', value: 'other' },
  ]
}

function weekEndDateKey(dateKey: string) {
  return formatUtcDateKey(addUtcDays(startOfUtcWeek(parseUtcDateKey(dateKey)), 6))
}

function buildMonthScopeOptions(latestDate: string) {
  const latest = parseUtcDateKey(latestDate)
  const year = latest.getUTCFullYear()
  const latestMonth = latest.getUTCMonth()
  const monthOptions = Array.from({ length: latestMonth + 1 }, (_, index) => {
    const monthIndex = latestMonth - index
    const value = `${year}-${String(monthIndex + 1).padStart(2, '0')}`

    return {
      label: monthScopeLabel(value),
      value,
    }
  })

  return [
    { label: 'Year to Date', value: 'ytd' },
    ...monthOptions,
  ]
}

function monthWeekStarts(scope: string, latestDate: string) {
  const [year, month] = scope.split('-').map(Number)
  const latestWeekStart = startOfUtcWeek(parseUtcDateKey(latestDate))
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const nextMonthStart = new Date(Date.UTC(year, month, 1))
  const firstWeekStart = startOfUtcWeek(monthStart)
  const starts: Date[] = []

  for (let start = firstWeekStart; start < nextMonthStart; start = addUtcDays(start, 7)) {
    if (start.getUTCMonth() !== month - 1) continue
    if (start > latestWeekStart) continue
    starts.push(start)
  }

  return starts
}

function buildWeekOptions(scope: string, latestDate: string) {
  if (scope === 'ytd') {
    return [{ label: '年初至今', value: latestDate }]
  }

  return [
    { label: '全部', value: ALL_WEEKS_VALUE },
    ...monthWeekStarts(scope, latestDate).reverse().map((start) => {
      const end = addUtcDays(start, 6)

      return {
        label: `${formatUtcDateKey(start)} - ${formatUtcDateKey(end)}`,
        value: formatUtcDateKey(end),
      }
    }),
  ]
}

function defaultWeekEndForScope(scope: string, latestDate: string) {
  if (scope === 'ytd') return latestDate
  return buildWeekOptions(scope, latestDate).find((item) => item.value !== ALL_WEEKS_VALUE)?.value || weekEndDateKey(latestDate)
}

function monthEndDateKey(scope: string, latestDate: string) {
  if (scope === 'ytd') return latestDate
  const [year, month] = scope.split('-').map(Number)
  const latest = parseUtcDateKey(latestDate)
  const monthEnd = addUtcDays(new Date(Date.UTC(year, month, 1)), -1)

  if (latest.getUTCFullYear() === year && latest.getUTCMonth() === month - 1 && latest < monthEnd) {
    return formatUtcDateKey(latest)
  }

  return formatUtcDateKey(monthEnd)
}

function latestAvailableFinanceDate(start: Date, end: Date) {
  const startKey = formatUtcDateKey(start)
  const endKey = formatUtcDateKey(end)
  const dates = allFinanceLedgerRows.value
    .map((row) => row.date)
    .filter((date) => date >= startKey && date <= endKey)
    .sort()
  const latest = dates[dates.length - 1]

  return latest ? parseUtcDateKey(latest) : null
}

function sumFinanceOrderGrossBetween(start: Date, end: Date) {
  const startKey = formatUtcDateKey(start)
  const endKey = formatUtcDateKey(end)
  const total = allFinanceLedgerRows.value
    .filter((row) => row.date >= startKey && row.date <= endKey && row.category === 'orderGross')
    .reduce((sum, row) => sum + Number(row.amount || 0), 0)

  return Number(total.toFixed(2))
}

const financeTrendOption = computed(() => ({
  color: ['#16a34a', '#d97706', '#2563eb', '#7c3aed', '#dc2626'],
  tooltip: {
    trigger: 'axis',
    formatter: (params: Array<{ dataIndex: number; marker: string; seriesName: string; value: number }>) => {
      const first = params[0]
      const item = currentFinance.value.trends[first?.dataIndex ?? 0]
      const lines = params.map((param) => {
        const value = param.seriesName === '订单' ? formatNumber(param.value) : formatUsd(Number(param.value || 0))
        return `${param.marker}${param.seriesName}：${value}`
      })
      return [item?.rangeLabel || item?.label || '', ...lines].join('<br/>')
    },
  },
  legend: { bottom: 0, data: ['订单入账', 'Etsy扣费', '广告花费', '估算利润', '订单'] },
  grid: { left: 52, right: 38, top: 34, bottom: 62 },
  xAxis: {
    type: 'category',
    data: currentFinance.value.trends.map((item) => item.label),
    axisTick: { show: false },
    axisLabel: { interval: currentFinance.value.trends.length > 14 ? 2 : 0 },
  },
  yAxis: [
    { type: 'value', name: '金额', splitLine: { lineStyle: { color: '#eef2f7' } } },
    { type: 'value', name: '订单', splitLine: { show: false } },
  ],
  series: [
    { name: '订单入账', type: 'line', smooth: true, data: currentFinance.value.trends.map((item) => item.orderGross) },
    { name: 'Etsy扣费', type: 'line', smooth: true, data: currentFinance.value.trends.map((item) => item.etsyFees) },
    { name: '广告花费', type: 'line', smooth: true, data: currentFinance.value.trends.map((item) => item.adSpend) },
    { name: '估算利润', type: 'bar', barWidth: 18, data: currentFinance.value.trends.map((item) => item.estimatedProfit ?? item.estimatedProfitExcludingLogistics) },
    { name: '订单', type: 'line', yAxisIndex: 1, smooth: true, data: currentFinance.value.trends.map((item) => item.orders) },
  ],
}))

const feeBreakdownOption = computed(() => ({
  color: ['#d97706', '#2563eb', '#dc2626', '#7c3aed', '#16a34a'],
  tooltip: {
    trigger: 'item',
    formatter: (params: { name: string; value: number; percent: number }) =>
      `${params.name}<br/>${formatUsd(params.value)}<br/>占比：${params.percent}%`,
  },
  legend: { show: false },
  series: [
    {
      type: 'pie',
      radius: ['48%', '72%'],
      center: ['50%', '48%'],
      label: { formatter: '{b}\n{d}%' },
      data: currentFinance.value.feeBreakdown.map((item) => ({
        name: item.name,
        value: item.amount,
      })),
    },
  ],
}))
</script>

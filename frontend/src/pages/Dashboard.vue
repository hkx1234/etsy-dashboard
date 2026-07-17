<template>
  <div class="page etsy-dashboard">
    <PageLoading v-if="isInitialLoading" />
    <template v-else>
    <section class="page-heading compact-heading">
      <div>
        <span class="eyebrow">Etsy Business Overview</span>
        <h1>经营总览</h1>
        <p class="overview-heading-copy">
          <template v-if="comparisonSummary">
            <span>本自然周共 {{ formatNumber(comparisonSummary.week.current) }} 单，较上周同期{{ comparisonSummary.week.direction }} {{ formatNumber(Math.abs(comparisonSummary.week.change)) }} 单</span>
            <span :class="['overview-change-pill', `is-${comparisonSummary.week.tone}`]">{{ comparisonSummary.week.percentText }}</span>
            <span>；本月至今共 {{ formatNumber(comparisonSummary.month.current) }} 单，较上月同期{{ comparisonSummary.month.direction }} {{ formatNumber(Math.abs(comparisonSummary.month.change)) }} 单</span>
            <span :class="['overview-change-pill', `is-${comparisonSummary.month.tone}`]">{{ comparisonSummary.month.percentText }}</span>
          </template>
          <template v-else>
            <span>{{ currentDashboard.summary }}</span>
          </template>
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

    <section class="dashboard-best-product">
      <div class="best-product-card">
        <img
          v-if="bestProduct?.imageUrl"
          class="best-product-image"
          :src="bestProduct.imageUrl"
          :alt="bestProduct.productName"
        />
        <div class="best-product-copy">
          <span>{{ currentDashboard.bestProductLabel }}</span>
          <strong>{{ currentDashboard.bestProduct }}</strong>
          <p>{{ currentDashboard.bestProductNote }}</p>
        </div>
      </div>
    </section>

    <a-alert
      v-if="syncError"
      class="sync-alert"
      type="warning"
      show-icon
      :message="syncError"
      description="页面会保留备用展示数据；本地 Etsy API 服务恢复后刷新即可同步。"
    />

    <section class="etsy-metric-grid">
      <article v-for="item in dashboardMetricCards" :key="item.key" class="etsy-metric-card" :class="`tone-${item.tone}`">
        <span>{{ item.title }}</span>
        <strong>{{ item.value }}</strong>
        <p>{{ item.note }}</p>
      </article>
    </section>

    <section class="etsy-two-column">
      <a-card class="panel-card dashboard-chart-panel trend-panel" :bordered="false">
        <template #title>{{ currentDashboard.trendTitle }}</template>
        <VChart class="chart chart-lg" :option="weeklyTrendOption" autoresize />
      </a-card>

      <a-card class="panel-card dashboard-chart-panel attribution-panel" :bordered="false">
        <template #title>{{ currentDashboard.sourceTitle }}</template>
        <VChart class="chart chart-lg" :option="orderAttributionPieOption" autoresize />
      </a-card>
    </section>
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
import { createFallbackEtsyDashboard, fetchEtsyDashboard } from '@/api/etsyDashboard'
import PageLoading from '@/components/PageLoading.vue'
import { formatMoney, formatNumber } from '@/utils/format'

use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const dashboardData = ref(createFallbackEtsyDashboard())
const selectedShopScope = ref('grain-and-grace')
const selectedMonthScope = ref(monthScopeValue(dashboardData.value.latestDate || dashboardData.value.selectedDate))
const selectedDataDate = ref(defaultWeekEndForScope(selectedMonthScope.value, dashboardData.value.latestDate || dashboardData.value.selectedDate))
const isSyncing = ref(false)
const hasLoaded = ref(false)
const syncError = ref('')
let autoRefreshTimer: number | undefined

const ALL_WEEKS_VALUE = 'all'

const selectedPeriod = computed(() => {
  if (selectedMonthScope.value === 'ytd') return 'ytd' as const
  if (selectedDataDate.value === ALL_WEEKS_VALUE) return 'month' as const
  return 'week' as const
})
const currentDashboard = computed(() => dashboardData.value.periods[selectedPeriod.value] ?? dashboardData.value.periods.week)
const currentMetrics = computed(() => currentDashboard.value.metrics)
const dashboardMetricCards = computed(() => currentMetrics.value.filter((item) => item.key !== 'best'))
const currentComparisons = computed(() => currentDashboard.value.comparisons)
const comparisonSummary = computed(() => {
  const orderComparison = currentComparisons.value?.metrics.find((item) => item.key === 'orders')
  if (!orderComparison) return null

  return {
    week: formatComparisonValue(orderComparison.week),
    month: formatComparisonValue(orderComparison.month),
  }
})
const currentTrends = computed(() => currentDashboard.value.trends)
const currentOrderAttribution = computed(() => currentDashboard.value.trafficSources)
const currentProducts = computed(() => dashboardData.value.products[selectedPeriod.value] ?? [])
const bestProduct = computed(() => currentProducts.value[0])
const isInitialLoading = computed(() => isSyncing.value && !hasLoaded.value)
const shopOptions = computed(() => buildShopOptions(dashboardData.value.shop))
const monthScopeOptions = computed(() => buildMonthScopeOptions(dashboardData.value.latestDate || selectedDataDate.value))
const weekOptions = computed(() => buildWeekOptions(selectedMonthScope.value, dashboardData.value.latestDate || selectedDataDate.value))
const requestEndDate = computed(() => selectedDataDate.value === ALL_WEEKS_VALUE
  ? monthEndDateKey(selectedMonthScope.value, dashboardData.value.latestDate || dashboardData.value.selectedDate)
  : selectedDataDate.value)

function formatComparisonValue(value: { current: number; previous: number; change: number; percentChange: number | null }) {
  const percentText = value.percentChange === null
    ? '上期为 0'
    : `${value.percentChange > 0 ? '+' : ''}${value.percentChange.toFixed(1)}%`

  return {
    ...value,
    direction: value.change > 0 ? '增加' : value.change < 0 ? '减少' : '持平',
    percentText,
    tone: value.change > 0 ? 'up' : value.change < 0 ? 'down' : 'flat',
  }
}

function buildShopOptions(_shop?: { shopId?: string; shopName?: string }) {
  return [
    { label: 'GrainAndGraceJewelry', value: 'grain-and-grace' },
    { label: '其他店铺', value: 'other' },
  ]
}

async function loadEtsyDashboard(endDate?: string) {
  isSyncing.value = true
  try {
    const data = await fetchEtsyDashboard(endDate)
    dashboardData.value = data
    const responseDate = data.selectedDate || selectedDataDate.value || data.latestDate
    if (selectedDataDate.value !== ALL_WEEKS_VALUE) {
      selectedDataDate.value = selectedMonthScope.value === 'ytd' ? data.latestDate || responseDate : weekEndDateKey(responseDate)
    }
    syncError.value = ''
  } catch (error) {
    syncError.value = error instanceof Error ? error.message : 'Etsy API 同步失败'
  } finally {
    hasLoaded.value = true
    isSyncing.value = false
  }
}

onMounted(() => {
  void loadEtsyDashboard(requestEndDate.value)
  autoRefreshTimer = window.setInterval(() => {
    void loadEtsyDashboard(requestEndDate.value)
  }, 10 * 60 * 1000)
})

onUnmounted(() => {
  if (autoRefreshTimer) window.clearInterval(autoRefreshTimer)
})

watch(selectedDataDate, (date, oldDate) => {
  if (!date || !oldDate || date === oldDate) return
  void loadEtsyDashboard(requestEndDate.value)
})

watch(selectedMonthScope, (scope, oldScope) => {
  if (!scope || scope === oldScope) return
  const nextDate = defaultWeekEndForScope(scope, dashboardData.value.latestDate || selectedDataDate.value)
  if (nextDate === selectedDataDate.value) {
    void loadEtsyDashboard(requestEndDate.value)
    return
  }
  selectedDataDate.value = nextDate
})

function formatTrendAxisLabel(item: { label: string; rangeLabel?: string }) {
  if (selectedPeriod.value !== 'week' || !item.rangeLabel?.includes(' - ')) return item.label
  const [start, end] = item.rangeLabel.split(' - ')
  return `${start.slice(5).replace('-', '/')}-${end.slice(5).replace('-', '/')}`
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

  const starts = monthWeekStarts(scope, latestDate)

  return [
    { label: '全部', value: ALL_WEEKS_VALUE },
    ...starts.reverse().map((start) => {
      const end = addUtcDays(start, 6)
      const label = `${formatUtcDateKey(start)} - ${formatUtcDateKey(end)}`

      return {
        label,
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

const weeklyTrendOption = computed(() => ({
  color: ['#2563eb', '#16a34a', '#d97706', '#7c3aed'],
  tooltip: {
    trigger: 'axis',
    formatter: (params: Array<{ dataIndex: number; marker: string; seriesName: string; value: number }>) => {
      const first = params[0]
      const item = currentTrends.value[first?.dataIndex ?? 0]
      const lines = params.map((param) => {
        const value = param.seriesName === '订单' ? formatNumber(param.value) : formatMoney(Number(param.value || 0))
        return `${param.marker}${param.seriesName}：${value}`
      })
      return [item?.rangeLabel || item?.label || '', ...lines].join('<br/>')
    },
  },
  legend: { bottom: 0, data: ['订单', '收入', '广告花费', '广告销售额'] },
  grid: { left: 48, right: 38, top: 34, bottom: 58 },
  xAxis: {
    type: 'category',
    data: currentTrends.value.map((item) => formatTrendAxisLabel(item)),
    axisTick: { show: false },
    axisLabel: { interval: 0 },
  },
  yAxis: [
    { type: 'value', name: '订单', splitLine: { lineStyle: { color: '#eef2f7' } } },
    { type: 'value', name: '金额', splitLine: { show: false } },
  ],
  series: [
    { name: '订单', type: 'bar', barWidth: 24, data: currentTrends.value.map((item) => item.orders) },
    { name: '收入', type: 'line', yAxisIndex: 1, smooth: true, data: currentTrends.value.map((item) => item.revenue) },
    { name: '广告花费', type: 'line', yAxisIndex: 1, smooth: true, data: currentTrends.value.map((item) => item.adSpend) },
    { name: '广告销售额', type: 'line', yAxisIndex: 1, smooth: true, data: currentTrends.value.map((item) => item.adRevenue) },
  ],
}))

const orderAttributionPieOption = computed(() => {
  return {
    color: ['#16a34a', '#2563eb'],
    tooltip: {
      trigger: 'item',
      formatter: (params: { name: string; value: number; percent: number }) =>
        `${params.name}<br/>订单：${formatNumber(params.value)}<br/>占比：${params.percent}%`,
    },
    legend: { bottom: 0 },
    series: [
      {
        type: 'pie',
        radius: ['46%', '72%'],
        center: ['50%', '45%'],
        label: { formatter: '{b}\n{d}%' },
        data: currentOrderAttribution.value.map((item) => ({
          name: item.name,
          value: item.orders,
        })),
      },
    ],
  }
})
</script>

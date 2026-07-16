<template>
  <div class="page traffic-page">
    <PageLoading v-if="isInitialLoading" />
    <template v-else>
    <section class="page-heading compact-heading">
      <div>
        <span class="eyebrow">Etsy Ads CSV</span>
        <h1>广告与流量</h1>
        <p class="ad-heading-copy">
          <span>{{ adSpendComparison.text }}</span>
          <span :class="['ad-spend-change', `is-${adSpendComparison.tone}`]">
            {{ adSpendComparison.value }}
          </span>
          <span v-if="adSpendComparison.detail" class="ad-spend-detail">{{ adSpendComparison.detail }}</span>
          <a-tooltip placement="bottomLeft">
            <template #title>
              <div>{{ dashboardData.ads.sourceFile || '等待广告报表' }}</div>
              <div>{{ dashboardData.ads.message }}</div>
            </template>
            <span class="ad-source-pill">广告数据 {{ adStatusText }}</span>
          </a-tooltip>
        </p>
      </div>
      <div class="period-controls">
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
      description="页面会保留备用展示数据；本地 Etsy API 服务恢复后刷新即可同步。"
    />

    <section class="etsy-metric-grid ad-grid">
      <article class="etsy-metric-card tone-amber">
        <span>广告花费</span>
        <strong>{{ formatMoney(currentAd.spend) }}</strong>
        <p>{{ currentAd.rows }} 天数据 / 日预算 {{ formatMoney(currentAd.endingBudget) }}</p>
      </article>
      <article class="etsy-metric-card tone-green">
        <span>广告销售额</span>
        <strong>{{ formatMoney(currentAd.revenue) }}</strong>
        <p>广告订单 {{ formatNumber(currentAd.orders) }} 单</p>
      </article>
      <article class="etsy-metric-card tone-blue">
        <span>ROAS</span>
        <strong>{{ currentAd.roas.toFixed(2) }}</strong>
        <p>每 $1 广告带来 ${{ currentAd.roas.toFixed(2) }} 销售额</p>
      </article>
      <article class="etsy-metric-card tone-red">
        <span>ACOS</span>
        <strong>{{ formatPercent(currentAd.acos) }}</strong>
        <p>广告花费 / 广告销售额</p>
      </article>
      <article class="etsy-metric-card tone-blue">
        <span>广告曝光</span>
        <strong>{{ formatNumber(currentAd.views) }}</strong>
        <p>站内广告展示量</p>
      </article>
      <article class="etsy-metric-card tone-green">
        <span>广告点击</span>
        <strong>{{ formatNumber(currentAd.clicks) }}</strong>
        <p>CTR {{ formatPercent(currentAd.clickRate) }} / CPC {{ formatMoney(currentAd.cpc) }}</p>
      </article>
    </section>

    <section class="market-keyword-panel traffic-module module-market">
      <div class="market-keyword-panel-head">
        <div>
          <strong>市场关键词雷达 · {{ marketData.scopeLabel }}</strong>
          <span>{{ marketData.sync.message }}</span>
        </div>
        <div class="market-source-actions">
          <span>关键词维度</span>
          <a-select v-model:value="marketScope" :options="marketScopeOptions" class="market-scope-select" size="small" />
          <a-tag :color="marketStatusColor">{{ marketStatusText }}</a-tag>
          <a-button size="small" :loading="isMarketSyncing" @click="loadMarketKeywords(true)">重新采样</a-button>
        </div>
      </div>

      <section class="market-keyword-section">
        <a-card class="panel-card table-card" :bordered="false">
          <template #title>公开市场关键词排行</template>
          <template #extra>
            <span class="market-ranking-count">
              {{ isMarketRankingExpanded ? '已展开' : `先展示前 ${MARKET_RANKING_PREVIEW_SIZE} 个` }}
            </span>
          </template>
          <a-alert
            v-if="marketError"
            class="sync-alert compact-alert"
            type="warning"
            show-icon
            :message="marketError"
          />
          <a-table
            :columns="marketKeywordColumns"
            :data-source="visibleMarketKeywords"
            :loading="isMarketSyncing"
            :pagination="false"
            row-key="keyword"
            :scroll="{ x: 900 }"
            size="middle"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'keyword'">
                <div class="market-keyword-cell">
                  <strong>{{ record.keyword }}</strong>
                  <span>{{ record.sourceSeeds.slice(0, 3).join(' / ') }}</span>
                </div>
              </template>
              <template v-if="column.key === 'score'">
                {{ formatNumber(record.score) }}
              </template>
              <template v-if="column.key === 'listingCount'">
                {{ formatNumber(record.listingCount) }}
              </template>
              <template v-if="column.key === 'tagUses'">
                {{ formatNumber(record.tagUses) }}
              </template>
              <template v-if="column.key === 'titleUses'">
                {{ formatNumber(record.titleUses) }}
              </template>
              <template v-if="column.key === 'searchUrl'">
                <a :href="record.searchUrl" target="_blank" rel="noreferrer">打开</a>
              </template>
            </template>
          </a-table>
          <div v-if="hasMoreMarketKeywords" class="market-ranking-toggle">
            <a-button type="link" size="small" @click="isMarketRankingExpanded = !isMarketRankingExpanded">
              {{ isMarketRankingExpanded ? '收起关键词排行' : `展开全部 ${formatNumber(topMarketKeywords.length)} 个关键词` }}
            </a-button>
          </div>
        </a-card>
      </section>
    </section>

    <section class="etsy-two-column">
      <a-card class="panel-card traffic-module-card module-trend" :bordered="false">
        <template #title>{{ currentTrendTitle }}</template>
        <VChart class="chart chart-lg" :option="adTrendOption" autoresize />
      </a-card>

      <a-card class="panel-card table-card ad-daily-card traffic-module-card module-detail" :bordered="false">
        <template #title>广告日报明细</template>
        <template #extra>
          <a-tag color="blue">{{ dashboardData.ads.sourceDir }}</a-tag>
        </template>
        <a-table
          :columns="columns"
          :data-source="scopedAdRows"
          :loading="isSyncing"
          :pagination="false"
          row-key="date"
          :scroll="{ x: 760 }"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'spend'">
              {{ formatMoney(record.spend) }}
            </template>
            <template v-if="column.key === 'revenue'">
              {{ formatMoney(record.revenue) }}
            </template>
            <template v-if="column.key === 'roas'">
              {{ Number(record.roas || 0).toFixed(2) }}
            </template>
            <template v-if="column.key === 'clickRate'">
              {{ formatPercent(record.clickRate) }}
            </template>
            <template v-if="column.key === 'endingBudget'">
              {{ formatMoney(record.endingBudget) }}
            </template>
          </template>
        </a-table>
      </a-card>
    </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { createFallbackEtsyDashboard, fetchEtsyDashboard } from '@/api/etsyDashboard'
import { createFallbackMarketKeywords, fetchMarketKeywords } from '@/api/etsyMarketKeywords'
import PageLoading from '@/components/PageLoading.vue'
import type { MarketKeywordScope } from '@/types/business'
import { formatMoney, formatNumber, formatPercent } from '@/utils/format'

use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const marketScope = ref<MarketKeywordScope>('category')
const dashboardData = ref(createFallbackEtsyDashboard())
const marketData = ref(createFallbackMarketKeywords(marketScope.value))
const selectedMonthScope = ref(monthScopeValue(dashboardData.value.latestDate || dashboardData.value.selectedDate))
const selectedDataDate = ref(defaultWeekEndForScope(selectedMonthScope.value, dashboardData.value.latestDate || dashboardData.value.selectedDate))
const isSyncing = ref(false)
const isMarketSyncing = ref(false)
const hasLoadedAdDashboard = ref(false)
const hasLoadedMarketKeywords = ref(false)
const syncError = ref('')
const marketError = ref('')
const isMarketRankingExpanded = ref(false)
const MARKET_RANKING_PREVIEW_SIZE = 8

const selectedPeriod = computed(() => selectedMonthScope.value === 'ytd' ? 'ytd' as const : 'week' as const)
const currentAd = computed(() => dashboardData.value.ads.periods[selectedPeriod.value])
const isInitialLoading = computed(() =>
  (isSyncing.value && !hasLoadedAdDashboard.value) ||
  (isMarketSyncing.value && !hasLoadedMarketKeywords.value),
)
const currentTrendTitle = computed(() => dashboardData.value.periods[selectedPeriod.value].trendTitle
  .replace('每日趋势', '广告每日趋势')
  .replace('周期对比', '广告周期对比')
  .replace('月度趋势', '广告月度趋势'))
const monthScopeOptions = computed(() => buildMonthScopeOptions(dashboardData.value.latestDate || selectedDataDate.value))
const weekOptions = computed(() => buildWeekOptions(selectedMonthScope.value, dashboardData.value.latestDate || selectedDataDate.value))
const allAdRows = computed(() => [...dashboardData.value.ads.rows].sort((a, b) => b.date.localeCompare(a.date)))
const scopedAdRows = computed(() => {
  const endDate = selectedMonthScope.value === 'ytd'
    ? dashboardData.value.latestDate || selectedDataDate.value
    : selectedDataDate.value
  const end = parseUtcDateKey(endDate)
  const start = selectedMonthScope.value === 'ytd'
    ? new Date(Date.UTC(end.getUTCFullYear(), 0, 1))
    : startOfUtcWeek(end)
  const startKey = formatUtcDateKey(start)
  const endKey = formatUtcDateKey(end)

  return allAdRows.value.filter((row) => row.date >= startKey && row.date <= endKey)
})
const adSpendComparison = computed(() => {
  const currentSpend = Number(currentAd.value.spend || 0)

  if (selectedMonthScope.value === 'ytd') {
    return {
      text: '广告花费 Year to Date 累计',
      value: formatMoney(currentSpend),
      detail: '',
      tone: 'flat',
    }
  }

  const selectedEnd = parseUtcDateKey(selectedDataDate.value || dashboardData.value.latestDate)
  const latest = parseUtcDateKey(dashboardData.value.ads.latestDate || dashboardData.value.latestDate || selectedDataDate.value)
  const effectiveEnd = selectedEnd.getTime() > latest.getTime() ? latest : selectedEnd
  const currentStart = startOfUtcWeek(selectedEnd)
  const previousStart = addUtcDays(currentStart, -7)
  const previousEnd = addUtcDays(effectiveEnd, -7)
  const comparableCurrentSpend = sumAdSpendBetween(currentStart, effectiveEnd)
  const previousSpend = sumAdSpendBetween(previousStart, previousEnd)
  const detail = `当前 ${formatMoney(comparableCurrentSpend)} / 上期 ${formatMoney(previousSpend)}`

  if (previousSpend <= 0) {
    return {
      text: '广告花费较上个自然周同期',
      value: comparableCurrentSpend > 0 ? '新增花费' : '持平',
      detail,
      tone: comparableCurrentSpend > 0 ? 'up' : 'flat',
    }
  }

  const percent = ((comparableCurrentSpend - previousSpend) / Math.abs(previousSpend)) * 100

  return {
    text: '广告花费较上个自然周同期',
    value: `${percent > 0 ? '+' : ''}${formatPercent(percent)}`,
    detail,
    tone: percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat',
  }
})
const marketScopeOptions: Array<{ label: string; value: MarketKeywordScope }> = [
  { label: '当前品类', value: 'category' },
  { label: '全平台', value: 'platform' },
]
const adStatusText = computed(() => {
  if (isSyncing.value) return '同步中'
  if (dashboardData.value.ads.status === 'synced') return '已接入'
  if (dashboardData.value.ads.status === 'cached') return '使用缓存'
  return '等待报表'
})
const marketStatusText = computed(() => {
  if (isMarketSyncing.value) return '采样中'
  if (marketData.value.status === 'synced') return '已采样'
  if (marketData.value.status === 'partial') return '部分采样'
  return '使用缓存'
})
const marketStatusColor = computed(() => {
  if (marketData.value.status === 'synced') return 'green'
  if (marketData.value.status === 'partial') return 'gold'
  return 'warning'
})
const topMarketKeywords = computed(() => marketData.value.keywords.slice(0, 30))
const visibleMarketKeywords = computed(() => isMarketRankingExpanded.value
  ? topMarketKeywords.value
  : topMarketKeywords.value.slice(0, MARKET_RANKING_PREVIEW_SIZE))
const hasMoreMarketKeywords = computed(() => topMarketKeywords.value.length > MARKET_RANKING_PREVIEW_SIZE)

const columns = [
  { title: '日期', key: 'date', dataIndex: 'date' },
  { title: '曝光', key: 'views', dataIndex: 'views' },
  { title: '点击', key: 'clicks', dataIndex: 'clicks' },
  { title: '订单', key: 'orders', dataIndex: 'orders' },
  { title: '花费', key: 'spend', dataIndex: 'spend' },
  { title: '销售额', key: 'revenue', dataIndex: 'revenue' },
  { title: 'ROAS', key: 'roas', dataIndex: 'roas' },
  { title: 'CTR', key: 'clickRate', dataIndex: 'clickRate' },
  { title: '日预算', key: 'endingBudget', dataIndex: 'endingBudget' },
]

const marketKeywordColumns = [
  { title: '关键词', key: 'keyword', width: 240 },
  { title: '热度分', key: 'score', dataIndex: 'score', width: 90 },
  { title: '样本商品', key: 'listingCount', dataIndex: 'listingCount', width: 100 },
  { title: '标签出现', key: 'tagUses', dataIndex: 'tagUses', width: 100 },
  { title: '标题出现', key: 'titleUses', dataIndex: 'titleUses', width: 100 },
  { title: 'Etsy', key: 'searchUrl', width: 80 },
]

async function loadAdDashboard(endDate = selectedDataDate.value) {
  isSyncing.value = true
  try {
    const data = await fetchEtsyDashboard(endDate)
    dashboardData.value = data
    const responseDate = data.selectedDate || selectedDataDate.value || data.latestDate
    selectedDataDate.value = selectedMonthScope.value === 'ytd' ? data.latestDate || responseDate : weekEndDateKey(responseDate)
    syncError.value = ''
  } catch (error) {
    syncError.value = error instanceof Error ? error.message : '广告报表同步失败'
  } finally {
    hasLoadedAdDashboard.value = true
    isSyncing.value = false
  }
}

async function loadMarketKeywords(force = false) {
  isMarketSyncing.value = true
  try {
    marketData.value = await fetchMarketKeywords({ force, scope: marketScope.value })
    marketError.value = ''
  } catch (error) {
    marketError.value = error instanceof Error ? error.message : '市场关键词采样失败'
  } finally {
    hasLoadedMarketKeywords.value = true
    isMarketSyncing.value = false
  }
}

onMounted(() => {
  void loadAdDashboard(selectedDataDate.value)
  void loadMarketKeywords()
})

watch(selectedDataDate, (date, oldDate) => {
  if (!date || !oldDate || date === oldDate) return
  void loadAdDashboard(date)
})

watch(selectedMonthScope, (scope, oldScope) => {
  if (!scope || scope === oldScope) return
  const nextDate = defaultWeekEndForScope(scope, dashboardData.value.latestDate || selectedDataDate.value)
  if (nextDate === selectedDataDate.value) {
    void loadAdDashboard(nextDate)
    return
  }
  selectedDataDate.value = nextDate
})

watch(marketScope, (scope) => {
  isMarketRankingExpanded.value = false
  marketData.value = createFallbackMarketKeywords(scope)
  marketError.value = ''
  void loadMarketKeywords()
})

function formatTrendAxisLabel(item: { label: string; rangeLabel?: string }) {
  if (!item.rangeLabel?.includes(' - ')) return item.label
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

  return monthWeekStarts(scope, latestDate).reverse().map((start) => {
    const end = addUtcDays(start, 6)

    return {
      label: `${formatUtcDateKey(start)} - ${formatUtcDateKey(end)}`,
      value: formatUtcDateKey(end),
    }
  })
}

function defaultWeekEndForScope(scope: string, latestDate: string) {
  if (scope === 'ytd') return latestDate
  return buildWeekOptions(scope, latestDate)[0]?.value || weekEndDateKey(latestDate)
}

function sumAdSpendBetween(start: Date, end: Date) {
  const startKey = formatUtcDateKey(start)
  const endKey = formatUtcDateKey(end)
  const spend = allAdRows.value
    .filter((row) => row.date >= startKey && row.date <= endKey)
    .reduce((sum, row) => sum + Number(row.spend || 0), 0)

  return Number(spend.toFixed(2))
}

const adTrendOption = computed(() => ({
  color: ['#d97706', '#16a34a', '#2563eb'],
  tooltip: {
    trigger: 'axis',
    formatter: (params: Array<{ dataIndex: number; marker: string; seriesName: string; value: number }>) => {
      const trends = dashboardData.value.periods[selectedPeriod.value].trends
      const item = trends[params[0]?.dataIndex ?? 0]
      const lines = params.map((param) => {
        const value = param.seriesName === '点击' ? formatNumber(param.value) : formatMoney(Number(param.value || 0))
        return `${param.marker}${param.seriesName}：${value}`
      })
      return [item?.rangeLabel || item?.label || '', ...lines].join('<br/>')
    },
  },
  legend: { bottom: 0, data: ['广告花费', '广告销售额', '点击'] },
  grid: { left: 52, right: 40, top: 34, bottom: 58 },
  xAxis: {
    type: 'category',
    data: dashboardData.value.periods[selectedPeriod.value].trends.map((item) => formatTrendAxisLabel(item)),
    axisTick: { show: false },
    axisLabel: { interval: 0 },
  },
  yAxis: [
    { type: 'value', name: '金额', splitLine: { lineStyle: { color: '#eef2f7' } } },
    { type: 'value', name: '点击', splitLine: { show: false } },
  ],
  series: [
    {
      name: '广告花费',
      type: 'bar',
      barWidth: 22,
      data: dashboardData.value.periods[selectedPeriod.value].trends.map((item) => item.adSpend),
    },
    {
      name: '广告销售额',
      type: 'line',
      smooth: true,
      data: dashboardData.value.periods[selectedPeriod.value].trends.map((item) => item.adRevenue),
    },
    {
      name: '点击',
      type: 'line',
      yAxisIndex: 1,
      smooth: true,
      data: dashboardData.value.periods[selectedPeriod.value].trends.map((item) => item.adClicks ?? 0),
    },
  ],
}))
</script>

<template>
  <div class="page reviews-page">
    <PageLoading v-if="isInitialLoading" />
    <template v-else>
    <section class="page-heading compact-heading">
      <div>
        <span class="eyebrow">Etsy Reviews API</span>
        <h1>评价看板</h1>
        <p class="review-heading-copy">
          <span>{{ reviewGoodRateSummary.text }}</span>
          <span :class="['review-change-pill', `is-${reviewGoodRateSummary.tone}`]">
            {{ reviewGoodRateSummary.value }}
          </span>
          <span class="review-comparison-detail">{{ reviewGoodRateSummary.detail }}</span>
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
        <a-button :loading="isSyncing" @click="loadReviews(true)">
          <template #icon>
            <ReloadOutlined />
          </template>
          重新同步
        </a-button>
      </div>
    </section>

    <a-alert
      v-if="syncError"
      class="sync-alert"
      type="warning"
      show-icon
      :message="syncError"
      description="页面会保留空数据；本地 Etsy API 服务恢复后刷新即可同步。"
    />

    <section class="review-status-line">
      <span>{{ reviewData.shop.shopName || 'Etsy 店铺评价' }}</span>
      <a-tooltip placement="bottomLeft">
        <template #title>
          <div>{{ reviewData.sync.message }}</div>
        </template>
        <span :class="['review-sync-pill', `is-${reviewData.sync.status}`]">评价数据 {{ syncStatusText }}</span>
      </a-tooltip>
    </section>

    <section class="filter-bar product-filter-bar">
      <a-segmented v-model:value="reviewFilter" :options="['全部评价', '有文字', '有图片', '低分评价']" />
      <span>统计范围：{{ currentPeriod.rangeLabel }} · 当前日期 {{ reviewData.currentDate || '等待同步' }}</span>
    </section>

    <section class="etsy-metric-grid review-grid">
      <article class="etsy-metric-card tone-green">
        <span>平均评分</span>
        <strong>{{ formatRating(currentPeriod.averageRating) }}</strong>
        <p>五星占比 {{ formatPercent(currentPeriod.fiveStarRate) }}</p>
      </article>
      <article class="etsy-metric-card tone-blue">
        <span>评价数量</span>
        <strong>{{ formatNumber(currentPeriod.totalReviews) }}</strong>
        <p>{{ formatNumber(currentPeriod.productCount) }} 个商品收到评价</p>
      </article>
      <article class="etsy-metric-card tone-red">
        <span>低分评价</span>
        <strong>{{ formatNumber(currentPeriod.lowRatingReviews) }}</strong>
        <p>评分 1-3 星的评价</p>
      </article>
      <article class="etsy-metric-card tone-amber">
        <span>买家晒图</span>
        <strong>{{ formatNumber(currentPeriod.photoReviews) }}</strong>
        <p>有图片评价 / 有文字 {{ formatNumber(currentPeriod.textReviews) }} 条</p>
      </article>
    </section>

    <a-card class="panel-card table-card product-section-card finance-panel-card review-panel-detail" :bordered="false">
      <template #title>最近评价明细</template>
      <template #extra>
        <a-tag color="blue">{{ formatNumber(filteredReviews.length) }} 条</a-tag>
      </template>
      <a-table
        :columns="reviewColumns"
        :data-source="filteredReviews"
        :loading="isSyncing"
        :pagination="reviewPagination"
        row-key="id"
        :scroll="{ x: 1040 }"
        size="middle"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'product'">
            <div class="product-cell">
              <img v-if="record.imageUrl" class="product-thumb" :src="record.imageUrl" :alt="record.productName" loading="lazy" />
              <div class="product-cell-copy">
                <strong>{{ record.productName }}</strong>
                <span>Listing ID: {{ record.listingId || '未知' }}</span>
              </div>
            </div>
          </template>
          <template v-if="column.key === 'rating'">
            <div class="rating-cell">
              <a-rate :value="record.rating" disabled />
              <strong>{{ formatRating(record.rating) }}</strong>
            </div>
          </template>
          <template v-if="column.key === 'review'">
            <p class="review-text">{{ record.review || '买家未留下文字。' }}</p>
          </template>
          <template v-if="column.key === 'reviewImageUrl'">
            <a v-if="record.reviewImageUrl" :href="record.reviewImageUrl" target="_blank" rel="noreferrer">
              <img class="review-image-thumb" :src="record.reviewImageUrl" alt="评价图片" loading="lazy" />
            </a>
            <span v-else class="table-note">无</span>
          </template>
        </template>
      </a-table>
    </a-card>

    <section class="etsy-two-column review-two-column">
      <a-card class="panel-card finance-panel-card review-panel-trend" :bordered="false">
        <template #title>{{ currentPeriod.label }}评分趋势</template>
        <VChart class="chart chart-lg" :option="reviewTrendOption" autoresize />
      </a-card>

      <a-card class="panel-card action-card finance-panel-card review-panel-risk" :bordered="false">
        <template #title>低分关注</template>
        <div v-if="lowRatingReviews.length" class="review-focus-list">
          <article v-for="review in lowRatingReviews" :key="review.id">
            <div class="review-focus-head">
              <a-rate :value="review.rating" disabled />
              <span>{{ review.createdDate }}</span>
            </div>
            <strong>{{ review.productName }}</strong>
            <p>{{ review.review || '买家未留下文字。' }}</p>
          </article>
        </div>
        <a-empty v-else description="当前范围内暂无低分评价" />
      </a-card>
    </section>

    <a-card class="panel-card table-card product-section-card finance-panel-card review-panel-summary" :bordered="false">
      <template #title>商品口碑汇总</template>
      <template #extra>
        <a-tag color="green">{{ currentPeriod.label }}</a-tag>
      </template>
      <a-table
        :columns="productColumns"
        :data-source="currentPeriod.topProducts"
        :loading="isSyncing"
        :pagination="productPagination"
        row-key="listingId"
        :scroll="{ x: 980 }"
        size="middle"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'product'">
            <div class="product-cell">
              <img v-if="record.imageUrl" class="product-thumb" :src="record.imageUrl" :alt="record.productName" loading="lazy" />
              <div class="product-cell-copy">
                <strong>{{ record.productName }}</strong>
                <span>Listing ID: {{ record.listingId || '未知' }}</span>
              </div>
            </div>
          </template>
          <template v-if="column.key === 'averageRating'">
            <div class="rating-cell">
              <a-rate :value="record.averageRating" allow-half disabled />
              <strong>{{ formatRating(record.averageRating) }}</strong>
            </div>
          </template>
          <template v-if="column.key === 'reviewCount'">
            {{ formatNumber(record.reviewCount) }}
          </template>
          <template v-if="column.key === 'lowRatingCount'">
            <a-tag :color="record.lowRatingCount > 0 ? 'red' : 'green'">
              {{ formatNumber(record.lowRatingCount) }}
            </a-tag>
          </template>
          <template v-if="column.key === 'photoReviewCount'">
            {{ formatNumber(record.photoReviewCount) }}
          </template>
          <template v-if="column.key === 'listingUrl'">
            <a v-if="record.listingUrl" :href="record.listingUrl" target="_blank" rel="noreferrer">打开</a>
            <span v-else class="table-note">暂无链接</span>
          </template>
        </template>
      </a-table>
    </a-card>
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
import { ReloadOutlined } from '@ant-design/icons-vue'
import { createFallbackEtsyReviews, fetchEtsyReviews } from '@/api/etsyReviews'
import PageLoading from '@/components/PageLoading.vue'
import type { ReviewPeriodKey } from '@/types/business'
import { formatNumber, formatPercent } from '@/utils/format'

use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const reviewFilter = ref('全部评价')
const reviewData = ref(createFallbackEtsyReviews())
const selectedShopScope = ref('grain-and-grace')
const selectedMonthScope = ref(monthScopeValue(reviewData.value.latestReviewDate || reviewData.value.currentDate || formatUtcDateKey(new Date())))
const selectedDataDate = ref(defaultWeekEndForScope(selectedMonthScope.value, reviewData.value.latestReviewDate || reviewData.value.currentDate || formatUtcDateKey(new Date())))
const isSyncing = ref(false)
const hasLoaded = ref(false)
const syncError = ref('')
const DAY_MS = 24 * 60 * 60 * 1000
const ALL_WEEKS_VALUE = 'all'

const selectedPeriod = computed<ReviewPeriodKey>(() => {
  if (selectedMonthScope.value === 'ytd') return 'ytd'
  if (selectedDataDate.value === ALL_WEEKS_VALUE) return 'month'
  return 'week'
})
const currentPeriod = computed(() => reviewData.value.periods[selectedPeriod.value] ?? reviewData.value.periods.week)
const isInitialLoading = computed(() => isSyncing.value && !hasLoaded.value)
const shopOptions = computed(() => buildShopOptions(reviewData.value.shop))
const monthScopeOptions = computed(() => buildMonthScopeOptions(reviewData.value.latestReviewDate || selectedDataDate.value))
const weekOptions = computed(() => buildWeekOptions(selectedMonthScope.value, reviewData.value.latestReviewDate || selectedDataDate.value))
const requestEndDate = computed(() => selectedDataDate.value === ALL_WEEKS_VALUE
  ? monthEndDateKey(selectedMonthScope.value, reviewData.value.latestReviewDate || reviewData.value.currentDate || formatUtcDateKey(new Date()))
  : selectedDataDate.value)
const reviewGoodRateSummary = computed(() => {
  const rows = reviewData.value.rows

  if (selectedMonthScope.value === 'ytd' || selectedDataDate.value === ALL_WEEKS_VALUE) {
    const end = parseUtcDateKey(requestEndDate.value)
    const start = selectedMonthScope.value === 'ytd' ? startOfUtcYear(end) : startOfUtcMonth(end)
    const rate = goodReviewRate(reviewsInDateRange(rows, start, addUtcDays(end, 1)))
    return {
      text: selectedMonthScope.value === 'ytd' ? '好评率 Year to Date' : '好评率统计月份',
      value: formatPercent(rate),
      detail: '4-5 星评价占比',
      tone: 'flat',
    }
  }

  const currentWeekStart = startOfUtcWeek(parseUtcDateKey(selectedDataDate.value))
  const currentWeekEnd = addUtcDays(currentWeekStart, 7)
  const previousWeekStart = addUtcDays(currentWeekStart, -7)
  const previousWeekEnd = currentWeekStart
  const currentRows = reviewsInDateRange(rows, currentWeekStart, currentWeekEnd)
  const previousRows = reviewsInDateRange(rows, previousWeekStart, previousWeekEnd)
  const currentRate = goodReviewRate(currentRows)
  const previousRate = goodReviewRate(previousRows)
  const change = Number((currentRate - previousRate).toFixed(1))
  const detail = `当前 ${formatPercent(currentRate)} / 上期 ${previousRows.length ? formatPercent(previousRate) : '暂无评价'}`

  if (!previousRows.length) {
    return {
      text: '好评率较上个自然周',
      value: currentRows.length ? '新增评价' : '暂无评价',
      detail,
      tone: currentRows.length ? 'up' : 'flat',
    }
  }

  return {
    text: '好评率较上个自然周',
    value: `${change > 0 ? '+' : ''}${change.toFixed(1)} 个百分点`,
    detail,
    tone: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
  }
})
const syncStatusText = computed(() => {
  if (isSyncing.value) return '同步中'
  if (reviewData.value.sync.status === 'synced') return '已接入'
  if (reviewData.value.sync.status === 'cached') return '使用缓存'
  return '等待同步'
})
const filteredReviews = computed(() => {
  const rows = currentPeriod.value.recentReviews
  if (reviewFilter.value === '有文字') return rows.filter((review) => Boolean(review.review))
  if (reviewFilter.value === '有图片') return rows.filter((review) => Boolean(review.reviewImageUrl))
  if (reviewFilter.value === '低分评价') return rows.filter((review) => review.rating <= 3)
  return rows
})
const lowRatingReviews = computed(() =>
  currentPeriod.value.recentReviews
    .filter((review) => review.rating <= 3)
    .slice(0, 6),
)

const reviewColumns = [
  { title: '商品', key: 'product', width: 340 },
  { title: '评分', key: 'rating', width: 190 },
  { title: '日期', key: 'createdDate', dataIndex: 'createdDate', width: 120 },
  { title: '评价内容', key: 'review', width: 360 },
  { title: '晒图', key: 'reviewImageUrl', width: 90 },
]

const productColumns = [
  { title: '商品', key: 'product', width: 360 },
  { title: '平均评分', key: 'averageRating', width: 190 },
  { title: '评价数', key: 'reviewCount', dataIndex: 'reviewCount', width: 100 },
  { title: '低分数', key: 'lowRatingCount', dataIndex: 'lowRatingCount', width: 100 },
  { title: '晒图数', key: 'photoReviewCount', dataIndex: 'photoReviewCount', width: 100 },
  { title: '最新评价', key: 'latestReviewDate', dataIndex: 'latestReviewDate', width: 120 },
  { title: 'Listing', key: 'listingUrl', width: 90 },
]

const reviewPagination = { pageSize: 12, showSizeChanger: false }
const productPagination = { pageSize: 10, showSizeChanger: false }

function formatRating(value: number) {
  return Number(value || 0).toFixed(2)
}

async function loadReviews(force = false) {
  isSyncing.value = true
  try {
    const data = await fetchEtsyReviews({ force, endDate: requestEndDate.value })
    reviewData.value = data
    const responseDate = data.currentDate || selectedDataDate.value || data.latestReviewDate
    if (selectedDataDate.value !== ALL_WEEKS_VALUE) {
      selectedDataDate.value = selectedMonthScope.value === 'ytd' ? responseDate : weekEndDateKey(responseDate)
    }
    syncError.value = ''
  } catch (error) {
    syncError.value = error instanceof Error ? error.message : '评价同步失败'
  } finally {
    hasLoaded.value = true
    isSyncing.value = false
  }
}

watch(selectedDataDate, (date, oldDate) => {
  if (!date || !oldDate || date === oldDate) return
  void loadReviews(false)
})

watch(selectedMonthScope, (scope, oldScope) => {
  if (!scope || scope === oldScope) return
  const nextDate = defaultWeekEndForScope(scope, reviewData.value.latestReviewDate || selectedDataDate.value)
  if (nextDate === selectedDataDate.value) {
    void loadReviews(false)
    return
  }
  selectedDataDate.value = nextDate
})

function trendTooltip(params: Array<{ dataIndex: number; marker: string; seriesName: string; value: number }>) {
  const item = currentPeriod.value.trends[params[0]?.dataIndex ?? 0]
  const lines = params.map((param) => {
    const value = param.seriesName === '平均评分' ? formatRating(Number(param.value || 0)) : formatNumber(Number(param.value || 0))
    return `${param.marker}${param.seriesName}：${value}`
  })
  return [item?.rangeLabel || item?.label || '', ...lines].join('<br/>')
}

const reviewTrendOption = computed(() => ({
  color: ['#2563eb', '#16a34a', '#dc2626'],
  tooltip: {
    trigger: 'axis',
    formatter: trendTooltip,
  },
  legend: { bottom: 0, data: ['评价数', '平均评分', '低分评价'] },
  grid: { left: 46, right: 42, top: 34, bottom: 58 },
  xAxis: {
    type: 'category',
    data: currentPeriod.value.trends.map((item) => item.label),
    axisTick: { show: false },
    axisLabel: {
      interval: currentPeriod.value.trends.length > 14 ? 4 : 0,
    },
  },
  yAxis: [
    { type: 'value', name: '评价', minInterval: 1, splitLine: { lineStyle: { color: '#eef2f7' } } },
    { type: 'value', name: '评分', min: 0, max: 5, splitLine: { show: false } },
  ],
  series: [
    {
      name: '评价数',
      type: 'bar',
      barWidth: currentPeriod.value.trends.length > 14 ? 10 : 22,
      data: currentPeriod.value.trends.map((item) => item.reviews),
    },
    {
      name: '平均评分',
      type: 'line',
      yAxisIndex: 1,
      smooth: true,
      data: currentPeriod.value.trends.map((item) => item.averageRating),
    },
    {
      name: '低分评价',
      type: 'line',
      smooth: true,
      data: currentPeriod.value.trends.map((item) => item.lowRatingReviews),
    },
  ],
}))

onMounted(() => {
  void loadReviews()
})

function parseUtcDateKey(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return new Date()
  return new Date(Date.UTC(year, month - 1, day))
}

function formatUtcDateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addUtcDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS)
}

function startOfUtcWeek(date: Date) {
  const day = date.getUTCDay() || 7
  return addUtcDays(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())), 1 - day)
}

function startOfUtcMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

function startOfUtcYear(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
}

function reviewsInDateRange(rows: Array<{ createdDate: string; rating: number }>, start: Date, end: Date) {
  const startKey = formatUtcDateKey(start)
  const endKey = formatUtcDateKey(end)

  return rows.filter((review) => review.createdDate >= startKey && review.createdDate < endKey)
}

function goodReviewRate(rows: Array<{ rating: number }>) {
  if (!rows.length) return 0
  const goodReviews = rows.filter((review) => Number(review.rating || 0) >= 4).length
  return Number(((goodReviews / rows.length) * 100).toFixed(1))
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
</script>

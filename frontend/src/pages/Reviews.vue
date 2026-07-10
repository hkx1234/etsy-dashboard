<template>
  <div class="page reviews-page">
    <PageLoading v-if="isInitialLoading" />
    <template v-else>
    <section class="page-heading compact-heading">
      <div>
        <span class="eyebrow">Etsy Reviews API</span>
        <h1>评价看板</h1>
        <p>同步店铺评价，按评价创建时间统计近期口碑、低分反馈和商品评价表现。</p>
      </div>
      <div class="period-controls">
        <span>评价范围</span>
        <a-select v-model:value="selectedPeriod" :options="reviewPeriodOptions" class="period-select" size="middle" />
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

    <section class="ad-source-strip">
      <div>
        <strong>{{ reviewData.shop.shopName || 'Etsy 店铺评价' }}</strong>
        <span>{{ reviewData.sync.message }}</span>
      </div>
      <a-tag :color="syncStatusColor">{{ syncStatusText }}</a-tag>
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

    <a-card class="panel-card table-card product-section-card" :bordered="false">
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
      <a-card class="panel-card" :bordered="false">
        <template #title>{{ currentPeriod.label }}评分趋势</template>
        <VChart class="chart chart-lg" :option="reviewTrendOption" autoresize />
      </a-card>

      <a-card class="panel-card action-card" :bordered="false">
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

    <a-card class="panel-card table-card product-section-card" :bordered="false">
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
import { computed, onMounted, ref } from 'vue'
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

const reviewPeriodOptions: Array<{ label: string; value: ReviewPeriodKey }> = [
  { label: '最近7天', value: 'week' },
  { label: '最近30天', value: 'month' },
  { label: '全部评价', value: 'all' },
]

const selectedPeriod = ref<ReviewPeriodKey>('month')
const reviewFilter = ref('全部评价')
const reviewData = ref(createFallbackEtsyReviews())
const isSyncing = ref(false)
const hasLoaded = ref(false)
const syncError = ref('')

const currentPeriod = computed(() => reviewData.value.periods[selectedPeriod.value])
const isInitialLoading = computed(() => isSyncing.value && !hasLoaded.value)
const syncStatusText = computed(() => {
  if (isSyncing.value) return '同步中'
  if (reviewData.value.sync.status === 'synced') return '已接入'
  if (reviewData.value.sync.status === 'cached') return '使用缓存'
  return '等待同步'
})
const syncStatusColor = computed(() => {
  if (reviewData.value.sync.status === 'synced') return 'green'
  if (reviewData.value.sync.status === 'cached') return 'gold'
  return 'warning'
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
    reviewData.value = await fetchEtsyReviews({ force })
    syncError.value = ''
  } catch (error) {
    syncError.value = error instanceof Error ? error.message : '评价同步失败'
  } finally {
    hasLoaded.value = true
    isSyncing.value = false
  }
}

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
      interval: selectedPeriod.value === 'month' ? 4 : 0,
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
      barWidth: selectedPeriod.value === 'month' ? 10 : 22,
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
</script>

<template>
  <div class="page etsy-dashboard">
    <PageLoading v-if="isInitialLoading" />
    <template v-else>
    <section class="etsy-hero">
      <div class="etsy-hero-main">
        <div class="period-toolbar">
          <span class="eyebrow">{{ currentDashboard.eyebrow }}</span>
          <div class="period-controls">
            <span>统计周期</span>
            <a-select
              v-model:value="selectedPeriod"
              :options="periodOptions"
              class="period-select"
              size="middle"
            />
            <span>截止日期</span>
            <a-select
              v-model:value="selectedDataDate"
              :options="dateOptions"
              :loading="isSyncing"
              class="date-select"
              size="middle"
            />
          </div>
        </div>
        <h1>{{ currentDashboard.title }}</h1>
        <p>{{ currentDashboard.summary }}</p>
        <div class="period-meta">
          <span>统计范围：{{ currentDashboard.rangeLabel }}</span>
          <span>{{ syncStatusText }}</span>
        </div>
      </div>
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

    <section class="fulfillment-panel-wrap">
      <a-card class="panel-card fulfillment-panel" :bordered="false">
        <template #title>当前履约状态</template>
        <template #extra>
          <span class="fulfillment-date">当前日期：{{ fulfillment.currentDate }}</span>
        </template>
        <div class="fulfillment-content">
          <div class="fulfillment-metrics compact">
            <article class="fulfillment-stat">
              <span>待发货订单</span>
              <strong>{{ formatNumber(fulfillment.pendingShipment) }}</strong>
              <p>已付款但还未发货</p>
            </article>
            <article class="fulfillment-stat" :class="{ danger: fulfillment.overdue > 0 }">
              <span>逾期风险</span>
              <strong>{{ formatNumber(fulfillment.overdue) }}</strong>
              <p>预计发货日已过</p>
            </article>
            <article class="fulfillment-stat">
              <span>已发货订单</span>
              <strong>{{ formatNumber(fulfillment.shipped) }}</strong>
              <p>来自已同步订单</p>
            </article>
          </div>
          <a-table
            class="fulfillment-table"
            :columns="fulfillmentColumns"
            :data-source="fulfillmentActionItems"
            :loading="isSyncing"
            :locale="{ emptyText: '当前没有需要处理的待发货订单' }"
            :pagination="false"
            row-key="receiptId"
            :scroll="{ x: 760 }"
            size="middle"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'receiptId'">
                #{{ record.receiptId }}
              </template>
              <template v-if="column.key === 'expectedShipDate'">
                {{ record.expectedShipDate || '未提供' }}
              </template>
              <template v-if="column.key === 'fulfillmentStatus'">
                <a-tag :color="fulfillmentStatusColor(record.fulfillmentStatus)">
                  {{ record.fulfillmentStatus }}
                </a-tag>
              </template>
              <template v-if="column.key === 'productSummary'">
                <div class="fulfillment-product">
                  <strong>{{ record.productSummary }}</strong>
                  <span>{{ formatNumber(record.itemCount) }} 件商品</span>
                </div>
              </template>
              <template v-if="column.key === 'total'">
                {{ formatMoney(record.total) }}
              </template>
            </template>
          </a-table>
        </div>
      </a-card>
    </section>

    <section class="etsy-two-column">
      <a-card class="panel-card" :bordered="false">
        <template #title>{{ currentDashboard.trendTitle }}</template>
        <VChart class="chart chart-lg" :option="weeklyTrendOption" autoresize />
      </a-card>

      <a-card class="panel-card" :bordered="false">
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
import { periodOptions } from '@/data/mockData'
import { createFallbackEtsyDashboard, fetchEtsyDashboard } from '@/api/etsyDashboard'
import PageLoading from '@/components/PageLoading.vue'
import type { PeriodKey } from '@/types/business'
import { formatMoney, formatNumber } from '@/utils/format'

use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const selectedPeriod = ref<PeriodKey>('week')
const dashboardData = ref(createFallbackEtsyDashboard())
const selectedDataDate = ref(dashboardData.value.selectedDate)
const isSyncing = ref(false)
const hasLoaded = ref(false)
const syncError = ref('')
let autoRefreshTimer: number | undefined

const currentDashboard = computed(() => dashboardData.value.periods[selectedPeriod.value])
const currentMetrics = computed(() => currentDashboard.value.metrics)
const dashboardMetricCards = computed(() => currentMetrics.value.filter((item) => item.key !== 'best'))
const currentTrends = computed(() => currentDashboard.value.trends)
const currentOrderAttribution = computed(() => currentDashboard.value.trafficSources)
const currentProducts = computed(() => dashboardData.value.products[selectedPeriod.value] ?? [])
const bestProduct = computed(() => currentProducts.value[0])
const fulfillment = computed(() => dashboardData.value.fulfillment)
const fulfillmentActionItems = computed(() => fulfillment.value.items.slice(0, 8))
const isInitialLoading = computed(() => isSyncing.value && !hasLoaded.value)
const dateOptions = computed(() =>
  dashboardData.value.availableDates.map((date) => ({
    label: date,
    value: date,
  })),
)
const syncStatusText = computed(() => {
  const sync = dashboardData.value.sync
  if (isSyncing.value) return '正在同步 Etsy API'
  if (sync.status === 'synced' || sync.status === 'cached') return `${sync.message} · 最新 ${dashboardData.value.latestDate}`
  return sync.message
})

const fulfillmentColumns = [
  { title: '订单号', key: 'receiptId', dataIndex: 'receiptId', width: 130 },
  { title: '下单时间', key: 'orderDate', dataIndex: 'orderDate', width: 120 },
  { title: '预计发货日', key: 'expectedShipDate', dataIndex: 'expectedShipDate', width: 130 },
  { title: '状态', key: 'fulfillmentStatus', dataIndex: 'fulfillmentStatus', width: 120 },
  { title: '商品', key: 'productSummary', dataIndex: 'productSummary' },
  { title: '金额', key: 'total', dataIndex: 'total', width: 110 },
]

function fulfillmentStatusColor(status: string) {
  if (status === '待发货') return 'blue'
  if (status === '已发货') return 'green'
  return 'default'
}

async function loadEtsyDashboard(endDate?: string) {
  isSyncing.value = true
  try {
    const data = await fetchEtsyDashboard(endDate)
    dashboardData.value = data
    selectedDataDate.value = data.selectedDate || data.latestDate
    syncError.value = ''
  } catch (error) {
    syncError.value = error instanceof Error ? error.message : 'Etsy API 同步失败'
  } finally {
    hasLoaded.value = true
    isSyncing.value = false
  }
}

onMounted(() => {
  void loadEtsyDashboard()
  autoRefreshTimer = window.setInterval(() => {
    void loadEtsyDashboard()
  }, 10 * 60 * 1000)
})

onUnmounted(() => {
  if (autoRefreshTimer) window.clearInterval(autoRefreshTimer)
})

watch(selectedDataDate, (date, oldDate) => {
  if (!date || !oldDate || date === oldDate) return
  void loadEtsyDashboard(date)
})

function formatTrendAxisLabel(item: { label: string; rangeLabel?: string }) {
  if (selectedPeriod.value === 'day' || !item.rangeLabel?.includes(' - ')) return item.label
  const [start, end] = item.rangeLabel.split(' - ')
  return `${start.slice(5).replace('-', '/')}-${end.slice(5).replace('-', '/')}`
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

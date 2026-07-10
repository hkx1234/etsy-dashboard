<template>
  <div class="page finance-page">
    <PageLoading v-if="isInitialLoading" />
    <template v-else>
    <section class="etsy-hero finance-hero">
      <div class="etsy-hero-main">
        <div class="period-toolbar">
          <span class="eyebrow">Etsy Payments / Ledger</span>
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
        <h1>{{ currentFinance.title }}</h1>
        <p>{{ currentFinance.summaryText }}</p>
        <div class="period-meta">
          <span>统计范围：{{ currentFinance.rangeLabel }}</span>
          <span>{{ syncStatusText }}</span>
        </div>
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

    <section class="etsy-metric-grid finance-metric-grid">
      <article v-for="item in currentFinance.metrics" :key="item.key" class="etsy-metric-card" :class="`tone-${item.tone}`">
        <span>{{ item.title }}</span>
        <strong>{{ item.value }}</strong>
        <p>{{ item.note }}</p>
      </article>
    </section>

    <section class="finance-two-column">
      <a-card class="panel-card" :bordered="false">
        <template #title>收入、费用与估算利润趋势</template>
        <VChart class="chart chart-lg" :option="financeTrendOption" autoresize />
      </a-card>

      <a-card class="panel-card" :bordered="false">
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

    <a-card class="panel-card finance-table-card" :bordered="false">
      <template #title>订单财务明细</template>
      <template #extra>
        <a-tag color="blue">{{ formatNumber(currentFinance.orderRows.length) }} 笔 payment</a-tag>
      </template>
      <a-table
        :columns="orderColumns"
        :data-source="visibleOrderRows"
        :loading="isSyncing"
        :pagination="{ pageSize: 10, showSizeChanger: false }"
        :scroll="{ x: 1040 }"
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
          <template v-else-if="column.key === 'logisticsStatus'">
            <a-tag color="default">{{ record.logisticsStatus }}</a-tag>
          </template>
          <template v-else-if="column.key === 'status'">
            <a-tag :color="paymentStatusColor(record.status)">{{ record.status || '未知' }}</a-tag>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-card class="panel-card finance-table-card" :bordered="false">
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
import { periodOptions } from '@/data/mockData'
import { createFallbackEtsyFinance, fetchEtsyFinance } from '@/api/etsyFinance'
import PageLoading from '@/components/PageLoading.vue'
import type { PeriodKey } from '@/types/business'
import { formatNumber } from '@/utils/format'

use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const selectedPeriod = ref<PeriodKey>('week')
const financeData = ref(createFallbackEtsyFinance())
const selectedDataDate = ref(financeData.value.selectedDate)
const isSyncing = ref(false)
const hasLoaded = ref(false)
const syncError = ref('')
let autoRefreshTimer: number | undefined

const currentFinance = computed(() => financeData.value.periods[selectedPeriod.value])
const isInitialLoading = computed(() => isSyncing.value && !hasLoaded.value)
const dateOptions = computed(() =>
  financeData.value.availableDates.map((date) => ({
    label: date,
    value: date,
  })),
)
const visibleOrderRows = computed(() => currentFinance.value.orderRows.slice(0, 80))
const visibleLedgerRows = computed(() => currentFinance.value.ledgerRows.slice(0, 120))
const syncStatusText = computed(() => {
  const sync = financeData.value.sync
  if (isSyncing.value) return '正在同步 Etsy 财务 API'
  if (sync.status === 'synced' || sync.status === 'cached') return `${sync.message} · 最新 ${financeData.value.latestDate}`
  return sync.message
})

const orderColumns = [
  { title: '订单号', key: 'receiptId', dataIndex: 'receiptId', width: 130 },
  { title: '时间', key: 'date', dataIndex: 'date', width: 120 },
  { title: '买家支付', key: 'amountGross', dataIndex: 'amountGross', width: 130 },
  { title: '支付费用', key: 'amountFees', dataIndex: 'amountFees', width: 120 },
  { title: 'Payment 净额', key: 'amountNet', dataIndex: 'amountNet', width: 130 },
  { title: '账户入账', key: 'ledgerGross', dataIndex: 'ledgerGross', width: 130 },
  { title: '销售税', key: 'ledgerSalesTax', dataIndex: 'ledgerSalesTax', width: 110 },
  { title: '物流费用', key: 'logisticsStatus', dataIndex: 'logisticsStatus', width: 120 },
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
    selectedDataDate.value = data.selectedDate || data.latestDate
    syncError.value = ''
  } catch (error) {
    syncError.value = error instanceof Error ? error.message : 'Etsy 财务 API 同步失败'
  } finally {
    hasLoaded.value = true
    isSyncing.value = false
  }
}

onMounted(() => {
  void loadFinance()
  autoRefreshTimer = window.setInterval(() => {
    void loadFinance()
  }, 10 * 60 * 1000)
})

onUnmounted(() => {
  if (autoRefreshTimer) window.clearInterval(autoRefreshTimer)
})

watch(selectedDataDate, (date, oldDate) => {
  if (!date || !oldDate || date === oldDate) return
  void loadFinance(date)
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
    { name: '估算利润', type: 'bar', barWidth: 18, data: currentFinance.value.trends.map((item) => item.estimatedProfitExcludingLogistics) },
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

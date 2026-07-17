<template>
  <div class="page order-status-page">
    <PageLoading v-if="isInitialLoading" />
    <template v-else>
      <section class="page-heading compact-heading">
        <div>
          <span class="eyebrow">Etsy Receipts</span>
          <h1>订单状态</h1>
          <p class="order-heading-copy">
            <template v-if="selectedMonthScope === 'ytd'">
              <span>Year to Date 共 {{ formatNumber(activeScopedOrders.length) }} 个有效订单，其中待发货 {{ formatNumber(pendingOrderCount) }} 单，已发货 {{ formatNumber(shippedOrderCount) }} 单。</span>
            </template>
            <template v-else-if="selectedDataDate === 'all'">
              <span>当前统计月份共 {{ formatNumber(activeScopedOrders.length) }} 个有效订单，其中待发货 {{ formatNumber(pendingOrderCount) }} 单，已发货 {{ formatNumber(shippedOrderCount) }} 单。</span>
            </template>
            <template v-else>
              <span>有效订单较上个自然周{{ orderComparisonSummary.direction }} {{ formatNumber(Math.abs(orderComparisonSummary.change)) }} 单</span>
              <span :class="['order-change-pill', `is-${orderComparisonSummary.tone}`]">{{ orderComparisonSummary.percentText }}</span>
              <span>当前 {{ formatNumber(orderComparisonSummary.current) }} / 上期 {{ formatNumber(orderComparisonSummary.previous) }}；其中待发货 {{ formatNumber(pendingOrderCount) }} 单，已发货 {{ formatNumber(shippedOrderCount) }} 单。</span>
            </template>
          </p>
        </div>
        <div class="period-controls order-status-controls">
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
            class="period-select"
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

      <section class="etsy-metric-grid order-status-metrics">
        <button
          v-for="item in statusCards"
          :key="item.key"
          type="button"
          class="etsy-metric-card order-status-card"
          :class="[`tone-${item.tone}`, { active: statusFilter === item.key }]"
          @click="setStatusFilter(item.key)"
        >
          <span>{{ item.title }}</span>
          <strong>{{ formatNumber(item.value) }}</strong>
          <p>{{ item.note }}</p>
        </button>
      </section>

      <a-card class="panel-card table-card order-detail-panel" :bordered="false">
        <template #title>{{ activeStatusLabel }}明细</template>
        <template #extra>
          <div class="table-extra-controls order-detail-controls">
            <a-input
              v-model:value="orderSearchKeyword"
              allow-clear
              class="order-search-input"
              placeholder="搜索订单号"
            />
            <a-segmented v-model:value="statusFilter" :options="statusOptions" />
          </div>
        </template>
        <a-table
          :columns="columns"
          :data-source="filteredOrders"
          :loading="isSyncing"
          :locale="{ emptyText: '当前筛选下没有订单' }"
          :pagination="{ pageSize: 20, showSizeChanger: false }"
          :scroll="{ x: 1250 }"
          row-key="receiptId"
          size="middle"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'receiptId'">
              #{{ record.receiptId }}
            </template>
            <template v-else-if="column.key === 'expectedShipDate'">
              {{ record.expectedShipDate || '未提供' }}
            </template>
            <template v-else-if="column.key === 'fulfillmentStatus'">
              <a-tag :color="fulfillmentStatusColor(record.fulfillmentStatus)">
                {{ record.fulfillmentStatus }}
              </a-tag>
              <a-tag v-if="record.isOverdue" color="red">逾期</a-tag>
              <a-tag v-else-if="record.isDueSoon" color="orange">近期</a-tag>
            </template>
            <template v-else-if="column.key === 'productSummary'">
              <div v-if="record.productItems?.length" class="fulfillment-product-list">
                <div
                  v-for="(item, index) in record.productItems"
                  :key="`${record.receiptId}-${item.listingId || index}`"
                  class="fulfillment-product-cell"
                >
                  <img
                    v-if="item.imageUrl"
                    class="order-product-thumb"
                    :src="item.imageUrl"
                    :alt="item.title"
                  />
                  <span v-else class="order-product-thumb order-product-thumb-empty" aria-hidden="true" />
                  <div class="fulfillment-product">
                    <strong>{{ item.title || record.productSummary }}</strong>
                    <span>{{ formatNumber(item.quantity || 1) }} 件</span>
                  </div>
                </div>
              </div>
              <div v-else class="fulfillment-product-cell">
                <span class="order-product-thumb order-product-thumb-empty" aria-hidden="true" />
                <div class="fulfillment-product">
                  <strong>{{ record.productSummary }}</strong>
                  <span>{{ formatNumber(record.itemCount) }} 件</span>
                </div>
              </div>
            </template>
            <template v-else-if="column.key === 'total'">
              {{ formatMoney(record.total) }}
            </template>
            <template v-else-if="column.key === 'logisticsUnitPrice'">
              <span v-if="record.logisticsMatched">{{ formatCnyMoney(record.logisticsUnitPrice, record.logisticsCurrency) }}/kg</span>
              <span v-else class="logistics-unmatched">未匹配</span>
            </template>
            <template v-else-if="column.key === 'logisticsTotalAmount'">
              <span v-if="record.logisticsMatched">{{ formatCnyMoney(record.logisticsTotalAmount, record.logisticsCurrency) }}</span>
              <span v-else class="logistics-unmatched">未匹配</span>
            </template>
          </template>
        </a-table>
      </a-card>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { createFallbackEtsyDashboard, fetchEtsyDashboard } from '@/api/etsyDashboard'
import PageLoading from '@/components/PageLoading.vue'
import type { EtsyDashboardResponse, FulfillmentOrder } from '@/types/business'
import { formatCnyMoney, formatMoney, formatNumber } from '@/utils/format'

type OrderStatusFilter = 'all' | 'pending' | 'shipped' | 'overdue' | 'unpaid' | 'canceled'

const route = useRoute()
const router = useRouter()
const dashboardData = ref<EtsyDashboardResponse>(createFallbackEtsyDashboard())
const initialDataDate = String(route.query.endDate || dashboardData.value.selectedDate)
const ALL_WEEKS_VALUE = 'all'
const selectedShopScope = ref('grain-and-grace')
const selectedMonthScope = ref(normalizeMonthScope(route.query.scope, initialDataDate))
const selectedDataDate = ref(selectedMonthScope.value === 'ytd'
  ? initialDataDate
  : String(route.query.endDate || '') === ALL_WEEKS_VALUE
  ? ALL_WEEKS_VALUE
  : weekEndDateKey(initialDataDate))
const statusFilter = ref<OrderStatusFilter>(normalizeStatusFilter(route.query.status))
const orderSearchKeyword = ref('')
const isSyncing = ref(false)
const hasLoaded = ref(false)
const syncError = ref('')

const statusOptions: Array<{ label: string; value: OrderStatusFilter }> = [
  { label: '全部', value: 'all' },
  { label: '待发货', value: 'pending' },
  { label: '已发货', value: 'shipped' },
  { label: '逾期风险', value: 'overdue' },
  { label: '未付款', value: 'unpaid' },
  { label: '已取消', value: 'canceled' },
]

const columns = [
  { title: '订单号', key: 'receiptId', dataIndex: 'receiptId', width: 130 },
  { title: '下单时间', key: 'orderDate', dataIndex: 'orderDate', width: 120 },
  { title: '预计发货日', key: 'expectedShipDate', dataIndex: 'expectedShipDate', width: 130 },
  { title: '状态', key: 'fulfillmentStatus', dataIndex: 'fulfillmentStatus', width: 150 },
  { title: '商品', key: 'productSummary', dataIndex: 'productSummary' },
  { title: '金额', key: 'total', dataIndex: 'total', width: 110 },
  { title: '物流单价', key: 'logisticsUnitPrice', dataIndex: 'logisticsUnitPrice', width: 120 },
  { title: '物流总金额', key: 'logisticsTotalAmount', dataIndex: 'logisticsTotalAmount', width: 130 },
]

const fulfillment = computed(() => dashboardData.value.fulfillment)
const allOrders = computed(() => fulfillment.value.orders?.length ? fulfillment.value.orders : fulfillment.value.items)
const isInitialLoading = computed(() => isSyncing.value && !hasLoaded.value)
const shopOptions = computed(() => buildShopOptions(dashboardData.value.shop))
const monthScopeOptions = computed(() => buildMonthScopeOptions(dashboardData.value.latestDate || selectedDataDate.value))
const weekOptions = computed(() => selectedMonthScope.value === 'ytd'
  ? [{ label: '年初至今', value: selectedDataDate.value }]
  : buildWeekOptions(selectedMonthScope.value, dashboardData.value.latestDate || selectedDataDate.value))
const requestEndDate = computed(() => selectedDataDate.value === ALL_WEEKS_VALUE
  ? monthEndDateKey(selectedMonthScope.value, dashboardData.value.latestDate || dashboardData.value.selectedDate)
  : selectedDataDate.value)
const scopedOrders = computed(() => {
  const endDate = selectedDataDate.value === ALL_WEEKS_VALUE
    ? requestEndDate.value
    : selectedMonthScope.value === 'ytd'
    ? dashboardData.value.latestDate || selectedDataDate.value
    : selectedDataDate.value
  const end = parseUtcDateKey(endDate)
  const start = selectedMonthScope.value === 'ytd'
    ? new Date(Date.UTC(end.getUTCFullYear(), 0, 1))
    : selectedDataDate.value === ALL_WEEKS_VALUE
    ? startOfUtcMonth(end)
    : startOfUtcWeek(end)
  const startKey = formatUtcDateKey(start)
  const endKey = formatUtcDateKey(end)

  return allOrders.value.filter((order) => order.orderDate && order.orderDate >= startKey && order.orderDate <= endKey)
})
const activeScopedOrders = computed(() => scopedOrders.value.filter((order) => !order.isCanceled))
const activeStatusLabel = computed(() => statusOptions.find((item) => item.value === statusFilter.value)?.label || '订单')
const pendingOrderCount = computed(() => activeScopedOrders.value.filter((order) => order.isPendingShipment).length)
const shippedOrderCount = computed(() => activeScopedOrders.value.filter((order) => order.isShipped).length)
const orderComparisonSummary = computed(() => {
  const selectedEnd = parseUtcDateKey(selectedDataDate.value || dashboardData.value.latestDate)
  const currentStart = startOfUtcWeek(selectedEnd)
  const currentEnd = addUtcDays(currentStart, 7)
  const previousStart = addUtcDays(currentStart, -7)
  const previousEnd = currentStart
  const current = countActiveOrdersBetween(currentStart, currentEnd)
  const previous = countActiveOrdersBetween(previousStart, previousEnd)
  const change = current - previous
  const percentChange = previous === 0
    ? current === 0
      ? 0
      : null
    : Number(((change / Math.abs(previous)) * 100).toFixed(1))

  return {
    current,
    previous,
    change,
    direction: change > 0 ? '增加' : change < 0 ? '减少' : '持平',
    percentText: percentChange === null ? '上期为 0' : `${percentChange > 0 ? '+' : ''}${percentChange.toFixed(1)}%`,
    tone: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
  }
})
const statusCards = computed<Array<{ key: OrderStatusFilter; title: string; value: number; note: string; tone: 'blue' | 'green' | 'amber' | 'red' }>>(() => [
  { key: 'all', title: '全部订单', value: activeScopedOrders.value.length, note: '不含已取消订单', tone: 'blue' },
  { key: 'pending', title: '待发货订单', value: activeScopedOrders.value.filter((order) => order.isPendingShipment).length, note: '已付款但还未发货', tone: 'amber' },
  { key: 'shipped', title: '已发货订单', value: activeScopedOrders.value.filter((order) => order.isShipped).length, note: '来自已同步订单', tone: 'green' },
  { key: 'overdue', title: '逾期风险', value: activeScopedOrders.value.filter((order) => order.isOverdue).length, note: '预计发货日已过', tone: 'red' },
])
const filteredOrders = computed(() => scopedOrders.value.filter((order) => (
  orderMatchesFilter(order, statusFilter.value) && orderMatchesSearch(order, orderSearchKeyword.value)
)))

function normalizeStatusFilter(value: unknown): OrderStatusFilter {
  const text = String(value || '')
  return ['pending', 'shipped', 'overdue', 'unpaid', 'canceled'].includes(text) ? text as OrderStatusFilter : 'all'
}

function buildShopOptions(_shop?: { shopId?: string; shopName?: string }) {
  return [
    { label: 'GrainAndGraceJewelry', value: 'grain-and-grace' },
    { label: '其他店铺', value: 'other' },
  ]
}

function orderMatchesFilter(order: FulfillmentOrder, filter: OrderStatusFilter) {
  if (filter === 'pending') return order.isPendingShipment
  if (filter === 'shipped') return order.isShipped && !order.isCanceled
  if (filter === 'overdue') return order.isOverdue
  if (filter === 'unpaid') return !order.isPaid && !order.isCanceled
  if (filter === 'canceled') return Boolean(order.isCanceled)
  return !order.isCanceled
}

function normalizeOrderSearch(value: string) {
  return value.replace(/^#/, '').replace(/\s+/g, '').trim()
}

function orderMatchesSearch(order: FulfillmentOrder, keyword: string) {
  const query = normalizeOrderSearch(keyword)
  if (!query) return true
  return String(order.receiptId || '').includes(query)
}

function countActiveOrdersBetween(start: Date, end: Date) {
  const startKey = formatUtcDateKey(start)
  const endKey = formatUtcDateKey(end)

  return allOrders.value.filter((order) => (
    !order.isCanceled &&
    order.orderDate &&
    order.orderDate >= startKey &&
    order.orderDate < endKey
  )).length
}

function setStatusFilter(filter: OrderStatusFilter) {
  statusFilter.value = filter
}

function fulfillmentStatusColor(status: string) {
  if (status === '待发货') return 'blue'
  if (status === '已发货') return 'green'
  if (status === '已取消') return 'default'
  return 'orange'
}

async function loadOrders(endDate?: string) {
  isSyncing.value = true
  try {
    const data = await fetchEtsyDashboard(endDate)
    dashboardData.value = data
    if (selectedDataDate.value !== ALL_WEEKS_VALUE) {
      selectedDataDate.value = selectedMonthScope.value === 'ytd'
        ? data.latestDate || data.selectedDate
        : weekEndDateKey(data.selectedDate || data.latestDate)
    }
    syncError.value = ''
  } catch (error) {
    syncError.value = error instanceof Error ? error.message : 'Etsy 订单状态同步失败'
  } finally {
    hasLoaded.value = true
    isSyncing.value = false
  }
}

function syncQuery() {
  router.replace({
    path: '/orders',
    query: {
      status: statusFilter.value === 'all' ? undefined : statusFilter.value,
      scope: selectedMonthScope.value,
      endDate: selectedDataDate.value,
    },
  })
}

onMounted(() => {
  void loadOrders(requestEndDate.value)
})

watch(selectedDataDate, (date, oldDate) => {
  if (!date || !oldDate || date === oldDate) return
  syncQuery()
  void loadOrders(requestEndDate.value)
})

watch(selectedMonthScope, (scope, oldScope) => {
  if (!scope || scope === oldScope) return
  const nextDate = scope === 'ytd'
    ? dashboardData.value.latestDate || selectedDataDate.value
    : defaultWeekEndForScope(scope, dashboardData.value.latestDate || selectedDataDate.value)

  if (nextDate === selectedDataDate.value) {
    syncQuery()
    void loadOrders(requestEndDate.value)
    return
  }

  selectedDataDate.value = nextDate
})

watch(statusFilter, syncQuery)

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

function startOfUtcMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

function monthScopeValue(dateKey: string) {
  const date = parseUtcDateKey(dateKey)
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${date.getUTCFullYear()}-${month}`
}

function normalizeMonthScope(value: unknown, fallbackDate: string) {
  const scope = String(value || '')
  if (scope === 'ytd') return 'ytd'
  return /^\d{4}-\d{2}$/.test(scope) ? scope : monthScopeValue(fallbackDate)
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
    return { label: monthScopeLabel(value), value }
  })

  return [{ label: 'Year to Date', value: 'ytd' }, ...monthOptions]
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

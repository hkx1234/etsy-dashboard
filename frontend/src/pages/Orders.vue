<template>
  <div class="page order-status-page">
    <PageLoading v-if="isInitialLoading" />
    <template v-else>
      <section class="page-heading compact-heading">
        <div>
          <span class="eyebrow">Etsy Receipts</span>
          <h1>订单状态</h1>
          <p>{{ summaryText }}</p>
        </div>
        <div class="period-controls order-status-controls">
          <span>截止日期</span>
          <a-select
            v-model:value="selectedDataDate"
            :options="dateOptions"
            :loading="isSyncing"
            class="date-select"
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

      <a-card class="panel-card table-card" :bordered="false">
        <template #title>{{ activeStatusLabel }}明细</template>
        <template #extra>
          <a-segmented v-model:value="statusFilter" :options="statusOptions" />
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
const selectedDataDate = ref(String(route.query.endDate || dashboardData.value.selectedDate))
const statusFilter = ref<OrderStatusFilter>(normalizeStatusFilter(route.query.status))
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
const dateOptions = computed(() =>
  dashboardData.value.availableDates.map((date) => ({
    label: date,
    value: date,
  })),
)
const activeStatusLabel = computed(() => statusOptions.find((item) => item.value === statusFilter.value)?.label || '订单')
const summaryText = computed(() =>
  `已同步 ${formatNumber(fulfillment.value.totalReceipts)} 个有效订单，其中待发货 ${formatNumber(fulfillment.value.pendingShipment)} 单，已发货 ${formatNumber(fulfillment.value.shipped)} 单。`,
)
const statusCards = computed<Array<{ key: OrderStatusFilter; title: string; value: number; note: string; tone: 'blue' | 'green' | 'amber' | 'red' }>>(() => [
  { key: 'all', title: '全部订单', value: fulfillment.value.totalReceipts, note: '不含已取消订单', tone: 'blue' },
  { key: 'pending', title: '待发货订单', value: fulfillment.value.pendingShipment, note: '已付款但还未发货', tone: 'amber' },
  { key: 'shipped', title: '已发货订单', value: fulfillment.value.shipped, note: '来自已同步订单', tone: 'green' },
  { key: 'overdue', title: '逾期风险', value: fulfillment.value.overdue, note: '预计发货日已过', tone: 'red' },
])
const filteredOrders = computed(() => allOrders.value.filter((order) => orderMatchesFilter(order, statusFilter.value)))

function normalizeStatusFilter(value: unknown): OrderStatusFilter {
  const text = String(value || '')
  return ['pending', 'shipped', 'overdue', 'unpaid', 'canceled'].includes(text) ? text as OrderStatusFilter : 'all'
}

function orderMatchesFilter(order: FulfillmentOrder, filter: OrderStatusFilter) {
  if (filter === 'pending') return order.isPendingShipment
  if (filter === 'shipped') return order.isShipped && !order.isCanceled
  if (filter === 'overdue') return order.isOverdue
  if (filter === 'unpaid') return !order.isPaid && !order.isCanceled
  if (filter === 'canceled') return Boolean(order.isCanceled)
  return !order.isCanceled
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
    selectedDataDate.value = data.selectedDate || data.latestDate
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
      endDate: selectedDataDate.value,
    },
  })
}

onMounted(() => {
  void loadOrders(selectedDataDate.value)
})

watch(selectedDataDate, (date, oldDate) => {
  if (!date || !oldDate || date === oldDate) return
  syncQuery()
  void loadOrders(date)
})

watch(statusFilter, syncQuery)
</script>

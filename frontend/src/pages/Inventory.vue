<template>
  <div class="page inventory-page">
    <PageLoading v-if="isInitialLoading" />
    <template v-else>
    <section class="page-heading compact-heading">
      <div>
        <span class="eyebrow">Inventory</span>
        <h1>库存看板</h1>
        <p>{{ dashboardData.sync.message }}</p>
      </div>
      <a-segmented v-model:value="viewMode" :options="['全部商品', '有库存', '低库存', '缺货']" />
    </section>

    <a-alert
      v-if="syncError"
      class="sync-alert"
      type="warning"
      show-icon
      :message="syncError"
      description="页面会保留备用数据；本地 Etsy API 服务恢复后刷新即可同步。"
    />

    <section class="etsy-metric-grid product-summary-grid">
      <article class="etsy-metric-card tone-blue">
        <span>在线商品</span>
        <strong>{{ formatNumber(products.length) }}</strong>
        <p>来自 Etsy active listings</p>
      </article>
      <article class="etsy-metric-card tone-amber">
        <span>总库存</span>
        <strong>{{ formatNumber(totalStock) }}</strong>
        <p>所有在线商品 quantity 汇总</p>
      </article>
      <article class="etsy-metric-card tone-red">
        <span>低库存</span>
        <strong>{{ formatNumber(lowStockProducts.length) }}</strong>
        <p>库存 1-5 的商品</p>
      </article>
    </section>

    <a-card class="panel-card table-card" :bordered="false">
      <template #title>商品库存明细</template>
      <template #extra>
        <a-tag color="blue">{{ formatNumber(filteredProducts.length) }} 个商品</a-tag>
      </template>
      <a-table
        :columns="columns"
        :data-source="filteredProducts"
        :loading="isSyncing"
        :pagination="{ pageSize: 20, showSizeChanger: false }"
        row-key="id"
        size="middle"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'tag'">
            <div class="product-cell">
              <img v-if="record.imageUrl" class="product-thumb" :src="record.imageUrl" :alt="record.productName" />
              <div class="product-cell-copy">
                <strong>{{ record.productName }}</strong>
                <span>Listing ID: {{ record.tag }}</span>
              </div>
            </div>
          </template>
          <template v-if="column.key === 'stockQuantity'">
            <strong>{{ formatNumber(record.stockQuantity) }}</strong>
          </template>
          <template v-if="column.key === 'status'">
            <a-tag v-if="record.stockQuantity === 0" color="red">缺货</a-tag>
            <a-tag v-else-if="record.stockQuantity <= 5" color="orange">低库存</a-tag>
            <a-tag v-else color="green">有库存</a-tag>
          </template>
          <template v-if="column.key === 'revenue'">
            {{ formatMoney(record.revenue) }}
          </template>
          <template v-if="column.key === 'conversion'">
            {{ formatPercent(record.views ? (record.orders / record.views) * 100 : 0) }}
          </template>
        </template>
      </a-table>
    </a-card>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { createFallbackEtsyDashboard, fetchEtsyDashboard } from '@/api/etsyDashboard'
import PageLoading from '@/components/PageLoading.vue'
import type { ProductPerformance } from '@/types/business'
import { formatMoney, formatNumber, formatPercent } from '@/utils/format'

const lowStockLimit = 5
const viewMode = ref('全部商品')
const dashboardData = ref(createFallbackEtsyDashboard())
const isSyncing = ref(false)
const hasLoaded = ref(false)
const syncError = ref('')

const products = computed(() => dashboardData.value.products.week ?? [])
const isInitialLoading = computed(() => isSyncing.value && !hasLoaded.value)
const totalStock = computed(() => products.value.reduce((sum, item) => sum + Number(item.stockQuantity || 0), 0))
const lowStockProducts = computed(() =>
  products.value.filter((item) => item.stockQuantity > 0 && item.stockQuantity <= lowStockLimit),
)
const outOfStockProducts = computed(() => products.value.filter((item) => item.stockQuantity === 0))
const filteredProducts = computed(() => {
  if (viewMode.value === '有库存') return products.value.filter((item) => item.stockQuantity > 0)
  if (viewMode.value === '低库存') return lowStockProducts.value
  if (viewMode.value === '缺货') return outOfStockProducts.value
  return products.value
})

const columns = [
  { title: '商品', key: 'tag', dataIndex: 'tag', width: 300 },
  { title: '库存', key: 'stockQuantity', dataIndex: 'stockQuantity', sorter: (a: ProductPerformance, b: ProductPerformance) => a.stockQuantity - b.stockQuantity },
  { title: '状态', key: 'status' },
  { title: '浏览量', key: 'views', dataIndex: 'views' },
  { title: '收藏', key: 'favorites', dataIndex: 'favorites' },
  { title: '订单', key: 'orders', dataIndex: 'orders' },
  { title: '收入', key: 'revenue', dataIndex: 'revenue' },
  { title: '转化率', key: 'conversion' },
]

async function loadInventoryData() {
  isSyncing.value = true
  try {
    dashboardData.value = await fetchEtsyDashboard()
    syncError.value = ''
  } catch (error) {
    dashboardData.value = createFallbackEtsyDashboard()
    syncError.value = error instanceof Error ? error.message : 'Etsy API 同步失败'
  } finally {
    hasLoaded.value = true
    isSyncing.value = false
  }
}

onMounted(() => {
  void loadInventoryData()
})
</script>

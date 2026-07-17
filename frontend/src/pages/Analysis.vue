<template>
  <div class="page products-page">
    <PageLoading v-if="isInitialLoading" />
    <template v-else>
    <section class="page-heading compact-heading">
      <div>
        <span class="eyebrow">Product Performance</span>
        <h1>产品表现</h1>
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

    <section v-if="canViewTagPerformance" class="filter-bar product-filter-bar">
      <a-segmented v-model:value="analysisMode" :options="analysisModeOptions" />
      <span>本期统计范围：{{ currentDashboard.rangeLabel }}</span>
    </section>

    <section v-if="canViewTagPerformance && analysisMode === '标签表现'" class="filter-bar product-filter-bar">
      <a-segmented v-model:value="tagViewMode" :options="['全部标签', '本期有订单', '高浏览低出单']" />
      <span>基于 Etsy listing tags 汇总，不代表全站搜索热度。</span>
    </section>

    <template v-if="analysisMode === '商品表现'">
    <section class="etsy-metric-grid product-summary-grid product-summary-grid-compact">
      <article class="etsy-metric-card product-summary-card product-orders-card tone-green">
        <span>本期出单商品</span>
        <strong>{{ formatNumber(productsWithOrdersCount) }}</strong>
        <p>本期至少有 1 单的商品数</p>
      </article>
      <article class="etsy-metric-card product-summary-card product-revenue-card tone-blue">
        <span>本期总收入</span>
        <strong>{{ formatMoney(periodProductRevenue) }}</strong>
        <p>来自商品交易明细汇总</p>
      </article>
    </section>

    <section class="etsy-two-column price-band-section">
      <a-card class="panel-card product-panel-card product-chart-card" :bordered="false">
        <template #title>出单产品收入与订单</template>
        <template #extra>
          <a-tag color="blue">按当前周期出单商品</a-tag>
        </template>
        <VChart class="chart chart-lg" :option="orderedProductOption" autoresize />
      </a-card>

      <a-card class="panel-card table-card product-panel-card price-band-table-card" :bordered="false">
        <template #title>价格带明细</template>
        <template #extra>
          <a-tag color="gold">{{ bestPriceBand.label }} 最强</a-tag>
        </template>
        <a-table
          :columns="priceBandColumns"
          :data-source="priceBandRows"
          :pagination="false"
          row-key="key"
          :scroll="{ x: 720 }"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'label'">
              <strong>{{ record.label }}</strong>
            </template>
            <template v-if="column.key === 'productCount'">
              {{ formatNumber(record.productCount) }}
            </template>
            <template v-if="column.key === 'orderCount'">
              {{ formatNumber(record.orderCount) }}
            </template>
            <template v-if="column.key === 'revenue'">
              {{ formatMoney(record.revenue) }}
            </template>
            <template v-if="column.key === 'averageOrderRevenue'">
              {{ formatMoney(record.averageOrderRevenue) }}
            </template>
            <template v-if="column.key === 'productShare'">
              {{ formatPercent(record.productShare) }}
            </template>
            <template v-if="column.key === 'averageFavorites'">
              {{ formatNumber(record.averageFavorites) }}
            </template>
          </template>
        </a-table>
        <p class="price-band-note">本期订单和收入按所选统计周期；在线商品数、商品占比和平均收藏来自当前 active listings 快照。</p>
      </a-card>
    </section>

    <a-card class="panel-card table-card product-section-card product-panel-card sales-table-card" :bordered="false">
      <template #title>销售表现</template>
      <template #extra>
        <div class="table-extra-controls">
          <a-segmented v-model:value="salesViewMode" :options="['全部产品', '本期有订单']" size="small" />
          <a-tag color="green">按所选统计周期</a-tag>
        </div>
      </template>
      <a-table
        :columns="salesColumns"
        :data-source="filteredSalesProducts"
        :loading="isSyncing"
        :pagination="productPagination"
        row-key="id"
        :scroll="{ x: 920 }"
        size="middle"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'tag'">
            <div class="product-cell">
              <img v-if="record.imageUrl" class="product-thumb" :src="record.imageUrl" :alt="record.productName" loading="lazy" />
              <div class="product-cell-copy">
                <strong>{{ record.productName }}</strong>
                <span>Listing ID: {{ record.tag }}</span>
              </div>
            </div>
          </template>
          <template v-if="column.key === 'orderCount'">
            {{ formatNumber(productOrderCount(record)) }}
          </template>
          <template v-if="column.key === 'soldQuantity'">
            {{ formatNumber(productSoldQuantity(record)) }}
          </template>
          <template v-if="column.key === 'revenue'">
            {{ formatMoney(record.revenue) }}
          </template>
          <template v-if="column.key === 'averageItemRevenue'">
            {{ formatMoney(productAverageItemRevenue(record)) }}
          </template>
          <template v-if="column.key === 'status'">
            <a-tag v-if="productSoldQuantity(record) > 0" color="green">本期有订单</a-tag>
            <a-tag v-else color="default">本期无订单</a-tag>
          </template>
          <template v-if="column.key === 'note'">
            <span class="table-note">{{ record.note }}</span>
          </template>
        </template>
      </a-table>
    </a-card>

    <a-card class="panel-card table-card product-section-card product-panel-card state-table-card" :bordered="false">
      <template #title>商品当前状态</template>
      <template #extra>
        <div class="table-extra-controls">
          <a-segmented v-model:value="stateViewMode" :options="['全部产品', '高收藏低出单']" size="small" />
        </div>
      </template>
      <a-table
        :columns="stateColumns"
        :data-source="filteredStateProducts"
        :loading="isSyncing"
        :pagination="productPagination"
        row-key="id"
        :scroll="{ x: 820 }"
        size="middle"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'tag'">
            <div class="product-cell">
              <img v-if="record.imageUrl" class="product-thumb" :src="record.imageUrl" :alt="record.productName" loading="lazy" />
              <div class="product-cell-copy">
                <strong>{{ record.productName }}</strong>
                <span>Listing ID: {{ record.tag }}</span>
              </div>
            </div>
          </template>
          <template v-if="column.key === 'stockQuantity'">
            <a-tag v-if="record.stockQuantity === 0" color="red">缺货</a-tag>
            <a-tag v-else-if="record.stockQuantity <= 5" color="orange">{{ formatNumber(record.stockQuantity) }}</a-tag>
            <span v-else>{{ formatNumber(record.stockQuantity) }}</span>
          </template>
          <template v-if="column.key === 'views'">
            {{ formatNumber(record.views) }}
          </template>
          <template v-if="column.key === 'favorites'">
            {{ formatNumber(record.favorites) }}
          </template>
          <template v-if="column.key === 'favoriteRate'">
            {{ formatPercent(record.views ? (record.favorites / record.views) * 100 : 0) }}
          </template>
          <template v-if="column.key === 'listingUrl'">
            <a v-if="record.listingUrl" :href="record.listingUrl" target="_blank" rel="noreferrer">打开</a>
            <span v-else class="table-note">暂无链接</span>
          </template>
        </template>
      </a-table>
    </a-card>

    </template>

    <template v-else-if="canViewTagPerformance">
      <section class="etsy-metric-grid product-summary-grid">
        <article class="etsy-metric-card product-summary-card tone-blue">
          <span>店铺标签数</span>
          <strong>{{ formatNumber(tagPerformance.length) }}</strong>
          <p>来自当前 active listings 的 tags</p>
        </article>
        <article class="etsy-metric-card product-summary-card tone-green">
          <span>本期有订单标签</span>
          <strong>{{ formatNumber(tagsWithOrdersCount) }}</strong>
          <p>关联商品在本期至少出过单</p>
        </article>
        <article class="etsy-metric-card product-summary-card tone-red">
          <span>高浏览低出单标签</span>
          <strong>{{ formatNumber(highViewLowOrderTagCount) }}</strong>
          <p>浏览高但本期暂无明显转化</p>
        </article>
        <article class="etsy-metric-card product-summary-card tone-amber">
          <span>本期最强标签</span>
          <strong>{{ topTag.tag || '暂无' }}</strong>
          <p>{{ formatNumber(topTag.soldQuantity) }} 件 / {{ formatMoney(topTag.revenue) }} 关联收入</p>
        </article>
      </section>

      <a-card class="panel-card product-panel-card tag-share-card" :bordered="false">
        <template #title>Top 标签关联收入占比</template>
        <template #extra>
          <a-tag color="blue">{{ currentDashboard.rangeLabel }}</a-tag>
        </template>
        <div class="tag-share-layout">
          <VChart class="chart chart-lg tag-share-chart" :option="tagRevenueShareOption" autoresize />
          <div class="tag-share-list">
            <div class="tag-share-list-head">
              <strong>Top {{ formatNumber(tagRevenueShareItems.length) }} 标签</strong>
              <span>{{ formatMoney(tagRevenueShareTotal) }} 关联收入</span>
            </div>
            <article v-for="(item, index) in tagRevenueShareItems" :key="item.tag" class="tag-share-row">
              <span class="tag-share-dot" :style="{ backgroundColor: tagShareColor(index) }"></span>
              <div>
                <strong>{{ item.tag }}</strong>
                <span>{{ formatMoney(item.revenue) }} / {{ formatPercent(item.share) }}</span>
              </div>
            </article>
          </div>
        </div>
      </a-card>

      <a-card class="panel-card table-card product-section-card product-panel-card tag-performance-table-card" :bordered="false">
        <template #title>标签表现分析</template>
        <template #extra>
          <a-tag color="blue">{{ formatNumber(filteredTagPerformance.length) }} 个标签</a-tag>
        </template>
        <a-table
          :columns="tagColumns"
          :data-source="filteredTagPerformance"
          :loading="isSyncing"
          :pagination="tagPagination"
          row-key="tag"
          :scroll="{ x: 1120 }"
          size="middle"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'tag'">
              <a-tag color="blue" class="tag-chip">{{ record.tag }}</a-tag>
            </template>
            <template v-if="column.key === 'productCount'">
              {{ formatNumber(record.productCount) }}
            </template>
            <template v-if="column.key === 'views'">
              {{ formatNumber(record.views) }}
            </template>
            <template v-if="column.key === 'favorites'">
              {{ formatNumber(record.favorites) }}
            </template>
            <template v-if="column.key === 'favoriteRate'">
              {{ formatPercent(record.favoriteRate) }}
            </template>
            <template v-if="column.key === 'orderCount'">
              {{ formatNumber(record.orderCount) }}
            </template>
            <template v-if="column.key === 'soldQuantity'">
              {{ formatNumber(record.soldQuantity) }}
            </template>
            <template v-if="column.key === 'revenue'">
              {{ formatMoney(record.revenue) }}
            </template>
            <template v-if="column.key === 'bestProduct'">
              <div class="product-cell">
                <img
                  v-if="record.bestProduct.imageUrl"
                  class="product-thumb"
                  :src="record.bestProduct.imageUrl"
                  :alt="record.bestProduct.productName"
                  loading="lazy"
                />
                <div class="product-cell-copy">
                  <strong>{{ record.bestProduct.productName }}</strong>
                  <span>{{ formatNumber(productSoldQuantity(record.bestProduct)) }} 件 / {{ formatMoney(record.bestProduct.revenue) }}</span>
                </div>
              </div>
            </template>
          </template>
        </a-table>
      </a-card>
    </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { getAuthUser } from '@/api/auth'
import { createFallbackEtsyDashboard, fetchEtsyDashboard } from '@/api/etsyDashboard'
import PageLoading from '@/components/PageLoading.vue'
import type { ProductPerformance } from '@/types/business'
import { formatMoney, formatNumber, formatPercent } from '@/utils/format'

use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const salesViewMode = ref('全部产品')
const stateViewMode = ref('全部产品')
const analysisMode = ref('商品表现')
const tagViewMode = ref('全部标签')
const canViewTagPerformance = computed(() => getAuthUser()?.role === 'operator')
const analysisModeOptions = computed(() => canViewTagPerformance.value ? ['商品表现', '标签表现'] : ['商品表现'])
const dashboardData = ref(createFallbackEtsyDashboard())
const selectedShopScope = ref('grain-and-grace')
const selectedMonthScope = ref(monthScopeValue(dashboardData.value.latestDate || dashboardData.value.selectedDate))
const selectedDataDate = ref(defaultWeekEndForScope(selectedMonthScope.value, dashboardData.value.latestDate || dashboardData.value.selectedDate))
const isSyncing = ref(false)
const hasLoaded = ref(false)
const emptyProduct: ProductPerformance = {
  id: 'empty',
  tag: '暂无数据',
  productName: '暂无数据',
  imageUrl: '',
  listingUrl: '',
  views: 0,
  favorites: 0,
  stockQuantity: 0,
  orderCount: 0,
  soldQuantity: 0,
  orders: 0,
  orderDates: [],
  orderDateSummary: '本期无订单',
  revenue: 0,
  averageItemRevenue: 0,
  isNew: false,
  tags: [],
  note: '等待 Etsy API 同步',
}

interface TagPerformance {
  tag: string
  productCount: number
  views: number
  favorites: number
  favoriteRate: number
  orderCount: number
  soldQuantity: number
  revenue: number
  bestProduct: ProductPerformance
}

interface PriceBandRow {
  key: string
  label: string
  min: number
  max: number | null
  productCount: number
  productShare: number
  orderCount: number
  soldQuantity: number
  revenue: number
  averageOrderRevenue: number
  averageFavorites: number
  favorites: number
}

interface TagRevenueShareItem {
  tag: string
  revenue: number
  share: number
}

interface OrderedProductChartRow {
  id: string
  tag: string
  productName: string
  imageUrl: string
  label: string
  orderCount: number
  revenue: number
}

const priceBandDefinitions: Array<Pick<PriceBandRow, 'key' | 'label' | 'min' | 'max'>> = [
  { key: '0-10', label: '$0-$10', min: 0, max: 10 },
  { key: '10-25', label: '$10-$25', min: 10, max: 25 },
  { key: '25-50', label: '$25-$50', min: 25, max: 50 },
  { key: '50-100', label: '$50-$100', min: 50, max: 100 },
  { key: '100+', label: '$100+', min: 100, max: null },
]

const tagShareColors = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#65a30d', '#ea580c', '#94a3b8']
const ALL_WEEKS_VALUE = 'all'

const selectedPeriod = computed(() => {
  if (selectedMonthScope.value === 'ytd') return 'ytd' as const
  if (selectedDataDate.value === ALL_WEEKS_VALUE) return 'month' as const
  return 'week' as const
})
const currentDashboard = computed(() => dashboardData.value.periods[selectedPeriod.value])
const productPerformance = computed(() => dashboardData.value.products[selectedPeriod.value] ?? [])
const shopOptions = computed(() => buildShopOptions(dashboardData.value.shop))
const monthScopeOptions = computed(() => buildMonthScopeOptions(dashboardData.value.latestDate || selectedDataDate.value))
const weekOptions = computed(() => buildWeekOptions(selectedMonthScope.value, dashboardData.value.latestDate || selectedDataDate.value))
const isInitialLoading = computed(() => isSyncing.value && !hasLoaded.value)
const requestEndDate = computed(() => selectedDataDate.value === ALL_WEEKS_VALUE
  ? monthEndDateKey(selectedMonthScope.value, dashboardData.value.latestDate || dashboardData.value.selectedDate)
  : selectedDataDate.value)

const salesColumns = [
  { title: '商品', key: 'tag', dataIndex: 'tag', width: 320 },
  { title: '本期订单数', key: 'orderCount', dataIndex: 'orderCount', width: 110 },
  { title: '本期售出件数', key: 'soldQuantity', dataIndex: 'soldQuantity', width: 120 },
  { title: '本期收入', key: 'revenue', dataIndex: 'revenue', width: 110 },
  { title: '件均收入', key: 'averageItemRevenue', width: 110 },
  { title: '状态', key: 'status', width: 120 },
  { title: '运营备注', key: 'note', width: 260 },
]

const stateColumns = [
  { title: '商品', key: 'tag', dataIndex: 'tag', width: 320 },
  { title: '当前库存', key: 'stockQuantity', dataIndex: 'stockQuantity', width: 100 },
  {
    title: '累计浏览量',
    key: 'views',
    dataIndex: 'views',
    width: 110,
    sorter: (a: ProductPerformance, b: ProductPerformance) => Number(a.views || 0) - Number(b.views || 0),
    sortDirections: ['descend', 'ascend'],
  },
  {
    title: '当前收藏数',
    key: 'favorites',
    dataIndex: 'favorites',
    width: 110,
    sorter: (a: ProductPerformance, b: ProductPerformance) => Number(a.favorites || 0) - Number(b.favorites || 0),
    sortDirections: ['descend', 'ascend'],
  },
  {
    title: '累计收藏率',
    key: 'favoriteRate',
    width: 110,
    sorter: (a: ProductPerformance, b: ProductPerformance) => {
      const rateA = a.views ? Number(a.favorites || 0) / Number(a.views || 1) : 0
      const rateB = b.views ? Number(b.favorites || 0) / Number(b.views || 1) : 0
      return rateA - rateB
    },
    sortDirections: ['descend', 'ascend'],
  },
  { title: 'Listing', key: 'listingUrl', width: 90 },
]

const tagColumns = [
  { title: '标签', key: 'tag', dataIndex: 'tag', width: 180 },
  { title: '覆盖商品', key: 'productCount', dataIndex: 'productCount', width: 100 },
  { title: '累计浏览', key: 'views', dataIndex: 'views', width: 110 },
  { title: '当前收藏', key: 'favorites', dataIndex: 'favorites', width: 110 },
  { title: '收藏率', key: 'favoriteRate', width: 100 },
  { title: '本期订单', key: 'orderCount', dataIndex: 'orderCount', width: 100 },
  { title: '售出件数', key: 'soldQuantity', dataIndex: 'soldQuantity', width: 100 },
  { title: '关联收入', key: 'revenue', dataIndex: 'revenue', width: 110 },
  { title: '标签下最佳商品', key: 'bestProduct', width: 320 },
]

const priceBandColumns = [
  { title: '价格带', key: 'label', dataIndex: 'label', width: 100 },
  { title: '在线商品', key: 'productCount', dataIndex: 'productCount', width: 90 },
  { title: '本期订单', key: 'orderCount', dataIndex: 'orderCount', width: 90 },
  { title: '本期收入', key: 'revenue', dataIndex: 'revenue', width: 100 },
  { title: '平均客单', key: 'averageOrderRevenue', width: 100 },
  { title: '商品占比', key: 'productShare', width: 90 },
  { title: '平均收藏', key: 'averageFavorites', width: 90 },
]

const productPagination = {
  pageSize: 20,
  showSizeChanger: true,
  pageSizeOptions: ['20', '50', '100'],
  showTotal: (total: number) => `共 ${formatNumber(total)} 个商品`,
}

const tagPagination = {
  pageSize: 20,
  showSizeChanger: true,
  pageSizeOptions: ['20', '50', '100'],
  showTotal: (total: number) => `共 ${formatNumber(total)} 个标签`,
}

function productOrderCount(item: ProductPerformance) {
  return Number(item.orderCount ?? item.orders ?? 0)
}

function buildShopOptions(_shop?: { shopId?: string; shopName?: string }) {
  return [
    { label: 'GrainAndGraceJewelry', value: 'grain-and-grace' },
    { label: '其他店铺', value: 'other' },
  ]
}

function productSoldQuantity(item: ProductPerformance) {
  return Number(item.soldQuantity ?? item.orders ?? 0)
}

function productAverageItemRevenue(item: ProductPerformance) {
  const soldQuantity = productSoldQuantity(item)
  return Number(item.averageItemRevenue ?? (soldQuantity > 0 ? item.revenue / soldQuantity : 0))
}

function productUnitPrice(item: ProductPerformance) {
  const currentPrice = Number(item.price || 0)
  if (currentPrice > 0) return currentPrice

  const averageItemRevenue = productAverageItemRevenue(item)
  return averageItemRevenue > 0 ? averageItemRevenue : 0
}

function createEmptyPriceBand(definition: Pick<PriceBandRow, 'key' | 'label' | 'min' | 'max'>): PriceBandRow {
  return {
    ...definition,
    productCount: 0,
    productShare: 0,
    orderCount: 0,
    soldQuantity: 0,
    revenue: 0,
    averageOrderRevenue: 0,
    averageFavorites: 0,
    favorites: 0,
  }
}

function isPriceInBand(price: number, band: Pick<PriceBandRow, 'min' | 'max'>) {
  return price >= band.min && (band.max == null || price < band.max)
}

function normalizeListingTag(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function tagShareColor(index: number) {
  return tagShareColors[index % tagShareColors.length]
}

function chartProductLabel(name: string) {
  const text = name.trim() || '未命名商品'
  return text.length > 18 ? `${text.slice(0, 18)}...` : text
}

function isBetterTagProduct(candidate: ProductPerformance, current: ProductPerformance) {
  if (!current || current.id === 'empty') return true
  return (
    candidate.revenue > current.revenue ||
    (candidate.revenue === current.revenue && productSoldQuantity(candidate) > productSoldQuantity(current)) ||
    (candidate.revenue === current.revenue && productSoldQuantity(candidate) === productSoldQuantity(current) && candidate.views > current.views)
  )
}

const filteredSalesProducts = computed(() => {
  if (salesViewMode.value === '本期有订单') return productPerformance.value.filter((item) => productSoldQuantity(item) > 0)
  return productPerformance.value
})
const filteredStateProducts = computed(() => {
  if (stateViewMode.value === '高收藏低出单') {
    return productPerformance.value.filter((item) => Number(item.favorites || 0) >= 10 && productSoldQuantity(item) <= 1)
  }
  return productPerformance.value
})
const productsWithOrdersCount = computed(() => productPerformance.value.filter((item) => productOrderCount(item) > 0).length)
const periodProductRevenue = computed(() => productPerformance.value.reduce((sum, item) => sum + Number(item.revenue || 0), 0))
const orderedProductChartRows = computed<OrderedProductChartRow[]>(() =>
  productPerformance.value
    .filter((item) => productOrderCount(item) > 0 || productSoldQuantity(item) > 0 || Number(item.revenue || 0) > 0)
    .sort(
      (a, b) =>
        Number(b.revenue || 0) - Number(a.revenue || 0) ||
        productOrderCount(b) - productOrderCount(a) ||
        productSoldQuantity(b) - productSoldQuantity(a),
    )
    .slice(0, 10)
    .map((item) => ({
      id: item.id,
      tag: item.tag,
      productName: item.productName,
      imageUrl: item.imageUrl || '',
      label: chartProductLabel(item.productName),
      orderCount: productOrderCount(item),
      revenue: Number(Number(item.revenue || 0).toFixed(2)),
    })),
)
const priceBandRows = computed<PriceBandRow[]>(() => {
  const rows = priceBandDefinitions.map(createEmptyPriceBand)
  const pricedProducts = productPerformance.value.filter((product) => productUnitPrice(product) > 0)

  for (const product of pricedProducts) {
    const price = productUnitPrice(product)
    const band = rows.find((item) => isPriceInBand(price, item))
    if (!band) continue

    band.productCount += 1
    band.orderCount += productOrderCount(product)
    band.soldQuantity += productSoldQuantity(product)
    band.revenue += Number(product.revenue || 0)
    band.favorites += Number(product.favorites || 0)
  }

  return rows.map((item) => ({
    ...item,
    productShare: pricedProducts.length ? Number(((item.productCount / pricedProducts.length) * 100).toFixed(1)) : 0,
    revenue: Number(item.revenue.toFixed(2)),
    averageOrderRevenue: item.orderCount > 0 ? Number((item.revenue / item.orderCount).toFixed(2)) : 0,
    averageFavorites: item.productCount > 0 ? Math.round(item.favorites / item.productCount) : 0,
  }))
})
const bestPriceBand = computed(() => {
  const strongest = [...priceBandRows.value].sort(
    (a, b) => b.revenue - a.revenue || b.orderCount - a.orderCount || b.productCount - a.productCount,
  )[0]

  return strongest && (strongest.revenue > 0 || strongest.productCount > 0) ? strongest : createEmptyPriceBand(priceBandDefinitions[0])
})

const tagPerformance = computed<TagPerformance[]>(() => {
  const tags = new Map<string, TagPerformance>()

  for (const product of productPerformance.value) {
    const productTags = [...new Set((product.tags ?? []).map(normalizeListingTag).filter(Boolean))]

    for (const tag of productTags) {
      const existing = tags.get(tag) || {
        tag,
        productCount: 0,
        views: 0,
        favorites: 0,
        favoriteRate: 0,
        orderCount: 0,
        soldQuantity: 0,
        revenue: 0,
        bestProduct: emptyProduct,
      }

      existing.productCount += 1
      existing.views += Number(product.views || 0)
      existing.favorites += Number(product.favorites || 0)
      existing.orderCount += productOrderCount(product)
      existing.soldQuantity += productSoldQuantity(product)
      existing.revenue += Number(product.revenue || 0)
      if (isBetterTagProduct(product, existing.bestProduct)) existing.bestProduct = product
      tags.set(tag, existing)
    }
  }

  return [...tags.values()]
    .map((item) => ({
      ...item,
      revenue: Number(item.revenue.toFixed(2)),
      favoriteRate: item.views > 0 ? Number(((item.favorites / item.views) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue || b.soldQuantity - a.soldQuantity || b.orderCount - a.orderCount || b.favorites - a.favorites || b.views - a.views)
})
const filteredTagPerformance = computed(() => {
  if (tagViewMode.value === '本期有订单') return tagPerformance.value.filter((item) => item.orderCount > 0)
  if (tagViewMode.value === '高浏览低出单') return tagPerformance.value.filter((item) => item.views >= 200 && item.orderCount === 0)
  return tagPerformance.value
})
const topTag = computed(() => tagPerformance.value[0] ?? {
  tag: '',
  productCount: 0,
  views: 0,
  favorites: 0,
  favoriteRate: 0,
  orderCount: 0,
  soldQuantity: 0,
  revenue: 0,
  bestProduct: emptyProduct,
})
const tagsWithOrdersCount = computed(() => tagPerformance.value.filter((item) => item.orderCount > 0).length)
const highViewLowOrderTagCount = computed(() => tagPerformance.value.filter((item) => item.views >= 200 && item.orderCount === 0).length)
const tagRevenueShareBase = computed(() => tagPerformance.value.filter((item) => item.revenue > 0))
const tagRevenueShareTop = computed(() => tagRevenueShareBase.value.slice(0, 8))
const tagRevenueShareTotal = computed(() => Number(tagRevenueShareTop.value.reduce((sum, item) => sum + item.revenue, 0).toFixed(2)))
const tagRevenueShareItems = computed<TagRevenueShareItem[]>(() => {
  if (tagRevenueShareTotal.value <= 0) return []

  return tagRevenueShareTop.value.map((item) => ({
    tag: item.tag,
    revenue: item.revenue,
    share: Number(((item.revenue / tagRevenueShareTotal.value) * 100).toFixed(1)),
  }))
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

async function loadProductData(endDate?: string) {
  isSyncing.value = true
  try {
    const data = await fetchEtsyDashboard(endDate)
    dashboardData.value = data
    const responseDate = data.selectedDate || selectedDataDate.value || data.latestDate
    if (selectedDataDate.value !== ALL_WEEKS_VALUE) {
      selectedDataDate.value = selectedMonthScope.value === 'ytd' ? data.latestDate || responseDate : weekEndDateKey(responseDate)
    }
  } catch {
    dashboardData.value = createFallbackEtsyDashboard()
  } finally {
    hasLoaded.value = true
    isSyncing.value = false
  }
}

onMounted(() => {
  void loadProductData(requestEndDate.value)
})

watch([analysisMode, canViewTagPerformance], ([mode, canView]) => {
  if (mode === '标签表现' && !canView) {
    analysisMode.value = '商品表现'
  }
}, { immediate: true })

watch(selectedDataDate, (date, oldDate) => {
  if (!date || !oldDate || date === oldDate) return
  void loadProductData(requestEndDate.value)
})

watch(selectedMonthScope, (scope, oldScope) => {
  if (!scope || scope === oldScope) return
  const nextDate = defaultWeekEndForScope(scope, dashboardData.value.latestDate || selectedDataDate.value)
  if (nextDate === selectedDataDate.value) {
    void loadProductData(requestEndDate.value)
    return
  }
  selectedDataDate.value = nextDate
})

const orderedProductOption = computed(() => ({
  color: ['#2563eb', '#16a34a'],
  tooltip: {
    trigger: 'axis',
    axisPointer: { type: 'shadow' },
    formatter: (params: Array<{ marker: string; seriesName: string; value: number; dataIndex: number }>) => {
      const first = params[0]
      const product = first ? orderedProductChartRows.value[first.dataIndex] : null
      const lines = params.map((param) => {
        const value = param.seriesName === '本期收入' ? formatMoney(param.value) : formatNumber(param.value)
        return `${param.marker}${param.seriesName}：${value}`
      })

      return [
        product ? `${product.productName}<br/>Listing ID: ${product.tag}` : '暂无出单商品',
        ...lines,
      ].join('<br/>')
    },
  },
  legend: { bottom: 0, data: ['本期收入', '本期订单'] },
  grid: { left: 58, right: 62, top: 64, bottom: 122 },
  xAxis: {
    type: 'category',
    data: orderedProductChartRows.value.map((item) => item.label),
    axisTick: { show: false },
    axisLabel: {
      interval: 0,
      margin: 16,
      color: '#0f172a',
      fontWeight: 700,
      formatter: (value: string, index: number) => {
        const product = orderedProductChartRows.value[index]
        return product?.imageUrl ? `{product${index}|}` : '{fallback|}'
      },
      rich: orderedProductChartRows.value.reduce<Record<string, unknown>>((styles, product, index) => {
        if (!product.imageUrl) return styles

        styles[`product${index}`] = {
          width: 42,
          height: 42,
          borderRadius: 6,
          backgroundColor: {
            image: product.imageUrl,
          },
        }

        return styles
      }, {
        fallback: {
          width: 42,
          height: 42,
          align: 'center',
          backgroundColor: '#f1f5f9',
          borderColor: '#cbd5e1',
          borderWidth: 1,
          borderRadius: 6,
        },
      }),
    },
    axisLine: { lineStyle: { color: '#94a3b8' } },
  },
  yAxis: [
    {
      type: 'value',
      name: '收入',
      axisLabel: { formatter: (value: number) => `$${Number(value).toLocaleString('en-US')}` },
      splitLine: { lineStyle: { color: '#eef2f7' } },
    },
    {
      type: 'value',
      name: '订单',
      minInterval: 1,
      max: (value: { max: number }) => Math.max(1, Math.ceil(Number(value.max || 0) * 1.35)),
      splitLine: { show: false },
    },
  ],
  series: [
    {
      name: '本期收入',
      type: 'bar',
      barMaxWidth: 34,
      z: 2,
      label: {
        show: true,
        position: 'top',
        distance: 6,
        color: '#2563eb',
        fontWeight: 700,
        fontSize: 11,
        formatter: (param: { value: number }) => formatMoney(Number(param.value || 0)),
      },
      data: orderedProductChartRows.value.map((item) => item.revenue),
    },
    {
      name: '本期订单',
      type: 'line',
      yAxisIndex: 1,
      smooth: true,
      symbolSize: 7,
      z: 5,
      zlevel: 1,
      label: {
        show: false,
      },
      lineStyle: { width: 2 },
      data: orderedProductChartRows.value.map((item) => item.orderCount),
    },
  ],
}))

const tagRevenueShareOption = computed(() => ({
  color: tagShareColors,
  tooltip: {
    trigger: 'item',
    formatter: (param: { name: string; value: number; percent: number; marker: string }) =>
      `${param.marker}${param.name}<br/>关联收入：${formatMoney(Number(param.value || 0))}<br/>占比：${Number(param.percent || 0).toFixed(1)}%`,
  },
  legend: {
    show: false,
    type: 'scroll',
    bottom: 0,
    itemWidth: 10,
    itemHeight: 10,
    textStyle: { color: '#334155', fontSize: 12 },
  },
  series: [
    {
      name: '标签关联收入',
      type: 'pie',
      radius: ['46%', '70%'],
      center: ['50%', '45%'],
      avoidLabelOverlap: true,
      padAngle: 2,
      minAngle: 6,
      itemStyle: {
        borderColor: '#ffffff',
        borderWidth: 3,
      },
      label: {
        show: true,
        color: '#334155',
        formatter: (param: { name: string; percent: number }) => `${param.name}\n${Number(param.percent || 0).toFixed(1)}%`,
      },
      labelLine: {
        length: 16,
        length2: 10,
      },
      emphasis: {
        scaleSize: 6,
        label: {
          fontWeight: 700,
        },
      },
      data:
        tagRevenueShareItems.value.length > 0
          ? tagRevenueShareItems.value.map((item) => ({
              name: item.tag,
              value: item.revenue,
            }))
          : [{ name: '暂无本期关联收入', value: 1, itemStyle: { color: '#cbd5e1' }, label: { color: '#64748b' } }],
    },
  ],
}))

</script>

<template>
  <div class="page products-page">
    <PageLoading v-if="isInitialLoading" />
    <template v-else>
    <section class="page-heading compact-heading">
      <div>
        <span class="eyebrow">Product Performance</span>
        <h1>产品表现</h1>
        <p>把本期销售表现和商品当前状态分开展示，避免本期数据和累计数据混在一起。</p>
      </div>
      <div class="period-controls">
        <span>统计周期</span>
        <a-select v-model:value="selectedPeriod" :options="periodOptions" class="period-select" size="middle" />
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

    <section class="filter-bar product-filter-bar">
      <a-segmented v-model:value="analysisMode" :options="['商品表现', '标签表现']" />
      <span>本期统计范围：{{ currentDashboard.rangeLabel }}</span>
    </section>

    <section v-if="analysisMode === '商品表现'" class="filter-bar product-filter-bar">
      <a-segmented v-model:value="salesViewMode" :options="['全部产品', '本期有订单']" />
      <span>销售字段按当前周期统计；商品当前状态可在对应模块内筛选。</span>
    </section>

    <section v-else class="filter-bar product-filter-bar">
      <a-segmented v-model:value="tagViewMode" :options="['全部标签', '本期有订单', '高浏览低出单']" />
      <span>基于 Etsy listing tags 汇总，不代表全站搜索热度。</span>
    </section>

    <template v-if="analysisMode === '商品表现'">
    <section class="etsy-metric-grid product-summary-grid">
      <article class="etsy-metric-card product-summary-card tone-green">
        <span>本期售出最多</span>
        <div class="summary-product">
          <img v-if="mostSold.imageUrl" class="summary-product-image" :src="mostSold.imageUrl" :alt="mostSold.productName" loading="lazy" />
          <div class="summary-product-copy">
            <strong>{{ mostSold.productName }}</strong>
            <small>Listing ID: {{ mostSold.tag }}</small>
          </div>
        </div>
        <p>{{ formatNumber(productSoldQuantity(mostSold)) }} 件 / {{ formatNumber(productOrderCount(mostSold)) }} 单</p>
      </article>
      <article class="etsy-metric-card product-summary-card tone-blue">
        <span>本期收入最高</span>
        <div class="summary-product">
          <img v-if="highestRevenue.imageUrl" class="summary-product-image" :src="highestRevenue.imageUrl" :alt="highestRevenue.productName" loading="lazy" />
          <div class="summary-product-copy">
            <strong>{{ highestRevenue.productName }}</strong>
            <small>Listing ID: {{ highestRevenue.tag }}</small>
          </div>
        </div>
        <p>{{ formatMoney(highestRevenue.revenue) }} 收入</p>
      </article>
      <article class="etsy-metric-card product-summary-card tone-amber">
        <span>本期出单商品</span>
        <strong>{{ formatNumber(productsWithOrdersCount) }}</strong>
        <p>本期至少有 1 单的商品数</p>
      </article>
      <article class="etsy-metric-card product-summary-card tone-red">
        <span>本期总收入</span>
        <strong>{{ formatMoney(periodProductRevenue) }}</strong>
        <p>来自商品交易明细汇总</p>
      </article>
    </section>

    <section class="etsy-two-column price-band-section">
      <a-card class="panel-card" :bordered="false">
        <template #title>价格带收入与订单</template>
        <template #extra>
          <a-tag color="blue">按当前商品价格带归类</a-tag>
        </template>
        <VChart class="chart chart-lg" :option="priceBandOption" autoresize />
      </a-card>

      <a-card class="panel-card table-card price-band-table-card" :bordered="false">
        <template #title>价格带明细</template>
        <template #extra>
          <a-tag color="green">{{ bestPriceBand.label }} 最强</a-tag>
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

    <a-card class="panel-card table-card product-section-card" :bordered="false">
      <template #title>本期销售表现</template>
      <template #extra>
        <a-tag color="green">按所选统计周期</a-tag>
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

    <a-card class="panel-card table-card product-section-card" :bordered="false">
      <template #title>商品当前状态</template>
      <template #extra>
        <div class="table-extra-controls">
          <a-segmented v-model:value="stateViewMode" :options="['全部产品', '高收藏低出单']" size="small" />
          <a-tag color="blue">当前快照 / 累计字段</a-tag>
        </div>
      </template>
      <a-table
        :columns="stateColumns"
        :data-source="filteredStateProducts"
        :loading="isSyncing"
        :pagination="productPagination"
        row-key="id"
        :scroll="{ x: 1040 }"
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
          <template v-if="column.key === 'currentNote'">
            <span class="table-note">{{ currentStateNote(record) }}</span>
          </template>
        </template>
      </a-table>
    </a-card>

    <section class="etsy-two-column">
      <a-card class="panel-card" :bordered="false">
        <template #title>本期订单与收入排行</template>
        <VChart class="chart chart-lg" :option="salesRankOption" autoresize />
      </a-card>

      <a-card class="panel-card action-card" :bordered="false">
        <template #title>口径说明</template>
        <div class="action-list">
          <article>
            <strong>本期销售表现</strong>
            <p>订单、售出件数和收入都按上方统计周期筛选。</p>
          </article>
          <article>
            <strong>商品当前状态</strong>
            <p>库存、累计浏览量和当前收藏数来自 Etsy active listings 当前快照。</p>
          </article>
          <article>
            <strong>转化率暂不显示</strong>
            <p>等每日商品快照积累后，再用本期新增浏览计算真实本期转化率。</p>
          </article>
        </div>
      </a-card>
    </section>
    </template>

    <template v-else>
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

      <a-card class="panel-card tag-share-card" :bordered="false">
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

      <a-card class="panel-card table-card product-section-card" :bordered="false">
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
import { periodOptions } from '@/data/mockData'
import { createFallbackEtsyDashboard, fetchEtsyDashboard } from '@/api/etsyDashboard'
import PageLoading from '@/components/PageLoading.vue'
import type { PeriodKey, ProductPerformance } from '@/types/business'
import { formatMoney, formatNumber, formatPercent } from '@/utils/format'

use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const salesViewMode = ref('全部产品')
const stateViewMode = ref('全部产品')
const analysisMode = ref('商品表现')
const tagViewMode = ref('全部标签')
const selectedPeriod = ref<PeriodKey>('week')
const dashboardData = ref(createFallbackEtsyDashboard())
const selectedDataDate = ref(dashboardData.value.selectedDate)
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

const priceBandDefinitions: Array<Pick<PriceBandRow, 'key' | 'label' | 'min' | 'max'>> = [
  { key: '0-10', label: '$0-$10', min: 0, max: 10 },
  { key: '10-25', label: '$10-$25', min: 10, max: 25 },
  { key: '25-50', label: '$25-$50', min: 25, max: 50 },
  { key: '50-100', label: '$50-$100', min: 50, max: 100 },
  { key: '100+', label: '$100+', min: 100, max: null },
]

const tagShareColors = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#65a30d', '#ea580c', '#94a3b8']

const currentDashboard = computed(() => dashboardData.value.periods[selectedPeriod.value])
const productPerformance = computed(() => dashboardData.value.products[selectedPeriod.value] ?? [])
const dateOptions = computed(() =>
  dashboardData.value.availableDates.map((date) => ({
    label: date,
    value: date,
  })),
)
const isInitialLoading = computed(() => isSyncing.value && !hasLoaded.value)

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
  { title: '当前备注', key: 'currentNote', width: 220 },
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

function currentStateNote(item: ProductPerformance) {
  if (item.stockQuantity === 0) return '当前缺货'
  if (item.stockQuantity <= 5) return '当前低库存'
  return `累计浏览 ${formatNumber(item.views)} / 当前收藏 ${formatNumber(item.favorites)}`
}

function normalizeListingTag(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function tagShareColor(index: number) {
  return tagShareColors[index % tagShareColors.length]
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
const mostSold = computed(
  () => [...productPerformance.value].sort((a, b) => productSoldQuantity(b) - productSoldQuantity(a) || b.revenue - a.revenue)[0] ?? emptyProduct,
)
const highestRevenue = computed(() => [...productPerformance.value].sort((a, b) => b.revenue - a.revenue)[0] ?? emptyProduct)
const productsWithOrdersCount = computed(() => productPerformance.value.filter((item) => productOrderCount(item) > 0).length)
const periodProductRevenue = computed(() => productPerformance.value.reduce((sum, item) => sum + Number(item.revenue || 0), 0))
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
const salesRankProducts = computed(() =>
  [...productPerformance.value]
    .sort((a, b) => b.revenue - a.revenue || productSoldQuantity(b) - productSoldQuantity(a))
    .slice(0, 12),
)
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

async function loadProductData(endDate?: string) {
  isSyncing.value = true
  try {
    const data = await fetchEtsyDashboard(endDate)
    dashboardData.value = data
    selectedDataDate.value = data.selectedDate || data.latestDate
  } catch {
    dashboardData.value = createFallbackEtsyDashboard()
  } finally {
    hasLoaded.value = true
    isSyncing.value = false
  }
}

onMounted(() => {
  void loadProductData()
})

watch(selectedDataDate, (date, oldDate) => {
  if (!date || !oldDate || date === oldDate) return
  void loadProductData(date)
})

const priceBandOption = computed(() => ({
  color: ['#2563eb', '#16a34a'],
  tooltip: {
    trigger: 'axis',
    axisPointer: { type: 'shadow' },
    formatter: (params: Array<{ marker: string; seriesName: string; value: number }>) =>
      params
        .map((param) => {
          const value = param.seriesName === '本期收入' ? formatMoney(param.value) : formatNumber(param.value)
          return `${param.marker}${param.seriesName}：${value}`
        })
        .join('<br/>'),
  },
  legend: { bottom: 0, data: ['本期收入', '本期订单'] },
  grid: { left: 58, right: 54, top: 52, bottom: 88 },
  xAxis: {
    type: 'category',
    data: priceBandRows.value.map((item) => item.label),
    axisTick: { show: false },
    axisLabel: {
      interval: 0,
      margin: 14,
      color: '#0f172a',
      fontWeight: 700,
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
      splitLine: { show: false },
    },
  ],
  series: [
    {
      name: '本期收入',
      type: 'bar',
      barMaxWidth: 34,
      label: {
        show: true,
        position: 'top',
        color: '#2563eb',
        fontWeight: 700,
        formatter: (param: { value: number }) => formatMoney(Number(param.value || 0)),
      },
      data: priceBandRows.value.map((item) => item.revenue),
    },
    {
      name: '本期订单',
      type: 'line',
      yAxisIndex: 1,
      smooth: true,
      symbolSize: 8,
      label: {
        show: true,
        color: '#16a34a',
        fontWeight: 700,
        formatter: (param: { value: number }) => formatNumber(Number(param.value || 0)),
      },
      data: priceBandRows.value.map((item) => item.orderCount),
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

const salesRankOption = computed(() => ({
  color: ['#2563eb', '#16a34a'],
  tooltip: {
    trigger: 'axis',
    axisPointer: { type: 'shadow' },
    formatter: (params: Array<{ marker: string; seriesName: string; value: number }>) =>
      params
        .map((param) => {
          const value = param.seriesName === '本期收入' ? formatMoney(param.value) : formatNumber(param.value)
          return `${param.marker}${param.seriesName}：${value}`
        })
        .join('<br/>'),
  },
  legend: { bottom: 0, data: ['售出件数', '本期收入'] },
  grid: { left: 42, right: 48, top: 36, bottom: 92 },
  xAxis: {
    type: 'category',
    data: salesRankProducts.value.map((item) => item.tag),
    axisTick: { show: false },
    axisLabel: { rotate: 35, width: 90, overflow: 'truncate' },
  },
  yAxis: [
    { type: 'value', name: '件数', splitLine: { lineStyle: { color: '#eef2f7' } } },
    { type: 'value', name: '收入', splitLine: { show: false } },
  ],
  series: [
    { name: '售出件数', type: 'bar', data: salesRankProducts.value.map((item) => productSoldQuantity(item)) },
    { name: '本期收入', type: 'bar', yAxisIndex: 1, data: salesRankProducts.value.map((item) => item.revenue) },
  ],
}))

</script>

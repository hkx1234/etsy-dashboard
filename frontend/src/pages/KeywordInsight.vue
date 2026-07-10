<template>
  <div class="page traffic-page">
    <PageLoading v-if="isInitialLoading" />
    <template v-else>
    <section class="page-heading compact-heading">
      <div>
        <span class="eyebrow">Etsy Ads CSV</span>
        <h1>广告与流量</h1>
        <p>读取广告报表文件夹里的最新 CSV，当前口径为 Etsy 站内广告流量。</p>
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

    <a-alert
      v-if="syncError"
      class="sync-alert"
      type="warning"
      show-icon
      :message="syncError"
      description="页面会保留备用展示数据；本地 Etsy API 服务恢复后刷新即可同步。"
    />

    <section class="ad-source-strip">
      <div>
        <strong>{{ dashboardData.ads.sourceFile || '等待广告报表' }}</strong>
        <span>{{ dashboardData.ads.message }}</span>
      </div>
      <a-tag :color="adStatusColor">{{ adStatusText }}</a-tag>
    </section>

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

    <section class="ad-source-strip market-source-strip">
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
    </section>

    <section class="etsy-metric-grid market-keyword-grid">
      <article class="etsy-metric-card tone-blue">
        <span>样本关键词</span>
        <strong>{{ formatNumber(marketData.keywords.length) }}</strong>
        <p>来自公开 marketplace 搜索结果标题和标签</p>
      </article>
      <article class="etsy-metric-card tone-amber">
        <span>最高结果数词</span>
        <strong>{{ topMarketSeed.keyword || '暂无' }}</strong>
        <p>{{ formatNumber(topMarketSeed.resultCount) }} 个 Etsy 搜索结果</p>
      </article>
      <article class="etsy-metric-card tone-red">
        <span>最高热度词</span>
        <strong>{{ topMarketKeyword.keyword || '暂无' }}</strong>
        <p>样本热度分 {{ formatNumber(topMarketKeyword.score) }}</p>
      </article>
    </section>

    <section class="etsy-two-column market-keyword-section">
      <a-card class="panel-card table-card" :bordered="false">
        <template #title>公开市场关键词排行</template>
        <a-alert
          v-if="marketError"
          class="sync-alert compact-alert"
          type="warning"
          show-icon
          :message="marketError"
        />
        <a-table
          :columns="marketKeywordColumns"
          :data-source="topMarketKeywords"
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
      </a-card>

      <a-card class="panel-card" :bordered="false">
        <template #title>高结果数种子词</template>
        <div class="seed-report-list">
          <article v-for="seed in topMarketSeeds" :key="seed.keyword">
            <div class="seed-report-head">
              <strong>{{ seed.keyword }}</strong>
              <a :href="seed.searchUrl" target="_blank" rel="noreferrer">Etsy 搜索</a>
            </div>
            <p>{{ formatNumber(seed.resultCount) }} 个结果 / 样本均价 {{ formatMoney(seed.avgPrice) }}</p>
            <div class="seed-tag-list">
              <a-tag v-for="tag in seed.topTags.slice(0, 4)" :key="`${seed.keyword}-${tag.tag}`">
                {{ tag.tag }}
              </a-tag>
            </div>
          </article>
        </div>
      </a-card>
    </section>

    <section class="etsy-two-column">
      <a-card class="panel-card" :bordered="false">
        <template #title>{{ currentTrendTitle }}</template>
        <VChart class="chart chart-lg" :option="adTrendOption" autoresize />
      </a-card>

      <a-card class="panel-card action-card" :bordered="false">
        <template #title>同步规则</template>
        <div class="action-list">
          <article>
            <strong>每天 12 点自动识别</strong>
            <p>新 CSV 下载到广告报表文件夹后，刷新看板会读取修改时间最新的表。</p>
          </article>
          <article>
            <strong>当前只算站内广告</strong>
            <p>CSV 来自 Etsy Ads 后台，因此这里的广告曝光、点击、花费和销售额都是站内广告口径。</p>
          </article>
          <article>
            <strong>原始文件不改动</strong>
            <p>本地 API 只读取 CSV，并保存一份解析缓存用于网络或磁盘临时异常时兜底。</p>
          </article>
        </div>
      </a-card>
    </section>

    <a-card class="panel-card table-card" :bordered="false">
      <template #title>广告日报明细</template>
      <template #extra>
        <a-tag color="blue">{{ dashboardData.ads.sourceDir }}</a-tag>
      </template>
      <a-table
        :columns="columns"
        :data-source="adRows"
        :loading="isSyncing"
        :pagination="false"
        row-key="date"
        size="middle"
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
import { periodOptions } from '@/data/mockData'
import { createFallbackEtsyDashboard, fetchEtsyDashboard } from '@/api/etsyDashboard'
import { createFallbackMarketKeywords, fetchMarketKeywords } from '@/api/etsyMarketKeywords'
import PageLoading from '@/components/PageLoading.vue'
import type { MarketKeywordEntry, MarketKeywordScope, MarketSeedReport, PeriodKey } from '@/types/business'
import { formatMoney, formatNumber, formatPercent } from '@/utils/format'

use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const selectedPeriod = ref<PeriodKey>('week')
const marketScope = ref<MarketKeywordScope>('category')
const dashboardData = ref(createFallbackEtsyDashboard())
const marketData = ref(createFallbackMarketKeywords(marketScope.value))
const selectedDataDate = ref(dashboardData.value.selectedDate)
const isSyncing = ref(false)
const isMarketSyncing = ref(false)
const hasLoadedAdDashboard = ref(false)
const hasLoadedMarketKeywords = ref(false)
const syncError = ref('')
const marketError = ref('')

const currentAd = computed(() => dashboardData.value.ads.periods[selectedPeriod.value])
const isInitialLoading = computed(() =>
  (isSyncing.value && !hasLoadedAdDashboard.value) ||
  (isMarketSyncing.value && !hasLoadedMarketKeywords.value),
)
const currentTrendTitle = computed(() => dashboardData.value.periods[selectedPeriod.value].trendTitle.replace('每日趋势', '广告每日趋势').replace('周期对比', '广告周期对比'))
const dateOptions = computed(() =>
  dashboardData.value.availableDates.map((date) => ({
    label: date,
    value: date,
  })),
)
const adRows = computed(() => [...dashboardData.value.ads.rows].sort((a, b) => b.date.localeCompare(a.date)))
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
const adStatusColor = computed(() => {
  if (dashboardData.value.ads.status === 'synced') return 'green'
  if (dashboardData.value.ads.status === 'cached') return 'gold'
  return 'warning'
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
const topMarketKeyword = computed<MarketKeywordEntry>(() => marketData.value.keywords[0] ?? {
  keyword: '',
  score: 0,
  listingCount: 0,
  tagUses: 0,
  titleUses: 0,
  sourceSeedCount: 0,
  sourceSeeds: [],
  sampleTitles: [],
  searchUrl: '',
})
const topMarketSeed = computed<MarketSeedReport>(() => marketData.value.seedReports[0] ?? {
  keyword: '',
  resultCount: 0,
  sampleSize: 0,
  avgPrice: 0,
  minPrice: 0,
  maxPrice: 0,
  searchUrl: '',
  topTags: [],
})
const topMarketKeywords = computed(() => marketData.value.keywords.slice(0, 30))
const topMarketSeeds = computed(() => marketData.value.seedReports.slice(0, 8))

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
    selectedDataDate.value = data.selectedDate || data.latestDate
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
  void loadAdDashboard()
  void loadMarketKeywords()
})

watch(selectedDataDate, (date, oldDate) => {
  if (!date || !oldDate || date === oldDate) return
  void loadAdDashboard(date)
})

watch(marketScope, (scope) => {
  marketData.value = createFallbackMarketKeywords(scope)
  marketError.value = ''
  void loadMarketKeywords()
})

function formatTrendAxisLabel(item: { label: string; rangeLabel?: string }) {
  if (selectedPeriod.value === 'day' || !item.rangeLabel?.includes(' - ')) return item.label
  const [start, end] = item.rangeLabel.split(' - ')
  return `${start.slice(5).replace('-', '/')}-${end.slice(5).replace('-', '/')}`
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

import { periodDashboardData, productPerformance } from '@/data/mockData'
import type { AdPeriodSummary, EtsyDashboardResponse, PeriodKey } from '@/types/business'
import { authFetch, parseJsonResponse } from './auth'

const periodKeys: PeriodKey[] = ['day', 'week', 'month']
const emptyAdPeriod: AdPeriodSummary = {
  rows: 0,
  views: 0,
  clicks: 0,
  orders: 0,
  revenue: 0,
  spend: 0,
  roas: 0,
  clickRate: 0,
  cpc: 0,
  acos: 0,
  endingBudget: 0,
}

function localDateKey() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function createFallbackEtsyDashboard(): EtsyDashboardResponse {
  const today = localDateKey()

  return {
    ok: false,
    generatedAt: '',
    sourceDir: 'Etsy Open API v3',
    availableDates: [today],
    selectedDate: today,
    latestDate: today,
    files: [],
    periods: periodDashboardData,
    products: periodKeys.reduce(
      (result, key) => ({
        ...result,
        [key]: productPerformance,
      }),
      {} as EtsyDashboardResponse['products'],
    ),
    fulfillment: {
      currentDate: '2026-06-30',
      totalReceipts: 0,
      paid: 0,
      pendingShipment: 0,
      dueSoon: 0,
      overdue: 0,
      shipped: 0,
      items: [],
    },
    ads: {
      status: 'missing',
      message: '等待广告报表同步',
      sourceDir: '/Volumes/汇总/广告报表',
      sourceFile: '',
      sourcePath: '',
      updatedAt: '',
      latestDate: '',
      rows: [],
      periods: periodKeys.reduce(
        (result, key) => ({
          ...result,
          [key]: emptyAdPeriod,
        }),
        {} as EtsyDashboardResponse['ads']['periods'],
      ),
    },
    sync: {
      status: 'error',
      fileCount: 0,
      latestFile: '',
      message: '暂时使用前端备用数据，等待 Etsy API 同步',
    },
  }
}

async function fetchDashboardJson(url: URL, fallbackMessage: string): Promise<EtsyDashboardResponse> {
  const response = await authFetch(url, { cache: 'no-store' })
  const data = await parseJsonResponse<EtsyDashboardResponse>(response, fallbackMessage)

  if (!response.ok || !data.ok) {
    throw new Error(data.sync?.message || (data as unknown as { message?: string }).message || fallbackMessage)
  }

  return data
}

export async function fetchEtsyDashboard(endDate?: string): Promise<EtsyDashboardResponse> {
  const etsyApiUrl = new URL('/etsy-api/dashboard-data', window.location.origin)
  if (endDate) etsyApiUrl.searchParams.set('endDate', endDate)

  return fetchDashboardJson(etsyApiUrl, 'Etsy API 同步失败')
}

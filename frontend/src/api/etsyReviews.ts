import type { EtsyReviewResponse } from '@/types/business'
import { authFetch, parseJsonResponse } from './auth'

export function createFallbackEtsyReviews(): EtsyReviewResponse {
  return {
    ok: false,
    generatedAt: '',
    sourceDir: 'Etsy Open API v3',
    shop: {
      shopId: '',
      shopName: '',
    },
    currentDate: '',
    latestReviewDate: '',
    totalAvailableReviews: 0,
    rows: [],
    products: [],
    periods: {
      week: createEmptyReviewPeriod('week', '自然周', '自然周评价概览'),
      month: createEmptyReviewPeriod('month', '统计月份', '统计月份评价概览'),
      ytd: createEmptyReviewPeriod('ytd', 'Year to Date', 'Year to Date 评价概览'),
      all: createEmptyReviewPeriod('all', '全部评价', '全部评价概览'),
    },
    files: [],
    sync: {
      status: 'error',
      fileCount: 0,
      latestFile: '',
      message: '暂时没有评价数据，等待 Etsy Reviews API 同步',
    },
  }
}

function createEmptyReviewPeriod(key: 'week' | 'month' | 'ytd' | 'all', label: string, title: string) {
  return {
    key,
    label,
    title,
    rangeLabel: '暂无评价',
    totalReviews: 0,
    averageRating: 0,
    lowRatingReviews: 0,
    photoReviews: 0,
    textReviews: 0,
    fiveStarRate: 0,
    productCount: 0,
    ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    trends: [],
    recentReviews: [],
    topProducts: [],
    lowRatingProducts: [],
  }
}

export async function fetchEtsyReviews(options: { force?: boolean; endDate?: string } = {}): Promise<EtsyReviewResponse> {
  const etsyApiUrl = new URL('/etsy-api/review-data', window.location.origin)
  if (options.force) etsyApiUrl.searchParams.set('force', '1')
  if (options.endDate) etsyApiUrl.searchParams.set('endDate', options.endDate)

  const response = await authFetch(etsyApiUrl, { cache: 'no-store' })
  const data = await parseJsonResponse<EtsyReviewResponse>(response, 'Etsy 评价同步失败')

  if (!response.ok || !data.ok) {
    throw new Error(data.sync?.message || (data as unknown as { message?: string }).message || 'Etsy 评价同步失败')
  }

  return data
}

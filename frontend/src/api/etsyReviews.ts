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
      week: createEmptyReviewPeriod('week', '最近7天', '最近7天评价概览'),
      month: createEmptyReviewPeriod('month', '最近30天', '最近30天评价概览'),
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

function createEmptyReviewPeriod(key: 'week' | 'month' | 'all', label: string, title: string) {
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

export async function fetchEtsyReviews(options: { force?: boolean } = {}): Promise<EtsyReviewResponse> {
  const etsyApiUrl = new URL('/etsy-api/review-data', window.location.origin)
  if (options.force) etsyApiUrl.searchParams.set('force', '1')

  const response = await authFetch(etsyApiUrl, { cache: 'no-store' })
  const data = await parseJsonResponse<EtsyReviewResponse>(response, 'Etsy 评价同步失败')

  if (!response.ok || !data.ok) {
    throw new Error(data.sync?.message || (data as unknown as { message?: string }).message || 'Etsy 评价同步失败')
  }

  return data
}

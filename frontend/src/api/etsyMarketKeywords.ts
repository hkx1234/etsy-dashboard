import type { MarketKeywordResponse, MarketKeywordScope } from '@/types/business'
import { authFetch, parseJsonResponse } from './auth'

export function createFallbackMarketKeywords(scope: MarketKeywordScope = 'category'): MarketKeywordResponse {
  return {
    ok: false,
    generatedAt: '',
    status: 'cached',
    scope,
    scopeLabel: scope === 'platform' ? '全平台关键词' : '当前品类关键词',
    source: 'Etsy Open API marketplace listings search',
    sourceNote: '等待 Etsy 市场关键词样本同步。',
    seedCount: 0,
    sampledSeedCount: 0,
    sampleListingCount: 0,
    keywords: [],
    seedReports: [],
    errors: [],
    sync: {
      status: 'error',
      fileCount: 0,
      latestFile: '',
      message: '等待 Etsy 市场关键词样本同步',
    },
  }
}

export async function fetchMarketKeywords(options: { force?: boolean; scope?: MarketKeywordScope } = {}): Promise<MarketKeywordResponse> {
  const etsyApiUrl = new URL('/etsy-api/market-keywords', window.location.origin)
  if (options.force) etsyApiUrl.searchParams.set('force', '1')
  if (options.scope) etsyApiUrl.searchParams.set('scope', options.scope)

  const response = await authFetch(etsyApiUrl, { cache: 'no-store' })
  const data = await parseJsonResponse<MarketKeywordResponse>(response, 'Etsy 市场关键词同步失败')

  if (!response.ok || !data.ok) {
    throw new Error(data.sync?.message || (data as unknown as { message?: string }).message || 'Etsy 市场关键词同步失败')
  }

  return data
}

import type { EtsyFinanceResponse, PeriodKey } from '@/types/business'
import { authFetch, parseJsonResponse } from './auth'

const periodKeys: PeriodKey[] = ['day', 'week', 'month']

function localDateKey() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function emptyPeriod(key: PeriodKey): EtsyFinanceResponse['periods'][PeriodKey] {
  const label = key === 'day' ? '按日' : key === 'week' ? '最近7天' : '最近30天'
  return {
    key,
    label,
    title: `${label}财务总览`,
    rangeLabel: '',
    summaryText: '等待 Etsy 财务 API 同步。',
    currency: 'USD',
    metrics: [],
    summary: {
      orderGross: 0,
      paymentFees: 0,
      listingFees: 0,
      etsyFees: 0,
      taxes: 0,
      ledgerAdSpend: 0,
      adSpend: 0,
      logisticsCost: 0,
      logisticsOrders: 0,
      logisticsCurrency: 'CNY',
      disbursements: 0,
      other: 0,
      ledgerNetChangeExcludingDisbursement: 0,
      estimatedProfitExcludingLogistics: 0,
      orders: 0,
      ledgerRows: 0,
      currency: 'USD',
    },
    trends: [],
    orderRows: [],
    logisticsRows: [],
    ledgerRows: [],
    feeBreakdown: [],
  }
}

export function createFallbackEtsyFinance(): EtsyFinanceResponse {
  const today = localDateKey()

  return {
    ok: false,
    generatedAt: '',
    sourceDir: 'Etsy Payments / Ledger',
    shop: {
      shopId: '',
    },
    availableDates: [today],
    selectedDate: today,
    latestDate: today,
    files: [],
    periods: periodKeys.reduce(
      (result, key) => ({
        ...result,
        [key]: emptyPeriod(key),
      }),
      {} as EtsyFinanceResponse['periods'],
    ),
    sync: {
      status: 'error',
      fileCount: 0,
      latestFile: '',
      message: '暂时等待 Etsy 财务 API 同步',
    },
  }
}

export async function fetchEtsyFinance(endDate?: string): Promise<EtsyFinanceResponse> {
  const etsyApiUrl = new URL('/etsy-api/finance-data', window.location.origin)
  if (endDate) etsyApiUrl.searchParams.set('endDate', endDate)

  const response = await authFetch(etsyApiUrl, { cache: 'no-store' })
  const data = await parseJsonResponse<EtsyFinanceResponse>(response, 'Etsy 财务 API 同步失败')

  if (!response.ok || !data.ok) {
    throw new Error(data.sync?.message || (data as unknown as { message?: string }).message || 'Etsy 财务 API 同步失败')
  }

  return data
}

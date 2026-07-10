export type PeriodKey = 'day' | 'week' | 'month'

export interface WeeklyMetric {
  key: string
  title: string
  value: string
  note: string
  tone: 'blue' | 'green' | 'amber' | 'red'
}

export interface WeeklyTrendItem {
  label: string
  rangeLabel?: string
  listings: number
  orders: number
  revenue: number
  adSpend: number
  adRevenue: number
  adViews?: number
  adClicks?: number
  adOrders?: number
  roas?: number
  clickRate?: number
  favorites: number
  conversations: number
}

export interface DashboardPeriodData {
  key: PeriodKey
  label: string
  eyebrow: string
  title: string
  rangeLabel: string
  summary: string
  bestProductLabel: string
  bestProduct: string
  bestProductNote: string
  trendTitle: string
  sourceTitle: string
  actionTitle: string
  metrics: WeeklyMetric[]
  trends: WeeklyTrendItem[]
  trafficSources: TrafficSource[]
}

export interface DashboardSyncInfo {
  status: 'synced' | 'cached' | 'error'
  fileCount: number
  latestFile: string
  message: string
}

export interface DashboardSourceFile {
  date: string
  name: string
  path: string
}

export type ReviewPeriodKey = 'week' | 'month' | 'all'

export interface ReviewRatingDistribution {
  1: number
  2: number
  3: number
  4: number
  5: number
}

export interface ReviewTrendItem {
  label: string
  rangeLabel: string
  reviews: number
  averageRating: number
  lowRatingReviews: number
}

export interface ReviewRow {
  id: string
  shopId: string
  listingId: string
  transactionId: string
  productName: string
  imageUrl: string
  listingUrl: string
  rating: number
  review: string
  language: string
  reviewImageUrl: string
  createdDate: string
  createdTimestamp: number
  updatedDate: string
}

export interface ReviewProductSummary {
  listingId: string
  productName: string
  imageUrl: string
  listingUrl: string
  reviewCount: number
  averageRating: number
  lowRatingCount: number
  photoReviewCount: number
  textReviewCount: number
  latestReviewDate: string
  latestReview: string
  ratingDistribution: ReviewRatingDistribution
}

export interface ReviewPeriodData {
  key: ReviewPeriodKey
  label: string
  title: string
  rangeLabel: string
  totalReviews: number
  averageRating: number
  lowRatingReviews: number
  photoReviews: number
  textReviews: number
  fiveStarRate: number
  productCount: number
  ratingDistribution: ReviewRatingDistribution
  trends: ReviewTrendItem[]
  recentReviews: ReviewRow[]
  topProducts: ReviewProductSummary[]
  lowRatingProducts: ReviewProductSummary[]
}

export interface EtsyReviewResponse {
  ok: boolean
  generatedAt: string
  sourceDir: string
  shop: {
    shopId: string
    shopName: string
  }
  currentDate: string
  latestReviewDate: string
  totalAvailableReviews: number
  rows: ReviewRow[]
  products: ReviewProductSummary[]
  periods: Record<ReviewPeriodKey, ReviewPeriodData>
  files: DashboardSourceFile[]
  sync: DashboardSyncInfo
}

export interface EtsyDashboardResponse {
  ok: boolean
  generatedAt: string
  sourceDir: string
  availableDates: string[]
  selectedDate: string
  latestDate: string
  files: DashboardSourceFile[]
  periods: Record<PeriodKey, DashboardPeriodData>
  products: Record<PeriodKey, ProductPerformance[]>
  fulfillment: FulfillmentStatus
  ads: AdReportData
  sync: DashboardSyncInfo
}

export interface FinanceMetric {
  key: string
  title: string
  value: string
  note: string
  tone: 'blue' | 'green' | 'amber' | 'red'
}

export interface FinanceSummary {
  orderGross: number
  paymentFees: number
  listingFees: number
  etsyFees: number
  taxes: number
  ledgerAdSpend: number
  adSpend: number
  disbursements: number
  other: number
  ledgerNetChangeExcludingDisbursement: number
  estimatedProfitExcludingLogistics: number
  orders: number
  ledgerRows: number
  currency: string
}

export interface FinanceTrendItem {
  label: string
  rangeLabel: string
  orderGross: number
  etsyFees: number
  taxes: number
  adSpend: number
  estimatedProfitExcludingLogistics: number
  orders: number
}

export interface FinanceOrderRow {
  paymentId: string
  receiptId: string
  date: string
  status: string
  buyerCurrency: string
  shopCurrency: string
  amountGross: number
  amountFees: number
  amountNet: number
  amountGrossText: string
  amountFeesText: string
  amountNetText: string
  ledgerGross: number
  ledgerProcessingFees: number
  ledgerSalesTax: number
  ledgerNetEstimate: number
  logisticsCost: number | null
  logisticsStatus: string
}

export interface FinanceLedgerRow {
  entryId: string
  ledgerId: string
  date: string
  type: string
  typeLabel: string
  category: string
  amount: number
  amountText: string
  currency: string
  balance: number
  balanceText: string
  description: string
  referenceType: string
  referenceId: string
  parentEntryId: string
}

export interface FinanceBreakdownItem {
  key: string
  name: string
  amount: number
}

export interface FinancePeriodData {
  key: PeriodKey
  label: string
  title: string
  rangeLabel: string
  summaryText: string
  currency: string
  metrics: FinanceMetric[]
  summary: FinanceSummary
  trends: FinanceTrendItem[]
  orderRows: FinanceOrderRow[]
  ledgerRows: FinanceLedgerRow[]
  feeBreakdown: FinanceBreakdownItem[]
}

export interface EtsyFinanceResponse {
  ok: boolean
  generatedAt: string
  sourceDir: string
  shop: {
    shopId: string
  }
  availableDates: string[]
  selectedDate: string
  latestDate: string
  files: DashboardSourceFile[]
  periods: Record<PeriodKey, FinancePeriodData>
  sync: DashboardSyncInfo
}

export interface FulfillmentOrder {
  receiptId: string
  orderDate: string
  expectedShipDate: string
  status: string
  fulfillmentStatus: '未付款' | '待发货' | '已发货' | '已取消'
  isPaid: boolean
  isShipped: boolean
  isCanceled?: boolean
  isPendingShipment: boolean
  isOverdue: boolean
  isDueSoon: boolean
  daysUntilDue: number | null
  productSummary: string
  itemCount: number
  total: number
}

export interface FulfillmentStatus {
  currentDate: string
  totalReceipts: number
  paid: number
  pendingShipment: number
  dueSoon: number
  overdue: number
  shipped: number
  items: FulfillmentOrder[]
}

export interface AdReportRow {
  date: string
  views: number
  clicks: number
  orders: number
  revenue: number
  spend: number
  roas: number
  clickRate: number
  endingBudget: number
}

export interface AdPeriodSummary {
  rows: number
  views: number
  clicks: number
  orders: number
  revenue: number
  spend: number
  roas: number
  clickRate: number
  cpc: number
  acos: number
  endingBudget: number
}

export interface AdReportData {
  status: 'synced' | 'cached' | 'missing' | 'error'
  message: string
  sourceDir: string
  sourceFile: string
  sourcePath: string
  updatedAt: string
  latestDate: string
  rows: AdReportRow[]
  periods: Record<PeriodKey, AdPeriodSummary>
}

export interface MarketKeywordEntry {
  keyword: string
  score: number
  listingCount: number
  tagUses: number
  titleUses: number
  sourceSeedCount: number
  sourceSeeds: string[]
  sampleTitles: string[]
  searchUrl: string
}

export interface MarketSeedReport {
  keyword: string
  resultCount: number
  sampleSize: number
  avgPrice: number
  minPrice: number
  maxPrice: number
  searchUrl: string
  topTags: Array<{
    tag: string
    count: number
  }>
}

export type MarketKeywordScope = 'category' | 'platform'

export interface MarketKeywordResponse {
  ok: boolean
  generatedAt: string
  status: 'synced' | 'partial' | 'cached'
  scope: MarketKeywordScope
  scopeLabel: string
  source: string
  sourceNote: string
  seedCount: number
  sampledSeedCount: number
  sampleListingCount: number
  keywords: MarketKeywordEntry[]
  seedReports: MarketSeedReport[]
  errors: Array<{
    keyword: string
    message: string
  }>
  sync: DashboardSyncInfo
}

export interface ProductPerformance {
  id: string
  tag: string
  productName: string
  imageUrl: string
  listingUrl: string
  tags?: string[]
  price?: number
  currencyCode?: string
  views: number
  favorites: number
  stockQuantity: number
  orderCount?: number
  soldQuantity?: number
  orders: number
  orderDates?: Array<{
    date: string
    quantity: number
  }>
  orderDateSummary?: string
  revenue: number
  averageItemRevenue?: number
  isNew: boolean
  note: string
}

export interface TrafficSource {
  name: string
  type: '非广告或未归因' | '广告订单' | '自然流量' | '广告流量'
  visits: number
  orders: number
  revenue: number
}

export interface AdMetric {
  title: string
  value: string
  note: string
  tone: 'blue' | 'green' | 'amber' | 'red'
}

export interface ImportRequirement {
  name: string
  fields: string
  source: string
  status: '建议每周导入' | '后续自动同步' | '可手动录入'
}

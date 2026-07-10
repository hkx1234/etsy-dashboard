export const USER_ROLES = [
  'super_admin',
  'owner',
  'admin',
  'operator',
  'finance',
  'sales',
  'ecommerce',
  'customer_service',
  'logistics',
  'viewer',
] as const

export type UserRole = typeof USER_ROLES[number]

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  super_admin: '超级管理员',
  owner: '老板',
  admin: '管理员',
  operator: '运营',
  finance: '财务',
  sales: '销售',
  ecommerce: '电商',
  customer_service: '客服',
  logistics: '物流',
  viewer: '只读',
}

export const USER_ROLE_OPTIONS = USER_ROLES.map((role) => ({
  label: USER_ROLE_LABELS[role],
  value: role,
}))

export const FINANCE_ROLES: UserRole[] = ['owner', 'admin', 'finance']
export const REVIEW_ROLES: UserRole[] = ['owner', 'admin', 'operator', 'sales']
export const PUBLIC_REGISTERABLE_ROLES: UserRole[] = ['operator', 'sales', 'ecommerce', 'customer_service', 'logistics']

export interface AuthUser {
  id: string
  username?: string
  email: string
  name: string
  role: UserRole
  createdAt: string
}

interface AuthResponse {
  ok: boolean
  message?: string
  token: string
  user: AuthUser
}

interface MeResponse {
  ok: boolean
  user: AuthUser
}

interface ApiErrorPayload {
  ok?: boolean
  message?: string
  detail?: string
  sync?: {
    message?: string
  }
}

const TOKEN_KEY = 'etsy-dashboard-auth-token'
const USER_KEY = 'etsy-dashboard-auth-user'
const DEFAULT_LOCAL_API_ORIGIN = 'http://localhost:3001'

function storagePair() {
  return [window.localStorage, window.sessionStorage]
}

function activeUserStorage() {
  return window.localStorage.getItem(TOKEN_KEY) ? window.localStorage : window.sessionStorage
}

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  return Boolean(value && typeof value === 'object')
}

export function isUserRole(role: unknown): role is UserRole {
  return USER_ROLES.includes(role as UserRole)
}

export function normalizeUserRole(role: unknown): UserRole {
  const value = String(role || '').trim().toLowerCase()
  if (value === 'root' || value === 'superadmin') return 'super_admin'
  if (value === 'inventory') return 'customer_service'
  if (value === 'warehouse' || value === 'logistic') return 'logistics'
  if (value === 'sales_customer_service') return 'customer_service'
  if (value === 'e_commerce' || value === 'e-commerce' || value === 'ecom' || value === 'dian_shang' || value === 'dianshang' || value === '电商' || value === '电子商务') return 'ecommerce'
  return isUserRole(value) ? value : 'viewer'
}

export function getAuthToken() {
  return window.localStorage.getItem(TOKEN_KEY) || window.sessionStorage.getItem(TOKEN_KEY) || ''
}

export function getAuthUser(): AuthUser | null {
  const raw = window.localStorage.getItem(USER_KEY) || window.sessionStorage.getItem(USER_KEY)
  if (!raw) return null

  try {
    const user = JSON.parse(raw) as AuthUser
    return user ? { ...user, role: normalizeUserRole(user.role) } : null
  } catch {
    return null
  }
}

export function setAuthSession(data: AuthResponse, remember: boolean) {
  clearAuthSession()
  const storage = remember ? window.localStorage : window.sessionStorage
  storage.setItem(TOKEN_KEY, data.token)
  storage.setItem(USER_KEY, JSON.stringify(data.user))
}

export function clearAuthSession() {
  storagePair().forEach((storage) => {
    storage.removeItem(TOKEN_KEY)
    storage.removeItem(USER_KEY)
  })
}

export async function refreshAuthUser() {
  const response = await authFetch('/auth/me', { cache: 'no-store' })
  const data = await parseJsonResponse<MeResponse>(response, '登录状态刷新失败')
  const user = { ...data.user, role: normalizeUserRole(data.user.role) }
  activeUserStorage().setItem(USER_KEY, JSON.stringify(user))
  return user
}

export function roleLabel(role?: UserRole | null) {
  if (role && isUserRole(role)) return USER_ROLE_LABELS[role]
  return role ? USER_ROLE_LABELS.viewer : '未登录'
}

export function roleTagColor(role?: UserRole | null) {
  const normalizedRole = role ? normalizeUserRole(role) : null
  if (normalizedRole === 'super_admin') return 'red'
  if (normalizedRole === 'owner') return 'gold'
  if (normalizedRole === 'admin') return 'purple'
  if (normalizedRole === 'finance') return 'green'
  if (normalizedRole === 'sales') return 'blue'
  if (normalizedRole === 'ecommerce') return 'geekblue'
  if (normalizedRole === 'customer_service') return 'cyan'
  if (normalizedRole === 'logistics') return 'orange'
  if (normalizedRole === 'viewer') return 'default'
  return 'blue'
}

export function canManageUsers(user?: AuthUser | null) {
  return user?.role === 'super_admin' || user?.role === 'admin'
}

export function canViewFinance(user?: AuthUser | null) {
  return Boolean(user?.role && FINANCE_ROLES.includes(user.role))
}

export function canViewReviews(user?: AuthUser | null) {
  return Boolean(user?.role && REVIEW_ROLES.includes(user.role))
}

export function isRoleWorkspacePending(user?: AuthUser | null) {
  return user?.role === 'sales' || user?.role === 'ecommerce' || user?.role === 'customer_service' || user?.role === 'logistics'
}

interface RegisterOptionsResponse {
  ok: boolean
  roles: UserRole[]
}

interface UiSettingsResponse {
  ok: boolean
  rolePageUpdates: Record<string, boolean>
}

export function authHeaders() {
  const token = getAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function configuredApiOrigin() {
  return String(import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '')
}

function shouldUseSameOriginApi() {
  return ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname)
}

function backendApiPath(pathname: string) {
  return pathname.replace(/^\/etsy-api(?=\/|$)/, '/etsy')
}

function apiUrl(input: string | URL) {
  const source = input instanceof URL ? input : new URL(input, window.location.origin)
  const path = `${source.pathname}${source.search}${source.hash}`
  const apiOrigin = configuredApiOrigin()

  if (apiOrigin) return new URL(backendApiPath(path), apiOrigin)
  if (shouldUseSameOriginApi()) return new URL(path, window.location.origin)
  return new URL(backendApiPath(path), DEFAULT_LOCAL_API_ORIGIN)
}

function isApiPath(pathname: string) {
  return pathname === '/auth'
    || pathname.startsWith('/auth/')
    || pathname === '/etsy-api'
    || pathname.startsWith('/etsy-api/')
}

function resolveApiInput(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input === 'string') {
    const url = new URL(input, window.location.origin)
    return isApiPath(url.pathname) ? apiUrl(url) : input
  }

  if (input instanceof URL) {
    return isApiPath(input.pathname) ? apiUrl(input) : input
  }

  return input
}

export function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json')
  }
  Object.entries(authHeaders()).forEach(([key, value]) => {
    headers.set(key, value)
  })

  return fetch(resolveApiInput(input), {
    ...init,
    headers,
  })
}

export async function parseJsonResponse<T>(response: Response, fallbackMessage = '请求失败'): Promise<T> {
  const text = await response.text()
  const contentType = response.headers.get('content-type') || ''
  const responseUrl = response.url || '未知接口'
  const responseLabel = `${response.status} ${response.statusText || ''}`.trim()
  let data: unknown = {}

  if (text.trim()) {
    try {
      data = JSON.parse(text) as unknown
    } catch {
      const preview = text.trim().replace(/\s+/g, ' ').slice(0, 120)
      const isHtml =
        contentType.includes('text/html') ||
        /^<!doctype html/i.test(preview) ||
        /^<html/i.test(preview)

      if (isHtml) {
        throw new Error(`接口返回了 HTML 页面，不是 JSON。请求：${responseUrl}；状态：${responseLabel}；类型：${contentType || '未知'}。请确认打开的是 http://localhost:3000，并且后端 http://localhost:3001 正在运行。`)
      }

      throw new Error(`${fallbackMessage}：接口返回内容不是 JSON。请求：${responseUrl}；状态：${responseLabel}${preview ? `；内容：${preview}` : ''}`)
    }
  }

  if (!response.ok || (isApiErrorPayload(data) && data.ok === false)) {
    if (response.status === 401) clearAuthSession()
    const payload = isApiErrorPayload(data) ? data : {}
    throw new Error(payload.sync?.message || payload.message || payload.detail || `${fallbackMessage}（${responseLabel}）`)
  }

  return data as T
}

async function parseAuthResponse(response: Response): Promise<AuthResponse> {
  return parseJsonResponse<AuthResponse>(response, '账号请求失败')
}

export async function loginWithEmail(payload: { email: string; password: string; remember: boolean }) {
  const response = await authFetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return parseAuthResponse(response)
}

export async function fetchRegisterOptions() {
  const response = await authFetch('/auth/register-options', { cache: 'no-store' })
  const data = await parseJsonResponse<RegisterOptionsResponse>(response, '注册岗位读取失败')
  return data.roles.map(normalizeUserRole).filter((role): role is UserRole => PUBLIC_REGISTERABLE_ROLES.includes(role))
}

export async function fetchUiSettings() {
  const response = await authFetch('/auth/ui-settings', { cache: 'no-store' })
  return parseJsonResponse<UiSettingsResponse>(response, '页面状态读取失败')
}

export async function registerWithEmail(payload: {
  email: string
  name: string
  password: string
  role: UserRole
  inviteCode?: string
  remember: boolean
}) {
  const response = await authFetch('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return parseAuthResponse(response)
}

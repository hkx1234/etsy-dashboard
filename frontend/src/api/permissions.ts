import { authFetch, parseJsonResponse, type AuthUser, type UserRole } from './auth'

interface UsersResponse {
  ok: boolean
  users: AuthUser[]
}

interface UpdateRoleResponse {
  ok: boolean
  user: AuthUser
}

interface CreateUserResponse {
  ok: boolean
  user: AuthUser
}

interface DeleteUserResponse {
  ok: boolean
}

export interface AuthSystemSettings {
  registerableRoles: UserRole[]
  rolePageUpdates: Record<string, boolean>
}

export interface UserFeedback {
  id: string
  userId: string
  username: string
  role: UserRole
  pageKey: string
  rating: number
  content: string
  createdAt: string
  resolvedAt?: string
}

interface SettingsResponse {
  ok: boolean
  settings: AuthSystemSettings
  publicRegisterableRoles: UserRole[]
}

interface FeedbackResponse {
  ok: boolean
  feedback: UserFeedback[]
}

interface CreateFeedbackResponse {
  ok: boolean
  feedback: UserFeedback
}

export interface CreateAuthUserPayload {
  username: string
  name: string
  email?: string
  password: string
  role: UserRole
}

export interface SubmitFeedbackPayload {
  pageKey: string
  rating: number
  content: string
}

export async function fetchAuthUsers() {
  const response = await authFetch('/auth/users', { cache: 'no-store' })
  const data = await parseJsonResponse<UsersResponse>(response, '用户列表读取失败')
  return data.users
}

export async function createAuthUser(payload: CreateAuthUserPayload) {
  const response = await authFetch('/auth/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await parseJsonResponse<CreateUserResponse>(response, '用户创建失败')
  return data.user
}

export async function updateAuthUserRole(userId: string, role: UserRole) {
  const response = await authFetch(`/auth/users/${userId}/role`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  })
  const data = await parseJsonResponse<UpdateRoleResponse>(response, '用户权限更新失败')
  return data.user
}

export async function deleteAuthUser(userId: string) {
  const response = await authFetch(`/auth/users/${userId}`, {
    method: 'DELETE',
  })
  await parseJsonResponse<DeleteUserResponse>(response, '用户删除失败')
}

export async function fetchAuthSettings() {
  const response = await authFetch('/auth/settings', { cache: 'no-store' })
  return parseJsonResponse<SettingsResponse>(response, '权限设置读取失败')
}

export async function updateAuthSettings(payload: Partial<AuthSystemSettings>) {
  const response = await authFetch('/auth/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return parseJsonResponse<SettingsResponse>(response, '权限设置保存失败')
}

export async function fetchUserFeedback() {
  const response = await authFetch('/auth/feedback', { cache: 'no-store' })
  const data = await parseJsonResponse<FeedbackResponse>(response, '内部意见读取失败')
  return data.feedback
}

export async function submitUserFeedback(payload: SubmitFeedbackPayload) {
  const response = await authFetch('/auth/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await parseJsonResponse<CreateFeedbackResponse>(response, '意见提交失败')
  return data.feedback
}

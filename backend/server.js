// The deployed .env is bind-mounted into /app. Prefer it over stale values
// captured when an older container was created so configuration fixes take
// effect on a normal restart without replacing the persistent-data container.
require('dotenv').config({ override: true })

const crypto = require('crypto')
const fs = require('fs/promises')
const path = require('path')
const express = require('express')
const mysql = require('mysql2/promise')
const { ProxyAgent } = require('undici')

const app = express()

// Keep the dashboard backend separate from the legacy service on port 8000.
// BACKEND_PORT remains available for an intentional deployment override.
const PORT = Number(process.env.BACKEND_PORT || 3001)
const ETSY_AUTH_URL = 'https://www.etsy.com/oauth/connect'
const ETSY_TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token'
const ETSY_API_BASE = 'https://api.etsy.com/v3/application'
const SCOPES = ['shops_r', 'listings_r', 'transactions_r', 'feedback_r']
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_AD_REPORT_DIR = '/Volumes/汇总/广告报表'
const RUNTIME_DATA_DIR = path.resolve(process.env.RUNTIME_DATA_DIR || path.join(__dirname, 'data'))
const DASHBOARD_TIME_ZONE = process.env.DASHBOARD_TIME_ZONE || 'Asia/Shanghai'
const DASHBOARD_CACHE_TTL_MS = Number(process.env.DASHBOARD_CACHE_TTL_MS || 5 * 60 * 1000)
const USD_CNY_RATE_TTL_MS = Number(process.env.USD_CNY_RATE_TTL_MS || 6 * 60 * 60 * 1000)
const FALLBACK_USD_CNY_RATE = Number(process.env.USD_CNY_RATE || 7.2)
const DEFAULT_LOGISTICS_FEES_API_URL = 'https://kaixue.app.n8n.cloud/webhook/logistics-fees/latest'
const ETSY_PROXY_URL = String(process.env.ETSY_PROXY_URL || '').trim()
const etsyProxyDispatcher = ETSY_PROXY_URL ? new ProxyAgent(ETSY_PROXY_URL) : null
const AUTH_CONFIG_FILE = 'auth-config.json'
const AUTH_USERS_FILE = 'auth-users.json'
const AUTH_TOKEN_TTL_MS = 12 * 60 * 60 * 1000
const AUTH_REMEMBER_TOKEN_TTL_MS = 30 * DAY_MS
const PASSWORD_ALGORITHM = 'pbkdf2_sha256'
const PASSWORD_ITERATIONS = 260000
const USER_ROLES = ['super_admin', 'owner', 'admin', 'operator', 'finance', 'sales', 'ecommerce', 'customer_service', 'logistics', 'viewer']
const PUBLIC_REGISTERABLE_ROLES = ['operator', 'sales', 'ecommerce', 'customer_service', 'logistics']
const DEFAULT_REGISTERABLE_ROLES = ['sales', 'ecommerce', 'customer_service', 'logistics']
const USER_MANAGEMENT_ROLES = new Set(['super_admin', 'admin'])
const FINANCE_ROLES = new Set(['owner', 'admin', 'finance'])
const REVIEW_ROLES = new Set(['owner', 'admin', 'operator', 'sales'])
const HUALEI_DEFAULT_API_BASE = 'http://www.sz56t.com:8082'
const HUALEI_DEFAULT_LABEL_BASE = 'http://www.sz56t.com:8089'

const pendingOAuth = new Map()
const dashboardCache = new Map()
const dashboardBuilds = new Map()
const reviewCache = new Map()
const reviewBuilds = new Map()
const marketKeywordCache = new Map()
const marketKeywordBuilds = new Map()
const financeCache = new Map()
const financeBuilds = new Map()
let usdCnyRateCache = null
let authPool = null
let authDbReady = null
let etsyTokenRefresh = null

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  next()
})

app.use(express.json({ limit: '1mb' }))

function env() {
  return {
    keystring: process.env.ETSY_KEYSTRING,
    sharedSecret: process.env.ETSY_SHARED_SECRET,
    redirectUri: process.env.ETSY_REDIRECT_URI,
  }
}

function assertEnv() {
  const missing = Object.entries(env())
    .filter(([, value]) => !value || value.startsWith('replace_with_') || value.startsWith('https://your-temp-domain'))
    .map(([key]) => key)

  if (missing.length > 0) {
    const error = new Error(`缺少或未填写环境变量: ${missing.join(', ')}`)
    error.status = 400
    throw error
  }
}

function dataPath(fileName) {
  if (fileName.startsWith('etsy-')) return path.join(RUNTIME_DATA_DIR, 'etsy', fileName)
  if (fileName.startsWith('hualei-')) return path.join(RUNTIME_DATA_DIR, 'hualei', fileName)
  if (fileName.startsWith('logistics-')) return path.join(RUNTIME_DATA_DIR, 'logistics', fileName)
  if (fileName.startsWith('auth-')) return path.join(RUNTIME_DATA_DIR, 'auth', fileName)
  return path.join(__dirname, fileName)
}

async function readJson(fileName) {
  try {
    const content = await fs.readFile(dataPath(fileName), 'utf8')
    return JSON.parse(content)
  } catch (error) {
    if (error.code === 'ENOENT') {
      const missing = new Error(`找不到 ${fileName}。请先完成 OAuth 授权，或先打开对应测试接口生成它。`)
      missing.status = 400
      throw missing
    }
    throw error
  }
}

async function writeJson(fileName, data) {
  const targetPath = dataPath(fileName)
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await fs.writeFile(targetPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

async function readOptionalJson(fileName, fallback) {
  try {
    return await readJson(fileName)
  } catch (error) {
    if (error.status === 400 || error.code === 'ENOENT') return fallback
    throw error
  }
}

function httpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function base64Url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function decodeBase64Url(value) {
  const normalized = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const padding = normalized.length % 4 ? '='.repeat(4 - (normalized.length % 4)) : ''
  return Buffer.from(`${normalized}${padding}`, 'base64')
}

function timingSafeEqualText(a, b) {
  const left = Buffer.from(String(a || ''))
  const right = Buffer.from(String(b || ''))
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase()
}

function isValidUsername(username) {
  return /^[a-z0-9_.-]{3,40}$/.test(username)
}

function normalizeUserRole(role) {
  const value = String(role || '').trim().toLowerCase()
  if (value === 'root' || value === 'superadmin') return 'super_admin'
  if (value === 'ops_admin') return 'operator'
  if (value === 'unknown' || value === 'read_only') return 'viewer'
  if (value === 'sales_customer_service') return 'customer_service'
  if (value === 'inventory') return 'customer_service'
  if (value === 'warehouse' || value === 'logistic') return 'logistics'
  if (value === 'e_commerce' || value === 'e-commerce' || value === 'ecom' || value === 'dian_shang' || value === 'dianshang' || value === '电商' || value === '电子商务') return 'ecommerce'
  return USER_ROLES.includes(value) ? value : ''
}

function normalizeRoleList(roles, allowedRoles = USER_ROLES, fallback = []) {
  const allowed = new Set(allowedRoles)
  const normalized = Array.isArray(roles)
    ? roles.map(normalizeUserRole).filter((role) => role && allowed.has(role))
    : []
  return [...new Set(normalized.length ? normalized : fallback)]
}

function createOwnerInviteCode() {
  return `OWNER-${base64Url(crypto.randomBytes(9)).toUpperCase()}`
}

function mysqlEnv() {
  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE || 'kanban_main',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
  }
}

function mysqlDatabaseName() {
  const { database } = mysqlEnv()
  if (!/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error('MYSQL_DATABASE 只能包含英文字母、数字和下划线')
  }
  return database
}

function userFromDbRow(row) {
  if (!row) return null
  return {
    id: String(row.id),
    username: row.username || '',
    email: row.email || '',
    name: row.name || '',
    role: roleFromDbRoleId(row.role_id),
    passwordHash: row.password_hash,
    createdAt: row.registered_at,
    updatedAt: row.registered_at,
  }
}

function roleFromDbRoleId(roleId) {
  const normalized = normalizeUserRole(roleId)
  return normalized || 'viewer'
}

function roleIdFromPublicRole(role) {
  const normalized = normalizeUserRole(role)
  if (!normalized) throw httpError(400, '权限类型无效')
  return normalized === 'operator' ? 'ops_admin' : normalized
}

function authPoolConfig(includeDatabase = true) {
  const { host, port, database, user, password } = mysqlEnv()
  return {
    host,
    port,
    user,
    password,
    database: includeDatabase ? database : undefined,
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4',
    timezone: 'Z',
    multipleStatements: false,
  }
}

async function getAuthPool() {
  await ensureAuthDbReady()
  return authPool
}

async function createAuthPool() {
  if (authPool) return authPool
  authPool = mysql.createPool(authPoolConfig(true))
  return authPool
}

async function createAuthDatabase() {
  const serverPool = mysql.createPool(authPoolConfig(false))
  const database = mysqlDatabaseName()
  try {
    await serverPool.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  } finally {
    await serverPool.end()
  }
}

async function createAuthTables() {
  const pool = await createAuthPool()
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_config (
      \`key\` VARCHAR(80) PRIMARY KEY,
      \`value\` TEXT NOT NULL,
      updated_at DATETIME(3) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      username VARCHAR(80) NULL,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(255) NULL UNIQUE,
      role_id VARCHAR(64) NOT NULL DEFAULT 'unknown',
      password_hash VARCHAR(255) NOT NULL,
      registered_at DATETIME(3) NOT NULL,
      cancelled_at DATETIME(3) NULL,
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      INDEX idx_users_role_id (role_id),
      INDEX idx_users_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  await ensureUserColumn('username', 'username VARCHAR(80) NULL AFTER id')
  await ensureUserColumnNullable('email', 'email VARCHAR(255) NULL')
  await ensureUserIndex('uq_users_username', 'username', true)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_feedback (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NULL,
      username VARCHAR(80) NULL,
      role_id VARCHAR(64) NOT NULL,
      page_key VARCHAR(80) NOT NULL,
      rating TINYINT UNSIGNED NOT NULL DEFAULT 0,
      content TEXT NOT NULL,
      created_at DATETIME(3) NOT NULL,
      resolved_at DATETIME(3) NULL,
      INDEX idx_feedback_role_id (role_id),
      INDEX idx_feedback_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
}

async function ensureUserColumn(columnName, definition) {
  const pool = await createAuthPool()
  const database = mysqlDatabaseName()
  const [rows] = await pool.execute(`
    SELECT COUNT(*) AS total
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ?
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = ?
  `, [database, columnName])

  if (Number(rows[0]?.total || 0) === 0) {
    await pool.query(`ALTER TABLE users ADD COLUMN ${definition}`)
  }
}

async function ensureUserIndex(indexName, columnName, unique = false) {
  const pool = await createAuthPool()
  const database = mysqlDatabaseName()
  const [rows] = await pool.execute(`
    SELECT COUNT(*) AS total
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = ?
      AND TABLE_NAME = 'users'
      AND INDEX_NAME = ?
  `, [database, indexName])

  if (Number(rows[0]?.total || 0) === 0) {
    await pool.query(`ALTER TABLE users ADD ${unique ? 'UNIQUE ' : ''}INDEX ${indexName} (${columnName})`)
  }
}

async function ensureUserColumnNullable(columnName, definition) {
  const pool = await createAuthPool()
  const database = mysqlDatabaseName()
  const [rows] = await pool.execute(`
    SELECT IS_NULLABLE AS nullable
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ?
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = ?
  `, [database, columnName])

  if (String(rows[0]?.nullable || '').toUpperCase() === 'NO') {
    await pool.query(`ALTER TABLE users MODIFY ${definition}`)
  }
}

function mysqlDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  const valid = Number.isNaN(date.getTime()) ? new Date() : date
  return valid.toISOString().slice(0, 23).replace('T', ' ')
}

function dateFromMysql(value) {
  if (!value) return ''
  if (value instanceof Date) return value.toISOString()
  const text = String(value)
  return text.includes('T') ? text : new Date(text.replace(' ', 'T')).toISOString()
}

async function getAuthConfigValue(key) {
  const pool = authPool || await createAuthPool()
  const [rows] = await pool.execute('SELECT `value` FROM auth_config WHERE `key` = ?', [key])
  const row = rows[0]
  return row?.value || ''
}

async function setAuthConfigValue(key, value) {
  const pool = authPool || await createAuthPool()
  await pool.execute(`
    INSERT INTO auth_config (\`key\`, \`value\`, updated_at)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE
      \`value\` = VALUES(\`value\`),
      updated_at = VALUES(updated_at)
  `, [key, String(value), mysqlDate()])
}

async function getJsonAuthConfigValue(key, fallback) {
  const raw = await getAuthConfigValue(key)
  if (!raw) return fallback

  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function defaultRolePageUpdates() {
  return Object.fromEntries(USER_ROLES.map((role) => [role, false]))
}

async function getRegisterableRoles() {
  await ensureAuthDbReady()
  const roles = await getJsonAuthConfigValue('registerableRoles', DEFAULT_REGISTERABLE_ROLES)
  return normalizeRoleList(roles, PUBLIC_REGISTERABLE_ROLES, DEFAULT_REGISTERABLE_ROLES)
}

async function getRolePageUpdates() {
  await ensureAuthDbReady()
  const saved = await getJsonAuthConfigValue('rolePageUpdates', {})
  return {
    ...defaultRolePageUpdates(),
    ...(saved && typeof saved === 'object' ? saved : {}),
  }
}

async function getSystemSettings() {
  const [registerableRoles, rolePageUpdates] = await Promise.all([
    getRegisterableRoles(),
    getRolePageUpdates(),
  ])

  return {
    registerableRoles,
    rolePageUpdates,
  }
}

async function updateSystemSettings(input = {}) {
  await ensureAuthDbReady()

  if (Array.isArray(input.registerableRoles)) {
    const registerableRoles = normalizeRoleList(input.registerableRoles, PUBLIC_REGISTERABLE_ROLES, DEFAULT_REGISTERABLE_ROLES)
    await setAuthConfigValue('registerableRoles', JSON.stringify(registerableRoles))
  }

  if (input.rolePageUpdates && typeof input.rolePageUpdates === 'object') {
    const current = await getRolePageUpdates()
    const next = { ...current }
    for (const role of USER_ROLES) {
      if (Object.prototype.hasOwnProperty.call(input.rolePageUpdates, role)) {
        next[role] = Boolean(input.rolePageUpdates[role])
      }
    }
    await setAuthConfigValue('rolePageUpdates', JSON.stringify(next))
  }

  return getSystemSettings()
}

async function insertUserRow(executor, user, ignoreDuplicate = false) {
  const now = new Date()
  const statement = ignoreDuplicate
    ? `
      INSERT INTO users (username, name, email, role_id, password_hash, registered_at, cancelled_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
      ON DUPLICATE KEY UPDATE
        name = IF(role_id = 'unknown' AND VALUES(name) <> '', VALUES(name), name),
        role_id = IF(role_id = 'unknown', VALUES(role_id), role_id)
    `
    : 'INSERT INTO users (username, name, email, role_id, password_hash, registered_at, cancelled_at) VALUES (?, ?, ?, ?, ?, ?, NULL)'
  const email = normalizeEmail(user.email)

  await executor.execute(
    statement,
    [
      normalizeUsername(user.username) || null,
      String(user.name || '').trim(),
      email || null,
      roleIdFromPublicRole(user.role),
      user.passwordHash,
      mysqlDate(user.createdAt || now),
    ],
  )
}

async function migrateAuthJsonToDb() {
  await createAuthDatabase()
  await createAuthTables()

  const savedConfig = await readOptionalJson(AUTH_CONFIG_FILE, null)
  if (savedConfig?.authSecret && !(await getAuthConfigValue('authSecret'))) {
    await setAuthConfigValue('authSecret', savedConfig.authSecret)
  }
  if (savedConfig?.ownerInviteCode && !(await getAuthConfigValue('ownerInviteCode'))) {
    await setAuthConfigValue('ownerInviteCode', savedConfig.ownerInviteCode)
  }

  const savedUsers = await readOptionalJson(AUTH_USERS_FILE, null)
  const users = Array.isArray(savedUsers?.users) ? savedUsers.users : []
  const pool = authPool || await createAuthPool()
  for (const user of users) {
    if (!user?.id || !user?.email || !user?.passwordHash) continue
    await insertUserRow(pool, user, true)
  }
}

async function ensureAuthDbReady() {
  if (!authDbReady) {
    authDbReady = migrateAuthJsonToDb()
  }
  return authDbReady
}

async function getAuthConfig() {
  await ensureAuthDbReady()

  let authSecret = process.env.AUTH_SECRET || await getAuthConfigValue('authSecret')
  let ownerInviteCode = process.env.OWNER_INVITE_CODE || await getAuthConfigValue('ownerInviteCode')

  if (!authSecret) {
    authSecret = base64Url(crypto.randomBytes(32))
    await setAuthConfigValue('authSecret', authSecret)
  }

  if (!ownerInviteCode) {
    ownerInviteCode = createOwnerInviteCode()
    await setAuthConfigValue('ownerInviteCode', ownerInviteCode)
  }

  return {
    authSecret,
    ownerInviteCode,
  }
}

async function readUsers() {
  await ensureAuthDbReady()
  const pool = await getAuthPool()
  const [rows] = await pool.execute('SELECT id, username, email, name, role_id, password_hash, registered_at FROM users WHERE cancelled_at IS NULL ORDER BY registered_at ASC')
  return rows.map((row) => userFromDbRow({
    ...row,
    registered_at: dateFromMysql(row.registered_at),
  }))
}

async function readPublicUsers() {
  await ensureAuthDbReady()
  const pool = await getAuthPool()
  const [rows] = await pool.execute('SELECT id, username, email, name, role_id, registered_at FROM users WHERE cancelled_at IS NULL ORDER BY registered_at ASC')
  return rows.map((row) => publicUser(userFromDbRow({
    ...row,
    password_hash: '',
    registered_at: dateFromMysql(row.registered_at),
  })))
}

async function findUserById(id) {
  await ensureAuthDbReady()
  const pool = await getAuthPool()
  const [rows] = await pool.execute('SELECT id, username, email, name, role_id, password_hash, registered_at FROM users WHERE id = ? AND cancelled_at IS NULL', [String(id)])
  const row = rows[0]
  return userFromDbRow(row ? {
    ...row,
    registered_at: dateFromMysql(row.registered_at),
  } : null)
}

async function countSuperAdmins() {
  await ensureAuthDbReady()
  const pool = await getAuthPool()
  const [rows] = await pool.execute("SELECT COUNT(*) AS total FROM users WHERE role_id = 'super_admin' AND cancelled_at IS NULL")
  return Number(rows[0]?.total || 0)
}

async function updateUserRole(id, role) {
  await ensureAuthDbReady()
  const nextRole = normalizeUserRole(role)
  if (!nextRole) throw httpError(400, '权限类型无效')

  const user = await findUserById(id)
  if (!user) throw httpError(404, '用户不存在')

  if (user.role === 'super_admin' && nextRole !== 'super_admin' && await countSuperAdmins() <= 1) {
    throw httpError(400, '至少需要保留一个超级管理员账号')
  }

  const pool = await getAuthPool()
  await pool.execute('UPDATE users SET role_id = ? WHERE id = ?', [roleIdFromPublicRole(nextRole), String(id)])
  return findUserById(id)
}

async function createManagedUser(input) {
  await ensureAuthDbReady()

  const username = normalizeUsername(input?.username)
  const email = normalizeEmail(input?.email)
  const name = String(input?.name || '').trim()
  const password = String(input?.password || '')
  const role = normalizeUserRole(input?.role || 'operator')

  if (!isValidUsername(username)) throw httpError(400, '账号需为 3-40 位英文字母、数字、点、下划线或短横线')
  if (email && !isValidEmail(email)) throw httpError(400, '请输入有效邮箱，或留空')
  if (!name) throw httpError(400, '请输入姓名')
  if (password.length < 6) throw httpError(400, '密码至少需要 6 位')
  if (!role) throw httpError(400, '权限类型无效')

  const existingLogin = await findUserByLogin(username)
  if (existingLogin) throw httpError(409, '这个账号已经存在')

  if (email) {
    const existingEmail = await findUserByEmail(email)
    if (existingEmail) throw httpError(409, '这个邮箱已经注册过了')
  }

  const savedUser = await createUser({
    username,
    email,
    name,
    role,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  return savedUser
}

async function deleteUserById(id) {
  await ensureAuthDbReady()
  const user = await findUserById(id)
  if (!user) throw httpError(404, '用户不存在')

  if (user.role === 'super_admin' && await countSuperAdmins() <= 1) {
    throw httpError(400, '至少需要保留一个超级管理员账号')
  }

  const pool = await getAuthPool()
  await pool.execute(`
    UPDATE users
    SET
      cancelled_at = ?,
      username = CASE
        WHEN username IS NULL OR username = '' THEN NULL
        ELSE LEFT(CONCAT('__deleted_', id, '_', username), 80)
      END,
      email = CASE
        WHEN email IS NULL OR email = '' THEN NULL
        ELSE LEFT(CONCAT('__deleted_', id, '_', email), 255)
      END
    WHERE id = ?
  `, [mysqlDate(), String(id)])
  return user
}

async function createUserFeedback(authUser, input = {}) {
  await ensureAuthDbReady()
  const pageKey = String(input.pageKey || input.page || 'general').trim().slice(0, 80) || 'general'
  const content = String(input.content || '').trim()
  const rating = Math.max(0, Math.min(5, Number(input.rating || 0)))

  if (!content) throw httpError(400, '请填写意见或评价内容')
  if (content.length > 2000) throw httpError(400, '意见内容不能超过 2000 字')

  const pool = await getAuthPool()
  const [result] = await pool.execute(`
    INSERT INTO user_feedback (user_id, username, role_id, page_key, rating, content, created_at, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
  `, [
    authUser?.id ? String(authUser.id) : null,
    authUser?.username || authUser?.email || '',
    roleIdFromPublicRole(authUser?.role || 'viewer'),
    pageKey,
    rating,
    content,
    mysqlDate(),
  ])

  return {
    id: String(result.insertId),
    userId: String(authUser?.id || ''),
    username: authUser?.username || authUser?.email || '',
    name: authUser?.name || '',
    role: authUser?.role || 'viewer',
    pageKey,
    rating,
    content,
    createdAt: new Date().toISOString(),
  }
}

async function readUserFeedback() {
  await ensureAuthDbReady()
  const pool = await getAuthPool()
  const [rows] = await pool.execute(`
    SELECT id, user_id, username, role_id, page_key, rating, content, created_at, resolved_at
    FROM user_feedback
    ORDER BY created_at DESC
    LIMIT 100
  `)

  return rows.map((row) => ({
    id: String(row.id),
    userId: row.user_id ? String(row.user_id) : '',
    username: row.username || '',
    role: roleFromDbRoleId(row.role_id),
    pageKey: row.page_key || '',
    rating: Number(row.rating || 0),
    content: row.content || '',
    createdAt: dateFromMysql(row.created_at),
    resolvedAt: dateFromMysql(row.resolved_at),
  }))
}

async function writeUsers(users) {
  await ensureAuthDbReady()
  const pool = await getAuthPool()
  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()
    await connection.execute('DELETE FROM users')
    for (const user of users) {
      await insertUserRow(connection, user)
    }
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

async function createUser(user) {
  await ensureAuthDbReady()
  const pool = await getAuthPool()
  await insertUserRow(pool, user)
  return findUserByLogin(user.username || user.email)
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const digest = crypto.pbkdf2Sync(String(password), salt, PASSWORD_ITERATIONS, 32, 'sha256')
  return [
    PASSWORD_ALGORITHM,
    String(PASSWORD_ITERATIONS),
    base64Url(salt),
    base64Url(digest),
  ].join('$')
}

function verifyPassword(password, passwordHash) {
  const value = String(passwordHash || '')
  if (value.startsWith(`${PASSWORD_ALGORITHM}$`)) {
    const [algorithm, iterations, encodedSalt, expectedDigest] = value.split('$')
    if (algorithm !== PASSWORD_ALGORITHM || !iterations || !encodedSalt || !expectedDigest) return false
    const digest = crypto.pbkdf2Sync(
      String(password),
      decodeBase64Url(encodedSalt),
      Number(iterations),
      32,
      'sha256',
    )
    return timingSafeEqualText(base64Url(digest), expectedDigest)
  }

  const [method, salt, expected] = value.split(':')
  if (method !== 'scrypt' || !salt || !expected) return false
  const actual = crypto.scryptSync(String(password), salt, 64).toString('hex')
  return timingSafeEqualText(actual, expected)
}

function publicUser(user) {
  if (!user) return null
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
  }
}

async function findUserByEmail(email) {
  await ensureAuthDbReady()
  const normalized = normalizeEmail(email)
  if (!normalized) return null
  const pool = await getAuthPool()
  const [rows] = await pool.execute('SELECT id, username, email, name, role_id, password_hash, registered_at FROM users WHERE email = ? AND cancelled_at IS NULL', [normalized])
  const row = rows[0]
  return userFromDbRow(row ? {
    ...row,
    registered_at: dateFromMysql(row.registered_at),
  } : null)
}

async function findUserByLogin(identifier) {
  await ensureAuthDbReady()
  const value = String(identifier || '').trim().toLowerCase()
  if (!value) return null

  const pool = await getAuthPool()
  const [rows] = await pool.execute(
    'SELECT id, username, email, name, role_id, password_hash, registered_at FROM users WHERE cancelled_at IS NULL AND (email = ? OR username = ?) LIMIT 1',
    [value, value],
  )
  const row = rows[0]
  return userFromDbRow(row ? {
    ...row,
    registered_at: dateFromMysql(row.registered_at),
  } : null)
}

function signAuthPayload(payload, secret) {
  const encodedPayload = base64Url(Buffer.from(JSON.stringify(payload)))
  const signature = base64Url(crypto.createHmac('sha256', secret).update(encodedPayload).digest())
  return `${encodedPayload}.${signature}`
}

async function createAuthToken(user, remember) {
  const { authSecret } = await getAuthConfig()
  const now = Date.now()
  const expiresAt = now + (remember ? AUTH_REMEMBER_TOKEN_TTL_MS : AUTH_TOKEN_TTL_MS)
  return signAuthPayload({
    sub: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    name: user.name,
    iat: now,
    exp: expiresAt,
  }, authSecret)
}

async function verifyAuthToken(token) {
  const [encodedPayload, signature] = String(token || '').split('.')
  if (!encodedPayload || !signature) throw httpError(401, '请先登录')

  const { authSecret } = await getAuthConfig()
  const expectedSignature = base64Url(crypto.createHmac('sha256', authSecret).update(encodedPayload).digest())
  if (!timingSafeEqualText(signature, expectedSignature)) throw httpError(401, '登录状态无效，请重新登录')

  let payload
  try {
    payload = JSON.parse(decodeBase64Url(encodedPayload).toString('utf8'))
  } catch {
    throw httpError(401, '登录状态无效，请重新登录')
  }

  if (!payload.exp || Number(payload.exp) < Date.now()) {
    throw httpError(401, '登录已过期，请重新登录')
  }

  const users = await readUsers()
  const user = users.find((item) => item.id === payload.sub)
  if (!user) throw httpError(401, '账号不存在，请重新登录')

  return publicUser(user)
}

function authTokenFromRequest(req) {
  const header = String(req.headers.authorization || '')
  if (!header.startsWith('Bearer ')) return ''
  return header.slice('Bearer '.length).trim()
}

function sendJsonError(res, error) {
  res.status(error.status || 500).json({
    ok: false,
    message: error.message || '请求失败',
  })
}

function requireAuth(req, res, next) {
  verifyAuthToken(authTokenFromRequest(req))
    .then((user) => {
      req.authUser = user
      next()
    })
    .catch((error) => sendJsonError(res, error))
}

function requireOwner(req, res, next) {
  if (!USER_MANAGEMENT_ROLES.has(req.authUser?.role)) {
    sendJsonError(res, httpError(403, '当前账号没有权限管理权限'))
    return
  }

  next()
}

function requireReviewAccess(req, res, next) {
  if (!REVIEW_ROLES.has(req.authUser?.role)) {
    sendJsonError(res, httpError(403, '当前账号没有评价看板权限'))
    return
  }

  next()
}

function requireFinanceAccess(req, res, next) {
  if (!FINANCE_ROLES.has(req.authUser?.role)) {
    sendJsonError(res, httpError(403, '当前账号没有财务看板权限'))
    return
  }

  next()
}

function createState() {
  return base64Url(crypto.randomBytes(32))
}

function createCodeVerifier() {
  return base64Url(crypto.randomBytes(64))
}

function createCodeChallenge(codeVerifier) {
  return base64Url(crypto.createHash('sha256').update(codeVerifier).digest())
}

function getUserIdFromAccessToken(accessToken) {
  const [userId] = String(accessToken || '').split('.')
  if (!userId || !/^\d+$/.test(userId)) {
    throw new Error('无法从 access_token 前缀提取 Etsy user_id')
  }
  return userId
}

function tokenWithMeta(tokenResponse, previousToken = {}) {
  const now = Date.now()
  const expiresIn = Number(tokenResponse.expires_in || 3600)
  const accessToken = tokenResponse.access_token || previousToken.access_token
  const refreshToken = tokenResponse.refresh_token || previousToken.refresh_token

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: tokenResponse.token_type || previousToken.token_type || 'Bearer',
    expires_in: expiresIn,
    expires_at: now + expiresIn * 1000,
    user_id: getUserIdFromAccessToken(accessToken),
    created_at: previousToken.created_at || new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
  }
}

async function parseFetchResponse(response) {
  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

function hualeiEnv() {
  return {
    apiBase: (process.env.HUALEI_API_BASE || HUALEI_DEFAULT_API_BASE).replace(/\/+$/, ''),
    labelBase: (process.env.HUALEI_LABEL_BASE || HUALEI_DEFAULT_LABEL_BASE).replace(/\/+$/, ''),
    username: process.env.HUALEI_USERNAME,
    password: process.env.HUALEI_PASSWORD,
    customerId: process.env.HUALEI_CUSTOMER_ID,
    customerUserId: process.env.HUALEI_CUSTOMER_USER_ID,
  }
}

function isFilledEnv(value) {
  return Boolean(value && !String(value).startsWith('replace_with_'))
}

function hualeiConfigStatus() {
  const config = hualeiEnv()
  const authMissing = []
  const orderMissing = []

  if (!isFilledEnv(config.username)) authMissing.push('HUALEI_USERNAME')
  if (!isFilledEnv(config.password)) authMissing.push('HUALEI_PASSWORD')
  if (!isFilledEnv(config.customerId)) orderMissing.push('HUALEI_CUSTOMER_ID')
  if (!isFilledEnv(config.customerUserId)) orderMissing.push('HUALEI_CUSTOMER_USER_ID')

  return {
    apiBase: config.apiBase,
    labelBase: config.labelBase,
    configured: {
      username: isFilledEnv(config.username),
      password: isFilledEnv(config.password),
      customerId: isFilledEnv(config.customerId),
      customerUserId: isFilledEnv(config.customerUserId),
    },
    missingForAuth: authMissing,
    missingForCreateOrder: orderMissing,
  }
}

function assertHualeiLoginEnv() {
  const missing = hualeiConfigStatus().missingForAuth
  if (missing.length > 0) {
    const error = new Error(`缺少华磊登录环境变量: ${missing.join(', ')}`)
    error.status = 400
    throw error
  }
}

function decodeMaybeEncoded(value) {
  if (typeof value !== 'string' || !/%[0-9A-F]{2}/i.test(value)) return value

  try {
    return decodeURIComponent(value.replace(/\+/g, '%20'))
  } catch {
    return value
  }
}

function decodeHualeiPayload(value) {
  if (Array.isArray(value)) return value.map(decodeHualeiPayload)
  if (!value || typeof value !== 'object') return decodeMaybeEncoded(value)

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, decodeHualeiPayload(item)]),
  )
}

async function parseHualeiResponse(response) {
  const buffer = Buffer.from(await response.arrayBuffer())
  const text = buffer.toString('utf8').trim()
  if (!text) return null

  try {
    return decodeHualeiPayload(JSON.parse(text))
  } catch {
    try {
      const normalizedText = text.replace(/'/g, '"')
      return decodeHualeiPayload(JSON.parse(normalizedText))
    } catch {
      return {
        raw: decodeMaybeEncoded(text),
      }
    }
  }
}

async function hualeiRequest(apiPath, params = {}) {
  const { apiBase } = hualeiEnv()
  const url = apiPath.startsWith('http') ? apiPath : `${apiBase}/${apiPath.replace(/^\/+/, '')}`
  const body = new URLSearchParams()

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      body.set(key, String(value))
    }
  })

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json,text/plain,*/*',
      'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
    },
    body,
  })

  const data = await parseHualeiResponse(response)

  if (!response.ok) {
    console.error('[hualei api error]', response.status, apiPath, data)
    const error = new Error(`华磊 API 请求失败: HTTP ${response.status}`)
    error.status = response.status
    error.details = data
    throw error
  }

  return data
}

async function hualeiAuthIds() {
  const config = hualeiEnv()
  if (isFilledEnv(config.customerId) && isFilledEnv(config.customerUserId)) {
    return {
      customer_id: config.customerId,
      customer_userid: config.customerUserId,
      source: '.env',
    }
  }

  const savedAuth = await readOptionalJson('hualei-auth.json', null)
  const customerId = savedAuth?.customer_id || savedAuth?.customerId || savedAuth?.data?.customer_id
  const customerUserId = savedAuth?.customer_userid || savedAuth?.customerUserId || savedAuth?.data?.customer_userid

  if (customerId && customerUserId) {
    return {
      customer_id: customerId,
      customer_userid: customerUserId,
      source: 'hualei-auth.json',
    }
  }

  const error = new Error('还没有华磊 customer_id/customer_userid。请先填写 HUALEI_USERNAME/HUALEI_PASSWORD 后打开 /logistics/auth。')
  error.status = 400
  throw error
}

function hualeiRows(data) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.data)) return data.data
  if (Array.isArray(data?.result)) return data.result
  if (Array.isArray(data?.results)) return data.results
  if (data && typeof data === 'object') return [data]
  return []
}

function firstValue(item, keys) {
  for (const key of keys) {
    if (item?.[key] !== undefined && item?.[key] !== null && item?.[key] !== '') {
      return item[key]
    }
  }
  return ''
}

function hualeiFeeFields(item) {
  return Object.fromEntries(
    Object.entries(item || {}).filter(([key]) => (
      /price|amount|fee|freight|fuel|cost|currency|运费|费用|金额|燃油|杂费/i.test(key)
    )),
  )
}

function extractHualeiFeeRows(data) {
  return hualeiRows(data).map((item) => {
    const feeFields = hualeiFeeFields(item)
    const amount = firstValue(item, [
      'orderpricetrial_amount',
      'total_amount',
      'totalAmount',
      'total_fee',
      'totalFee',
      'amount',
      'cost',
      '总金额',
    ])
    const currency = firstValue(item, [
      'orderpricetrial_currency',
      'currency',
      'currencyCode',
      'currency_code',
      '币种',
    ])

    return {
      orderNo: firstValue(item, [
        'order_customerinvoicecode',
        'documentCode',
        'document_code',
        'order_code',
        'order_no',
        'orderNo',
      ]),
      orderId: firstValue(item, ['order_id', 'orderId']),
      trackingNumber: firstValue(item, [
        'tracking_number',
        'track_number',
        'trackNumber',
        'trackingNumber',
      ]),
      amount,
      currency,
      hasFee: amount !== '' || Object.keys(feeFields).length > 0,
      feeFields,
    }
  })
}

function hualeiLabelUrl(orderId, printType = 'lab10_10') {
  const { labelBase } = hualeiEnv()
  const url = new URL(`${labelBase}/order/FastRpt/PDF_NEW.aspx`)
  url.searchParams.set('PrintType', printType)
  url.searchParams.set('order_id', orderId)
  return url.toString()
}

async function requestToken(params) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)
  let response
  try {
    response = await fetch(ETSY_TOKEN_URL, {
      method: 'POST',
      signal: controller.signal,
      ...(etsyProxyDispatcher ? { dispatcher: etsyProxyDispatcher } : {}),
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
        accept: 'application/json',
      },
      body: new URLSearchParams(params),
    })
  } finally {
    clearTimeout(timeout)
  }

  const data = await parseFetchResponse(response)

  if (!response.ok) {
    console.error('[etsy token error]', response.status, data)
    const error = new Error(`Etsy token 请求失败: HTTP ${response.status}`)
    error.status = response.status
    error.details = data
    throw error
  }

  return data
}

async function refreshAccessToken(existingToken) {
  assertEnv()

  if (!existingToken.refresh_token) {
    const error = new Error('etsy-token.json 里没有 refresh_token，请重新打开 /etsy/connect 授权。')
    error.status = 401
    throw error
  }

  const { keystring } = env()
  const tokenResponse = await requestToken({
    grant_type: 'refresh_token',
    client_id: keystring,
    refresh_token: existingToken.refresh_token,
  })

  const refreshedToken = tokenWithMeta(tokenResponse, existingToken)
  await writeJson('etsy-token.json', refreshedToken)
  return refreshedToken
}

async function getValidAccessToken(forceRefresh = false) {
  const token = await readJson('etsy-token.json')
  const expiresAt = Number(token.expires_at || 0)
  const shouldRefresh = forceRefresh || !expiresAt || Date.now() + TOKEN_REFRESH_MARGIN_MS >= expiresAt

  if (!shouldRefresh) {
    return token.access_token
  }

  // Dashboard requests listings, receipts and transactions concurrently. Etsy may
  // rotate refresh tokens, so only one request may refresh a given token at a time.
  if (!etsyTokenRefresh) {
    etsyTokenRefresh = refreshAccessToken(token).finally(() => {
      etsyTokenRefresh = null
    })
  }

  const refreshedToken = await etsyTokenRefresh
  return refreshedToken.access_token
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function etsyFetch(apiPath, options = {}) {
  assertEnv()

  const { keystring, sharedSecret } = env()
  const url = apiPath.startsWith('http') ? apiPath : `${ETSY_API_BASE}${apiPath}`
  const { timeoutMs = 12000, ...fetchOptions } = options

  async function doRequest(accessToken) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), Number(timeoutMs || 12000))
    try {
      return await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
        ...(etsyProxyDispatcher ? { dispatcher: etsyProxyDispatcher } : {}),
        headers: {
          accept: 'application/json',
          'x-api-key': `${keystring}:${sharedSecret}`,
          authorization: `Bearer ${accessToken}`,
          ...(fetchOptions.headers || {}),
        },
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  let accessToken = await getValidAccessToken()
  let response = await doRequest(accessToken)

  if (response.status === 401) {
    console.warn('[etsy api retry] HTTP 401，尝试刷新 token 后重试一次:', apiPath)
    accessToken = await getValidAccessToken(true)
    response = await doRequest(accessToken)
  }

  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after')
    const waitMs = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : 2000
    console.warn(`[etsy api retry] HTTP 429，等待 ${waitMs}ms 后重试一次:`, apiPath)
    await wait(Math.min(waitMs, 10000))
    response = await doRequest(accessToken)
  }

  const data = await parseFetchResponse(response)

  if (!response.ok) {
    console.error('[etsy api error]', response.status, apiPath, data)
    const error = new Error(`Etsy API 请求失败: HTTP ${response.status}`)
    error.status = response.status
    error.details = data
    throw error
  }

  return data
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function page(title, body) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; padding: 32px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172033; background: #f6f7f9; }
    main { max-width: 980px; margin: 0 auto; background: #fff; border: 1px solid #d8dee8; border-radius: 8px; padding: 24px; }
    h1 { margin: 0 0 16px; font-size: 24px; }
    h2 { margin-top: 24px; font-size: 18px; }
    a { color: #0f63ce; }
    table { border-collapse: collapse; width: 100%; margin-top: 12px; }
    th, td { border: 1px solid #d8dee8; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f1f4f8; }
    code, pre { background: #f1f4f8; border-radius: 6px; }
    code { padding: 2px 4px; }
    pre { padding: 16px; overflow-x: auto; }
    .ok { color: #147a3d; }
    .warn { color: #9a5b00; }
    .links { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
    .links a { border: 1px solid #b9c8de; border-radius: 6px; padding: 8px 10px; text-decoration: none; background: #fff; }
  </style>
</head>
<body>
  <main>${body}</main>
</body>
</html>`
}

function jsonBlock(data) {
  return `<pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`
}

function formatMoney(value) {
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'object') {
    if ('amount' in value && 'divisor' in value) {
      const amount = Number(value.amount)
      const divisor = Number(value.divisor || 100)
      const currency = value.currency_code || value.currency || ''
      return `${currency} ${(amount / divisor).toFixed(2)}`.trim()
    }
    if ('currency_formatted_raw' in value) return value.currency_formatted_raw
  }
  return JSON.stringify(value)
}

function getResults(data) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.results)) return data.results
  if (data && typeof data === 'object') return [data]
  return []
}

function getCount(data) {
  if (typeof data?.count === 'number') return data.count
  return getResults(data).length
}

function toMoneyNumber(value) {
  if (value == null) return 0
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^0-9.-]/g, ''))
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (typeof value === 'object' && 'amount' in value && 'divisor' in value) {
    return Number(value.amount || 0) / Number(value.divisor || 100)
  }
  return 0
}

function moneyCurrency(value) {
  if (!value || typeof value !== 'object') return ''
  return value.currency_code || value.currency || ''
}

function moneyText(value) {
  return `$${Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function numberText(value) {
  return Number(value || 0).toLocaleString('en-US')
}

function timestampMs(item) {
  const raw = Number(item?.created_timestamp || item?.creation_timestamp || item?.created_date || 0)
  if (!raw) return 0
  return raw > 1000000000000 ? raw : raw * 1000
}

function rawTimestampMs(value) {
  const raw = Number(value || 0)
  if (!raw) return 0
  return raw > 1000000000000 ? raw : raw * 1000
}

function startOfDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS)
}

function addMonths(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1))
}

function dateKey(date) {
  return date.toISOString().slice(0, 10)
}

function dateKeyInTimeZone(date, timeZone = DASHBOARD_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const partMap = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${partMap.year}-${partMap.month}-${partMap.day}`
}

function dateKeyDayNumber(value) {
  return Math.floor(Date.parse(`${value}T00:00:00.000Z`) / DAY_MS)
}

function monthLabel(date) {
  return `${date.getUTCMonth() + 1}月`
}

function shortDateLabel(date) {
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}`
}

function parseDateKey(value, fallback) {
  if (!value) return fallback
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) ? fallback : parsed
}

function startOfWeek(date) {
  const day = date.getUTCDay() || 7
  return addDays(startOfDay(date), 1 - day)
}

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

function startOfYear(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
}

function isInRange(item, start, end) {
  const createdAt = timestampMs(item)
  return createdAt >= start.getTime() && createdAt < end.getTime()
}

function adReportDir() {
  return process.env.ETSY_AD_REPORT_DIR || DEFAULT_AD_REPORT_DIR
}

function parseCsv(content) {
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]
    const next = content[index + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      row.push(cell)
      cell = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1
      row.push(cell)
      if (row.some((value) => value.trim() !== '')) rows.push(row)
      row = []
      cell = ''
      continue
    }

    cell += char
  }

  row.push(cell)
  if (row.some((value) => value.trim() !== '')) rows.push(row)
  return rows
}

function parseNumber(value) {
  if (value == null || value === '') return 0
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function parseAdDate(value) {
  const monthMap = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  }
  const match = String(value || '').trim().match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/)
  if (!match) return ''
  const month = monthMap[match[1].toLowerCase()]
  if (month == null) return ''
  return dateKey(new Date(Date.UTC(Number(match[3]), month, Number(match[2]))))
}

function normalizeHeader(value) {
  return String(value || '').replace(/^\uFEFF/, '').trim()
}

function parseAdReportCsv(content) {
  const rows = parseCsv(content)
  const headers = (rows[0] || []).map(normalizeHeader)

  return rows.slice(1)
    .map((row) => {
      const item = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']))
      const date = parseAdDate(item['Date (ET)'])
      if (!date) return null

      return {
        date,
        views: parseNumber(item.Views),
        clicks: parseNumber(item.Clicks),
        orders: parseNumber(item.Orders),
        revenue: parseNumber(item['Revenue (USD)']),
        spend: parseNumber(item['Spend (USD)']),
        roas: parseNumber(item.ROAS),
        clickRate: parseNumber(item['Click rate']),
        endingBudget: parseNumber(item['Ending budget (USD)']),
      }
    })
    .filter(Boolean)
}

async function findLatestAdReportFile() {
  const dir = adReportDir()
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const csvFiles = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.csv'))
  const files = await Promise.all(
    csvFiles.map(async (entry) => {
      const filePath = path.join(dir, entry.name)
      const stat = await fs.stat(filePath)
      return {
        name: entry.name,
        path: filePath,
        mtimeMs: stat.mtimeMs,
        updatedAt: stat.mtime.toISOString(),
      }
    }),
  )

  return files.sort((a, b) => b.mtimeMs - a.mtimeMs)[0] || null
}

async function fetchAdReportData() {
  const sourceDir = adReportDir()

  try {
    const latestFile = await findLatestAdReportFile()
    if (!latestFile) {
      return {
        status: 'missing',
        sourceDir,
        sourceFile: '',
        sourcePath: '',
        updatedAt: '',
        rows: [],
        message: `未在 ${sourceDir} 找到广告 CSV。`,
      }
    }

    const content = await fs.readFile(latestFile.path, 'utf8')
    const rows = parseAdReportCsv(content)
    const payload = {
      status: 'synced',
      sourceDir,
      sourceFile: latestFile.name,
      sourcePath: latestFile.path,
      updatedAt: latestFile.updatedAt,
      rows,
      message: `已同步广告报表：${latestFile.name}，${numberText(rows.length)} 天站内广告数据`,
    }

    await writeJson('etsy-ads.json', payload)
    return payload
  } catch (error) {
    const cached = await readOptionalJson('etsy-ads.json', null)
    if (cached) {
      return {
        ...cached,
        status: 'cached',
        message: `广告报表本次读取失败，已使用上次缓存：${cached.sourceFile || 'etsy-ads.json'}。${error.message}`,
      }
    }

    return {
      status: 'error',
      sourceDir,
      sourceFile: '',
      sourcePath: '',
      updatedAt: '',
      rows: [],
      message: `广告报表读取失败：${error.message}`,
    }
  }
}

function adRowDateMs(row) {
  return parseDateKey(row.date, new Date(0)).getTime()
}

function aggregateAds(adRows, start, end) {
  const inPeriod = adRows.filter((row) => {
    const rowTime = adRowDateMs(row)
    return rowTime >= start.getTime() && rowTime < end.getTime()
  })
  const spend = inPeriod.reduce((sum, row) => sum + Number(row.spend || 0), 0)
  const revenue = inPeriod.reduce((sum, row) => sum + Number(row.revenue || 0), 0)
  const views = inPeriod.reduce((sum, row) => sum + Number(row.views || 0), 0)
  const clicks = inPeriod.reduce((sum, row) => sum + Number(row.clicks || 0), 0)
  const orders = inPeriod.reduce((sum, row) => sum + Number(row.orders || 0), 0)
  const latestBudget = [...inPeriod].sort((a, b) => adRowDateMs(b) - adRowDateMs(a))[0]?.endingBudget || 0

  return {
    rows: inPeriod.length,
    views,
    clicks,
    orders,
    revenue: Number(revenue.toFixed(2)),
    spend: Number(spend.toFixed(2)),
    roas: spend > 0 ? Number((revenue / spend).toFixed(2)) : 0,
    clickRate: views > 0 ? Number(((clicks / views) * 100).toFixed(1)) : 0,
    cpc: clicks > 0 ? Number((spend / clicks).toFixed(2)) : 0,
    acos: revenue > 0 ? Number(((spend / revenue) * 100).toFixed(1)) : 0,
    endingBudget: Number(latestBudget || 0),
  }
}

function logisticsFeesApiUrl() {
  return String(process.env.LOGISTICS_FEES_API_URL || DEFAULT_LOGISTICS_FEES_API_URL).trim()
}

function logisticsFeesApiHeaders() {
  const token = String(process.env.LOGISTICS_FEES_API_TOKEN || '').trim()
  if (!token) return {}
  const headerName = String(process.env.LOGISTICS_FEES_API_HEADER_NAME || 'x-dashboard-token').trim()
  return { [headerName]: token }
}

function cnyMoneyText(value, currency = 'CNY') {
  const amount = Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return currency === 'CNY' ? `¥${amount}` : `${currency} ${amount}`
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2))
}

function normalizeOrderNo(value) {
  return String(value || '').trim().replace(/^#/, '')
}

function logisticsDateKey(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  const key = text.match(/^(\d{4}-\d{2}-\d{2})/)?.[1]
  if (key) return key
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? '' : dateKeyInTimeZone(parsed)
}

function logisticsUnitPrice(item, totalAmount, weight) {
  const directUnitPrice = parseNumber(
    item.unitPrice ??
    item.unit_price ??
    item.orderpricetrial_unitprice ??
    item.orderpricetrial_unit_price ??
    item.price ??
    item.unitAmount ??
    item.unit_amount ??
    item['单价'],
  )
  if (directUnitPrice > 0) return roundMoney(directUnitPrice)
  if (totalAmount > 0 && weight > 0) return roundMoney(totalAmount / weight)
  return 0
}

function normalizeLogisticsFeeItems(payload) {
  const rawItems = Array.isArray(payload?.items)
    ? payload.items
    : Array.isArray(payload?.data)
      ? payload.data
      : Object.values(payload?.itemsByOrderNo || {})
  const defaultCurrency = payload?.summary?.currency || 'CNY'

  return rawItems
    .map((item) => {
      const receivedAt = item.receivedAt || item.received_at || item.receiveTime || item.date || ''
      const orderNo = normalizeOrderNo(item.orderNo || item.orderId || item.order_id || item.order_customerinvoicecode)
      const totalAmount = parseNumber(item.totalAmount ?? item.total_amount ?? item.orderpricetrial_amount ?? item.amount)
      const weight = parseNumber(item.weight ?? item.chargeWeight ?? item.charge_weight)

      return {
        orderNo,
        trackingNo: item.trackingNo || item.tracking_no || item.order_serviceinvoicecode || '',
        receivedAt,
        date: logisticsDateKey(receivedAt),
        shippingMethod: item.shippingMethod || item.shipping_method || item.express_type || '',
        country: item.country || '',
        weight,
        freight: parseNumber(item.freight ?? item.freightAmount ?? item.shippingFee),
        fuel: parseNumber(item.fuel ?? item.fuelFee),
        misc: parseNumber(item.misc ?? item.miscFee ?? item.otherFee),
        totalAmount: roundMoney(totalAmount),
        unitPrice: logisticsUnitPrice(item, totalAmount, weight),
        pieces: Number(item.pieces || item.quantity || item.count || 1),
        currency: item.currency || item.orderpricetrial_currency || defaultCurrency,
        paid: typeof item.paid === 'boolean' ? item.paid : null,
      }
    })
    .filter((item) => item.orderNo || item.date || item.totalAmount)
}

function buildLogisticsFeeByOrderNo(rows) {
  const map = new Map()

  for (const row of rows) {
    const orderNo = normalizeOrderNo(row.orderNo)
    if (!orderNo) continue

    if (!map.has(orderNo)) {
      map.set(orderNo, {
        orderNo,
        trackingNo: row.trackingNo || '',
        trackingNos: row.trackingNo ? [row.trackingNo] : [],
        receivedAt: row.receivedAt || '',
        date: row.date || '',
        shippingMethod: row.shippingMethod || '',
        country: row.country || '',
        weight: 0,
        freight: 0,
        fuel: 0,
        misc: 0,
        totalAmount: 0,
        unitPrice: 0,
        pieces: 0,
        currency: row.currency || 'CNY',
        paid: row.paid,
        rowCount: 0,
      })
    }

    const item = map.get(orderNo)
    item.weight += Number(row.weight || 0)
    item.freight += Number(row.freight || 0)
    item.fuel += Number(row.fuel || 0)
    item.misc += Number(row.misc || 0)
    item.totalAmount += Number(row.totalAmount || 0)
    item.pieces += Number(row.pieces || 0)
    item.rowCount += 1
    if (!item.unitPrice && row.unitPrice) item.unitPrice = Number(row.unitPrice || 0)
    if (row.trackingNo && !item.trackingNos.includes(row.trackingNo)) item.trackingNos.push(row.trackingNo)
    if (!item.trackingNo && row.trackingNo) item.trackingNo = row.trackingNo
    if (!item.receivedAt && row.receivedAt) item.receivedAt = row.receivedAt
    if (!item.date && row.date) item.date = row.date
    if (!item.shippingMethod && row.shippingMethod) item.shippingMethod = row.shippingMethod
    if (!item.country && row.country) item.country = row.country
    if (!item.currency && row.currency) item.currency = row.currency
    if (item.paid == null && row.paid != null) item.paid = row.paid
  }

  for (const item of map.values()) {
    item.weight = Number(item.weight.toFixed(3))
    item.freight = roundMoney(item.freight)
    item.fuel = roundMoney(item.fuel)
    item.misc = roundMoney(item.misc)
    item.totalAmount = roundMoney(item.totalAmount)
    item.unitPrice = item.weight > 0 ? roundMoney(item.totalAmount / item.weight) : roundMoney(item.unitPrice)
    item.pieces = item.pieces || item.rowCount
  }

  return map
}

async function fetchLogisticsFeeData() {
  const sourceUrl = logisticsFeesApiUrl()
  if (!sourceUrl) {
    return {
      status: 'missing',
      sourceUrl: '',
      updatedAt: '',
      rows: [],
      message: '物流费用接口未配置。',
    }
  }

  try {
    const response = await fetch(sourceUrl, { headers: logisticsFeesApiHeaders() })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const payload = await response.json()
    const rows = normalizeLogisticsFeeItems(payload)
    const totalAmount = rows.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0)
    const currency = payload?.summary?.currency || rows.find((row) => row.currency)?.currency || 'CNY'
    const normalized = {
      status: 'synced',
      sourceUrl,
      updatedAt: payload?.updatedAt || new Date().toISOString(),
      rows,
      summary: {
        count: rows.length,
        totalAmount: Number(totalAmount.toFixed(2)),
        currency,
      },
      message: `已同步物流费用：${numberText(rows.length)} 单，${cnyMoneyText(totalAmount, currency)}`,
    }

    await writeJson('logistics-fees.json', normalized)
    return normalized
  } catch (error) {
    const cached = await readOptionalJson('logistics-fees.json', null)
    if (cached) {
      return {
        ...cached,
        status: 'cached',
        message: `物流费用本次读取失败，已使用上次缓存：${error.message}`,
      }
    }

    return {
      status: 'error',
      sourceUrl,
      updatedAt: '',
      rows: [],
      message: `物流费用读取失败：${error.message}`,
    }
  }
}

function logisticsRowDateMs(row) {
  return parseDateKey(row.date, new Date(0)).getTime()
}

function aggregateLogisticsFees(rows, start, end) {
  const inPeriod = rows.filter((row) => {
    const rowTime = logisticsRowDateMs(row)
    return rowTime >= start.getTime() && rowTime < end.getTime()
  })
  const totalAmount = inPeriod.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0)
  const orderNos = new Set(inPeriod.map((row) => row.orderNo).filter(Boolean))
  const currency = inPeriod.find((row) => row.currency)?.currency || rows.find((row) => row.currency)?.currency || 'CNY'

  return {
    rows: inPeriod.length,
    orders: orderNos.size || inPeriod.length,
    totalAmount: Number(totalAmount.toFixed(2)),
    currency,
  }
}

const MARKET_KEYWORD_CATEGORY_SEEDS = [
  'bodhi bracelet',
  'prayer beads',
  'mala bracelet',
  'meditation bracelet',
  'mala beads',
  'bodhi mala',
  'lotus bracelet',
  'spiritual gift',
]

const MARKET_KEYWORD_PLATFORM_SEEDS = [
  'gift',
  'personalized gift',
  'jewelry',
  'home decor',
  'wall art',
  'wedding gift',
  'bracelet',
  'necklace',
  'digital download',
  'printable wall art',
]

const MARKET_KEYWORD_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'bead',
  'beads',
  'by',
  'for',
  'from',
  'gift',
  'gifts',
  'in',
  'is',
  'it',
  'jewelry',
  'mm',
  'of',
  'on',
  'or',
  'set',
  'the',
  'to',
  'with',
])

function normalizeMarketKeyword(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/[^a-z0-9&\\-\\s]/g, ' ')
    .replace(/\\s+/g, ' ')
    .trim()
}

function marketKeywordSearchUrl(keyword) {
  return `https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`
}

function marketListingUrl(listing) {
  if (listing.url) return listing.url
  if (listing.listing_id) return `https://www.etsy.com/listing/${listing.listing_id}`
  return ''
}

function marketPriceNumber(listing) {
  return toMoneyNumber(listing.price)
}

function marketTitleTokens(title) {
  return normalizeMarketKeyword(title)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !MARKET_KEYWORD_STOP_WORDS.has(token) && !/^\\d+$/.test(token))
}

function marketTitlePhrases(title) {
  const tokens = marketTitleTokens(title)
  const phrases = []

  for (const size of [2, 3]) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      const phrase = tokens.slice(index, index + size).join(' ')
      if (phrase.length >= 8) phrases.push(phrase)
    }
  }

  return phrases
}

function normalizeMarketScope(scope) {
  return scope === 'platform' ? 'platform' : 'category'
}

function marketScopeLabel(scope) {
  return scope === 'platform' ? '全平台关键词' : '当前品类关键词'
}

function marketKeywordCacheFile(scope) {
  return scope === 'platform' ? 'etsy-market-keywords-platform.json' : 'etsy-market-keywords-category.json'
}

function collectMarketSeedKeywords(listings, scope = 'category') {
  if (scope === 'platform') {
    return MARKET_KEYWORD_PLATFORM_SEEDS.map(normalizeMarketKeyword).filter(Boolean)
  }

  const counts = new Map()

  for (const listing of listings) {
    const tags = Array.isArray(listing.tags) ? listing.tags : []
    for (const tag of tags) {
      const keyword = normalizeMarketKeyword(tag)
      if (!keyword || keyword.length < 5) continue
      counts.set(keyword, (counts.get(keyword) || 0) + 1)
    }
  }

  const tagSeeds = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([keyword]) => keyword)
  const seeds = [...MARKET_KEYWORD_CATEGORY_SEEDS.map(normalizeMarketKeyword), ...tagSeeds]
  return [...new Set(seeds)].slice(0, 10)
}

async function fetchMarketSeedSample(keyword) {
  const encodedKeyword = encodeURIComponent(keyword)
  const data = await etsyFetch(`/listings/active?keywords=${encodedKeyword}&limit=40&offset=0`)
  const results = getResults(data)

  return {
    keyword,
    resultCount: Number(data?.count || results.length || 0),
    sampleSize: results.length,
    listings: results.map((listing) => ({
      listingId: String(listing.listing_id || ''),
      title: listing.title || '',
      url: marketListingUrl(listing),
      shopId: String(listing.shop_id || ''),
      price: marketPriceNumber(listing),
      currency: listing.price?.currency_code || '',
      tags: Array.isArray(listing.tags) ? listing.tags.map(normalizeMarketKeyword).filter(Boolean) : [],
    })),
  }
}

function buildMarketKeywordEntries(seedSamples) {
  const keywords = new Map()
  const listingKeysByKeyword = new Map()

  function ensureKeyword(keyword) {
    if (!keywords.has(keyword)) {
      keywords.set(keyword, {
        keyword,
        score: 0,
        listingCount: 0,
        tagUses: 0,
        titleUses: 0,
        sourceSeeds: new Set(),
        sampleTitles: [],
      })
      listingKeysByKeyword.set(keyword, new Set())
    }
    return keywords.get(keyword)
  }

  for (const sample of seedSamples) {
    for (const listing of sample.listings) {
      const listingKey = listing.listingId || listing.title
      const titlePhrases = marketTitlePhrases(listing.title)
      const tagKeywords = listing.tags || []

      for (const keyword of tagKeywords) {
        if (!keyword || keyword.length < 5) continue
        const item = ensureKeyword(keyword)
        item.tagUses += 1
        item.sourceSeeds.add(sample.keyword)
        listingKeysByKeyword.get(keyword).add(listingKey)
        if (item.sampleTitles.length < 3) item.sampleTitles.push(listing.title)
      }

      for (const keyword of titlePhrases) {
        if (!keyword || keyword.length < 5) continue
        const item = ensureKeyword(keyword)
        item.titleUses += 1
        item.sourceSeeds.add(sample.keyword)
        listingKeysByKeyword.get(keyword).add(listingKey)
        if (item.sampleTitles.length < 3) item.sampleTitles.push(listing.title)
      }
    }
  }

  return [...keywords.values()]
    .map((item) => {
      const listingCount = listingKeysByKeyword.get(item.keyword)?.size || 0
      const sourceSeedCount = item.sourceSeeds.size
      const score = listingCount * 4 + item.tagUses * 2 + item.titleUses + sourceSeedCount * 3

      return {
        keyword: item.keyword,
        score,
        listingCount,
        tagUses: item.tagUses,
        titleUses: item.titleUses,
        sourceSeedCount,
        sourceSeeds: [...item.sourceSeeds].slice(0, 6),
        sampleTitles: item.sampleTitles,
        searchUrl: marketKeywordSearchUrl(item.keyword),
      }
    })
    .filter((item) => item.listingCount >= 2 || item.tagUses >= 2 || item.titleUses >= 2)
    .sort((a, b) => b.score - a.score || b.listingCount - a.listingCount || b.tagUses - a.tagUses)
    .slice(0, 120)
}

function buildMarketSeedSummary(seedSamples) {
  return seedSamples
    .map((sample) => {
      const prices = sample.listings.map((listing) => Number(listing.price || 0)).filter((price) => price > 0)
      const avgPrice = prices.length ? prices.reduce((sum, price) => sum + price, 0) / prices.length : 0
      const tagCounts = new Map()

      for (const listing of sample.listings) {
        for (const tag of listing.tags || []) {
          if (!tag || tag.length < 5) continue
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)
        }
      }

      return {
        keyword: sample.keyword,
        resultCount: sample.resultCount,
        sampleSize: sample.sampleSize,
        avgPrice: Number(avgPrice.toFixed(2)),
        minPrice: prices.length ? Number(Math.min(...prices).toFixed(2)) : 0,
        maxPrice: prices.length ? Number(Math.max(...prices).toFixed(2)) : 0,
        searchUrl: marketKeywordSearchUrl(sample.keyword),
        topTags: [...tagCounts.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, 8)
          .map(([tag, count]) => ({ tag, count })),
      }
    })
    .sort((a, b) => b.resultCount - a.resultCount)
}

async function buildMarketKeywordData(options = {}) {
  const scope = normalizeMarketScope(options.scope)
  const scopeLabel = marketScopeLabel(scope)
  const cacheFile = marketKeywordCacheFile(scope)
  const shopId = await getSavedShopId()
  const listingsPayload = await etsyFetchAll(`/shops/${shopId}/listings/active`, 'etsy-listings.json')
  const listings = getResults(listingsPayload)
  const seeds = collectMarketSeedKeywords(listings, scope)
  const seedSamples = []
  const errors = []

  for (const seed of seeds) {
    try {
      seedSamples.push(await fetchMarketSeedSample(seed))
      await wait(300)
    } catch (error) {
      console.warn('[market keyword sample error]', seed, error.message)
      errors.push({ keyword: seed, message: error.message })
    }
  }

  if (!seedSamples.length) {
    const error = new Error(errors[0]?.message || 'Etsy 市场关键词采样失败')
    error.status = 502
    throw error
  }

  const seedReports = buildMarketSeedSummary(seedSamples)
  const keywords = buildMarketKeywordEntries(seedSamples)
  const payload = {
    ok: true,
    generatedAt: new Date().toISOString(),
    status: errors.length ? 'partial' : 'synced',
    scope,
    scopeLabel,
    source: 'Etsy Open API marketplace listings search',
    sourceNote: scope === 'platform'
      ? '全平台版使用 Etsy 公开 marketplace 大类搜索样本，不是 Etsy 官方搜索量或买家真实搜索次数。'
      : '当前品类版使用店铺标签和品类种子词的公开 marketplace 搜索样本，不是 Etsy 官方搜索量或买家真实搜索次数。',
    seedCount: seeds.length,
    sampledSeedCount: seedSamples.length,
    sampleListingCount: seedSamples.reduce((sum, sample) => sum + sample.sampleSize, 0),
    keywords,
    seedReports,
    errors,
    sync: {
      status: errors.length ? 'cached' : 'synced',
      fileCount: 1,
      latestFile: cacheFile,
      message: errors.length
        ? `${scopeLabel}已完成部分采样：${numberText(keywords.length)} 个关键词，${numberText(seedSamples.length)} 个种子词成功。`
        : `${scopeLabel}已同步：${numberText(keywords.length)} 个关键词，${numberText(seedSamples.length)} 个种子词。`,
    },
  }

  await writeJson(cacheFile, payload)
  return payload
}

function createMissingMarketKeywordData(scope, message) {
  const scopeLabel = marketScopeLabel(scope)
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    status: 'cached',
    scope,
    scopeLabel,
    source: 'Etsy Open API marketplace listings search',
    sourceNote: '当前展示备用数据，完成 Etsy 授权后会同步市场关键词样本。',
    seedCount: 0,
    sampledSeedCount: 0,
    sampleListingCount: 0,
    keywords: [],
    seedReports: [],
    errors: [],
    sync: {
      status: 'cached',
      fileCount: 0,
      latestFile: '',
      message: '当前展示备用数据；完成 Etsy 授权后刷新即可同步真实数据。',
    },
  }
}

async function getMarketKeywordData(options = {}) {
  const scope = normalizeMarketScope(options.scope)
  const cacheKey = `market-keywords-${scope}`
  const cacheFile = marketKeywordCacheFile(scope)
  const now = Date.now()
  const cached = marketKeywordCache.get(cacheKey)

  if (!options.force && cached && now - cached.createdAt < DASHBOARD_CACHE_TTL_MS) {
    return {
      ...cached.data,
      cache: {
        status: 'memory',
        ageSeconds: Math.round((now - cached.createdAt) / 1000),
        ttlSeconds: Math.round(DASHBOARD_CACHE_TTL_MS / 1000),
      },
    }
  }

  if (!options.force && marketKeywordBuilds.has(cacheKey)) {
    return marketKeywordBuilds.get(cacheKey)
  }

  if (!options.force) {
    const cachedFile = await readOptionalJson(cacheFile, null)
    if (cachedFile) {
      marketKeywordCache.set(cacheKey, {
        createdAt: Date.now(),
        data: cachedFile,
      })
      return {
        ...cachedFile,
        cache: {
          status: 'file',
          ageSeconds: 0,
          ttlSeconds: Math.round(DASHBOARD_CACHE_TTL_MS / 1000),
        },
      }
    }
  }

  const build = buildMarketKeywordData({ ...options, scope }).then((data) => {
    marketKeywordCache.set(cacheKey, {
      createdAt: Date.now(),
      data,
    })
    return {
      ...data,
      cache: {
        status: 'fresh',
        ageSeconds: 0,
        ttlSeconds: Math.round(DASHBOARD_CACHE_TTL_MS / 1000),
      },
    }
  }).catch(async (error) => {
    const cachedFile = await readOptionalJson(cacheFile, null)
    if (cachedFile) {
      return {
        ...cachedFile,
        status: 'cached',
        sync: {
          ...(cachedFile.sync || {}),
          status: 'cached',
          message: `Etsy 市场关键词本次采样失败，已使用上次缓存。${error.message}`,
        },
      }
    }
    if (isMissingEtsySetupError(error)) {
      const fallback = createMissingMarketKeywordData(scope, error.message)
      marketKeywordCache.set(cacheKey, {
        createdAt: Date.now(),
        data: fallback,
      })
      return {
        ...fallback,
        cache: {
          status: 'empty',
          ageSeconds: 0,
          ttlSeconds: Math.round(DASHBOARD_CACHE_TTL_MS / 1000),
        },
      }
    }
    throw error
  }).finally(() => {
    marketKeywordBuilds.delete(cacheKey)
  })

  marketKeywordBuilds.set(cacheKey, build)
  return build
}

function sumListingFavorites(listings) {
  return listings.reduce((sum, listing) => sum + Number(listing.num_favorers || 0), 0)
}

function sumListingViews(listings) {
  return listings.reduce((sum, listing) => sum + Number(listing.views || 0), 0)
}

function sumListingQuantity(listings) {
  return listings.reduce((sum, listing) => sum + Number(listing.quantity || 0), 0)
}

function countLowStockListings(listings) {
  return listings.filter((listing) => {
    const quantity = Number(listing.quantity || 0)
    return quantity > 0 && quantity <= 5
  }).length
}

function countOutOfStockListings(listings) {
  return listings.filter((listing) => Number(listing.quantity || 0) === 0).length
}

function receiptRevenue(receipt) {
  return toMoneyNumber(receipt.grandtotal || receipt.total_price || receipt.total)
}

function transactionRevenue(transaction) {
  return toMoneyNumber(transaction.price) * Number(transaction.quantity || 1)
}

function transactionDateKey(transaction) {
  const ms = timestampMs(transaction)
  return ms ? dateKey(startOfDay(new Date(ms))) : ''
}

function listingCreatedMs(listing) {
  const raw = Number(listing?.created_timestamp || listing?.creation_timestamp || listing?.original_creation_timestamp || 0)
  if (!raw) return 0
  return raw > 1000000000000 ? raw : raw * 1000
}

function countListingsCreatedInRange(listings, start, end) {
  return listings.filter((listing) => {
    const createdAt = listingCreatedMs(listing)
    return createdAt >= start.getTime() && createdAt < end.getTime()
  }).length
}

function getListingImageUrl(imageData) {
  const firstImage = getResults(imageData).sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0))[0]
  return firstImage?.url_170x135 || firstImage?.url_570xN || firstImage?.url_fullxfull || firstImage?.url_75x75 || ''
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = []
  let index = 0

  async function worker() {
    while (index < items.length) {
      const currentIndex = index
      index += 1
      results[currentIndex] = await mapper(items[currentIndex], currentIndex)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

async function getListingImageMap(listings, options = {}) {
  const cache = await readOptionalJson('etsy-listing-images.json', { updatedAt: '', images: {} })
  const images = cache.images || {}
  const missingListings = listings.filter((listing) => {
    const id = String(listing.listing_id)
    return id && !images[id]
  })

  async function refreshMissingImages() {
    await mapWithConcurrency(missingListings, 5, async (listing) => {
      const id = String(listing.listing_id)
      try {
        const imageData = await etsyFetch(`/listings/${id}/images`, { timeoutMs: 2500 })
        images[id] = getListingImageUrl(imageData)
      } catch (error) {
        console.warn('[listing image error]', id, error.message)
        images[id] = ''
      }
    })

    await writeJson('etsy-listing-images.json', {
      updatedAt: new Date().toISOString(),
      images,
    })
  }

  if (missingListings.length > 0) {
    if (options.background) {
      refreshMissingImages().catch((error) => {
        console.warn('[listing image background error]', error.message)
      })
    } else {
      await refreshMissingImages()
    }
  }

  return images
}

async function getReviewListings(listings, reviews) {
  const listingMap = new Map(listings.map((listing) => [String(listing.listing_id), listing]))
  const reviewListingIds = [...new Set(
    reviews
      .map((review) => String(review?.listing_id || ''))
      .filter(Boolean),
  )]

  return reviewListingIds.map((id) => listingMap.get(id) || { listing_id: id })
}

function aggregateReceipts(receipts, start, end) {
  const inPeriod = receipts.filter((receipt) => isInRange(receipt, start, end))
  return {
    orders: inPeriod.length,
    revenue: inPeriod.reduce((sum, receipt) => sum + receiptRevenue(receipt), 0),
    paid: inPeriod.filter((receipt) => receipt.is_paid).length,
    shipped: inPeriod.filter((receipt) => receipt.is_shipped).length,
    pendingShipment: inPeriod.filter((receipt) => receipt.is_paid && !receipt.is_shipped).length,
  }
}

function buildProductPerformance(transactions, listings, imageMap, start, end) {
  const listingMap = new Map(listings.map((listing) => [String(listing.listing_id), listing]))
  const products = new Map(
    listings.map((listing) => {
      const id = String(listing.listing_id)
      return [
        id,
        {
          id,
          tag: id,
          productName: listing.title || `Listing ${id}`,
          imageUrl: imageMap[id] || '',
          listingUrl: listing.url || '',
          tags: Array.isArray(listing.tags) ? listing.tags : [],
          price: toMoneyNumber(listing.price),
          currencyCode: moneyCurrency(listing.price),
          views: Number(listing.views || 0),
          favorites: Number(listing.num_favorers || 0),
          stockQuantity: Number(listing.quantity || 0),
          orderCount: 0,
          soldQuantity: 0,
          orders: 0,
          receiptIds: [],
          orderDates: [],
          orderDateSummary: '本期无订单',
          revenue: 0,
          averageItemRevenue: 0,
          isNew: false,
          note: `库存 ${numberText(listing.quantity || 0)} / 浏览 ${numberText(listing.views || 0)}`,
        },
      ]
    }),
  )

  for (const transaction of transactions) {
    if (!isInRange(transaction, start, end)) continue

    const id = String(transaction.listing_id || transaction.transaction_id)
    const listing = listingMap.get(id) || {}
    const existing = products.get(id) || {
      id,
      tag: id,
      productName: transaction.title || listing.title || `Listing ${id}`,
      imageUrl: imageMap[id] || '',
      listingUrl: listing.url || '',
      tags: Array.isArray(listing.tags) ? listing.tags : [],
      price: toMoneyNumber(listing.price) || toMoneyNumber(transaction.price),
      currencyCode: moneyCurrency(listing.price) || moneyCurrency(transaction.price),
      views: Number(listing.views || 0),
      favorites: Number(listing.num_favorers || 0),
      stockQuantity: Number(listing.quantity || 0),
      orderCount: 0,
      soldQuantity: 0,
      orders: 0,
      receiptIds: [],
      orderDates: [],
      orderDateSummary: '本期无订单',
      revenue: 0,
      averageItemRevenue: 0,
      isNew: false,
      note: '',
    }

    const quantity = Number(transaction.quantity || 1)
    const receiptId = String(transaction.receipt_id || transaction.transaction_id || '')
    if (receiptId && !existing.receiptIds.includes(receiptId)) {
      existing.receiptIds.push(receiptId)
    }
    existing.orderCount = existing.receiptIds.length
    existing.soldQuantity += quantity
    existing.orders = existing.soldQuantity
    existing.revenue += transactionRevenue(transaction)
    const soldDate = transactionDateKey(transaction)
    if (soldDate) {
      const dateItem = existing.orderDates.find((item) => item.date === soldDate)
      if (dateItem) {
        dateItem.quantity += quantity
      } else {
        existing.orderDates.push({ date: soldDate, quantity })
      }
      existing.orderDates.sort((a, b) => b.date.localeCompare(a.date))
      existing.orderDateSummary = existing.orderDates
        .map((item) => `${item.date} ${numberText(item.quantity)} 件`)
        .join(' / ')
    }
    existing.averageItemRevenue = existing.soldQuantity > 0 ? Number((existing.revenue / existing.soldQuantity).toFixed(2)) : 0
    existing.note = `本期 ${numberText(existing.orderCount)} 单 / ${numberText(existing.soldQuantity)} 件 / ${moneyText(existing.revenue)} 收入`
    products.set(id, existing)
  }

  return [...products.values()]
    .map((product) => {
      const { receiptIds, ...publicProduct } = product
      return {
        ...publicProduct,
        averageItemRevenue: product.soldQuantity > 0 ? Number((product.revenue / product.soldQuantity).toFixed(2)) : 0,
      }
    })
    .sort((a, b) => b.soldQuantity - a.soldQuantity || b.revenue - a.revenue || b.views - a.views)
}

async function recordListingSnapshot(listings, imageMap) {
  const snapshotDate = dateKeyInTimeZone(new Date())
  const existing = await readOptionalJson('etsy-listing-snapshots.json', {
    updatedAt: '',
    timeZone: DASHBOARD_TIME_ZONE,
    snapshots: [],
  })
  const previousSnapshots = Array.isArray(existing.snapshots) ? existing.snapshots : []
  const todaySnapshots = listings.map((listing) => {
    const id = String(listing.listing_id || '')
    return {
      date: snapshotDate,
      listingId: id,
      title: listing.title || '',
      imageUrl: imageMap[id] || '',
      listingUrl: listing.url || '',
      cumulativeViews: Number(listing.views || 0),
      cumulativeFavorites: Number(listing.num_favorers || 0),
      quantity: Number(listing.quantity || 0),
      price: toMoneyNumber(listing.price),
      capturedAt: new Date().toISOString(),
    }
  })

  await writeJson('etsy-listing-snapshots.json', {
    updatedAt: new Date().toISOString(),
    timeZone: DASHBOARD_TIME_ZONE,
    count: previousSnapshots.filter((item) => item.date !== snapshotDate).length + todaySnapshots.length,
    snapshots: [
      ...previousSnapshots.filter((item) => item.date !== snapshotDate),
      ...todaySnapshots,
    ],
  })

  return {
    date: snapshotDate,
    count: todaySnapshots.length,
  }
}

function buildFulfillmentStatus(receipts, transactions, listings = [], imageMap = {}, logisticsRows = []) {
  const todayKey = dateKeyInTimeZone(new Date())
  const todayDayNumber = dateKeyDayNumber(todayKey)
  const transactionsByReceipt = new Map()
  const listingMap = new Map(listings.map((listing) => [String(listing.listing_id || ''), listing]))
  const logisticsFeeByOrderNo = buildLogisticsFeeByOrderNo(logisticsRows)

  for (const transaction of transactions) {
    const receiptId = String(transaction.receipt_id || '')
    if (!receiptId) continue
    if (!transactionsByReceipt.has(receiptId)) transactionsByReceipt.set(receiptId, [])
    transactionsByReceipt.get(receiptId).push(transaction)
  }

  const orders = receipts.map((receipt) => {
    const receiptId = String(receipt.receipt_id || '')
    const receiptTransactions = transactionsByReceipt.get(receiptId) || receipt.transactions || []
    const expectedTimestamps = receiptTransactions
      .map((transaction) => rawTimestampMs(transaction.expected_ship_date))
      .filter(Boolean)
    const expectedShipMs = expectedTimestamps.length ? Math.min(...expectedTimestamps) : 0
    const expectedShipDate = expectedShipMs ? dateKeyInTimeZone(new Date(expectedShipMs)) : ''
    const orderMs = timestampMs(receipt)
    const itemCount = receiptTransactions.reduce((sum, transaction) => sum + Number(transaction.quantity || 1), 0) || receiptTransactions.length || 1
    const productItems = receiptTransactions
      .map((transaction) => {
        const listingId = String(transaction.listing_id || '')
        const listing = listingMap.get(listingId) || {}
        const title = transaction.title || listing.title || (listingId ? `Listing ${listingId}` : '')

        return {
          listingId,
          title,
          quantity: Number(transaction.quantity || 1),
          imageUrl: listingId ? imageMap[listingId] || '' : '',
          listingUrl: listing.url || (listingId ? `https://www.etsy.com/listing/${listingId}` : ''),
        }
      })
      .filter((item) => item.title || item.listingId)
    const productNames = productItems.map((item) => item.title).filter(Boolean)
    const productSummary =
      productNames.length > 1
        ? `${productNames[0]} 等 ${numberText(productNames.length)} 个商品`
        : productNames[0] || `Receipt ${receiptId}`
    const productImageUrl = productItems.find((item) => item.imageUrl)?.imageUrl || ''
    const daysUntilDue = expectedShipDate ? dateKeyDayNumber(expectedShipDate) - todayDayNumber : null
    const statusText = String(receipt.status || '').toLowerCase()
    const isCanceled = statusText.includes('cancel')
    const isPaid = Boolean(receipt.is_paid)
    const isShipped = Boolean(receipt.is_shipped)
    const isPendingShipment = isPaid && !isShipped && !isCanceled
    const isOverdue = isPendingShipment && daysUntilDue != null && daysUntilDue < 0
    const isDueSoon = isPendingShipment && daysUntilDue != null && daysUntilDue >= 0 && daysUntilDue <= 3
    const fulfillmentStatus = isCanceled
      ? '已取消'
      : !isPaid
      ? '未付款'
      : isShipped
        ? '已发货'
        : '待发货'
    const logisticsFee = logisticsFeeByOrderNo.get(normalizeOrderNo(receiptId)) || null

    return {
      receiptId,
      orderDate: orderMs ? dateKeyInTimeZone(new Date(orderMs)) : '',
      expectedShipDate,
      status: receipt.status || '',
      fulfillmentStatus,
      isPaid,
      isShipped,
      isCanceled,
      isPendingShipment,
      isOverdue,
      isDueSoon,
      daysUntilDue,
      productSummary,
      productImageUrl,
      productItems,
      itemCount,
      total: Number(receiptRevenue(receipt).toFixed(2)),
      logisticsMatched: Boolean(logisticsFee),
      logisticsUnitPrice: logisticsFee?.unitPrice || 0,
      logisticsTotalAmount: logisticsFee?.totalAmount || 0,
      logisticsCurrency: logisticsFee?.currency || 'CNY',
      logisticsWeight: logisticsFee?.weight || 0,
      logisticsReceivedAt: logisticsFee?.receivedAt || '',
      logisticsTrackingNo: logisticsFee?.trackingNo || '',
    }
  })

  const pendingItems = orders
    .filter((order) => order.isPendingShipment)
    .sort((a, b) => {
      const priorityA = a.isOverdue ? 0 : a.isDueSoon ? 1 : 2
      const priorityB = b.isOverdue ? 0 : b.isDueSoon ? 1 : 2
      if (priorityA !== priorityB) return priorityA - priorityB
      if (a.expectedShipDate && b.expectedShipDate && a.expectedShipDate !== b.expectedShipDate) {
        return a.expectedShipDate.localeCompare(b.expectedShipDate)
      }
      return b.orderDate.localeCompare(a.orderDate)
    })

  const activeOrders = orders.filter((order) => !order.isCanceled)
  const sortedOrders = [...orders].sort((a, b) => {
    if (a.orderDate !== b.orderDate) return b.orderDate.localeCompare(a.orderDate)
    return String(b.receiptId).localeCompare(String(a.receiptId))
  })

  return {
    currentDate: todayKey,
    totalReceipts: activeOrders.length,
    paid: activeOrders.filter((order) => order.isPaid).length,
    pendingShipment: pendingItems.length,
    dueSoon: pendingItems.filter((order) => order.isDueSoon).length,
    overdue: pendingItems.filter((order) => order.isOverdue).length,
    shipped: activeOrders.filter((order) => order.isShipped).length,
    unpaid: activeOrders.filter((order) => !order.isPaid).length,
    canceled: orders.filter((order) => order.isCanceled).length,
    items: pendingItems,
    orders: sortedOrders,
  }
}

function buildTrendItem(label, listings, receipts, adRows, logisticsRows, start, end) {
  const receiptMetrics = aggregateReceipts(receipts, start, end)
  const adMetrics = aggregateAds(adRows, start, end)
  const logisticsMetrics = aggregateLogisticsFees(logisticsRows, start, end)
  const endInclusive = addDays(end, -1)

  return {
    label,
    rangeLabel: `${dateKey(start)} - ${dateKey(endInclusive)}`,
    listings: listings.length,
    orders: receiptMetrics.orders,
    revenue: Number(receiptMetrics.revenue.toFixed(2)),
    adSpend: adMetrics.spend,
    adRevenue: adMetrics.revenue,
    adViews: adMetrics.views,
    adClicks: adMetrics.clicks,
    adOrders: adMetrics.orders,
    roas: adMetrics.roas,
    clickRate: adMetrics.clickRate,
    logisticsCost: logisticsMetrics.totalAmount,
    logisticsOrders: logisticsMetrics.orders,
    favorites: sumListingFavorites(listings),
    conversations: 0,
  }
}

function buildDayTrends(listings, receipts, adRows, logisticsRows, endDate) {
  return Array.from({ length: 7 }, (_, index) => {
    const start = addDays(endDate, index - 6)
    const item = buildTrendItem(shortDateLabel(start), listings, receipts, adRows, logisticsRows, start, addDays(start, 1))
    item.rangeLabel = dateKey(start)
    return item
  })
}

function buildWeekTrends(listings, receipts, adRows, logisticsRows, endDate) {
  const currentWeekStart = startOfWeek(endDate)

  return Array.from({ length: 5 }, (_, index) => {
    const start = addDays(currentWeekStart, (index - 4) * 7)
    return buildTrendItem(shortDateLabel(start), listings, receipts, adRows, logisticsRows, start, addDays(start, 7))
  })
}

function buildMonthTrends(listings, receipts, adRows, logisticsRows, endDate) {
  const currentMonthStart = startOfMonth(endDate)

  return Array.from({ length: 6 }, (_, index) => {
    const start = addMonths(currentMonthStart, index - 5)
    return buildTrendItem(monthLabel(start), listings, receipts, adRows, logisticsRows, start, addMonths(start, 1))
  })
}

function buildYearToDateTrends(listings, receipts, adRows, logisticsRows, endDate) {
  const yearStart = startOfYear(endDate)
  const currentMonth = endDate.getUTCMonth()

  return Array.from({ length: currentMonth + 1 }, (_, index) => {
    const start = addMonths(yearStart, index)
    const end = index === currentMonth ? addDays(endDate, 1) : addMonths(start, 1)
    return buildTrendItem(monthLabel(start), listings, receipts, adRows, logisticsRows, start, end)
  })
}

function metric(key, title, value, note, tone) {
  return { key, title, value, note, tone }
}

function comparisonValue(currentValue, previousValue) {
  const current = Number(currentValue || 0)
  const previous = Number(previousValue || 0)
  const change = Number((current - previous).toFixed(2))
  const percentChange = previous === 0
    ? current === 0
      ? 0
      : null
    : Number(((change / Math.abs(previous)) * 100).toFixed(1))

  return {
    current: Number(current.toFixed(2)),
    previous: Number(previous.toFixed(2)),
    change,
    percentChange,
  }
}

function aggregateComparisonMetrics(listings, receipts, adRows, logisticsRows, start, end) {
  const receiptMetrics = aggregateReceipts(receipts, start, end)
  const adMetrics = aggregateAds(adRows, start, end)
  const logisticsMetrics = aggregateLogisticsFees(logisticsRows, start, end)

  return {
    listings: countListingsCreatedInRange(listings, start, end),
    orders: receiptMetrics.orders,
    revenue: receiptMetrics.revenue,
    adSpend: adMetrics.spend,
    adRevenue: adMetrics.revenue,
    logistics: logisticsMetrics.totalAmount,
  }
}

function buildDashboardComparisons({ listings, receipts, adRows, logisticsRows, weekStart, weekEnd, latestDate }) {
  const latestExclusive = addDays(latestDate, 1)
  const effectiveWeekEnd = new Date(Math.min(weekEnd.getTime(), latestExclusive.getTime()))
  const elapsedWeekDays = Math.max(1, Math.round((effectiveWeekEnd.getTime() - weekStart.getTime()) / DAY_MS))
  const previousWeekStart = addDays(weekStart, -7)
  const previousWeekEnd = addDays(previousWeekStart, elapsedWeekDays)

  const selectedMonthStart = startOfMonth(weekStart)
  const selectedMonthEnd = addMonths(selectedMonthStart, 1)
  const effectiveMonthEnd = new Date(Math.min(effectiveWeekEnd.getTime(), selectedMonthEnd.getTime()))
  const elapsedMonthDays = Math.max(1, Math.round((effectiveMonthEnd.getTime() - selectedMonthStart.getTime()) / DAY_MS))
  const previousMonthStart = addMonths(selectedMonthStart, -1)
  const previousMonthEnd = new Date(Math.min(addDays(previousMonthStart, elapsedMonthDays).getTime(), selectedMonthStart.getTime()))

  const weekCurrent = aggregateComparisonMetrics(listings, receipts, adRows, logisticsRows, weekStart, effectiveWeekEnd)
  const weekPrevious = aggregateComparisonMetrics(listings, receipts, adRows, logisticsRows, previousWeekStart, previousWeekEnd)
  const monthCurrent = aggregateComparisonMetrics(listings, receipts, adRows, logisticsRows, selectedMonthStart, effectiveMonthEnd)
  const monthPrevious = aggregateComparisonMetrics(listings, receipts, adRows, logisticsRows, previousMonthStart, previousMonthEnd)

  const comparisonMetric = (key, title, format, unit, tone) => ({
    key,
    title,
    format,
    unit,
    tone,
    week: comparisonValue(weekCurrent[key], weekPrevious[key]),
    month: comparisonValue(monthCurrent[key], monthPrevious[key]),
  })

  return {
    weekLabel: elapsedWeekDays < 7 ? '较上周同期' : '较上一自然周',
    monthLabel: '较上月同期',
    weekRangeLabel: `${dateKey(weekStart)} - ${dateKey(addDays(effectiveWeekEnd, -1))}`,
    previousWeekRangeLabel: `${dateKey(previousWeekStart)} - ${dateKey(addDays(previousWeekEnd, -1))}`,
    monthRangeLabel: `${dateKey(selectedMonthStart)} - ${dateKey(addDays(effectiveMonthEnd, -1))}`,
    previousMonthRangeLabel: `${dateKey(previousMonthStart)} - ${dateKey(addDays(previousMonthEnd, -1))}`,
    metrics: [
      comparisonMetric('listings', '上架产品', 'number', '个', 'blue'),
      comparisonMetric('orders', '订单', 'number', '单', 'green'),
      comparisonMetric('revenue', '订单收入', 'usd', '', 'green'),
      comparisonMetric('adSpend', '广告花费', 'usd', '', 'amber'),
      comparisonMetric('adRevenue', '广告销售额', 'usd', '', 'blue'),
      comparisonMetric('logistics', '物流费用', 'cny', '', 'amber'),
    ],
  }
}

function buildPeriodDashboard({ key, label, title, rangeLabel, listings, receipts, transactions, imageMap, adRows, logisticsRows, start, end, trends }) {
  const receiptMetrics = aggregateReceipts(receipts, start, end)
  const adMetrics = aggregateAds(adRows, start, end)
  const logisticsMetrics = aggregateLogisticsFees(logisticsRows, start, end)
  const products = buildProductPerformance(transactions, listings, imageMap, start, end)
  const bestProduct = products[0]
  const favorites = sumListingFavorites(listings)
  const views = sumListingViews(listings)
  const newListings = countListingsCreatedInRange(listings, start, end)
  const periodName =
    key === 'week'
      ? '自然周'
      : key === 'month'
        ? '本月'
        : key === 'ytd'
          ? '年初至今'
          : '单日'
  const bestProductTitle = `${periodName}最佳出品`
  const trendTitle =
    key === 'day'
      ? '最近7天每日趋势'
      : key === 'week'
        ? '近5个自然周对比'
        : key === 'ytd'
          ? 'Year to Date 月度趋势'
          : '近6个月对比'
  const nonAdOrders = Math.max(receiptMetrics.orders - adMetrics.orders, 0)
  const nonAdRevenue = Math.max(receiptMetrics.revenue - adMetrics.revenue, 0)

  return {
    period: {
      key,
      label,
      eyebrow: 'Etsy Open API v3',
      title,
      rangeLabel,
      summary: `${periodName}上架 ${numberText(newListings)} 个产品，出了 ${numberText(receiptMetrics.orders)} 单，广告花费 ${moneyText(adMetrics.spend)}，广告销售额 ${moneyText(adMetrics.revenue)}，物流费用 ${cnyMoneyText(logisticsMetrics.totalAmount, logisticsMetrics.currency)}，商品收藏 ${numberText(favorites)}。`,
      bestProductLabel: bestProductTitle,
      bestProduct: bestProduct?.productName || '暂无订单商品',
      bestProductNote: bestProduct
        ? `${numberText(bestProduct.orders)} 件 / ${moneyText(bestProduct.revenue)} 收入`
        : '当前周期内暂无交易数据。',
      trendTitle,
      sourceTitle: `${label}订单归因占比`,
      actionTitle: `${label}建议动作`,
      metrics: [
        metric('listings', `${periodName}上架产品`, numberText(newListings), `在线 ${numberText(listings.length)} 个商品`, 'blue'),
        metric('orders', `${periodName}订单`, numberText(receiptMetrics.orders), `广告 ${numberText(adMetrics.orders)} 单 / 已付款 ${numberText(receiptMetrics.paid)} 单`, 'green'),
        metric('adSpend', '广告花费', moneyText(adMetrics.spend), `站内广告点击 ${numberText(adMetrics.clicks)} 次 / CPC ${moneyText(adMetrics.cpc)}`, 'amber'),
        metric('adRevenue', '广告销售额', moneyText(adMetrics.revenue), `广告订单 ${numberText(adMetrics.orders)} 单 / ROAS ${adMetrics.roas.toFixed(2)}`, 'blue'),
        metric('favorites', '商品收藏数', numberText(favorites), '来自 active listings 当前收藏数', 'red'),
        metric('logistics', '物流费用', cnyMoneyText(logisticsMetrics.totalAmount, logisticsMetrics.currency), `${numberText(logisticsMetrics.orders)} 单 / 来自 n8n 物流表`, 'amber'),
        metric('best', bestProductTitle, bestProduct ? bestProduct.productName.slice(0, 24) : '暂无', bestProduct?.note || '暂无交易', 'blue'),
      ],
      trends,
      trafficSources: [
        {
          name: '非广告 / 未归因订单',
          type: '非广告或未归因',
          visits: Math.max(views - adMetrics.views, 0),
          orders: nonAdOrders,
          revenue: Number(nonAdRevenue.toFixed(2)),
        },
        {
          name: '站内广告订单',
          type: '广告订单',
          visits: adMetrics.views,
          orders: adMetrics.orders,
          revenue: adMetrics.revenue,
        },
      ],
    },
    products,
  }
}

async function etsyFetchAll(apiPath, fileName, options = {}) {
  const limit = Number(options.limit || 100)
  const maxPages = Number(options.maxPages || 10)
  const skipCache = Boolean(options.skipCache)
  let offset = 0
  let count = null
  const rows = []

  try {
    for (let page = 0; page < maxPages; page += 1) {
      const separator = apiPath.includes('?') ? '&' : '?'
      const data = await etsyFetch(`${apiPath}${separator}limit=${limit}&offset=${offset}`)
      const results = getResults(data)

      rows.push(...results)
      if (typeof data?.count === 'number') count = data.count
      if (results.length < limit) break
      if (count != null && rows.length >= count) break
      offset += limit
    }

    const payload = { count: count ?? rows.length, results: rows, __source: 'live' }
    if (fileName && !skipCache) await writeJson(fileName, payload)
    return payload
  } catch (error) {
    const cached = fileName && !skipCache ? await readOptionalJson(fileName, null) : null
    if (cached) {
      console.warn(`[etsy api cache] ${fileName} 使用上次 Etsy API 缓存:`, error.message)
      return {
        ...cached,
        __source: 'cache',
        __cacheReason: error.message,
      }
    }

    throw error
  }
}

function isMissingEtsySetupError(error) {
  const message = String(error?.message || '')
  return (
    message.includes('etsy-shops.json') ||
    message.includes('etsy-token.json') ||
    message.includes('OAuth') ||
    message.includes('ETSY_KEYSTRING') ||
    message.includes('ETSY_SHARED_SECRET') ||
    message.includes('ETSY_REDIRECT_URI') ||
    message.includes('shop_id')
  )
}

async function fetchDashboardSourceData() {
  try {
    const shopId = await getSavedShopId()
    const [listingsPayload, receiptsPayload, transactionsPayload] = await Promise.all([
      etsyFetchAll(`/shops/${shopId}/listings/active`, 'etsy-listings.json'),
      etsyFetchAll(`/shops/${shopId}/receipts`, 'etsy-receipts.json'),
      etsyFetchAll(`/shops/${shopId}/transactions`, 'etsy-transactions.json'),
    ])
    const payloads = [listingsPayload, receiptsPayload, transactionsPayload]
    const usedCache = payloads.some((payload) => payload.__source === 'cache')

    return {
      listings: getResults(listingsPayload),
      receipts: getResults(receiptsPayload),
      transactions: getResults(transactionsPayload),
      syncSource: usedCache ? 'cache' : 'live',
      cacheReasons: payloads.map((payload) => payload.__cacheReason).filter(Boolean),
    }
  } catch (error) {
    if (!isMissingEtsySetupError(error)) throw error
    console.warn('[etsy setup missing] dashboard using empty data:', error.message)
    return {
      listings: [],
      receipts: [],
      transactions: [],
      syncSource: 'setup-missing',
      cacheReasons: [error.message],
    }
  }
}

async function buildDashboardData(endDateValue) {
  const { listings, receipts, transactions, syncSource, cacheReasons } = await fetchDashboardSourceData()
  const adReport = await fetchAdReportData()
  const adRows = adReport.rows || []
  const logisticsReport = await fetchLogisticsFeeData()
  const logisticsRows = logisticsReport.rows || []
  const imageMap = await getListingImageMap(listings)
  let listingSnapshot = null
  try {
    listingSnapshot = await recordListingSnapshot(listings, imageMap)
  } catch (error) {
    console.warn('[listing snapshot error]', error.message)
  }
  const fulfillment = buildFulfillmentStatus(receipts, transactions, listings, imageMap, logisticsRows)
  const receiptDates = receipts
    .map((receipt) => timestampMs(receipt))
    .filter(Boolean)
    .map((ms) => dateKey(startOfDay(new Date(ms))))
    .sort()
  const adDates = adRows.map((row) => row.date).filter(Boolean).sort()
  const logisticsDates = logisticsRows.map((row) => row.date).filter(Boolean).sort()
  const todayKey = dateKeyInTimeZone(new Date())
  const availableDates = [...new Set([...receiptDates, ...adDates, ...logisticsDates, todayKey])].sort()
  const latestDate = availableDates.at(-1) || todayKey
  const selectedDate = dateKey(parseDateKey(endDateValue, parseDateKey(latestDate, startOfDay(new Date()))))
  const endDate = parseDateKey(selectedDate, startOfDay(new Date()))

  const dayStart = endDate
  const weekStart = startOfWeek(endDate)
  const weekEnd = addDays(weekStart, 7)
  const monthStart = startOfMonth(endDate)
  const yearStart = startOfYear(endDate)
  const monthEnd = addDays(endDate, 1)

  const day = buildPeriodDashboard({
    key: 'day',
    label: '按日',
    title: '单日经营总览',
    rangeLabel: selectedDate,
    listings,
    receipts,
    transactions,
    imageMap,
    adRows,
    logisticsRows,
    start: dayStart,
    end: addDays(dayStart, 1),
    trends: buildDayTrends(listings, receipts, adRows, logisticsRows, endDate),
  })
  const week = buildPeriodDashboard({
    key: 'week',
    label: '自然周',
    title: '自然周经营总览',
    rangeLabel: `${dateKey(weekStart)} - ${dateKey(addDays(weekEnd, -1))}`,
    listings,
    receipts,
    transactions,
    imageMap,
    adRows,
    logisticsRows,
    start: weekStart,
    end: weekEnd,
    trends: buildWeekTrends(listings, receipts, adRows, logisticsRows, endDate),
  })
  week.period.comparisons = buildDashboardComparisons({
    listings,
    receipts,
    adRows,
    logisticsRows,
    weekStart,
    weekEnd,
    latestDate: parseDateKey(latestDate, endDate),
  })
  const month = buildPeriodDashboard({
    key: 'month',
    label: '本月',
    title: '本月经营总览',
    rangeLabel: `${dateKey(monthStart)} - ${selectedDate}`,
    listings,
    receipts,
    transactions,
    imageMap,
    adRows,
    logisticsRows,
    start: monthStart,
    end: monthEnd,
    trends: buildMonthTrends(listings, receipts, adRows, logisticsRows, endDate),
  })
  const ytd = buildPeriodDashboard({
    key: 'ytd',
    label: 'Year to Date',
    title: 'Year to Date 经营总览',
    rangeLabel: `${dateKey(yearStart)} - ${selectedDate}`,
    listings,
    receipts,
    transactions,
    imageMap,
    adRows,
    logisticsRows,
    start: yearStart,
    end: monthEnd,
    trends: buildYearToDateTrends(listings, receipts, adRows, logisticsRows, endDate),
  })
  const adDay = aggregateAds(adRows, dayStart, addDays(dayStart, 1))
  const adWeek = aggregateAds(adRows, weekStart, weekEnd)
  const adMonth = aggregateAds(adRows, monthStart, monthEnd)
  const adYtd = aggregateAds(adRows, yearStart, monthEnd)
  const logisticsDay = aggregateLogisticsFees(logisticsRows, dayStart, addDays(dayStart, 1))
  const logisticsWeek = aggregateLogisticsFees(logisticsRows, weekStart, weekEnd)
  const logisticsMonth = aggregateLogisticsFees(logisticsRows, monthStart, monthEnd)
  const logisticsYtd = aggregateLogisticsFees(logisticsRows, yearStart, monthEnd)
  const isSetupMissing = syncSource === 'setup-missing'
  const syncStatus = isSetupMissing ? 'cached' : syncSource === 'cache' ? 'cached' : 'synced'
  const syncLatestFile = isSetupMissing
    ? ''
    : syncSource === 'cache'
      ? 'Etsy Open API v3 本地缓存'
      : 'Etsy Open API v3 + 广告报表'
  const syncMessage = isSetupMissing
    ? '当前展示备用数据；完成 Etsy 授权后刷新即可同步真实数据。'
    : syncSource === 'cache'
      ? `Etsy API 本次同步受限，已使用上次 API 缓存：${numberText(listings.length)} 个商品，${numberText(receipts.length)} 个订单，${numberText(transactions.length)} 条交易；${adReport.message}；${logisticsReport.message}。${cacheReasons[0] || ''}`
      : `已同步 Etsy API：${numberText(listings.length)} 个商品，${numberText(receipts.length)} 个订单，${numberText(transactions.length)} 条交易；${adReport.message}；${logisticsReport.message}`

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    sourceDir: 'Etsy Open API v3',
    availableDates: availableDates.length ? availableDates : [latestDate],
    selectedDate,
    latestDate,
    files: [
      { date: latestDate, name: 'etsy-listings.json', path: dataPath('etsy-listings.json') },
      { date: latestDate, name: 'etsy-receipts.json', path: dataPath('etsy-receipts.json') },
      { date: latestDate, name: 'etsy-transactions.json', path: dataPath('etsy-transactions.json') },
      { date: latestDate, name: 'etsy-listing-images.json', path: dataPath('etsy-listing-images.json') },
      { date: listingSnapshot?.date || latestDate, name: 'etsy-listing-snapshots.json', path: dataPath('etsy-listing-snapshots.json') },
      { date: adDates.at(-1) || latestDate, name: adReport.sourceFile || 'etsy-ads.json', path: adReport.sourcePath || dataPath('etsy-ads.json') },
      { date: logisticsDates.at(-1) || latestDate, name: 'logistics-fees.json', path: dataPath('logistics-fees.json') },
    ],
    periods: {
      day: day.period,
      week: week.period,
      month: month.period,
      ytd: ytd.period,
    },
    products: {
      day: day.products,
      week: week.products,
      month: month.products,
      ytd: ytd.products,
    },
    fulfillment,
    ads: {
      status: adReport.status,
      message: adReport.message,
      sourceDir: adReport.sourceDir,
      sourceFile: adReport.sourceFile,
      sourcePath: adReport.sourcePath,
      updatedAt: adReport.updatedAt,
      latestDate: adDates.at(-1) || '',
      rows: adRows,
      periods: {
        day: adDay,
        week: adWeek,
        month: adMonth,
        ytd: adYtd,
      },
    },
    logistics: {
      status: logisticsReport.status,
      message: logisticsReport.message,
      sourceUrl: logisticsReport.sourceUrl,
      updatedAt: logisticsReport.updatedAt,
      latestDate: logisticsDates.at(-1) || '',
      rows: logisticsRows,
      periods: {
        day: logisticsDay,
        week: logisticsWeek,
        month: logisticsMonth,
        ytd: logisticsYtd,
      },
    },
    sync: {
      status: syncSource === 'setup-missing' ? 'cached' : syncSource === 'cache' ? 'cached' : 'synced',
      fileCount: isSetupMissing ? 0 : adRows.length > 0 ? 7 : 6,
      latestFile: syncLatestFile,
      message: syncMessage,
    },
  }
}

async function getDashboardData(endDateValue, options = {}) {
  const fallbackDate = startOfDay(new Date())
  const normalizedEndDate = endDateValue ? dateKey(parseDateKey(endDateValue, fallbackDate)) : ''
  const cacheKey = normalizedEndDate || 'latest'
  const now = Date.now()
  const cached = dashboardCache.get(cacheKey)

  if (!options.force && cached && now - cached.createdAt < DASHBOARD_CACHE_TTL_MS) {
    return {
      ...cached.data,
      cache: {
        status: 'memory',
        ageSeconds: Math.round((now - cached.createdAt) / 1000),
        ttlSeconds: Math.round(DASHBOARD_CACHE_TTL_MS / 1000),
      },
    }
  }

  if (!options.force && dashboardBuilds.has(cacheKey)) {
    return dashboardBuilds.get(cacheKey)
  }

  const build = buildDashboardData(normalizedEndDate || undefined).then((data) => {
    const cacheEntry = {
      createdAt: Date.now(),
      data,
    }
    dashboardCache.set(cacheKey, cacheEntry)
    if (data.selectedDate) dashboardCache.set(data.selectedDate, cacheEntry)
    if (data.selectedDate && data.selectedDate === data.latestDate) dashboardCache.set('latest', cacheEntry)
    return {
      ...data,
      cache: {
        status: 'fresh',
        ageSeconds: 0,
        ttlSeconds: Math.round(DASHBOARD_CACHE_TTL_MS / 1000),
      },
    }
  }).finally(() => {
    dashboardBuilds.delete(cacheKey)
  })

  dashboardBuilds.set(cacheKey, build)
  return build
}

const FINANCE_PAYMENT_FEE_TYPES = new Set([
  'PAYMENT_PROCESSING_FEE',
  'transaction',
  'transaction_quantity',
  'buyer_fee',
])
const FINANCE_LISTING_FEE_TYPES = new Set(['listing', 'renew_sold_auto'])
const FINANCE_AD_LEDGER_TYPES = new Set(['prolist'])
const FINANCE_TAX_TYPES = new Set(['sales_tax'])
const FINANCE_DISBURSEMENT_TYPES = new Set(['DISBURSE2'])

const FINANCE_LEDGER_TYPE_LABELS = {
  PAYMENT_GROSS: '订单入账',
  PAYMENT_PROCESSING_FEE: '支付手续费',
  transaction: '交易手续费',
  transaction_quantity: '交易数量费',
  buyer_fee: '买家相关费用',
  listing: 'Listing 上架费',
  renew_sold_auto: '自动续费',
  prolist: 'Etsy 广告扣费',
  sales_tax: '销售税',
  DISBURSE2: '打款/提现',
}

function financeMoneyNumber(value) {
  if (value == null) return 0
  if (typeof value === 'object' && 'amount' in value && 'divisor' in value) {
    return Number(value.amount || 0) / Number(value.divisor || 100)
  }
  return Number(value || 0) / 100
}

function financeMoneyCurrency(value, fallback = '') {
  if (!value || typeof value !== 'object') return fallback
  return value.currency_code || value.currency || fallback
}

function financeLedgerAmount(row) {
  return Number(row?.amount || 0) / 100
}

function financeLedgerDate(row) {
  const raw = Number(row?.created_timestamp || row?.create_date || 0)
  if (!raw) return ''
  return dateKeyInTimeZone(new Date(raw > 1000000000000 ? raw : raw * 1000))
}

function financePaymentDate(payment) {
  const raw = Number(payment?.created_timestamp || payment?.create_timestamp || 0)
  if (!raw) return ''
  return dateKeyInTimeZone(new Date(raw > 1000000000000 ? raw : raw * 1000))
}

function financeLedgerCategory(row) {
  const type = String(row?.ledger_type || '')
  if (type === 'PAYMENT_GROSS') return 'orderGross'
  if (FINANCE_PAYMENT_FEE_TYPES.has(type)) return 'paymentFees'
  if (FINANCE_LISTING_FEE_TYPES.has(type)) return 'listingFees'
  if (FINANCE_AD_LEDGER_TYPES.has(type)) return 'adFees'
  if (FINANCE_TAX_TYPES.has(type)) return 'taxes'
  if (FINANCE_DISBURSEMENT_TYPES.has(type)) return 'disbursements'
  return 'other'
}

function financeLedgerTypeLabel(type) {
  return FINANCE_LEDGER_TYPE_LABELS[type] || type || '其他'
}

function financeSignedAmountText(amount, currency = 'USD') {
  const sign = amount < 0 ? '-' : ''
  return `${sign}${currency} ${Math.abs(Number(amount || 0)).toFixed(2)}`
}

function financeRowsInRange(rows, start, end) {
  return rows.filter((row) => {
    const date = row.date || financeLedgerDate(row) || financePaymentDate(row)
    if (!date) return false
    const time = parseDateKey(date, new Date(0)).getTime()
    return time >= start.getTime() && time < end.getTime()
  })
}

function fallbackUsdCnyRate(reason = '') {
  return {
    base: 'USD',
    quote: 'CNY',
    rate: Number(FALLBACK_USD_CNY_RATE || 7.2),
    updatedAt: new Date().toISOString(),
    source: reason ? `fallback:${reason}` : 'fallback',
    isFallback: true,
  }
}

async function fetchUsdCnyExchangeRate() {
  const envRate = Number(process.env.USD_CNY_RATE || 0)
  if (envRate > 0) {
    return {
      base: 'USD',
      quote: 'CNY',
      rate: Number(envRate.toFixed(4)),
      updatedAt: new Date().toISOString(),
      source: 'env:USD_CNY_RATE',
      isFallback: false,
    }
  }

  const now = Date.now()
  if (usdCnyRateCache && now - usdCnyRateCache.cachedAt < USD_CNY_RATE_TTL_MS) {
    return usdCnyRateCache.value
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const payload = await response.json()
    const rate = Number(payload?.rates?.CNY || 0)
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('missing CNY rate')

    const value = {
      base: 'USD',
      quote: 'CNY',
      rate: Number(rate.toFixed(4)),
      updatedAt: payload?.time_last_update_utc || new Date().toISOString(),
      source: 'open.er-api.com',
      isFallback: false,
    }

    usdCnyRateCache = { cachedAt: now, value }
    return value
  } catch (error) {
    const value = usdCnyRateCache?.value || fallbackUsdCnyRate(error.message)
    if (!usdCnyRateCache) usdCnyRateCache = { cachedAt: now, value }
    return value
  } finally {
    clearTimeout(timeout)
  }
}

function logisticsCostToUsd(amount, currency, exchangeRate) {
  const value = Number(amount || 0)
  const normalizedCurrency = String(currency || 'CNY').toUpperCase()
  const rate = Number(exchangeRate?.rate || FALLBACK_USD_CNY_RATE || 7.2)
  if (!value) return 0
  if (normalizedCurrency === 'USD') return Number(value.toFixed(2))
  return Number((value / rate).toFixed(2))
}

function summarizeFinanceLedger(ledgerRows, adRows, logisticsRows, start, end, exchangeRate = fallbackUsdCnyRate()) {
  const rows = financeRowsInRange(ledgerRows, start, end)
  const adMetrics = aggregateAds(adRows, start, end)
  const logisticsMetrics = aggregateLogisticsFees(logisticsRows, start, end)
  const logisticsCostUsd = logisticsCostToUsd(logisticsMetrics.totalAmount, logisticsMetrics.currency, exchangeRate)
  const totals = {
    orderGross: 0,
    paymentFees: 0,
    listingFees: 0,
    etsyFees: 0,
    taxes: 0,
    ledgerAdSpend: 0,
    adSpend: Number(adMetrics.spend || 0),
    logisticsCost: logisticsMetrics.totalAmount,
    logisticsCostUsd,
    logisticsOrders: logisticsMetrics.orders,
    logisticsCurrency: logisticsMetrics.currency,
    usdCnyRate: Number(exchangeRate.rate || FALLBACK_USD_CNY_RATE || 7.2),
    exchangeRateSource: exchangeRate.source || 'fallback',
    exchangeRateUpdatedAt: exchangeRate.updatedAt || '',
    exchangeRateIsFallback: Boolean(exchangeRate.isFallback),
    disbursements: 0,
    other: 0,
    ledgerNetChangeExcludingDisbursement: 0,
    estimatedProfitExcludingLogistics: 0,
    estimatedProfit: 0,
    profitMargin: 0,
    orders: 0,
    ledgerRows: rows.length,
    currency: rows.find((row) => row.currency)?.currency || 'USD',
  }
  const paymentIds = new Set()

  for (const row of rows) {
    const amount = financeLedgerAmount(row)
    const category = financeLedgerCategory(row)

    if (row.ledger_type === 'PAYMENT_GROSS') {
      totals.orderGross += amount
      if (row.reference_id) paymentIds.add(String(row.reference_id))
    } else if (category === 'paymentFees') {
      totals.paymentFees += Math.abs(amount)
    } else if (category === 'listingFees') {
      totals.listingFees += Math.abs(amount)
    } else if (category === 'taxes') {
      totals.taxes += Math.abs(amount)
    } else if (category === 'adFees') {
      totals.ledgerAdSpend += Math.abs(amount)
    } else if (category === 'disbursements') {
      totals.disbursements += Math.abs(amount)
    } else {
      totals.other += amount
    }

    if (category !== 'disbursements') totals.ledgerNetChangeExcludingDisbursement += amount
  }

  totals.etsyFees = totals.paymentFees + totals.listingFees
  totals.orders = paymentIds.size
  totals.estimatedProfitExcludingLogistics = totals.orderGross - totals.etsyFees - totals.taxes - totals.adSpend
  totals.estimatedProfit = totals.estimatedProfitExcludingLogistics - totals.logisticsCostUsd
  totals.profitMargin = totals.orderGross > 0
    ? (totals.estimatedProfit / totals.orderGross) * 100
    : 0

  for (const key of Object.keys(totals)) {
    if (typeof totals[key] === 'number') totals[key] = Number(totals[key].toFixed(2))
  }

  return totals
}

function buildFinanceMetric(key, title, value, note, tone = 'blue') {
  return { key, title, value, note, tone }
}

function buildFinanceTrend(ledgerRows, adRows, logisticsRows, start, end, exchangeRate) {
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS))
  return Array.from({ length: days }, (_, index) => {
    const dayStart = addDays(start, index)
    const dayEnd = addDays(dayStart, 1)
    const summary = summarizeFinanceLedger(ledgerRows, adRows, logisticsRows, dayStart, dayEnd, exchangeRate)
    return {
      label: shortDateLabel(dayStart),
      rangeLabel: dateKey(dayStart),
      orderGross: summary.orderGross,
      etsyFees: summary.etsyFees,
      taxes: summary.taxes,
      adSpend: summary.adSpend,
      logisticsCost: summary.logisticsCost,
      logisticsCostUsd: summary.logisticsCostUsd,
      estimatedProfitExcludingLogistics: summary.estimatedProfitExcludingLogistics,
      estimatedProfit: summary.estimatedProfit,
      orders: summary.orders,
    }
  })
}

function buildFinanceMonthlyTrend(ledgerRows, adRows, logisticsRows, start, end, exchangeRate) {
  const months = []

  for (let monthStart = startOfMonth(start); monthStart < end; monthStart = addMonths(monthStart, 1)) {
    const monthEnd = new Date(Math.min(addMonths(monthStart, 1).getTime(), end.getTime()))
    const summary = summarizeFinanceLedger(ledgerRows, adRows, logisticsRows, monthStart, monthEnd, exchangeRate)

    months.push({
      label: monthLabel(monthStart),
      rangeLabel: `${dateKey(monthStart)} - ${dateKey(addDays(monthEnd, -1))}`,
      orderGross: summary.orderGross,
      etsyFees: summary.etsyFees,
      taxes: summary.taxes,
      adSpend: summary.adSpend,
      logisticsCost: summary.logisticsCost,
      logisticsCostUsd: summary.logisticsCostUsd,
      estimatedProfitExcludingLogistics: summary.estimatedProfitExcludingLogistics,
      estimatedProfit: summary.estimatedProfit,
      orders: summary.orders,
    })
  }

  return months
}

function financeComparisonValue(currentValue, previousValue) {
  const current = Number(currentValue || 0)
  const previous = Number(previousValue || 0)
  const change = Number((current - previous).toFixed(2))
  const percentChange = previous === 0
    ? current === 0
      ? 0
      : null
    : Number(((change / Math.abs(previous)) * 100).toFixed(1))

  return {
    current: Number(current.toFixed(2)),
    previous: Number(previous.toFixed(2)),
    change,
    percentChange,
  }
}

function buildFinanceOrderGrossComparison({ ledgerRows, adRows, logisticsRows, weekStart, weekEnd, latestDate, exchangeRate }) {
  const latestExclusive = addDays(latestDate, 1)
  const effectiveWeekEnd = new Date(Math.min(weekEnd.getTime(), latestExclusive.getTime()))
  const safeCurrentEnd = effectiveWeekEnd > weekStart ? effectiveWeekEnd : addDays(weekStart, 1)
  const elapsedWeekDays = Math.max(1, Math.round((safeCurrentEnd.getTime() - weekStart.getTime()) / DAY_MS))
  const previousWeekStart = addDays(weekStart, -7)
  const previousWeekEnd = addDays(previousWeekStart, elapsedWeekDays)
  const current = summarizeFinanceLedger(ledgerRows, adRows, logisticsRows, weekStart, safeCurrentEnd, exchangeRate).orderGross
  const previous = summarizeFinanceLedger(ledgerRows, adRows, logisticsRows, previousWeekStart, previousWeekEnd, exchangeRate).orderGross

  return {
    label: elapsedWeekDays < 7 ? '较上个自然周同期' : '较上个自然周',
    currentRangeLabel: `${dateKey(weekStart)} - ${dateKey(addDays(safeCurrentEnd, -1))}`,
    previousRangeLabel: `${dateKey(previousWeekStart)} - ${dateKey(addDays(previousWeekEnd, -1))}`,
    ...financeComparisonValue(current, previous),
  }
}

function buildFinanceBreakdown(summary) {
  return [
    { key: 'paymentFees', name: '支付/交易手续费', amount: Number(summary.paymentFees || 0) },
    { key: 'listingFees', name: '上架/自动续费', amount: Number(summary.listingFees || 0) },
    { key: 'adSpend', name: '广告花费 CSV', amount: Number(summary.adSpend || 0) },
    { key: 'taxes', name: '销售税', amount: Number(summary.taxes || 0) },
    { key: 'ledgerAdSpend', name: 'Ledger 广告扣费', amount: Number(summary.ledgerAdSpend || 0) },
  ].filter((item) => item.amount > 0)
}

function normalizeFinanceLedgerRows(ledgerRows) {
  return ledgerRows
    .map((row) => {
      const amount = financeLedgerAmount(row)
      const type = String(row.ledger_type || '')
      return {
        entryId: String(row.entry_id || ''),
        ledgerId: String(row.ledger_id || ''),
        date: financeLedgerDate(row),
        type,
        typeLabel: financeLedgerTypeLabel(type),
        category: financeLedgerCategory(row),
        amount: Number(amount.toFixed(2)),
        amountText: financeSignedAmountText(amount, row.currency || 'USD'),
        currency: row.currency || 'USD',
        balance: Number(financeLedgerAmount({ amount: row.balance }).toFixed(2)),
        balanceText: financeSignedAmountText(financeLedgerAmount({ amount: row.balance }), row.currency || 'USD'),
        description: row.description || '',
        referenceType: row.reference_type || '',
        referenceId: String(row.reference_id || ''),
        parentEntryId: String(row.parent_entry_id || ''),
      }
    })
    .sort((a, b) => b.date.localeCompare(a.date) || Number(b.entryId) - Number(a.entryId))
}

function normalizeFinanceLogisticsRows(logisticsRows, start, end) {
  return logisticsRows
    .filter((row) => {
      const rowTime = logisticsRowDateMs(row)
      return rowTime >= start.getTime() && rowTime < end.getTime()
    })
    .map((row, index) => ({
      logisticsKey: `${row.orderNo || 'unknown'}-${row.trackingNo || index}`,
      orderNo: normalizeOrderNo(row.orderNo),
      trackingNo: row.trackingNo || '',
      receivedAt: row.receivedAt || '',
      date: row.date || '',
      shippingMethod: row.shippingMethod || '',
      country: row.country || '',
      weight: Number(row.weight || 0),
      unitPrice: Number(row.unitPrice || 0),
      totalAmount: Number(row.totalAmount || 0),
      currency: row.currency || 'CNY',
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.orderNo.localeCompare(a.orderNo))
}

function buildLedgerLookup(ledgerRows) {
  const byPaymentId = new Map()
  const taxByReceiptId = new Map()

  for (const row of ledgerRows) {
    const referenceId = String(row.reference_id || '')
    if (!referenceId) continue

    if (row.reference_type === 'shop_payment' || row.reference_type === 'processing_fee') {
      if (!byPaymentId.has(referenceId)) byPaymentId.set(referenceId, [])
      byPaymentId.get(referenceId).push(row)
    }

    if (row.reference_type === 'receipt' && FINANCE_TAX_TYPES.has(String(row.ledger_type || ''))) {
      if (!taxByReceiptId.has(referenceId)) taxByReceiptId.set(referenceId, [])
      taxByReceiptId.get(referenceId).push(row)
    }
  }

  return { byPaymentId, taxByReceiptId }
}

function normalizeFinanceOrderRows(payments, ledgerRows, logisticsRows, start, end) {
  const { byPaymentId, taxByReceiptId } = buildLedgerLookup(ledgerRows)
  const logisticsFeeByOrderNo = buildLogisticsFeeByOrderNo(logisticsRows)
  const periodPayments = payments.filter((payment) => {
    const date = financePaymentDate(payment)
    if (!date) return false
    const time = parseDateKey(date, new Date(0)).getTime()
    return time >= start.getTime() && time < end.getTime()
  })

  return periodPayments
    .map((payment) => {
      const paymentId = String(payment.payment_id || '')
      const receiptId = String(payment.receipt_id || '')
      const paymentLedgerRows = byPaymentId.get(paymentId) || []
      const taxRows = taxByReceiptId.get(receiptId) || []
      const ledgerGross = paymentLedgerRows
        .filter((row) => row.ledger_type === 'PAYMENT_GROSS')
        .reduce((sum, row) => sum + financeLedgerAmount(row), 0)
      const ledgerProcessingFees = paymentLedgerRows
        .filter((row) => row.ledger_type === 'PAYMENT_PROCESSING_FEE')
        .reduce((sum, row) => sum + Math.abs(financeLedgerAmount(row)), 0)
      const taxes = taxRows.reduce((sum, row) => sum + Math.abs(financeLedgerAmount(row)), 0)
      const gross = financeMoneyNumber(payment.amount_gross)
      const fees = financeMoneyNumber(payment.amount_fees)
      const net = financeMoneyNumber(payment.amount_net)
      const buyerCurrency = financeMoneyCurrency(payment.amount_gross, payment.buyer_currency || '')
      const logisticsFee = logisticsFeeByOrderNo.get(normalizeOrderNo(receiptId)) || null

      return {
        paymentId,
        receiptId,
        date: financePaymentDate(payment),
        status: payment.status || '',
        buyerCurrency,
        shopCurrency: payment.shop_currency || payment.currency || 'USD',
        amountGross: Number(gross.toFixed(2)),
        amountFees: Number(fees.toFixed(2)),
        amountNet: Number(net.toFixed(2)),
        amountGrossText: `${buyerCurrency || payment.buyer_currency || ''} ${gross.toFixed(2)}`.trim(),
        amountFeesText: `${buyerCurrency || payment.buyer_currency || ''} ${fees.toFixed(2)}`.trim(),
        amountNetText: `${buyerCurrency || payment.buyer_currency || ''} ${net.toFixed(2)}`.trim(),
        ledgerGross: Number(ledgerGross.toFixed(2)),
        ledgerProcessingFees: Number(ledgerProcessingFees.toFixed(2)),
        ledgerSalesTax: Number(taxes.toFixed(2)),
        ledgerNetEstimate: Number((ledgerGross - ledgerProcessingFees - taxes).toFixed(2)),
        logisticsCost: logisticsFee?.totalAmount ?? null,
        logisticsMatched: Boolean(logisticsFee),
        logisticsStatus: logisticsFee ? '已匹配' : '未匹配',
        logisticsUnitPrice: logisticsFee?.unitPrice || 0,
        logisticsTotalAmount: logisticsFee?.totalAmount || 0,
        logisticsCurrency: logisticsFee?.currency || 'CNY',
        logisticsWeight: logisticsFee?.weight || 0,
        logisticsTrackingNo: logisticsFee?.trackingNo || '',
        logisticsTrackingNos: logisticsFee?.trackingNos || [],
        logisticsReceivedAt: logisticsFee?.receivedAt || '',
        logisticsShippingMethod: logisticsFee?.shippingMethod || '',
        logisticsCountry: logisticsFee?.country || '',
      }
    })
    .sort((a, b) => b.date.localeCompare(a.date) || Number(b.receiptId) - Number(a.receiptId))
}

async function fetchFinancePayments(shopId, paymentIds) {
  const uniqueIds = [...new Set(paymentIds.map(String).filter(Boolean))]
  if (uniqueIds.length === 0) {
    const payload = { count: 0, results: [], __source: 'live' }
    await writeJson('etsy-payments.json', payload)
    return payload
  }

  try {
    const rows = []
    for (let index = 0; index < uniqueIds.length; index += 25) {
      const chunk = uniqueIds.slice(index, index + 25)
      const query = new URLSearchParams({
        payment_ids: chunk.join(','),
        limit: '100',
        offset: '0',
      })
      const data = await etsyFetch(`/shops/${shopId}/payments?${query.toString()}`)
      rows.push(...getResults(data))
    }

    const payload = { count: rows.length, results: rows, __source: 'live' }
    await writeJson('etsy-payments.json', payload)
    return payload
  } catch (error) {
    const cached = await readOptionalJson('etsy-payments.json', null)
    if (cached) {
      console.warn('[etsy api cache] etsy-payments.json 使用上次 Etsy API 缓存:', error.message)
      return {
        ...cached,
        __source: 'cache',
        __cacheReason: error.message,
      }
    }
    throw error
  }
}

const FINANCE_LEDGER_MAX_WINDOW_DAYS = 31

function financeLedgerRowKey(row) {
  const entryId = String(row?.entry_id || '')
  if (entryId) return `entry:${entryId}`
  const ledgerId = String(row?.ledger_id || '')
  if (ledgerId) return `ledger:${ledgerId}`
  return [
    row?.create_date || row?.created_timestamp || row?.date || '',
    row?.ledger_type || '',
    row?.reference_type || '',
    row?.reference_id || '',
    row?.amount?.amount || row?.amount || '',
    row?.currency || row?.amount?.currency_code || '',
  ].join('|')
}

async function fetchFinanceLedgerPayload(shopId, endDate, startDate) {
  const rangeStart = startDate || addDays(endDate, -29)
  const rangeEndExclusive = addDays(endDate, 1)
  const rows = []

  if (rangeStart >= rangeEndExclusive) {
    const payload = { count: 0, results: [], __source: 'live' }
    await writeJson('etsy-ledger.json', payload)
    return payload
  }

  try {
    for (let cursor = new Date(rangeStart); cursor < rangeEndExclusive;) {
      const chunkEnd = new Date(Math.min(
        addDays(cursor, FINANCE_LEDGER_MAX_WINDOW_DAYS).getTime(),
        rangeEndExclusive.getTime(),
      ))
      const minCreated = Math.floor(cursor.getTime() / 1000)
      const maxCreated = Math.floor(chunkEnd.getTime() / 1000)
      const apiPath = `/shops/${shopId}/payment-account/ledger-entries?min_created=${minCreated}&max_created=${maxCreated}`
      const chunkPayload = await etsyFetchAll(apiPath, null, { limit: 100, maxPages: 50, skipCache: true })

      rows.push(...getResults(chunkPayload))
      if (chunkEnd <= cursor) break
      cursor = chunkEnd
    }

    const seen = new Set()
    const dedupedRows = rows.filter((row) => {
      const key = financeLedgerRowKey(row)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    const payload = { count: dedupedRows.length, results: dedupedRows, __source: 'live' }
    await writeJson('etsy-ledger.json', payload)
    return payload
  } catch (error) {
    const cached = await readOptionalJson('etsy-ledger.json', null)
    if (cached) {
      console.warn('[etsy api cache] etsy-ledger.json 使用上次 Etsy API 缓存:', error.message)
      return {
        ...cached,
        __source: 'cache',
        __cacheReason: error.message,
      }
    }
    throw error
  }
}

async function fetchFinanceSourceData(endDate, startDate) {
  try {
    const shopId = await getSavedShopId()
    const ledgerPayload = await fetchFinanceLedgerPayload(shopId, endDate, startDate)
    const ledgerRows = getResults(ledgerPayload)
    const paymentIds = ledgerRows
      .filter((row) => row.reference_type === 'shop_payment' || row.reference_type === 'processing_fee')
      .map((row) => row.reference_id)
      .filter(Boolean)
    const paymentsPayload = await fetchFinancePayments(shopId, paymentIds)
    const payloads = [ledgerPayload, paymentsPayload]
    const usedCache = payloads.some((payload) => payload.__source === 'cache')

    return {
      shopId,
      ledgerRows,
      payments: getResults(paymentsPayload),
      syncSource: usedCache ? 'cache' : 'live',
      cacheReasons: payloads.map((payload) => payload.__cacheReason).filter(Boolean),
    }
  } catch (error) {
    if (!isMissingEtsySetupError(error)) throw error
    console.warn('[etsy setup missing] finance using empty data:', error.message)
    return {
      shopId: '',
      ledgerRows: [],
      payments: [],
      syncSource: 'setup-missing',
      cacheReasons: [error.message],
    }
  }
}

function buildFinancePeriod({ key, label, title, rangeLabel, ledgerRows, payments, adRows, logisticsRows, start, end, comparison, exchangeRate }) {
  const summary = summarizeFinanceLedger(ledgerRows, adRows, logisticsRows, start, end, exchangeRate)
  const orderRows = normalizeFinanceOrderRows(payments, ledgerRows, logisticsRows, start, end)
  const periodLedgerRows = normalizeFinanceLedgerRows(financeRowsInRange(ledgerRows, start, end))
  const periodLogisticsRows = normalizeFinanceLogisticsRows(logisticsRows, start, end)
  const currency = summary.currency || 'USD'
  const periodName = key === 'day' ? '单日' : key === 'week' ? '自然周' : key === 'month' ? '统计月份' : 'Year to Date'
  const metricCurrency = currency
  const metrics = [
    buildFinanceMetric('gross', '订单入账', moneyText(summary.orderGross), `${numberText(summary.orders)} 笔 payment gross`, 'green'),
    buildFinanceMetric('etsyFees', 'Etsy 扣费', moneyText(summary.etsyFees), '支付/交易/上架/续费，不含广告 CSV', 'amber'),
    buildFinanceMetric('taxes', '销售税', moneyText(summary.taxes), 'Etsy 代收或相关税项', 'blue'),
    buildFinanceMetric('adSpend', '广告花费', moneyText(summary.adSpend), '来自站内广告 CSV', 'red'),
    buildFinanceMetric('logistics', '物流费用', cnyMoneyText(summary.logisticsCost, summary.logisticsCurrency), `折合 ${moneyText(summary.logisticsCostUsd)} / USD-CNY ${summary.usdCnyRate.toFixed(4)}`, 'amber'),
    buildFinanceMetric('profit', '估算利润', moneyText(summary.estimatedProfit), `利润率 ${summary.profitMargin.toFixed(1)}% / 已扣物流费，不含商品成本`, 'green'),
  ]

  return {
    key,
    label,
    title,
    rangeLabel,
    summaryText: `${periodName}订单入账 ${moneyText(summary.orderGross)}，Etsy 扣费 ${moneyText(summary.etsyFees)}，广告花费 ${moneyText(summary.adSpend)}，物流费用折合 ${moneyText(summary.logisticsCostUsd)}，估算利润 ${moneyText(summary.estimatedProfit)}。`,
    currency: metricCurrency,
    metrics,
    summary,
    comparison,
    trends: key === 'ytd'
      ? buildFinanceMonthlyTrend(ledgerRows, adRows, logisticsRows, start, end, exchangeRate)
      : buildFinanceTrend(ledgerRows, adRows, logisticsRows, key === 'month' || key === 'week' ? start : addDays(end, -7), end, exchangeRate),
    orderRows,
    logisticsRows: periodLogisticsRows,
    ledgerRows: periodLedgerRows,
    feeBreakdown: buildFinanceBreakdown(summary),
  }
}

async function buildFinanceData(endDateValue) {
  const fallbackDate = startOfDay(new Date())
  const selectedDate = dateKey(parseDateKey(endDateValue, fallbackDate))
  const endDate = parseDateKey(selectedDate, fallbackDate)
  const yearStart = new Date(Date.UTC(endDate.getUTCFullYear(), 0, 1))
  const { shopId, ledgerRows, payments, syncSource, cacheReasons } = await fetchFinanceSourceData(endDate, yearStart)
  const adReport = await fetchAdReportData()
  const adRows = adReport.rows || []
  const logisticsReport = await fetchLogisticsFeeData()
  const logisticsRows = logisticsReport.rows || []
  const exchangeRate = await fetchUsdCnyExchangeRate()
  const ledgerDates = ledgerRows.map(financeLedgerDate).filter(Boolean).sort()
  const paymentDates = payments.map(financePaymentDate).filter(Boolean).sort()
  const adDates = adRows.map((row) => row.date).filter(Boolean).sort()
  const logisticsDates = logisticsRows.map((row) => row.date).filter(Boolean).sort()
  const dataDates = [...new Set([...ledgerDates, ...paymentDates, ...adDates, ...logisticsDates])].sort()
  const latestDataDate = dataDates.at(-1) || selectedDate
  const availableDates = [...new Set([...dataDates, selectedDate])].sort()
  const latestDate = availableDates.at(-1) || selectedDate
  const dayStart = endDate
  const weekStart = startOfWeek(endDate)
  const monthStart = startOfMonth(endDate)
  const dayEnd = addDays(dayStart, 1)
  const weekEnd = addDays(weekStart, 7)
  const monthEnd = addDays(endDate, 1)
  const ytdEnd = monthEnd
  const weekComparison = buildFinanceOrderGrossComparison({
    ledgerRows,
    adRows,
    logisticsRows,
    weekStart,
    weekEnd,
    latestDate: parseDateKey(latestDataDate, endDate),
    exchangeRate,
  })
  const day = buildFinancePeriod({
    key: 'day',
    label: '按日',
    title: '单日财务总览',
    rangeLabel: selectedDate,
    ledgerRows,
    payments,
    adRows,
    logisticsRows,
    start: dayStart,
    end: dayEnd,
    exchangeRate,
  })
  const week = buildFinancePeriod({
    key: 'week',
    label: '自然周',
    title: '自然周财务总览',
    rangeLabel: `${dateKey(weekStart)} - ${dateKey(addDays(weekEnd, -1))}`,
    ledgerRows,
    payments,
    adRows,
    logisticsRows,
    start: weekStart,
    end: weekEnd,
    comparison: weekComparison,
    exchangeRate,
  })
  const month = buildFinancePeriod({
    key: 'month',
    label: '统计月份',
    title: '统计月份财务总览',
    rangeLabel: `${dateKey(monthStart)} - ${selectedDate}`,
    ledgerRows,
    payments,
    adRows,
    logisticsRows,
    start: monthStart,
    end: monthEnd,
    exchangeRate,
  })
  const ytd = buildFinancePeriod({
    key: 'ytd',
    label: 'Year to Date',
    title: 'Year to Date 财务总览',
    rangeLabel: `${dateKey(yearStart)} - ${selectedDate}`,
    ledgerRows,
    payments,
    adRows,
    logisticsRows,
    start: yearStart,
    end: ytdEnd,
    exchangeRate,
  })

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    sourceDir: 'Etsy Payments / Ledger',
    shop: {
      shopId: String(shopId || ''),
    },
    availableDates,
    selectedDate,
    latestDate,
    files: [
      { date: selectedDate, name: 'etsy-ledger.json', path: dataPath('etsy-ledger.json') },
      { date: selectedDate, name: 'etsy-payments.json', path: dataPath('etsy-payments.json') },
      { date: adDates.at(-1) || selectedDate, name: adReport.sourceFile || 'etsy-ads.json', path: adReport.sourcePath || dataPath('etsy-ads.json') },
      { date: logisticsDates.at(-1) || selectedDate, name: 'logistics-fees.json', path: dataPath('logistics-fees.json') },
    ],
    periods: {
      day,
      week,
      month,
      ytd,
    },
    sync: {
      status: syncSource === 'setup-missing' ? 'cached' : syncSource === 'cache' ? 'cached' : 'synced',
      fileCount: syncSource === 'setup-missing' ? 0 : 4,
      latestFile: syncSource === 'cache' ? 'Etsy 财务本地缓存' : 'Etsy Payments / Ledger + 广告报表 + 物流费用',
      message:
        syncSource === 'cache'
          ? `Etsy 财务 API 本次同步受限，已使用上次缓存：${numberText(ledgerRows.length)} 条流水，${numberText(payments.length)} 条 payment；${logisticsReport.message}。${cacheReasons[0] || ''}`
          : `已同步 Etsy 财务 API：${numberText(ledgerRows.length)} 条流水，${numberText(payments.length)} 条 payment；${adReport.message}；${logisticsReport.message}`,
    },
  }
}

async function getFinanceData(endDateValue, options = {}) {
  const fallbackDate = startOfDay(new Date())
  const normalizedEndDate = endDateValue ? dateKey(parseDateKey(endDateValue, fallbackDate)) : dateKey(fallbackDate)
  const cacheKey = normalizedEndDate || 'latest'
  const now = Date.now()
  const cached = financeCache.get(cacheKey)

  if (!options.force && cached && now - cached.createdAt < DASHBOARD_CACHE_TTL_MS) {
    return {
      ...cached.data,
      cache: {
        status: 'memory',
        ageSeconds: Math.round((now - cached.createdAt) / 1000),
        ttlSeconds: Math.round(DASHBOARD_CACHE_TTL_MS / 1000),
      },
    }
  }

  if (!options.force && financeBuilds.has(cacheKey)) {
    return financeBuilds.get(cacheKey)
  }

  const build = buildFinanceData(normalizedEndDate).then((data) => {
    const cacheEntry = {
      createdAt: Date.now(),
      data,
    }
    financeCache.set(cacheKey, cacheEntry)
    if (data.selectedDate) financeCache.set(data.selectedDate, cacheEntry)
    return {
      ...data,
      cache: {
        status: 'fresh',
        ageSeconds: 0,
        ttlSeconds: Math.round(DASHBOARD_CACHE_TTL_MS / 1000),
      },
    }
  }).finally(() => {
    financeBuilds.delete(cacheKey)
  })

  financeBuilds.set(cacheKey, build)
  return build
}

function reviewCreatedMs(review) {
  const raw = Number(review?.created_timestamp || review?.create_timestamp || 0)
  if (!raw) return 0
  return raw > 1000000000000 ? raw : raw * 1000
}

function reviewUpdatedMs(review) {
  const raw = Number(review?.updated_timestamp || review?.update_timestamp || 0)
  if (!raw) return 0
  return raw > 1000000000000 ? raw : raw * 1000
}

function averageReviewRating(reviews) {
  const rated = reviews.filter((review) => Number(review.rating || 0) > 0)
  if (!rated.length) return 0
  const total = rated.reduce((sum, review) => sum + Number(review.rating || 0), 0)
  return Number((total / rated.length).toFixed(2))
}

function ratingDistribution(reviews) {
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const review of reviews) {
    const rating = Math.round(Number(review.rating || 0))
    if (rating >= 1 && rating <= 5) distribution[rating] += 1
  }
  return distribution
}

function normalizeReview(review, listingMap, imageMap) {
  const listingId = String(review.listing_id || '')
  const listing = listingMap.get(listingId) || {}
  const createdAt = reviewCreatedMs(review)
  const updatedAt = reviewUpdatedMs(review)
  const transactionId = String(review.transaction_id || '')
  const reviewText = String(review.review || '').trim()
  const id = transactionId || `${listingId}-${createdAt}-${Number(review.rating || 0)}-${reviewText.slice(0, 20)}`

  return {
    id,
    shopId: String(review.shop_id || ''),
    listingId,
    transactionId,
    productName: listing.title || (listingId ? `Listing ${listingId}` : '未知商品'),
    imageUrl: imageMap[listingId] || '',
    listingUrl: listing.url || '',
    rating: Number(review.rating || 0),
    review: reviewText,
    language: review.language || '',
    reviewImageUrl: review.image_url_fullxfull || '',
    createdDate: createdAt ? dateKeyInTimeZone(new Date(createdAt)) : '',
    createdTimestamp: createdAt,
    updatedDate: updatedAt ? dateKeyInTimeZone(new Date(updatedAt)) : '',
  }
}

function reviewInRange(review, start, end) {
  if (review.createdDate) {
    return review.createdDate >= dateKey(start) && review.createdDate < dateKey(end)
  }

  return review.createdTimestamp >= start.getTime() && review.createdTimestamp < end.getTime()
}

function buildReviewProductSummaries(reviews) {
  const products = new Map()

  for (const review of reviews) {
    const key = review.listingId || review.id
    const existing = products.get(key) || {
      listingId: review.listingId,
      productName: review.productName,
      imageUrl: review.imageUrl,
      listingUrl: review.listingUrl,
      reviewCount: 0,
      ratingSum: 0,
      averageRating: 0,
      lowRatingCount: 0,
      photoReviewCount: 0,
      textReviewCount: 0,
      latestReviewDate: '',
      latestReview: '',
      ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    }

    existing.reviewCount += 1
    existing.ratingSum += Number(review.rating || 0)
    existing.averageRating = Number((existing.ratingSum / existing.reviewCount).toFixed(2))
    if (Number(review.rating || 0) <= 3) existing.lowRatingCount += 1
    if (review.reviewImageUrl) existing.photoReviewCount += 1
    if (review.review) existing.textReviewCount += 1
    const rating = Math.round(Number(review.rating || 0))
    if (rating >= 1 && rating <= 5) existing.ratingDistribution[rating] += 1
    if (!existing.latestReviewDate || review.createdDate > existing.latestReviewDate) {
      existing.latestReviewDate = review.createdDate
      existing.latestReview = review.review
    }

    products.set(key, existing)
  }

  return [...products.values()]
    .map(({ ratingSum, ...product }) => product)
    .sort((a, b) => b.reviewCount - a.reviewCount || b.averageRating - a.averageRating || b.latestReviewDate.localeCompare(a.latestReviewDate))
}

function aggregateReviewTrend(reviews, label, start, end) {
  const periodReviews = reviews.filter((review) => reviewInRange(review, start, end))
  const averageRating = averageReviewRating(periodReviews)

  return {
    label,
    rangeLabel: `${dateKey(start)} - ${dateKey(addDays(end, -1))}`,
    reviews: periodReviews.length,
    averageRating,
    lowRatingReviews: periodReviews.filter((review) => Number(review.rating || 0) <= 3).length,
  }
}

function buildReviewDailyTrends(reviews, start, days) {
  return Array.from({ length: days }, (_, index) => {
    const dayStart = addDays(start, index)
    const item = aggregateReviewTrend(reviews, shortDateLabel(dayStart), dayStart, addDays(dayStart, 1))
    item.rangeLabel = dateKey(dayStart)
    return item
  })
}

function buildReviewMonthlyTrends(reviews, endDate) {
  const currentMonthStart = startOfMonth(endDate)
  return Array.from({ length: 12 }, (_, index) => {
    const start = addMonths(currentMonthStart, index - 11)
    const end = addMonths(start, 1)
    return aggregateReviewTrend(reviews, dateKey(start).slice(0, 7), start, end)
  })
}

function buildReviewYearToDateTrends(reviews, endDate) {
  const yearStart = startOfYear(endDate)
  const currentMonth = endDate.getUTCMonth()

  return Array.from({ length: currentMonth + 1 }, (_, index) => {
    const start = addMonths(yearStart, index)
    const end = index === currentMonth ? addDays(endDate, 1) : addMonths(start, 1)
    return aggregateReviewTrend(reviews, monthLabel(start), start, end)
  })
}

function buildReviewPeriod(key, label, title, reviews, start, end, trendMode) {
  const inPeriod = start && end ? reviews.filter((review) => reviewInRange(review, start, end)) : reviews
  const sortedReviews = [...inPeriod].sort((a, b) => b.createdTimestamp - a.createdTimestamp)
  const averageRating = averageReviewRating(inPeriod)
  const distribution = ratingDistribution(inPeriod)
  const lowRatingReviews = sortedReviews.filter((review) => Number(review.rating || 0) <= 3)
  const productSummaries = buildReviewProductSummaries(inPeriod)
  const fiveStarRate = inPeriod.length ? Number(((distribution[5] / inPeriod.length) * 100).toFixed(1)) : 0
  const rangeLabel =
    start && end
      ? `${dateKey(start)} - ${dateKey(addDays(end, -1))}`
      : sortedReviews.at(-1)?.createdDate && sortedReviews[0]?.createdDate
        ? `${sortedReviews.at(-1).createdDate} - ${sortedReviews[0].createdDate}`
        : '暂无评价'

  return {
    key,
    label,
    title,
    rangeLabel,
    totalReviews: inPeriod.length,
    averageRating,
    lowRatingReviews: lowRatingReviews.length,
    photoReviews: inPeriod.filter((review) => review.reviewImageUrl).length,
    textReviews: inPeriod.filter((review) => review.review).length,
    fiveStarRate,
    productCount: productSummaries.length,
    ratingDistribution: distribution,
    trends:
      trendMode === 'ytd'
        ? buildReviewYearToDateTrends(reviews, end ? addDays(end, -1) : new Date())
        : trendMode === 'month'
        ? buildReviewMonthlyTrends(reviews, end ? addDays(end, -1) : new Date())
        : buildReviewDailyTrends(reviews, start, Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS))),
    recentReviews: sortedReviews.slice(0, 40),
    topProducts: [...productSummaries]
      .filter((product) => product.reviewCount > 0)
      .sort((a, b) => b.averageRating - a.averageRating || b.reviewCount - a.reviewCount)
      .slice(0, 12),
    lowRatingProducts: [...productSummaries]
      .filter((product) => product.lowRatingCount > 0)
      .sort((a, b) => b.lowRatingCount - a.lowRatingCount || a.averageRating - b.averageRating)
      .slice(0, 12),
  }
}

async function readCachedReviewSourceData() {
  const [shopData, listingsPayload, reviewsPayload] = await Promise.all([
    readOptionalJson('etsy-shops.json', null),
    readOptionalJson('etsy-listings.json', null),
    readOptionalJson('etsy-reviews.json', null),
  ])

  if (!shopData || !reviewsPayload) return null

  return {
    shop: getFirstShop(shopData),
    listings: getResults(listingsPayload || {}),
    reviews: getResults(reviewsPayload),
    reviewCount: typeof reviewsPayload.count === 'number' ? reviewsPayload.count : getResults(reviewsPayload).length,
    syncSource: 'cache',
    cacheReasons: ['使用本地 Etsy 评价缓存'],
  }
}

async function fetchReviewSourceData(options = {}) {
  if (!options.force) {
    const cached = await readCachedReviewSourceData()
    if (cached) return cached
  }

  try {
    const shopData = await readJson('etsy-shops.json')
    const shop = getFirstShop(shopData)
    const shopId = shop.shop_id
    const [listingsPayload, reviewsPayload] = await Promise.all([
      etsyFetchAll(`/shops/${shopId}/listings/active`, 'etsy-listings.json'),
      etsyFetchAll(`/shops/${shopId}/reviews`, 'etsy-reviews.json', { maxPages: 50 }),
    ])
    const payloads = [listingsPayload, reviewsPayload]
    const usedCache = payloads.some((payload) => payload.__source === 'cache')

    return {
      shop,
      listings: getResults(listingsPayload),
      reviews: getResults(reviewsPayload),
      reviewCount: typeof reviewsPayload.count === 'number' ? reviewsPayload.count : getResults(reviewsPayload).length,
      syncSource: usedCache ? 'cache' : 'live',
      cacheReasons: payloads.map((payload) => payload.__cacheReason).filter(Boolean),
    }
  } catch (error) {
    if (!isMissingEtsySetupError(error)) throw error
    console.warn('[etsy setup missing] reviews using empty data:', error.message)
    return {
      shop: {},
      listings: [],
      reviews: [],
      reviewCount: 0,
      syncSource: 'setup-missing',
      cacheReasons: [error.message],
    }
  }
}

async function buildReviewData(options = {}) {
  const { shop, listings, reviews, reviewCount, syncSource, cacheReasons } = await fetchReviewSourceData(options)
  const reviewListings = await getReviewListings(listings, reviews)
  const listingMap = new Map(reviewListings.map((listing) => [String(listing.listing_id), listing]))
  const imageMap = await getListingImageMap(reviewListings, { background: !options.force })
  const rows = reviews
    .map((review) => normalizeReview(review, listingMap, imageMap))
    .filter((review) => review.createdTimestamp)
    .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
  const latestReviewDate = rows[0]?.createdDate || ''
  const currentDateKey = options.endDate || latestReviewDate || dateKeyInTimeZone(new Date())
  const selectedDate = parseDateKey(currentDateKey, startOfDay(new Date()))
  const weekStart = startOfWeek(selectedDate)
  const weekEnd = addDays(weekStart, 7)
  const monthStart = startOfMonth(selectedDate)
  const monthEnd = addMonths(monthStart, 1)
  const yearStart = startOfYear(selectedDate)
  const ytdEnd = addDays(selectedDate, 1)

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    sourceDir: 'Etsy Open API v3',
    shop: {
      shopId: String(shop.shop_id || ''),
      shopName: shop.shop_name || shop.title || '',
    },
    currentDate: currentDateKey,
    latestReviewDate,
    totalAvailableReviews: reviewCount,
    rows,
    products: buildReviewProductSummaries(rows),
    periods: {
      week: buildReviewPeriod('week', '自然周', '自然周评价概览', rows, weekStart, weekEnd, 'day'),
      month: buildReviewPeriod('month', '统计月份', '统计月份评价概览', rows, monthStart, monthEnd, 'day'),
      ytd: buildReviewPeriod('ytd', 'Year to Date', 'Year to Date 评价概览', rows, yearStart, ytdEnd, 'ytd'),
      all: buildReviewPeriod('all', '全部评价', '全部评价概览', rows, null, null, 'month'),
    },
    files: [
      { date: latestReviewDate || currentDateKey, name: 'etsy-reviews.json', path: dataPath('etsy-reviews.json') },
      { date: currentDateKey, name: 'etsy-listings.json', path: dataPath('etsy-listings.json') },
      { date: currentDateKey, name: 'etsy-listing-images.json', path: dataPath('etsy-listing-images.json') },
    ],
    sync: {
      status: syncSource === 'setup-missing' ? 'cached' : syncSource === 'cache' ? 'cached' : 'synced',
      fileCount: syncSource === 'setup-missing' ? 0 : 3,
      latestFile: syncSource === 'setup-missing' ? '' : syncSource === 'cache' ? 'Etsy 评价本地缓存' : 'Etsy Reviews API',
      message:
        syncSource === 'cache'
          ? `Etsy 评价本次同步受限，已使用上次缓存：${numberText(rows.length)} 条评价。${cacheReasons[0] || ''}`
          : `已同步 Etsy 评价：${numberText(rows.length)} 条评价，最新 ${latestReviewDate || '暂无评价'}。`,
      message: syncSource === 'setup-missing'
        ? '当前展示备用数据；完成 Etsy 授权后刷新即可同步真实数据。'
        : syncSource === 'cache'
          ? `Etsy 评价本次同步受限，已使用上次缓存：${numberText(rows.length)} 条评价。${cacheReasons[0] || ''}`
          : `已同步 Etsy 评价：${numberText(rows.length)} 条评价，最新 ${latestReviewDate || '暂无评价'}。`,
    },
  }
}

async function getReviewData(options = {}) {
  const cacheKey = `reviews:${options.endDate || 'latest'}`
  const now = Date.now()
  const cached = reviewCache.get(cacheKey)

  if (!options.force && cached && now - cached.createdAt < DASHBOARD_CACHE_TTL_MS) {
    return {
      ...cached.data,
      cache: {
        status: 'memory',
        ageSeconds: Math.round((now - cached.createdAt) / 1000),
        ttlSeconds: Math.round(DASHBOARD_CACHE_TTL_MS / 1000),
      },
    }
  }

  if (!options.force && reviewBuilds.has(cacheKey)) {
    return reviewBuilds.get(cacheKey)
  }

  const build = buildReviewData(options).then((data) => {
    reviewCache.set(cacheKey, {
      createdAt: Date.now(),
      data,
    })
    return {
      ...data,
      cache: {
        status: 'fresh',
        ageSeconds: 0,
        ttlSeconds: Math.round(DASHBOARD_CACHE_TTL_MS / 1000),
      },
    }
  }).finally(() => {
    reviewBuilds.delete(cacheKey)
  })

  reviewBuilds.set(cacheKey, build)
  return build
}

function getFirstShop(shopData) {
  const shops = getResults(shopData)
  const shop = shops.find((item) => item && item.shop_id)
  if (!shop) {
    const error = new Error('etsy-shops.json 中没有找到 shop_id。请先确认 /etsy/callback 或 /etsy/test-shops 是否成功。')
    error.status = 400
    throw error
  }
  return shop
}

async function getSavedShopId() {
  const shopData = await readJson('etsy-shops.json')
  return getFirstShop(shopData).shop_id
}

function renderRows(headers, rows) {
  const headerHtml = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')
  const rowsHtml = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('')

  return `<table><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>`
}

function renderError(error) {
  const status = error.status || 500
  const details = error.details ? `<h2>原始错误</h2>${jsonBlock(error.details)}` : ''
  return page('Etsy API 测试错误', `
    <h1>请求失败</h1>
    <p class="warn">HTTP ${escapeHtml(status)}：${escapeHtml(error.message)}</p>
    ${details}
    <p><a href="/">返回首页</a></p>
  `)
}

const JSON_ERROR_PATHS = new Set([
  '/etsy/dashboard-data',
  '/etsy/finance-data',
  '/etsy/review-data',
  '/etsy/market-keywords',
])

function expectsJsonError(req) {
  return req.path.startsWith('/auth/') || JSON_ERROR_PATHS.has(req.path) || String(req.headers.accept || '').includes('application/json')
}

function asyncRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res)
    } catch (error) {
      console.error('[route error]', error)
      if (expectsJsonError(req)) {
        sendJsonError(res, error)
        return
      }
      res.status(error.status || 500).send(renderError(error))
    }
  }
}

app.get('/', (req, res) => {
  res.send(page('Etsy API 本地测试服务', `
    <h1>Etsy Open API v3 本地测试服务已启动</h1>
    <p>当前服务运行在 <code>http://localhost:${escapeHtml(PORT)}</code>。</p>
    <p>请先用 Cloudflare Quick Tunnel 暴露 HTTPS 地址，并把 Etsy App Callback URL 与 <code>.env</code> 里的 <code>ETSY_REDIRECT_URI</code> 设置成同一个地址。</p>
    <div class="links">
      <a href="/etsy/connect">开始 Etsy 授权</a>
      <a href="/etsy/test-shops">测试店铺信息</a>
      <a href="/etsy/test-listings">测试商品列表</a>
      <a href="/etsy/test-receipts">测试订单 Receipts</a>
      <a href="/etsy/test-transactions">测试交易 Transactions</a>
      <a href="/etsy/test-reviews">测试评价 Reviews</a>
      <a href="/etsy/dashboard-data">看板汇总 JSON</a>
      <a href="/etsy/finance-data">财务看板 JSON</a>
      <a href="/etsy/review-data">评价看板 JSON</a>
      <a href="/etsy/market-keywords">市场关键词 JSON</a>
      <a href="/logistics/config">物流配置检查</a>
      <a href="/logistics/products">物流渠道列表</a>
    </div>
  `))
})

app.get('/auth/register-options', asyncRoute(async (req, res) => {
  res.json({
    ok: true,
    roles: await getRegisterableRoles(),
  })
}))

app.post('/auth/register', asyncRoute(async (req, res) => {
  const email = normalizeEmail(req.body?.email)
  const name = String(req.body?.name || '').trim()
  const password = String(req.body?.password || '')
  const inviteCode = String(req.body?.inviteCode || '').trim()
  const requestedRole = normalizeUserRole(req.body?.role || req.body?.position)
  const remember = Boolean(req.body?.remember)

  if (!isValidEmail(email)) throw httpError(400, '请输入有效邮箱')
  if (!name) throw httpError(400, '请输入姓名')
  if (password.length < 6) throw httpError(400, '密码至少需要 6 位')
  if (!requestedRole) throw httpError(400, '请选择你在盈领公司的岗位')
  const registerableRoles = await getRegisterableRoles()
  if (!registerableRoles.includes(requestedRole) && !inviteCode) {
    throw httpError(400, '当前岗位不支持自助注册，请联系管理员创建账号')
  }

  const existingUser = await findUserByEmail(email)
  if (existingUser) {
    throw httpError(409, '这个邮箱已经注册过了')
  }

  const { ownerInviteCode } = await getAuthConfig()
  let role = requestedRole
  if (inviteCode) {
    if (!ownerInviteCode || !timingSafeEqualText(inviteCode, ownerInviteCode)) {
      throw httpError(400, '邀请码无效')
    }
    role = 'admin'
  }

  const user = {
    id: crypto.randomUUID(),
    email,
    name,
    role,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  const savedUser = await createUser(user)

  res.json({
    ok: true,
    user: publicUser(savedUser),
    token: await createAuthToken(savedUser, remember),
  })
}))

app.post('/auth/login', asyncRoute(async (req, res) => {
  const identifier = String(req.body?.email || req.body?.username || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  const remember = Boolean(req.body?.remember)

  if (!identifier || !password) throw httpError(400, '请输入账号和密码')

  const user = await findUserByLogin(identifier)
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw httpError(401, '邮箱或密码不正确')
  }

  res.json({
    ok: true,
    user: publicUser(user),
    token: await createAuthToken(user, remember),
  })
}))

app.get('/auth/me', requireAuth, asyncRoute(async (req, res) => {
  res.json({
    ok: true,
    user: req.authUser,
  })
}))

app.get('/auth/ui-settings', requireAuth, asyncRoute(async (req, res) => {
  const settings = await getSystemSettings()
  res.json({
    ok: true,
    rolePageUpdates: settings.rolePageUpdates,
  })
}))

app.get('/auth/settings', requireAuth, requireOwner, asyncRoute(async (req, res) => {
  res.json({
    ok: true,
    settings: await getSystemSettings(),
    publicRegisterableRoles: PUBLIC_REGISTERABLE_ROLES,
  })
}))

app.patch('/auth/settings', requireAuth, requireOwner, asyncRoute(async (req, res) => {
  res.json({
    ok: true,
    settings: await updateSystemSettings(req.body || {}),
    publicRegisterableRoles: PUBLIC_REGISTERABLE_ROLES,
  })
}))

app.get('/auth/feedback', requireAuth, requireOwner, asyncRoute(async (req, res) => {
  res.json({
    ok: true,
    feedback: await readUserFeedback(),
  })
}))

app.post('/auth/feedback', requireAuth, asyncRoute(async (req, res) => {
  res.status(201).json({
    ok: true,
    feedback: await createUserFeedback(req.authUser, req.body || {}),
  })
}))

app.get('/auth/users', requireAuth, requireOwner, asyncRoute(async (req, res) => {
  res.json({
    ok: true,
    users: await readPublicUsers(),
  })
}))

app.post('/auth/users', requireAuth, requireOwner, asyncRoute(async (req, res) => {
  const requestedRole = normalizeUserRole(req.body?.role || 'operator')
  if (req.authUser?.role !== 'super_admin' && requestedRole === 'super_admin') {
    throw httpError(403, '只有超级管理员可以创建超级管理员账号')
  }

  const user = await createManagedUser(req.body)
  res.status(201).json({
    ok: true,
    user: publicUser(user),
  })
}))

app.patch('/auth/users/:id/role', requireAuth, requireOwner, asyncRoute(async (req, res) => {
  const targetUser = await findUserById(req.params.id)
  if (!targetUser) throw httpError(404, '用户不存在')

  const nextRole = normalizeUserRole(req.body?.role)
  if (req.authUser?.role !== 'super_admin' && (targetUser.role === 'super_admin' || nextRole === 'super_admin')) {
    throw httpError(403, '只有超级管理员可以调整超级管理员账号')
  }

  const user = await updateUserRole(req.params.id, req.body?.role)
  res.json({
    ok: true,
    user: publicUser(user),
  })
}))

app.delete('/auth/users/:id', requireAuth, requireOwner, asyncRoute(async (req, res) => {
  if (String(req.authUser?.id) === String(req.params.id)) {
    throw httpError(400, '不能删除当前登录账号')
  }

  const targetUser = await findUserById(req.params.id)
  if (!targetUser) throw httpError(404, '用户不存在')
  if (req.authUser?.role !== 'super_admin' && targetUser.role === 'super_admin') {
    throw httpError(403, '只有超级管理员可以删除超级管理员账号')
  }

  await deleteUserById(req.params.id)
  res.json({
    ok: true,
  })
}))

app.get('/etsy/connect', asyncRoute(async (req, res) => {
  assertEnv()

  const { keystring, redirectUri } = env()
  const state = createState()
  const codeVerifier = createCodeVerifier()
  const codeChallenge = createCodeChallenge(codeVerifier)

  pendingOAuth.set(state, {
    codeVerifier,
    createdAt: Date.now(),
  })

  const url = new URL(ETSY_AUTH_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', keystring)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', SCOPES.join(' '))
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')

  res.redirect(url.toString())
}))

app.get('/etsy/callback', asyncRoute(async (req, res) => {
  assertEnv()

  const { code, state, error, error_description: errorDescription } = req.query

  if (error) {
    const oauthError = new Error(`Etsy 授权返回错误: ${errorDescription || error}`)
    oauthError.status = 400
    throw oauthError
  }

  if (!code || !state) {
    const missing = new Error('Etsy 回调缺少 code 或 state。')
    missing.status = 400
    throw missing
  }

  const pending = pendingOAuth.get(state)
  pendingOAuth.delete(state)

  if (!pending) {
    const invalidState = new Error('invalid state：state 不存在或已经被使用。请重新打开 /etsy/connect 授权。')
    invalidState.status = 400
    throw invalidState
  }

  const { keystring, redirectUri } = env()
  const tokenResponse = await requestToken({
    grant_type: 'authorization_code',
    client_id: keystring,
    redirect_uri: redirectUri,
    code,
    code_verifier: pending.codeVerifier,
  })

  const savedToken = tokenWithMeta(tokenResponse)
  await writeJson('etsy-token.json', savedToken)

  const shopData = await etsyFetch(`/users/${savedToken.user_id}/shops`)
  await writeJson('etsy-shops.json', shopData)

  const shop = getFirstShop(shopData)
  res.send(page('Etsy 授权成功', `
    <h1 class="ok">Etsy 授权成功</h1>
    <p>已经保存 <code>etsy-token.json</code> 和 <code>etsy-shops.json</code>。</p>
    <h2>当前店铺</h2>
    ${renderRows(['shop_id', 'shop_name'], [[shop.shop_id, shop.shop_name || shop.title || '']])}
    <h2>原始 JSON</h2>
    ${jsonBlock(shopData)}
    <div class="links">
      <a href="/etsy/test-listings">继续测试商品列表</a>
      <a href="/etsy/test-receipts">继续测试订单 Receipts</a>
      <a href="/etsy/test-transactions">继续测试交易 Transactions</a>
      <a href="/etsy/test-reviews">继续测试评价 Reviews</a>
    </div>
  `))
}))

app.get('/etsy/test-shops', asyncRoute(async (req, res) => {
  const token = await readJson('etsy-token.json')
  const userId = token.user_id || getUserIdFromAccessToken(token.access_token)
  let shopData
  let source = 'api'
  let message = 'Fetched shops from Etsy API.'

  try {
    shopData = await etsyFetch(`/users/${userId}/shops`)
    await writeJson('etsy-shops.json', shopData)
  } catch (error) {
    const cachedShopData = await readOptionalJson('etsy-shops.json', null)
    if (!cachedShopData) throw error

    shopData = cachedShopData
    source = 'cache'
    message = `Etsy API request failed, using local etsy-shops.json cache: ${error.message}`
  }

  const shop = getFirstShop(shopData)
  const wantsJson = String(req.query.format || '').toLowerCase() === 'json'
    || String(req.headers.accept || '').includes('application/json')

  if (wantsJson) {
    res.json({
      ok: true,
      source,
      message,
      shop,
      data: shopData,
    })
    return
  }

  res.send(page('Etsy 店铺信息测试', `
    <h1 class="ok">店铺信息读取成功</h1>
    ${renderRows(['shop_id', 'shop_name'], [[shop.shop_id, shop.shop_name || shop.title || '']])}
    <h2>原始 JSON</h2>
    ${jsonBlock(shopData)}
  `))
}))

app.get('/etsy/test-listings', asyncRoute(async (req, res) => {
  const shopId = await getSavedShopId()
  const listings = await etsyFetchAll(`/shops/${shopId}/listings/active`, 'etsy-listings.json')

  const rows = getResults(listings)
    .slice(0, 5)
    .map((listing) => [
      listing.listing_id,
      listing.title,
      listing.state,
      formatMoney(listing.price),
      listing.quantity,
      listing.views,
      listing.num_favorers,
    ])

  res.send(page('Etsy 商品列表测试', `
    <h1 class="ok">商品列表读取成功</h1>
    <p>count: <strong>${escapeHtml(getCount(listings))}</strong></p>
    ${renderRows(['listing_id', 'title', 'state', 'price', 'quantity', 'views', 'num_favorers'], rows)}
    <h2>原始 JSON</h2>
    ${jsonBlock(listings)}
  `))
}))

app.get('/etsy/test-receipts', asyncRoute(async (req, res) => {
  const shopId = await getSavedShopId()
  const receipts = await etsyFetchAll(`/shops/${shopId}/receipts`, 'etsy-receipts.json')

  const rows = getResults(receipts)
    .slice(0, 5)
    .map((receipt) => [
      receipt.receipt_id,
      receipt.created_timestamp,
      formatMoney(receipt.grandtotal || receipt.total_price || receipt.total),
      receipt.is_paid,
      receipt.is_shipped,
    ])

  res.send(page('Etsy Receipts 测试', `
    <h1 class="ok">订单 Receipts 读取成功</h1>
    <p>count: <strong>${escapeHtml(getCount(receipts))}</strong></p>
    ${renderRows(['receipt_id', 'created_timestamp', 'grandtotal/total_price', 'is_paid', 'is_shipped'], rows)}
    <h2>原始 JSON</h2>
    ${jsonBlock(receipts)}
  `))
}))

app.get('/etsy/test-transactions', asyncRoute(async (req, res) => {
  const shopId = await getSavedShopId()
  const transactions = await etsyFetchAll(`/shops/${shopId}/transactions`, 'etsy-transactions.json')

  const rows = getResults(transactions)
    .slice(0, 5)
    .map((transaction) => [
      transaction.transaction_id,
      transaction.listing_id,
      transaction.title,
      transaction.quantity,
      formatMoney(transaction.price),
      transaction.created_timestamp,
    ])

  res.send(page('Etsy Transactions 测试', `
    <h1 class="ok">交易 Transactions 读取成功</h1>
    <p>count: <strong>${escapeHtml(getCount(transactions))}</strong></p>
    ${renderRows(['transaction_id', 'listing_id', 'title', 'quantity', 'price', 'created_timestamp'], rows)}
    <h2>原始 JSON</h2>
    ${jsonBlock(transactions)}
  `))
}))

app.get('/etsy/test-reviews', asyncRoute(async (req, res) => {
  const shopId = await getSavedShopId()
  const reviews = await etsyFetchAll(`/shops/${shopId}/reviews`, 'etsy-reviews.json', { maxPages: 50 })

  const rows = getResults(reviews)
    .slice(0, 5)
    .map((review) => [
      review.listing_id,
      review.transaction_id || '',
      review.rating,
      dateKeyInTimeZone(new Date(reviewCreatedMs(review) || Date.now())),
      String(review.review || '').slice(0, 120),
      review.image_url_fullxfull ? 'yes' : 'no',
    ])

  res.send(page('Etsy Reviews 测试', `
    <h1 class="ok">评价 Reviews 读取成功</h1>
    <p>count: <strong>${escapeHtml(getCount(reviews))}</strong></p>
    ${renderRows(['listing_id', 'transaction_id', 'rating', 'created', 'review', 'photo'], rows)}
    <h2>原始 JSON</h2>
    ${jsonBlock(reviews)}
  `))
}))

app.get('/etsy/dashboard-data', requireAuth, asyncRoute(async (req, res) => {
  const dashboardData = await getDashboardData(req.query.endDate, {
    force: req.query.force === '1' || req.query.refresh === '1',
  })
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(dashboardData, null, 2))
}))

app.get('/etsy/finance-data', requireAuth, requireFinanceAccess, asyncRoute(async (req, res) => {
  const financeData = await getFinanceData(req.query.endDate, {
    force: req.query.force === '1' || req.query.refresh === '1',
  })
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(financeData, null, 2))
}))

app.get('/etsy/review-data', requireAuth, requireReviewAccess, asyncRoute(async (req, res) => {
  const reviewData = await getReviewData({
    force: req.query.force === '1' || req.query.refresh === '1',
    endDate: req.query.endDate,
  })
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(reviewData, null, 2))
}))

app.get('/etsy/market-keywords', requireAuth, asyncRoute(async (req, res) => {
  const marketData = await getMarketKeywordData({
    force: req.query.force === '1' || req.query.refresh === '1',
    scope: req.query.scope,
  })
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(marketData, null, 2))
}))

app.get('/logistics/config', asyncRoute(async (req, res) => {
  const status = hualeiConfigStatus()
  const savedAuth = await readOptionalJson('hualei-auth.json', null)
  const savedProducts = await readOptionalJson('hualei-products.json', null)

  res.send(page('物流 API 配置检查', `
    <h1>物流 API 配置检查</h1>
    <p>当前先接华磊系统 API，用来验证认证、渠道、订单号和费用字段。</p>
    ${renderRows(['项目', '状态'], [
      ['接口地址 URL1', status.apiBase],
      ['面单地址 URL2', status.labelBase],
      ['账号 HUALEI_USERNAME', status.configured.username ? '已填写' : '未填写'],
      ['密码 HUALEI_PASSWORD', status.configured.password ? '已填写' : '未填写'],
      ['customer_id', status.configured.customerId || savedAuth?.customer_id ? '已获取/已填写' : '未获取'],
      ['customer_userid', status.configured.customerUserId || savedAuth?.customer_userid ? '已获取/已填写' : '未获取'],
      ['渠道缓存', savedProducts ? '已有 hualei-products.json' : '未读取'],
    ])}
    <h2>下一步</h2>
    <ol>
      <li>先在 <code>.env</code> 填 <code>HUALEI_USERNAME</code> 和 <code>HUALEI_PASSWORD</code>。</li>
      <li>重启本地后端。</li>
      <li>打开 <code>/logistics/auth</code> 获取 <code>customer_id</code> 和 <code>customer_userid</code>。</li>
      <li>打开 <code>/logistics/products</code> 读取物流渠道。</li>
      <li>用真实订单号打开 <code>/logistics/test-fees?orderNo=你的订单号</code> 看费用字段是否返回。</li>
    </ol>
    <div class="links">
      <a href="/logistics/auth">1. 测试认证</a>
      <a href="/logistics/products">2. 测试渠道</a>
      <a href="/logistics/test-fees">3. 费用探测</a>
    </div>
  `))
}))

app.get('/logistics/auth', asyncRoute(async (req, res) => {
  assertHualeiLoginEnv()

  const { username, password, apiBase } = hualeiEnv()
  const authData = await hualeiRequest('/selectAuth.htm', { username, password })
  const saved = {
    ...authData,
    apiBase,
    updatedAt: new Date().toISOString(),
  }
  await writeJson('hualei-auth.json', saved)

  res.send(page('华磊认证测试', `
    <h1 class="${authData?.ack === 'true' || authData?.ack === true ? 'ok' : 'warn'}">华磊认证返回</h1>
    ${renderRows(['字段', '值'], [
      ['ack', authData?.ack ?? ''],
      ['customer_id', authData?.customer_id ?? authData?.customerId ?? ''],
      ['customer_userid', authData?.customer_userid ?? authData?.customerUserId ?? ''],
      ['message', authData?.message ?? ''],
    ])}
    <p>已经保存到 <code>hualei-auth.json</code>。如果这里有 <code>customer_id</code> 和 <code>customer_userid</code>，后面可以继续测渠道和订单费用。</p>
    <h2>原始 JSON</h2>
    ${jsonBlock(saved)}
    <div class="links">
      <a href="/logistics/products">继续测试渠道列表</a>
      <a href="/logistics/config">返回配置检查</a>
    </div>
  `))
}))

app.get('/logistics/products', asyncRoute(async (req, res) => {
  const products = await hualeiRequest('/getProductList.htm')
  const rows = hualeiRows(products).slice(0, 30).map((item) => [
    item.product_id ?? item.productId ?? '',
    item.product_shortname ?? item.productShortname ?? item.product_name ?? item.productName ?? '',
  ])

  await writeJson('hualei-products.json', {
    updatedAt: new Date().toISOString(),
    rows: hualeiRows(products),
    raw: products,
  })

  res.send(page('华磊渠道列表测试', `
    <h1 class="ok">华磊渠道列表返回</h1>
    <p>已经保存 <code>hualei-products.json</code>。这里的 <code>product_id</code> 后面创建物流订单时会用到。</p>
    ${renderRows(['product_id', 'product_shortname / name'], rows)}
    <h2>原始 JSON</h2>
    ${jsonBlock(products)}
  `))
}))

app.get('/logistics/test-fees', asyncRoute(async (req, res) => {
  const documentCode = String(req.query.documentCode || req.query.orderNo || req.query.order || '').trim()
  const orderId = String(req.query.orderId || req.query.order_id || '').trim()

  if (!documentCode && !orderId) {
    const error = new Error('请在地址后面加订单号，例如 /logistics/test-fees?orderNo=4108914363')
    error.status = 400
    throw error
  }

  const params = orderId ? { order_id: orderId } : { documentCode }
  const data = await hualeiRequest('/getOrderTrackingNumberBatch.htm', params)
  const feeRows = extractHualeiFeeRows(data)
  const hasAnyFee = feeRows.some((row) => row.hasFee)

  await writeJson('hualei-fee-probe.json', {
    updatedAt: new Date().toISOString(),
    query: params,
    feeRows,
    raw: data,
  })

  res.send(page('华磊费用字段探测', `
    <h1 class="${hasAnyFee ? 'ok' : 'warn'}">华磊订单费用探测</h1>
    <p>${hasAnyFee
      ? '这次返回里找到了疑似费用字段，可以继续做订单费用接入。'
      : '这次返回里还没有看到明确费用字段。需要再用真实已出库/已计费订单测试，或向货代索要费用明细接口。'}</p>
    ${renderRows(['原订单号', '华磊 order_id', '跟踪号', '费用金额', '币种', '是否有费用字段', '疑似费用字段'], feeRows.map((row) => [
      row.orderNo,
      row.orderId,
      row.trackingNumber,
      row.amount,
      row.currency,
      row.hasFee ? '是' : '否',
      JSON.stringify(row.feeFields),
    ]))}
    <h2>原始 JSON</h2>
    ${jsonBlock(data)}
  `))
}))

app.get('/logistics/track', asyncRoute(async (req, res) => {
  const documentCode = String(req.query.documentCode || req.query.trackingNumber || req.query.track || '').trim()

  if (!documentCode) {
    const error = new Error('请在地址后面加跟踪号，例如 /logistics/track?trackingNumber=4PX300...')
    error.status = 400
    throw error
  }

  const data = await hualeiRequest('/selectTrack.htm', { documentCode })
  await writeJson('hualei-tracks.json', {
    updatedAt: new Date().toISOString(),
    query: { documentCode },
    raw: data,
  })

  res.send(page('华磊轨迹查询测试', `
    <h1 class="ok">华磊轨迹查询返回</h1>
    <h2>原始 JSON</h2>
    ${jsonBlock(data)}
  `))
}))

app.get('/logistics/label-url', asyncRoute(async (req, res) => {
  const orderId = String(req.query.orderId || req.query.order_id || '').trim()
  const printType = String(req.query.printType || 'lab10_10').trim()

  if (!orderId) {
    const error = new Error('请在地址后面加华磊 order_id，例如 /logistics/label-url?orderId=308897')
    error.status = 400
    throw error
  }

  const url = hualeiLabelUrl(orderId, printType)

  res.send(page('华磊面单链接', `
    <h1>华磊面单链接</h1>
    ${renderRows(['字段', '值'], [
      ['order_id', orderId],
      ['PrintType', printType],
      ['URL', url],
    ])}
    <div class="links">
      <a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">打开面单</a>
    </div>
  `))
}))

const server = app.listen(PORT, () => {
  console.log(`Etsy API test server is running: http://localhost:${PORT}`)
  console.log('Open /etsy/connect after you configure Cloudflare Tunnel and ETSY_REDIRECT_URI.')
})

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用。请先关闭占用该端口的进程，或在 .env 里临时设置 PORT=3001。`)
    process.exit(1)
  }

  console.error('[server error]', error)
  process.exit(1)
})

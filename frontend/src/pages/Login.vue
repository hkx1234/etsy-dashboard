<template>
  <main class="login-page">
    <section class="auth-shell">
      <aside class="auth-hero">
        <div class="auth-hero-mark">
          <ShopOutlined />
          <span>Etsy Dashboard</span>
        </div>
        <div class="auth-hero-copy">
          <p class="auth-kicker">Local Workspace</p>
          <h2>GrainAndGraceJewelry店铺数据看板</h2>
          <p>按岗位权限访问商品、订单、广告、库存和财务数据。</p>
        </div>
        <div class="auth-role-list">
          <div>
            <span>业务岗位</span>
            <strong>销售 / 客服 / 物流</strong>
          </div>
          <div>
            <span>授权岗位</span>
            <strong>管理员配置权限</strong>
          </div>
        </div>
      </aside>

      <section class="auth-card">
        <div class="auth-head">
          <div>
            <span>{{ isRegister ? 'Create Account' : 'Welcome Back' }}</span>
            <h1>{{ isRegister ? '创建账号' : '欢迎回来' }}</h1>
            <p>{{ isRegister ? '先选择你在盈领公司的岗位，再填写账号信息。' : '使用用户名或邮箱登录你的 Etsy 数据看板。' }}</p>
          </div>
        </div>

        <a-alert
          v-if="errorMessage"
          class="auth-alert"
          type="error"
          show-icon
          :message="errorMessage"
        />
        <a-alert
          v-if="successMessage"
          class="auth-alert"
          type="success"
          show-icon
          :message="successMessage"
        />

        <form class="auth-form" autocomplete="off" @submit.prevent="submitAuth">
          <label v-if="isRegister" class="auth-field">
            <span>岗位</span>
            <a-select
              v-model:value="form.role"
              size="large"
              :options="registerRoleOptions"
              placeholder="请选择岗位"
            />
          </label>

          <label class="auth-field">
            <span>{{ isRegister ? '邮箱' : '账号' }}</span>
            <a-input
              v-model:value="form.email"
              size="large"
              autocomplete="off"
              name="login_account_no_autofill"
              :placeholder="isRegister ? 'name@example.com' : '用户名或邮箱'"
            />
          </label>

          <label v-if="isRegister" class="auth-field">
            <span>姓名</span>
            <a-input
              v-model:value="form.name"
              size="large"
              autocomplete="name"
              placeholder="请输入姓名"
            />
          </label>

          <label class="auth-field">
            <span>密码</span>
            <a-input-password
              v-model:value="form.password"
              size="large"
              autocomplete="new-password"
              name="login_password_no_autofill"
              placeholder="请输入密码"
            />
          </label>

          <label v-if="isRegister" class="auth-field">
            <span>确认密码</span>
            <a-input-password
              v-model:value="form.confirmPassword"
              size="large"
              autocomplete="new-password"
              placeholder="再次输入密码"
            />
          </label>

          <label v-if="isRegister" class="auth-field">
            <span>管理员邀请码</span>
            <a-input
              v-model:value="form.inviteCode"
              size="large"
              autocomplete="off"
              placeholder="可选，由管理员提供"
            />
          </label>

          <div v-if="!isRegister" class="auth-row">
            <a-checkbox v-model:checked="form.remember">保持登录</a-checkbox>
          </div>

          <a-checkbox v-if="isRegister" v-model:checked="form.agree" class="auth-terms">
            我已确认账号权限用途
          </a-checkbox>

          <a-button
            type="primary"
            html-type="submit"
            size="large"
            block
            :loading="loading"
          >
            {{ isRegister ? '注册账号' : '登录' }}
          </a-button>
        </form>

        <div class="auth-switch">
          <template v-if="isRegister">
            已有账号？
            <button type="button" @click="goLogin">去登录</button>
          </template>
          <template v-else>
            还没有账号？
            <button type="button" @click="goRegister">创建账号</button>
          </template>
        </div>
      </section>
    </section>

    <a-modal
      v-model:open="showDataNotice"
      class="data-notice-modal"
      title="数据保密公告"
      :width="540"
      :footer="null"
      :mask-closable="true"
      @cancel="dismissDataNotice"
    >
      <div class="data-notice-body">
        <p class="data-notice-lead">
          本系统展示的是深圳市盈领电商内部经营数据，仅限授权人员在工作范围内使用。
        </p>
        <ul>
          <li>数据包含店铺、商品、订单、广告、物流及财务相关信息。</li>
          <li>禁止外传、截图扩散、转发给无关人员，或用于非工作目的。</li>
          <li>继续使用代表你已知悉并同意遵守数据保密要求。</li>
        </ul>
        <div class="data-notice-actions">
          <a-button @click="rejectDataNotice">拒绝</a-button>
          <a-button type="primary" @click="acceptDataNotice">同意并继续</a-button>
        </div>
      </div>
    </a-modal>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ShopOutlined } from '@ant-design/icons-vue'
import { fetchRegisterOptions, loginWithEmail, registerWithEmail, setAuthSession, USER_ROLE_OPTIONS, type UserRole } from '@/api/auth'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const showDataNotice = ref(false)
const isRegister = computed(() => route.path === '/register')
const DATA_NOTICE_KEY = 'yingling-data-notice-agreed'
const fallbackRegisterableRoles: UserRole[] = ['sales', 'customer_service', 'logistics']
const registerableRoles = ref<UserRole[]>(fallbackRegisterableRoles)
const registerRoleOptions = computed(() => USER_ROLE_OPTIONS.filter((option) => registerableRoles.value.includes(option.value)))

const form = reactive({
  email: '',
  name: '',
  role: 'sales' as UserRole,
  password: '',
  confirmPassword: '',
  inviteCode: '',
  remember: true,
  agree: false,
})

watch(isRegister, () => {
  errorMessage.value = ''
  successMessage.value = ''
})

onMounted(() => {
  syncDataNotice()
  resetLoginCredentials()
  void loadRegisterOptions()
  window.setTimeout(resetLoginCredentials, 100)
})

watch(
  () => route.path,
  () => {
    syncDataNotice()
    resetLoginCredentials()
  },
)

function redirectTarget() {
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard'
  if (!redirect.startsWith('/') || redirect.startsWith('/login') || redirect.startsWith('/register')) return '/dashboard'
  return redirect
}

async function loadRegisterOptions() {
  try {
    const roles = await fetchRegisterOptions()
    registerableRoles.value = roles.length ? roles : fallbackRegisterableRoles
    if (!registerableRoles.value.includes(form.role)) {
      form.role = registerableRoles.value[0] || 'sales'
    }
  } catch {
    registerableRoles.value = fallbackRegisterableRoles
  }
}

function validateRegister() {
  if (!registerableRoles.value.includes(form.role)) return '请选择你在盈领公司的岗位'
  if (!form.name.trim()) return '请输入姓名'
  if (form.password.length < 6) return '密码至少需要 6 位'
  if (form.password !== form.confirmPassword) return '两次输入的密码不一致'
  if (!form.agree) return '请先确认账号权限用途'
  return ''
}

async function submitAuth() {
  errorMessage.value = ''
  loading.value = true

  try {
    if (isRegister.value) {
      const validationError = validateRegister()
      if (validationError) throw new Error(validationError)

      await registerWithEmail({
        email: form.email,
        name: form.name,
        role: form.role,
        password: form.password,
        inviteCode: form.inviteCode.trim(),
        remember: false,
      })
      form.password = ''
      form.confirmPassword = ''
      form.inviteCode = ''
      form.agree = false
      router.replace({
        path: '/login',
        query: {
          registered: '1',
        },
      })
      return
    } else {
      const data = await loginWithEmail({
        email: form.email,
        password: form.password,
        remember: form.remember,
      })
      setAuthSession(data, form.remember)
    }

    router.replace(redirectTarget())
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '账号请求失败'
  } finally {
    loading.value = false
  }
}

function goRegister() {
  router.push('/register')
}

function goLogin() {
  router.push('/login')
}

function syncDataNotice() {
  showDataNotice.value = !hasAcceptedDataNotice()
}

function resetLoginCredentials() {
  if (isRegister.value) return
  form.email = ''
  form.password = ''
}

function hasAcceptedDataNotice() {
  try {
    return window.localStorage.getItem(DATA_NOTICE_KEY) === '1'
  } catch {
    return false
  }
}

function acceptDataNotice() {
  try {
    window.localStorage.setItem(DATA_NOTICE_KEY, '1')
  } catch {
    // If storage is unavailable, hide the notice for this visit only.
  }
  showDataNotice.value = false
}

function dismissDataNotice() {
  showDataNotice.value = false
}

function rejectDataNotice() {
  dismissDataNotice()
}

watch(
  () => route.query.registered,
  (registered) => {
    successMessage.value = registered === '1' ? '账号创建成功，请使用刚刚注册的邮箱或用户名登录。' : ''
  },
  { immediate: true },
)
</script>

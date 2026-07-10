<template>
  <section class="page permissions-page">
    <div class="page-heading">
      <div>
        <span class="eyebrow">Access Control</span>
        <h1>权限管理</h1>
        <p>管理系统账号、角色和数据看板访问权限。</p>
      </div>
      <div class="permissions-toolbar">
        <a-button :loading="loading" @click="loadUsers">
          <template #icon>
            <ReloadOutlined />
          </template>
          刷新
        </a-button>
        <a-button type="primary" @click="openCreateModal">
          <template #icon>
            <PlusOutlined />
          </template>
          新增用户
        </a-button>
      </div>
    </div>

    <a-alert
      v-if="errorMessage"
      class="permissions-alert"
      type="error"
      show-icon
      :message="errorMessage"
    />

    <a-table
      :columns="columns"
      :data-source="users"
      :loading="loading"
      row-key="id"
      :pagination="{ pageSize: 10, showSizeChanger: false }"
      :scroll="{ x: 960 }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'account'">
          <div class="permission-account">
            <strong>{{ record.username || record.email || '-' }}</strong>
            <span>{{ record.email || '未填写邮箱' }}</span>
          </div>
        </template>

        <template v-else-if="column.key === 'role'">
          <a-tag :color="roleTagColor(record.role)">
            {{ roleLabel(record.role) }}
          </a-tag>
        </template>

        <template v-else-if="column.key === 'createdAt'">
          {{ formatDate(record.createdAt) }}
        </template>

        <template v-else-if="column.key === 'actions'">
          <div class="permission-actions">
            <a-select
              class="permission-role-select"
              size="small"
              :value="record.role"
              :options="roleOptions"
              :disabled="updatingId === record.id"
              @change="roleChangeHandler(record, $event)"
            />
            <a-popconfirm
              title="确认删除这个用户？"
              ok-text="删除"
              cancel-text="取消"
              @confirm="deleteUser(record)"
            >
              <a-tooltip :title="record.id === currentUser?.id ? '不能删除当前登录账号' : '删除用户'">
                <a-button
                  danger
                  size="small"
                  :disabled="record.id === currentUser?.id"
                  :loading="deletingId === record.id"
                  aria-label="删除用户"
                >
                  <template #icon>
                    <DeleteOutlined />
                  </template>
                </a-button>
              </a-tooltip>
            </a-popconfirm>
          </div>
        </template>
      </template>
    </a-table>

    <section class="permission-admin-grid">
      <a-card class="permission-admin-card permission-setting-card" :bordered="false">
        <template #title>注册岗位设置</template>
        <template #extra>
          <a-tag color="blue">{{ settingsForm.registerableRoles.length }} 个开放</a-tag>
        </template>
        <a-checkbox-group
          v-model:value="settingsForm.registerableRoles"
          class="register-role-grid"
        >
          <a-checkbox
            v-for="option in registerableRoleOptions"
            :key="option.value"
            class="register-role-option"
            :class="{ 'is-active': settingsForm.registerableRoles.includes(option.value) }"
            :value="option.value"
          >
            <span class="register-role-label">{{ option.label }}</span>
            <span class="register-role-state">
              {{ settingsForm.registerableRoles.includes(option.value) ? '已开放' : '未开放' }}
            </span>
          </a-checkbox>
        </a-checkbox-group>
        <div class="permission-setting-footer">
          <span>自助注册岗位</span>
          <a-button type="primary" :loading="savingSettings" @click="saveSettings">
            保存设置
          </a-button>
        </div>
      </a-card>

      <a-card class="permission-admin-card permission-setting-card" :bordered="false">
        <template #title>页面更新控制</template>
        <template #extra>
          <a-tag :color="updatingRoleCount ? 'orange' : 'green'">
            {{ updatingRoleCount }} 个更新中
          </a-tag>
        </template>
        <div class="role-update-list">
          <div
            v-for="option in pagedPageUpdateRoleOptions"
            :key="option.value"
            class="role-update-row"
            :class="{ 'is-updating': settingsForm.rolePageUpdates[option.value] }"
          >
            <div class="role-update-copy">
              <strong>{{ option.label }}</strong>
              <span>{{ settingsForm.rolePageUpdates[option.value] ? '更新中' : '正常' }}</span>
            </div>
            <a-switch v-model:checked="settingsForm.rolePageUpdates[option.value]" />
          </div>
        </div>
        <div class="permission-setting-footer">
          <span>页面维护模式</span>
          <div class="permission-page-tabs" aria-label="页面更新控制分页">
            <button
              v-for="page in roleUpdatePages"
              :key="page"
              type="button"
              :class="{ active: page === roleUpdatePage }"
              @click="roleUpdatePage = page"
            >
              {{ page }}
            </button>
          </div>
        </div>
      </a-card>
    </section>

    <a-modal
      v-model:open="createOpen"
      title="新增用户"
      ok-text="创建用户"
      cancel-text="取消"
      :confirm-loading="creating"
      :mask-closable="false"
      @ok="submitCreateUser"
      @cancel="closeCreateModal"
    >
      <a-form layout="vertical" class="permission-form">
        <a-form-item label="账号" required>
          <a-input
            v-model:value="createForm.username"
            autocomplete="off"
            placeholder="例如 admin 或 zhangsan"
          />
        </a-form-item>
        <a-form-item label="姓名" required>
          <a-input
            v-model:value="createForm.name"
            autocomplete="off"
            placeholder="请输入姓名"
          />
        </a-form-item>
        <a-form-item label="邮箱">
          <a-input
            v-model:value="createForm.email"
            autocomplete="off"
            placeholder="可选"
          />
        </a-form-item>
        <a-form-item label="密码" required>
          <a-input-password
            v-model:value="createForm.password"
            autocomplete="new-password"
            placeholder="至少 6 位"
          />
        </a-form-item>
        <a-form-item label="角色" required>
          <a-select
            v-model:value="createForm.role"
            :options="roleOptions"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { message } from 'ant-design-vue'
import type { ColumnsType } from 'ant-design-vue/es/table'
import {
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons-vue'
import {
  createAuthUser,
  deleteAuthUser,
  fetchAuthSettings,
  fetchAuthUsers,
  updateAuthSettings,
  updateAuthUserRole,
  type CreateAuthUserPayload,
} from '@/api/permissions'
import {
  getAuthUser,
  PUBLIC_REGISTERABLE_ROLES,
  roleLabel,
  roleTagColor,
  USER_ROLE_OPTIONS,
  type AuthUser,
  type UserRole,
} from '@/api/auth'

const users = ref<AuthUser[]>([])
const loading = ref(false)
const creating = ref(false)
const savingSettings = ref(false)
const updatingId = ref('')
const deletingId = ref('')
const errorMessage = ref('')
const createOpen = ref(false)
const currentUser = getAuthUser()
const ROLE_UPDATE_PAGE_SIZE = 3
const roleUpdatePage = ref(1)

const roleOptions = computed(() =>
  currentUser?.role === 'super_admin'
    ? USER_ROLE_OPTIONS
    : USER_ROLE_OPTIONS.filter((option) => option.value !== 'super_admin'),
)

const createForm = reactive<CreateAuthUserPayload>({
  username: '',
  name: '',
  email: '',
  password: '',
  role: 'sales',
})

const settingsForm = reactive({
  registerableRoles: [] as UserRole[],
  rolePageUpdates: {} as Record<string, boolean>,
})

const columns = computed<ColumnsType<AuthUser>>(() => [
  { title: '账号', key: 'account', width: 260 },
  { title: '姓名', dataIndex: 'name', key: 'name', width: 160 },
  { title: '角色', key: 'role', width: 140 },
  { title: '创建时间', key: 'createdAt', width: 190 },
  { title: '操作', key: 'actions', width: 260 },
])

const registerableRoleOptions = computed(() =>
  USER_ROLE_OPTIONS.filter((option) => PUBLIC_REGISTERABLE_ROLES.includes(option.value)),
)

const pageUpdateRoleOptions = computed(() =>
  USER_ROLE_OPTIONS.filter((option) => option.value !== 'viewer'),
)

const roleUpdatePageTotal = computed(() =>
  Math.max(1, Math.ceil(pageUpdateRoleOptions.value.length / ROLE_UPDATE_PAGE_SIZE)),
)

const roleUpdatePages = computed(() =>
  Array.from({ length: roleUpdatePageTotal.value }, (_, index) => index + 1),
)

const pagedPageUpdateRoleOptions = computed(() => {
  const safePage = Math.min(roleUpdatePage.value, roleUpdatePageTotal.value)
  const start = (safePage - 1) * ROLE_UPDATE_PAGE_SIZE
  return pageUpdateRoleOptions.value.slice(start, start + ROLE_UPDATE_PAGE_SIZE)
})

const updatingRoleCount = computed(() =>
  pageUpdateRoleOptions.value.filter((option) => settingsForm.rolePageUpdates[option.value]).length,
)

function formatDate(value: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function resetCreateForm() {
  createForm.username = ''
  createForm.name = ''
  createForm.email = ''
  createForm.password = ''
  createForm.role = 'sales'
}

function openCreateModal() {
  errorMessage.value = ''
  resetCreateForm()
  createOpen.value = true
}

function closeCreateModal() {
  if (creating.value) return
  createOpen.value = false
  resetCreateForm()
}

async function loadUsers() {
  errorMessage.value = ''
  loading.value = true
  try {
    users.value = await fetchAuthUsers()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '用户列表读取失败'
  } finally {
    loading.value = false
  }
}

async function loadSettings() {
  try {
    const data = await fetchAuthSettings()
    settingsForm.registerableRoles = data.settings.registerableRoles
    settingsForm.rolePageUpdates = { ...data.settings.rolePageUpdates }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '权限设置读取失败'
  }
}

async function saveSettings() {
  errorMessage.value = ''
  savingSettings.value = true
  try {
    const data = await updateAuthSettings({
      registerableRoles: settingsForm.registerableRoles,
      rolePageUpdates: settingsForm.rolePageUpdates,
    })
    settingsForm.registerableRoles = data.settings.registerableRoles
    settingsForm.rolePageUpdates = { ...data.settings.rolePageUpdates }
    message.success('设置已保存')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '权限设置保存失败'
  } finally {
    savingSettings.value = false
  }
}

async function submitCreateUser() {
  errorMessage.value = ''
  const payload: CreateAuthUserPayload = {
    username: createForm.username.trim(),
    name: createForm.name.trim(),
    email: createForm.email?.trim(),
    password: createForm.password,
    role: createForm.role,
  }

  if (!payload.username || !payload.name || !payload.password) {
    errorMessage.value = '请填写账号、姓名和密码'
    return
  }

  creating.value = true
  try {
    const createdUser = await createAuthUser(payload)
    users.value = [...users.value, createdUser]
    message.success('用户已创建')
    createOpen.value = false
    resetCreateForm()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '用户创建失败'
  } finally {
    creating.value = false
  }
}

async function changeRole(user: AuthUser, role: UserRole) {
  if (user.role === role) return

  errorMessage.value = ''
  updatingId.value = user.id
  try {
    const updatedUser = await updateAuthUserRole(user.id, role)
    users.value = users.value.map((item) => item.id === updatedUser.id ? updatedUser : item)
    message.success('角色已更新')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '用户权限更新失败'
  } finally {
    updatingId.value = ''
  }
}

async function deleteUser(user: AuthUser) {
  errorMessage.value = ''
  deletingId.value = user.id
  try {
    await deleteAuthUser(user.id)
    users.value = users.value.filter((item) => item.id !== user.id)
    message.success('用户已删除')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '用户删除失败'
  } finally {
    deletingId.value = ''
  }
}

function roleChangeHandler(user: AuthUser, value: string | number) {
  void changeRole(user, String(value) as UserRole)
}

onMounted(() => {
  void loadUsers()
  void loadSettings()
})
</script>

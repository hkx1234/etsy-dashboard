<template>
  <a-layout class="app-shell">
    <a-layout-sider
      v-model:collapsed="collapsed"
      :trigger="null"
      collapsible
      :width="232"
      :collapsed-width="72"
      class="app-sider"
      :class="{ 'is-collapsed': collapsed }"
    >
      <div class="brand">
        <div class="brand-mark">
          <ShopOutlined />
        </div>
        <div v-if="!collapsed" class="brand-copy">
          <strong>Etsy 周报看板</strong>
          <span>Listing · Orders · Ads</span>
        </div>
      </div>

      <a-menu
        theme="dark"
        mode="inline"
        class="side-menu"
        :selected-keys="[selectedKey]"
        @click="handleMenuClick"
      >
        <a-menu-item v-if="showOperationsPages" key="/dashboard">
          <DashboardOutlined />
          <span>每周总览</span>
        </a-menu-item>
        <a-menu-item v-if="showOperationsPages" key="/products">
          <TagsOutlined />
          <span>产品表现</span>
        </a-menu-item>
        <a-menu-item v-if="showOperationsPages" key="/inventory">
          <DatabaseOutlined />
          <span>库存看板</span>
        </a-menu-item>
        <a-menu-item v-if="showOperationsPages" key="/orders">
          <ProfileOutlined />
          <span>订单状态</span>
        </a-menu-item>
        <a-menu-item v-if="showOperationsPages" key="/traffic">
          <FundOutlined />
          <span>广告与流量</span>
        </a-menu-item>
        <a-menu-item v-if="showPendingWorkspace" key="/coming-soon">
          <ClockCircleOutlined />
          <span>暂未开发</span>
        </a-menu-item>
        <a-menu-item v-if="showFinance" key="/finance">
          <AccountBookOutlined />
          <span>财务看板</span>
        </a-menu-item>
        <a-menu-item v-if="showPermissions" key="/permissions">
          <SafetyCertificateOutlined />
          <span>权限管理</span>
        </a-menu-item>
        <a-menu-item v-if="showPermissions" key="/internal-feedback">
          <MessageOutlined />
          <span>内部评价</span>
        </a-menu-item>
        <a-menu-item v-if="showReviews" key="/reviews">
          <StarOutlined />
          <span>评价看板</span>
        </a-menu-item>
      </a-menu>

      <button
        type="button"
        class="sider-collapse-trigger"
        :aria-label="collapsed ? '展开侧边栏' : '收起侧边栏'"
        :title="collapsed ? '展开侧边栏' : '收起侧边栏'"
        @click="collapsed = !collapsed"
      >
        <MenuUnfoldOutlined v-if="collapsed" />
        <MenuFoldOutlined v-else />
      </button>
    </a-layout-sider>

    <a-layout class="main-shell" :class="{ collapsed }">
      <a-layout-header class="topbar">
        <div class="topbar-left">
          <a-button type="text" class="icon-button" @click="collapsed = !collapsed">
            <template #icon>
              <MenuUnfoldOutlined v-if="collapsed" />
              <MenuFoldOutlined v-else />
            </template>
          </a-button>
          <div class="topbar-title">
            <strong>{{ pageTitle }}</strong>
            <span>从 Etsy Open API 本地同步商品、订单和库存数据</span>
          </div>
        </div>
        <div class="topbar-actions">
          <span class="topbar-user">{{ currentUser?.name || currentUser?.email }}</span>
          <a-tag :color="roleTagColor(currentUser?.role)">{{ roleText }}</a-tag>
          <a-button size="small" @click="logout">退出登录</a-button>
        </div>
      </a-layout-header>

      <a-layout-content class="content">
        <router-view />
      </a-layout-content>
    </a-layout>
  </a-layout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AccountBookOutlined,
  ClockCircleOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  FundOutlined,
  MessageOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ProfileOutlined,
  SafetyCertificateOutlined,
  ShopOutlined,
  StarOutlined,
  TagsOutlined,
} from '@ant-design/icons-vue'
import { canManageUsers, canViewFinance, canViewReviews, clearAuthSession, fetchUiSettings, getAuthUser, isRoleWorkspacePending, refreshAuthUser, roleLabel, roleTagColor } from '@/api/auth'

const collapsed = ref(false)
const route = useRoute()
const router = useRouter()
const currentUser = ref(getAuthUser())
const rolePageUpdates = ref<Record<string, boolean>>({})
const currentRole = computed(() => currentUser.value?.role || '')
const bypassComingSoon = computed(() => ['super_admin', 'owner', 'admin'].includes(currentRole.value))
const currentRoleUpdating = computed(() => Boolean(currentUser.value?.role && rolePageUpdates.value[currentUser.value.role]))
const roleUpdatingApplies = computed(() => currentRoleUpdating.value && !bypassComingSoon.value)
const showOperationsPages = computed(() => !roleUpdatingApplies.value && ['owner', 'admin', 'operator'].includes(currentRole.value))
const showPendingWorkspace = computed(() => !bypassComingSoon.value && (roleUpdatingApplies.value || isRoleWorkspacePending(currentUser.value)))
const showFinance = computed(() => !roleUpdatingApplies.value && canViewFinance(currentUser.value))
const showPermissions = computed(() => canManageUsers(currentUser.value))
const showReviews = computed(() => canViewReviews(currentUser.value))
const roleText = computed(() => roleLabel(currentUser.value?.role))

const selectedKey = computed(() => {
  const firstSegment = route.path.split('/')[1] || 'dashboard'
  return `/${firstSegment}`
})

const pageTitle = computed(() => String(route.meta.title ?? '每周总览'))

function handleMenuClick(info: { key: string | number }) {
  router.push(String(info.key))
}

function logout() {
  clearAuthSession()
  router.push('/login')
}

async function loadUiSettings() {
  try {
    const settings = await fetchUiSettings()
    rolePageUpdates.value = settings.rolePageUpdates || {}
  } catch {
    rolePageUpdates.value = {}
  }
}

async function loadCurrentUser() {
  try {
    currentUser.value = await refreshAuthUser()
  } catch {
    currentUser.value = getAuthUser()
  }
}

function redirectIfUpdating() {
  if (roleUpdatingApplies.value && route.path !== '/coming-soon' && route.path !== '/reviews' && !route.path.startsWith('/permissions')) {
    router.replace('/coming-soon')
  }
}

onMounted(() => {
  void loadCurrentUser()
    .then(loadUiSettings)
    .then(redirectIfUpdating)
})

watch(roleUpdatingApplies, redirectIfUpdating)

</script>

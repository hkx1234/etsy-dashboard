import { createRouter, createWebHistory } from 'vue-router'
import { type RouteLocationNormalized } from 'vue-router'
import MainLayout from '@/layouts/MainLayout.vue'
import ComingSoon from '@/pages/ComingSoon.vue'
import Dashboard from '@/pages/Dashboard.vue'
import Finance from '@/pages/Finance.vue'
import Inventory from '@/pages/Inventory.vue'
import InternalFeedback from '@/pages/InternalFeedback.vue'
import Login from '@/pages/Login.vue'
import Permissions from '@/pages/Permissions.vue'
import Products from '@/pages/Analysis.vue'
import Reviews from '@/pages/Reviews.vue'
import Traffic from '@/pages/KeywordInsight.vue'
import { canViewFinance, canViewReviews, getAuthToken, getAuthUser, isRoleWorkspacePending, type AuthUser, type UserRole } from '@/api/auth'

const COMING_SOON_BYPASS_ROLES: UserRole[] = ['super_admin', 'owner', 'admin']

function bypassComingSoon(user: AuthUser | null) {
  return Boolean(user?.role && COMING_SOON_BYPASS_ROLES.includes(user.role))
}

function defaultRouteForUser(user: AuthUser | null) {
  if (user?.role === 'super_admin') return '/permissions'
  if (canViewReviews(user) && isRoleWorkspacePending(user)) return '/reviews'
  if (isRoleWorkspacePending(user)) return '/coming-soon'
  if (canViewFinance(user) && user?.role === 'finance') return '/finance'
  return '/dashboard'
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: Login,
      meta: { title: '登录', public: true },
    },
    {
      path: '/register',
      name: 'register',
      component: Login,
      meta: { title: '创建账号', public: true },
    },
    {
      path: '/',
      component: MainLayout,
      redirect: (to) => {
        const user = getAuthUser()
        return to.fullPath === '/' ? defaultRouteForUser(user) : '/dashboard'
      },
      children: [
        {
          path: 'dashboard',
          name: 'dashboard',
          component: Dashboard,
          meta: { title: '每周总览', allowedRoles: ['owner', 'admin', 'operator'] },
        },
        {
          path: 'products',
          name: 'products',
          component: Products,
          meta: { title: '产品表现', allowedRoles: ['owner', 'admin', 'operator'] },
        },
        {
          path: 'inventory',
          name: 'inventory',
          component: Inventory,
          meta: { title: '库存看板', allowedRoles: ['owner', 'admin', 'operator'] },
        },
        {
          path: 'traffic',
          name: 'traffic',
          component: Traffic,
          meta: { title: '广告与流量', allowedRoles: ['owner', 'admin', 'operator'] },
        },
        {
          path: 'finance',
          name: 'finance',
          component: Finance,
          meta: { title: '财务看板', allowedRoles: ['owner', 'admin', 'finance'] },
        },
        {
          path: 'permissions',
          name: 'permissions',
          component: Permissions,
          meta: { title: '权限管理', allowedRoles: ['super_admin', 'admin'] },
        },
        {
          path: 'internal-feedback',
          name: 'internal-feedback',
          component: InternalFeedback,
          meta: { title: '内部评价', allowedRoles: ['super_admin', 'admin'] },
        },
        {
          path: 'reviews',
          name: 'reviews',
          component: Reviews,
          meta: { title: '评价看板', allowedRoles: ['owner', 'admin', 'operator', 'sales'] },
        },
        {
          path: 'coming-soon',
          name: 'coming-soon',
          component: ComingSoon,
          meta: { title: '暂未开发' },
        },
      ],
    },
  ],
})

function routeAllowed(to: RouteLocationNormalized, user: AuthUser | null) {
  const allowedRoles = to.meta.allowedRoles as UserRole[] | undefined
  return !allowedRoles?.length || Boolean(user?.role && allowedRoles.includes(user.role))
}

router.beforeEach((to) => {
  const token = getAuthToken()
  const user = getAuthUser()
  const isPublic = Boolean(to.meta.public)

  if (isPublic && token && user) {
    return defaultRouteForUser(user)
  }

  if (!isPublic && (!token || !user)) {
    return {
      path: '/login',
      query: { redirect: to.fullPath },
    }
  }

  if (to.path === '/coming-soon' && bypassComingSoon(user)) {
    return defaultRouteForUser(user)
  }

  if (!routeAllowed(to, user)) {
    const fallback = defaultRouteForUser(user)
    return fallback === to.fullPath ? '/coming-soon' : fallback
  }

  return true
})

export default router

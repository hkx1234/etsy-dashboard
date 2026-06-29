<template>
  <div id="app">
    <nav class="navbar" v-if="authStore.token">
      <div class="nav-content">
        <router-link to="/dashboard" class="nav-logo">App Template</router-link>
        <div class="nav-links">
          <router-link to="/dashboard">Dashboard</router-link>
          <router-link to="/profile" class="nav-user-link">
            <span>{{ authStore.userName || 'Profile' }}</span>
          </router-link>
          <button class="btn-secondary" @click="logout" style="padding:6px 14px;font-size:13px">Logout</button>
        </div>
      </div>
    </nav>
    <router-view />
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useAuthStore } from './stores/auth'
import { useRouter } from 'vue-router'
import { getProfile } from './api/user'

const authStore = useAuthStore()
const router = useRouter()

onMounted(async () => {
  if (authStore.token) {
    try {
      const data = await getProfile()
      authStore.setUserInfo(data)
    } catch (e) {
      // ignore
    }
  }
})

function logout() {
  authStore.logout()
  router.push('/login')
}
</script>

<style scoped>
.navbar {
  background: white;
  border-bottom: 1px solid #e5e7eb;
  padding: 0 20px;
  position: sticky;
  top: 0;
  z-index: 100;
}
.nav-content {
  max-width: 960px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
}
.nav-logo {
  font-size: 18px;
  font-weight: 700;
  color: #4f46e5;
}
.nav-links {
  display: flex;
  align-items: center;
  gap: 20px;
  font-size: 14px;
}
.nav-links a.router-link-active {
  color: #4f46e5;
  font-weight: 600;
}
.nav-user-link {
  color: #6b7280;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.nav-user-link:hover {
  color: #4f46e5;
}
</style>

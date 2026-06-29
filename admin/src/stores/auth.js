import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('admin_token') || '')
  const refreshToken = ref(localStorage.getItem('admin_refreshToken') || '')
  const email = ref(localStorage.getItem('admin_email') || '')
  const role = ref(localStorage.getItem('admin_role') || '')

  const isLoggedIn = computed(() => !!token.value)

  function setAuth(data) {
    token.value = data.access_token
    refreshToken.value = data.refresh_token
    localStorage.setItem('admin_token', data.access_token)
    localStorage.setItem('admin_refreshToken', data.refresh_token)
  }

  function setMe(data) {
    email.value = data.email || ''
    role.value = data.role || ''
    localStorage.setItem('admin_email', email.value)
    localStorage.setItem('admin_role', role.value)
  }

  function logout() {
    token.value = ''
    refreshToken.value = ''
    email.value = ''
    role.value = ''
    localStorage.removeItem('admin_token')
    localStorage.removeItem('admin_refreshToken')
    localStorage.removeItem('admin_email')
    localStorage.removeItem('admin_role')
  }

  return { token, refreshToken, email, role, isLoggedIn, setAuth, setMe, logout }
})

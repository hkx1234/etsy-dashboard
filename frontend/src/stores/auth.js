import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('token') || '')
  const refreshToken = ref(localStorage.getItem('refreshToken') || '')
  const userEmail = ref(localStorage.getItem('userEmail') || '')
  const userId = ref(localStorage.getItem('userId') || '')
  const userName = ref(localStorage.getItem('userName') || '')

  const isLoggedIn = computed(() => !!token.value)

  function setAuth(data) {
    token.value = data.access_token
    refreshToken.value = data.refresh_token
    userEmail.value = data.user?.email || ''
    userId.value = data.user?.id || ''
    const u = data.user || {}
    userName.value = ((u.last_name || '') + (u.first_name || '')).trim() || u.email || ''
    localStorage.setItem('token', data.access_token)
    localStorage.setItem('refreshToken', data.refresh_token)
    localStorage.setItem('userEmail', userEmail.value)
    localStorage.setItem('userId', userId.value)
    localStorage.setItem('userName', userName.value)
  }

  function setUserInfo(info) {
    userName.value = ((info.last_name || '') + (info.first_name || '')).trim() || info.email || ''
    localStorage.setItem('userName', userName.value)
  }

  function logout() {
    token.value = ''
    refreshToken.value = ''
    userEmail.value = ''
    userId.value = ''
    userName.value = ''
    localStorage.removeItem('token')
    localStorage.removeItem('refreshToken')
    localStorage.removeItem('userEmail')
    localStorage.removeItem('userId')
    localStorage.removeItem('userName')
  }

  return { token, refreshToken, userEmail, userId, userName, isLoggedIn, setAuth, setUserInfo, logout }
})

import axios from 'axios'
import { useAuthStore } from '../stores/auth'
import router from '../router'

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 60000
})

// Request interceptor - auto attach token
api.interceptors.request.use(config => {
  const authStore = useAuthStore()
  if (authStore.token) {
    config.headers.Authorization = `Bearer ${authStore.token}`
  }
  return config
})

// Response interceptor - unified error handling
api.interceptors.response.use(
  response => {
    const data = response.data
    if (data.code === 200) {
      return data.data
    }
    return Promise.reject(new Error(data.message || 'Request failed'))
  },
  error => {
    if (error.response?.status === 403 || error.response?.status === 401) {
      const authStore = useAuthStore()
      authStore.logout()
      router.push('/login')
    }
    const data = error.response?.data
    let msg = data?.message || error.message || 'Network error'
    if (data?.data && Array.isArray(data.data)) {
      const details = data.data
        .map(d => d.msg ? d.msg.replace(/^Value error,\s*/i, '') : JSON.stringify(d))
        .join('; ')
      if (details) msg = details
    } else if (data?.detail) {
      if (Array.isArray(data.detail)) {
        msg = data.detail.map(d => d.msg || d.message || JSON.stringify(d)).join('; ')
      } else if (typeof data.detail === 'string') {
        msg = data.detail
      }
    }
    return Promise.reject(new Error(msg))
  }
)

export default api

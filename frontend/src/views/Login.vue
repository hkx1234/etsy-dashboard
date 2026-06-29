<template>
  <div class="auth-page">
    <div class="auth-card">
      <h2>App Template</h2>
      <p class="subtitle">Sign in to your account</p>
      <form @submit.prevent="handleLogin">
        <div class="form-group">
          <label>Email</label>
          <input v-model="email" type="email" placeholder="Enter email" required />
        </div>
        <div class="form-group">
          <label>Password</label>
          <input v-model="password" type="password" placeholder="Enter password" required />
        </div>
        <p v-if="error" class="error">{{ error }}</p>
        <button type="submit" class="btn-glow" :disabled="loading">
          {{ loading ? 'Signing in...' : 'Sign In' }}
        </button>
      </form>
      <p class="auth-link">Don't have an account? <router-link to="/register">Register</router-link></p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { login } from '../api/auth'
import { getProfile } from '../api/user'

const router = useRouter()
const authStore = useAuthStore()
const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function handleLogin() {
  error.value = ''
  loading.value = true
  try {
    const data = await login(email.value, password.value)
    authStore.setAuth(data)
    try {
      const profile = await getProfile()
      authStore.setUserInfo(profile)
    } catch (_) {}
    router.push('/dashboard')
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.auth-page { display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #f5f5f5; }
.auth-card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 2px 20px rgba(0,0,0,0.08); width: 100%; max-width: 400px; }
.auth-card h2 { margin: 0 0 4px; font-size: 24px; color: #4f46e5; }
.subtitle { color: #6b7280; margin: 0 0 24px; font-size: 14px; }
.form-group { margin-bottom: 16px; }
.form-group label { display: block; font-size: 13px; color: #374151; margin-bottom: 4px; font-weight: 500; }
.form-group input { width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; box-sizing: border-box; }
.form-group input:focus { outline: none; border-color: #4f46e5; box-shadow: 0 0 0 3px rgba(79,70,229,0.1); }
.error { color: #ef4444; font-size: 13px; margin: 8px 0; }
.btn-glow { width: 100%; padding: 11px; background: linear-gradient(135deg, #4f46e5, #7c3aed); color: white; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; }
.btn-glow:disabled { opacity: 0.6; cursor: not-allowed; }
.auth-link { text-align: center; margin-top: 16px; font-size: 13px; color: #6b7280; }
.auth-link a { color: #4f46e5; }
</style>

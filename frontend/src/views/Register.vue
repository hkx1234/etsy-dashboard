<template>
  <div class="auth-page">
    <div class="auth-card">
      <h2>Create Account</h2>
      <p class="subtitle">Register a new account</p>
      <form @submit.prevent="handleRegister">
        <div class="form-row">
          <div class="form-group">
            <label>First Name</label>
            <input v-model="firstName" type="text" placeholder="First name" required />
          </div>
          <div class="form-group">
            <label>Last Name</label>
            <input v-model="lastName" type="text" placeholder="Last name" required />
          </div>
        </div>
        <div class="form-group">
          <label>Email</label>
          <input v-model="email" type="email" placeholder="Enter email" required />
        </div>
        <div class="form-group">
          <label>Password</label>
          <input v-model="password" type="password" placeholder="At least 8 characters" required />
        </div>
        <p v-if="error" class="error">{{ error }}</p>
        <button type="submit" class="btn-glow" :disabled="loading">
          {{ loading ? 'Registering...' : 'Register' }}
        </button>
      </form>
      <p class="auth-link">Already have an account? <router-link to="/login">Sign In</router-link></p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { register } from '../api/auth'

const router = useRouter()
const authStore = useAuthStore()
const firstName = ref('')
const lastName = ref('')
const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function handleRegister() {
  error.value = ''
  loading.value = true
  try {
    const data = await register({
      first_name: firstName.value,
      last_name: lastName.value,
      email: email.value,
      password: password.value
    })
    authStore.setAuth(data)
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
.auth-card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 2px 20px rgba(0,0,0,0.08); width: 100%; max-width: 440px; }
.auth-card h2 { margin: 0 0 4px; font-size: 24px; color: #4f46e5; }
.subtitle { color: #6b7280; margin: 0 0 24px; font-size: 14px; }
.form-row { display: flex; gap: 12px; }
.form-row .form-group { flex: 1; }
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

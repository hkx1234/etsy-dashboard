<template>
  <div class="page">
    <div class="card">
      <h1>Welcome, {{ authStore.userName || 'User' }}!</h1>
      <p>You have successfully logged in. This is your dashboard.</p>
    </div>
  </div>
</template>

<script setup>
import { useAuthStore } from '../stores/auth'
const authStore = useAuthStore()
</script>

<style scoped>
.page { max-width: 960px; margin: 0 auto; padding: 40px 20px; }
.card { background: white; padding: 32px; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
.card h1 { margin: 0 0 8px; font-size: 22px; }
.card p { color: #6b7280; }
</style>

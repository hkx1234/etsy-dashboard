<template>
  <div class="page">
    <div class="card">
      <h1>Profile</h1>
      <div class="profile-info">
        <div class="info-row"><span class="label">Name:</span><span>{{ authStore.userName }}</span></div>
        <div class="info-row"><span class="label">Email:</span><span>{{ authStore.userEmail }}</span></div>
      </div>
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
.card h1 { margin: 0 0 24px; font-size: 22px; }
.profile-info { display: flex; flex-direction: column; gap: 12px; }
.info-row { display: flex; gap: 8px; }
.label { font-weight: 600; color: #374151; min-width: 80px; }
</style>

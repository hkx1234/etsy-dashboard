<template>
  <section class="page internal-feedback-page">
    <div class="page-heading">
      <div>
        <span class="eyebrow">Internal Feedback</span>
        <h1>内部评价</h1>
        <p>查看公司内部人员提交的页面意见、评分和使用反馈。</p>
      </div>
      <div class="permissions-toolbar">
        <a-button :loading="loading" @click="loadFeedback">
          <template #icon>
            <ReloadOutlined />
          </template>
          刷新
        </a-button>
      </div>
    </div>

    <a-alert
      v-if="errorMessage"
      class="permissions-alert"
      type="error"
      show-icon
      :message="errorMessage"
    />

    <div class="internal-feedback-summary">
      <div class="internal-feedback-metric">
        <span>反馈总数</span>
        <strong>{{ feedback.length }}</strong>
      </div>
      <div class="internal-feedback-metric">
        <span>平均评分</span>
        <strong>{{ averageRating }}</strong>
      </div>
      <div class="internal-feedback-metric">
        <span>参与岗位</span>
        <strong>{{ roleTotal }}</strong>
      </div>
    </div>

    <a-table
      class="internal-feedback-table"
      :columns="columns"
      :data-source="feedback"
      :loading="loading"
      row-key="id"
      :pagination="{ pageSize: 10, showSizeChanger: false }"
      :scroll="{ x: 920 }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'account'">
          <div class="permission-account">
            <strong>{{ record.username || '-' }}</strong>
            <span>ID {{ record.userId || '-' }}</span>
          </div>
        </template>

        <template v-else-if="column.key === 'role'">
          <a-tag :color="roleTagColor(record.role)">
            {{ roleLabel(record.role) }}
          </a-tag>
        </template>

        <template v-else-if="column.key === 'rating'">
          <a-rate :value="record.rating" disabled />
        </template>

        <template v-else-if="column.key === 'content'">
          <div class="internal-feedback-content">{{ record.content || '-' }}</div>
        </template>

        <template v-else-if="column.key === 'createdAt'">
          {{ formatDate(record.createdAt) }}
        </template>
      </template>
    </a-table>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { ColumnsType } from 'ant-design-vue/es/table'
import { ReloadOutlined } from '@ant-design/icons-vue'
import { fetchUserFeedback, type UserFeedback } from '@/api/permissions'
import { roleLabel, roleTagColor } from '@/api/auth'

const feedback = ref<UserFeedback[]>([])
const loading = ref(false)
const errorMessage = ref('')

const columns = computed<ColumnsType<UserFeedback>>(() => [
  { title: '账号', key: 'account', width: 180 },
  { title: '角色', key: 'role', width: 120 },
  { title: '页面', dataIndex: 'pageKey', key: 'pageKey', width: 140 },
  { title: '评分', key: 'rating', width: 180 },
  { title: '内容', key: 'content', width: 360 },
  { title: '提交时间', key: 'createdAt', width: 180 },
])

const averageRating = computed(() => {
  if (!feedback.value.length) return '-'
  const total = feedback.value.reduce((sum, item) => sum + Number(item.rating || 0), 0)
  return (total / feedback.value.length).toFixed(1)
})

const roleTotal = computed(() => {
  return new Set(feedback.value.map((item) => item.role).filter(Boolean)).size
})

function formatDate(value: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

async function loadFeedback() {
  errorMessage.value = ''
  loading.value = true
  try {
    feedback.value = await fetchUserFeedback()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '内部评价读取失败'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadFeedback()
})
</script>

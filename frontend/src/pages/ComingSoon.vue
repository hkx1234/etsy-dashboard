<template>
  <section class="page coming-soon-page">
    <div class="coming-soon-panel">
      <span class="eyebrow">Workspace</span>
      <h1>暂未开发</h1>
      <p>当前岗位的专属页面正在整理，可以先提交使用意见和评价。</p>

      <a-form layout="vertical" class="feedback-form">
        <a-form-item label="评价分数">
          <a-rate v-model:value="form.rating" />
        </a-form-item>
        <a-form-item label="意见内容" required>
          <a-textarea
            v-model:value="form.content"
            :rows="4"
            placeholder="请填写你希望补充的功能、页面问题或使用建议"
            :maxlength="500"
            show-count
          />
        </a-form-item>
        <a-button type="primary" :loading="submitting" @click="submitFeedback">
          提交意见
        </a-button>
      </a-form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { message } from 'ant-design-vue'
import { submitUserFeedback } from '@/api/permissions'

const submitting = ref(false)
const form = reactive({
  rating: 5,
  content: '',
})

async function submitFeedback() {
  const content = form.content.trim()
  if (!content) {
    message.warning('请填写意见内容')
    return
  }

  submitting.value = true
  try {
    await submitUserFeedback({
      pageKey: 'coming-soon',
      rating: form.rating,
      content,
    })
    form.content = ''
    form.rating = 5
    message.success('意见已提交')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '意见提交失败')
  } finally {
    submitting.value = false
  }
}
</script>

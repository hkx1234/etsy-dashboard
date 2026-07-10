<template>
  <section class="page-loading-state" role="status" aria-live="polite">
    <a-spin size="large" />
    <strong>{{ title }}</strong>
    <span>{{ description }}</span>
  </section>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  title?: string
  description?: string
}>(), {
  title: '正在加载中，请稍后',
  description: '系统正在读取最新数据。',
})
</script>

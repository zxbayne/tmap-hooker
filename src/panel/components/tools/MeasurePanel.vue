<template>
  <div class="result-block">
    <div v-if="measureMode === 'editing'" class="measure-edit-hint">
      拖拽测距点编辑 · 双击结束 · Esc 取消
    </div>
    <div v-else class="result-hint">
      {{ pointCount === 0 ? '请点击地图添加测量点' : '请继续点击添加更多点' }}
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  pointCount: number
  measureMode: 'idle' | 'drawing' | 'editing'
}>()
</script>

<template>
  <div class="toolbar">
    <button
      v-for="tool in TOOL_CONFIGS"
      :key="tool.id"
      class="tool-btn"
      :class="{ active: activeTool === tool.id, disabled: !isMapReady }"
      :title="tool.description"
      :disabled="!isMapReady"
      @click="emit('select', tool.id)"
    >
      <span class="tool-icon">{{ tool.icon }}</span>
      <span class="tool-name">{{ tool.name }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
// 从 TOOL_CONFIGS 动态渲染工具按钮，新增工具只需在 tool-config.ts 中注册，无需修改此组件
import { TOOL_CONFIGS } from '@shared/tool-config'

defineProps<{
  /** 当前激活的工具 id，用于高亮对应按钮。 */
  activeTool: string
  /** 地图未就绪时禁用所有工具按钮。 */
  isMapReady: boolean
}>()

const emit = defineEmits<{
  select: [toolId: string]
}>()
</script>

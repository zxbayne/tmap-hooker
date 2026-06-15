<template>
  <div v-if="showBar" class="action-bar">
    <button
      v-if="activeTool === TOOL_IDS.MULTI_POINT && pointCount >= 2"
      class="action-btn finish-btn"
      @click="emit('finish')"
    >
      完成
    </button>
    <button
      v-if="activeTool === TOOL_IDS.MULTI_POINT && pointCount > 0"
      class="action-btn undo-btn"
      @click="emit('undo')"
    >
      撤销
    </button>
    <button
      v-if="hasAnyData"
      class="action-btn clear-btn"
      @click="emit('clear')"
    >
      清除
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { TOOL_IDS } from '@shared/tool-config'
import type { SegmentInfo } from '../composables/useTool'

const props = defineProps<{
  activeTool: string
  pointCount: number
  segments: SegmentInfo[]
}>()

const emit = defineEmits<{
  finish: []
  undo: []
  clear: []
}>()

/**
 * 多边形工具激活时隐藏操作栏。
 * 多边形工具有自己的"绘制/清空/删除"按钮（在 PolygonPanel 内），不需要通用操作栏。
 */
const showBar = computed(() => props.activeTool !== TOOL_IDS.POLYGON)

/** 判断当前是否有可清除的数据（有数据时才显示清除按钮）。 */
const hasAnyData = computed(
  () => props.pointCount > 0 || props.segments.length > 0,
)
</script>

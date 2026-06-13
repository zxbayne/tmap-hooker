<template>
  <div class="result-block">
    <div v-if="segments.length === 0" class="result-hint">
      {{ pointCount === 0 ? '请点击地图添加测量点' : '请继续点击添加更多点' }}
    </div>
    <div v-else class="segment-list">
      <div v-for="seg in segments" :key="`${seg.from}-${seg.to}`" class="segment-row">
        <span class="seg-idx">{{ seg.from }} → {{ seg.to }}</span>
        <span class="seg-dist">{{ seg.label }}</span>
      </div>
      <div class="segment-row segment-total">
        <span class="seg-idx">合计</span>
        <span class="seg-dist">{{ totalLabel }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { SegmentInfo } from '../../composables/useTool'

defineProps<{
  /** 各测量段的距离信息列表，每段包含起止点序号和距离。 */
  segments: SegmentInfo[]
  /** 格式化后的总距离字符串，segments 为空时为空字符串。 */
  totalLabel: string
  /** 当前已点击的点数，用于显示引导文字。 */
  pointCount: number
}>()
</script>

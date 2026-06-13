<template>
  <div class="result-block">
    <div v-if="twoPointResult" class="result-distance">
      <span class="result-label">距离</span>
      <span class="result-value">{{ formatDistance(twoPointResult.distanceM) }}</span>
    </div>
    <div v-else-if="pointCount === 1" class="result-hint">请点击第二个点</div>
    <div v-else class="result-hint">请点击第一个点</div>
  </div>
</template>

<script setup lang="ts">
import type { MeasurementResultPayload } from '@shared/protocol'
import { formatDistance } from '@shared/utils/distance'

defineProps<{
  /** 测量完成后的结果，null 表示测量进行中。 */
  twoPointResult: MeasurementResultPayload | null
  /** 当前已点击的点数（0 或 1），用于显示不同的引导提示文字。 */
  pointCount: number
}>()
</script>

<template>
  <div v-if="showResult" class="result-panel">
    <TwoPointResult
      v-if="activeTool === TOOL_IDS.TWO_POINT || (twoPointResult && !activeTool)"
      :two-point-result="twoPointResult"
      :point-count="pointCount"
    />
    <MultiPointResult
      v-else-if="activeTool === TOOL_IDS.MULTI_POINT || (segments.length > 0 && !activeTool)"
      :segments="segments"
      :total-label="totalLabel"
      :point-count="pointCount"
    />
    <PolygonPanel
      v-else-if="activeTool === TOOL_IDS.POLYGON"
      :coords-text="polygonCoords"
      :selected-polygon-id="selectedPolygonId"
      :polygon-count="polygonCount"
      @draw="emit('drawPolygon', $event)"
      @delete="emit('deletePolygon')"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { TOOL_IDS } from '@shared/tool-config'
import type { MeasurementResultPayload } from '@shared/protocol'
import type { SegmentInfo } from '../composables/useTool'
import TwoPointResult from './tools/TwoPointResult.vue'
import MultiPointResult from './tools/MultiPointResult.vue'
import PolygonPanel from './tools/PolygonPanel.vue'

const props = defineProps<{
  activeTool: string
  twoPointResult: MeasurementResultPayload | null
  segments: SegmentInfo[]
  totalLabel: string
  pointCount: number
  polygonCoords: string
  selectedPolygonId: string | null
  polygonCount: number
}>()

const emit = defineEmits<{
  drawPolygon: [input: string]
  deletePolygon: []
}>()

/** 有激活工具或有历史数据时显示结果区域。 */
const showResult = computed(
  () =>
    props.activeTool !== '' ||
    props.twoPointResult !== null ||
    props.segments.length > 0,
)
</script>

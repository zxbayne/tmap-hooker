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
      :polygon-mode="polygonMode"
      :drawing-point-count="drawingPointCount"
      :polygon-layers="polygonLayers"
      @start-drawing="emit('startDrawing')"
      @finish-drawing="emit('finishDrawing')"
      @cancel-drawing="emit('cancelDrawing')"
      @undo-point="emit('undoPoint')"
      @delete-layer="(id) => emit('deleteLayer', id)"
      @rename-layer="(id, name) => emit('renameLayer', id, name)"
      @toggle-visible="(id) => emit('toggleVisible', id)"
      @select-layer="(id) => emit('selectLayer', id)"
      @draw-from-text="(input) => emit('drawFromText', input)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { TOOL_IDS } from '@shared/tool-config'
import type { MeasurementResultPayload } from '@shared/protocol'
import type { SegmentInfo, PolygonLayer } from '../composables/useTool'
import TwoPointResult from './tools/TwoPointResult.vue'
import MultiPointResult from './tools/MultiPointResult.vue'
import PolygonPanel from './tools/PolygonPanel.vue'

const props = defineProps<{
  activeTool: string
  twoPointResult: MeasurementResultPayload | null
  segments: SegmentInfo[]
  totalLabel: string
  pointCount: number
  // polygon
  polygonMode: 'idle' | 'drawing'
  drawingPointCount: number
  polygonLayers: PolygonLayer[]
}>()

const emit = defineEmits<{
  startDrawing: []
  finishDrawing: []
  cancelDrawing: []
  undoPoint: []
  deleteLayer: [id: string]
  renameLayer: [id: string, name: string]
  toggleVisible: [id: string]
  selectLayer: [id: string]
  drawFromText: [input: string]
}>()

const showResult = computed(
  () =>
    props.activeTool !== '' ||
    props.twoPointResult !== null ||
    props.segments.length > 0,
)
</script>

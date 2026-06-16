<template>
  <div v-if="showResult" class="result-panel">
    <MeasurePanel
      v-if="activeTool === TOOL_IDS.MULTI_POINT"
      :point-count="pointCount"
      :measure-mode="measureMode"
    />
    <PolygonPanel
      v-else-if="activeTool === TOOL_IDS.POLYGON"
      :polygon-mode="polygonMode"
      :drawing-point-count="drawingPointCount"
      :editing-polygon-id="editingPolygonId"
      @start-drawing="$emit('startDrawing')"
      @finish-drawing="$emit('finishDrawing')"
      @cancel-drawing="$emit('cancelDrawing')"
      @undo-point="$emit('undoPoint')"
      @draw-from-text="(input) => $emit('drawFromText', input)"
      @finish-edit="$emit('finishEdit')"
      @cancel-edit="$emit('cancelEdit')"
    />
    <CirclePanel
      v-else-if="activeTool === TOOL_IDS.CIRCLE"
      :circle-mode="circleMode"
      :circle-preview="circlePreview"
      :preview-geometry="circlePreviewGeometry"
      @start-drawing="$emit('startDrawingCircle')"
      @cancel-drawing="$emit('cancelDrawingCircle')"
      @update-circle="(id, r, n) => $emit('updateCircle', id, r, n)"
      @finish-circle="$emit('finishCircle')"
      @commit-edit="$emit('commitEditCircle')"
      @cancel-edit="$emit('cancelEditCircle')"
    />
    <PointPanel
      v-else-if="activeTool === TOOL_IDS.POINT_MARKER"
      @import-points="(input) => $emit('importPoints', input)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { TOOL_IDS } from '@shared/tool-config'
import type { CirclePreview, CircleGeometry } from './tools/CirclePanel.vue'
import PolygonPanel from './tools/PolygonPanel.vue'
import CirclePanel from './tools/CirclePanel.vue'
import PointPanel from './tools/PointPanel.vue'
import MeasurePanel from './tools/MeasurePanel.vue'

const props = defineProps<{
  activeTool: string
  pointCount: number
  measureMode: 'idle' | 'drawing' | 'editing'
  polygonMode: 'idle' | 'drawing'
  drawingPointCount: number
  editingPolygonId: string | null
  circleMode: 'idle' | 'drawing' | 'placed' | 'editing'
  circlePreview: CirclePreview | null
  circlePreviewGeometry: CircleGeometry | null
}>()

defineEmits<{
  startDrawing: []
  finishDrawing: []
  cancelDrawing: []
  undoPoint: []
  drawFromText: [input: string]
  finishEdit: []
  cancelEdit: []
  updateCircle: [id: string, radius: number, nPoints: number]
  finishCircle: []
  startDrawingCircle: []
  cancelDrawingCircle: []
  commitEditCircle: []
  cancelEditCircle: []
  importPoints: [input: string]
}>()

const showResult = computed(() => props.activeTool !== '')
</script>

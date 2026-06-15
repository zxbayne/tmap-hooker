<template>
  <div v-if="showResult" class="result-panel">
    <MultiPointResult
      v-if="activeTool === TOOL_IDS.MULTI_POINT || (segments.length > 0 && !activeTool)"
      :segments="segments"
      :total-label="totalLabel"
      :point-count="pointCount"
    />
    <PolygonPanel
      v-else-if="activeTool === TOOL_IDS.POLYGON"
      :polygon-mode="polygonMode"
      :drawing-point-count="drawingPointCount"
      :polygon-layers="polygonLayers"
      :editing-polygon-id="editingPolygonId"
      @start-drawing="emit('startDrawing')"
      @finish-drawing="emit('finishDrawing')"
      @cancel-drawing="emit('cancelDrawing')"
      @undo-point="emit('undoPoint')"
      @delete-layer="(id) => emit('deleteLayer', id)"
      @rename-layer="(id, name) => emit('renameLayer', id, name)"
      @toggle-visible="(id) => emit('toggleVisible', id)"
      @select-layer="(id) => emit('selectLayer', id)"
      @draw-from-text="(input) => emit('drawFromText', input)"
      @start-edit="(id) => emit('startEdit', id)"
      @finish-edit="emit('finishEdit')"
      @cancel-edit="emit('cancelEdit')"
    />
    <CirclePanel
      v-else-if="activeTool === TOOL_IDS.CIRCLE"
      :circle-preview="circlePreview"
      :preview-geometry="circlePreviewGeometry"
      @update-circle="(id, r, n) => emit('updateCircle', id, r, n)"
      @finish-circle="emit('finishCircle')"
    />
    <PointPanel
      v-else-if="activeTool === TOOL_IDS.POINT_MARKER"
      :point-markers="pointMarkers"
      @delete-point="(id) => emit('deletePoint', id)"
      @rename-point="(id, name) => emit('renamePoint', id, name)"
      @toggle-visible="(id) => emit('togglePointVisible', id)"
      @select-point="(id, multi) => emit('selectPoint', id, multi)"
      @import-points="(input) => emit('importPoints', input)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { TOOL_IDS } from '@shared/tool-config'
import type { SegmentInfo, PolygonLayer, PointMarkerItem } from '../composables/useTool'
import type { CirclePreview, CircleGeometry } from './tools/CirclePanel.vue'
import MultiPointResult from './tools/MultiPointResult.vue'
import PolygonPanel from './tools/PolygonPanel.vue'
import CirclePanel from './tools/CirclePanel.vue'
import PointPanel from './tools/PointPanel.vue'

const props = defineProps<{
  activeTool: string
  segments: SegmentInfo[]
  totalLabel: string
  pointCount: number
  // polygon
  polygonMode: 'idle' | 'drawing'
  drawingPointCount: number
  polygonLayers: PolygonLayer[]
  editingPolygonId: string | null
  // point marker
  pointMarkers: PointMarkerItem[]
  // circle
  circlePreview: CirclePreview | null
  circlePreviewGeometry: CircleGeometry | null
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
  startEdit: [id: string]
  finishEdit: []
  cancelEdit: []
  // circle
  updateCircle: [id: string, radius: number, nPoints: number]
  finishCircle: []
  // point marker
  deletePoint: [id: string]
  renamePoint: [id: string, name: string]
  togglePointVisible: [id: string]
  selectPoint: [id: string, multiSelect: boolean]
  importPoints: [input: string]
}>()

const showResult = computed(
  () =>
    props.activeTool !== '' ||
    props.segments.length > 0 ||
    props.pointMarkers.length > 0,
)
</script>

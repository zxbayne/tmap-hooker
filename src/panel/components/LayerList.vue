<template>
  <div v-if="layers.length > 0" class="layer-list">
    <div class="layer-list-header">
      <span class="layer-list-title">图层</span>
      <span class="layer-count">{{ layers.length }}</span>
    </div>
    <ul class="layer-items">
      <li
        v-for="layer in layers"
        :key="layer.id"
        :class="[
          'layer-item',
          { 'layer-selected': layer.selected },
          { 'layer-hidden': !layer.visible },
        ]"
        draggable="true"
        @click.stop="$emit('selectLayer', layer.id)"
        @dragstart="onDragStart($event, layer.id)"
        @dragover.prevent="onDragOver($event, layer.id)"
        @dragleave="onDragLeave($event)"
        @drop="onDrop($event, layer.id)"
        @dragend="onDragEnd"
      >
        <span class="layer-grip" title="拖拽排序">⠿</span>
        <span class="layer-icon">{{ kindIcon(layer.kind) }}</span>
        <span
          v-if="editingId !== layer.id"
          class="layer-name"
          :title="layer.name"
          @dblclick="startRename(layer.id, layer.name)"
        >{{ layer.name }}</span>
        <input
          v-else
          ref="nameInput"
          v-model="editingName"
          class="layer-name-input"
          maxlength="30"
          @blur="commitRename(layer.id)"
          @keydown.enter="commitRename(layer.id)"
          @keydown.escape="cancelRename"
        />
        <button
          class="layer-btn layer-vis-btn"
          :title="layer.visible ? '隐藏' : '显示'"
          @click.stop="$emit('toggleVisible', layer.id)"
        >{{ layer.visible ? '👁' : '━' }}</button>
        <button
          v-if="isEditable(layer.kind)"
          class="layer-btn layer-edit-btn"
          title="编辑"
          @click.stop="$emit('editLayer', layer.id)"
        >✎</button>
        <button
          class="layer-btn layer-del-btn"
          title="删除"
          @click.stop="$emit('deleteLayer', layer.id)"
        >✕</button>
      </li>
    </ul>

    <!-- 选中图层详情区 -->
    <div v-if="selectedLayer" class="layer-detail">
      <div class="detail-kind">{{ kindLabel(selectedLayer.kind) }}</div>
      <div class="detail-name">{{ selectedLayer.name }}</div>

      <!-- 多边形 -->
      <template v-if="selectedLayer.kind === 'polygon' && selectedLayer.data?.kind === 'polygon'">
        <div class="detail-row"><span class="dl">顶点数</span><span>{{ selectedLayer.data.coords.length }}</span></div>
        <div class="detail-row"><span class="dl">面积</span><span>{{ fmtArea(selectedLayer.data.area) }}</span></div>
        <div class="detail-row"><span class="dl">周长</span><span>{{ fmtDist(selectedLayer.data.perimeter) }}</span></div>
        <div class="detail-actions">
          <button class="detail-btn" @click="$emit('editLayer', selectedLayer.id)">✎ 编辑顶点</button>
        </div>

        <!-- 坐标导出 -->
        <div class="export-section">
          <div class="export-fmt-bar">
            <button class="export-fmt-btn" :class="{ active: polyExportFmt === 'array' }" @click="polyExportFmt = 'array'">二维数组</button>
            <button class="export-fmt-btn" :class="{ active: polyExportFmt === 'semicolon' }" @click="polyExportFmt = 'semicolon'">分号格式</button>
          </div>
          <textarea
            class="export-textarea"
            readonly
            :value="polyExportText(selectedLayer.data.coords)"
            rows="3"
            spellcheck="false"
          />
          <button class="detail-btn export-copy-btn" @click="copyPolyCoords(selectedLayer.data.coords)">
            {{ polyCopied ? '已复制 ✓' : '📋 复制' }}
          </button>
        </div>
      </template>

      <!-- 圆形 -->
      <template v-if="selectedLayer.kind === 'circle' && selectedLayer.data?.kind === 'circle'">
        <div class="detail-row"><span class="dl">圆心</span><span>{{ selectedLayer.data.center.lng.toFixed(6) }}, {{ selectedLayer.data.center.lat.toFixed(6) }}</span></div>
        <div class="detail-row"><span class="dl">半径</span><span>{{ fmtDist(selectedLayer.data.radius) }}</span></div>
        <div class="detail-row"><span class="dl">拟合边数</span><span>{{ selectedLayer.data.nPoints }}</span></div>
        <div class="detail-row"><span class="dl">面积</span><span>{{ fmtArea(selectedLayer.data.area) }}</span></div>
        <div class="detail-row"><span class="dl">周长</span><span>{{ fmtDist(selectedLayer.data.perimeter) }}</span></div>
        <div class="detail-actions">
          <button class="detail-btn" @click="$emit('editLayer', selectedLayer.id)">✎ 编辑圆形</button>
        </div>

        <!-- 圆形坐标导出 -->
        <div class="export-section">
          <div class="export-fmt-bar">
            <button class="export-fmt-btn" :class="{ active: circleExportFmt === 'array' }" @click="circleExportFmt = 'array'">二维数组</button>
            <button class="export-fmt-btn" :class="{ active: circleExportFmt === 'semicolon' }" @click="circleExportFmt = 'semicolon'">分号格式</button>
          </div>
          <textarea
            class="export-textarea"
            readonly
            :value="circleExportText(selectedLayer.data)"
            rows="3"
            spellcheck="false"
          />
          <button class="detail-btn export-copy-btn" @click="copyCircleCoords(selectedLayer.data)">
            {{ circleCopied ? '已复制 ✓' : '📋 复制' }}
          </button>
        </div>
      </template>

      <!-- 测距 -->
      <template v-if="selectedLayer.kind === 'measure' && selectedLayer.data?.kind === 'measure'">
        <div class="detail-row"><span class="dl">段数</span><span>{{ selectedLayer.data.segmentDistances.length }}</span></div>
        <div class="detail-row"><span class="dl">总距</span><span>{{ fmtDist(selectedLayer.data.totalDistance) }}</span></div>
        <div class="detail-segments">
          <div v-for="(d, i) in selectedLayer.data.segmentDistances" :key="i" class="seg-row">
            <span class="seg-idx">段{{ i + 1 }}</span>
            <span class="seg-dist">{{ fmtDist(d) }}</span>
          </div>
        </div>
        <div class="detail-actions">
          <button class="detail-btn" @click="$emit('editLayer', selectedLayer.id)">✎ 编辑测距</button>
        </div>
      </template>

      <!-- 打点 -->
      <template v-if="selectedLayer.kind === 'point-marker' && selectedLayer.data?.kind === 'point-marker'">
        <div class="detail-row"><span class="dl">坐标</span><span>{{ selectedLayer.data.lng.toFixed(6) }}, {{ selectedLayer.data.lat.toFixed(6) }}</span></div>
        <div class="detail-actions">
          <button class="detail-btn" @click="copyCoords(selectedLayer.data)">📋 复制坐标</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import type { GenericLayer, LayerKind, PointMarkerLayerData, PolygonLayerData, CircleLayerData } from '@shared/protocol'

const props = defineProps<{
  layers: GenericLayer[]
  selectedLayer: GenericLayer | null
}>()

const emit = defineEmits<{
  selectLayer: [id: string]
  toggleVisible: [id: string]
  deleteLayer: [id: string]
  renameLayer: [id: string, name: string]
  reorder: [ids: string[]]
  editLayer: [id: string]
}>()

const editingId = ref<string | null>(null)
const editingName = ref('')
const dragId = ref<string | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)

// 多边形坐标导出
const polyExportFmt = ref<'array' | 'semicolon'>('array')
const polyCopied = ref(false)

function polyExportText(coords: Array<{ lat: number; lng: number }>): string {
  if (coords.length === 0) return ''
  if (polyExportFmt.value === 'array') {
    return JSON.stringify(coords.map(c => [c.lng, c.lat]))
  }
  return coords.map(c => `${c.lng},${c.lat}`).join(';')
}

async function copyPolyCoords(coords: Array<{ lat: number; lng: number }>) {
  const text = polyExportText(coords)
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    polyCopied.value = true
    setTimeout(() => { polyCopied.value = false }, 2000)
  } catch { /* clipboard not available */ }
}

// ── 圆形坐标导出 ────────────────────────────────────────────────────────────

const circleExportFmt = ref<'array' | 'semicolon'>('array')
const circleCopied = ref(false)

/** 用圆心 + 半径近似生成多边形顶点（与 hook 端 _fallbackPoints 相同算法）。 */
function generateCircleVertices(data: CircleLayerData): Array<{ lat: number; lng: number }> {
  const { center, radius, nPoints } = data
  const points: Array<{ lat: number; lng: number }> = []
  const step = (2 * Math.PI) / nPoints
  const latPerM = 1 / 111320
  for (let i = 0; i < nPoints; i++) {
    const angle = i * step
    const cosA = Math.cos(angle)
    const lngPerM = 1 / (111320 * Math.cos(center.lat * Math.PI / 180))
    points.push({
      lat: center.lat + radius * Math.sin(angle) * latPerM,
      lng: center.lng + radius * cosA * lngPerM,
    })
  }
  return points
}

function circleExportText(data: CircleLayerData): string {
  const coords = generateCircleVertices(data)
  if (circleExportFmt.value === 'array') {
    return JSON.stringify(coords.map(c => [c.lng, c.lat]))
  }
  return coords.map(c => `${c.lng},${c.lat}`).join(';')
}

async function copyCircleCoords(data: CircleLayerData) {
  const text = circleExportText(data)
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    circleCopied.value = true
    setTimeout(() => { circleCopied.value = false }, 2000)
  } catch { /* clipboard not available */ }
}

function kindIcon(kind: LayerKind): string {
  switch (kind) {
    case 'polygon': return '⬡'
    case 'circle': return '◯'
    case 'measure': return '📏'
    case 'point-marker': return '📍'
    default: return '●'
  }
}

function kindLabel(kind: LayerKind): string {
  switch (kind) {
    case 'polygon': return '📐 多边形'
    case 'circle': return '⭕ 圆形'
    case 'measure': return '📏 测距'
    case 'point-marker': return '📍 打点'
    default: return kind
  }
}

function isEditable(kind: LayerKind): boolean {
  return kind === 'polygon' || kind === 'circle' || kind === 'measure'
}

function fmtDist(m: number | null): string {
  if (m == null) return '—'
  if (m >= 1000) return (m / 1000).toFixed(2) + ' km'
  return m.toFixed(1) + ' m'
}

function fmtArea(sqm: number | null): string {
  if (sqm == null) return '—'
  if (sqm >= 1_000_000) return (sqm / 1_000_000).toFixed(2) + ' km²'
  return sqm.toFixed(1) + ' m²'
}

function copyCoords(data: PointMarkerLayerData) {
  const text = `${data.lng.toFixed(6)}, ${data.lat.toFixed(6)}`
  navigator.clipboard.writeText(text).catch(() => {})
}

function startRename(id: string, name: string) {
  editingId.value = id
  editingName.value = name
  nextTick(() => {
    nameInput.value?.focus()
    nameInput.value?.select()
  })
}

function commitRename(id: string) {
  if (!editingId.value) return
  const name = editingName.value.trim()
  if (name) emit('renameLayer', id, name)
  editingId.value = null
}

function cancelRename() { editingId.value = null }

// ── Drag & drop ──────────────────────────────────────────────────────────────

function onDragStart(e: DragEvent, id: string) {
  dragId.value = id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
  ;(e.currentTarget as HTMLElement)?.classList.add('layer-dragging')
}

function onDragOver(e: DragEvent, _id: string) {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  ;(e.currentTarget as HTMLElement)?.classList.add('layer-drag-over')
}

function onDragLeave(e: DragEvent) {
  ;(e.currentTarget as HTMLElement)?.classList.remove('layer-drag-over')
}

function onDrop(e: DragEvent, targetId: string) {
  e.preventDefault()
  ;(e.currentTarget as HTMLElement)?.classList.remove('layer-drag-over')
  const srcId = dragId.value
  if (!srcId || srcId === targetId) return
  const list = props.layers
  const srcIdx = list.findIndex(l => l.id === srcId)
  const tgtIdx = list.findIndex(l => l.id === targetId)
  if (srcIdx === -1 || tgtIdx === -1) return
  const newOrder = list.map(l => l.id)
  newOrder.splice(srcIdx, 1)
  newOrder.splice(tgtIdx, 0, srcId)
  emit('reorder', newOrder)
}

function onDragEnd(e: DragEvent) {
  dragId.value = null
  ;(e.currentTarget as HTMLElement)?.classList.remove('layer-dragging')
  document.querySelectorAll('.layer-drag-over').forEach(el => el.classList.remove('layer-drag-over'))
}
</script>

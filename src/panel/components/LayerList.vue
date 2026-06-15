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
        <!-- 拖拽手柄 -->
        <span class="layer-grip" title="拖拽排序">⠿</span>

        <!-- 类型图标 -->
        <span class="layer-icon">{{ kindIcon(layer.kind) }}</span>

        <!-- 名称（双击可编辑） -->
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

        <!-- 可见性切换 -->
        <button
          class="layer-btn layer-vis-btn"
          :title="layer.visible ? '隐藏' : '显示'"
          @click.stop="$emit('toggleVisible', layer.id)"
        >{{ layer.visible ? '👁' : '━' }}</button>

        <!-- 编辑（仅测距支持） -->
        <button
          v-if="layer.kind === 'measure'"
          class="layer-btn layer-edit-btn"
          title="编辑"
          @click.stop="$emit('editLayer', layer.id)"
        >✎</button>

        <!-- 删除 -->
        <button
          class="layer-btn layer-del-btn"
          title="删除"
          @click.stop="$emit('deleteLayer', layer.id)"
        >✕</button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import type { UnifiedLayer } from '../composables/useTool'

const props = defineProps<{
  layers: UnifiedLayer[]
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

function kindIcon(kind: string): string {
  switch (kind) {
    case 'polygon': return '⬡'
    case 'circle': return '◯'
    case 'measure': return '📏'
    case 'point-marker': return '📍'
    default: return '●'
  }
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
  if (name) {
    emit('renameLayer', id, name)
  }
  editingId.value = null
}

function cancelRename() {
  editingId.value = null
}

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

  // 交换图层顺序
  const srcIdx = props.layers.findIndex(l => l.id === srcId)
  const tgtIdx = props.layers.findIndex(l => l.id === targetId)
  if (srcIdx === -1 || tgtIdx === -1) return

  const newOrder = props.layers.map(l => l.id)
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

<template>
  <div class="polygon-panel">
    <!-- 模式状态栏 -->
    <div class="poly-mode-bar">
      <span class="poly-mode-badge" :class="editingPolygonId ? 'editing' : polygonMode">
        {{ editingPolygonId ? '✎ 编辑模式' : polygonMode === 'drawing' ? `● 绘制中 ${drawingPointCount}点` : '选择模式' }}
      </span>
      <button
        class="poly-new-btn"
        :disabled="polygonMode === 'drawing' || !!editingPolygonId"
        @click="$emit('startDrawing')"
      >
        + 新建多边形
      </button>
    </div>

    <!-- 绘制操作栏（仅绘制模式可见） -->
    <div v-if="polygonMode === 'drawing'" class="poly-draw-controls">
      <div class="poly-draw-hint">单击添加顶点 · 双击完成 · Esc 取消</div>
      <div class="poly-draw-actions">
        <button
          class="poly-btn draw-btn"
          :disabled="drawingPointCount < 3"
          @click="$emit('finishDrawing')"
        >✓ 完成</button>
        <button
          class="poly-btn undo-poly-btn"
          :disabled="drawingPointCount === 0"
          @click="$emit('undoPoint')"
        >↩ 撤销</button>
        <button class="poly-btn cancel-btn" @click="$emit('cancelDrawing')">✗ 取消</button>
      </div>
    </div>

    <!-- 编辑工具栏（编辑模式） -->
    <div v-if="editingPolygonId" class="poly-edit-controls">
      <div class="poly-edit-hint">拖拽顶点修改形状</div>
      <div class="poly-edit-actions">
        <button class="poly-btn draw-btn" @click="$emit('finishEdit')">✓ 完成编辑</button>
        <button class="poly-btn cancel-btn" @click="$emit('cancelEdit')">✗ 取消</button>
      </div>
    </div>

    <!-- 坐标导入（折叠） -->
    <div>
      <div class="poly-import-toggle" @click="coordsExpanded = !coordsExpanded">
        <span class="toggle-arrow" :class="{ open: coordsExpanded }">▶</span>
        坐标导入
      </div>
      <div v-show="coordsExpanded" class="poly-import-body">
        <textarea
          class="coords-input"
          v-model="localCoords"
          placeholder="[[lng,lat],[lng,lat],...]
或 lng,lat;lng,lat;..."
          rows="3"
          spellcheck="false"
        />
        <div class="polygon-actions">
          <button class="poly-btn draw-btn" :disabled="!localCoords.trim()" @click="onDrawFromText">绘制</button>
          <button class="poly-btn clear-btn" :disabled="!localCoords.trim()" @click="localCoords = ''">清空</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  polygonMode: 'idle' | 'drawing'
  drawingPointCount: number
  editingPolygonId: string | null
}>()

const emit = defineEmits<{
  startDrawing: []
  finishDrawing: []
  cancelDrawing: []
  undoPoint: []
  drawFromText: [input: string]
  finishEdit: []
  cancelEdit: []
}>()

const coordsExpanded = ref(false)
const localCoords = ref('')

function onDrawFromText() {
  const text = localCoords.value.trim()
  if (!text) return
  emit('drawFromText', text)
  localCoords.value = ''
}
</script>

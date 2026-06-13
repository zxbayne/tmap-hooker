<template>
  <div class="polygon-panel">
    <!-- 模式状态栏 -->
    <div class="poly-mode-bar">
      <span class="poly-mode-badge" :class="polygonMode">
        {{ polygonMode === 'drawing' ? `● 绘制中 ${drawingPointCount}点` : '选择模式' }}
      </span>
      <button
        class="poly-new-btn"
        :disabled="polygonMode === 'drawing'"
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
        >
          ✓ 完成
        </button>
        <button
          class="poly-btn undo-poly-btn"
          :disabled="drawingPointCount === 0"
          @click="$emit('undoPoint')"
        >
          ↩ 撤销
        </button>
        <button class="poly-btn cancel-btn" @click="$emit('cancelDrawing')">
          ✗ 取消
        </button>
      </div>
    </div>

    <!-- 图层列表 -->
    <div class="poly-layers">
      <div class="poly-layers-header">
        <span>图层列表</span>
        <span class="poly-layer-count">{{ polygonLayers.length }}</span>
      </div>

      <div class="poly-layer-list">
        <div v-if="polygonLayers.length === 0" class="poly-layer-empty">
          尚无多边形，点击"新建"开始绘制
        </div>

        <div
          v-for="layer in polygonLayers"
          :key="layer.id"
          class="poly-layer-item"
          :class="{ selected: layer.selected, 'hidden-layer': !layer.visible }"
          @click="onSelectLayer(layer.id)"
        >
          <!-- 可见性切换 -->
          <button
            class="poly-layer-vis"
            :title="layer.visible ? '隐藏' : '显示'"
            @click.stop="$emit('toggleVisible', layer.id)"
          >
            {{ layer.visible ? '👁' : '🚫' }}
          </button>

          <!-- 名称（双击进入编辑） -->
          <input
            v-if="editingId === layer.id"
            :ref="(el) => { nameInputRef.value = el as HTMLInputElement | null }"
            class="poly-name-input"
            :value="layer.name"
            @blur="onNameBlur(layer.id, $event)"
            @keydown.enter="onNameBlur(layer.id, $event)"
            @keydown.escape.stop="editingId = null"
            @click.stop
          />
          <span
            v-else
            class="poly-layer-name"
            :title="layer.name + '（双击重命名）'"
            @dblclick.stop="startEdit(layer.id)"
          >
            {{ layer.name }}
          </span>

          <!-- 删除按钮 -->
          <button
            class="poly-layer-del"
            title="删除"
            @click.stop="$emit('deleteLayer', layer.id)"
          >
            🗑
          </button>
        </div>
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
          placeholder="[[lat,lng],[lat,lng],...]
或 lat,lng;lat,lng;..."
          rows="3"
          spellcheck="false"
        />
        <div class="polygon-actions">
          <button
            class="poly-btn draw-btn"
            :disabled="!localCoords.trim()"
            @click="onDrawFromText"
          >
            绘制
          </button>
          <button
            class="poly-btn clear-btn"
            :disabled="!localCoords.trim()"
            @click="localCoords = ''"
          >
            清空
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import type { PolygonLayer } from '../../composables/useTool'

const props = defineProps<{
  polygonMode: 'idle' | 'drawing'
  drawingPointCount: number
  drawingCoordsText: string
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

const coordsExpanded = ref(false)
const localCoords = ref('')
const editingId = ref<string | null>(null)
const nameInputRef = ref<HTMLInputElement | null>(null)

// 当绘制中的坐标更新时，同步到坐标导入区（若展开）
watch(() => props.drawingCoordsText, (val) => {
  if (val && coordsExpanded.value) {
    localCoords.value = val
  }
})

function onSelectLayer(id: string) {
  if (editingId.value !== null) return
  emit('selectLayer', id)
}

function startEdit(id: string) {
  editingId.value = id
  nextTick(() => {
    nameInputRef.value?.select()
  })
}

function onNameBlur(id: string, evt: Event) {
  const input = evt.target as HTMLInputElement
  const name = input.value.trim()
  if (name) emit('renameLayer', id, name)
  editingId.value = null
}

function onDrawFromText() {
  const text = localCoords.value.trim()
  if (!text) return
  emit('drawFromText', text)
  localCoords.value = ''
}

// 在 Panel 层也监听 Escape，作为 hook 层 keydown 的备用
function onKeydown(evt: KeyboardEvent) {
  if (evt.key === 'Escape' && props.polygonMode === 'drawing') {
    emit('cancelDrawing')
  }
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

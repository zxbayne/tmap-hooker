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

    <!-- 坐标导出（选中多边形时显示） -->
    <div v-if="selectedLayer && selectedLayer.coords.length > 0" class="poly-coords-export">
      <div class="poly-coords-header">
        <span>坐标导出</span>
        <div class="poly-coords-fmt-bar">
          <button
            class="poly-coords-fmt-btn"
            :class="{ active: coordsFmt === 'array' }"
            @click="coordsFmt = 'array'"
          >二维数组</button>
          <button
            class="poly-coords-fmt-btn"
            :class="{ active: coordsFmt === 'semicolon' }"
            @click="coordsFmt = 'semicolon'"
          >分号格式</button>
        </div>
      </div>
      <textarea
        class="poly-coords-textarea"
        readonly
        :value="formattedCoords"
        rows="3"
        spellcheck="false"
      />
      <button class="poly-btn draw-btn poly-coords-copy-btn" @click="copyCoords">
        {{ copied ? '已复制 ✓' : '复制' }}
      </button>
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
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import type { PolygonLayer } from '../../composables/useTool'

const props = defineProps<{
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

const coordsExpanded = ref(false)
const localCoords = ref('')
const editingId = ref<string | null>(null)
const nameInputRef = ref<HTMLInputElement | null>(null)

// 坐标导出
const coordsFmt = ref<'array' | 'semicolon'>('array')
const copied = ref(false)

const selectedLayer = computed(() => props.polygonLayers.find((l) => l.selected) ?? null)

const formattedCoords = computed(() => {
  const coords = selectedLayer.value?.coords ?? []
  if (coords.length === 0) return ''
  if (coordsFmt.value === 'array') {
    return JSON.stringify(coords.map((c) => [c.lng, c.lat]))
  }
  return coords.map((c) => `${c.lng},${c.lat}`).join(';')
})

async function copyCoords() {
  if (!formattedCoords.value) return
  try {
    await navigator.clipboard.writeText(formattedCoords.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    // clipboard not available
  }
}


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

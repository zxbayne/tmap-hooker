<template>
  <div class="point-panel">
    <!-- 提示栏 -->
    <div class="point-hint">点击地图添加点位{{ isShiftHeld ? ' · Shift 多选模式' : '' }}</div>

    <!-- 点位列表 -->
    <div class="poly-layers">
      <div class="poly-layers-header">
        <span>点位列表</span>
        <span class="poly-layer-count">{{ pointMarkers.length }}</span>
      </div>

      <div class="poly-layer-list">
        <div v-if="pointMarkers.length === 0" class="poly-layer-empty">
          尚无点位，点击地图开始标记
        </div>

        <div
          v-for="marker in pointMarkers"
          :key="marker.id"
          class="poly-layer-item"
          :class="{ selected: marker.selected, 'hidden-layer': !marker.visible }"
          @click="onSelectMarker(marker.id)"
        >
          <!-- 可见性切换 -->
          <button
            class="poly-layer-vis"
            :title="marker.visible ? '隐藏' : '显示'"
            @click.stop="$emit('toggleVisible', marker.id)"
          >
            {{ marker.visible ? '👁' : '🚫' }}
          </button>

          <!-- 名称（双击进入编辑） -->
          <input
            v-if="editingId === marker.id"
            :ref="setNameInputRef"
            class="poly-name-input"
            :value="marker.name"
            @blur="onNameBlur(marker.id, $event)"
            @keydown.enter="onNameBlur(marker.id, $event)"
            @keydown.escape.stop="editingId = null"
            @click.stop
          />
          <span
            v-else
            class="poly-layer-name"
            :title="marker.name + '（双击重命名）'"
            @dblclick.stop="startEdit(marker.id)"
          >
            {{ marker.name }}
          </span>

          <!-- 删除按钮 -->
          <span class="poly-layer-actions">
            <button
              class="poly-layer-del"
              title="删除"
              @click.stop="$emit('deletePoint', marker.id)"
            >🗑</button>
          </span>
        </div>
      </div>
    </div>

    <!-- 坐标导出（折叠） -->
    <div>
      <div class="poly-import-toggle" @click="exportExpanded = !exportExpanded">
        <span class="toggle-arrow" :class="{ open: exportExpanded }">▶</span>
        坐标导出
        <span v-if="selectedMarkers.length > 0" class="point-sel-badge">{{ selectedMarkers.length }}</span>
      </div>
      <div v-show="exportExpanded" class="poly-import-body">
        <div v-if="selectedMarkers.length === 0" class="poly-layer-empty">
          请先在列表中选中点位
        </div>
        <template v-else>
          <div class="poly-coords-fmt-bar" style="margin-bottom: 6px;">
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
        </template>
      </div>
    </div>

    <!-- 坐标导入（折叠） -->
    <div>
      <div class="poly-import-toggle" @click="importExpanded = !importExpanded">
        <span class="toggle-arrow" :class="{ open: importExpanded }">▶</span>
        坐标导入
      </div>
      <div v-show="importExpanded" class="poly-import-body">
        <textarea
          class="coords-input"
          v-model="localCoords"
          placeholder="[lng,lat]
[[lng,lat],[lng,lat],...]
或 lng,lat;lng,lat;..."
          rows="3"
          spellcheck="false"
        />
        <div class="polygon-actions">
          <button
            class="poly-btn draw-btn"
            :disabled="!localCoords.trim()"
            @click="onImport"
          >
            导入
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
import type { PointMarkerItem } from '../../composables/useTool'

const props = defineProps<{
  pointMarkers: PointMarkerItem[]
}>()

const emit = defineEmits<{
  deletePoint: [id: string]
  renamePoint: [id: string, name: string]
  toggleVisible: [id: string]
  selectPoint: [id: string, multiSelect: boolean]
  importPoints: [input: string]
}>()

const exportExpanded = ref(false)
const importExpanded = ref(false)
const localCoords = ref('')
const editingId = ref<string | null>(null)
const nameInputRef = ref<HTMLInputElement | null>(null)
const setNameInputRef = (el: HTMLInputElement | null) => { nameInputRef.value = el }

const coordsFmt = ref<'array' | 'semicolon'>('array')
const copied = ref(false)
const isShiftHeld = ref(false)

function onKeydown(e: KeyboardEvent) { if (e.key === 'Shift') isShiftHeld.value = true }
function onKeyup(e: KeyboardEvent) { if (e.key === 'Shift') isShiftHeld.value = false }

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('keyup', onKeyup)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('keyup', onKeyup)
})

const selectedMarkers = computed(() => props.pointMarkers.filter((m) => m.selected))

const formattedCoords = computed(() => {
  if (selectedMarkers.value.length === 0) return ''
  if (coordsFmt.value === 'array') {
    return JSON.stringify(selectedMarkers.value.map((m) => [m.lng, m.lat]))
  }
  return selectedMarkers.value.map((m) => `${m.lng},${m.lat}`).join(';')
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

function onSelectMarker(id: string) {
  if (editingId.value !== null) return
  emit('selectPoint', id, isShiftHeld.value)
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
  if (name) emit('renamePoint', id, name)
  editingId.value = null
}

function onImport() {
  const text = localCoords.value.trim()
  if (!text) return
  emit('importPoints', text)
  localCoords.value = ''
}
</script>

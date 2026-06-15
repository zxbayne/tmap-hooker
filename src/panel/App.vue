<template>
  <!-- 折叠状态：右边缘小标签，可拖动调整垂直位置 -->
  <div
    v-if="isCollapsed"
    class="mini-tab"
    :style="{ top: miniTabY + 'px' }"
    @mousedown.prevent="startMiniDrag"
    @click.stop="onMiniTabClick"
    title="展开 TMap 工具"
  >
    <span>📍</span>
    <span class="mini-tab-text">TMap工具</span>
  </div>

  <!-- 展开状态：显示完整面板（始终贴靠右侧，仅垂直可拖动） -->
  <div
    v-else
    class="floating-panel"
    :style="{ right: '10px', top: posY + 'px' }"
  >
    <!-- 标题栏 / 拖拽区域 -->
    <div class="panel-header" @mousedown.prevent="startDrag">
      <span class="panel-title">📍 TMap 工具</span>
      <div class="header-actions">
        <span class="map-status" :class="statusClass">
          {{ statusText }}
        </span>
        <button class="icon-btn" :class="{ active: showSettings }" @click.stop="toggleSettings" title="设置">
          ⚙️
        </button>
        <button class="icon-btn" @click.stop="collapse" title="收起">
          ⟩
        </button>
      </div>
    </div>

    <!-- 设置下拉面板 -->
    <Settings v-if="showSettings" @debug-change="setDebug" @theme-change="onThemeChange" />

    <!-- 工具选择栏 -->
    <ToolBar
      :active-tool="activeTool"
      :is-map-ready="isMapReady"
      @select="setTool"
    />

    <!-- 工具结果/操作区 -->
    <ResultPanel
      :active-tool="activeTool"
      :segments="segments"
      :total-label="totalLabel"
      :point-count="pointCount"
      :polygon-mode="polygonMode"
      :drawing-point-count="drawingPointCount"
      :polygon-layers="polygonLayers"
      :editing-polygon-id="editingPolygonId"
      :point-markers="pointMarkers"
      :circle-preview="circlePreview"
      :circle-preview-geometry="circlePreviewGeometry"
      @start-drawing="startDrawingPolygon"
      @finish-drawing="finishDrawingPolygon"
      @cancel-drawing="cancelDrawingPolygon"
      @undo-point="undoPolygonPoint"
      @delete-layer="(id) => deletePolygon(id)"
      @rename-layer="(id, name) => renamePolygon(id, name)"
      @toggle-visible="(id) => togglePolygonVisible(id)"
      @select-layer="(id) => selectPolygonFromPanel(id)"
      @draw-from-text="(input) => drawPolygon(input)"
      @start-edit="(id) => startEditPolygon(id)"
      @finish-edit="finishEditPolygon"
      @cancel-edit="cancelEditPolygon"
      @update-circle="(id, r, n) => updateCircle(id, r, n)"
      @finish-circle="finishCircle"
      @delete-point="(id) => deletePointMarker(id)"
      @rename-point="(id, name) => renamePointMarker(id, name)"
      @toggle-point-visible="(id) => togglePointMarkerVisible(id)"
      @select-point="(id, multi) => selectPointMarkerFromPanel(id, multi)"
      @import-points="(input) => importPointMarkers(input)"
    />

    <!-- 操作按钮栏（多边形工具激活时隐藏） -->
    <ActionBar
      :active-tool="activeTool"
      :point-count="pointCount"
      :segments="segments"
      @finish="finish"
      @undo="undo"
      @clear="clear"
    />

    <!-- 鼠标坐标显示 -->
    <div v-if="mouseCoords" class="coords-display">
      {{ mouseCoords.lng.toFixed(6) }}, {{ mouseCoords.lat.toFixed(6) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useTool } from './composables/useTool'
import { THEME_KEY, HOST_ID } from '@shared/constants'
import ToolBar from './components/ToolBar.vue'
import ResultPanel from './components/ResultPanel.vue'
import ActionBar from './components/ActionBar.vue'
import Settings from './components/Settings.vue'

const {
  isMapReady,
  mapStatus,
  activeTool,
  segments,
  totalLabel,
  pointCount,
  polygonMode,
  drawingPointCount,
  polygonLayers,
  editingPolygonId,
  pointMarkers,
  setTool,
  finish,
  undo,
  clear,
  startDrawingPolygon,
  finishDrawingPolygon,
  cancelDrawingPolygon,
  undoPolygonPoint,
  drawPolygon,
  deletePolygon,
  selectPolygonFromPanel,
  togglePolygonVisible,
  renamePolygon,
  startEditPolygon,
  finishEditPolygon,
  cancelEditPolygon,
  deletePointMarker,
  selectPointMarkerFromPanel,
  togglePointMarkerVisible,
  renamePointMarker,
  importPointMarkers,
  updateCircle,
  finishCircle,
  setDebug,
  mouseCoords,
  circlePreview,
  circlePreviewGeometry,
} = useTool()

// ── 折叠/展开状态 ─────────────────────────────────────────────────────────────
const COLLAPSE_KEY = '__tmh_collapsed__'
const MINI_Y_KEY = '__tmh_mini_y__'
const isCollapsed = ref(localStorage.getItem(COLLAPSE_KEY) === 'true')

// ── 地图状态指示器 ────────────────────────────────────────────────────────────
const statusClass = computed(() => ({
  ready: mapStatus.value === 'ready',
  lost: mapStatus.value === 'lost',
  restored: mapStatus.value === 'restored',
}))

const statusText = computed(() => {
  switch (mapStatus.value) {
    case 'ready': return '已就绪'
    case 'lost': return '地图已断开'
    case 'restored': return '已恢复'
    default: return '未检测'
  }
})

function collapse() {
  isCollapsed.value = true
  localStorage.setItem(COLLAPSE_KEY, 'true')
}

function expand() {
  isCollapsed.value = false
  localStorage.setItem(COLLAPSE_KEY, 'false')
}

// ── Mini-tab 拖动 ────────────────────────────────────────────────────────────
const savedMiniY = localStorage.getItem(MINI_Y_KEY)
const miniTabY = ref(savedMiniY !== null ? Number(savedMiniY) : Math.max(0, window.innerHeight / 2 - 40))
let miniDragging = false
let miniDragOffsetY = 0
let miniHasMoved = false

function startMiniDrag(e: MouseEvent) {
  miniDragging = true
  miniHasMoved = false
  miniDragOffsetY = e.clientY - miniTabY.value
}

function onMiniTabClick() {
  if (miniHasMoved) {
    miniHasMoved = false
    return
  }
  expand()
}

// ── 设置面板可见性 ─────────────────────────────────────────────────────────────
const showSettings = ref(false)

function toggleSettings() {
  showSettings.value = !showSettings.value
}

// ── 面板垂直拖拽（始终贴靠右侧，仅垂直可移动）────────────────────────────────
const posY = ref(20)
let dragging = false
let dragOffsetY = 0

function startDrag(e: MouseEvent) {
  dragging = true
  dragOffsetY = e.clientY - posY.value
}

function onMouseMove(e: MouseEvent) {
  if (dragging) {
    posY.value = Math.max(0, Math.min(window.innerHeight - 100, e.clientY - dragOffsetY))
  }
  if (miniDragging) {
    miniHasMoved = true
    miniTabY.value = Math.max(0, Math.min(window.innerHeight - 80, e.clientY - miniDragOffsetY))
  }
}

function onMouseUp() {
  dragging = false
  if (miniDragging) {
    localStorage.setItem(MINI_Y_KEY, String(miniTabY.value))
  }
  miniDragging = false
}

function onResize() {
  posY.value = Math.max(0, Math.min(window.innerHeight - 100, posY.value))
}

// ── 主题管理 ──────────────────────────────────────────────────────────────────
const themePref = ref<'system' | 'light' | 'dark'>('system')
/** 系统级暗色模式媒体查询，供 "跟随系统" 模式使用。 */
const systemDark = window.matchMedia('(prefers-color-scheme: dark)')

/** 当前生效的主题（解析 'system' 后的实际值）。 */
const effectiveTheme = computed<'light' | 'dark'>(() => {
  if (themePref.value === 'system') return systemDark.matches ? 'dark' : 'light'
  return themePref.value
})

/** 将主题 class 应用到 Shadow 宿主元素（:host 选择器需要类在宿主上）。 */
function applyTheme() {
  const host = document.getElementById(HOST_ID)
  if (!host) return
  // 直接读 systemDark.matches，不依赖 computed（computed 缓存了旧值）
  const isDark = themePref.value === 'system'
    ? systemDark.matches
    : themePref.value === 'dark'
  host.classList.toggle('theme-light', !isDark)
  host.classList.toggle('theme-dark', isDark)
}

/** 从 chrome.storage 加载主题（首次读 localStorage 做迁移），异步初始化。 */
async function loadTheme() {
  try {
    const result = await chrome.storage.local.get(THEME_KEY)
    const stored = result[THEME_KEY]
    if (stored === 'system' || stored === 'light' || stored === 'dark') {
      themePref.value = stored
    }
  } catch {
    // chrome.storage 不可用时尝试 localStorage 迁移
    const local = localStorage.getItem(THEME_KEY)
    if (local === 'system' || local === 'light' || local === 'dark') {
      themePref.value = local
    }
  }
  applyTheme()
}

/** 监听系统主题变化（仅 "跟随系统" 模式需要）。 */
function onSystemThemeChange() {
  if (themePref.value === 'system') applyTheme()
}

/** 跨上下文同步：popup/panel 任一方改主题，另一方实时跟随。 */
function onStorageChanged(changes: Record<string, chrome.storage.StorageChange>, area: string) {
  if (area !== 'local') return
  const c = changes[THEME_KEY]
  if (!c) return
  const v = c.newValue
  if (v === 'system' || v === 'light' || v === 'dark') {
    themePref.value = v
    applyTheme()
  }
}

function onThemeChange(theme: 'system' | 'light' | 'dark') {
  themePref.value = theme
  chrome.storage.local.set({ [THEME_KEY]: theme }).catch(() => {
    localStorage.setItem(THEME_KEY, theme)
  })
  applyTheme()
}

onMounted(async () => {
  await loadTheme()
  systemDark.addEventListener('change', onSystemThemeChange)
  chrome.storage.onChanged.addListener(onStorageChanged)
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
  window.addEventListener('resize', onResize)
})

onUnmounted(() => {
  systemDark.removeEventListener('change', onSystemThemeChange)
  chrome.storage.onChanged.removeListener(onStorageChanged)
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <!-- 折叠状态：显示小球，点击展开 -->
  <div v-if="isCollapsed" class="mini-ball" @click="expand" title="TMap 工具">
    📍
  </div>

  <!-- 展开状态：显示完整面板 -->
  <div
    v-else
    class="floating-panel"
    :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
  >
    <!-- 标题栏 / 拖拽区域 -->
    <div class="panel-header" @mousedown.prevent="startDrag">
      <span class="panel-title">📍 TMap 工具</span>
      <div class="header-actions">
        <span class="map-status" :class="{ ready: isMapReady }">
          {{ isMapReady ? '已就绪' : '未检测' }}
        </span>
        <button class="icon-btn" :class="{ active: showSettings }" @click.stop="toggleSettings" title="设置">
          ⚙️
        </button>
        <button class="icon-btn" @click.stop="collapse" title="收起">
          ╌
        </button>
      </div>
    </div>

    <!-- 设置下拉面板 -->
    <Settings v-if="showSettings" @debug-change="setDebug" />

    <!-- 工具选择栏 -->
    <ToolBar
      :active-tool="activeTool"
      :is-map-ready="isMapReady"
      @select="setTool"
    />

    <!-- 工具结果/操作区 -->
    <ResultPanel
      :active-tool="activeTool"
      :two-point-result="twoPointResult"
      :segments="segments"
      :total-label="totalLabel"
      :point-count="pointCount"
      :polygon-coords="polygonCoords"
      :selected-polygon-id="selectedPolygonId"
      :polygon-count="polygonCount"
      @draw-polygon="drawPolygon"
      @delete-polygon="deletePolygon"
    />

    <!-- 操作按钮栏（多边形工具激活时隐藏，由 PolygonPanel 提供自己的按钮） -->
    <ActionBar
      :active-tool="activeTool"
      :point-count="pointCount"
      :two-point-result="twoPointResult"
      :segments="segments"
      @finish="finish"
      @undo="undo"
      @clear="clear"
    />
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted, onUnmounted } from 'vue'
import { useTool } from './composables/useTool'
import ToolBar from './components/ToolBar.vue'
import ResultPanel from './components/ResultPanel.vue'
import ActionBar from './components/ActionBar.vue'
import Settings from './components/Settings.vue'

const {
  isMapReady,
  activeTool,
  segments,
  totalLabel,
  pointCount,
  twoPointResult,
  polygonCoords,
  selectedPolygonId,
  polygonCount,
  setTool,
  finish,
  undo,
  clear,
  drawPolygon,
  deletePolygon,
  setDebug,
} = useTool()

// ── 折叠/展开状态 ─────────────────────────────────────────────────────────────
const COLLAPSE_KEY = '__tmh_collapsed__'
const isCollapsed = ref(localStorage.getItem(COLLAPSE_KEY) === 'true')

/** 收起面板为小球，状态持久化到 localStorage。 */
function collapse() {
  isCollapsed.value = true
  localStorage.setItem(COLLAPSE_KEY, 'true')
}

/** 从小球展开为完整面板，状态持久化到 localStorage。 */
function expand() {
  isCollapsed.value = false
  localStorage.setItem(COLLAPSE_KEY, 'false')
}

// ── 设置面板可见性 ─────────────────────────────────────────────────────────────
const showSettings = ref(false)

/** 切换设置下拉面板的显示/隐藏。 */
function toggleSettings() {
  showSettings.value = !showSettings.value
}

// ── 面板拖拽功能 ───────────────────────────────────────────────────────────────
const pos = reactive({ x: window.innerWidth - 260, y: 20 })
let dragging = false
let dragOffset = { x: 0, y: 0 }

/** 记录拖拽起始点，供 onMouseMove 计算偏移量。 */
function startDrag(e: MouseEvent) {
  dragging = true
  dragOffset.x = e.clientX - pos.x
  dragOffset.y = e.clientY - pos.y
}

/** 跟踪鼠标移动更新面板位置，限制在视口范围内。 */
function onMouseMove(e: MouseEvent) {
  if (!dragging) return
  pos.x = Math.max(0, Math.min(window.innerWidth - 240, e.clientX - dragOffset.x))
  pos.y = Math.max(0, Math.min(window.innerHeight - 100, e.clientY - dragOffset.y))
}

/** 结束拖拽。 */
function onMouseUp() {
  dragging = false
}

onMounted(() => {
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
})

onUnmounted(() => {
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
})
</script>

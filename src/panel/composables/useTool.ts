import { ref, computed } from 'vue'
import { HookEvent, PanelCmd } from '@shared/protocol'
import type { HookMessage, SegmentAddedPayload } from '@shared/protocol'
import { useMapBridge } from './useMapBridge'
import { formatDistance } from '@shared/utils/distance'

export interface SegmentInfo {
  from: number
  to: number
  distanceM: number
  label: string
}

/** 已提交的多边形图层信息，在 Panel 层维护名称、可见性、选中状态和顶点坐标（供坐标导出）。 */
export interface PolygonLayer {
  id: string
  name: string
  visible: boolean
  selected: boolean
  coords: Array<{ lat: number; lng: number }>
  /** 面积（平方米），hook 层计算后回传。仅选中/新建/编辑后更新。 */
  area: number | null
  /** 周长（米），hook 层计算后回传。 */
  perimeter: number | null
}

/** 打点标记条目，Panel 层维护名称、可见性、选中状态和坐标。 */
export interface PointMarkerItem {
  id: string
  name: string
  visible: boolean
  selected: boolean
  lat: number
  lng: number
}

export function useTool() {
  const { onHookEvent, sendCmd } = useMapBridge()

  const isMapReady = ref(false)
  const mapStatus = ref<'init' | 'ready' | 'lost' | 'restored'>('init')
  const activeTool = ref<string>('')
  const segments = ref<SegmentInfo[]>([])
  const totalM = ref(0)
  const pointCount = ref(0)

  // 多边形工具相关状态
  const polygonMode = ref<'idle' | 'drawing'>('idle')
  const drawingPointCount = ref(0)
  /** 当前绘制中各顶点坐标文本，供坐标导入折叠区同步显示。 */
  const drawingCoordsText = ref('')
  const polygonLayers = ref<PolygonLayer[]>([])
  const editingPolygonId = ref<string | null>(null)
  let polygonNameCounter = 0

  // 打点标记工具相关状态
  const pointMarkers = ref<PointMarkerItem[]>([])
  let pointNameCounter = 0

  // 鼠标坐标实时显示
  const mouseCoords = ref<{ lat: number; lng: number } | null>(null)

  // 圆形工具状态
  const circleMode = ref<'idle' | 'drawing' | 'placed' | 'editing'>('idle')
  const circlePreview = ref<{ id: string; lat: number; lng: number; radius: number; nPoints: number } | null>(null)
  const circlePreviewGeometry = ref<{ area: number; perimeter: number } | null>(null)

  const totalLabel = computed(() => (totalM.value > 0 ? formatDistance(totalM.value) : ''))
  const isMeasuring = computed(() => activeTool.value !== '')

  onHookEvent((msg: HookMessage) => {
    switch (msg.type) {
      case HookEvent.MAP_READY:
        isMapReady.value = true
        mapStatus.value = 'ready'
        break

      case HookEvent.MAP_LOST:
        isMapReady.value = false
        mapStatus.value = 'lost'
        break

      case HookEvent.MAP_RESTORED:
        isMapReady.value = true
        mapStatus.value = 'restored'
        // 2 秒后恢复为 ready 状态
        setTimeout(() => { if (mapStatus.value === 'restored') mapStatus.value = 'ready' }, 2000)
        break

      case HookEvent.POINT_ADDED:
        pointCount.value = msg.payload.index + 1
        break

      case HookEvent.SEGMENT_ADDED: {
        const p = msg.payload as SegmentAddedPayload
        segments.value.push({
          from: p.fromIdx + 1,
          to: p.toIdx + 1,
          distanceM: p.distanceM,
          label: formatDistance(p.distanceM),
        })
        totalM.value = p.totalM
        break
      }

      case HookEvent.POINT_REMOVED:
        pointCount.value = msg.payload.newCount
        if (segments.value.length > 0) {
          const removed = segments.value.pop()!
          totalM.value -= removed.distanceM
        }
        break

      case HookEvent.POLYGON_MODE_CHANGED:
        polygonMode.value = msg.payload.mode
        drawingPointCount.value = msg.payload.drawingPointCount
        if (msg.payload.mode === 'idle') {
          drawingCoordsText.value = ''
        }
        break

      case HookEvent.POLYGON_POINT_ADDED:
        drawingPointCount.value = msg.payload.index + 1
        drawingCoordsText.value = msg.payload.coordsText
        break

      case HookEvent.POLYGON_POINT_REMOVED:
        drawingPointCount.value = msg.payload.newCount
        drawingCoordsText.value = msg.payload.coordsText
        break

      case HookEvent.POLYGON_DRAWN:
        polygonLayers.value.push({
          id: msg.payload.id,
          name: `多边形 ${++polygonNameCounter}`,
          visible: true,
          selected: false,
          coords: [],
          area: null,
          perimeter: null,
        })
        break

      case HookEvent.POLYGON_SELECTED: {
        const prev = polygonLayers.value.find((l) => l.selected)
        if (prev) { prev.selected = false }
        const next = polygonLayers.value.find((l) => l.id === msg.payload.id)
        if (next) { next.selected = true; next.coords = msg.payload.coords }
        break
      }

      case HookEvent.POLYGON_DELETED: {
        const idx = polygonLayers.value.findIndex((l) => l.id === msg.payload.id)
        if (idx !== -1) polygonLayers.value.splice(idx, 1)
        break
      }

      case HookEvent.POLYGON_EDIT_STARTED:
        editingPolygonId.value = msg.payload.id
        break

      case HookEvent.POLYGON_EDIT_FINISHED: {
        editingPolygonId.value = null
        const edited = polygonLayers.value.find((l) => l.id === msg.payload.id)
        if (edited) edited.coords = msg.payload.coords
        break
      }

      case HookEvent.POLYGON_EDIT_CANCELLED:
        editingPolygonId.value = null
        break

      case HookEvent.POLYGON_GEOMETRY: {
        const layer = polygonLayers.value.find((l) => l.id === msg.payload.id)
        if (layer) {
          layer.area = msg.payload.area
          layer.perimeter = msg.payload.perimeter
        }
        break
      }

      case HookEvent.POINT_MARKER_ADDED:
        pointMarkers.value.push({
          id: msg.payload.id,
          name: msg.payload.name,
          visible: true,
          selected: false,
          lat: msg.payload.lat,
          lng: msg.payload.lng,
        })
        pointNameCounter++
        break

      case HookEvent.POINT_MARKER_DELETED: {
        const idx = pointMarkers.value.findIndex((p) => p.id === msg.payload.id)
        if (idx !== -1) pointMarkers.value.splice(idx, 1)
        break
      }

      case HookEvent.MOUSE_MOVE:
        mouseCoords.value = { lat: msg.payload.lat, lng: msg.payload.lng }
        break

      case HookEvent.CIRCLE_CENTER_SET:
        circleMode.value = 'drawing'
        circlePreview.value = {
          id: msg.payload.id,
          lat: msg.payload.lat,
          lng: msg.payload.lng,
          radius: msg.payload.radius,
          nPoints: msg.payload.nPoints,
        }
        circlePreviewGeometry.value = null
        break

      case HookEvent.CIRCLE_UPDATED:
        if (circlePreview.value && circlePreview.value.id === msg.payload.id) {
          if (circleMode.value === 'drawing') circleMode.value = 'placed'
          circlePreview.value.radius = msg.payload.radius
          circlePreview.value.nPoints = msg.payload.nPoints
          circlePreviewGeometry.value = {
            area: msg.payload.area,
            perimeter: msg.payload.perimeter,
          }
        }
        break

      case HookEvent.CIRCLE_EDIT_STARTED:
        circleMode.value = 'editing'
        break

      case HookEvent.CIRCLE_EDIT_COMMITTED:
      case HookEvent.CIRCLE_EDIT_CANCELLED:
        circleMode.value = 'idle'
        circlePreview.value = null
        circlePreviewGeometry.value = null
        break
    }
  })

  function setTool(toolId: string) {
    const next = activeTool.value === toolId ? '' : toolId
    activeTool.value = next
    segments.value = []
    totalM.value = 0
    pointCount.value = 0
    if (next !== 'circle') {
      circleMode.value = 'idle'
      circlePreview.value = null
      circlePreviewGeometry.value = null
    }
    if (next !== 'polygon') {
      polygonMode.value = 'idle'
      drawingPointCount.value = 0
      drawingCoordsText.value = ''
    }
    sendCmd({ type: PanelCmd.SET_TOOL, payload: { toolId: next } })
  }

  function finish() {
    activeTool.value = ''
    sendCmd({ type: PanelCmd.FINISH })
  }

  function undo() {
    sendCmd({ type: PanelCmd.UNDO })
  }

  function clear() {
    segments.value = []
    totalM.value = 0
    pointCount.value = 0
    activeTool.value = ''
    polygonMode.value = 'idle'
    drawingPointCount.value = 0
    drawingCoordsText.value = ''
    polygonLayers.value = []
    polygonNameCounter = 0
    pointMarkers.value = []
    pointNameCounter = 0
    circlePreview.value = null
    circlePreviewGeometry.value = null
    sendCmd({ type: PanelCmd.CLEAR })
  }

  // ── Polygon commands ──────────────────────────────────────────────────────

  function startDrawingPolygon() {
    sendCmd({ type: PanelCmd.START_DRAWING_POLYGON })
  }

  function finishDrawingPolygon() {
    sendCmd({ type: PanelCmd.FINISH_DRAWING_POLYGON })
  }

  function cancelDrawingPolygon() {
    sendCmd({ type: PanelCmd.CANCEL_DRAWING_POLYGON })
  }

  function undoPolygonPoint() {
    sendCmd({ type: PanelCmd.UNDO_POLYGON_POINT })
  }

  function drawPolygon(input: string) {
    sendCmd({ type: PanelCmd.DRAW_POLYGON, payload: { input } })
  }

  function deletePolygon(id: string) {
    sendCmd({ type: PanelCmd.DELETE_POLYGON, payload: { id } })
  }

  /** 图层列表行点击：本地立即标记选中，同时通知 hook 触发地图高亮。 */
  function selectPolygonFromPanel(id: string) {
    const prev = polygonLayers.value.find((l) => l.selected)
    if (prev) prev.selected = false
    const next = polygonLayers.value.find((l) => l.id === id)
    if (next) next.selected = true
    sendCmd({ type: PanelCmd.SELECT_POLYGON, payload: { id } })
  }

  /** 切换可见性：本地更新 + 通知 hook 切换地图样式。 */
  function togglePolygonVisible(id: string) {
    const layer = polygonLayers.value.find((l) => l.id === id)
    if (!layer) return
    layer.visible = !layer.visible
    sendCmd({ type: PanelCmd.TOGGLE_POLYGON_VISIBLE, payload: { id, visible: layer.visible } })
  }

  /** 重命名多边形（仅 Panel 本地操作，不发送到 hook）。 */
  function renamePolygon(id: string, name: string) {
    const layer = polygonLayers.value.find((l) => l.id === id)
    if (layer) layer.name = name
  }

  function startEditPolygon(id: string) {
    sendCmd({ type: PanelCmd.START_EDIT_POLYGON, payload: { id } })
  }

  function finishEditPolygon() {
    sendCmd({ type: PanelCmd.FINISH_EDIT_POLYGON })
  }

  function cancelEditPolygon() {
    sendCmd({ type: PanelCmd.CANCEL_EDIT_POLYGON })
  }

  // ── Point marker commands ──────────────────────────────────────────────────

  function deletePointMarker(id: string) {
    sendCmd({ type: PanelCmd.DELETE_POINT_MARKER, payload: { id } })
  }

  function selectPointMarkerFromPanel(id: string, multiSelect = false) {
    if (multiSelect) {
      // Toggle this item while keeping others
      const marker = pointMarkers.value.find((p) => p.id === id)
      if (marker) marker.selected = !marker.selected
    } else {
      // Single select: clear all, then select only this one
      pointMarkers.value.forEach((p) => { p.selected = false })
      const marker = pointMarkers.value.find((p) => p.id === id)
      if (marker) marker.selected = true
      sendCmd({ type: PanelCmd.SELECT_POINT_MARKER, payload: { id } })
    }
  }

  function togglePointMarkerVisible(id: string) {
    const marker = pointMarkers.value.find((p) => p.id === id)
    if (!marker) return
    marker.visible = !marker.visible
    sendCmd({ type: PanelCmd.TOGGLE_POINT_MARKER_VISIBLE, payload: { id, visible: marker.visible } })
  }

  function renamePointMarker(id: string, name: string) {
    const marker = pointMarkers.value.find((p) => p.id === id)
    if (marker) marker.name = name
    sendCmd({ type: PanelCmd.RENAME_POINT_MARKER, payload: { id, name } })
  }

  function importPointMarkers(input: string) {
    sendCmd({ type: PanelCmd.IMPORT_POINT_MARKERS, payload: { input } })
  }

  // ── Circle commands ────────────────────────────────────────────────────────

  function startDrawingCircle() {
    sendCmd({ type: PanelCmd.START_DRAWING_CIRCLE })
  }

  function cancelDrawingCircle() {
    circleMode.value = 'idle'
    circlePreview.value = null
    circlePreviewGeometry.value = null
    sendCmd({ type: PanelCmd.CANCEL_DRAWING_CIRCLE })
  }

  function updateCircle(id: string, radius: number, nPoints: number) {
    sendCmd({ type: PanelCmd.UPDATE_CIRCLE, payload: { id, radius, nPoints } })
  }

  function finishCircle() {
    sendCmd({ type: PanelCmd.FINISH_CIRCLE })
    circleMode.value = 'idle'
    circlePreview.value = null
    circlePreviewGeometry.value = null
  }

  function startEditCircle(id: string) {
    sendCmd({ type: PanelCmd.START_EDIT_CIRCLE, payload: { id } })
  }

  function commitEditCircle() {
    sendCmd({ type: PanelCmd.COMMIT_EDIT_CIRCLE })
  }

  function cancelEditCircle() {
    sendCmd({ type: PanelCmd.CANCEL_EDIT_CIRCLE })
  }

  function setDebug(enabled: boolean) {
    sendCmd({ type: PanelCmd.SET_DEBUG, payload: { enabled } })
  }

  return {
    isMapReady,
    mapStatus,
    activeTool,
    segments,
    totalLabel,
    pointCount,
    // polygon
    polygonMode,
    drawingPointCount,
    drawingCoordsText,
    polygonLayers,
    editingPolygonId,
    // point marker
    pointMarkers,
    // mouse coords
    mouseCoords,
    // circle
    circleMode,
    circlePreview,
    circlePreviewGeometry,
    // commands
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
    startDrawingCircle,
    cancelDrawingCircle,
    startEditCircle,
    commitEditCircle,
    cancelEditCircle,
    setDebug,
  }
}

import { ref, computed } from 'vue'
import { HookEvent, PanelCmd } from '@shared/protocol'
import type { HookMessage, SegmentAddedPayload, MeasurementResultPayload } from '@shared/protocol'
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
}

export function useTool() {
  const { onHookEvent, sendCmd } = useMapBridge()

  const isMapReady = ref(false)
  const activeTool = ref<string>('')
  const segments = ref<SegmentInfo[]>([])
  const totalM = ref(0)
  const pointCount = ref(0)
  const twoPointResult = ref<MeasurementResultPayload | null>(null)

  // 多边形工具相关状态
  const polygonMode = ref<'idle' | 'drawing'>('idle')
  const drawingPointCount = ref(0)
  /** 当前绘制中各顶点坐标文本，供坐标导入折叠区同步显示。 */
  const drawingCoordsText = ref('')
  const polygonLayers = ref<PolygonLayer[]>([])
  let polygonNameCounter = 0

  const totalLabel = computed(() => (totalM.value > 0 ? formatDistance(totalM.value) : ''))
  const isMeasuring = computed(() => activeTool.value !== '')

  onHookEvent((msg: HookMessage) => {
    switch (msg.type) {
      case HookEvent.MAP_READY:
        isMapReady.value = true
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

      case HookEvent.MEASUREMENT_RESULT: {
        const p = msg.payload as MeasurementResultPayload
        twoPointResult.value = p
        totalM.value = p.distanceM
        activeTool.value = ''
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
    }
  })

  function setTool(toolId: string) {
    const next = activeTool.value === toolId ? '' : toolId
    activeTool.value = next
    segments.value = []
    totalM.value = 0
    pointCount.value = 0
    twoPointResult.value = null
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
    twoPointResult.value = null
    activeTool.value = ''
    polygonMode.value = 'idle'
    drawingPointCount.value = 0
    drawingCoordsText.value = ''
    polygonLayers.value = []
    polygonNameCounter = 0
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

  function setDebug(enabled: boolean) {
    sendCmd({ type: PanelCmd.SET_DEBUG, payload: { enabled } })
  }

  return {
    isMapReady,
    activeTool,
    segments,
    totalLabel,
    pointCount,
    twoPointResult,
    // polygon
    polygonMode,
    drawingPointCount,
    drawingCoordsText,
    polygonLayers,
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
    setDebug,
  }
}

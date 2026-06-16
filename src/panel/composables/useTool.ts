import { ref, computed } from 'vue'
import { HookEvent, PanelCmd } from '@shared/protocol'
import type {
  HookMessage, SegmentAddedPayload,
  CircleDrawnPayload, GenericLayer, LayerKind, LayerData,
  LayerDrawnPayload, LayerSelectedPayload, LayerEditEventPayload,
  MeasureLayerData,
} from '@shared/protocol'
import { useMapBridge } from './useMapBridge'
import { formatDistance } from '@shared/utils/distance'
import { TOOL_IDS } from '@shared/tool-config'
import type { LatLng } from '@shared/utils/parse-coords'

export interface SegmentInfo {
  from: number
  to: number
  distanceM: number
  label: string
}

export { type GenericLayer, type LayerKind, type LayerData } from '@shared/protocol'

export function useTool() {
  const { onHookEvent, sendCmd } = useMapBridge()

  const isMapReady = ref(false)
  const mapStatus = ref<'init' | 'ready' | 'lost' | 'restored'>('init')
  const activeTool = ref<string>('')
  const segments = ref<SegmentInfo[]>([])
  const totalM = ref(0)
  const pointCount = ref(0)

  // ── 统一图层存储（唯一数据源） ────────────────────────────────────────────
  const layers = ref<GenericLayer[]>([])
  const layerOrder = ref<string[]>([])
  const nameCounters: Record<string, number> = { polygon: 0, circle: 0, measure: 0, 'point-marker': 0 }

  // 按 layerOrder 排序后的图层列表
  const sortedLayers = computed<GenericLayer[]>(() => {
    const orderMap = new Map(layerOrder.value.map((id, i) => [id, i]))
    return [...layers.value].sort((a, b) => {
      const ai = orderMap.get(a.id)
      const bi = orderMap.get(b.id)
      if (ai !== undefined && bi !== undefined) return ai - bi
      if (ai !== undefined) return -1
      if (bi !== undefined) return 1
      return 0
    })
  })

  /** 获取当前选中的图层（同时只能选中一个）。 */
  const selectedLayer = computed<GenericLayer | null>(() =>
    layers.value.find(l => l.selected) ?? null,
  )

  // ── 工具绘制状态（保留，仅用于创建过程） ──────────────────────────────────

  const polygonMode = ref<'idle' | 'drawing'>('idle')
  const drawingPointCount = ref(0)
  const drawingCoordsText = ref('')
  const editingPolygonId = ref<string | null>(null)

  const pointMarkers = ref<Array<{ id: string; name: string; lat: number; lng: number }>>([])

  const mouseCoords = ref<{ lat: number; lng: number } | null>(null)

  const circleMode = ref<'idle' | 'drawing' | 'placed' | 'editing'>('idle')
  const circlePreview = ref<{ id: string; lat: number; lng: number; radius: number; nPoints: number } | null>(null)
  const circlePreviewGeometry = ref<{ area: number; perimeter: number } | null>(null)

  const measureMode = ref<'idle' | 'drawing' | 'editing'>('idle')

  // ── 工具专有状态（非图层管理，保留） ──────────────────────────────────────
  // pointMarkers 保留内部数组，用于 PointPanel 的已有数据回显和批量导入
  // 但图层管理走 layers，不重复维护 selected/visible

  const totalLabel = computed(() => (totalM.value > 0 ? formatDistance(totalM.value) : ''))

  // ── 图层辅助函数 ───────────────────────────────────────────────────────────

  /** 自动命名 */
  function nextName(kind: string): string {
    nameCounters[kind] = (nameCounters[kind] || 0) + 1
    const labels: Record<string, string> = {
      polygon: '多边形', circle: '圆形', measure: '测距', 'point-marker': '点位',
    }
    return `${labels[kind] ?? kind} ${nameCounters[kind]}`
  }

  /** 统一选中图层（取消所有其他选中，通知 hook）。 */
  function selectLayer(id: string) {
    const target = layers.value.find(l => l.id === id)
    if (!target) return

    // 取消所有选中
    for (const l of layers.value) {
      if (l.id !== id) l.selected = false
    }
    target.selected = true
    sendCmd({ type: PanelCmd.LAYER_SELECT, payload: { id: target.id, kind: target.kind } })
  }

  /** 统一删除图层。 */
  function deleteLayer(id: string) {
    const idx = layers.value.findIndex(l => l.id === id)
    if (idx === -1) return
    const layer = layers.value[idx]
    layers.value.splice(idx, 1)
    layerOrder.value = layerOrder.value.filter(oid => oid !== id)
    sendCmd({ type: PanelCmd.LAYER_DELETE, payload: { id: layer.id, kind: layer.kind } })
    // 同步清理 pointMarkers 内部数组
    if (layer.kind === 'point-marker') {
      const pidx = pointMarkers.value.findIndex(p => p.id === id)
      if (pidx !== -1) pointMarkers.value.splice(pidx, 1)
    }
  }

  /** 统一切换可见性。 */
  function toggleLayerVisible(id: string) {
    const layer = layers.value.find(l => l.id === id)
    if (!layer) return
    layer.visible = !layer.visible
    sendCmd({ type: PanelCmd.LAYER_TOGGLE, payload: { id, kind: layer.kind, visible: layer.visible } })
  }

  /** 统一重命名。 */
  function renameLayer(id: string, name: string) {
    const layer = layers.value.find(l => l.id === id)
    if (!layer) return
    layer.name = name
    sendCmd({ type: PanelCmd.LAYER_RENAME, payload: { id, kind: layer.kind, name } })
    // 同步更新 pointMarkers 内部数组
    if (layer.kind === 'point-marker') {
      const pm = pointMarkers.value.find(p => p.id === id)
      if (pm) pm.name = name
    }
  }

  /** 拖拽排序。 */
  function reorderLayers(newOrder: string[]) {
    layerOrder.value = newOrder
  }

  /** 开始编辑图层（通过 LAYER_EDIT 通知 hook）。 */
  function editLayer(id: string) {
    const layer = layers.value.find(l => l.id === id)
    if (!layer) return
    // 切换工具前清理其他工具的瞬态状态，与 setTool() 保持一致
    if (layer.kind === 'polygon') {
      activeTool.value = TOOL_IDS.POLYGON
      circleMode.value = 'idle'
      circlePreview.value = null
      circlePreviewGeometry.value = null
      measureMode.value = 'idle'
    } else if (layer.kind === 'circle') {
      activeTool.value = TOOL_IDS.CIRCLE
      polygonMode.value = 'idle'
      drawingPointCount.value = 0
      drawingCoordsText.value = ''
      measureMode.value = 'idle'
    }
    if (layer.kind === 'measure') {
      const data = layer.data as MeasureLayerData | undefined
      if (!data || data.paths.length === 0) return
      activeTool.value = TOOL_IDS.MULTI_POINT
      polygonMode.value = 'idle'
      drawingPointCount.value = 0
      drawingCoordsText.value = ''
      circleMode.value = 'idle'
      circlePreview.value = null
      circlePreviewGeometry.value = null
      measureMode.value = 'editing'
      // 深拷贝数组避免 postMessage 对 Vue reactive Proxy 序列化报错
      sendCmd({
        type: PanelCmd.LAYER_EDIT,
        payload: {
          id, kind: 'measure', name: layer.name,
          points: JSON.parse(JSON.stringify(data.paths[0])),
          segmentDistances: JSON.parse(JSON.stringify(data.segmentDistances)),
        },
      })
    } else {
      sendCmd({ type: PanelCmd.LAYER_EDIT, payload: { id, kind: layer.kind, name: layer.name } })
    }
  }

  // ── Hook 事件处理 ──────────────────────────────────────────────────────────

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
        setTimeout(() => { if (mapStatus.value === 'restored') mapStatus.value = 'ready' }, 2000)
        break

      case HookEvent.POINT_ADDED:
        pointCount.value = msg.payload.index + 1
        break

      case HookEvent.SEGMENT_ADDED: {
        const p = msg.payload as SegmentAddedPayload
        segments.value.push({
          from: p.fromIdx + 1, to: p.toIdx + 1,
          distanceM: p.distanceM, label: formatDistance(p.distanceM),
        })
        totalM.value = p.totalM
        break
      }

      case HookEvent.POINT_REMOVED:
        pointCount.value = msg.payload.newCount
        if (segments.value.length > 0) {
          totalM.value -= segments.value.pop()!.distanceM
        }
        break

      case HookEvent.POLYGON_MODE_CHANGED:
        polygonMode.value = msg.payload.mode
        drawingPointCount.value = msg.payload.drawingPointCount
        if (msg.payload.mode === 'idle') drawingCoordsText.value = ''
        break

      case HookEvent.POLYGON_POINT_ADDED:
        drawingPointCount.value = msg.payload.index + 1
        drawingCoordsText.value = msg.payload.coordsText
        break

      case HookEvent.POLYGON_POINT_REMOVED:
        drawingPointCount.value = msg.payload.newCount
        drawingCoordsText.value = msg.payload.coordsText
        break

      case HookEvent.POLYGON_GEOMETRY: {
        const layer = layers.value.find(l => l.id === msg.payload.id)
        if (layer?.data && layer.data.kind === 'polygon') {
          layer.data.area = msg.payload.area
          layer.data.perimeter = msg.payload.perimeter
        }
        break
      }

      case HookEvent.CIRCLE_CENTER_SET:
        circleMode.value = 'drawing'
        circlePreview.value = {
          id: msg.payload.id,
          lat: msg.payload.lat, lng: msg.payload.lng,
          radius: msg.payload.radius, nPoints: msg.payload.nPoints,
        }
        circlePreviewGeometry.value = null
        break

      case HookEvent.CIRCLE_UPDATED: {
        const p = msg.payload as CircleUpdatedPayload & { lat?: number; lng?: number }
        // 兼容 preview 尚未被 CIRCLE_CENTER_SET 初始化的情况
        if (!circlePreview.value || circlePreview.value.id !== p.id) {
          if (p.lat !== undefined && p.lng !== undefined) {
            circleMode.value = 'placed'
            circlePreview.value = { id: p.id, lat: p.lat, lng: p.lng, radius: p.radius, nPoints: p.nPoints }
            circlePreviewGeometry.value = { area: p.area, perimeter: p.perimeter }
          }
          break
        }
        if (circleMode.value === 'drawing') circleMode.value = 'placed'
        circlePreview.value.radius = p.radius
        circlePreview.value.nPoints = p.nPoints
        // placed-mode 圆心拖拽时同步更新坐标（避免 UI 显示的圆心和地图上的不一致）
        if (p.lat !== undefined && p.lng !== undefined) {
          circlePreview.value.lat = p.lat
          circlePreview.value.lng = p.lng
        }
        circlePreviewGeometry.value = { area: p.area, perimeter: p.perimeter }
        break
      }

      // ── 统一图层事件 ──

      case HookEvent.LAYER_DRAWN: {
        const p = msg.payload as LayerDrawnPayload
        const existing = layers.value.find(l => l.id === p.id)
        if (existing) {
          // 编辑提交：更新 data
          existing.data = p.data
        } else {
          layers.value.push({
            id: p.id,
            kind: p.kind,
            name: nextName(p.kind),
            visible: true,
            selected: false,
            data: p.data,
          })
          layerOrder.value.push(p.id)
        }
        // 圆形绘制完成后清除预览
        if (p.kind === 'circle') {
          circleMode.value = 'idle'
          circlePreview.value = null
          circlePreviewGeometry.value = null
        }
        // 打点：同步到 pointMarkers 内部数组
        if (p.kind === 'point-marker' && p.data.kind === 'point-marker') {
          pointMarkers.value.push({
            id: p.id,
            name: layers.value[layers.value.length - 1].name,
            lat: p.data.lat,
            lng: p.data.lng,
          })
        }
        break
      }

      case HookEvent.LAYER_SELECTED: {
        const p = msg.payload as LayerSelectedPayload
        // 取消所有选中
        for (const l of layers.value) l.selected = false
        if (p.id && p.data) {
          const layer = layers.value.find(l => l.id === p.id)
          if (layer) {
            layer.selected = true
            layer.data = p.data
          }
        }
        break
      }

      case HookEvent.LAYER_DELETED: {
        const p = msg.payload
        const idx = layers.value.findIndex(l => l.id === p.id)
        if (idx !== -1) layers.value.splice(idx, 1)
        layerOrder.value = layerOrder.value.filter(id => id !== p.id)
        break
      }

      case HookEvent.LAYER_EDIT_STARTED: {
        const p = msg.payload as LayerEditEventPayload
        if (p.kind === 'polygon') { editingPolygonId.value = p.id; activeTool.value = TOOL_IDS.POLYGON }
        if (p.kind === 'circle') { circleMode.value = 'editing'; activeTool.value = TOOL_IDS.CIRCLE }
        if (p.kind === 'measure') { measureMode.value = 'editing'; activeTool.value = TOOL_IDS.MULTI_POINT }
        break
      }

      case HookEvent.LAYER_EDIT_COMMITTED:
      case HookEvent.LAYER_EDIT_CANCELLED: {
        const p = msg.payload as LayerEditEventPayload
        if (p.kind === 'polygon') { editingPolygonId.value = null; activeTool.value = '' }
        if (p.kind === 'circle') {
          circleMode.value = 'idle'
          circlePreview.value = null
          circlePreviewGeometry.value = null
          activeTool.value = ''
        }
        if (p.kind === 'measure') {
          measureMode.value = 'idle'
          activeTool.value = ''
        }
        break
      }

      case HookEvent.MOUSE_MOVE:
        mouseCoords.value = { lat: msg.payload.lat, lng: msg.payload.lng }
        break
    }
  })

  // ── 工具切换 ───────────────────────────────────────────────────────────────

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
    if (next === TOOL_IDS.MULTI_POINT) {
      measureMode.value = 'drawing'
    } else {
      measureMode.value = 'idle'
    }
    sendCmd({ type: PanelCmd.SET_TOOL, payload: { toolId: next } })
  }

  function finish() {
    activeTool.value = ''
    measureMode.value = 'idle'
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
    circlePreview.value = null
    circlePreviewGeometry.value = null
    circleMode.value = 'idle'
    measureMode.value = 'idle'
    layers.value = []
    pointMarkers.value = []
    for (const k of Object.keys(nameCounters)) nameCounters[k] = 0
    layerOrder.value = []
    sendCmd({ type: PanelCmd.CLEAR })
  }

  // ── 多边形工具命令 ────────────────────────────────────────────────────────

  function startDrawingPolygon() { sendCmd({ type: PanelCmd.START_DRAWING_POLYGON }) }
  function finishDrawingPolygon() { sendCmd({ type: PanelCmd.FINISH_DRAWING_POLYGON }) }
  function cancelDrawingPolygon() { sendCmd({ type: PanelCmd.CANCEL_DRAWING_POLYGON }) }
  function undoPolygonPoint() { sendCmd({ type: PanelCmd.UNDO_POLYGON_POINT }) }
  function drawPolygon(input: string) { sendCmd({ type: PanelCmd.DRAW_POLYGON, payload: { input } }) }
  function finishEditPolygon() { sendCmd({ type: PanelCmd.FINISH_EDIT_POLYGON }) }
  function cancelEditPolygon() { sendCmd({ type: PanelCmd.CANCEL_EDIT_POLYGON }) }

  // ── 打点标记命令 ──────────────────────────────────────────────────────────

  function importPointMarkers(input: string) {
    sendCmd({ type: PanelCmd.IMPORT_POINT_MARKERS, payload: { input } })
  }

  // ── 圆形工具命令 ──────────────────────────────────────────────────────────

  function startDrawingCircle() { sendCmd({ type: PanelCmd.START_DRAWING_CIRCLE }) }
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
  function commitEditCircle() { sendCmd({ type: PanelCmd.COMMIT_EDIT_CIRCLE }) }
  function cancelEditCircle() { sendCmd({ type: PanelCmd.CANCEL_EDIT_CIRCLE }) }

  // ── 测距编辑命令 ──────────────────────────────────────────────────────────

  function commitEditMeasure() { sendCmd({ type: PanelCmd.COMMIT_EDIT_MEASURE }) }
  function cancelEditMeasure() { sendCmd({ type: PanelCmd.CANCEL_EDIT_MEASURE }) }
  function setDebug(enabled: boolean) { sendCmd({ type: PanelCmd.SET_DEBUG, payload: { enabled } }) }

  return {
    // 基础状态
    isMapReady, mapStatus, activeTool,
    // 统一图层
    layers: sortedLayers, selectedLayer, layerOrder,
    // 图层操作
    selectLayer, deleteLayer, toggleLayerVisible, renameLayer, reorderLayers, editLayer,
    // 测距实时状态
    segments, totalLabel, pointCount,
    // 多边形
    polygonMode, drawingPointCount, drawingCoordsText, editingPolygonId,
    startDrawingPolygon, finishDrawingPolygon, cancelDrawingPolygon,
    undoPolygonPoint, drawPolygon, finishEditPolygon, cancelEditPolygon,
    // 打点
    pointMarkers, importPointMarkers,
    // 圆形
    circleMode, circlePreview, circlePreviewGeometry, measureMode,
    startDrawingCircle, cancelDrawingCircle, updateCircle, finishCircle,
    commitEditCircle, cancelEditCircle,
    // 测距编辑
    commitEditMeasure, cancelEditMeasure,
    // 通用
    mouseCoords, setTool, finish, undo, clear, setDebug,
  }
}

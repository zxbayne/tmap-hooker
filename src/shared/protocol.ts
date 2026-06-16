/**
 * Hook ↔ Panel 通信协议定义。
 * 消息通过 window.postMessage 在 MAIN world（hook）和 ISOLATED world（panel）之间传递，
 * 用 source 字段区分扩展消息和页面其他 postMessage。
 *
 * 使用 const enum + 字符串字面量值，而非数字枚举，
 * 原因：字符串值在浏览器 DevTools 的 message 面板中直接可读，方便调试。
 */
import type { LatLng } from './utils/parse-coords'
export type { LatLng }

export const HOOK_SOURCE = 'tmap-hook'
export const PANEL_SOURCE = 'tmap-panel'

// Hook → Panel 事件：hook 层检测到地图事件时发送给 panel
export const enum HookEvent {
  MAP_READY = 'MAP_READY',
  MAP_LOST = 'MAP_LOST',
  MAP_RESTORED = 'MAP_RESTORED',
  MOUSE_MOVE = 'MOUSE_MOVE',
  // 多点测距（实时绘制过程中的状态推送）
  POINT_ADDED = 'POINT_ADDED',
  SEGMENT_ADDED = 'SEGMENT_ADDED',
  MEASUREMENT_RESULT = 'MEASUREMENT_RESULT',
  POINT_REMOVED = 'POINT_REMOVED',
  // 多边形绘制过程中的状态推送
  POLYGON_POINT_ADDED = 'POLYGON_POINT_ADDED',
  POLYGON_POINT_REMOVED = 'POLYGON_POINT_REMOVED',
  POLYGON_MODE_CHANGED = 'POLYGON_MODE_CHANGED',
  POLYGON_GEOMETRY = 'POLYGON_GEOMETRY',
  // 圆形绘制过程中的状态推送
  CIRCLE_CENTER_SET = 'CIRCLE_CENTER_SET',
  CIRCLE_UPDATED = 'CIRCLE_UPDATED',
  // ── 通用图层事件 ──
  /** 图层创建或编辑完成 */
  LAYER_DRAWN = 'LAYER_DRAWN',
  /** 图层被选中（含完整几何数据） */
  LAYER_SELECTED = 'LAYER_SELECTED',
  /** 图层被删除 */
  LAYER_DELETED = 'LAYER_DELETED',
  /** 编辑启动/完成/取消 */
  LAYER_EDIT_STARTED = 'LAYER_EDIT_STARTED',
  LAYER_EDIT_COMMITTED = 'LAYER_EDIT_COMMITTED',
  LAYER_EDIT_CANCELLED = 'LAYER_EDIT_CANCELLED',
}

// Panel → Hook 命令：panel 层用户操作时发送给 hook
export const enum PanelCmd {
  PANEL_READY = 'PANEL_READY',
  SET_TOOL = 'SET_TOOL',
  FINISH = 'FINISH',
  UNDO = 'UNDO',
  CLEAR = 'CLEAR',
  SET_DEBUG = 'SET_DEBUG',
  // ── 通用图层命令 ──
  /** 选中图层（kind 让 hook 路由到正确的工具/overlay） */
  LAYER_SELECT = 'LAYER_SELECT',
  /** 删除图层 */
  LAYER_DELETE = 'LAYER_DELETE',
  /** 切换可见性 */
  LAYER_TOGGLE = 'LAYER_TOGGLE',
  /** 重命名 */
  LAYER_RENAME = 'LAYER_RENAME',
  /** 进入编辑模式 */
  LAYER_EDIT = 'LAYER_EDIT',
  // ── 工具专有命令 ──
  /** 多边形绘制控制 */
  START_DRAWING_POLYGON = 'START_DRAWING_POLYGON',
  FINISH_DRAWING_POLYGON = 'FINISH_DRAWING_POLYGON',
  CANCEL_DRAWING_POLYGON = 'CANCEL_DRAWING_POLYGON',
  UNDO_POLYGON_POINT = 'UNDO_POLYGON_POINT',
  DRAW_POLYGON = 'DRAW_POLYGON',
  FINISH_EDIT_POLYGON = 'FINISH_EDIT_POLYGON',
  CANCEL_EDIT_POLYGON = 'CANCEL_EDIT_POLYGON',
  /** 圆形工具控制 */
  START_DRAWING_CIRCLE = 'START_DRAWING_CIRCLE',
  CANCEL_DRAWING_CIRCLE = 'CANCEL_DRAWING_CIRCLE',
  UPDATE_CIRCLE = 'UPDATE_CIRCLE',
  FINISH_CIRCLE = 'FINISH_CIRCLE',
  COMMIT_EDIT_CIRCLE = 'COMMIT_EDIT_CIRCLE',
  CANCEL_EDIT_CIRCLE = 'CANCEL_EDIT_CIRCLE',
  /** 测距编辑 */
  COMMIT_EDIT_MEASURE = 'COMMIT_EDIT_MEASURE',
  CANCEL_EDIT_MEASURE = 'CANCEL_EDIT_MEASURE',
  UPDATE_MEASURE_VERTEX = 'UPDATE_MEASURE_VERTEX',
  /** 打点标记导入 */
  IMPORT_POINT_MARKERS = 'IMPORT_POINT_MARKERS',
}

// ── 图层种类 ────────────────────────────────────────────────────────────────

export type LayerKind = 'polygon' | 'circle' | 'measure' | 'point-marker'

// ── 通用图层数据模型 ────────────────────────────────────────────────────────

export interface PolygonLayerData {
  kind: 'polygon'
  coords: LatLng[]
  area: number | null
  perimeter: number | null
}

export interface CircleLayerData {
  kind: 'circle'
  center: LatLng
  radius: number
  nPoints: number
  area: number
  perimeter: number
}

export interface MeasureLayerData {
  kind: 'measure'
  paths: LatLng[][]
  segmentDistances: number[]
  totalDistance: number
}

export interface PointMarkerLayerData {
  kind: 'point-marker'
  lat: number
  lng: number
}

export type LayerData = PolygonLayerData | CircleLayerData | MeasureLayerData | PointMarkerLayerData

/** Panel 端统一图层 (单一数据源)。 */
export interface GenericLayer {
  id: string
  kind: LayerKind
  name: string
  visible: boolean
  selected: boolean
  data?: LayerData
}

// ── Hook → Panel payload 类型 ────────────────────────────────────────────────

export interface PointAddedPayload {
  index: number
  lat: number
  lng: number
}

export interface SegmentAddedPayload {
  fromIdx: number
  toIdx: number
  distanceM: number
  totalM: number
}

export interface MeasurementResultPayload {
  distanceM: number
  pointA: LatLng
  pointB: LatLng
}

export interface PointRemovedPayload {
  newCount: number
}

export interface PolygonPointAddedPayload {
  lat: number
  lng: number
  index: number
  coordsText: string
}

export interface PolygonPointRemovedPayload {
  newCount: number
  coordsText: string
}

export interface PolygonModeChangedPayload {
  mode: 'idle' | 'drawing'
  drawingPointCount: number
}

export interface PolygonGeometryPayload {
  id: string
  area: number
  perimeter: number
}

export interface CircleCenterSetPayload {
  id: string
  lat: number
  lng: number
  radius: number
  nPoints: number
}

export interface CircleUpdatedPayload {
  id: string
  radius: number
  nPoints: number
  area: number
  perimeter: number
  /** placed-mode 圆心拖拽 / 放置完成后携带，让 panel 端 circlePreview 坐标保持同步。 */
  lat?: number
  lng?: number
}

export interface CircleDrawnPayload {
  id: string
  center: LatLng
  radius: number
  nPoints: number
  area: number
  perimeter: number
}

// ── 通用图层 payload ──

export interface LayerDrawnPayload {
  id: string
  kind: LayerKind
  data: LayerData
}

export interface LayerSelectedPayload {
  id: string | null
  data?: LayerData
}

export interface LayerDeletedPayload {
  id: string
}

export interface LayerEditEventPayload {
  id: string
  kind: LayerKind
}

// ── Panel → Hook payload ─────────────────────────────────────────────────────

export interface SetToolPayload {
  toolId: string
}

export interface SetDebugPayload {
  enabled: boolean
}

export interface DrawPolygonPayload {
  input: string
}

export interface UpdateCirclePayload {
  id: string
  radius: number
  nPoints: number
}

export interface ImportPointMarkersPayload {
  input: string
}

// ── 通用图层命令 payload ──

export interface LayerSelectPayload {
  id: string
  kind: LayerKind
}

export interface LayerDeletePayload {
  id: string
  kind: LayerKind
}

export interface LayerTogglePayload {
  id: string
  kind: LayerKind
  visible: boolean
}

export interface LayerRenamePayload {
  id: string
  kind: LayerKind
  name: string
}

export interface LayerEditPayload {
  id: string
  kind: LayerKind
  /** 测距编辑时需要携带已有数据 */
  points?: LatLng[]
  segmentDistances?: number[]
  name?: string
}

// ── 快照 ─────────────────────────────────────────────────────────────────────

export interface OverlaySnapshotItem {
  polygons: Array<{ id: string; points: LatLng[]; visible: boolean }>
  pointMarkers: Array<{ id: string; lat: number; lng: number; name: string; visible: boolean }>
  measures: Array<{ id: string; points: LatLng[]; visible: boolean }>
  /** 已提交的圆形，用于 SPA 切换后在 CircleTool 里重建内部状态。 */
  circles: Array<{
    id: string
    center: LatLng
    radius: number
    nPoints: number
    visible: boolean
  }>
}

export interface MapRestoredPayload {
  polygonCount: number
  pointMarkerCount: number
}

export interface MouseMovePayload {
  lat: number
  lng: number
}

// ── 消息联合类型 ─────────────────────────────────────────────────────────────

type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never

export type HookMessage =
  | { source: typeof HOOK_SOURCE; type: HookEvent.MAP_READY }
  | { source: typeof HOOK_SOURCE; type: HookEvent.MAP_LOST }
  | { source: typeof HOOK_SOURCE; type: HookEvent.MAP_RESTORED; payload: MapRestoredPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.MOUSE_MOVE; payload: MouseMovePayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.POINT_ADDED; payload: PointAddedPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.SEGMENT_ADDED; payload: SegmentAddedPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.MEASUREMENT_RESULT; payload: MeasurementResultPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.POINT_REMOVED; payload: PointRemovedPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.POLYGON_POINT_ADDED; payload: PolygonPointAddedPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.POLYGON_POINT_REMOVED; payload: PolygonPointRemovedPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.POLYGON_MODE_CHANGED; payload: PolygonModeChangedPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.POLYGON_GEOMETRY; payload: PolygonGeometryPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.CIRCLE_CENTER_SET; payload: CircleCenterSetPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.CIRCLE_UPDATED; payload: CircleUpdatedPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.LAYER_DRAWN; payload: LayerDrawnPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.LAYER_SELECTED; payload: LayerSelectedPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.LAYER_DELETED; payload: LayerDeletedPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.LAYER_EDIT_STARTED; payload: LayerEditEventPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.LAYER_EDIT_COMMITTED; payload: LayerEditEventPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.LAYER_EDIT_CANCELLED; payload: LayerEditEventPayload }

export type PanelMessage =
  | { source: typeof PANEL_SOURCE; type: PanelCmd.PANEL_READY }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.SET_TOOL; payload: SetToolPayload }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.FINISH }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.UNDO }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.CLEAR }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.SET_DEBUG; payload: SetDebugPayload }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.LAYER_SELECT; payload: LayerSelectPayload }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.LAYER_DELETE; payload: LayerDeletePayload }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.LAYER_TOGGLE; payload: LayerTogglePayload }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.LAYER_RENAME; payload: LayerRenamePayload }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.LAYER_EDIT; payload: LayerEditPayload }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.START_DRAWING_POLYGON }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.FINISH_DRAWING_POLYGON }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.CANCEL_DRAWING_POLYGON }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.UNDO_POLYGON_POINT }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.DRAW_POLYGON; payload: DrawPolygonPayload }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.FINISH_EDIT_POLYGON }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.CANCEL_EDIT_POLYGON }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.START_DRAWING_CIRCLE }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.CANCEL_DRAWING_CIRCLE }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.UPDATE_CIRCLE; payload: UpdateCirclePayload }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.FINISH_CIRCLE }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.COMMIT_EDIT_CIRCLE }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.CANCEL_EDIT_CIRCLE }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.COMMIT_EDIT_MEASURE }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.CANCEL_EDIT_MEASURE }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.UPDATE_MEASURE_VERTEX }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.IMPORT_POINT_MARKERS; payload: ImportPointMarkersPayload }

/** 从 hook 层向 panel 层发送事件消息（自动附加 source 字段）。 */
export function sendToPanel(msg: DistributiveOmit<HookMessage, 'source'>): void {
  window.postMessage({ ...msg, source: HOOK_SOURCE }, '*')
}

/** 从 panel 层向 hook 层发送命令消息（自动附加 source 字段）。 */
export function sendToHook(msg: DistributiveOmit<PanelMessage, 'source'>): void {
  window.postMessage({ ...msg, source: PANEL_SOURCE }, '*')
}

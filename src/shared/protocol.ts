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
  POINT_ADDED = 'POINT_ADDED',
  SEGMENT_ADDED = 'SEGMENT_ADDED',
  MEASUREMENT_RESULT = 'MEASUREMENT_RESULT',
  POINT_REMOVED = 'POINT_REMOVED',
  // 多边形工具事件
  POLYGON_POINT_ADDED = 'POLYGON_POINT_ADDED',
  POLYGON_POINT_REMOVED = 'POLYGON_POINT_REMOVED',
  POLYGON_DRAWN = 'POLYGON_DRAWN',
  POLYGON_SELECTED = 'POLYGON_SELECTED',
  POLYGON_DELETED = 'POLYGON_DELETED',
  POLYGON_MODE_CHANGED = 'POLYGON_MODE_CHANGED',
  POLYGON_EDIT_STARTED = 'POLYGON_EDIT_STARTED',
  POLYGON_EDIT_FINISHED = 'POLYGON_EDIT_FINISHED',
  POLYGON_EDIT_CANCELLED = 'POLYGON_EDIT_CANCELLED',
  // 打点标记工具事件
  POINT_MARKER_ADDED = 'POINT_MARKER_ADDED',
  POINT_MARKER_DELETED = 'POINT_MARKER_DELETED',
  // 地图生命周期事件
  MAP_LOST = 'MAP_LOST',
  MAP_RESTORED = 'MAP_RESTORED',
}

// Panel → Hook 命令：panel 层用户操作时发送给 hook
export const enum PanelCmd {
  PANEL_READY = 'PANEL_READY',
  SET_TOOL = 'SET_TOOL',
  FINISH = 'FINISH',
  UNDO = 'UNDO',
  CLEAR = 'CLEAR',
  SET_DEBUG = 'SET_DEBUG',
  // 多边形工具命令
  DRAW_POLYGON = 'DRAW_POLYGON',
  DELETE_POLYGON = 'DELETE_POLYGON',
  START_DRAWING_POLYGON = 'START_DRAWING_POLYGON',
  FINISH_DRAWING_POLYGON = 'FINISH_DRAWING_POLYGON',
  CANCEL_DRAWING_POLYGON = 'CANCEL_DRAWING_POLYGON',
  UNDO_POLYGON_POINT = 'UNDO_POLYGON_POINT',
  SELECT_POLYGON = 'SELECT_POLYGON',
  TOGGLE_POLYGON_VISIBLE = 'TOGGLE_POLYGON_VISIBLE',
  START_EDIT_POLYGON = 'START_EDIT_POLYGON',
  FINISH_EDIT_POLYGON = 'FINISH_EDIT_POLYGON',
  CANCEL_EDIT_POLYGON = 'CANCEL_EDIT_POLYGON',
  // 打点标记工具命令
  DELETE_POINT_MARKER = 'DELETE_POINT_MARKER',
  SELECT_POINT_MARKER = 'SELECT_POINT_MARKER',
  TOGGLE_POINT_MARKER_VISIBLE = 'TOGGLE_POINT_MARKER_VISIBLE',
  RENAME_POINT_MARKER = 'RENAME_POINT_MARKER',
  IMPORT_POINT_MARKERS = 'IMPORT_POINT_MARKERS',
}

// ── Hook → Panel payload 类型 ────────────────────────────────────────────────

/** 用户在地图上点击了新点时发送。 */
export interface PointAddedPayload {
  index: number
  lat: number
  lng: number
}

/** 多点测距新增一段时发送，包含该段距离和累计总距离。 */
export interface SegmentAddedPayload {
  fromIdx: number
  toIdx: number
  distanceM: number
  totalM: number
}

/** 两点测距完成后发送，包含最终距离和两点坐标。 */
export interface MeasurementResultPayload {
  distanceM: number
  pointA: LatLng
  pointB: LatLng
}

/** 多点测距撤销最后一点后发送。 */
export interface PointRemovedPayload {
  newCount: number
}

/** 多边形绘制模式下新增顶点时发送。 */
export interface PolygonPointAddedPayload {
  lat: number
  lng: number
  index: number
  coordsText: string
}

/** 多边形绘制模式下撤销最后一个顶点时发送。 */
export interface PolygonPointRemovedPayload {
  newCount: number
  coordsText: string
}

/** 多边形绘制完成后发送，id 为新多边形的唯一标识，count 为顶点数。 */
export interface PolygonDrawnPayload {
  id: string
  count: number
}

/** 用户点击地图上某个多边形时发送，附带顶点坐标供面板坐标导出功能使用。 */
export interface PolygonSelectedPayload {
  id: string | null
  coords: LatLng[]
}

/** 多边形被删除后发送。 */
export interface PolygonDeletedPayload {
  id: string
}

/** 多边形工具绘制模式变更时发送（idle = 选择模式，drawing = 绘制模式）。 */
export interface PolygonModeChangedPayload {
  mode: 'idle' | 'drawing'
  drawingPointCount: number
}

/** 多边形顶点编辑模式已启动。 */
export interface PolygonEditStartedPayload {
  id: string
}

/** 多边形顶点编辑完成，附带最终坐标。 */
export interface PolygonEditFinishedPayload {
  id: string
  coords: LatLng[]
}

/** 多边形顶点编辑已取消。 */
export interface PolygonEditCancelledPayload {
  id: string
}

/** 打点标记工具：新增一个点位时发送。 */
export interface PointMarkerAddedPayload {
  id: string
  lat: number
  lng: number
  name: string
}

/** 打点标记工具：点位被删除时发送。 */
export interface PointMarkerDeletedPayload {
  id: string
}

/** overlay 快照：保存所有地图覆盖物数据，用于 SPA 页面切换后的恢复。 */
export interface OverlaySnapshotItem {
  polygons: Array<{ id: string; points: LatLng[]; visible: boolean }>
  pointMarkers: Array<{ id: string; lat: number; lng: number; name: string; visible: boolean }>
}

/** 地图恢复后发送，携带恢复的覆盖物数量。 */
export interface MapRestoredPayload {
  polygonCount: number
  pointMarkerCount: number
}

// ── Panel → Hook payload 类型 ────────────────────────────────────────────────

/** 切换工具的命令，toolId 为空字符串时表示取消激活。 */
export interface SetToolPayload {
  toolId: string
}

/** 设置 hook 层调试日志开关。 */
export interface SetDebugPayload {
  enabled: boolean
}

/** 从坐标文本绘制多边形的命令。 */
export interface DrawPolygonPayload {
  input: string
}

/** 删除指定 id 的多边形。 */
export interface DeletePolygonPayload {
  id: string
}

/** Panel 主动选中指定多边形（触发 hook 层高亮）。 */
export interface SelectPolygonPayload {
  id: string
}

/** 切换指定多边形的可见性。 */
export interface TogglePolygonVisiblePayload {
  id: string
  visible: boolean
}

/** 启动指定多边形的顶点编辑模式。 */
export interface StartEditPolygonPayload {
  id: string
}

/** 删除指定点位。 */
export interface DeletePointMarkerPayload {
  id: string
}

/** Panel 主动选中指定点位。 */
export interface SelectPointMarkerPayload {
  id: string
}

/** 切换指定点位的可见性。 */
export interface TogglePointMarkerVisiblePayload {
  id: string
  visible: boolean
}

/** 重命名点位（同步地图标签）。 */
export interface RenamePointMarkerPayload {
  id: string
  name: string
}

/** 从坐标文本批量导入点位。 */
export interface ImportPointMarkersPayload {
  input: string
}

// ── 消息联合类型（用于 TypeScript 类型收窄） ────────────────────────────────

/**
 * 分配式 Omit：在联合类型的每个成员上分别执行 Omit，而非把整个联合当成一个类型。
 * 普通 `Omit<Union, K>` 会先求联合的公共键，导致各成员独有的 payload 字段被丢弃。
 */
type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never

export type HookMessage =
  | { source: typeof HOOK_SOURCE; type: HookEvent.MAP_READY }
  | { source: typeof HOOK_SOURCE; type: HookEvent.POINT_ADDED; payload: PointAddedPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.SEGMENT_ADDED; payload: SegmentAddedPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.MEASUREMENT_RESULT; payload: MeasurementResultPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.POINT_REMOVED; payload: PointRemovedPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.POLYGON_POINT_ADDED; payload: PolygonPointAddedPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.POLYGON_POINT_REMOVED; payload: PolygonPointRemovedPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.POLYGON_DRAWN; payload: PolygonDrawnPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.POLYGON_SELECTED; payload: PolygonSelectedPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.POLYGON_DELETED; payload: PolygonDeletedPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.POLYGON_MODE_CHANGED; payload: PolygonModeChangedPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.POLYGON_EDIT_STARTED; payload: PolygonEditStartedPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.POLYGON_EDIT_FINISHED; payload: PolygonEditFinishedPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.POLYGON_EDIT_CANCELLED; payload: PolygonEditCancelledPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.POINT_MARKER_ADDED; payload: PointMarkerAddedPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.POINT_MARKER_DELETED; payload: PointMarkerDeletedPayload }
  | { source: typeof HOOK_SOURCE; type: HookEvent.MAP_LOST }
  | { source: typeof HOOK_SOURCE; type: HookEvent.MAP_RESTORED; payload: MapRestoredPayload }

export type PanelMessage =
  | { source: typeof PANEL_SOURCE; type: PanelCmd.PANEL_READY }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.SET_TOOL; payload: SetToolPayload }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.FINISH }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.UNDO }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.CLEAR }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.SET_DEBUG; payload: SetDebugPayload }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.DRAW_POLYGON; payload: DrawPolygonPayload }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.DELETE_POLYGON; payload: DeletePolygonPayload }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.START_DRAWING_POLYGON }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.FINISH_DRAWING_POLYGON }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.CANCEL_DRAWING_POLYGON }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.UNDO_POLYGON_POINT }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.SELECT_POLYGON; payload: SelectPolygonPayload }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.TOGGLE_POLYGON_VISIBLE; payload: TogglePolygonVisiblePayload }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.START_EDIT_POLYGON; payload: StartEditPolygonPayload }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.FINISH_EDIT_POLYGON }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.CANCEL_EDIT_POLYGON }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.DELETE_POINT_MARKER; payload: DeletePointMarkerPayload }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.SELECT_POINT_MARKER; payload: SelectPointMarkerPayload }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.TOGGLE_POINT_MARKER_VISIBLE; payload: TogglePointMarkerVisiblePayload }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.RENAME_POINT_MARKER; payload: RenamePointMarkerPayload }
  | { source: typeof PANEL_SOURCE; type: PanelCmd.IMPORT_POINT_MARKERS; payload: ImportPointMarkersPayload }

/** 从 hook 层向 panel 层发送事件消息（自动附加 source 字段）。 */
export function sendToPanel(msg: DistributiveOmit<HookMessage, 'source'>): void {
  window.postMessage({ ...msg, source: HOOK_SOURCE }, '*')
}

/** 从 panel 层向 hook 层发送命令消息（自动附加 source 字段）。 */
export function sendToHook(msg: DistributiveOmit<PanelMessage, 'source'>): void {
  window.postMessage({ ...msg, source: PANEL_SOURCE }, '*')
}

/**
 * Hook ↔ Panel 通信协议定义。
 * 消息通过 window.postMessage 在 MAIN world（hook）和 ISOLATED world（panel）之间传递，
 * 用 source 字段区分扩展消息和页面其他 postMessage。
 *
 * 使用 const enum + 字符串字面量值，而非数字枚举，
 * 原因：字符串值在浏览器 DevTools 的 message 面板中直接可读，方便调试。
 */
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
}

export interface LatLngData {
  lat: number
  lng: number
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
  pointA: LatLngData
  pointB: LatLngData
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

/** 用户点击地图上某个多边形时发送。 */
export interface PolygonSelectedPayload {
  id: string | null
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

// ── 消息联合类型（用于 TypeScript 类型收窄） ────────────────────────────────

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

/** 从 hook 层向 panel 层发送事件消息（自动附加 source 字段）。 */
export function sendToPanel(msg: Omit<HookMessage, 'source'>): void {
  window.postMessage({ ...msg, source: HOOK_SOURCE }, '*')
}

/** 从 panel 层向 hook 层发送命令消息（自动附加 source 字段）。 */
export function sendToHook(msg: Omit<PanelMessage, 'source'>): void {
  window.postMessage({ ...msg, source: PANEL_SOURCE }, '*')
}

import { OverlayManager } from './overlay-manager'
import { MultiPointTool } from './tools/multi-point'
import { CircleTool } from './tools/circle'
import { PolygonTool } from './tools/polygon'
import { PointMarkerTool } from './tools/point-marker'
import { sendToPanel, HookEvent } from '@shared/protocol'
import type { OverlaySnapshotItem } from '@shared/protocol'
import { TOOL_IDS } from '@shared/tool-config'
import { log } from './logger'
import type { ITool, ToolContext } from './tools/types'

export class ToolManager {
  private tools: Map<string, ITool> = new Map()
  private activeTool: ITool | null = null
  private map: any = null
  private TMap: any = null
  private overlays: OverlayManager | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  /** 上一个地图实例的覆盖物快照，用于 SPA 切换后恢复。 */
  private pendingSnapshot: OverlaySnapshotItem | null = null
  /** 鼠标坐标推送节流定时器。 */
  private mouseMoveTimer: ReturnType<typeof setTimeout> | null = null
  private mouseMoveHandler: ((evt: any) => void) | null = null

  constructor() {
    this.register(new MultiPointTool())
    this.register(new CircleTool())
    this.register(new PolygonTool())
    this.register(new PointMarkerTool())
  }

  register(tool: ITool): void {
    this.tools.set(tool.id, tool)
  }

  onMapReady(map: any, TMap: any): void {
    if (this.map === map) return
    log('ToolManager.onMapReady — new map instance captured', map)

    const isReconnect = this.map !== null

    // 1. 保存旧覆盖物快照
    if (this.overlays) {
      this.pendingSnapshot = this.overlays.snapshot()
      this.overlays.detachFromMap()
      log('snapshot saved:', this.pendingSnapshot.polygons.length, 'polygons,', this.pendingSnapshot.pointMarkers.length, 'point markers')
    }

    // 2. 停用旧工具
    const prevToolId = this.activeTool?.id ?? null
    if (this.activeTool) {
      this.activeTool.deactivate()
      this.activeTool = null
    }

    // 3. 替换地图实例
    this.map = map
    this.TMap = TMap
    this.overlays = new OverlayManager(map, TMap)

    // 4. 恢复快照 — 延迟到下一事件循环，等待地图内部初始化完成。
    //    map.on() 在构造器内触发时，图层管理器尚未就绪，立即 restore 会抛异常。
    let restoredPoly = 0
    let restoredPm = 0
    if (this.pendingSnapshot) {
      const snap = this.pendingSnapshot
      const polygonTool = this.tools.get(TOOL_IDS.POLYGON) as PolygonTool
      const clickCb = polygonTool?.getClickHandler() ?? (() => {})
      const mdCb = polygonTool?.getMousedownHandler()
      restoredPoly = snap.polygons.length
      restoredPm = snap.pointMarkers.length
      this.pendingSnapshot = null
      setTimeout(() => {
        this.overlays!.restore(snap, clickCb, mdCb)
        log('snapshot restored:', restoredPoly, 'polygons,', restoredPm, 'point markers')
      }, 0)
    }

    // 5. 重新激活之前的工具（同样延迟，确保 overlays 已恢复）
    if (prevToolId) {
      setTimeout(() => {
        this.setTool(prevToolId)
      }, 0)
    }

    // 6. 启动心跳
    this.startHeartbeat()

    // 7. 启动鼠标坐标推送
    this.startMouseTracking()

    // 8. 通知 panel
    if (isReconnect) {
      sendToPanel({ type: HookEvent.MAP_RESTORED, payload: { polygonCount: restoredPoly, pointMarkerCount: restoredPm } })
    }
    sendToPanel({ type: HookEvent.MAP_READY })
    log('MAP_READY sent to panel' + (isReconnect ? ' (reconnect)' : ''))
  }

  /** 心跳检测到地图实例已销毁时调用。 */
  onMapLost(): void {
    log('ToolManager.onMapLost — map instance gone')
    this.stopHeartbeat()
    this.stopMouseTracking()
    // 保存快照（如果还没存）
    if (this.overlays && !this.pendingSnapshot) {
      this.pendingSnapshot = this.overlays.snapshot()
      log('snapshot saved on map lost:', this.pendingSnapshot.polygons.length, 'polygons')
    }
    // 清理图层引用
    if (this.overlays) {
      this.overlays.detachFromMap()
    }
    // 停用工具
    if (this.activeTool) {
      this.activeTool.deactivate()
      this.activeTool = null
    }
    sendToPanel({ type: HookEvent.MAP_LOST })
    log('MAP_LOST sent to panel')
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      try {
        this.map?.getCenter()
      } catch {
        log('heartbeat: map.getCenter() threw, assuming destroyed')
        this.onMapLost()
      }
    }, 3000)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /** 供 map-bridge 的 wrapper 判断实例是否已被捕获，避免重复触发。 */
  isMapCaptured(instance: any): boolean {
    return this.map === instance && this.map !== null
  }

  replayMapReady(): void {
    log('replayMapReady — map exists?', !!this.map)
    if (this.map) sendToPanel({ type: HookEvent.MAP_READY })
  }

  setTool(toolId: string): void {
    if (!this.map || !this.overlays) return

    if (this.activeTool) {
      this.activeTool.deactivate()
      const persistentTools = new Set([TOOL_IDS.POLYGON, TOOL_IDS.POINT_MARKER, TOOL_IDS.CIRCLE])
      if (!persistentTools.has(this.activeTool.id as any)) {
        this.overlays.clearMeasurement()
      }
    }

    if (toolId === '') {
      this.activeTool = null
      return
    }

    const tool = this.tools.get(toolId)
    if (!tool) return

    const ctx: ToolContext = {
      map: this.map,
      overlays: this.overlays!,
    }

    this.activeTool = tool
    tool.activate(ctx)
    log('setTool:', toolId)
  }

  // ── Polygon-specific commands ─────────────────────────────────────────────

  private _polygon(): PolygonTool | null {
    return this.activeTool instanceof PolygonTool ? this.activeTool : null
  }

  startDrawingPolygon(): void {
    this._polygon()?.enterDrawingMode()
  }

  finishDrawingPolygon(): void {
    this._polygon()?.finishDrawing()
  }

  cancelDrawingPolygon(): void {
    this._polygon()?.cancelDrawing()
  }

  undoPolygonPoint(): void {
    this._polygon()?.undoDrawingPoint()
  }

  drawPolygon(input: string): void {
    this._polygon()?.drawFromInput(input)
  }

  deletePolygonById(id: string): void {
    this._polygon()?.deleteById(id)
  }

  selectPolygonById(id: string): void {
    this._polygon()?.selectById(id, true)
  }

  togglePolygonVisible(id: string, visible: boolean): void {
    this._polygon()?.setVisible(id, visible)
  }

  startEditPolygon(id: string): void {
    this._polygon()?.startEditById(id)
  }

  finishEditPolygon(): void {
    this._polygon()?.finishEdit()
  }

  cancelEditPolygon(): void {
    this._polygon()?.cancelEdit()
  }

  // ── Point marker commands ─────────────────────────────────────────────────

  private _pointMarker(): PointMarkerTool | null {
    return this.activeTool instanceof PointMarkerTool ? this.activeTool : null
  }

  deletePointMarker(id: string): void {
    this._pointMarker()?.deleteById(id)
  }

  selectPointMarker(id: string): void {
    this._pointMarker()?.selectById(id, true)
  }

  togglePointMarkerVisible(id: string, visible: boolean): void {
    this._pointMarker()?.setVisible(id, visible)
  }

  renamePointMarker(id: string, name: string): void {
    this._pointMarker()?.renameById(id, name)
  }

  importPointMarkers(input: string): void {
    this._pointMarker()?.importFromInput(input)
  }

  // ── Circle tool commands ──────────────────────────────────────────────────

  private _circle(): CircleTool | null {
    return this.activeTool instanceof CircleTool ? this.activeTool : null
  }

  updateCircle(id: string, radius: number, nPoints: number): void {
    this._circle()?.updateCircle(id, radius, nPoints)
  }

  finishCircle(): void {
    this._circle()?.finishCircle()
  }

  startDrawingCircle(): void {
    this._circle()?.startDrawing()
  }

  cancelDrawingCircle(): void {
    this._circle()?.cancelDrawing()
  }

  startEditCircle(id: string): void {
    this._circle()?.startEditCircle(id)
  }

  commitEditCircle(): void {
    this._circle()?.commitEditCircle()
  }

  cancelEditCircle(): void {
    this._circle()?.cancelEditCircle()
  }

  updateEditCircle(id: string, radius: number, nPoints: number): void {
    this._circle()?.updateEditCircle(undefined, radius, nPoints)
  }

  // ── General tool commands ─────────────────────────────────────────────────

  finish(): void {
    this.activeTool?.finish?.()
  }

  undo(): void {
    this.activeTool?.undo?.()
  }

  clear(): void {
    if (this.activeTool) {
      this.activeTool.reset()
    } else {
      this.overlays?.clearAll()
    }
  }

  // ── Mouse coordinate tracking ────────────────────────────────────────────

  private startMouseTracking(): void {
    this.stopMouseTracking()
    this.mouseMoveHandler = (evt: any) => {
      if (this.mouseMoveTimer) return
      this.mouseMoveTimer = setTimeout(() => {
        this.mouseMoveTimer = null
        try {
          sendToPanel({
            type: HookEvent.MOUSE_MOVE,
            payload: { lat: evt.latLng.lat, lng: evt.latLng.lng },
          })
        } catch { /* 地图监听可能已失效 */ }
      }, 50) // 50ms 节流（~20fps 坐标刷新）
    }
    this.map.on('mousemove', this.mouseMoveHandler)
    log('mouse tracking started')
  }

  private stopMouseTracking(): void {
    if (this.mouseMoveHandler && this.map) {
      this.map.off('mousemove', this.mouseMoveHandler)
    }
    this.mouseMoveHandler = null
    if (this.mouseMoveTimer) {
      clearTimeout(this.mouseMoveTimer)
      this.mouseMoveTimer = null
    }
  }
}

import { OverlayManager } from './overlay-manager'
import { TwoPointTool } from './tools/two-point'
import { MultiPointTool } from './tools/multi-point'
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

  constructor() {
    this.register(new TwoPointTool())
    this.register(new MultiPointTool())
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

    // 4. 恢复快照
    let restoredPoly = 0
    let restoredPm = 0
    if (this.pendingSnapshot) {
      const polygonTool = this.tools.get(TOOL_IDS.POLYGON) as PolygonTool
      const clickCb = polygonTool?.getClickHandler() ?? (() => {})
      const mdCb = polygonTool?.getMousedownHandler()
      this.overlays.restore(this.pendingSnapshot, clickCb, mdCb)
      restoredPoly = this.pendingSnapshot.polygons.length
      restoredPm = this.pendingSnapshot.pointMarkers.length
      this.pendingSnapshot = null
      log('snapshot restored:', restoredPoly, 'polygons,', restoredPm, 'point markers')
    }

    // 5. 重新激活之前的工具
    if (prevToolId) {
      this.setTool(prevToolId)
    }

    // 6. 启动心跳
    this.startHeartbeat()

    // 7. 通知 panel
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
      const persistentTools = new Set([TOOL_IDS.POLYGON, TOOL_IDS.POINT_MARKER])
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
}

import { OverlayManager } from './overlay-manager'
import { MultiPointTool } from './tools/multi-point'
import { CircleTool } from './tools/circle'
import { PolygonTool } from './tools/polygon'
import { PointMarkerTool } from './tools/point-marker'
import { sendToPanel, HookEvent, PanelCmd } from '@shared/protocol'
import type { OverlaySnapshotItem, LayerKind } from '@shared/protocol'
import type { LatLng } from '@shared/utils/parse-coords'
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
      const snap = this.overlays.snapshot()
      // 补充圆形内部状态（center/radius/nPoints），overlay-manager 只保存几何
      const circleTool = this.tools.get(TOOL_IDS.CIRCLE) as CircleTool | undefined
      const circleItems = circleTool?.getAllCircles() ?? []
      snap.circles = circleItems.map((c) => ({
        ...c,
        visible: snap.polygons.find((p) => p.id === c.id)?.visible ?? true,
      }))
      // 多边形列表里不需要重复保留圆形的多边形（restore 时由 circles 负责重建）
      snap.polygons = snap.polygons.filter((p) => !p.id.startsWith('circle-'))
      this.pendingSnapshot = snap
      this.overlays.detachFromMap()
      log('snapshot saved:', snap.polygons.length, 'polygons,', snap.pointMarkers.length, 'point markers,', snap.circles.length, 'circles')
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
      let restoredMeasures = snap.measures?.length ?? 0
      const restoredCircles = snap.circles?.length ?? 0
      this.pendingSnapshot = null
      setTimeout(() => {
        this.overlays!.restore(snap, clickCb, mdCb, (id: string) => {
          sendToPanel({ type: HookEvent.LAYER_SELECTED, payload: { id } })
        })
        // 恢复圆形内部状态，让已提交的圆形可以再次被点击/拖动/编辑
        if (restoredCircles > 0) {
          const ct = this.tools.get(TOOL_IDS.CIRCLE) as CircleTool | undefined
          if (ct && this.map && this.overlays) {
            const ctx: ToolContext = { map: this.map, overlays: this.overlays }
            ct.registerFromSnapshot(snap.circles, ctx)
          }
        }
        const totalRestored = restoredPoly + restoredPm + restoredMeasures + restoredCircles
        log('snapshot restored:', restoredPoly, 'polygons,', restoredPm, 'point markers,', restoredMeasures, 'measures,', restoredCircles, 'circles')
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
      const snap = this.overlays.snapshot()
      const circleTool = this.tools.get(TOOL_IDS.CIRCLE) as CircleTool | undefined
      const circleItems = circleTool?.getAllCircles() ?? []
      snap.circles = circleItems.map((c) => ({
        ...c,
        visible: snap.polygons.find((p) => p.id === c.id)?.visible ?? true,
      }))
      snap.polygons = snap.polygons.filter((p) => !p.id.startsWith('circle-'))
      this.pendingSnapshot = snap
      log('snapshot saved on map lost:', snap.polygons.length, 'polygons,', snap.circles.length, 'circles')
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

    // No-op：已经是同一个工具，避免 deactivate → activate 清除绘制状态
    if (this.activeTool && this.activeTool.id === toolId) return

    if (this.activeTool) {
      this.activeTool.deactivate()
      const persistentTools = new Set([TOOL_IDS.POLYGON, TOOL_IDS.POINT_MARKER, TOOL_IDS.CIRCLE])
      if (!persistentTools.has(this.activeTool.id as any)) {
        this.overlays.clearMeasurement()
      }
    }

    if (toolId === '') {
      if (this.activeTool) {
        this.activeTool.deactivate()
        this.activeTool = null
      }
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

  // ── Tool accessors ─────────────────────────────────────────────────────────

  private _polygon(): PolygonTool | null {
    return this.activeTool instanceof PolygonTool ? this.activeTool : null
  }

  private _pointMarker(): PointMarkerTool | null {
    return this.activeTool instanceof PointMarkerTool ? this.activeTool : null
  }

  private _circle(): CircleTool | null {
    return this.activeTool instanceof CircleTool ? this.activeTool : null
  }

  // ── Unified layer dispatch ─────────────────────────────────────────────────

  /**
   * 统一处理 Panel 发起的图层级操作（select / delete / toggle / rename / edit）。
   *
   * Panel 端已不再发送旧的类型专用命令（SELECT_POLYGON、DELETE_POINT_MARKER 等），
   * 全部改用 LAYER_SELECT / LAYER_DELETE / LAYER_TOGGLE / LAYER_RENAME / LAYER_EDIT，
   * 通过 kind 字段路由到正确的工具或 overlay 方法。
   */
  dispatchLayerCommand(
    cmd:
      | PanelCmd.LAYER_SELECT
      | PanelCmd.LAYER_DELETE
      | PanelCmd.LAYER_TOGGLE
      | PanelCmd.LAYER_RENAME
      | PanelCmd.LAYER_EDIT,
    payload: {
      id: string
      kind: LayerKind
      visible?: boolean
      name?: string
      points?: LatLng[]
      segmentDistances?: number[]
    },
  ): void {
    const { id, kind } = payload

    switch (cmd) {
      // ── Select ──────────────────────────────────────────────────────────
      case PanelCmd.LAYER_SELECT:
        switch (kind) {
          case 'polygon':
            // panToLocation=true：来自 panel 的选中请求需要自动定位
            this._polygon()?.selectById(id, true)
            break
          case 'circle':
            this.overlays?.setPolygonHighlight(id)
            // 定位到圆心
            {
              const info = this._circle()?.getCircleInfo(id)
              if (info) this._panTo(info.center.lat, info.center.lng)
            }
            break
          case 'point-marker':
            this._pointMarker()?.selectById(id, true)
            break
          case 'measure':
            this.overlays?.setMeasureHighlight(id)
            break
        }
        break

      // ── Delete ──────────────────────────────────────────────────────────
      case PanelCmd.LAYER_DELETE:
        switch (kind) {
          case 'polygon':
            this._polygon()?.deleteById(id)
            break
          case 'circle':
            // Circle 多边形存储在 OverlayManager 的 polygonLayer 中
            this.overlays?.removePolygon(id)
            sendToPanel({ type: HookEvent.LAYER_DELETED, payload: { id } })
            break
          case 'point-marker':
            this._pointMarker()?.deleteById(id)
            break
          case 'measure':
            this.overlays?.removeMeasure(id)
            sendToPanel({ type: HookEvent.LAYER_DELETED, payload: { id } })
            break
        }
        break

      // ── Toggle visibility ───────────────────────────────────────────────
      case PanelCmd.LAYER_TOGGLE:
        switch (kind) {
          case 'polygon':
            this._polygon()?.setVisible(id, payload.visible!)
            break
          case 'circle':
            this.overlays?.setPolygonVisible(id, payload.visible!)
            break
          case 'point-marker':
            this._pointMarker()?.setVisible(id, payload.visible!)
            break
          case 'measure':
            this.overlays?.setMeasureVisible(id, payload.visible!)
            break
        }
        break

      // ── Rename ──────────────────────────────────────────────────────────
      case PanelCmd.LAYER_RENAME:
        switch (kind) {
          case 'polygon':
            // Polygon 名称仅存在于 Panel 端，hook 层无需处理
            break
          case 'circle':
            // Circle 名称仅存在于 Panel 端
            break
          case 'point-marker':
            this._pointMarker()?.renameById(id, payload.name!)
            break
          case 'measure':
            // Measure 名称仅存在于 Panel 端
            break
        }
        break

      // ── Start edit ──────────────────────────────────────────────────────
      case PanelCmd.LAYER_EDIT:
        switch (kind) {
          case 'polygon':
            this._polygon()?.startEditById(id)
            break
          case 'circle':
            {
              const ct = this.tools.get(TOOL_IDS.CIRCLE) as CircleTool | undefined
              if (!ct || !this.map || !this.overlays) break
              // 如果圆形工具未激活，先激活它（需要 ctx 才能编辑）
              if (this.activeTool !== ct) {
                if (this.activeTool) this.activeTool.deactivate()
                const ctx: ToolContext = { map: this.map, overlays: this.overlays }
                ct.activate(ctx)
                this.activeTool = ct
              }
              ct.startEditCircle(id)
              // 通知 panel 当前活跃工具变为圆形（以便显示 slider 等编辑 UI）
              sendToPanel({ type: HookEvent.LAYER_EDIT_STARTED, payload: { id, kind: 'circle' } })
            }
            break
          case 'point-marker':
            // 打点标记不支持顶点编辑
            break
          case 'measure':
            this.startEditMeasure(
              id,
              payload.name ?? '',
              payload.points ?? [],
              payload.segmentDistances ?? [],
            )
            break
        }
        break
    }
  }

  /** 将地图视野平移到指定经纬度。 */
  private _panTo(lat: number, lng: number): void {
    if (!this.map || !this.TMap) return
    const center = new this.TMap.LatLng(lat, lng)
    if (typeof this.map.panTo === 'function') {
      this.map.panTo(center)
    } else {
      this.map.setCenter(center)
    }
  }

  // ── Polygon drawing commands (tool-specific) ───────────────────────────────

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

  finishEditPolygon(): void {
    this._polygon()?.finishEdit()
  }

  cancelEditPolygon(): void {
    this._polygon()?.cancelEdit()
  }

  // ── Point marker commands (tool-specific) ──────────────────────────────────

  importPointMarkers(input: string): void {
    this._pointMarker()?.importFromInput(input)
  }

  // ── Circle tool commands (tool-specific) ──────────────────────────────────

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

  commitEditCircle(): void {
    this._circle()?.commitEditCircle()
  }

  cancelEditCircle(): void {
    this._circle()?.cancelEditCircle()
  }

  updateEditCircle(id: string, radius: number, nPoints: number): void {
    this._circle()?.updateEditCircle(undefined, radius, nPoints)
  }

  // ── Measure layer commands (persistent, work without active tool) ──────────

  /** 开始编辑测距：切换到多点工具并加载已有数据。 */
  startEditMeasure(id: string, name: string, points: LatLng[], segDists: number[]): void {
    const tool = this.tools.get(TOOL_IDS.MULTI_POINT) as MultiPointTool
    if (!tool || !this.map || !this.overlays) return

    // 停用当前工具
    if (this.activeTool && this.activeTool !== tool) {
      this.activeTool.deactivate()
    }

    const ctx: ToolContext = { map: this.map, overlays: this.overlays }
    tool.loadForEdit(ctx, id, name, points, segDists)
    this.activeTool = tool
  }

  /** 提交测距编辑：触发 finish 重建持久图层。 */
  commitEditMeasure(): void {
    this.activeTool?.finish?.()
  }

  /** 取消测距编辑：MultiPointTool 内部 onKeydown(Escape) 自行恢复。 */
  cancelEditMeasure(): void {
    // 由 MultiPointTool.onKeydown(Escape) 自行处理
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

  // ── Mouse coordinate tracking ─────────────────────────────────────────────

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

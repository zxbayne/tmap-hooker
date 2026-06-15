import { OverlayManager } from './overlay-manager'
import { TwoPointTool } from './tools/two-point'
import { MultiPointTool } from './tools/multi-point'
import { PolygonTool } from './tools/polygon'
import { PointMarkerTool } from './tools/point-marker'
import { sendToPanel, HookEvent } from '@shared/protocol'
import { TOOL_IDS } from '@shared/tool-config'
import { log } from './logger'
import type { ITool, ToolContext } from './tools/types'

export class ToolManager {
  private tools: Map<string, ITool> = new Map()
  private activeTool: ITool | null = null
  private map: any = null
  private TMap: any = null
  private overlays: OverlayManager | null = null

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

    if (this.map && this.activeTool) {
      this.activeTool.deactivate()
      this.activeTool = null
    }

    this.map = map
    this.TMap = TMap
    this.overlays = new OverlayManager(map, TMap)
    sendToPanel({ type: HookEvent.MAP_READY })
    log('MAP_READY sent to panel')
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

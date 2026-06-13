import { OverlayManager } from './overlay-manager'
import { TwoPointTool } from './tools/two-point'
import { MultiPointTool } from './tools/multi-point'
import { PolygonTool } from './tools/polygon'
import { sendToPanel, HookEvent } from '@shared/protocol'
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
  }

  register(tool: ITool): void {
    this.tools.set(tool.id, tool)
  }

  onMapReady(map: any, TMap: any): void {
    if (this.map === map) return
    log('ToolManager.onMapReady — new map instance captured', map)
    this.map = map
    this.TMap = TMap
    this.overlays = new OverlayManager(map, TMap)
    sendToPanel({ type: HookEvent.MAP_READY })
    log('MAP_READY sent to panel')
  }

  replayMapReady(): void {
    log('replayMapReady — map exists?', !!this.map)
    if (this.map) sendToPanel({ type: HookEvent.MAP_READY })
  }

  setTool(toolId: string): void {
    if (!this.map || !this.overlays) return

    if (this.activeTool) {
      this.activeTool.deactivate()
      if (this.activeTool.id !== 'polygon') {
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
      overlays: this.overlays,
      emit: (type, payload) => window.postMessage({ source: 'tmap-hook', type, payload }, '*'),
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
    this._polygon()?.selectById(id)
  }

  togglePolygonVisible(id: string, visible: boolean): void {
    this._polygon()?.setVisible(id, visible)
  }

  // ── General tool commands ─────────────────────────────────────────────────

  finish(): void {
    const tool = this.activeTool
    if (tool && 'finish' in tool && typeof (tool as any).finish === 'function') {
      ;(tool as any).finish()
    }
  }

  undo(): void {
    const tool = this.activeTool
    if (tool && 'undo' in tool && typeof (tool as any).undo === 'function') {
      ;(tool as any).undo()
    }
  }

  clear(): void {
    if (this.activeTool) {
      this.activeTool.reset()
    } else {
      this.overlays?.clearAll()
    }
  }
}

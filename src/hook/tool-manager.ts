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

  /** 将工具注册到工具表，key 为 tool.id。 */
  register(tool: ITool): void {
    this.tools.set(tool.id, tool)
  }

  /**
   * 捕获到 TMap map 实例时调用，初始化 OverlayManager 并通知 panel。
   * 幂等性守卫：`this.map === map` 时直接返回，因为 prototype 上的多个被 hook 方法
   * 都会触发此回调，对同一实例只应初始化一次。
   */
  onMapReady(map: any, TMap: any): void {
    if (this.map === map) return
    log('ToolManager.onMapReady — new map instance captured', map)
    this.map = map
    this.TMap = TMap
    this.overlays = new OverlayManager(map, TMap)
    sendToPanel({ type: HookEvent.MAP_READY })
    log('MAP_READY sent to panel')
  }

  /**
   * 若 map 已就绪则重新发送 MAP_READY 事件。
   * 用于 panel 脚本（content script）比 hook 脚本晚加载时补发事件。
   */
  replayMapReady(): void {
    log('replayMapReady — map exists?', !!this.map)
    if (this.map) sendToPanel({ type: HookEvent.MAP_READY })
  }

  /**
   * 切换当前激活工具。
   * - 先 deactivate 当前工具
   * - 若当前工具不是 polygon，调用 clearMeasurement（测量覆盖物是临时的）；
   *   若是 polygon 则不清除（polygon 覆盖物是持久的，切换工具时应保留）
   * - 再 activate 新工具
   */
  setTool(toolId: string): void {
    if (!this.map || !this.overlays) return

    if (this.activeTool) {
      this.activeTool.deactivate()
      // 多边形工具的覆盖物是持久的，切换时不清除；其他测量工具的覆盖物是临时的
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

  /**
   * 向当前激活的 PolygonTool 发起绘制命令。
   * 仅当 activeTool 是 PolygonTool 时才生效，避免类型转换错误。
   */
  drawPolygon(input: string): void {
    const tool = this.activeTool
    if (tool instanceof PolygonTool) {
      tool.drawFromInput(input)
    }
  }

  /**
   * 向当前激活的 PolygonTool 发起删除选中多边形的命令。
   * 仅当 activeTool 是 PolygonTool 时才生效。
   */
  deletePolygon(): void {
    const tool = this.activeTool
    if (tool instanceof PolygonTool) {
      tool.deleteSelected()
    }
  }

  /** 完成当前工具的操作（如多点测距停止接受新点击）。工具须实现可选的 finish() 方法。 */
  finish(): void {
    const tool = this.activeTool
    if (tool && 'finish' in tool && typeof (tool as any).finish === 'function') {
      ;(tool as any).finish()
    }
  }

  /** 撤销当前工具的最后一步操作。工具须实现可选的 undo() 方法。 */
  undo(): void {
    const tool = this.activeTool
    if (tool && 'undo' in tool && typeof (tool as any).undo === 'function') {
      ;(tool as any).undo()
    }
  }

  /**
   * 清除所有覆盖物并重置工具状态。
   * 若有激活工具则调用其 reset()，否则直接 clearAll()（清除所有图层，包括多边形）。
   */
  clear(): void {
    if (this.activeTool) {
      this.activeTool.reset()
    } else {
      this.overlays?.clearAll()
    }
  }
}

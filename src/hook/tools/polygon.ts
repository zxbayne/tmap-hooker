import { HookEvent, sendToPanel } from '@shared/protocol'
import { TOOL_IDS } from '@shared/tool-config'
import { parseCoords, coordsToText } from '@shared/utils/parse-coords'
import { log } from '../logger'
import type { ITool, ToolContext, LatLng } from './types'

export class PolygonTool implements ITool {
  readonly id = TOOL_IDS.POLYGON

  private ctx: ToolContext | null = null
  /** 当前正在绘制（尚未提交）的点列表，提交后清空。 */
  private drawingPoints: LatLng[] = []
  /** 当前高亮选中的多边形 id，null 表示没有选中。 */
  private selectedId: string | null = null
  /** 已完成绘制的多边形 id 集合，用于管理生命周期。 */
  private polygonIds: Set<string> = new Set()
  private idCounter = 0
  private clickHandler: ((evt: any) => void) | null = null

  /** 注册地图点击监听器，清空上一次的绘制点，进入绘制模式。 */
  activate(ctx: ToolContext): void {
    this.ctx = ctx
    this.drawingPoints = []
    this.clickHandler = (evt: any) => this.onMapClick(evt)
    ctx.map.on('click', this.clickHandler)
    log('PolygonTool activated')
  }

  /** 注销地图点击监听器，清除临时绘制标记，但保留已完成的多边形。 */
  deactivate(): void {
    if (this.ctx && this.clickHandler) {
      this.ctx.map.off('click', this.clickHandler)
    }
    this.clickHandler = null
    this.ctx = null
    this._clearDrawingMarkers()
    this.drawingPoints = []
    log('PolygonTool deactivated')
  }

  /**
   * 清除当前正在绘制的临时标记和点，重新开始绘制流程。
   * 注意：已完成的多边形不会被清除，只有 CLEAR 命令才会清除所有覆盖物。
   */
  reset(): void {
    this._clearDrawingMarkers()
    this.drawingPoints = []
    // 如果工具仍处于激活状态，重新挂载点击监听器
    if (this.ctx) {
      if (!this.clickHandler) {
        this.clickHandler = (evt: any) => this.onMapClick(evt)
        this.ctx.map.on('click', this.clickHandler)
      }
    }
    log('PolygonTool reset (drawing cleared, polygons preserved)')
  }

  /**
   * 解析坐标输入并在地图上绘制多边形。
   * 支持两种格式：`[[lat,lng],...]` 或 `lat,lng;lat,lng;...`。
   * 绘制成功后清除临时标记，并向 panel 发送 POLYGON_DRAWN 事件。
   */
  drawFromInput(input: string): void {
    if (!this.ctx) return
    const points = parseCoords(input)
    if (!points) {
      log('drawFromInput: failed to parse input:', input)
      return
    }

    this._clearDrawingMarkers()
    this.drawingPoints = []

    const id = `poly-${++this.idCounter}`
    this.ctx.overlays.addPolygon(id, points, (clickedId) => this._onPolygonClick(clickedId))
    this.polygonIds.add(id)

    sendToPanel({ type: HookEvent.POLYGON_DRAWN, payload: { id, count: points.length } })
    log('polygon drawn from input, id =', id, 'points =', points.length)
  }

  /** 删除当前选中的多边形，并向 panel 发送 POLYGON_DELETED 事件。 */
  deleteSelected(): void {
    if (!this.ctx || !this.selectedId) return
    const id = this.selectedId
    this.ctx.overlays.removePolygon(id)
    this.polygonIds.delete(id)
    this.selectedId = null
    sendToPanel({ type: HookEvent.POLYGON_DELETED, payload: { id } })
    log('polygon deleted:', id)
  }

  /**
   * 处理地图点击事件：追加点到绘制缓冲区，放置编号临时标记，
   * 并向 panel 发送 POLYGON_POINT_ADDED（含当前所有点的坐标文本，供 textarea 实时更新）。
   */
  private onMapClick(evt: any): void {
    if (!this.ctx) return
    const latlng: LatLng = { lat: evt.latLng.lat, lng: evt.latLng.lng }
    const index = this.drawingPoints.length
    this.drawingPoints.push(latlng)

    // 显示临时编号标记，帮助用户确认打点顺序
    this.ctx.overlays.addMarker(`poly-drawing-${index}`, latlng, String(index + 1))

    const coordsText = coordsToText(this.drawingPoints)
    sendToPanel({
      type: HookEvent.POLYGON_POINT_ADDED,
      payload: { lat: latlng.lat, lng: latlng.lng, index, coordsText },
    })
    log('polygon point added:', latlng, 'total points:', this.drawingPoints.length)
  }

  /**
   * 处理地图上多边形的点击事件：高亮选中，通知 panel 更新选中状态。
   * 重复点击同一多边形不重复触发。
   */
  private _onPolygonClick(id: string): void {
    if (this.selectedId === id) return
    this.selectedId = id
    this.ctx?.overlays.setPolygonHighlight(id)
    sendToPanel({ type: HookEvent.POLYGON_SELECTED, payload: { id } })
    log('polygon selected:', id)
  }

  /** 移除所有临时绘制标记（poly-drawing-0 到 poly-drawing-N）。 */
  private _clearDrawingMarkers(): void {
    if (!this.ctx) return
    for (let i = 0; i < this.drawingPoints.length; i++) {
      this.ctx.overlays.removeMarker(`poly-drawing-${i}`)
    }
  }
}

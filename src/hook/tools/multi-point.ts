import { haversine, formatDistance } from '@shared/utils/distance'
import { HookEvent, PanelCmd, sendToPanel } from '@shared/protocol'
import { TOOL_IDS } from '@shared/tool-config'
import type { ITool, ToolContext, LatLng } from './types'

export class MultiPointTool implements ITool {
  readonly id = TOOL_IDS.MULTI_POINT

  private ctx: ToolContext | null = null
  private points: LatLng[] = []
  private totalM = 0
  private clickHandler: ((evt: any) => void) | null = null

  /** 注册地图点击监听器，初始化点列表和累计距离。 */
  activate(ctx: ToolContext): void {
    this.ctx = ctx
    this.points = []
    this.totalM = 0
    this.clickHandler = (evt: any) => this.onMapClick(evt)
    ctx.map.on('click', this.clickHandler)
  }

  /** 注销地图点击监听器，清空内部状态。 */
  deactivate(): void {
    if (this.ctx && this.clickHandler) {
      this.ctx.map.off('click', this.clickHandler)
    }
    this.clickHandler = null
    this.ctx = null
  }

  /** 清除所有覆盖物和测量数据，重新挂载点击监听器以继续测量。 */
  reset(): void {
    if (this.ctx) {
      this.ctx.overlays.clearAll()
    }
    this.points = []
    this.totalM = 0
    // reset 后需要重新挂载监听器以支持继续点击
    if (this.ctx && !this.clickHandler) {
      this.clickHandler = (evt: any) => this.onMapClick(evt)
      this.ctx.map.on('click', this.clickHandler)
    }
  }

  /** 停止接收新点击（保留已绘制的覆盖物），对应面板的"完成"按钮。 */
  finish(): void {
    if (this.ctx && this.clickHandler) {
      this.ctx.map.off('click', this.clickHandler)
      this.clickHandler = null
    }
  }

  /**
   * 撤销最后一个点：移除对应的标记、线段和标签，并从累计距离中减去该段。
   * 索引 0 的点没有对应线段，只删除标记。
   */
  undo(): void {
    if (!this.ctx || this.points.length === 0) return
    const idx = this.points.length - 1

    this.ctx.overlays.removeMarker(`mp-${idx}`)
    if (idx > 0) {
      this.ctx.overlays.removePolyline(`mp-line-${idx - 1}`)
      this.ctx.overlays.removeLabel(`mp-label-${idx - 1}`)
      const a = this.points[idx - 1]
      const b = this.points[idx]
      this.totalM -= haversine(a.lat, a.lng, b.lat, b.lng)
    }

    this.points.pop()
    sendToPanel({ type: HookEvent.POINT_REMOVED, payload: { newCount: this.points.length } })
  }

  /**
   * 处理地图点击事件：追加新点，绘制标记；若已有前一点则计算并绘制线段+距离标签。
   * 每次点击都向 panel 发送 POINT_ADDED，有线段时额外发送 SEGMENT_ADDED。
   */
  private onMapClick(evt: any): void {
    if (!this.ctx) return
    const latlng: LatLng = { lat: evt.latLng.lat, lng: evt.latLng.lng }
    const idx = this.points.length

    this.points.push(latlng)
    this.ctx.overlays.addMarker(`mp-${idx}`, latlng, String(idx + 1))
    sendToPanel({ type: HookEvent.POINT_ADDED, payload: { index: idx, ...latlng } })

    if (idx > 0) {
      const prev = this.points[idx - 1]
      const segDist = haversine(prev.lat, prev.lng, latlng.lat, latlng.lng)
      this.totalM += segDist

      this.ctx.overlays.setPolyline(`mp-line-${idx - 1}`, [prev, latlng])

      const midLat = (prev.lat + latlng.lat) / 2
      const midLng = (prev.lng + latlng.lng) / 2
      this.ctx.overlays.addLabel(
        `mp-label-${idx - 1}`,
        { lat: midLat, lng: midLng },
        formatDistance(segDist),
      )

      sendToPanel({
        type: HookEvent.SEGMENT_ADDED,
        payload: {
          fromIdx: idx - 1,
          toIdx: idx,
          distanceM: segDist,
          totalM: this.totalM,
        },
      })
    }
  }
}

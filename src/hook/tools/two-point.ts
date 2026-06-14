import { haversine, formatDistance, getLabelStyleId } from '@shared/utils/distance'
import { HookEvent, sendToPanel } from '@shared/protocol'
import { TOOL_IDS } from '@shared/tool-config'
import { log } from '../logger'
import type { ITool, ToolContext, LatLng } from './types'

type State = 'idle' | 'waiting-a' | 'waiting-b'

export class TwoPointTool implements ITool {
  readonly id = TOOL_IDS.TWO_POINT

  private state: State = 'idle'
  private ctx: ToolContext | null = null
  private points: LatLng[] = []
  private clickHandler: ((evt: any) => void) | null = null

  /** 注册地图点击监听器，进入等待第一个点的状态。 */
  activate(ctx: ToolContext): void {
    this.ctx = ctx
    this.state = 'waiting-a'
    this.points = []
    this.clickHandler = (evt: any) => this.onMapClick(evt)
    ctx.map.on('click', this.clickHandler)
  }

  /** 注销地图点击监听器，清空内部状态。不清除地图上已绘制的覆盖物（由 ToolManager 统一清理）。 */
  deactivate(): void {
    if (this.ctx && this.clickHandler) {
      this.ctx.map.off('click', this.clickHandler)
    }
    this.clickHandler = null
    this.ctx = null
    this.state = 'idle'
  }

  /** 清除所有覆盖物并重新开始测量。 */
  reset(): void {
    if (this.ctx) {
      this.ctx.overlays.clearAll()
    }
    this.points = []
    this.state = this.ctx ? 'waiting-a' : 'idle'
  }

  /**
   * 处理地图点击事件，状态机：idle → waiting-a → waiting-b → idle（自动）。
   * 第一次点击放置 A 点，第二次点击放置 B 点并计算距离，之后自动停止监听。
   */
  private onMapClick(evt: any): void {
    if (!this.ctx) return
    const latlng: LatLng = { lat: evt.latLng.lat, lng: evt.latLng.lng }

    if (this.state === 'waiting-a') {
      this.points = [latlng]
      this.ctx.overlays.addMarker('tp-0', latlng, 'A')
      sendToPanel({ type: HookEvent.POINT_ADDED, payload: { index: 0, ...latlng } })
      this.state = 'waiting-b'
    } else if (this.state === 'waiting-b') {
      this.points.push(latlng)
      const [a, b] = this.points
      const distanceM = haversine(a.lat, a.lng, b.lat, b.lng)

      this.ctx.overlays.addMarker('tp-1', latlng, 'B')
      this.ctx.overlays.setPolyline('tp-line', this.points)

      const midLat = (a.lat + b.lat) / 2
      const midLng = (a.lng + b.lng) / 2
      this.ctx.overlays.addLabel('tp-label', { lat: midLat, lng: midLng }, formatDistance(distanceM), getLabelStyleId(a, b))

      sendToPanel({ type: HookEvent.POINT_ADDED, payload: { index: 1, ...latlng } })
      sendToPanel({
        type: HookEvent.MEASUREMENT_RESULT,
        payload: { distanceM, pointA: a, pointB: b },
      })

      log('two-point measurement complete, distance =', distanceM)
      // 两点测距完成后自动停止监听，保留覆盖物供用户查看
      this.ctx.map.off('click', this.clickHandler!)
      this.clickHandler = null
      this.state = 'idle'
    }
  }
}

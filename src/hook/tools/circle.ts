import { HookEvent, sendToPanel } from '@shared/protocol'
import { TOOL_IDS } from '@shared/tool-config'
import { log } from '../logger'
import type { ITool, ToolContext } from './types'
import type { LatLng } from '@shared/utils/parse-coords'

/** 默认拟合点数。 */
const DEFAULT_N = 64
/** 默认半径（米）。 */
const DEFAULT_R = 500
/** 多边形 ID 前缀，区别于手绘多边形。 */
const CIRCLE_PREFIX = 'circle-'
/** 预览用临时 ID。 */
const PREVIEW_ID = 'circle-preview'

export class CircleTool implements ITool {
  readonly id = TOOL_IDS.CIRCLE

  private ctx: ToolContext | null = null
  private clickHandler: ((evt: any) => void) | null = null
  private idCounter = 0

  /** 当前预览状态（圆心已落但未完成）。 */
  private pending: { id: string; center: LatLng; radius: number; nPoints: number } | null = null
  /** 已完成的圆形多边形 id 集合。 */
  private circleIds: Set<string> = new Set()
  /** 圆心坐标缓存。 */
  private circleCenters: Map<string, LatLng> = new Map()
  /** 圆形参数缓存。 */
  private circleParams: Map<string, { radius: number; nPoints: number }> = new Map()
  /** 生成点数缓存（供 polygonCoords 使用）。 */
  private circleCoords: Map<string, LatLng[]> = new Map()

  // 供 ToolManager 在 snapshot/restore 时提取多边形点击回调
  getClickHandler(): (id: string) => void { return () => {} }
  getMousedownHandler(): undefined { return undefined }

  activate(ctx: ToolContext): void {
    this.ctx = ctx
    this.pending = null
    this.clickHandler = (evt: any) => this.onMapClick(evt)
    ctx.map.on('click', this.clickHandler)
    log('CircleTool activated')
  }

  deactivate(): void {
    this._cleanupClick()
    if (this.pending) {
      this.ctx?.overlays.removePreviewPolygon(PREVIEW_ID)
      this.pending = null
    }
    this.ctx = null
    log('CircleTool deactivated')
  }

  reset(): void {
    if (this.pending) {
      this.ctx?.overlays.removePreviewPolygon(PREVIEW_ID)
      this.pending = null
    }
    if (this.ctx) {
      for (const id of this.circleIds) {
        this.ctx.overlays.removePolygon(id)
      }
    }
    this.circleIds.clear()
    this.circleCenters.clear()
    this.circleParams.clear()
    this.circleCoords.clear()
    this.idCounter = 0
    // reset 后重挂监听器
    if (this.ctx && !this.clickHandler) {
      this.clickHandler = (evt: any) => this.onMapClick(evt)
      this.ctx.map.on('click', this.clickHandler)
    }
    log('CircleTool reset')
  }

  /** 更新当前预览圆的参数（半径或拟合点数），重新生成多边形并回传几何信息。 */
  updateCircle(id: string, radius: number, nPoints: number): void {
    if (!this.pending || this.pending.id !== id || !this.ctx) return
    this.pending.radius = radius
    this.pending.nPoints = nPoints
    const points = this._generatePoints(this.pending.center, radius, nPoints)
    this.ctx.overlays.setPreviewPolygon(PREVIEW_ID, points,
      () => {}, // preview 不需要点击回调
    )
    const { area, perimeter } = this._computeGeometry(points)
    sendToPanel({
      type: HookEvent.CIRCLE_UPDATED,
      payload: { id, radius, nPoints, area, perimeter },
    })
  }

  /** 完成圆形绘制：将预览多边形转为正式多边形，加入图层列表。 */
  finishCircle(): void {
    if (!this.pending || !this.ctx) return
    const { id, center, radius, nPoints } = this.pending
    const points = this._generatePoints(center, radius, nPoints)
    this.ctx.overlays.addPolygon(id, points,
      (_clickedId) => {},
      undefined,
    )
    this.circleIds.add(id)
    this.circleCenters.set(id, center)
    this.circleParams.set(id, { radius, nPoints })
    this.circleCoords.set(id, points)
    sendToPanel({ type: HookEvent.POLYGON_DRAWN, payload: { id, count: nPoints } })
    const { area, perimeter } = this._computeGeometry(points)
    sendToPanel({
      type: HookEvent.POLYGON_GEOMETRY,
      payload: { id, area, perimeter },
    })
    this.pending = null
    log('CircleTool finishCircle:', id, 'radius:', radius, 'n:', nPoints)
  }

  /** 获取圆形参数（供 panel 展示）。 */
  getCircleInfo(id: string): { center: LatLng; radius: number; nPoints: number } | null {
    const center = this.circleCenters.get(id)
    const params = this.circleParams.get(id)
    if (!center || !params) return null
    return { center, ...params }
  }

  /** 检查 id 是否为圆形。 */
  isCircle(id: string): boolean {
    return this.circleIds.has(id)
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private onMapClick(evt: any): void {
    if (!this.ctx) return
    // 如果已有预览，先清除
    if (this.pending) {
      this.ctx.overlays.removePreviewPolygon(PREVIEW_ID)
    }
    const center: LatLng = { lat: evt.latLng.lat, lng: evt.latLng.lng }
    const id = `${CIRCLE_PREFIX}${++this.idCounter}`
    this.pending = { id, center, radius: DEFAULT_R, nPoints: DEFAULT_N }
    const points = this._generatePoints(center, DEFAULT_R, DEFAULT_N)
    this.ctx.overlays.setPreviewPolygon(PREVIEW_ID, points,
      () => {},
    )
    sendToPanel({
      type: HookEvent.CIRCLE_CENTER_SET,
      payload: { id, lat: center.lat, lng: center.lng, radius: DEFAULT_R, nPoints: DEFAULT_N },
    })
    log('CircleTool center set:', id, center)
  }

  /** 以 center 为圆心，radius 为半径，n 个点拟合圆形。 */
  private _generatePoints(center: LatLng, radius: number, n: number): LatLng[] {
    const TMap = (window as any).TMap
    if (!TMap?.geometry?.computeDestination) {
      log('_generatePoints: TMap.geometry.computeDestination not available, using fallback')
      return this._fallbackPoints(center, radius, n)
    }
    const points: LatLng[] = []
    const step = 360 / n
    const tmapCenter = new TMap.LatLng(center.lat, center.lng)
    for (let i = 0; i < n; i++) {
      const raw = i * step
      // TMap GL 要求 heading 在 [-180, 180]，[0, 360) 会被拒绝
      const heading = raw > 180 ? raw - 360 : raw
      try {
        const dest = TMap.geometry.computeDestination(tmapCenter, heading, radius) as any
        if (dest) {
          points.push({ lat: dest.getLat(), lng: dest.getLng() })
        }
      } catch {
        // computeDestination 抛异常（非标准 heading 范围等），退到纯本地计算
        log('_generatePoints: computeDestination threw, falling back to local')
        return this._fallbackPoints(center, radius, n)
      }
    }
    return points
  }

  /** 纯本地近似圆形生成（不依赖 TMap.geometry），作为 fallback。 */
  private _fallbackPoints(center: LatLng, radius: number, n: number): LatLng[] {
    const points: LatLng[] = []
    const step = (2 * Math.PI) / n
    const latPerM = 1 / 111320
    for (let i = 0; i < n; i++) {
      const angle = i * step
      const cosA = Math.cos(angle)
      const lngPerM = 1 / (111320 * Math.cos(center.lat * Math.PI / 180))
      points.push({
        lat: center.lat + radius * Math.sin(angle) * latPerM,
        lng: center.lng + radius * cosA * lngPerM,
      })
    }
    return points
  }

  /** 计算面积和周长，复用 TMap.geometry。 */
  private _computeGeometry(points: LatLng[]): { area: number; perimeter: number } {
    try {
      const TMap = (window as any).TMap
      if (!TMap?.geometry) return { area: 0, perimeter: 0 }
      const path = points.map((p: LatLng) => new TMap.LatLng(p.lat, p.lng))
      const closedPath = [...path, path[0]]
      return {
        area: TMap.geometry.computeArea(closedPath) as number,
        perimeter: TMap.geometry.computeDistance(closedPath) as number,
      }
    } catch {
      return { area: 0, perimeter: 0 }
    }
  }

  private _cleanupClick(): void {
    if (this.ctx && this.clickHandler) {
      this.ctx.map.off('click', this.clickHandler)
      this.clickHandler = null
    }
  }
}

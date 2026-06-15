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

type CircleMode = 'idle' | 'drawing' | 'placed'

export class CircleTool implements ITool {
  readonly id = TOOL_IDS.CIRCLE

  private ctx: ToolContext | null = null
  private idCounter = 0
  private mode: CircleMode = 'idle'

  /** 当前预览/编辑状态。 */
  private pending: { id: string; center: LatLng; radius: number; nPoints: number } | null = null

  // ── 拖拽绘制 ──
  private mousedownHandler: ((evt: any) => void) | null = null
  private mousemoveHandler: ((evt: any) => void) | null = null
  private mouseupHandler: (() => void) | null = null
  private isDragging = false

  // ── 编辑模式 ──
  private editingId: string | null = null
  private editCenter: LatLng | null = null
  private editRadius = 0
  private editNPoints = DEFAULT_N
  /** 编辑前快照，用于 cancel 回滚。 */
  private editSnapshot: { center: LatLng; radius: number; nPoints: number } | null = null
  /** 圆心拖拽手柄 marker id。 */
  private centerHandleId: string | null = null
  private dragendHandler: ((evt: any) => void) | null = null

  // ── 图层数据 ──
  private circleIds: Set<string> = new Set()
  private circleCenters: Map<string, LatLng> = new Map()
  private circleParams: Map<string, { radius: number; nPoints: number }> = new Map()
  private circleCoords: Map<string, LatLng[]> = new Map()

  // 供 ToolManager 在 snapshot/restore 时提取多边形点击回调
  getClickHandler(): (id: string) => void { return () => {} }
  getMousedownHandler(): undefined { return undefined }

  // ══════════════════════════════════════════════════════════════════
  // Lifecycle
  // ══════════════════════════════════════════════════════════════════

  activate(ctx: ToolContext): void {
    this.ctx = ctx
    this.mode = 'idle'
    this.pending = null
    log('CircleTool activated (idle)')
  }

  deactivate(): void {
    this._cleanupAll()
    if (this.pending) {
      this.ctx?.overlays.removePreviewPolygon(PREVIEW_ID)
      this.pending = null
    }
    if (this.editingId) this.cancelEditCircle()
    this.ctx = null
    log('CircleTool deactivated')
  }

  reset(): void {
    this._cleanupAll()
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
    this.mode = 'idle'
    this.editingId = null
    log('CircleTool reset')
  }

  // ══════════════════════════════════════════════════════════════════
  // 绘制流程（panel 驱动）
  // ══════════════════════════════════════════════════════════════════

  /** 进入绘制模式：监听 mousedown/mousemove/mouseup 用于拖拽画圆。 */
  startDrawing(): void {
    if (this.mode !== 'idle' || !this.ctx) return
    this.mode = 'drawing'
    this._listenDrag()
    log('CircleTool: enter drawing mode')
  }

  /** 取消绘制，回到 idle。 */
  cancelDrawing(): void {
    if (this.mode === 'idle') return
    this._stopDrag()
    this.isDragging = false
    if (this.pending) {
      this.ctx?.overlays.removePreviewPolygon(PREVIEW_ID)
      this.pending = null
    }
    this.mode = 'idle'
    log('CircleTool: cancel drawing → idle')
  }

  // ══════════════════════════════════════════════════════════════════
  // 拖拽绘制内部实现
  // ══════════════════════════════════════════════════════════════════

  private _listenDrag(): void {
    if (!this.ctx) return
    this.mousedownHandler = (evt: any) => this._onDragStart(evt)
    this.mousemoveHandler = (evt: any) => this._onDragMove(evt)
    this.mouseupHandler = () => this._onDragEnd()
    const map = this.ctx.map
    map.on('mousedown', this.mousedownHandler)
    map.on('mousemove', this.mousemoveHandler)
    map.on('mouseup', this.mouseupHandler)
  }

  private _stopDrag(): void {
    if (!this.ctx) return
    const map = this.ctx.map
    if (this.mousedownHandler) { map.off('mousedown', this.mousedownHandler); this.mousedownHandler = null }
    if (this.mousemoveHandler) { map.off('mousemove', this.mousemoveHandler); this.mousemoveHandler = null }
    if (this.mouseupHandler) { map.off('mouseup', this.mouseupHandler); this.mouseupHandler = null }
  }

  private _onDragStart(evt: any): void {
    if (this.mode !== 'drawing' || !this.ctx) return
    this.isDragging = true
    const center: LatLng = { lat: evt.latLng.lat, lng: evt.latLng.lng }
    const id = `${CIRCLE_PREFIX}${++this.idCounter}`
    this.pending = { id, center, radius: DEFAULT_R, nPoints: DEFAULT_N }
    this._updatePreview(center, DEFAULT_R, DEFAULT_N)
    sendToPanel({
      type: HookEvent.CIRCLE_CENTER_SET,
      payload: { id, lat: center.lat, lng: center.lng, radius: DEFAULT_R, nPoints: DEFAULT_N },
    })
  }

  private _onDragMove(evt: any): void {
    if (!this.isDragging || !this.pending || !this.ctx) return
    const TMap = (window as any).TMap as any
    const from = new TMap.LatLng(this.pending.center.lat, this.pending.center.lng)
    const to = new TMap.LatLng(evt.latLng.lat, evt.latLng.lng)
    let radius = DEFAULT_R
    try {
      radius = TMap.geometry.computeDistance([from, to]) as number
    } catch { /* fall through */ }
    if (radius < 10) radius = 10
    this.pending.radius = radius
    this._updatePreview(this.pending.center, radius, this.pending.nPoints)
    const { area, perimeter } = this._computeGeometry(
      this._generatePoints(this.pending.center, radius, this.pending.nPoints),
    )
    sendToPanel({
      type: HookEvent.CIRCLE_UPDATED,
      payload: { id: this.pending.id, radius, nPoints: this.pending.nPoints, area, perimeter },
    })
  }

  private _onDragEnd(): void {
    if (!this.isDragging) return
    this.isDragging = false
    if (this.pending) {
      this.mode = 'placed'
      log('CircleTool: placed, center=', this.pending.center, 'radius=', this.pending.radius)
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 完成 / 滑块更新（panel 驱动）
  // ══════════════════════════════════════════════════════════════════

  updateCircle(id: string, radius: number, nPoints: number): void {
    if (!this.pending || this.pending.id !== id || !this.ctx) return
    this.pending.radius = radius
    this.pending.nPoints = nPoints
    this._updatePreview(this.pending.center, radius, nPoints)
    const points = this._generatePoints(this.pending.center, radius, nPoints)
    const { area, perimeter } = this._computeGeometry(points)
    sendToPanel({
      type: HookEvent.CIRCLE_UPDATED,
      payload: { id, radius, nPoints, area, perimeter },
    })
  }

  finishCircle(): void {
    if (!this.pending || !this.ctx) return
    this._stopDrag()
    const { id, center, radius, nPoints } = this.pending
    const points = this._generatePoints(center, radius, nPoints)
    this.ctx.overlays.addPolygon(id, points, () => {}, undefined)
    this.circleIds.add(id)
    this.circleCenters.set(id, center)
    this.circleParams.set(id, { radius, nPoints })
    this.circleCoords.set(id, points)
    sendToPanel({ type: HookEvent.POLYGON_DRAWN, payload: { id, count: nPoints } })
    const { area, perimeter } = this._computeGeometry(points)
    sendToPanel({ type: HookEvent.POLYGON_GEOMETRY, payload: { id, area, perimeter } })
    this.pending = null
    this.mode = 'idle'
    log('CircleTool finishCircle:', id, 'r=', radius, 'n=', nPoints)
  }

  // ══════════════════════════════════════════════════════════════════
  // 圆形编辑（参数化）
  // ══════════════════════════════════════════════════════════════════

  startEditCircle(id: string): void {
    const center = this.circleCenters.get(id)
    const params = this.circleParams.get(id)
    if (!center || !params || !this.ctx) return
    this.editingId = id
    this.editCenter = { ...center }
    this.editRadius = params.radius
    this.editNPoints = params.nPoints
    this.editSnapshot = { center: { ...center }, radius: params.radius, nPoints: params.nPoints }
    this._showCenterHandle()
    this._updateEditPreview()
    sendToPanel({ type: HookEvent.CIRCLE_EDIT_STARTED, payload: { id } })
    log('CircleTool startEditCircle:', id)
  }

  /** 编辑中被 panel 拖拽圆心或调滑块时调用。 */
  updateEditCircle(center?: LatLng, radius?: number, nPoints?: number): void {
    if (!this.editingId || !this.ctx) return
    if (center) this.editCenter = center
    if (radius !== undefined) this.editRadius = radius
    if (nPoints !== undefined) this.editNPoints = nPoints
    this._updateEditPreview()
    const points = this._generatePoints(this.editCenter!, this.editRadius, this.editNPoints)
    const { area, perimeter } = this._computeGeometry(points)
    sendToPanel({
      type: HookEvent.CIRCLE_UPDATED,
      payload: { id: this.editingId, radius: this.editRadius, nPoints: this.editNPoints, area, perimeter },
    })
  }

  commitEditCircle(): void {
    if (!this.editingId || !this.editCenter) return
    const id = this.editingId
    this.circleCenters.set(id, this.editCenter)
    this.circleParams.set(id, { radius: this.editRadius, nPoints: this.editNPoints })
    const points = this._generatePoints(this.editCenter, this.editRadius, this.editNPoints)
    this.circleCoords.set(id, points)
    this.ctx?.overlays.setPreviewPolygon(id, points, () => {}, undefined)
    this.ctx?.overlays.addPolygon(id, points, () => {}, undefined)
    this._removeCenterHandle()
    sendToPanel({ type: HookEvent.CIRCLE_EDIT_COMMITTED, payload: { id } })
    const { area, perimeter } = this._computeGeometry(points)
    sendToPanel({ type: HookEvent.POLYGON_GEOMETRY, payload: { id, area, perimeter } })
    this.editingId = null
    this.editSnapshot = null
    log('CircleTool commitEditCircle:', id)
  }

  cancelEditCircle(): void {
    if (!this.editingId || !this.editSnapshot) return
    const id = this.editingId
    const snap = this.editSnapshot
    this.circleCenters.set(id, snap.center)
    this.circleParams.set(id, { radius: snap.radius, nPoints: snap.nPoints })
    const points = this._generatePoints(snap.center, snap.radius, snap.nPoints)
    this.circleCoords.set(id, points)
    this.ctx?.overlays.setPreviewPolygon(id, points, () => {}, undefined)
    this.ctx?.overlays.addPolygon(id, points, () => {}, undefined)
    this._removeCenterHandle()
    sendToPanel({ type: HookEvent.CIRCLE_EDIT_CANCELLED, payload: { id } })
    this.editingId = null
    this.editSnapshot = null
    log('CircleTool cancelEditCircle:', id)
  }

  // ══════════════════════════════════════════════════════════════════
  // 圆心拖拽手柄
  // ══════════════════════════════════════════════════════════════════

  private _showCenterHandle(): void {
    if (!this.editCenter || !this.ctx) return
    const TMap = (window as any).TMap as any
    this.centerHandleId = '__tmh_circle_center_handle__'
    const existing = this.ctx.overlays as any
    // 用 MultiMarker 放一个可拖拽蓝点
    const styles = {
      [this.centerHandleId]: new TMap.MarkerStyle({
        width: 16,
        height: 16,
        anchor: { x: 8, y: 8 },
        src: this._centerPinSvg(),
      }),
    }
    // 通过 overlays 的 markerLayer 注入
    const layer = (this.ctx.overlays as any).markerLayer
    if (!layer) return
    // 借用一个直连 geometry
    const geometries = [{
      id: this.centerHandleId,
      styleId: this.centerHandleId,
      position: new TMap.LatLng(this.editCenter.lat, this.editCenter.lng),
    }]
    if (!layer._centerHandleGeoms) {
      layer.add(geometries)
      layer._centerHandleGeoms = true
      layer.setStyles(styles)
    } else {
      layer.updateGeometries(geometries)
    }
    // 拖拽结束回调
    this.dragendHandler = (evt: any) => {
      if (!evt.geometry) return
      const pos = evt.geometry.position
      this.editCenter = { lat: pos.lat, lng: pos.lng }
      this.updateEditCircle(this.editCenter)
    }
    layer.on('dragend', this.dragendHandler)
  }

  private _removeCenterHandle(): void {
    const layer = (this.ctx?.overlays as any)?.markerLayer
    if (!layer || !this.centerHandleId) return
    if (this.dragendHandler) {
      layer.off('dragend', this.dragendHandler)
      this.dragendHandler = null
    }
    layer.remove([this.centerHandleId])
    layer._centerHandleGeoms = false
    this.centerHandleId = null
  }

  private _centerPinSvg(): string {
    return 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">`
      + `<circle cx="8" cy="8" r="6" fill="#4A90D9" stroke="#fff" stroke-width="2"/>`
      + `</svg>`,
    )
  }

  // ══════════════════════════════════════════════════════════════════
  // 查询
  // ══════════════════════════════════════════════════════════════════

  isCircle(id: string): boolean { return this.circleIds.has(id) }

  getCircleInfo(id: string): { center: LatLng; radius: number; nPoints: number } | null {
    const center = this.circleCenters.get(id)
    const params = this.circleParams.get(id)
    if (!center || !params) return null
    return { center, ...params }
  }

  getMode(): CircleMode { return this.mode }

  // ══════════════════════════════════════════════════════════════════
  // 几何计算（与旧版相同）
  // ══════════════════════════════════════════════════════════════════

  private _updatePreview(center: LatLng, radius: number, nPoints: number): void {
    const points = this._generatePoints(center, radius, nPoints)
    this.ctx?.overlays.setPreviewPolygon(PREVIEW_ID, points, () => {})
  }

  private _updateEditPreview(): void {
    if (!this.editCenter || !this.editingId) return
    const points = this._generatePoints(this.editCenter, this.editRadius, this.editNPoints)
    this.ctx?.overlays.setPreviewPolygon(this.editingId, points, () => {}, undefined)
  }

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
      const heading = raw > 180 ? raw - 360 : raw
      try {
        const dest = TMap.geometry.computeDestination(tmapCenter, heading, radius)
        if (dest) points.push({ lat: dest.getLat(), lng: dest.getLng() })
      } catch {
        log('_generatePoints: computeDestination threw, falling back to local')
        return this._fallbackPoints(center, radius, n)
      }
    }
    return points
  }

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

  private _cleanupAll(): void {
    this._stopDrag()
    this.isDragging = false
    this._removeCenterHandle()
  }
}

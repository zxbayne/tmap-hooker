import { HookEvent, sendToPanel } from '@shared/protocol'
import type { LayerKind } from '@shared/protocol'
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
  /** 持久化 overlays/mapRef 引用，不随 deactivate 清空，确保切工具后仍可拖拽/高亮已绘制图形。 */
  private overlays: any = null
  private mapRef: any = null
  private idCounter = 0
  private mode: CircleMode = 'idle'

  /** 当前预览/编辑状态。 */
  private pending: { id: string; center: LatLng; radius: number; nPoints: number } | null = null

  // ── 点击放置（click-to-place）──
  private _clickHandler: ((evt: any) => void) | null = null

  // ── placed-mode 圆心拖拽 ──
  private _placedMdHandler: ((evt: any) => void) | null = null
  private _placedMmHandler: ((evt: any) => void) | null = null
  private _placedMuHandler: (() => void) | null = null
  private _placedDragging = false

  // ── 已提交圆形拖拽（idle 模式）──
  private _commitDragId: string | null = null
  private _commitDragMoved = false
  private _commitDragStartLatLng: { lat: number; lng: number } | null = null
  private _commitDragOrigCenter: { lat: number; lng: number } | null = null
  private _commitMmHandler: ((evt: any) => void) | null = null
  private _commitMuHandler: (() => void) | null = null

  // ── 编辑模式圆心拖拽 ──
  private _editDragMmHandler: ((evt: MouseEvent) => void) | null = null
  private _editDragMuHandler: (() => void) | null = null

  // ── 编辑模式 ──
  private editingId: string | null = null
  private editCenter: LatLng | null = null
  private editRadius = 0
  private editNPoints = DEFAULT_N
  /** 编辑前快照，用于 cancel 回滚。 */
  private editSnapshot: { center: LatLng; radius: number; nPoints: number } | null = null

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
    this.overlays = ctx.overlays
    this.mapRef = ctx.map
    this.mode = 'idle'
    this.pending = null
    ctx.overlays.setCircleClickHandler(this._onCircleClick.bind(this))
    ctx.overlays.setCircleMousedownHandler(this._onCircleMousedown.bind(this))
    log('CircleTool activated (idle)')
  }

  deactivate(): void {
    this._cleanupAll()
    this._cancelCommitDrag()
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
    this._cancelCommitDrag()
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
  // 绘制流程（click-to-place）
  // ══════════════════════════════════════════════════════════════════

  /** 进入绘制模式：点击地图放置圆心，半径通过 panel 调整。 */
  startDrawing(): void {
    if (this.mode !== 'idle' || !this.ctx) return
    this.mode = 'drawing'
    this._listenClick()
    log('CircleTool: enter drawing mode')
  }

  /** 取消绘制，回到 idle。 */
  cancelDrawing(): void {
    if (this.mode === 'idle') return
    this._stopClick()
    this._stopPlacedDrag()
    if (this.pending) {
      this.ctx?.overlays.removePreviewPolygon(PREVIEW_ID)
      this.pending = null
    }
    this.mode = 'idle'
    log('CircleTool: cancel drawing → idle')
  }

  // ══════════════════════════════════════════════════════════════════
  // 点击放置内部实现
  // ══════════════════════════════════════════════════════════════════

  private _listenClick(): void {
    if (!this.ctx) return
    this._clickHandler = (evt: any) => {
      if (this.mode !== 'drawing' || !this.ctx) return
      this._stopClick()
      const center: LatLng = { lat: evt.latLng.lat, lng: evt.latLng.lng }
      const id = `${CIRCLE_PREFIX}${++this.idCounter}`
      this.pending = { id, center, radius: DEFAULT_R, nPoints: DEFAULT_N }
      this._updatePreview(center, DEFAULT_R, DEFAULT_N)
      sendToPanel({
        type: HookEvent.CIRCLE_CENTER_SET,
        payload: { id, lat: center.lat, lng: center.lng, radius: DEFAULT_R, nPoints: DEFAULT_N },
      })
      this.mode = 'placed'
      this._listenPlacedDrag()
      log('CircleTool: center placed at', center)
    }
    this.ctx.map.on('click', this._clickHandler)
  }

  private _stopClick(): void {
    if (!this.ctx || !this._clickHandler) return
    this.ctx.map.off('click', this._clickHandler)
    this._clickHandler = null
  }

  // ── placed-mode 圆心拖拽 ──────────────────────────────────────────────────

  private _listenPlacedDrag(): void {
    if (!this.ctx) return
    const polyLayer = this.ctx.overlays.getPolygonLayer()
    if (!polyLayer) return
    this._placedMdHandler = (evt: any) => {
      if (evt.geometry?.id !== PREVIEW_ID || !this.pending || !this.ctx) return
      evt.originalEvent?.stopPropagation()
      this._placedDragging = true
      const map = this.ctx!.map
      map.on('mousemove', this._placedMmHandler!)
      map.on('mouseup', this._placedMuHandler!)
    }
    this._placedMmHandler = (evt: any) => {
      if (!this._placedDragging || !this.pending || !this.ctx) return
      const center = { lat: evt.latLng.lat, lng: evt.latLng.lng }
      this.pending.center = center
      this._updatePreview(center, this.pending.radius, this.pending.nPoints)
      const points = this._generatePoints(center, this.pending.radius, this.pending.nPoints)
      const { area, perimeter } = this._computeGeometry(points)
      sendToPanel({
        type: HookEvent.CIRCLE_UPDATED,
        payload: { id: this.pending.id, radius: this.pending.radius, nPoints: this.pending.nPoints, area, perimeter, lat: center.lat, lng: center.lng } as any,
      })
    }
    this._placedMuHandler = () => {
      if (!this._placedDragging || !this.pending || !this.ctx) return
      this._placedDragging = false
      const map = this.ctx.map
      map.off('mousemove', this._placedMmHandler!)
      map.off('mouseup', this._placedMuHandler!)
      const { id, center, radius, nPoints } = this.pending
      const points = this._generatePoints(center, radius, nPoints)
      const { area, perimeter } = this._computeGeometry(points)
      sendToPanel({
        type: HookEvent.CIRCLE_UPDATED,
        payload: { id, radius, nPoints, area, perimeter, lat: center.lat, lng: center.lng } as any,
      })
      log('CircleTool: center dragged to', center)
    }
    polyLayer.on('mousedown', this._placedMdHandler)
  }

  private _stopPlacedDrag(): void {
    const polyLayer = this.ctx?.overlays.getPolygonLayer()
    if (polyLayer && this._placedMdHandler) {
      polyLayer.off('mousedown', this._placedMdHandler)
    }
    if (this.ctx) {
      const map = this.ctx.map
      if (this._placedMmHandler) map.off('mousemove', this._placedMmHandler)
      if (this._placedMuHandler) map.off('mouseup', this._placedMuHandler)
    }
    this._placedMdHandler = null
    this._placedMmHandler = null
    this._placedMuHandler = null
    this._placedDragging = false
  }

  // ══════════════════════════════════════════════════════════════════
  // 完成 / 滑块更新（panel 驱动）
  // ══════════════════════════════════════════════════════════════════

  updateCircle(id: string, radius: number, nPoints: number): void {
    // 编辑模式下路由到 updateEditCircle（pending 为 null）
    if (this.editingId === id) {
      this.updateEditCircle(undefined, radius, nPoints)
      return
    }
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
    this._stopClick()
    this._stopPlacedDrag()
    const { id, center, radius, nPoints } = this.pending
    const points = this._generatePoints(center, radius, nPoints)
    this.ctx.overlays.removePreviewPolygon(PREVIEW_ID)
    this.ctx.overlays.addPolygon(id, points, () => {}, undefined)
    this.circleIds.add(id)
    this.circleCenters.set(id, center)
    this.circleParams.set(id, { radius, nPoints })
    this.circleCoords.set(id, points)
    const { area, perimeter } = this._computeGeometry(points)
    sendToPanel({
      type: HookEvent.LAYER_DRAWN,
      payload: { id, kind: 'circle', data: { kind: 'circle', center, radius, nPoints, area, perimeter } },
    })
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
    this._updateEditPreview()
    sendToPanel({ type: HookEvent.LAYER_EDIT_STARTED, payload: { id, kind: 'circle' } })
    log('CircleTool startEditCircle:', id)
  }

  /** 编辑中被 panel 调滑块时调用（center 来自拖拽时内部更新，无需 panel 传入）。 */
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
    this.ctx?.overlays.addPolygon(id, points, () => {}, undefined)
    this.ctx?.overlays.setPolygonHighlight(null)
    this._stopEditCenterDrag()
    const { area, perimeter } = this._computeGeometry(points)
    sendToPanel({ type: HookEvent.LAYER_EDIT_COMMITTED, payload: { id, kind: 'circle' } })
    sendToPanel({
      type: HookEvent.LAYER_DRAWN,
      payload: { id, kind: 'circle', data: { kind: 'circle', center: this.editCenter, radius: this.editRadius, nPoints: this.editNPoints, area, perimeter } },
    })
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
    this.ctx?.overlays.addPolygon(id, points, () => {}, undefined)
    this.ctx?.overlays.setPolygonHighlight(null)
    this._stopEditCenterDrag()
    sendToPanel({ type: HookEvent.LAYER_EDIT_CANCELLED, payload: { id, kind: 'circle' } })
    this.editingId = null
    this.editSnapshot = null
    log('CircleTool cancelEditCircle:', id)
  }

  // ══════════════════════════════════════════════════════════════════
  // 编辑模式圆心拖拽（直接拖拽地图上的圆形）
  // ══════════════════════════════════════════════════════════════════

  private _startEditCenterDrag(latLng: any): void {
    if (!this.editCenter || !this.mapRef || !this.overlays) return
    const origCenter = { ...this.editCenter }
    const startLatLng = { lat: latLng.lat, lng: latLng.lng }

    try { this.mapRef.setDraggable(false) } catch { /* ignore */ }

    this._editDragMmHandler = (evt: MouseEvent) => {
      if (!this.mapRef) return
      const container = this.mapRef.getContainer()
      const rect = container.getBoundingClientRect()
      const TMap = (window as any).TMap
      let lat: number, lng: number
      try {
        const point = new TMap.Point(evt.clientX - rect.left, evt.clientY - rect.top)
        const projected = this.mapRef.unprojectFromContainer(point)
        lat = projected.lat
        lng = projected.lng
      } catch { return }
      const dLat = lat - startLatLng.lat
      const dLng = lng - startLatLng.lng
      this.editCenter = { lat: origCenter.lat + dLat, lng: origCenter.lng + dLng }
      this._updateEditPreview()
    }

    this._editDragMuHandler = () => {
      document.removeEventListener('mousemove', this._editDragMmHandler!)
      document.removeEventListener('mouseup', this._editDragMuHandler!)
      try { this.mapRef?.setDraggable(true) } catch { /* ignore */ }
      this._editDragMmHandler = null
      this._editDragMuHandler = null
      if (this.editCenter && this.editingId) {
        const points = this._generatePoints(this.editCenter, this.editRadius, this.editNPoints)
        const { area, perimeter } = this._computeGeometry(points)
        sendToPanel({
          type: HookEvent.CIRCLE_UPDATED,
          payload: { id: this.editingId, radius: this.editRadius, nPoints: this.editNPoints, area, perimeter },
        })
        log('CircleTool: edit center dragged to', this.editCenter)
      }
    }

    document.addEventListener('mousemove', this._editDragMmHandler)
    document.addEventListener('mouseup', this._editDragMuHandler)
  }

  private _stopEditCenterDrag(): void {
    if (this._editDragMmHandler) {
      document.removeEventListener('mousemove', this._editDragMmHandler)
      this._editDragMmHandler = null
    }
    if (this._editDragMuHandler) {
      document.removeEventListener('mouseup', this._editDragMuHandler)
      this._editDragMuHandler = null
    }
    try { this.mapRef?.setDraggable(true) } catch { /* ignore */ }
  }

  // ══════════════════════════════════════════════════════════════════
  // 圆形点击 / mousedown 回调
  // ══════════════════════════════════════════════════════════════════

  private _onCircleClick(id: string): void {
    log('[circle] click — id:', id, 'editing:', !!this.editingId)
    if (!this.circleIds.has(id)) return
    if (!this.overlays) return
    if (this.editingId === id) return  // 编辑中不重复触发选中
    const center = this.circleCenters.get(id)
    const params = this.circleParams.get(id)
    if (!center || !params) return
    this.overlays.setPolygonHighlight(id)
    const points = this.circleCoords.get(id)!
    const { area, perimeter } = this._computeGeometry(points)
    sendToPanel({
      type: HookEvent.LAYER_SELECTED,
      payload: { id, data: { kind: 'circle', center, radius: params.radius, nPoints: params.nPoints, area, perimeter } },
    })
    log('[circle] selected:', id)
  }

  private _onCircleMousedown(id: string, latLng: any): void {
    log('[circle] mousedown — id:', id, 'editing:', !!this.editingId)
    if (!this.circleIds.has(id) || !this.overlays || !this.mapRef) return

    // 编辑模式：拖拽圆形调整圆心
    if (this.editingId === id) {
      this._startEditCenterDrag(latLng)
      return
    }

    // 其他圆形正在编辑，忽略
    if (this.editingId) { log('[circle] mousedown SKIP — editing other'); return }

    // idle 模式：拖拽已提交圆形移动位置
    this.overlays.setPolygonHighlight(id)
    const origCenter = this.circleCenters.get(id)
    if (!origCenter) { log('[circle] mousedown SKIP — no origCenter'); return }
    this._commitDragId = id
    this._commitDragMoved = false
    this._commitDragStartLatLng = { lat: latLng.lat, lng: latLng.lng }
    this._commitDragOrigCenter = { ...origCenter }
    try { this.mapRef.setDraggable(false) } catch { /* ignore */ }
    this._commitMmHandler = (evt: MouseEvent) => {
      if (!this._commitDragId || !this.mapRef || !this._commitDragStartLatLng || !this._commitDragOrigCenter) return
      const container = this.mapRef.getContainer()
      const rect = container.getBoundingClientRect()
      const TMap = (window as any).TMap
      let lat: number, lng: number
      try {
        const point = new TMap.Point(evt.clientX - rect.left, evt.clientY - rect.top)
        const projected = this.mapRef.unprojectFromContainer(point)
        lat = projected.lat
        lng = projected.lng
      } catch (e: any) {
        log('[circle] commit-drag unproject FAILED:', e?.message ?? e)
        return
      }
      this._commitDragMoved = true
      const dLat = lat - this._commitDragStartLatLng.lat
      const dLng = lng - this._commitDragStartLatLng.lng
      const center = {
        lat: this._commitDragOrigCenter.lat + dLat,
        lng: this._commitDragOrigCenter.lng + dLng,
      }
      this.circleCenters.set(this._commitDragId, center)
      const params = this.circleParams.get(this._commitDragId)!
      const points = this._generatePoints(center, params.radius, params.nPoints)
      this.circleCoords.set(this._commitDragId, points)
      const polyLayer = this.overlays.getPolygonLayer()
      if (polyLayer) {
        const path = this._tmapClosedPath(points, TMap)
        polyLayer.updateGeometries([{ id: this._commitDragId, styleId: 'highlight', paths: [path] }])
      }
    }
    this._commitMuHandler = () => {
      log('[circle] drag-end — id:', this._commitDragId, 'moved:', this._commitDragMoved)
      if (!this._commitDragId || !this.mapRef) return
      document.removeEventListener('mousemove', this._commitMmHandler!)
      document.removeEventListener('mouseup', this._commitMuHandler!)
      try { this.mapRef.setDraggable(true) } catch { /* ignore */ }
      if (this._commitDragMoved) {
        const center = this.circleCenters.get(this._commitDragId)!
        const params = this.circleParams.get(this._commitDragId)!
        const points = this.circleCoords.get(this._commitDragId)!
        const { area, perimeter } = this._computeGeometry(points)
        this.overlays.addPolygon(this._commitDragId, points, () => {}, undefined)
        this.overlays.setPolygonHighlight(this._commitDragId)
        sendToPanel({
          type: HookEvent.LAYER_DRAWN,
          payload: { id: this._commitDragId, kind: 'circle', data: { kind: 'circle', center, radius: params.radius, nPoints: params.nPoints, area, perimeter } },
        })
        log('CircleTool: commit-dragged', this._commitDragId, 'to', center)
      }
      this._commitDragId = null
      this._commitDragStartLatLng = null
      this._commitDragOrigCenter = null
      this._commitMmHandler = null
      this._commitMuHandler = null
    }
    document.addEventListener('mousemove', this._commitMmHandler)
    document.addEventListener('mouseup', this._commitMuHandler)
  }

  private _tmapClosedPath(points: LatLng[], TMap: any): any[] {
    const closed = [...points]
    const first = closed[0]
    const last = closed[closed.length - 1]
    if (first.lat !== last.lat || first.lng !== last.lng) closed.push(first)
    return closed.map((p) => new TMap.LatLng(p.lat, p.lng))
  }

  private _cancelCommitDrag(): void {
    if (this._commitMmHandler) document.removeEventListener('mousemove', this._commitMmHandler)
    if (this._commitMuHandler) document.removeEventListener('mouseup', this._commitMuHandler)
    this._commitDragId = null
    this._commitDragStartLatLng = null
    this._commitDragOrigCenter = null
    this._commitMmHandler = null
    this._commitMuHandler = null
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

  getAllCircles(): Array<{ id: string; center: LatLng; radius: number; nPoints: number }> {
    const result: Array<{ id: string; center: LatLng; radius: number; nPoints: number }> = []
    for (const id of this.circleIds) {
      const center = this.circleCenters.get(id)
      const params = this.circleParams.get(id)
      if (center && params) {
        result.push({ id, center: { ...center }, radius: params.radius, nPoints: params.nPoints })
      }
    }
    return result
  }

  registerFromSnapshot(
    items: Array<{ id: string; center: LatLng; radius: number; nPoints: number }>,
    ctx: ToolContext,
  ): void {
    for (const item of items) {
      const points = this._generatePoints(item.center, item.radius, item.nPoints)
      ctx.overlays.addPolygon(item.id, points, () => {}, undefined)
      this.circleIds.add(item.id)
      this.circleCenters.set(item.id, item.center)
      this.circleParams.set(item.id, { radius: item.radius, nPoints: item.nPoints })
      this.circleCoords.set(item.id, points)
      const { area, perimeter } = points.length >= 3 ? this._computeGeometry(points) : { area: 0, perimeter: 0 }
      sendToPanel({
        type: HookEvent.LAYER_DRAWN,
        payload: {
          id: item.id,
          kind: 'circle' as LayerKind,
          data: { kind: 'circle', center: item.center, radius: item.radius, nPoints: item.nPoints, area, perimeter },
        },
      })
    }
    ctx.overlays.setCircleClickHandler((id: string) => {
      if (!this.circleIds.has(id)) return
      const info = this.getCircleInfo(id)
      if (!info) return
      const coords = this.circleCoords.get(id)
      const { area, perimeter } = coords ? this._computeGeometry(coords) : { area: 0, perimeter: 0 }
      sendToPanel({
        type: HookEvent.LAYER_SELECTED,
        payload: { id, data: { kind: 'circle', center: info.center, radius: info.radius, nPoints: info.nPoints, area, perimeter } },
      })
    })
    ctx.overlays.setCircleMousedownHandler((id: string, latLng: any) => {
      if (!this.ctx) {
        this.ctx = ctx
      }
      this._onCircleMousedown(id, latLng)
    })
    log('CircleTool.registerFromSnapshot:', items.length, 'circles')
  }

  getMode(): CircleMode { return this.mode }

  // ══════════════════════════════════════════════════════════════════
  // 几何计算
  // ══════════════════════════════════════════════════════════════════

  private _updatePreview(center: LatLng, radius: number, nPoints: number): void {
    const points = this._generatePoints(center, radius, nPoints)
    this.ctx?.overlays.setPreviewPolygon(PREVIEW_ID, points, () => {})
  }

  /**
   * 更新编辑中圆形的地图视觉。
   * 先 addPolygon（upsert）写入新路径到 polygons 缓存，
   * 再用 setPolygonPreview 切换为虚线预览样式（与新建圆形一致）。
   */
  private _updateEditPreview(): void {
    if (!this.editCenter || !this.editingId || !this.ctx) return
    const points = this._generatePoints(this.editCenter, this.editRadius, this.editNPoints)
    this.ctx.overlays.addPolygon(this.editingId, points, () => {}, undefined)
    this.ctx.overlays.setPolygonPreview(this.editingId)
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
    this._stopClick()
    this._stopPlacedDrag()
    this._stopEditCenterDrag()
  }
}

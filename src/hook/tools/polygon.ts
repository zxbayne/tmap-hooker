import { HookEvent, sendToPanel } from '@shared/protocol'
import { TOOL_IDS } from '@shared/tool-config'
import { parseCoords, coordsToText } from '@shared/utils/parse-coords'
import { log } from '../logger'
import type { ITool, ToolContext } from './types'
import type { LatLng } from '@shared/utils/parse-coords'

export class PolygonTool implements ITool {
  readonly id = TOOL_IDS.POLYGON

  private ctx: ToolContext | null = null
  private mode: 'idle' | 'drawing' = 'idle'
  private drawingPoints: LatLng[] = []
  private selectedId: string | null = null
  private polygonIds: Set<string> = new Set()
  private polygonCoords: Map<string, LatLng[]> = new Map()
  private idCounter = 0

  private drawClickHandler: ((evt: any) => void) | null = null
  private mousemoveHandler: ((evt: any) => void) | null = null
  private dblClickHandler: ((evt: any) => void) | null = null
  private keydownHandler: ((evt: KeyboardEvent) => void) | null = null

  // 拖动相关
  private isDragging = false
  private dragStartLatLng: { lat: number; lng: number } | null = null
  private dragOriginalCoords: LatLng[] | null = null
  private draggingId: string | null = null
  private dragCurrentCoords: LatLng[] | null = null
  private _justFinishedDrag = false
  private dragMoveHandler: ((evt: any) => void) | null = null
  private dragUpHandler: (() => void) | null = null

  // idle 模式地图点击（取消选中）
  private idleMapClickHandler: ((evt: any) => void) | null = null
  private _polygonClickFired = false

  private static readonly RUBBER_BAND_ID = 'poly-rubber-band'
  private static readonly PREVIEW_POLY_ID = 'poly-preview'

  // ── ITool interface ───────────────────────────────────────────────────────

  activate(ctx: ToolContext): void {
    this.ctx = ctx
    this.mode = 'idle'
    this._registerIdleClick()
    log('PolygonTool activated (idle mode)')
  }

  deactivate(): void {
    if (this.mode === 'drawing') {
      this._cleanupDrawingState()
    }
    this._unregisterIdleClick()
    this._cleanupDrag()
    this.ctx = null
    log('PolygonTool deactivated')
  }

  /**
   * 清除所有已绘制多边形及绘制状态，响应 CLEAR 命令。
   * Panel 层的 clear() 已重置 polygonLayers，此处只负责清理地图覆盖物。
   */
  reset(): void {
    if (this.mode === 'drawing') {
      this._cleanupDrawingState()
    }
    if (this.ctx) {
      for (const id of this.polygonIds) {
        this.ctx.overlays.removePolygon(id)
      }
    }
    this.polygonIds.clear()
    this.polygonCoords.clear()
    this.selectedId = null
    this.idCounter = 0
    log('PolygonTool reset — all polygons cleared')
  }

  // ── Mode transitions ──────────────────────────────────────────────────────

  /** 进入绘制模式：注册所有绘制相关事件监听器，取消当前选中。 */
  enterDrawingMode(): void {
    if (!this.ctx) return
    this._cleanupDrawingState()
    this._unregisterIdleClick()
    this.mode = 'drawing'
    this.drawingPoints = []
    this.selectedId = null
    this.ctx.overlays.setPolygonHighlight(null)

    this.drawClickHandler = (evt: any) => this.onMapClick(evt)
    this.ctx.map.on('click', this.drawClickHandler)

    this.mousemoveHandler = (evt: any) => this.onMouseMove(evt)
    this.ctx.map.on('mousemove', this.mousemoveHandler)

    this.dblClickHandler = (evt: any) => this.onDblClick(evt)
    this.ctx.map.on('dblclick', this.dblClickHandler)

    this.keydownHandler = (evt: KeyboardEvent) => this.onKeydown(evt)
    document.addEventListener('keydown', this.keydownHandler)

    sendToPanel({ type: HookEvent.POLYGON_MODE_CHANGED, payload: { mode: 'drawing', drawingPointCount: 0 } })
    log('PolygonTool enterDrawingMode')
  }

  /** 完成当前绘制：至少需要 3 个顶点，生成多边形后进入 idle 模式。 */
  finishDrawing(): void {
    if (this.drawingPoints.length < 3 || !this.ctx) return
    const id = `poly-${++this.idCounter}`
    const count = this.drawingPoints.length
    const coords = [...this.drawingPoints]
    this.ctx.overlays.addPolygon(id, coords,
      (clickedId) => this._onPolygonClick(clickedId),
      (clickedId, latLng) => this._onPolygonMousedown(clickedId, latLng),
    )
    this.polygonIds.add(id)
    this.polygonCoords.set(id, coords)
    sendToPanel({ type: HookEvent.POLYGON_DRAWN, payload: { id, count } })
    log('polygon finished, id =', id, 'points =', count)
    this.enterIdleMode()
  }

  /** 取消当前绘制：丢弃所有打点，进入 idle 模式。 */
  cancelDrawing(): void {
    log('PolygonTool cancelDrawing')
    this.enterIdleMode()
  }

  /** 进入 idle（选择）模式：注销绘制事件，清理临时覆盖物。 */
  private enterIdleMode(): void {
    this._cleanupDrawingState()
    this._registerIdleClick()
    sendToPanel({ type: HookEvent.POLYGON_MODE_CHANGED, payload: { mode: 'idle', drawingPointCount: 0 } })
    log('PolygonTool enterIdleMode')
  }

  /**
   * 清理绘制状态（注销事件监听、移除临时覆盖物）而不发送 mode 事件。
   * 供 enterIdleMode、deactivate、reset 内部调用，避免代码重复。
   */
  private _cleanupDrawingState(): void {
    this.mode = 'idle'
    if (this.ctx) {
      if (this.drawClickHandler) {
        this.ctx.map.off('click', this.drawClickHandler)
        this.drawClickHandler = null
      }
      if (this.mousemoveHandler) {
        this.ctx.map.off('mousemove', this.mousemoveHandler)
        this.mousemoveHandler = null
      }
      if (this.dblClickHandler) {
        this.ctx.map.off('dblclick', this.dblClickHandler)
        this.dblClickHandler = null
      }
      this._clearDrawingMarkers()
      this.ctx.overlays.removeRubberBand(PolygonTool.RUBBER_BAND_ID)
      this.ctx.overlays.removePreviewPolygon(PolygonTool.PREVIEW_POLY_ID)
    }
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler)
      this.keydownHandler = null
    }
    this.drawingPoints = []
  }

  // ── Public commands ───────────────────────────────────────────────────────

  /**
   * 从坐标文本直接绘制多边形（坐标导入入口）。
   * 若当前在绘制模式则先取消，解析成功后立即进入 idle 模式。
   */
  drawFromInput(input: string): void {
    if (!this.ctx) return
    if (this.mode === 'drawing') {
      this.enterIdleMode()
    }
    const points = parseCoords(input)
    if (!points || points.length < 3) {
      log('drawFromInput: failed to parse or too few points:', input)
      return
    }
    const id = `poly-${++this.idCounter}`
    this.ctx.overlays.addPolygon(id, points,
      (clickedId) => this._onPolygonClick(clickedId),
      (clickedId, latLng) => this._onPolygonMousedown(clickedId, latLng),
    )
    this.polygonIds.add(id)
    this.polygonCoords.set(id, points)
    sendToPanel({ type: HookEvent.POLYGON_DRAWN, payload: { id, count: points.length } })
    log('polygon drawn from input, id =', id, 'points =', points.length)
  }

  /** 撤销绘制中的最后一个顶点。 */
  undoDrawingPoint(): void {
    if (this.mode !== 'drawing' || this.drawingPoints.length === 0) return
    this._popLastDrawingPoint()
    if (this.drawingPoints.length === 0) {
      this.ctx?.overlays.removeRubberBand(PolygonTool.RUBBER_BAND_ID)
    }
    if (this.drawingPoints.length >= 3) {
      this.ctx?.overlays.setPreviewPolygon(
        PolygonTool.PREVIEW_POLY_ID,
        this.drawingPoints,
        (id) => this._onPolygonClick(id),
      )
    } else {
      this.ctx?.overlays.removePreviewPolygon(PolygonTool.PREVIEW_POLY_ID)
    }
    const coordsText = coordsToText(this.drawingPoints)
    sendToPanel({
      type: HookEvent.POLYGON_POINT_REMOVED,
      payload: { newCount: this.drawingPoints.length, coordsText },
    })
    log('polygon point undone, remaining:', this.drawingPoints.length)
  }

  /** 按 id 删除指定多边形（Panel 图层列表删除按钮触发）。 */
  deleteById(id: string): void {
    if (!this.ctx) return
    this.ctx.overlays.removePolygon(id)
    this.polygonIds.delete(id)
    this.polygonCoords.delete(id)
    if (this.selectedId === id) {
      this.selectedId = null
    }
    sendToPanel({ type: HookEvent.POLYGON_DELETED, payload: { id } })
    log('polygon deleted by id:', id)
  }

  /** 切换指定多边形的地图可见性。 */
  setVisible(id: string, visible: boolean): void {
    this.ctx?.overlays.setPolygonVisible(id, visible)
  }

  /** Panel 图层列表选中某行时主动触发高亮（非地图点击路径）。 */
  selectById(id: string): void {
    if (this.mode === 'drawing') return
    if (this.selectedId === id) return
    this.selectedId = id
    this.ctx?.overlays.setPolygonHighlight(id)
    const coords = this.polygonCoords.get(id) ?? []
    sendToPanel({ type: HookEvent.POLYGON_SELECTED, payload: { id, coords } })
    log('polygon selected by panel:', id)
  }

  // ── Map event handlers ────────────────────────────────────────────────────

  private onMapClick(evt: any): void {
    if (!this.ctx || this.mode !== 'drawing') return
    const latlng: LatLng = { lat: evt.latLng.lat, lng: evt.latLng.lng }
    const index = this.drawingPoints.length
    this.drawingPoints.push(latlng)
    this.ctx.overlays.addMarker(`poly-drawing-${index}`, latlng, String(index + 1))

    if (this.drawingPoints.length >= 3) {
      this.ctx.overlays.setPreviewPolygon(
        PolygonTool.PREVIEW_POLY_ID,
        this.drawingPoints,
        (id) => this._onPolygonClick(id),
      )
    }

    const coordsText = coordsToText(this.drawingPoints)
    sendToPanel({
      type: HookEvent.POLYGON_POINT_ADDED,
      payload: { lat: latlng.lat, lng: latlng.lng, index, coordsText },
    })
    log('polygon point added:', latlng, 'total:', this.drawingPoints.length)
  }

  /** 鼠标移动时更新橡皮筋预览线（所有已打点 + 当前光标位置）。 */
  private onMouseMove(evt: any): void {
    if (!this.ctx || this.mode !== 'drawing' || this.drawingPoints.length === 0) return
    const cursor: LatLng = { lat: evt.latLng.lat, lng: evt.latLng.lng }
    this.ctx.overlays.setRubberBand(PolygonTool.RUBBER_BAND_ID, [...this.drawingPoints, cursor])
  }

  /**
   * 双击完成多边形。
   * TMap 双击事件触发顺序：click（第一下）→ click（第二下）→ dblclick。
   * 第二下 click 已经向 drawingPoints 添加了一个点，这里需要先弹出再提交。
   */
  private onDblClick(_evt: any): void {
    if (this.mode !== 'drawing') return
    this._popLastDrawingPoint()
    this.finishDrawing()
  }

  private onKeydown(evt: KeyboardEvent): void {
    if (evt.key === 'Escape') {
      evt.preventDefault()
      this.cancelDrawing()
    }
  }

  /** 点击已有多边形时的回调（图层级注册，通过 evt.geometry.id 路由）。 */
  private _onPolygonClick(id: string): void {
    this._polygonClickFired = true
    if (id === PolygonTool.PREVIEW_POLY_ID) return
    if (this.mode === 'drawing') return
    if (this._justFinishedDrag) return
    if (this.selectedId === id) return
    this.selectedId = id
    this.ctx?.overlays.setPolygonHighlight(id)
    const coords = this.polygonCoords.get(id) ?? []
    sendToPanel({ type: HookEvent.POLYGON_SELECTED, payload: { id, coords } })
    log('polygon selected:', id)
  }

  // ── Idle-click deselect ───────────────────────────────────────────────────

  private _registerIdleClick(): void {
    if (this.idleMapClickHandler || !this.ctx) return
    this.idleMapClickHandler = (_evt: any) => {
      if (this._polygonClickFired) {
        this._polygonClickFired = false
        return
      }
      if (this.selectedId !== null) {
        this.selectedId = null
        this.ctx?.overlays.setPolygonHighlight(null)
        sendToPanel({ type: HookEvent.POLYGON_SELECTED, payload: { id: '', coords: [] } })
        log('polygon deselected (map click)')
      }
    }
    this.ctx.map.on('click', this.idleMapClickHandler)
  }

  private _unregisterIdleClick(): void {
    if (!this.idleMapClickHandler || !this.ctx) return
    this.ctx.map.off('click', this.idleMapClickHandler)
    this.idleMapClickHandler = null
  }

  // ── Polygon drag ──────────────────────────────────────────────────────────

  private _onPolygonMousedown(id: string, latLng: any): void {
    log('[drag] mousedown — id:', id, 'mode:', this.mode, 'selectedId:', this.selectedId)
    if (this.mode !== 'idle') return
    if (id === PolygonTool.PREVIEW_POLY_ID) return
    if (!this.ctx) return
    if (id !== this.selectedId) return
    const originalCoords = this.polygonCoords.get(id)
    if (!originalCoords) return

    this.isDragging = true
    this.draggingId = id
    this.dragStartLatLng = { lat: latLng.lat, lng: latLng.lng }
    this.dragOriginalCoords = [...originalCoords]
    this.dragCurrentCoords = null

    try {
      this.ctx.map.setDraggable(false)
    } catch (e) {
      log('[drag] map.setDraggable(false) threw:', e)
    }

    this.dragMoveHandler = (evt: any) => this._onDragMove(evt)
    this.dragUpHandler = () => this._onDragUp()
    this.ctx.map.on('mousemove', this.dragMoveHandler)
    document.addEventListener('mouseup', this.dragUpHandler)
    log('[drag] started')
  }

  private _onDragMove(evt: any): void {
    if (!this.isDragging || !this.dragStartLatLng || !this.dragOriginalCoords || !this.draggingId || !this.ctx) return
    const dLat = evt.latLng.lat - this.dragStartLatLng.lat
    const dLng = evt.latLng.lng - this.dragStartLatLng.lng
    const newCoords = this.dragOriginalCoords.map((p) => ({ lat: p.lat + dLat, lng: p.lng + dLng }))
    this.dragCurrentCoords = newCoords
    this.ctx.overlays.updatePolygonPath(this.draggingId, newCoords)
  }

  private _onDragUp(): void {
    if (!this.isDragging || !this.dragOriginalCoords || !this.draggingId || !this.ctx) return
    const finalCoords = this.dragCurrentCoords ?? [...this.dragOriginalCoords]
    const id = this.draggingId

    this.polygonCoords.set(id, finalCoords)
    this.ctx.overlays.addPolygon(id, finalCoords,
      (clickedId) => this._onPolygonClick(clickedId),
      (clickedId, latLng) => this._onPolygonMousedown(clickedId, latLng),
    )
    this.ctx.overlays.setPolygonHighlight(id)
    sendToPanel({ type: HookEvent.POLYGON_SELECTED, payload: { id, coords: finalCoords } })

    this._cleanupDrag()

    try { this.ctx.map.setDraggable(true) } catch { /* 忽略 */ }

    this._justFinishedDrag = true
    setTimeout(() => { this._justFinishedDrag = false }, 100)
    log('polygon drag end:', id)
  }

  private _cleanupDrag(): void {
    if (this.ctx && this.dragMoveHandler) {
      this.ctx.map.off('mousemove', this.dragMoveHandler)
      this.dragMoveHandler = null
    }
    if (this.dragUpHandler) {
      document.removeEventListener('mouseup', this.dragUpHandler)
      this.dragUpHandler = null
    }
    this.isDragging = false
    this.draggingId = null
    this.dragStartLatLng = null
    this.dragOriginalCoords = null
    this.dragCurrentCoords = null
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _popLastDrawingPoint(): void {
    if (this.drawingPoints.length === 0) return
    const lastIdx = this.drawingPoints.length - 1
    this.ctx?.overlays.removeMarker(`poly-drawing-${lastIdx}`)
    this.drawingPoints.pop()
  }

  private _clearDrawingMarkers(): void {
    if (!this.ctx) return
    for (let i = 0; i < this.drawingPoints.length; i++) {
      this.ctx.overlays.removeMarker(`poly-drawing-${i}`)
    }
  }
}

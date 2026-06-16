import { HookEvent, sendToPanel } from '@shared/protocol'
import type { LayerKind, LayerDrawnPayload, LayerSelectedPayload, LayerDeletedPayload, LayerEditEventPayload, PolygonLayerData } from '@shared/protocol'
import { TOOL_IDS } from '@shared/tool-config'
import { parseCoords, coordsToText } from '@shared/utils/parse-coords'
import { log } from '../logger'
import type { ITool, ToolContext } from './types'
import type { LatLng } from '@shared/utils/parse-coords'

export class PolygonTool implements ITool {
  readonly id = TOOL_IDS.POLYGON

  private ctx: ToolContext | null = null
  /** 持久化 overlays 引用，不随 deactivate 清空，确保切工具后仍可高亮点击的图形。 */
  private overlays: any = null
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

  // 编辑相关
  private editingId: string | null = null
  private editOriginalCoords: LatLng[] | null = null
  private editCurrentCoords: LatLng[] | null = null
  private editor: any = null
  private editLayer: any = null

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

  /** 供 OverlayManager.restore() 使用的多边形点击回调。 */
  getClickHandler(): (id: string) => void {
    return (id) => this._onPolygonClick(id)
  }

  /** 供 OverlayManager.restore() 使用的多边形 mousedown 回调。 */
  getMousedownHandler(): (id: string, latLng: any) => void {
    return (id, latLng) => this._onPolygonMousedown(id, latLng)
  }

  /**
   * SPA 切换后从快照恢复 PolygonTool 内部状态。
   * overlay-manager.restore() 只重建了图层几何体和内部 polygons Map，
   * PolygonTool.polygonCoords 和 Panel 的 layers 列表需要重新同步。
   */
  registerFromRestore(items: Array<{ id: string; points: LatLng[] }>): void {
    for (const item of items) {
      this.polygonCoords.set(item.id, item.points)
      // 回放 LAYER_DRAWN 让 Panel 重建图层列表
      const { area, perimeter } = this._tryComputeGeometry(item.points)
      sendToPanel({
        type: HookEvent.LAYER_DRAWN,
        payload: {
          id: item.id,
          kind: 'polygon' as LayerKind,
          data: { kind: 'polygon', coords: item.points, area, perimeter } as PolygonLayerData,
        },
      })
    }
    log('PolygonTool.registerFromRestore:', items.length, 'polygons')
  }

  activate(ctx: ToolContext): void {
    this.ctx = ctx
    this.overlays = ctx.overlays
    this.mode = 'idle'
    this._registerIdleClick()
    log('PolygonTool activated (idle mode)')
  }

  deactivate(): void {
    if (this.editingId !== null) {
      this._cancelEditInternal()
    }
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
    if (this.editingId !== null) {
      this._cancelEditInternal()
    }
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
    if (this.editingId !== null) {
      this._cancelEditInternal()
    }
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
    sendToPanel({ type: HookEvent.LAYER_DRAWN, payload: { id, kind: 'polygon' as LayerKind, data: { kind: 'polygon', coords, area: null, perimeter: null } as PolygonLayerData } })
    this._sendGeometryInfo(id, coords)
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
    sendToPanel({ type: HookEvent.LAYER_DRAWN, payload: { id, kind: 'polygon' as LayerKind, data: { kind: 'polygon', coords: points, area: null, perimeter: null } as PolygonLayerData } })
    this._sendGeometryInfo(id, points)
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
    if (this.editingId === id) {
      this._cancelEditInternal()
    }
    this.ctx.overlays.removePolygon(id)
    this.polygonIds.delete(id)
    this.polygonCoords.delete(id)
    if (this.selectedId === id) {
      this.selectedId = null
    }
    sendToPanel({ type: HookEvent.LAYER_DELETED, payload: { id } })
    log('polygon deleted by id:', id)
  }

  /** 切换指定多边形的地图可见性。 */
  setVisible(id: string, visible: boolean): void {
    this.ctx?.overlays.setPolygonVisible(id, visible)
  }

  /** Panel 图层列表选中某行时主动触发高亮（非地图点击路径）。 */
  selectById(id: string, panToLocation = false): void {
    if (this.mode === 'drawing') return
    if (this.selectedId === id) return
    this.selectedId = id
    this.overlays?.setPolygonHighlight(id)
    const coords = this.polygonCoords.get(id) ?? []
    if (panToLocation && coords.length > 0 && this.ctx) {
      this._panToCenter(coords)
    }
    sendToPanel({ type: HookEvent.LAYER_SELECTED, payload: { id, data: { kind: 'polygon', coords, area: null, perimeter: null } as PolygonLayerData } })
    this._sendGeometryInfo(id, coords)
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
    if (this.editingId !== null) return
    if (this._justFinishedDrag) return
    if (this.selectedId === id) return
    this.selectedId = id
    this.overlays?.setPolygonHighlight(id)
    const coords = this.polygonCoords.get(id) ?? []
    sendToPanel({ type: HookEvent.LAYER_SELECTED, payload: { id, data: { kind: 'polygon', coords, area: null, perimeter: null } as PolygonLayerData } })
    this._sendGeometryInfo(id, coords)
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
        sendToPanel({ type: HookEvent.LAYER_SELECTED, payload: { id: '' } })
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
    if (this.editingId !== null) return
    if (this.mode !== 'idle') return
    if (id === PolygonTool.PREVIEW_POLY_ID) return
    if (!this.ctx) return
    // 如果多边形未选中，先自动选中（对齐 CircleTool 的"直接拖"体验）
    if (id !== this.selectedId) {
      this.selectedId = id
      this.ctx.overlays.setPolygonHighlight(id)
      const coords = this.polygonCoords.get(id) ?? []
      sendToPanel({ type: HookEvent.LAYER_SELECTED, payload: { id, data: { kind: 'polygon', coords, area: null, perimeter: null } as PolygonLayerData } })
      this._sendGeometryInfo(id, coords)
    }
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

    const dragMoveLogger: Array<{ t: number; x: number; y: number }> = []
    this.dragMoveHandler = (evt: MouseEvent) => {
      // 使用 document mousemove（而非 map.on），避免 TMap overlay 层拦截 mousemove 事件
      if (!this.ctx || !this.isDragging) return
      dragMoveLogger.push({ t: Date.now(), x: evt.clientX, y: evt.clientY })
      const container = this.ctx.map.getContainer()
      const rect = container.getBoundingClientRect()
      const TMap = (window as any).TMap
      let latLng: { lat: number; lng: number }
      try {
        const point = new TMap.Point(evt.clientX - rect.left, evt.clientY - rect.top)
        const projected = this.ctx.map.unprojectFromContainer(point)
        latLng = { lat: projected.lat, lng: projected.lng }
      } catch (e: any) {
        log('[drag] unproject FAILED:', e?.message ?? e)
        return
      }
      this._onDragMove({ latLng, _seq: dragMoveLogger.length })
    }
    this.dragUpHandler = () => {
      log('[drag] mouseup — moved:', dragMoveLogger.length, 'times')
      this._onDragUp()
    }
    document.addEventListener('mousemove', this.dragMoveHandler)
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
    // 内联计算 area/perimeter，避免 LAYER_SELECTED(null) + POLYGON_GEOMETRY 两步的时序依赖
    const { area, perimeter } = this._tryComputeGeometry(finalCoords)
    sendToPanel({ type: HookEvent.LAYER_SELECTED, payload: { id, data: { kind: 'polygon', coords: finalCoords, area, perimeter } as PolygonLayerData } })
    // area/perimeter 已内联，只在计算失败（null）时才补发
    if (area === null) this._sendGeometryInfo(id, finalCoords)

    this._cleanupDrag()

    try { this.ctx.map.setDraggable(true) } catch { /* 忽略 */ }

    this._justFinishedDrag = true
    setTimeout(() => { this._justFinishedDrag = false }, 100)
    log('polygon drag end:', id)
  }

  private _cleanupDrag(): void {
    if (this.dragMoveHandler) {
      document.removeEventListener('mousemove', this.dragMoveHandler)
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

  // ── Polygon editing ───────────────────────────────────────────────────────

  /** 进入顶点编辑模式，使用 TMap.tools.GeometryEditor 在隔离图层上编辑指定多边形。 */
  startEditById(id: string): void {
    if (!this.ctx) return
    const TMap = (window as any).TMap
    if (!TMap?.tools?.GeometryEditor) {
      log('startEditById: TMap.tools.GeometryEditor not available')
      return
    }
    if (this.editingId !== null) {
      this._cancelEditInternal()
    }
    if (this.mode === 'drawing') {
      this._cleanupDrawingState()
      sendToPanel({ type: HookEvent.POLYGON_MODE_CHANGED, payload: { mode: 'idle', drawingPointCount: 0 } })
    }

    const originalCoords = this.polygonCoords.get(id)
    if (!originalCoords) return

    this.editOriginalCoords = [...originalCoords]
    this.editCurrentCoords = null
    this.editingId = id

    // 隐藏主层中该多边形
    this.ctx.overlays.setPolygonVisible(id, false)

    // 创建临时编辑图层（含该多边形）
    const closedPath = [...originalCoords]
    if (closedPath.length > 0) {
      const first = closedPath[0]
      const last = closedPath[closedPath.length - 1]
      if (first.lat !== last.lat || first.lng !== last.lng) closedPath.push(first)
    }
    const tmapPath = closedPath.map((p: LatLng) => new TMap.LatLng(p.lat, p.lng))

    this.editLayer = new TMap.MultiPolygon({
      map: this.ctx.map,
      styles: {
        default: new TMap.PolygonStyle({
          color: 'rgba(74, 144, 217, 0.12)',
          borderColor: '#4A90D9',
          borderWidth: 2,
        }),
        highlight: new TMap.PolygonStyle({
          color: 'rgba(74, 144, 217, 0.3)',
          borderColor: '#2B6CB0',
          borderWidth: 3,
        }),
      },
      geometries: [{ id, styleId: 'default', paths: [tmapPath] }],
    })

    this.editor = new TMap.tools.GeometryEditor({
      map: this.ctx.map,
      overlayList: [{ overlay: this.editLayer, id: 'edit-layer', selectedStyleId: 'highlight' }],
      actionMode: TMap.tools.constants.EDITOR_ACTION.INTERACT,
      activeOverlayId: 'edit-layer',
      selectable: true,
      snappable: true,
    })

    this.editor.on('adjust_complete', (result: any) => {
      log('adjust_complete fired, result keys:', result ? Object.keys(result).join(',') : 'null')
      this._syncEditCoords(result)
      log('after adjust_complete sync, editCurrentCoords count:', this.editCurrentCoords?.length ?? 'null')
    })
    this.editor.on('delete_complete', (result: any) => {
      log('delete_complete fired')
      this._syncEditCoords(result)
    })

    // 自动选中该多边形，无需用户在地图上手动点击
    try {
      this.editor.select([id])
    } catch (e) {
      log('startEditById: auto-select failed:', e)
    }

    this._unregisterIdleClick()
    sendToPanel({ type: HookEvent.LAYER_EDIT_STARTED, payload: { id, kind: 'polygon' } })
    log('startEditById:', id)
  }

  /** 提交编辑：用最终坐标更新主层，销毁编辑器。 */
  finishEdit(): void {
    if (!this.ctx || this.editingId === null) return
    // 最后一次强制同步（从 editLayer 直读，不依赖缓存）
    this._syncEditCoords()
    const id = this.editingId
    log('finishEdit:', id, '- editCurrentCoords:', this.editCurrentCoords ? this.editCurrentCoords.length + ' pts' : 'null — falling back to original')
    const finalCoords = this.editCurrentCoords ?? this.editOriginalCoords!
    this._destroyEditor()
    this.polygonCoords.set(id, finalCoords)
    this.ctx.overlays.addPolygon(id, finalCoords,
      (clickedId) => this._onPolygonClick(clickedId),
      (clickedId, latLng) => this._onPolygonMousedown(clickedId, latLng),
    )
    this.ctx.overlays.setPolygonVisible(id, true)
    this.editingId = null
    this._registerIdleClick()
    sendToPanel({ type: HookEvent.LAYER_EDIT_COMMITTED, payload: { id, kind: 'polygon' } })
    // Also send updated layer data
    sendToPanel({ type: HookEvent.LAYER_DRAWN, payload: { id, kind: 'polygon' as LayerKind, data: { kind: 'polygon', coords: finalCoords, area: null, perimeter: null } as PolygonLayerData } })
    this._sendGeometryInfo(id, finalCoords)
    log('finishEdit:', id)
  }

  /** 取消编辑：恢复原始多边形，销毁编辑器。 */
  cancelEdit(): void {
    if (this.editingId === null) return
    const id = this.editingId
    this._cancelEditInternal()
    sendToPanel({ type: HookEvent.LAYER_EDIT_CANCELLED, payload: { id, kind: 'polygon' } })
    log('cancelEdit:', id)
  }

  /** 内部取消逻辑（不发送 CANCELLED 事件，供 deactivate/reset 等场景调用）。 */
  private _cancelEditInternal(): void {
    if (this.editingId === null) return
    const id = this.editingId
    this._destroyEditor()
    if (this.ctx) {
      this.ctx.overlays.setPolygonVisible(id, true)
    }
    this.editingId = null
    if (this.ctx) {
      this._registerIdleClick()
    }
  }

  private _destroyEditor(): void {
    try { this.editor?.setMap?.(null) } catch { /* ignore */ }
    try { this.editor?.destroy?.() } catch { /* ignore */ }
    try { this.editLayer?.setMap?.(null) } catch { /* ignore */ }
    this.editor = null
    this.editLayer = null
    this.editOriginalCoords = null
    this.editCurrentCoords = null
  }

  /**
   * 从编辑器事件结果或 editLayer 中读取最新坐标并缓存。
   * 优先使用事件结果中的 geometry.paths（adjust_complete 直接携带最新数据），
   * 若缺失则回落到 editLayer.getGeometries()。
   */
  private _syncEditCoords(result?: any): void {
    // 优先：从事件结果中提取（adjust_complete 结果本身即几何体，含 id/styleId/paths/rank）
    if (result?.paths) {
      const paths = result.paths
      const rawPts = Array.isArray(paths[0]) ? paths[0] : paths
      if (rawPts.length > 0) {
        log('_syncEditCoords: using result.geometry.paths, pts:', rawPts.length)
        this.editCurrentCoords = this._normalizeEditCoords(rawPts)
        return
      }
    }
    // 回落：从图层几何体读取
    if (!this.editLayer) {
      log('_syncEditCoords: no editLayer')
      return
    }
    const geos = this.editLayer.getGeometries?.()
    log('_syncEditCoords: getGeometries returned', geos ? geos.length + ' geos' : 'null')
    if (!geos || geos.length === 0) return
    const paths = geos[0]?.paths
    log('_syncEditCoords: paths type:', Array.isArray(paths) ? 'array len=' + paths.length : typeof paths)
    if (!paths || paths.length === 0) return
    const rawPts = Array.isArray(paths[0]) ? paths[0] : paths
    log('_syncEditCoords: rawPts len:', rawPts.length, 'first item type:', rawPts[0] ? typeof rawPts[0] : 'empty')
    if (rawPts.length === 0) return
    this.editCurrentCoords = this._normalizeEditCoords(rawPts)
    log('_syncEditCoords: normalized to', this.editCurrentCoords.length, 'pts')
  }

  private _normalizeEditCoords(pts: any[]): LatLng[] {
    let coords: LatLng[] = pts.map((p: any) => ({
      lat: typeof p.getLat === 'function' ? p.getLat() : p.lat,
      lng: typeof p.getLng === 'function' ? p.getLng() : p.lng,
    }))
    if (coords.length > 1) {
      const first = coords[0]; const last = coords[coords.length - 1]
      if (first.lat === last.lat && first.lng === last.lng) coords = coords.slice(0, -1)
    }
    return coords
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _panToCenter(coords: LatLng[]): void {
    if (!this.ctx) return
    const lats = coords.map((p) => p.lat)
    const lngs = coords.map((p) => p.lng)
    const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2
    const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2
    const TMap = (window as any).TMap
    const center = new TMap.LatLng(centerLat, centerLng)
    if (typeof this.ctx.map.panTo === 'function') {
      this.ctx.map.panTo(center)
    } else {
      this.ctx.map.setCenter(center)
    }
  }

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

  /** 计算多边形面积和周长，并通过协议发送给 panel。 */
  private _sendGeometryInfo(id: string, coords: LatLng[]): void {
    if (!this.ctx || coords.length < 3) return
    const TMap = (window as any).TMap
    if (!TMap?.geometry) return
    try {
      const path = coords.map((p) => new TMap.LatLng(p.lat, p.lng))
      const closedPath = [...path, path[0]]
      const perimeter = TMap.geometry.computeDistance(closedPath) as number
      const area = TMap.geometry.computeArea(closedPath) as number
      sendToPanel({
        type: HookEvent.POLYGON_GEOMETRY,
        payload: { id, area, perimeter },
      })
      log('_sendGeometryInfo:', id, 'area:', area, 'perimeter:', perimeter)
    } catch (e) {
      log('_sendGeometryInfo failed:', e)
    }
  }

  /**
   * 同步计算多边形面积和周长，失败时返回 null。
   * 供 _onDragUp / finishEdit 等需要在同一消息里携带几何数据的场景使用，
   * 避免先发 null 再补发 POLYGON_GEOMETRY 产生的时序依赖。
   */
  private _tryComputeGeometry(coords: LatLng[]): { area: number | null; perimeter: number | null } {
    if (coords.length < 3) return { area: null, perimeter: null }
    const TMap = (window as any).TMap
    if (!TMap?.geometry) return { area: null, perimeter: null }
    try {
      const path = coords.map((p) => new TMap.LatLng(p.lat, p.lng))
      const closedPath = [...path, path[0]]
      const perimeter = TMap.geometry.computeDistance(closedPath) as number
      const area = TMap.geometry.computeArea(closedPath) as number
      return { area, perimeter }
    } catch (e) {
      log('_tryComputeGeometry failed:', e)
      return { area: null, perimeter: null }
    }
  }
}

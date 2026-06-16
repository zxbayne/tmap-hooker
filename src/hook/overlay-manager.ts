import type { LatLng } from '@shared/utils/parse-coords'
import type { OverlaySnapshotItem } from '@shared/protocol'
import { log } from './logger'

/**
 * 管理地图上所有覆盖物图层（标记、折线、标签、多边形、橡皮筋线）。
 * 采用懒加载策略：图层在第一次使用时创建，避免在空工具状态下占用资源。
 * 各图层通过 TMap Multi* 系列 API 批量管理，支持 add/update/remove。
 */
export class OverlayManager {
  private map: any
  private TMap: any
  private markerLayer: any = null
  private polylineLayer: any = null
  private labelMarkers: Map<string, any> = new Map()
  private polygonLayer: any = null
  private rubberBandLayer: any = null
  /** 持久点位图层（不被 clearMeasurement 清除）。 */
  private pointMarkerLayer: any = null
  private pointLabelLayer: any = null

  /** 已添加的标记 id 集合，用于区分 add 和 update 操作。 */
  private markers: Map<string, boolean> = new Map()
  private polylines: Map<string, boolean> = new Map()
  /**
   * 已添加的多边形路径缓存（paths 数组）。
   * 仅存储"真实"多边形（非预览），由 addPolygon 写入、removePolygon 清理。
   * setPreviewPolygon 不写此 Map，因此 setPolygonHighlight 可通过此 Map 跳过预览多边形。
   */
  private polygons: Map<string, any[]> = new Map()
  /** 预览多边形路径，由 setPreviewPolygon 管理，独立于 polygons。 */
  private previewPaths: any[] | null = null
  private rubberBands: Map<string, boolean> = new Map()
  /** 持久点位 track。 */
  private pointMarkers: Map<string, LatLng> = new Map()
  private pointMarkerNames: Map<string, string> = new Map()
  private pointMarkerVisible: Map<string, boolean> = new Map()
  private highlightedPointId: string | null = null

  /** 每个真实多边形的可见状态（true = 可见，false = 隐藏）。 */
  private polygonVisible: Map<string, boolean> = new Map()
  /** 当前高亮的多边形 id，供 setPolygonVisible 判断应还原为何种样式。 */
  private highlightedId: string | null = null

  /** 多边形点击时的回调，注册在图层级别（非单个几何体），通过 evt.geometry.id 区分。 */
  private onPolygonClick: ((id: string) => void) | null = null
  /** 多边形 mousedown 回调，用于实现拖动。 */
  private onPolygonMousedown: ((id: string, latLng: any) => void) | null = null

  /** 圆形专有回调（按 circle- 前缀路由，不与多边形回调混淆）。 */
  private onCircleClick: ((id: string) => void) | null = null
  private onCircleMousedown: ((id: string, latLng: any) => void) | null = null

  /** mousedown handler 是否已绑定到 polygonLayer（只绑一次）。 */
  private _mousedownAttached = false

  // ── Measure layers (persistent) ────────────────────────────────────────────

  /** 测距折线图层（线、距离标签、顶点标记）。 */
  private measurePolylineLayer: any = null
  private measureMarkerLayer: any = null
  /** 每条测距的标签集（key=measureId, value=标签 MultiMarker 实例数组）。 */
  private measureLabelMarkers: Map<string, any[]> = new Map()
  /** 每条测距的顶点坐标（key=measureId）。 */
  private measures: Map<string, LatLng[]> = new Map()
  /** 每条测距的可见状态。 */
  private measureVisible: Map<string, boolean> = new Map()
  /** 当前高亮测距 id。 */
  private highlightedMeasureId: string | null = null
  /** 测距点击回调。 */
  private onMeasureClick: ((id: string) => void) | null = null

  constructor(map: any, TMap: any) {
    this.map = map
    this.TMap = TMap
  }

  // ── Markers ──────────────────────────────────────────────────────────────

  private ensureMarkerLayer() {
    if (this.markerLayer) return
    this.markerLayer = new this.TMap.MultiMarker({
      id: 'tmap-hooker-markers',
      map: this.map,
      styles: {
        default: new this.TMap.MarkerStyle({
          width: 14,
          height: 14,
          anchor: { x: 7, y: 7 },
          src: this._hollowCircleSvg(),
        }),
      },
      geometries: [],
    })
  }

  /** 统一的 add-or-update 操作：track 有记录则 update，否则 add 并记录。 */
  private _upsert(layer: any, track: Map<string, boolean>, id: string, geometry: object): void {
    if (track.has(id)) {
      layer.updateGeometries([geometry])
    } else {
      layer.add([geometry])
      track.set(id, true)
    }
  }

  addMarker(id: string, latlng: LatLng, label = ''): void {
    this.ensureMarkerLayer()
    const geometry = {
      id,
      styleId: 'default',
      position: new this.TMap.LatLng(latlng.lat, latlng.lng),
    }
    this._upsert(this.markerLayer, this.markers, id, geometry)
  }

  removeMarker(id: string): void {
    if (!this.markerLayer || !this.markers.has(id)) return
    this.markerLayer.remove([id])
    this.markers.delete(id)
  }

  // ── Polylines ─────────────────────────────────────────────────────────────

  private ensurePolylineLayer() {
    if (this.polylineLayer) return
    this.polylineLayer = new this.TMap.MultiPolyline({
      id: 'tmap-hooker-lines',
      map: this.map,
      styles: {
        default: new this.TMap.PolylineStyle({
          color: '#4A90D9',
          width: 2,
          lineCap: 'butt',
          dashArray: [10, 6],
        }),
      },
      geometries: [],
    })
  }

  setPolyline(id: string, points: LatLng[]): void {
    if (points.length < 2) return
    this.ensurePolylineLayer()
    const path = points.map((p) => new this.TMap.LatLng(p.lat, p.lng))
    this._upsert(this.polylineLayer, this.polylines, id, { id, styleId: 'default', paths: path })
  }

  removePolyline(id: string): void {
    if (!this.polylineLayer || !this.polylines.has(id)) return
    this.polylineLayer.remove([id])
    this.polylines.delete(id)
  }

  // ── Labels (per-marker with SVG cards) ────────────────────────────────────

  addLabel(id: string, latlng: LatLng, text: string, _styleId = 'default'): void {
    // 更新已有标签：先销毁旧 mini-MultiMarker 再建新的
    if (this.labelMarkers.has(id)) {
      this.labelMarkers.get(id)!.setMap(null)
    }
    const svg = this._labelCardSvg(text)
    const w = this._labelCardWidth(text)
    const layer = new this.TMap.MultiMarker({
      map: this.map,
      styles: {
        default: new this.TMap.MarkerStyle({
          width: w,
          height: 24,
          anchor: { x: Math.round(w / 2), y: 30 },  // 标签底部在坐标点上方 6px
          src: svg,
        }),
      },
      geometries: [{
        id,
        styleId: 'default',
        position: new this.TMap.LatLng(latlng.lat, latlng.lng),
      }],
    })
    this.labelMarkers.set(id, layer)
  }

  removeLabel(id: string): void {
    const marker = this.labelMarkers.get(id)
    if (!marker) return
    marker.setMap(null)
    this.labelMarkers.delete(id)
  }

  // ── Polygons ──────────────────────────────────────────────────────────────

  private _attachMousedownHandler(): void {
    // 只绑定一次（mousedown handler 内部通过 prefix 路由到不同工具的 callback）
    if (this._mousedownAttached || !this.polygonLayer) {
      log('[overlay] _attachMousedownHandler SKIP — attached:', this._mousedownAttached, 'layer:', !!this.polygonLayer)
      return
    }
    this._mousedownAttached = true
    log('[overlay] _attachMousedownHandler DONE — mousedown listener registered')
    this.polygonLayer.on('mousedown', (evt: any) => {
      const id: string = evt.geometry?.id
      log('[overlay] mousedown event:', id, 'circleCb:', !!this.onCircleMousedown, 'polyCb:', !!this.onPolygonMousedown)
      if (!id) return
      evt.originalEvent?.stopPropagation()
      if (id.startsWith('circle-') && this.onCircleMousedown) {
        this.onCircleMousedown(id, evt.latLng)
        return
      }
      this.onPolygonMousedown?.(id, evt.latLng)
    })
  }

  private ensurePolygonLayer(
    onClickCb: (id: string) => void,
    onMousedownCb?: (id: string, latLng: any) => void,
    initialGeometries?: any[],
  ) {
    if (this.polygonLayer) {
      // 图层已存在：更新回调（后续 addPolygon / setPreviewPolygon 可能带入新的回调）;
      // 初始几何体仅追加。
      if (onClickCb) this.onPolygonClick = onClickCb
      if (onMousedownCb) this.onPolygonMousedown = onMousedownCb
      this._attachMousedownHandler()
      if (initialGeometries && initialGeometries.length > 0) {
        this.polygonLayer.add(initialGeometries)
      }
      return
    }
    this.polygonLayer = new this.TMap.MultiPolygon({
      id: 'tmap-hooker-polygons',
      map: this.map,
      styles: {
        default: new this.TMap.PolygonStyle({
          color: 'rgba(74, 144, 217, 0.18)',
          borderColor: '#4A90D9',
          borderWidth: 2,
          borderDashArray: [0, 0],
        }),
        highlight: new this.TMap.PolygonStyle({
          color: 'rgba(74, 144, 217, 0.30)',
          borderColor: '#2B6CB0',
          borderWidth: 3,
          borderDashArray: [0, 0],
        }),
        /** 绘制中的实时预览多边形，使用更低透明度以区分已提交的多边形。 */
        preview: new this.TMap.PolygonStyle({
          color: 'rgba(74, 144, 217, 0.12)',
          borderColor: 'rgba(74, 144, 217, 0.7)',
          borderWidth: 2,
          borderDashArray: [8, 6],
        }),
        /** 隐藏样式：完全透明，用于实现单个多边形的可见性切换。 */
        hidden: new this.TMap.PolygonStyle({
          color: 'rgba(0,0,0,0)',
          borderColor: 'rgba(0,0,0,0)',
          borderWidth: 1,
          borderDashArray: [0, 0],
        }),
      },
      geometries: initialGeometries ?? [],
    })
    this.onPolygonClick = onClickCb
    this.polygonLayer.on('click', (evt: any) => {
      const id: string = evt.geometry?.id
      if (!id) return
      if (id.startsWith('circle-') && this.onCircleClick) {
        this.onCircleClick(id)
        return
      }
      this.onPolygonClick?.(id)
    })
    // 将插件多边形图层提到最高层级，确保点击事件不会
    // 被页面自身的多边形截获
    this.polygonLayer.setZIndex(9999)
    if (onMousedownCb) {
      this.onPolygonMousedown = onMousedownCb
    }
    this._attachMousedownHandler()
  }

  private _closedPath(points: LatLng[]): any[] {
    const closed = [...points]
    const first = closed[0]
    const last = closed[closed.length - 1]
    if (first.lat !== last.lat || first.lng !== last.lng) closed.push(first)
    return closed.map((p) => new this.TMap.LatLng(p.lat, p.lng))
  }

  /**
   * 在地图上添加或更新真实多边形（非预览）。
   * auto-close：自动追加第一个点到末尾以闭合路径。
   */
  addPolygon(id: string, points: LatLng[], onClickCb: (id: string) => void, onMousedownCb?: (id: string, latLng: any) => void): void {
    this.ensurePolygonLayer(onClickCb, onMousedownCb)
    // 强设 mousedown 回调：确保即使 polygonLayer 在预览阶段先创建（丢失了 mousedown 回调），
    // 此处 addPolygon 也会把回调补上。
    if (onMousedownCb) this.setPolygonMousedownHandler(onMousedownCb)

    const path = this._closedPath(points)
    const geometry = { id, styleId: 'default', paths: [path] }

    if (this.polygons.has(id)) {
      this.polygonLayer.updateGeometries([geometry])
    } else {
      this.polygonLayer.add([geometry])
    }
    this.polygons.set(id, [path])
    this.polygonVisible.set(id, true)
  }

  removePolygon(id: string): void {
    if (!this.polygonLayer || !this.polygons.has(id)) return
    this.polygonLayer.remove([id])
    this.polygons.delete(id)
    this.polygonVisible.delete(id)
    if (this.highlightedId === id) this.highlightedId = null
  }

  /** 实时更新多边形路径，用于拖拽过程中的位置预览。不更新 polygons 缓存，由调用方在拖拽结束后调 addPolygon 提交。 */
  updatePolygonPath(id: string, points: LatLng[]): void {
    if (!this.polygonLayer) return
    this.polygonLayer.updateGeometries([{ id, styleId: 'highlight', paths: [this._closedPath(points)] }])
  }

  /**
   * 添加或更新绘制中的预览多边形（使用 preview 样式，不参与高亮/可见性管理）。
   * 预览多边形不写入 polygons / polygonVisible，因此 setPolygonHighlight 会自动跳过它。
   */
  setPreviewPolygon(id: string, points: LatLng[], onClickCb: (id: string) => void, onMousedownCb?: (id: string, latLng: any) => void): void {
    if (points.length < 3) return
    this.ensurePolygonLayer(onClickCb, onMousedownCb)

    const geometry = { id, styleId: 'preview', paths: [this._closedPath(points)] }

    if (this.previewPaths !== null) {
      this.polygonLayer.updateGeometries([geometry])
    } else {
      this.polygonLayer.add([geometry])
    }
    this.previewPaths = []
  }

  /** 移除预览多边形。 */
  removePreviewPolygon(id: string): void {
    if (!this.polygonLayer || this.previewPaths === null) return
    this.polygonLayer.remove([id])
    this.previewPaths = null
  }

  /**
   * 切换多边形高亮：将新 id 设为 highlight，将前一个高亮的多边形恢复 default。
   * 传入 null 则只清除当前高亮。只需更新最多 2 个几何体（O(1)）。
   */
  setPolygonHighlight(id: string | null): void {
    if (!this.polygonLayer || this.polygons.size === 0) return
    const prev = this.highlightedId
    this.highlightedId = id
    const updates: any[] = []
    if (prev !== null && prev !== id) {
      const paths = this.polygons.get(prev)
      if (paths && this.polygonVisible.get(prev) !== false) {
        updates.push({ id: prev, styleId: 'default', paths })
      }
    }
    if (id !== null) {
      const paths = this.polygons.get(id)
      if (paths && this.polygonVisible.get(id) !== false) {
        updates.push({ id, styleId: 'highlight', paths })
      }
    }
    if (updates.length > 0) {
      this.polygonLayer.updateGeometries(updates)
    }
  }

  /**
   * 切换指定多边形的可见性（通过切换 styleId 到 hidden 实现，避免 remove/re-add）。
   */
  setPolygonVisible(id: string, visible: boolean): void {
    if (!this.polygonLayer || !this.polygons.has(id)) return
    this.polygonVisible.set(id, visible)
    const paths = this.polygons.get(id)!
    const styleId = !visible ? 'hidden' : (this.highlightedId === id ? 'highlight' : 'default')
    this.polygonLayer.updateGeometries([{ id, styleId, paths }])
  }

  // ── Rubber band ───────────────────────────────────────────────────────────

  /** 懒初始化橡皮筋线图层（绘制预览专用，样式区别于测量折线）。 */
  private ensureRubberBandLayer() {
    if (this.rubberBandLayer) return
    this.rubberBandLayer = new this.TMap.MultiPolyline({
      id: 'tmap-hooker-rubberband',
      map: this.map,
      styles: {
        default: new this.TMap.PolylineStyle({
          color: '#4A90D9',
          width: 2,
          lineCap: 'butt',
          dashArray: [10, 6],
        }),
      },
      geometries: [],
    })
    this.rubberBandLayer.setZIndex(9996)
  }

  /**
   * 添加或更新橡皮筋预览线。
   * points 为全部已打点 + 鼠标当前位置，至少 2 个点才有效。
   */
  setRubberBand(id: string, points: LatLng[]): void {
    if (points.length < 2) return
    this.ensureRubberBandLayer()
    const path = points.map((p) => new this.TMap.LatLng(p.lat, p.lng))
    this._upsert(this.rubberBandLayer, this.rubberBands, id, { id, styleId: 'default', paths: path })
  }

  removeRubberBand(id: string): void {
    if (!this.rubberBandLayer || !this.rubberBands.has(id)) return
    this.rubberBandLayer.remove([id])
    this.rubberBands.delete(id)
  }

  // ── Point Markers (persistent) ───────────────────────────────────────────

  private ensurePointMarkerLayer(initialGeometries?: any[]) {
    if (this.pointMarkerLayer) {
      if (initialGeometries && initialGeometries.length > 0) {
        this.pointMarkerLayer.add(initialGeometries)
      }
      return
    }
    this.pointMarkerLayer = new this.TMap.MultiMarker({
      id: 'tmap-hooker-point-markers',
      map: this.map,
      styles: {
        default: new this.TMap.MarkerStyle({
          width: 24,
          height: 30,
          anchor: { x: 12, y: 30 },
          src: this._pinDefaultSvg(),
        }),
        highlight: new this.TMap.MarkerStyle({
          width: 24,
          height: 30,
          anchor: { x: 12, y: 30 },
          src: this._pinHighlightSvg(),
        }),
        hidden: new this.TMap.MarkerStyle({
          width: 1,
          height: 1,
          anchor: { x: 0, y: 0 },
          src: this._pinSvg('rgba(0,0,0,0)'),
        }),
      },
      geometries: initialGeometries ?? [],
    })
    this.pointMarkerLayer.setZIndex(9998)
  }

  private ensurePointLabelLayer(initialGeometries?: any[]) {
    if (this.pointLabelLayer) {
      if (initialGeometries && initialGeometries.length > 0) {
        this.pointLabelLayer.add(initialGeometries)
      }
      return
    }
    this.pointLabelLayer = new this.TMap.MultiLabel({
      id: 'tmap-hooker-point-labels',
      map: this.map,
      styles: {
        default: new this.TMap.LabelStyle({
          color: '#4A90D9',
          size: 14,
          angle: 0,
          offset: { x: 0, y: 6 },
        }),
        highlight: new this.TMap.LabelStyle({
          color: '#FF3500',
          size: 14,
          angle: 0,
          offset: { x: 0, y: 6 },
        }),
        hidden: new this.TMap.LabelStyle({
          color: 'rgba(0,0,0,0)',
          size: 1,
          offset: { x: 0, y: 0 },
        }),
      },
      geometries: initialGeometries ?? [],
    })
    this.pointLabelLayer.setZIndex(9997)
  }

  addPointMarker(id: string, latlng: LatLng, name: string): void {
    this.ensurePointMarkerLayer()
    this.ensurePointLabelLayer()
    const pos = new this.TMap.LatLng(latlng.lat, latlng.lng)
    const styleId = this.highlightedPointId === id ? 'highlight' : 'default'

    const markerGeo = { id, styleId, position: pos }
    if (this.pointMarkers.has(id)) {
      this.pointMarkerLayer.updateGeometries([markerGeo])
      this.pointLabelLayer.updateGeometries([{ id, styleId, position: pos, content: name }])
    } else {
      this.pointMarkerLayer.add([markerGeo])
      this.pointLabelLayer.add([{ id, styleId, position: pos, content: name }])
    }
    this.pointMarkers.set(id, latlng)
    this.pointMarkerNames.set(id, name)
    this.pointMarkerVisible.set(id, true)
  }

  removePointMarker(id: string): void {
    if (!this.pointMarkerLayer || !this.pointMarkers.has(id)) return
    this.pointMarkerLayer.remove([id])
    this.pointLabelLayer?.remove([id])
    this.pointMarkers.delete(id)
    this.pointMarkerNames.delete(id)
    this.pointMarkerVisible.delete(id)
    if (this.highlightedPointId === id) this.highlightedPointId = null
  }

  updatePointMarkerName(id: string, name: string): void {
    if (!this.pointLabelLayer || !this.pointMarkers.has(id)) return
    this.pointMarkerNames.set(id, name)
    const latlng = this.pointMarkers.get(id)!
    const pos = new this.TMap.LatLng(latlng.lat, latlng.lng)
    const styleId = !this.pointMarkerVisible.get(id)
      ? 'hidden'
      : this.highlightedPointId === id ? 'highlight' : 'default'
    this.pointLabelLayer.updateGeometries([{ id, styleId, position: pos, content: name }])
  }

  setPointMarkerHighlight(id: string | null): void {
    if (!this.pointMarkerLayer) return
    const prev = this.highlightedPointId
    this.highlightedPointId = id
    const markerUpdates: any[] = []
    const labelUpdates: any[] = []

    if (prev !== null && prev !== id && this.pointMarkers.has(prev)) {
      const latlng = this.pointMarkers.get(prev)!
      const pos = new this.TMap.LatLng(latlng.lat, latlng.lng)
      const visible = this.pointMarkerVisible.get(prev) !== false
      const styleId = visible ? 'default' : 'hidden'
      markerUpdates.push({ id: prev, styleId, position: pos })
      labelUpdates.push({ id: prev, styleId, position: pos, content: this.pointMarkerNames.get(prev) ?? '' })
    }
    if (id !== null && this.pointMarkers.has(id)) {
      const latlng = this.pointMarkers.get(id)!
      const pos = new this.TMap.LatLng(latlng.lat, latlng.lng)
      const visible = this.pointMarkerVisible.get(id) !== false
      const styleId = visible ? 'highlight' : 'hidden'
      markerUpdates.push({ id, styleId, position: pos })
      labelUpdates.push({ id, styleId, position: pos, content: this.pointMarkerNames.get(id) ?? '' })
    }
    if (markerUpdates.length > 0) this.pointMarkerLayer.updateGeometries(markerUpdates)
    if (labelUpdates.length > 0) this.pointLabelLayer?.updateGeometries(labelUpdates)
  }

  setPointMarkerVisible(id: string, visible: boolean): void {
    if (!this.pointMarkerLayer || !this.pointMarkers.has(id)) return
    this.pointMarkerVisible.set(id, visible)
    const latlng = this.pointMarkers.get(id)!
    const pos = new this.TMap.LatLng(latlng.lat, latlng.lng)
    const styleId = !visible ? 'hidden' : (this.highlightedPointId === id ? 'highlight' : 'default')
    this.pointMarkerLayer.updateGeometries([{ id, styleId, position: pos }])
    if (this.pointLabelLayer) {
      const name = this.pointMarkerNames.get(id) ?? ''
      this.pointLabelLayer.updateGeometries([{ id, styleId, position: pos, content: name }])
    }
  }

  // ── Measure layers (persistent) ────────────────────────────────────────────

  private ensureMeasurePolylineLayer() {
    if (this.measurePolylineLayer) return
    this.measurePolylineLayer = new this.TMap.MultiPolyline({
      id: 'tmap-hooker-measure-lines',
      map: this.map,
      styles: {
        default: new this.TMap.PolylineStyle({
          color: '#4A90D9',
          width: 2,
          lineCap: 'butt',
          dashArray: [10, 6],
        }),
        highlight: new this.TMap.PolylineStyle({
          color: '#2B6CB0',
          width: 3,
          lineCap: 'butt',
          dashArray: [0, 0],
        }),
        hidden: new this.TMap.PolylineStyle({
          color: 'rgba(0,0,0,0)',
          width: 1,
          dashArray: [0, 0],
        }),
      },
      geometries: [],
    })
    this.measurePolylineLayer.setZIndex(9995)
    this.measurePolylineLayer.on('click', (evt: any) => {
      const id: string = evt.geometry?.id
      if (id) this.onMeasureClick?.(id)
    })
  }

  private ensureMeasureMarkerLayer() {
    if (this.measureMarkerLayer) return
    this.measureMarkerLayer = new this.TMap.MultiMarker({
      id: 'tmap-hooker-measure-markers',
      map: this.map,
      styles: {
        default: new this.TMap.MarkerStyle({
          width: 14,
          height: 14,
          anchor: { x: 7, y: 7 },
          src: this._hollowCircleSvg(),
        }),
        hidden: new this.TMap.MarkerStyle({
          width: 1,
          height: 1,
          anchor: { x: 0, y: 0 },
          src: this._pinSvg('rgba(0,0,0,0)'),
        }),
      },
      geometries: [],
    })
    this.measureMarkerLayer.setZIndex(9994)
  }

  /** 新建或更新一条测距图层（折线 + 顶点标记 + 距离标签）。 */
  addMeasure(
    id: string,
    points: LatLng[],
    segmentDistances: number[],
    onClickCb: (id: string) => void,
  ): void {
    if (points.length < 2) return
    this.onMeasureClick = onClickCb
    this.ensureMeasurePolylineLayer()
    this.ensureMeasureMarkerLayer()

    const path = points.map((p) => new this.TMap.LatLng(p.lat, p.lng))
    const styleId = this.highlightedMeasureId === id ? 'highlight' : 'default'
    const isUpdate = this.measures.has(id)
    const oldPoints = isUpdate ? this.measures.get(id)! : null

    // 折线：所有点连成一条
    const lineGeo = { id, styleId, paths: [path] }
    if (isUpdate) {
      this.measurePolylineLayer.updateGeometries([lineGeo])
    } else {
      this.measurePolylineLayer.add([lineGeo])
    }

    this.measures.set(id, [...points])
    this.measureVisible.set(id, true)

    // 添加顶点标记
    const markerGeos = points.map((p, i) => ({
      id: `${id}-v-${i}`,
      styleId: 'default',
      position: new this.TMap.LatLng(p.lat, p.lng),
    }))
    if (this.measureMarkerLayer) {
      if (isUpdate && oldPoints) {
        // 移除旧的顶点标记（按旧的顶点数）
        const oldIds = oldPoints.map((_p: LatLng, i: number) => `${id}-v-${i}`)
        this.measureMarkerLayer.remove(oldIds)
      }
      this.measureMarkerLayer.add(markerGeos)
    }

    // 距离标签：每段中点
    this._updateMeasureLabels(id, points, segmentDistances)
  }

  /** 更新测距距离标签。 */
  private _updateMeasureLabels(id: string, points: LatLng[], segmentDistances: number[]): void {
    this._destroyMeasureLabels(id)
    const labels: any[] = []
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]
      const b = points[i + 1]
      const midLat = (a.lat + b.lat) / 2
      const midLng = (a.lng + b.lng) / 2
      const dist = segmentDistances[i] ?? 0
      let text: string
      if (dist >= 1000) {
        text = `${(dist / 1000).toFixed(2)} km`
      } else {
        text = `${Math.round(dist)} m`
      }
      const svg = this._labelCardSvg(text)
      const w = this._labelCardWidth(text)
      const labelLayer = new this.TMap.MultiMarker({
        map: this.map,
        styles: {
          default: new this.TMap.MarkerStyle({
            width: w,
            height: 24,
            anchor: { x: Math.round(w / 2), y: 30 },
            src: svg,
          }),
        },
        geometries: [{
          id: `${id}-label-${i}`,
          styleId: 'default',
          position: new this.TMap.LatLng(midLat, midLng),
        }],
      })
      labels.push(labelLayer)
    }
    this.measureLabelMarkers.set(id, labels)
  }

  /** 销毁某条测距的所有标签。 */
  private _destroyMeasureLabels(id: string): void {
    const labels = this.measureLabelMarkers.get(id)
    if (!labels) return
    for (const l of labels) l.setMap(null)
    this.measureLabelMarkers.delete(id)
  }

  /** 移除测距图层。 */
  removeMeasure(id: string): void {
    if (!this.measures.has(id)) return
    if (this.measurePolylineLayer) {
      this.measurePolylineLayer.remove([id])
    }
    if (this.measureMarkerLayer) {
      const points = this.measures.get(id)!
      const ids = points.map((_, i) => `${id}-v-${i}`)
      this.measureMarkerLayer.remove(ids)
    }
    this._destroyMeasureLabels(id)
    this.measures.delete(id)
    this.measureVisible.delete(id)
    if (this.highlightedMeasureId === id) this.highlightedMeasureId = null
  }

  /** 切换测距可见性。 */
  setMeasureVisible(id: string, visible: boolean): void {
    if (!this.measurePolylineLayer || !this.measures.has(id)) return
    this.measureVisible.set(id, visible)
    const points = this.measures.get(id)!
    const path = points.map((p) => new this.TMap.LatLng(p.lat, p.lng))
    const lineStyle = !visible ? 'hidden'
      : (this.highlightedMeasureId === id ? 'highlight' : 'default')
    this.measurePolylineLayer.updateGeometries([{ id, styleId: lineStyle, paths: [path] }])

    const markerStyle = visible ? 'default' : 'hidden'
    if (this.measureMarkerLayer) {
      const markerGeos = points.map((p, i) => ({
        id: `${id}-v-${i}`,
        styleId: markerStyle,
        position: new this.TMap.LatLng(p.lat, p.lng),
      }))
      this.measureMarkerLayer.updateGeometries(markerGeos)
    }

    // 标签：显隐通过 setMap
    const labels = this.measureLabelMarkers.get(id)
    if (labels) {
      for (const l of labels) {
        if (visible) l.setMap(this.map)
        else l.setMap(null)
      }
    }
  }

  /** 切换测距高亮。 */
  setMeasureHighlight(id: string | null): void {
    const prev = this.highlightedMeasureId
    this.highlightedMeasureId = id

    const lineUpdates: any[] = []
    if (prev !== null && prev !== id && this.measures.has(prev) && this.measureVisible.get(prev) !== false) {
      const pts = this.measures.get(prev)!
      lineUpdates.push({ id: prev, styleId: 'default', paths: [pts.map((p: LatLng) => new this.TMap.LatLng(p.lat, p.lng))] })
    }
    if (id !== null && this.measures.has(id) && this.measureVisible.get(id) !== false) {
      const pts = this.measures.get(id)!
      lineUpdates.push({ id, styleId: 'highlight', paths: [pts.map((p: LatLng) => new this.TMap.LatLng(p.lat, p.lng))] })
    }
    if (lineUpdates.length > 0 && this.measurePolylineLayer) {
      this.measurePolylineLayer.updateGeometries(lineUpdates)
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** 销毁测量图层（标记、折线、标签）并清空对应 track Map。clearAll 和 clearMeasurement 的共同实现。 */
  private _destroyMeasurementLayers(): void {
    if (this.markerLayer) {
      this.markerLayer.setMap(null)
      this.markerLayer = null
      this.markers.clear()
    }
    if (this.polylineLayer) {
      this.polylineLayer.setMap(null)
      this.polylineLayer = null
      this.polylines.clear()
    }
    for (const marker of this.labelMarkers.values()) {
      marker.setMap(null)
    }
    this.labelMarkers.clear()
  }

  clearAll(): void {
    this._destroyMeasurementLayers()
    if (this.rubberBandLayer) {
      this.rubberBandLayer.setMap(null)
      this.rubberBandLayer = null
      this.rubberBands.clear()
    }
    if (this.polygonLayer) {
      this.polygonLayer.setMap(null)
      this.polygonLayer = null
      this.polygons.clear()
      this.polygonVisible.clear()
      this.previewPaths = null
      this.highlightedId = null
      this.onPolygonClick = null
    }
    if (this.pointMarkerLayer) {
      this.pointMarkerLayer.setMap(null)
      this.pointMarkerLayer = null
      this.pointMarkers.clear()
      this.pointMarkerNames.clear()
      this.pointMarkerVisible.clear()
      this.highlightedPointId = null
    }
    if (this.pointLabelLayer) {
      this.pointLabelLayer.setMap(null)
      this.pointLabelLayer = null
    }
    // 测距图层清理
    if (this.measurePolylineLayer) {
      this.measurePolylineLayer.setMap(null)
      this.measurePolylineLayer = null
    }
    if (this.measureMarkerLayer) {
      this.measureMarkerLayer.setMap(null)
      this.measureMarkerLayer = null
    }
    for (const labels of this.measureLabelMarkers.values()) {
      for (const l of labels) l.setMap(null)
    }
    this.measureLabelMarkers.clear()
    this.measures.clear()
    this.measureVisible.clear()
    this.highlightedMeasureId = null
  }

  /**
   * 只清除测量覆盖物（标记、折线、标签），保留多边形图层和橡皮筋线。
   * 用于工具切换时：多边形是用户持久内容，测量覆盖物是临时的。
   */
  clearMeasurement(): void {
    this._destroyMeasurementLayers()
  }

  // ── Snapshot / Restore ────────────────────────────────────────────────────

  /**
   * 导出所有持久覆盖物数据为可序列化快照。
   * 用于 SPA 页面切换前保存数据，切换后通过 restoreSnapshot() 恢复。
   */
  snapshot(): OverlaySnapshotItem {
    return {
      polygons: Array.from(this.polygons.entries()).map(([id, paths]) => ({
        id,
        points: (paths[0] ?? []).map((p: any) => ({ lat: p.lat, lng: p.lng })),
        visible: this.polygonVisible.get(id) ?? true,
      })),
      pointMarkers: Array.from(this.pointMarkers.entries()).map(([id, latlng]) => ({
        id,
        lat: latlng.lat,
        lng: latlng.lng,
        name: this.pointMarkerNames.get(id) ?? '',
        visible: this.pointMarkerVisible.get(id) ?? true,
      })),
      measures: Array.from(this.measures.entries()).map(([id, points]) => ({
        id,
        points: points.map((p: LatLng) => ({ lat: p.lat, lng: p.lng })),
        visible: this.measureVisible.get(id) ?? true,
      })),
      circles: [],
    }
  }

  /**
   * 从快照恢复所有持久覆盖物数据到当前地图。
   */
  restore(
    data: OverlaySnapshotItem,
    polygonClickCb: (id: string) => void,
    polygonMousedownCb?: (id: string, latLng: any) => void,
    measureClickCb?: (id: string) => void,
  ): void {
    // 恢复多边形——将几何体通过 initialGeometries 传入构造器，
    // 避免地图未就绪时 add() 不渲染的问题。
    if (data.polygons.length > 0) {
      const geos = data.polygons.map((poly) => {
        const path = this._closedPath(poly.points)
        this.polygons.set(poly.id, [path])
        this.polygonVisible.set(poly.id, poly.visible)
        return { id: poly.id, styleId: poly.visible ? 'default' : 'hidden', paths: [path] }
      })
      this.ensurePolygonLayer(polygonClickCb, polygonMousedownCb, geos)
    }
    // 恢复点位
    if (data.pointMarkers.length > 0) {
      const sorted = [...data.pointMarkers].sort((a, b) => a.id.localeCompare(b.id))
      const markerGeos: any[] = []
      const labelGeos: any[] = []
      for (const pm of sorted) {
        const pos = new this.TMap.LatLng(pm.lat, pm.lng)
        const styleId = pm.visible ? 'default' : 'hidden'
        this.pointMarkers.set(pm.id, { lat: pm.lat, lng: pm.lng })
        this.pointMarkerNames.set(pm.id, pm.name)
        this.pointMarkerVisible.set(pm.id, pm.visible)
        markerGeos.push({ id: pm.id, styleId, position: pos })
        labelGeos.push({ id: pm.id, styleId, position: pos, content: pm.name })
      }
      this.ensurePointMarkerLayer(markerGeos)
      this.ensurePointLabelLayer(labelGeos)
    }
    // 恢复测距
    if (data.measures && data.measures.length > 0) {
      for (const m of data.measures) {
        if (m.points.length < 2) continue
        // 计算段距离
        const segDists: number[] = []
        for (let i = 0; i < m.points.length - 1; i++) {
          const a = m.points[i]
          const b = m.points[i + 1]
          const R = 6371000
          const dLat = (b.lat - a.lat) * Math.PI / 180
          const dLng = (b.lng - a.lng) * Math.PI / 180
          const lat1 = a.lat * Math.PI / 180
          const lat2 = b.lat * Math.PI / 180
          const sinDLat = Math.sin(dLat / 2)
          const sinDLng = Math.sin(dLng / 2)
          const a2 = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng
          segDists.push(R * 2 * Math.atan2(Math.sqrt(a2), Math.sqrt(1 - a2)))
        }
        this.addMeasure(m.id, m.points, segDists, measureClickCb ?? (() => {}))
        if (!m.visible) this.setMeasureVisible(m.id, false)
      }
    }
  }

  /** 从地图移除所有图层（不清除数据），用于地图实例销毁前的清理。 */
  detachFromMap(): void {
    const layers: any[] = [
      this.markerLayer, this.polylineLayer,
      this.polygonLayer, this.rubberBandLayer,
      this.pointMarkerLayer, this.pointLabelLayer,
      this.measurePolylineLayer, this.measureMarkerLayer,
    ]
    for (const layer of layers) {
      if (layer) layer.setMap(null)
    }
    for (const marker of this.labelMarkers.values()) {
      marker.setMap(null)
    }
    for (const labels of this.measureLabelMarkers.values()) {
      for (const l of labels) l.setMap(null)
    }
  }

  /** 获取多边形图层引用（供 CircleTool 等注册直连事件）。 */
  getPolygonLayer(): any { return this.polygonLayer }

  /** 设置圆形专有点击回调（由 CircleTool 注册）。 */
  setCircleClickHandler(cb: (id: string) => void): void { this.onCircleClick = cb }

  /** 设置圆形专有 mousedown 回调（由 CircleTool 注册，用于拖拽移动）。 */
  setCircleMousedownHandler(cb: (id: string, latLng: any) => void): void {
    this.onCircleMousedown = cb
    this._attachMousedownHandler()
  }

  /** 设置多边形专有 mousedown 回调（由 PolygonTool 注册，用于拖拽移动）。 */
  setPolygonMousedownHandler(cb: (id: string, latLng: any) => void): void {
    this.onPolygonMousedown = cb
    this._attachMousedownHandler()
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** 测距距离标签：白底圆角卡片 + 深灰文字，匹配 MeasureTool 官方样式。 */
  private _labelCardSvg(text: string): string {
    const w = this._labelCardWidth(text)
    const h = 22
    // SVG 白底圆角矩形 + 文字
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="4" fill="#FFFFFF" stroke="#CCCCCC" stroke-width="1"/>
      <text x="${Math.round(w / 2)}" y="15" text-anchor="middle" fill="#333333" font-size="11" font-family="sans-serif">${this._xmlEscape(text)}</text>
    </svg>`
    return `data:image/svg+xml;base64,${btoa(svg)}`
  }

  /** 估算标签文本宽度，用于生成合适尺寸的 SVG。中文约 12px，英文/数字约 7px。 */
  private _labelCardWidth(text: string): number {
    let w = 0
    for (const ch of text) {
      w += /[\u4e00-\u9fff]/.test(ch) ? 12 : 7
    }
    return w + 16  // + 左右 padding
  }

  /** 转义 XML 特殊字符，防止 SVG 注入。 */
  private _xmlEscape(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  /** 测距标记：蓝色空心圆，匹配 TMap MeasureTool 官方样式。 */
  private _hollowCircleSvg(): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">
      <circle cx="7" cy="7" r="5" fill="#FFFFFF" stroke="#4A90D9" stroke-width="2"/>
    </svg>`
    return `data:image/svg+xml;base64,${btoa(svg)}`
  }

  private _markerSvg(label: string): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
      <circle cx="11" cy="11" r="9" fill="#FF6B35" stroke="#fff" stroke-width="2"/>
      <text x="11" y="15" text-anchor="middle" fill="#fff" font-size="10" font-family="sans-serif" font-weight="bold">${label}</text>
    </svg>`
    return `data:image/svg+xml;base64,${btoa(svg)}`
  }

  /** 未选中点位图标：亮蓝色大图钉。 */
  private _pinDefaultSvg(): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="30" viewBox="0 0 24 30">
      <path d="M12 0C6.48 0 2 4.48 2 10c0 7 10 20 10 20S22 17 22 10c0-5.52-4.48-10-10-10z" fill="#4488FF" stroke="#fff" stroke-width="1.5"/>
      <circle cx="12" cy="10" r="4" fill="#fff" opacity="0.9"/>
    </svg>`
    return `data:image/svg+xml;base64,${btoa(svg)}`
  }

  /** 选中点位图标：红色大图钉 + 红色光晕，醒目突出。 */
  private _pinHighlightSvg(): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="30" viewBox="0 0 24 30">
      <defs>
        <filter id="glow" x="-50%" y="-20%" width="200%" height="150%">
          <feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#FF3500" flood-opacity="0.5"/>
        </filter>
      </defs>
      <path d="M12 0C6.48 0 2 4.48 2 10c0 7 10 20 10 20S22 17 22 10c0-5.52-4.48-10-10-10z" fill="#FF3500" stroke="#fff" stroke-width="2" filter="url(#glow)"/>
      <circle cx="12" cy="10" r="4" fill="#fff" opacity="0.95"/>
    </svg>`
    return `data:image/svg+xml;base64,${btoa(svg)}`
  }

  private _pinSvg(color: string): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="30" viewBox="0 0 24 30">
      <path d="M12 0C6.48 0 2 4.48 2 10c0 7 10 20 10 20S22 17 22 10c0-5.52-4.48-10-10-10z" fill="${color}" stroke="#fff" stroke-width="1.5"/>
      <circle cx="12" cy="10" r="4" fill="#fff" opacity="0.9"/>
    </svg>`
    return `data:image/svg+xml;base64,${btoa(svg)}`
  }
}

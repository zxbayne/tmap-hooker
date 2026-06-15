import type { LatLng } from '@shared/utils/parse-coords'
import type { OverlaySnapshotItem } from '@shared/protocol'

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
  private labelLayer: any = null
  private polygonLayer: any = null
  private rubberBandLayer: any = null
  /** 持久点位图层（不被 clearMeasurement 清除）。 */
  private pointMarkerLayer: any = null
  private pointLabelLayer: any = null

  /** 已添加的标记 id 集合，用于区分 add 和 update 操作。 */
  private markers: Map<string, boolean> = new Map()
  private polylines: Map<string, boolean> = new Map()
  private labels: Map<string, boolean> = new Map()
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
          width: 22,
          height: 22,
          anchor: { x: 11, y: 11 },
          src: this._markerSvg(''),
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
          color: '#FF6B35',
          width: 3,
          borderWidth: 1,
          borderColor: '#ffffff',
          lineCap: 'round',
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

  // ── Labels ────────────────────────────────────────────────────────────────

  private ensureLabelLayer() {
    if (this.labelLayer) return
    const base = {
      color: 'rgb(238, 117, 45)',
      size: 12,
      angle: 0,
      background: true,
      backgroundColor: 'rgba(20, 20, 40, 0.85)',
      borderRadius: 4,
    }
    this.labelLayer = new this.TMap.MultiLabel({
      id: 'tmap-hooker-labels',
      map: this.map,
      styles: {
        // E-W 线段 → 标签在正上方
        'label-up':        new this.TMap.LabelStyle({ ...base, offset: { x: 0,   y: -28 } }),
        // N-S 线段 → 标签在正右方
        'label-right':     new this.TMap.LabelStyle({ ...base, offset: { x: 30,  y:   0 } }),
        // NE-SW 线段 → 标签在左上方（垂直于线段）
        'label-up-left':   new this.TMap.LabelStyle({ ...base, offset: { x: -20, y: -20 } }),
        // NW-SE 线段 → 标签在右上方（垂直于线段）
        'label-up-right':  new this.TMap.LabelStyle({ ...base, offset: { x: 20,  y: -20 } }),
      },
      geometries: [],
    })
  }

  addLabel(id: string, latlng: LatLng, text: string, styleId = 'default'): void {
    this.ensureLabelLayer()
    const geometry = {
      id,
      styleId,
      position: new this.TMap.LatLng(latlng.lat, latlng.lng),
      content: text,
    }
    this._upsert(this.labelLayer, this.labels, id, geometry)
  }

  removeLabel(id: string): void {
    if (!this.labelLayer || !this.labels.has(id)) return
    this.labelLayer.remove([id])
    this.labels.delete(id)
  }

  // ── Polygons ──────────────────────────────────────────────────────────────

  private _attachMousedownHandler(): void {
    this.polygonLayer.on('mousedown', (evt: any) => {
      const id: string = evt.geometry?.id
      if (id) {
        evt.originalEvent?.stopPropagation()
        this.onPolygonMousedown?.(id, evt.latLng)
      }
    })
  }

  private ensurePolygonLayer(onClickCb: (id: string) => void, onMousedownCb?: (id: string, latLng: any) => void) {
    if (this.polygonLayer) {
      if (onMousedownCb && !this.onPolygonMousedown) {
        this.onPolygonMousedown = onMousedownCb
        this._attachMousedownHandler()
      }
      return
    }
    this.polygonLayer = new this.TMap.MultiPolygon({
      id: 'tmap-hooker-polygons',
      map: this.map,
      styles: {
        default: new this.TMap.PolygonStyle({
          color: 'rgba(255, 107, 53, 0.2)',
          borderColor: '#FF6B35',
          borderWidth: 2,
          borderDashArray: [0, 0],
        }),
        highlight: new this.TMap.PolygonStyle({
          color: 'rgba(255, 53, 0, 0.35)',
          borderColor: '#FF3500',
          borderWidth: 3,
          borderDashArray: [0, 0],
        }),
        /** 绘制中的实时预览多边形，使用更低透明度以区分已提交的多边形。 */
        preview: new this.TMap.PolygonStyle({
          color: 'rgba(255, 107, 53, 0.08)',
          borderColor: 'rgba(255, 107, 53, 0.55)',
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
      geometries: [],
    })
    this.onPolygonClick = onClickCb
    this.polygonLayer.on('click', (evt: any) => {
      const id: string = evt.geometry?.id
      if (id) this.onPolygonClick?.(id)
    })
    // 将插件多边形图层提到最高层级，确保点击事件不会
    // 被页面自身的多边形截获
    this.polygonLayer.setZIndex(9999)
    if (onMousedownCb) {
      this.onPolygonMousedown = onMousedownCb
      this._attachMousedownHandler()
    }
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
          color: 'rgba(255, 107, 53, 0.55)',
          width: 2,
          borderWidth: 1,
          borderColor: 'rgba(255, 107, 53, 0.2)',
          lineCap: 'round',
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

  private ensurePointMarkerLayer() {
    if (this.pointMarkerLayer) return
    this.pointMarkerLayer = new this.TMap.MultiMarker({
      id: 'tmap-hooker-point-markers',
      map: this.map,
      styles: {
        default: new this.TMap.MarkerStyle({
          width: 24,
          height: 30,
          anchor: { x: 12, y: 30 },
          src: this._pinSvg('#FF6B35'),
        }),
        highlight: new this.TMap.MarkerStyle({
          width: 24,
          height: 30,
          anchor: { x: 12, y: 30 },
          src: this._pinSvg('#FF3500'),
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
    this.pointMarkerLayer.setZIndex(9998)
  }

  private ensurePointLabelLayer() {
    if (this.pointLabelLayer) return
    this.pointLabelLayer = new this.TMap.MultiLabel({
      id: 'tmap-hooker-point-labels',
      map: this.map,
      styles: {
        default: new this.TMap.LabelStyle({
          color: '#FF6B35',
          size: 12,
          angle: 0,
          background: true,
          backgroundColor: 'rgba(20, 20, 40, 0.85)',
          borderRadius: 4,
          offset: { x: 0, y: 6 },
        }),
        highlight: new this.TMap.LabelStyle({
          color: '#FF3500',
          size: 12,
          angle: 0,
          background: true,
          backgroundColor: 'rgba(20, 20, 40, 0.92)',
          borderRadius: 4,
          offset: { x: 0, y: 6 },
        }),
        hidden: new this.TMap.LabelStyle({
          color: 'rgba(0,0,0,0)',
          size: 1,
          background: false,
          offset: { x: 0, y: 0 },
        }),
      },
      geometries: [],
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
    if (this.labelLayer) {
      this.labelLayer.setMap(null)
      this.labelLayer = null
      this.labels.clear()
    }
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
    }
  }

  /**
   * 从快照恢复所有持久覆盖物数据到当前地图。
   * 直接操作底层图层，不依赖工具回调——适合在工具未激活时批量重建。
   */
  restore(
    data: OverlaySnapshotItem,
    polygonClickCb: (id: string) => void,
    polygonMousedownCb?: (id: string, latLng: any) => void,
  ): void {
    // 恢复多边形
    if (data.polygons.length > 0) {
      this.ensurePolygonLayer(polygonClickCb, polygonMousedownCb)
      const geos = data.polygons.map((poly) => {
        const path = this._closedPath(poly.points)
        this.polygons.set(poly.id, [path])
        this.polygonVisible.set(poly.id, poly.visible)
        return { id: poly.id, styleId: poly.visible ? 'default' : 'hidden', paths: [path] }
      })
      this.polygonLayer.add(geos)
    }
    // 恢复点位（按 id 排序确保 counter 逻辑一致）
    if (data.pointMarkers.length > 0) {
      this.ensurePointMarkerLayer()
      this.ensurePointLabelLayer()
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
      this.pointMarkerLayer.add(markerGeos)
      this.pointLabelLayer.add(labelGeos)
    }
  }

  /** 从地图移除所有图层（不清除数据），用于地图实例销毁前的清理。 */
  detachFromMap(): void {
    const layers: any[] = [
      this.markerLayer, this.polylineLayer, this.labelLayer,
      this.polygonLayer, this.rubberBandLayer,
      this.pointMarkerLayer, this.pointLabelLayer,
    ]
    for (const layer of layers) {
      if (layer) layer.setMap(null)
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _markerSvg(label: string): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
      <circle cx="11" cy="11" r="9" fill="#FF6B35" stroke="#fff" stroke-width="2"/>
      <text x="11" y="15" text-anchor="middle" fill="#fff" font-size="10" font-family="sans-serif" font-weight="bold">${label}</text>
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

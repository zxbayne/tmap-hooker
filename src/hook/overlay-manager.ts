import type { LatLng } from './tools/types'

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

  /** 每个真实多边形的可见状态（true = 可见，false = 隐藏）。 */
  private polygonVisible: Map<string, boolean> = new Map()
  /** 当前高亮的多边形 id，供 setPolygonVisible 判断应还原为何种样式。 */
  private highlightedId: string | null = null

  /** 多边形点击时的回调，注册在图层级别（非单个几何体），通过 evt.geometry.id 区分。 */
  private onPolygonClick: ((id: string) => void) | null = null

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

  addMarker(id: string, latlng: LatLng, label = ''): void {
    this.ensureMarkerLayer()
    const geometry = {
      id,
      styleId: 'default',
      position: new this.TMap.LatLng(latlng.lat, latlng.lng),
    }
    if (this.markers.has(id)) {
      this.markerLayer.updateGeometries([geometry])
    } else {
      this.markerLayer.add([geometry])
      this.markers.set(id, true)
    }
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
    const geometry = { id, styleId: 'default', paths: path }
    if (this.polylines.has(id)) {
      this.polylineLayer.updateGeometries([geometry])
    } else {
      this.polylineLayer.add([geometry])
      this.polylines.set(id, true)
    }
  }

  removePolyline(id: string): void {
    if (!this.polylineLayer || !this.polylines.has(id)) return
    this.polylineLayer.remove([id])
    this.polylines.delete(id)
  }

  // ── Labels ────────────────────────────────────────────────────────────────

  private ensureLabelLayer() {
    if (this.labelLayer) return
    this.labelLayer = new this.TMap.MultiLabel({
      id: 'tmap-hooker-labels',
      map: this.map,
      styles: {
        default: new this.TMap.LabelStyle({
          color: 'rgb(238, 117, 45)',
          size: 12,
          offset: { x: 0, y: -16 },
          angle: 0,
          background: true,
          backgroundColor: 'rgba(20, 20, 40, 0.85)',
          borderRadius: 4,
        }),
      },
      geometries: [],
    })
  }

  addLabel(id: string, latlng: LatLng, text: string): void {
    this.ensureLabelLayer()
    const geometry = {
      id,
      styleId: 'default',
      position: new this.TMap.LatLng(latlng.lat, latlng.lng),
      content: text,
    }
    if (this.labels.has(id)) {
      this.labelLayer.updateGeometries([geometry])
    } else {
      this.labelLayer.add([geometry])
      this.labels.set(id, true)
    }
  }

  removeLabel(id: string): void {
    if (!this.labelLayer || !this.labels.has(id)) return
    this.labelLayer.remove([id])
    this.labels.delete(id)
  }

  // ── Polygons ──────────────────────────────────────────────────────────────

  private ensurePolygonLayer(onClickCb: (id: string) => void) {
    if (this.polygonLayer) return
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
  }

  /**
   * 在地图上添加或更新真实多边形（非预览）。
   * auto-close：自动追加第一个点到末尾以闭合路径。
   */
  addPolygon(id: string, points: LatLng[], onClickCb: (id: string) => void): void {
    this.ensurePolygonLayer(onClickCb)

    const closed = [...points]
    const first = closed[0]
    const last = closed[closed.length - 1]
    if (first.lat !== last.lat || first.lng !== last.lng) {
      closed.push(first)
    }

    const path = closed.map((p) => new this.TMap.LatLng(p.lat, p.lng))
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

  /**
   * 添加或更新绘制中的预览多边形（使用 preview 样式，不参与高亮/可见性管理）。
   * 预览多边形不写入 polygons / polygonVisible，因此 setPolygonHighlight 会自动跳过它。
   */
  setPreviewPolygon(id: string, points: LatLng[], onClickCb: (id: string) => void): void {
    if (points.length < 3) return
    this.ensurePolygonLayer(onClickCb)

    const closed = [...points]
    const first = closed[0]
    const last = closed[closed.length - 1]
    if (first.lat !== last.lat || first.lng !== last.lng) {
      closed.push(first)
    }
    const path = closed.map((p) => new this.TMap.LatLng(p.lat, p.lng))
    const geometry = { id, styleId: 'preview', paths: [path] }

    if (this.previewPaths !== null) {
      this.polygonLayer.updateGeometries([geometry])
    } else {
      this.polygonLayer.add([geometry])
    }
    this.previewPaths = [path]
  }

  /** 移除预览多边形。 */
  removePreviewPolygon(id: string): void {
    if (!this.polygonLayer || this.previewPaths === null) return
    this.polygonLayer.remove([id])
    this.previewPaths = null
  }

  /**
   * 切换多边形高亮：将 id 对应的多边形设为 highlight，其余可见多边形恢复 default。
   * 传入 null 则取消所有高亮。预览多边形和隐藏多边形不受影响。
   */
  setPolygonHighlight(id: string | null): void {
    if (!this.polygonLayer || this.polygons.size === 0) return
    this.highlightedId = id
    const updates: any[] = []
    for (const [pid, paths] of this.polygons.entries()) {
      if (this.polygonVisible.get(pid) === false) continue
      updates.push({ id: pid, styleId: pid === id ? 'highlight' : 'default', paths })
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
  }

  /**
   * 添加或更新橡皮筋预览线。
   * points 为全部已打点 + 鼠标当前位置，至少 2 个点才有效。
   */
  setRubberBand(id: string, points: LatLng[]): void {
    if (points.length < 2) return
    this.ensureRubberBandLayer()
    const path = points.map((p) => new this.TMap.LatLng(p.lat, p.lng))
    const geometry = { id, styleId: 'default', paths: path }
    if (this.rubberBands.has(id)) {
      this.rubberBandLayer.updateGeometries([geometry])
    } else {
      this.rubberBandLayer.add([geometry])
      this.rubberBands.set(id, true)
    }
  }

  removeRubberBand(id: string): void {
    if (!this.rubberBandLayer || !this.rubberBands.has(id)) return
    this.rubberBandLayer.remove([id])
    this.rubberBands.delete(id)
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  clearAll(): void {
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
  }

  /**
   * 只清除测量覆盖物（标记、折线、标签），保留多边形图层和橡皮筋线。
   * 用于工具切换时：多边形是用户持久内容，测量覆盖物是临时的。
   */
  clearMeasurement(): void {
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

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _markerSvg(label: string): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
      <circle cx="11" cy="11" r="9" fill="#FF6B35" stroke="#fff" stroke-width="2"/>
      <text x="11" y="15" text-anchor="middle" fill="#fff" font-size="10" font-family="sans-serif" font-weight="bold">${label}</text>
    </svg>`
    return `data:image/svg+xml;base64,${btoa(svg)}`
  }
}

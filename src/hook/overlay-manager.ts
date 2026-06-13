import type { LatLng } from './tools/types'

/**
 * 管理地图上所有覆盖物图层（标记、折线、标签、多边形）。
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
  /** 已添加的标记 id 集合，用于区分 add 和 update 操作。 */
  private markers: Map<string, boolean> = new Map()
  private polylines: Map<string, boolean> = new Map()
  private labels: Map<string, boolean> = new Map()
  private polygons: Map<string, boolean> = new Map()

  /** 多边形点击时的回调，注册在图层级别（非单个几何体），通过 evt.geometry.id 区分。 */
  private onPolygonClick: ((id: string) => void) | null = null

  constructor(map: any, TMap: any) {
    this.map = map
    this.TMap = TMap
  }

  // ── Markers ──────────────────────────────────────────────────────────────

  /** 懒初始化标记图层，首次添加标记时调用。 */
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

  /**
   * 添加或更新指定 id 的标记。
   * 若该 id 已存在则调用 updateGeometries，否则调用 add。
   */
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

  /** 从图层移除指定 id 的标记。 */
  removeMarker(id: string): void {
    if (!this.markerLayer || !this.markers.has(id)) return
    this.markerLayer.remove([id])
    this.markers.delete(id)
  }

  // ── Polylines ─────────────────────────────────────────────────────────────

  /** 懒初始化折线图层，首次添加折线时调用。 */
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

  /**
   * 设置指定 id 的折线路径（至少需要 2 个点）。
   * 用于测量工具绘制两点连线或多点折线的各段。
   */
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

  /** 从图层移除指定 id 的折线。 */
  removePolyline(id: string): void {
    if (!this.polylineLayer || !this.polylines.has(id)) return
    this.polylineLayer.remove([id])
    this.polylines.delete(id)
  }

  // ── Labels ────────────────────────────────────────────────────────────────

  /** 懒初始化标签图层，首次添加标签时调用。 */
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
          padding: '2 6',
        }),
      },
      geometries: [],
    })
  }

  /** 在指定位置添加或更新距离标签文本。 */
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

  /** 从图层移除指定 id 的标签。 */
  removeLabel(id: string): void {
    if (!this.labelLayer || !this.labels.has(id)) return
    this.labelLayer.remove([id])
    this.labels.delete(id)
  }

  // ── Polygons ──────────────────────────────────────────────────────────────

  /**
   * 懒初始化多边形图层，并绑定点击事件监听器。
   * 点击事件在图层级别注册（而非单个几何体），通过 evt.geometry.id 路由到具体的多边形。
   */
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
   * 在地图上添加或更新多边形。
   * auto-close：TMap.MultiPolygon 要求 paths 数组的首尾坐标相同才能渲染闭合图形，
   * 此方法自动追加第一个点到末尾，调用方无需手动处理。
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
      this.polygons.set(id, true)
    }
  }

  /** 从图层移除指定 id 的多边形。 */
  removePolygon(id: string): void {
    if (!this.polygonLayer || !this.polygons.has(id)) return
    this.polygonLayer.remove([id])
    this.polygons.delete(id)
  }

  /**
   * 切换多边形高亮状态：将 id 对应的多边形设为 highlight 样式，其余恢复为 default。
   * 传入 null 则取消所有高亮。
   */
  setPolygonHighlight(id: string | null): void {
    if (!this.polygonLayer || this.polygons.size === 0) return
    const updates: any[] = []
    for (const pid of this.polygons.keys()) {
      updates.push({ id: pid, styleId: pid === id ? 'highlight' : 'default' })
    }
    this.polygonLayer.updateGeometries(updates)
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** 清除所有图层（标记、折线、标签、多边形），用于 CLEAR 命令。 */
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
    if (this.polygonLayer) {
      this.polygonLayer.setMap(null)
      this.polygonLayer = null
      this.polygons.clear()
      this.onPolygonClick = null
    }
  }

  /**
   * 只清除测量覆盖物（标记、折线、标签），保留多边形图层。
   * 用于工具切换时：多边形是用户主动绘制的持久内容，不应因切换工具而丢失；
   * 测量工具的覆盖物是临时的，切换后应清除。
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

  /** 生成带标号文字的 SVG 标记图标，以 base64 data URL 形式返回供 TMap.MarkerStyle 使用。 */
  private _markerSvg(label: string): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
      <circle cx="11" cy="11" r="9" fill="#FF6B35" stroke="#fff" stroke-width="2"/>
      <text x="11" y="15" text-anchor="middle" fill="#fff" font-size="10" font-family="sans-serif" font-weight="bold">${label}</text>
    </svg>`
    return `data:image/svg+xml;base64,${btoa(svg)}`
  }
}

import { haversine, formatDistance, getLabelStyleId } from '@shared/utils/distance'
import { HookEvent, sendToPanel } from '@shared/protocol'
import { TOOL_IDS } from '@shared/tool-config'
import { log } from '../logger'
import type { ITool, ToolContext } from './types'
import type { LatLng } from '@shared/utils/parse-coords'

const RUBBER_BAND_ID = 'mp-rubber'

export class MultiPointTool implements ITool {
  readonly id = TOOL_IDS.MULTI_POINT

  private ctx: ToolContext | null = null
  private points: LatLng[] = []
  private totalM = 0
  private clickHandler: ((evt: any) => void) | null = null
  private mousemoveHandler: ((evt: any) => void) | null = null
  private dblClickHandler: ((evt: any) => void) | null = null
  private keydownHandler: ((evt: KeyboardEvent) => void) | null = null
  private mapContainer: HTMLElement | null = null
  private measureCount = 0
  private measureId: string | null = null
  /** 是否处于编辑已有测距的模式。 */
  private editMode = false
  /** 正在编辑的测距 ID（复用原 ID 而非新建）。 */
  private editMeasureId: string | null = null
  /** 编辑模式下的原名称（commit 时保持名称不变）。 */
  private editMeasureName: string | null = null

  /** 注册地图事件监听器，初始化点列表和累计距离。 */
  activate(ctx: ToolContext): void {
    this.ctx = ctx
    this.points = []
    this.totalM = 0

    this.clickHandler = (evt: any) => this.onMapClick(evt)
    ctx.map.on('click', this.clickHandler)

    this.mousemoveHandler = (evt: any) => this.onMouseMove(evt)
    ctx.map.on('mousemove', this.mousemoveHandler)

    this.dblClickHandler = (evt: any) => this.onDblClick(evt)
    ctx.map.on('dblclick', this.dblClickHandler)

    this.keydownHandler = (evt: KeyboardEvent) => this.onKeydown(evt)
    document.addEventListener('keydown', this.keydownHandler)

    this.setCrosshair(true)
    log('MultiPointTool activated — crosshair + rubber band + dblclick + escape')
  }

  /**
   * 加载已有测距数据进行编辑。
   * 移除持久测距图层，将顶点数据注入临时绘制层，后续操作与新建绘制一致。
   */
  loadForEdit(ctx: ToolContext, id: string, name: string, points: LatLng[], segDists: number[]): void {
    // 先清理可能已激活的旧状态
    this.deactivate()

    this.ctx = ctx
    this.editMode = true
    this.editMeasureId = id
    this.editMeasureName = name
    this.points = [...points]
    this.totalM = segDists.reduce((a, b) => a + b, 0)

    // 移除持久图层（后续由 finish 重新创建）
    ctx.overlays.removeMeasure(id)

    // 在临时图层上渲染已有顶点和线段
    for (let i = 0; i < points.length; i++) {
      const pt = points[i]
      ctx.overlays.addMarker(`mp-${i}`, pt, String(i + 1))
      sendToPanel({ type: HookEvent.POINT_ADDED, payload: { index: i, lat: pt.lat, lng: pt.lng } })

      if (i > 0) {
        const prev = points[i - 1]
        const dist = segDists[i - 1]
        ctx.overlays.setPolyline(`mp-line-${i - 1}`, [prev, pt])
        const midLat = (prev.lat + pt.lat) / 2
        const midLng = (prev.lng + pt.lng) / 2
        ctx.overlays.addLabel(
          `mp-label-${i - 1}`,
          { lat: midLat, lng: midLng },
          formatDistance(dist),
          getLabelStyleId(prev, pt),
        )
        sendToPanel({
          type: HookEvent.SEGMENT_ADDED,
          payload: { fromIdx: i - 1, toIdx: i, distanceM: dist, totalM: this.totalM },
        })
      }
    }

    // 注册编辑模式的事件监听
    this.clickHandler = (evt: any) => this.onMapClick(evt)
    ctx.map.on('click', this.clickHandler)
    this.mousemoveHandler = (evt: any) => this.onMouseMove(evt)
    ctx.map.on('mousemove', this.mousemoveHandler)
    this.dblClickHandler = (evt: any) => this.onDblClick(evt)
    ctx.map.on('dblclick', this.dblClickHandler)
    this.keydownHandler = (evt: KeyboardEvent) => this.onKeydown(evt)
    document.addEventListener('keydown', this.keydownHandler)
    this.setCrosshair(true)
    log('MultiPointTool loadForEdit —', id, points.length, 'points')
  }

  /** 注销所有地图事件监听器，清空内部状态。 */
  deactivate(): void {
    if (this.ctx) {
      if (this.clickHandler) {
        this.ctx.map.off('click', this.clickHandler)
        this.clickHandler = null
      }
      if (this.mousemoveHandler) {
        this.ctx.map.off('mousemove', this.mousemoveHandler)
        this.mousemoveHandler = null
      }
      if (this.dblClickHandler) {
        this.ctx.map.off('dblclick', this.dblClickHandler)
        this.dblClickHandler = null
      }
      this.ctx.overlays.removeRubberBand(RUBBER_BAND_ID)
    }
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler)
      this.keydownHandler = null
    }
    this.setCrosshair(false)
    this.ctx = null
  }

  /** 清除所有覆盖物和测量数据，重新挂载点击监听器以继续测量。 */
  reset(): void {
    if (this.ctx) {
      this.ctx.overlays.clearMeasurement()
    }
    this.points = []
    this.totalM = 0
    // reset 后需要重新挂载监听器以支持继续点击
    if (this.ctx && !this.clickHandler) {
      this.clickHandler = (evt: any) => this.onMapClick(evt)
      this.ctx.map.on('click', this.clickHandler)

      this.mousemoveHandler = (evt: any) => this.onMouseMove(evt)
      this.ctx.map.on('mousemove', this.mousemoveHandler)

      this.dblClickHandler = (evt: any) => this.onDblClick(evt)
      this.ctx.map.on('dblclick', this.dblClickHandler)
    }
  }

  /** 停止接收新点击（保留已绘制的覆盖物），对应双击/面板"完成"按钮。 */
  finish(): void {
    if (!this.ctx) return
    if (this.clickHandler) {
      this.ctx.map.off('click', this.clickHandler)
      this.clickHandler = null
    }
    if (this.mousemoveHandler) {
      this.ctx.map.off('mousemove', this.mousemoveHandler)
      this.mousemoveHandler = null
      this.ctx.overlays.removeRubberBand(RUBBER_BAND_ID)
    }
    if (this.dblClickHandler) {
      this.ctx.map.off('dblclick', this.dblClickHandler)
      this.dblClickHandler = null
    }
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler)
      this.keydownHandler = null
    }
    this.setCrosshair(false)

    // 如果至少有两个点，创建持久测距图层
    if (this.points.length >= 2) {
      const isEdit = this.editMode
      const id = isEdit ? this.editMeasureId! : `measure-${Date.now()}`
      const name = isEdit ? this.editMeasureName! : `测距 ${this.measureCount + 1}`

      if (!isEdit) {
        this.measureCount++
      }

      const segDists: number[] = []
      for (let i = 0; i < this.points.length - 1; i++) {
        const a = this.points[i]
        const b = this.points[i + 1]
        segDists.push(haversine(a.lat, a.lng, b.lat, b.lng))
      }

      // 创建/更新持久测距图层（新线 + 标记 + 标签）
      this.ctx.overlays.addMeasure(id, [...this.points], segDists, (clickedId: string) => {
        sendToPanel({ type: HookEvent.MEASURE_SELECTED, payload: { id: clickedId } })
      })

      // 清理临时绘制用的覆盖物
      this.ctx.overlays.clearMeasurement()

      // 发射测距图层数据到 panel
      sendToPanel({
        type: HookEvent.MEASURE_DRAWN,
        payload: {
          id,
          name,
          visible: true,
          selected: false,
          paths: [[...this.points]],
          segmentDistances: segDists,
          totalDistance: this.totalM,
        },
      })

      // 重置编辑模式
      this.editMode = false
      this.editMeasureId = null
      this.editMeasureName = null
    }
    log('MultiPointTool finished')
  }

  /**
   * 撤销最后一个点：移除对应的标记、线段和标签，并从累计距离中减去该段。
   * 索引 0 的点没有对应线段，只删除标记。
   */
  undo(): void {
    if (!this.ctx || this.points.length === 0) return
    const idx = this.points.length - 1

    this.ctx.overlays.removeMarker(`mp-${idx}`)
    if (idx > 0) {
      this.ctx.overlays.removePolyline(`mp-line-${idx - 1}`)
      this.ctx.overlays.removeLabel(`mp-label-${idx - 1}`)
      const a = this.points[idx - 1]
      const b = this.points[idx]
      this.totalM -= haversine(a.lat, a.lng, b.lat, b.lng)
    }

    this.points.pop()

    // 更新橡皮筋：从最后一个剩余点到光标不变（等下一次 mousemove 更新）
    // 如果没点了，移除橡皮筋
    if (this.points.length === 0) {
      this.ctx.overlays.removeRubberBand(RUBBER_BAND_ID)
    }

    sendToPanel({ type: HookEvent.POINT_REMOVED, payload: { newCount: this.points.length } })
    log('MultiPointTool undo, remaining:', this.points.length)
  }

  // ── Event handlers ───────────────────────────────────────────────────────

  /**
   * 处理地图点击事件：追加新点，绘制标记；若已有前一点则计算并绘制线段+距离标签。
   */
  private onMapClick(evt: any): void {
    if (!this.ctx) return
    const latlng: LatLng = { lat: evt.latLng.lat, lng: evt.latLng.lng }
    const idx = this.points.length

    this.points.push(latlng)
    this.ctx.overlays.addMarker(`mp-${idx}`, latlng, String(idx + 1))
    sendToPanel({ type: HookEvent.POINT_ADDED, payload: { index: idx, ...latlng } })

    if (idx > 0) {
      const prev = this.points[idx - 1]
      const segDist = haversine(prev.lat, prev.lng, latlng.lat, latlng.lng)
      this.totalM += segDist

      this.ctx.overlays.setPolyline(`mp-line-${idx - 1}`, [prev, latlng])

      const midLat = (prev.lat + latlng.lat) / 2
      const midLng = (prev.lng + latlng.lng) / 2
      this.ctx.overlays.addLabel(
        `mp-label-${idx - 1}`,
        { lat: midLat, lng: midLng },
        formatDistance(segDist),
        getLabelStyleId(prev, latlng),
      )

      sendToPanel({
        type: HookEvent.SEGMENT_ADDED,
        payload: {
          fromIdx: idx - 1,
          toIdx: idx,
          distanceM: segDist,
          totalM: this.totalM,
        },
      })
    }
  }

  /**
   * 鼠标移动时更新橡皮筋预览线（最后一个点 → 鼠标当前位置）。
   * 配合 MeasureTool 体验，提供实时预览。
   */
  private onMouseMove(evt: any): void {
    if (!this.ctx || this.points.length === 0) return
    const cursor: LatLng = { lat: evt.latLng.lat, lng: evt.latLng.lng }
    this.ctx.overlays.setRubberBand(RUBBER_BAND_ID, [this.points[this.points.length - 1], cursor])
  }

  /**
   * 双击结束测量。
   * TMap 双击事件触发顺序：click（第一下）→ click（第二下）→ dblclick。
   * 第一下 click 已经向 points 添加了一个点，这里需要先撤销再完成。
   */
  private onDblClick(_evt: any): void {
    this.undo()    // 撤销 dblclick 前误加的最后一点
    this.finish()  // 停止监听，保留所有覆盖物
    log('MultiPointTool dblclick finish')
  }

  /** Escape 取消：清空所有覆盖物，回到初始测量状态。编辑模式下恢复原图层。 */
  private onKeydown(evt: KeyboardEvent): void {
    if (evt.key !== 'Escape') return
    evt.preventDefault()

    if (this.editMode && this.editMeasureId && this.ctx) {
      // 编辑取消：恢复原图层后退出编辑模式
      const id = this.editMeasureId
      const name = this.editMeasureName
      const pts = [...this.points]
      const segDists: number[] = []
      for (let i = 0; i < pts.length - 1; i++) {
        segDists.push(haversine(pts[i].lat, pts[i].lng, pts[i + 1].lat, pts[i + 1].lng))
      }
      // 重新创建持久图层
      this.ctx.overlays.addMeasure(id, pts, segDists, (clickedId: string) => {
        sendToPanel({ type: HookEvent.MEASURE_SELECTED, payload: { id: clickedId } })
      })
      // 清理临时绘制
      this.ctx.overlays.clearMeasurement()
      // 通知 panel 恢复
      sendToPanel({
        type: HookEvent.MEASURE_DRAWN,
        payload: {
          id,
          name: name!,
          visible: true,
          selected: false,
          paths: [[...pts]],
          segmentDistances: segDists,
          totalDistance: segDists.reduce((a, b) => a + b, 0),
        },
      })
      this.editMode = false
      this.editMeasureId = null
      this.editMeasureName = null
      log('MultiPointTool edit cancelled — restored', id)
    } else {
      this.reset()
    }
    log('MultiPointTool Escape — reset')
  }

  // ── Crosshair cursor ─────────────────────────────────────────────────────

  /** 在地图容器上切换十字准星光标。 */
  private setCrosshair(on: boolean): void {
    try {
      if (!this.mapContainer) {
        this.mapContainer = this.ctx?.map?.getContainer?.()
          ?? document.getElementById('container')
      }
      if (this.mapContainer) {
        if (on) {
          this.mapContainer.classList.add('__tmh-crosshair')
        } else {
          this.mapContainer.classList.remove('__tmh-crosshair')
        }
      }
    } catch {
      // 静默失败：容器不可达不影响核心功能
    }
  }
}

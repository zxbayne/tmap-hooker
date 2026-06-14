import { HookEvent, sendToPanel } from '@shared/protocol'
import { TOOL_IDS } from '@shared/tool-config'
import { parsePointCoords } from '@shared/utils/parse-coords'
import { log } from '../logger'
import type { ITool, ToolContext } from './types'
import type { LatLng } from '@shared/utils/parse-coords'

export class PointMarkerTool implements ITool {
  readonly id = TOOL_IDS.POINT_MARKER

  private ctx: ToolContext | null = null
  private points: Map<string, LatLng> = new Map()
  private pointNames: Map<string, string> = new Map()
  private idCounter = 0
  private selectedId: string | null = null

  private clickHandler: ((evt: any) => void) | null = null

  // ── ITool interface ───────────────────────────────────────────────────────

  activate(ctx: ToolContext): void {
    this.ctx = ctx
    this.clickHandler = (evt: any) => this.onMapClick(evt)
    ctx.map.on('click', this.clickHandler)
    log('PointMarkerTool activated')
  }

  deactivate(): void {
    if (this.ctx && this.clickHandler) {
      this.ctx.map.off('click', this.clickHandler)
    }
    this.clickHandler = null
    this.ctx = null
    log('PointMarkerTool deactivated')
  }

  reset(): void {
    if (this.ctx) {
      for (const id of this.points.keys()) {
        this.ctx.overlays.removePointMarker(id)
      }
    }
    this.points.clear()
    this.pointNames.clear()
    this.selectedId = null
    this.idCounter = 0
    log('PointMarkerTool reset — all points cleared')
  }

  // ── Map event handler ─────────────────────────────────────────────────────

  private onMapClick(evt: any): void {
    if (!this.ctx) return
    const latlng: LatLng = { lat: evt.latLng.lat, lng: evt.latLng.lng }
    const id = `pm-${++this.idCounter}`
    const name = `点位 ${this.idCounter}`
    this._addPoint(id, latlng, name)
    log('PointMarkerTool point added:', id, latlng)
  }

  // ── Public commands ───────────────────────────────────────────────────────

  deleteById(id: string): void {
    if (!this.ctx || !this.points.has(id)) return
    this.ctx.overlays.removePointMarker(id)
    this.points.delete(id)
    this.pointNames.delete(id)
    if (this.selectedId === id) this.selectedId = null
    sendToPanel({ type: HookEvent.POINT_MARKER_DELETED, payload: { id } })
    log('PointMarkerTool point deleted:', id)
  }

  selectById(id: string, panToLocation = false): void {
    if (this.selectedId === id) return
    this.selectedId = id
    this.ctx?.overlays.setPointMarkerHighlight(id)
    if (panToLocation && this.ctx) {
      const latlng = this.points.get(id)
      if (latlng) {
        const TMap = (window as any).TMap
        const pos = new TMap.LatLng(latlng.lat, latlng.lng)
        if (typeof this.ctx.map.panTo === 'function') {
          this.ctx.map.panTo(pos)
        } else {
          this.ctx.map.setCenter(pos)
        }
      }
    }
    log('PointMarkerTool point selected:', id)
  }

  setVisible(id: string, visible: boolean): void {
    this.ctx?.overlays.setPointMarkerVisible(id, visible)
  }

  renameById(id: string, name: string): void {
    if (!this.points.has(id)) return
    this.pointNames.set(id, name)
    this.ctx?.overlays.updatePointMarkerName(id, name)
    log('PointMarkerTool point renamed:', id, '->', name)
  }

  importFromInput(input: string): void {
    if (!this.ctx) return
    const coords = parsePointCoords(input)
    if (!coords || coords.length === 0) {
      log('PointMarkerTool importFromInput: failed to parse:', input)
      return
    }
    for (const latlng of coords) {
      const id = `pm-${++this.idCounter}`
      const name = `点位 ${this.idCounter}`
      this._addPoint(id, latlng, name)
    }
    log('PointMarkerTool imported', coords.length, 'points')
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _addPoint(id: string, latlng: LatLng, name: string): void {
    if (!this.ctx) return
    this.ctx.overlays.addPointMarker(id, latlng, name)
    this.points.set(id, latlng)
    this.pointNames.set(id, name)
    sendToPanel({ type: HookEvent.POINT_MARKER_ADDED, payload: { id, lat: latlng.lat, lng: latlng.lng, name } })
  }
}

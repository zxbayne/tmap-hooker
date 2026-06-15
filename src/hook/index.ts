/**
 * Hook 层入口文件，运行在页面的 MAIN world（通过 manifest.json 的 "world": "MAIN" 配置）。
 * 可以直接访问 window.TMap 等页面级全局变量。
 * 通过 window.postMessage 与运行在 ISOLATED world 的 panel 层通信。
 */
import { initLogger, setDebug, log } from './logger'
import { ToolManager } from './tool-manager'
import { installMapBridge } from './map-bridge'
import { PANEL_SOURCE, PanelCmd } from '@shared/protocol'
import type { PanelMessage } from '@shared/protocol'

initLogger()
log('hook.iife.js loaded, document.readyState =', document.readyState)

// 注入十字准星光标样式（测距工具激活时使用）
// document_start 时机 document.head 可能未就绪，延迟到 DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  const crosshairStyle = document.createElement('style')
  crosshairStyle.textContent = '.__tmh-crosshair { cursor: crosshair !important; }'
  document.head.appendChild(crosshairStyle)
})

const toolManager = new ToolManager()
installMapBridge(toolManager)

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as PanelMessage
  if (!msg || msg.source !== PANEL_SOURCE) return

  log('received panel message:', msg.type)

  switch (msg.type) {
    case PanelCmd.PANEL_READY:
      toolManager.replayMapReady()
      break
    case PanelCmd.SET_TOOL:
      toolManager.setTool(msg.payload.toolId)
      break
    case PanelCmd.FINISH:
      toolManager.finish()
      break
    case PanelCmd.UNDO:
      toolManager.undo()
      break
    case PanelCmd.CLEAR:
      toolManager.clear()
      break
    case PanelCmd.SET_DEBUG:
      setDebug(msg.payload.enabled)
      log('debug mode set to:', msg.payload.enabled)
      break
    case PanelCmd.DRAW_POLYGON:
      toolManager.drawPolygon(msg.payload.input)
      break
    case PanelCmd.DELETE_POLYGON:
      toolManager.deletePolygonById(msg.payload.id)
      break
    case PanelCmd.START_DRAWING_POLYGON:
      toolManager.startDrawingPolygon()
      break
    case PanelCmd.FINISH_DRAWING_POLYGON:
      toolManager.finishDrawingPolygon()
      break
    case PanelCmd.CANCEL_DRAWING_POLYGON:
      toolManager.cancelDrawingPolygon()
      break
    case PanelCmd.UNDO_POLYGON_POINT:
      toolManager.undoPolygonPoint()
      break
    case PanelCmd.SELECT_POLYGON:
      toolManager.selectPolygonById(msg.payload.id)
      break
    case PanelCmd.TOGGLE_POLYGON_VISIBLE:
      toolManager.togglePolygonVisible(msg.payload.id, msg.payload.visible)
      break
    case PanelCmd.START_EDIT_POLYGON:
      toolManager.startEditPolygon(msg.payload.id)
      break
    case PanelCmd.FINISH_EDIT_POLYGON:
      toolManager.finishEditPolygon()
      break
    case PanelCmd.CANCEL_EDIT_POLYGON:
      toolManager.cancelEditPolygon()
      break
    case PanelCmd.DELETE_POINT_MARKER:
      toolManager.deletePointMarker(msg.payload.id)
      break
    case PanelCmd.SELECT_POINT_MARKER:
      toolManager.selectPointMarker(msg.payload.id)
      break
    case PanelCmd.TOGGLE_POINT_MARKER_VISIBLE:
      toolManager.togglePointMarkerVisible(msg.payload.id, msg.payload.visible)
      break
    case PanelCmd.RENAME_POINT_MARKER:
      toolManager.renamePointMarker(msg.payload.id, msg.payload.name)
      break
    case PanelCmd.IMPORT_POINT_MARKERS:
      toolManager.importPointMarkers(msg.payload.input)
      break
    case PanelCmd.UPDATE_CIRCLE:
      toolManager.updateCircle(msg.payload.id, msg.payload.radius, msg.payload.nPoints)
      break
    case PanelCmd.FINISH_CIRCLE:
      toolManager.finishCircle()
      break
    case PanelCmd.START_DRAWING_CIRCLE:
      toolManager.startDrawingCircle()
      break
    case PanelCmd.CANCEL_DRAWING_CIRCLE:
      toolManager.cancelDrawingCircle()
      break
    case PanelCmd.START_EDIT_CIRCLE:
      toolManager.startEditCircle(msg.payload.id)
      break
    case PanelCmd.COMMIT_EDIT_CIRCLE:
      toolManager.commitEditCircle()
      break
    case PanelCmd.CANCEL_EDIT_CIRCLE:
      toolManager.cancelEditCircle()
      break
    case PanelCmd.DELETE_MEASURE:
      toolManager.deleteMeasure(msg.payload.id)
      break
    case PanelCmd.SELECT_MEASURE:
      toolManager.selectMeasure(msg.payload.id)
      break
    case PanelCmd.TOGGLE_MEASURE_VISIBLE:
      toolManager.toggleMeasureVisible(msg.payload.id, msg.payload.visible)
      break
    case PanelCmd.RENAME_MEASURE:
      toolManager.renameMeasure(msg.payload.id, msg.payload.name)
      break
    // 测距编辑命令
    case PanelCmd.START_EDIT_MEASURE:
      toolManager.startEditMeasure(
        msg.payload.id,
        msg.payload.name,
        msg.payload.points,
        msg.payload.segmentDistances,
      )
      break
    case PanelCmd.COMMIT_EDIT_MEASURE:
      toolManager.commitEditMeasure()
      break
    case PanelCmd.CANCEL_EDIT_MEASURE:
    case PanelCmd.UPDATE_MEASURE_VERTEX:
      break
  }
})

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
  }
})

import { ref, computed } from 'vue'
import { HookEvent, PanelCmd } from '@shared/protocol'
import type { HookMessage, SegmentAddedPayload, MeasurementResultPayload } from '@shared/protocol'
import { useMapBridge } from './useMapBridge'
import { formatDistance } from '@shared/utils/distance'

/** 多点测距中的单段信息，供 MultiPointResult 组件展示。 */
export interface SegmentInfo {
  from: number
  to: number
  distanceM: number
  label: string
}

/**
 * 工具状态管理 composable，是 panel 层的响应式数据中枢。
 * 监听所有来自 hook 层的 HookEvent，并维护相应的响应式状态；
 * 同时提供向 hook 发送命令的函数供组件调用。
 */
export function useTool() {
  const { onHookEvent, sendCmd } = useMapBridge()

  const isMapReady = ref(false)
  /** 当前激活的工具 id，空字符串表示无工具激活。 */
  const activeTool = ref<string>('')
  const segments = ref<SegmentInfo[]>([])
  const totalM = ref(0)
  const pointCount = ref(0)
  const twoPointResult = ref<MeasurementResultPayload | null>(null)

  // 多边形工具相关状态
  /** textarea 中显示的坐标文本，由 hook 层打点时实时更新。 */
  const polygonCoords = ref('')
  const selectedPolygonId = ref<string | null>(null)
  const polygonCount = ref(0)

  /** 多点测距的总距离格式化字符串，totalM 为 0 时返回空字符串。 */
  const totalLabel = computed(() => (totalM.value > 0 ? formatDistance(totalM.value) : ''))
  const isMeasuring = computed(() => activeTool.value !== '')

  // 处理所有来自 hook 层的事件
  onHookEvent((msg: HookMessage) => {
    switch (msg.type) {
      case HookEvent.MAP_READY:
        isMapReady.value = true
        break

      case HookEvent.POINT_ADDED:
        pointCount.value = msg.payload.index + 1
        break

      case HookEvent.SEGMENT_ADDED: {
        const p = msg.payload as SegmentAddedPayload
        segments.value.push({
          from: p.fromIdx + 1,
          to: p.toIdx + 1,
          distanceM: p.distanceM,
          label: formatDistance(p.distanceM),
        })
        totalM.value = p.totalM
        break
      }

      case HookEvent.MEASUREMENT_RESULT: {
        // 两点测距完成，hook 层已停止监听，panel 也清除激活工具状态
        const p = msg.payload as MeasurementResultPayload
        twoPointResult.value = p
        totalM.value = p.distanceM
        activeTool.value = ''
        break
      }

      case HookEvent.POINT_REMOVED:
        pointCount.value = msg.payload.newCount
        if (segments.value.length > 0) {
          const removed = segments.value.pop()!
          totalM.value -= removed.distanceM
        }
        break

      case HookEvent.POLYGON_POINT_ADDED:
        // 实时同步 hook 层的打点坐标到 textarea
        polygonCoords.value = msg.payload.coordsText
        break

      case HookEvent.POLYGON_DRAWN:
        polygonCount.value++
        polygonCoords.value = ''
        break

      case HookEvent.POLYGON_SELECTED:
        selectedPolygonId.value = msg.payload.id
        break

      case HookEvent.POLYGON_DELETED:
        polygonCount.value = Math.max(0, polygonCount.value - 1)
        selectedPolygonId.value = null
        break
    }
  })

  /**
   * 切换激活工具（点击已激活的工具则取消激活）。
   * 切换时重置所有测量状态；多边形工具切换时保留多边形相关状态。
   */
  function setTool(toolId: string) {
    const next = activeTool.value === toolId ? '' : toolId
    activeTool.value = next
    segments.value = []
    totalM.value = 0
    pointCount.value = 0
    twoPointResult.value = null
    if (next !== 'polygon') {
      polygonCoords.value = ''
      selectedPolygonId.value = null
    }
    sendCmd({ type: PanelCmd.SET_TOOL, payload: { toolId: next } })
  }

  /** 完成当前操作（对应多点测距的"完成"按钮），停止接受新点击。 */
  function finish() {
    activeTool.value = ''
    sendCmd({ type: PanelCmd.FINISH })
  }

  /** 撤销最后一步操作（对应多点测距的"撤销"按钮）。 */
  function undo() {
    sendCmd({ type: PanelCmd.UNDO })
  }

  /** 清除所有测量数据和覆盖物，重置面板到初始状态。 */
  function clear() {
    segments.value = []
    totalM.value = 0
    pointCount.value = 0
    twoPointResult.value = null
    activeTool.value = ''
    polygonCoords.value = ''
    selectedPolygonId.value = null
    polygonCount.value = 0
    sendCmd({ type: PanelCmd.CLEAR })
  }

  /** 提交坐标文本，通知 hook 层绘制多边形。 */
  function drawPolygon(input: string) {
    sendCmd({ type: PanelCmd.DRAW_POLYGON, payload: { input } })
  }

  /** 通知 hook 层删除当前选中的多边形。 */
  function deletePolygon() {
    sendCmd({ type: PanelCmd.DELETE_POLYGON })
  }

  /** 切换 hook 层的调试日志开关，同步自设置面板的复选框状态。 */
  function setDebug(enabled: boolean) {
    sendCmd({ type: PanelCmd.SET_DEBUG, payload: { enabled } })
  }

  return {
    isMapReady,
    activeTool,
    segments,
    totalM,
    totalLabel,
    pointCount,
    twoPointResult,
    isMeasuring,
    polygonCoords,
    selectedPolygonId,
    polygonCount,
    setTool,
    finish,
    undo,
    clear,
    drawPolygon,
    deletePolygon,
    setDebug,
  }
}

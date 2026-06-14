import type { OverlayManager } from '../overlay-manager'
export type { LatLng } from '@shared/utils/parse-coords'

/** 工具激活时注入的上下文，包含 map 实例和覆盖物管理器。 */
export interface ToolContext {
  /** TMap.Map 实例，用于注册/注销地图事件。 */
  map: any
  /** 管理地图上所有覆盖物（标记、线、标签、多边形）的统一接口。 */
  overlays: OverlayManager
}

/**
 * 所有测量/绘制工具必须实现的接口。
 * ToolManager 通过此接口管理工具的生命周期，无需了解具体实现。
 */
export interface ITool {
  /** 工具的唯一标识符，与 TOOL_IDS 中的值对应。 */
  readonly id: string
  /** 激活工具，注入上下文并开始监听地图事件。 */
  activate(ctx: ToolContext): void
  /** 停用工具，注销地图事件监听器，清理临时状态。 */
  deactivate(): void
  /** 重置工具到初始状态（清除覆盖物），但保持激活状态。 */
  reset(): void
  /** 停止接收新输入并锁定当前结果（可选，仅部分工具实现）。 */
  finish?(): void
  /** 撤销最后一步操作（可选，仅部分工具实现）。 */
  undo?(): void
}

import type { OverlayManager } from '../overlay-manager'

/** 经纬度坐标，与 TMap.LatLng 结构对应，用纯数据对象传递以避免依赖 TMap 类型。 */
export interface LatLng {
  lat: number
  lng: number
}

/** 工具向 panel 发送事件的函数签名，对应 `window.postMessage` 封装。 */
export type MessageEmitter = (type: string, payload?: unknown) => void

/** 工具激活时注入的上下文，包含 map 实例、覆盖物管理器和消息发射器。 */
export interface ToolContext {
  /** TMap.Map 实例，用于注册/注销地图事件。 */
  map: any
  /** 管理地图上所有覆盖物（标记、线、标签、多边形）的统一接口。 */
  overlays: OverlayManager
  /** 向 panel 发送事件消息的函数。 */
  emit: MessageEmitter
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
}

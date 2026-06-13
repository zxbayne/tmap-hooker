import { onMounted, onUnmounted } from 'vue'
import { HOOK_SOURCE, PanelCmd, sendToHook } from '@shared/protocol'
import type { HookMessage } from '@shared/protocol'

type Handler = (msg: HookMessage) => void

/**
 * 模块级 handler 数组和单一 window 事件监听器。
 * 使用模块单例而非组件级注册的原因：Vue 组件可能多次挂载，
 * 若每次 onMounted 都调用 addEventListener 会产生重复监听器，
 * 导致同一条消息被处理多次。
 */
const handlers: Handler[] = []

/** 统一的 window.message 事件处理函数，过滤后分发给所有注册的 handler。 */
function onMessage(event: MessageEvent) {
  const msg = event.data as HookMessage
  if (!msg || msg.source !== HOOK_SOURCE) return
  handlers.forEach((h) => h(msg))
}

let listenerInstalled = false

/** 确保 window.message 监听器只安装一次。 */
function ensureListener() {
  if (listenerInstalled) return
  window.addEventListener('message', onMessage)
  listenerInstalled = true
}

/**
 * 提供 hook ↔ panel 消息桥接能力的 Vue composable。
 * - `onHookEvent`：注册消息处理回调，组件卸载时自动清理。
 * - `sendCmd`：向 hook 层发送命令。
 * 每个使用此 composable 的组件在 onMounted 时会向 hook 发送 PANEL_READY。
 */
export function useMapBridge() {
  /** 注册消息 handler，并在 onUnmounted 时自动移除，防止内存泄漏。 */
  const onHookEvent = (handler: Handler) => {
    ensureListener()
    handlers.push(handler)
    onUnmounted(() => {
      const idx = handlers.indexOf(handler)
      if (idx !== -1) handlers.splice(idx, 1)
    })
  }

  /** 向 hook 层发送命令消息，是 sendToHook 的别名。 */
  const sendCmd = sendToHook

  onMounted(() => {
    // 通知 hook 层 panel 已就绪，触发 replayMapReady 以处理加载顺序问题
    sendToHook({ type: PanelCmd.PANEL_READY })
  })

  return { onHookEvent, sendCmd }
}

import { SETTINGS_KEY } from '@shared/constants'

let debugEnabled = false

/**
 * 读取 localStorage 中保存的 debug 开关状态，在 hook 脚本启动时调用一次。
 * hook 运行在 MAIN world，可以直接访问页面的 localStorage。
 */
export function initLogger(): void {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    debugEnabled = raw ? JSON.parse(raw).debug === true : false
  } catch {
    debugEnabled = false
  }
}

/**
 * 运行时切换调试日志开关。
 * 由 panel 发送 SET_DEBUG 命令后在 index.ts 中调用。
 */
export function setDebug(enabled: boolean): void {
  debugEnabled = enabled
}

/**
 * 向控制台输出带前缀的日志，仅在 debug 模式开启时有效。
 * hook 层所有日志都经过此函数，避免在生产页面产生噪音。
 */
export function log(...args: unknown[]): void {
  if (debugEnabled) console.log('[TMapHooker]', ...args)
}

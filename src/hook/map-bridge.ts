import { log } from './logger'
import type { ToolManager } from './tool-manager'

/**
 * 需要 hook 的 TMap.Map prototype 方法列表。
 * 选取这些方法是因为它们是任何使用 TMap.Map 的页面都会调用的最基础方法，
 * 能以最高概率捕获到 map 实例。不选 constructor 是因为 Proxy 拦截
 * 构造函数在 content script 环境下更脆弱。
 */
const CAPTURE_METHODS = ['getCenter', 'setCenter', 'on', 'off', 'setZoom', 'getZoom', 'fitBounds']

/**
 * 标记 prototype 已被 patch 的属性名，防止 setter trap 和轮询同时触发时重复 patch。
 */
const ALREADY_PATCHED = '__tmapHookerPatched'
let POLL_TIMER: ReturnType<typeof setInterval> | null = null
let pollCount = 0

/**
 * 安装 TMap 实例检测桥接器，采用双重策略确保无论 TMap 何时加载都能被捕获：
 * 1. setter trap（快速路径）：监听 `window.TMap` 赋值，适用于 TMap 在本脚本之后加载的情况。
 * 2. 200ms 轮询（兜底）：适用于 TMap 已在本脚本之前加载完毕的情况。
 * 两者均调用 `tryPrototypePatch`，一旦 patch 成功则停止轮询。
 */
export function installMapBridge(toolManager: ToolManager): void {
  log('installMapBridge called, document.readyState =', document.readyState)
  log('window.TMap at install time =', (window as any).TMap)

  trySetterTrap(toolManager)

  POLL_TIMER = setInterval(() => {
    pollCount++
    const TMap = (window as any).TMap
    log(`poll #${pollCount}: window.TMap =`, TMap, '| Map =', TMap?.Map)

    if (tryPrototypePatch(TMap, toolManager)) {
      log('prototype patched on poll #' + pollCount + ', stopping poll')
      clearInterval(POLL_TIMER!)
      POLL_TIMER = null
    }

    if (pollCount >= 50) {
      log('gave up polling after 50 attempts (10s). TMap never appeared.')
      clearInterval(POLL_TIMER!)
      POLL_TIMER = null
    }
  }, 200)
}

/**
 * 通过 Object.defineProperty 监听 `window.TMap` 的赋值事件。
 * 如果调用时 TMap 已经存在，则跳过 setter trap，直接尝试 patch。
 */
function trySetterTrap(toolManager: ToolManager): void {
  if ((window as any).TMap) {
    log('TMap already exists, patching directly')
    tryPrototypePatch((window as any).TMap, toolManager)
    return
  }

  try {
    Object.defineProperty(window, 'TMap', {
      configurable: true,
      enumerable: true,
      set(value: any) {
        log('window.TMap setter triggered, value =', value)
        Object.defineProperty(window, 'TMap', {
          value,
          writable: true,
          configurable: true,
          enumerable: true,
        })
        tryPrototypePatch(value, toolManager)
      },
    })
    log('window.TMap setter trap installed')
  } catch (e) {
    log('failed to install setter trap:', e)
  }
}

/**
 * 在 TMap.Map.prototype 上 hook CAPTURE_METHODS 中的每个方法，
 * 使得任意 map 实例在调用这些方法时都会通知 toolManager。
 * 通过 ALREADY_PATCHED 标记保证幂等性——多次调用不会重复包装。
 *
 * @returns true 表示 patch 成功（包含已 patch 的情况），false 表示 TMap 尚未就绪。
 */
function tryPrototypePatch(TMap: any, toolManager: ToolManager): boolean {
  if (!TMap) return false
  log('tryPrototypePatch: TMap =', TMap, '| TMap.Map =', TMap?.Map)

  if (!TMap?.Map?.prototype) {
    log('TMap.Map.prototype not found, keys on TMap:', Object.keys(TMap))
    return false
  }

  const proto = TMap.Map.prototype
  if (proto[ALREADY_PATCHED]) {
    log('prototype already patched, skipping')
    return true
  }

  log('patching TMap.Map.prototype, methods to hook:', CAPTURE_METHODS)

  let captured = false
  const onCapture = (instance: any) => {
    if (captured) return
    captured = true
    toolManager.onMapReady(instance, TMap)
    // 捕获成功后把所有 wrapper 还原为原始方法，避免持续日志和无谓开销
    for (const method of CAPTURE_METHODS) {
      if (typeof originals[method] === 'function') {
        proto[method] = originals[method]
      }
    }
    log('map instance captured, wrappers removed')
  }

  const originals: Record<string, Function> = {}
  let hookedCount = 0
  for (const method of CAPTURE_METHODS) {
    if (typeof proto[method] !== 'function') {
      log(`skip ${method} (not a function)`)
      continue
    }
    const orig = proto[method]
    originals[method] = orig
    proto[method] = function (this: any, ...args: unknown[]) {
      log(`map.${method}() called — capturing instance`)
      onCapture(this)
      return orig.apply(this, args)
    }
    hookedCount++
    log(`hooked ${method}`)
  }

  proto[ALREADY_PATCHED] = true
  log(`prototype patch complete, hooked ${hookedCount} methods`)
  return true
}

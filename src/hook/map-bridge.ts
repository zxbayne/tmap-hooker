import { log } from './logger'
import type { ToolManager } from './tool-manager'

const CAPTURE_METHODS = ['getCenter', 'setCenter', 'on', 'off', 'setZoom', 'getZoom', 'fitBounds']

const ALREADY_PATCHED = '__tmapHookerPatched'
let POLL_TIMER: ReturnType<typeof setInterval> | null = null
let pollCount = 0

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
 * 在 TMap.Map.prototype 上 hook CAPTURE_METHODS。
 * wrapper 永久保留不拆除，通过 toolManager.isMapCaptured() 判断是否需捕获。
 * SPA 切回时新实例自动被拦截，无需外部重置。
 */
function tryPrototypePatch(TMap: any, toolManager: ToolManager): boolean {
  if (!TMap) return false

  if (!TMap?.Map?.prototype) {
    log('TMap.Map.prototype not found, keys on TMap:', Object.keys(TMap))
    return false
  }

  const proto = TMap.Map.prototype
  if (proto[ALREADY_PATCHED]) {
    log('prototype already patched')
    return true
  }

  log('patching TMap.Map.prototype, methods to hook:', CAPTURE_METHODS)

  let hookedCount = 0
  for (const method of CAPTURE_METHODS) {
    if (typeof proto[method] !== 'function') {
      log(`skip ${method} (not a function)`)
      continue
    }
    const orig = proto[method]
    proto[method] = function (this: any, ...args: unknown[]) {
      // 静默检查：当前实例是否已被捕获？未被捕获时才触发
      if (!toolManager.isMapCaptured(this)) {
        log(`map.${method}() — new instance detected, capturing`)
        toolManager.onMapReady(this, TMap)
      }
      return orig.apply(this, args)
    }
    hookedCount++
    log(`hooked ${method}`)
  }

  proto[ALREADY_PATCHED] = true
  log(`prototype patch complete, hooked ${hookedCount} methods`)
  return true
}

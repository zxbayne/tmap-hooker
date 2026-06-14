import { createApp, type App } from 'vue'
import VueApp from './App.vue'
import panelCss from './style/panel.css?inline'

const DEFAULT_WHITELIST = ['lbs.qq.com']
const HOST_ID = 'tmap-hooker-host'

let vueApp: App | null = null

async function isWhitelisted(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get('whitelist')
    const wl: string[] = Array.isArray(result.whitelist) ? result.whitelist : DEFAULT_WHITELIST
    return wl.some((d) => location.hostname.includes(d))
  } catch {
    return true
  }
}

function mount() {
  if (document.getElementById(HOST_ID)) return

  const host = document.createElement('div')
  host.id = HOST_ID
  document.body.appendChild(host)

  const shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = panelCss
  shadow.appendChild(style)

  const mountPoint = document.createElement('div')
  shadow.appendChild(mountPoint)

  vueApp = createApp(VueApp)
  vueApp.mount(mountPoint)
}

function unmount() {
  vueApp?.unmount()
  vueApp = null
  document.getElementById(HOST_ID)?.remove()
}

async function syncMount() {
  const allowed = await isWhitelisted()
  const mounted = !!document.getElementById(HOST_ID)
  if (allowed && !mounted) mount()
  else if (!allowed && mounted) unmount()
}

// storage 变更时实时同步挂载状态（覆盖所有 tab，无需 sendMessage）
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'whitelist' in changes) syncMount()
})

// 响应 popup 的存活探测
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'PING') {
    sendResponse({ type: 'PONG' })
    return true
  }
})

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', syncMount)
} else {
  syncMount()
}

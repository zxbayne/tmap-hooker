import { createApp } from 'vue'
import App from './App.vue'
import panelCss from './style/panel.css?inline'

/**
 * 在页面中创建 Shadow DOM 宿主并挂载 Vue 应用。
 *
 * 使用 Shadow DOM 的原因：第三方页面的全局 CSS 可能与面板样式冲突；
 * Shadow DOM 提供完全的 CSS 隔离，页面样式不会渗入面板，面板样式也不会泄漏到页面。
 *
 * double-mount 守卫：某些 SPA 页面的路由切换会重新执行 content script，
 * 通过检查 DOM 中是否已存在宿主元素来防止重复挂载。
 */
function mountPanel() {
  if (document.getElementById('tmap-hooker-host')) return

  const host = document.createElement('div')
  host.id = 'tmap-hooker-host'
  document.body.appendChild(host)

  const shadow = host.attachShadow({ mode: 'open' })

  // 将内联 CSS 注入 shadow root，实现样式隔离
  const style = document.createElement('style')
  style.textContent = panelCss
  shadow.appendChild(style)

  // Vue 挂载点在 shadow DOM 内部
  const mountPoint = document.createElement('div')
  shadow.appendChild(mountPoint)

  createApp(App).mount(mountPoint)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountPanel)
} else {
  mountPanel()
}

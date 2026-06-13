/** Vue 单文件组件的类型声明，让 TS 识别 `import X from './X.vue'`。 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

/** Vite 的 `?inline` CSS 导入：返回 CSS 文本字符串。 */
declare module '*.css?inline' {
  const css: string
  export default css
}

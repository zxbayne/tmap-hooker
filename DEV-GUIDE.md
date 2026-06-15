# TMap Hooker 开发指南

> 面向新贡献者的上手指南。读完你应该能独立开发新功能。

---

## 一、项目概述

TMap Hooker 是一个 Chrome Manifest V3 浏览器扩展。它在所有网页上自动注入一个侧边面板，当检测到页面使用了腾讯地图 JavaScript GL SDK（`window.TMap`）时，提供测距、多边形绘制、打点标记等辅助工具。

**一句话**：一个寄生在第三方 TMap 页面上的地图工具箱。

---

## 二、技术栈

| 层面 | 技术 | 用途 |
|---|---|---|
| 语言 | TypeScript 5.4 | 全部代码 |
| 构建 | Vite 5 + Rollup | 输出 IIFE 格式的浏览器脚本 |
| 扩展平台 | Chrome MV3 | manifest、content script、storage API |
| UI 框架 | Vue 3.4 (Composition API) | 侧边面板 UI |
| CSS 隔离 | Shadow DOM | 防止页面样式污染面板 |
| 地图 SDK | TMap JS GL (外部依赖，不打包) | 通过页面全局 `window.TMap` 访问 |
| 通信 | `window.postMessage` | hook ↔ panel 跨 world 通信 |
| 包管理 | npm | `package.json` 中只有 devDependencies |

**没有运行时依赖。**面板用的 Vue 3 和 hook 脚本都是纯 TypeScript，构建产物是自包含的 IIFE 文件。

---

## 三、项目目录结构

```
tmap-hooker/
├── manifest.json              # Chrome 扩展清单
├── package.json               # npm 脚本和依赖
├── tsconfig.json              # TypeScript 配置 + 路径别名
├── vite.config.hook.ts        # hook 脚本构建配置
├── vite.config.panel.ts       # panel 脚本构建配置
├── vite.config.popup.ts       # popup 构建配置
├── public/
│   ├── icons/                 # 扩展图标 (16/48/128)
│   └── popup.html             # 点击扩展图标的弹窗
├── src/
│   ├── hook/                  # Hook 层 — 运行在 MAIN world
│   │   ├── index.ts           # 入口：初始化、消息路由
│   │   ├── logger.ts          # 调试日志（可开关）
│   │   ├── map-bridge.ts      # TMap 探测与 prototype hook
│   │   ├── overlay-manager.ts # 覆盖物管理（标记/线/标签/多边形）
│   │   ├── tool-manager.ts    # 工具注册与生命周期
│   │   └── tools/
│   │       ├── types.ts       # ITool 接口定义
│   │       ├── two-point.ts   # 两点测距
│   │       ├── multi-point.ts # 多点测距
│   │       ├── polygon.ts     # 多边形绘制（最大最复杂的工具）
│   │       └── point-marker.ts # 打点标记
│   ├── panel/                 # Panel 层 — 运行在 ISOLATED world
│   │   ├── index.ts           # Shadow DOM 创建 + Vue 挂载 + 白名单
│   │   ├── App.vue            # 根组件（折叠/拖拽/设置）
│   │   ├── composables/
│   │   │   ├── useMapBridge.ts  # 消息收发（模块级单例）
│   │   │   └── useTool.ts       # 响应式工具状态管理
│   │   ├── components/
│   │   │   ├── ToolBar.vue       # 工具选择按钮栏
│   │   │   ├── ResultPanel.vue   # 工具结果区域（路由）
│   │   │   ├── ActionBar.vue     # 操作按钮（完成/撤销/清除）
│   │   │   ├── Settings.vue      # 设置面板
│   │   │   └── tools/
│   │   │       ├── TwoPointResult.vue
│   │   │       ├── MultiPointResult.vue
│   │   │       ├── PolygonPanel.vue  # 多边形管理面板
│   │   │       └── PointPanel.vue    # 打点标记管理面板
│   │   └── style/panel.css
│   └── shared/                # 两层共享的代码
│       ├── protocol.ts        # 通信协议（消息枚举+类型+发送函数）
│       ├── tool-config.ts     # 工具元数据（id、名称、图标）
│       └── utils/
│           ├── distance.ts    # Haversine 公式、距离格式化
│           └── parse-coords.ts # 坐标解析（多格式兼容）
└── dist/                      # 构建产物（git 忽略）
    ├── manifest.json
    ├── icons/
    ├── hook.iife.js
    ├── panel.iife.js
    └── popup.iife.js
```

---

## 四、核心架构：Two-World 设计

这是整个项目最基础的概念，理解它才能理解一切。

### 4.1 为什么需要两个脚本？

Chrome MV3 的 content script 默认运行在 **ISOLATED world**：
- 可以访问页面 DOM
- 但**看不到页面的 JavaScript 变量**（`window.TMap`、`window.vueApp` 等）

而我们要操作的 TMap 对象在 **MAIN world** 里，隔离世界里的代码拿不到。

### 4.2 解决方案

```
┌───────────────────────────────────────────────────────┐
│  第三方页面                                             │
│                                                       │
│  MAIN world                    ISOLATED world          │
│  ┌──────────────┐              ┌──────────────┐       │
│  │ hook.iife.js │  postMessage │ panel.iife.js│       │
│  │              │◄────────────►│              │       │
│  │ 访问 TMap    │              │ Vue 3 UI     │       │
│  │ 操作覆盖物    │              │ Shadow DOM   │       │
│  └──────┬───────┘              └──────────────┘       │
│         │                                             │
│  ┌──────┴──────┐                                      │
│  │ window.TMap │  ← 页面加载的 SDK                     │
│  └─────────────┘                                      │
└───────────────────────────────────────────────────────┘
```

**hook.iife.js** 通过 `manifest.json` 中 `"world": "MAIN"` 跑在主上下文，可以直接 `(window as any).TMap`。

**panel.iife.js** 默认跑在隔离世界，用 Vue 3 构建 UI，通过 Shadow DOM 做 CSS 隔离。

两个脚本通过 `window.postMessage` 通信——所有消息携带 `source` 字段（`'tmap-hook'` 或 `'tmap-panel'`），以此区分扩展消息和页面自身的 postMessage。

### 4.3 manifest.json 中的配置

```json
"content_scripts": [
  {
    "matches": ["<all_urls>"],
    "js": ["hook.iife.js"],
    "run_at": "document_start",   // ← 尽可能早注入
    "world": "MAIN"              // ← 跑在页面主上下文
  },
  {
    "matches": ["<all_urls>"],
    "js": ["panel.iife.js"],
    "run_at": "document_idle"     // ← DOM 就绪后再挂载 UI
  }
]
```

`run_at: "document_start"` 确保 hook 在页面任何脚本执行前就注入，最大化捕获 `window.TMap` 赋值的机会。

---

## 五、关键技术要点

### 5.1 TMap 探测与 map 实例捕获 (`map-bridge.ts`)

**问题**：TMap SDK 可能在 hook 注入前已经加载，也可能在数秒后才加载，时机不确定。

**方案**：双重策略并行运行。

#### 策略 1：Setter Trap（拦截 `window.TMap` 的赋值）

```typescript
Object.defineProperty(window, 'TMap', {
  configurable: true,
  set(value) {
    // TMap 被赋值 → 立即 patch prototype
    // 然后还原为普通属性（拆除陷阱）
    Object.defineProperty(window, 'TMap', {
      value, writable: true, configurable: true,
    })
    tryPrototypePatch(value, toolManager)
  },
})
```

适用于 TMap **在本脚本之后加载**的场景（SPA 异步加载 SDK）。

#### 策略 2：轮询（每 200ms 检查一次）

```typescript
setInterval(() => {
  const TMap = (window as any).TMap
  if (tryPrototypePatch(TMap, toolManager)) {
    clearInterval(timer)  // 成功就停
  }
}, 200)
```

适用于 TMap **在本脚本之前已加载**的场景。最多轮询 50 次（10 秒），超时放弃。

**幂等保护**：两种策略抢跑，通过 `TMap.Map.prototype.__tmapHookerPatched` 标记保证不会重复 patch。

#### Prototype Hook：一次性钓鱼

拿到 `TMap` 之后，需要捕获具体的 map 实例。做法是 patch `TMap.Map.prototype` 上的方法：

```typescript
const CAPTURE_METHODS = ['getCenter', 'setCenter', 'on', 'off', 'setZoom', 'getZoom', 'fitBounds']

// 对每个方法做包装
for (const method of CAPTURE_METHODS) {
  const orig = proto[method]
  proto[method] = function(this, ...args) {
    onCapture(this)       // ← 捕获 this（即 map 实例）
    return orig.apply(this, args)
  }
}
```

一旦捕获成功，**所有 wrapper 立刻还原为原始方法**，零持久开销。这是一次性的。

### 5.2 跨层通信协议 (`protocol.ts`)

**为什么需要严格类型定义？** 两个世界之间只有纯 JSON 字符串传递，没有任何 IDE 支撑。没有类型约束，很容易出现拿错字段、拼错事件名的 bug。

#### 消息结构

```typescript
// Hook → Panel（事件通知）
{ source: 'tmap-hook', type: 'MAP_READY' }
{ source: 'tmap-hook', type: 'POLYGON_DRAWN', payload: { id: 'xxx', count: 5 } }

// Panel → Hook（用户命令）
{ source: 'tmap-panel', type: 'SET_TOOL', payload: { toolId: 'polygon' } }
```

#### 类型安全的实现方式

每一对（事件类型 + payload）都定义为 Discriminated Union：

```typescript
export type HookMessage =
  | { source: typeof HOOK_SOURCE; type: HookEvent.MAP_READY }
  | { source: typeof HOOK_SOURCE; type: HookEvent.POLYGON_DRAWN; payload: PolygonDrawnPayload }
  // ... 每种消息类型一行
```

接收方对 `msg.type` 做 `switch` 时，TypeScript 自动收窄类型，`msg.payload` 有精确的类型推导。

#### 发送函数

```typescript
// hook 层发消息给 panel
sendToPanel({ type: HookEvent.MAP_READY })

// panel 层发命令给 hook
sendToHook({ type: PanelCmd.SET_TOOL, payload: { toolId: 'polygon' } })
```

`source` 字段自动附加，调用方不需要关心。

#### 为什么用字符串枚举而非数字？

调试时在 Chrome DevTools → Sources → Event Listener Breakpoints 看不到数字的含义，但 `"POLYGON_DRAWN"` 一眼就知道是什么。

### 5.3 工具插件系统

#### ITool 接口

所有工具实现统一接口：

```typescript
export interface ITool {
  readonly id: string
  activate(ctx: ToolContext): void   // 激活，注入上下文，注册地图事件
  deactivate(): void                 // 停用，注销事件，清理临时状态
  reset(): void                      // 重置（清除覆盖物），但保持激活
  finish?(): void                    // 可选：锁定当前结果
  undo?(): void                      // 可选：撤销最后一步
}
```

#### ToolContext

`activate` 时注入，工具不自己管理 TMap 引用：

```typescript
interface ToolContext {
  map: any          // TMap.Map 实例，用于注册/注销地图事件
  overlays: OverlayManager  // 覆盖物管理，添加标记/线/多边形
}
```

#### ToolManager 生命周期

位于 `tool-manager.ts`，管理工具切换：

1. `setTool(toolId)` → 调用旧工具的 `deactivate()`
2. 判断新旧工具是否属于持久类型（多边形、打点标记——这些的数据切换后保留）
3. 非持久工具 → `overlays.clearMeasurement()` 清除临时覆盖物
4. 新工具 `activate(ctx)`，注入上下文

#### 添加新工具的步骤

1. 在 `src/shared/tool-config.ts` 的 `TOOL_CONFIGS` 数组和 `TOOL_IDS` 对象中添加条目
2. 在 `src/shared/protocol.ts` 中添加新事件枚举和 payload 接口
3. 在 `src/hook/tools/` 下创建工具文件，实现 `ITool` 接口
4. 在 `src/hook/tool-manager.ts` 的 `constructor` 中 `this.register(new XXXTool())`
5. 在 `src/hook/index.ts` 的消息 `switch` 中路由新的 `PanelCmd`
6. 在 `src/panel/components/tools/` 下添加面板组件
7. 在 `src/panel/composables/useTool.ts` 中添加状态管理和命令函数

### 5.4 OverlayManager (`overlay-manager.ts`)

覆盖物管理的核心类，封装了 TMap 的 Multi* 图层 API。

#### 设计要点

**懒加载**：每个图层（`MultiMarker`、`MultiPolyline`、`MultiPolygon`、`MultiLabel`、`RubberBand`）通过 `ensure*Layer()` 在第一次使用时才创建。避免在用户只测距时创建不需要的多边形图层（WebGL 上下文资源）。

**Upsert 模式**：每个几何体用 `_upsert()` 统一管理——tracking Map 有记录 → `updateGeometries`，没有 → `add`。测距时鼠标移动的实时预览依赖这个模式。

**可见性切换不 remove**：多边形和点位的显隐用 `hidden` 样式（`rgba(0,0,0,0)`），通过 `updateGeometries([{ id, styleId: 'hidden' }])` 实现。避免了 `remove + add` 的闪烁和性能问题。

**高亮管理**：`setPolygonHighlight(id)` 的做法——把前一个高亮的恢复 `default` 样式，新选中的设为 `highlight`，每次只更新最多 2 个几何体（O(1)）。

**多边形和点位图层是持久的**（`clearMeasurement()` 不清除），测距临时图层是临时的。这个设计让切工具时测距数据消失但已有的多边形和点位保留。

### 5.5 Panel 层设计

#### Shadow DOM CSS 隔离 (`panel/index.ts`)

```typescript
const host = document.createElement('div')
const shadow = host.attachShadow({ mode: 'open' })

// 手动注入 CSS（Vite ?inline 导入）
const style = document.createElement('style')
style.textContent = panelCss
shadow.appendChild(style)

// 在 shadow root 内挂载 Vue
const mountPoint = document.createElement('div')
shadow.appendChild(mountPoint)
createApp(VueApp).mount(mountPoint)
```

Shadow DOM 确保外部页面 CSS 不影响面板，面板 CSS 也不泄露到页面。

#### 白名单机制

面板通过 `chrome.storage.local` 读取白名单域名列表，只在匹配的域名上挂载 UI。默认白名单包含 `lbs.qq.com`。监听 `chrome.storage.onChanged` 实时同步——修改白名单后所有已打开的 tab 自动挂载/卸载。

#### useMapBridge：消息通信 Composable

```typescript
const handlers: Handler[] = []  // 模块级
let listenerInstalled = false

function ensureListener() {
  if (listenerInstalled) return
  window.addEventListener('message', onMessage)
  listenerInstalled = true
}

export function useMapBridge() {
  const onHookEvent = (handler) => {
    ensureListener()
    handlers.push(handler)
    onUnmounted(() => {
      handlers.splice(handlers.indexOf(handler), 1)
    })
  }
  // ...
}
```

**关键设计**：`window.addEventListener` 是模块级单例，只注册一次。每个使用此 composable 的组件通过 `handlers` 数组分发消息。避免 Vue 多次挂载导致的重复监听。

#### 消息同步时序

加载顺序可能是 hook 先跑完（`document_start`）→ panel 之后才挂载（`document_idle`）。如果 hook 在 panel 挂载前就发送了 `MAP_READY`，panel 就会丢失这条消息。

解决方式：panel 挂载时发送 `PANEL_READY` → hook 收到后调用 `toolManager.replayMapReady()` → 如果 map 已就绪，重新发送 `MAP_READY`。

### 5.6 构建系统

三个独立的 Vite 配置，对应三个入口：

| 配置文件 | 入口 | 产物 | 运行环境 |
|---|---|---|---|
| `vite.config.hook.ts` | `src/hook/index.ts` | `dist/hook.iife.js` | MAIN world |
| `vite.config.panel.ts` | `src/panel/index.ts` | `dist/panel.iife.js` | ISOLATED world |
| `vite.config.popup.ts` | popup 逻辑 | `dist/popup.iife.js` | 扩展弹窗 |

**关键配置项**：

```typescript
// 每个 vite config 都要设置这两项
build: {
  emptyOutDir: false,             // 不能清空 dist，否则后构建的会删掉先构建的文件
  lib: { formats: ['iife'] },    // 浏览器 content script 必须用 IIFE
  rollupOptions: {
    output: { inlineDynamicImports: true },  // IIFE 必须内联所有 import
  },
  minify: false,                  // 开发阶段不压缩，方便调试
}
```

**Panel 特有配置**：

```typescript
// Vue 运行时会检查 process.env.NODE_ENV，IIFE 中没有 process 全局变量
define: { 'process.env.NODE_ENV': JSON.stringify('production') }
```

**路径别名**：在 `tsconfig.json` 和每个 `vite.config.*.ts` 中都配置了：

```json
"paths": {
  "@shared/*": ["./src/shared/*"],
  "@hook/*": ["./src/hook/*"],
  "@panel/*": ["./src/panel/*"]
}
```

---

## 六、开发流程

### 6.1 环境准备

```bash
# 需要 Node.js 18+
node --version

# 安装依赖（只有 devDependencies）
npm install
```

### 6.2 开发模式

```bash
npm run dev
```

这会启动 `concurrently`，同时运行三个 watch 进程（hook + panel + popup）。修改 `src/` 下任何文件，对应脚本自动重新构建。

### 6.3 构建

```bash
npm run build
# 实际执行：copy-assets → build:hook → build:panel → build:popup
```

产物在 `dist/` 目录。

### 6.4 加载到 Chrome

1. 打开 `chrome://extensions`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择项目的 `dist/` 目录
5. 打开任何使用了 TMap 的页面（如 `lbs.qq.com` 的示例页面）

**热更新**：修改 hook/panel 代码后重新构建，然后在 `chrome://extensions` 页面点击扩展的刷新按钮 🔄，再刷新目标页面即可看到效果。不支持真正的 HMR。

### 6.5 调试技巧

**Hook 层调试**：
- 打开目标页面的 DevTools → Console
- 在设置面板中开启「调试日志」
- 或者在 Console 中执行 `localStorage.__tmh_settings__ = '{"debug":true}'` 然后刷新

**消息追踪**：
- DevTools → Sources → 左侧 Global Listeners → message 事件 → 可看到每次 postMessage

**未压缩产物**：`minify: false` 意味着 `dist/` 中的代码是可读的，可以直接在 Sources 面板打断点调试。

---

## 七、常见陷阱

### 7.1 不要在 ISOLATED world 里访问 TMap

panel 层跑在隔离世界。`window.TMap` 在 panel 里是 `undefined`。必须通过 `sendToHook` → hook 层 → hook 层访问 TMap → `sendToPanel` 回传结果。

### 7.2 Prototype patch 记得还原

`map-bridge.ts` 里捕获到 map 实例后立刻还原 wrapper。如果忘了还原，每次 `map.on()` 调用都会触发 `onCapture`（虽然幂等但有无谓的函数调用）。

### 7.3 postMessage 的 source 字段

页面自身也可能使用 `postMessage`。必须通过 `source` 字段过滤——只处理 `'tmap-hook'` 和 `'tmap-panel'` 的消息。否则可能误处理页面的 postMessage。

### 7.4 emptyOutDir: false

如果把这个设为 `true`，每次构建都会清空 `dist/`，后构建的脚本会删掉先构建的。必须 `false`。

### 7.5 Shadow DOM 内的 Vue Devtools

默认情况下 Vue Devtools 检测不到 Shadow DOM 内的 Vue 实例。可以安装 Vue Devtools 的 beta 版本，或使用 `console.log` 调试。

### 7.6 TMap 坐标顺序

TMap 的坐标格式是 `{lat: 纬度, lng: 经度}`——纬度在前，经度在后。和高德、百度相反。这是 TMap API 文档白纸黑字写的，但还是最容易搞反的地方。

### 7.7 持久工具 vs 临时工具

多边形和打点标记是持久工具（`PERSISTENT_TOOLS` 集合），切换工具时不会清除数据。两点/多点测距是临时工具，切走就清。这个设计在 `ToolManager.setTool()` 中体现——添加新工具时要注意声明自己的持久性。

---

## 八、从哪开始读代码

推荐阅读顺序：

| 序号 | 文件 | 为什么 |
|---|---|---|
| 1 | `manifest.json` | 理解入口点 |
| 2 | `src/hook/index.ts` | Hook 层入口，消息路由总览 |
| 3 | `src/shared/protocol.ts` | 理解所有消息类型 |
| 4 | `src/shared/tool-config.ts` | 理解有哪些工具 |
| 5 | `src/hook/tools/types.ts` | 理解 ITool 接口 |
| 6 | `src/hook/map-bridge.ts` | 理解 TMap 探测机制 |
| 7 | `src/hook/tool-manager.ts` | 理解工具切换逻辑 |
| 8 | `src/hook/overlay-manager.ts` | 理解覆盖物管理 |
| 9 | `src/hook/tools/two-point.ts` | 最简单的工具，理解 ITool 实现模式 |
| 10 | `src/panel/index.ts` | 理解 Shadow DOM 挂载 |
| 11 | `src/panel/composables/useMapBridge.ts` | 理解面板侧消息桥接 |
| 12 | `src/panel/composables/useTool.ts` | 理解状态管理 |
| 13 | `src/panel/App.vue` | 理解 UI 结构 |

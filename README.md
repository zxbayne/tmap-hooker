# TMap Hooker

一个 Chrome Manifest V3 浏览器扩展，用于在访问使用腾讯地图（TMap JS GL SDK）的第三方网站时，提供测距和多边形绘制辅助工具。

## 功能

| 工具 | 说明 |
|---|---|
| **两点测距** 📏 | 在地图上点击两个点，计算并显示球面（Haversine）距离 |
| **多点测距** 📐 | 连续点击多个点，实时显示每段距离和折线总距离，支持撤销 |
| **绘制多边形** ⬡ | 点击地图打点绘制多边形，或直接输入坐标；支持多个多边形共存、点击选中、删除 |

**其他特性：**
- 面板可折叠为小球，不干扰正常浏览
- 设置面板提供调试日志开关
- 面板可拖拽自由定位
- 状态（折叠、设置）持久化到 `localStorage`

---

## 架构概述

扩展由两个独立的内容脚本组成，通过 `window.postMessage` 通信：

```
┌─────────────────────────────────────────────────────────────────┐
│                         第三方网页                               │
│                                                                 │
│  ┌──────────────────────┐      window.postMessage               │
│  │   hook.iife.js       │◄────────────────────────────────────┐ │
│  │  (MAIN world)        │                                     │ │
│  │                      │  window.postMessage                 │ │
│  │  • 访问 window.TMap  │────────────────────────────────────►│ │
│  │  • Prototype hook    │                                     │ │
│  │  • OverlayManager    │                                     │ │
│  │  • ToolManager       │         ┌───────────────────────┐  │ │
│  └──────────────────────┘         │   panel.iife.js       │  │ │
│                                   │  (ISOLATED world)     │  │ │
│  window.TMap（TMap SDK）          │                       │  │ │
│                                   │  • Vue 3 面板 UI      │◄─┘ │
│                                   │  • Shadow DOM 隔离    │    │
│                                   │  • useTool composable │    │
│                                   └───────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

**关键设计决策：**

- **MAIN world**：hook 脚本通过 `manifest.json` 中 `"world": "MAIN"` 运行在页面主上下文，可直接访问 `window.TMap`
- **双重探测策略**：setter trap（TMap 晚加载时捕获赋值）+ 200ms 轮询（TMap 已加载时直接 patch）
- **Prototype Hook**：patch `TMap.Map.prototype` 上的方法（getCenter、on、off 等），在任意方法调用时捕获 map 实例
- **Shadow DOM**：面板 UI 通过 Shadow DOM 挂载，与页面 CSS 完全隔离

---

## 目录结构

```
tmap-hooker/
├── manifest.json          # Chrome 扩展清单（MV3）
├── public/icons/          # 扩展图标
├── src/
│   ├── hook/              # Hook 层（MAIN world 脚本）
│   │   ├── index.ts       # 入口：初始化、消息路由
│   │   ├── logger.ts      # 可开关的调试日志
│   │   ├── map-bridge.ts  # TMap 探测与 prototype 劫持
│   │   ├── overlay-manager.ts  # 地图覆盖物管理（标记/线/标签/多边形）
│   │   ├── tool-manager.ts     # 工具注册与生命周期管理
│   │   └── tools/
│   │       ├── types.ts        # ITool 接口、ToolContext 等类型
│   │       ├── two-point.ts    # 两点测距工具
│   │       ├── multi-point.ts  # 多点测距工具
│   │       └── polygon.ts      # 多边形绘制工具
│   ├── panel/             # Panel 层（ISOLATED world + Vue 3）
│   │   ├── index.ts       # Shadow DOM 创建与 Vue 挂载
│   │   ├── App.vue        # 根组件（折叠/展开、拖拽、设置）
│   │   ├── composables/
│   │   │   ├── useMapBridge.ts # postMessage 收发封装
│   │   │   └── useTool.ts      # 响应式工具状态管理
│   │   ├── components/    # UI 组件
│   │   └── style/panel.css
│   └── shared/            # Hook 和 Panel 共享的类型与工具
│       ├── protocol.ts    # 消息枚举、payload 类型、发送函数
│       ├── tool-config.ts # 工具元数据（id、名称、图标）
│       └── utils/
│           ├── distance.ts    # Haversine 公式、距离格式化
│           └── parse-coords.ts # 坐标字符串解析（两种格式）
├── vite.config.hook.ts    # Hook 层构建配置（IIFE）
└── vite.config.panel.ts   # Panel 层构建配置（IIFE + Vue）
```

---

## 开发环境

**要求：** Node.js 18+

```bash
# 安装依赖
npm install

# 启动开发模式（双 watch，修改文件自动重新构建）
npm run dev
```

---

## 构建与安装

```bash
# 构建生产版本
npm run build
```

构建产物在 `dist/` 目录：
- `hook.iife.js` — Hook 脚本（~28 KB）
- `panel.iife.js` — Panel UI（~235 KB）
- `manifest.json` — 扩展清单
- `icons/` — 扩展图标

**加载到 Chrome：**

1. 打开 `chrome://extensions`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」，选择 `dist/` 目录
4. 访问任何使用 TMap 的网站，面板会自动出现

---

## 扩展新工具

扩展架构支持通过 ITool 接口插件化地添加新工具，无需修改核心代码：

1. 在 `src/shared/tool-config.ts` 中添加工具元数据（id、名称、图标）
2. 在 `src/shared/protocol.ts` 中添加所需的事件/命令枚举和 payload 类型
3. 在 `src/hook/tools/` 中实现 `ITool` 接口（`activate / deactivate / reset`）
4. 在 `src/hook/tool-manager.ts` 的 constructor 中注册新工具
5. 在 `src/panel/components/tools/` 中添加对应的结果展示组件
6. 在 `src/panel/composables/useTool.ts` 中处理新事件和状态

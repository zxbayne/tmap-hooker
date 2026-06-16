# v1.6.0 统一图层列表 PRD

## 1. 背景与问题

### 1.1 当前状态

tmap-hooker 目前有四类"图层"数据，但它们的生命周期管理方式**不统一**：

| 类型 | 持久化 | 命名 | 显隐 | 选中高亮 | 列表展示 |
|------|--------|------|------|----------|----------|
| 多边形 (polygon) | ✅ 保留 | ✅ | ✅ | ✅ | ✅ 图层列表 |
| 圆形 (circle) | ✅ 保留 | ✅ | ✅ | ✅ | ✅ 同上列表 |
| 打点标记 (point-marker) | ✅ 保留 | ✅ | ✅ | ✅ | ✅ 点标记列表 |
| 测距线段 (measure segments) | ❌ 切工具即清 | ❌ 无 | ❌ 无 | ❌ 无 | ❌ 仅实时数值 |
| **两段测距 (two-point)** | ❌ 切工具即清 | — | — | — | — |

**核心问题**：测距结果是"一次性"的——用户在地图上量了一段距离，切到多边形工具后，刚才量的线就消失了。如果用户需要以后回看，只能截图。

### 1.2 目标

**把测距线段也变成"图层"的一等公民**：和多边形、圆形、打点标记一样，可命名、可显隐、可选择高亮、永久保留直到手动删除。

## 2. 功能范围

### 2.1 核心变更

#### 2.1.1 MultiPoint 测距线段 → 图层化

- 用户测量完成后（双击/Escape），生成的线段集作为一个"图层"保留
- 图层出现在统一图层列表中
- 默认名：`线段 N`（N 为自增序号）
- 可重命名
- 可切换显隐（隐藏后地图上对应线段消失，重新显示后恢复）
- 可选中高亮（选中后对应线段高亮，其他线段不变；点击其他图层取消选中）
- 可删除
- **可编辑**：点击 ✏️ 进入编辑模式
  - 每个折点显示可拖拽手柄
  - 拖动任意折点 → 实时更新线段路径 + 段距离标签
  - 点击「完成」提交，「取消」恢复

#### 2.1.2 圆形「开始绘制」按钮 + 拖拽交互

- 切到圆形工具后，需先点击「开始绘制」按钮才能绘制（和多边形「开始绘制」一致）
- 绘制前（idle 状态）：地图点击无反应，按钮显示「开始绘制圆形」
- 绘制中：
  - **mousedown** 在地图上 → 放置圆心，开始拖拽
  - **mousemove**（拖拽中）→ 半径 = 圆心到鼠标的距离，实时生成预览圆（橡皮筋效果）
  - **mouseup** → 定下半径，面板显示滑块可微调
  - 按钮变为「完成」「取消」
- 快捷键：Escape 取消绘制，回到 idle
- 完成：preview → 正式图层，入统一列表
- 取消：清除预览，回到 idle

#### 2.1.3 圆形支持编辑

- 在图层列表中点击圆形的 ✏️（编辑按钮）进入编辑模式
- 编辑模式下：
  - 地图上显示圆心拖拽手柄（可拖动改圆心位置）
  - 面板显示半径滑块 + 拟合点数滑块
  - 每次拖动/滑块变化 → 实时重新生成多边形预览
- 点击「完成」→ 提交新参数，更新多边形
- 点击「取消」→ 恢复编辑前的参数和图形
- 实现方式：参数化编辑（改圆心/半径/点数 → 重新 `_generatePoints` → `updatePolygon`），不走顶点级编辑

#### 2.1.4 统一图层列表

用一个**统一列表**替代当前分散的 "多边形图层列表" 和 "点标记列表"：

```
── 图层 (4) ──────────────────── [+]
  🔷 多边形-1         👁 ✏️ 🗑
  ⭕ 圆形-2           👁 ✏️ 🗑
  📏 线段-1           👁 ✏️ 🗑
  📍 标记-1           👁 ✏️ 🗑
```

每行显示：**类型图标 + 名称 + 操作按钮**。操作包括：
- 👁 显隐切换
- ✏️ 编辑（多边形→顶点编辑 / 圆形→参数化编辑 / 测距线段→折点拖动 / 打点标记→不支持）
- 🗑 删除

### 2.2 范围外（不做）

- 图层拖拽排序
- 图层分组
- 图层导出
- 测量线段编辑（拖动中间节点改变路径）

## 3. 详细设计

### 3.1 数据模型

新增 `MeasureLayer` 接口（`src/shared/protocol.ts`）：

```typescript
export interface MeasureLayer {
  /** 唯一标识，如 'measure-1', 'twopoint-1' */
  id: string
  /** 类型 */
  type: 'measure'
  /** 图层名称（用户可编辑） */
  name: string
  /** 是否可见 */
  visible: boolean
  /** 是否选中高亮 */
  selected: boolean
  /** 线段组：每个元素是一条 sub-path 的顶点数组 */
  paths: LatLng[][]
  /** 每段距离（米），与 paths 一一对应 */
  segmentDistances: number[]
  /** 总距离（米） */
  totalDistance: number
}
```

合并到统一的图层列表：

```typescript
// 现有多边形图层
export interface PolygonLayer { ... }

// 现有圆形信息（复用 PolygonLayer，circle 前缀 id）
// 现有打点标记
export interface PointMarkerItem { ... }

// 新增
export interface MeasureLayer { ... }
```

### 3.2 通信协议

新增 `PanelCmd` / `HookEvent`：

| 方向 | 命令 | 载荷 | 说明 |
|------|------|------|------|
| Panel → Hook | `RENAME_MEASURE` | `{ id, name }` | 重命名测量图层 |
| Panel → Hook | `TOGGLE_MEASURE_VISIBLE` | `{ id }` | 切换显隐 |
| Panel → Hook | `SELECT_MEASURE` | `{ id }` | 选中测量图层（触发高亮） |
| Panel → Hook | `DELETE_MEASURE` | `{ id }` | 删除测量图层 |
| Hook → Panel | `MEASURE_DRAWN` | `MeasureLayer` | 测量完成，新图层 |
| Hook → Panel | `MEASURE_VISIBILITY_CHANGED` | `{ id, visible }` | 显隐变更确认 |
| Hook → Panel | `MEASURE_SELECTED` | `{ id }` | 选中确认 |

### 3.3 Hook 层改动

#### 3.3.1 OverlayManager 新增测量图层管理

```
+ addMeasureLayer(id, paths, segmentDistances)
+ removeMeasureLayer(id)
+ setMeasureLayerVisible(id, visible)
+ setMeasureLayerHighlight(id, highlighted)
+ updateMeasureLabel(id, name)
```

测距线段渲染为 `TMap.MultiPolyline`：
- 默认样式：蓝色虚线 `#4A90D9`，`dashArray: [10, 6]`
- 选中高亮：橙色实线 `#FF6B35`，`dashArray: []`，线宽 +1px
- 距离标签：每段终点挂 `MultiMarker`，段距离文本（和当前测距标签一致）

#### 3.3.2 MultiPointTool 改动

- 当前 `finish()` 后数据只通过 `HookEvent.MEASUREMENT_COMPLETE` 发一次
- 新增：`finish()` 同时调用 `overlays.addMeasureLayer(...)`，再发 `HookEvent.MEASURE_DRAWN`
- `reset()` 不再清除**已完成的图层数据**，只清"正在测量中"的临时标记

#### 3.3.3 CircleTool 改动

- 新增 `circleMode: 'idle' | 'drawing' | 'placed'` 状态
  - `idle`：地图点击无响应
  - `drawing`：mousedown 放圆心 → mousemove 拖拽预览 → mouseup 定半径 → 进入 `placed`
  - `placed`：半径已定，面板滑块可微调，等待「完成」或「取消」
- 拖拽交互监听 `mousedown` / `mousemove` / `mouseup` 三个事件
- 拖拽过程中用 `TMap.geometry.computeDistance([center, mouse])` 计算实时半径
- 新增编辑模式：`enterEditMode(id, center, radius, nPoints)`
  - 圆心位置放可拖拽手柄（`TMap.MultiMarker`，draggable，填充蓝圆点图标）
  - 拖拽圆心 → 整个圆移动位置，实时预览
  - 面板同步显示半径滑块 + 拟合点数滑块
- 新增 `updateEditPreview(center, radius, nPoints)` → 实时刷新多边形
- 新增 `commitEdit()` / `cancelEdit()` → 提交或回滚

#### 3.3.4 ToolManager 改动

- 新增 `measureLayers: Map<string, MeasureLayer>` 存储
- 新增 `_onRenameMeasure`, `_onToggleMeasureVisible`, `_onSelectMeasure`, `_onDeleteMeasure` 处理器

### 3.4 Panel 层改动

#### 3.4.1 useTool.ts

新增状态和方法：

```typescript
// 状态
const measureLayers: Ref<MeasureLayer[]>

// 方法
function renameMeasure(id: string, name: string)
function toggleMeasureVisible(id: string)
function selectMeasure(id: string)
function deleteMeasure(id: string)
```

#### 3.4.2 新组件：LayerList.vue

统一图层列表组件，替代现有分散列表：

| 操作 | 交互 |
|------|------|
| 👁 显隐 | 点击切换眼睛图标（睁/闭） |
| ✏️ 重命名 | 点击弹出 inline 编辑框，回车确认 |
| 🗑 删除 | 点击弹出确认提示 |
| 选中 | 点击图层行主体，该图层高亮 |

排序规则：按创建时间倒序（最新的在上）。

快捷键：Shift + 点击 → 多选（仅"选中"操作，多选后不支持批量编辑）。

#### 3.4.3 改造现有组件

- **PolygonPanel.vue**：移除内部图层列表，改为复用 LayerList；编辑按钮触发编辑模式
- **PointPanel.vue**：移除内部点标记列表，改为复用 LayerList
- **CirclePanel.vue**：新增「开始绘制」按钮（idle/drawing 状态切换）；编辑模式下显示半径+点数滑块；完成后自动入列表
- **MultiPointResult.vue**：测量完成后自动入列表
- **ResultPanel.vue**：路由到 LayerList

### 3.5 兼容性

- 原有 `PolygonLayer[]`、`PointMarkerItem[]` 数据格式**不变**
- `useTool` 中同时维护 `polygonLayers`、`pointMarkers`、`measureLayers` 三个数组
- `LayerList` 组件接收联合列表，渲染时按类型区分图标

## 4. UI 规格

### 4.1 图层列表项

```
┌──────────────────────────────────────┐
│ 📏 线段-1                  👁 ✏️ 🗑  │  ← 未选中
│ 总长 1,234m · 3段                    │
├──────────────────────────────────────┤
│ 📏 线段-2                  👁 ✏️ 🗑  │  ← 选中（高亮底色）
│ 总长 5,678m · 4段                    │
├──────────────────────────────────────┤
│ ⭕ 圆形-1                  👁 ✏️ 🗑  │
│ 半径 500m · 面积 785,398m²          │
└──────────────────────────────────────┘
```

### 4.2 类型图标

| 类型 | 图标 | 副标题信息 |
|------|------|-----------|
| 多边形 (polygon) | 🔷 | 面积 xxx m² · N 个顶点 |
| 圆形 (circle) | ⭕ | 半径 xxx m · 面积 xxx m² |
| 测距线段 (measure) | 📏 | 总长 xxx · N 段 |
| 打点标记 (point-marker) | 📍 | lng, lat |

### 4.3 空状态

```
── 图层 (0) ────────────────────
  暂无图层，使用上方工具开始创建
```

## 5. 实现步骤

1. **CircleTool**：新增 idle/drawing 模式 + 开始按钮逻辑
2. **CirclePanel.vue**：新增「开始绘制」按钮 + 编辑模式 UI
3. **CircleTool 编辑**：圆心拖拽手柄 + 参数化编辑流程
4. **protocol.ts**：新增 `MeasureLayer` 接口 + 相关 `PanelCmd` / `HookEvent` + 线段编辑命令
5. **overlay-manager.ts**：新增测量图层渲染方法（MultiPolyline + 标签 + 编辑手柄）
6. **MultiPointTool**：`finish()` 生成图层 + 编辑模式（折点拖动）
7. **tool-manager.ts**：测量图层状态管理 + 命令路由 + 圆形编辑路由
8. **useTool.ts**：新增 `measureLayers` 状态 + 方法 + 圆形编辑方法
9. **LayerList.vue**：统一图层列表组件
10. **ResultPanel.vue**：集成 LayerList
11. **Panel 清理**：移除 PolygonPanel / PointPanel 内部分散列表
12. **构建 + 测试**

## 6. 验收标准

- [ ] 多点测距完成后，线段作为一个图层出现在列表中，切到其他工具不消失
- [ ] 图层列表中同时显示多边形、圆形、测距线段、打点标记
- [ ] 圆形需先点击「开始绘制」才能放圆心（idle 时地图点击无反应）
- [ ] 圆形可编辑：点击 ✏️ 进入编辑 → 拖动圆心 + 滑块调半径/点数 → 实时预览 → 完成/取消
- [ ] 多边形仍支持顶点编辑（和现有一致）
- [ ] 打点标记不支持编辑（✏️ 按钮置灰或隐藏）
- [ ] 测距线段编辑：拖动任意折点 → 路径 + 距离标签实时更新 → 完成/取消
- [ ] 点击 👁 可以隐藏/显示对应图层
- [ ] 点击 🗑 可以删除
- [ ] 点击图层行可以在选中/取消选中间切换（地图上同步高亮）
- [ ] 图层按创建时间倒序排列
- [ ] 空列表显示引导文案
- [ ] 主题切换不影响图层列表样式
- [ ] 页面刷新后图层列表清空（和现有多边形/点标记行为一致）

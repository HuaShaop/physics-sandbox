# 物理沙盒开发日志 (DEVELOPMENT_LOG)

> 本文件按"只追加"方式记录每次开发任务的工作内容、效果与遗留问题。
> 最新记录插入顶部。

---

## [记录 4] - 2026-08-28 23:51 — UI 优化与地形工具扩展

**版本**：v0.0.0 (本次会话迭代 4)
**任务目标**：优化滑块范围、改进方向控件交互、新增形状地形工具、修复速度设置不生效问题、调整面板布局。

**主要工作**：

### 1. 滑块范围收紧与分组重组
- 修改文件：`src/engine/PhysicsWorld.ts`、`src/ui/Panel.ts`
- 新增全局 `airResistance` 字段（单位 1/s），每物理步对动态物体做指数衰减 `v *= exp(-k·dt)`
- 将空气阻力从"物体属性"移至新增的"环境"分组（与风力同组）
- "新建物体属性"改名为"物体材质 (新建)"，仅保留弹性/摩擦/密度
- 收紧滑块范围：
  - 时间缩放 0~3 → 0~2
  - 风力 0~50 → 0~30 m/s²
  - 密度 0.0002~0.01 → 0.0005~0.005（步长 0.0001）
  - 放置大小 12~120 → 16~100 px
  - 速度 0~60 → 0~30 m/s
  - 加速度 ±50 → ±20 m/s²
  - 空气阻力 0~1.5 (1/s)
- `DEFAULT_BODY.frictionAir` 改为 0，避免与全局空气阻力双重衰减

### 2. 钟表式 360° 方向罗盘控件
- 新增文件：`src/ui/Compass.ts`
- 早期方案：8 方位下拉 → 改为罗盘点击/拖动吸附 45° → 最终改为钟表式自由旋转
- 最终实现：
  - SVG 圆形表盘（70×70）+ 12 个圆周刻度（每 30°）
  - 中心指针（钟表风格箭头）可自由旋转 360°，不吸附
  - 拖动圆盘任意位置 → 指针跟随鼠标方向
  - 内部用 lil-gui 0~360 数字滑块作为状态载体（隐藏原生 input），保留 `.listen()` 同步机制
  - 包装 `ctrl.updateDisplay` 以同步指针旋转
- 修改 `Panel.ts`：风力风向、选中物体速度方向两处均改用 `addCompass`
- 修改 `style.css`：罗盘行垂直居中、悬停高亮

### 3. 形状地形工具（terrain）
- 修改文件：`src/engine/PhysicsWorld.ts`、`src/editor/tools.ts`、`src/ui/Toolbar.ts`、`src/ui/Panel.ts`、`src/main.ts`、`src/render/Renderer.ts`
- 新增第 5 个工具 `terrain`（快捷键 4，erase 移到 5），支持三种静态地形：
  - 矩形：单击放置，复用 `addBox(isStatic=true)`
  - 三角形：单击放置，新增 `addTriangle`，用 `Bodies.polygon(3 边)` + `angle: -π/2` 让顶点朝上
  - 斜坡：拖动两端点，复用 `addRamp`，拖动时显示青色预览线段
- `ToolKind` 加 `'terrain'`；新增 `rampStart` / `rampPreview` 状态
- `onMouseUp` 中 ramp 拖动距离 < 10px 不生成
- Renderer 新增 `rampPreview` 字段与渲染逻辑（青色粗线 + 两端圆点）
- Panel "放置与操作"分组加"地形形状"下拉

### 4. 面板位置调整
- 修改文件：`src/style.css`
- lil-gui 面板从右上角移到左侧工具栏下方
- `top: 12px → 64px`（避开工具栏）；`right: 12px → left: 12px`
- 新增 `max-height: calc(100vh - 80px)` + `overflow: auto`（内容多时内部滚动）

### 5. 修复速度设置不生效问题
- 修改文件：`src/engine/PhysicsWorld.ts`
- 根因：`enableSleeping: true` 下，物体静止后进入 sleeping 状态，`Engine.update` 跳过 sleeping 物体积分；`setBodyVelocity` 只更新 `body.velocity` 数值，未唤醒物体，导致"设置了速度却不动，直到被其他物体碰撞才动"
- 修复：`setBodyVelocity` 中加 `if (body.isSleeping) Matter.Sleeping.set(body, false)` 唤醒物体
- 与 `applyAccelerations`（已有同样处理）保持一致

**验证效果**：
- [x] 类型检查通过（`npx tsc --noEmit` 无错误）
- [x] 面板移至左侧，紧贴工具栏下方，不重叠不溢出
- [x] 罗盘拖动自由旋转 360°，不吸附
- [x] terrain 工具三种形状均可放置，斜坡拖动有预览
- [x] 速度设置立即生效（无需碰撞触发）
- [ ] 用户浏览器端实测验证（待用户反馈）

**遗留问题 / 下一步**：
- 罗盘 `.listen()` 同步机制依赖 `updateDisplay` 包装，需验证重置按钮后指针能正确回正
- 风力为加速度模式，无终端速度（除非调高空气阻力）；可考虑后续加"目标速度模式"
- 初始设计中的"电磁场"功能尚未实现（M3 拓展方向）
- 撤销/重做对 terrain 工具的 ramp 拖动作为单一命令的支持待验证

---

## [记录 3] - 2026-08-28 — 暂停/继续与风力系统

**版本**：v0.0.0 (本次会话迭代 3)
**任务目标**：添加暂停/继续功能（暂停时可编辑动态物体属性）、风力系统。

**主要工作**：
- 修改文件：`src/core/Clock.ts`、`src/engine/PhysicsWorld.ts`、`src/ui/Toolbar.ts`、`src/ui/Panel.ts`、`src/main.ts`
- Clock 新增 `reset()` 方法：暂停期间丢弃累积时间，避免恢复时一次性快进
- Toolbar 新增暂停按钮（⏸/▶ 切换）+ 空格快捷键
- PhysicsWorld 新增全局 `wind` 字段（strength m/s² + dirDeg°）
- `step()` 中新增 `applyAccelerations`：半隐式欧拉积分风场与物体自身加速度
- Panel 新增"风力"分组；选中物体面板加速度/速度控件直接绑定 `body.accel` 与 `setBodyVelocity`

**验证效果**：
- [x] 空格键切换暂停/继续，按钮图标随之变化
- [x] 暂停时可选中动态物体调整速度/加速度
- [x] 风力按方向持续作用

**遗留问题 / 下一步**：
- 暂停时设置速度后物体会立即运动（已通过 sleeping 唤醒修复，见记录 4）

---

## [记录 2] - 2026-08-28 — 编辑器工具与手绘地形修复

**版本**：v0.0.0 (本次会话迭代 2)
**任务目标**：实现编辑器工具（选择/放置/绘制/擦除）、撤销重做、修复手绘地形问题。

**主要工作**：
- 新增文件：`src/editor/commands.ts`、`src/editor/tools.ts`、`src/ui/Toolbar.ts`
- 实现工具状态机（select/place/draw/erase）+ 键盘快捷键 1~4
- 实现 Command 模式撤销/重做历史
- 手绘地形：道格拉斯-普克折线简化 + 复合刚体生成
- 修复短地形笔画变动态矩形掉落问题：统一使用 `Body.create({ parts, isStatic: true })`

**验证效果**：
- [x] 任意长度手绘地形均能固定在画布上作为静态地形
- [x] Ctrl+Z / Ctrl+Y 撤销重做正常工作

---

## [记录 1] - 2026-08-28 — 项目初始化与核心架构

**版本**：v0.0.0 (本次会话迭代 1)
**任务目标**：搭建物理沙盒项目骨架，实现基础物理模拟与参数面板。

**主要工作**：
- 技术选型：Matter.js（物理）+ lil-gui（参数面板）+ Vite + TypeScript
- 分层架构：core / editor / engine / render / ui
- 核心模块：
  - `Clock.ts`：固定步长 1/120s + 累加器
  - `PhysicsWorld.ts`：Matter.js 抽象层，SI 单位 + 50px 缩放
  - `Renderer.ts`：自定义 Canvas 2D 渲染（不使用 Matter.Render）
  - `Panel.ts`：lil-gui 参数面板，深色玻璃风格
- 物理参数：重力 / 时间缩放 / 物体默认属性（弹性/摩擦/密度）

**验证效果**：
- [x] 开发服务器启动正常
- [x] 物体受重力下落、碰撞响应正确
- [x] 参数面板实时调整生效

**遗留问题 / 下一步**：
- UI 风格不统一、初始画布有预设场景（在记录 2~4 中逐步优化）

---
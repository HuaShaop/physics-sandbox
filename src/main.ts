import { Clock } from './core/Clock';
import { CommandHistory } from './editor/commands';
import { ToolManager, type ToolKind } from './editor/tools';
import { G_EARTH, PhysicsWorld, VELOCITY_TO_MS } from './engine/PhysicsWorld';
import { Renderer } from './render/Renderer';
import { createPanel } from './ui/Panel';
import { Toolbar } from './ui/Toolbar';
import './style.css';

// ---------- 初始化 ----------
const canvas = document.getElementById('stage') as HTMLCanvasElement;

const world = new PhysicsWorld(window.innerWidth, window.innerHeight, canvas);
const renderer = new Renderer(canvas, world);
const clock = new Clock(120); // 固定 120Hz 物理步长
world.setGravity(G_EARTH);

// 初始为空白场景：仅保留四周不可见边界，物体由用户自行放置

// ---------- 编辑器：命令历史 + 工具状态机 ----------
const history = new CommandHistory(world);
const tools = new ToolManager(world, history, canvas);

// ---------- 一键重置：清空场景 + 恢复默认参数 + 清空历史 ----------
function resetAll(): void {
  tools.deselect();
  history.clear();
  world.resetScene();
  world.resetParams();
}

// ---------- 暂停/继续 ----------
let paused = false;
function togglePause(): void {
  paused = !paused;
  toolbar.setPaused(paused);
  renderer.paused = paused;
}

// ---------- 工具栏 ----------
const toolbar = new Toolbar(
  document.body,
  (tool) => tools.setTool(tool),
  () => history.undo(),
  () => history.redo(),
  togglePause,
  resetAll,
);
tools.onToolChange = (tool) => toolbar.setActive(tool);
history.onChange = (canUndo, canRedo) => toolbar.updateHistoryButtons(canUndo, canRedo);

// ---------- 参数面板 ----------
const panel = createPanel(world, renderer, VELOCITY_TO_MS, {
  addBox: () =>
    world.addBox(80 + Math.random() * (renderer.width - 160), 60, world.placeSize, world.placeSize),
  addCircle: () =>
    world.addCircle(80 + Math.random() * (renderer.width - 160), 60, world.placeSize / 2),
  clear: () => world.clearDynamic(),
  deleteSelected: () => tools.deleteSelected(),
});

// ---------- 画布指针事件 → 工具状态机 ----------
let pointerDown = false;

function toCanvasPos(e: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

canvas.addEventListener('pointerdown', (e) => {
  pointerDown = true;
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* 合成事件（自动化测试）无活动指针，忽略 */
  }
  tools.onMouseDown(toCanvasPos(e));
});
canvas.addEventListener('pointermove', (e) => {
  tools.onMouseMove(toCanvasPos(e), pointerDown);
});
canvas.addEventListener('pointerup', (e) => {
  pointerDown = false;
  tools.onMouseUp();
  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch {
    /* 同上 */
  }
});

// ---------- 键盘快捷键 ----------
const TOOL_KEYS: Record<string, ToolKind> = {
  '1': 'select',
  '2': 'place',
  '3': 'draw',
  '4': 'terrain',
  '5': 'erase',
};

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (target.tagName === 'INPUT' || target.tagName === 'SELECT') return; // 面板输入时不响应

  const tool = TOOL_KEYS[e.key];
  if (tool) {
    tools.setTool(tool);
    return;
  }
  if (e.key === ' ') {
    e.preventDefault(); // 防止空格触发聚焦按钮的点击，导致双重切换
    togglePause();
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    tools.deleteSelected();
    return;
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) history.redo();
    else history.undo();
  } else if (e.ctrlKey && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    history.redo();
  }
});

// ---------- 主循环：固定步长物理 + rAF 渲染 ----------
let fps = 60;
let lastFpsTime = performance.now();
let frameCount = 0;

function loop(nowMs: number): void {
  clock.begin(nowMs);
  if (paused) clock.reset(); // 暂停期间丢弃累积时间，恢复时不快进
  else clock.consumeStep((dt) => world.step(dt));
  renderer.render(fps);

  // 同步编辑器状态到渲染层与面板
  renderer.selectedBody = tools.selectedBody;
  renderer.drawingPath = tools.drawingPath;
  renderer.rampPreview =
    tools.rampStart && tools.rampPreview
      ? { start: tools.rampStart, end: tools.rampPreview }
      : null;
  panel.updateBody(tools.selectedBody);

  frameCount++;
  if (nowMs - lastFpsTime >= 500) {
    fps = (frameCount * 1000) / (nowMs - lastFpsTime);
    frameCount = 0;
    lastFpsTime = nowMs;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------- 调试钩子（控制台可直接访问） ----------
Object.assign(window, { __world: world, __tools: tools });

// ---------- 窗口尺寸变化 ----------
window.addEventListener('resize', () => renderer.resize());

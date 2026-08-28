import type Matter from 'matter-js';
import type { PhysicsWorld } from '../engine/PhysicsWorld';
import { CommandHistory } from './commands';

/**
 * 编辑器工具状态机。
 * select  : 点选/拖拽物体（MouseConstraint 生效）
 * place   : 点击空白处放置物体
 * draw    : 手绘静态地形（折线简化后生成复合刚体）
 * erase   : 点击/划过删除物体与地形
 */
export type ToolKind = 'select' | 'place' | 'draw' | 'erase' | 'terrain';

export interface Pt {
  x: number;
  y: number;
}

/** 道格拉斯-普克折线简化：去除冗余采样点，降低地形碰撞体复杂度 */
export function simplify(points: Pt[], epsilon = 2): Pt[] {
  if (points.length <= 2) return points.slice();

  const perpDist = (p: Pt, a: Pt, b: Pt): number => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    // 点到直线的垂距
    return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / Math.sqrt(lenSq);
  };

  let maxDist = 0;
  let index = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplify(points.slice(0, index + 1), epsilon);
    const right = simplify(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

export class ToolManager {
  currentTool: ToolKind = 'select';
  /** 当前选中物体（select 工具） */
  selectedBody: Matter.Body | null = null;
  /** draw 工具正在绘制的折线（渲染预览用） */
  drawingPath: Pt[] = [];
  /** terrain-ramp 工具拖动中的起点与当前预览终点 */
  rampStart: Pt | null = null;
  rampPreview: Pt | null = null;
  private drawing = false;
  /** erase 连续擦除时的上一次位置 */
  private lastErasePos: Pt | null = null;
  private readonly world: PhysicsWorld;
  private readonly history: CommandHistory;
  private readonly canvas: HTMLCanvasElement;

  /** 工具切换 / 选中变化时通知外部（工具栏、面板、光标） */
  onToolChange?: (tool: ToolKind) => void;
  onSelectChange?: (body: Matter.Body | null) => void;

  constructor(world: PhysicsWorld, history: CommandHistory, canvas: HTMLCanvasElement) {
    this.world = world;
    this.history = history;
    this.canvas = canvas;
  }

  setTool(tool: ToolKind): void {
    if (this.currentTool === tool) return;
    // 切换工具时中断进行中的操作
    this.drawing = false;
    this.drawingPath = [];
    this.rampStart = null;
    this.rampPreview = null;
    this.currentTool = tool;

    // 仅 select 工具允许 MouseConstraint 抓取物体
    const mc = this.world.mouseConstraint;
    mc.collisionFilter.mask = tool === 'select' ? 0xffffffff : 0;
    if (tool !== 'select' && mc.constraint.bodyB) {
      this.world.releaseDraggedBody();
    }

    this.canvas.style.cursor =
      tool === 'select'
        ? 'default'
        : tool === 'draw' || tool === 'terrain'
          ? 'crosshair'
          : 'copy';
    this.onToolChange?.(tool);
  }

  // ---------- 画布事件（坐标为逻辑像素） ----------

  onMouseDown(pos: Pt): void {
    switch (this.currentTool) {
      case 'select': {
        const hit = this.world.bodyAt(pos.x, pos.y);
        this.selectedBody = hit && hit.label !== 'wall' ? hit : null;
        this.onSelectChange?.(this.selectedBody);
        break;
      }
      case 'place':
        this.placeAt(pos);
        break;
      case 'draw':
        this.drawing = true;
        this.drawingPath = [pos];
        break;
      case 'erase':
        this.eraseAt(pos);
        this.lastErasePos = pos;
        break;
      case 'terrain':
        this.placeTerrainAt(pos);
        break;
    }
  }

  onMouseMove(pos: Pt, isDown: boolean): void {
    if (!isDown) return;
    switch (this.currentTool) {
      case 'draw': {
        // 采样距离阈值，避免点过密
        const last = this.drawingPath[this.drawingPath.length - 1];
        if (!last || Math.hypot(pos.x - last.x, pos.y - last.y) > 8) {
          this.drawingPath.push(pos);
        }
        break;
      }
      case 'terrain': {
        // 仅 ramp 模式需要拖动预览
        if (this.rampStart) this.rampPreview = pos;
        break;
      }
      case 'erase': {
        // 快速划动时沿线段插值采样，避免漏删
        const from = this.lastErasePos ?? pos;
        const dist = Math.hypot(pos.x - from.x, pos.y - from.y);
        const steps = Math.max(1, Math.ceil(dist / 10));
        for (let i = 1; i <= steps; i++) {
          this.eraseAt({
            x: from.x + ((pos.x - from.x) * i) / steps,
            y: from.y + ((pos.y - from.y) * i) / steps,
          });
        }
        this.lastErasePos = pos;
        break;
      }
    }
  }

  onMouseUp(): void {
    if (this.currentTool === 'draw' && this.drawing) {
      this.drawing = false;
      const simplified = simplify(this.drawingPath, 2);
      this.drawingPath = [];
      const stroke = this.world.addStroke(simplified);
      if (stroke) this.history.addBody(stroke);
    }
    if (this.currentTool === 'terrain' && this.rampStart && this.rampPreview) {
      const a = this.rampStart;
      const b = this.rampPreview;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      if (dist > 10) {
        const ramp = this.world.addRamp(a.x, a.y, b.x, b.y);
        this.history.addBody(ramp);
      }
    }
    this.rampStart = null;
    this.rampPreview = null;
    this.lastErasePos = null;
  }

  /** 删除选中物体（Delete 键 / 面板按钮） */
  deleteSelected(): boolean {
    if (!this.selectedBody) return false;
    const body = this.selectedBody;
    this.selectedBody = null;
    this.onSelectChange?.(null);
    this.world.removeBody(body);
    this.history.deleteBody(body);
    return true;
  }

  /** 取消选中并清理瞬时状态（重置时调用，不产生历史记录） */
  deselect(): void {
    this.selectedBody = null;
    this.drawing = false;
    this.drawingPath = [];
    this.rampStart = null;
    this.rampPreview = null;
    this.lastErasePos = null;
    this.onSelectChange?.(null);
  }

  // ---------- 内部操作 ----------

  private placeAt(pos: Pt): void {
    if (this.world.bodyAt(pos.x, pos.y)) return; // 已有物体处不放置
    const s = this.world.placeSize;
    const body =
      this.world.placeKind === 'circle'
        ? this.world.addCircle(pos.x, pos.y, s / 2)
        : this.world.addBox(pos.x, pos.y, s, s);
    this.history.addBody(body);
  }

  /** terrain 工具：根据 terrainKind 放置静态地形；ramp 模式记录起点等待拖动 */
  private placeTerrainAt(pos: Pt): void {
    const kind = this.world.terrainKind;
    if (kind === 'ramp') {
      this.rampStart = pos;
      this.rampPreview = pos;
      return;
    }
    if (this.world.bodyAt(pos.x, pos.y)) return; // 已有物体处不放置
    const s = this.world.placeSize;
    const body =
      kind === 'triangle'
        ? this.world.addTriangle(pos.x, pos.y, s)
        : this.world.addBox(pos.x, pos.y, s, s, true);
    this.history.addBody(body);
  }

  /** 删除指定位置命中的可删除物体；返回是否删除成功 */
  private eraseAt(pos: Pt): boolean {
    const hit = this.world.bodyAt(pos.x, pos.y);
    if (!hit || hit.label === 'wall') return false;
    if (this.selectedBody === hit) {
      this.selectedBody = null;
      this.onSelectChange?.(null);
    }
    this.world.removeBody(hit);
    this.history.deleteBody(hit);
    return true;
  }
}

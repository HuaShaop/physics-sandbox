import Matter from 'matter-js';
import type { PhysicsWorld } from '../engine/PhysicsWorld';

/**
 * Canvas 2D 渲染器。
 * 不使用 Matter.Render，以便完全掌控视觉风格，
 * 并为后续矢量场可视化、轨迹追踪等留出空间。
 */
export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly world: PhysicsWorld;
  private readonly ctx: CanvasRenderingContext2D;
  private dpr: number;

  /** 调试可视化开关 */
  showVelocity = true;
  /** 暂停状态（仅影响 HUD 提示，渲染始终进行） */
  paused = false;

  /** 编辑器状态（每帧由 main 同步）：选中物体与绘制中的折线 */
  selectedBody: Matter.Body | null = null;
  drawingPath: Array<{ x: number; y: number }> = [];
  /** terrain-ramp 工具拖动中的预览线段（两点） */
  rampPreview: { start: { x: number; y: number }; end: { x: number; y: number } } | null = null;

  constructor(canvas: HTMLCanvasElement, world: PhysicsWorld) {
    this.canvas = canvas;
    this.world = world;
    this.ctx = canvas.getContext('2d')!;
    this.dpr = window.devicePixelRatio || 1;
    this.resize();
  }

  /** 按 CSS 尺寸 × dpr 设置画布物理分辨率；逻辑坐标保持 CSS 像素 */
  resize(): void {
    const { canvas } = this;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    this.dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * this.dpr);
    canvas.height = Math.round(h * this.dpr);
  }

  get width(): number {
    return this.canvas.clientWidth;
  }

  get height(): number {
    return this.canvas.clientHeight;
  }

  render(fps: number): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.drawBackground();
    this.drawBodies();
    this.drawAnnotations();
    this.drawSelection();
    this.drawPreview();
    this.drawMouseConstraint();
    this.drawHud(fps);
  }

  /** 选中物体：金色发光描边 */
  private drawSelection(): void {
    const body = this.selectedBody;
    if (!body || !this.world.bodies.includes(body)) return;
    const { ctx } = this;

    ctx.save();
    ctx.shadowColor = 'rgba(251, 191, 36, 0.9)';
    ctx.shadowBlur = 12;
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (body.circleRadius) {
      ctx.arc(body.position.x, body.position.y, body.circleRadius, 0, Math.PI * 2);
    } else {
      const verts = body.vertices;
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
      ctx.closePath();
    }
    ctx.stroke();
    ctx.restore();
  }

  /** 物体文字标注：显示在物体上方（用户在面板中设置） */
  private drawAnnotations(): void {
    const { ctx } = this;
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const body of this.world.bodies) {
      const text = body.annotation;
      if (!text) continue;
      const halfH = body.circleRadius ?? (body.bounds.max.y - body.bounds.min.y) / 2;
      const x = body.position.x;
      const y = body.position.y - halfH - 10;
      const w = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(10, 12, 18, 0.7)';
      ctx.fillRect(x - w / 2 - 5, y - 11, w + 10, 16);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(text, x, y);
    }
  }

  /** draw 工具的实时折线预览 + terrain-ramp 拖动预览 */
  private drawPreview(): void {
    const { ctx } = this;
    const path = this.drawingPath;
    if (path.length > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
      if (path.length === 1) ctx.lineTo(path[0].x + 0.1, path[0].y);
      ctx.stroke();

      // 端点标记
      ctx.fillStyle = '#fbbf24';
      const tip = path[path.length - 1];
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // terrain-ramp 拖动预览
    const ramp = this.rampPreview;
    if (ramp) {
      ctx.strokeStyle = 'rgba(126, 200, 227, 0.85)';
      ctx.lineWidth = 14;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ramp.start.x, ramp.start.y);
      ctx.lineTo(ramp.end.x, ramp.end.y);
      ctx.stroke();

      // 两端点
      ctx.fillStyle = '#7ec8e3';
      ctx.beginPath();
      ctx.arc(ramp.start.x, ramp.start.y, 5, 0, Math.PI * 2);
      ctx.arc(ramp.end.x, ramp.end.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawBackground(): void {
    const { ctx, width: w, height: h } = this;
    // 深色渐变背景
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#12141c');
    grad.addColorStop(1, '#1a1d28');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // 网格（50px = 1m，呼应 PPM）
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 50) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = 0; y <= h; y += 50) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
  }

  private drawBodies(): void {
    const { ctx } = this;
    for (const body of this.world.bodies) {
      const isStatic = body.isStatic;
      ctx.beginPath();
      if (body.circleRadius) {
        ctx.arc(body.position.x, body.position.y, body.circleRadius, 0, Math.PI * 2);
      } else {
        const verts = body.vertices;
        ctx.moveTo(verts[0].x, verts[0].y);
        for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
        ctx.closePath();
      }

      if (isStatic) {
        ctx.fillStyle = '#2c3040';
        ctx.fill();
        ctx.strokeStyle = '#4a5068';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        // 睡眠中的物体降饱和，直观展示 sleeping 机制
        const sleeping = body.isSleeping;
        ctx.fillStyle = sleeping ? '#3e4a5e' : '#3d7ea6';
        ctx.fill();
        ctx.strokeStyle = sleeping ? '#5a6a82' : '#7ec8e3';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // 质心参考点
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(body.position.x - 1.5, body.position.y - 1.5, 3, 3);

      if (!isStatic && this.showVelocity) this.drawVelocity(body);
    }
  }

  /** 速度矢量箭头（青色），长度按比例缩放 */
  private drawVelocity(body: Matter.Body): void {
    const { ctx } = this;
    const scale = 8; // 可视化放大系数
    const vx = body.velocity.x * scale;
    const vy = body.velocity.y * scale;
    const speed = Math.hypot(vx, vy);
    if (speed < 4) return;

    const { x, y } = body.position;
    const ex = x + vx;
    const ey = y + vy;

    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    // 箭头头部
    const angle = Math.atan2(vy, vx);
    const head = 6;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - head * Math.cos(angle - 0.4), ey - head * Math.sin(angle - 0.4));
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - head * Math.cos(angle + 0.4), ey - head * Math.sin(angle + 0.4));
    ctx.stroke();
  }

  private drawMouseConstraint(): void {
    const mc = this.world.mouseConstraint;
    const bodyB = mc.constraint.bodyB;
    if (!bodyB) return;
    const { ctx } = this;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(mc.constraint.pointA.x, mc.constraint.pointA.y);
    ctx.lineTo(bodyB.position.x, bodyB.position.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawHud(fps: number): void {
    const { ctx } = this;
    const count = this.world.bodies.filter((b) => !b.isStatic).length;
    let line = `FPS ${fps.toFixed(0)}  |  物体 ${count}  |  g = ${this.world.gravity.toFixed(1)} m/s²`;
    if (this.world.wind.strength > 0) {
      line += `  |  风 ${this.world.wind.strength.toFixed(1)} m/s² @${this.world.wind.dirDeg.toFixed(0)}°`;
    }
    if (this.paused) line += '  |  ⏸ 已暂停';

    ctx.font = '12px ui-monospace, Consolas, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.textAlign = 'left';
    ctx.fillText(line, 14, 22);
  }
}

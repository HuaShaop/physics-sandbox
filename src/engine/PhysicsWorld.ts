import Matter from 'matter-js';

/**
 * 物理引擎抽象封装层。
 *
 * 世界坐标采用"逻辑像素"（与 Canvas CSS 像素 1:1），
 * 重力等参数在面板上以 SI 单位（m/s²）显示，内部按标准重力换算。
 * 后续可在此接口之下替换为 Rapier 等引擎而不影响上层。
 */

/** 每米对应多少像素，用于单位换算显示 */
export const PPM = 50;
/** 标准重力加速度（m/s²），gravity(1x) 对应此值 */
export const G_EARTH = 9.8;

/** matter 速度单位为 px/(1/60 s)；乘以该系数换算为 m/s */
export const VELOCITY_TO_MS = 60 / PPM;

/** 新建物体的默认物理属性（面板可调） */
export interface BodyDefaults {
  restitution: number; // 弹性 0~1
  friction: number; // 摩擦 0~1
  frictionAir: number; // 空气阻力
  density: number; // 密度（Matter 默认 0.001）
}

export const DEFAULT_BODY: BodyDefaults = {
  restitution: 0.4,
  friction: 0.1,
  frictionAir: 0, // 全局空气阻力统一由 world.airResistance 处理，避免双重衰减
  density: 0.001,
};

export type ShapeKind = 'box' | 'circle';

export class PhysicsWorld {
  readonly engine: Matter.Engine;
  /** 全部物体（含静态） */
  private allBodies: Matter.Body[] = [];
  /** 新建物体使用的默认属性 */
  defaults: BodyDefaults = { ...DEFAULT_BODY };
  /** 点击画布空白处时放置的形状 */
  placeKind: ShapeKind = 'circle';
  /** 放置尺寸（px）：圆形为直径，方块为边长 */
  placeSize = 36;
  /** terrain 工具放置的静态地形形状 */
  terrainKind: 'box' | 'triangle' | 'ramp' = 'box';
  /** 全局风场：强度 (m/s²) 与方向（0°=向右，90°=向上） */
  readonly wind = { strength: 0, dirDeg: 0 };
  /** 全局空气阻力系数 (1/s)：每秒速度指数衰减率，0=真空无阻力 */
  airResistance = 0;
  /** 鼠标拖拽约束 */
  readonly mouseConstraint: Matter.MouseConstraint;

  private readonly width: number;
  private readonly height: number;

  constructor(width: number, height: number, canvas: HTMLCanvasElement) {
    this.width = width;
    this.height = height;
    this.engine = Matter.Engine.create({
      enableSleeping: true,
      gravity: { x: 0, y: 1, scale: 0.001 },
    });

    // 鼠标交互：pixelRatio=1，因为渲染层用逻辑像素坐标
    const mouse = Matter.Mouse.create(canvas);
    mouse.pixelRatio = 1;
    this.mouseConstraint = Matter.MouseConstraint.create(this.engine, {
      mouse,
      constraint: {
        stiffness: 0.2,
        render: { visible: false },
      },
    });
    Matter.Composite.add(this.engine.world, this.mouseConstraint);

    this.buildWalls();
  }

  // ---------- 场景构建 ----------

  /** 四周围墙（静态，不可删除） */
  private buildWalls(): void {
    const t = 60; // 墙厚
    const opts: Matter.IChamferableBodyDefinition = { isStatic: true, friction: 0.8, label: 'wall' };
    const walls = [
      Matter.Bodies.rectangle(this.width / 2, this.height + t / 2 - 2, this.width * 2, t, opts),
      Matter.Bodies.rectangle(this.width / 2, -t / 2, this.width * 2, t, opts),
      Matter.Bodies.rectangle(-t / 2, this.height / 2, t, this.height * 2, opts),
      Matter.Bodies.rectangle(this.width + t / 2, this.height / 2, t, this.height * 2, opts),
    ];
    walls.forEach((w) => this.add(w));
  }

  add(body: Matter.Body): void {
    this.allBodies.push(body);
    Matter.Composite.add(this.engine.world, body);
  }

  /** 从世界中移除物体（可被 restoreBody 恢复） */
  removeBody(body: Matter.Body): void {
    // 若正被鼠标拖拽，先松开
    if (this.mouseConstraint.constraint.bodyB === body) {
      this.releaseDraggedBody();
    }
    Matter.Composite.remove(this.engine.world, body);
    this.allBodies = this.allBodies.filter((b) => b !== body);
  }

  /** 松开鼠标拖拽中的物体（类型定义不含 null，运行时允许置空） */
  releaseDraggedBody(): void {
    const mc = this.mouseConstraint;
    mc.constraint.bodyB = null as unknown as Matter.Body;
    mc.body = null as unknown as Matter.Body;
  }

  /** 恢复之前移除的物体（撤销删除），静态标志保留不变 */
  restoreBody(body: Matter.Body): void {
    this.add(body);
  }

  /**
   * 手绘地形：把折线简化后生成静态复合刚体（每段一条粗线段）。
   * 返回整条地形对应的单个 body，便于整体撤销/删除。
   */
  addStroke(points: Array<{ x: number; y: number }>, thickness = 12): Matter.Body | null {
    if (points.length < 2) return null;
    const parts: Matter.Body[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 2) continue;
      const seg = Matter.Bodies.rectangle(
        (a.x + b.x) / 2,
        (a.y + b.y) / 2,
        len + thickness * 0.5, // 稍微延长避免接缝
        thickness,
        { angle: Math.atan2(b.y - a.y, b.x - a.x) },
      );
      parts.push(seg);
    }
    if (parts.length === 0) return null;

    // 统一用 Body.create 包一层：确保单段地形也被标记为静态
    // （否则短笔画会生成非静态矩形，受重力掉落）
    const stroke = Matter.Body.create({ parts, isStatic: true, friction: 0.5 });
    stroke.label = 'stroke';
    this.add(stroke);
    return stroke;
  }

  addBox(x: number, y: number, w = 40, h = 40, isStatic = false): Matter.Body {
    const d = this.defaults;
    const body = Matter.Bodies.rectangle(x, y, w, h, {
      isStatic,
      restitution: d.restitution,
      friction: d.friction,
      frictionAir: d.frictionAir,
      density: d.density,
      chamfer: { radius: Math.min(4, w / 4) }, // 轻微圆角减少堆叠抖动
      label: 'box',
    });
    this.add(body);
    return body;
  }

  addCircle(x: number, y: number, r = 20, isStatic = false): Matter.Body {
    const d = this.defaults;
    const body = Matter.Bodies.circle(x, y, r, {
      isStatic,
      restitution: d.restitution,
      friction: d.friction,
      frictionAir: d.frictionAir,
      density: d.density,
      label: 'circle',
    });
    this.add(body);
    return body;
  }

  /** 静态等边三角形：以 (x,y) 为重心，size 为外接圆直径，顶点朝上 */
  addTriangle(x: number, y: number, size: number, isStatic = true): Matter.Body {
    const body = Matter.Bodies.polygon(x, y, 3, size / 2, {
      isStatic,
      friction: 0.5,
      label: 'triangle',
      angle: -Math.PI / 2,
    });
    this.add(body);
    return body;
  }

  /** 静态斜坡：由两端点定义的粗线段 */
  addRamp(x1: number, y1: number, x2: number, y2: number, thickness = 14): Matter.Body {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const body = Matter.Bodies.rectangle((x1 + x2) / 2, (y1 + y2) / 2, len, thickness, {
      isStatic: true,
      friction: 0.5,
      angle,
    });
    this.add(body);
    return body;
  }

  /** 清除所有动态物体（保留边界） */
  clearDynamic(): void {
    for (const b of this.allBodies) {
      if (!b.isStatic) {
        Matter.Composite.remove(this.engine.world, b);
      }
    }
    this.allBodies = this.allBodies.filter((b) => b.isStatic);
  }

  /** 重置场景：移除所有非边界物体（动态物体、手绘地形、斜坡） */
  resetScene(): void {
    for (const b of this.allBodies) {
      if (b.label === 'wall') continue;
      if (this.mouseConstraint.constraint.bodyB === b) this.releaseDraggedBody();
      Matter.Composite.remove(this.engine.world, b);
    }
    this.allBodies = this.allBodies.filter((b) => b.label === 'wall');
  }

  /** 重置参数：重力、时间缩放、物体默认属性恢复默认值 */
  resetParams(): void {
    Object.assign(this.defaults, DEFAULT_BODY);
    this.placeKind = 'circle';
    this.placeSize = 36;
    this.terrainKind = 'box';
    this.wind.strength = 0;
    this.wind.dirDeg = 0;
    this.airResistance = 0;
    this.setGravity(G_EARTH);
    this.timeScale = 1;
  }

  // ---------- 参数调节 ----------

  /** 设置重力，单位 m/s²（以标准重力为 1 的倍率换算） */
  setGravity(g: number): void {
    this.engine.gravity.y = g / G_EARTH;
  }

  get gravity(): number {
    return this.engine.gravity.y * G_EARTH;
  }

  set timeScale(s: number) {
    this.engine.timing.timeScale = s;
  }

  get timeScale(): number {
    return this.engine.timing.timeScale;
  }

  /** 将默认属性应用到所有动态物体（面板勾选时） */
  applyDefaultsToAll(): void {
    const d = this.defaults;
    for (const b of this.allBodies) {
      if (b.isStatic) continue;
      b.restitution = d.restitution;
      b.friction = d.friction;
      b.frictionAir = d.frictionAir;
      Matter.Body.setDensity(b, d.density);
    }
  }

  // ---------- 选中物体属性编辑 ----------

  /** 设置动态物体速度（speed 单位 m/s；dir 单位 °，0°=向右、90°=向上） */
  setBodyVelocity(body: Matter.Body, speedMs: number, dirDeg: number): void {
    if (body.isStatic) return;
    const rad = (dirDeg * Math.PI) / 180;
    const v = speedMs / VELOCITY_TO_MS;
    // 必须唤醒物体，否则 enableSleeping 下引擎会跳过 sleeping 物体的积分，
    // 表现为“设置了速度却不动，直到被其他物体碰撞才动”
    if (body.isSleeping) Matter.Sleeping.set(body, false);
    Matter.Body.setVelocity(body, { x: Math.cos(rad) * v, y: -Math.sin(rad) * v });
  }

  // ---------- 查询与推进 ----------

  get bodies(): readonly Matter.Body[] {
    return this.allBodies;
  }

  /** 点是否落在某个物体上（用于点击放置 vs 拖拽的判定） */
  bodyAt(x: number, y: number): Matter.Body | undefined {
    const found = Matter.Query.point(this.allBodies, { x, y });
    return found[0];
  }

  /** 推进一个固定物理步长（秒）。timeScale 由引擎内部处理 */
  step(dtSeconds: number): void {
    this.applyAccelerations(dtSeconds);
    this.applyAirDrag(dtSeconds);
    Matter.Engine.update(this.engine, dtSeconds * 1000);
  }

  /** 全局空气阻力：对动态物体速度做指数衰减（与速度方向无关的阻尼） */
  private applyAirDrag(dtSeconds: number): void {
    if (this.airResistance <= 0) return;
    const damping = Math.exp(-this.airResistance * dtSeconds);
    for (const b of this.allBodies) {
      if (b.isStatic || b.isSleeping) continue;
      Matter.Body.setVelocity(b, {
        x: b.velocity.x * damping,
        y: b.velocity.y * damping,
      });
    }
  }

  /** 每步对动态物体施加风场与自身加速度（半隐式欧拉，直接叠加速度） */
  private applyAccelerations(dtSeconds: number): void {
    const rad = (this.wind.dirDeg * Math.PI) / 180;
    const wax = Math.cos(rad) * this.wind.strength;
    const way = -Math.sin(rad) * this.wind.strength;
    if (wax === 0 && way === 0 && !this.allBodies.some((b) => b.accel)) return;

    // matter 速度单位为 px/(1/60 s)：a(m/s²) × PPM → px/s²，× dt → px/s，÷60 → API 单位
    const dv = (PPM * dtSeconds) / 60;
    for (const b of this.allBodies) {
      if (b.isStatic) continue;
      const ax = wax + (b.accel?.x ?? 0);
      const ay = way + (b.accel?.y ?? 0);
      if (ax === 0 && ay === 0) continue;
      if (b.isSleeping) Matter.Sleeping.set(b, false);
      Matter.Body.setVelocity(b, { x: b.velocity.x + ax * dv, y: b.velocity.y + ay * dv });
    }
  }
}

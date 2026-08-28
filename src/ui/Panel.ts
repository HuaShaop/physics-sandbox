import GUI from 'lil-gui';
import Matter from 'matter-js';
import type { PhysicsWorld } from '../engine/PhysicsWorld';
import type { Renderer } from '../render/Renderer';
import { addCompass } from './Compass';

const TYPE_NAMES: Record<string, string> = {
  box: '方块',
  circle: '圆球',
  stroke: '手绘地形',
  wall: '边界',
};

export interface PanelHandle {
  gui: GUI;
  /**
   * 每帧由 main 调用。
   * 切换选中时重建"选中物体"分组，控制器直接绑定物体对象本身：
   * 拖动滑块 / 输入文字立即写入 body 属性，无中间代理。
   */
  updateBody(body: Matter.Body | null): void;
}

export function createPanel(
  world: PhysicsWorld,
  renderer: Renderer,
  velocityToMs: number,
  actions: {
    addBox: () => void;
    addCircle: () => void;
    clear: () => void;
    deleteSelected: () => void;
  },
): PanelHandle {
  const gui = new GUI({ title: '物理沙盒' });

  // ---- 世界参数 ----
  const worldParams = {
    gravity: world.gravity,
    timeScale: world.timeScale,
  };
  const worldFolder = gui.addFolder('世界参数');
  worldFolder
    .add(worldParams, 'gravity', 0, 30, 0.1)
    .name('重力 g (m/s²)')
    .onChange((v: number) => world.setGravity(v));
  worldFolder
    .add(worldParams, 'timeScale', 0, 2, 0.05)
    .name('时间缩放')
    .onChange((v: number) => (world.timeScale = v));
  worldFolder.add(renderer, 'showVelocity').name('显示速度矢量');

  // ---- 环境（全局作用力与介质） ----
  const envFolder = gui.addFolder('环境');
  envFolder.add(world.wind, 'strength', 0, 30, 0.5).name('风力强度 (m/s²)').listen();
  addCompass(envFolder, world.wind, 'dirDeg').name('风向').listen();
  envFolder.add(world, 'airResistance', 0, 1.5, 0.05).name('空气阻力 (1/s)').listen();

  // ---- 物体材质（新建物体默认） ----
  const bodyFolder = gui.addFolder('物体材质 (新建)');
  bodyFolder.add(world.defaults, 'restitution', 0, 1, 0.05).name('弹性');
  bodyFolder.add(world.defaults, 'friction', 0, 1, 0.05).name('摩擦');
  bodyFolder.add(world.defaults, 'density', 0.0005, 0.005, 0.0001).name('密度');
  bodyFolder.add({ apply: () => world.applyDefaultsToAll() }, 'apply').name('应用到所有物体');

  // ---- 放置与操作 ----
  const actionFolder = gui.addFolder('放置与操作');
  actionFolder
    .add(world, 'placeKind', { 圆形: 'circle', 方块: 'box' })
    .name('物体形状')
    .listen();
  actionFolder
    .add(world, 'terrainKind', { 矩形: 'box', 三角形: 'triangle', 斜坡: 'ramp' })
    .name('地形形状')
    .listen();
  actionFolder.add(world, 'placeSize', 16, 100, 2).name('放置大小 (px)').listen();
  gui.add(actions, 'addBox').name('随机添加方块');
  gui.add(actions, 'addCircle').name('随机添加圆');
  gui.add(actions, 'clear').name('清空动态物体');

  // ---- 选中物体：直接绑定物体对象 ----
  let selBody: Matter.Body | null = null;
  let selFolder: GUI | null = null;
  const disp = { label: '无', mass: 0, speed: 0 };

  const buildSelection = (body: Matter.Body | null): void => {
    selFolder?.destroy();
    selFolder = gui.addFolder('选中物体');
    selFolder.add(disp, 'label').name('类型').listen().disable();
    selFolder.add(disp, 'mass').name('质量').listen().disable();
    selFolder.add(disp, 'speed').name('速度 (m/s)').listen().disable();

    if (body) {
      // 标注：直接读写 body.annotation，渲染器每帧读取绘制
      if (body.annotation === undefined) body.annotation = '';
      selFolder.add(body, 'annotation').name('标注');
    }

    if (body && !body.isStatic) {
      // 速度：写回须经 setVelocity（同步 Verlet 积分的 positionPrev 内部状态）
      // 方向使用钟表式罗盘，0~360° 自由旋转
      const rawDir =
        (((Math.atan2(-body.velocity.y, body.velocity.x) * 180) / Math.PI) + 360) % 360;
      const vel = {
        mag: Math.hypot(body.velocity.x, body.velocity.y) / velocityToMs,
        dir: Math.round(rawDir),
      };
      const applyVel = (): void => world.setBodyVelocity(body, vel.mag, vel.dir);
      selFolder.add(vel, 'mag', 0, 30, 0.5).name('速度大小 m/s').onChange(applyVel);
      addCompass(selFolder, vel, 'dir').name('速度方向').onChange(applyVel);

      // 加速度：直接绑定 body.accel，物理引擎每个固定步读取并积分
      if (!body.accel) body.accel = { x: 0, y: 0 };
      selFolder.add(body.accel, 'x', -20, 20, 0.5).name('加速度x m/s² 右+');
      selFolder.add(body.accel, 'y', -20, 20, 0.5).name('加速度y m/s² 下+');
      selFolder
        .add(
          {
            clear: () => {
              body.accel!.x = 0;
              body.accel!.y = 0;
            },
          },
          'clear',
        )
        .name('加速度清零');

      // 材质：直接双向绑定；密度例外（须经 setDensity 联动更新质量）
      // 空气阻力归入"环境"分组，此处不再暴露
      selFolder.add(body, 'restitution', 0, 1, 0.05).name('弹性');
      selFolder.add(body, 'friction', 0, 1, 0.05).name('摩擦');
      const dens = { v: body.density };
      selFolder
        .add(dens, 'v', 0.0005, 0.005, 0.0001)
        .name('密度')
        .onFinishChange((v: number) => Matter.Body.setDensity(body, v));
    }

    selFolder.add({ del: () => actions.deleteSelected() }, 'del').name('删除选中 (Del)');
  };

  buildSelection(null);

  return {
    gui,
    updateBody(body) {
      if (body !== selBody) {
        selBody = body;
        buildSelection(body);
      }
      // 只读显示每帧刷新（配合 .listen() 实时更新）
      disp.label = body ? (TYPE_NAMES[body.label] ?? body.label) : '无';
      disp.mass = body?.mass ?? 0;
      disp.speed = body ? Math.hypot(body.velocity.x, body.velocity.y) * velocityToMs : 0;
    },
  };
}

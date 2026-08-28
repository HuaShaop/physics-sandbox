import type GUI from 'lil-gui';

export interface CompassController {
  name(label: string): this;
  listen(): this;
  onChange(cb: (v: number) => void): this;
  disable(): this;
  update(): void;
}

/**
 * 在 lil-gui 面板中注入一个钟表式 360° 方向选择器。
 *
 * - 圆形表盘 + 12 个圆周刻度（每 30°）
 * - 中心指针可拖动到任意角度（0~360°，0=右、90=上）
 * - 拖动圆盘任意位置即可旋转指针，不吸附
 *
 * 内部用 lil-gui 原生数字滑块 (0~360) 作为状态载体，
 * 仅隐藏 input/slider 并把 SVG 罗盘追加到 widget 容器。
 */
export function addCompass(
  gui: GUI,
  object: { [key: string]: unknown },
  property: string,
): CompassController {
  // 用 0~360 数字滑块作为状态载体（隐藏），保留 listen/updateDisplay
  const ctrl = gui.add(object, property, 0, 360, 1);
  const row = ctrl.domElement as HTMLElement;
  const widget = row.querySelector('.lil-widget') as HTMLElement | null;
  if (!widget) return ctrl as unknown as CompassController;

  // 隐藏原生 input/slider，保留容器
  Array.from(widget.children).forEach((child) => {
    (child as HTMLElement).style.display = 'none';
  });

  const SVGNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '-50 -50 100 100');
  svg.setAttribute('class', 'compass');
  svg.style.width = '70px';
  svg.style.height = '70px';
  svg.style.cursor = 'grab';
  svg.style.display = 'block';

  // 表盘
  const dial = document.createElementNS(SVGNS, 'circle');
  dial.setAttribute('cx', '0');
  dial.setAttribute('cy', '0');
  dial.setAttribute('r', '46');
  dial.setAttribute('fill', 'rgba(255,255,255,0.04)');
  dial.setAttribute('stroke', 'rgba(255,255,255,0.14)');
  svg.appendChild(dial);

  // 12 个圆周刻度（每 30°，钟表风格）
  for (let i = 0; i < 12; i++) {
    const rad = (i * 30 * Math.PI) / 180;
    const x1 = Math.cos(rad) * 41;
    const y1 = -Math.sin(rad) * 41;
    const x2 = Math.cos(rad) * 46;
    const y2 = -Math.sin(rad) * 46;
    const tick = document.createElementNS(SVGNS, 'line');
    tick.setAttribute('x1', String(x1));
    tick.setAttribute('y1', String(y1));
    tick.setAttribute('x2', String(x2));
    tick.setAttribute('y2', String(y2));
    tick.setAttribute('stroke', 'rgba(255,255,255,0.25)');
    tick.setAttribute('stroke-width', '1');
    svg.appendChild(tick);
  }

  // 指针（钟表风格：从中心向外的箭头）
  const needle = document.createElementNS(SVGNS, 'g');
  const line = document.createElementNS(SVGNS, 'line');
  line.setAttribute('x1', '0');
  line.setAttribute('y1', '0');
  line.setAttribute('x2', '30');
  line.setAttribute('y2', '0');
  line.setAttribute('stroke', '#7ec8e3');
  line.setAttribute('stroke-width', '3');
  line.setAttribute('stroke-linecap', 'round');
  const head = document.createElementNS(SVGNS, 'polygon');
  head.setAttribute('points', '30,0 22,-5 22,5');
  head.setAttribute('fill', '#7ec8e3');
  needle.appendChild(line);
  needle.appendChild(head);
  svg.appendChild(needle);

  // 中心圆点
  const hub = document.createElementNS(SVGNS, 'circle');
  hub.setAttribute('cx', '0');
  hub.setAttribute('cy', '0');
  hub.setAttribute('r', '4');
  hub.setAttribute('fill', '#7ec8e3');
  svg.appendChild(hub);

  widget.appendChild(svg);

  // ---- 同步指针角度 ----
  const sync = (): void => {
    const v = Number(object[property]) || 0;
    needle.setAttribute('transform', `rotate(${-v})`);
  };

  // 包装 ctrl.updateDisplay：lil-gui 同步 UI 时一并更新指针
  const origUpdate = ctrl.updateDisplay.bind(ctrl);
  ctrl.updateDisplay = () => {
    const r = origUpdate();
    sync();
    return r;
  };
  sync();

  // ---- 用户拖动 ----
  const callbacks: Array<(v: number) => void> = [];
  const setValue = (v: number): void => {
    const normalized = ((v % 360) + 360) % 360;
    if (Number(object[property]) === normalized) return;
    object[property] = normalized;
    sync();
    ctrl.updateDisplay();
    for (const cb of callbacks) cb(normalized);
  };

  // 拖动圆盘任意位置 → 指针指向鼠标方向（0~360°，不吸附）
  let dragging = false;
  const handle = (e: PointerEvent): void => {
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    if (Math.hypot(dx, dy) < 6) return; // 中心点附近忽略，避免抖动
    const ang = (((Math.atan2(-dy, dx) * 180) / Math.PI) + 360) % 360;
    setValue(ang);
  };
  svg.addEventListener('pointerdown', (e) => {
    dragging = true;
    svg.setPointerCapture(e.pointerId);
    svg.style.cursor = 'grabbing';
    handle(e);
    e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    if (dragging) handle(e);
  });
  const endDrag = (): void => {
    dragging = false;
    svg.style.cursor = 'grab';
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  return {
    name(s: string) {
      ctrl.name(s);
      return this;
    },
    listen() {
      ctrl.listen();
      return this;
    },
    onChange(cb: (v: number) => void) {
      callbacks.push(cb);
      return this;
    },
    disable() {
      ctrl.disable();
      svg.style.opacity = '0.4';
      svg.style.pointerEvents = 'none';
      return this;
    },
    update: sync,
  };
}

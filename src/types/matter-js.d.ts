import 'matter-js';

declare module 'matter-js' {
  interface Body {
    /** 用户为物体添加的文字标注（渲染在物体上方） */
    annotation?: string;
    /** 物体自身持续加速度（m/s²，屏幕坐标 y 向下为正），每物理步积分 */
    accel?: { x: number; y: number };
  }
}

/**
 * 固定步长时钟（累加器模式）。
 *
 * 物理推进使用固定 dt，保证不同刷新率显示器行为一致；
 * 渲染通过插值系数 alpha 平滑显示。
 */
export class Clock {
  /** 固定物理步长（秒） */
  readonly fixedDt: number;
  /** 累加器上限，防止后台切回时一次补算过多（如浏览器节流后） */
  private readonly maxFrameTime = 0.25;
  private accumulator = 0;
  private lastTime = 0;

  constructor(fps = 120) {
    this.fixedDt = 1 / fps;
  }

  /** 每帧调用：推进累加器，返回需要执行的物理步数 */
  begin(nowMs: number): void {
    if (this.lastTime === 0) this.lastTime = nowMs;
    let frameDt = (nowMs - this.lastTime) / 1000;
    this.lastTime = nowMs;
    if (frameDt > this.maxFrameTime) frameDt = this.maxFrameTime;
    this.accumulator += frameDt;
  }

  /** 丢弃已累积的时间（暂停恢复时调用，避免一次性快进） */
  reset(): void {
    this.accumulator = 0;
  }

  /** 是否还有待执行的物理步；有则执行回调并消耗一个 dt */
  consumeStep(onStep: (dt: number) => void): void {
    while (this.accumulator >= this.fixedDt) {
      onStep(this.fixedDt);
      this.accumulator -= this.fixedDt;
    }
  }

  /** 渲染插值系数（0~1），用于将来在两帧物理状态间插值 */
  get alpha(): number {
    return this.accumulator / this.fixedDt;
  }
}

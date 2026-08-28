import type Matter from 'matter-js';
import type { PhysicsWorld } from '../engine/PhysicsWorld';

/**
 * 编辑操作命令历史（命令模式）。
 * 撤销/重做仅针对结构性变更：放置、删除、画地形。
 * 拖拽等连续操作不入栈。
 */
type Command = {
  /** 执行正向操作（重做时调用） */
  redo: () => void;
  /** 撤销操作 */
  undo: () => void;
};

export class CommandHistory {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  /** 变更时通知外部（如工具栏按钮禁用状态） */
  onChange?: (canUndo: boolean, canRedo: boolean) => void;

  private readonly world: PhysicsWorld;

  constructor(world: PhysicsWorld) {
    this.world = world;
  }

  private push(cmd: Command): void {
    this.undoStack.push(cmd);
    this.redoStack.length = 0; // 新操作清空重做分支
    this.notify();
  }

  /** 记录"添加物体"操作 */
  addBody(body: Matter.Body): void {
    this.push({
      redo: () => this.world.restoreBody(body),
      undo: () => this.world.removeBody(body),
    });
  }

  /** 记录"删除物体"操作 */
  deleteBody(body: Matter.Body): void {
    this.push({
      redo: () => this.world.removeBody(body),
      undo: () => this.world.restoreBody(body),
    });
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo();
    this.redoStack.push(cmd);
    this.notify();
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.redo();
    this.undoStack.push(cmd);
    this.notify();
  }

  /** 清空全部历史（重置场景时调用，防止撤销恢复已清空的物体） */
  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.notify();
  }

  private notify(): void {
    this.onChange?.(this.canUndo(), this.canRedo());
  }
}

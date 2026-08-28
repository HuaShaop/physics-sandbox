import type { ToolKind } from '../editor/tools';

/**
 * 顶部工具栏：工具切换 + 撤销/重做/暂停/重置按钮。
 * 纯 DOM 实现，悬浮于画布上方。
 */
interface ToolDef {
  kind: ToolKind;
  icon: string;
  name: string;
  key: string;
}

const TOOLS: ToolDef[] = [
  { kind: 'select', icon: '⬚', name: '选择/拖拽', key: '1' },
  { kind: 'place', icon: '●', name: '放置物体', key: '2' },
  { kind: 'draw', icon: '✎', name: '手绘地形', key: '3' },
  { kind: 'terrain', icon: '▭', name: '形状地形', key: '4' },
  { kind: 'erase', icon: '⌫', name: '擦除', key: '5' },
];

export class Toolbar {
  private buttons = new Map<ToolKind, HTMLButtonElement>();
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;
  private pauseBtn: HTMLButtonElement;

  constructor(
    root: HTMLElement,
    onSelectTool: (tool: ToolKind) => void,
    onUndo: () => void,
    onRedo: () => void,
    onTogglePause: () => void,
    onReset: () => void,
  ) {
    const bar = document.createElement('div');
    bar.className = 'toolbar';

    for (const t of TOOLS) {
      const btn = document.createElement('button');
      btn.className = 'tool-btn';
      btn.innerHTML = `<span class="icon">${t.icon}</span><span class="tip">${t.name} (${t.key})</span>`;
      btn.title = `${t.name}（快捷键 ${t.key}）`;
      btn.addEventListener('click', () => onSelectTool(t.kind));
      this.buttons.set(t.kind, btn);
      bar.appendChild(btn);
    }

    const sep = document.createElement('div');
    sep.className = 'toolbar-sep';
    bar.appendChild(sep);

    this.undoBtn = this.makeActionBtn('↶', '撤销 (Ctrl+Z)', onUndo);
    this.redoBtn = this.makeActionBtn('↷', '重做 (Ctrl+Y)', onRedo);
    bar.appendChild(this.undoBtn);
    bar.appendChild(this.redoBtn);

    const sep2 = document.createElement('div');
    sep2.className = 'toolbar-sep';
    bar.appendChild(sep2);
    this.pauseBtn = this.makeActionBtn('⏸', '暂停/继续 (空格)', onTogglePause);
    bar.appendChild(this.pauseBtn);
    bar.appendChild(this.makeActionBtn('⟳', '重置参数与场景', onReset));

    root.appendChild(bar);
    this.setActive('select');
    this.updateHistoryButtons(false, false);
  }

  private makeActionBtn(icon: string, title: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'tool-btn';
    btn.innerHTML = `<span class="icon">${icon}</span>`;
    btn.title = title;
    btn.addEventListener('click', onClick);
    return btn;
  }

  setActive(tool: ToolKind): void {
    for (const [kind, btn] of this.buttons) {
      btn.classList.toggle('active', kind === tool);
    }
  }

  updateHistoryButtons(canUndo: boolean, canRedo: boolean): void {
    this.undoBtn.disabled = !canUndo;
    this.redoBtn.disabled = !canRedo;
  }

  /** 暂停状态切换：图标 ⏸ ↔ ▶，暂停时按钮高亮 */
  setPaused(paused: boolean): void {
    this.pauseBtn.innerHTML = `<span class="icon">${paused ? '▶' : '⏸'}</span>`;
    this.pauseBtn.classList.toggle('active', paused);
  }
}

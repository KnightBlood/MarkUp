import type { Anchor, ViewAdapter, ViewKind } from './types'

const LABELS: Record<ViewKind, string> = {
  wysiwyg: '实时预览 · Milkdown(ProseMirror) —— M1 接线',
  source: '分屏 · OverType overlay —— M1 接线',
  hybrid: '源码 · CodeMirror 6(HyperMD 思路) —— M1 接线',
}

const PLACEHOLDER = `# 未连接

这是 %KIND% 视图的占位内容。

M1 里程碑将由三视图适配器(adapter)接管：

- wysiwyg: @milkdown/kit + 共享 remark 渲染管线
- source: OverType textarea-overlay
- hybrid: CodeMirror 6 隐藏标记渲染
`

export function createStubAdapter(kind: ViewKind): ViewAdapter {
  let value = PLACEHOLDER.replace('%KIND%', kind)
  let host: HTMLElement | null = null

  return {
    kind,
    mount(container: HTMLElement): void {
      const el = document.createElement('div')
      el.className = 'adapter-stub'
      const label = document.createElement('div')
      label.className = 'adapter-stub__label'
      label.textContent = LABELS[kind]
      const pre = document.createElement('pre')
      pre.className = 'adapter-stub__content'
      pre.textContent = value
      el.append(label, pre)
      host = el
      container.replaceChildren(el)
    },
    unmount(): void {
      host?.remove()
      host = null
    },
    setValue(markdown: string): void {
      value = markdown
    },
    getValue(): string {
      return value
    },
    focus(): void {
      host?.querySelector<HTMLElement>('.adapter-stub__content')?.focus()
    },
    insertMarkdown(options): void {
      value = value + options.markdown
      const pre = host?.querySelector<HTMLElement>('.adapter-stub__content')
      if (pre) pre.textContent = value
    },
    async insertImage(): Promise<boolean> {
      return false
    },
    insertTable(rows = 3, cols = 3): void {
      const header = `| ${Array.from({ length: cols }, (_, i) => `H${i + 1}`).join(' | ')} |`
      const sep = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`
      const body = Array.from(
        { length: Math.max(0, rows - 1) },
        () => `| ${Array.from({ length: cols }, () => ' ').join(' | ')} |`,
      )
      value = value + [header, sep, ...body].join('\n')
      const pre = host?.querySelector<HTMLElement>('.adapter-stub__content')
      if (pre) pre.textContent = value
    },
    setCodeLanguage(): void {},
    centerCaret(): void {},
    setLineNumbers(): void {},
    setSpellcheck(): void {},
    getLineAt(): null {
      return null
    },
    captureAnchor(): Anchor {
      return { offset: 0, line: 0 }
    },
    restoreAnchor(): void {
    },
  }
}
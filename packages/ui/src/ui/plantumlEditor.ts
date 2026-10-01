import { el } from '../dom'
import { renderEmbed } from './embeds'

type ReactApi = typeof import('react')
type ReactRoot = import('react-dom/client').Root
type ReactNode = import('react').ReactNode

export interface PlantumlOpenOptions {
  code: string
  title?: string
  onConfirm: (code: string) => void
  onCancel?: () => void
}

export interface PlantumlEditorApi {
  el: HTMLElement
  open: (options: PlantumlOpenOptions) => void
  close: () => void
  isOpen: () => boolean
}

const PREVIEW_DEBOUNCE_MS = 350

/**
 * Error boundary guarding the lazy React tree. The whole visual editor is
 * code-split (react + beautiful-plantuml only load on first open), so this is
 * built after React arrives — createElement only, no JSX at module scope.
 * A renderer crash (exotic DOM, jsdom, future lib changes) degrades to the
 * official preview instead of taking the dialog down.
 */
function makeRenderGuard(react: ReactApi) {
  interface GuardProps {
    fallback: ReactNode
    children?: ReactNode
  }
  return class RenderGuard extends react.Component<GuardProps, { failed: boolean }> {
    constructor(props: GuardProps) {
      super(props)
      this.state = { failed: false }
    }
    static getDerivedStateFromError(): { failed: boolean } {
      return { failed: true }
    }
    override componentDidCatch(error: unknown): void {
      console.warn('[markup] PlantUML visual renderer failed', error)
    }
    override render(): ReactNode {
      return this.state.failed ? this.props.fallback : this.props.children
    }
  }
}

export function createPlantumlEditor(): PlantumlEditorApi {
  let openState: PlantumlOpenOptions | null = null
  /** Bumped on every teardown — invalidates in-flight imports and renders. */
  let session = 0
  let previewToken = 0
  let previewTimer: number | null = null
  let reactRoot: ReactRoot | null = null
  let latest = ''
  let initial = ''

  const titleEl = el('h2', { class: 'settings__title', text: 'PlantUML 可视化编辑' })
  const closeBtn = el('button', {
    class: 'settings__close',
    type: 'button',
    text: '×',
    'aria-label': '关闭',
    onclick: () => close(),
  })
  const leftPane = el('div', { class: 'plantuml-editor__left' })
  const rightPane = el('div', { class: 'plantuml-editor__right' })
  const statusEl = el('div', { class: 'plantuml-editor__status', text: '' })
  const cancelBtn = el('button', {
    class: 'btn',
    type: 'button',
    text: '取消',
    onclick: () => close(),
  })
  const confirmBtn = el('button', {
    class: 'btn btn--primary',
    type: 'button',
    text: '写入',
    disabled: true,
    onclick: () => confirm(),
  })
  const panel = el(
    'div',
    {
      class: 'settings__panel plantuml-editor__panel',
      role: 'dialog',
      'aria-label': 'PlantUML 可视化编辑',
      tabindex: '-1',
    },
    el('header', { class: 'settings__header' }, titleEl, closeBtn),
    el('div', { class: 'settings__body plantuml-editor__body' }, leftPane, rightPane),
    el(
      'div',
      { class: 'plantuml-editor__foot' },
      statusEl,
      el('div', { class: 'plantuml-editor__spacer' }),
      cancelBtn,
      confirmBtn,
    ),
  )
  const root = el('div', { class: 'settings plantuml-editor', hidden: true }, panel)

  const notice = (text: string, cls = 'plantuml-editor__notice'): HTMLElement =>
    el('div', { class: cls, text })

  function teardown(): void {
    session += 1
    previewToken += 1
    if (previewTimer !== null) {
      window.clearTimeout(previewTimer)
      previewTimer = null
    }
    const pending = reactRoot
    reactRoot = null
    if (pending) {
      try {
        pending.unmount()
      } catch {
        /* already gone */
      }
    }
    leftPane.replaceChildren()
    rightPane.replaceChildren()
  }

  function close(): void {
    if (root.hidden) return
    const opts = openState
    openState = null
    teardown()
    root.hidden = true
    opts?.onCancel?.()
  }

  function confirm(): void {
    if (!openState || confirmBtn.disabled) return
    const opts = openState
    const code = latest
    openState = null
    teardown()
    root.hidden = true
    opts.onConfirm(code)
  }

  async function renderPreview(code: string): Promise<void> {
    const token = ++previewToken
    rightPane.replaceChildren()
    const hint = el('div', { class: 'plantuml-editor__hint', text: '官方预览渲染中…' })
    const canvas = el('div', { class: 'plantuml-editor__render' })
    rightPane.append(hint, canvas)
    try {
      await renderEmbed('plantuml', code, canvas)
      if (token !== previewToken) return
      hint.remove()
    } catch (error) {
      if (token !== previewToken) return
      hint.textContent = `官方预览失败：${error instanceof Error ? error.message : String(error)}`
      hint.classList.add('plantuml-editor__hint--bad')
    }
  }

  function schedulePreview(code: string): void {
    if (previewTimer !== null) window.clearTimeout(previewTimer)
    previewTimer = window.setTimeout(() => {
      previewTimer = null
      void renderPreview(code)
    }, PREVIEW_DEBOUNCE_MS)
  }

  /**
   * Code-split entry: beautiful-plantuml parses first — a non-sequence diagram
   * (parser reports errors) skips React entirely and the dialog degrades to
   * the official preview alone.
   */
  async function mountVisual(code: string): Promise<void> {
    const token = session
    try {
      const bp = await import('beautiful-plantuml')
      if (token !== session) return
      let errors: Array<{ line?: number; text?: string }> | null = null
      let degraded = true
      try {
        const ast = bp.parse(code)
        errors = (ast.errors ?? []) as Array<{ line?: number; text?: string }>
        degraded = errors.length > 0
      } catch {
        degraded = true
      }
      if (degraded) {
        const detail = (errors ?? [])
          .slice(0, 4)
          .map((e) => (e.line ? `L${e.line}: ${e.text ?? ''}` : (e.text ?? '')))
          .filter(Boolean)
        leftPane.replaceChildren(
          notice(
            '非时序图（或含语法错误），暂不支持可视化编辑。右侧为官方预览，可在源码中继续修改。',
          ),
          detail.length
            ? notice(detail.join('\n'), 'plantuml-editor__notice plantuml-editor__notice--mono')
            : notice(''),
        )
        statusEl.textContent = '非时序图：仅官方预览'
        statusEl.className = 'plantuml-editor__status plantuml-editor__status--warn'
        return
      }

      const [react, dom] = await Promise.all([import('react'), import('react-dom/client')])
      if (token !== session) return
      const h = react.createElement
      const Guard = makeRenderGuard(react)
      const host = el('div', { class: 'plantuml-editor__canvas' })
      leftPane.replaceChildren(host)
      reactRoot = dom.createRoot(host)
      reactRoot.render(
        h(
          Guard,
          {
            fallback: h(
              'div',
              { className: 'plantuml-editor__notice plantuml-editor__notice--mono' },
              '图形渲染不可用，已降级为官方预览。',
            ),
          },
          h(bp.DiagramProvider, {
            code,
            onChange: (next: string) => {
              if (token !== session) return
              latest = next
              const changed = next !== initial
              confirmBtn.disabled = !changed
              statusEl.textContent = changed
                ? '已修改，点击「写入」更新代码块'
                : '左：可视化编辑 · 右：官方预览（实时同步）'
              schedulePreview(next)
            },
            // DiagramActions is host-mounted by design: without it the
            // click → action popover → prompt edit chain never renders.
            children: [h(bp.SequenceDiagram, null), h(bp.DiagramActions, null)],
          }),
        ),
      )
      statusEl.textContent = '左：可视化编辑 · 右：官方预览（实时同步）'
      statusEl.className = 'plantuml-editor__status'
    } catch (error) {
      if (token !== session) return
      const message = error instanceof Error ? error.message : String(error)
      leftPane.replaceChildren(notice(`可视化编辑器加载失败：${message}`))
      statusEl.textContent = '可视化编辑不可用，仅官方预览有效'
      statusEl.className = 'plantuml-editor__status plantuml-editor__status--warn'
      console.warn('[markup] PlantUML visual editor load failed', error)
    }
  }

  function open(options: PlantumlOpenOptions): void {
    if (!root.hidden) close()
    openState = options
    initial = options.code
    latest = options.code
    titleEl.textContent = options.title ?? 'PlantUML 可视化编辑'
    confirmBtn.disabled = true
    statusEl.textContent = '正在加载可视化编辑器…'
    statusEl.className = 'plantuml-editor__status'
    leftPane.replaceChildren(notice('正在加载可视化编辑器…', 'plantuml-editor__hint'))
    rightPane.replaceChildren()
    root.hidden = false
    panel.focus()
    schedulePreview(options.code)
    void mountVisual(options.code)
  }

  root.addEventListener('click', (event) => {
    if (event.target === root) close()
  })
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      close()
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      confirm()
    }
  })

  return {
    el: root,
    open,
    close,
    isOpen: () => !root.hidden,
  }
}

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
const IDLE_STATUS = '左：可视化 / 源码 · 右：官方预览（实时同步）'

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
  /** Re-paints the mounted visual tree with fresh code (null before mount). */
  let paintVisual: ((code: string) => void) | null = null
  /** Code last handed to paintVisual — source edits invalidate it. */
  let visualCode = ''
  let latest = ''
  let initial = ''
  let activeTab: 'visual' | 'source' = 'visual'

  const titleEl = el('h2', { class: 'settings__title', text: 'PlantUML 可视化编辑' })
  const closeBtn = el('button', {
    class: 'settings__close',
    type: 'button',
    text: '×',
    'aria-label': '关闭',
    onclick: () => close(),
  })
  const visualPane = el('div', { class: 'plantuml-editor__pane', role: 'tabpanel' })
  const sourceArea = el('textarea', {
    class: 'plantuml-editor__source',
    spellcheck: 'false',
    'aria-label': 'PlantUML 源码',
  })
  const sourcePane = el(
    'div',
    { class: 'plantuml-editor__pane', role: 'tabpanel', hidden: true },
    sourceArea,
  )
  const visualTabBtn = el('button', {
    class: 'plantuml-editor__tab plantuml-editor__tab--active',
    type: 'button',
    role: 'tab',
    text: '可视化',
    'aria-selected': 'true',
    onclick: () => setTab('visual'),
  })
  const sourceTabBtn = el('button', {
    class: 'plantuml-editor__tab',
    type: 'button',
    role: 'tab',
    text: '源码',
    'aria-selected': 'false',
    onclick: () => setTab('source'),
  })
  const leftPane = el(
    'div',
    { class: 'plantuml-editor__left' },
    el('div', { class: 'plantuml-editor__tabs', role: 'tablist' }, visualTabBtn, sourceTabBtn),
    visualPane,
    sourcePane,
  )
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

  function setTab(tab: 'visual' | 'source'): void {
    activeTab = tab
    visualTabBtn.classList.toggle('plantuml-editor__tab--active', tab === 'visual')
    sourceTabBtn.classList.toggle('plantuml-editor__tab--active', tab === 'source')
    visualTabBtn.setAttribute('aria-selected', String(tab === 'visual'))
    sourceTabBtn.setAttribute('aria-selected', String(tab === 'source'))
    visualPane.hidden = tab !== 'visual'
    sourcePane.hidden = tab !== 'source'
    // Source edits while the canvas is hidden invalidate the painted tree.
    if (tab === 'visual' && paintVisual && visualCode !== latest) paintVisual(latest)
  }

  /** Single write path: visual onChange and the source textarea both land here. */
  function applyCode(next: string): void {
    if (!openState) return
    latest = next
    if (sourceArea.value !== next) sourceArea.value = next
    const changed = next !== initial
    confirmBtn.disabled = !changed
    statusEl.textContent = changed ? '已修改，点击「写入」更新代码块' : IDLE_STATUS
    statusEl.className = 'plantuml-editor__status'
    schedulePreview(next)
  }

  sourceArea.addEventListener('input', () => {
    if (!openState) return
    applyCode(sourceArea.value)
  })

  function teardown(): void {
    session += 1
    previewToken += 1
    if (previewTimer !== null) {
      window.clearTimeout(previewTimer)
      previewTimer = null
    }
    const pending = reactRoot
    reactRoot = null
    paintVisual = null
    visualCode = ''
    if (pending) {
      try {
        pending.unmount()
      } catch {
        /* already gone */
      }
    }
    visualPane.replaceChildren()
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
      // The preview scales svg to its box in both directions — that needs a
      // viewBox; synthesise one from the size attrs if the engine omits it.
      const svg = canvas.querySelector('svg')
      if (svg && !svg.hasAttribute('viewBox')) {
        const width = svg.getAttribute('width')
        const height = svg.getAttribute('height')
        const w = width && !width.includes('%') ? Number.parseFloat(width) : 0
        const h = height && !height.includes('%') ? Number.parseFloat(height) : 0
        if (w > 0 && h > 0) svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
      }
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
   * the official preview alone (the source tab stays fully editable).
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
        visualPane.replaceChildren(
          notice(
            '非时序图（或含语法错误），暂不支持可视化编辑。可切到「源码」标签直接修改，右侧为官方预览。',
          ),
          detail.length
            ? notice(detail.join('\n'), 'plantuml-editor__notice plantuml-editor__notice--mono')
            : notice(''),
        )
        statusEl.textContent = '非时序图：仅官方预览'
        statusEl.className = 'plantuml-editor__status plantuml-editor__status--warn'
        setTab('source')
        return
      }

      const [react, dom] = await Promise.all([import('react'), import('react-dom/client')])
      if (token !== session) return
      const h = react.createElement
      const Guard = makeRenderGuard(react)
      const host = el('div', { class: 'plantuml-editor__canvas' })
      visualPane.replaceChildren(host)
      reactRoot = dom.createRoot(host)
      const paint = (next: string): void => {
        if (!reactRoot || token !== session) return
        visualCode = next
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
              code: next,
              onChange: (value: string) => {
                if (token !== session) return
                applyCode(value)
              },
              // DiagramActions is host-mounted by design: without it the
              // click → action popover → prompt edit chain never renders.
              children: [
                h(bp.SequenceDiagram, { key: 'sequence' }),
                h(bp.DiagramActions, { key: 'actions' }),
              ],
            }),
          ),
        )
      }
      paintVisual = paint
      // Paint the freshest code (the user may have edited source while the
      // visual tree was still loading).
      paint(latest)
      statusEl.textContent = IDLE_STATUS
      statusEl.className = 'plantuml-editor__status'
    } catch (error) {
      if (token !== session) return
      const message = error instanceof Error ? error.message : String(error)
      visualPane.replaceChildren(notice(`可视化编辑器加载失败：${message}`))
      statusEl.textContent = '可视化编辑不可用，仅官方预览有效'
      statusEl.className = 'plantuml-editor__status plantuml-editor__status--warn'
      setTab('source')
      console.warn('[markup] PlantUML visual editor load failed', error)
    }
  }

  function open(options: PlantumlOpenOptions): void {
    if (!root.hidden) close()
    openState = options
    initial = options.code
    latest = options.code
    sourceArea.value = options.code
    titleEl.textContent = options.title ?? 'PlantUML 可视化编辑'
    confirmBtn.disabled = true
    statusEl.textContent = '正在加载可视化编辑器…'
    statusEl.className = 'plantuml-editor__status'
    visualPane.replaceChildren(notice('正在加载可视化编辑器…', 'plantuml-editor__hint'))
    rightPane.replaceChildren()
    setTab('visual')
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

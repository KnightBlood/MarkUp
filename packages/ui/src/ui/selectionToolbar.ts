/**
 * 工具栏 — the floating format bar Typora shows over a selection.
 *
 * Two rules shape this:
 *
 * 1. **Pressing a button must not lose the selection.** Every button cancels
 *    its own `mousedown`; without that the editor's selection collapses the
 *    moment the pointer goes down, and every command would act on a bare caret.
 * 2. **The toolbar never guesses where the text is.** It is given a rect by the
 *    caller and only decides whether that rect is worth showing against — the
 *    shell knows the active view and can get a rect out of it (or not, for
 *    分屏's textarea overlay, which no browser exposes through
 *    `window.getSelection()`).
 */

export interface SelectionToolbarItem {
  /** Glyph shown in the button. */
  icon: string
  /** Tooltip + accessible name. */
  label: string
  /** Command id dispatched on click. */
  command: string
}

/** Grouped so the bar reads as two clusters, like Typora's. */
export const SELECTION_TOOLBAR_ITEMS: readonly (SelectionToolbarItem | 'separator')[] = [
  { icon: 'B', label: '加粗', command: 'format.bold' },
  { icon: 'I', label: '斜体', command: 'format.italic' },
  { icon: 'U', label: '下划线', command: 'format.underline' },
  { icon: 'S', label: '删除线', command: 'format.strike' },
  { icon: '==', label: '高亮', command: 'format.highlight' },
  { icon: '</>', label: '行内代码', command: 'format.inlineCode' },
  { icon: '🔗', label: '超链接…', command: 'format.link' },
  'separator',
  { icon: '❝', label: '引用', command: 'format.quote' },
  { icon: '•', label: '无序列表', command: 'format.bullet' },
  { icon: '1.', label: '有序列表', command: 'format.ordered' },
  { icon: '☑', label: '任务列表', command: 'format.task' },
  'separator',
  { icon: '↑', label: '提升标题级别', command: 'format.headingUp' },
  { icon: '↓', label: '降低标题级别', command: 'format.headingDown' },
]

export interface SelectionToolbarApi {
  el: HTMLElement
  /**
   * Place the bar above `rect`, or hide it when `rect` is null (no selection, or
   * a view that cannot report one).
   */
  update(rect: { top: number; bottom: number; left: number; width: number } | null): void
  /** Hide without forgetting the last placement. */
  hide(): void
  get visible(): boolean
}

/** Distance kept from the selection, and from the viewport edges. */
const GAP = 8
const EDGE = 8

export function createSelectionToolbar(run: (command: string) => void): SelectionToolbarApi {
  const el = document.createElement('div')
  el.className = 'selection-toolbar'
  el.hidden = true
  // `role=toolbar` + buttons: the bar is a set of commands, not a menu.
  el.setAttribute('role', 'toolbar')

  for (const item of SELECTION_TOOLBAR_ITEMS) {
    if (item === 'separator') {
      const sep = document.createElement('span')
      sep.className = 'selection-toolbar__sep'
      sep.setAttribute('aria-hidden', 'true')
      el.append(sep)
      continue
    }
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'selection-toolbar__btn'
    button.textContent = item.icon
    button.title = item.label
    button.setAttribute('aria-label', item.label)
    button.addEventListener('mousedown', (event) => {
      // Keep the selection: without this the editor collapses it on mousedown
      // and the command would act on a bare caret.
      event.preventDefault()
    })
    button.addEventListener('click', () => {
      run(item.command)
      // The command rewrote the document, so the old rect is stale.
      el.hidden = true
    })
    el.append(button)
  }

  return {
    el,
    get visible() {
      return !el.hidden
    },
    hide() {
      el.hidden = true
    },
    update(rect) {
      if (!rect) {
        el.hidden = true
        return
      }
      // Show first so the bar has a measurable width, then place it.
      el.hidden = false
      el.style.left = '0px'
      el.style.top = '0px'
      const width = el.offsetWidth
      const maxLeft = Math.max(EDGE, window.innerWidth - width - EDGE)
      const centered = rect.left + rect.width / 2 - width / 2
      el.style.left = `${Math.min(Math.max(centered, EDGE), maxLeft)}px`
      // Above the selection, but below it when there is no room above (a
      // selection on the first line would otherwise put the bar off-screen).
      const above = rect.top - el.offsetHeight - GAP
      el.style.top = `${above >= EDGE ? above : rect.bottom + GAP}px`
    },
  }
}

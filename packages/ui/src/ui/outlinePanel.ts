/**
 * 大纲浮窗 — Typora's outline window.
 *
 * Reuses `extractOutline`, the same data the sidebar's 大纲 tab renders. The two
 * differ only in presentation: the sidebar is a persistent column that scrolls
 * with the doc, this floats over it. Keeping one extractor means a heading can
 * never appear in one and not the other.
 */

import type { OutlineItem } from '../outline'

export interface OutlinePanelApi {
  el: HTMLElement
  /** Re-render from the document's outline. */
  update(items: OutlineItem[]): void
  /** Mark the heading the caret is in (offset-based, so it survives re-renders). */
  setActive(offset: number | null): void
  toggle(): void
  open(): void
  close(): void
  readonly visible: boolean
}

/** Indentation per heading level, so the hierarchy is readable at a glance. */
const INDENT = 12

/**
 * The last item whose offset is at or before `offset` — the heading the caret is
 * under. Headings come in document order, so a linear scan is exact and needs no
 * "current section" bookkeeping that could drift.
 */
export function activeOutlineIndex(items: OutlineItem[], offset: number | null): number {
  if (offset === null || items.length === 0) return -1
  let active = -1
  for (let i = 0; i < items.length; i += 1) {
    if (items[i]!.offset <= offset) active = i
    else break
  }
  return active
}

export function createOutlinePanel(onSelect: (item: OutlineItem) => void): OutlinePanelApi {
  const el = document.createElement('aside')
  el.className = 'outline-panel'
  el.hidden = true
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-label', '大纲')

  const heading = document.createElement('h2')
  heading.className = 'outline-panel__title'
  heading.textContent = '大纲'
  el.append(heading)

  const list = document.createElement('div')
  list.className = 'outline-panel__list'
  el.append(list)

  const empty = document.createElement('p')
  empty.className = 'outline-panel__empty'
  empty.textContent = '文档没有标题'
  el.append(empty)

  /** Buttons in document order, paired with their source item. */
  let rendered: OutlineItem[] = []
  let buttons: HTMLButtonElement[] = []

  const setActiveAt = (index: number): void => {
    for (let i = 0; i < buttons.length; i += 1) {
      buttons[i]!.classList.toggle('is-active', i === index)
    }
  }

  return {
    el,
    get visible() {
      return !el.hidden
    },
    update(items) {
      rendered = items
      buttons = []
      list.replaceChildren()
      empty.hidden = items.length > 0
      for (const item of items) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'outline-panel__item'
        button.textContent = item.text
        // Level → indent, clamped so a 6-level document still fits the panel.
        button.style.paddingLeft = `${8 + (Math.min(item.level, 6) - 1) * INDENT}px`
        button.title = `第 ${item.line} 行`
        button.addEventListener('click', () => onSelect(item))
        list.append(button)
        buttons.push(button)
      }
    },
    setActive(offset) {
      setActiveAt(activeOutlineIndex(rendered, offset))
    },
    toggle() {
      el.hidden = !el.hidden
    },
    open() {
      el.hidden = false
    },
    close() {
      el.hidden = true
    },
  }
}

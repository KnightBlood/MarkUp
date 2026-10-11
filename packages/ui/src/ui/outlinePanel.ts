/**
 * 大纲浮窗 — Typora's outline window.
 *
 * Reuses `extractOutline`, the same data the sidebar's 大纲 tab renders. The two
 * differ only in presentation: the sidebar is a persistent column, this floats
 * over it. Keeping one extractor means a heading can never appear in one and not
 * the other.
 *
 * Collapsing is panel state, not document state: it is how you are *reading*
 * this session, and persisting it would mean a document you collapsed once stays
 * collapsed forever.
 */

import type { OutlineItem } from '../outline'

export interface OutlinePanelApi {
  el: HTMLElement
  /** Re-render from the document's outline. Collapsed state is kept. */
  update(items: OutlineItem[]): void
  /** Mark the heading the caret is in (by offset, so it survives a re-render). */
  setActive(offset: number | null): void
  toggle(): void
  open(): void
  close(): void
  readonly visible: boolean
}

/** Indentation per heading level, so the hierarchy is readable at a glance. */
const INDENT = 12

/**
 * The indices of `items` that are actually shown: a collapsed heading hides
 * every following item that is *deeper* than it, until something at its level or
 * above appears.
 */
export function visibleOutlineIndices(items: OutlineItem[], collapsed: Set<number>): number[] {
  const visible: number[] = []
  let hideDeeperThan: number | null = null
  for (let index = 0; index < items.length; index += 1) {
    const level = items[index]!.level
    if (hideDeeperThan !== null) {
      if (level > hideDeeperThan) continue
      // Back to the collapsed heading's level: stop hiding, then re-evaluate
      // this item on its own merits.
      hideDeeperThan = null
    }
    visible.push(index)
    if (collapsed.has(index)) hideDeeperThan = level
  }
  return visible
}

/** True when the heading at `index` has anything nested under it. */
export function hasNestedHeadings(items: OutlineItem[], index: number): boolean {
  const level = items[index]?.level
  if (level === undefined) return false
  return (items[index + 1]?.level ?? 0) > level
}

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

  const header = document.createElement('div')
  header.className = 'outline-panel__header'
  const heading = document.createElement('h2')
  heading.className = 'outline-panel__title'
  heading.textContent = '大纲'
  const expandBtn = document.createElement('button')
  expandBtn.type = 'button'
  expandBtn.className = 'outline-panel__action'
  expandBtn.textContent = '展开'
  expandBtn.title = '全部展开'
  const collapseBtn = document.createElement('button')
  collapseBtn.type = 'button'
  collapseBtn.className = 'outline-panel__action'
  collapseBtn.textContent = '折叠'
  collapseBtn.title = '全部折叠'
  header.append(heading, expandBtn, collapseBtn)
  el.append(header)

  const list = document.createElement('div')
  list.className = 'outline-panel__list'
  el.append(list)

  const empty = document.createElement('p')
  empty.className = 'outline-panel__empty'
  empty.textContent = '文档没有标题'
  el.append(empty)

  let items: OutlineItem[] = []
  /** Indices (into `items`) the user collapsed. */
  const collapsed = new Set<number>()
  let activeOffset: number | null = null
  /** Buttons in render order, paired with the item index they came from. */
  let buttons: Array<{ button: HTMLButtonElement; index: number }> = []

  const render = (): void => {
    buttons = []
    list.replaceChildren()
    empty.hidden = items.length > 0
    const visible = visibleOutlineIndices(items, collapsed)
    const active = activeOutlineIndex(items, activeOffset)
    for (const index of visible) {
      const item = items[index]!
      const row = document.createElement('div')
      row.className = 'outline-panel__row'
      const nested = hasNestedHeadings(items, index)
      if (nested) {
        const twisty = document.createElement('button')
        twisty.type = 'button'
        twisty.className = 'outline-panel__twisty'
        twisty.textContent = collapsed.has(index) ? '▸' : '▾'
        twisty.title = collapsed.has(index) ? '展开' : '折叠'
        twisty.setAttribute('aria-expanded', collapsed.has(index) ? 'false' : 'true')
        twisty.addEventListener('click', (event) => {
          event.stopPropagation()
          if (collapsed.has(index)) collapsed.delete(index)
          else collapsed.add(index)
          render()
        })
        row.append(twisty)
      } else {
        // Keep the text aligned with headings that do have a twisty.
        const spacer = document.createElement('span')
        spacer.className = 'outline-panel__twisty outline-panel__twisty--empty'
        row.append(spacer)
      }
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `outline-panel__item${index === active ? ' is-active' : ''}`
      button.textContent = item.text
      // Level → indent, clamped so a 6-level document still fits the panel.
      button.style.paddingLeft = `${8 + (Math.min(item.level, 6) - 1) * INDENT}px`
      button.title = `第 ${item.line} 行`
      button.addEventListener('click', () => onSelect(item))
      row.append(button)
      list.append(row)
      buttons.push({ button, index })
    }
  }

  expandBtn.addEventListener('click', () => {
    collapsed.clear()
    render()
  })
  collapseBtn.addEventListener('click', () => {
    // Collapse only what actually has children — collapsing a leaf is a no-op
    // that would still flip its twisty to a state that never comes back.
    collapsed.clear()
    for (let index = 0; index < items.length; index += 1) {
      if (hasNestedHeadings(items, index)) collapsed.add(index)
    }
    render()
  })

  return {
    el,
    get visible() {
      return !el.hidden
    },
    update(next) {
      items = next
      // Collapsed indices are positional, so a different document must not
      // inherit them — the same index would mean a different heading.
      collapsed.clear()
      render()
    },
    setActive(offset) {
      activeOffset = offset
      const active = activeOutlineIndex(items, offset)
      const target = buttons.find((entry) => entry.index === active)
      for (const entry of buttons) entry.button.classList.toggle('is-active', entry === target)
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

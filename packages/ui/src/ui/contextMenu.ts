import { el } from '../dom'

export interface ContextMenuItem {
  label?: string
  shortcut?: string
  disabled?: boolean
  separator?: boolean
  /**
   * Glyph rendered before the label (e.g. `✂`). Mostly for hand-in-hand with
   * `row`, where the glyph *is* the button face.
   */
  icon?: string
  /**
   * Horizontal icon strip (Typora's top toolbar row). Each child renders as a
   * square glyph button with `label`/`shortcut` as its tooltip; clicking runs
   * it and closes the menu. Separators inside a row are ignored.
   */
  row?: ContextMenuItem[]
  /**
   * Checkable state: `undefined` → plain item, `true`/`false` → checkbox item
   * (`role="menuitemcheckbox"` + leading ✓ marker). The menu hides after run,
   * so the caller recomputes the state on every `show`.
   */
  checked?: boolean
  /**
   * Flyout submenu. Hovering or clicking the item opens it instead of
   * running `run` (nested levels are supported).
   */
  submenu?: ContextMenuItem[]
  run?: () => void
}

export interface ContextMenuApi {
  el: HTMLElement
  show(x: number, y: number, items: ContextMenuItem[]): void
  hide(): void
  isOpen(): boolean
}

/** Grace period letting the pointer travel into a flyout before it collapses. */
const SUBMENU_CLOSE_DELAY = 240

export function createContextMenu(parent: HTMLElement): ContextMenuApi {
  const root = el('div', { class: 'context-menu', hidden: true, role: 'menu' })
  parent.append(root)

  // Element under the point that opened the menu; the menu follows it while
  // content scrolls instead of closing immediately.
  let anchorEl: Element | null = null
  let anchorDX = 0
  let anchorDY = 0

  /**
   * Open layers — root first, then one element per flyout level. Layers are
   * siblings (not nested) because each is `position: fixed` and clamped
   * against the viewport independently.
   */
  const layers: HTMLElement[] = []
  let closeTimer: ReturnType<typeof setTimeout> | null = null

  const cancelClose = (): void => {
    if (closeTimer !== null) {
      clearTimeout(closeTimer)
      closeTimer = null
    }
  }

  /** Drop every flyout deeper than `depth` (root = 0; never unmounts root). */
  const closeDeeper = (depth: number): void => {
    while (layers.length > depth + 1) {
      const layer = layers.pop()
      if (layer && layer !== root) layer.remove()
    }
    cancelClose()
  }

  const hide = (): void => {
    closeDeeper(-1)
    root.hidden = true
    root.replaceChildren()
    anchorEl = null
  }

  const place = (x: number, y: number): void => {
    root.style.left = '0px'
    root.style.top = '0px'
    const rect = root.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    root.style.left = `${Math.max(4, Math.min(x, vw - rect.width - 4))}px`
    root.style.top = `${Math.max(4, Math.min(y, vh - rect.height - 4))}px`
  }

  const placeSub = (layer: HTMLElement, anchor: HTMLElement): void => {
    const rect = anchor.getBoundingClientRect()
    const subRect = layer.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    // Open right of the parent row; flip left when the viewport is short on
    // space (and fall back to the right edge if neither side fits).
    let x = rect.right + 2
    if (x + subRect.width > vw - 4) x = rect.left - subRect.width - 2
    if (x < 4) x = Math.min(rect.right + 2, Math.max(4, vw - subRect.width - 4))
    let y = rect.top
    if (y + subRect.height > vh - 4) y = Math.max(4, vh - subRect.height - 4)
    layer.style.left = `${Math.max(4, Math.min(x, Math.max(4, vw - subRect.width - 4)))}px`
    layer.style.top = `${Math.max(4, y)}px`
  }

  const run = (item: ContextMenuItem): void => {
    hide()
    item.run?.()
  }

  const wireLayer = (layer: HTMLElement, depth: number): void => {
    layer.addEventListener('mouseenter', cancelClose)
    layer.addEventListener('mouseleave', () => {
      cancelClose()
      closeTimer = setTimeout(() => {
        closeTimer = null
        closeDeeper(depth)
      }, SUBMENU_CLOSE_DELAY)
    })
  }

  // Leaving the root menu collapses its flyouts (after the travel grace).
  wireLayer(root, 0)

  /** A horizontal strip of glyph buttons — the Typora-style toolbar row. */
  const renderIconRow = (cells: ContextMenuItem[], depth: number): HTMLElement => {
    const row = el('div', { class: 'context-menu__row', role: 'group' })
    for (const cell of cells) {
      if (cell.separator) continue
      const tip = cell.shortcut ? `${cell.label ?? ''} ${cell.shortcut}` : (cell.label ?? '')
      const button = el(
        'button',
        {
          class: 'context-menu__iconbtn',
          type: 'button',
          role: 'menuitem',
          'aria-label': cell.label ?? null,
          title: tip || null,
          disabled: cell.disabled === true,
          onclick: () => {
            if (cell.disabled === true) return
            run(cell)
          },
        },
        el('span', { class: 'context-menu__glyph', text: cell.icon ?? cell.label ?? '' }),
      )
      button.addEventListener('mouseenter', () => {
        cancelClose()
        if (cell.disabled === true) return
        // Hovering a glyph collapses flyouts opened from a sibling row.
        closeDeeper(depth)
      })
      row.append(button)
    }
    return row
  }

  const renderInto = (
    layer: HTMLElement,
    items: ContextMenuItem[],
    depth: number,
  ): void => {
    layer.replaceChildren()
    for (const item of items) {
      if (item.separator) {
        layer.append(el('div', { class: 'context-menu__sep', role: 'separator' }))
        continue
      }
      if (Array.isArray(item.row) && item.row.length > 0) {
        layer.append(renderIconRow(item.row, depth))
        continue
      }
      const hasSub =
        Array.isArray(item.submenu) && item.submenu.length > 0 && item.disabled !== true
      const children: Array<HTMLElement | null> = []
      if (item.icon) {
        children.push(
          el('span', { class: 'context-menu__icon', text: item.icon, 'aria-hidden': 'true' }),
        )
      }
      if (item.checked !== undefined) {
        children.push(
          el('span', {
            class: 'context-menu__check',
            text: item.checked ? '✓' : '',
            'aria-hidden': 'true',
          }),
        )
      }
      children.push(el('span', { class: 'context-menu__label', text: item.label ?? '' }))
      if (item.shortcut) {
        children.push(el('span', { class: 'context-menu__shortcut', text: item.shortcut }))
      }
      if (hasSub) {
        children.push(el('span', { class: 'context-menu__arrow', text: '›', 'aria-hidden': 'true' }))
      }

      const openSub = (): void => {
        closeDeeper(depth)
        const sub = el('div', { class: 'context-menu context-menu--sub', role: 'menu' })
        renderInto(sub, item.submenu as ContextMenuItem[], depth + 1)
        parent.append(sub)
        layers.push(sub)
        wireLayer(sub, depth + 1)
        button.setAttribute('aria-expanded', 'true')
        placeSub(sub, button)
      }

      const button = el(
        'button',
        {
          class: `context-menu__item${hasSub ? ' context-menu__item--sub' : ''}`,
          type: 'button',
          role:
            item.checked !== undefined
              ? 'menuitemcheckbox'
              : hasSub
                ? 'menuitem'
                : 'menuitem',
          'aria-haspopup': hasSub ? 'true' : null,
          'aria-expanded': hasSub ? 'false' : null,
          'aria-checked': item.checked === undefined ? null : String(item.checked),
          disabled: item.disabled === true,
          onclick: () => {
            if (item.disabled === true) return
            if (hasSub) {
              openSub()
              return
            }
            run(item)
          },
        },
        ...children,
      )
      button.addEventListener('mouseenter', () => {
        cancelClose()
        if (item.disabled === true) return
        if (hasSub) openSub()
        // Hovering a plain row collapses any flyout opened from a sibling.
        else closeDeeper(depth)
      })
      layer.append(button)
    }
  }

  const show = (x: number, y: number, items: ContextMenuItem[]): void => {
    closeDeeper(-1)
    renderInto(root, items, 0)
    // Capture the anchor before the menu becomes visible so elementFromPoint
    // never hits the menu itself. (jsdom lacks elementFromPoint → null.)
    anchorEl =
      typeof document.elementFromPoint === 'function'
        ? document.elementFromPoint(x, y)
        : null
    if (anchorEl && root.contains(anchorEl)) anchorEl = null
    root.hidden = false
    layers.push(root)
    place(x, y)
    if (anchorEl) {
      const anchorRect = anchorEl.getBoundingClientRect()
      const menuRect = root.getBoundingClientRect()
      anchorDX = menuRect.left - anchorRect.left
      anchorDY = menuRect.top - anchorRect.top
    }
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (root.hidden) return
    const target = event.target as Node | null
    if (target && layers.some((layer) => layer.contains(target))) return
    hide()
  }
  const onViewportChange = (event?: Event): void => {
    if (root.hidden) return
    // Ignore scrolling inside the menu itself (it can overflow).
    if (event && event.target instanceof Node && root.contains(event.target)) return
    closeDeeper(0)
    if (!anchorEl || !anchorEl.isConnected) {
      hide()
      return
    }
    const rect = anchorEl.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) {
      hide()
      return
    }
    place(rect.left + anchorDX, rect.top + anchorDY)
  }
  const onKeydown = (event: KeyboardEvent): void => {
    if (root.hidden) return
    if (event.key === 'Escape') {
      event.stopPropagation()
      hide()
    }
  }

  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('blur', hide)
  window.addEventListener('keydown', onKeydown, true)
  window.addEventListener('resize', onViewportChange)
  parent.addEventListener('scroll', onViewportChange, true)

  return {
    el: root,
    show,
    hide,
    isOpen: () => !root.hidden,
  }
}

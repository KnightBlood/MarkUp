import { MENU_TEMPLATE, type MenuTemplateItem, type MenuTemplateSection } from '@markup/host-api'
import { formatShortcut, type CommandRegistry } from '../commands'
import { el } from '../dom'
import type { ContextMenuApi, ContextMenuItem } from './contextMenu'

export interface MenuBarActions {
  quit?: () => void
  reload?: () => void
  devtools?: () => void
}

export interface MenuBarOptions {
  registry: CommandRegistry
  /** The shared context-menu instance the dropdowns are rendered into. */
  menu: ContextMenuApi
  /** Checkbox state (`kind: 'checkbox'`); missing ids read as unchecked. */
  isChecked?: (id: string) => boolean
  /** Host-owned actions; omitting one renders that item disabled. */
  actions?: MenuBarActions
}

export interface MenuBarApi {
  el: HTMLElement
  /** Menu items for a section label — exposed for smoke tests. */
  itemsFor(label: string): ContextMenuItem[]
  /** Labels in menu.json order. */
  labels(): string[]
}

/** `CmdOrCtrl+Shift+P` → `Mod+Shift+P` so `formatShortcut` can localize it. */
export function toAppShortcut(accelerator: string | undefined): string | undefined {
  if (!accelerator) return undefined
  return accelerator.replace(/^(CommandOrControl|CmdOrCtrl)/, 'Mod')
}

/**
 * In-app menu bar (文件 / 编辑 / 段落 / 格式 / 插入 / 视图 / 帮助) driven by the
 * same `menu.json` as the native shells, so the web shell — which has no OS
 * menu — still exposes the full command surface, and every shell shows the
 * same structure. Dropdowns reuse the context-menu primitive (flyouts, escape,
 * viewport clamping and the 240 ms hover grace all come for free).
 */
export function createMenuBar(options: MenuBarOptions): MenuBarApi {
  const { registry, menu, actions } = options
  const nav = el('nav', { class: 'menubar', role: 'menubar', 'aria-label': '主菜单' })
  const buttons = new Map<string, HTMLButtonElement>()
  let current: string | null = null
  /** Section label that was open when the pointer went down on the bar. */
  let pressed: string | null = null

  const toItem = (item: MenuTemplateItem): ContextMenuItem => {
    if (item.kind === 'separator') return { separator: true }

    if (item.kind === 'checkbox') {
      const checked = options.isChecked?.(item.id) === true
      return {
        label: item.label,
        checked,
        run: () => registry.run(checked ? item.off : item.on),
      }
    }

    if (item.kind === 'action') {
      const run = actions?.[item.id]
      return {
        label: item.label,
        shortcut: formatShortcut(toAppShortcut(item.accelerator)),
        disabled: !run,
        run: () => run?.(),
      }
    }

    return {
      label: item.label,
      shortcut: formatShortcut(registry.shortcutFor(item.id)),
      disabled: !registry.get(item.id),
      run: () => registry.run(item.id),
    }
  }

  const itemsFor = (label: string): ContextMenuItem[] => {
    const section = MENU_TEMPLATE.find((entry) => entry.label === label)
    return section ? section.items.map(toItem) : []
  }

  const markCurrent = (label: string | null): void => {
    for (const [name, button] of buttons) {
      button.setAttribute('aria-expanded', String(name === label))
    }
    current = label
  }

  const openSection = (section: MenuTemplateSection, button: HTMLButtonElement): void => {
    const rect = button.getBoundingClientRect()
    markCurrent(section.label)
    menu.show(rect.left, rect.bottom + 2, itemsFor(section.label))
  }

  for (const section of MENU_TEMPLATE) {
    const button = el('button', {
      class: 'menubar__btn',
      type: 'button',
      role: 'menuitem',
      text: section.label,
      'aria-haspopup': 'true',
      'aria-expanded': 'false',
      onclick: () => {
        // A pointerdown on the bar runs *after* the menu's window-level
        // outside-click handler has already closed the dropdown, so remember
        // what was open when the press started (see `pressed` below).
        const wasOpen =
          pressed === section.label || (current === section.label && menu.isOpen())
        pressed = null
        if (wasOpen) {
          menu.hide()
          markCurrent(null)
          return
        }
        openSection(section, button)
      },
    }) as HTMLButtonElement
    // Once a section is open, hovering a sibling switches to it (Typora-like),
    // but hovering with nothing open must not pop menus.
    button.addEventListener('mouseenter', () => {
      if (menu.isOpen() && current !== section.label) openSection(section, button)
    })
    buttons.set(section.label, button)
    nav.append(button)
  }

  // Captured on press, while `current` still reflects the dropdown that was
  // open before the outside-click handler dismissed it.
  nav.addEventListener('pointerdown', () => {
    pressed = current
  })

  // The menu can also close through Escape / an outside click, which the bar
  // never hears about — resync the highlight on the next tick.
  const syncHighlight = (): void => {
    if (!menu.isOpen()) markCurrent(null)
  }
  window.addEventListener('pointerdown', () => window.setTimeout(syncHighlight, 0))
  window.addEventListener('keydown', () => window.setTimeout(syncHighlight, 0))

  return {
    el: nav,
    itemsFor,
    labels: () => MENU_TEMPLATE.map((section) => section.label),
  }
}

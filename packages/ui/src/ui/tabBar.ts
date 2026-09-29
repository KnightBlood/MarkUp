import { el } from '../dom'
import type { ContextMenuItem } from './contextMenu'

export interface TabSpec {
  id: string
  /** Display name (basename or 未命名文档). */
  title: string
  /** Full path — '' for an untitled tab (disables path actions). */
  path: string
  modified: boolean
  active: boolean
}

export interface TabBarOptions {
  getTabs: () => TabSpec[]
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onCloseOthers: (id: string) => void
  onCloseAll: () => void
  onCloseSaved: () => void
  onNew: () => void
  onReorder: (id: string, targetId: string, before: boolean) => void
  onCopyPath: (path: string) => void
  /** Backing menu surface (the shell's shared context menu). */
  showMenu: (x: number, y: number, items: ContextMenuItem[]) => void
}

export interface TabBarApi {
  el: HTMLElement
  refresh: () => void
}

/**
 * Horizontal tab strip: click to activate, middle-click / × to close,
 * right-click for close-all-style actions + copy path, HTML5 drag to reorder.
 * The strip always shows at least the "+" button so an empty store still
 * offers a way in.
 */
export function createTabBar(options: TabBarOptions): TabBarApi {
  const list = el('div', { class: 'tabbar__list', role: 'tablist' })
  const newBtn = el('button', {
    class: 'tabbar__new',
    type: 'button',
    text: '+',
    title: '新建标签页',
    'aria-label': '新建标签页',
    onclick: () => options.onNew(),
  })
  const root = el('div', { class: 'tabbar', role: 'toolbar', 'aria-label': '标签页' }, list, newBtn)

  const clearDropHints = (): void => {
    for (const node of list.children) {
      node.classList.remove('is-drop-before', 'is-drop-after', 'is-dragging')
    }
  }

  let dragId: string | null = null

  const menuItems = (tab: TabSpec, tabs: TabSpec[]): ContextMenuItem[] => [
    { label: '关闭', run: () => options.onClose(tab.id) },
    {
      label: '关闭其他',
      disabled: tabs.length < 2,
      run: () => options.onCloseOthers(tab.id),
    },
    { label: '关闭全部', run: () => options.onCloseAll() },
    { label: '关闭已保存的标签页', run: () => options.onCloseSaved() },
    { separator: true },
    { label: '新建标签页', run: () => options.onNew() },
    { separator: true },
    {
      label: '复制路径',
      disabled: !tab.path,
      run: () => tab.path && options.onCopyPath(tab.path),
    },
  ]

  const renderTab = (tab: TabSpec, tabs: TabSpec[]): HTMLElement => {
    const button = el(
      'button',
      {
        class: `tabbar__tab${tab.active ? ' is-active' : ''}${tab.modified ? ' is-dirty' : ''}`,
        type: 'button',
        role: 'tab',
        'aria-selected': tab.active ? 'true' : 'false',
        'data-id': tab.id,
        title: tab.path || tab.title,
        draggable: 'true',
        onclick: () => options.onSelect(tab.id),
        onauxclick: (event: MouseEvent) => {
          if (event.button === 1) options.onClose(tab.id)
        },
      },
      el('span', { class: 'tabbar__title', text: tab.title }),
      tab.modified
        ? el('span', { class: 'tabbar__dirty', text: '●', title: '有未保存修改' })
        : null,
      el('span', {
        class: 'tabbar__close',
        text: '×',
        title: '关闭标签页',
        role: 'button',
        'aria-label': `关闭 ${tab.title}`,
        onclick: (event: MouseEvent) => {
          event.stopPropagation()
          options.onClose(tab.id)
        },
      }),
    ) as HTMLElement

    button.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      event.stopPropagation()
      options.showMenu(event.clientX, event.clientY, menuItems(tab, tabs))
    })

    button.addEventListener('dragstart', (event) => {
      dragId = tab.id
      const transfer = (event as DragEvent).dataTransfer
      if (transfer) {
        transfer.setData('text/plain', tab.id)
        transfer.effectAllowed = 'move'
      }
      button.classList.add('is-dragging')
    })
    button.addEventListener('dragend', () => {
      dragId = null
      button.classList.remove('is-dragging')
      clearDropHints()
    })
    button.addEventListener('dragover', (event) => {
      if (!dragId || dragId === tab.id) return
      event.preventDefault()
      const transfer = (event as DragEvent).dataTransfer
      if (transfer) transfer.dropEffect = 'move'
      const rect = button.getBoundingClientRect()
      const before = rect.width > 0 && event.clientX < rect.left + rect.width / 2
      button.classList.toggle('is-drop-before', before)
      button.classList.toggle('is-drop-after', !before)
    })
    button.addEventListener('dragleave', () => button.classList.remove('is-drop-before', 'is-drop-after'))
    button.addEventListener('drop', (event) => {
      event.preventDefault()
      const transfer = (event as DragEvent).dataTransfer
      const id = dragId || transfer?.getData('text/plain') || ''
      const rect = button.getBoundingClientRect()
      const before = rect.width > 0 && event.clientX < rect.left + rect.width / 2
      dragId = null
      clearDropHints()
      if (id) options.onReorder(id, tab.id, before)
    })

    return button
  }

  const refresh = (): void => {
    const tabs = options.getTabs()
    list.replaceChildren(...tabs.map((tab) => renderTab(tab, tabs)))
  }

  refresh()

  return { el: root, refresh }
}

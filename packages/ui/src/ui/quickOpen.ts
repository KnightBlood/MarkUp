import { el } from '../dom'
import { fuzzyFilter } from '../fuzzy'
import { basename, relativePath } from '../workspace'

export interface QuickOpenEntry {
  path: string
}

export interface QuickOpenApi {
  el: HTMLElement
  open: (entries: QuickOpenEntry[]) => void
  close: () => void
  toggle: (entries: QuickOpenEntry[]) => void
  isOpen: () => boolean
  dispose: () => void
}

export function createQuickOpen(
  hostEl: HTMLElement,
  onOpenPath: (path: string) => void,
  getRoot: () => string | null,
): QuickOpenApi {
  const input = el('input', {
    class: 'palette__input',
    type: 'text',
    placeholder: '按文件名打开…（输入以过滤）',
    spellcheck: 'false',
    autocomplete: 'off',
  })
  const list = el('div', { class: 'palette__list' })
  const panel = el('div', { class: 'palette__panel' }, input, list)
  const root = el('div', { class: 'palette palette--quick', hidden: true }, panel)

  let entries: QuickOpenEntry[] = []
  let filtered: QuickOpenEntry[] = []
  let activeIndex = 0

  const close = (): void => {
    root.hidden = true
    input.value = ''
  }

  const labelFor = (entry: QuickOpenEntry): string => {
    const workspaceRoot = getRoot()
    return workspaceRoot ? relativePath(workspaceRoot, entry.path) : basename(entry.path)
  }

  const syncActive = (): void => {
    const items = list.querySelectorAll<HTMLElement>('.palette__item')
    items.forEach((item, index) => item.classList.toggle('is-active', index === activeIndex))
    items[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }

  const runAt = (index: number): void => {
    const entry = filtered[index]
    if (!entry) return
    close()
    onOpenPath(entry.path)
  }

  const renderList = (): void => {
    const query = input.value.trim()
    filtered = fuzzyFilter(
      query,
      entries,
      (entry) => labelFor(entry),
    ).map((hit) => hit.item)

    if (activeIndex >= filtered.length) activeIndex = 0

    if (filtered.length === 0) {
      list.replaceChildren(
        el('div', {
          class: 'palette__empty',
          text: entries.length === 0 ? '没有可打开的文件（可先打开文件夹）' : '无匹配文件',
        }),
      )
      return
    }

    list.replaceChildren(
      ...filtered.slice(0, 80).map((entry, index) => {
        const item = el(
          'button',
          {
            class: `palette__item${index === activeIndex ? ' is-active' : ''}`,
            type: 'button',
            onclick: () => runAt(index),
            onmouseenter: () => {
              activeIndex = index
              syncActive()
            },
          },
          el('span', { class: 'palette__label', text: labelFor(entry) }),
          el('kbd', { class: 'palette__shortcut', text: basename(entry.path) }),
        )
        return item
      }),
    )
  }

  const open = (nextEntries: QuickOpenEntry[]): void => {
    entries = nextEntries
    root.hidden = false
    input.value = ''
    activeIndex = 0
    renderList()
    input.focus()
    input.select()
  }

  const toggle = (nextEntries: QuickOpenEntry[]): void => {
    if (root.hidden) open(nextEntries)
    else close()
  }

  input.addEventListener('input', () => {
    activeIndex = 0
    renderList()
  })

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (filtered.length === 0) return
      activeIndex = (activeIndex + 1) % Math.min(filtered.length, 80)
      syncActive()
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (filtered.length === 0) return
      const max = Math.min(filtered.length, 80)
      activeIndex = (activeIndex - 1 + max) % max
      syncActive()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      runAt(activeIndex)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  })

  root.addEventListener('click', (event) => {
    if (event.target === root) close()
  })

  hostEl.appendChild(root)

  return {
    el: root,
    open,
    close,
    toggle,
    isOpen: () => !root.hidden,
    dispose: () => root.remove(),
  }
}

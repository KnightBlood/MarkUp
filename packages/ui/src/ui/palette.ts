import { el } from '../dom'
import { formatShortcut, type Command } from '../commands'

export interface PaletteApi {
  el: HTMLElement
  toggle: () => void
  open: () => void
  close: () => void
  dispose: () => void
}

export function registerCommandPalette(hostEl: HTMLElement, getCommands: () => Command[]): PaletteApi {
  const input = el('input', {
    class: 'palette__input',
    type: 'text',
    placeholder: '输入命令…',
    spellcheck: 'false',
    autocomplete: 'off',
  })
  const list = el('div', { class: 'palette__list' })
  const panel = el('div', { class: 'palette__panel' }, input, list)
  const root = el('div', { class: 'palette', hidden: true }, panel)

  let filtered: Command[] = []
  let activeIndex = 0

  const close = (): void => {
    root.hidden = true
    input.value = ''
  }

  const open = (): void => {
    root.hidden = false
    input.value = ''
    activeIndex = 0
    renderList()
    input.focus()
    input.select()
  }

  const toggle = (): void => {
    if (root.hidden) open()
    else close()
  }

  const syncActive = (): void => {
    const items = list.querySelectorAll<HTMLElement>('.palette__item')
    items.forEach((item, index) => item.classList.toggle('is-active', index === activeIndex))
    items[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }

  const runAt = (index: number): void => {
    const command = filtered[index]
    if (!command) return
    close()
    command.run()
  }

  const renderList = (): void => {
    const query = input.value.trim().toLowerCase()
    filtered = getCommands().filter((command) => {
      if (!query) return true
      return (
        command.label.toLowerCase().includes(query) ||
        command.id.toLowerCase().includes(query) ||
        (command.shortcut ?? '').toLowerCase().includes(query)
      )
    })
    if (activeIndex >= filtered.length) activeIndex = 0

    if (filtered.length === 0) {
      list.replaceChildren(el('div', { class: 'palette__empty', text: '无匹配命令' }))
      return
    }

    list.replaceChildren(
      ...filtered.map((command, index) => {
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
          el('span', { class: 'palette__label', text: command.label }),
        )
        const shortcut = formatShortcut(command.shortcut)
        if (shortcut) item.append(el('kbd', { class: 'palette__shortcut', text: shortcut }))
        return item
      }),
    )
  }

  input.addEventListener('input', () => {
    activeIndex = 0
    renderList()
  })

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (filtered.length === 0) return
      activeIndex = (activeIndex + 1) % filtered.length
      syncActive()
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (filtered.length === 0) return
      activeIndex = (activeIndex - 1 + filtered.length) % filtered.length
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
    toggle,
    open,
    close,
    dispose: () => root.remove(),
  }
}

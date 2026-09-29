import { el } from '../dom'
import type { HostAPI, VerifyReport } from '@markup/host-api'

export interface StatusbarStats {
  words: number
  chars: number
  lines: number
  modified: boolean
}

export interface StatusbarItemHandle {
  setText: (text: string, title?: string) => void
  dispose: () => void
}

export interface StatusbarApi {
  el: HTMLElement
  refresh: () => void
  setVerify: (ver: VerifyReport) => void
  setShowStats: (visible: boolean) => void
  /** Dynamic item (plugins): same id reuses one slot; dispose removes it. */
  registerItem: (id: string) => StatusbarItemHandle
}

export interface StatusbarOptions {
  host: HostAPI
  getStats: () => StatusbarStats
  getThemeLabel: () => string
  onThemeClick?: () => void
}

export function createStatusbar(options: StatusbarOptions): StatusbarApi {
  const statsItem = el('span', { class: 'statusbar__item' })
  const stateItem = el('span', { class: 'statusbar__item' })
  const themeItem = el('button', {
    class: 'statusbar__item statusbar__item--btn',
    type: 'button',
    title: '打开设置',
  })
  const hostItem = el('span', { class: 'statusbar__item', text: 'host: 校验中…' })
  let showStats = true

  if (options.onThemeClick) {
    themeItem.addEventListener('click', options.onThemeClick)
  }

  const refresh = (): void => {
    const stats = options.getStats()
    statsItem.textContent = `字数 ${stats.words} · 字符 ${stats.chars} · 行 ${stats.lines}`
    statsItem.hidden = !showStats
    stateItem.textContent = stats.modified ? '未保存' : '已保存'
    stateItem.classList.toggle('statusbar__item--bad', stats.modified)
    stateItem.classList.toggle('statusbar__item--ok', !stats.modified)
    themeItem.textContent = `主题: ${options.getThemeLabel()}`
  }

  const setVerify = (ver: VerifyReport): void => {
    if (ver.ok) {
      hostItem.className = 'statusbar__item statusbar__item--ok'
      hostItem.textContent = `host: ${options.host.platform} 校验通过`
    } else {
      hostItem.className = 'statusbar__item statusbar__item--bad'
      hostItem.textContent = `host: ${options.host.platform} 发现 ${ver.issues.length} 个问题`
    }
  }

  const setShowStats = (visible: boolean): void => {
    showStats = visible
    refresh()
  }

  const dynamicItems = new Map<string, HTMLElement>()
  const spacer = el('span', { class: 'statusbar__spacer' })

  const registerItem = (id: string): StatusbarItemHandle => {
    let item = dynamicItems.get(id)
    if (!item) {
      item = el('span', { class: 'statusbar__item' })
      dynamicItems.set(id, item)
      spacer.insertAdjacentElement('beforebegin', item)
    }
    return {
      setText: (text: string, title?: string) => {
        item!.textContent = text
        if (title !== undefined) item!.title = title
      },
      dispose: () => {
        item!.remove()
        if (dynamicItems.get(id) === item) dynamicItems.delete(id)
      },
    }
  }

  refresh()

  const root = el(
    'footer',
    { class: 'statusbar' },
    statsItem,
    stateItem,
    spacer,
    themeItem,
    hostItem,
  )

  return { el: root, refresh, setVerify, setShowStats, registerItem }
}

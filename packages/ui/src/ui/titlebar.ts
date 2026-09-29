import type { HostAPI } from '@markup/host-api'
import { el } from '../dom'
import type { ContextMenuItem } from './contextMenu'

export function createDocLabel(): HTMLElement {
  return el('span', { class: 'titlebar__doc', text: '未命名文档' })
}

export function createLogo(): HTMLElement {
  return el('span', { class: 'titlebar__logo', text: 'Markup' })
}

/** Minimal title-bar context menu: window controls + reload (if host supports them). */
export function titlebarMenuItems(host: HostAPI, onReload?: () => void): ContextMenuItem[] {
  const items: ContextMenuItem[] = []
  const win = host.window
  if (win) {
    items.push(
      { label: '最小化', run: () => win.minimize() },
      { label: '最大化 / 还原', run: () => win.toggleMaximize() },
      { separator: true },
      { label: '关闭', run: () => win.close() },
    )
  }
  if (onReload) {
    if (items.length > 0) items.push({ separator: true })
    items.push({ label: '重新加载', run: onReload })
  }
  return items
}
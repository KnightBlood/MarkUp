import { renderEmbed, type EmbedKind } from './embeds'
import { el } from '../dom'

export interface EmbedOpenOptions {
  kind: EmbedKind
  code: string
}

export interface EmbedViewerApi {
  el: HTMLElement
  open: (options: EmbedOpenOptions) => void
  close: () => void
  isOpen: () => boolean
}

const TITLES: Record<EmbedKind, string> = {
  model: '3D 模型预览',
  video: '视频播放',
  mindmap: '脑图预览',
  xmind: 'XMind 脑图预览',
  drawio: 'Draw.io 图表预览',
  plantuml: 'PlantUML 图预览',
  file: '文件预览',
}

export function createEmbedViewer(): EmbedViewerApi {
  let renderToken = 0

  const titleEl = el('h2', { class: 'settings__title', text: '嵌入预览' })
  const closeBtn = el('button', {
    class: 'settings__close',
    type: 'button',
    text: '×',
    'aria-label': '关闭',
    onclick: () => close(),
  })
  const stage = el('div', { class: 'embed-viewer__stage' })

  const panel = el(
    'div',
    { class: 'settings__panel embed-viewer__panel', role: 'dialog', 'aria-label': '嵌入预览', tabindex: '-1' },
    el('header', { class: 'settings__header' }, titleEl, closeBtn),
    el('div', { class: 'settings__body embed-viewer__body' }, stage),
  )
  const root = el('div', { class: 'settings embed-viewer', hidden: true }, panel)

  function close(): void {
    if (root.hidden) return
    renderToken += 1
    root.hidden = true
    // Drop the media element so playback stops with the dialog.
    stage.replaceChildren()
  }

  function open(options: EmbedOpenOptions): void {
    titleEl.textContent = TITLES[options.kind] ?? '嵌入预览'
    const code = options.code.trim()
    const token = ++renderToken
    const hint = el('div', { class: 'embed-viewer__hint', text: '加载中…' })
    const canvas = el('div', { class: 'embed-viewer__render' })
    stage.replaceChildren(hint, canvas)
    root.hidden = false
    panel.focus()
    void (async () => {
      try {
        await renderEmbed(options.kind, code, canvas)
        if (token !== renderToken) return
        hint.remove()
      } catch (error) {
        if (token !== renderToken) return
        const message = error instanceof Error ? error.message : String(error)
        stage.replaceChildren(
          el('div', { class: 'embed-viewer__error', text: `无法预览：${message}` }),
          el('pre', { class: 'embed-viewer__source', text: code }),
        )
      }
    })()
  }

  root.addEventListener('click', (event) => {
    if (event.target === root) close()
  })
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      close()
    }
  })

  return {
    el: root,
    open,
    close,
    isOpen: () => !root.hidden,
  }
}

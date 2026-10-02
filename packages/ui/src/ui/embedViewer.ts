import { renderEmbed, type EmbedKind } from './embeds'
import { normalizeDiagramLang, renderDiagram } from '../../../core/src/diagrams'
import { renderMath } from '../../../core/src/mathRender'
import { el } from '../dom'

export interface EmbedOpenOptions {
  kind: EmbedKind
  code: string
}

export interface DiagramOpenOptions {
  diagram: { lang: string; code: string }
}

export interface MathOpenOptions {
  math: { latex: string }
}

export type EmbedViewerOpenOptions = EmbedOpenOptions | DiagramOpenOptions | MathOpenOptions

export interface EmbedViewerApi {
  el: HTMLElement
  open: (options: EmbedViewerOpenOptions) => void
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

interface PreviewDescriptor {
  title: string
  /** Source shown in the error fallback. */
  source: string
  /** Value for `data-render` — drives the default frame size per content type. */
  render: string
}

function describe(options: EmbedViewerOpenOptions): PreviewDescriptor {
  if ('kind' in options) {
    return {
      title: TITLES[options.kind] ?? '嵌入预览',
      source: options.code.trim(),
      render: options.kind,
    }
  }
  if ('diagram' in options) {
    return { title: '图表预览', source: options.diagram.code.trim(), render: 'diagram' }
  }
  return { title: '公式预览', source: options.math.latex.trim(), render: 'math' }
}

async function renderPreview(options: EmbedViewerOpenOptions, canvas: HTMLElement): Promise<void> {
  if ('kind' in options) {
    await renderEmbed(options.kind, options.code.trim(), canvas)
    return
  }
  if ('diagram' in options) {
    const lang = normalizeDiagramLang(options.diagram.lang)
    if (!lang) throw new Error(`不支持的图表类型：${options.diagram.lang}`)
    await renderDiagram(lang, options.diagram.code.trim(), canvas)
    return
  }
  renderMath(options.math.latex, canvas, true)
}

/** Natural content size: the measured canvas box (see svg normalisation). */
function naturalSize(canvas: HTMLElement): { w: number; h: number } {
  const child = canvas.children.length === 1 ? canvas.firstElementChild : null
  if (child && child.tagName.toLowerCase() === 'svg') {
    const wAttr = child.getAttribute('width')
    const hAttr = child.getAttribute('height')
    const pxW = wAttr && !wAttr.includes('%') ? Number.parseFloat(wAttr) : 0
    const pxH = hAttr && !hAttr.includes('%') ? Number.parseFloat(hAttr) : 0
    if (!(pxW > 4 && pxH > 4)) {
      // viewBox-only / %-sized SVGs have no intrinsic px box (they fall back
      // to 300×150) — give them one from the viewBox so the measured layout
      // matches what the fit rule scales.
      const vb = (child.getAttribute('viewBox') ?? '')
        .trim()
        .split(/[\s,]+/)
        .map(Number)
      const vbW = vb[2] ?? 0
      const vbH = vb[3] ?? 0
      if (vb.length === 4 && vbW > 4 && vbH > 4) {
        child.setAttribute('width', String(Math.round(vbW)))
        child.setAttribute('height', String(Math.round(vbH)))
      }
    }
  }
  return { w: canvas.offsetWidth, h: canvas.offsetHeight }
}

export function createEmbedViewer(): EmbedViewerApi {
  let renderToken = 0
  /** User zoom multiplier over the fit baseline (1 = the plain fit rule). */
  let userZoom = 1
  /** Last computed fit-to-window scale (1 until measured; jsdom stays 1). */
  let fitScale = 1
  let panX = 0
  let panY = 0

  const titleEl = el('h2', { class: 'settings__title', text: '嵌入预览' })
  const closeBtn = el('button', {
    class: 'settings__close',
    type: 'button',
    text: '×',
    'aria-label': '关闭',
    onclick: () => close(),
  })
  const zoomLabel = el('span', {
    class: 'embed-viewer__zoom-label',
    text: '100%',
    'aria-live': 'polite',
  })
  const zoomOutBtn = el('button', {
    class: 'embed-viewer__zoom-btn',
    type: 'button',
    text: '−',
    'aria-label': '缩小',
    onclick: () => setZoom(userZoom / 1.25),
  })
  const zoomInBtn = el('button', {
    class: 'embed-viewer__zoom-btn',
    type: 'button',
    text: '+',
    'aria-label': '放大',
    onclick: () => setZoom(userZoom * 1.25),
  })
  const zoomFitBtn = el('button', {
    class: 'embed-viewer__zoom-btn',
    type: 'button',
    text: '适应',
    'aria-label': '恢复适应窗口',
    onclick: () => setZoom(1),
  })
  const zoomBar = el(
    'div',
    { class: 'embed-viewer__zoom', hidden: true, role: 'group', 'aria-label': '缩放' },
    zoomOutBtn,
    zoomLabel,
    zoomInBtn,
    zoomFitBtn,
  )
  const stage = el('div', { class: 'embed-viewer__stage' })

  const panel = el(
    'div',
    { class: 'settings__panel embed-viewer__panel', role: 'dialog', 'aria-label': '嵌入预览', tabindex: '-1' },
    el('header', { class: 'settings__header' }, titleEl, zoomBar, closeBtn),
    el('div', { class: 'settings__body embed-viewer__body' }, stage),
  )
  const root = el('div', { class: 'settings embed-viewer', hidden: true }, panel)

  function updateZoomLabel(): void {
    zoomLabel.textContent = `${Math.round(fitScale * userZoom * 100)}%`
  }

  function setZoom(next: number): void {
    userZoom = Math.min(8, Math.max(0.25, next))
    if (userZoom === 1) {
      panX = 0
      panY = 0
    }
    if (root.hidden) return
    fitStage()
  }

  function close(): void {
    if (root.hidden) return
    renderToken += 1
    root.hidden = true
    // Drop the media element so playback stops with the dialog.
    stage.replaceChildren()
    stage.classList.remove('embed-viewer__stage--zoomed', 'embed-viewer__stage--clip')
    panel.style.width = ''
    panel.style.height = ''
    userZoom = 1
    fitScale = 1
    panX = 0
    panY = 0
    zoomBar.hidden = true
    updateZoomLabel()
  }

  /**
   * Size rule: content below the cap → the dialog shrinks to the content;
   * content at/over the cap → the dialog pins at the cap and the content is
   * scaled down (centred) to fit the window. Layoutless environments (jsdom)
   * keep the CSS cap untouched.
   *
   * Zoom: userZoom ≠ 1 pins the panel at the cap and multiplies the fit scale
   * (pan clamps so the content edge never leaves the stage); 适应 resets to
   * the baseline rule above.
   */
  function fitStage(): void {
    const canvas = stage.querySelector<HTMLElement>('.embed-viewer__render')
    panel.style.width = ''
    panel.style.height = ''
    const zoomed = userZoom !== 1 && Boolean(canvas)
    stage.classList.toggle('embed-viewer__stage--zoomed', zoomed)
    stage.classList.toggle('embed-viewer__stage--clip', zoomed)
    updateZoomLabel()
    if (!canvas) return
    canvas.style.transform = ''
    canvas.style.transformOrigin = ''
    const availW = stage.clientWidth
    const availH = stage.clientHeight
    if (availW <= 0 || availH <= 0) return
    const nat = naturalSize(canvas)
    if (nat.w <= 4 || nat.h <= 4) return
    const chromeW = panel.offsetWidth - availW
    const chromeH = panel.offsetHeight - availH
    fitScale = Math.min(1, availW / nat.w, availH / nat.h)
    updateZoomLabel()
    if (userZoom === 1) {
      if (fitScale >= 0.999) {
        // Content fits → the window scales to the content.
        panel.style.width = `${Math.ceil(nat.w + chromeW)}px`
        panel.style.height = `${Math.ceil(nat.h + chromeH)}px`
        return
      }
      // Content reached the cap → scale it down to the window, centred.
      canvas.style.transformOrigin = 'top left'
      const tx = Math.max(0, (availW - nat.w * fitScale) / 2)
      const ty = Math.max(0, (availH - nat.h * fitScale) / 2)
      canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${fitScale})`
      return
    }
    // Zoomed: pin at the cap, scale past the fit baseline, clamp the pan so
    // an over-sized canvas stays reachable inside the stage box.
    canvas.style.transformOrigin = 'top left'
    const scale = fitScale * userZoom
    const dispW = nat.w * scale
    const dispH = nat.h * scale
    const overX = dispW > availW
    const overY = dispH > availH
    const cx = (availW - dispW) / 2
    const cy = (availH - dispH) / 2
    const tx = overX ? Math.min(Math.max(cx + panX, availW - dispW), 0) : cx
    const ty = overY ? Math.min(Math.max(cy + panY, availH - dispH), 0) : cy
    canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`
  }

  function open(options: EmbedViewerOpenOptions): void {
    const { title, source, render } = describe(options)
    titleEl.textContent = title
    const token = ++renderToken
    userZoom = 1
    fitScale = 1
    panX = 0
    panY = 0
    zoomBar.hidden = true
    updateZoomLabel()
    const hint = el('div', { class: 'embed-viewer__hint', text: '加载中…' })
    const canvas = el('div', { class: 'embed-viewer__render' })
    canvas.dataset.render = render
    stage.replaceChildren(hint, canvas)
    stage.classList.remove('embed-viewer__stage--zoomed', 'embed-viewer__stage--clip')
    panel.style.width = ''
    panel.style.height = ''
    root.hidden = false
    panel.focus()
    void (async () => {
      try {
        await renderPreview(options, canvas)
        if (token !== renderToken) return
        hint.remove()
        // Zoom controls only make sense over rendered content.
        zoomBar.hidden = false
        fitStage()
        // <video> only knows its intrinsic size after metadata — refit once.
        canvas
          .querySelector('video')
          ?.addEventListener('loadedmetadata', () => fitIfCurrent(token), { once: true })
      } catch (error) {
        if (token !== renderToken) return
        const message = error instanceof Error ? error.message : String(error)
        // Text fallback keeps the capped layout (fitting would shrink long
        // sources below readability).
        stage.replaceChildren(
          el('div', { class: 'embed-viewer__error', text: `无法预览：${message}` }),
          el('pre', { class: 'embed-viewer__source', text: source }),
        )
        panel.style.width = ''
        panel.style.height = ''
      }
    })()
  }

  function fitIfCurrent(token: number): void {
    if (token === renderToken && !root.hidden) fitStage()
  }

  window.addEventListener('resize', () => {
    if (!root.hidden) fitStage()
  })

  // Wheel zoom: ctrl+wheel or plain wheel over the stage scales the canvas
  // around the fit baseline (deltaY<0 = zoom in).
  stage.addEventListener(
    'wheel',
    (event) => {
      if (root.hidden || zoomBar.hidden) return
      const canvas = stage.querySelector('.embed-viewer__render')
      if (!canvas) return
      event.preventDefault()
      const factor = Math.exp(-event.deltaY * 0.0015)
      setZoom(userZoom * factor)
    },
    { passive: false },
  )

  // Drag to pan once the content overflows the stage (clamped in fitStage).
  let drag: { x: number; y: number } | null = null
  stage.addEventListener('mousedown', (event) => {
    if (root.hidden || zoomBar.hidden || userZoom === 1) return
    if (event.button !== 0) return
    event.preventDefault()
    drag = { x: event.clientX, y: event.clientY }
    stage.classList.add('embed-viewer__stage--dragging')
  })
  window.addEventListener('mousemove', (event) => {
    if (!drag) return
    panX += event.clientX - drag.x
    panY += event.clientY - drag.y
    drag = { x: event.clientX, y: event.clientY }
    fitStage()
  })
  window.addEventListener('mouseup', () => {
    if (!drag) return
    drag = null
    stage.classList.remove('embed-viewer__stage--dragging')
  })

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

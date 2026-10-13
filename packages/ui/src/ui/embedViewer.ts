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

/**
 * Inline SVG glyph for the title-bar window button. The button is icon-only
 * on purpose: wording (最大化 / 还原) would take horizontal room the header
 * does not have, and the title bar must stay a single row. `currentColor`
 * keeps the glyph in step with the button's own foreground.
 *
 * The size attributes are load-bearing. Without them an SVG's intrinsic size
 * is 300x150, so flex stretches it to the whole 46x45 button and stroke-width
 * 1.4 maps to a 3.94px slab — three times the ~1px stroke of the × beside it,
 * and a shape that reads as one of the framed zoom buttons instead of as a
 * title-bar control. At 16px the same 1.4 would still be heavy, so 1.2 lands
 * on 1.2px and the glyph's 9-unit box on 9px — what × draws at 20px.
 */
function svgIcon(pathD: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', pathD)
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '1.2')
  path.setAttribute('stroke-linejoin', 'round')
  svg.append(path)
  return svg
}

export function createEmbedViewer(): EmbedViewerApi {
  let renderToken = 0
  /** User zoom multiplier over the fit baseline (1 = the plain fit rule). */
  let userZoom = 1
  /** Last computed fit-to-window scale (1 until measured; jsdom stays 1). */
  let fitScale = 1
  let panX = 0
  let panY = 0
  /** Maximised: the panel covers the overlay, overriding fitStage's fit rule. */
  let maximized = false

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
  const maxBtnIcon = svgIcon('M3.5 3.5h9v9h-9z')
  const restoreBtnIcon = svgIcon('M6.5 6.5h6v6h-6z M10 3.5H3.5v6')
  restoreBtnIcon.style.display = 'none'
  const maxBtn = el(
    'button',
    {
      class: 'embed-viewer__win-btn',
      type: 'button',
      'aria-label': '最大化',
      'aria-pressed': 'false',
      title: '最大化',
      onclick: () => setMaximized(!maximized),
    },
    maxBtnIcon,
    restoreBtnIcon,
  )
  const stage = el('div', { class: 'embed-viewer__stage' })

  const panel = el(
    'div',
    { class: 'settings__panel embed-viewer__panel', role: 'dialog', 'aria-label': '嵌入预览', tabindex: '-1' },
    el('header', { class: 'settings__header' }, titleEl, zoomBar, maxBtn, closeBtn),
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

  /**
   * Swap the glyph and the accessible name together. The visible face stays a
   * picture either way — only aria/title carry the wording, so nothing in the
   * header row can widen and wrap the title.
   */
  function syncMaxBtn(): void {
    const label = maximized ? '还原' : '最大化'
    maxBtnIcon.style.display = maximized ? 'none' : ''
    restoreBtnIcon.style.display = maximized ? '' : 'none'
    maxBtn.setAttribute('aria-label', label)
    maxBtn.setAttribute('title', label)
    maxBtn.setAttribute('aria-pressed', String(maximized))
  }

  function setMaximized(next: boolean): void {
    if (maximized === next) return
    maximized = next
    // The class is what CSS keys the maximised layout off
    // (.settings.embed-viewer:has(.embed-viewer__stage--maximized)); fitStage
    // only sizes the content inside it.
    stage.classList.toggle('embed-viewer__stage--maximized', next)
    syncMaxBtn()
    fitStage()
  }

  function close(): void {
    if (root.hidden) return
    renderToken += 1
    root.classList.remove('is-open')
    root.hidden = true
    // Drop the media element so playback stops with the dialog — and so an
    // embedded <model-viewer> leaves the shared renderer (see open()).
    stage.replaceChildren()
    stage.classList.remove(
      'embed-viewer__stage--zoomed',
      'embed-viewer__stage--clip',
      'embed-viewer__stage--maximized',
    )
    panel.style.width = ''
    panel.style.height = ''
    userZoom = 1
    fitScale = 1
    panX = 0
    panY = 0
    maximized = false
    syncMaxBtn()
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
   *
   * Maximised: the panel pins at 100% and the stage keeps the whole cover
   * area, so the content is centred on the screen instead of on the dialog's
   * original rect. Only the "shrink the dialog to the content" step is
   * skipped there — user zoom, pan and the fit baseline all keep working on
   * top of the maximised panel, which is why they share the code below
   * instead of getting a fit-only branch of their own.
   */
  function fitStage(): void {
    const canvas = stage.querySelector<HTMLElement>('.embed-viewer__render')
    const zoomed = userZoom !== 1 && Boolean(canvas)
    stage.classList.toggle('embed-viewer__stage--zoomed', zoomed)
    stage.classList.toggle('embed-viewer__stage--clip', zoomed)
    // The capped and the maximised layout both size the panel from CSS, so the
    // inline width/height has to go before measuring — an inline value would
    // win over the 100% cover rule.
    panel.style.width = ''
    panel.style.height = ''
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
    if (userZoom === 1 && !maximized) {
      if (fitScale >= 0.999) {
        // Content fits → the window scales to the content, but never below the
        // width the title bar needs (CSS min-width, read back in px).
        const minW = Number.parseFloat(getComputedStyle(panel).minWidth)
        panel.style.width = `${Math.max(Math.ceil(nat.w + chromeW), Number.isFinite(minW) ? minW : 0)}px`
        panel.style.height = `${Math.ceil(nat.h + chromeH)}px`
        // The panel is now possibly wider than the content, so the canvas must
        // be centred rather than left-pinned. Done with a transform on the
        // top-left flex position — the maths below assumes exactly that, so a
        // flex centring here would silently double the offset.
        const fitW = stage.clientWidth
        const fitH = stage.clientHeight
        if (fitW > 0 && fitH > 0) {
          canvas.style.transformOrigin = 'top left'
          canvas.style.transform = `translate(${Math.max(0, (fitW - nat.w) / 2)}px, ${Math.max(0, (fitH - nat.h) / 2)}px)`
        }
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
    maximized = false
    syncMaxBtn()
    zoomBar.hidden = true
    updateZoomLabel()
    const hint = el('div', { class: 'embed-viewer__hint', text: '加载中…' })
    const canvas = el('div', { class: 'embed-viewer__render' })
    canvas.dataset.render = render
    stage.replaceChildren(hint, canvas)
    stage.classList.remove(
      'embed-viewer__stage--zoomed',
      'embed-viewer__stage--clip',
      'embed-viewer__stage--maximized',
    )
    panel.style.width = ''
    panel.style.height = ''
    // `.settings` is visible on `.is-open` alone, but keep `hidden` too: it is
    // what takes the dialog out of layout. A merely `visibility: hidden` dialog
    // still lays out, so its <model-viewer> stays a scene of the shared
    // renderer — and that renderer sizes every canvas to max() across scenes,
    // which would hand the 360px inline embed a 480px canvas to clip against.
    root.classList.add('is-open')
    root.hidden = false
    panel.focus()
    void (async () => {
      try {
        await renderPreview(options, canvas)
        if (token !== renderToken) return
        hint.remove()
        // Zoom controls only make sense over rendered content — and only when
        // the content has none of its own. file / drawio / xmind all mount
        // `<flyfish-file-viewer>` as `.md-embed__file`, whose own bar already
        // owns zoom (−/+/%, 1:1, fit, rotation); a second one over it would
        // disagree (outer 100% vs inner 71%) and scale the inner toolbar
        // along with the document. Hiding the bar also gates the wheel and
        // drag handlers below, so the outer zoom goes quiet entirely.
        zoomBar.hidden = Boolean(canvas.querySelector('.md-embed__file'))
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
      // Esc unwinds one step at a time, the way a maximised window does:
      // maximised → restored → closed. Closing straight from maximised would
      // swallow the state the user just asked to leave.
      if (maximized) {
        setMaximized(false)
        return
      }
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

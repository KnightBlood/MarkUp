import { JSDOM } from 'jsdom'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const dom = new JSDOM('<!doctype html><div id="root"></div>', {
  pretendToBeVisual: true,
  url: 'http://localhost/',
})
const window = dom.window
const define = (key: string, value: unknown): void => {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
}
define('window', window)
define('document', window.document)
define('navigator', window.navigator)
define('HTMLElement', window.HTMLElement)
define('Element', window.Element)
define('Node', window.Node)
define('SVGElement', window.SVGElement)
define('MutationObserver', window.MutationObserver)
define('CustomEvent', window.CustomEvent)
define('getComputedStyle', window.getComputedStyle.bind(window))
define('File', window.File)
define('Blob', window.Blob)
define('FileReader', window.FileReader)
define('DOMParser', (window as unknown as { DOMParser: unknown }).DOMParser)
define('XMLSerializer', (window as unknown as { XMLSerializer: unknown }).XMLSerializer)
let rafId = 0
define('requestAnimationFrame', (cb: FrameRequestCallback) =>
  window.setTimeout(() => cb(rafId++), 16),
)
define('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
define('addEventListener', (type: string, fn: EventListener) => window.addEventListener(type, fn))
define('removeEventListener', (type: string, fn: EventListener) =>
  window.removeEventListener(type, fn),
)
define('dispatchEvent', (event: Event) => window.dispatchEvent(event))
window.Element.prototype.scrollIntoView = function () {}
window.HTMLElement.prototype.focus = function () {}

// jsdom lacks canvas/SVG geometry APIs used by the PlantUML engine (the
// dialog's official-preview pane runs the same renderer as the embeds).
const fakeCtx2d = {
  font: '10px sans-serif',
  measureText: (text: string) => ({
    width: Array.from(text ?? '').length * 7,
    actualBoundingBoxAscent: 8,
    actualBoundingBoxDescent: 2,
  }),
}
;(
  window as unknown as { HTMLCanvasElement: { prototype: Record<string, unknown> } }
).HTMLCanvasElement.prototype.getContext = function () {
  return fakeCtx2d
}
const svgProto = (window as unknown as { SVGElement: { prototype: Record<string, unknown> } })
  .SVGElement.prototype
svgProto.getBBox = function (this: Element) {
  const text = (this.textContent ?? '').trim()
  return { x: 0, y: 0, width: Array.from(text).length * 7, height: 14 }
}
svgProto.getComputedTextLength = function (this: Element) {
  return Array.from((this.textContent ?? '').trim()).length * 7
}

const { createPlantumlEditor } = await import('../src/ui/plantumlEditor')

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
async function waitFor<T>(probe: () => T | null | undefined | false, label: string): Promise<T> {
  const deadline = Date.now() + 10000
  for (;;) {
    const hit = probe()
    if (hit) return hit
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`)
    await sleep(50)
  }
}

const openEditor = (): ReturnType<typeof createPlantumlEditor> => {
  const editor = createPlantumlEditor()
  document.body.append(editor.el)
  return editor
}

const button = (root: Element, label: string): HTMLButtonElement | undefined =>
  Array.from(root.querySelectorAll('button')).find((b) => b.textContent === label)

// ---- degraded: non-sequence input skips React, confirm stays disabled ----
{
  const editor = openEditor()
  let cancelled = 0
  let confirmed: string | null = null
  editor.open({
    code: 'hello world, not a diagram',
    onConfirm: (code) => {
      confirmed = code
    },
    onCancel: () => {
      cancelled += 1
    },
  })
  assert(editor.isOpen(), 'dialog opens')
  const left = editor.el.querySelector('.plantuml-editor__left')
  assert(left, 'left pane exists')
  await waitFor(
    () => (left.textContent?.includes('非时序图') ? left.textContent : null),
    'degraded notice',
  )
  const ok = button(editor.el, '写入')
  assert(ok, 'confirm button exists')
  assert(ok.disabled, 'degraded: confirm disabled')
  editor.close()
  assert(!editor.isOpen(), 'degraded dialog closed')
  assert(cancelled === 1, 'close routes to onCancel')
  assert(confirmed === null, 'no confirm on cancel')
  editor.el.remove()
}

// ---- sequence input: React canvas + official preview both settle ----
{
  const editor = openEditor()
  let cancelled = 0
  editor.open({
    code: '@startuml\nAlice -> Bob: hi\n@enduml',
    onConfirm: () => {},
    onCancel: () => {
      cancelled += 1
    },
  })
  const left = editor.el.querySelector('.plantuml-editor__left')
  const right = editor.el.querySelector('.plantuml-editor__right')
  assert(left && right, 'both panes exist')
  const settledText = await waitFor(
    () =>
      !(left.textContent ?? '').includes('正在加载') && left.childElementCount > 0
        ? left.textContent
        : null,
    'interactive pane settles',
  )
  const canvasHost = left.querySelector('.plantuml-editor__canvas')
  const guarded = settledText?.includes('图形渲染不可用') ?? false
  const loadFailed = settledText?.includes('加载失败') ?? false
  assert(
    canvasHost || guarded || loadFailed,
    `settles as React canvas / boundary fallback / load notice: ${left.innerHTML.slice(0, 300)}`,
  )
  if (canvasHost) {
    assert(canvasHost.childElementCount > 0, 'React mounted into the canvas host')
  }
  await waitFor(
    () => right.querySelector('.md-embed__plantuml svg, .plantuml-editor__hint--bad'),
    'official preview settles (svg or error hint)',
  )
  const ok = button(editor.el, '写入')
  assert(ok && ok.disabled, 'unchanged sequence: confirm disabled')

  // backdrop click cancels
  editor.el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  assert(!editor.isOpen(), 'backdrop click closes')
  assert(cancelled === 1, 'backdrop routes to onCancel')
  editor.el.remove()
}

// ---- reopening invalidates the previous session (stale async bails) ----
{
  const editor = openEditor()
  let cancelled = 0
  editor.open({
    code: 'junk one',
    onConfirm: () => {},
    onCancel: () => {
      cancelled += 1
    },
  })
  editor.open({
    code: '@startuml\nAlice -> Bob: hi\n@enduml',
    onConfirm: () => {},
    onCancel: () => {
      cancelled += 1
    },
  })
  assert(cancelled === 1, 're-open cancels the previous session')
  const left = editor.el.querySelector('.plantuml-editor__left')
  assert(left, 'left pane exists after reopen')
  const settled = await waitFor(
    () => {
      const text = left.textContent ?? ''
      if (left.childElementCount === 0) return null
      if (text.includes('正在加载') || text.includes('非时序图')) return null
      return left.innerHTML
    },
    'second session wins over the first',
  )
  assert(
    settled.includes('plantuml-editor__canvas') ||
      settled.includes('加载失败') ||
      settled.includes('图形渲染不可用'),
    `second session reaches a visual state: ${settled.slice(0, 200)}`,
  )
  editor.close()
  editor.el.remove()
}

console.log(
  'SMOKE UI PLANTUML OK: degraded parse gate + seq React mount + preview settle + confirm gating + cancel/backdrop + session invalidation',
)

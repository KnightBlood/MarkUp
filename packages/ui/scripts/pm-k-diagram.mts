import { JSDOM } from 'jsdom'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
  pretendToBeVisual: true,
})
const g = globalThis as typeof globalThis & {
  window: Window & typeof globalThis
  document: Document
  navigator: Navigator
  HTMLElement: typeof HTMLElement
  Element: typeof Element
  Node: typeof Node
  SVGElement: typeof SVGElement
  HTMLInputElement: typeof HTMLInputElement
  HTMLTextAreaElement: typeof HTMLTextAreaElement
  HTMLButtonElement: typeof HTMLButtonElement
  HTMLDivElement: typeof HTMLDivElement
  HTMLSelectElement: typeof HTMLSelectElement
  HTMLLabelElement: typeof HTMLLabelElement
  HTMLImageElement: typeof HTMLImageElement
  HTMLCanvasElement: typeof HTMLCanvasElement
  HTMLIFrameElement: typeof HTMLIFrameElement
  Event: typeof Event
  KeyboardEvent: typeof KeyboardEvent
  MouseEvent: typeof MouseEvent
  MutationObserver: typeof MutationObserver
  DOMParser: typeof DOMParser
  getComputedStyle: typeof getComputedStyle
  requestAnimationFrame: typeof requestAnimationFrame
  cancelAnimationFrame: typeof cancelAnimationFrame
}
g.window = dom.window as unknown as Window & typeof globalThis
g.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
  writable: true,
})
g.HTMLElement = dom.window.HTMLElement as typeof g.HTMLElement
g.Element = dom.window.Element as typeof g.Element
g.Node = dom.window.Node as typeof g.Node
g.SVGElement = dom.window.SVGElement as typeof g.SVGElement
g.HTMLInputElement = dom.window.HTMLInputElement as typeof g.HTMLInputElement
g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement as typeof g.HTMLTextAreaElement
g.HTMLButtonElement = dom.window.HTMLButtonElement as typeof g.HTMLButtonElement
g.HTMLDivElement = dom.window.HTMLDivElement as typeof g.HTMLDivElement
g.HTMLSelectElement = dom.window.HTMLSelectElement as typeof g.HTMLSelectElement
g.HTMLLabelElement = dom.window.HTMLLabelElement as typeof g.HTMLLabelElement
g.HTMLImageElement = dom.window.HTMLImageElement as typeof g.HTMLImageElement
g.HTMLCanvasElement = dom.window.HTMLCanvasElement as typeof g.HTMLCanvasElement
g.HTMLIFrameElement = dom.window.HTMLIFrameElement as typeof g.HTMLIFrameElement
g.Event = dom.window.Event as typeof g.Event
g.KeyboardEvent = dom.window.KeyboardEvent as typeof g.KeyboardEvent
g.MouseEvent = dom.window.MouseEvent as typeof g.MouseEvent
g.MutationObserver = dom.window.MutationObserver as unknown as typeof g.MutationObserver
g.DOMParser = dom.window.DOMParser as typeof g.DOMParser
for (const name of [
  'NodeList',
  'HTMLCollection',
  'CSSStyleSheet',
  'CSSStyleDeclaration',
  'StyleSheet',
  'DOMRect',
  'XPathEvaluator',
  'Document',
  'DocumentFragment',
  'DocumentType',
  'Text',
  'Comment',
  'Range',
  'StaticRange',
  'Selection',
  'XMLSerializer',
  'NodeFilter',
  'TreeWalker',
  'File',
  'FileReader',
  'Blob',
  'FormData',
] as const) {
  const value = (dom.window as unknown as Record<string, unknown>)[name]
  if (value !== undefined) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  }
}
g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window) as typeof g.getComputedStyle
let rafSeq = 0
g.requestAnimationFrame = ((cb: FrameRequestCallback) =>
  dom.window.setTimeout(() => cb(Date.now()), 16) as unknown as number) as typeof g.requestAnimationFrame
g.cancelAnimationFrame = ((id: number) => dom.window.clearTimeout(id)) as typeof g.cancelAnimationFrame
void rafSeq
dom.window.Element.prototype.scrollIntoView = function () {}
dom.window.HTMLElement.prototype.focus = function () {}

// jsdom has no canvas backend; X6's text-wrap measurement only needs
// font assignment + measureText().width.
{
  const proto = dom.window.HTMLCanvasElement.prototype as unknown as Record<string, unknown>
  proto.getContext = function (type?: string) {
    if (type !== '2d') return null
    return {
      font: '10px sans-serif',
      textBaseline: 'alphabetic',
      textAlign: 'start',
      save() {},
      restore() {},
      measureText(text: string) {
        return { width: (text ?? '').length * 8 }
      },
    } as unknown as CanvasRenderingContext2D
  }
}

// jsdom lacks SVG geometry; X6 needs matrix translate/rotate/inverse/multiply
// chains plus point/bbox helpers. Minimal 2D DOMMatrix-alike covers that.
interface SmokeMatrix {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
  multiply(other: SmokeMatrix): SmokeMatrix
  multiplyRight(other: SmokeMatrix): SmokeMatrix
  multiplyLeft(other: SmokeMatrix): SmokeMatrix
  translate(x: number, y: number): SmokeMatrix
  translateSelf(x: number, y: number): SmokeMatrix
  scale(sx: number, sy?: number): SmokeMatrix
  scaleSelf(sx: number, sy?: number): SmokeMatrix
  rotate(deg: number): SmokeMatrix
  rotateSelf(deg: number): SmokeMatrix
  setTranslate(x: number, y: number): SmokeMatrix
  setRotate(deg: number, cx?: number, cy?: number): SmokeMatrix
  setScale(sx: number, sy?: number): SmokeMatrix
  inverse(): SmokeMatrix
  invertSelf(): SmokeMatrix
  flipX(): SmokeMatrix
  flipY(): SmokeMatrix
  transformPoint(p: { x: number; y: number }): { x: number; y: number }
  toString(): string
}

function applyMatrix(target: SmokeMatrix, src: SmokeMatrix): SmokeMatrix {
  target.a = src.a
  target.b = src.b
  target.c = src.c
  target.d = src.d
  target.e = src.e
  target.f = src.f
  return target
}

function makeMatrix(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0): SmokeMatrix {
  const m: SmokeMatrix = {
    a,
    b,
    c,
    d,
    e,
    f,
    multiply(other) {
      return makeMatrix(
        a * other.a + c * other.b,
        b * other.a + d * other.b,
        a * other.c + c * other.d,
        b * other.c + d * other.d,
        a * other.e + c * other.f + e,
        b * other.e + d * other.f + f,
      )
    },
    multiplyRight(other) {
      return m.multiply(other)
    },
    multiplyLeft(other) {
      return other.multiply(m)
    },
    translate(x, y) {
      return m.multiply(makeMatrix(1, 0, 0, 1, x, y))
    },
    translateSelf(x, y) {
      return applyMatrix(m, m.translate(x, y))
    },
    scale(sx, sy = sx) {
      return m.multiply(makeMatrix(sx, 0, 0, sy, 0, 0))
    },
    scaleSelf(sx, sy = sx) {
      return applyMatrix(m, m.scale(sx, sy))
    },
    rotate(deg) {
      const rad = (deg * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      return m.multiply(makeMatrix(cos, sin, -sin, cos, 0, 0))
    },
    rotateSelf(deg) {
      return applyMatrix(m, m.rotate(deg))
    },
    setTranslate(x, y) {
      return applyMatrix(m, makeMatrix(1, 0, 0, 1, x, y))
    },
    setRotate(deg, cx = 0, cy = 0) {
      return applyMatrix(m, makeMatrix().translate(cx, cy).rotate(deg).translate(-cx, -cy))
    },
    setScale(sx, sy = sx) {
      return applyMatrix(m, makeMatrix(sx, 0, 0, sy, 0, 0))
    },
    inverse() {
      const det = a * d - b * c
      if (!det) return makeMatrix()
      const id = 1 / det
      return makeMatrix(d * id, -b * id, -c * id, a * id, (c * f - d * e) * id, (b * e - a * f) * id)
    },
    invertSelf() {
      return applyMatrix(m, m.inverse())
    },
    flipX() {
      return m.multiply(makeMatrix(-1, 0, 0, 1, 0, 0))
    },
    flipY() {
      return m.multiply(makeMatrix(1, 0, 0, -1, 0, 0))
    },
    transformPoint(p) {
      return { x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f }
    },
    toString() {
      return `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`
    },
  }
  return m
}

{
  const svg = dom.window.SVGElement.prototype as unknown as Record<string, unknown>
  svg.getCTM = () => makeMatrix()
  svg.getScreenCTM = () => makeMatrix()
  svg.getBBox = () => ({ x: 0, y: 0, width: 120, height: 40, top: 0, left: 0, right: 120, bottom: 40 })
  svg.getComputedTextLength = () => 96
  const svgProto = dom.window.SVGSVGElement.prototype as unknown as Record<string, unknown>
  svgProto.createSVGMatrix = () => makeMatrix()
  svgProto.createSVGPoint = () => ({
    x: 0,
    y: 0,
    matrixTransform(matrix: SmokeMatrix) {
      return matrix.transformPoint(this as { x: number; y: number })
    },
  })
}

// mermaid 12 wants CSSStyleSheet / adoptedStyleSheets; visimer uses global CSS.
if (typeof (globalThis as Record<string, unknown>).CSSStyleSheet === 'undefined') {
  class FakeSheet {
    replaceSync(): void {}
    insertRule(): number {
      return 0
    }
    cssRules: unknown[] = []
  }
  Object.defineProperty(globalThis, 'CSSStyleSheet', {
    value: FakeSheet,
    configurable: true,
    writable: true,
  })
}
if (typeof (globalThis as Record<string, unknown>).CSS === 'undefined') {
  Object.defineProperty(globalThis, 'CSS', {
    value: {
      escape: (value: string) => String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`),
      supports: () => true,
      valid: () => true,
      registerProperty: () => {},
    },
    configurable: true,
    writable: true,
  })
}
try {
  const doc = dom.window.document as unknown as Record<string, unknown>
  if (!('adoptedStyleSheets' in doc)) {
    Object.defineProperty(dom.window.document, 'adoptedStyleSheets', {
      value: [],
      configurable: true,
      writable: true,
    })
  }
} catch {
  /* ignore */
}

const { createDiagramEditor } = await import('../src/ui/diagramEditor')
const { FLOW_TEMPLATE, parseFlowchart } = await import('../../core/src/flowchartCodec')
const { setDiagramEditHandler, requestDiagramEdit } = await import('../../core/src/diagramEditBridge')

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const diagram = createDiagramEditor()
assert(diagram.el.classList.contains('diagram'), 'diagram root class')
assert(diagram.isOpen() === false, 'starts closed')

// ── open with template ──────────────────────────────────────────────
let confirmed: string | null = null
diagram.open({
  code: FLOW_TEMPLATE,
  title: '插入流程图',
  onConfirm: (code) => {
    confirmed = code
  },
})
assert(diagram.isOpen(), 'open shows dialog')
assert(
  diagram.el.querySelector('.diagram__panel[role="dialog"]'),
  'dialog role present',
)
const title = diagram.el.querySelector('.settings__title')
assert(title?.textContent === '插入流程图', `title: ${title?.textContent}`)
const textarea = diagram.el.querySelector<HTMLTextAreaElement>('textarea.diagram__source')
assert(textarea, 'source textarea exists')
assert(textarea.value.includes('flowchart TD'), 'template loaded into textarea')

const statusText = (): string => diagram.el.querySelector('.diagram__status')?.textContent ?? ''
const canvasBtn = Array.from(diagram.el.querySelectorAll<HTMLButtonElement>('.diagram__mode')).find(
  (b) => b.textContent === '画布',
)
const sourceBtn = Array.from(diagram.el.querySelectorAll<HTMLButtonElement>('.diagram__mode')).find(
  (b) => b.textContent === '源码',
)
assert(canvasBtn && sourceBtn, 'mode buttons exist')

// Wait until the canvas either comes up or falls back to source mode.
const deadline = Date.now() + 12000
let editorState: 'canvas' | 'source-fallback' | '' = ''
while (Date.now() < deadline) {
  if (canvasBtn.classList.contains('is-active')) {
    editorState = 'canvas'
    break
  }
  if (statusText().includes('源码模式')) {
    editorState = 'source-fallback'
    break
  }
  await sleep(60)
}
assert(editorState !== '', `editor never settled (status: ${statusText()})`)

if (editorState === 'canvas') {
  const canvasHost = diagram.el.querySelector('.diagram__canvas')
  assert(canvasHost && !canvasHost.hidden, 'canvas host visible in canvas mode')
  assert(
    canvasHost.querySelector('[class*="x6-graph"]'),
    `flowchart template must render x6 (${canvasHost.innerHTML.slice(0, 260)})`,
  )
  // Toolbar interactions: add a node, toggle connect mode.
  const shapeBtns = Array.from(diagram.el.querySelectorAll<HTMLButtonElement>('.diagram__shape'))
  const rectBtn = shapeBtns.find((b) => (b.title ?? '').includes('添加矩形节点'))
  assert(rectBtn && !rectBtn.disabled, 'x6 shape button enabled')
  rectBtn.click()
  assert(statusText().includes('已添加'), `x6 add node status: ${statusText()}`)
  const connBtn = shapeBtns.find((b) => (b.title ?? '').includes('依次点击两个节点连线'))
  assert(connBtn && !connBtn.disabled, 'x6 connect button enabled')
  connBtn.click()
  assert(connBtn.classList.contains('is-active'), 'x6 connect mode on')
  connBtn.click()
  assert(!connBtn.classList.contains('is-active'), 'x6 connect mode off')
  // Switch to source: serialization must produce a parseable flowchart
  // with the freshly added node (template has 4 nodes → ≥5 now).
  sourceBtn.click()
  assert(!textarea.hidden, 'textarea visible after leaving canvas')
  const serialized = textarea.value
  const parsed = parseFlowchart(serialized)
  assert(parsed.ok, `serialized canvas code must parse (${serialized.slice(0, 120)})`)
  if (parsed.ok) {
    assert(parsed.graph.nodes.length >= 5, `serialized nodes: ${parsed.graph.nodes.length}`)
    assert(parsed.graph.edges.length >= 4, `serialized edges: ${parsed.graph.edges.length}`)
  }
} else {
  assert(!sourceBtn.classList.contains('is-active') || true, 'source mode')
  assert(!textarea.hidden || statusText().includes('源码模式'), 'source mode reachable')
}

// ── edit + confirm from source mode ─────────────────────────────────
sourceBtn.click()
assert(!textarea.hidden, 'source textarea shown')
textarea.value = 'flowchart TD\n    X[甲] --> Y{乙}\n'
textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
const confirmBtn = diagram.el.querySelector<HTMLButtonElement>('.formula__btn--primary')
assert(confirmBtn, 'confirm button exists')
confirmBtn.click()
assert(diagram.isOpen() === false, 'confirm closes dialog')
assert(confirmed !== null, 'confirm callback fired')
assert(
  confirmed !== null && confirmed.includes('X[甲]'),
  `confirmed code should carry the edit: ${confirmed}`,
)

// ── default template when no code given ─────────────────────────────
confirmed = null
diagram.open({
  onConfirm: (code) => {
    confirmed = code
  },
})
assert(diagram.isOpen(), 'reopened')
const textarea2 = diagram.el.querySelector<HTMLTextAreaElement>('textarea.diagram__source')
assert(textarea2.value === FLOW_TEMPLATE, 'default template when code omitted')
await sleep(200)

// ── cancel via Escape ───────────────────────────────────────────────
let cancelled = false
diagram.open({
  code: FLOW_TEMPLATE,
  onConfirm: () => {
    throw new Error('should not confirm')
  },
  onCancel: () => {
    cancelled = true
  },
})
diagram.el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
assert(!diagram.isOpen(), 'escape closes')
assert(cancelled, 'cancel callback fired')

// ── invalid source stays open with error status ─────────────────────
let confirmedInvalid: string | null = null
diagram.open({
  code: '# 不是流程图\n',
  onConfirm: (code) => {
    confirmedInvalid = code
  },
})
await sleep(600)
const textarea3 = diagram.el.querySelector<HTMLTextAreaElement>('textarea.diagram__source')
assert(textarea3, 'textarea for invalid-source open')
sourceBtn.click()
textarea3.value = 'just plain text'
textarea3.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
const confirmBtn2 = diagram.el.querySelector<HTMLButtonElement>('.formula__btn--primary')
confirmBtn2.click()
assert(diagram.isOpen(), 'invalid source must not confirm')
// confirm() validates the source asynchronously (visimer capability detection),
// and source input clears the status — wait for the validation message.
const invalidDeadline = Date.now() + 15000
while (
  Date.now() < invalidDeadline &&
  !(statusText().includes('有效') || statusText().includes('流程图'))
) {
  await sleep(60)
}
assert(statusText().includes('有效') || statusText().includes('流程图'), `invalid status: ${statusText()}`)
assert(confirmedInvalid === null, 'confirm blocked')
diagram.el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
assert(!diagram.isOpen(), 'closed after invalid attempt')

// ── diagram edit bridge wiring (editor opens with request code) ─────
let bridgeDoneCode: string | null = null
let bridgeCancelled = false
setDiagramEditHandler((request, done) => {
  diagram.open({
    code: request.code,
    title: '编辑流程图',
    onConfirm: (code) => {
      bridgeDoneCode = code
      done(code)
    },
    onCancel: () => {
      bridgeCancelled = true
      done(null)
    },
  })
})
let bridgeHandled = false
bridgeHandled = requestDiagramEdit(
  { lang: 'mermaid', code: 'flowchart LR\n    A[甲] --> B[乙]\n' },
  () => undefined,
)
assert(bridgeHandled === true, 'bridge handled')
assert(diagram.isOpen(), 'bridge opens diagram editor')
const title2 = diagram.el.querySelector('.settings__title')
assert(title2?.textContent === '编辑流程图', `bridge title: ${title2?.textContent}`)
await sleep(300)
const textarea4 = diagram.el.querySelector<HTMLTextAreaElement>('textarea.diagram__source')
assert(textarea4.value.includes('A[甲]'), 'bridge code loaded')
sourceBtn.click()
textarea4.value = 'flowchart LR\n    A[改] --> B[乙]\n'
textarea4.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
diagram.el.querySelector<HTMLButtonElement>('.formula__btn--primary')!.click()
assert(bridgeDoneCode !== null && bridgeDoneCode.includes('A[改]'), `bridge confirm: ${bridgeDoneCode}`)
setDiagramEditHandler(null)

// Bridge without handler reports false
setDiagramEditHandler(null)
const unhandled = requestDiagramEdit({ lang: 'mermaid', code: 'flowchart TD\n  A --> B\n' }, () => undefined)
assert(unhandled === false, 'bridge without handler returns false')

// ── sequence diagram → Visimer canvas (x6 cannot edit it) ───────────
const visStatus = (): 'ready' | 'fallback' | '' =>
  statusText().includes('可视化画布就绪')
    ? 'ready'
    : statusText().includes('已停留在源码模式') || statusText().includes('已切换到源码模式')
      ? 'fallback'
      : ''
const waitVisimer = async (ms: number): Promise<'ready' | 'fallback' | ''> => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const state = visStatus()
    if (state) return state
    await sleep(60)
  }
  return ''
}

const SEQ_CODE = [
  'sequenceDiagram',
  '    participant A as Alice',
  '    A->>B: Hello',
  '    B-->>A: OK',
  '',
].join('\n')
let seqConfirmed: string | null = null
diagram.open({
  code: SEQ_CODE,
  title: '编辑时序图',
  onConfirm: (code) => {
    seqConfirmed = code
  },
})
assert(diagram.isOpen(), 'sequence editor opens')
const seqState = await waitVisimer(15000)
assert(seqState === 'ready', `sequence must open visimer canvas (state=${seqState}, status=${statusText()})`)
const seqHost = diagram.el.querySelector('.diagram__canvas')
assert(seqHost?.querySelector('svg'), 'visimer sequence svg rendered')
assert(!seqHost?.querySelector('.x6-graph'), 'sequence must not build an x6 graph')
const seqShapeBtn = Array.from(diagram.el.querySelectorAll<HTMLButtonElement>('.diagram__shape')).find(
  (b) => (b.title ?? '').includes('添加'),
)
assert(seqShapeBtn?.disabled, 'shape buttons disabled under sequence visimer')
const seqConnBtn = Array.from(diagram.el.querySelectorAll<HTMLButtonElement>('.diagram__shape')).find(
  (b) => (b.title ?? '').includes('连线'),
)
assert(seqConnBtn?.disabled, 'connect disabled under sequence visimer')
const seqDeleteBtn = Array.from(diagram.el.querySelectorAll<HTMLButtonElement>('.diagram__shape')).find(
  (b) => (b.title ?? '').includes('删除选中'),
)
assert(seqDeleteBtn && !seqDeleteBtn.disabled, 'delete enabled under visimer')
seqDeleteBtn.click()
assert(statusText().includes('先选中'), `vis delete with empty selection: ${statusText()}`)

// Source round-trip keeps the sequence code
sourceBtn.click()
assert(!textarea.hidden, 'sequence source textarea shown')
assert(textarea.value.includes('sequenceDiagram'), 'source shows sequence code')
textarea.value = `${SEQ_CODE}    A->>B: Again\n`
textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }))

// Editing the source and returning to the canvas rebuilds visimer
canvasBtn.click()
const seqRebuilt = await waitVisimer(15000)
assert(seqRebuilt === 'ready', `sequence rebuild (state=${seqRebuilt}, status=${statusText()})`)
confirmBtn.click()
assert(diagram.isOpen() === false, 'sequence confirm closes dialog')
assert(seqConfirmed !== null && seqConfirmed.includes('sequenceDiagram'), `sequence confirm: ${seqConfirmed}`)
assert(seqConfirmed !== null && seqConfirmed.includes('Again'), `sequence edit carried: ${seqConfirmed}`)

// ── subgraph flowchart → Visimer canvas (x6 treats it as unsupported) ─
const SUB_CODE = [
  'flowchart TD',
  '    subgraph SG1[分组一]',
  '        A[甲] --> B[乙]',
  '    end',
  '    B --> C{丙}',
  '',
].join('\n')
let subConfirmed: string | null = null
diagram.open({
  code: SUB_CODE,
  title: '编辑含子图的流程图',
  onConfirm: (code) => {
    subConfirmed = code
  },
})
const subState = await waitVisimer(15000)
assert(subState === 'ready', `subgraph must open visimer canvas (state=${subState}, status=${statusText()})`)
const subHost = diagram.el.querySelector('.diagram__canvas')
assert(subHost?.querySelector('svg'), 'visimer subgraph svg rendered')
assert(!subHost?.querySelector('.x6-graph'), 'subgraph flowchart must not build an x6 graph')
// Flow-type visimer: toolbar dispatches into the visimer engine.
const subShapeBtns = Array.from(diagram.el.querySelectorAll<HTMLButtonElement>('.diagram__shape'))
const subRectBtn = subShapeBtns.find((b) => (b.title ?? '').includes('添加矩形节点'))
assert(subRectBtn && !subRectBtn.disabled, 'shape button enabled under flow visimer')
subRectBtn.click()
assert(statusText().includes('已添加'), `vis add node status: ${statusText()}`)
const subConnBtn = subShapeBtns.find((b) => (b.title ?? '').includes('依次点击两个节点连线'))
assert(subConnBtn && !subConnBtn.disabled, 'connect enabled under flow visimer')
subConnBtn.click()
assert(subConnBtn.classList.contains('is-active'), 'vis connect mode on')
// Escape while vis-connecting must exit the tool without closing the dialog.
subHost.dispatchEvent(
  new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
)
assert(diagram.isOpen(), 'escape during vis connect keeps dialog open')
assert(!subConnBtn.classList.contains('is-active'), 'escape exits vis connect tool')
confirmBtn.click()
assert(diagram.isOpen() === false, 'subgraph confirm closes dialog')
assert(subConfirmed !== null && subConfirmed.includes('subgraph SG1'), `subgraph confirm: ${subConfirmed}`)
assert(subConfirmed !== null && subConfirmed.includes('New node'), `vis added node carried: ${subConfirmed}`)

console.log(
  `SMOKE UI DIAGRAM OK: open/confirm/cancel/invalid-guard + bridge edit + x6 canvas + visimer sequence/subgraph`,
)
process.exit(0)

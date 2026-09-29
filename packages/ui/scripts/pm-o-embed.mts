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
  Event: typeof Event
  KeyboardEvent: typeof KeyboardEvent
  MouseEvent: typeof MouseEvent
  MutationObserver: typeof MutationObserver
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
g.Event = dom.window.Event as typeof g.Event
g.KeyboardEvent = dom.window.KeyboardEvent as typeof g.KeyboardEvent
g.MouseEvent = dom.window.MouseEvent as typeof g.MouseEvent
g.MutationObserver = dom.window.MutationObserver as unknown as typeof g.MutationObserver
g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window) as typeof g.getComputedStyle
g.requestAnimationFrame = ((cb: FrameRequestCallback) =>
  dom.window.setTimeout(() => cb(Date.now()), 16) as unknown as number) as typeof g.requestAnimationFrame
g.cancelAnimationFrame = ((id: number) => dom.window.clearTimeout(id)) as typeof g.cancelAnimationFrame
for (const name of ['File', 'FileReader', 'Blob', 'SVGElement', 'HTMLVideoElement', 'DOMParser', 'XMLSerializer'] as const) {
  const value = (dom.window as unknown as Record<string, unknown>)[name]
  if (value !== undefined) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  }
}
dom.window.Element.prototype.scrollIntoView = function () {}
dom.window.HTMLElement.prototype.focus = function () {}

// markmap measures with getBBox/getComputedTextLength; jsdom has neither.
{
  const svg = dom.window.SVGElement.prototype as unknown as Record<string, unknown>
  svg.getBBox = () => ({ x: 0, y: 0, width: 120, height: 40, top: 0, left: 0, right: 120, bottom: 40 })
  svg.getComputedTextLength = () => 96
}

const { createEmbedViewer } = await import('../src/ui/embedViewer')
const { setEmbedSourceResolver, MINDMAP_TEMPLATE } = await import('../src/ui/embeds')

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const waitFor = async (
  probe: () => unknown,
  label: string,
  timeoutMs = 5000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (probe()) return
    await sleep(50)
  }
  throw new Error(`timeout waiting for ${label}`)
}

const VIDEO_URL = 'data:video/mp4;base64,AAAA'
const viewer = createEmbedViewer()
assert(viewer.el.classList.contains('embed-viewer'), 'root class')
assert(viewer.isOpen() === false, 'starts closed')

// ── open with a data-URL video → renders, title set ─────────────────
viewer.open({ kind: 'video', code: VIDEO_URL })
assert(viewer.isOpen(), 'open shows dialog')
const title = viewer.el.querySelector('.settings__title')
assert(title?.textContent === '视频播放', `title: ${title?.textContent}`)
assert(
  viewer.el.querySelector('.embed-viewer__panel[role="dialog"]'),
  'dialog role present',
)
await waitFor(() => viewer.el.querySelector('video'), 'video rendered')
assert(!viewer.el.querySelector('.embed-viewer__hint'), 'loading hint removed on success')
const video = viewer.el.querySelector('video') as HTMLVideoElement
assert(video.getAttribute('src') === VIDEO_URL, 'video src is the data URL')
assert(video.controls, 'native controls on')

// ── Escape closes and drops the media element ───────────────────────
viewer.el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
assert(!viewer.isOpen(), 'escape closes')
assert(!viewer.el.querySelector('video'), 'stage cleared (playback stops)')

// ── local path without resolver → 无法预览 error keeps the source ──
setEmbedSourceResolver(null)
viewer.open({ kind: 'video', code: '/tmp/clip.mp4' })
await waitFor(() => viewer.el.querySelector('.embed-viewer__error'), 'error state')
const err = viewer.el.querySelector('.embed-viewer__error')
assert(
  (err?.textContent ?? '').startsWith('无法预览：'),
  `error copy: ${err?.textContent}`,
)
const srcPre = viewer.el.querySelector('.embed-viewer__source')
assert(srcPre?.textContent === '/tmp/clip.mp4', 'source block shows the raw fence')
assert(!viewer.el.querySelector('video'), 'no video in error state')

// ── resolver wired → same path renders ──────────────────────────────
setEmbedSourceResolver(async (path) =>
  path === '/tmp/clip.mp4' ? 'data:video/mp4;base64,QUJD' : null,
)
viewer.open({ kind: 'video', code: '/tmp/clip.mp4' })
await waitFor(() => viewer.el.querySelector('video'), 'video via resolver')
assert(
  viewer.el.querySelector('video')?.getAttribute('src') === 'data:video/mp4;base64,QUJD',
  'resolver data URL used',
)
setEmbedSourceResolver(null)

// ── backdrop click closes ───────────────────────────────────────────
viewer.el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
assert(!viewer.isOpen(), 'backdrop click closes')

// ── model open: rendered OR graceful 无法预览 (jsdom has no custom element registry) ──
viewer.open({ kind: 'model', code: '/tmp/duck.glb' })
await waitFor(
  () => viewer.el.querySelector('model-viewer') || viewer.el.querySelector('.embed-viewer__error'),
  'model settles',
)
assert(
  viewer.el.querySelector('model-viewer') || viewer.el.querySelector('.embed-viewer__error'),
  'model renders or reports 无法预览',
)
viewer.close()

// ── mindmap open: svg OR graceful error; content is markdown ────────
viewer.open({ kind: 'mindmap', code: MINDMAP_TEMPLATE })
await waitFor(
  () => viewer.el.querySelector('svg') || viewer.el.querySelector('.embed-viewer__error'),
  'mindmap settles',
)
assert(
  viewer.el.querySelector('svg') || viewer.el.querySelector('.embed-viewer__error'),
  'mindmap renders or reports 无法预览',
)
const mindTitle = viewer.el.querySelector('.settings__title')
assert(mindTitle?.textContent === '脑图预览', `mindmap title: ${mindTitle?.textContent}`)
viewer.close()

// ── xmind without resolver → mounts file viewer host, title mapped ──
viewer.open({ kind: 'xmind', code: '/tmp/plan.xmind' })
await waitFor(
  () => viewer.el.querySelector('.md-embed__file') || viewer.el.querySelector('.embed-viewer__error'),
  'xmind settles',
  60000,
)
const xmindTitle = viewer.el.querySelector('.settings__title')
assert(xmindTitle?.textContent === 'XMind 脑图预览', `xmind title: ${xmindTitle?.textContent}`)
assert(
  viewer.el.querySelector('.md-embed__file') || viewer.el.querySelector('.embed-viewer__error'),
  'xmind renders the file viewer or reports 无法预览',
)
viewer.close()

// ── drawio inline XML → mounts file viewer (renderer-drawing), title mapped ──
viewer.open({
  kind: 'drawio',
  code:
    '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    '<mxCell id="2" value="N" style="rounded=0;" vertex="1" parent="1">' +
    '<mxGeometry x="20" y="20" width="80" height="40" as="geometry"/></mxCell>' +
    '</root></mxGraphModel>',
})
await waitFor(
  () => viewer.el.querySelector('.md-embed__file') || viewer.el.querySelector('.embed-viewer__error'),
  'drawio settles',
  60000,
)
const drawioTitle = viewer.el.querySelector('.settings__title')
assert(drawioTitle?.textContent === 'Draw.io 图表预览', `drawio title: ${drawioTitle?.textContent}`)
assert(
  viewer.el.querySelector('.md-embed__file') || viewer.el.querySelector('.embed-viewer__error'),
  'drawio mounts the file viewer or reports 无法预览',
)
if (viewer.el.querySelector('.md-embed__file')) {
  assert(
    viewer.el.querySelector('flyfish-file-viewer'),
    'drawio file viewer element mounted in viewer stage',
  )
  assert(
    !viewer.el.querySelector('.embed-viewer__hint'),
    'drawio loading hint removed on success',
  )
}
viewer.close()

// ── plantuml title mapped; render settles as svg OR 无法预览 ─────────
viewer.open({ kind: 'plantuml', code: '@startuml\nAlice -> Bob : Hi\n@enduml' })
await waitFor(
  () => viewer.el.querySelector('.md-embed__plantuml svg') || viewer.el.querySelector('.embed-viewer__error'),
  'plantuml settles',
  60000,
)
const pumlTitle = viewer.el.querySelector('.settings__title')
assert(pumlTitle?.textContent === 'PlantUML 图预览', `plantuml title: ${pumlTitle?.textContent}`)
assert(
  viewer.el.querySelector('.md-embed__plantuml svg') || viewer.el.querySelector('.embed-viewer__error'),
  'plantuml renders or reports 无法预览',
)
viewer.close()

// ── file open: title mapped; mounts file-viewer OR graceful 无法预览 ──
setEmbedSourceResolver(async (path) =>
  path === '/tmp/合同.pdf' ? 'data:application/pdf;base64,JVBERi0xLjQK' : null,
)
viewer.open({ kind: 'file', code: '/tmp/合同.pdf' })
await waitFor(
  () =>
    viewer.el.querySelector('.md-embed__file') ||
    viewer.el.querySelector('.embed-viewer__error'),
  'file settles',
  60000,
)
const fileTitle = viewer.el.querySelector('.settings__title')
assert(fileTitle?.textContent === '文件预览', `file title: ${fileTitle?.textContent}`)
assert(
  viewer.el.querySelector('.md-embed__file') ||
    viewer.el.querySelector('.embed-viewer__error'),
  'file renders viewer host or reports 无法预览',
)
if (viewer.el.querySelector('.md-embed__file')) {
  assert(
    viewer.el.querySelector('flyfish-file-viewer'),
    'flyfish-file-viewer element mounted in viewer stage',
  )
}
setEmbedSourceResolver(null)
viewer.close()

console.log(
  'SMOKE UI EMBED OK: viewer open/video render + escape/backdrop close + resolver error copy + model/mindmap tolerance + xmind/drawio/plantuml/file titles',
)
process.exit(0)

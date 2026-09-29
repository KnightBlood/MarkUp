function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const { buildStandaloneHtml, exportHtmlDocument, renderMarkdownHtml } = await import('../src/exportHtml')

const body = await renderMarkdownHtml('# 标题\n\n正文 **粗体**')
assert(body.includes('<h1'), 'render h1')
assert(body.includes('<strong>'), 'render strong')

const doc = await exportHtmlDocument('---\ntitle: demo\n---\n\n# 一级\n\n$$x^2$$', {
  title: 'My Doc',
})
assert(doc.startsWith('<!doctype html>'), 'doctype')
assert(doc.includes('<title>My Doc</title>'), 'title escape')
assert(doc.includes('一级'), 'body heading')
assert(doc.includes('katex'), 'katex css link')
assert(doc.includes('<style>'), 'inline style')
assert(!doc.includes('title: demo'), 'frontmatter not in html body')

const bare = buildStandaloneHtml('<p>hi</p>', { title: 'T' })
assert(bare.includes('<p>hi</p>'), 'passthrough body')
assert(bare.includes('<title>T</title>'), 'default title')
assert(bare.includes('@media print'), 'print styles present by default')

const noPrint = buildStandaloneHtml('<p>x</p>', { title: 'T', printStyles: false })
assert(!noPrint.includes('@media print'), 'printStyles false strips print block')

// Export hydrate: pipeline emits .md-diagram[data-diagram] wrappers; HTML/PDF/print
// export must resolve them in-place (render) or keep the source (never blank).
const diagramMd = '# 图\n\n```mermaid\nflowchart TD\n  A[开始] --> B{判断}\n```\n'
const diagramBody = await renderMarkdownHtml(diagramMd)
assert(diagramBody.includes('md-diagram'), 'pipeline emits md-diagram wrapper')
assert(diagramBody.includes('data-diagram'), 'wrapper keeps data-diagram attr')
assert(diagramBody.includes('开始'), 'diagram source preserved pre-hydrate')

const { hydrateExportDiagrams } = await import('../src/exportHtml')
const { JSDOM } = await import('jsdom')
const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true })
const define = (key: string, value: unknown): void => {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
}
define('window', dom.window)
define('document', dom.window.document)
define('navigator', dom.window.navigator)
define('HTMLElement', dom.window.HTMLElement)
define('Element', dom.window.Element)
define('SVGElement', dom.window.SVGElement)
define('Node', dom.window.Node)
define('MutationObserver', dom.window.MutationObserver)
define('DOMParser', dom.window.DOMParser)
define('getComputedStyle', dom.window.getComputedStyle.bind(dom.window))
define('requestAnimationFrame', (cb: FrameRequestCallback) => dom.window.setTimeout(() => cb(Date.now()), 16))
define('cancelAnimationFrame', (id: number) => dom.window.clearTimeout(id))
Object.defineProperty(dom.window.Element.prototype, 'scrollIntoView', { value: () => {} })

const hydrated = await hydrateExportDiagrams(diagramBody)
assert(hydrated.includes('md-diagram'), 'hydrate keeps wrapper')
assert(
  hydrated.includes('data-rendered') || hydrated.includes('data-error'),
  'hydrate resolves diagram (rendered or source-preserving error)',
)
if (!hydrated.includes('data-rendered')) {
  assert(hydrated.includes('md-diagram__source'), 'failed hydrate keeps source block')
  assert(hydrated.includes('开始'), 'failed hydrate keeps source text')
} else {
  assert(hydrated.includes('<svg'), 'rendered hydrate embeds svg')
}

const exportDoc = await exportHtmlDocument(diagramMd, { title: 'D' })
assert(exportDoc.includes('md-diagram'), 'export doc carries diagram wrapper')
assert(
  exportDoc.includes('data-rendered') || exportDoc.includes('data-error'),
  'export doc diagrams resolved',
)

console.log('SMOKE CORE EXPORT OK: standalone html / pipeline render / diagram hydrate')

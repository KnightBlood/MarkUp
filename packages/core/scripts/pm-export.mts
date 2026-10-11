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

// ---- 导出选项：页面设置 / HTML 追加 / 大纲 --------------------------------
{
  const { buildStandaloneHtml, exportOptionsFromConfig } = await import('../src/exportHtml')

  const plain = buildStandaloneHtml('<p>x</p>', { title: 'T' })
  assert(!plain.includes('@page'), 'no page rules unless asked for')
  assert(plain.includes('<style>') && plain.includes('</style>'), 'stylesheet present')

  const paged = buildStandaloneHtml('<p>x</p>', {
    title: 'T',
    pageSize: 'A4',
    pageMargin: '20mm',
    pageBreakOnH1: true,
  })
  assert(paged.includes('@page { size: A4; margin: 20mm; }'), 'page size and margin emitted')
  assert(paged.includes('h1 { break-before: page; }'), '按一级标题分页 emitted')

  // The values land inside a <style> element, so a `}` must not get through —
  // it would end the rule and let the rest of the value become arbitrary CSS.
  const injected = buildStandaloneHtml('<p>x</p>', {
    pageSize: 'A4 } body { display: none',
  })
  assert(!injected.includes('@page'), 'a value that could break out emits no rule at all')
  assert(!injected.includes('body { display: none'), 'and none of the injected text survives')

  const extras = buildStandaloneHtml('<p>x</p>', {
    customCss: '.x { color: red }',
    headHtml: '<meta name="a" content="b">',
    bodyHtml: '<script>void 0</script>',
  })
  // Custom CSS has to come *after* the built-in sheet or it could not override it.
  assert(extras.indexOf('.x { color: red }') > extras.indexOf('h1, h2, h3'), 'custom CSS wins')
  assert(extras.includes('<meta name="a" content="b">'), 'head extra injected')
  assert(extras.indexOf('<script>void 0</script>') > extras.indexOf('</article>'), 'body extra injected')

  // 大纲: prepending the document's own marker reuses the same construct, so the
  // outline links and the heading ids cannot disagree.
  const outlineDoc = await exportHtmlDocument('# 标题\n\n正文', { outline: true })
  assert(outlineDoc.includes('class="md-toc"'), 'outline emits the document outline')
  assert(
    outlineDoc.indexOf('class="md-toc"') < outlineDoc.indexOf('标题</h1>'),
    'outline sits before the body',
  )
  // An author-written [TOC] must not be duplicated by the option.
  const already = await exportHtmlDocument('[TOC]\n\n# 标题', { outline: true })
  assert(
    (already.match(/class="md-toc"/g) ?? []).length === 1,
    'an existing [TOC] is not doubled up',
  )
  const noOutline = await exportHtmlDocument('# 标题\n\n正文', {})
  assert(!noOutline.includes('class="md-toc"'), 'no outline unless asked for')

  // ---- 首行缩进 ----
  assert(!plain.includes('text-indent'), 'no indent rule unless asked for')
  assert(
    buildStandaloneHtml('<p>x</p>', { firstLineIndent: true }).includes(
      '.markdown-body p { text-indent: 2em; }',
    ),
    '首行缩进 reaches the exported stylesheet',
  )
  // It is a layout rule, so it belongs with the other 页面设置 output rather than
  // in the base sheet — and the config maps onto it from the editor setting.
  assert(
    exportOptionsFromConfig({ firstLineIndent: true }).firstLineIndent === true,
    'the editor setting feeds the export',
  )
  assert(
    exportOptionsFromConfig({}).firstLineIndent === false,
    'and absent means off',
  )

  // Config → options: absent keys mean the behaviour before these settings.
  const opts = exportOptionsFromConfig({})
  assert(
    opts.outline === false && opts.pageBreakOnH1 === false,
    'absent config keys are off, not undefined-vs-false surprises',
  )
  assert(
    opts.customCss === undefined && opts.pageSize === undefined,
    'absent strings stay absent so the builder can skip them',
  )
  const on = exportOptionsFromConfig({ exportOutline: true, exportPageSize: 'Letter' })
  assert(on.outline === true && on.pageSize === 'Letter', 'config maps through')
}

console.log('SMOKE CORE EXPORT OK: standalone html / pipeline render / diagram hydrate')

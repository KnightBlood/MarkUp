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
define('MutationObserver', window.MutationObserver)
define('CustomEvent', window.CustomEvent)
define('getComputedStyle', window.getComputedStyle.bind(window))
define('File', window.File)
define('Blob', window.Blob)
define('FileReader', window.FileReader)
define('DOMParser', (window as unknown as { DOMParser: unknown }).DOMParser)
define('XMLSerializer', (window as unknown as { XMLSerializer: unknown }).XMLSerializer)
let rafId = 0
define('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => cb(rafId++), 16))
define('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
define('addEventListener', (type: string, fn: EventListener) => window.addEventListener(type, fn))
define('removeEventListener', (type: string, fn: EventListener) =>
  window.removeEventListener(type, fn),
)
define('dispatchEvent', (event: Event) => window.dispatchEvent(event))
window.Element.prototype.scrollIntoView = function () {}
window.HTMLElement.prototype.focus = function () {}

// jsdom lacks canvas/SVG layout APIs the PlantUML engine needs for measuring.
const fakeCtx2d = {
  font: '10px sans-serif',
  measureText: (text: string) => ({
    width: Array.from(text).length * 7,
    actualBoundingBoxAscent: 8,
    actualBoundingBoxDescent: 2,
    fontBoundingBoxAscent: 8,
    fontBoundingBoxDescent: 2,
  }),
}
;(window as unknown as { HTMLCanvasElement: { prototype: Record<string, unknown> } })
  .HTMLCanvasElement.prototype.getContext = function () {
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

const errors: unknown[] = []
const originalError = console.error
console.error = (...args: unknown[]): void => {
  errors.push(args.map(String).join(' '))
}

import type { EmbedContent } from '../src/embeds'

const {
  normalizeEmbedLang,
  resolveEmbedSrc,
  resolveEmbedText,
  setEmbedSourceResolver,
  setEmbedEnlargeHandler,
  hydrateEmbeds,
  requestEmbedEnlarge,
  parseEmbedContent,
  normalizeDrawioXml,
  MINDMAP_TEMPLATE,
  PLANTUML_TEMPLATE,
} = await import('../src/embeds')
const { renderMarkdownHtml, hydrateExportDiagrams, buildStandaloneHtml } = await import(
  '../src/exportHtml'
)
const { createWysiwygAdapter } = await import('../src/adapters/wysiwyg')

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const waitFor = async (probe: () => unknown, label: string): Promise<void> => {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (probe()) return
    await sleep(50)
  }
  throw new Error(`timeout waiting for ${label}`)
}

// ---- language aliases ----
assert(normalizeEmbedLang('model') === 'model', 'model')
assert(normalizeEmbedLang('GLB') === 'model', 'GLB alias')
assert(normalizeEmbedLang('gltf') === 'model', 'gltf alias')
assert(normalizeEmbedLang('3d') === 'model', '3d alias')
assert(normalizeEmbedLang('video') === 'video', 'video')
assert(normalizeEmbedLang('mp4') === 'video', 'mp4 alias')
assert(normalizeEmbedLang('webm') === 'video', 'webm alias')
assert(normalizeEmbedLang('ogg') === 'video', 'ogg alias')
// avbridge-era containers (see EMBED_ALIASES)
assert(normalizeEmbedLang('mkv') === 'video', 'mkv alias')
assert(normalizeEmbedLang('MKV') === 'video', 'mkv alias upper')
assert(normalizeEmbedLang('avi') === 'video', 'avi alias')
assert(normalizeEmbedLang('wmv') === 'video', 'wmv alias')
assert(normalizeEmbedLang('flv') === 'video', 'flv alias')
assert(normalizeEmbedLang('rmvb') === 'video', 'rmvb alias')
assert(normalizeEmbedLang('3gp') === 'video', '3gp alias')
assert(normalizeEmbedLang('qt') === 'video', 'qt alias')
// `ts`/`mts` are TypeScript — MPEG-TS goes through ```video + path or ```file.
assert(normalizeEmbedLang('ts') === null, 'ts stays TypeScript')
assert(normalizeEmbedLang('mts') === null, 'mts stays TypeScript')
assert(normalizeEmbedLang('mindmap') === 'mindmap', 'mindmap')
assert(normalizeEmbedLang('MIND-MAP') === 'mindmap', 'mind-map alias')
assert(normalizeEmbedLang('xmind') === 'xmind', 'xmind')
assert(normalizeEmbedLang('XMIND') === 'xmind', 'xmind upper')
assert(normalizeEmbedLang('drawio') === 'drawio', 'drawio')
assert(normalizeEmbedLang('DIO') === 'drawio', 'dio alias')
assert(normalizeEmbedLang('plantuml') === 'plantuml', 'plantuml')
assert(normalizeEmbedLang('puml') === 'plantuml', 'puml alias')
assert(normalizeEmbedLang('file') === 'file', 'file')
assert(normalizeEmbedLang('FILE') === 'file', 'file upper')
assert(normalizeEmbedLang('PDF') === 'file', 'pdf alias upper')
assert(normalizeEmbedLang('pdf') === 'file', 'pdf alias')
assert(normalizeEmbedLang('office') === 'file', 'office alias')
assert(normalizeEmbedLang('docx') === 'file', 'docx alias')
assert(normalizeEmbedLang('ofd') === 'file', 'ofd alias')
assert(normalizeEmbedLang('dwg') === 'file', 'dwg alias')
assert(normalizeEmbedLang('epub') === 'file', 'epub alias')
assert(normalizeEmbedLang('zip') === 'file', 'zip alias')
assert(normalizeEmbedLang('eml') === 'file', 'eml alias')
assert(normalizeEmbedLang('typst') === 'file', 'typst alias')
assert(normalizeEmbedLang('mermaid') === null, 'mermaid not an embed')
assert(normalizeEmbedLang('js') === null, 'js not an embed')
assert(normalizeEmbedLang('') === null, 'empty not an embed')
assert(normalizeEmbedLang(undefined) === null, 'undefined not an embed')
assert(MINDMAP_TEMPLATE.includes('# 中心主题'), 'mindmap template starter')
assert(
  PLANTUML_TEMPLATE.includes('@startuml') && PLANTUML_TEMPLATE.includes('@enduml'),
  'plantuml template fences',
)

// ---- pipeline placeholder ----
{
  const html = await renderMarkdownHtml(
    ['# 标题', '', '```model', '/tmp/duck.glb', '```', '', '```mindmap', '# 中心', '```'].join('\n'),
  )
  assert(html.includes('data-embed="model"'), 'pipeline emits model wrapper')
  assert(html.includes('data-embed="mindmap"'), 'pipeline emits mindmap wrapper')
  assert(html.includes('md-embed__source'), 'pipeline keeps the source block')
  assert(html.includes('/tmp/duck.glb'), 'fence content carried')
  const videoHtml = await renderMarkdownHtml(
    ['```video', '/tmp/clip.mp4', '```', '', '```model', '<b>&x</b>', '```'].join('\n'),
  )
  assert(
    videoHtml.includes('data-embed="video"') && videoHtml.includes('/tmp/clip.mp4'),
    'video placeholder',
  )
  assert(videoHtml.includes('&lt;b&gt;&amp;x&lt;/b&gt;'), 'model fence content escaped')
  const fileHtml = await renderMarkdownHtml(['```file', '/tmp/合同.pdf', '```'].join('\n'))
  assert(fileHtml.includes('data-embed="file"'), 'file placeholder')
  assert(fileHtml.includes('/tmp/合同.pdf'), 'file fence path carried')
  const pdfLangHtml = await renderMarkdownHtml(['```pdf', '/tmp/a.pdf', '```'].join('\n'))
  assert(pdfLangHtml.includes('data-embed="file"'), 'pdf lang maps to file wrapper')
  const trioHtml = await renderMarkdownHtml(
    [
      '```xmind',
      '/tmp/plan.xmind',
      '```',
      '',
      '```drawio',
      '<mxGraphModel/>',
      '```',
      '',
      '```plantuml',
      '@startuml',
      'Alice -> Bob : Hi',
      '@enduml',
      '```',
    ].join('\n'),
  )
  assert(trioHtml.includes('data-embed="xmind"'), 'xmind placeholder')
  assert(trioHtml.includes('data-embed="drawio"'), 'drawio placeholder')
  assert(trioHtml.includes('data-embed="plantuml"'), 'plantuml placeholder')
  assert(trioHtml.includes('@enduml'), 'plantuml fence content carried')
}

// ---- resolveEmbedSrc branches ----
{
  setEmbedSourceResolver(null)
  assert(
    (await resolveEmbedSrc('https://example.com/a.glb')) === 'https://example.com/a.glb',
    'http URL direct',
  )
  assert(
    (await resolveEmbedSrc(' data:video/mp4;base64,AAAA ')) === 'data:video/mp4;base64,AAAA',
    'data URL direct (trimmed)',
  )
  let rejected = false
  try {
    await resolveEmbedSrc('/tmp/a.glb')
  } catch {
    rejected = true
  }
  assert(rejected, 'local path without resolver rejects')

  setEmbedSourceResolver(async (path) => (path === '/tmp/ok.glb' ? 'data:model/gltf-binary;base64,AAAA' : null))
  assert(
    (await resolveEmbedSrc('/tmp/ok.glb')) === 'data:model/gltf-binary;base64,AAAA',
    'resolver data URL',
  )
  let rejectedNull = false
  try {
    await resolveEmbedSrc('/tmp/missing.glb')
  } catch {
    rejectedNull = true
  }
  assert(rejectedNull, 'resolver returning null rejects')
  setEmbedSourceResolver(null)
}

// ---- parseEmbedContent: path vs inline shapes ----
{
  const asText = (value: EmbedContent): string => {
    assert(value.kind === 'text', `expected text, got ${JSON.stringify(value)}`)
    return value.text
  }
  const asPath = (value: EmbedContent): string => {
    assert(value.kind === 'path', `expected path, got ${JSON.stringify(value)}`)
    return value.path
  }
  assert(
    asText(parseEmbedContent('plantuml', '@startuml\nAlice -> Bob\n@enduml')) ===
      '@startuml\nAlice -> Bob\n@enduml',
    'plantuml multiline DSL is text',
  )
  assert(asText(parseEmbedContent('plantuml', '  @startuml A -> B @enduml  ')) === '@startuml A -> B @enduml', 'plantuml single-line DSL is text')
  assert(asPath(parseEmbedContent('plantuml', 'C:\\docs\\seq.puml')) === 'C:\\docs\\seq.puml', 'plantuml windows path')
  assert(asPath(parseEmbedContent('plantuml', ' diagrams/a.puml ')) === 'diagrams/a.puml', 'plantuml posix path trimmed')
  assert(asText(parseEmbedContent('drawio', '<mxfile><diagram/></mxfile>')).startsWith('<mxfile'), 'drawio inline mxfile')
  assert(asText(parseEmbedContent('drawio', '<mxGraphModel/>')) === '<mxGraphModel/>', 'drawio single-line model')
  assert(asPath(parseEmbedContent('drawio', '/tmp/net.drawio')) === '/tmp/net.drawio', 'drawio path')
  assert(asPath(parseEmbedContent('drawio', 'plan.dio')) === 'plan.dio', 'dio path')
  assert(
    asPath(parseEmbedContent('file', 'C:\\docs\\合同.pdf')) === 'C:\\docs\\合同.pdf',
    'file windows path',
  )
  assert(asPath(parseEmbedContent('file', ' docs/report.docx ')) === 'docs/report.docx', 'file path trimmed')
  assert(
    asPath(parseEmbedContent('file', 'https://x.test/a.pdf#page=2')) === 'https://x.test/a.pdf#page=2',
    'file url kept',
  )
  {
    let fileMulti = false
    try {
      parseEmbedContent('file', '/tmp/a.pdf\n/tmp/b.docx')
    } catch {
      fileMulti = true
    }
    assert(fileMulti, 'file multiline rejects')
  }
  let badShape = false
  try {
    parseEmbedContent('drawio', 'first line\nsecond line')
  } catch {
    badShape = true
  }
  assert(badShape, 'drawio multiline non-XML rejects')
  let badPuml = false
  try {
    parseEmbedContent('plantuml', 'not a dsl\nsecond line')
  } catch {
    badPuml = true
  }
  assert(badPuml, 'plantuml multiline without @start rejects')
}

// ---- resolveEmbedText: data URL / resolver path / missing resolver ----
{
  const utf8ToB64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64')
  const CHINESE = '中文内容 ✓ @enduml'
  assert(
    (await resolveEmbedText(`data:text/plain;base64,${utf8ToB64(CHINESE)}`)) === CHINESE,
    'resolveEmbedText decodes utf-8 data URL',
  )
  setEmbedSourceResolver(null)
  let rejected = false
  try {
    await resolveEmbedText('/tmp/a.puml')
  } catch {
    rejected = true
  }
  assert(rejected, 'resolveEmbedText without resolver rejects')
  setEmbedSourceResolver(async (path) =>
    path === '/tmp/a.puml'
      ? `data:text/plain;base64,${utf8ToB64('Alice -> Bob')}`
      : null,
  )
  assert((await resolveEmbedText('/tmp/a.puml')) === 'Alice -> Bob', 'resolver path → text')
  setEmbedSourceResolver(null)
}

// ---- normalizeDrawioXml: raw model / nested mxfile / compressed diagram ----
{
  const MODEL =
    '<mxGraphModel dx="1" dy="2"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>'
  assert((await normalizeDrawioXml(MODEL)) === MODEL, 'raw mxGraphModel passthrough')

  const nested = `<mxfile host="x"><diagram name="Page-1" id="d1">${MODEL}</diagram></mxfile>`
  const unwrapped = await normalizeDrawioXml(nested)
  assert(unwrapped.includes('<mxGraphModel'), 'nested diagram unwrapped')
  assert(unwrapped.includes('mxCell id="0"'), 'nested cells kept')

  const { deflateSync } = await import('fflate')
  const raw = deflateSync(new TextEncoder().encode(MODEL))
  let binary = ''
  for (const byte of raw) binary += String.fromCharCode(byte)
  const compressed = btoa(binary)
  const packed = `<mxfile><diagram name="P" id="d2">${compressed}</diagram></mxfile>`
  const inflated = await normalizeDrawioXml(packed)
  assert(inflated.includes('<mxGraphModel'), 'compressed diagram inflated')

  let emptyDiagram = false
  try {
    await normalizeDrawioXml('<mxfile><diagram name="x" id="y"/></mxfile>')
  } catch (error) {
    emptyDiagram = /为空/.test(String(error))
  }
  assert(emptyDiagram, 'empty diagram rejects')

  let badRoot = false
  try {
    await normalizeDrawioXml('<html><body/></html>')
  } catch (error) {
    badRoot = /根节点/.test(String(error))
  }
  assert(badRoot, 'foreign root rejects')
}

// ---- hydrate: video data URL is deterministic; rerun is a no-op ----
const VIDEO_URL = 'data:video/mp4;base64,AAAA'
const host = window.document.getElementById('root') as HTMLElement
{
  host.innerHTML = `<div class="md-embed" data-embed="video"><pre class="md-embed__source"><code>${VIDEO_URL}</code></pre></div>`
  const wrap = host.querySelector('.md-embed') as HTMLElement
  const result = await hydrateEmbeds(host)
  assert(result.rendered === 1 && result.failed === 0, `video hydrate: ${JSON.stringify(result)}`)
  assert(wrap.dataset.rendered === '1', 'video wrapper marked rendered')
  assert(wrap.querySelector('video'), 'video element rendered')
  const rerun = await hydrateEmbeds(host)
  assert(rerun.rendered === 0 && rerun.failed === 0, 'rerender skipped')
  assert(host.querySelectorAll('video').length === 1, 'no duplicate video')
}

// ---- hydrate: non-native container escalates to avbridge → deterministic fallback ----
{
  host.innerHTML = `<div class="md-embed" data-embed="mkv"><pre class="md-embed__source"><code>/tmp/clip.mkv</code></pre></div>`
  const wrap = host.querySelector('.md-embed') as HTMLElement
  // Pin the libav base to a scheme fetch rejects on the spot: no network, no
  // engine in Node — createPlayer must reject fast and the embed must land on
  // the same source-block fallback every media error gets. (Real shells load
  // the engine from <baseURI>/vendor/libav — see scripts/libav-vendor-plugin.mjs.)
  const scope = globalThis as { AVBRIDGE_LIBAV_BASE?: unknown }
  scope.AVBRIDGE_LIBAV_BASE = 'nope://libav.invalid'
  setEmbedSourceResolver(async (path) =>
    path === '/tmp/clip.mkv' ? 'data:video/x-matroska;base64,QUJD' : null,
  )
  try {
    const result = await hydrateEmbeds(host)
    // renderVideo settles before the async escalation runs; avbridge then
    // rejects and flips the wrapper to the error state.
    assert(result.rendered === 1 && result.failed === 0, `mkv hydrate: ${JSON.stringify(result)}`)
    assert(wrap.dataset.rendered === '1', 'mkv wrapper rendered before escalation settles')
    await waitFor(() => wrap.dataset.error === '1', 'mkv avbridge escalation error')
    assert(wrap.classList.contains('md-embed--error'), 'mkv error class')
    assert(!wrap.dataset.rendered, 'rendered flag cleared on escalation failure')
    assert(wrap.querySelector('.md-embed__source'), 'mkv keeps source block')
  } finally {
    setEmbedSourceResolver(null)
    delete scope.AVBRIDGE_LIBAV_BASE
  }
}

// ---- hydrate: local path without resolver → error state, source kept ----
{
  host.innerHTML = `<div class="md-embed" data-embed="model"><pre class="md-embed__source"><code>/tmp/nope.glb</code></pre></div>`
  const wrap = host.querySelector('.md-embed') as HTMLElement
  const result = await hydrateEmbeds(host)
  assert(result.failed === 1, `failure counted: ${JSON.stringify(result)}`)
  assert(wrap.dataset.error === '1', 'wrapper marked error')
  assert(wrap.classList.contains('md-embed--error'), 'error class present')
  assert(!wrap.querySelector('video'), 'no half-rendered child')
  assert(!wrap.querySelector('.md-embed__canvas'), 'failed canvas removed')
  assert(wrap.querySelector('.md-embed__source'), 'source block kept for fallback')
}

// ---- hydrate: mindmap / model tolerate rendered OR error (env dependent) ----
{
  host.innerHTML =
    `<div class="md-embed" data-embed="mindmap"><pre class="md-embed__source"><code>${MINDMAP_TEMPLATE}</code></pre></div>`
  await hydrateEmbeds(host)
  const wrap = host.querySelector('.md-embed') as HTMLElement
  assert(
    wrap.dataset.rendered === '1' || wrap.dataset.error === '1',
    'mindmap settles as rendered or error',
  )
  if (wrap.dataset.rendered === '1') {
    assert(wrap.querySelector('svg'), 'rendered mindmap has svg')
  }
}

// ---- hydrate: drawio inline XML mounts the file viewer (renderer-drawing) ----
{
  host.replaceChildren()
  const wrap = host.ownerDocument!.createElement('div')
  wrap.className = 'md-embed'
  wrap.dataset.embed = 'drawio'
  const pre = wrap.ownerDocument.createElement('pre')
  pre.className = 'md-embed__source'
  const codeEl = pre.ownerDocument.createElement('code')
  codeEl.textContent =
    '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    '<mxCell id="2" value="Box" style="rounded=0;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">' +
    '<mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell>' +
    '<mxCell id="3" value="End" style="ellipse;fillColor=#d5e8d4;" vertex="1" parent="1">' +
    '<mxGeometry x="240" y="40" width="120" height="60" as="geometry"/></mxCell>' +
    '<mxCell id="4" edge="1" parent="1" source="2" target="3">' +
    '<mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel>'
  pre.append(codeEl)
  wrap.append(pre)
  host.append(wrap)
  const result = await hydrateEmbeds(host)
  assert(result.rendered === 1 && result.failed === 0, `drawio hydrate: ${JSON.stringify(result)}`)
  assert(wrap.dataset.rendered === '1', 'drawio wrapper marked rendered')
  assert(wrap.querySelector('.md-embed__file'), 'drawio mounts through the file viewer host')
  const drawioViewer = wrap.querySelector('flyfish-file-viewer') as
    | (HTMLElement & { filename?: string })
    | null
  assert(drawioViewer, 'drawio file viewer element mounted')
  assert(drawioViewer?.filename === 'inline.drawio', `drawio filename routed: ${drawioViewer?.filename}`)
}

// ---- hydrate: plantuml DSL renders offline (strong) ----
{
  host.replaceChildren()
  const mkPumlWrap = (body: string): HTMLElement => {
    const wrap = host.ownerDocument!.createElement('div')
    wrap.className = 'md-embed'
    wrap.dataset.embed = 'plantuml'
    const pre = wrap.ownerDocument.createElement('pre')
    pre.className = 'md-embed__source'
    const codeEl = pre.ownerDocument.createElement('code')
    codeEl.textContent = body
    pre.append(codeEl)
    wrap.append(pre)
    host.append(wrap)
    return wrap
  }
  const wrapA = mkPumlWrap(PLANTUML_TEMPLATE)
  const wrapB = mkPumlWrap('@startmindmap\n* Root\n** Leaf\n@endmindmap')
  // The TeaVM engine prints progress through console.log — keep smoke output clean.
  const originalLog = console.log
  console.log = (): void => {}
  let result: { rendered: number; failed: number }
  try {
    result = await hydrateEmbeds(host)
  } finally {
    console.log = originalLog
  }
  assert(result.rendered === 2 && result.failed === 0, `plantuml hydrate: ${JSON.stringify(result)}`)
  const svgA = wrapA.querySelector('.md-embed__plantuml svg')
  assert(svgA, 'plantuml sequence svg present')
  assert(/Alice/.test(svgA?.outerHTML ?? ''), 'sequence label painted')
  const svgB = wrapB.querySelector('.md-embed__plantuml svg')
  assert(svgB, 'second (queued) plantuml svg present — renders serialize')
}

// ---- hydrate: xmind file through resolver (mounts file viewer) ----
{
  host.replaceChildren()
  const { zipSync } = await import('fflate')
  const contentJson = JSON.stringify([
    {
      id: 's1',
      class: 'sheet',
      title: 'Sheet 1',
      rootTopic: { id: 't1', title: '中心', children: { attached: [{ id: 't2', title: '分支' }] } },
    },
  ])
  const zip = zipSync({ 'content.json': new TextEncoder().encode(contentJson) })
  const zipB64 = Buffer.from(zip).toString('base64')
  const notZipB64 = Buffer.from('this is not a zip').toString('base64')
  const wrapXmind = host.ownerDocument!.createElement('div')
  wrapXmind.className = 'md-embed'
  wrapXmind.dataset.embed = 'xmind'
  const preX = wrapXmind.ownerDocument.createElement('pre')
  preX.className = 'md-embed__source'
  const codeX = preX.ownerDocument.createElement('code')
  codeX.textContent = '/tmp/plan.xmind'
  preX.append(codeX)
  wrapXmind.append(preX)
  host.append(wrapXmind)
  const wrapBad = host.ownerDocument!.createElement('div')
  wrapBad.className = 'md-embed'
  wrapBad.dataset.embed = 'xmind'
  const preB = wrapBad.ownerDocument.createElement('pre')
  preB.className = 'md-embed__source'
  const codeB = preB.ownerDocument.createElement('code')
  codeB.textContent = '/tmp/broken.xmind'
  preB.append(codeB)
  wrapBad.append(preB)
  host.append(wrapBad)

  setEmbedSourceResolver(async (path) => {
    if (path === '/tmp/plan.xmind') return `data:application/octet-stream;base64,${zipB64}`
    if (path === '/tmp/broken.xmind') return `data:application/octet-stream;base64,${notZipB64}`
    return null
  })
  const result = await hydrateEmbeds(host)
  setEmbedSourceResolver(null)
  assert(wrapXmind.dataset.rendered === '1', `xmind settles rendered: ${JSON.stringify(result)}`)
  const xmindViewer = wrapXmind.querySelector('flyfish-file-viewer') as
    | (HTMLElement & { filename?: string })
    | null
  assert(xmindViewer, 'xmind file viewer element mounted')
  assert(xmindViewer?.filename === 'plan.xmind', `xmind filename routed: ${xmindViewer?.filename}`)
  // Corrupt bytes are surfaced by the viewer's own panel, so the embed itself
  // still settles as rendered (no md-embed--error fallback anymore).
  assert(wrapBad.dataset.rendered === '1', 'broken xmind still mounts the viewer')
  assert(wrapBad.querySelector('flyfish-file-viewer'), 'broken xmind viewer element present')
}

// ---- hydrate: file fence → file-viewer element (tolerant of jsdom runtime) ----
{
  host.replaceChildren()
  const wrapFile = host.ownerDocument!.createElement('div')
  wrapFile.className = 'md-embed'
  wrapFile.dataset.embed = 'file'
  const preF = wrapFile.ownerDocument.createElement('pre')
  preF.className = 'md-embed__source'
  const codeF = preF.ownerDocument.createElement('code')
  codeF.textContent = '/tmp/合同.pdf'
  preF.append(codeF)
  wrapFile.append(preF)
  host.append(wrapFile)
  setEmbedSourceResolver(async (path) =>
    path === '/tmp/合同.pdf' ? 'data:application/pdf;base64,JVBERi0xLjQK' : null,
  )
  const result = await hydrateEmbeds(host)
  setEmbedSourceResolver(null)
  assert(
    wrapFile.dataset.rendered === '1' || wrapFile.dataset.error === '1',
    `file hydrate settles: ${JSON.stringify(result)}`,
  )
  if (wrapFile.dataset.rendered === '1') {
    const hostDiv = wrapFile.querySelector('.md-embed__file')
    assert(hostDiv, 'file viewer host div present')
    const viewer = hostDiv?.querySelector('flyfish-file-viewer')
    assert(viewer, 'flyfish-file-viewer element mounted')
    // The source block stays in the DOM for CSS hiding (same as every kind).
    assert(
      wrapFile.querySelector('.md-embed__source')?.textContent === '/tmp/合同.pdf',
      'source block preserved for CSS hiding',
    )
  } else {
    // jsdom may not satisfy the viewer runtime (workers/assets) — the failure
    // path must keep the source block visible like every other embed kind.
    assert(wrapFile.classList.contains('md-embed--error'), 'file error class')
    assert(wrapFile.querySelector('.md-embed__source'), 'failed file keeps source block')
  }
}

// ---- enlarge bridge ----
{
  setEmbedEnlargeHandler(null)
  assert(requestEmbedEnlarge({ kind: 'video', code: VIDEO_URL }) === false, 'no handler → false')
  let seen: { kind: string; code: string } | null = null
  setEmbedEnlargeHandler((request) => {
    seen = request
  })
  assert(requestEmbedEnlarge({ kind: 'video', code: VIDEO_URL }) === true, 'handler → true')
  assert(seen !== null && seen.kind === 'video' && seen.code === VIDEO_URL, 'handler payload')
  setEmbedEnlargeHandler(null)
}

// ---- wysiwyg widget: fence → widget with 放大/编辑 bar ----
{
  const updates: string[] = []
  const wy = createWysiwygAdapter({ onChange: (md) => updates.push(md) })
  wy.setValue(`# t\n\n\`\`\`video\n${VIDEO_URL}\n\`\`\`\n`)
  wy.mount(host)
  await waitFor(() => host.querySelector('.md-embed--widget'), 'embed widget')
  const widget = host.querySelector('.md-embed--widget') as HTMLElement
  assert(widget.dataset.embed === 'video', 'widget kind')
  assert(
    host.querySelector('.md-embed-hidden'),
    'source code_block hidden by node decoration',
  )
  const buttons = Array.from(widget.querySelectorAll<HTMLButtonElement>('.md-embed__btn'))
  const enlarge = buttons.find((b) => b.textContent === '放大')
  const edit = buttons.find((b) => b.textContent === '编辑')
  assert(enlarge && edit, 'bar has 放大 and 编辑')
  let enlarged: { kind: string; code: string } | null = null
  setEmbedEnlargeHandler((request) => {
    enlarged = request
  })
  enlarge.click()
  assert(enlarged !== null, '放大 invokes enlarge handler')
  assert(enlarged?.kind === 'video' && enlarged?.code === VIDEO_URL, 'enlarge payload')
  setEmbedEnlargeHandler(null)
  await waitFor(() => widget.querySelector('video'), 'widget video rendered')
  wy.unmount()
}

// ---- export: video hydrates into <video>, model adds CDN script ----
{
  const body = await renderMarkdownHtml(['```video', VIDEO_URL, '```'].join('\n'))
  const hydrated = await hydrateExportDiagrams(body)
  assert(hydrated.includes('<video'), 'export body carries rendered <video')
  const doc = buildStandaloneHtml(hydrated, { title: 'x' })
  assert(doc.includes('<video'), 'standalone html includes video')
  assert(!doc.includes('model-viewer.min.js'), 'no model CDN without model embed')

  const modelBody = await renderMarkdownHtml(['```model', '/tmp/a.glb', '```'].join('\n'))
  const modelDoc = buildStandaloneHtml(modelBody, { title: 'x' })
  assert(modelDoc.includes('data-embed="model"'), 'model wrapper in export')
  assert(
    modelDoc.includes('https://cdn.jsdelivr.net/npm/@google/model-viewer@4.3.1/'),
    'model CDN script pinned',
  )

  // New embed kinds flow through the same pipeline: wrapper lands in the
  // export body, hydration inlines the rendered SVG (no scripts needed).
  const pumlBody = await renderMarkdownHtml(['```plantuml', PLANTUML_TEMPLATE, '```'].join('\n'))
  assert(pumlBody.includes('data-embed="plantuml"'), 'plantuml wrapper in export pipeline')
  const originalLog2 = console.log
  console.log = (): void => {}
  let pumlHydrated: string
  try {
    pumlHydrated = await hydrateExportDiagrams(pumlBody)
  } finally {
    console.log = originalLog2
  }
  assert(pumlHydrated.includes('md-embed__plantuml'), 'export hydrates plantuml to svg')
  assert(/<svg[\s>]/.test(pumlHydrated), 'export carries inline svg')

  const xmindBody = await renderMarkdownHtml(['```xmind', '/tmp/plan.xmind', '```'].join('\n'))
  assert(xmindBody.includes('data-embed="xmind"'), 'xmind wrapper in export pipeline')

  // file-viewer renders into Shadow DOM + workers that cannot be serialized
  // into a standalone document: export skips hydration and keeps the source.
  const fileBody = await renderMarkdownHtml(['```file', '/tmp/合同.pdf', '```'].join('\n'))
  assert(fileBody.includes('data-embed="file"'), 'file wrapper in export pipeline')
  const fileHydrated = await hydrateExportDiagrams(fileBody)
  assert(fileHydrated.includes('data-embed="file"'), 'file wrapper kept in export')
  assert(!fileHydrated.includes('data-rendered'), 'file stays unrendered in export')
  assert(fileHydrated.includes('/tmp/合同.pdf'), 'file source block kept for export')
}

console.error = originalError
// hydrate keeps the source block on failure and logs '[markup] 嵌入渲染失败';
// the no-resolver / model / mindmap cases above exercise exactly that path.
// avbridge logs its own diagnostics through console.error ('[avbridge]…'),
// and the mkv escalation case expects exactly that failure chain.
const unexpected = errors.filter(
  (entry) => !entry.includes('嵌入渲染失败') && !entry.includes('[avbridge'),
)
assert(unexpected.length === 0, `unexpected console.error output:\n${unexpected.join('\n')}`)
console.log(
  'SMOKE CORE EMBED OK: aliases(mindmap/xmind/drawio/puml/avbridge-containers, ts/mts stay TS) + pipeline placeholders + resolve branches + parseEmbedContent + resolveEmbedText + normalizeDrawioXml + hydrate video/error/mkv→avbridge escalation/drawio/plantuml/xmind/file (drawio+xmind now mount the file viewer) + widget bar + export video/model/plantuml/file-skip',
)

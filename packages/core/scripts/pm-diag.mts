import { JSDOM } from 'jsdom'
import { hydrateDiagrams, normalizeDiagramLang } from '../src/diagrams'
import { createSharedPipeline } from '../src/pipeline'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(normalizeDiagramLang('mermaid') === 'mermaid', 'alias mermaid')
assert(normalizeDiagramLang('flow') === 'flow', 'alias flow')
assert(normalizeDiagramLang('flowchart') === 'flow', 'alias flowchart')
assert(normalizeDiagramLang(' graph ') === 'mermaid', 'alias graph + trim')
assert(normalizeDiagramLang('js') === null, 'non-diagram lang')
assert(normalizeDiagramLang(null) === null, 'null lang')

const markdown = [
  '---',
  'title: demo',
  'tags: [a, b]',
  '---',
  '',
  '# 标题 A',
  '',
  '## 标题 A',
  '',
  '<script>alert(1)</script>',
  '',
  '```mermaid',
  'flowchart TD',
  '  A[开始] --> B{判断}',
  '  B -->|是| C[结束]',
  '```',
  '',
  '```flow',
  'st=>start: Start',
  'e=>end: End',
  'st->e',
  '```',
  '',
  '```js',
  'const a = 1',
  '```',
  '',
  '```math',
  'E = mc^2',
  '```',
  '',
  '行内公式 $x^2 + y^2 = z^2$ 与块级公式：',
  '',
  '$$\\int_0^1 x^2 \\,dx = \\frac{1}{3}$$',
  '',
].join('\n')

const pipeline = createSharedPipeline()
const { html, toc } = await pipeline.render(markdown)

assert(html.includes('data-diagram="mermaid"'), 'mermaid placeholder missing')
assert(html.includes('data-diagram="flow"'), 'flow placeholder missing')
assert(!html.includes('<script>'), 'raw html not stripped')
assert(html.includes('language-js'), 'plain code fence lost')
assert(html.includes('data-math="block"'), 'math fence placeholder missing')
assert(html.includes('katex'), 'math fence katex html missing')
assert(html.includes('class="katex"'), 'katex span missing')
assert(html.includes('title: demo') === false, 'frontmatter body should not leak title raw block')
assert(html.includes('E = mc') || html.includes('E = mc^{2}') || html.includes('E = mc'), 'math source missing')
assert(toc.length === 2, `toc length: ${toc.length}`)
assert(toc[0]?.text === '标题 A', 'toc first text')
assert(toc[1]?.text === '标题 A', 'toc second text')
assert(toc[0]?.id !== toc[1]?.id, 'toc slugs not unique')

const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { pretendToBeVisual: true })
const g = globalThis as unknown as Record<string, unknown>
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
void g
Object.defineProperty(dom.window.Element.prototype, 'scrollIntoView', { value: () => {} })

const nodes = Array.from(dom.window.document.querySelectorAll('.md-diagram'))
assert(nodes.length === 2, `diagram nodes: ${nodes.length}`)

const first = await hydrateDiagrams(dom.window.document.body)
for (const node of nodes) {
  const done = node.dataset.rendered !== undefined || node.dataset.error !== undefined
  assert(done, 'diagram node not resolved')
}
assert(first.rendered + first.failed === 2, `hydrate counts: ${JSON.stringify(first)}`)

const second = await hydrateDiagrams(dom.window.document.body)
assert(second.rendered === 0 && second.failed === 0, 'hydrate not idempotent')

console.log(
  `SMOKE PIPELINE/DIAGRAM OK: toc=${toc.map((t) => t.id).join(',')} hydrate=${first.rendered}/${first.failed}`,
)

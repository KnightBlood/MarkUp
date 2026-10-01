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
define('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => cb(rafId++), 16))
define('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
define('addEventListener', (type: string, fn: EventListener) => window.addEventListener(type, fn))
define('removeEventListener', (type: string, fn: EventListener) =>
  window.removeEventListener(type, fn),
)
define('dispatchEvent', (event: Event) => window.dispatchEvent(event))
window.Element.prototype.scrollIntoView = function () {}
window.HTMLElement.prototype.focus = function () {}

// jsdom lacks canvas/SVG geometry APIs used by measurement code paths.
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

const { findFenceAtOffset, fenceContentInsert } = await import('../src/fenceRange')
const {
  isPlantumlFence,
  plantumlFenceTarget,
  setPlantumlResolver,
  resolvePlantumlTarget,
} = await import('../src/plantumlEditBridge')
const { createSourceAdapter } = await import('../src/adapters/source')
const { createWysiwygAdapter } = await import('../src/adapters/wysiwyg')

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
async function waitFor<T>(probe: () => T | null | undefined | false, label: string): Promise<T> {
  const deadline = Date.now() + 8000
  for (;;) {
    const hit = probe()
    if (hit) return hit
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`)
    await sleep(50)
  }
}

// ---- fence scan: content span, aliases, foreign/unclosed fences ----
const md = [
  '# doc',
  '',
  '```plantuml',
  'Alice -> Bob: hi',
  'Bob --> Alice: ok',
  '```',
  '',
  'plain text',
  '',
  '```js',
  'const a = 1',
  '```',
].join('\n')
{
  const inContent = md.indexOf('Alice')
  const range = findFenceAtOffset(md, inContent, isPlantumlFence)
  assert(range, 'plantuml fence found at content offset')
  assert(
    range.code === 'Alice -> Bob: hi\nBob --> Alice: ok',
    `content captured: ${JSON.stringify(range.code)}`,
  )
  assert(
    findFenceAtOffset(md, md.indexOf('```plantuml') + 4, isPlantumlFence),
    'offset on the opener line resolves',
  )
  assert(
    findFenceAtOffset(md, md.indexOf('plain text'), isPlantumlFence) === null,
    'text outside any fence is null',
  )
  assert(
    findFenceAtOffset(md, md.indexOf('const a'), isPlantumlFence) === null,
    'inside a foreign-language fence is null',
  )
  assert(
    findFenceAtOffset('```plantuml\nA -> B', 15, isPlantumlFence) === null,
    'unclosed fence is null',
  )
  assert(isPlantumlFence('puml'), 'puml alias accepted')
  assert(isPlantumlFence('PLANTUML'), 'case-insensitive info string')
  assert(!isPlantumlFence('js'), 'js is not a plantuml fence')
  assert(fenceContentInsert('a') === 'a\n', 'append missing newline')
  assert(fenceContentInsert('a\n') === 'a\n', 'keep existing newline')
  assert(fenceContentInsert('') === '', 'empty stays empty')

  // splice round-trip: the write-back path the plain adapters use
  const captures: Array<[number, number, string]> = []
  const target = plantumlFenceTarget(md, inContent, (from, to, text) => {
    captures.push([from, to, text])
    return true
  })
  assert(target && target.code === range.code, 'target carries the same code')
  assert(target?.writeBack('X -> Y: new') === true, 'writeBack succeeds')
  assert(captures.length === 1, 'replace invoked exactly once')
  const [from, to, text] = captures[0]!
  const spliced = md.slice(0, from) + text + md.slice(to)
  assert(
    spliced.includes('```plantuml\nX -> Y: new\n```'),
    `fences stay valid after splice: ${JSON.stringify(spliced.slice(0, 80))}`,
  )
  assert(spliced.includes('const a = 1'), 'foreign fence untouched')

  // an empty rewrite must still leave a balanced fence: the range already
  // includes the separator newline, so nothing extra is inserted
  const emptyCaptures: Array<[number, number, string]> = []
  const emptyTarget = plantumlFenceTarget(md, inContent, (f, t, s) => {
    emptyCaptures.push([f, t, s])
    return true
  })
  emptyTarget?.writeBack('')
  const [ef, et, etext] = emptyCaptures[0]!
  assert(etext === '', `empty rewrite inserts nothing: ${JSON.stringify(etext)}`)
  const emptied = md.slice(0, ef) + etext + md.slice(et)
  assert(
    emptied.includes('```plantuml\n```'),
    `empty fence stays balanced: ${JSON.stringify(emptied.slice(0, 60))}`,
  )
}

// ---- resolver registry: resolve / throw / clear ----
{
  setPlantumlResolver((anchor) => (anchor.caret ? { code: 'stub', writeBack: () => true } : null))
  const hit = resolvePlantumlTarget({ caret: true })
  assert(hit?.code === 'stub', 'resolver returns the target')
  assert(resolvePlantumlTarget({}) === null, 'pointer anchor misses the caret-only resolver')
  setPlantumlResolver(() => {
    throw new Error('boom')
  })
  const originalWarn = console.warn
  console.warn = (): void => {}
  try {
    assert(resolvePlantumlTarget({ caret: true }) === null, 'throwing resolver degrades to null')
  } finally {
    console.warn = originalWarn
  }
  setPlantumlResolver(null)
  assert(resolvePlantumlTarget({ caret: true }) === null, 'cleared resolver yields null')
}

// ---- source adapter: caret + pointer resolve, splice write-back ----
{
  const host = document.createElement('div')
  document.body.append(host)
  const updates: string[] = []
  const src = createSourceAdapter({ onChange: (next) => updates.push(next) })
  const sourceMd = 'intro\n\n```plantuml\nAlice -> Bob: hi\n```\n\noutro'
  src.setValue(sourceMd)
  src.mount(host)
  const ta = host.querySelector('textarea')
  assert(ta, 'source textarea mounted')
  assert(src.getValue() === sourceMd, 'adapter value set')

  const offset = sourceMd.indexOf('Alice')
  ta.setSelectionRange(offset, offset)
  const caretTarget = resolvePlantumlTarget({ caret: true })
  assert(caretTarget, 'caret inside the fence resolves')
  assert(caretTarget.code === 'Alice -> Bob: hi', `caret target code: ${caretTarget.code}`)
  assert(caretTarget.writeBack('Carol -> Dave: yo'), 'caret writeBack ok')
  const written = src.getValue()
  assert(
    written.includes('```plantuml\nCarol -> Dave: yo\n```'),
    `spliced source: ${JSON.stringify(written)}`,
  )
  assert(written.includes('intro') && written.includes('outro'), 'outside text intact')
  assert(updates.length > 0, 'onChange fired after write-back')

  // pointer anchor with a zero-size rect (jsdom) falls back to the caret line
  const pointerTarget = resolvePlantumlTarget({ target: ta, clientX: 4, clientY: 4 })
  assert(pointerTarget, 'pointer anchor resolves via caret fallback')

  // caret outside the fence → no target
  ta.setSelectionRange(0, 0)
  assert(resolvePlantumlTarget({ caret: true }) === null, 'caret before the fence is null')

  src.unmount()
  assert(resolvePlantumlTarget({ caret: true }) === null, 'source unmount clears resolver')
  host.remove()
}

// ---- wysiwyg adapter: widget pointer → resolve + PM write-back ----
{
  const host = document.createElement('div')
  document.body.append(host)
  const updates: string[] = []
  const wy = createWysiwygAdapter({ onChange: (next) => updates.push(next) })
  const startCode = '@startuml\nAlice -> Bob: hi\n@enduml'
  wy.setValue(`# t\n\n\`\`\`plantuml\n${startCode}\n\`\`\`\n\ntail\n`)
  wy.mount(host)
  const widget = await waitFor(
    () => host.querySelector<HTMLElement>('.md-embed--widget[data-embed="plantuml"]'),
    'plantuml widget',
  )
  const target = await waitFor(
    () => resolvePlantumlTarget({ target: widget }),
    'widget resolves to a plantuml block',
  )
  assert(target.code === startCode, `widget target code: ${target.code}`)
  assert(target.writeBack('@startuml\nCarol -> Dave: yo\n@enduml'), 'widget writeBack ok')
  // The wysiwyg listener flushes serialized markdown on a 200ms debounce.
  const value = await waitFor(
    () => (wy.getValue().includes('Carol -> Dave: yo') ? wy.getValue() : null),
    'wysiwyg value after write-back',
  )
  assert(
    value.includes(`\`\`\`plantuml\n@startuml\nCarol -> Dave: yo\n@enduml\n\`\`\``),
    `wysiwyg value after write-back: ${JSON.stringify(value)}`,
  )
  await waitFor(() => (updates.length > 0 ? updates.length : null), 'wysiwyg onChange fired')

  const heading = host.querySelector('h1')
  if (heading) {
    assert(resolvePlantumlTarget({ target: heading }) === null, 'heading is not a plantuml block')
  }

  wy.unmount()
  assert(resolvePlantumlTarget({ caret: true }) === null, 'wysiwyg unmount clears resolver')
  host.remove()
}

console.log(
  'SMOKE CORE PUML OK: fence span + newline splice + resolver registry + source caret/pointer write-back + wysiwyg widget resolve/write-back',
)

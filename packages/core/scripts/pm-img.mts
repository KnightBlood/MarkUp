import { JSDOM } from 'jsdom'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const dom = new JSDOM('<!doctype html><div id="root"></div><div id="root2"></div>', {
  pretendToBeVisual: true,
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

// The transformer swallows image-parse errors with console.error; collect them.
const errors: unknown[] = []
const originalError = console.error
console.error = (...args: unknown[]): void => {
  errors.push(args.map(String).join(' '))
}

const { createWysiwygAdapter } = await import('../src/adapters/wysiwyg')
const { createSourceAdapter } = await import('../src/adapters/source')
const { imageAltText, isImageFile } = await import('../src/adapters/types')

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const waitFor = async (probe: () => unknown, label: string): Promise<void> => {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (probe()) return
    await sleep(50)
  }
  throw new Error(`timeout waiting for ${label}`)
}

const b64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const file = new window.File(
  [Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))],
  'shot.png',
  { type: 'image/png' },
)

// ---- wysiwyg: insert image at cursor ----
const updates: string[] = []
const wy = createWysiwygAdapter({ onChange: (md) => updates.push(md) })
wy.setValue('hello world')
const root = window.document.getElementById('root')
assert(root, 'root missing')
wy.mount(root)
await waitFor(() => root.querySelector('.ProseMirror'), 'wysiwyg mount')

{
  const before = errors.length
  const ok = await wy.insertImage(file)
  assert(ok, 'insertImage should succeed')
  assert(
    wy.getValue().includes('data:image/png'),
    'getValue must see the image synchronously (flush past the 200ms debounce)',
  )
  assert(
    updates.some((md) => md.includes('data:image/png')),
    'onChange must fire synchronously with the inserted image',
  )
  const img = root.querySelector('img')
  assert(img, 'wysiwyg must render an <img> after insert')
  assert(
    (img.getAttribute('src') ?? '').startsWith('data:image/png'),
    'inserted img src is the data URL',
  )
  assert(errors.length === before, 'insert must not log parse errors')
}

// ---- wysiwyg: open existing document containing an untitled image ----
{
  const before = errors.length
  wy.setValue(`before\n\n![shot.png](data:image/png;base64,${b64})\n\nafter\n`)
  await sleep(50)
  assert(errors.length === before, 'parsing untitled image must not log errors')
  const imgs = root.querySelectorAll('img')
  assert(imgs.length >= 1, 'document with untitled image must render it')
  const text = root.querySelector('.ProseMirror')?.textContent ?? ''
  assert(text.includes('before') && text.includes('after'), 'surrounding text kept')
  assert(
    wy.getValue().includes('data:image/png'),
    'getValue keeps the image after setValue round-trip',
  )
}

// ---- wysiwyg: titled image still round-trips ----
{
  const before = errors.length
  wy.setValue(`![t](data:image/png;base64,${b64} "Title")`)
  await sleep(50)
  assert(errors.length === before, 'titled image parses without errors')
  assert(root.querySelector('img'), 'titled image renders')
  assert(wy.getValue().includes('"Title"'), 'title survives serialization')
}
wy.unmount()

// ---- source (split) view: image renders as a thumbnail ----
const src = createSourceAdapter({})
src.setValue(`before\n\n![a](data:image/png;base64,${b64})\n\nafter\n`)
const root2 = window.document.getElementById('root2')
assert(root2, 'root2 missing')
src.mount(root2)
await waitFor(() => root2.querySelector('.overtype-preview'), 'source preview')
{
  const img = root2.querySelector('.overtype-preview img.source-image')
  assert(img, 'source preview must render an image thumbnail')
  assert(
    (img.getAttribute('src') ?? '').startsWith('data:image/png'),
    'thumbnail src is the data URL (not sanitizeUrl-#)',
  )
  assert(
    !root2.querySelector('.overtype-preview a[href="#"]'),
    'image anchor must be replaced, not left as a broken # link',
  )
  const prev = img.previousSibling
  assert(
    !prev || prev.nodeType !== 3 || !(prev.textContent ?? '').endsWith('!'),
    'leading ! consumed by the image swap',
  )
}
src.unmount()

// ---- shared file classification ----
assert(isImageFile({ type: 'image/webp' }), 'mime image/webp accepted')
assert(isImageFile({ name: 'x.avif', type: '' }), 'extension fallback avif')
assert(isImageFile({ name: 'x.svg', type: 'application/octet-stream' }), 'octet-stream svg accepted')
assert(isImageFile({ name: 'x.tiff', type: 'image/tiff' }), 'tiff accepted')
assert(!isImageFile({ name: 'x.txt', type: '' }), 'plain txt rejected')
assert(!isImageFile({ name: 'x.png', type: 'text/plain' }), 'explicit non-image mime rejected')
assert(imageAltText({ name: 'a[1](2).png' }) === 'a_1__2_.png', 'alt text sanitized')

console.error = originalError
assert(errors.length === 0, `unexpected console.error output:\n${errors.join('\n')}`)
console.log('SMOKE CORE IMG OK: wysiwyg insert/open/titled + source thumbnail + file classification')

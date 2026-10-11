/**
 * Smoke: 只读模式 across all three views.
 *
 * Read-only is deceptively easy to get wrong in two ways, and both are silent:
 *
 * 1. **Setting the DOM instead of the owner's state.** ProseMirror and
 *    CodeMirror both own `contenteditable` and reset anything written behind
 *    their back on the next render, so the toggle would appear to work and then
 *    quietly stop.
 * 2. **Forgetting a view switch.** Each adapter builds a brand-new editable
 *    surface on `mount`, which starts editable — so read-only has to be
 *    re-applied, or turning it on and then switching views re-enables typing.
 */

import { JSDOM } from 'jsdom'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const dom = new JSDOM(
  '<!doctype html><div id="root"></div><div id="root2"></div><div id="root3"></div>',
  { pretendToBeVisual: true },
)
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const waitFor = async (probe: () => unknown, label: string): Promise<void> => {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (probe()) return
    await sleep(50)
  }
  throw new Error(`timeout waiting for ${label}`)
}

const { createWysiwygAdapter } = await import('../src/adapters/wysiwyg')
const { createSourceAdapter } = await import('../src/adapters/source')
const { createHybridAdapter } = await import('../src/adapters/hybrid')

const el = (id: string): HTMLElement => {
  const node = window.document.getElementById(id)
  assert(node, `${id} missing`)
  return node
}

// ---- 实时预览 (ProseMirror) -----------------------------------------------
{
  const wy = createWysiwygAdapter({})
  wy.setValue('hello world')
  wy.mount(el('root'))
  await waitFor(() => el('root').querySelector('.ProseMirror'), 'wysiwyg mount')

  const pm = el('root').querySelector<HTMLElement>('.ProseMirror')
  assert(pm, 'ProseMirror root')
  assert(pm.getAttribute('contenteditable') !== 'false', 'starts editable')

  wy.setReadOnly?.(true)
  await sleep(20)
  assert(
    pm.getAttribute('contenteditable') === 'false',
    'read-only must reach the DOM ProseMirror actually owns',
  )
  // The document is still selectable — only *editing* is blocked.
  assert(wy.getValue().includes('hello world'), 'read-only keeps the content')

  wy.setReadOnly?.(false)
  await sleep(20)
  assert(pm.getAttribute('contenteditable') !== 'false', 'turning it back off restores editing')
  wy.unmount()
}

// ---- 分屏 (OverType) ------------------------------------------------------
{
  const src = createSourceAdapter({})
  src.setValue('hello world')
  src.mount(el('root2'))
  await waitFor(() => el('root2').querySelector('.overtype-preview'), 'source mount')

  const textarea = el('root2').querySelector<HTMLTextAreaElement>('textarea')
  assert(textarea, 'OverType textarea')
  assert(textarea.readOnly === false, 'starts editable')

  src.setReadOnly?.(true)
  await sleep(20)
  // OverType's own input handlers bail out on `readOnly`, so this is the lever
  // the library expects — not a DOM attribute we invented.
  assert(textarea.readOnly === true, 'read-only reaches the textarea OverType reads')
  // The class lands on the adapter's own root (`.adapter-source`), which is what
  // the stylesheet targets.
  const srcRoot = el('root2').querySelector('.adapter-source')
  assert(srcRoot?.classList.contains('is-readonly'), 'the styling cue is applied')
  assert(src.getValue() === 'hello world', 'read-only keeps the content')

  src.setReadOnly?.(false)
  await sleep(20)
  assert(textarea.readOnly === false, 'turning it back off restores editing')
  src.unmount()
}

// ---- 源码 (CodeMirror) ----------------------------------------------------
{
  const hy = createHybridAdapter({})
  hy.setValue('hello world')
  hy.mount(el('root3'))
  await waitFor(() => el('root3').querySelector('.cm-content'), 'hybrid mount')

  const content = el('root3').querySelector<HTMLElement>('.cm-content')
  assert(content, 'CodeMirror content')
  assert(content.getAttribute('contenteditable') !== 'false', 'starts editable')

  hy.setReadOnly?.(true)
  await sleep(20)
  // Set through CodeMirror's editable facet; writing the attribute directly
  // would be reverted the next time it renders.
  assert(content.getAttribute('contenteditable') === 'false', 'read-only reaches CodeMirror')
  assert(hy.getValue() === 'hello world', 'read-only keeps the content')

  hy.setReadOnly?.(false)
  await sleep(20)
  assert(content.getAttribute('contenteditable') !== 'false', 'turning it back off restores editing')
  hy.unmount()
}

console.log('SMOKE CORE READONLY OK: wysiwyg/ProseMirror + OverType textarea + CodeMirror editable facet')

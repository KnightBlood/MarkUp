import { JSDOM } from 'jsdom'
import { Editor, defaultValueCtx, editorViewCtx, rootCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'

const { window } = new JSDOM('<!doctype html><div id="e"></div>', { pretendToBeVisual: true })
globalThis.window = window
globalThis.document = window.document
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
const g = window
g.Element.prototype.scrollIntoView = function () {}
g.HTMLElement.prototype.focus = function () {}
let rafId = 0
g.requestAnimationFrame = (cb) => {
  rafId += 1
  return window.setTimeout(() => cb(rafId), 16)
}
g.cancelAnimationFrame = (id) => window.clearTimeout(id)
globalThis.addEventListener = (type, fn) => window.addEventListener(type, fn)
globalThis.removeEventListener = (type, fn) => window.removeEventListener(type, fn)
globalThis.dispatchEvent = (event) => window.dispatchEvent(event)
globalThis.CustomEvent = window.CustomEvent

const markup = [
  '# 标题',
  '',
  '段落 with *em* **strong** `code`.',
  '',
  '> quote line',
  '',
  '1. one',
  '2. two',
  '',
  '* loose',
  '* list',
  '',
  'end',
  '',
].join('\n')

let last = null
let editor = null

try {
  editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, window.document.getElementById('e'))
      ctx.set(defaultValueCtx, markup)
      ctx
        .get(listenerCtx)
        .markdownUpdated((_ctx, md) => {
          last = md
        })
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(listener)

  await editor.create()
  const view = editor.action((ctx) => ctx.get(editorViewCtx))
  if (view.state.schema.topNodeType.name !== 'doc') {
    throw new Error(`bad top node: ${view.state.schema.topNodeType.name}`)
  }
  if (view.state.doc.textContent.length === 0) throw new Error('empty document')
  view.dispatch(view.state.tr.insertText('\nappended', view.state.doc.content.size))
  await new Promise((r) => setTimeout(r, 400))
  if (last === null || !last.includes('appended')) {
    throw new Error(`markdownUpdated did not fire: ${last}`)
  }
  console.log('SMOKE MILKDOWN OK: doc top, markdownUpdated fires')
} catch (error) {
  console.error('SMOKE MILKDOWN FAIL:', error)
  process.exitCode = 1
} finally {
  await editor?.destroy(false).catch(() => {})
  process.exit(process.exitCode ?? 0)
}

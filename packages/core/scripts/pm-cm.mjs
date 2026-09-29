import { JSDOM } from 'jsdom'
import { EditorState } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'

const { window } = new JSDOM('<!doctype html><div id="e"></div>', { pretendToBeVisual: true })
globalThis.window = window
globalThis.document = window.document
globalThis.MutationObserver = window.MutationObserver
globalThis.Window = window.Window
globalThis.HTMLElement = window.HTMLElement
globalThis.Element = window.Element
globalThis.getComputedStyle = window.getComputedStyle.bind(window)
const host = window.document.getElementById('e')

class ConcealWidget extends WidgetType {
  constructor(spaces) {
    super()
    this.spaces = spaces
  }
  eq(other) {
    return other.spaces === this.spaces
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-conceal'
    s.textContent = ' '.repeat(this.spaces)
    return s
  }
}

const view = new EditorView({
  parent: host,
  state: EditorState.create({
    doc: '# 标题\n\n段落 *em* **strong** `code`.\n\n- a\n- b\n',
    extensions: [basicSetup, markdown(), EditorView.lineWrapping],
  }),
})
view.focus()
view.dispatch({ changes: { from: view.state.doc.length, insert: '\nappended' } })
await new Promise((r) => setTimeout(r, 20))
const text = view.state.doc.toString()
if (!text.includes('appended')) {
  console.error('SMOKE FAIL: dispatch lost text')
  process.exit(1)
}
view.destroy()
console.log('SMOKE OK: codemirror(basicSetup@codemirror/meta 6.x) + markdown + lineWrapping create/mount/focus/dispatch viable')
process.exit(0)

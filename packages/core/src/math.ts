import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { buildWidgetLangSelect } from './codeLangs'
import { requestMathEdit, requestMathEnlarge } from './mathEditorBridge'
import { renderMath } from './mathRender'

export * from './mathRender'

function focusInsideBlock(view: EditorView, pos: number): void {
  const doc = view.state.doc
  const $target = doc.resolve(Math.min(pos + 1, doc.content.size))
  view.dispatch(view.state.tr.setSelection(TextSelection.near($target)))
  view.focus()
}

export function replaceCodeBlockContent(view: EditorView, pos: number, next: string): boolean {
  const state = view.state
  const node = state.doc.nodeAt(pos)
  if (!node || node.type.name !== 'code_block') return false
  const from = pos + 1
  const to = pos + node.nodeSize - 1
  const tr = state.tr
  if (to > from) tr.delete(from, to)
  if (next) tr.insert(from, state.schema.text(next))
  view.dispatch(tr)
  return true
}

function findTextRange(view: EditorView, needle: string): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null
  view.state.doc.descendants((node, pos) => {
    if (found || !node.isText || !node.text) return
    const idx = node.text.indexOf(needle)
    if (idx >= 0) found = { from: pos + idx, to: pos + idx + needle.length }
  })
  return found
}

export function mathWidgetFactory(
  code: string,
  /** Fence language for the top-left dropdown; `null` = no dropdown (the
   *  visible source pre hosts one instead, when the caret is inside). */
  language: string | null = null,
): (view: EditorView, getPos: () => number | undefined) => HTMLElement {
  return (view, getPos) => {
    const wrap = document.createElement('div')
    wrap.className = 'md-math md-math--widget'
    wrap.setAttribute('contenteditable', 'false')
    wrap.dataset.math = 'block'
    wrap.title = '点击编辑公式'
    const source = document.createElement('pre')
    source.className = 'md-math__source'
    source.textContent = code
    source.hidden = true
    const focusSource = (): void => {
      const pos = getPos()
      if (pos === undefined) return
      focusInsideBlock(view, pos)
    }
    const editNow = (): void => {
      const handled = requestMathEdit({ latex: code, display: true }, (result) => {
        if (!result) return
        const pos = getPos()
        if (pos !== undefined && replaceCodeBlockContent(view, pos, result.latex)) {
          view.focus()
          return
        }
        const needle = `\`\`\`math\n${code}\n\`\`\``
        const range = findTextRange(view, needle)
        if (range) {
          view.dispatch(
            view.state.tr.insertText(`\`\`\`math\n${result.latex}\n\`\`\``, range.from, range.to),
          )
          view.focus()
        }
      })
      if (handled) return
      focusSource()
    }
    const bar = document.createElement('div')
    bar.className = 'md-embed__bar'
    const enlargeBtn = document.createElement('button')
    enlargeBtn.type = 'button'
    enlargeBtn.className = 'md-embed__btn'
    enlargeBtn.textContent = '放大'
    enlargeBtn.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      // Without a viewer wired the enlarge falls back to the source block.
      if (!requestMathEnlarge({ latex: code, display: true })) focusSource()
    })
    const editBtn = document.createElement('button')
    editBtn.type = 'button'
    editBtn.className = 'md-embed__btn'
    editBtn.textContent = '编辑'
    editBtn.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      editNow()
    })
    bar.append(enlargeBtn, editBtn)
    if (language !== null) wrap.append(buildWidgetLangSelect(view, getPos, language))
    wrap.append(bar, source)
    try {
      const out = document.createElement('div')
      out.className = 'md-math__output'
      renderMath(code, out, true)
      wrap.append(out)
    } catch {
      wrap.classList.add('md-math--error')
      wrap.append(document.createTextNode(code))
    }
    wrap.addEventListener('mousedown', (event) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('.md-embed__lang')) {
        // The language dropdown keeps native behavior (opening it would be
        // cancelled by preventDefault below).
        event.stopPropagation()
        return
      }
      event.preventDefault()
      event.stopPropagation()
    })
    // Body click is deliberately inert — the 放大/编辑 bar is the sole entry.
    return wrap
  }
}

export function inlineMathWidgetFactory(
  latex: string,
): (view: EditorView, getPos: () => number | undefined) => HTMLElement {
  return (view) => {
    const span = document.createElement('span')
    span.className = 'md-math md-math--inline-widget'
    span.contentEditable = 'false'
    span.dataset.math = 'inline'
    span.title = '点击编辑公式'
    try {
      renderMath(latex, span, false)
    } catch {
      span.classList.add('md-math--error')
      span.textContent = `$${latex}$`
    }
    span.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
    })
    span.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      requestMathEdit({ latex, display: false }, (result) => {
        if (!result) return
        const range = findTextRange(view, `$${latex}$`)
        if (!range) return
        view.dispatch(view.state.tr.insertText(`$${result.latex}$`, range.from, range.to))
        view.focus()
      })
    })
    return span
  }
}

export function replaceInlineMathLatex(
  view: EditorView,
  oldLatex: string,
  newLatex: string,
): boolean {
  const range = findTextRange(view, `$${oldLatex}$`)
  if (!range) return false
  view.dispatch(view.state.tr.insertText(`$${newLatex}$`, range.from, range.to))
  return true
}

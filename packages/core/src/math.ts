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

/**
 * Inline `$…$` widget. The source stays in the document (it is the source of
 * truth); the widget only stands in for it while the caret is outside.
 *
 * `source` is the raw markdown slice the widget replaces (delimiters included),
 * so the write-back can verify the position before rewriting it.
 */
export function inlineMathWidgetFactory(
  source: string,
  latex: string,
): (view: EditorView, getPos: () => number | undefined) => HTMLElement {
  return (view, getPos) => {
    const span = document.createElement('span')
    span.className = 'md-math md-math--inline-widget'
    span.contentEditable = 'false'
    span.dataset.math = 'inline'
    span.title = '点击编辑公式'
    try {
      renderMath(latex, span, false)
    } catch {
      span.classList.add('md-math--error')
      span.textContent = source
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
        // Inline math keeps its inline form: promoting it to `$$…$$` mid
        // paragraph would leave literal source behind (see displayMathWidgetFactory).
        const range = mathSourceRange(view, getPos(), source)
        if (!range) return
        view.dispatch(view.state.tr.insertText(`$${result.latex}$`, range.from, range.to))
        view.focus()
      })
    })
    return span
  }
}

/**
 * `$$…$$` display-math widget: replaces the *content* of the whole paragraph
 * (the paragraph box, and therefore its margins, stays). Clicking it opens the
 * editor; the paragraph content is rewritten in place, so a multi-line
 * `$$\n…\n$$` (whose newlines ProseMirror stores as soft breaks) survives too.
 */
export function displayMathWidgetFactory(
  latex: string,
): (view: EditorView, getPos: () => number | undefined) => HTMLElement {
  return (view, getPos) => {
    const span = document.createElement('span')
    span.className = 'md-math md-math--inline-widget md-math--display-widget'
    span.contentEditable = 'false'
    span.dataset.math = 'display'
    span.title = '点击编辑公式'
    try {
      renderMath(latex, span, true)
    } catch {
      span.classList.add('md-math--error')
      span.textContent = `$$${latex}$$`
    }
    span.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
    })
    span.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      requestMathEdit({ latex, display: true }, (result) => {
        if (!result) return
        const pos = getPos()
        if (pos === undefined) return
        const $pos = view.state.doc.resolve(pos)
        const from = $pos.start($pos.depth)
        const to = $pos.end($pos.depth)
        view.dispatch(view.state.tr.insertText(`$$${result.latex}$$`, from, to))
        view.focus()
      })
    })
    return span
  }
}

/**
 * The `$$…$$` latex when the paragraph is nothing but display math (the
 * standalone-line form remark-math turns into block math). ProseMirror stores
 * soft breaks as leaves, so the surrounding text is trimmed first.
 */
export function displayMathOfParagraph(text: string): string | null {
  const match = /^\$\$((?:(?!\$\$)[\s\S])+)\$\$$/.exec(text.trim())
  return match ? match[1]!.trim() : null
}

/**
 * Locate one math source in the document: the widget position when it still
 * holds the expected text, a text search otherwise (the widget may have been
 * re-created against a stale position).
 */
function mathSourceRange(
  view: EditorView,
  from: number | undefined,
  source: string,
): { from: number; to: number } | null {
  if (from !== undefined) {
    const to = from + source.length
    if (to <= view.state.doc.content.size && view.state.doc.textBetween(from, to) === source) {
      return { from, to }
    }
  }
  return findTextRange(view, source)
}

export interface InlineMathRange {
  /** Offset of the opening `$` within the scanned text. */
  from: number
  /** Offset just past the closing `$`. */
  to: number
  latex: string
}

/** Whether the character at `index` is escaped by an odd run of backslashes. */
function isEscaped(text: string, index: number): boolean {
  let backslashes = 0
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) backslashes += 1
  return backslashes % 2 === 1
}

/**
 * Inline math ranges (`$…$`) inside one text node, following the single-dollar
 * rules of micromark/remark-math: the opening `$` must be followed by a
 * non-space, the closing `$` must be preceded by a non-space, `\$` is escaped
 * and `$$` is left alone (block math). `$5 与 $6` therefore stays plain text.
 *
 * Ranges never span text nodes — a `$…$` split by a mark boundary (e.g.
 * `$a**b**$`) stays literal source.
 */
export function findInlineMath(text: string): InlineMathRange[] {
  const ranges: InlineMathRange[] = []
  let i = 0
  while (i < text.length) {
    const open = text.indexOf('$', i)
    if (open < 0) break
    // Not a single, unescaped opener: skip it and keep scanning.
    if (isEscaped(text, open) || text[open + 1] === '$' || /\s/.test(text[open + 1] ?? '')) {
      i = open + 1
      continue
    }
    let close = open + 1
    let found = -1
    while (close < text.length) {
      close = text.indexOf('$', close)
      if (close < 0) break
      const adjacent = text[close - 1] === '$' || text[close + 1] === '$'
      if (isEscaped(text, close) || adjacent || /\s/.test(text[close - 1] ?? '')) {
        close += 1
        continue
      }
      found = close
      break
    }
    if (found < 0) break
    ranges.push({ from: open, to: found + 1, latex: text.slice(open + 1, found) })
    i = found + 1
  }
  return ranges
}


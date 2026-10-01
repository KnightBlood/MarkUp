import { EditorState, EditorSelection, RangeSetBuilder } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import {
  plantumlFenceTarget,
  setPlantumlResolver,
  type PlantumlAnchor,
  type PlantumlTarget,
} from '../plantumlEditBridge'
import {
  imageAltText,
  isImageFile,
  type Anchor,
  type InsertMarkdownOptions,
  type LineAt,
  type ViewAdapter,
} from './types'

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result ?? '')), { once: true })
    reader.addEventListener('error', () => reject(reader.error ?? new Error('read failed')), {
      once: true,
    })
    reader.readAsDataURL(file)
  })
}

export interface HybridAdapterOptions {
  onChange?: (markdown: string) => void
}

class ConcealWidget extends WidgetType {
  constructor(readonly spaces: number) {
    super()
  }

  override eq(other: ConcealWidget): boolean {
    return other.spaces === this.spaces
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-conceal'
    span.textContent = ' '.repeat(this.spaces)
    return span
  }
}

interface ConcealRule {
  name: string
  test: (text: string) => { from: number; to: number } | null
}

const CONCEAL_RULES: ConcealRule[] = [
  {
    name: 'heading',
    test: (text) => {
      const m = /^( {0,3})(#{1,6})(?=\s|$)/.exec(text)
      if (!m) return null
      return { from: m[1]!.length, to: m[1]!.length + m[2]!.length }
    },
  },
  {
    name: 'quote',
    test: (text) => {
      const m = /^( {0,3})(>+)/.exec(text)
      if (!m) return null
      return { from: m[1]!.length, to: m[1]!.length + m[2]!.length }
    },
  },
  {
    name: 'list',
    test: (text) => {
      const m = /^( {0,4})((?:[-+*])|(?:\d{1,9}[.)]))(?=\s)/.exec(text)
      if (!m) return null
      return { from: m[1]!.length, to: m[1]!.length + m[2]!.length }
    },
  },
]

function activeLineStarts(view: EditorView): Set<number> {
  const starts = new Set<number>()
  for (const range of view.state.selection.ranges) {
    const line = view.state.doc.lineAt(range.from)
    for (let l = Math.max(1, line.number - 1); l <= Math.min(view.state.doc.lines, line.number + 1); l++) {
      starts.add(view.state.doc.line(l).from)
    }
  }
  return starts
}

function buildHiddenMarkup(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const active = activeLineStarts(view)
  for (let i = 1; i <= view.state.doc.lines; i++) {
    if (active.has(view.state.doc.line(i).from)) continue
    const line = view.state.doc.line(i)
    for (const rule of CONCEAL_RULES) {
      const hit = rule.test(line.text)
      if (!hit) continue
      const spaces = hit.to - hit.from
      if (spaces <= 0) continue
      builder.add(
        line.from + hit.from,
        line.from + hit.to,
        Decoration.replace({ widget: new ConcealWidget(spaces), startSide: 1, endSide: -1 }),
      )
      break
    }
  }
  return builder.finish()
}

const hiddenMarkupPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildHiddenMarkup(view)
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildHiddenMarkup(update.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

export function createHybridAdapter(options: HybridAdapterOptions = {}): ViewAdapter {
  let value = ''
  let view: EditorView | null = null
  let rootEl: HTMLElement | null = null
  let suppressChange = false
  let lineNumbers = false
  let spellcheck = false
  const { onChange } = options

  const applyChrome = (): void => {
    if (rootEl) rootEl.classList.toggle('hide-line-numbers', !lineNumbers)
    if (view) view.contentDOM.spellcheck = spellcheck
  }

  // PlantUML blocks: pointer → CM doc offset, caret as fallback; write-back
  // splices only the fence content span through a CM transaction (the
  // updateListener then propagates value + onChange like any other edit).
  const resolvePlantuml = (anchor: PlantumlAnchor): PlantumlTarget | null => {
    const active = view
    if (!active) return null
    let offset: number | null = null
    if (anchor.target && anchor.clientX !== undefined && anchor.clientY !== undefined) {
      offset = active.posAtCoords({ x: anchor.clientX, y: anchor.clientY })
    }
    if (offset == null && anchor.caret) offset = active.state.selection.main.head
    if (offset == null) return null
    return plantumlFenceTarget(value, offset, (from, to, text) => {
      if (!view) return false
      view.dispatch({ changes: { from, to, insert: text } })
      // Park the caret at the end of the content — not on the trailing
      // newline, which would sit it on the closing fence line.
      const body = text.endsWith('\n') ? text.slice(0, -1) : text
      const caret = body.length > 0 ? from + body.length : Math.max(from - 1, 0)
      view.dispatch({ selection: EditorSelection.cursor(caret) })
      return true
    })
  }

  return {
    kind: 'hybrid',

    mount(container: HTMLElement): void {
      if (view) return
      const host = document.createElement('div')
      host.className = 'adapter-hybrid'
      container.replaceChildren(host)
      rootEl = host

      view = new EditorView({
        parent: host,
        state: EditorState.create({
          doc: value,
          extensions: [
            basicSetup,
            markdown(),
            hiddenMarkupPlugin,
            EditorView.lineWrapping,
            EditorView.updateListener.of((update) => {
              if (!update.docChanged || suppressChange) return
              value = update.state.doc.toString()
              onChange?.(value)
            }),
          ],
        }),
      })
      applyChrome()
      setPlantumlResolver(resolvePlantuml)
    },

    unmount(): void {
      setPlantumlResolver(null)
      view?.destroy()
      view = null
      rootEl?.remove()
      rootEl = null
    },

    setValue(markdown: string): void {
      value = markdown
      if (!view) return
      if (view.state.doc.toString() === markdown) return
      suppressChange = true
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: markdown },
      })
      suppressChange = false
    },

    getValue(): string {
      return value
    },

    focus(): void {
      view?.focus()
    },

    insertMarkdown(options: InsertMarkdownOptions): void {
      if (!view) return
      const { from, to } = view.state.selection.main
      const insert = options.markdown
      view.dispatch({
        changes: { from, to, insert },
        selection: EditorSelection.cursor(from + (options.caretOffset ?? insert.length)),
        scrollIntoView: true,
      })
      value = view.state.doc.toString()
      onChange?.(value)
      view.focus()
    },

    async insertImage(file: File): Promise<boolean> {
      if (!isImageFile(file)) return false
      const dataUrl = await readFileAsDataUrl(file)
      if (!view) return false
      const { from, to } = view.state.selection.main
      const insert = `![${imageAltText(file)}](${dataUrl})`
      view.dispatch({
        changes: { from, to, insert },
        selection: EditorSelection.cursor(from + insert.length),
        scrollIntoView: true,
      })
      value = view.state.doc.toString()
      onChange?.(value)
      view.focus()
      return true
    },

    insertTable(rows = 3, cols = 3): void {
      const header = `| ${Array.from({ length: cols }, (_, i) => `H${i + 1}`).join(' | ')} |`
      const sep = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`
      const body = Array.from(
        { length: Math.max(0, rows - 1) },
        () => `| ${Array.from({ length: cols }, () => ' ').join(' | ')} |`,
      )
      const md = [header, sep, ...body].join('\n')
      if (!view) {
        value = value + md
        return
      }
      const { from, to } = view.state.selection.main
      view.dispatch({
        changes: { from, to, insert: md },
        selection: EditorSelection.cursor(from + md.length),
        scrollIntoView: true,
      })
      value = view.state.doc.toString()
      onChange?.(value)
      view.focus()
    },

    setCodeLanguage(): void {
      /* hybrid 视图围栏语言由命令层处理 */
    },

    centerCaret(): void {
      if (!view) return
      const head = view.state.selection.main.head
      const coords = view.coordsAtPos(head)
      const scroller = view.scrollDOM
      if (!coords) return
      const height = coords.bottom - coords.top
      const scrollerTop = scroller.getBoundingClientRect().top
      const cursorTopInScroller = coords.top - scrollerTop
      const target =
        scroller.scrollTop + cursorTopInScroller - scroller.clientHeight / 2 + height / 2
      scroller.scrollTop = Math.max(0, target)
    },

    captureAnchor(): Anchor {
      if (!view) return { offset: 0, line: 1 }
      const selection = view.state.selection.main
      const start = Math.min(selection.anchor, selection.head)
      const end = Math.max(selection.anchor, selection.head)
      const line = view.state.doc.lineAt(start)
      return {
        offset: start,
        line: line.number,
        // Both ends, so callers can act on the selection and not just the caret.
        ...(end > start ? { endOffset: end } : {}),
      }
    },

    restoreAnchor(anchor: Anchor): void {
      if (!view) return
      const docLength = view.state.doc.length
      const from = Math.min(Math.max(anchor.offset, 0), docLength)
      const to =
        anchor.endOffset === undefined
          ? from
          : Math.min(Math.max(anchor.endOffset, from), docLength)
      view.dispatch({
        selection: EditorSelection.single(from, to),
        scrollIntoView: true,
      })
      view.focus()
    },

    setLineNumbers(enabled: boolean): void {
      lineNumbers = enabled
      applyChrome()
    },

    setSpellcheck(enabled: boolean): void {
      spellcheck = enabled
      applyChrome()
    },

    getLineAt(clientX: number, clientY: number): LineAt | null {
      if (!view) return null
      const pos =
        view.posAtCoords({ x: clientX, y: clientY }) ?? view.state.selection.main.head
      const line = view.state.doc.lineAt(pos)
      return {
        text: line.text,
        line: line.number,
        offset: line.from,
        column: Math.min(Math.max(pos - line.from, 0), line.text.length),
      }
    },
  }
}
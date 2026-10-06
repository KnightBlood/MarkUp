import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  nodesCtx,
  parserCtx,
  prosePluginsCtx,
  rootCtx,
  serializerCtx,
} from '@milkdown/kit/core'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import type { NodeSchema } from '@milkdown/kit/transformer'
import {
  gfm,
  addColAfterCommand,
  addColBeforeCommand,
  addRowAfterCommand,
  addRowBeforeCommand,
  columnResizingPlugin,
  exitTable,
  moveColCommand,
  moveRowCommand,
  selectColCommand,
  selectRowCommand,
  selectTableCommand,
} from '@milkdown/kit/preset/gfm'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { upload, uploadConfig } from '@milkdown/kit/plugin/upload'
import {
  createCodeBlockCommand,
  liftListItemCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark'
import { lift } from '@milkdown/kit/prose/commands'
import { callCommand } from '@milkdown/kit/utils'
import {
  EditorState,
  Plugin as ProsePlugin,
  Selection,
  TextSelection,
  type Transaction,
} from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { Fragment, Slice, type Node } from '@milkdown/kit/prose/model'
import {
  CellSelection,
  deleteColumn,
  deleteRow,
  deleteTable,
  isInTable,
  selectedRect,
} from '@milkdown/kit/prose/tables'
import { buildWidgetLangSelect } from '../codeLangs'
import { hydrateDiagrams, normalizeDiagramLang, type DiagramLang } from '../diagrams'
import { hydrateEmbeds, normalizeEmbedLang, requestEmbedEnlarge, type EmbedKind } from '../embeds'
import { requestDiagramEdit, requestDiagramEnlarge } from '../diagramEditBridge'
import { joinFrontmatter, splitFrontmatter } from '../frontmatter'
import {
  displayMathOfParagraph,
  displayMathWidgetFactory,
  findInlineMath,
  inlineMathWidgetFactory,
  mathWidgetFactory,
  normalizeMathLang,
  replaceCodeBlockContent,
} from '../math'
import {
  requestPlantumlVisualEdit,
  setPlantumlResolver,
  type PlantumlAnchor,
  type PlantumlTarget,
} from '../plantumlEditBridge'
import type { BlockFormatId } from '../textFormat'
import {
  TABLE_COMMAND_LABELS,
  imageAltText,
  isImageFile,
  type Anchor,
  type InsertMarkdownOptions,
  type TableCommandId,
  type ViewAdapter,
} from './types'

/** Nearest ancestor node whose type is one of `names` around the selection. */
function enclosingAncestor(
  state: EditorState,
  names: string[],
): { node: Node; pos: number } | null {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (names.includes(node.type.name)) return { node, pos: $from.before(depth) }
  }
  return null
}

/** GFM task items carry `checked`; plain bullet items have it null/undefined. */
function isTaskList(list: Node): boolean {
  const first = list.firstChild
  return !!first && first.attrs.checked !== null && first.attrs.checked !== undefined
}

/**
 * Task list checkbox.
 *
 * Milkdown renders a task item as `li[data-item-type="task"][data-checked]`
 * with no checkbox widget (upstream relies on its theme CSS for the box), so
 * `wysiwyg.css` draws one in the item's left padding and this plugin makes it
 * clickable — clicking the box toggles the item's `checked` attribute.
 */
function taskCheckboxPlugin(onToggled: (view: EditorView) => void): ProsePlugin {
  return new ProsePlugin({
    props: {
      handleDOMEvents: {
        mousedown: (view, event) => {
          const target = event.target
          if (!(target instanceof HTMLElement)) return false
          const item = target.closest('li[data-item-type="task"]')
          if (!item || !view.dom.contains(item)) return false
          // Only the drawn box (left padding zone) toggles — text clicks keep
          // their normal caret behaviour.
          const rect = item.getBoundingClientRect()
          if (event.clientX - rect.left > 24) return false
          const $pos = view.state.doc.resolve(view.posAtDOM(item, 0))
          for (let depth = $pos.depth; depth > 0; depth -= 1) {
            const node = $pos.node(depth)
            if (node.type.name !== 'list_item') continue
            event.preventDefault()
            view.dispatch(
              view.state.tr.setNodeMarkup($pos.before(depth), undefined, {
                ...node.attrs,
                checked: node.attrs.checked !== true,
              }),
            )
            onToggled(view)
            return true
          }
          return false
        },
      },
    },
  })
}

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

/**
 * The stock image schema declares `title`/`alt` as `validate: 'string'`, but
 * mdast yields `null` for `![alt](url)` without a title. ProseMirror then
 * throws inside `createAndFill`, the transformer swallows it
 * (`console.error` + skip) and the image node is silently dropped — inserted
 * or opened documents lose every untitled image. Patch the schema's
 * parseMarkdown runner to normalize null → '' before node creation.
 */
const imageNullSafety: MilkdownPlugin = (ctx) => () => {
  ctx.update(nodesCtx, (entries) =>
    entries.map((entry): [string, NodeSchema] => {
      if (entry[0] !== 'image') return entry
      const spec = entry[1]
      const parse = spec.parseMarkdown
      if (!parse) return entry
      return [
        'image',
        {
          ...spec,
          parseMarkdown: {
            ...parse,
            runner: (state, node, type) => {
              parse.runner(
                state,
                { ...node, title: node.title ?? '', alt: node.alt ?? '' },
                type,
              )
            },
          },
        },
      ]
    }),
  )
}

export interface WysiwygAdapterOptions {
  onChange?: (markdown: string) => void
}

function prefixNode(view: EditorView, pos: number): Node {
  const doc = view.state.doc
  const size = doc.content.size
  if (pos <= 0) return doc.type.create(null)
  if (pos >= size) return doc

  const nodes: Node[] = []
  let cursor = 0
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i)
    const end = cursor + child.nodeSize
    if (end <= pos) {
      nodes.push(child)
      cursor = end
      continue
    }
    if (cursor >= pos) break
    const partial = cutNodeClosed(child, pos - cursor)
    if (partial) nodes.push(partial)
    break
  }
  return doc.type.create(null, Fragment.fromArray(nodes))
}

function cutNodeClosed(node: Node, rel: number): Node | null {
  if (rel <= 0) return null
  if (rel >= node.nodeSize) return node
  // Text nodes have no children to recurse into — cut the string itself, which
  // is what makes character-accurate prefixes (and selections) possible.
  if (node.isText) return node.cut(0, rel)
  if (rel <= 1) return null

  const contentCut = Math.min(rel, node.nodeSize - 1) - 1
  const kids: Node[] = []
  let offset = 0
  let any = false
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    const end = offset + child.nodeSize
    if (end <= contentCut) {
      kids.push(child)
      offset = end
      any = true
      continue
    }
    if (offset >= contentCut) break
    const partial = cutNodeClosed(child, contentCut - offset)
    if (partial) {
      kids.push(partial)
      any = true
    }
    break
  }
  if (!any) return null
  return node.copy(Fragment.fromArray(kids))
}

function serializePrefix(
  view: EditorView,
  serializer: (doc: Node) => string,
  pos: number,
): string | null {
  if (pos <= 0) return ''
  try {
    return serializer(prefixNode(view, pos))
  } catch {
    return null
  }
}

function stopWidgetPointerEvents(event: Event): boolean {
  return (
    event.type === 'click' ||
    event.type === 'mousedown' ||
    event.type === 'mouseup' ||
    event.type === 'pointerdown' ||
    event.type === 'pointerup' ||
    event.type === 'contextmenu' ||
    event.type === 'keydown' ||
    event.type === 'keyup'
  )
}

/** In-pre language select: widget decoration placed at the start of the
 *  code_block content, absolutely positioned at the pre's top-left corner. */
function langSelectWidgetFactory(
  language: string,
): (view: EditorView, getPos: () => number | undefined) => HTMLElement {
  return (view, getPos) => {
    const select = buildWidgetLangSelect(view, getPos, language)
    select.dataset.langWidget = 'pre'
    return select
  }
}

function diagramWidgetFactory(
  lang: DiagramLang,
  code: string,
  language: string,
): (view: EditorView, getPos: () => number | undefined) => HTMLElement {
  return (view, getPos) => {
    const wrap = document.createElement('div')
    wrap.className = 'md-diagram md-diagram--widget'
    wrap.setAttribute('contenteditable', 'false')
    wrap.dataset.diagram = lang
    const source = document.createElement('pre')
    source.className = 'md-diagram__source'
    source.textContent = code
    const moveToSource = (): void => {
      const pos = getPos()
      if (pos === undefined) return
      const doc = view.state.doc
      const $target = doc.resolve(Math.min(pos + 1, doc.content.size))
      view.dispatch(view.state.tr.setSelection(TextSelection.near($target)))
      view.focus()
    }
    const editNow = (): void => {
      const pos = getPos()
      if (pos === undefined) return
      // Graphical editor bridge first (mermaid only); without a handler the
      // edit falls back to moving the caret into the fence (source editing).
      if (lang === 'mermaid') {
        const handled = requestDiagramEdit({ lang, code }, (next) => {
          if (next === null) return
          const current = getPos()
          if (current !== undefined && replaceCodeBlockContent(view, current, next)) view.focus()
        })
        if (handled) return
      }
      moveToSource()
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
      // Without a viewer wired the enlarge falls back to editing the fence.
      if (!requestDiagramEnlarge({ lang, code })) moveToSource()
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
    const langSelect = buildWidgetLangSelect(view, getPos, language)
    wrap.append(langSelect, bar, source)
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
    // Body click is deliberately inert — the 放大/编辑 bar is the sole entry
    // (avoids accidental editor popups when selecting/pointing at the widget).
    void hydrateDiagrams(wrap)
    return wrap
  }
}

function embedWidgetFactory(
  kind: EmbedKind,
  code: string,
  language: string,
): (view: EditorView, getPos: () => number | undefined) => HTMLElement {
  return (view, getPos) => {
    const wrap = document.createElement('div')
    wrap.className = 'md-embed md-embed--widget'
    wrap.setAttribute('contenteditable', 'false')
    wrap.dataset.embed = kind

    const moveToSource = (): void => {
      const pos = getPos()
      if (pos === undefined) return
      const doc = view.state.doc
      const $target = doc.resolve(Math.min(pos + 1, doc.content.size))
      view.dispatch(view.state.tr.setSelection(TextSelection.near($target)))
      view.focus()
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
      // Without a viewer wired the enlarge falls back to editing the fence.
      if (!requestEmbedEnlarge({ kind, code })) moveToSource()
    })
    const editBtn = document.createElement('button')
    editBtn.type = 'button'
    editBtn.className = 'md-embed__btn'
    editBtn.textContent = '编辑'
    editBtn.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      // Reveal the fence first — that also puts the caret inside this block,
      // which is exactly what the caret resolver needs. plantuml then hands
      // off to the visual dialog; without a dialog owner wired the button
      // stays in source editing (the pre-visual-edit behavior).
      moveToSource()
      if (kind === 'plantuml') requestPlantumlVisualEdit()
    })
    bar.append(enlargeBtn, editBtn)

    const source = document.createElement('pre')
    source.className = 'md-embed__source'
    source.textContent = code
    const langSelect = buildWidgetLangSelect(view, getPos, language)
    wrap.append(langSelect, bar, source)

    wrap.addEventListener('mousedown', (event) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('.md-embed__lang')) {
        // The language dropdown keeps native behavior (opening it would be
        // cancelled by preventDefault below).
        event.stopPropagation()
        return
      }
      if (target?.closest('button')) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (
        target?.closest(
          'video, avbridge-player, model-viewer, svg, .md-embed__file, flyfish-file-viewer',
        )
      ) {
        // Native controls / the avbridge control bar / camera gestures /
        // file-viewer interactions keep their default behavior (text
        // selection inside the viewer etc.).
        event.stopPropagation()
        return
      }
      event.preventDefault()
      event.stopPropagation()
    })
    void hydrateEmbeds(wrap)
    return wrap
  }
}

function widgetDecorations(state: EditorState): DecorationSet {
  const decorations: Decoration[] = []
  const { doc, selection } = state
  doc.descendants((node, pos, parent) => {
    // `$$…$$` filling a whole paragraph (remark-math's block math): the
    // paragraph's inline content collapses and the display widget takes its
    // place. The paragraph box itself stays, so the formula keeps its own line.
    if (node.type.name === 'paragraph') {
      const latex = displayMathOfParagraph(node.textContent)
      if (latex) {
        const from = pos + 1
        const to = pos + node.nodeSize - 1
        const inside = selection.ranges.some((r) => r.$from.pos < to && r.$to.pos > from)
        if (!inside) {
          decorations.push(Decoration.inline(from, to, { nodeName: 'span', class: 'md-math-hidden' }))
          decorations.push(
            Decoration.widget(from, displayMathWidgetFactory(latex), {
              key: `md-math-display:${latex}`,
              stopEvent: stopWidgetPointerEvents,
            }),
          )
        }
      }
      return
    }
    if (node.isText) {
      // Inline `$…$`: the widget stands in for the source while the caret is
      // outside; the source itself is collapsed (`.md-math-hidden`) rather than
      // removed, so ProseMirror can still map every position to the DOM.
      if (
        node.text &&
        node.text.includes('$') &&
        !parent?.type.spec.code &&
        !(parent?.type.name === 'paragraph' && displayMathOfParagraph(parent.textContent)) &&
        !node.marks.some((mark) => mark.type.name === 'code')
      ) {
        for (const range of findInlineMath(node.text)) {
          const from = pos + range.from
          const to = pos + range.to
          if (selection.ranges.some((r) => r.$from.pos < to && r.$to.pos > from)) continue
          decorations.push(
            Decoration.inline(from, to, { nodeName: 'span', class: 'md-math-hidden' }),
          )
          decorations.push(
            Decoration.widget(from, inlineMathWidgetFactory(node.text.slice(range.from, range.to), range.latex), {
              key: `md-math-inline:${range.latex}`,
              stopEvent: stopWidgetPointerEvents,
            }),
          )
        }
      }
      return
    }
    if (node.type.name !== 'code_block') return
    const language = String(node.attrs.language ?? '')
    const from = pos
    const to = pos + node.nodeSize
    const inside = selection.ranges.some((range) => range.$from.pos < to && range.$to.pos > from)
    const code = node.textContent
    if (code.trim()) {
      const diagramLang = normalizeDiagramLang(language)
      if (diagramLang && !inside) {
        decorations.push(Decoration.node(from, to, { class: 'md-diagram-hidden' }))
        decorations.push(
          Decoration.widget(from, diagramWidgetFactory(diagramLang, code, language), {
            key: `md-diagram:${language}:${diagramLang}:${code}`,
            stopEvent: stopWidgetPointerEvents,
          }),
        )
        return
      }
      const embedKind = normalizeEmbedLang(language)
      if (embedKind && !inside) {
        decorations.push(Decoration.node(from, to, { class: 'md-embed-hidden' }))
        decorations.push(
          Decoration.widget(from, embedWidgetFactory(embedKind, code, language), {
            key: `md-embed:${language}:${embedKind}:${code.length}:${code.slice(0, 40)}`,
            stopEvent: stopWidgetPointerEvents,
          }),
        )
        return
      }
      const mathLang = normalizeMathLang(language)
      if (mathLang) {
        if (!inside) {
          // Pre hidden — the wrapper owns the language select.
          decorations.push(Decoration.node(from, to, { class: 'md-diagram-hidden' }))
          decorations.push(
            Decoration.widget(from, mathWidgetFactory(code, language), {
              key: `md-math:${language}:${code}`,
              stopEvent: stopWidgetPointerEvents,
            }),
          )
          return
        }
        // Caret inside: live preview above the still-visible source. The
        // language select lives in the pre below (added after this branch),
        // so the wrapper deliberately gets none — one dropdown per block.
        decorations.push(
          Decoration.widget(from, mathWidgetFactory(code, null), {
            key: `md-math:live:${code}`,
            stopEvent: stopWidgetPointerEvents,
          }),
        )
      }
    }
    // Visible pre (plain block, preview block with the caret inside, or an
    // empty fence) — language dropdown at its top-left corner.
    decorations.push(
      Decoration.widget(from + 1, langSelectWidgetFactory(language), {
        key: `md-lang:${from}:${language}`,
        stopEvent: () => true,
      }),
    )
  })
  return DecorationSet.create(doc, decorations)
}

const widgetPlugin = new ProsePlugin({
  props: {
    decorations: (state) => widgetDecorations(state),
  },
})

type TableRect = ReturnType<typeof selectedRect>

function tableRect(state: EditorState): TableRect | null {
  if (!isInTable(state)) return null
  return selectedRect(state)
}

function canDeleteRows(rect: TableRect): boolean {
  if (rect.top === 0) return false
  return rect.map.height - (rect.bottom - rect.top) >= 2
}

function canDeleteCols(rect: TableRect): boolean {
  return rect.map.width - (rect.right - rect.left) >= 1
}

function tableCommandEnabled(state: EditorState, id: TableCommandId): boolean {
  const rect = tableRect(state)
  if (!rect) return false
  switch (id) {
    case 'rowBefore':
    case 'rowAfter':
    case 'colBefore':
    case 'colAfter':
    case 'alignLeft':
    case 'alignCenter':
    case 'alignRight':
    case 'selectRow':
    case 'selectCol':
    case 'selectTable':
    case 'deleteTable':
    case 'exit':
      return true
    case 'rowDelete':
      return canDeleteRows(rect)
    case 'colDelete':
      return canDeleteCols(rect)
    case 'rowUp':
      return rect.bottom - rect.top === 1 && rect.top >= 2
    case 'rowDown':
      return rect.bottom - rect.top === 1 && rect.top >= 1 && rect.bottom < rect.map.height
    case 'colLeft':
      return rect.right - rect.left === 1 && rect.left >= 1
    case 'colRight':
      return rect.right - rect.left === 1 && rect.right < rect.map.width
    case 'deleteSelection': {
      const sel = state.selection
      if (sel instanceof CellSelection) {
        if (sel.isRowSelection() && sel.isColSelection()) return true
        return sel.isColSelection() ? canDeleteCols(rect) : canDeleteRows(rect)
      }
      return canDeleteRows(rect)
    }
  }
}

function alignTableColumns(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  alignment: 'left' | 'center' | 'right',
): boolean {
  const rect = tableRect(state)
  if (!rect) return false
  const { tableStart, map, table } = rect
  const tr = state.tr
  const seen = new Set<number>()
  let changed = false
  for (let col = rect.left; col < rect.right; col++) {
    for (let row = 0; row < map.height; row++) {
      const offset = map.positionAt(row, col, table)
      if (seen.has(offset)) continue
      seen.add(offset)
      const pos = tableStart + offset
      const cell = state.doc.nodeAt(pos)
      if (!cell || cell.attrs.alignment === alignment) continue
      tr.setNodeMarkup(pos, undefined, { ...cell.attrs, alignment })
      changed = true
    }
  }
  if (!changed) return false
  dispatch(tr)
  return true
}

type TableMenuId = 'row' | 'col' | 'select'

type TableToolbarItem =
  | { kind: 'sep' }
  | { kind: 'insert'; label: string; title: string }
  | {
      kind: 'menu'
      id: TableMenuId
      label: string
      title: string
      entries: readonly TableCommandId[]
    }
  | { kind: 'cmd'; id: TableCommandId; label: string; title: string }

const tableToolbarItems: readonly TableToolbarItem[] = [
  { kind: 'insert', label: '⊞', title: '插入表格…' },
  { kind: 'sep' },
  {
    kind: 'menu',
    id: 'row',
    label: '行▾',
    title: '行操作',
    entries: ['rowBefore', 'rowAfter', 'rowUp', 'rowDown', 'rowDelete'],
  },
  {
    kind: 'menu',
    id: 'col',
    label: '列▾',
    title: '列操作',
    entries: ['colBefore', 'colAfter', 'colLeft', 'colRight', 'colDelete'],
  },
  {
    kind: 'menu',
    id: 'select',
    label: '选▾',
    title: '选择与删除',
    entries: ['selectRow', 'selectCol', 'selectTable', 'deleteSelection'],
  },
  { kind: 'sep' },
  { kind: 'cmd', id: 'alignLeft', label: '左', title: '左对齐（整列）' },
  { kind: 'cmd', id: 'alignCenter', label: '中', title: '居中对齐（整列）' },
  { kind: 'cmd', id: 'alignRight', label: '右', title: '右对齐（整列）' },
  { kind: 'sep' },
  { kind: 'cmd', id: 'deleteTable', label: '删表', title: '删除表格' },
  { kind: 'cmd', id: 'exit', label: '退出', title: '退出表格' },
]

const tableMenuSpecs = new Map<TableMenuId, readonly TableCommandId[]>()
for (const item of tableToolbarItems) {
  if (item.kind === 'menu') tableMenuSpecs.set(item.id, item.entries)
}

interface TableToolbarActions {
  run(id: TableCommandId): void
  insertTable(rows: number, cols: number): void
}

function tableToolbarPlugin(host: HTMLElement, actions: TableToolbarActions): ProsePlugin {
  let bar: HTMLElement | null = null
  let picker: HTMLElement | null = null
  let insertBtn: HTMLButtonElement | null = null
  let menu: HTMLElement | null = null
  let menuTrigger: HTMLButtonElement | null = null
  let lastState: EditorState | null = null
  const cmdButtons = new Map<TableCommandId, HTMLButtonElement>()
  const menuButtons = new Map<TableMenuId, HTMLButtonElement>()
  const menuItems = new Map<TableCommandId, HTMLButtonElement>()

  const focusEditor = (): void => {
    host.querySelector<HTMLElement>('.ProseMirror')?.focus()
  }

  const closePicker = (): void => {
    picker?.remove()
    picker = null
    insertBtn?.setAttribute('aria-expanded', 'false')
  }

  const closeMenu = (): void => {
    menu?.remove()
    menu = null
    menuTrigger?.setAttribute('aria-expanded', 'false')
    menuTrigger = null
    menuItems.clear()
  }

  const hide = (): void => {
    closeMenu()
    closePicker()
    bar?.remove()
    bar = null
    insertBtn = null
    cmdButtons.clear()
    menuButtons.clear()
  }

  const buildPicker = (): HTMLElement => {
    const el = document.createElement('div')
    el.className = 'table-toolbar__picker'
    el.setAttribute('contenteditable', 'false')
    const cells: HTMLButtonElement[] = []
    for (let rows = 1; rows <= 6; rows++) {
      for (let cols = 1; cols <= 8; cols++) {
        const cell = document.createElement('button')
        cell.type = 'button'
        cell.className = 'table-toolbar__cell'
        cell.dataset.rows = String(rows)
        cell.dataset.cols = String(cols)
        cell.title = `${rows} × ${cols} 表格`
        cell.setAttribute('aria-label', `插入 ${rows} 行 ${cols} 列表格`)
        cell.addEventListener('mousedown', (event) => event.preventDefault())
        cell.addEventListener('mouseenter', () => {
          for (const other of cells) {
            const active =
              Number(other.dataset.rows) <= rows && Number(other.dataset.cols) <= cols
            other.classList.toggle('is-active', active)
          }
        })
        cell.addEventListener('click', (event) => {
          event.preventDefault()
          closePicker()
          focusEditor()
          actions.insertTable(rows, cols)
        })
        cells.push(cell)
        el.append(cell)
      }
    }
    el.addEventListener('mouseleave', () => {
      for (const other of cells) other.classList.remove('is-active')
    })
    return el
  }

  const positionPopup = (popup: HTMLElement, anchor: HTMLElement): void => {
    if (!bar) return
    const maxLeft = Math.max(0, bar.clientWidth - popup.offsetWidth)
    popup.style.left = `${Math.min(Math.max(0, anchor.offsetLeft), maxLeft)}px`
    const barRect = bar.getBoundingClientRect()
    const hostRect = host.getBoundingClientRect()
    const need = popup.offsetHeight + 8
    const roomBelow = hostRect.bottom - barRect.bottom
    const roomAbove = barRect.top - hostRect.top
    if (roomBelow < need && roomAbove > need) popup.style.top = `${-(popup.offsetHeight + 4)}px`
  }

  const openPicker = (): void => {
    if (!bar || picker) return
    closeMenu()
    picker = buildPicker()
    bar.append(picker)
    if (insertBtn) positionPopup(picker, insertBtn)
    insertBtn?.setAttribute('aria-expanded', 'true')
  }

  const openMenu = (id: TableMenuId): void => {
    if (!bar) return
    const entries = tableMenuSpecs.get(id)
    const trigger = menuButtons.get(id)
    if (!entries || !trigger) return
    const menuEl = document.createElement('div')
    menuEl.className = 'table-toolbar__menu'
    menuEl.dataset.menu = id
    menuEl.setAttribute('role', 'menu')
    menuEl.setAttribute('contenteditable', 'false')
    for (const entry of entries) {
      const itemBtn = document.createElement('button')
      itemBtn.type = 'button'
      itemBtn.className = 'table-toolbar__menu-item'
      itemBtn.setAttribute('role', 'menuitem')
      itemBtn.textContent = TABLE_COMMAND_LABELS[entry]
      itemBtn.title = TABLE_COMMAND_LABELS[entry]
      if (lastState) itemBtn.disabled = !tableCommandEnabled(lastState, entry)
      menuItems.set(entry, itemBtn)
      itemBtn.addEventListener('mousedown', (event) => event.preventDefault())
      itemBtn.addEventListener('click', (event) => {
        event.preventDefault()
        closeMenu()
        focusEditor()
        actions.run(entry)
      })
      menuEl.append(itemBtn)
    }
    bar.append(menuEl)
    positionPopup(menuEl, trigger)
    menu = menuEl
    menuTrigger = trigger
    trigger.setAttribute('aria-expanded', 'true')
  }

  const toggleMenu = (id: TableMenuId): void => {
    const wasOpen = menu?.dataset.menu === id
    closeMenu()
    closePicker()
    if (!wasOpen) openMenu(id)
  }

  const ensure = (): HTMLElement => {
    if (bar && bar.isConnected) return bar
    cmdButtons.clear()
    menuButtons.clear()
    menuItems.clear()
    insertBtn = null
    bar = document.createElement('div')
    bar.className = 'table-toolbar'
    bar.setAttribute('contenteditable', 'false')
    for (const item of tableToolbarItems) {
      if (item.kind === 'sep') {
        const sep = document.createElement('span')
        sep.className = 'table-toolbar__sep'
        sep.setAttribute('aria-hidden', 'true')
        bar.append(sep)
        continue
      }
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className =
        item.kind === 'insert'
          ? 'table-toolbar__btn table-toolbar__btn--insert'
          : item.kind === 'menu'
            ? 'table-toolbar__btn table-toolbar__btn--menu'
            : 'table-toolbar__btn'
      btn.textContent = item.label
      btn.title = item.title
      btn.addEventListener('mousedown', (event) => event.preventDefault())
      if (item.kind === 'insert') {
        btn.setAttribute('aria-haspopup', 'true')
        btn.setAttribute('aria-expanded', 'false')
        insertBtn = btn
        btn.addEventListener('click', (event) => {
          event.preventDefault()
          const wasOpen = picker !== null
          closePicker()
          if (!wasOpen) openPicker()
        })
      } else if (item.kind === 'menu') {
        btn.setAttribute('aria-haspopup', 'true')
        btn.setAttribute('aria-expanded', 'false')
        menuButtons.set(item.id, btn)
        btn.addEventListener('click', (event) => {
          event.preventDefault()
          toggleMenu(item.id)
        })
      } else {
        cmdButtons.set(item.id, btn)
        btn.addEventListener('click', (event) => {
          event.preventDefault()
          closeMenu()
          closePicker()
          focusEditor()
          actions.run(item.id)
        })
      }
      bar.append(btn)
    }
    host.append(bar)
    return bar
  }

  const refreshDisabled = (state: EditorState): void => {
    for (const [id, btn] of cmdButtons) btn.disabled = !tableCommandEnabled(state, id)
    for (const [id, btn] of menuItems) btn.disabled = !tableCommandEnabled(state, id)
  }

  const update = (editorView: EditorView): void => {
    const { state } = editorView
    lastState = state
    if (!tableRect(state)) {
      hide()
      return
    }
    const el = ensure()
    refreshDisabled(state)
    let coords: { left: number; top: number } | null = null
    try {
      coords = editorView.coordsAtPos(state.selection.from) as { left: number; top: number }
    } catch {
      coords = null
    }
    const hostRect = host.getBoundingClientRect()
    if (coords) {
      const height = el.offsetHeight
      const above = coords.top - hostRect.top - height - 8
      const top = above >= 0 ? above : coords.top - hostRect.top + 24
      const maxLeft = Math.max(8, host.clientWidth - el.offsetWidth - 8)
      const left = Math.min(Math.max(8, coords.left - hostRect.left), maxLeft)
      el.style.left = `${left}px`
      el.style.top = `${top}px`
    } else {
      el.style.left = '16px'
      el.style.top = '16px'
    }
  }

  return new ProsePlugin({
    props: {
      handleDOMEvents: {
        contextmenu: (editorView, event) => {
          const found = editorView.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          })
          if (!found) return false
          const $found = editorView.state.doc.resolve(found.pos)
          let inside = false
          for (let d = $found.depth; d > 0; d--) {
            if ($found.node(d).type.name === 'table') {
              inside = true
              break
            }
          }
          if (!inside) return false
          const target = TextSelection.near($found)
          if (!target.eq(editorView.state.selection)) {
            editorView.dispatch(editorView.state.tr.setSelection(target).scrollIntoView())
          }
          return false
        },
      },
    },
    view(editorView) {
      const relocate = (): void => update(editorView)
      const closePopups = (): void => {
        closeMenu()
        closePicker()
      }
      const onDocPointer = (event: Event): void => {
        const target = event.target
        if (!(target instanceof globalThis.Node) || !bar || !bar.contains(target)) {
          closePopups()
          return
        }
        if (menu && !menu.contains(target) && !(menuTrigger?.contains(target))) closeMenu()
      }
      const onDocKeydown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') closePopups()
      }
      document.addEventListener('scroll', relocate, true)
      window.addEventListener('resize', relocate)
      document.addEventListener('mousedown', onDocPointer, true)
      document.addEventListener('keydown', onDocKeydown, true)
      update(editorView)
      return {
        update: () => update(editorView),
        destroy: () => {
          document.removeEventListener('scroll', relocate, true)
          window.removeEventListener('resize', relocate)
          document.removeEventListener('mousedown', onDocPointer, true)
          document.removeEventListener('keydown', onDocKeydown, true)
          hide()
        },
      }
    },
  })
}

function offsetLineFromPrefix(prefix: string): Anchor {
  const offset = prefix.length
  const line = offset === 0 ? 1 : prefix.split('\n').length
  return { offset, line }
}

function approximateAnchor(view: EditorView, pos: number): Anchor {
  const size = view.state.doc.content.size
  const clamped = Math.min(Math.max(pos, 0), size)
  let text = ''
  if (clamped > 0) {
    try {
      text = view.state.doc.textBetween(0, clamped, '\n', '\n')
    } catch {
      text = ''
    }
  }
  const offset = text.length
  const line = offset === 0 ? 1 : text.split('\n').length
  return { offset, line }
}

export function createWysiwygAdapter(options: WysiwygAdapterOptions = {}): ViewAdapter {
  let editor: Editor | null = null
  let rootEl: HTMLElement | null = null
  let value = ''
  let frontmatter = ''
  let ready = false
  let wantsFocus = false
  let lastAnchor: Anchor | null = null
  let spellcheck = false
  // Swallow markdownUpdated during create()/first settle so remount ≠ dirty.
  let suppressInitEmit = false
  const { onChange } = options

  const applySpellcheck = (): void => {
    if (!rootEl) return
    const editable = rootEl.querySelector<HTMLElement>('.ProseMirror, [contenteditable="true"]')
    if (editable) editable.spellcheck = spellcheck
  }

  const emit = (markdown: string): void => {
    const full = joinFrontmatter({ frontmatter, body: markdown })
    value = full
    if (suppressInitEmit) return
    onChange?.(full)
  }

  function applyMarkdown(markdown: string): void {
    const split = splitFrontmatter(markdown)
    frontmatter = split.frontmatter
    const body = split.body
    value = markdown
    if (!editor || !ready) return
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const parser = ctx.get(parserCtx)
      const serializer = ctx.get(serializerCtx)
      const doc = parser(body)
      const state = EditorState.create({
        schema: view.state.schema,
        doc,
        plugins: view.state.plugins,
      })
      view.updateState(state)
      value = joinFrontmatter({ frontmatter, body: serializer(doc) })
    })
  }

  function ensureBlockInsertPos(view: EditorView): void {
    const { $from } = view.state.selection
    for (let d = $from.depth; d >= 1; d--) {
      const node = $from.node(d)
      if (
        node.type.name === 'heading' ||
        node.type.name === 'code_block' ||
        node.type.name === 'table' ||
        node.type.name === 'table_row' ||
        node.type.name === 'table_cell' ||
        node.type.name === 'table_header'
      ) {
        const after = Math.min($from.after(d), view.state.doc.content.size)
        const $after = view.state.doc.resolve(Math.max(0, after))
        view.dispatch(view.state.tr.setSelection(TextSelection.near($after)))
        return
      }
    }
  }

  // Like `Slice.maxOpen`, but never descends into code blocks: Milkdown's
  // `code_block` has `content: text*` (not a leaf), so plain `maxOpen` would
  // hand `replaceRange` an *open* slice (openStart=1) exposing the fence's raw
  // text — when the caret sits inside a non-empty paragraph that text splices
  // straight into it and the ``` markers disappear. Stopping at code blocks
  // keeps fences (plantuml/mermaid/math/mindmap…) as closed, standalone
  // blocks, while pure inline payloads (bold links, footnote markers…) still
  // open into the current paragraph as before.
  function insertableSlice(fragment: Fragment): Slice {
    let openStart = 0
    for (let n = fragment.firstChild; n && !n.isLeaf && !n.type.spec.code; n = n.firstChild) openStart++
    let openEnd = 0
    for (let n = fragment.lastChild; n && !n.isLeaf && !n.type.spec.code; n = n.lastChild) openEnd++
    return new Slice(fragment, openStart, openEnd)
  }

  function insertMarkdownAtCursor(markdown: string, caretOffset?: number): void {
    if (!editor || !ready) return
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      ensureBlockInsertPos(view)
      const parser = ctx.get(parserCtx)
      const { from, to } = view.state.selection
      const doc = parser(markdown)
      // Inline content (bold text, links, images, inline math…) opens into the
      // current paragraph instead of becoming a new block; see insertableSlice
      // for why fences must stay closed.
      const slice = insertableSlice(doc.content)
      const wasLeadingCode = view.state.doc.firstChild?.type.spec.code === true
      const wasTrailingCode = view.state.doc.lastChild?.type.spec.code === true
      let tr = view.state.tr.replaceRange(from, to, slice)
      // The insert must leave a textblock on BOTH sides of a fence: ProseMirror
      // cannot put a caret at a bare document edge next to a code block, so a
      // leading/trailing fence created here gets an empty paragraph to type in.
      const paragraphType = view.state.schema.nodes.paragraph
      if (paragraphType) {
        if (!wasLeadingCode && tr.doc.firstChild?.type.spec.code) {
          tr = tr.insert(0, paragraphType.create())
        }
        if (!wasTrailingCode && tr.doc.lastChild?.type.spec.code) {
          tr = tr.insert(tr.doc.content.size, paragraphType.create())
        }
      }
      // Previewable widgets (diagram/plantuml/math/embed) only render while the
      // caret sits OUTSIDE the fence — park it in the textblock right after the
      // inserted code block so the preview shows immediately instead of only
      // after the cursor leaves the block.
      if (caretOffset === undefined) {
        const $cur = tr.doc.resolve(tr.selection.from)
        for (let d = $cur.depth; d >= 1; d--) {
          if ($cur.node(d).type.spec.code) {
            const after = Math.min($cur.after(d), tr.doc.content.size)
            tr = tr.setSelection(TextSelection.near(tr.doc.resolve(after)))
            break
          }
        }
      }
      const caret =
        caretOffset === undefined
          ? tr.selection.from
          : Math.min(from + caretOffset, tr.doc.content.size)
      const pos = Math.max(0, Math.min(caret, tr.doc.content.size))
      const sel = TextSelection.near(tr.doc.resolve(pos))
      view.dispatch(tr.setSelection(sel).scrollIntoView())
      // Listener markdownUpdated is debounced (200ms); flush synchronously so
      // getValue()/doc bridges see the inserted markdown (e.g. images) now.
      emit(ctx.get(serializerCtx)(view.state.doc))
      view.focus()
    })
  }

  function insertTableAtCursor(rows: number, cols: number): void {
    const header = `| ${Array.from({ length: cols }, (_, i) => `H${i + 1}`).join(' | ')} |`
    const sep = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`
    const body = Array.from(
      { length: Math.max(0, rows - 1) },
      () => `| ${Array.from({ length: cols }, () => ' ').join(' | ')} |`,
    )
    insertMarkdownAtCursor([header, sep, ...body].join('\n'))
  }

  function executeTableCommand(id: TableCommandId): boolean {
    if (!editor || !ready) return false
    return editor.action((ctx): boolean => {
      const view = ctx.get(editorViewCtx)
      const state = view.state
      const beforeDoc = state.doc
      let result = false
      const rect = tableRect(state)
      if (rect && tableCommandEnabled(state, id)) {
        switch (id) {
          case 'rowBefore':
            // 表头行不允许在其前插入行（schema 只允许一个 header row），回退到其后。
            result = callCommand(
              rect.top === 0 ? addRowAfterCommand.key : addRowBeforeCommand.key,
            )(ctx)
            break
          case 'rowAfter':
            result = callCommand(addRowAfterCommand.key)(ctx)
            break
          case 'colBefore':
            result = callCommand(addColBeforeCommand.key)(ctx)
            break
          case 'colAfter':
            result = callCommand(addColAfterCommand.key)(ctx)
            break
          case 'rowDelete':
            result = deleteRow(state, view.dispatch)
            break
          case 'colDelete':
            result = deleteColumn(state, view.dispatch)
            break
          case 'deleteTable':
            result = deleteTable(state, view.dispatch)
            break
          case 'rowUp':
            result = callCommand(moveRowCommand.key, { from: rect.top, to: rect.top - 1 })(ctx)
            break
          case 'rowDown':
            result = callCommand(moveRowCommand.key, { from: rect.top, to: rect.top + 1 })(ctx)
            break
          case 'colLeft':
            result = callCommand(moveColCommand.key, { from: rect.left, to: rect.left - 1 })(ctx)
            break
          case 'colRight':
            result = callCommand(moveColCommand.key, { from: rect.left, to: rect.left + 1 })(ctx)
            break
          case 'alignLeft':
            result = alignTableColumns(state, view.dispatch, 'left')
            break
          case 'alignCenter':
            result = alignTableColumns(state, view.dispatch, 'center')
            break
          case 'alignRight':
            result = alignTableColumns(state, view.dispatch, 'right')
            break
          case 'selectRow':
            callCommand(selectRowCommand.key, { index: rect.top })(ctx)
            result = view.state.selection instanceof CellSelection
            break
          case 'selectCol':
            callCommand(selectColCommand.key, { index: rect.left })(ctx)
            result = view.state.selection instanceof CellSelection
            break
          case 'selectTable':
            callCommand(selectTableCommand.key)(ctx)
            result = view.state.selection instanceof CellSelection
            break
          case 'deleteSelection': {
            const sel = state.selection
            if (sel instanceof CellSelection && sel.isRowSelection() && sel.isColSelection()) {
              result = deleteTable(state, view.dispatch)
            } else if (sel instanceof CellSelection && sel.isColSelection()) {
              result = deleteColumn(state, view.dispatch)
            } else {
              result = deleteRow(state, view.dispatch)
            }
            break
          }
          case 'exit':
            result = callCommand(exitTable.key)(ctx)
            break
        }
      }
      // Listener markdownUpdated is debounced (200ms); flush synchronously so
      // getValue()/doc bridges see the new document immediately.
      if (view.state.doc !== beforeDoc) {
        emit(ctx.get(serializerCtx)(view.state.doc))
      }
      return result
    })
  }

  // PlantUML block lookup. Pointer: posAtDOM on the clicked DOM — the widget
  // is a decoration at the code block's own pos, so a boundary lands beside
  // the block (neighbour check follows) and a raw-block click resolves as an
  // ancestor. Caret: the selection only — a boundary neighbour would false
  // positive when the caret merely sits next to a block.
  const resolvePlantuml = (anchor: PlantumlAnchor): PlantumlTarget | null => {
    if (!editor || !ready) return null
    return editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const doc = view.state.doc
      let pos: number | null = null
      if (anchor.target) {
        let dom: Element | null = anchor.target
        while (dom) {
          try {
            pos = view.posAtDOM(dom, 0)
            break
          } catch {
            dom = dom.parentElement
          }
        }
      } else if (anchor.caret) {
        pos = view.state.selection.from
      }
      if (pos == null) return null
      const probe = Math.min(Math.max(pos, 0), doc.content.size)
      const $ = doc.resolve(probe)
      let block: Node | null = null
      let blockPos = -1
      for (let depth = $.depth; depth > 0; depth--) {
        const node = $.node(depth)
        if (node.type.name === 'code_block') {
          block = node
          blockPos = $.before(depth)
          break
        }
      }
      if (!block && anchor.target) {
        const after = $.nodeAfter
        const before = $.nodeBefore
        if (after?.type.name === 'code_block') {
          block = after
          blockPos = probe
        } else if (before?.type.name === 'code_block') {
          block = before
          blockPos = probe - before.nodeSize
        }
      }
      if (!block || normalizeEmbedLang(String(block.attrs.language ?? '')) !== 'plantuml') {
        return null
      }
      const target: PlantumlTarget = {
        code: block.textContent,
        writeBack: (next) => replaceCodeBlockContent(view, blockPos, next),
      }
      return target
    })
  }

  return {
    kind: 'wysiwyg',

    mount(container: HTMLElement): void {
      if (editor) return
      suppressInitEmit = true
      const split = splitFrontmatter(value)
      frontmatter = split.frontmatter
      const initial = split.body
      const host = document.createElement('div')
      host.className = 'adapter-wysiwyg'
      container.replaceChildren(host)
      rootEl = host
      setPlantumlResolver(resolvePlantuml)

      const instance = Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, host)
          ctx.set(defaultValueCtx, initial)
          ctx.update(prosePluginsCtx, (plugins) => [
            widgetPlugin,
            // Flush synchronously so the doc store / tab dirty dot see the
            // toggle without waiting for the 200ms listener debounce.
            taskCheckboxPlugin((view) => emit(ctx.get(serializerCtx)(view.state.doc))),
            tableToolbarPlugin(host, {
              run: (id) => {
                executeTableCommand(id)
              },
              insertTable: (rows, cols) => {
                insertTableAtCursor(rows, cols)
              },
            }),
            ...plugins,
          ])
          ctx.update(uploadConfig.key, (config) => ({
            ...config,
            enableHtmlFileUploader: true,
          }))
          ctx
            .get(listenerCtx)
            .markdownUpdated((_ctx, markdown) => {
              emit(markdown)
            })
        })
        .use(commonmark)
        .use(gfm)
        .use(columnResizingPlugin)
        .use(history)
        .use(listener)
        .use(upload)
        .use(imageNullSafety)

      editor = instance
      void instance
        .create()
        .then(() => {
          ready = true
          applySpellcheck()
          if (value !== joinFrontmatter({ frontmatter, body: initial })) applyMarkdown(value)
          if (lastAnchor) applyAnchor(lastAnchor)
          if (wantsFocus) {
            wantsFocus = false
            editor?.action((ctx) => ctx.get(editorViewCtx).focus())
          }
          suppressInitEmit = false
        })
        .catch((error: unknown) => {
          console.error('[markup] milkdown create 失败', error)
          suppressInitEmit = false
          editor = null
          rootEl?.remove()
          rootEl = null
        })
    },

    unmount(): void {
      setPlantumlResolver(null)
      ready = false
      if (!editor) {
        rootEl?.remove()
        rootEl = null
        return
      }
      const instance = editor
      editor = null
      void instance.destroy(false)
      rootEl?.remove()
      rootEl = null
    },

    setValue(markdown: string): void {
      applyMarkdown(markdown)
    },

    getValue(): string {
      return value
    },

    focus(): void {
      if (!editor || !ready) {
        wantsFocus = true
        return
      }
      editor.action((ctx) => ctx.get(editorViewCtx).focus())
    },

    insertMarkdown(options: InsertMarkdownOptions): void {
      insertMarkdownAtCursor(options.markdown, options.caretOffset)
    },

    async insertImage(file: File): Promise<boolean> {
      if (!isImageFile(file)) return false
      const dataUrl = await readFileAsDataUrl(file)
      insertMarkdownAtCursor(`![${imageAltText(file)}](${dataUrl})`)
      return true
    },

    insertTable(rows = 3, cols = 3): void {
      insertTableAtCursor(rows, cols)
    },

    runTableCommand(id: TableCommandId): boolean {
      return executeTableCommand(id)
    },

    /**
     * Paragraph-level formats done natively on the ProseMirror document.
     *
     * The shell's markdown-text rewrite cannot do this here: `# `, `1. ` and
     * `- [ ] ` are *structure* in the wysiwyg view, not text, so splicing a
     * markdown range could only rewrite the line's inline content (an H1
     * "stayed H1", `1.` → `- ` nested a list inside the item). Milkdown ships
     * the matching block commands; list ⇄ list and task toggles go through
     * `setNodeMarkup` on the list node so items/nesting survive.
     */
    setBlockFormat(id: BlockFormatId): boolean {
      if (!editor || !ready) return false
      return editor.action((ctx): boolean => {
        const view = ctx.get(editorViewCtx)
        const schema = view.state.schema
        const flush = (): void => emit(ctx.get(serializerCtx)(view.state.doc))
        const call = (key: unknown, payload?: unknown): boolean =>
          Boolean(callCommand(key as never, payload as never)(ctx))

        const listTypes = ['bullet_list', 'ordered_list']
        const liftOutOfList = (): boolean => {
          let lifted = false
          for (let i = 0; i < 8; i += 1) {
            if (!enclosingAncestor(view.state, listTypes)) break
            if (!call(liftListItemCommand.key)) break
            lifted = true
          }
          return lifted
        }
        const setTaskChecked = (checked: boolean | null): boolean => {
          const list = enclosingAncestor(view.state, ['bullet_list'])
          if (!list) return false
          const tr = view.state.tr
          let pos = list.pos + 1
          list.node.forEach((child) => {
            if (child.type.name === 'list_item') {
              tr.setNodeMarkup(pos, undefined, { ...child.attrs, checked })
            }
            pos += child.nodeSize
          })
          if (!tr.docChanged) return false
          view.dispatch(tr)
          return true
        }
        /**
         * 有序 ⇄ 无序：换列表节点类型，并把条目的 `listType`/`label` 一并改掉。
         * Milkdown 的 `syncListOrderPlugin`（appendTransaction）会按条目属性把
         * 列表类型强制同步回去——只改节点类型会被它静默撤销。
         */
        const convertList = (
          pos: number,
          node: Node,
          target: 'bullet_list' | 'ordered_list',
        ): boolean => {
          const type = schema.nodes[target]
          if (!type) return false
          const ordered = target === 'ordered_list'
          const tr = view.state.tr.setNodeMarkup(pos, type, node.attrs)
          let childPos = pos + 1
          let index = 0
          node.forEach((child) => {
            if (child.type.name === 'list_item') {
              const attrs: Record<string, unknown> = {
                ...child.attrs,
                listType: ordered ? 'ordered' : 'bullet',
              }
              if (ordered) attrs.label = `${index + 1}.`
              tr.setNodeMarkup(childPos, undefined, attrs)
            }
            childPos += child.nodeSize
            index += 1
          })
          view.dispatch(tr)
          return true
        }
        const ensureBulletList = (): boolean => {
          const bullet = enclosingAncestor(view.state, ['bullet_list'])
          if (bullet) return true
          const ordered = enclosingAncestor(view.state, ['ordered_list'])
          if (ordered) return convertList(ordered.pos, ordered.node, 'bullet_list')
          return call(wrapInBulletListCommand.key)
        }

        const heading = /^h([1-6])$/.exec(id)
        let result = false
        // Blocks that cannot sit inside a list item (heading / quote / fence)
        // first leave the list, so 引用/代码块 on a list line reads like
        // "turn this line into …" instead of silently doing nothing.
        const leaveList = (): void => {
          if (enclosingAncestor(view.state, listTypes)) liftOutOfList()
        }
        if (heading) {
          const level = Number(heading[1])
          const parent = view.state.selection.$from.parent
          const same =
            parent.type.name === 'heading' && Number(parent.attrs.level) === level
          if (same) {
            result = call(turnIntoTextCommand.key)
          } else {
            leaveList()
            result = call(wrapInHeadingCommand.key, level)
          }
        } else if (id === 'plain') {
          result = liftOutOfList()
          if (!result && enclosingAncestor(view.state, ['blockquote'])) {
            result = lift(view.state, view.dispatch)
          }
          if (!result) result = call(turnIntoTextCommand.key)
        } else if (id === 'quote') {
          if (enclosingAncestor(view.state, ['blockquote'])) {
            result = lift(view.state, view.dispatch)
          } else {
            leaveList()
            result = call(wrapInBlockquoteCommand.key)
          }
        } else if (id === 'codeBlock') {
          if (view.state.selection.$from.parent.type.name === 'code_block') {
            result = call(turnIntoTextCommand.key)
          } else {
            leaveList()
            result = call(createCodeBlockCommand.key, '')
          }
        } else if (id === 'bullet' || id === 'ordered') {
          const type = id === 'bullet' ? 'bullet_list' : 'ordered_list'
          const current = enclosingAncestor(view.state, listTypes)
          if (current && current.node.type.name === type) {
            result = call(liftListItemCommand.key)
          } else if (current) {
            result = convertList(current.pos, current.node, type)
          } else {
            result = call(
              type === 'bullet_list'
                ? wrapInBulletListCommand.key
                : wrapInOrderedListCommand.key,
            )
          }
        } else if (id === 'task') {
          const existing = enclosingAncestor(view.state, ['bullet_list'])
          result = existing
            ? setTaskChecked(isTaskList(existing.node) ? null : false)
            : ensureBulletList() && setTaskChecked(false)
        }

        if (result) flush()
        return result
      })
    },

    setCodeLanguage(language: string): void {
      if (!editor || !ready) return
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const { $from } = view.state.selection
        let pos = -1
        for (let d = $from.depth; d >= 0; d--) {
          const node = $from.node(d)
          if (node.type.name === 'code_block') {
            pos = $from.before(d)
            break
          }
        }
        if (pos < 0) return
        view.dispatch(view.state.tr.setNodeAttribute(pos, 'language', language))
      })
    },

    centerCaret(): void {
      const scroller = rootEl
      if (!editor || !ready || !scroller) return
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const { from } = view.state.selection
        const coords = view.coordsAtPos(from)
        if (!coords) return
        const height = coords.bottom - coords.top
        const scrollerTop = scroller.getBoundingClientRect().top
        const cursorTop = coords.top - scrollerTop
        const target = scroller.scrollTop + cursorTop - scroller.clientHeight / 2 + height / 2
        scroller.scrollTop = Math.max(0, target)
      })
    },

    captureAnchor(): Anchor {
      if (!editor || !ready) return { offset: 0, line: 1 }
      return editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const serializer = ctx.get(serializerCtx)
        const fmChars = frontmatter ? frontmatter.length + 2 : 0
        const fmLines = frontmatter ? frontmatter.split('\n').length : 0
        const anchorAt = (pos: number): { offset: number; line: number } => {
          const prefix = serializePrefix(view, serializer, pos)
          const bodyAnchor =
            prefix === null ? approximateAnchor(view, pos) : offsetLineFromPrefix(prefix)
          return { offset: bodyAnchor.offset + fmChars, line: bodyAnchor.line + fmLines }
        }
        const selection = view.state.selection
        const start = Math.min(selection.anchor, selection.head)
        const end = Math.max(selection.anchor, selection.head)
        if (end <= 0) {
          lastAnchor = { offset: frontmatter.length, line: 1 }
          return lastAnchor
        }
        const from = anchorAt(start)
        const to = end > start ? anchorAt(end) : null
        lastAnchor = {
          offset: from.offset,
          line: from.line,
          // Both ends, so callers can act on the selection and not just the caret.
          ...(to !== null && to.offset > from.offset ? { endOffset: to.offset } : {}),
        }
        return lastAnchor
      })
    },

    restoreAnchor(anchor: Anchor): void {
      lastAnchor = anchor
      if (!editor || !ready) return
      const fmLines = frontmatter ? frontmatter.split('\n').length : 0
      const fmChars = frontmatter ? frontmatter.length + 2 : 0
      const bodyAnchor: Anchor = {
        offset: Math.max(0, anchor.offset - fmChars),
        line: Math.max(1, anchor.line - fmLines),
        endOffset:
          anchor.endOffset === undefined ? undefined : Math.max(0, anchor.endOffset - fmChars),
      }
      applyAnchor(bodyAnchor)
    },

    setLineNumbers(): void {
      /* wysiwyg 无视图行号 */
    },

    setSpellcheck(enabled: boolean): void {
      spellcheck = enabled
      applySpellcheck()
    },
  }

  function posForOffset(view: EditorView, serializer: (doc: Node) => string, offset: number): number {
    const size = view.state.doc.content.size
    const atMost = Math.min(Math.max(offset, 0), size * 64)
    const cuts = safeCutPositions(view)
    // 1. Largest block boundary whose serialized prefix still fits.
    let lo = 0
    let hi = cuts.length - 1
    let best = 0
    let failed = false
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const pos = cuts[mid] ?? 0
      const text = serializePrefix(view, serializer, pos)
      if (text === null) {
        failed = true
        break
      }
      if (text.length <= atMost) {
        best = pos
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    if (failed) {
      best = 0
      for (const pos of cuts) {
        const text = serializePrefix(view, serializer, pos)
        if (text === null) continue
        if (text.length <= atMost) best = pos
        else break
      }
    }
    // 2. Refine inside that block: block boundaries alone can only express a
    //    caret, so a selection (endOffset) would collapse. Positions inside a
    //    text block serialize monotonically, so binary-search them too.
    const nextCut = cuts.find((cut) => cut > best) ?? size
    let low = best
    let high = nextCut
    while (low <= high) {
      const mid = (low + high) >> 1
      const text = serializePrefix(view, serializer, mid)
      if (text === null || text.length > atMost) {
        high = mid - 1
        continue
      }
      best = mid
      low = mid + 1
    }
    return Math.min(Math.max(best, 0), size)
  }

  function safeCutPositions(view: EditorView): number[] {
    const doc = view.state.doc
    const cuts = new Set<number>([0, doc.content.size])
    doc.descendants((node, pos) => {
      if (!node.isBlock) return
      cuts.add(pos)
      cuts.add(pos + node.nodeSize)
    })
    return [...cuts].sort((a, b) => a - b)
  }

  function applyAnchor(anchor: Anchor): void {
    if (!editor || !ready) return
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const serializer = ctx.get(serializerCtx)
      const from = posForOffset(view, serializer, anchor.offset)
      const to =
        anchor.endOffset === undefined ? from : posForOffset(view, serializer, anchor.endOffset)
      const size = view.state.doc.content.size
      const start = Math.min(Math.max(from, 0), size)
      const end = Math.min(Math.max(Math.max(to, start), 0), size)
      const selection = resolveSelection(view.state.doc, start, end)
      view.dispatch(view.state.tr.setSelection(selection).scrollIntoView())
      view.focus()
    })
  }

  function resolveSelection(doc: Node, start: number, end: number): Selection {
    const snapIn = (pos: number, bias: 1 | -1): TextSelection | null => {
      const $pos = doc.resolve(pos)
      if ($pos.parent.inlineContent) return new TextSelection($pos)
      const found = TextSelection.findFrom($pos, bias, true)
      return found instanceof TextSelection ? found : null
    }
    if (end > start) {
      const headSel = snapIn(end, -1) ?? snapIn(end, 1)
      const tailSel = snapIn(start, 1) ?? snapIn(start, -1)
      if (tailSel && headSel) {
        try {
          return TextSelection.create(doc, tailSel.from, Math.max(headSel.to, tailSel.from))
        } catch {
          /* fall through */
        }
      }
    } else {
      const collapsed = snapIn(start, 1) ?? snapIn(start, -1)
      if (collapsed) return collapsed
    }
    return TextSelection.near(doc.resolve(Math.min(start, doc.content.size)), 1)
  }
}

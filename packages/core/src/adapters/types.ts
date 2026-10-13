export type ViewKind = 'wysiwyg' | 'source' | 'hybrid'

import type { BlockFormatId, ListIndentStep, TaskStatus } from '../textFormat'
import type { SmartInputOptions } from '../smartInput'

/**
 * Image formats accepted for insert/paste when the blob reports no usable MIME
 * type (some clipboards and pickers hand out `''` or `application/octet-stream`).
 */
const IMAGE_EXTENSION_RE = /\.(apng|avif|bmp|gif|ico|jfif|jpe?g|png|svg|tiff?|webp)$/i

/** True when a file should be embedded as a markdown image. */
export function isImageFile(file: { name?: string; type?: string }): boolean {
  const type = file.type ?? ''
  if (type.startsWith('image/')) return true
  if (type && type !== 'application/octet-stream') return false
  return !!file.name && IMAGE_EXTENSION_RE.test(file.name)
}

/** Alt text survives markdown round-trips only without raw `[]()` chars. */
export function imageAltText(file: { name?: string }): string {
  return (file.name || 'image').replace(/[[\]()]/g, '_')
}

/**
 * A resolved image ready to splice into the document.
 *
 * A view never sees the `File`: deciding where the bytes live (an inline
 * `data:` URL, or a copy on disk with a relative reference) is Typora's
 * 「插入图片时」 and belongs to the shell, so all three views get one answer
 * instead of three drifting ones. See `imagePersist.ts`.
 */
export interface InsertedImage {
  alt: string
  url: string
}

export interface Anchor {
  offset: number
  line: number
  endOffset?: number
}

export interface InsertMarkdownOptions {
  markdown: string
  caretOffset?: number
}

/** Commands addressable on a wysiwyg table (guarded against schema corruption). */
export type TableCommandId =
  | 'rowBefore'
  | 'rowAfter'
  | 'rowDelete'
  | 'rowUp'
  | 'rowDown'
  | 'colBefore'
  | 'colAfter'
  | 'colDelete'
  | 'colLeft'
  | 'colRight'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'selectRow'
  | 'selectCol'
  | 'selectTable'
  | 'deleteSelection'
  | 'deleteTable'
  | 'exit'

/** Display labels shared by toolbar menus, editor context menu and palette. */
export const TABLE_COMMAND_LABELS: Record<TableCommandId, string> = {
  rowBefore: '上方插入行',
  rowAfter: '下方插入行',
  rowDelete: '删除当前行',
  rowUp: '上移一行',
  rowDown: '下移一行',
  colBefore: '左侧插入列',
  colAfter: '右侧插入列',
  colDelete: '删除当前列',
  colLeft: '左移一列',
  colRight: '右移一列',
  alignLeft: '左对齐',
  alignCenter: '居中对齐',
  alignRight: '右对齐',
  selectRow: '选中整行',
  selectCol: '选中整列',
  selectTable: '选中整表',
  deleteSelection: '删除选中内容',
  deleteTable: '删除表格',
  exit: '退出表格',
}

export interface ViewAdapter {
  readonly kind: ViewKind
  mount(container: HTMLElement): void
  unmount(): void
  setValue(markdown: string): void
  getValue(): string
  /**
   * 查找/替换要用的文本，锚点必须和它同坐标系。
   *
   * 默认就是 `getValue()`；只有实时预览需要另给一份 —— 它的 `restoreAnchor` 是拿
   * **序列化输出**对齐的，而 `getValue()` 在 `setValue` 抢在 `mount` 之前被
   * `SyncEngine` 调到时还停在原始源码上，两者差在转义与列表符号上（`- [x]` →
   * `* \[x]`），查找的锚点会整体偏掉几个字符。
   */
  getSearchValue?(): string
  focus(): void
  captureAnchor(): Anchor
  restoreAnchor(anchor: Anchor): void
  insertMarkdown?(options: InsertMarkdownOptions): void
  /** Splice a resolved image in; the shell decided its URL (see `InsertedImage`). */
  insertImage?(image: InsertedImage): boolean
  insertTable?(rows?: number, cols?: number): void
  /** Run a table edit command (wysiwyg only). False when unsupported/no-op. */
  runTableCommand?(id: TableCommandId): boolean
  /**
   * Apply a paragraph-level format natively (wysiwyg only): heading level,
   * quote, bullet/ordered/task list, code block.
   *
   * The plain-text views rewrite line markers, but in the wysiwyg view those
   * markers (`# `, `1. `, `- [ ] `) are *structure*, not text — a markdown
   * range splice can only rewrite inline content there. Adapters that can do
   * better return true; the shell falls back to the text rewrite otherwise.
   */
  setBlockFormat?(id: BlockFormatId): boolean
  /**
   * 列表缩进 natively. Nesting a list is a *structure* change, so the
   * markdown-text rewrite cannot express it here. False when unsupported or a
   * no-op, and the caller falls back to the text transform.
   */
  setListIndent?(step: ListIndentStep): boolean
  /**
   * 任务状态 ▸ 标记为已完成 / 未完成, applied to the enclosing list (Typora
   * marks the whole list, not just the caret's item). False when the caret is
   * not in a task list.
   */
  setTaskStatus?(status: TaskStatus): boolean
  setCodeLanguage?(language: string): void
  /** Scroll so the caret line sits near the vertical center of its scroller. */
  centerCaret?(): void
  /** Toggle line-number gutter (source/hybrid). No-op when unsupported. */
  setLineNumbers?(enabled: boolean): void
  /** Toggle browser spellcheck on the editable surface. */
  setSpellcheck?(enabled: boolean): void
  /**
   * 只读模式. Blocks edits but keeps selection, scrolling and copying; each view
   * flips whatever owns its `contenteditable` (ProseMirror props, CodeMirror's
   * editable facet, OverType's textarea) rather than the DOM directly.
   */
  setReadOnly?(enabled: boolean): void
  /**
   * 智能输入 — 智能引号 / 智能破折号 / 成对的符号.
   *
   * Each view installs its own hook (ProseMirror's `handleTextInput`,
   * CodeMirror's `inputHandler`, the textarea's `beforeinput`) because all three
   * own their input path; the rules themselves are shared in `smartInput.ts`.
   */
  setSmartInput?(options: SmartInputOptions): void
  /**
   * Resolve the source line under a viewport point (or caret as fallback).
   * `offset` is the markdown offset of the line start; `column` is 0-based within the line.
   */
  getLineAt?(clientX: number, clientY: number): LineAt | null
}

export interface LineAt {
  text: string
  /** 1-based line number in the markdown document. */
  line: number
  /** Markdown offset of the first character of this line. */
  offset: number
  /** 0-based column within the line (best effort from pointer/caret). */
  column: number
}
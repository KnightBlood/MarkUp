export type ViewKind = 'wysiwyg' | 'source' | 'hybrid'

import type { BlockFormatId } from '../textFormat'

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
  focus(): void
  captureAnchor(): Anchor
  restoreAnchor(anchor: Anchor): void
  insertMarkdown?(options: InsertMarkdownOptions): void
  insertImage?(file: File): Promise<boolean>
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
  setCodeLanguage?(language: string): void
  /** Scroll so the caret line sits near the vertical center of its scroller. */
  centerCaret?(): void
  /** Toggle line-number gutter (source/hybrid). No-op when unsupported. */
  setLineNumbers?(enabled: boolean): void
  /** Toggle browser spellcheck on the editable surface. */
  setSpellcheck?(enabled: boolean): void
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
/**
 * 拖入文件 — what a dropped file should become.
 *
 * Split out from the shell because the ordering is the whole decision and it is
 * easy to get subtly wrong: `.md` wins over the image test (a dropped
 * `diagram.png.md` is a document), an image wins over a generic link, and
 * everything else is a link. Keeping it pure means the rule can be pinned
 * without a browser, a drag event, or a host.
 */

import { isImageFile } from './adapters/types'

export type DroppedKind = 'document' | 'image' | 'link'

/** Extensions a drop opens as a document rather than linking to. */
const DOCUMENT_NAME = /\.(md|markdown|mdown|mkd|txt)$/i

/** True when a dropped file should open as a document in its own tab. */
export function isDocumentName(name: string): boolean {
  return DOCUMENT_NAME.test(name)
}

/**
 * How to handle a dropped file.
 *
 * A markdown document opens; an image goes through the same 插入图片时 rules as
 * a pasted one; anything else becomes a link to the file.
 */
export function classifyDroppedFile(file: { name?: string; type?: string }): DroppedKind {
  if (isDocumentName(file.name ?? '')) return 'document'
  if (isImageFile(file)) return 'image'
  return 'link'
}

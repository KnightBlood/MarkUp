/**
 * Locate the open ``` fence covering a markdown offset.
 *
 * Used by the plain-text adapters (source / hybrid) to turn "the caret or
 * pointer sits inside a fence" into a precise content span that later edits
 * can rewrite without touching the fence lines themselves.
 */
export interface FenceRange {
  /** Offset of the first content character (right after the opener's newline). */
  contentFrom: number
  /** Offset just past the content — includes the newline preceding the closing fence. */
  contentTo: number
  /** Fence body without that trailing separator newline. */
  code: string
}

const FENCE_RE = /^(`{3,})(.*)$/

const stripCr = (line: string): string => (line.endsWith('\r') ? line.slice(0, -1) : line)

/**
 * Wrap `text` so a closing ``` always starts on its own line. Empty content
 * stays empty (an already-separated opener + closer need no extra newline).
 */
export function fenceContentInsert(text: string): string {
  if (text === '') return ''
  return text.endsWith('\n') ? text : `${text}\n`
}

/**
 * Returns the target fence's content span, or null when `offset` sits outside
 * any matching fence — including inside a *different* fence (a bare ```
 * encountered while walking up closes whatever we're in, and a foreign opener
 * means we're inside that language's block instead).
 */
export function findFenceAtOffset(
  markdown: string,
  offset: number,
  isOpeningFence: (info: string) => boolean,
): FenceRange | null {
  const clamped = Math.min(Math.max(offset, 0), markdown.length)
  const lines: string[] = []
  const starts: number[] = []
  let lineStart = 0
  for (let i = 0; i <= markdown.length; i++) {
    if (i === markdown.length || markdown.charCodeAt(i) === 10) {
      lines.push(markdown.slice(lineStart, i))
      starts.push(lineStart)
      lineStart = i + 1
    }
  }
  if (lines.length === 0) return null

  // Line containing the offset; an offset sitting on a \n belongs to the line above.
  let idx = lines.length - 1
  for (let i = 0; i < lines.length; i++) {
    if (clamped <= starts[i]! + lines[i]!.length) {
      idx = i
      break
    }
  }

  let openerIdx = -1
  for (let i = idx; i >= 0; i--) {
    const m = FENCE_RE.exec(stripCr(lines[i] ?? ''))
    if (!m) continue
    const info = (m[2] ?? '').trim()
    if (info === '') return null
    if (!isOpeningFence(info)) return null
    openerIdx = i
    break
  }
  if (openerIdx < 0) return null

  for (let i = openerIdx + 1; i < lines.length; i++) {
    const m = FENCE_RE.exec(stripCr(lines[i] ?? ''))
    if (!m) continue
    // A fence line carrying an info string inside a block is literal content;
    // only a bare ``` closes it.
    if ((m[2] ?? '').trim() !== '') continue
    const contentFrom = starts[openerIdx]! + lines[openerIdx]!.length + 1
    const contentTo = starts[i]!
    const raw = markdown.slice(contentFrom, contentTo)
    return { contentFrom, contentTo, code: raw.endsWith('\n') ? raw.slice(0, -1) : raw }
  }
  return null
}

export interface LineLinkHit {
  kind: 'link' | 'image'
  /** Link/image alt or label text. */
  text: string
  url: string
  /** 0-based start index in the line. */
  start: number
  /** 0-based end index (exclusive) in the line. */
  end: number
}

const INLINE_LINK_RE =
  /(!?)\[([^\]]*)\]\(\s*(?:<([^>\n]+)>|([^)\s]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g

/**
 * Find an inline markdown link or image on a single line.
 * When `column` is given, prefer the match that contains that column.
 */
export function parseLineLink(line: string, column?: number): LineLinkHit | null {
  const matches: LineLinkHit[] = []
  INLINE_LINK_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = INLINE_LINK_RE.exec(line)) !== null) {
    const start = match.index
    const end = start + match[0].length
    matches.push({
      kind: match[1] === '!' ? 'image' : 'link',
      text: match[2] ?? '',
      url: match[3] ?? match[4] ?? '',
      start,
      end,
    })
  }
  if (matches.length === 0) return null
  if (column !== undefined) {
    const hit = matches.find((item) => column >= item.start && column <= item.end)
    if (hit) return hit
  }
  return matches[0] ?? null
}

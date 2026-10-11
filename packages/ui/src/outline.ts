export interface OutlineItem {
  text: string
  level: number
  offset: number
  line: number
}

const FENCE_RE = /^\s*(?:```|~~~)/
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/

export function extractOutline(markdown: string): OutlineItem[] {
  const items: OutlineItem[] = []
  const lines = markdown.split(/\r?\n/)
  let offset = 0
  let inFence = false
  let inFrontmatter = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (i === 0 && line === '---') {
      inFrontmatter = true
      offset += line.length + 1
      continue
    }
    if (inFrontmatter) {
      if (line === '---' || line === '...') inFrontmatter = false
      offset += line.length + 1
      continue
    }
    if (FENCE_RE.test(line)) {
      inFence = !inFence
    } else if (!inFence) {
      const match = HEADING_RE.exec(line)
      if (match) {
        items.push({
          text: (match[2] ?? '').trim(),
          level: (match[1] ?? '#').length,
          offset,
          line: i + 1,
        })
      }
    }
    offset += line.length + 1
  }
  return items
}

/**
 * 目录显示的标题层数. `maxLevel` of 0 (or a non-positive value) means every level.
 *
 * Filtering runs *after* extraction, so the surviving items keep their real
 * levels: an h3 under a filtered-out h2 is still an h3 and still indents like
 * one, rather than being silently renumbered into its parent's place.
 */
export function filterOutlineLevel(items: OutlineItem[], maxLevel: number): OutlineItem[] {
  if (maxLevel <= 0) return items
  return items.filter((item) => item.level <= maxLevel)
}

export function countStats(markdown: string): { words: number; chars: number; lines: number } {
  const chars = markdown.length
  const lines = markdown === '' ? 1 : markdown.split('\n').length
  const cjkRe = /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]/g
  const cjkCount = markdown.match(cjkRe)?.length ?? 0
  const words = cjkCount + (markdown.replace(cjkRe, ' ').match(/\S+/g)?.length ?? 0)
  return { words, chars, lines }
}

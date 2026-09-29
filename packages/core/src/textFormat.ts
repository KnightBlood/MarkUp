/**
 * Pure markdown transforms behind the editor's right-click menu.
 *
 * Every helper returns a {@link TextEdit} — *what to replace* (a range) rather
 * than a whole new document. The shell replays it through the adapter's native
 * `insertMarkdown()`, so the change lands as a single normal edit in all three
 * views (实时预览 / 分屏 / 源码). Nothing here touches the DOM or a view
 * adapter, which is exactly why one implementation covers all of them.
 */

export interface TextRange {
  from: number
  to: number
}

export interface TextEdit {
  /** Range in the current markdown to replace. */
  range: TextRange
  /** Replacement text. */
  text: string
  /** Caret offset inside `text` (default: end of `text`). */
  caret?: number
  /** Post-edit selection inside `text`; omit for a collapsed caret. */
  select?: TextRange
}

export type InlineFormatId = 'bold' | 'italic' | 'code' | 'strike'

export type BlockFormatId =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'quote'
  | 'plain'
  | 'codeBlock'
  | 'bullet'
  | 'ordered'
  | 'task'

const INLINE_MARKERS: Record<InlineFormatId, string> = {
  bold: '**',
  italic: '*',
  code: '`',
  strike: '~~',
}

const clamp = (n: number, min: number, max: number): number =>
  Math.min(Math.max(n, min), max)

function longestBacktickRun(text: string): number {
  let best = 0
  let run = 0
  for (const char of text) {
    if (char === '`') {
      run += 1
      if (run > best) best = run
    } else {
      run = 0
    }
  }
  return best
}

/** Longest backtick run + 1 — the shortest fence that can wrap `text`. */
const codeFence = (text: string): string => '`'.repeat(longestBacktickRun(text) + 1)

const unpadCode = (inner: string): string =>
  inner.startsWith(' ') && inner.endsWith(' ') && inner.trim().length > 0
    ? inner.slice(1, -1)
    : inner

/**
 * Is `text` already wrapped in this format (so the click should unwrap)?
 * `**bold**` never counts as italic — toggling italic there must yield
 * `***bold+italic***` instead of silently stripping the bold.
 */
function isWrapped(text: string, fence: string, id: InlineFormatId): boolean {
  if (!fence || text.length < fence.length * 2) return false
  if (id === 'code') {
    const match = /^(`+)([\s\S]*)\1$/.exec(text)
    if (!match) return false
    const inner = unpadCode(match[2] ?? '')
    return longestBacktickRun(inner) < (match[1] ?? '').length
  }
  if (!text.startsWith(fence) || !text.endsWith(fence)) return false
  if (id === 'italic' && text.startsWith('**') && text.endsWith('**')) return false
  return true
}

/**
 * Toggle a line format around the selection.
 *
 * With no selection a placeholder is wrapped and selected instead of an empty
 * marker pair: `****` (and `~~~~`) is a valid thematic break in markdown, so an
 * empty pair re-parses as a horizontal rule in the wysiwyg view. Selecting the
 * placeholder means the next keystroke replaces it, which is the same
 * "start typing inside the marks" flow Typora gives you.
 */
export function inlineFormatEdit(
  markdown: string,
  range: TextRange,
  id: InlineFormatId,
  placeholder = '',
): TextEdit {
  const from = clamp(range.from, 0, markdown.length)
  const to = clamp(range.to, from, markdown.length)
  const bounds: TextRange = { from, to }
  const marker = INLINE_MARKERS[id]
  const text = markdown.slice(from, to)

  if (!text) {
    const seed = placeholder
    const seeded = marker + seed + marker
    return {
      range: bounds,
      text: seeded,
      caret: marker.length,
      select: { from: marker.length, to: marker.length + seed.length },
    }
  }

  const fence = id === 'code' ? codeFence(text) : marker
  if (isWrapped(text, fence, id)) {
    const inner =
      id === 'code'
        ? unpadCode(text.slice(fence.length, -fence.length))
        : text.slice(fence.length, -fence.length)
    return { range: bounds, text: inner, select: { from: 0, to: inner.length } }
  }

  const body =
    id === 'code' && (text.startsWith('`') || text.endsWith('`')) ? ` ${text} ` : text
  const wrapped = fence + body + fence
  return {
    range: bounds,
    text: wrapped,
    select: { from: fence.length, to: fence.length + text.length },
  }
}

const URL_LIKE = /^https?:\/\/\S+$/i
const EXISTING_LINK = /^\[([^\]]*)\]\(([^)]*)\)$/

/**
 * Build `[label](url)`. Re-editing an existing `[label](old)` selection keeps
 * its label; a bare URL selection becomes its own label; an empty selection
 * inserts `[](url)` with the caret inside the brackets (type the label next).
 */
export function linkEdit(markdown: string, range: TextRange, url: string): TextEdit {
  const from = clamp(range.from, 0, markdown.length)
  const to = clamp(range.to, from, markdown.length)
  const bounds: TextRange = { from, to }
  const raw = markdown.slice(from, to)
  const trimmed = raw.trim()

  const existing = EXISTING_LINK.exec(trimmed)
  if (existing) {
    const next = `[${existing[1] ?? ''}](${url})`
    return { range: bounds, text: next, caret: next.length }
  }

  if (!trimmed) {
    return { range: bounds, text: `[](${url})`, caret: 1 }
  }

  const label = URL_LIKE.test(trimmed) ? trimmed : raw
  const next = `[${label}](${url})`
  return { range: bounds, text: next, caret: next.length }
}

interface LineParts {
  /** Leading indentation kept verbatim. */
  indent: string
  heading: number
  quote: boolean
  bullet: string
  task: boolean
  ordered: string
  rest: string
}

function parseLine(line: string): LineParts {
  const indent = /^[ \t]*/.exec(line)?.[0] ?? ''
  let rest = line.slice(indent.length)
  let heading = 0
  let quote = false
  let bullet = ''
  let task = false
  let ordered = ''

  // Order matters: a quote can hold a list, a list can hold a task.
  while (rest.startsWith('>')) {
    quote = true
    rest = rest.replace(/^>\s?/, '')
  }
  const headingMatch = /^(#{1,6})\s+/.exec(rest)
  if (headingMatch) {
    heading = (headingMatch[1] ?? '').length
    rest = rest.slice(headingMatch[0].length)
  }
  const orderedMatch = /^(\d+[.)])\s+/.exec(rest)
  if (orderedMatch) {
    ordered = orderedMatch[1] ?? ''
    rest = rest.slice(orderedMatch[0].length)
  }
  const bulletMatch = /^([-*+])\s+/.exec(rest)
  if (bulletMatch) {
    bullet = bulletMatch[1] ?? '-'
    rest = rest.slice(bulletMatch[0].length)
  }
  const taskMatch = /^\[([ xX])\]\s+/.exec(rest)
  if (taskMatch) {
    task = true
    rest = rest.slice(taskMatch[0].length)
  }

  return { indent, heading, quote, bullet, task, ordered, rest }
}

/** Everything except the quote marker — used to turn a format "off". */
const withoutMarks = (parts: LineParts): string =>
  parts.indent + (parts.quote ? '> ' : '') + parts.rest

/** Rebuild a line with `body` in place of `parts.rest`, marks untouched. */
const withRest = (parts: LineParts, body: string): string =>
  parts.indent + (parts.quote ? '> ' : '') + body

function renderLine(parts: LineParts, id: BlockFormatId): string | null {
  // Blank / marker-only lines are structural — never rewrite them.
  if (!parts.rest.trim()) return parts.rest ? parts.indent + parts.rest : null

  const level = id === 'h1' || id === 'h2' || id === 'h3' || id === 'h4' || id === 'h5' || id === 'h6'
    ? Number(id.slice(1))
    : 0

  const isOn = (): boolean => {
    if (level > 0) return parts.heading === level
    switch (id) {
      case 'quote':
        return parts.quote
      case 'bullet':
        return !!parts.bullet && !parts.ordered
      case 'ordered':
        return !!parts.ordered
      case 'task':
        return parts.task
      case 'plain':
        return (
          parts.heading === 0 &&
          !parts.quote &&
          !parts.bullet &&
          !parts.ordered &&
          !parts.task
        )
      default:
        return false
    }
  }

  if (isOn()) {
    // Turning a format off: quote/plain drop their marker outright; a task
    // keeps the bullet (`- [ ] x` → `- x`); heading/lists drop theirs but keep
    // an enclosing quote, so nested marks survive.
    if (id === 'quote' || id === 'plain') return parts.indent + parts.rest
    if (id === 'task' && parts.bullet) return withRest(parts, `${parts.bullet} ${parts.rest}`)
    return withoutMarks(parts)
  }

  if (level > 0) return withRest(parts, `${'#'.repeat(level)} ${parts.rest}`)
  switch (id) {
    case 'quote':
      return withRest(parts, `> ${parts.rest}`)
    case 'plain':
      return parts.indent + parts.rest
    case 'bullet':
      return withRest(parts, `- ${parts.rest}`)
    case 'ordered':
      return withRest(parts, `1. ${parts.rest}`)
    case 'task':
      return withRest(parts, `- [ ] ${parts.rest}`)
    default:
      return null
  }
}

interface LineSpan {
  start: number
  end: number
  text: string
}

function lineSpans(markdown: string): LineSpan[] {
  const spans: LineSpan[] = []
  let start = 0
  while (start <= markdown.length) {
    const nl = markdown.indexOf('\n', start)
    const end = nl === -1 ? markdown.length : nl
    spans.push({ start, end, text: markdown.slice(start, end) })
    if (nl === -1) break
    start = nl + 1
  }
  return spans
}

const FENCE_LINE = /^\s*```[^\s`]*\s*$/

/**
 * Apply a paragraph-level format to every line the selection touches.
 * Returns `null` when nothing changes, so the caller can skip the edit and
 * avoid marking the document dirty for a no-op click.
 */
export function blockFormatEdit(
  markdown: string,
  range: TextRange,
  id: BlockFormatId,
): TextEdit | null {
  const from = clamp(range.from, 0, markdown.length)
  const to = clamp(range.to, from, markdown.length)
  const spans = lineSpans(markdown)
  if (spans.length === 0) return null

  const caret = from
  let first = spans.findIndex((span) => caret <= span.end)
  if (first < 0) first = spans.length - 1
  let last = spans.findIndex((span) => to <= span.end)
  if (last < 0) last = spans.length - 1
  if (last < first) last = first
  // A selection ending exactly at a line break means "up to that break" —
  // don't drag the next, untouched line into the edit.
  if (last > first && markdown[to - 1] === '\n') last -= 1

  const targets = spans.slice(first, last + 1)
  const rangeStart = targets[0]!.start
  const rangeEnd = targets[targets.length - 1]!.end

  if (id === 'codeBlock') {
    return codeBlockEdit(spans, first, last, caret)
  }

  const out: string[] = []
  let caretOffset: number | null = null
  let produced = 0
  for (const span of targets) {
    const parts = parseLine(span.text)
    const next = renderLine(parts, id)
    if (next === null) {
      // Blank / marker-only line: keep it verbatim so the join below doesn't
      // swallow it.
      if (caretOffset === null && caret >= span.start && caret <= span.end) {
        caretOffset = produced + (caret - span.start)
      }
      out.push(span.text)
      produced += span.text.length + 1
      continue
    }
    if (caretOffset === null && caret >= span.start && caret <= span.end) {
      // Only the prefix changes — the trailing rest moves verbatim, so the
      // caret shifts by exactly the prefix delta.
      const offsetInOld = caret - span.start
      const delta = next.length - span.text.length
      caretOffset = produced + clamp(offsetInOld + delta, 0, next.length)
    }
    out.push(next)
    produced += next.length + 1
  }

  const text = out.join('\n')
  if (text === markdown.slice(rangeStart, rangeEnd)) return null
  if (caretOffset === null) caretOffset = text.length
  return { range: { from: rangeStart, to: rangeEnd }, text, caret: caretOffset }
}

/**
 * Wrap the target lines in a ``` fence — or, when they sit inside an existing
 * fenced block, drop that block's fence lines entirely (so the toggle works
 * from any line of the block, not just its edges).
 */
function codeBlockEdit(
  spans: LineSpan[],
  first: number,
  last: number,
  caret: number,
): TextEdit | null {
  let openIdx = -1
  for (let i = first - 1; i >= 0; i -= 1) {
    if (FENCE_LINE.test(spans[i]!.text)) {
      openIdx = i
      break
    }
  }
  let closeIdx = -1
  for (let i = last + 1; i < spans.length; i += 1) {
    if (FENCE_LINE.test(spans[i]!.text)) {
      closeIdx = i
      break
    }
  }

  if (openIdx >= 0 && closeIdx > openIdx) {
    const text = spans
      .slice(openIdx + 1, closeIdx)
      .map((span) => span.text)
      .join('\n')
    if (!text.trim()) return null
    return {
      range: { from: spans[openIdx]!.start, to: spans[closeIdx]!.end },
      text,
      caret: clamp(caret - (spans[openIdx]!.end + 1), 0, text.length),
    }
  }

  const targets = spans.slice(first, last + 1)
  if (targets.every((span) => !span.text.trim())) return null

  const rangeStart = targets[0]!.start
  const rangeEnd = targets[targets.length - 1]!.end
  const body = targets.map((span) => span.text).join('\n')
  const text = '```\n' + body + '\n```'
  return {
    range: { from: rangeStart, to: rangeEnd },
    text,
    caret: clamp(caret - rangeStart + '```\n'.length, 0, text.length),
  }
}

/** Lines a selection touches, exported for callers that need the bounds. */
export function selectionLineRange(
  markdown: string,
  range: TextRange,
): TextRange | null {
  const edit = blockFormatEdit(markdown, range, 'plain')
  if (edit) return edit.range
  const spans = lineSpans(markdown)
  if (spans.length === 0) return null
  const from = clamp(range.from, 0, markdown.length)
  const to = clamp(range.to, from, markdown.length)
  const first = spans.findIndex((span) => from <= span.end)
  const lastIdx = (() => {
    const idx = spans.findIndex((span) => to <= span.end)
    return idx < 0 ? spans.length - 1 : idx
  })()
  const start = spans[first < 0 ? spans.length - 1 : first]?.start ?? 0
  const end = spans[lastIdx]?.end ?? markdown.length
  return { from: start, to: end }
}

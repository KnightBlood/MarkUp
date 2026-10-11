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

export type InlineFormatId =
  | 'bold'
  | 'italic'
  | 'code'
  | 'strike'
  | 'underline'
  | 'highlight'
  | 'sup'
  | 'sub'

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

/**
 * Open/close pairs rather than a single marker: `<u>`/`</u>` differ, and the
 * split keeps the table honest for the symmetric forms too.
 *
 * `sub`/`sup` borrow the single `~`/`^` forms Typora uses. The renderer is
 * built with `remark-gfm({ singleTilde: false })`, so `~~x~~` remains the only
 * strikethrough and the lone tilde is free — see `pipeline.ts`.
 */
const INLINE_MARKERS: Record<InlineFormatId, { open: string; close: string }> = {
  bold: { open: '**', close: '**' },
  italic: { open: '*', close: '*' },
  code: { open: '`', close: '`' },
  strike: { open: '~~', close: '~~' },
  underline: { open: '<u>', close: '</u>' },
  highlight: { open: '==', close: '==' },
  sup: { open: '^', close: '^' },
  sub: { open: '~', close: '~' },
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
 * `***bold+italic***` instead of silently stripping the bold. The same guard
 * keeps `==x==` from being read as a highlight when it is really two `=` runs.
 */
function isWrapped(text: string, fence: string, id: InlineFormatId): boolean {
  const { open, close } = INLINE_MARKERS[id]
  if (!fence || text.length < open.length + close.length) return false
  if (id === 'code') {
    const match = /^(`+)([\s\S]*)\1$/.exec(text)
    if (!match) return false
    const inner = unpadCode(match[2] ?? '')
    return longestBacktickRun(inner) < (match[1] ?? '').length
  }
  if (!text.startsWith(open) || !text.endsWith(close)) return false
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
  const { open, close } = INLINE_MARKERS[id]
  const text = markdown.slice(from, to)

  if (!text) {
    const seed = placeholder
    const seeded = open + seed + close
    return {
      range: bounds,
      text: seeded,
      caret: open.length,
      select: { from: open.length, to: open.length + seed.length },
    }
  }

  const fence = id === 'code' ? codeFence(text) : open
  if (isWrapped(text, fence, id)) {
    const inner =
      id === 'code'
        ? unpadCode(text.slice(fence.length, -fence.length))
        : text.slice(open.length, -close.length)
    return { range: bounds, text: inner, select: { from: 0, to: inner.length } }
  }

  const body =
    id === 'code' && (text.startsWith('`') || text.endsWith('`')) ? ` ${text} ` : text
  // `code` computes a fence long enough to survive any backtick run inside, so
  // both ends need *that* length — using the single-char close here would emit
  // ``a ` b` instead of ```a ` b``` and break the fence on re-parse.
  const wrapped = id === 'code' ? fence + body + fence : open + body + close
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

interface Selection {
  spans: LineSpan[]
  first: number
  last: number
  caret: number
}

/** Resolve a markdown range to the line indices it touches. */
function selectLines(markdown: string, range: TextRange): Selection | null {
  const from = clamp(range.from, 0, markdown.length)
  const to = clamp(range.to, from, markdown.length)
  const spans = lineSpans(markdown)
  if (spans.length === 0) return null
  let first = spans.findIndex((span) => from <= span.end)
  if (first < 0) first = spans.length - 1
  let last = spans.findIndex((span) => to <= span.end)
  if (last < 0) last = spans.length - 1
  if (last < first) last = first
  // A selection ending exactly at a line break means "up to that break" —
  // don't drag the next, untouched line into the edit.
  if (last > first && markdown[to - 1] === '\n') last -= 1
  return { spans, first, last, caret: from }
}

/**
 * Rewrite lines `first..last` through `map`, building the edit and carrying the
 * caret. `map` returning null (or the original text) leaves a line verbatim —
 * blank and marker-only lines are structural, so rewriting them swallows the
 * join. Returns null when nothing changed, so a no-op keypress never dirties
 * the document.
 */
function rewriteLines(
  sel: Selection,
  first: number,
  last: number,
  map: (parts: LineParts, line: string, index: number) => string | null,
): TextEdit | null {
  const targets = sel.spans.slice(first, last + 1)
  const rangeStart = targets[0]!.start
  const rangeEnd = targets[targets.length - 1]!.end
  const out: string[] = []
  let caretOffset: number | null = null
  let produced = 0
  for (let i = 0; i < targets.length; i++) {
    const span = targets[i]!
    const next = map(parseLine(span.text), span.text, first + i) ?? span.text
    if (caretOffset === null && sel.caret >= span.start && sel.caret <= span.end) {
      // Only the prefix usually changes — the trailing rest moves verbatim, so
      // the caret shifts by exactly the length delta.
      const offsetInOld = sel.caret - span.start
      const delta = next.length - span.text.length
      caretOffset = produced + clamp(offsetInOld + delta, 0, next.length)
    }
    out.push(next)
    produced += next.length + 1
  }
  const text = out.join('\n')
  if (text === sel.spans.slice(first, last + 1).map((s) => s.text).join('\n')) return null
  return { range: { from: rangeStart, to: rangeEnd }, text, caret: caretOffset ?? text.length }
}

/**
 * Apply a paragraph-level format to every line the selection touches.
 * Returns `null` when nothing changes, so the caller can skip the edit and
 * avoid marking the document dirty for a no-op click.
 */
export function blockFormatEdit(
  markdown: string,
  range: TextRange,
  id: BlockFormatId,
  /** 默认的代码块语言, used only when `id === 'codeBlock'`. */
  codeLanguage = '',
): TextEdit | null {
  const sel = selectLines(markdown, range)
  if (!sel) return null

  if (id === 'codeBlock') {
    return codeBlockEdit(sel.spans, sel.first, sel.last, sel.caret, codeLanguage)
  }

  return rewriteLines(sel, sel.first, sel.last, (parts, line) => renderLine(parts, id) ?? line)
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
  language = '',
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
  // 默认的代码块语言 — the fence's info string. Trimmed to a single token: a
  // space would end the info string and the rest would become fence metadata.
  const info = language.trim().split(/\s+/)[0] ?? ''
  const fence = `\`\`\`${info}\n`
  const text = fence + body + '\n```'
  return {
    range: { from: rangeStart, to: rangeEnd },
    text,
    caret: clamp(caret - rangeStart + fence.length, 0, text.length),
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

// ── 段落：标题级别 / 列表缩进 / 任务状态 ────────────────────────────────────

/**
 * Typora「提升 / 降低标题级别」.
 *
 * The names read backwards until you notice that a "higher heading level" means
 * *more* prominent: 提升 promotes (`##` → `#`) and 降低 demotes (`#` → `##`).
 * That matches the direction of Typora's own Ctrl+= / Ctrl+- bindings.
 */
export type HeadingStep = 'up' | 'down'

/** Target level for `step`. 0 means paragraph. */
export function stepHeadingLevel(level: number, step: HeadingStep): number {
  // 提升: a paragraph becomes h1 and h1 stays put; otherwise one level up.
  if (step === 'up') return level <= 1 ? 1 : level - 1
  // 降低: a paragraph has nowhere to go; h6 falls back out of the heading run.
  return level === 0 ? 0 : level >= 6 ? 0 : level + 1
}

/** Heading level (0 = not a heading) of the first line the range touches. */
export function headingLevelAt(markdown: string, range: TextRange): number {
  const sel = selectLines(markdown, range)
  if (!sel) return 0
  return parseLine(sel.spans[sel.first]!.text).heading
}

export function headingLevelEdit(
  markdown: string,
  range: TextRange,
  step: HeadingStep,
): TextEdit | null {
  const sel = selectLines(markdown, range)
  if (!sel) return null
  return rewriteLines(sel, sel.first, sel.last, (parts) => {
    // A blank or marker-only line is structural — never grow a `#` onto it.
    if (!parts.rest.trim()) return null
    const level = stepHeadingLevel(parts.heading, step)
    return withRest(parts, level > 0 ? `${'#'.repeat(level)} ${parts.rest}` : parts.rest)
  })
}

export type ListIndentStep = 'in' | 'out'

/** 默认缩进的允许范围 — beyond this a stray config value stops being an indent. */
const MIN_INDENT = 1
const MAX_INDENT = 8

/** Clamp 默认缩进 to something that is still an indent. */
export function clampIndentSize(size: unknown): number {
  if (typeof size !== 'number' || !Number.isFinite(size)) return 2
  return Math.min(Math.max(Math.round(size), MIN_INDENT), MAX_INDENT)
}

/**
 * Split off any leading `>` run so an indent lands *inside* a blockquote
 * instead of turning the quote itself into an indented block.
 */
function splitQuotePrefix(line: string): { prefix: string; rest: string } {
  const prefix = /^(?:[ \t]*>[ \t]?)*/.exec(line)?.[0] ?? ''
  return { prefix, rest: line.slice(prefix.length) }
}

export function listIndentEdit(
  markdown: string,
  range: TextRange,
  step: ListIndentStep,
  /** 默认缩进 — spaces per level. Defaults to 2, clamped to 1–8. */
  indentSize = 2,
): TextEdit | null {
  const size = clampIndentSize(indentSize)
  const indentRe = new RegExp(`^[ \\t]{1,${size}}`)
  const sel = selectLines(markdown, range)
  if (!sel) return null
  return rewriteLines(sel, sel.first, sel.last, (parts, line) => {
    // 列表缩进 only means something on a list item.
    if (!parts.bullet && !parts.ordered) return null
    const { prefix, rest } = splitQuotePrefix(line)
    if (step === 'in') return `${prefix}${' '.repeat(size)}${rest}`
    const indent = indentRe.exec(rest)?.[0]
    if (indent) return prefix + rest.slice(indent.length)
    // Nothing left to outdent, so the item leaves the list — Typora turns it
    // into a paragraph here rather than quietly doing nothing.
    return withoutMarks(parts)
  })
}

/** Typora 任务状态 ▸ 标记为已完成 / 未完成. */
export type TaskStatus = 'done' | 'todo'

const isTaskLine = (line: string): boolean => parseLine(line).task

export function taskStatusEdit(
  markdown: string,
  range: TextRange,
  status: TaskStatus,
): TextEdit | null {
  const sel = selectLines(markdown, range)
  if (!sel) return null
  // Typora marks the whole list, not just the caret's item — so widen to the
  // contiguous run of task lines. Only when the selection actually starts on
  // one: otherwise the walk would grab an unrelated neighbouring list.
  if (!isTaskLine(sel.spans[sel.first]!.text)) return null
  let first = sel.first
  while (first > 0 && isTaskLine(sel.spans[first - 1]!.text)) first -= 1
  let last = sel.last
  while (last + 1 < sel.spans.length && isTaskLine(sel.spans[last + 1]!.text)) last += 1
  const box = status === 'done' ? 'x' : ' '
  return rewriteLines(sel, first, last, (parts) => {
    if (!parts.task) return null
    const marker = parts.ordered || parts.bullet || '-'
    const quote = parts.quote ? '> ' : ''
    return `${parts.indent}${quote}${marker} [${box}] ${parts.rest}`
  })
}

/**
 * The literal 内容目录 marker. `pipeline.ts` expands a paragraph holding
 * exactly this string into a nested link list built from the document's
 * headings, which is why the marker lives here rather than in the shell.
 */
export const TOC_MARKER = '[TOC]'

// ── 选择与跳转 (Typora 编辑 ▸ 跳转到 / 选中) ──────────────────────────────

/** What 选中当前… picks up around the caret. */
export type SelectScope = 'line' | 'word' | 'sentence' | 'block'

/** A word character: letters, digits and underscore, plus anything non-ASCII
 * (CJK has no spaces, so treating every non-ASCII rune as a word char is what
 * makes double-click-selects-a-word behave in Chinese text). */
const isWordChar = (ch: string): boolean => /[\p{L}\p{N}_]/u.test(ch)

/** Sentence terminators, both ASCII and the full-width forms used in CJK. */
const SENTENCE_END = /[.。!！?？;；]/

/**
 * The range of `scope` around `offset`, or null when there is nothing sensible
 * to select (an empty document).
 *
 * Selection is expressed as markdown offsets so every view can apply it through
 * its own `setSelectionRange` — the editor's offsets and the markdown's agree,
 * which is the whole reason these live here rather than in a view.
 */
export function selectScope(
  markdown: string,
  offset: number,
  scope: SelectScope,
): TextRange | null {
  if (markdown.length === 0) return null
  const at = clamp(offset, 0, markdown.length)

  if (scope === 'line') return lineRangeAt(markdown, at)

  if (scope === 'word') {
    // Never null for a non-empty document: a "select word" that does nothing
    // reads as broken. Prefer the word the caret is in or has just left, then
    // the next one along.
    const wordAt = (index: number): boolean =>
      index >= 0 && index < markdown.length && isWordChar(markdown[index]!)
    let anchor = -1
    if (wordAt(at)) anchor = at
    else if (wordAt(at - 1)) anchor = at - 1
    else {
      for (let i = at - 1; i >= 0 && anchor < 0; i -= 1) if (wordAt(i)) anchor = i
      for (let i = at; i < markdown.length && anchor < 0; i += 1) if (wordAt(i)) anchor = i
    }
    if (anchor < 0) return null
    let from = anchor
    while (from > 0 && isWordChar(markdown[from - 1]!)) from -= 1
    let to = anchor + 1
    while (to < markdown.length && isWordChar(markdown[to]!)) to += 1
    return { from, to }
  }

  if (scope === 'sentence') {
    // Clamp to the paragraph: a "sentence" running across a blank line is really
    // swallowing the next one, and this reuses the block logic instead of
    // duplicating the blank-line rule.
    const block = selectScope(markdown, at, 'block')
    if (!block) return null
    let from = at
    while (from > block.from && !SENTENCE_END.test(markdown[from - 1] ?? '')) from -= 1
    let to = at
    while (to < block.to && !SENTENCE_END.test(markdown[to] ?? '')) to += 1
    // The terminator belongs to the sentence it ends.
    if (to < block.to) to += 1
    // Trim the whitespace a terminator leaves behind.
    while (from < to && /\s/.test(markdown[from] ?? '')) from += 1
    while (to > from && /\s/.test(markdown[to - 1] ?? '')) to -= 1
    return to > from ? { from, to } : null
  }

  // block: the paragraph — the run of non-blank lines around the caret.
  const spans = lineSpans(markdown)
  let index = spans.findIndex((span) => at <= span.end)
  if (index < 0) index = spans.length - 1
  const blank = (line: string): boolean => line.trim().length === 0
  if (blank(spans[index]!.text)) {
    // A caret on a blank line selects just that line, so the command still does
    // something visible instead of silently picking a neighbouring paragraph.
    return { from: spans[index]!.start, to: spans[index]!.end }
  }
  let first = index
  while (first > 0 && !blank(spans[first - 1]!.text)) first -= 1
  let last = index
  while (last + 1 < spans.length && !blank(spans[last + 1]!.text)) last += 1
  return { from: spans[first]!.start, to: spans[last]!.end }
}

/** The whole line containing `offset`, without its trailing newline. */
export function lineRangeAt(markdown: string, offset: number): TextRange | null {
  if (markdown.length === 0) return null
  const at = clamp(offset, 0, markdown.length)
  const spans = lineSpans(markdown)
  const span = spans.find((candidate) => at <= candidate.end)
  const line = span ?? spans[spans.length - 1]!
  return { from: line.start, to: line.end }
}

/** 跳转到文首 / 文末. */
export function documentEdge(markdown: string, edge: 'start' | 'end'): TextRange {
  return edge === 'start' ? { from: 0, to: 0 } : { from: markdown.length, to: markdown.length }
}

/** 跳转到行首 / 行尾. */
export function lineEdge(markdown: string, offset: number, edge: 'start' | 'end'): TextRange {
  const line = lineRangeAt(markdown, offset)
  if (!line) return { from: 0, to: 0 }
  return edge === 'start' ? { from: line.from, to: line.from } : { from: line.to, to: line.to }
}

// ── 链接引用 ────────────────────────────────────────────────────────────────

/**
 * The label a reference link uses for `text`.
 *
 * Lowercased and slugified because a reference label is an *identifier*: two
 * links to the same place should produce the same label, and `Hello World` and
 * `hello world` have to agree. Letters and digits survive, including CJK.
 */
export function referenceLabel(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'ref'
}

/** The inline half of a reference link: `[text][label]`. */
export function referenceLinkInline(text: string, label: string): string {
  // The visible text keeps its own brackets out of the way — markdown would
  // otherwise end the link early.
  const safe = text.trim().replace(/[[\]]/g, '')
  return `[${safe}][${label}]`
}

/** The definition half: `[label]: url`. */
export function referenceLinkDefinition(label: string, url: string): string {
  // A destination with spaces has to be wrapped, or markdown ends it at the
  // first space.
  const destination = /\s/.test(url) ? `<${url}>` : url
  return `[${label}]: ${destination}`
}

/**
 * True when a definition for `label` already exists. Reference labels are
 * case-insensitive in CommonMark, so this compares that way too — otherwise a
 * second definition would be appended for what is really the same label.
 */
export function hasReferenceDefinition(markdown: string, label: string): boolean {
  const wanted = label.toLowerCase()
  for (const line of markdown.split('\n')) {
    const match = /^ {0,3}\[([^\]]+)\]:\s*\S/.exec(line)
    if (match && match[1]!.trim().toLowerCase() === wanted) return true
  }
  return false
}

/**
 * 删除块 — remove the paragraph (or the whole block) the range sits in.
 *
 * One adjacent separator goes with it. Deleting only the text would leave the
 * blank line that separated it from its neighbour, so repeatedly deleting blocks
 * would grow a gap instead of shrinking the document.
 */
export function deleteBlockEdit(markdown: string, range: TextRange): TextEdit | null {
  const block = selectScope(markdown, range.from, 'block')
  if (!block) return null
  // The block scope never includes its trailing newline; take one separator.
  const afterEnd = block.to
  const trailing = markdown.slice(afterEnd).match(/^\n\n/)
  if (trailing) {
    return { range: { from: block.from, to: afterEnd + trailing[0].length }, text: '', caret: block.from }
  }
  const leading = markdown.slice(0, block.from).match(/\n\n$/)
  if (leading) {
    return { range: { from: block.from - leading[0].length, to: block.to }, text: '', caret: block.from - leading[0].length }
  }
  // The only block in the document: it goes, and a blank paragraph remains so the
  // caret has somewhere to be.
  return { range: { from: block.from, to: block.to }, text: '', caret: block.from }
}

/**
 * 在上方 / 下方插入段落 — open a new empty paragraph next to the one at `range`.
 *
 * Markdown has no empty paragraph, so "a new paragraph" means one more blank
 * line; the caret lands on it so typing goes straight into the new block.
 */
export function insertParagraphEdit(
  markdown: string,
  range: TextRange,
  where: 'before' | 'after',
): TextEdit | null {
  const block = selectScope(markdown, range.from, 'block')
  if (!block) return null
  if (where === 'before') {
    if (block.from === 0) {
      // Nothing above, so both newlines are the new paragraph's own separator.
      return { range: { from: 0, to: 0 }, text: '\n\n', caret: 1 }
    }
    // A block always has a separator above it; one more newline opens the empty
    // paragraph between them.
    return { range: { from: block.from, to: block.from }, text: '\n', caret: block.from + 1 }
  }
  const at = block.to
  // A block is followed by either a blank line or the end of the document, so
  // only the latter still needs the separator written.
  const text = at >= markdown.length ? '\n\n' : '\n'
  return { range: { from: at, to: at }, text, caret: at + 1 }
}

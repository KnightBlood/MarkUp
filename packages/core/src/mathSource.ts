/**
 * 复制公式 — find a formula in the markdown source, and render one to MathML.
 *
 * A scanner rather than a regex, because `$` is context-sensitive in markdown:
 * an escaped `\$`, a `$$` inside a code fence, and a lone `$` used as currency
 * all have to be ruled out. Getting that wrong means copying the wrong thing —
 * or copying prose that merely looks like math.
 */

import katex from 'katex'

export interface MathSpan {
  latex: string
  /** Range of the whole `$…$` / `$$…$$`, delimiters included. */
  from: number
  to: number
  block: boolean
}

/** A line that opens or closes a ``` / ~~~ fence. */
const FENCE = /^(`{3,}|~{3,})/

/**
 * Find the closing delimiter at or after `from`, or -1.
 *
 * Inline math follows remark-math's rules: the closing `$` may not be preceded
 * by whitespace, and `$$` is a different construct rather than two of these.
 */
function findClose(markdown: string, from: number, block: boolean): number {
  let index = from
  while (index < markdown.length) {
    if (markdown[index] === '\\') {
      index += 2
      continue
    }
    if (markdown[index] === '$') {
      if (block) {
        if (markdown[index + 1] === '$') return index
      } else if (markdown[index + 1] !== '$' && !/\s/.test(markdown[index - 1] ?? '')) {
        return index
      }
    }
    index += 1
  }
  return -1
}

/** Every formula in the document, in order, skipping fences and inline code. */
export function collectMathSpans(markdown: string): MathSpan[] {
  const spans: MathSpan[] = []
  let index = 0
  let fenced = false
  /** Length of the backtick run that opened the current code span, or 0. */
  let codeRun = 0
  let atLineStart = true

  while (index < markdown.length) {
    const char = markdown[index]!
    // An escaped character is never a delimiter.
    if (char === '\\') {
      index += 2
      atLineStart = false
      continue
    }
    if (atLineStart && (char === '`' || char === '~')) {
      const fence = FENCE.exec(markdown.slice(index))
      if (fence) {
        fenced = !fenced
        index += fence[0].length
        atLineStart = false
        continue
      }
    }
    if (!fenced && char === '`') {
      let run = 0
      while (markdown[index + run] === '`') run += 1
      if (codeRun === 0) codeRun = run
      else if (run === codeRun) codeRun = 0
      index += run
      atLineStart = false
      continue
    }
    if (!fenced && codeRun === 0 && char === '$') {
      const block = markdown[index + 1] === '$'
      const open = block ? 2 : 1
      const after = markdown[index + open]
      // Inline math may not start with a space (`$ x$` is prose); display math
      // routinely does — `$$\n…\n$$` is the standard form — so the rule is
      // inline-only.
      if (block || (after !== undefined && !/\s/.test(after))) {
        const close = findClose(markdown, index + open, block)
        if (close >= 0) {
          spans.push({
            latex: markdown.slice(index + open, close),
            from: index,
            to: close + open,
            block,
          })
          index = close + open
          atLineStart = false
          continue
        }
      }
    }
    atLineStart = char === '\n'
    index += 1
  }
  return spans
}

/** The formula the caret sits in or on, or null. */
export function mathSpanAt(markdown: string, offset: number): MathSpan | null {
  return collectMathSpans(markdown).find((span) => offset >= span.from && offset <= span.to) ?? null
}

/**
 * LaTeX → MathML through KaTeX's own MathML output.
 *
 * The result is what KaTeX emits for `output: 'mathml'`, which is the `<math>`
 * element wrapped in its usual `<span class="katex">` — both are valid and the
 * wrapper is harmless on a clipboard, which is why it is not stripped.
 *
 * Returns null on a formula KaTeX cannot parse, so the caller can say so rather
 * than putting a half-rendered fragment on the clipboard.
 */
export function latexToMathML(latex: string, block = false): string | null {
  try {
    return katex.renderToString(latex, {
      output: 'mathml',
      displayMode: block,
      throwOnError: true,
    })
  } catch {
    return null
  }
}

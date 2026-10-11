/**
 * Typora's subscript / superscript / highlight / underline in the 分屏 view.
 *
 * 分屏 is OverType, not the remark pipeline: it renders markdown with its own
 * line-oriented parser into HTML. `MarkdownParser.setCustomSyntax` is the hook
 * it exposes for exactly this — a function run over each already-parsed HTML
 * line — so the same three patterns from `mdSyntax.ts` are replayed on text
 * that OverType left literal.
 *
 * Three OverType-specific adjustments, all needed to keep 分屏 in step with the
 * other two views and with export:
 *
 * 1. **Single-tilde strikethrough is undone.** OverType treats `~x~` as
 *    `<del>`, but the app renders with `remark-gfm({ singleTilde: false })` so
 *    that the lone tilde is subscript. Rather than monkey-patch OverType's
 *    parser, the `<del>` it produced from single tildes is unwrapped here (the
 *    markers are identifiable by their `syntax-marker` span) and re-read as
 *    subscript.
 * 2. **Tag awareness.** Inline markup has already been turned into tags by the
 *    time this runs, so the patterns are applied only to the text between
 *    them, and never inside `<code>`.
 * 3. **`<u>` is HTML-escaped** by OverType's line escaping, so enabling
 *    underline un-escapes exactly the `u`/`ins` tags — nothing else — and lets
 *    the browser render them.
 */

import OverType from 'overtype'
import { SYNTAX_PATTERNS, type MdSyntaxOptions } from './mdSyntax'

interface OverTypeStatics {
  setCustomSyntax?: (processor: ((html: string) => string) | null) => void
  MarkdownParser?: { setCustomSyntax?: (processor: ((html: string) => string) | null) => void }
}

const statics = OverType as unknown as OverTypeStatics

let current: MdSyntaxOptions = {}
let installed = false

/**
 * OverType's single-tilde strikethrough output — identical to its double-tilde
 * form except for the marker text, which is what makes the two distinguishable.
 * The tildes are restored on unwrap so the subscript pattern can then claim
 * them; dropping the markers would leave bare text with no way back.
 */
const SINGLE_TILDE_DEL =
  /<del><span class="syntax-marker">~<\/span>([\s\S]+?)<span class="syntax-marker">~<\/span><\/del>/g

/** `<u>` / `<ins>` as OverType's line escaping leaves them. */
const ESCAPED_U = /&lt;(\/?)(u|ins)&gt;/gi

const TAG_SPLIT = /(<[^>]*>)/

const CODE_OPEN = /^<code[\s/>]/i
const CODE_CLOSE = /^<\/code\s*>/i

/** Undo single-tilde strikethrough so the tilde is free for subscript. */
function unwrapSingleTildeDel(html: string): string {
  return html.replace(SINGLE_TILDE_DEL, (_whole, inner: string) => `~${inner}~`)
}

function applyTextSyntax(text: string, options: MdSyntaxOptions): string {
  if (options.underline === false) return text
  return text.replace(ESCAPED_U, (_whole, slash: string, tag: string) => `<${slash}${tag}>`)
}

/**
 * Wrap the three marker pairs outside of tags. Runs leftmost-first like the
 * mdast walker so `==a~b~c==` opens the highlight before the subscript inside.
 */
function wrapMarkers(text: string, options: MdSyntaxOptions): string {
  let best: { match: RegExpExecArray; type: string } | null = null
  for (const { type, regex } of SYNTAX_PATTERNS) {
    if (options[type as keyof MdSyntaxOptions] === false) continue
    regex.lastIndex = 0
    const match = regex.exec(text)
    if (!match || match[0].length === 0) continue
    if (!best || match.index < best.match.index) best = { match, type }
  }
  if (!best) return text

  const start = best.match.index
  const end = start + best.match[0].length
  const tag = best.type === 'highlight' ? 'mark' : best.type === 'subscript' ? 'sub' : 'sup'
  const inner = wrapMarkers(best.match[1] ?? '', options)
  return (
    wrapMarkers(text.slice(0, start), options) +
    `<${tag}>${inner}</${tag}>` +
    wrapMarkers(text.slice(end), options)
  )
}

/** Transform one already-parsed HTML line. Exported for tests. */
export function applyOvertypeSyntaxHtml(html: string, options: MdSyntaxOptions): string {
  let source = html
  if (options.subscript !== false) source = unwrapSingleTildeDel(source)

  let inCode = 0
  const out = source
    .split(TAG_SPLIT)
    .map((segment) => {
      if (!segment.startsWith('<')) {
        if (inCode > 0) return segment
        const text = applyTextSyntax(segment, options)
        return wrapMarkers(text, options)
      }
      if (CODE_OPEN.test(segment)) inCode += 1
      else if (CODE_CLOSE.test(segment)) inCode = Math.max(0, inCode - 1)
      return segment
    })
    .join('')
  return out
}

/**
 * Install the hook once. Later calls only swap the options the installed
 * processor reads, so toggling a syntax in 设置 ▸ Markdown takes effect on the
 * next render without re-installing anything.
 */
export function setOvertypeSyntax(options: MdSyntaxOptions): void {
  current = options
  if (installed) return
  installed = true
  const processor = (html: string): string => applyOvertypeSyntaxHtml(html, current)

  // Prefer the parser's static: it only stores the processor, whereas
  // `OverType.setCustomSyntax` additionally walks every live instance to
  // re-render — needless work at boot, before any editor exists.
  const parser = statics.MarkdownParser
  if (parser && typeof parser.setCustomSyntax === 'function') {
    parser.setCustomSyntax.call(parser, processor)
    return
  }
  if (typeof statics.setCustomSyntax === 'function') {
    statics.setCustomSyntax.call(statics, processor)
  }
}

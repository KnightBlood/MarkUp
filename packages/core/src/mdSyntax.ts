/**
 * Typora-style markdown syntax extensions: subscript, superscript, highlight
 * and underline.
 *
 * Implemented as a single remark plugin that rewrites the mdast **after**
 * parsing, rather than as micromark constructs. Two reasons:
 *
 * 1. With `remark-gfm({ singleTilde: false })` — which this app requires so
 *    `~~strike~~` stays the only strikethrough form — `~`, `^` and `==` are
 *    ordinary text characters, so `mdast-util-from-markdown` leaves them in
 *    `text` nodes verbatim. Nothing has to be taught to tokenize them.
 * 2. One plugin serves both consumers: the export/preview pipeline
 *    (`createSharedPipeline`) and Milkdown's own parser in 实时预览
 *    (`$remark(...)` in `adapters/wysiwyg.ts`). Both run remark plugins on the
 *    mdast before it is turned into HTML or ProseMirror, so the three views
 *    cannot drift apart.
 *
 * Every rewritten node carries `data.hName`, so `remark-rehype` emits the
 * matching element (`<mark>` / `<sup>` / `<sub>` / `<u>`) and Milkdown's
 * `$markSchema` can match on the node type for its own round-trip.
 *
 * Code is never touched: the walk only rewrites `text` nodes, and fenced code,
 * inline code and math keep their payload in `value` rather than `children`.
 */

/** Node kinds produced here; also the names Milkdown matches in `parseMarkdown`. */
export const MD_SYNTAX_TYPES = {
  subscript: 'subscript',
  superscript: 'superscript',
  highlight: 'highlight',
  underline: 'underline',
} as const

/** `data.hName` for each produced node. */
const H_NAME: Record<string, string> = {
  subscript: 'sub',
  superscript: 'sup',
  highlight: 'mark',
  underline: 'u',
}

export interface MdSyntaxOptions {
  subscript?: boolean
  superscript?: boolean
  highlight?: boolean
  underline?: boolean
}

interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
  data?: { hName?: string; hProperties?: Record<string, unknown> }
}

/**
 * One pattern per syntax, exported so OverType's 分屏 renderer can apply the
 * exact same rules to its own HTML output — see `overtypeSyntax.ts`. Each:
 * - refuses to open on the marker char itself (`~x~` must not swallow the
 *   first `~` of `~~strike~~`),
 * - refuses an empty or space-padded body, so `H~2~O` works while `~ ~` and
 *   `== ==` stay literal,
 * - refuses a marker run of the same char at either end.
 */
export const SYNTAX_PATTERNS: ReadonlyArray<{ type: string; regex: RegExp }> = [
  { type: MD_SYNTAX_TYPES.highlight, regex: /==([^=\s](?:[^=\n]*[^=\s])?)==/g },
  {
    type: MD_SYNTAX_TYPES.subscript,
    regex: /(?<!~)~([^~\s](?:[^~\n]*[^~\s])?)~(?!~)/g,
  },
  {
    type: MD_SYNTAX_TYPES.superscript,
    regex: /(?<!\^)\^([^\^\s](?:[^\^\n]*[^\^\s])?)\^(?!\^)/g,
  },
]

const PATTERNS = SYNTAX_PATTERNS

/** Tags Typora writes for underline; `<u>` is the one it produces. */
const UNDERLINE_OPEN = /^\s*<(u|ins)>\s*$/i
const UNDERLINE_CLOSE = /^\s*<\/(u|ins)>\s*$/i

const ENABLED = (options: MdSyntaxOptions, key: keyof MdSyntaxOptions): boolean =>
  options[key] !== false

function markNode(type: string, children: MdNode[]): MdNode {
  return { type, children, data: { hName: H_NAME[type] ?? type } }
}

/** Is this node's subtree plain text we may rewrite? */
const isText = (node: MdNode): boolean => node.type === 'text' && typeof node.value === 'string'

/**
 * Split one text value on every enabled pattern, recursing into the inner
 * content of each match. Recursion is what makes `==外层 ^上^ 内==` nest the
 * superscript inside the highlight instead of leaving it literal.
 *
 * Ties are broken by position: the leftmost match across all patterns wins,
 * so `==a~b~c==` opens the highlight first and finds the subscript inside.
 */
function splitText(value: string, options: MdSyntaxOptions): MdNode[] {
  if (!value) return [{ type: 'text', value }]

  let best: { match: RegExpExecArray; type: string } | null = null
  for (const { type, regex } of PATTERNS) {
    if (!ENABLED(options, type as keyof MdSyntaxOptions)) continue
    regex.lastIndex = 0
    const match = regex.exec(value)
    if (!match) continue
    // The guards make a zero-width match impossible, but bail rather than hang
    // forever if a pattern is ever relaxed.
    if (match[0].length === 0) continue
    if (!best || match.index < best.match.index) best = { match, type }
  }
  if (!best) return [{ type: 'text', value }]

  const start = best.match.index
  const end = start + best.match[0].length
  const out: MdNode[] = []
  if (start > 0) out.push(...splitText(value.slice(0, start), options))
  out.push(markNode(best.type, splitText(best.match[1] ?? '', options)))
  if (end < value.length) out.push(...splitText(value.slice(end), options))
  return out
}

/**
 * Fold `<u>` / `</u>` pairs in a children array into `underline` nodes.
 * Inline HTML reaches mdast as `html` nodes interleaved with `text`, so the
 * pairing happens across siblings. Unclosed tags are left alone (and dropped
 * later by the pipeline's html filter).
 */
function foldUnderline(children: MdNode[]): MdNode[] {
  const out: MdNode[] = []
  let open = -1
  for (const child of children) {
    if (child.type === 'html') {
      const value = child.value ?? ''
      if (UNDERLINE_OPEN.test(value)) {
        if (open < 0) {
          out.push({ type: '__u_open__' })
          open = out.length - 1
        }
        continue
      }
      if (UNDERLINE_CLOSE.test(value)) {
        if (open >= 0) {
          const inner = out.splice(open + 1)
          out.splice(open, 1, markNode(MD_SYNTAX_TYPES.underline, inner))
          open = -1
        }
        continue
      }
    }
    if (open >= 0) out.push(child)
    else if (child.type !== 'html') out.push(child)
  }
  // An unmatched opener means the tag was never closed — drop the marker and
  // keep whatever followed it as ordinary content.
  if (open >= 0) out.splice(open, 1)
  return out
}

/** Nodes whose children are opaque — never rewritten. */
const OPAQUE = new Set(['inlineCode', 'code', 'math', 'inlineMath'])

function walk(node: MdNode, options: MdSyntaxOptions): void {
  if (!node.children || OPAQUE.has(node.type)) return
  let children = node.children
  if (ENABLED(options, 'underline')) children = foldUnderline(children)
  const next: MdNode[] = []
  for (const child of children) {
    if (isText(child)) {
      next.push(...splitText(child.value ?? '', options))
      continue
    }
    walk(child, options)
    next.push(child)
  }
  node.children = next
}

/**
 * Remark plugin adding the four extensions.
 *
 * Note the shape: unified's `use(plugin, options)` calls `plugin(options)` and
 * treats the return value as the **transformer** — there is no separate
 * attacher hop. Returning an attacher instead makes unified adopt it as the new
 * mdast root, which silently empties every document.
 */
export function mdSyntax(options: MdSyntaxOptions = {}) {
  const opts: MdSyntaxOptions = {
    subscript: options.subscript !== false,
    superscript: options.superscript !== false,
    highlight: options.highlight !== false,
    underline: options.underline !== false,
  }
  return function transformer(tree: MdNode): void {
    walk(tree, opts)
  }
}

/**
 * Same plugin as an attacher, for Milkdown's `$remark(name, factory)` — which
 * expects `factory(options)` to yield a classic remark plugin, the shape
 * `remark-gfm` itself uses.
 */
export function mdSyntaxPlugin(options: MdSyntaxOptions = {}) {
  return function attacher() {
    return mdSyntax(options)
  }
}

/** Names of the node kinds a given options object enables. */
export function enabledSyntaxTypes(options: MdSyntaxOptions = {}): string[] {
  return Object.values(MD_SYNTAX_TYPES).filter((type) =>
    ENABLED(options, type as keyof MdSyntaxOptions),
  )
}

/**
 * Map the four 「语法支持」 preferences onto {@link MdSyntaxOptions}. Absent keys
 * stay enabled, so profiles written before these fields existed keep the
 * previous behaviour.
 */
export function mdSyntaxOptionsFromConfig(config?: {
  mdSubscript?: boolean
  mdSuperscript?: boolean
  mdHighlight?: boolean
  mdUnderline?: boolean
}): MdSyntaxOptions {
  return {
    subscript: config?.mdSubscript,
    superscript: config?.mdSuperscript,
    highlight: config?.mdHighlight,
    underline: config?.mdUnderline,
  }
}

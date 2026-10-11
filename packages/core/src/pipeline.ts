import rehypeKatex from 'rehype-katex'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import katex from 'katex'
import type { AppConfig } from '@markup/host-api'
import { normalizeDiagramLang } from './diagrams'
import { normalizeEmbedLang } from './embeds'
import { splitFrontmatter } from './frontmatter'
import { normalizeMathLang } from './math'
import { mdAlerts } from './mdAlerts'
import { mdSyntax } from './mdSyntax'
import { TOC_MARKER } from './textFormat'
import { remapUnicodePunctuation } from './unicodePunct'

export interface TocEntry {
  text: string
  level: number
  id: string
}

export interface RenderResult {
  html: string
  toc: TocEntry[]
}

export interface Pipeline {
  render(markdown: string): Promise<RenderResult>
}

/**
 * Typora's 「Markdown ▸ 语法支持」 toggles. Every one defaults to on, matching
 * the previous hard-coded behaviour, so callers that pass nothing see no change.
 */
export interface PipelineOptions {
  /** `$…$` and `$$…$$` (remark-math). */
  inlineMath?: boolean
  /** ` ```math ` / ` ```latex ` fenced blocks. */
  codeBlockMath?: boolean
  /** mermaid / flowchart.js / sequence fences. */
  diagrams?: boolean
  /** 3D model / video / mindmap / xmind / drawio / plantuml / file fences. */
  embeds?: boolean
  /** `H~2~O` */
  subscript?: boolean
  /** `X^2^` */
  superscript?: boolean
  /** `==key==` */
  highlight?: boolean
  /** `<u>key</u>` */
  underline?: boolean
  /** `> [!NOTE]` callout blocks. */
  alerts?: boolean
  /** GFM bare-URL autolinks. */
  autoLink?: boolean
  /**
   * 保留单换行符 — a single newline inside a paragraph becomes a hard break
   * instead of a space. Applies wherever the pipeline renders (export, split
   * view), so the document reads the same way in all of them.
   */
  preserveLineBreaks?: boolean
  /**
   * 解析时识别 Unicode 标点 — read `「title」`, `》`, `＃` … as their ASCII
   * equivalents while parsing. The document is untouched; the rendered output
   * shows the remapped form, which is the point of the option.
   */
  remapUnicodePunctuation?: boolean
}

interface MdastNode {
  type: string
  children?: MdastNode[]
  lang?: string | null
  value?: string
  depth?: number
  meta?: string | null
  /** Set on a `list` built for a `[TOC]` expansion. */
  ordered?: boolean
  /** Set on a `link` built for a `[TOC]` expansion. */
  url?: string
  data?: {
    hName?: string
    hProperties?: Record<string, unknown>
  }
}

const ESCAPE_TOKENS: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => ESCAPE_TOKENS[ch] ?? ch)
}

function textOf(node: MdastNode): string {
  if (node.type === 'text' || node.type === 'code') return node.value ?? ''
  if (!node.children) return ''
  return node.children.map(textOf).join('')
}

function slugify(text: string, seen: Map<string, number>): string {
  const base =
    text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  const count = seen.get(base) ?? 0
  seen.set(base, count + 1)
  return count === 0 ? base : `${base}-${count}`
}

interface TransformCtx {
  toc: TocEntry[]
  seen: Map<string, number>
  options: PipelineOptions
}

/**
 * Collect the outline *before* rewriting anything.
 *
 * A `[TOC]` has to expand to the whole document's headings even when it sits
 * above them, so the list cannot be built while walking in order — and the
 * `seen` map that disambiguates duplicate slugs has to be filled exactly once,
 * here, or the anchors shift away from the ones the export outline points at.
 */
function collectToc(parent: MdastNode, ctx: TransformCtx): void {
  if (!parent.children) return
  for (const child of parent.children) {
    if (child.type === 'heading' && typeof child.depth === 'number') {
      const text = textOf(child).trim()
      const id = slugify(text, ctx.seen)
      ctx.toc.push({ text, level: child.depth, id })
      // Stamp the anchor onto the heading in the same pass. Generated here
      // rather than in the TOC expansion so a heading and its outline entry can
      // never disagree about the slug — a `[TOC]` link and a sidebar entry that
      // resolve differently is the kind of bug nobody notices until a reader
      // clicks one.
      child.data = {
        ...child.data,
        hProperties: { ...(child.data?.hProperties ?? {}), id },
      }
    }
    collectToc(child, ctx)
  }
}

/** Drop the speculative nested lists that ended up with no items. */
function pruneEmptyLists(node: MdastNode): void {
  if (!node.children) return
  node.children = node.children.filter(
    (child) => !(child.type === 'list' && (child.children?.length ?? 0) === 0),
  )
  for (const child of node.children) pruneEmptyLists(child)
}

/** A `[TOC]` paragraph → a nested bullet list of links to every heading. */
function tocNode(ctx: TransformCtx): MdastNode {
  const root: MdastNode = {
    type: 'list',
    ordered: false,
    children: [],
    // A hook for both the export stylesheet and the app theme, and something
    // for tests to target without depending on list nesting depth.
    data: { hProperties: { className: ['md-toc'] } },
  }
  if (ctx.toc.length === 0) return root
  const top = Math.min(...ctx.toc.map((entry) => entry.level))
  const stack: Array<{ level: number; node: MdastNode }> = [{ level: top - 1, node: root }]
  for (const entry of ctx.toc) {
    // Pop back to the parent of this level's run; entries deeper than their
    // predecessor nest, shallower or equal ones become siblings.
    while (stack.length > 1 && entry.level <= stack[stack.length - 1]!.level) stack.pop()
    const item: MdastNode = { type: 'listItem', children: [] }
    const nested: MdastNode = { type: 'list', ordered: false, children: [] }
    item.children!.push({
      type: 'paragraph',
      children: [
        { type: 'link', url: `#${entry.id}`, children: [{ type: 'text', value: entry.text }] },
      ],
    })
    item.children!.push(nested)
    stack[stack.length - 1]!.node.children!.push(item)
    stack.push({ level: entry.level, node: nested })
  }
  pruneEmptyLists(root)
  return root
}

function diagramPlaceholder(lang: string, code: string): MdastNode {
  return {
    type: 'html',
    value: `<div class="md-diagram" data-diagram="${lang}"><pre class="md-diagram__source"><code>${escapeHtml(code)}</code></pre></div>`,
  }
}

function embedPlaceholder(kind: string, code: string): MdastNode {
  return {
    type: 'html',
    value: `<div class="md-embed" data-embed="${kind}"><pre class="md-embed__source"><code>${escapeHtml(code)}</code></pre></div>`,
  }
}

function mathPlaceholder(code: string): MdastNode {
  let rendered = ''
  try {
    rendered = katex.renderToString(code, {
      displayMode: true,
      throwOnError: false,
      output: 'html',
      strict: 'ignore',
    })
  } catch {
    rendered = `<code class="md-math-error">${escapeHtml(code)}</code>`
  }
  return {
    type: 'html',
    value: `<div class="md-math md-math--block" data-math="block">${rendered}<pre class="md-math__source" hidden>${escapeHtml(code)}</pre></div>`,
  }
}

/**
 * `mdast-util-gfm-autolink-literal` tags the links it invents with
 * `class="auto"`; an author-written `[label](url)` never carries it. That is
 * the only reliable way to tell them apart after parsing, which is what the
 * 「自动识别链接」 toggle needs.
 */
function isAutoLink(node: MdastNode): boolean {
  const className = node.data?.hProperties?.['className']
  return Array.isArray(className) && className.includes('auto')
}

/**
 * 保留单换行符 — turn soft line breaks inside a paragraph into hard breaks.
 *
 * `remark-parse` keeps a soft break as a literal `\n` inside the text node (the
 * HTML step is what normally turns it into a space), so this is a matter of
 * splitting those nodes. Code blocks are untouched by construction: their
 * newlines live in `code.value`, not in a text node, and a code block's line
 * breaks are its content rather than formatting.
 */
function applyLineBreaks(parent: MdastNode): void {
  if (!parent.children) return
  const next: MdastNode[] = []
  for (const child of parent.children) {
    if (child.type === 'text' && child.value?.includes('\n')) {
      child.value.split('\n').forEach((part, index) => {
        if (index > 0) next.push({ type: 'break' })
        // An empty part would render as nothing; skip it rather than emit a
        // text node with no content.
        if (part) next.push({ type: 'text', value: part })
      })
      continue
    }
    applyLineBreaks(child)
    next.push(child)
  }
  parent.children = next
}

function transform(parent: MdastNode, ctx: TransformCtx): void {
  if (!parent.children) return
  const next: MdastNode[] = []
  for (const child of parent.children) {
    if (child.type === 'html') continue
    if (ctx.options.autoLink === false && child.type === 'link' && isAutoLink(child)) {
      // Undo the literal autolink: keep its contents, drop the anchor.
      transform(child, ctx)
      next.push(...(child.children ?? []))
      continue
    }
    if (child.type === 'code') {
      if (ctx.options.diagrams !== false) {
        const diagram = normalizeDiagramLang(child.lang)
        if (diagram) {
          next.push(diagramPlaceholder(diagram, child.value ?? ''))
          continue
        }
      }
      if (ctx.options.embeds !== false) {
        const embed = normalizeEmbedLang(child.lang)
        if (embed) {
          next.push(embedPlaceholder(embed, child.value ?? ''))
          continue
        }
      }
      if (ctx.options.codeBlockMath !== false) {
        const math = normalizeMathLang(child.lang)
        if (math) {
          next.push(mathPlaceholder(child.value ?? ''))
          continue
        }
      } else {
        // `rehype-katex` renders any element carrying `language-math` as display
        // math, independently of the mdast interception above. Leaving the
        // fence alone here would therefore keep rendering ```math even with the
        // toggle off, so re-label it as unhighlighted plain text — the visible
        // result is the raw fence, which is what "off" means.
        if (normalizeMathLang(child.lang)) {
          child.data = { ...child.data, hProperties: { className: ['language-plaintext'] } }
        }
      }
    }
    if (child.type === 'paragraph' && textOf(child).trim() === TOC_MARKER) {
      next.push(tocNode(ctx))
      continue
    }
    transform(child, ctx)
    next.push(child)
  }
  parent.children = next
}

export function createSharedPipeline(options: PipelineOptions = {}): Pipeline {
  return {
    async render(markdown: string): Promise<RenderResult> {
      const { body } = splitFrontmatter(markdown)
      // 解析时识别 Unicode 标点 rewrites the *input*, before parsing — there is no
      // mdast node for `》` to recognise afterwards, so this cannot be a transform.
      const source = options.remapUnicodePunctuation ? remapUnicodePunctuation(body) : body
      const ctx: TransformCtx = { toc: [], seen: new Map(), options }
      const processor = unified()
        .use(remarkParse)
        // `singleTilde: false` keeps `~~x~~` as the only strikethrough form, so
        // the single tilde stays free for subscript — the same split Typora uses.
        .use(remarkGfm, { singleTilde: false })
        .use(mdSyntax, {
          subscript: options.subscript,
          superscript: options.superscript,
          highlight: options.highlight,
          underline: options.underline,
        })
      // Inserted mid-chain on purpose: plugins run in registration order, so
      // appending this after remark-rehype would let it walk a hast tree it
      // cannot read. And it has to be conditional at all — `.use()` decides
      // *what* runs, so an unconditional call left the callouts converting
      // even with 「Github Style Alert」 switched off.
      if (options.alerts !== false) processor.use(mdAlerts)
      const file = await processor
        .use(remarkMath, options.inlineMath === false ? { singleDollarTextMath: false } : {})
        .use(() => (tree: MdastNode) => {
          collectToc(tree, ctx)
          // Before `transform`, so the `break` nodes are already in place when
          // the html/auto-link passes walk the tree.
          if (options.preserveLineBreaks) applyLineBreaks(tree)
          transform(tree, ctx)
        })
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeKatex, { strict: false })
        .use(rehypeStringify, { allowDangerousHtml: true })
        .process(source)
      return { html: String(file), toc: ctx.toc }
    },
  }
}

/**
 * Map the user's 「Markdown ▸ 语法支持」 preferences onto {@link PipelineOptions}.
 *
 * Every field is optional in `AppConfig` and defaults to enabled, so an absent
 * key (existing user profiles written before these landed) keeps the previous
 * hard-coded behaviour instead of silently switching features off.
 */
export function pipelineOptionsFromConfig(config?: AppConfig): PipelineOptions {
  if (!config) return {}
  return {
    inlineMath: config.mdInlineMath,
    codeBlockMath: config.mdCodeBlockMath,
    subscript: config.mdSubscript,
    superscript: config.mdSuperscript,
    highlight: config.mdHighlight,
    underline: config.mdUnderline,
    diagrams: config.mdDiagrams,
    alerts: config.mdAlerts,
    autoLink: config.mdAutoLink,
    preserveLineBreaks: config.preserveLineBreaks === true,
    remapUnicodePunctuation: config.remapUnicodePunctuation === true,
  }
}

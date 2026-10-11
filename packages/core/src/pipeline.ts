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
}

interface MdastNode {
  type: string
  children?: MdastNode[]
  lang?: string | null
  value?: string
  depth?: number
  meta?: string | null
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
    if (child.type === 'heading' && typeof child.depth === 'number') {
      const text = textOf(child).trim()
      ctx.toc.push({ text, level: child.depth, id: slugify(text, ctx.seen) })
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
        .use(() => (tree: MdastNode) => transform(tree, ctx))
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeKatex, { strict: false })
        .use(rehypeStringify, { allowDangerousHtml: true })
        .process(body)
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
  }
}

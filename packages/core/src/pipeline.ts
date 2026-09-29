import rehypeKatex from 'rehype-katex'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import katex from 'katex'
import { normalizeDiagramLang } from './diagrams'
import { normalizeEmbedLang } from './embeds'
import { splitFrontmatter } from './frontmatter'
import { normalizeMathLang } from './math'

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

interface MdastNode {
  type: string
  children?: MdastNode[]
  lang?: string | null
  value?: string
  depth?: number
  meta?: string | null
  data?: { hName?: string; hProperties?: Record<string, unknown> }
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

function transform(parent: MdastNode, ctx: TransformCtx): void {
  if (!parent.children) return
  const next: MdastNode[] = []
  for (const child of parent.children) {
    if (child.type === 'html') continue
    if (child.type === 'code') {
      const diagram = normalizeDiagramLang(child.lang)
      if (diagram) {
        next.push(diagramPlaceholder(diagram, child.value ?? ''))
        continue
      }
      const embed = normalizeEmbedLang(child.lang)
      if (embed) {
        next.push(embedPlaceholder(embed, child.value ?? ''))
        continue
      }
      const math = normalizeMathLang(child.lang)
      if (math) {
        next.push(mathPlaceholder(child.value ?? ''))
        continue
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

export function createSharedPipeline(): Pipeline {
  return {
    async render(markdown: string): Promise<RenderResult> {
      const { body } = splitFrontmatter(markdown)
      const ctx: TransformCtx = { toc: [], seen: new Map() }
      const processor = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkMath)
        .use(() => (tree: MdastNode) => transform(tree, ctx))
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeKatex, { strict: false })
        .use(rehypeStringify, { allowDangerousHtml: true })
      const file = await processor.process(body)
      return { html: String(file), toc: ctx.toc }
    },
  }
}

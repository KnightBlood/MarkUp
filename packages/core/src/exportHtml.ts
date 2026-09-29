import { createSharedPipeline } from './pipeline'
import { splitFrontmatter } from './frontmatter'
import { hydrateDiagrams } from './diagrams'
import { hydrateEmbeds } from './embeds'

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const EXPORT_CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0 auto;
  padding: 2.5rem 1.5rem 4rem;
  max-width: 48rem;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 16px;
  line-height: 1.7;
  color: #1f2328;
  background: #fff;
}
@media (prefers-color-scheme: dark) {
  body { color: #e6edf3; background: #0d1117; }
}
h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.6em 0 0.6em; }
h1 { font-size: 1.9em; border-bottom: 1px solid #d0d7de; padding-bottom: 0.3em; }
h2 { font-size: 1.5em; border-bottom: 1px solid #d0d7de; padding-bottom: 0.25em; }
p, ul, ol, blockquote, pre, table { margin: 0 0 1em; }
a { color: #0969da; }
@media (prefers-color-scheme: dark) { a { color: #58a6ff; } }
code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.9em;
  background: #f6f8fa;
  padding: 0.15em 0.4em;
  border-radius: 4px;
}
pre {
  background: #f6f8fa;
  padding: 12px 14px;
  border-radius: 8px;
  overflow-x: auto;
}
pre code { background: none; padding: 0; }
blockquote {
  border-left: 4px solid #d0d7de;
  margin-left: 0;
  padding: 0 1em;
  color: #57606a;
}
table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
th, td { border: 1px solid #d0d7de; padding: 6px 12px; }
th { background: #f6f8fa; font-weight: 600; text-align: left; }
img { max-width: 100%; height: auto; }
hr { border: none; border-top: 1px solid #d0d7de; margin: 2em 0; }
.md-math { margin: 1em 0; overflow-x: auto; text-align: center; }
.md-diagram { margin: 1em 0; background: #f6f8fa; border-radius: 8px; padding: 12px; overflow-x: auto; }
.md-diagram__source pre { margin: 0; background: transparent; }
.md-diagram__canvas { overflow-x: auto; }
.md-diagram__canvas svg { max-width: 100%; height: auto; }
.md-embed { margin: 1em 0; position: relative; }
.md-embed__source { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 0.9em; background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 6px; padding: 10px 14px; white-space: pre-wrap; word-break: break-word; margin: 0; }
.md-embed[data-rendered] > .md-embed__source { display: none; }
.md-embed--error > .md-embed__source { border-color: #d64545; }
.md-embed--error > .md-embed__canvas { display: none; }
.md-embed__video { display: block; max-width: 100%; max-height: 440px; background: #000; border-radius: 6px; }
.md-embed model-viewer { display: block; width: 100%; height: 360px; background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 6px; --poster-color: transparent; }
.md-embed[data-embed="mindmap"] .md-embed__canvas { border: 1px solid #d0d7de; border-radius: 6px; overflow: hidden; }
.md-embed[data-embed="mindmap"] .md-embed__canvas { height: 360px; }
.md-embed[data-embed="xmind"] .md-embed__canvas { border: 1px solid #d0d7de; border-radius: 6px; overflow: hidden; }
.md-embed__mindmap { display: block; width: 100%; height: 100%; }
.md-embed__xmind-sheet { font-size: 12.5px; font-weight: 600; padding: 6px 10px 2px; color: #57606a; }
.md-embed__xmind-sheet + .md-embed__mindmap { height: 300px; }
.md-embed__drawio { position: relative; width: 100%; height: 480px; overflow: auto; background: #fff; border: 1px solid #d0d7de; border-radius: 6px; }
.md-embed__drawio > svg { display: block; max-width: none; }
.md-embed__plantuml { overflow: auto; padding: 8px; background: #fff; border: 1px solid #d0d7de; border-radius: 6px; }
.md-embed__plantuml svg { display: block; max-width: 100%; height: auto; margin: 0 auto; }
.md-embed__bar { display: none; }
.md-frontmatter {
  display: none;
}
.footnotes { font-size: 0.9em; color: #57606a; border-top: 1px solid #d0d7de; margin-top: 2em; padding-top: 1em; }
@media print {
  body { max-width: none; padding: 0; }
  a[href^="http"]::after { content: " (" attr(href) ")"; font-size: 0.85em; color: #57606a; }
  pre, blockquote, table { break-inside: avoid; }
  h1, h2, h3 { break-after: avoid; }
}
`

const KATEX_CSS =
  'https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css'

export interface ExportHtmlOptions {
  title?: string
  /** Include @media print rules (default true). */
  printStyles?: boolean
}

export async function renderMarkdownHtml(markdown: string): Promise<string> {
  const pipeline = createSharedPipeline()
  const { html } = await pipeline.render(markdown)
  return html
}

/**
 * Render mermaid/flow fences and model/video/mindmap embeds in export HTML.
 *
 * The pipeline emits the same `.md-diagram[data-diagram]` /
 * `.md-embed[data-embed]` wrappers the editor uses, so this reuses
 * `hydrateDiagrams` + `hydrateEmbeds`. A failure keeps the source block
 * (graceful fallback) — exports never show a blank hole. Embeds whose fence
 * holds a local path resolve through the shell's `fs.readBase64` wiring.
 */
export async function hydrateExportDiagrams(bodyHtml: string): Promise<string> {
  if (typeof document === 'undefined') return bodyHtml
  const host = document.createElement('div')
  host.innerHTML = bodyHtml
  const hasDiagram = host.querySelector('.md-diagram[data-diagram]')
  const hasEmbed = host.querySelector('.md-embed[data-embed]')
  if (!hasDiagram && !hasEmbed) return bodyHtml
  if (hasDiagram) await hydrateDiagrams(host)
  if (hasEmbed) await hydrateEmbeds(host, { skip: ['file', 'drawio', 'xmind'] })
  return host.innerHTML
}

export function buildStandaloneHtml(
  bodyHtml: string,
  options: ExportHtmlOptions = {},
): string {
  const title = escapeHtml(options.title ?? 'Document')
  const css = options.printStyles === false ? EXPORT_CSS.replace(/@media print[\s\S]*?\n\}/, '') : EXPORT_CSS
  // `<model-viewer>` is a custom element: exported pages need the module
  // script (same CDN pin style as KaTeX); dynamic import covers the editor.
  const modelViewerScript = bodyHtml.includes('data-embed="model"')
    ? '\n<script type="module" src="https://cdn.jsdelivr.net/npm/@google/model-viewer@4.3.1/dist/model-viewer.min.js"></script>'
    : ''
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="${KATEX_CSS}">
<style>${css}</style>
</head>
<body>
<article class="markdown-body">
${bodyHtml}
</article>${modelViewerScript}
</body>
</html>
`
}

export async function exportHtmlDocument(
  markdown: string,
  options: ExportHtmlOptions = {},
): Promise<string> {
  const title =
    options.title ??
    splitFrontmatter(markdown).body.split('\n').find((line) => line.startsWith('# '))?.slice(2).trim() ??
    'Document'
  const body = await renderMarkdownHtml(markdown)
  const hydrated = await hydrateExportDiagrams(body)
  return buildStandaloneHtml(hydrated, { ...options, title })
}

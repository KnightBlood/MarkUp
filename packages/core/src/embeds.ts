import type { HydrateResult } from './diagrams'

export type EmbedKind =
  | 'model'
  | 'video'
  | 'mindmap'
  | 'xmind'
  | 'drawio'
  | 'plantuml'
  | 'file'

const EMBED_ALIASES: Record<string, EmbedKind> = {
  model: 'model',
  glb: 'model',
  gltf: 'model',
  '3d': 'model',
  video: 'video',
  mp4: 'video',
  webm: 'video',
  ogv: 'video',
  ogg: 'video',
  mov: 'video',
  mindmap: 'mindmap',
  'mind-map': 'mindmap',
  xmind: 'xmind',
  drawio: 'drawio',
  dio: 'drawio',
  plantuml: 'plantuml',
  puml: 'plantuml',
  // Generic document/engineering preview (file-viewer: 274 extensions).
  file: 'file',
  document: 'file',
  attachment: 'file',
  preview: 'file',
  pdf: 'file',
  office: 'file',
  doc: 'file',
  docx: 'file',
  xls: 'file',
  xlsx: 'file',
  ppt: 'file',
  pptx: 'file',
  rtf: 'file',
  odt: 'file',
  ods: 'file',
  odp: 'file',
  csv: 'file',
  ofd: 'file',
  epub: 'file',
  chm: 'file',
  zip: 'file',
  rar: 'file',
  archive: 'file',
  tar: 'file',
  eml: 'file',
  email: 'file',
  mbox: 'file',
  dwg: 'file',
  dxf: 'file',
  cad: 'file',
  typst: 'file',
  psd: 'file',
  hwp: 'file',
  heic: 'file',
}

export function normalizeEmbedLang(lang?: string | null): EmbedKind | null {
  if (!lang) return null
  const key = lang.trim().toLowerCase()
  if (!key) return null
  return EMBED_ALIASES[key] ?? null
}

/** Resolves a local file path to a `data:` URL (shell wires `host.fs.readBase64`). */
export type EmbedSourceResolver = (path: string) => Promise<string | null>

let sourceResolver: EmbedSourceResolver | null = null

export function setEmbedSourceResolver(resolver: EmbedSourceResolver | null): void {
  sourceResolver = resolver
}

export interface EmbedEnlargeRequest {
  kind: EmbedKind
  code: string
}

export type EmbedEnlargeHandler = (request: EmbedEnlargeRequest) => void

let enlargeHandler: EmbedEnlargeHandler | null = null

export function setEmbedEnlargeHandler(handler: EmbedEnlargeHandler | null): void {
  enlargeHandler = handler
}

/** Returns false when no viewer is wired (caller falls back to source editing). */
export function requestEmbedEnlarge(request: EmbedEnlargeRequest): boolean {
  if (!enlargeHandler) return false
  enlargeHandler(request)
  return true
}

const DIRECT_SRC_RE = /^(?:https?:|data:|blob:)/i

/** Starter markdown for new ```mindmap fences (headings = branches). */
export const MINDMAP_TEMPLATE = `# 中心主题

## 分支一

- 要点 A
- 要点 B

## 分支二

- 要点 C
`

/** Starter body for new ```plantuml fences. */
export const PLANTUML_TEMPLATE = `@startuml
Alice -> Bob : Hello
Bob --> Alice : Hi
@enduml
`

/**
 * Fence content for model/video is a single source: an http(s)/data/blob URL
 * used as-is, otherwise a local file path resolved through the shell's
 * binary reader (`fs.readBase64` → `data:` URL).
 */
export async function resolveEmbedSrc(raw: string): Promise<string> {
  const src = raw.trim()
  if (!src) throw new Error('嵌入内容为空')
  if (DIRECT_SRC_RE.test(src)) return src
  if (!sourceResolver) throw new Error('当前环境无法读取本地文件（缺少 fs.readBase64）')
  const dataUrl = await sourceResolver(src)
  if (!dataUrl) throw new Error(`无法读取文件：${src}`)
  return dataUrl
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',')
  if (comma < 0 || !dataUrl.startsWith('data:')) throw new Error('无效的 data URL')
  const meta = dataUrl.slice(0, comma)
  const payload = dataUrl.slice(comma + 1)
  if (!/;base64/i.test(meta)) {
    return new TextEncoder().encode(decodeURIComponent(payload))
  }
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function dataUrlToUtf8(dataUrl: string): string {
  return new TextDecoder('utf-8').decode(dataUrlToBytes(dataUrl))
}

async function resolveEmbedBytes(raw: string): Promise<Uint8Array> {
  const src = await resolveEmbedSrc(raw)
  if (src.startsWith('data:')) return dataUrlToBytes(src)
  const response = await fetch(src)
  if (!response.ok) throw new Error(`读取失败（HTTP ${response.status}）：${src}`)
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * drawio / plantuml fences accept two shapes: a single line naming a file
 * (path or URL) or inline content (XML / UML DSL). xmind is always a path.
 */
export type EmbedContent = { kind: 'path'; path: string } | { kind: 'text'; text: string }

export function parseEmbedContent(
  kind: 'drawio' | 'plantuml' | 'file',
  code: string,
): EmbedContent {
  const trimmed = code.trim()
  if (!trimmed) throw new Error('嵌入内容为空')
  if (kind === 'file') {
    // Path/URL only — binary documents cannot be inlined into markdown.
    const fileLines = trimmed.split('\n')
    if (fileLines.length === 1) return { kind: 'path', path: (fileLines[0] ?? '').trim() }
    throw new Error('```file 围栏需要单行文件路径或 URL')
  }
  if (kind === 'plantuml') {
    if (/@start\w+/i.test(trimmed)) return { kind: 'text', text: trimmed }
  } else if (trimmed.startsWith('<')) {
    return { kind: 'text', text: trimmed }
  }
  const lines = trimmed.split('\n')
  if (lines.length === 1) return { kind: 'path', path: (lines[0] ?? '').trim() }
  throw new Error('无法识别的嵌入内容（需为单行文件路径或有效的内联内容）')
}

/** Reads a fence-referenced file (or URL) and decodes it as UTF-8 text. */
export async function resolveEmbedText(raw: string): Promise<string> {
  const src = await resolveEmbedSrc(raw)
  if (src.startsWith('data:')) return dataUrlToUtf8(src)
  const response = await fetch(src)
  if (!response.ok) throw new Error(`读取失败（HTTP ${response.status}）：${src}`)
  return response.text()
}

function markEmbedFailed(el: Element): void {
  el.removeAttribute('data-rendered')
  el.setAttribute('data-error', '1')
  el.classList.add('md-embed--error')
}

async function renderVideo(code: string, container: HTMLElement): Promise<void> {
  const src = await resolveEmbedSrc(code)
  const video = document.createElement('video')
  video.className = 'md-embed__video'
  video.controls = true
  video.preload = 'metadata'
  video.src = src
  // Media errors surface asynchronously — flip back to the source block.
  video.addEventListener('error', () => {
    const wrap = video.closest('.md-embed')
    if (wrap) markEmbedFailed(wrap)
  })
  container.append(video)
}

async function renderModel(code: string, container: HTMLElement): Promise<void> {
  const src = await resolveEmbedSrc(code)
  await import('@google/model-viewer')
  const viewer = document.createElement('model-viewer')
  viewer.setAttribute('src', src)
  viewer.setAttribute('camera-controls', '')
  viewer.setAttribute('interaction-prompt', 'none')
  viewer.setAttribute('shadow-intensity', '1')
  viewer.className = 'md-embed__model'
  container.append(viewer)
}

async function renderMindmap(code: string, container: HTMLElement): Promise<void> {
  const { Transformer } = await import('markmap-lib')
  const { Markmap } = await import('markmap-view')
  const { root } = new Transformer().transform(code.trim())
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 'md-embed__mindmap')
  container.append(svg)
  const mm = Markmap.create(
    svg as Parameters<typeof Markmap.create>[0],
    { autoFit: true },
    root,
  )
  await mm.fit().catch(() => undefined)
}

// ---------------------------------------------------------------------------
// XMind (.xmind = ZIP workbook) — rendered by the file viewer's mindmap line
// ---------------------------------------------------------------------------

/**
 * XMind previews ride `@file-viewer/renderer-mindmap` (`@ljheee/xmind-parser` +
 * jszip, fully offline) — the same engine family as ```file, one viewer stack
 * for every binary diagram format. The previous markmap conversion threw
 * `Cannot read properties of undefined (reading 'map')` inside markmap-view's
 * `renderData` on real Zen workbooks.
 */
async function renderXmind(code: string, container: HTMLElement): Promise<void> {
  const raw = code.trim()
  await mountFileViewer(container, await resolveEmbedBytes(raw), fileViewerNameFor(raw))
}

// ---------------------------------------------------------------------------
// Draw.io (.drawio / .dio — mxGraphModel XML, optionally zipped in <mxfile>)
// ---------------------------------------------------------------------------

function localName(el: Element): string {
  return el.localName || el.nodeName
}

async function inflateDrawioDiagram(compressed: string): Promise<string> {
  const { inflateSync, unzlibSync } = await import('fflate')
  let bytes: Uint8Array
  try {
    const binary = atob(compressed)
    bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  } catch {
    throw new Error('Draw.io diagram 节点不是合法 base64')
  }
  try {
    return new TextDecoder().decode(inflateSync(bytes))
  } catch {
    try {
      return new TextDecoder().decode(unzlibSync(bytes))
    } catch {
      throw new Error('Draw.io diagram 内容无法解压')
    }
  }
}

/** Unwraps `<mxfile>` (plain or compressed diagram) down to an `<mxGraphModel>` XML. */
export async function normalizeDrawioXml(xml: string): Promise<string> {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const root = doc.documentElement
  if (!root || localName(root) === 'parsererror') throw new Error('Draw.io XML 解析失败')
  const rootName = localName(root)
  if (rootName === 'mxGraphModel') return xml
  if (rootName === 'mxfile') {
    const diagram = root.getElementsByTagName('diagram')[0]
    if (!diagram) throw new Error('Draw.io 文件缺少 diagram 节点')
    const inner = diagram.getElementsByTagName('mxGraphModel')[0]
    if (inner) return new XMLSerializer().serializeToString(inner)
    const compressed = (diagram.textContent ?? '').trim()
    if (!compressed) throw new Error('Draw.io diagram 节点为空')
    return inflateDrawioDiagram(compressed)
  }
  throw new Error(`不支持的 Draw.io 根节点：<${rootName}>`)
}

/**
 * Draw.io previews ride `@file-viewer/renderer-drawing` (bundled
 * `vendor/drawio/viewer-static.min.js`, fully offline) instead of a parallel
 * mxgraph mount — one diagram stack for ```drawio and ```file. A bare
 * `<mxGraphModel>` is a valid .drawio payload for that renderer, so inline
 * fences only need `normalizeDrawioXml` for the `<mxfile>`/compressed shapes.
 */
async function renderDrawio(code: string, container: HTMLElement): Promise<void> {
  const content = parseEmbedContent('drawio', code)
  if (content.kind === 'text') {
    const modelXml = await normalizeDrawioXml(content.text)
    await mountFileViewer(container, new TextEncoder().encode(modelXml), 'inline.drawio')
    return
  }
  await mountFileViewer(
    container,
    await resolveEmbedBytes(content.path),
    fileViewerNameFor(content.path),
  )
}

// ---------------------------------------------------------------------------
// PlantUML (official TeaVM engine: @plantuml/core — fully offline)
// ---------------------------------------------------------------------------

let vizLoadPromise: Promise<void> | null = null
let plantumlModule: Promise<typeof import('@plantuml/core/plantuml.js')> | null = null
let plantumlQueue: Promise<unknown> = Promise.resolve()

async function ensureVizGlobal(): Promise<void> {
  if ((globalThis as Record<string, unknown>).Viz) return
  if (!vizLoadPromise) {
    const load = (async (): Promise<void> => {
      let assetUrl: string | null = null
      try {
        const mod = (await import('@plantuml/core/viz-global.js?url')) as { default?: string }
        assetUrl = mod.default ?? null
      } catch {
        assetUrl = null
      }
      if (assetUrl) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script')
          script.src = assetUrl
          script.async = false
          script.onload = () => resolve()
          script.onerror = () => reject(new Error('PlantUML 布局引擎加载失败'))
          document.head.append(script)
        })
        if (!(globalThis as Record<string, unknown>).Viz) {
          throw new Error('PlantUML 布局引擎初始化失败')
        }
        return
      }
      // Node (tsx smoke tests): load the UMD build directly — its CommonJS
      // branch fills exports with the same object the browser branch mounts.
      try {
        const { createRequire } = (await import(
          /* @vite-ignore */ 'node:module'
        )) as typeof import('node:module')
        const req = createRequire(import.meta.url)
        ;(globalThis as Record<string, unknown>).Viz = req('@plantuml/core/viz-global.js')
      } catch (error) {
        throw new Error(`PlantUML 布局引擎不可用：${String(error)}`)
      }
    })()
    vizLoadPromise = load.catch((error: unknown) => {
      vizLoadPromise = null
      throw error
    })
  }
  return vizLoadPromise
}

async function renderPlantuml(code: string, container: HTMLElement): Promise<void> {
  const content = parseEmbedContent('plantuml', code)
  const text = content.kind === 'text' ? content.text : await resolveEmbedText(content.path)
  await ensureVizGlobal()
  const mod = await (plantumlModule ??= import('@plantuml/core/plantuml.js'))
  const lines = text.split(/\r\n|\r|\n/)
  // The engine keeps shared state — renders in one context must be serialized.
  const task = plantumlQueue.then(
    () =>
      new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('PlantUML 渲染超时（30s）')), 30000)
        try {
          mod.renderToString(
            lines,
            (svg) => {
              clearTimeout(timer)
              resolve(svg)
            },
            (message) => {
              clearTimeout(timer)
              reject(new Error(message))
            },
          )
        } catch (error) {
          clearTimeout(timer)
          reject(error)
        }
      }),
  )
  plantumlQueue = task.catch(() => undefined)
  const svg = await task
  const wrap = document.createElement('div')
  wrap.className = 'md-embed__plantuml'
  wrap.innerHTML = svg
  container.append(wrap)
}

// ---------------------------------------------------------------------------
// Generic files (@file-viewer/web-full — full format matrix, fully offline)
// ---------------------------------------------------------------------------

let fileViewerModule: Promise<typeof import('@file-viewer/web-full')> | null = null

function ensureFileViewer(): Promise<typeof import('@file-viewer/web-full')> {
  if (!fileViewerModule) fileViewerModule = import('@file-viewer/web-full')
  return fileViewerModule
}

/**
 * Name used for renderer routing: local paths keep their basename (the
 * original extension drives the pipeline), http(s) URLs use the pathname,
 * and `data:` URLs fall back to the MIME subtype (`application/pdf` →
 * `inline.pdf`).
 *
 * Only the filename matters downstream — `@file-viewer`'s source contract
 * derives the routing extension via `source.type || getExtension(filename)`,
 * and `type` there is *extension-shaped*, not a MIME. Feeding a MIME into
 * it makes `getByExtension('application/pdf')` miss and drops every render
 * into the unsupported state, so we never set `viewer.type` and normalize
 * the derived subtype against the registry's extension table instead
 * (`image/svg+xml` → `svg`, `text/plain` → `txt`).
 */
function fileViewerNameFor(raw: string): string {
  if (DIRECT_SRC_RE.test(raw)) {
    const dataMatch = /^data:([^;,]+)?/i.exec(raw)
    if (dataMatch) {
      const mime = dataMatch[1] ?? ''
      const subtype = (mime.split('/').pop() ?? '').split('+')[0] ?? ''
      const lowered = /^[a-z0-9]{1,8}$/i.test(subtype) ? subtype.toLowerCase() : 'bin'
      return `inline.${lowered === 'plain' ? 'txt' : lowered}`
    }
    try {
      const pathname = new URL(raw).pathname
      const base = decodeURIComponent(pathname.split('/').filter(Boolean).pop() ?? '')
      if (base) return base
    } catch {
      // unparseable URL — fall through to the generic name
    }
    return 'preview.bin'
  }
  const base = raw.split(/[\\/]/).filter(Boolean).pop() ?? ''
  return base || 'preview.bin'
}

/** Mirrors the shell theme classes onto the viewer's own theme option. */
function fileViewerTheme(): 'light' | 'dark' | 'system' {
  const root = document.documentElement
  if (root.classList.contains('theme-dark')) return 'dark'
  if (root.classList.contains('theme-light')) return 'light'
  return 'system'
}

/**
 * Mounts one `<flyfish-file-viewer>` for already-resolved bytes. Shared by
 * ```file and by the diagram formats the viewer renders natively
 * (```drawio → renderer-drawing, ```xmind → renderer-mindmap).
 */
async function mountFileViewer(
  container: HTMLElement,
  bytes: Uint8Array,
  filename: string,
): Promise<void> {
  const host = document.createElement('div')
  host.className = 'md-embed__file'
  container.append(host)
  const mod = await ensureFileViewer()
  // Custom element path: `disconnectedCallback` runs the controller teardown
  // when the editor replaces the widget — a bare mountViewer() would leak
  // workers/RAF loops across re-renders.
  mod.defineFileViewerElement()
  const viewer = document.createElement(mod.FILE_VIEWER_ELEMENT_TAG) as InstanceType<
    typeof mod.FileViewerElement
  >
  viewer.buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
  viewer.filename = filename
  // `viewer.type` deliberately left unset: the controller derives the
  // routing extension from the filename (`source.type` is extension-shaped
  // there — a MIME makes `getByExtension` miss → unsupported state).
  viewer.options = { locale: 'zh-CN', theme: fileViewerTheme() }
  host.append(viewer)
}

async function renderFile(code: string, container: HTMLElement): Promise<void> {
  const content = parseEmbedContent('file', code)
  if (content.kind !== 'path') throw new Error('```file 围栏需要单行文件路径或 URL')
  await mountFileViewer(
    container,
    await resolveEmbedBytes(content.path),
    fileViewerNameFor(content.path),
  )
}

export async function renderEmbed(
  kind: EmbedKind,
  code: string,
  container: HTMLElement,
): Promise<void> {
  if (kind === 'video') {
    await renderVideo(code, container)
    return
  }
  if (kind === 'model') {
    await renderModel(code, container)
    return
  }
  if (kind === 'xmind') {
    await renderXmind(code, container)
    return
  }
  if (kind === 'drawio') {
    await renderDrawio(code, container)
    return
  }
  if (kind === 'plantuml') {
    await renderPlantuml(code, container)
    return
  }
  if (kind === 'file') {
    await renderFile(code, container)
    return
  }
  await renderMindmap(code, container)
}

/**
 * Render `.md-embed[data-embed]` wrappers (pipeline placeholder + editor
 * widget share the structure). Mirrors `hydrateDiagrams`: a failure keeps
 * the source block visible instead of leaving a hole.
 *
 * `options.skip` leaves listed kinds untouched — export passes
 * `['file', 'drawio', 'xmind']` because those render through the file viewer
 * (Shadow DOM / workers) which cannot be serialized into a standalone HTML
 * document.
 */
export async function hydrateEmbeds(
  root: ParentNode,
  options: { skip?: readonly EmbedKind[] } = {},
): Promise<HydrateResult> {
  const selector = '.md-embed[data-embed]'
  const candidates: Element[] = []
  const maybeSelf = root as Partial<Element>
  if (typeof maybeSelf.matches === 'function' && maybeSelf.matches(selector)) {
    candidates.push(root as Element)
  }
  candidates.push(...root.querySelectorAll<HTMLElement>(selector))
  const nodes = candidates as HTMLElement[]
  const result: HydrateResult = { rendered: 0, failed: 0 }
  for (const el of nodes) {
    if (el.dataset.rendered !== undefined || el.dataset.error !== undefined) continue
    const kind = normalizeEmbedLang(el.dataset.embed)
    const sourceEl = el.querySelector('.md-embed__source')
    if (!kind || !sourceEl) continue
    if (options.skip?.includes(kind)) continue
    const code = sourceEl.textContent ?? ''
    if (!code.trim()) {
      el.dataset.rendered = '1'
      continue
    }
    const canvas = document.createElement('div')
    canvas.className = 'md-embed__canvas'
    el.append(canvas)
    try {
      await renderEmbed(kind, code, canvas)
      el.dataset.rendered = '1'
      result.rendered += 1
    } catch (error) {
      canvas.remove()
      el.dataset.error = '1'
      el.classList.add('md-embed--error')
      console.error('[markup] 嵌入渲染失败', kind, error)
      result.failed += 1
    }
  }
  return result
}

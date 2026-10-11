/**
 * 图像工具 — the document-side half of Typora's image tools.
 *
 * Everything here is pure text/path arithmetic over the markdown: finding the
 * image references, mapping a reference URL to a path on disk, and respelling a
 * reference after a file was copied, moved or switched between syntaxes. The
 * shell owns the filesystem side, which is why none of this touches `host`.
 *
 * The scanning rules matter more than they look: an `![](…)` inside a fenced
 * code block is *sample* markdown, and rewriting it would corrupt the sample —
 * so fences and inline code spans are tracked and skipped.
 */

import { type PathStyle, dirname, joinPath, imageMarkdownUrl } from './imagePersist'
import type { TextEdit, TextRange } from './textFormat'

export type ImageSyntax = 'markdown' | 'html'

export interface ImageRef {
  /** Range of the whole reference in the markdown. */
  from: number
  to: number
  kind: ImageSyntax
  alt: string
  url: string
  /** Where the URL sits inside the reference, for surgical rewrites. */
  urlFrom: number
  urlTo: number
}

/** A drive letter (`C:`), which looks like a scheme but is not one. */
const WINDOWS_ROOT = /^[a-zA-Z]:$/
const SCHEME = /^([a-z][a-z0-9+.-]*):/i

const FENCE = /^\s*(?:```|~~~)/

/**
 * The URL's scheme, or null when it is a relative/absolute filesystem path.
 * A single letter before `:` is a Windows drive, not a scheme — `C:/a.png` has
 * to resolve as a path, not be dismissed as remote.
 */
export function imageUrlScheme(url: string): string | null {
  const scheme = SCHEME.exec(url)?.[1]?.toLowerCase()
  if (!scheme || scheme.length === 1) return null
  return scheme
}

/** True for anything that is not a path on this machine (`data:`, `http:`, `web:`…). */
export function isRemoteImageUrl(url: string): boolean {
  return imageUrlScheme(url) !== null
}

/** `decodeURIComponent` that leaves a malformed escape alone instead of throwing. */
function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Collapse `.` and `..` segments; a `..` that would escape the root is dropped. */
export function normalizePath(path: string, style: PathStyle): string {
  const parts = path.split(/[\\/]+/)
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      // Keep a Windows drive or a POSIX root: `C:/..` must not become empty.
      if (out.length > 0 && !WINDOWS_ROOT.test(out[out.length - 1]!)) out.pop()
      continue
    }
    out.push(part)
  }
  const joined = out.join(style.sep)
  // Preserve a leading separator for absolute POSIX paths.
  return /^[\\/]/.test(path) ? style.sep + joined : joined
}

/**
 * Absolute path an image reference points at, or null when it is not a local
 * file (a `data:` URL, a remote URL, a virtual web path) or the document has
 * never been saved and so has no directory to be relative to.
 */
export function resolveImagePath(
  url: string,
  docPath: string | null,
  style: PathStyle,
): string | null {
  if (!url || isRemoteImageUrl(url)) return null
  if (!docPath) return null
  // Strip the markdown "pointy" form and any surrounding whitespace.
  const raw = decodeSafe(url.trim().replace(/^<|>$/g, '')).replace(/\\/g, style.sep)
  const head = raw.split(style.sep)[0] ?? ''
  if (/^[\\/]/.test(raw) || WINDOWS_ROOT.test(head)) return normalizePath(raw, style)
  return normalizePath(joinPath(dirname(docPath, style.sep), raw, style.sep), style)
}

/** The document-relative URL for an absolute path (the inverse of the above). */
export function imageUrlForPath(
  path: string,
  docPath: string,
  options: { preferRelative: boolean; dotPrefix: boolean; escapeUrl: boolean },
  style: PathStyle,
): string {
  return imageMarkdownUrl(path, docPath, options, style)
}

interface ScanState {
  /** Inside a fenced code block opened by ``` or ~~~. */
  fenced: boolean
}

/** Inline code spans, which must be skipped the same way fences are. */
function inlineCodeRanges(line: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const re = /(`+)(?:[^`]|(?!\1)`)*?\1/g
  let match: RegExpExecArray | null
  while ((match = re.exec(line))) ranges.push([match.index, match.index + match[0].length])
  return ranges
}

const MARKDOWN_IMAGE =
  /!\[([^\]]*)\]\(\s*(<[^>\n]*>|[^\s)\n]+)(?:\s+["'][^"'\n]*["'])?\s*\)/g
const HTML_IMAGE = /<img\b[^>]*>/gi

function attr(tag: string, name: string): { value: string; from: number; to: number } | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i')
  const match = re.exec(tag)
  if (!match || match.index < 0) return null
  const quote = match[2] !== undefined ? '"' : match[3] !== undefined ? "'" : ''
  const value = match[2] ?? match[3] ?? match[4] ?? ''
  const raw = match[0]
  // Point at the value itself, not the whole attribute, so a rewrite is
  // surgical. `indexOf` lands on the opening quote, so step past it.
  const at = raw.indexOf(quote || value)
  const offset = match.index + at + (quote ? quote.length : 0)
  return { value, from: offset, to: offset + value.length }
}

/**
 * Every image reference in the document, in order, skipping fenced blocks and
 * inline code spans.
 */
export function collectImages(markdown: string): ImageRef[] {
  const refs: ImageRef[] = []
  const state: ScanState = { fenced: false }
  let lineStart = 0
  while (lineStart <= markdown.length) {
    const newline = markdown.indexOf('\n', lineStart)
    const lineEnd = newline === -1 ? markdown.length : newline
    const line = markdown.slice(lineStart, lineEnd)
    if (FENCE.test(line)) {
      state.fenced = !state.fenced
      lineStart = lineEnd + 1
      continue
    }
    if (!state.fenced) {
      const code = inlineCodeRanges(line)
      const inCode = (index: number): boolean =>
        code.some(([from, to]) => index >= from && index < to)

      for (const match of line.matchAll(MARKDOWN_IMAGE)) {
        const at = lineStart + (match.index ?? 0)
        if (inCode(match.index ?? 0)) continue
        const urlGroup = match[2] ?? ''
        const value = urlGroup.replace(/^<|>$/g, '')
        const urlOffset = match[0].indexOf(urlGroup)
        refs.push({
          from: at,
          to: at + match[0].length,
          kind: 'markdown',
          alt: match[1] ?? '',
          url: value,
          urlFrom: at + urlOffset + (urlGroup.startsWith('<') ? 1 : 0),
          urlTo: at + urlOffset + (urlGroup.startsWith('<') ? 1 : 0) + value.length,
        })
      }
      for (const match of line.matchAll(HTML_IMAGE)) {
        const tag = match[0]
        if (inCode(match.index ?? 0)) continue
        const src = attr(tag, 'src')
        if (!src) continue
        const alt = attr(tag, 'alt')
        const at = lineStart + (match.index ?? 0)
        refs.push({
          from: at,
          to: at + tag.length,
          kind: 'html',
          alt: alt?.value ?? '',
          url: src.value,
          urlFrom: at + src.from,
          urlTo: at + src.to,
        })
      }
    }
    lineStart = lineEnd + 1
  }
  return refs
}

/** The image reference containing `offset`, if the caret sits on one. */
export function imageAt(markdown: string, offset: number): ImageRef | null {
  // `<=` on the end so a caret placed just after the closing paren still counts.
  return collectImages(markdown).find((ref) => offset >= ref.from && offset <= ref.to) ?? null
}

/** A reference in the other syntax. */
export function respellImage(ref: ImageRef, target: ImageSyntax): string {
  if (target === 'html') {
    const alt = ref.alt ? ` alt="${ref.alt}"` : ''
    return `<img src="${ref.url}"${alt} />`
  }
  return `![${ref.alt}](${ref.url})`
}

/** The image references a range addresses; a collapsed range means the whole document. */
export function imagesInScope(markdown: string, range: TextRange): ImageRef[] {
  const collapsed = range.to <= range.from
  return collectImages(markdown).filter(
    (ref) => collapsed || (ref.to > range.from && ref.from < range.to),
  )
}

/**
 * 转换图片语法 — respell the images the selection touches between markdown and
 * HTML. A collapsed selection means "every image in the document", which is what
 * Typora's menu item does.
 */
export function switchImageSyntaxEdit(
  markdown: string,
  range: TextRange,
  target: ImageSyntax,
): TextEdit | null {
  const hits = imagesInScope(markdown, range).filter((ref) => ref.kind !== target)
  if (hits.length === 0) return null
  return replaceRefs(markdown, hits, (ref) => respellImage(ref, target))
}

/**
 * Rewrite references, returning the edit for the minimal range that covers
 * them. Assumes the refs are disjoint (they come from one scan), and walks them
 * in document order so the untouched text between them is copied verbatim —
 * splicing the rewritten string by original offsets would slice the *new* text
 * with *old* coordinates.
 */
function replaceRefs(
  markdown: string,
  refs: ImageRef[],
  render: (ref: ImageRef) => string,
  span?: (ref: ImageRef) => TextRange,
): TextEdit {
  const ordered = [...refs].sort((a, b) => a.from - b.from)
  const bounds = (ref: ImageRef): TextRange => span?.(ref) ?? { from: ref.from, to: ref.to }
  const from = Math.min(...ordered.map((ref) => bounds(ref).from))
  const to = Math.max(...ordered.map((ref) => bounds(ref).to))
  let out = ''
  let cursor = from
  for (const ref of ordered) {
    const bound = bounds(ref)
    out += markdown.slice(cursor, bound.from) + render(ref)
    cursor = bound.to
  }
  return { range: { from, to }, text: out + markdown.slice(cursor, to) }
}

/**
 * Repoint every reference that used to point at `fromPath` so it points at
 * `toPath` instead. Used after a rename / move / copy-to-folder: the file moved,
 * so the document has to follow it, and matching on the *resolved* path rather
 * than the written URL means `./a.png`, `a.png` and `%61.png` are all found.
 */
export function repointImagesEdit(
  markdown: string,
  docPath: string,
  fromPath: string,
  toPath: string,
  options: { preferRelative: boolean; dotPrefix: boolean; escapeUrl: boolean },
  style: PathStyle,
): TextEdit | null {
  const hits = collectImages(markdown).filter(
    (ref) => resolveImagePath(ref.url, docPath, style) === fromPath,
  )
  if (hits.length === 0) return null
  const url = imageUrlForPath(toPath, docPath, options, style)
  return replaceRefs(
    markdown,
    hits,
    () => url,
    (ref) => ({ from: ref.urlFrom, to: ref.urlTo }),
  )
}

export interface LocalImage {
  ref: ImageRef
  path: string
}

/**
 * The document's local images with their resolved paths, in document order and
 * de-duplicated by path — two references to the same file are one file to move.
 */
export function localImages(markdown: string, docPath: string | null, style: PathStyle): LocalImage[] {
  const seen = new Set<string>()
  const out: LocalImage[] = []
  for (const ref of collectImages(markdown)) {
    const path = resolveImagePath(ref.url, docPath, style)
    if (!path || seen.has(path)) continue
    seen.add(path)
    out.push({ ref, path })
  }
  return out
}

/** Every reference (not de-duplicated) pointing at `path`. */
export function refsForPath(
  markdown: string,
  path: string,
  docPath: string,
  style: PathStyle,
): ImageRef[] {
  return collectImages(markdown).filter(
    (ref) => resolveImagePath(ref.url, docPath, style) === path,
  )
}

/** The URL-decoded basename, for showing a name in a prompt. */
export function imageDisplayName(url: string): string {
  const decoded = decodeSafe(url)
  const index = Math.max(decoded.lastIndexOf('/'), decoded.lastIndexOf('\\'))
  return index < 0 ? decoded : decoded.slice(index + 1)
}

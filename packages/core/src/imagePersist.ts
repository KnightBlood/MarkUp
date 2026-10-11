/**
 * Typora「图像 ▸ 插入图片时」—— where a newly inserted image lands on disk,
 * and what that makes the markdown reference look like.
 *
 * Deliberately pure path arithmetic. Every side effect (writing bytes, making
 * directories, listing a folder so a name is not clobbered) arrives through
 * {@link ImagePersistDeps}, so the parts that are easy to get subtly wrong —
 * the five destination modes, `${filename}` substitution, collision suffixes,
 * relative-path climbing and URL escaping — are testable without a shell.
 *
 * The consumer is the shell, not the editor views. Previously all three views
 * independently turned a pasted `File` into a data URL, which meant the
 * "where does this file go" rules would have had to be written three times and
 * would drift. Now a view is handed a finished markdown URL and only splices
 * it in.
 */

import { IMAGE_COPY_MODES, type ImageCopyMode } from '@markup/host-api'

/** Typora's 「插入图片时」radio group, re-exported so callers can pull it from core. */
export type { ImageCopyMode }
export { IMAGE_COPY_MODES }

export interface ImagePersistOptions {
  /** `none` keeps the bitmap inline as a `data:` URL — Typora's 「无特殊操作」. */
  mode: ImageCopyMode
  /** `mode: 'custom'` destination; supports `${filename}` and `${filepath}`. */
  customPath: string
  /** 优先使用相对路径 — reference the copy relatively to the document folder. */
  preferRelative: boolean
  /** 图片语法偏好 — write `./assets/x.png` rather than `assets/x.png`. */
  dotPrefix: boolean
  /** 插入时自动转义图片 URL — percent-encode spaces and parentheses. */
  escapeUrl: boolean
}

export interface ImagePersistDeps {
  /** Create `dir` and every missing parent (`mkdir -p`). */
  mkdirp(dir: string): Promise<void>
  /** Basenames already inside `dir` — used to avoid overwriting an image. */
  listNames(dir: string): Promise<string[]>
  /** Write a `data:` URL's bytes to an absolute path. */
  writeDataUrl(path: string, dataUrl: string): Promise<void>
  /** Absolute path of the document, or null while it has never been saved. */
  docPath(): string | null
}

/**
 * What a path looks like on this host. Windows compares case-insensitively and
 * treats drives as separate roots; POSIX does neither, and folding case there
 * would compute a wrong relative path (`/a/B` → `/a/b/x.png` is not `x.png`).
 */
export interface PathStyle {
  sep: string
  caseInsensitive: boolean
}

const WINDOWS_ROOT = /^[a-zA-Z]:$/

/** Everything before the last separator; keeps `C:\` for `C:\a.png`. */
export function dirname(path: string, sep: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (i < 0) return ''
  if (i === 0) return path[0]!
  const head = path.slice(0, i)
  return WINDOWS_ROOT.test(head) ? head + sep : head
}

export function basename(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i < 0 ? path : path.slice(i + 1)
}

/** `note.md` → `note`. A leading dot is part of the name, so `.env` stays whole. */
export function stem(path: string): string {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

export function extname(path: string): string {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1) : ''
}

/** Join an absolute directory with a relative one; tolerates stray separators. */
export function joinPath(dir: string, rel: string, sep: string): string {
  if (!rel) return dir
  if (!dir) return rel
  return `${dir.replace(/[\\/]+$/, '')}${sep}${rel.replace(/^[\\/]+/, '')}`
}

/** `${filename}` → the document's basename without extension; `${filepath}` drops the extension from the full path. */
export function substitute(template: string, docPath: string): string {
  return template.replace(/\$\{(filename|filepath)\}/g, (_m, kind: string) =>
    kind === 'filename' ? stem(docPath) : docPath.replace(/\.[^.\\/]+$/, ''),
  )
}

/**
 * `to` expressed from `fromDir`. Returns '' when there is no relative form —
 * on Windows that happens across drives, which is why the style is threaded
 * through instead of guessed from the separator.
 */
export function relativePath(fromDir: string, to: string, style: PathStyle): string {
  const split = (p: string) => p.split(/[\\/]+/).filter(Boolean)
  const a = split(fromDir)
  const b = split(to)
  if (a[0] && WINDOWS_ROOT.test(a[0]) && a[0] !== b[0]) return ''
  const eq = (x: string, y: string) =>
    style.caseInsensitive ? x.toLowerCase() === y.toLowerCase() : x === y
  let i = 0
  while (i < a.length && i < b.length && eq(a[i]!, b[i]!)) i++
  const up = Array.from({ length: a.length - i }, () => '..')
  return [...up, ...b.slice(i)].join(style.sep)
}

/** Absolute directory the copy belongs in, or null when nothing should be copied. */
export function imageTargetDir(
  options: ImagePersistOptions,
  docPath: string | null,
  sep: string,
): string | null {
  if (options.mode === 'none') return null
  // Typora asks the user to save first. Rather than abort the paste (which
  // would silently drop the image) the caller keeps it inline; that is still
  // valid markdown, so nothing is lost — it just is not on disk yet.
  if (!docPath) return null
  if (options.mode === 'folder') return dirname(docPath, sep)
  const folder = (
    options.mode === 'assets'
      ? 'assets'
      : options.mode === 'docAssets'
        ? `${stem(docPath)}.assets`
        : substitute(options.customPath, docPath)
  )
    // A user-typed `./assets` should not survive into the joined path as a
    // literal `.` segment — it is the same directory either way. Only `./` is
    // stripped: a leading `/` on its own marks an absolute path, and removing
    // it would silently relocate the image.
    .replace(/^\.[\\/]+/, '')
  if (!folder || folder === '.') return dirname(docPath, sep)
  // A custom path may legitimately be absolute. Joining that onto the
  // document folder would produce `/a\C:\a\b`, so it has to short-circuit.
  if (/^[\\/]/.test(folder) || WINDOWS_ROOT.test(folder.split(/[\\/]/)[0] ?? ''))
    return folder
  return joinPath(dirname(docPath, sep), folder, sep)
}

/**
 * A name inside `dir` that does not collide with an existing file. Comparison
 * is always case-insensitive: guessing wrong on a case-sensitive filesystem
 * only skips a name, while guessing wrong on a case-insensitive one overwrites
 * somebody's image.
 */
export function uniqueFileName(dir: string, wanted: string, existing: Iterable<string>): string {
  const taken = new Set([...existing].map((name) => name.toLowerCase()))
  if (!taken.has(wanted.toLowerCase())) return wanted
  const dot = wanted.lastIndexOf('.')
  const base = dot > 0 ? wanted.slice(0, dot) : wanted
  const ext = dot > 0 ? wanted.slice(dot) : ''
  for (let i = 1; ; i++) {
    const candidate = `${base}-${i}${ext}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

/** Percent-encode what would otherwise terminate a markdown link destination. */
export function escapeUrlPath(url: string): string {
  return url.replace(/[ ()]/g, (ch) => (ch === ' ' ? '%20' : ch === '(' ? '%28' : '%29'))
}

/**
 * The markdown URL for a copied image. Always forward slashes — a Windows
 * backslash escapes the next character inside a link destination, so
 * `![](D:\a.png)` renders a broken link.
 */
export function imageMarkdownUrl(
  target: string,
  docPath: string,
  options: Pick<ImagePersistOptions, 'preferRelative' | 'dotPrefix' | 'escapeUrl'>,
  style: PathStyle,
): string {
  const asPosix = (p: string) => p.replace(/\\/g, '/')
  // `relativePath` reports '' when there is no relative form (another drive);
  // `??` would keep that empty string, so it has to collapse to null.
  const rel = options.preferRelative
    ? relativePath(dirname(docPath, style.sep), target, style) || null
    : null
  let url = asPosix(rel ?? target)
  // The `./` preference is Typora's, and it only applies to a relative path —
  // an absolute one already starts with a drive letter or a root.
  if (rel && options.dotPrefix && !url.startsWith('.')) url = `./${url}`
  return options.escapeUrl ? escapeUrlPath(url) : url
}

export interface ImageInsertSource {
  /** The image's bytes as a `data:` URL. */
  dataUrl: string
  /** Original filename, or a synthesised one for a clipboard bitmap. */
  name: string
}

export type ImageInsertResult =
  /** Copied to nothing: reference the bitmap inline. */
  | { kind: 'inline'; url: string }
  /** Written to disk; `path` is absolute, `url` is what goes in the document. */
  | { kind: 'saved'; url: string; path: string }

/**
 * Turn a pasted or picked image into the URL a view should splice into the
 * document. Falls back to the inline data URL whenever the image cannot be
 * put on disk (mode off, document never saved) — insertion still succeeds and
 * the document stays valid rather than losing the paste.
 */
export async function resolveImageInsert(
  source: ImageInsertSource,
  options: ImagePersistOptions,
  deps: ImagePersistDeps,
  style: PathStyle,
): Promise<ImageInsertResult> {
  const docPath = deps.docPath()
  const dir = imageTargetDir(options, docPath, style.sep)
  if (!dir || !docPath) return { kind: 'inline', url: source.dataUrl }
  await deps.mkdirp(dir)
  const name = uniqueFileName(dir, source.name, await deps.listNames(dir))
  const path = joinPath(dir, name, style.sep)
  await deps.writeDataUrl(path, source.dataUrl)
  return { kind: 'saved', path, url: imageMarkdownUrl(path, docPath, options, style) }
}

/**
 * Read a pasted or picked image as a `data:` URL — the inline path, and the
 * fallback whenever an image cannot go on disk. Lives here rather than in each
 * editor view so there is a single browser-side reader.
 *
 * `FileReader` is only touched when called, so importing this in a non-DOM
 * context (smoke tests) is safe.
 */
export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result ?? '')), { once: true })
    reader.addEventListener('error', () => reject(reader.error ?? new Error('read failed')), {
      once: true,
    })
    reader.readAsDataURL(file)
  })
}

/**
 * The path flavour for a document path.
 *
 * `host.platform` names the *shell* (electron / tauri / …), not the operating
 * system — one build runs on every OS — so the document path is the only
 * accurate signal. A Windows path arrives as `C:\…` or `C:/…`; anything else is
 * POSIX. The empty string (unsaved) has no separator we care about: an unsaved
 * document never reaches the copy path.
 */
export function pathStyleFor(docPath: string): PathStyle {
  const windows = /^[a-zA-Z]:[\\/]/.test(docPath) || docPath.includes('\\')
  return { sep: windows ? '\\' : '/', caseInsensitive: windows }
}

/** Filename for a clipboard bitmap, which arrives with no name of its own. */
export function imageNameFor(file: { name?: string; type?: string }): string {
  if (file.name) return file.name
  const sub = (file.type ?? '').split('/')[1]?.replace(/\+.*$/, '') ?? ''
  const ext = sub === 'jpeg' ? 'jpg' : /^[a-z0-9]{2,5}$/.test(sub) ? sub : 'png'
  return `image.${ext}`
}

/** Where an inserted image came from — gates 对本地位置的图片应用上述规则. */
export type ImageSourceKind = 'paste' | 'local'

/**
 * `AppConfig` → options. Every default matches what the app did before these
 * settings existed: 无特殊操作, relative references, no `./`, no escaping.
 */
export function imagePersistOptionsFromConfig(config: {
  imageCopyMode?: ImageCopyMode
  imageCopyCustomPath?: string
  imagePreferRelative?: boolean
  imageDotPrefix?: boolean
  imageEscapeUrl?: boolean
}): ImagePersistOptions {
  return {
    mode: config.imageCopyMode ?? 'none',
    customPath: config.imageCopyCustomPath ?? '${filename}.assets',
    // Typora ships 优先使用相对路径 on, and an absolute path would break as soon
    // as the folder is moved — the copy is meant to travel with the document.
    preferRelative: config.imagePreferRelative !== false,
    // 图片语法偏好 and 自动转义 are opt-in in Typora.
    dotPrefix: config.imageDotPrefix === true,
    escapeUrl: config.imageEscapeUrl === true,
  }
}

import { getHost, type DirEntry } from '@markup/host-api'

export interface WorkspaceState {
  root: string | null
  files: string[]
}

export interface SearchHit {
  path: string
  line: number
  column: number
  offset: number
  length: number
  preview: string
}

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  'target',
  '.next',
  '.nuxt',
  '.output',
  '.vscode',
  '.idea',
  '.turbo',
  '.cache',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
])

const MD_EXT = /\.(md|markdown|mdx)$/i

const MAX_WALK_FILES = 4000
const MAX_SEARCH_FILES = 600
const MAX_SEARCH_HITS = 400
const MAX_READ_BYTES = 512 * 1024

export function isMarkdownPath(path: string): boolean {
  return MD_EXT.test(path)
}

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

export function dirname(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return idx <= 0 ? path : path.slice(0, idx)
}

export function joinPath(root: string, name: string): string {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  return root.endsWith('/') || root.endsWith('\\') ? root + name : root + sep + name
}

export function relativePath(root: string, path: string): string {
  const normRoot = root.replace(/[\\/]+$/, '')
  if (path.startsWith(normRoot)) {
    const rest = path.slice(normRoot.length).replace(/^[\\/]+/, '')
    return rest || basename(path)
  }
  return basename(path)
}

function shouldSkip(entry: DirEntry): boolean {
  if (entry.kind === 'dir' && IGNORE_DIRS.has(entry.name)) return true
  if (entry.kind === 'file' && entry.name.startsWith('.') && entry.name !== '.md') return true
  return false
}

export async function walkMarkdownFiles(root: string, limit = MAX_WALK_FILES): Promise<string[]> {
  const host = getHost()
  const out: string[] = []
  const queue: string[] = [root]

  while (queue.length > 0 && out.length < limit) {
    const dir = queue.shift()
    if (!dir) break
    let entries: DirEntry[] = []
    try {
      entries = await host.fs.readDir(dir)
    } catch {
      continue
    }
    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const entry of entries) {
      if (out.length >= limit) break
      if (shouldSkip(entry)) continue
      if (entry.kind === 'dir') {
        queue.push(entry.path)
      } else if (isMarkdownPath(entry.name)) {
        out.push(entry.path)
      }
    }
  }
  return out
}

export async function openWorkspaceFolder(): Promise<string | null> {
  const host = getHost()
  try {
    const picked = await host.dialog.open({ directory: true, multiple: false })
    const first = picked[0]
    if (!first) return null
    return first.path
  } catch (error) {
    console.error('[markup] open folder failed', error)
    await host.dialog
      .message({ title: 'Markup', message: `打开文件夹失败：${String(error)}` })
      .catch(() => undefined)
    return null
  }
}

export interface GlobalSearchOptions {
  query: string
  caseSensitive: boolean
  useRegex: boolean
  paths: string[]
}

function buildMatcher(options: GlobalSearchOptions): ((line: string) => { index: number; length: number }[]) | null {
  const { query, caseSensitive, useRegex } = options
  if (!query) return null

  if (useRegex) {
    let re: RegExp
    try {
      re = new RegExp(query, caseSensitive ? 'g' : 'gi')
    } catch {
      return null
    }
    return (line) => {
      const hits: { index: number; length: number }[] = []
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(line)) !== null) {
        hits.push({ index: m.index, length: Math.max(m[0].length, 1) })
        if (m[0].length === 0) re.lastIndex += 1
        if (hits.length > 20) break
      }
      return hits
    }
  }

  const needle = caseSensitive ? query : query.toLowerCase()
  return (line) => {
    const hay = caseSensitive ? line : line.toLowerCase()
    const hits: { index: number; length: number }[] = []
    let from = 0
    while (from <= hay.length) {
      const idx = hay.indexOf(needle, from)
      if (idx < 0) break
      hits.push({ index: idx, length: needle.length })
      from = idx + Math.max(needle.length, 1)
      if (hits.length > 20) break
    }
    return hits
  }
}

export async function searchInFiles(options: GlobalSearchOptions): Promise<SearchHit[]> {
  const host = getHost()
  const matchLine = buildMatcher(options)
  if (!matchLine) return []

  const hits: SearchHit[] = []
  const paths = options.paths.slice(0, MAX_SEARCH_FILES)

  for (const path of paths) {
    if (hits.length >= MAX_SEARCH_HITS) break
    let content: string
    try {
      const file = await host.fs.read(path)
      content = file.content
    } catch {
      continue
    }
    if (content.length > MAX_READ_BYTES) content = content.slice(0, MAX_READ_BYTES)
    const lines = content.split('\n')
    let offset = 0
    for (let i = 0; i < lines.length; i++) {
      if (hits.length >= MAX_SEARCH_HITS) break
      const line = lines[i] ?? ''
      const matches = matchLine(line)
      for (const m of matches) {
        if (hits.length >= MAX_SEARCH_HITS) break
        hits.push({
          path,
          line: i + 1,
          column: m.index + 1,
          offset: offset + m.index,
          length: m.length,
          preview: line.trim().slice(0, 200),
        })
      }
      offset += line.length + 1
    }
  }
  return hits
}

export function collectSearchTargets(
  workspace: WorkspaceState,
  recents: string[],
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (path: string): void => {
    if (!path || seen.has(path) || !isMarkdownPath(path)) return
    seen.add(path)
    out.push(path)
  }
  for (const path of workspace.files) push(path)
  for (const path of recents) push(path)
  return out
}

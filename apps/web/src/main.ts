import { boot, showHostMessage } from '@markup/ui'
import type {
  AppConfig,
  DirEntry,
  FileResult,
  FsEvent,
  HostAPI,
  HostEvent,
  HostEventMap,
  MessageOptions,
  MessageResult,
  OpenDialogOptions,
  PathInfo,
} from '@markup/host-api'
import { embedMimeForPath } from '@markup/host-api'

const CONFIG_KEY = 'markup.web.config'

const DEFAULT_CONFIG: AppConfig = {
  theme: 'system',
  fontSize: 16,
  lineWidth: 780,
  recentDocuments: [],
}

const webFiles = new Map<string, File>()
const webIndex = new Map<string, { kind: 'file' } | { kind: 'dir'; children: Set<string> }>()
let webFileSeq = 0

function baseName(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? path : path.slice(index + 1)
}

function parentPath(path: string): string {
  const index = path.lastIndexOf('/')
  return index <= 0 ? '' : path.slice(0, index)
}

function ensureDir(path: string): void {
  if (!path) return
  const existing = webIndex.get(path)
  if (existing) return
  webIndex.set(path, { kind: 'dir', children: new Set() })
  const parent = parentPath(path)
  if (parent && parent !== path) {
    ensureDir(parent)
    const parentNode = webIndex.get(parent)
    if (parentNode?.kind === 'dir') parentNode.children.add(baseName(path))
  }
}

function registerWebFile(fullPath: string, file: File): void {
  const parent = parentPath(fullPath)
  if (parent) ensureDir(parent)
  webFiles.set(fullPath, file)
  webIndex.set(fullPath, { kind: 'file' })
  if (parent) {
    const parentNode = webIndex.get(parent)
    if (parentNode?.kind === 'dir') parentNode.children.add(baseName(fullPath))
  }
}

function pickFiles(options: OpenDialogOptions): Promise<PathInfo[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    if (options.multiple) input.multiple = true
    if (options.directory) input.setAttribute('webkitdirectory', '')
    const exts = (options.filters ?? []).flatMap((f) => f.extensions).map((e) => `.${e}`)
    if (exts.length && !options.directory) input.accept = exts.join(',')
    let settled = false
    const settle = (paths: PathInfo[]): void => {
      if (settled) return
      settled = true
      input.remove()
      resolve(paths)
    }
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? [])
      if (options.directory && files.length > 0) {
        const seq = webFileSeq++
        const firstRel = files[0]?.webkitRelativePath || files[0]?.name || 'folder'
        const rootName = firstRel.split('/')[0] || 'folder'
        const root = `webfs:${seq}/${rootName}`
        for (const file of files) {
          const rel = file.webkitRelativePath || file.name
          registerWebFile(`webfs:${seq}/${rel}`, file)
        }
        ensureDir(root)
        settle([{ path: root }])
        return
      }
      settle(
        files.map((file) => {
          const key = `web:${webFileSeq++}:${file.name}`
          registerWebFile(key, file)
          return { path: key }
        }),
      )
    })
    input.addEventListener('cancel', () => settle([]))
    document.body.append(input)
    input.click()
  })
}

function createWebHost(): HostAPI {
  return {
    platform: 'web',
    fs: {
      read: async (path: string): Promise<FileResult> => {
        const file = webFiles.get(path)
        if (!file) throw new Error(`web host: 未找到文件 ${path}`)
        const content = await file.text()
        return {
          path,
          content,
          encoding: 'utf8',
          crlf: content.includes('\r\n'),
          bom: content.charCodeAt(0) === 0xfeff,
        }
      },
      write: () => Promise.reject(new Error('web host 不支持 fs.write')),
      readDir: async (path: string): Promise<DirEntry[]> => {
        const entry = webIndex.get(path)
        if (!entry || entry.kind !== 'dir') {
          throw new Error(`web host: 不是目录或不存在 ${path}`)
        }
        return [...entry.children].sort().map((name) => {
          const childPath = `${path}/${name}`
          const child = webIndex.get(childPath)
          return {
            name,
            path: childPath,
            kind: child?.kind === 'dir' ? ('dir' as const) : ('file' as const),
            size: 0,
            mtime: 0,
          }
        })
      },
      watch: (_path: string, _listener: (event: FsEvent) => void): (() => void) => () => {},
      readBase64: async (path: string): Promise<string> => {
        const file = webFiles.get(path)
        if (!file) throw new Error(`web host: 未找到文件 ${path}`)
        const bytes = new Uint8Array(await file.arrayBuffer())
        let binary = ''
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        }
        return `data:${embedMimeForPath(path)};base64,${btoa(binary)}`
      },
    },
    dialog: {
      open: (options: OpenDialogOptions): Promise<PathInfo[]> => pickFiles(options),
      save: () => Promise.resolve(null),
      message: (options: MessageOptions): Promise<MessageResult> => showHostMessage(options),
    },
    app: {
      openExternal: (url: string): Promise<void> => {
        window.open(url, '_blank')
        return Promise.resolve()
      },
      setTitle: (title: string): void => {
        document.title = title
      },
      getConfig: async (): Promise<AppConfig> => {
        const raw = localStorage.getItem(CONFIG_KEY)
        const parsed = raw ? (JSON.parse(raw) as Partial<AppConfig>) : {}
        return { ...DEFAULT_CONFIG, ...parsed }
      },
      setConfig: (config: AppConfig): void => {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
      },
      on: <E extends HostEvent>(event: E, listener: (payload: HostEventMap[E]) => void) => {
        if (event !== 'os-theme') return () => {}
        if (typeof window.matchMedia !== 'function') return () => {}
        const mq = window.matchMedia('(prefers-color-scheme: dark)')
        const handler = (): void => {
          ;(listener as (payload: 'light' | 'dark') => void)(mq.matches ? 'dark' : 'light')
        }
        mq.addEventListener('change', handler)
        return () => mq.removeEventListener('change', handler)
      },
      print: async (html?: string): Promise<boolean> => {
        if (html) {
          const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
          const url = URL.createObjectURL(blob)
          const win = window.open(url, '_blank')
          if (!win) {
            URL.revokeObjectURL(url)
            return false
          }
          win.addEventListener('load', () => {
            win.print()
            setTimeout(() => URL.revokeObjectURL(url), 60_000)
          })
          return true
        }
        window.print()
        return true
      },
    },
  }
}

void boot(createWebHost())
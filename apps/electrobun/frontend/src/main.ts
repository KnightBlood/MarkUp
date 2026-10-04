import { Electroview } from 'electrobun/view'
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
  SaveDialogOptions,
} from '@markup/host-api'
import type { AppRPC, HostEventEnvelope } from '../../shared/rpc'

// One typed channel up (host methods) and one down (`host-event`), which is
// exactly the shape the other shells get from their single IPC channel.
const rpc = Electroview.defineRPC<AppRPC>({
  // fs reads can block on antivirus scans; Electrobun's default RPC budget is 1s.
  maxRequestTime: 30_000,
  handlers: {
    requests: {},
    messages: {
      'host-event': (envelope: HostEventEnvelope) => dispatchHostEvent(envelope),
    },
  },
})

new Electroview({ rpc })

const listeners = new Map<HostEvent, Set<(payload: never) => void>>()

function dispatchHostEvent(envelope: HostEventEnvelope): void {
  const set = listeners.get(envelope.event)
  if (!set) return
  for (const listener of set) listener(envelope.payload as never)
}

function addListener<E extends HostEvent>(
  event: E,
  listener: (payload: HostEventMap[E]) => void,
): void {
  let set = listeners.get(event)
  if (!set) {
    set = new Set()
    listeners.set(event, set)
  }
  set.add(listener as (payload: never) => void)
}

function removeListener<E extends HostEvent>(
  event: E,
  listener: (payload: HostEventMap[E]) => void,
): void {
  listeners.get(event)?.delete(listener as (payload: never) => void)
}

/**
 * Electrobun exposes no OS theme signal to the main process, and `os-theme` is
 * the one host event the view can observe on its own — so this shell reports
 * it from `matchMedia` instead of the host.
 */
let themeWatcher: (() => void) | null = null

function ensureThemeWatcher(): void {
  if (themeWatcher) return
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const push = (): void => {
    dispatchHostEvent({ event: 'os-theme', payload: media.matches ? 'dark' : 'light' })
  }
  media.addEventListener('change', push)
  // Report the boot-time value on the next tick: `on()` is still registering
  // its listener when this runs and the handlers expect async delivery.
  queueMicrotask(push)
  themeWatcher = () => media.removeEventListener('change', push)
}

function printHtml(html?: string): Promise<boolean> {
  if (!html) return Promise.resolve(false)
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  if (!win) {
    URL.revokeObjectURL(url)
    return Promise.resolve(false)
  }
  win.addEventListener('load', () => {
    win.print()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  })
  return Promise.resolve(true)
}

function createElectrobunHost(): HostAPI {
  return {
    platform: 'electrobun',
    fs: {
      read: (path: string): Promise<FileResult> => rpc.request.fsRead(path),
      write: (path: string, content: string): Promise<void> =>
        rpc.request.fsWrite({ path, content }),
      readDir: (path: string): Promise<DirEntry[]> => rpc.request.fsReadDir(path),
      readBase64: (path: string): Promise<string> => rpc.request.fsReadBase64(path),
      watch: (path: string, listener: (event: FsEvent) => void): (() => void) => {
        void rpc.request.fsWatch(path).catch((error) => {
          console.warn('[markup] watch failed:', path, error)
        })
        addListener('fs-changed', listener)
        return () => {
          removeListener('fs-changed', listener)
          void rpc.request.fsUnwatch(path).catch(() => {})
        }
      },
    },
    dialog: {
      open: (options: OpenDialogOptions): Promise<PathInfo[]> =>
        rpc.request.dialogOpen(options),
      save: (options: SaveDialogOptions): Promise<PathInfo | null> =>
        rpc.request.dialogSave(options),
      // Native boxes are out: every shell answers with the shared in-app
      // <dialog>, so this one needs no round trip at all.
      message: (options: MessageOptions): Promise<MessageResult> => showHostMessage(options),
    },
    app: {
      openExternal: (url: string): Promise<void> => rpc.request.appOpenExternal(url),
      setTitle: (title: string): void => {
        void rpc.request.appSetTitle(title)
      },
      openDevTools: (): void => {
        void rpc.request.appOpenDevTools()
      },
      getConfig: (): Promise<AppConfig> => rpc.request.appGetConfig(),
      setConfig: (config: AppConfig): void => {
        void rpc.request.appSetConfig(config)
      },
      getPath: (name: 'plugins' | 'pluginsLocal' | 'userData'): Promise<string | null> =>
        rpc.request.appGetPath(name),
      on: <E extends HostEvent>(event: E, listener: (payload: HostEventMap[E]) => void) => {
        addListener(event, listener)
        if (event === 'os-theme') ensureThemeWatcher()
        return () => removeListener(event, listener)
      },
      print: (html?: string): Promise<boolean> => printHtml(html),
    },
    window: {
      minimize: (): void => {
        void rpc.request.winMinimize()
      },
      toggleMaximize: (): void => {
        void rpc.request.winToggleMaximize()
      },
      close: (): void => {
        void rpc.request.winClose()
      },
      // The shell vetoes every native close and asks first via `close-request`;
      // this is the answer that lets the window actually go away.
      confirmClose: (): void => {
        void rpc.request.winConfirmClose()
      },
      isMaximized: (): Promise<boolean> => rpc.request.winIsMaximized(),
    },
  }
}

void boot(createElectrobunHost())

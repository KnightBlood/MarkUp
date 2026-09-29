import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { boot, showHostMessage } from '@markup/ui'
import type {
  AppConfig,
  DirEntry,
  FileResult,
  FsEvent,
  HostAPI,
  MessageOptions,
  MessageResult,
  OpenDialogOptions,
  PathInfo,
  SaveDialogOptions,
} from '@markup/host-api'

interface HostMessage {
  event: string
  payload: unknown
}

function createTauriHost(): HostAPI {
  return {
    platform: 'tauri',
    fs: {
      read: (path: string): Promise<FileResult> => invoke('read_file', { path }),
      write: (path: string, content: string): Promise<void> => invoke('write_file', { path, content }),
      readDir: (path: string): Promise<DirEntry[]> => invoke('read_dir', { path }),
      readBase64: (path: string): Promise<string> => invoke('read_base64', { path }),
      watch: (path: string, listener: (event: FsEvent) => void): (() => void) => {
        let off: (() => void) | null = null
        void listen<HostMessage>('host-event', (event) => {
          if (event.payload.event === 'fs-changed') listener(event.payload.payload as FsEvent)
        }).then((unlisten) => {
          off = unlisten
        })
        void invoke('fs_watch', { path })
        return () => off?.()
      },
    },
    dialog: {
      open: (options: OpenDialogOptions): Promise<PathInfo[]> => invoke('open_dialog', { options }),
      save: (options: SaveDialogOptions): Promise<PathInfo | null> => invoke('save_dialog', { options }),
      message: (options: MessageOptions): Promise<MessageResult> => showHostMessage(options),
    },
    app: {
      openExternal: (url: string): Promise<void> => invoke('open_external', { url }),
      setTitle: (title: string): void => {
        document.title = title
        void invoke('set_title', { title })
      },
      openDevTools: (): void => {
        void invoke('open_devtools')
      },
      getConfig: (): Promise<AppConfig> => invoke('get_config'),
      setConfig: (config: AppConfig): void => {
        void invoke('set_config', { config })
      },
      getPath: (name: 'plugins' | 'pluginsLocal' | 'userData'): Promise<string | null> =>
        invoke('get_path', { name }),
      on: (event, listener) => {
        let off: (() => void) | null = null
        void listen<HostMessage>('host-event', (e) => {
          if (e.payload.event === event) listener(e.payload.payload as never)
        }).then((unlisten) => {
          off = unlisten
        })
        return () => off?.()
      },
      print: async (html?: string): Promise<boolean> => {
        if (!html) return false
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
      },
    },
    window: {
      minimize: () => void invoke('window_minimize'),
      toggleMaximize: () => void invoke('window_toggle_maximize'),
      close: () => void invoke('window_close'),
    },
  }
}

void boot(createTauriHost())
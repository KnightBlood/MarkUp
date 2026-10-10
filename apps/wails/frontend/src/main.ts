import { Call, Dialogs, Events, Window } from '@wailsio/runtime'
import { boot, showHostMessage } from '@markup/ui'
import type {
  AppConfig,
  ConvertRequest,
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

// FQN = packagePath.TypeName.MethodName (see wails Bindings.Get / generator templates).
const HOST = 'github.com/markup/markup-wails/services.HostService'

function toPathInfos(value: string | string[] | undefined): PathInfo[] {
  if (!value) return []
  if (Array.isArray(value)) return value.filter(Boolean).map((path) => ({ path }))
  return value ? [{ path: value }] : []
}

function createWailsHost(): HostAPI {
  return {
    platform: 'wails',
    fs: {
      read: (path: string): Promise<FileResult> => Call.ByName(`${HOST}.ReadFile`, path),
      write: (path: string, content: string): Promise<void> => Call.ByName(`${HOST}.WriteFile`, path, content),
      readDir: (path: string): Promise<DirEntry[]> => Call.ByName(`${HOST}.ReadDir`, path),
      readBase64: (path: string): Promise<string> => Call.ByName(`${HOST}.ReadBase64`, path),
      watch: (path: string, listener: (event: FsEvent) => void): (() => void) => {
        // Go polls the directory (services.HostService.Watch) and emits fs-changed.
        void Call.ByName(`${HOST}.Watch`, path).catch((error) => {
          console.warn('[markup] watch failed:', path, error)
        })
        const off = Events.On('host-event', (ev) => {
          const data = ev.data as { event?: string; payload?: unknown } | null
          if (data && data.event === 'fs-changed') {
            listener(data.payload as FsEvent)
          }
        })
        return () => {
          void Call.ByName(`${HOST}.Unwatch`, path).catch(() => {})
          off()
        }
      },
    },
    dialog: {
      open: async (options: OpenDialogOptions): Promise<PathInfo[]> => {
        const filters = (options.filters ?? []).map((filter) => ({
          DisplayName: filter.name,
          Pattern: filter.extensions.map((ext) => `*.${ext}`).join(';'),
        }))
        const picked = await Dialogs.OpenFile({
          CanChooseDirectories: options.directory === true,
          CanChooseFiles: options.directory !== true,
          AllowsMultipleSelection: options.multiple === true,
          Directory: options.defaultPath,
          Filters: filters,
          Title: options.directory ? '打开文件夹' : '打开',
        })
        return toPathInfos(picked as string | string[] | undefined)
      },
      save: async (options: SaveDialogOptions): Promise<PathInfo | null> => {
        const picked = await Dialogs.SaveFile({
          Filename: options.defaultPath ?? options.defaultExt ?? '',
          CanChooseDirectories: false,
          CanChooseFiles: true,
          CanCreateDirectories: true,
          Filters: (options.filters ?? []).map((filter) => ({
            DisplayName: filter.name,
            Pattern: filter.extensions.map((ext) => `*.${ext}`).join(';'),
          })),
          Title: '保存为',
        })
        if (!picked) return null
        return { path: picked }
      },
      message: (options: MessageOptions): Promise<MessageResult> => showHostMessage(options),
    },
    app: {
      openExternal: (_url: string): Promise<void> => Promise.resolve(),
      setTitle: (title: string): void => {
        void Window.SetTitle(title)
      },
      openDevTools: (): void => {
        void Call.ByName(`${HOST}.OpenDevTools`).catch(() => {})
      },
      getConfig: (): Promise<AppConfig> => Call.ByName(`${HOST}.GetConfig`),
      setConfig: (config: AppConfig): Promise<void> => Call.ByName(`${HOST}.SetConfig`, config),
      getPath: (name: 'plugins' | 'pluginsLocal' | 'userData'): Promise<string | null> =>
        Call.ByName(`${HOST}.GetPath`, name),
      // 文档转换 — formats only; Go decides whether pandoc or carta runs.
      converter: () => Call.ByName(`${HOST}.ConverterInfo`),
      convert: (request: ConvertRequest) => Call.ByName(`${HOST}.ConvertDocument`, request),
      on: (event, listener) => {
        // Go emits a single "host-event" channel with { event, payload }.
        // Listen once per HostEvent name and unwrap by nested event field.
        return Events.On('host-event', (ev) => {
          const data = ev.data as { event?: string; payload?: unknown } | null
          if (data && data.event === event) {
            listener(data.payload as never)
          }
        })
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
      minimize: () => void Call.ByName(`${HOST}.WindowMinimize`).catch(() => {}),
      toggleMaximize: () => void Call.ByName(`${HOST}.WindowToggleMaximize`).catch(() => {}),
      close: () => void Call.ByName(`${HOST}.WindowClose`).catch(() => {}),
    },
  }
}

void boot(createWailsHost())
/**
 * Electrobun main process (Bun).
 *
 * Contract parity with the other four shells:
 *  - serves the 13 required {@link HostAPI} methods over Electrobun's typed
 *    view <-> bun RPC (`shared/rpc.ts`),
 *  - forwards every host event on a single `host-event` channel,
 *  - consumes `menu.json` for OS-level shortcuts,
 *  - never installs a native menu bar (see `hideNativeMenuBar` below),
 *  - intercepts window close and asks the app first via `close-request`.
 */
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

import { BrowserWindow } from 'electrobun/main/browser-window'
import { GlobalShortcut } from 'electrobun/main/native'
import { defineElectrobunRPC } from 'electrobun/main/rpc'
import events from 'electrobun/main/events'
import { openExternal, openFileDialog } from 'electrobun/main/utils'

import { embedMimeForPath } from '../../../../packages/host-api/src/mime'
import type {
  AppConfig,
  DirEntry,
  FileResult,
  HostEvent,
  HostEventMap,
  HostMenuData,
  OpenDialogOptions,
  PathInfo,
  SaveDialogOptions,
} from '../../../../packages/host-api/src/types'
import menuData from '../../menu.json'
import type { AppRPC } from '../../shared/rpc'
import { saveFileDialog } from './saveDialog'

// JSON import infers wide `string` kinds; content validated by pm-l-menu smoke.
const menu = menuData as unknown as HostMenuData

const watchers = new Map<string, FSWatcher>()

/**
 * `beforeunload`/`will-close` cannot prompt from inside an Electron-family
 * webview — it either silently cancels or silently closes. Electrobun's native
 * side asks `will-close` synchronously and closes unless the handler vetoes, so
 * the shell always vetoes, forwards `close-request`, and closes for real only
 * once the app answered `window.confirmClose()`.
 */
let allowClose = false
let mainWindow: BrowserWindow | null = null

const rpc = defineElectrobunRPC<AppRPC, 'bun'>('bun', {
  // Fs reads can hit cold antivirus scans; the default 1s RPC budget is too
  // tight for a desktop editor.
  maxRequestTime: 30_000,
  handlers: {
    requests: {
      fsRead: async (path: string): Promise<FileResult> => {
        const buffer = await readFile(path)
        const bom =
          buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
        const body = bom ? buffer.subarray(3) : buffer
        const content = body.toString('utf8')
        return { path, content, encoding: 'utf8', crlf: content.includes('\r\n'), bom }
      },
      fsWrite: ({ path, content }: { path: string; content: string }): Promise<void> =>
        writeFile(path, content, 'utf8'),
      fsReadDir: async (path: string): Promise<DirEntry[]> => {
        const entries = await readdir(path, { withFileTypes: true })
        return Promise.all(
          entries.map(async (entry) => {
            const child = join(path, entry.name)
            let size = 0
            let mtime = 0
            try {
              const info = await stat(child)
              size = info.size
              mtime = info.mtimeMs
            } catch {
              size = 0
              mtime = 0
            }
            return {
              name: entry.name,
              path: child,
              kind: entry.isDirectory() ? ('dir' as const) : ('file' as const),
              size,
              mtime,
            }
          }),
        )
      },
      fsWatch: (path: string): void => {
        if (watchers.has(path)) return
        try {
          const watcher = watch(path, { recursive: false }, (eventKind, filename) => {
            emitHostEvent('fs-changed', {
              kind: eventKind === 'rename' ? 'remove' : 'change',
              path: filename ? join(path, filename.toString()) : path,
            })
          })
          watchers.set(path, watcher)
        } catch (error) {
          console.warn('[markup] fs.watch failed:', path, error)
        }
      },
      fsUnwatch: (path: string): void => {
        const watcher = watchers.get(path)
        if (!watcher) return
        watcher.close()
        watchers.delete(path)
      },
      fsReadBase64: async (path: string): Promise<string> => {
        const buffer = await readFile(path)
        return `data:${embedMimeForPath(path)};base64,${buffer.toString('base64')}`
      },
      dialogOpen: async (options: OpenDialogOptions): Promise<PathInfo[]> => {
        // `openFileDialog` spreads its defaults with the caller's object, so a
        // key present with value `undefined` would clobber the SDK defaults
        // (`"~/"`, `"*"`) — only set them when we actually have a value.
        const request: Parameters<typeof openFileDialog>[0] = {
          canChooseFiles: options.directory !== true,
          canChooseDirectory: options.directory === true,
          allowsMultipleSelection: options.multiple === true,
        }
        if (options.defaultPath) request.startingFolder = dirname(options.defaultPath)
        const allowed = toAllowedFileTypes(options.filters)
        if (allowed) request.allowedFileTypes = allowed
        const paths = await openFileDialog(request)
        return paths.filter(Boolean).map((path) => ({ path }))
      },
      dialogSave: (options: SaveDialogOptions): PathInfo | null => {
        const path = saveFileDialog(options)
        return path ? { path } : null
      },
      appOpenExternal: (url: string): void => {
        openExternal(url)
      },
      appSetTitle: (title: string): void => {
        mainWindow?.setTitle(title)
      },
      appOpenDevTools: (): void => {
        mainWindow?.webview.openDevTools()
      },
      appGetConfig: (): AppConfig => loadConfig(),
      appSetConfig: (config: AppConfig): void => saveConfig(config),
      appGetPath: (name: 'plugins' | 'pluginsLocal' | 'userData'): string | null => {
        if (name === 'pluginsLocal') return join(dirname(process.execPath), 'plugins')
        if (name === 'plugins') {
          const dir = join(homedir(), '.markup', 'plugins')
          mkdirSync(dir, { recursive: true })
          return dir
        }
        return configDir()
      },
      winMinimize: (): void => {
        mainWindow?.minimize()
      },
      winToggleMaximize: (): void => {
        if (!mainWindow) return
        if (mainWindow.isMaximized()) mainWindow.unmaximize()
        else mainWindow.maximize()
      },
      winClose: (): void => {
        mainWindow?.close()
      },
      winConfirmClose: (): void => {
        allowClose = true
        mainWindow?.close()
      },
      winIsMaximized: (): boolean => mainWindow?.isMaximized() ?? false,
    },
    messages: {},
  },
})

function emitHostEvent<E extends HostEvent>(event: E, payload: HostEventMap[E]): void {
  try {
    rpc.send['host-event']({ event, payload })
  } catch (error) {
    console.warn('[markup] host event dropped:', event, error)
  }
}

function toAllowedFileTypes(filters: OpenDialogOptions['filters']): string | undefined {
  const extensions = (filters ?? []).flatMap((filter) => filter.extensions)
  if (extensions.length === 0) return undefined
  return extensions.map((ext) => ext.replace(/^\./, '')).join(',')
}

function configDir(): string {
  return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Markup')
}

function configFilePath(): string {
  return join(configDir(), 'config.json')
}

function loadConfig(): AppConfig {
  try {
    const file = configFilePath()
    if (existsSync(file)) {
      return JSON.parse(readFileSync(file, 'utf8')) as AppConfig
    }
  } catch {
    void 0
  }
  return { theme: 'system', fontSize: 16, lineWidth: 780, recentDocuments: [] }
}

function saveConfig(config: AppConfig): void {
  const file = configFilePath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(config, null, 2))
}

/** OS-level shortcuts (fire while the window is unfocused), from `menu.json`. */
function registerGlobalShortcuts(): void {
  for (const shortcut of menu.globalShortcuts) {
    try {
      const ok = GlobalShortcut.register(shortcut.accelerator, () => {
        emitHostEvent('global-shortcut', shortcut.commandId)
      })
      if (!ok) console.warn('[markup] global shortcut unavailable:', shortcut.accelerator)
    } catch (error) {
      console.error('[markup] global shortcut failed:', shortcut.accelerator, error)
    }
  }
}

function createWindow(): void {
  const devUrl = process.env.MARKUP_DEVSERVER_URL
  allowClose = false
  mainWindow = new BrowserWindow({
    title: 'Markup',
    url: devUrl || 'views://app/index.html',
    frame: { width: 1200, height: 800 },
    titleBarStyle: 'default',
    rpc,
  })
}

function installWindowListeners(): void {
  events.on('focus', () => emitHostEvent('window-focus', true))
  events.on('blur', () => emitHostEvent('window-focus', false))

  events.on('will-close', (event) => {
    const closeEvent = event as {
      response?: { allow: boolean }
      responseWasSet?: boolean
    }
    // Veto synchronously so Electrobun never reaches `closeWindow`, then ask
    // the app; `winConfirmClose` closes for real without re-entering here.
    closeEvent.response = { allow: false }
    emitHostEvent('close-request', undefined)
  })

  events.on('close', () => {
    mainWindow = null
    for (const [path, watcher] of watchers) {
      watcher.close()
      watchers.delete(path)
    }
    GlobalShortcut.unregisterAll()
  })
}

/*
 * HIDE_NATIVE_MENU_BAR: the other shells install the menu from `menu.json` and
 * then hide the native bar (Electron `setMenuBarVisibility(false)`, Wails
 * `HideMenuBar`, Tauri `hide_menu`) so the in-app menubar stays the single
 * menu while native accelerators keep working. Electrobun offers no equivalent
 * — `libNativeWrapper.dll` grows an `HMENU` only through `setApplicationMenu`,
 * and that call has no visibility flag — so this shell never calls it and
 * there is no native menu bar to hide. Local accelerators keep working because
 * `packages/ui` dispatches them from its own `CommandRegistry`, exactly as the
 * `web` shell does; OS-level ones come from `menu.globalShortcuts` below.
 */
installWindowListeners()
createWindow()
registerGlobalShortcuts()

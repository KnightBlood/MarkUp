import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeTheme,
  shell,
  type OpenDialogOptions as ElectronOpenDialogOptions,
} from 'electron'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  watch as fsWatch,
  type FSWatcher,
} from 'node:fs'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { HOST_EVENT_CHANNEL, IPC_CHANNELS } from '../../shared/ipc'
import menuData from '../../shared/menu.json'
import type {
  AppConfig,
  DirEntry,
  FileResult,
  FsEvent,
  HostMenuData,
  OpenDialogOptions,
  PathInfo,
} from '@markup/host-api'
import { embedMimeForPath } from '@markup/host-api'

// JSON import infers wide `string` kinds; structure validated by pm-l-menu smoke.
const menu = menuData as unknown as HostMenuData

let mainWindow: BrowserWindow | null = null
const watchers = new Map<string, FSWatcher>()
/**
 * Set once the renderer answered the close prompt. `beforeunload` is a no-op
 * in Electron (it silently cancels the close, never prompts), so the shell
 * intercepts `close`, asks the app via `close-request`, and only closes for
 * real when the app calls `window.confirmClose()`.
 */
let allowClose = false

function emitHostEvent(payload: { event: string; payload: unknown }): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(HOST_EVENT_CHANNEL, payload)
  }
}

async function readFileResult(path: string): Promise<FileResult> {
  const buffer = await readFile(path)
  const bom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
  const body = bom ? buffer.subarray(3) : buffer
  const content = body.toString('utf8')
  return { path, content, encoding: 'utf8', crlf: content.includes('\r\n'), bom }
}

async function listDir(path: string): Promise<DirEntry[]> {
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
}

function configFilePath(): string {
  return join(app.getPath('userData'), 'config.json')
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

function buildOpenProperties(options: OpenDialogOptions): ElectronOpenDialogOptions['properties'] {
  const properties: ElectronOpenDialogOptions['properties'] = []
  if (options.multiple) properties.push('multiSelections')
  if (options.directory) {
    properties.push('openDirectory')
  } else {
    properties.push('openFile')
  }
  return properties
}

function registerHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.fsRead, (_event, path: string) => readFileResult(path))
  ipcMain.handle(IPC_CHANNELS.fsWrite, (_event, path: string, content: string) => writeFile(path, content, 'utf8'))
  ipcMain.handle(IPC_CHANNELS.fsReadDir, (_event, path: string) => listDir(path))
  ipcMain.handle(IPC_CHANNELS.fsReadBase64, async (_event, path: string) => {
    const buffer = await readFile(path)
    return `data:${embedMimeForPath(path)};base64,${buffer.toString('base64')}`
  })
  ipcMain.handle(IPC_CHANNELS.fsWatch, (_event, dir: string) => {
    const watcher = fsWatch(dir, { recursive: false }, (eventKind, filename) => {
      const event: FsEvent = {
        kind: eventKind === 'rename' ? 'remove' : 'change',
        path: filename ? join(dir, filename.toString()) : dir,
      }
      emitHostEvent({ event: 'fs-changed', payload: event })
    })
    watchers.set(dir, watcher)
  })

  ipcMain.handle(IPC_CHANNELS.dlOpen, async (_event, options: OpenDialogOptions) => {
    const result = await dialog.showOpenDialog({
      title: '打开',
      defaultPath: options.defaultPath,
      filters: options.filters,
      properties: buildOpenProperties(options),
    })
    const paths: PathInfo[] = result.filePaths.map((path) => ({ path }))
    return paths
  })

  ipcMain.handle(IPC_CHANNELS.dlSave, async (_event, options: OpenDialogOptions) => {
    const result = await dialog.showSaveDialog({
      title: '保存为',
      defaultPath: options.defaultPath,
      filters: options.filters,
    })
    if (result.canceled || !result.filePath) return null
    return { path: result.filePath } satisfies PathInfo
  })

  ipcMain.handle(IPC_CHANNELS.appOpenExternal, (_event, url: string) => shell.openExternal(url))
  ipcMain.handle(IPC_CHANNELS.appOpenDevTools, () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.openDevTools({ mode: 'detach' })
  })
  ipcMain.handle(IPC_CHANNELS.appSetTitle, (_event, title: string) => {
    mainWindow?.setTitle(title)
  })
  ipcMain.handle(IPC_CHANNELS.appGetConfig, () => loadConfig())
  ipcMain.handle(IPC_CHANNELS.appSetConfig, (_event, config: AppConfig) => saveConfig(config))
  ipcMain.handle(IPC_CHANNELS.appGetPath, (_event, name: string) => {
    if (name === 'pluginsLocal') return join(dirname(process.execPath), 'plugins')
    if (name !== 'plugins' && name !== 'userData') return null
    const dir =
      name === 'userData' ? app.getPath('userData') : join(app.getPath('home'), '.markup', 'plugins')
    mkdirSync(dir, { recursive: true })
    return dir
  })
  ipcMain.handle(IPC_CHANNELS.appPrint, async (_event, html?: string) => {
    if (html) return printHtmlDocument(html)
    if (!mainWindow || mainWindow.isDestroyed()) return false
    mainWindow.webContents.print()
    return true
  })
  ipcMain.handle(IPC_CHANNELS.appExportPdf, async (_event, path: string, html: string) => {
    const buffer = await renderHtmlToPdf(html)
    await writeFile(path, buffer)
    return true
  })
  ipcMain.handle(IPC_CHANNELS.winMinimize, () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize()
  })
  ipcMain.handle(IPC_CHANNELS.winToggleMaximize, () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.handle(IPC_CHANNELS.winClose, () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close()
  })
  ipcMain.handle(IPC_CHANNELS.winConfirmClose, () => {
    allowClose = true
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close()
  })
}

async function loadHtmlInHiddenWindow(html: string): Promise<BrowserWindow> {
  const hidden = new BrowserWindow({ show: false, width: 900, height: 1200 })
  await hidden.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  return hidden
}

async function printHtmlDocument(html: string): Promise<boolean> {
  const hidden = await loadHtmlInHiddenWindow(html)
  try {
    await new Promise<void>((resolve) => {
      hidden.webContents.print({ silent: false, printBackground: true }, (_ok, reason) => {
        if (reason && reason !== 'cancelled') console.error('[markup] print failed', reason)
        resolve()
      })
    })
    return true
  } finally {
    if (!hidden.isDestroyed()) hidden.destroy()
  }
}

async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const hidden = await loadHtmlInHiddenWindow(html)
  try {
    return await hidden.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
    })
  } finally {
    if (!hidden.isDestroyed()) hidden.destroy()
  }
}

function sendMenuCommand(commandId: string): void {
  emitHostEvent({ event: 'menu-command', payload: commandId })
}

function emitOsTheme(): void {
  emitHostEvent({
    event: 'os-theme',
    payload: nativeTheme.shouldUseDarkColors ? ('dark' as const) : ('light' as const),
  })
}

/** OS-level shortcuts (work when the window is unfocused). Payload = command id. */
function registerGlobalShortcuts(): void {
  for (const shortcut of menu.globalShortcuts) {
    try {
      const ok = globalShortcut.register(shortcut.accelerator, () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (!mainWindow.isFocused()) mainWindow.focus()
        }
        emitHostEvent({ event: 'global-shortcut', payload: shortcut.commandId })
      })
      if (!ok) console.warn('[markup] global shortcut unavailable:', shortcut.accelerator)
    } catch (error) {
      console.error('[markup] global shortcut failed:', shortcut.accelerator, error)
    }
  }
}

function buildApplicationMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = []
  for (const section of menu.menu) {
    const submenu: Electron.MenuItemConstructorOptions[] = []
    for (const item of section.items) {
      switch (item.kind) {
        case 'separator':
          submenu.push({ type: 'separator' })
          break
        case 'command':
          submenu.push({ label: item.label, click: () => sendMenuCommand(item.id) })
          break
        case 'checkbox':
          submenu.push({
            label: item.label,
            type: 'checkbox',
            click: (menuItem) => sendMenuCommand(menuItem.checked ? item.on : item.off),
          })
          break
        case 'action':
          if (item.id === 'quit') {
            submenu.push(
              process.platform === 'darwin'
                ? { role: 'close' }
                : { label: item.label, accelerator: item.accelerator, role: 'quit' },
            )
          } else if (item.id === 'reload') {
            submenu.push({ label: item.label, accelerator: item.accelerator, role: 'reload' })
          } else {
            submenu.push({
              label: item.label,
              accelerator: item.accelerator,
              click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.toggleDevTools()
                }
              },
            })
          }
          break
      }
    }
    template.push({ label: section.label, submenu })
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Markup',
    webPreferences: {
      preload: join(app.getAppPath(), 'dist/main/src/preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: true,
    },
  })
  void mainWindow.loadFile(join(app.getAppPath(), 'dist/renderer/index.html'))

  // The in-app menu bar (shell.ts) is the single menu; keep the native bar out
  // of the way. The menu itself stays set so its accelerators keep working.
  mainWindow.setMenuBarVisibility(false)

  allowClose = false
  mainWindow.on('close', (event) => {
    if (allowClose) return
    event.preventDefault()
    emitHostEvent({ event: 'close-request', payload: true })
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

void app.whenReady().then(() => {
  registerHandlers()
  buildApplicationMenu()
  createWindow()
  nativeTheme.on('updated', emitOsTheme)
  emitOsTheme()
  registerGlobalShortcuts()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
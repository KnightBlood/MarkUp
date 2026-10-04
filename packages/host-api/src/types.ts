import menuJson from './menu.json'

export type HostPlatform = 'electron' | 'wails' | 'tauri' | 'web' | 'electrobun'

export interface FileResult {
  path: string
  content: string
  encoding: string
  crlf: boolean
  bom: boolean
}

export interface DirEntry {
  name: string
  path: string
  kind: 'file' | 'dir'
  size: number
  mtime: number
}

export interface FsEvent {
  kind: 'create' | 'change' | 'remove'
  path: string
}

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface OpenDialogOptions {
  multiple?: boolean
  directory?: boolean
  defaultPath?: string
  filters?: FileFilter[]
}

export interface SaveDialogOptions {
  defaultPath?: string
  defaultExt?: string
  filters?: FileFilter[]
}

export interface PathInfo {
  path: string
}

export interface MessageOptions {
  title?: string
  message: string
  buttons?: string[]
}

export interface MessageResult {
  button: string
}

/** User-defined color overrides applied on top of light/dark/system base. */
export interface CustomTheme {
  bg?: string
  bgSoft?: string
  bgRaise?: string
  fg?: string
  fgMuted?: string
  border?: string
  accent?: string
  accentFg?: string
  ok?: string
  bad?: string
}

export interface AppConfig {
  theme: 'light' | 'dark' | 'system' | 'custom'
  fontSize: number
  lineWidth: number
  recentDocuments: string[]
  /** Autosave dirty documents with a path (desktop). Default false. */
  autoSave?: boolean
  /** Autosave debounce in ms. Default 1500. */
  autoSaveDelayMs?: number
  /** Keep the caret line vertically centered while typing. Default false. */
  typewriter?: boolean
  /** Color overrides when theme === 'custom'. */
  customTheme?: CustomTheme
  /** Show line numbers in source/hybrid views. Default false. */
  lineNumbers?: boolean
  /** Show word/char/line stats in the status bar. Default true. */
  showStats?: boolean
  /** Distraction-free layout (hide sidebar / mode bar / status bar). Default false. */
  focusMode?: boolean
  /** Insert pasted clipboard images as markdown data-URL images. Default true. */
  imagePaste?: boolean
  /** Browser spellcheck in editable surfaces. Default false. */
  spellcheck?: boolean
  /** Plugin ids the user turned off — dirs still scanned (manifest shown in settings) but never executed. */
  disabledPlugins?: string[]
  /** Body/UI font family (CSS font stack) for preview text; empty/absent = system default. */
  bodyFont?: string
  /** Code font family for source view, code blocks and gutters; absent = system default. */
  codeFont?: string
  /**
   * User rebinding of in-app shortcuts: command id → `Mod+X` (`''` = unbound).
   * Native menus / OS-level accelerators keep their default key positions.
   */
  shortcuts?: Record<string, string>
  /** Reopen the previous session's tabs at boot. Default true. */
  restoreSession?: boolean
  /** Paths open in tabs last session (tab order) — restored best-effort. */
  openTabs?: string[]
  /** Path of the tab focused last session (paired with `openTabs`). */
  activeTab?: string
}

export interface HostEventMap {
  'fs-changed': FsEvent
  'global-shortcut': string
  'window-focus': boolean
  'os-theme': 'light' | 'dark'
  /** Native menu item activated; payload is command id. */
  'menu-command': string
  /**
   * The shell wants to close the window and asks the app first (payload is
   * unused). Answer with `window.confirmClose()` once the user decided.
   *
   * Needed because `beforeunload` does not prompt in Electron-family
   * webviews — it silently cancels the close instead.
   */
  'close-request': void
}

/** Native window chrome controls (title bar / minimize-maximize-close). */
export interface WindowControls {
  minimize(): void
  toggleMaximize(): void
  close(): void
  /**
   * Close the window for real, skipping the shell's close interception.
   * The shell emits `close-request` first and only calls this once the app
   * finished its "unsaved changes" prompt (see {@link HostEventMap}).
   * Optional — hosts without interception may omit it.
   */
  confirmClose?(): void
  /** Optional — whether the window is currently maximized (for menu labels). */
  isMaximized?(): Promise<boolean>
}

export type HostEvent = keyof HostEventMap

/**
 * Cross-shell OS-level shortcuts (fire when the window is unfocused).
 * Accelerator syntax differs per host (Electron/Tauri: CommandOrControl, Wails: CmdOrCtrl).
 * Single source: src/menu.json (synced to each shell via scripts/sync-menu.mjs).
 */
export interface GlobalShortcut {
  commandId: string
  accelerator: string
  wailsAccelerator: string
}

export interface MenuCommandItem {
  kind: 'command'
  id: string
  label: string
}
export interface MenuSeparatorItem {
  kind: 'separator'
}
export interface MenuCheckboxItem {
  kind: 'checkbox'
  id: string
  label: string
  on: string
  off: string
}
/** Host-owned action (quit/reload/devtools) — each shell maps it to its native implementation. */
export interface MenuActionItem {
  kind: 'action'
  id: 'quit' | 'reload' | 'devtools'
  label: string
  accelerator?: string
}
export type MenuTemplateItem =
  | MenuCommandItem
  | MenuSeparatorItem
  | MenuCheckboxItem
  | MenuActionItem
export interface MenuTemplateSection {
  label: string
  items: MenuTemplateItem[]
}
export interface HostMenuData {
  menu: MenuTemplateSection[]
  globalShortcuts: GlobalShortcut[]
}

// JSON import infers wide `string` discriminants; content is validated by pm-l-menu smoke.
const hostMenuData = menuJson as unknown as HostMenuData

export const MENU_TEMPLATE: readonly MenuTemplateSection[] = hostMenuData.menu
export const GLOBAL_SHORTCUTS: ReadonlyArray<GlobalShortcut> = hostMenuData.globalShortcuts

/** Command ids referenced by the native menu (commands + checkbox on/off). */
export function menuCommandIds(data: HostMenuData = hostMenuData): string[] {
  const ids: string[] = []
  for (const section of data.menu) {
    for (const item of section.items) {
      if (item.kind === 'command') ids.push(item.id)
      else if (item.kind === 'checkbox') ids.push(item.on, item.off)
    }
  }
  for (const shortcut of data.globalShortcuts) ids.push(shortcut.commandId)
  return ids
}

export interface HostAPI {
  readonly platform: HostPlatform
  fs: {
    read(path: string): Promise<FileResult>
    write(path: string, content: string): Promise<void>
    readDir(path: string): Promise<DirEntry[]>
    watch(path: string, listener: (event: FsEvent) => void): () => void
    /**
     * Read a binary file as a full `data:` URL (`data:<mime>;base64,...`) —
     * binary-safe companion to `read`. Used by embeds (3D model / video) that
     * store a local path in the document and need bytes at render/export time.
     * Web resolves its virtual `web:`/`webfs:` paths through the picked File.
     */
    readBase64(path: string): Promise<string>
  }
  dialog: {
    open(options: OpenDialogOptions): Promise<PathInfo[]>
    save(options: SaveDialogOptions): Promise<PathInfo | null>
    message(options: MessageOptions): Promise<MessageResult>
  }
  app: {
    openExternal(url: string): Promise<void>
    setTitle(title: string): void
    /**
     * Open the shell's developer tools. Optional — the native menu bar is
     * hidden in every desktop shell (the in-app menu bar is the single menu),
     * so its `开发者工具` item routes here instead of relying on a menu
     * accelerator.
     */
    openDevTools?(): void
    getConfig(): Promise<AppConfig>
    setConfig(config: AppConfig): void
    on<E extends HostEvent>(event: E, listener: (payload: HostEventMap[E]) => void): () => void
    /**
     * Open the system print dialog.
     * Pass standalone HTML to print a document; omit to print the current window.
     * Optional — not all hosts implement printing.
     */
    print?(html?: string): Promise<boolean>
    /**
     * Export a PDF at `path` from standalone `html` (Electron printToPDF, etc.).
     * Optional — hosts without binary PDF export omit this.
     */
    exportPdf?(path: string, html: string): Promise<boolean>
    /**
     * Resolve a well-known application directory. Optional — hosts without
     * filesystem access omit this and plugin loading becomes a no-op.
     * - 'plugins' — user-global plugin root (`~/.markup/plugins`, created on
     *   demand, identical across shells)
     * - 'pluginsLocal' — `plugins/` next to the program executable (resolved
     *   to an absolute path, never created on demand — may not exist)
     * - 'userData' — the config root
     */
    getPath?(name: 'plugins' | 'pluginsLocal' | 'userData'): Promise<string | null>
  }
  /**
   * Native window controls (minimize / maximize / close).
   * Optional — web and hosts without window chrome omit this.
   */
  window?: WindowControls
}
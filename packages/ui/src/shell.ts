import { verifyHost, getHost, menuCommandIds, type AppConfig, type ConvertRequest, type ConvertResult, type CustomTheme, type FileFilter, type FsEvent } from '@markup/host-api'
import {
  DocStore,
  FLOW_TEMPLATE,
  TABLE_COMMAND_LABELS,
  blockFormatEdit,
  exportHtmlDocument,
  inlineFormatEdit,
  linkEdit,
  resolvePlantumlTarget,
  setDiagramEditHandler,
  setDiagramEnlargeHandler,
  setMathEditHandler,
  setMathEnlargeHandler,
  setPlantumlVisualEditHandler,
  type BlockFormatId,
  type InlineFormatId,
  type OpenDoc,
  type PlantumlTarget,
  type TableCommandId,
  type TextEdit,
} from '@markup/core'
import { el } from './dom'
import { createStatusbar, type StatusbarItemHandle } from './ui/statusbar'
import { createToastHost } from './ui/toast'
import { renderSidebar, pickMarkdownFile, type SidebarApi, type SidebarTabSpec } from './ui/sidebar'
import { renderEditorPane, type EditorPaneApi } from './ui/editor'
import { createDocLabel, createLogo, titlebarMenuItems } from './ui/titlebar'
import { registerCommandPalette, type PaletteApi } from './ui/palette'
import { createFindPanel } from './ui/findPanel'
import { createQuickOpen } from './ui/quickOpen'
import { createSettings, type SettingsApi, type SettingsTabSpec } from './ui/settings'
import { createKeybindingsPanel } from './ui/keybindings'
import { createContextMenu, type ContextMenuItem } from './ui/contextMenu'
import { showPrompt } from './ui/promptDialog'
import { createTabBar, type TabSpec } from './ui/tabBar'
import { createMenuBar } from './ui/menuBar'
import { createFormulaEditor, type FormulaEditorApi, type FormulaMode } from './ui/formulaEditor'
import { createDiagramEditor, type DiagramEditorApi } from './ui/diagramEditor'
import { createEmbedViewer, type EmbedViewerApi } from './ui/embedViewer'
import { createPlantumlEditor, type PlantumlEditorApi } from './ui/plantumlEditor'
import {
  MINDMAP_TEMPLATE,
  PLANTUML_TEMPLATE,
  setEmbedEnlargeHandler,
  setEmbedSourceResolver,
} from './ui/embeds'
import { CommandRegistry, attachKeydown, formatShortcut } from './commands'
import { loadPlugins, type LoadedPlugin, type PluginManifest } from './plugins'
import { countStats } from './outline'
import { parseLineLink } from './mdLinks'
import { openWorkspaceFolder, walkMarkdownFiles, type WorkspaceState } from './workspace'
import { attachHostEvents, systemThemeClass } from './hostEvents'
import { THEME_CLASSES, THEME_LABELS, THEME_ORDER, fontVars, themeClass } from './appearance'
import './theme/shell.css'

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** Folder of `path`, matching {@link basename}. Empty when it has none. */
function dirname(path: string): string {
  const cut = path.search(/[\\/][^\\/]+$/)
  return cut > 0 ? path.slice(0, cut) : ''
}

function resolveMarkdownUrl(url: string): string {
  try {
    return new URL(url, document.baseURI).href
  } catch {
    return url
  }
}

const CUSTOM_THEME_VARS: Array<{ key: keyof CustomTheme; css: string }> = [
  { key: 'bg', css: '--bg' },
  { key: 'bgSoft', css: '--bg-soft' },
  { key: 'bgRaise', css: '--bg-raise' },
  { key: 'fg', css: '--fg' },
  { key: 'fgMuted', css: '--fg-muted' },
  { key: 'border', css: '--border' },
  { key: 'accent', css: '--accent' },
  { key: 'accentFg', css: '--accent-fg' },
  { key: 'ok', css: '--ok' },
  { key: 'bad', css: '--bad' },
]

let osTheme: 'light' | 'dark' | null = null

interface TableCommandSpec {
  id: TableCommandId
  /** Register in the command palette. */
  palette?: boolean
  /** Emit a separator after this item in the editor context menu. */
  menuSep?: boolean
}

const TABLE_COMMANDS: readonly TableCommandSpec[] = [
  { id: 'rowBefore', palette: true, menuSep: true },
  { id: 'rowAfter', palette: true },
  { id: 'rowUp', palette: true },
  { id: 'rowDown', palette: true },
  { id: 'colBefore', palette: true, menuSep: true },
  { id: 'colAfter', palette: true },
  { id: 'colLeft', palette: true },
  { id: 'colRight', palette: true, menuSep: true },
  { id: 'rowDelete', palette: true },
  { id: 'colDelete', palette: true },
  { id: 'deleteSelection', palette: true, menuSep: true },
  { id: 'selectRow' },
  { id: 'selectCol' },
  { id: 'selectTable', menuSep: true },
  { id: 'alignLeft', palette: true },
  { id: 'alignCenter', palette: true },
  { id: 'alignRight', palette: true, menuSep: true },
  { id: 'deleteTable', palette: true },
  { id: 'exit', palette: true },
]

function prefersDark(): boolean {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  return false
}

function applyAppearance(config: AppConfig): void {
  const root = document.documentElement
  root.classList.remove(...THEME_CLASSES)
  for (const { css } of CUSTOM_THEME_VARS) root.style.removeProperty(css)
  // `system` resolves through the OS preference, every other theme is explicit.
  const resolved =
    config.theme === 'system' ? systemThemeClass(osTheme, prefersDark()) : themeClass(config.theme)
  if (resolved) root.classList.add(resolved)
  if (config.theme === 'custom') {
    const palette = config.customTheme ?? {}
    for (const { key, css } of CUSTOM_THEME_VARS) {
      const value = palette[key]
      if (value) root.style.setProperty(css, value)
    }
  }
  root.style.setProperty('--font-size', `${config.fontSize || 16}px`)
  root.style.setProperty('--editor-line-width', `${config.lineWidth || 780}px`)
  // Optional font overrides (settings → 外观 → 字体); absent = CSS defaults.
  for (const { name, value } of fontVars(config)) {
    if (value) root.style.setProperty(name, value)
    else root.style.removeProperty(name)
  }
}

export interface EditorContextMenuContext {
  target: EventTarget | null
  clientX: number
  clientY: number
}

/** Contributes extra items to the editor context menu (plugins / registration surface). */
export type ContextItemProvider = (
  event: MouseEvent,
  context: EditorContextMenuContext,
) => ContextMenuItem[]

export interface ShellHandle {
  /** Commands backing the palette, keybindings and native menu. */
  registry: CommandRegistry
  /** Append items to the editor context menu. Returns an unsubscribe. */
  registerContextItem: (provider: ContextItemProvider) => () => void
  /** Append a sidebar tab (button + panel). Returns an unsubscribe. */
  registerSidebarTab: (spec: SidebarTabSpec) => () => void
  /** Append a settings tab (button + panel). Returns an unsubscribe. */
  registerSettingsTab: (spec: SettingsTabSpec) => () => void
}

export function renderShell(): ShellHandle {
  const root = document.getElementById('app')
  if (!root) throw new Error('缺少 #app 挂载点')

  const host = getHost()
  const doc = new DocStore()
  const docLabel = createDocLabel()
  const registry = new CommandRegistry()
  const workspace: WorkspaceState = { root: null, files: [] }
  let appearance: AppConfig = {
    theme: 'system',
    fontSize: 16,
    lineWidth: 780,
    recentDocuments: [],
    autoSave: false,
    typewriter: false,
    lineNumbers: false,
    showStats: true,
    focusMode: false,
    imagePaste: true,
    spellcheck: false,
  }

  let refreshSidePanel: (() => void) | null = null
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
  let autoSaveEnabled = false
  let autoSaveDelayMs = 1500
  let autoSaveBusy = false
  let settings!: SettingsApi
  let contextMenu!: ReturnType<typeof createContextMenu>
  let formulaEditor!: FormulaEditorApi
  let diagramEditor!: DiagramEditorApi
  let embedViewer!: EmbedViewerApi
  let plantumlEditor!: PlantumlEditorApi
  let palette!: PaletteApi
  let shellEl: HTMLElement | null = null
  const contextItemProviders: ContextItemProvider[] = []
  const registerContextItem = (provider: ContextItemProvider): (() => void) => {
    contextItemProviders.push(provider)
    return () => {
      const index = contextItemProviders.indexOf(provider)
      if (index >= 0) contextItemProviders.splice(index, 1)
    }
  }

  const editor: EditorPaneApi = renderEditorPane(doc, {
    onContentChanged: () => refreshSidePanel?.(),
    onContextMenu: (event, context) => showEditorContextMenu(event, context),
  })

  const statusbar = createStatusbar({
    host,
    getStats: () => {
      const current = doc.getDocument()
      const markdown = editor.getMarkdown()
      const counted = countStats(markdown)
      return {
        ...counted,
        modified: current?.modified ?? false,
      }
    },
    getThemeLabel: () => THEME_LABELS[appearance.theme] ?? 'system',
    onThemeClick: () => settings.open(),
  })

  let sidebar!: SidebarApi

  const toastHost = createToastHost()
  root.appendChild(toastHost.el)

  const keybindingsPanel = createKeybindingsPanel({
    registry,
    onChange: (overrides) => applyAppearanceConfig({ ...appearance, shortcuts: overrides }),
  })

  settings = createSettings({
    getAppearance: () => appearance,
    onAppearanceChange: (next) => applyAppearanceConfig(next),
    onClose: () => keybindingsPanel.dispose(),
  })

  settings.registerTab({
    id: 'keys',
    label: '快捷键',
    render: () => keybindingsPanel.el,
  })
  contextMenu = createContextMenu(root)
  formulaEditor = createFormulaEditor()
  setMathEditHandler((request, done) => {
    formulaEditor.open({
      latex: request.latex,
      mode: request.display ? 'block' : 'inline',
      title: '编辑公式',
      onConfirm: (result) => done({ latex: result.latex, display: result.mode === 'block' }),
      onCancel: () => done(null),
    })
  })

  diagramEditor = createDiagramEditor()
  setDiagramEditHandler((request, done) => {
    diagramEditor.open({
      code: request.code,
      title: '编辑流程图',
      onConfirm: (code) => done(code),
      onCancel: () => done(null),
    })
  })

  plantumlEditor = createPlantumlEditor()
  // Visual editing: the widget 编辑 button forwards the caret command into
  // this outlet — open the code-split React dialog, then splice the confirmed
  // source back through the range captured at resolve time. (Menu/context-menu
  // entries were removed once the uniform 放大/编辑 bar became the sole entry.)
  const openPlantumlVisualEdit = (target: PlantumlTarget): void => {
    plantumlEditor.open({
      code: target.code,
      title: 'PlantUML 可视化编辑',
      onConfirm: (next) => {
        if (!target.writeBack(next)) toastHost.show('写入代码块失败', { level: 'error' })
      },
    })
  }

  embedViewer = createEmbedViewer()
  setEmbedEnlargeHandler((request) => {
    embedViewer.open({ kind: request.kind, code: request.code })
  })
  setDiagramEnlargeHandler((request) => {
    embedViewer.open({ diagram: { lang: request.lang, code: request.code } })
  })
  setMathEnlargeHandler((request) => {
    embedViewer.open({ math: { latex: request.latex } })
  })
  // Widget 编辑按钮 → the same resolve-and-open path as the caret command
  // (the button reveals the fence first, so the caret resolver sees it).
  setPlantumlVisualEditHandler(() => registry.run('plantuml.visualEdit'))
  setEmbedSourceResolver(async (path) => {
    try {
      return await host.fs.readBase64(path)
    } catch (error) {
      console.error('[markup] fs.readBase64 failed', path, error)
      return null
    }
  })

  const insertFormula = (mode: FormulaMode): void => {
    formulaEditor.open({
      latex: '',
      mode,
      title: '插入公式',
      onConfirm: (result) => {
        if (result.mode === 'block') {
          editor.insertMarkdown(`\n\n\`\`\`math\n${result.latex}\n\`\`\`\n\n`)
        } else {
          editor.insertMarkdown(`$${result.latex}$`)
        }
      },
    })
  }

  const insertDiagram = (): void => {
    diagramEditor.open({
      code: FLOW_TEMPLATE,
      title: '插入流程图',
      onConfirm: (code) => {
        editor.insertMarkdown(`\n\n\`\`\`mermaid\n${code}\n\`\`\`\n\n`)
      },
    })
  }

  const showError = async (message: string): Promise<void> => {
    await host.dialog.message({ title: 'Markup', message }).catch(() => undefined)
  }

  const openDocument = (path: string, content: string): void => {
    doc.setDocument(path, content)
    // Title + tab strip follow the doc store's own change event.
    sidebar.refreshRecents()
    sidebar.refreshOutline()
    statusbar.refresh()
  }

  const openPath = async (path: string): Promise<void> => {
    try {
      const { content } = await host.fs.read(path)
      openDocument(path, content)
    } catch (error) {
      console.error('[markup] openPath failed', error)
      await showError(`打开文件失败：${String(error)}`)
    }
  }

  const getRecents = async (): Promise<string[]> => {
    try {
      const config = await host.app.getConfig()
      return config.recentDocuments ?? []
    } catch {
      return appearance.recentDocuments ?? []
    }
  }

  const openFolder = async (): Promise<void> => {
    const rootPath = await openWorkspaceFolder()
    if (!rootPath) return
    try {
      const files = await walkMarkdownFiles(rootPath)
      workspace.root = rootPath
      workspace.files = files
      sidebar.refreshWorkspace()
      sidebar.showTab('file')
    } catch (error) {
      console.error('[markup] open folder failed', error)
      await showError(`打开文件夹失败：${String(error)}`)
    }
  }

  sidebar = renderSidebar({
    onOpen: openDocument,
    openPath,
    getCurrentPath: () => doc.getDocument()?.path || null,
    getMarkdown: () => editor.getMarkdown(),
    gotoAnchor: (anchor) => {
      editor.gotoAnchor(anchor)
      statusbar.refresh()
    },
    getWorkspace: () => workspace,
    onOpenFolder: openFolder,
    getRecents,
    showContextMenu: (x, y, items) => contextMenu.show(x, y, items),
    copyText: (text) => writeClipboard(text),
    removeFromRecents: async (path) => {
      const next = appearance.recentDocuments.filter((item) => item !== path)
      applyAppearanceConfig({ ...appearance, recentDocuments: next })
      sidebar.refreshRecents()
    },
  })

  // The DocStore owns the persisted recents list; mirror it into the in-memory
  // config (and repaint) so a session save can never rewrite a stale copy —
  // `persistSession()` spreads `appearance` on every document change.
  doc.onRecentsChange((recentDocuments) => {
    appearance = { ...appearance, recentDocuments }
    sidebar.refreshRecents()
  })

  refreshSidePanel = () => {
    sidebar.refreshOutline()
    statusbar.refresh()
  }

  // ---- tabs ------------------------------------------------------------
  const tabSpecs = (): TabSpec[] =>
    doc.getTabs().map((tab) => ({
      id: tab.id,
      title: tab.path ? basename(tab.path) : '未命名文档',
      path: tab.path,
      modified: tab.modified,
      active: tab.id === doc.getActiveId(),
    }))

  const newTab = (): void => {
    doc.newTab()
    editor.focus()
    refreshSidePanel?.()
  }

  /** One shared confirm for close / close-others / close-all. */
  const confirmDiscard = async (targets: OpenDoc[]): Promise<boolean> => {
    const dirty = targets.filter((tab) => tab.modified)
    if (dirty.length === 0) return true
    const names = dirty.map((tab) => (tab.path ? basename(tab.path) : '未命名文档'))
    const message =
      names.length === 1
        ? `“${names[0]}” 有未保存的修改，关闭后将丢失。`
        : `${names.length} 个文档有未保存的修改，关闭后将丢失。`
    const res = await host.dialog.message({
      title: '关闭标签页',
      message,
      buttons: ['关闭', '取消'],
    })
    return res.button === '关闭'
  }

  const closeTab = async (id: string): Promise<void> => {
    const tab = doc.getTab(id)
    if (!tab) return
    if (!(await confirmDiscard([tab]))) return
    doc.closeTab(id)
    // The shell never sits on zero documents — reopen a blank one.
    if (!doc.isOpen()) doc.newTab()
    refreshSidePanel?.()
  }

  const closeOtherTabs = async (id: string): Promise<void> => {
    const others = doc.getTabs().filter((tab) => tab.id !== id)
    if (others.length === 0) return
    if (!(await confirmDiscard(others))) return
    doc.closeWhere((tab) => tab.id !== id)
    doc.switchTo(id)
    refreshSidePanel?.()
  }

  const closeAllTabs = async (): Promise<void> => {
    const tabs = doc.getTabs()
    if (tabs.length === 0) return
    if (!(await confirmDiscard(tabs))) return
    doc.closeWhere(() => true)
    doc.newTab()
    refreshSidePanel?.()
  }

  const closeSavedTabs = (): void => {
    doc.closeWhere((tab) => !tab.modified)
    if (!doc.isOpen()) doc.newTab()
    refreshSidePanel?.()
  }

  const cycleTab = (offset: number): void => {
    if (doc.cycle(offset)) refreshSidePanel?.()
  }

  const selectTab = (id: string): void => {
    if (doc.switchTo(id)) refreshSidePanel?.()
  }

  /**
   * Persist the open-tab list (paths only — contents live on disk). Skipped
   * until boot finished and when session restore is switched off, so a
   * partially loaded config can never wipe the stored session.
   */
  let sessionPersist = false
  let sessionSignature = ''
  const persistSession = (): void => {
    if (!sessionPersist || appearance.restoreSession === false) return
    const openTabs = doc.getTabs().map((tab) => tab.path).filter(Boolean)
    const activeTab = doc.getDocument()?.path || undefined
    const signature = JSON.stringify([openTabs, activeTab])
    if (signature === sessionSignature) return
    sessionSignature = signature
    applyAppearanceConfig({ ...appearance, openTabs, activeTab })
  }

  const restoreSessionTabs = async (paths: string[], activePath?: string): Promise<number> => {
    let restored = 0
    for (const path of paths.slice(0, 24)) {
      if (!path || doc.hasPath(path)) continue
      try {
        const { content } = await host.fs.read(path)
        doc.restoreTab(path, content)
        restored += 1
      } catch (error) {
        // Deleted/moved files must not abort the whole restore.
        console.warn('[markup] session restore skipped:', path, error)
      }
    }
    if (restored > 0) {
      // The implicit blank tab would otherwise sit in front of the session.
      doc.dropBlankTab()
      const focused = activePath ? doc.switchToPath(activePath) : false
      if (!focused) doc.switchToPath(paths.find((path) => doc.hasPath(path)) ?? '')
    }
    return restored
  }

  const tabbar = createTabBar({
    getTabs: tabSpecs,
    onSelect: selectTab,
    onClose: (id) => void closeTab(id),
    onCloseOthers: (id) => void closeOtherTabs(id),
    onCloseAll: () => void closeAllTabs(),
    onCloseSaved: () => closeSavedTabs(),
    onNew: newTab,
    onReorder: (id, target, before) => {
      doc.reorder(id, target, before)
    },
    onCopyPath: (path) => void writeClipboard(path),
    showMenu: (x, y, items) => contextMenu.show(x, y, items),
  })

  const saveActive = async (): Promise<void> => {
    const current = doc.getDocument()
    if (!current) return
    if (current.path) {
      try {
        await doc.save()
        statusbar.refresh()
      } catch (error) {
        await showError(`保存失败：${String(error)}`)
      }
      return
    }
    await saveAs()
  }

  const saveAs = async (): Promise<void> => {
    const current = doc.getDocument()
    if (!current) return
    try {
      const picked = await host.dialog.save({
        defaultPath: current.path || '未命名.md',
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      })
      if (!picked?.path) return
      const ok = await doc.save(picked.path)
      if (ok) {
        sidebar.refreshRecents()
        statusbar.refresh()
      }
    } catch (error) {
      await showError(`保存失败：${String(error)}`)
    }
  }

  const openFile = async (): Promise<void> => {
    const picked = await pickMarkdownFile()
    if (picked) openDocument(picked.path, picked.content)
  }

  const exportBaseName = (): string => {
    const current = doc.getDocument()
    if (current?.path) return basename(current.path).replace(/\.(md|markdown)$/i, '')
    return '未命名文档'
  }

  const downloadText = (filename: string, content: string, mime: string): void => {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const exportAsHtml = async (): Promise<void> => {
    const base = exportBaseName()
    try {
      const html = await exportHtmlDocument(editor.getMarkdown(), { title: base })
      if (host.platform === 'web') {
        downloadText(`${base}.html`, html, 'text/html;charset=utf-8')
        return
      }
      const picked = await host.dialog.save({
        defaultPath: `${base}.html`,
        filters: [{ name: 'HTML', extensions: ['html'] }],
      })
      if (!picked?.path) return
      await host.fs.write(picked.path, html)
    } catch (error) {
      await showError(`导出 HTML 失败：${String(error)}`)
    }
  }

  const exportAsPdf = async (): Promise<void> => {
    const base = exportBaseName()
    try {
      const html = await exportHtmlDocument(editor.getMarkdown(), { title: base })
      if (host.app.exportPdf) {
        const picked = await host.dialog.save({
          defaultPath: `${base}.pdf`,
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        })
        if (!picked?.path) return
        const ok = await host.app.exportPdf(picked.path, html)
        if (!ok) throw new Error('exportPdf 返回失败')
        return
      }
      await printDocumentHtml(html)
    } catch (error) {
      await showError(`导出 PDF 失败：${String(error)}`)
    }
  }

  // ---- document conversion (导入文档 / 导出为…) --------------------------
  // Markup never bundles a converter. `host.app.convert` exists only in the
  // desktop shells, which resolve `pandoc` first and `carta` as a fallback and
  // are interchangeable here — both spell formats the same way and both take
  // `-f`/`-t`/`-o`/stdin, so this layer names formats and never programs.
  //
  // `gfm` is the format name in both directions, and that was measured against
  // pandoc 3.12.1 rather than guessed: it is the one name that keeps pipe
  // tables (`markdown` emits grid tables, which this renderer does not draw),
  // the `[^1]` footnotes `insert.footnote` writes, and `- [ ]` task lists all
  // at once.
  const MARKDOWN_FORMAT = 'gfm'

  type ConverterCall = (request: ConvertRequest) => Promise<ConvertResult>

  const IMPORT_FORMAT_BY_EXT: Record<string, string> = {
    docx: 'docx',
    odt: 'odt',
    rtf: 'rtf',
    epub: 'epub',
    html: 'html',
    htm: 'html',
  }

  const IMPORT_FILTERS: FileFilter[] = [
    { name: 'Word 文档', extensions: ['docx'] },
    { name: 'OpenDocument 文本', extensions: ['odt'] },
    { name: '富文本', extensions: ['rtf'] },
    { name: 'EPUB 电子书', extensions: ['epub'] },
    { name: '网页', extensions: ['html', 'htm'] },
  ]

  interface ConvertTarget {
    id: string
    label: string
    ext: string
    format: string
    filterName: string
  }

  const CONVERT_TARGETS: ConvertTarget[] = [
    { id: 'file.exportDocx', label: '导出为 Word (.docx)…', ext: 'docx', format: 'docx', filterName: 'Word 文档' },
    { id: 'file.exportOdt', label: '导出为 OpenDocument (.odt)…', ext: 'odt', format: 'odt', filterName: 'OpenDocument 文本' },
    { id: 'file.exportRtf', label: '导出为富文本 (.rtf)…', ext: 'rtf', format: 'rtf', filterName: '富文本' },
    { id: 'file.exportEpub', label: '导出为 EPUB (.epub)…', ext: 'epub', format: 'epub', filterName: 'EPUB 电子书' },
  ]

  /**
   * Probe before opening any dialog. Nothing is bundled, so "no converter
   * yet" is the normal first-run state — it gets an offer to open
   * 设置 ▸ 编辑 ▸ 文档转换 rather than a stack trace, and the caller simply stops.
   */
  const requireConverter = async (): Promise<ConverterCall | null> => {
    const convert = host.app.convert
    if (!convert) {
      await showError('文档转换需要桌面版：浏览器版没有本机的转换程序。')
      return null
    }
    const info = await host.app.converter?.().catch(() => null)
    if (info) return convert
    // A bad explicit path and no converter at all fail the same way, but they
    // are not the same mistake — say which one happened.
    const configured = (await host.app.getConfig().catch(() => null))?.converterPath?.trim()
    const detail = configured
      ? `当前填的路径「${configured}」无法运行，请修正它，或清空改用 PATH 上的 pandoc / carta。`
      : '请安装 pandoc（首选）或 carta 并保证它在 PATH 上，或在「设置 ▸ 编辑 ▸ 文档转换」里填写它的路径。'
    const answer = await host.dialog
      .message({
        title: '需要文档转换器',
        message: `Markup 不内置转换程序。${detail}`,
        buttons: ['打开设置', '取消'],
      })
      .catch(() => ({ button: '取消' }))
    // Open the 编辑 tab, not the default one: 文档转换 lives there, and making
    // the user hunt for the field the prompt just told them to fill is the
    // whole point of the button existing.
    if (answer.button === '打开设置') settings.open('editor')
    return null
  }

  const importDocument = async (): Promise<void> => {
    const convert = await requireConverter()
    if (!convert) return
    try {
      const picked = await host.dialog.open({ multiple: false, filters: IMPORT_FILTERS })
      const path = picked[0]?.path
      if (!path) return
      const ext = (path.split('.').pop() ?? '').toLowerCase()
      const from = IMPORT_FORMAT_BY_EXT[ext]
      if (!from) {
        await showError(`不支持的文档格式：.${ext}`)
        return
      }
      // Claim `<source>.md` only when nothing already lives there — an import
      // must never shadow a document the user already has on disk. Deciding
      // this *before* converting is also what keeps `--extract-media` from
      // leaving an orphaned `_files/` folder for a document we open untitled.
      const target = path.replace(/\.[^.]+$/, '.md')
      let existsAtTarget = false
      try {
        await host.fs.read(target)
        existsAtTarget = true
      } catch {
        /* absent — safe to claim */
      }
      const result = await convert({
        from,
        to: MARKDOWN_FORMAT,
        inputPath: path,
        // Relative on purpose: pandoc then writes the images to a sibling
        // `<name>_files/` and emits portable links, so the markdown and its
        // pictures travel as a pair instead of being nailed to this machine.
        ...(existsAtTarget ? {} : { mediaDir: `${basename(path).replace(/\.[^.]+$/, '')}_files` }),
      })
      openDocument(existsAtTarget ? '' : target, result.text ?? '')
      statusbar.refresh()
    } catch (error) {
      await showError(`导入失败：${String(error)}`)
    }
  }

  const exportConverted = async (target: ConvertTarget): Promise<void> => {
    const convert = await requireConverter()
    if (!convert) return
    try {
      const picked = await host.dialog.save({
        defaultPath: `${exportBaseName()}.${target.ext}`,
        filters: [{ name: target.filterName, extensions: [target.ext] }],
      })
      if (!picked?.path) return
      const open = doc.getDocument()
      await convert({
        from: MARKDOWN_FORMAT,
        to: target.format,
        text: editor.getMarkdown(),
        outputPath: picked.path,
        // Relative `![](./images/cover.png)` links resolve against the
        // document's own folder — not wherever the copy is being saved to,
        // which is what makes images survive the round trip.
        ...(open?.path ? { cwd: dirname(open.path) } : {}),
      })
    } catch (error) {
      await showError(`导出失败：${String(error)}`)
    }
  }

  const printDocumentHtml = async (html?: string): Promise<void> => {
    try {
      const payload = html ?? (await exportHtmlDocument(editor.getMarkdown(), { title: exportBaseName() }))
      const ok = await host.app.print?.(payload)
      if (!ok) await showError('当前平台不支持打印')
    } catch (error) {
      await showError(`打印失败：${String(error)}`)
    }
  }

  const runAutoSave = async (): Promise<void> => {
    if (autoSaveBusy) return
    const dirty = doc.getModified().filter((tab) => !!tab.path)
    if (dirty.length === 0) return
    autoSaveBusy = true
    try {
      await doc.saveModified()
      statusbar.refresh()
      tabbar.refresh()
    } catch (error) {
      console.error('[markup] autosave failed', error)
    } finally {
      autoSaveBusy = false
    }
  }

  const scheduleAutoSave = (): void => {
    if (!autoSaveEnabled) return
    if (autoSaveTimer) clearTimeout(autoSaveTimer)
    autoSaveTimer = setTimeout(() => {
      void runAutoSave()
    }, autoSaveDelayMs)
  }

  const setAutoSave = (enabled: boolean): void => {
    applyAppearanceConfig({ ...appearance, autoSave: enabled })
    if (!enabled && autoSaveTimer) {
      clearTimeout(autoSaveTimer)
      autoSaveTimer = null
    }
  }

  const setTypewriter = (enabled: boolean): void => {
    applyAppearanceConfig({ ...appearance, typewriter: enabled })
  }

  const pickAndInsertImage = async (): Promise<void> => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept =
      'image/*,.apng,.avif,.bmp,.gif,.ico,.jfif,.jpeg,.jpg,.png,.svg,.tif,.tiff,.webp'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) return
      void editor.insertImage(file)
    })
    input.click()
  }

  const pickAndInsertEmbed = async (lang: string, filters: FileFilter[]): Promise<void> => {
    try {
      const picked = await host.dialog.open({ multiple: false, filters })
      const first = picked[0]
      // The fence stores the path (or web virtual path); rendering/export
      // resolves it through host.fs.readBase64.
      if (first) editor.insertMarkdown(`\n\n\`\`\`${lang}\n${first.path}\n\`\`\`\n\n`)
    } catch (error) {
      console.error('[markup] pickAndInsertEmbed failed', error)
    }
  }

  const writeClipboard = async (text: string): Promise<void> => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        return
      }
    } catch {
      /* fall through to execCommand */
    }
    const scratch = document.createElement('textarea')
    scratch.value = text
    scratch.setAttribute('readonly', '')
    scratch.style.position = 'fixed'
    scratch.style.left = '-9999px'
    document.body.append(scratch)
    scratch.select()
    document.execCommand('copy')
    scratch.remove()
  }

  const copySelection = async (): Promise<void> => {
    const selected = editor.getSelectedText()
    if (selected) {
      await writeClipboard(selected)
      return
    }
    editor.focus()
    document.execCommand('copy')
  }

  const cutSelection = async (): Promise<void> => {
    const selected = editor.getSelectedText()
    if (selected) {
      await writeClipboard(selected)
      editor.focus()
      const active = document.activeElement
      if (
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLInputElement
      ) {
        active.setRangeText('', active.selectionStart ?? 0, active.selectionEnd ?? 0, 'end')
      } else {
        document.execCommand('delete')
      }
      return
    }
    editor.focus()
    document.execCommand('cut')
  }

  const pasteClipboard = async (): Promise<void> => {
    editor.focus()
    let text = ''
    try {
      if (navigator.clipboard?.readText) text = await navigator.clipboard.readText()
    } catch {
      text = ''
    }
    if (text) {
      editor.insertMarkdown(text)
      return
    }
    document.execCommand('paste')
  }

  const selectAll = (): void => {
    editor.focus()
    document.execCommand('selectAll')
  }

  // ── formatting ────────────────────────────────────────────────────────
  // The right-click format buttons, the `format.*` commands and the keyboard
  // shortcuts all funnel through these three helpers: compute a TextEdit from
  // the markdown (see `@markup/core/textFormat`), replay it through the
  // adapter's native insert path, then restore the caret/selection. One
  // implementation therefore behaves identically in 实时预览 / 分屏 / 源码.

  // Seeded text for a format applied to an empty selection. A bare marker pair
  // (`****`) parses as a thematic break, so the marks are seeded with a word
  // that the next keystroke replaces.
  const INLINE_PLACEHOLDERS: Record<InlineFormatId, string> = {
    bold: '粗体',
    italic: '斜体',
    code: '代码',
    strike: '删除线',
  }

  /** Selection as markdown offsets; falls back to the caret (or EOF). */
  const selectionRange = (): { from: number; to: number } => {
    const range = editor.getSelectionRange()
    if (range) return range
    const markdown = editor.getMarkdown()
    return { from: markdown.length, to: markdown.length }
  }

  const applyTextEdit = (edit: TextEdit | null): void => {
    if (!edit) return
    editor.setSelectionRange(edit.range.from, edit.range.to)
    editor.insertMarkdown(edit.text, edit.caret ?? edit.text.length)
    if (edit.select) {
      editor.setSelectionRange(
        edit.range.from + edit.select.from,
        edit.range.from + edit.select.to,
      )
    }
    editor.focus()
  }

  const applyInlineFormat = (id: InlineFormatId): void =>
    applyTextEdit(
      inlineFormatEdit(editor.getMarkdown(), selectionRange(), id, INLINE_PLACEHOLDERS[id]),
    )

  const applyBlockFormat = (id: BlockFormatId): void => {
    // Views that can express block structure natively (wysiwyg) do the edit
    // themselves — the markdown-text rewrite cannot change node types there
    // (and would corrupt结构-sensitive lines like table rows).
    if (editor.supportsBlockFormat()) {
      editor.setBlockFormat(id)
      return
    }
    applyTextEdit(blockFormatEdit(editor.getMarkdown(), selectionRange(), id))
  }

  const insertLink = async (): Promise<void> => {
    // Capture the document/range up front — the prompt is modal and steals
    // focus, so re-reading afterwards could see a moved caret.
    const markdown = editor.getMarkdown()
    const range = selectionRange()
    const selected = markdown.slice(range.from, range.to).trim()
    const url = await showPrompt({
      title: '插入链接',
      message: selected ? `链接文字：${selected.slice(0, 80)}` : undefined,
      value: /^https?:\/\/\S+$/i.test(selected) ? selected : '',
      placeholder: 'https://',
      confirmText: '插入',
    })
    if (!url || !url.trim()) return
    applyTextEdit(linkEdit(markdown, range, url.trim()))
  }

  const deleteSelection = (): void => {
    const range = selectionRange()
    if (range.to <= range.from) return
    editor.setSelectionRange(range.from, range.to)
    editor.insertMarkdown('', 0)
  }

  const escapeHtml = (text: string): string =>
    text.replace(
      /[&<>"]/g,
      (char) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char,
    )

  /** Selection serialized as HTML (wysiwyg DOM); '' when there is no DOM range. */
  const selectionHtml = (): string => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return ''
    const host = document.createElement('div')
    host.append(selection.getRangeAt(0).cloneContents())
    return host.innerHTML
  }

  const copySelectionAs = async (mode: 'markdown' | 'text' | 'html'): Promise<void> => {
    const markdown = editor.getMarkdown()
    const range = selectionRange()
    if (range.to <= range.from) return
    let text = markdown.slice(range.from, range.to)
    // 源码视图 has no rendered DOM: 纯文本/HTML fall back to the markdown slice.
    if (mode === 'text') text = editor.getSelectedText() || text
    if (mode === 'html') text = selectionHtml() || `<p>${escapeHtml(text)}</p>`
    await writeClipboard(text)
  }

  const pasteAsPlainText = async (): Promise<void> => {
    let text = ''
    try {
      if (navigator.clipboard?.readText) text = await navigator.clipboard.readText()
    } catch {
      text = ''
    }
    if (!text) {
      // Insecure context / denied permission — say so instead of pasting
      // nothing, then fall back to the normal paste path.
      await host.dialog.message({
        title: '粘贴为纯文本',
        message: '浏览器未授予剪贴板读取权限，已改用普通粘贴。',
        buttons: ['好'],
      })
      await pasteClipboard()
      return
    }
    editor.focus()
    editor.insertMarkdown(text)
  }

  const showEditorContextMenu = (
    event: MouseEvent,
    context: EditorContextMenuContext,
  ): void => {
    const node = context.target instanceof Element ? context.target : null
    const img = node?.closest('img[src]') as HTMLImageElement | null
    const link = node?.closest('a[href]') as HTMLAnchorElement | null
    const pre = node?.closest('pre')
    const kind = editor.getViewKind()
    const line = kind === 'source' || kind === 'hybrid'
      ? editor.getLineAt(context.clientX, context.clientY)
      : null
    const parsed = line ? parseLineLink(line.text, line.column) : null
    const insertItems: ContextMenuItem[] = [
      { label: '图片…', run: () => void pickAndInsertImage() },
      { label: '表格（3×3）', run: () => editor.insertTable(3, 3) },
      { label: '水平分割线', run: () => registry.run('insert.hr') },
      { label: '公式…', run: () => registry.run('insert.formula') },
      { label: '行内公式…', run: () => registry.run('insert.formula.inline') },
      { label: '流程图…', run: () => registry.run('insert.diagram') },
      { separator: true },
      { label: '3D 模型…', run: () => registry.run('insert.model') },
      { label: '视频…', run: () => registry.run('insert.video') },
      { label: '脑图', run: () => registry.run('insert.mindmap') },
      { label: 'XMind 脑图…', run: () => registry.run('insert.xmind') },
      { label: 'Draw.io 图表…', run: () => registry.run('insert.drawio') },
      { label: 'PlantUML 图', run: () => registry.run('insert.plantuml') },
      { separator: true },
      { label: '文件预览…', run: () => registry.run('insert.file') },
      { label: '脚注', run: () => registry.run('insert.footnote') },
    ]
    const viewItems: ContextMenuItem[] = [
      { label: '实时预览', checked: kind === 'wysiwyg', run: () => registry.run('view.wysiwyg') },
      { label: '分屏', checked: kind === 'source', run: () => registry.run('view.source') },
      { label: '源码', checked: kind === 'hybrid', run: () => registry.run('view.hybrid') },
      { separator: true },
      {
        label: '行号',
        checked: appearance.lineNumbers === true,
        run: () => registry.run('view.lineNumbers'),
      },
      {
        label: '打字机模式',
        checked: appearance.typewriter === true,
        run: () => registry.run('view.typewriter'),
      },
      {
        label: '专注模式',
        checked: appearance.focusMode === true,
        run: () => registry.run('view.focusMode'),
      },
      {
        label: '自动保存',
        checked: autoSaveEnabled,
        run: () => registry.run('file.autoSaveToggle'),
      },
      {
        label: '状态栏字数',
        checked: appearance.showStats !== false,
        run: () => registry.run('view.showStats'),
      },
    ]
    const paragraphItems: ContextMenuItem[] = [
      { label: '一级标题', shortcut: formatShortcut('Mod+1'), run: () => registry.run('format.h1') },
      { label: '二级标题', shortcut: formatShortcut('Mod+2'), run: () => registry.run('format.h2') },
      { label: '三级标题', shortcut: formatShortcut('Mod+3'), run: () => registry.run('format.h3') },
      { label: '四级标题', shortcut: formatShortcut('Mod+4'), run: () => registry.run('format.h4') },
      { label: '五级标题', shortcut: formatShortcut('Mod+5'), run: () => registry.run('format.h5') },
      { label: '六级标题', shortcut: formatShortcut('Mod+6'), run: () => registry.run('format.h6') },
      { separator: true },
      { label: '正文', run: () => registry.run('format.plain') },
      { label: '引用', shortcut: formatShortcut('Mod+Shift+Q'), run: () => registry.run('format.quote') },
      { separator: true },
      { label: '无序列表', run: () => registry.run('format.bullet') },
      { label: '有序列表', run: () => registry.run('format.ordered') },
      { label: '任务列表', run: () => registry.run('format.task') },
      { separator: true },
      { label: '代码块', shortcut: formatShortcut('Mod+Shift+K'), run: () => registry.run('format.codeBlock') },
    ]
    const copyPasteAsItems: ContextMenuItem[] = [
      {
        label: '复制为 Markdown',
        shortcut: formatShortcut('Mod+Shift+C'),
        run: () => registry.run('edit.copyAsMarkdown'),
      },
      { label: '复制为 HTML 代码', run: () => registry.run('edit.copyAsHtml') },
      { label: '复制为纯文本', run: () => registry.run('edit.copyAsText') },
      { separator: true },
      {
        label: '粘贴为纯文本',
        shortcut: formatShortcut('Mod+Shift+V'),
        run: () => registry.run('edit.pasteAsPlainText'),
      },
    ]
    // Typora-style layout: glyph toolbar row, copy/paste-as flyout, two rows of
    // format glyphs, then the paragraph / insert / view flyouts.
    const items: ContextMenuItem[] = [
      {
        row: [
          { icon: '✂', label: '剪切', shortcut: formatShortcut('Mod+X'), run: () => void cutSelection() },
          { icon: '⧉', label: '复制', shortcut: formatShortcut('Mod+C'), run: () => void copySelection() },
          { icon: '📋', label: '粘贴', shortcut: formatShortcut('Mod+V'), run: () => void pasteClipboard() },
          { icon: '🗑', label: '删除', run: () => registry.run('edit.delete') },
        ],
      },
      { separator: true },
      { label: '复制 / 粘贴为…', submenu: copyPasteAsItems },
      { separator: true },
      {
        row: [
          { icon: 'B', label: '粗体', shortcut: formatShortcut('Mod+B'), run: () => registry.run('format.bold') },
          { icon: 'I', label: '斜体', shortcut: formatShortcut('Mod+I'), run: () => registry.run('format.italic') },
          { icon: '</>', label: '行内代码', run: () => registry.run('format.inlineCode') },
          { icon: '🔗', label: '链接…', shortcut: formatShortcut('Mod+K'), run: () => registry.run('format.link') },
        ],
      },
      {
        row: [
          { icon: '❝', label: '引用', run: () => registry.run('format.quote') },
          { icon: '•', label: '无序列表', run: () => registry.run('format.bullet') },
          { icon: '1.', label: '有序列表', run: () => registry.run('format.ordered') },
          { icon: '☑', label: '任务列表', run: () => registry.run('format.task') },
        ],
      },
      { separator: true },
      { label: '段落', submenu: paragraphItems },
      { label: '插入', submenu: insertItems },
      { label: '视图', submenu: viewItems },
      { separator: true },
      { label: '全选', shortcut: formatShortcut('Mod+A'), run: selectAll },
      { label: '命令面板', shortcut: formatShortcut('Mod+Shift+P'), run: () => palette.toggle() },
    ]
    if (kind === 'wysiwyg' && node?.closest('table')) {
      const tableItems: ContextMenuItem[] = []
      for (const spec of TABLE_COMMANDS) {
        tableItems.push({
          label: TABLE_COMMAND_LABELS[spec.id],
          run: () => editor.runTableCommand(spec.id),
        })
        if (spec.menuSep) tableItems.push({ separator: true })
      }
      items.unshift({ label: '表格', submenu: tableItems }, { separator: true })
    }
    if (parsed?.kind === 'image') {
      const url = resolveMarkdownUrl(parsed.url)
      items.unshift(
        { label: '打开图片', run: () => void host.app.openExternal(url) },
        { label: '复制图片地址', run: () => void writeClipboard(url) },
        { separator: true },
      )
    } else if (parsed?.kind === 'link') {
      const url = resolveMarkdownUrl(parsed.url)
      items.unshift(
        { label: '打开链接', run: () => void host.app.openExternal(url) },
        { label: '复制链接地址', run: () => void writeClipboard(url) },
        { separator: true },
      )
    } else if (link) {
      items.unshift(
        {
          label: '打开链接',
          run: () => void host.app.openExternal(link.href),
        },
        {
          label: '复制链接地址',
          run: () => void writeClipboard(link.href),
        },
        { separator: true },
      )
    } else if (img) {
      items.unshift(
        {
          label: '打开图片',
          run: () => void host.app.openExternal(img.src),
        },
        {
          label: '复制图片地址',
          run: () => void writeClipboard(img.src),
        },
        { separator: true },
      )
    } else if (pre) {
      items.unshift(
        {
          label: '复制代码',
          run: () => void writeClipboard(pre.textContent ?? ''),
        },
        {
          label: '设置语言…',
          run: () => registry.run('code.language'),
        },
        { separator: true },
      )
    }
    for (const provider of contextItemProviders) {
      items.push(...provider(event, context))
    }
    contextMenu.show(context.clientX, context.clientY, items)
  }

  const cycleTheme = (): void => {
    const index = THEME_ORDER.indexOf(appearance.theme)
    const nextTheme = THEME_ORDER[(index + 1) % THEME_ORDER.length] ?? 'system'
    applyAppearanceConfig({ ...appearance, theme: nextTheme })
    statusbar.refresh()
  }

  const applyAppearanceConfig = (next: AppConfig): void => {
    appearance = next
    autoSaveEnabled = next.autoSave === true
    autoSaveDelayMs = next.autoSaveDelayMs ?? 1500
    applyAppearance(next)
    editor.setTypewriter(next.typewriter === true)
    editor.setLineNumbers(next.lineNumbers === true)
    editor.setSpellcheck(next.spellcheck === true)
    editor.setImagePasteEnabled(next.imagePaste !== false)
    statusbar.setShowStats(next.showStats !== false)
    shellEl?.classList.toggle('shell--focus', next.focusMode === true)
    host.app.setConfig(next)
    statusbar.refresh()
    sidebar.refreshRecents()
  }

  const findPanel = createFindPanel({
    getMarkdown: () => editor.getMarkdown(),
    gotoAnchor: (anchor) => {
      editor.gotoAnchor(anchor)
      statusbar.refresh()
    },
    replaceInDocument: (markdown) => {
      editor.setValue(markdown)
      statusbar.refresh()
      sidebar.refreshOutline()
    },
  })
  editor.el.appendChild(findPanel.el)

  const quickOpen = createQuickOpen(
    root,
    (path) => {
      void openPath(path)
    },
    () => workspace.root,
  )

  const collectQuickEntries = async (): Promise<{ path: string }[]> => {
    const recents = await getRecents()
    const seen = new Set<string>()
    const out: { path: string }[] = []
    const push = (path: string): void => {
      if (!path || seen.has(path)) return
      seen.add(path)
      out.push({ path })
    }
    for (const path of workspace.files) push(path)
    for (const path of recents) push(path)
    return out
  }

  const toggleQuickOpen = (): void => {
    void (async () => {
      const entries = await collectQuickEntries()
      quickOpen.toggle(entries)
    })()
  }

  registry.register({ id: 'file.open', label: '打开文件…', shortcut: 'Mod+O', run: () => void openFile() })
  registry.register({ id: 'file.openFolder', label: '打开文件夹…', run: () => void openFolder() })
  registry.register({ id: 'file.new', label: '新建标签页', shortcut: 'Mod+T', run: newTab })
  registry.register({ id: 'tab.close', label: '关闭标签页', shortcut: 'Mod+W', run: () => void closeTab(doc.getActiveId() ?? '') })
  registry.register({
    id: 'tab.closeOthers',
    label: '关闭其他标签页',
    run: () => {
      const id = doc.getActiveId()
      if (id) void closeOtherTabs(id)
    },
  })
  registry.register({ id: 'tab.closeAll', label: '关闭全部标签页', run: () => void closeAllTabs() })
  registry.register({ id: 'tab.closeSaved', label: '关闭已保存标签页', run: closeSavedTabs })
  registry.register({ id: 'tab.next', label: '下一个标签页', shortcut: 'Mod+Tab', run: () => cycleTab(1) })
  registry.register({ id: 'tab.prev', label: '上一个标签页', shortcut: 'Mod+Shift+Tab', run: () => cycleTab(-1) })
  registry.register({ id: 'file.save', label: '保存', shortcut: 'Mod+S', run: () => void saveActive() })
  registry.register({ id: 'file.saveAs', label: '另存为…', shortcut: 'Mod+Shift+S', run: () => void saveAs() })
  registry.register({ id: 'file.quickOpen', label: '快速打开文件', shortcut: 'Mod+P', run: toggleQuickOpen })
  registry.register({
    id: 'file.exportHtml',
    label: '导出 HTML…',
    shortcut: 'Mod+Shift+E',
    run: () => void exportAsHtml(),
  })
  registry.register({
    id: 'file.exportPdf',
    label: '导出 PDF…',
    shortcut: 'Mod+Shift+D',
    run: () => void exportAsPdf(),
  })
  registry.register({
    id: 'file.print',
    label: '打印…',
    shortcut: 'Mod+Shift+M',
    run: () => void printDocumentHtml(),
  })
  registry.register({ id: 'file.import', label: '导入文档…', run: () => void importDocument() })
  for (const target of CONVERT_TARGETS) {
    registry.register({ id: target.id, label: target.label, run: () => void exportConverted(target) })
  }
  registry.register({
    id: 'file.autoSaveToggle',
    label: '切换自动保存',
    run: () => setAutoSave(!autoSaveEnabled),
  })
  registry.register({
    id: 'file.autoSaveOn',
    label: '开启自动保存',
    run: () => setAutoSave(true),
  })
  registry.register({
    id: 'file.autoSaveOff',
    label: '关闭自动保存',
    run: () => setAutoSave(false),
  })
  registry.register({
    id: 'edit.find',
    label: '查找',
    shortcut: 'Mod+F',
    run: () => {
      if (findPanel.isOpen()) findPanel.focusFind()
      else findPanel.open(false)
    },
  })
  registry.register({
    id: 'edit.replace',
    label: '替换',
    shortcut: 'Mod+H',
    run: () => findPanel.open(true),
  })
  registry.register({
    id: 'edit.cut',
    label: '剪切',
    shortcut: 'Mod+X',
    run: () => void cutSelection(),
  })
  registry.register({
    id: 'edit.copy',
    label: '复制',
    shortcut: 'Mod+C',
    run: () => void copySelection(),
  })
  registry.register({
    id: 'edit.paste',
    label: '粘贴',
    shortcut: 'Mod+V',
    run: () => void pasteClipboard(),
  })
  registry.register({
    id: 'edit.selectAll',
    label: '全选',
    shortcut: 'Mod+A',
    run: selectAll,
  })
  registry.register({
    id: 'format.bold',
    label: '加粗',
    shortcut: 'Mod+B',
    run: () => applyInlineFormat('bold'),
  })
  registry.register({
    id: 'format.italic',
    label: '斜体',
    shortcut: 'Mod+I',
    run: () => applyInlineFormat('italic'),
  })
  registry.register({
    id: 'format.inlineCode',
    label: '行内代码',
    run: () => applyInlineFormat('code'),
  })
  registry.register({
    id: 'format.link',
    label: '超链接…',
    shortcut: 'Mod+K',
    run: () => void insertLink(),
  })
  registry.register({
    id: 'format.bullet',
    label: '无序列表',
    run: () => applyBlockFormat('bullet'),
  })
  registry.register({
    id: 'format.ordered',
    label: '有序列表',
    run: () => applyBlockFormat('ordered'),
  })
  registry.register({
    id: 'format.task',
    label: '任务列表',
    run: () => applyBlockFormat('task'),
  })
  registry.register({
    id: 'format.quote',
    label: '引用',
    shortcut: 'Mod+Shift+Q',
    run: () => applyBlockFormat('quote'),
  })
  registry.register({
    id: 'format.plain',
    label: '正文',
    run: () => applyBlockFormat('plain'),
  })
  registry.register({
    id: 'format.codeBlock',
    label: '代码块',
    shortcut: 'Mod+Shift+K',
    run: () => applyBlockFormat('codeBlock'),
  })
  registry.register({
    id: 'format.h1',
    label: '一级标题',
    shortcut: 'Mod+1',
    run: () => applyBlockFormat('h1'),
  })
  registry.register({
    id: 'format.h2',
    label: '二级标题',
    shortcut: 'Mod+2',
    run: () => applyBlockFormat('h2'),
  })
  registry.register({
    id: 'format.h3',
    label: '三级标题',
    shortcut: 'Mod+3',
    run: () => applyBlockFormat('h3'),
  })
  registry.register({
    id: 'format.h4',
    label: '四级标题',
    shortcut: 'Mod+4',
    run: () => applyBlockFormat('h4'),
  })
  registry.register({
    id: 'format.h5',
    label: '五级标题',
    shortcut: 'Mod+5',
    run: () => applyBlockFormat('h5'),
  })
  registry.register({
    id: 'format.h6',
    label: '六级标题',
    shortcut: 'Mod+6',
    run: () => applyBlockFormat('h6'),
  })
  registry.register({
    id: 'edit.delete',
    label: '删除',
    run: deleteSelection,
  })
  registry.register({
    id: 'edit.copyAsMarkdown',
    label: '复制为 Markdown',
    shortcut: 'Mod+Shift+C',
    run: () => void copySelectionAs('markdown'),
  })
  registry.register({
    id: 'edit.copyAsHtml',
    label: '复制为 HTML 代码',
    run: () => void copySelectionAs('html'),
  })
  registry.register({
    id: 'edit.copyAsText',
    label: '复制为纯文本',
    run: () => void copySelectionAs('text'),
  })
  registry.register({
    id: 'edit.pasteAsPlainText',
    label: '粘贴为纯文本',
    shortcut: 'Mod+Shift+V',
    run: () => void pasteAsPlainText(),
  })
  registry.register({
    id: 'insert.hr',
    label: '水平分割线',
    run: () => editor.insertMarkdown('\n\n---\n\n'),
  })
  registry.register({
    id: 'search.global',
    label: '全局搜索',
    shortcut: 'Mod+Shift+F',
    run: () => sidebar.focusSearch(),
  })
  registry.register({
    id: 'view.sidebarOutline',
    label: '侧栏：大纲',
    shortcut: 'Mod+Shift+1',
    run: () => sidebar.showTab('outline'),
  })
  registry.register({
    id: 'view.sidebarFiles',
    label: '侧栏：文件',
    shortcut: 'Mod+Shift+3',
    run: () => sidebar.showTab('file'),
  })
  registry.register({
    id: 'view.wysiwyg',
    label: '视图：实时预览',
    shortcut: 'Mod+Alt+1',
    run: () => editor.setView('wysiwyg'),
  })
  registry.register({
    id: 'view.source',
    label: '视图：分屏',
    shortcut: 'Mod+Alt+2',
    run: () => editor.setView('source'),
  })
  registry.register({
    id: 'view.hybrid',
    label: '视图：源码',
    shortcut: 'Mod+Alt+3',
    run: () => editor.setView('hybrid'),
  })
  registry.register({
    id: 'insert.table',
    label: '插入表格（3×3）',
    run: () => {
      editor.insertTable(3, 3)
    },
  })
  for (const spec of TABLE_COMMANDS) {
    if (!spec.palette) continue
    registry.register({
      id: `table.${spec.id}`,
      label: `表格：${TABLE_COMMAND_LABELS[spec.id]}`,
      run: () => {
        editor.runTableCommand(spec.id)
      },
    })
  }
  registry.register({
    id: 'insert.math',
    label: '插入数学块',
    run: () => registry.run('insert.formula'),
  })
  registry.register({
    id: 'insert.formula',
    label: '插入公式…',
    shortcut: 'Mod+Alt+M',
    run: () => insertFormula('block'),
  })
  registry.register({
    id: 'insert.formula.inline',
    label: '插入行内公式…',
    shortcut: 'Mod+Alt+I',
    run: () => insertFormula('inline'),
  })
  registry.register({
    id: 'insert.diagram',
    label: '插入流程图…',
    shortcut: 'Mod+Alt+G',
    run: () => insertDiagram(),
  })
  registry.register({
    id: 'insert.footnote',
    label: '插入脚注',
    run: () => editor.insertMarkdown(' [^1]\n\n[^1]: '),
  })
  registry.register({
    id: 'insert.image',
    label: '插入图片…',
    run: () => void pickAndInsertImage(),
  })
  registry.register({
    id: 'insert.model',
    label: '插入 3D 模型…',
    run: () =>
      void pickAndInsertEmbed('model', [{ name: '3D 模型', extensions: ['glb', 'gltf'] }]),
  })
  registry.register({
    id: 'insert.video',
    label: '插入视频…',
    run: () =>
      void pickAndInsertEmbed('video', [
        {
          name: '视频',
          // 原生可播 + avbridge 兜底的容器（mkv/avi/wmv/flv/ts/rmvb…）。
          extensions: [
            'mp4',
            'm4v',
            'mov',
            'qt',
            'webm',
            'ogv',
            'ogg',
            'mkv',
            'avi',
            'divx',
            'xvid',
            'wmv',
            'asf',
            'flv',
            'f4v',
            'ts',
            'mts',
            'm2ts',
            '3gp',
            '3g2',
            'rm',
            'rmvb',
          ],
        },
      ]),
  })
  registry.register({
    id: 'insert.mindmap',
    label: '插入脑图',
    run: () => editor.insertMarkdown(`\n\n\`\`\`mindmap\n${MINDMAP_TEMPLATE}\`\`\`\n\n`),
  })
  registry.register({
    id: 'insert.xmind',
    label: '插入 XMind 脑图…',
    run: () =>
      void pickAndInsertEmbed('xmind', [{ name: 'XMind 文件', extensions: ['xmind'] }]),
  })
  registry.register({
    id: 'insert.drawio',
    label: '插入 Draw.io 图表…',
    run: () =>
      void pickAndInsertEmbed('drawio', [
        { name: 'Draw.io 图表', extensions: ['drawio', 'dio'] },
      ]),
  })
  registry.register({
    id: 'insert.plantuml',
    label: '插入 PlantUML 图',
    run: () => editor.insertMarkdown(`\n\n\`\`\`plantuml\n${PLANTUML_TEMPLATE}\`\`\`\n\n`),
  })
  registry.register({
    id: 'plantuml.visualEdit',
    label: 'PlantUML 可视化编辑…',
    run: () => {
      const target = resolvePlantumlTarget({ caret: true })
      if (!target) {
        toastHost.show('请先将光标置于 PlantUML 代码块内', { level: 'warn' })
        return
      }
      openPlantumlVisualEdit(target)
    },
  })
  registry.register({
    id: 'insert.file',
    label: '插入文件预览…',
    run: () =>
      void pickAndInsertEmbed('file', [
        {
          name: '文档 / 工程文件',
          extensions: [
            'pdf',
            'doc',
            'docx',
            'xls',
            'xlsx',
            'ppt',
            'pptx',
            'rtf',
            'odt',
            'ods',
            'odp',
            'csv',
            'ofd',
            'epub',
            'chm',
            'zip',
            'rar',
            '7z',
            'tar',
            'gz',
            'eml',
            'msg',
            'mbox',
            'dwg',
            'dxf',
            'dwf',
            'typ',
            'psd',
            'hwp',
            'hwpx',
            'heic',
          ],
        },
      ]),
  })
  registry.register({
    id: 'code.language',
    label: '设置代码块语言…',
    run: () => {
      void showPrompt({
        title: '设置代码块语言',
        message: '代码块语言（如 js / ts / python / math）',
        value: 'js',
        placeholder: 'js',
        confirmText: '设置',
      }).then((lang) => {
        if (lang && lang.trim()) editor.setCodeLanguage(lang.trim())
      })
    },
  })
  registry.register({ id: 'theme.toggle', label: '切换主题（浅色/深色/跟随系统/自定义）', run: cycleTheme })
  registry.register({
    id: 'view.typewriter',
    label: '切换打字机模式',
    shortcut: 'Mod+Alt+T',
    run: () => setTypewriter(!(appearance.typewriter === true)),
  })
  registry.register({
    id: 'view.focusMode',
    label: '切换专注模式',
    shortcut: 'Mod+Alt+F',
    run: () => applyAppearanceConfig({ ...appearance, focusMode: appearance.focusMode !== true }),
  })
  registry.register({
    id: 'view.lineNumbers',
    label: '切换行号',
    run: () => applyAppearanceConfig({ ...appearance, lineNumbers: appearance.lineNumbers !== true }),
  })
  registry.register({
    id: 'view.showStats',
    label: '切换状态栏字数统计',
    run: () => applyAppearanceConfig({ ...appearance, showStats: appearance.showStats === false }),
  })
  registry.register({
    id: 'settings.open',
    label: '打开设置…',
    shortcut: 'Mod+,',
    run: settings.open,
  })
  registry.register({
    id: 'settings.appearance',
    label: '设置：外观',
    run: () => settings.open('appearance'),
  })
  registry.register({
    id: 'settings.editor',
    label: '设置：编辑',
    run: () => settings.open('editor'),
  })
  registry.register({
    id: 'settings.view',
    label: '设置：视图',
    run: () => settings.open('view'),
  })
  registry.register({
    id: 'settings.keys',
    label: '设置：快捷键',
    run: () => settings.open('keys'),
  })
  registry.register({
    id: 'app.reload',
    label: '重新加载窗口',
    shortcut: 'Mod+R',
    run: () => void requestReload(),
  })
  // 原生菜单栏在三壳里都隐藏了（应用内菜单栏是唯一菜单）：Windows 上
  // Wails 的 HideMenuBar 会摘掉菜单、加速键随之失效，所以退出/开发者工具
  // 这两个「原生动作」也补一条渲染层命令兜底。
  if (host.window) {
    registry.register({
      id: 'file.quit',
      label: '退出',
      shortcut: 'Mod+Q',
      run: () => host.window?.close(),
    })
  }
  if (host.app.openDevTools) {
    registry.register({
      id: 'help.devtools',
      label: '开发者工具',
      shortcut: 'Mod+Shift+I',
      run: () => host.app.openDevTools?.(),
    })
  }
  registry.register({
    id: 'host.status',
    label: 'HostAPI 平台信息',
    run: () =>
      void host.dialog
        .message({
          title: 'HostAPI 平台信息',
          message: `platform=${host.platform}`,
          buttons: ['确定'],
        })
        .catch(() => undefined),
  })

  attachKeydown(registry)

  const handleOsTheme = (theme: 'light' | 'dark'): void => {
    if (osTheme === theme) return
    osTheme = theme
    if (appearance.theme === 'system') applyAppearance(appearance)
  }

  attachHostEvents(host, {
    onMenuCommand: (commandId) => {
      registry.run(commandId)
    },
    onGlobalShortcut: (commandId) => {
      registry.run(commandId)
    },
    onOsTheme: handleOsTheme,
    // OS-initiated open (double-click on a `.md`, CLI arg, second instance).
    // Reuses `openPath` so the tab, recents list and window title behave
    // exactly like a quick-open / sidebar pick.
    onFileOpen: (path) => {
      void openPath(path)
    },
  })

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    handleOsTheme(mq.matches ? 'dark' : 'light')
    const onMq = (event: MediaQueryListEvent): void => {
      handleOsTheme(event.matches ? 'dark' : 'light')
    }
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onMq)
    }
  }

  doc.subscribe(() => {
    const current = doc.getDocument()
    const name = current?.path ? basename(current.path) : '未命名文档'
    const modified = current?.modified ?? false
    docLabel.textContent = modified ? `● ${name}` : name
    docLabel.classList.toggle('titlebar__doc--modified', modified)
    // Native/tab title follows the focused tab, not the last opened file.
    host.app.setTitle(current?.path ? `${modified ? '● ' : ''}${name}` : 'Markup')
    tabbar.refresh()
    sidebar.refreshOutline()
    statusbar.refresh()
    persistSession()
    // Autosave follows every dirty tab that has a path, not just the active one.
    if (doc.getModified().some((tab) => !!tab.path) && host.platform !== 'web') scheduleAutoSave()
  })

  // Closing the window.
  //
  // In a browser, `beforeunload` shows the native "leave site?" prompt. In
  // Electron-family webviews the same handler *silently cancels* the close, so
  // a dirty tab made the window impossible to close. Those shells intercept
  // the close instead and ask here, where the app can show its own dialog;
  // `confirmClose` is the shell's "really close now" switch.
  const nativeWindow = host.window
  let closing = false
  /** Ask — and optionally save — before the shell closes the window. */
  const resolveCloseRequest = async (): Promise<void> => {
    if (closing) return
    closing = true
    try {
      const dirty = doc.getModified()
      if (dirty.length > 0) {
        const unnamed = dirty.filter((tab) => !tab.path).length
        const names = dirty.map((tab) => (tab.path ? basename(tab.path) : '未命名文档'))
        const message =
          dirty.length === 1
            ? `“${names[0]}” 有未保存的修改，关闭前要保存吗？`
            : `有 ${dirty.length} 个文档未保存，其中 ${unnamed} 个尚未命名，关闭前要保存吗？`
        const choice = await host.dialog.message({
          title: '关闭 Markup',
          message,
          buttons: unnamed ? ['直接关闭', '取消'] : ['保存并关闭', '直接关闭', '取消'],
        })
        if (choice.button === '取消' || choice.button === '') {
          closing = false
          return
        }
        if (choice.button === '保存并关闭') {
          try {
            await doc.saveModified()
          } catch (error) {
            console.error('[markup] save before close failed', error)
            await showError(`保存失败：${String(error)}`)
            closing = false
            return
          }
        }
      }
      closing = false
      nativeWindow?.confirmClose?.()
    } catch (error) {
      console.error('[markup] close request failed', error)
      closing = false
      nativeWindow?.confirmClose?.()
    }
  }
  const requestReload = async (): Promise<void> => {
    if (nativeWindow?.confirmClose && doc.hasModified()) {
      const res = await host.dialog.message({
        title: '重新加载',
        message: '有未保存的修改，重新加载会丢失它们。',
        buttons: ['重新加载', '取消'],
      })
      if (res.button !== '重新加载') return
    }
    window.location.reload()
  }
  if (nativeWindow) {
    // Native chrome: shells that can intercept the close (`confirmClose`) ask
    // here first. Shells without that hook simply close — registering
    // `beforeunload` there would silently *block* the close instead of asking.
    if (nativeWindow.confirmClose) {
      host.app.on('close-request', () => {
        void resolveCloseRequest()
      })
    }
  } else {
    window.addEventListener('beforeunload', (event) => {
      if (doc.hasModified()) {
        event.preventDefault()
        event.returnValue = ''
      }
    })
  }

  const menuBar = createMenuBar({
    registry,
    menu: contextMenu,
    isChecked: (id) => (id === 'file.autoSave' ? autoSaveEnabled : false),
    actions: {
      // `quit` needs native chrome; without it the item renders disabled.
      quit: host.window ? () => host.window?.close() : undefined,
      reload: () => void requestReload(),
      devtools: host.app.openDevTools ? () => host.app.openDevTools?.() : undefined,
    },
  })
  const titlebar = el('header', { class: 'titlebar' }, createLogo(), menuBar.el, docLabel)
  titlebar.addEventListener('contextmenu', (event: MouseEvent) => {
    event.preventDefault()
    const items = titlebarMenuItems(host, () => void requestReload())
    if (items.length > 0) contextMenu.show(event.clientX, event.clientY, items)
  })

  const shell = el(
    'div',
    { class: 'shell' },
    titlebar,
    el(
      'div',
      { class: 'shell-body' },
      sidebar.el,
      // Document tabs share the sidebar's tab row — same height, same rule.
      el('div', { class: 'shell-main' }, tabbar.el, editor.el),
    ),
    statusbar.el,
  )
  shellEl = shell
  if (appearance.focusMode === true) shell.classList.add('shell--focus')

  root.replaceChildren(
    shell,
    settings.el,
    contextMenu.el,
    formulaEditor.el,
    diagramEditor.el,
    embedViewer.el,
    plantumlEditor.el,
  )

  palette = registerCommandPalette(root, () => registry.list())
  registry.register({
    id: 'palette.toggle',
    label: '命令面板',
    shortcut: 'Mod+Shift+P',
    run: palette.toggle,
  })

  // Self-check: the native menu is data-driven from host-api menu.json —
  // every command it references must be registered above.
  for (const id of menuCommandIds()) {
    if (!registry.get(id)) {
      console.warn('[markup] native menu references unregistered command:', id)
    }
  }

  // ---- plugin channel -------------------------------------------------
  // Scan both plugin roots (~/.markup/plugins + <program dir>/plugins) on
  // boot — but only after config resolves, so a disabled plugin (settings →
  // 插件, persisted in AppConfig.disabledPlugins) is reported for the
  // management list yet never executed. Web host has no getPath —
  // loadPlugins no-ops there.
  let loadedPlugins: LoadedPlugin[] = []
  let disabledManifests: PluginManifest[] = []
  let pluginIssues: Array<{ source: string; error: string }> = []
  let pluginWarnings: string[] = []
  const attachedWatchDirs = new Set<string>()
  let pluginWatchOffs: Array<() => void> = []
  let pluginsReloadTimer: ReturnType<typeof setTimeout> | null = null

  const pluginDocument = {
    getMarkdown: () => editor.getMarkdown(),
    setMarkdown: (markdown: string) => editor.setValue(markdown),
    insertMarkdown: (markdown: string) => editor.insertMarkdown(markdown),
    getSelectedText: () => editor.getSelectedText(),
    focus: () => editor.focus(),
    getPath: () => doc.getDocument()?.path || null,
    getCursor: () => editor.getSelectionRange(),
    setSelection: (from: number, to?: number) => editor.setSelectionRange(from, to),
    open: async (path: string): Promise<boolean> => {
      try {
        const { content } = await host.fs.read(path)
        openDocument(path, content)
        return true
      } catch (error) {
        console.error('[markup] plugin doc.open failed:', path, error)
        return false
      }
    },
  }
  const pluginContext = {
    registerContextItem,
    registerSidebarTab: (spec: SidebarTabSpec) => sidebar.registerTab(spec),
    registerSettingsTab: (spec: SettingsTabSpec) => settings.registerTab(spec),
  }

  const togglePlugin = (id: string, on: boolean): void => {
    const ids = new Set(appearance.disabledPlugins ?? [])
    if (on) ids.delete(id)
    else ids.add(id)
    const disabledPlugins = [...ids]
    applyAppearanceConfig({ ...appearance, disabledPlugins })
    void bootPlugins(disabledPlugins)
  }

  const pluginRows = el('div')
  const refreshPluginRows = (): void => {
    pluginRows.replaceChildren()
    const seen = new Set<string>()
    const rows: Array<{ manifest: PluginManifest; on: boolean }> = []
    for (const plugin of loadedPlugins) {
      rows.push({ manifest: plugin.manifest, on: true })
      seen.add(plugin.manifest.id)
    }
    for (const manifest of disabledManifests) {
      if (seen.has(manifest.id)) continue
      rows.push({ manifest, on: false })
      seen.add(manifest.id)
    }
    if (rows.length === 0) {
      const hint = el('p', { class: 'settings__label', text: '未检测到已安装插件' })
      pluginRows.append(hint)
      void Promise.all([host.app.getPath?.('plugins'), host.app.getPath?.('pluginsLocal')])
        .then(([globalDir, localDir]) => {
          const paths = [globalDir, localDir].filter((path): path is string => Boolean(path))
          if (paths.length > 0) {
            hint.textContent = `未检测到已安装插件（把插件文件夹放入 ${paths.join(' 或 ')} 后重启）`
          }
        })
        .catch(() => undefined)
    }
    for (const row of rows) {
      const check = el('input', { class: 'settings__check', type: 'checkbox' })
      check.checked = row.on
      check.addEventListener('change', () => togglePlugin(row.manifest.id, check.checked))
      const description = row.manifest.description ? ` — ${row.manifest.description}` : ''
      const permissions = row.manifest.permissions?.length
        ? `（权限：${row.manifest.permissions.join(', ')}）`
        : ''
      pluginRows.append(
        el(
          'label',
          { class: 'settings__field settings__field--row' },
          check,
          el('span', {
            class: 'settings__label',
            text: `${row.manifest.name}（${row.manifest.id} · v${row.manifest.version}）${permissions}${description}`,
          }),
        ),
      )
    }
    // Load diagnostics stay visible in the UI, not just in devtools console.
    for (const warning of pluginWarnings) {
      pluginRows.append(el('p', { class: 'settings__issue settings__issue--warn', text: `警告：${warning}` }))
    }
    for (const issue of pluginIssues) {
      pluginRows.append(
        el('p', { class: 'settings__issue', text: `${issue.source}：${issue.error}` }),
      )
    }
  }

  const normalizePath = (path: string): string => path.toLowerCase().replace(/\//g, '\\')

  const onPluginDirEvent = (event: FsEvent): void => {
    // Electron broadcasts every fs-changed payload — only react to our plugin dirs.
    const eventPath = normalizePath(event.path)
    let ours = false
    for (const dir of attachedWatchDirs) {
      if (eventPath.startsWith(normalizePath(dir))) {
        ours = true
        break
      }
    }
    if (!ours) return
    if (pluginsReloadTimer) clearTimeout(pluginsReloadTimer)
    pluginsReloadTimer = setTimeout(() => {
      pluginsReloadTimer = null
      void bootPlugins(appearance.disabledPlugins ?? [])
    }, 400)
  }

  const attachPluginWatches = (dirs: string[]): void => {
    for (const dir of dirs) {
      if (attachedWatchDirs.has(dir)) continue
      try {
        const off = host.fs.watch(dir, onPluginDirEvent)
        attachedWatchDirs.add(dir)
        pluginWatchOffs.push(off)
      } catch (error) {
        console.warn('[markup] plugins watch failed:', dir, error)
      }
    }
  }

  const pluginStatusItems = new Map<string, StatusbarItemHandle>()

  const bootPlugins = async (disabledIds: string[]): Promise<void> => {
    for (const plugin of loadedPlugins) plugin.deactivate()
    loadedPlugins = []
    // Plugins that forgot to remove statusbar items leave orphans — clear them all here.
    for (const handle of pluginStatusItems.values()) handle.dispose()
    pluginStatusItems.clear()
    try {
      const result = await loadPlugins({
        host,
        commands: registry,
        document: pluginDocument,
        disabled: disabledIds,
        context: pluginContext,
        notify: (message, options) => toastHost.show(message, options),
        statusbar: {
          set: (id, text, title) => {
            let handle = pluginStatusItems.get(id)
            if (!handle) {
              handle = statusbar.registerItem(id)
              pluginStatusItems.set(id, handle)
            }
            handle.setText(text, title)
            return () => {
              if (pluginStatusItems.get(id) === handle) pluginStatusItems.delete(id)
              handle.dispose()
            }
          },
          remove: (id) => {
            const handle = pluginStatusItems.get(id)
            if (!handle) return
            pluginStatusItems.delete(id)
            handle.dispose()
          },
        },
        getWorkspaceRoot: () => workspace.root,
      })
      loadedPlugins = result.loaded
      disabledManifests = result.disabled
      pluginIssues = result.errors
      pluginWarnings = result.warnings
      for (const err of result.errors) {
        console.error('[markup] plugin load failed:', err.source, err.error)
      }
      for (const warning of result.warnings) {
        console.warn('[markup] plugin warning:', warning)
      }
      if (result.loaded.length > 0) {
        console.info(
          '[markup] plugins loaded:',
          result.loaded.map((plugin) => plugin.manifest.id).join(', '),
        )
      }
      attachPluginWatches(result.watchDirs)
      refreshPluginRows()
    } catch (error) {
      console.error('[markup] plugin loading crashed', error)
      pluginIssues = [{ source: 'plugins', error: error instanceof Error ? error.message : String(error) }]
      refreshPluginRows()
    }
  }

  settings.registerTab({
    id: 'plugins',
    label: '插件',
    render: () =>
      el(
        'div',
        { class: 'settings__panel-body', 'data-tab-panel': 'plugins' },
        el(
          'section',
          { class: 'settings__section' },
          el('h3', { class: 'settings__heading', text: '插件' }),
          el('p', { class: 'settings__label', text: '启用/禁用立即生效并持久化到配置。' }),
          pluginRows,
        ),
      ),
  })

  void host.app
    .getConfig()
    .then((config) => {
      // Rebound shortcuts must be in place before any key is pressed.
      registry.applyOverrides(config.shortcuts)
      keybindingsPanel.refresh()
      applyAppearanceConfig({
        ...appearance,
        ...config,
        autoSave: config.autoSave === true,
        autoSaveDelayMs: config.autoSaveDelayMs ?? 1500,
        typewriter: config.typewriter === true,
        lineNumbers: config.lineNumbers === true,
        showStats: config.showStats !== false,
        focusMode: config.focusMode === true,
        imagePaste: config.imagePaste !== false,
        spellcheck: config.spellcheck === true,
        customTheme: config.customTheme,
      })
      sidebar.refreshRecents()
      // Session restore: reopen last session's paths (best effort) — or start
      // a single blank tab when there is nothing to restore.
      sessionPersist = config.restoreSession !== false
      void (async () => {
        if (sessionPersist) await restoreSessionTabs(config.openTabs ?? [], config.activeTab)
        if (!doc.isOpen()) doc.newTab()
        sessionSignature = JSON.stringify([
          doc.getTabs().map((tab) => tab.path).filter(Boolean),
          doc.getDocument()?.path || undefined,
        ])
        tabbar.refresh()
      })()
      void bootPlugins(appearance.disabledPlugins ?? [])
    })
    .catch((error) => {
      console.error('[markup] getConfig failed', error)
      applyAppearance(appearance)
      if (!doc.isOpen()) doc.newTab()
      void bootPlugins(appearance.disabledPlugins ?? [])
    })

  void verifyHost(host).then((ver) => statusbar.setVerify(ver))

  return {
    registry,
    registerContextItem,
    registerSidebarTab: (spec) => sidebar.registerTab(spec),
    registerSettingsTab: (spec) => settings.registerTab(spec),
  }
}

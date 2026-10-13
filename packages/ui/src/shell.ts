import { verifyHost, getHost, menuCommandIds, type AppConfig, type ConvertRequest, type ConvertResult, type CustomTheme, type FileFilter, type FsEvent } from '@markup/host-api'
import {
  DocStore,
  FLOW_TEMPLATE,
  TABLE_COMMAND_LABELS,
  blockFormatEdit,
  classifyDroppedFile,
  documentEdge,
  lineEdge,
  lineRangeAt,
  selectScope,
  exportHtmlDocument,
  exportOptionsFromConfig,
  fileToDataUrl,
  deleteBlockEdit,
  filterPaths,
  formatTableSource,
  hasReferenceDefinition,
  insertParagraphEdit,
  latexToMathML,
  mathSpanAt,
  parseGlobList,
  referenceLabel,
  referenceLinkDefinition,
  referenceLinkInline,
  stripHtmlFormatting,
  headingLevelAt,
  headingLevelEdit,
  imageAltText,
  imageAt,
  imageDisplayName,
  imageNameFor,
  imagePersistOptionsFromConfig,
  imageTargetDir,
  imagesInScope,
  inlineFormatEdit,
  joinPath,
  linkEdit,
  listIndentEdit,
  localImages,
  pathStyleFor,
  repointImagesEdit,
  resolveImageInsert,
  resolveImagePath,
  resolvePlantumlTarget,
  setDiagramEditHandler,
  setDiagramEnlargeHandler,
  setMathEditHandler,
  setMathEnlargeHandler,
  setOvertypeSyntax,
  setPlantumlVisualEditHandler,
  splitFrontmatter,
  stepHeadingLevel,
  switchImageSyntaxEdit,
  taskStatusEdit,
  mdSyntaxOptionsFromConfig,
  pipelineOptionsFromConfig,
  TOC_MARKER,
  uniqueFileName,
  type BlockFormatId,
  type HeadingStep,
  type ImageRef,
  type ImageSyntax,
  type InlineFormatId,
  type InsertedImage,
  type ListIndentStep,
  type OpenDoc,
  type PlantumlTarget,
  type SelectScope,
  type TableCommandId,
  type TaskStatus,
  type TextEdit,
  type TextRange,
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
import { createSelectionToolbar } from './ui/selectionToolbar'
import { createStatsPanel } from './ui/statsPanel'
import { createOutlinePanel } from './ui/outlinePanel'
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
import { countStats, extractOutline, filterOutlineLevel } from './outline'
import { parseLineLink } from './mdLinks'
import { openWorkspaceFolder, walkMarkdownFiles, type WorkspaceState } from './workspace'
import { attachHostEvents, systemThemeClass } from './hostEvents'
import { THEME_CLASSES, THEME_LABELS, THEME_ORDER, fontVars, themeClass } from './appearance'
import { clampZoom, stepZoom, zoomCss, zoomFromWheelDelta, ZOOM_DEFAULT } from './zoom'
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
  // 视图 ▸ 放大 / 缩小. A CSS variable rather than an inline style on one
  // element, so the zoom survives a view switch (the adapters rebuild their
  // own DOM) without the shell having to re-apply it.
  root.style.setProperty('--view-zoom', zoomCss(config.viewZoom))
  // 首行缩进: a variable rather than a stylesheet edit so the preview, the
  // export and a future print path all read the same switch.
  root.style.setProperty('--mk-first-line-indent', config.firstLineIndent ? '2em' : '0px')
  // 代码块自动换行. Default (absent) is `pre` — a code block does not wrap, which
  // is how it has always rendered; turning the setting on allows wrapping.
  root.style.setProperty('--mk-code-wrap', config.codeBlockWrap ? 'pre-wrap' : 'pre')
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
  const workspace: WorkspaceState = { root: null, files: [], allFiles: [] }
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

  /**
   * 图像 ▸ 插入图片时 — where a pasted or picked image goes.
   *
   * Lives here rather than inside a view so all three views agree, and so the
   * answer does not depend on whether the image arrived by paste or by
   * 插入图片. Returning null means "keep it inline" — which is also what a host
   * without a writable filesystem (web) gets.
   */
  const persistImage = async (
    file: File,
    source: 'paste' | 'local',
  ): Promise<InsertedImage | null> => {
    const { writeBase64, mkdirp, readDir } = host.fs
    if (!writeBase64 || !mkdirp) return null
    // 对本地位置的图片应用上述规则 — a picked file the user deliberately
    // chose is left where it is unless they asked otherwise. A paste always
    // goes through the rules: an inline bitmap has no home of its own.
    if (source === 'local' && appearance.imageApplyLocal === false) return null
    const docPath = doc.getDocument()?.path || null
    const options = imagePersistOptionsFromConfig(appearance)
    const style = pathStyleFor(docPath ?? '')
    // 无特殊操作 (the default) and an unsaved document both mean "inline".
    // Bailing before the read matters: base64-encoding a full-screen
    // screenshot only to throw it away is real work on every paste.
    if (imageTargetDir(options, docPath, style.sep) === null) return null
    try {
      const dataUrl = await fileToDataUrl(file)
      const { url } = await resolveImageInsert(
        { dataUrl, name: imageNameFor(file) },
        options,
        {
          mkdirp,
          writeDataUrl: (path, data) => writeBase64(path, data),
          // A missing directory just means there is nothing to collide with.
          listNames: async (dir) => {
            try {
              return (await readDir(dir)).map((entry) => entry.name)
            } catch {
              return []
            }
          },
          docPath: () => docPath,
        },
        style,
      )
      return { alt: imageAltText(file), url }
    } catch (error) {
      // A host-side failure must not eat the paste — the caller falls back to
      // the inline data URL, which is still valid markdown.
      console.error('[markup] 图片落盘失败，改为内联 data URL', error)
      return null
    }
  }

  // ── 图像工具 ─────────────────────────────────────────────────────────────
  // Every entry point that touches the disk needs the same two capabilities, so
  // a host without them (web) simply does not offer the items — better than a
  // menu entry whose only possible outcome is an error.
  const canEditImageFiles = (): boolean =>
    typeof host.fs.writeBase64 === 'function' && typeof host.fs.remove === 'function'

  const imageContext = () => {
    const docPath = doc.getDocument()?.path || null
    return {
      docPath,
      options: imagePersistOptionsFromConfig(appearance),
      style: pathStyleFor(docPath ?? ''),
    }
  }

  /** The local image the caret sits on, with its path resolved. */
  const currentImage = (): { ref: ImageRef; path: string } | null => {
    const { docPath, style } = imageContext()
    const ref = imageAt(editor.getMarkdown(), selectionRange().from)
    if (!ref) return null
    const path = resolveImagePath(ref.url, docPath, style)
    return path ? { ref, path } : null
  }

  const confirmImageAction = async (
    title: string,
    message: string,
    confirmText: string,
  ): Promise<boolean> => {
    const result = await host.dialog.message({ title, message, buttons: ['取消', confirmText] })
    return result.button === confirmText
  }

  /** Bytes → bytes, then drop the original: a move spelled with the optional ops. */
  const moveImageFile = async (from: string, to: string): Promise<void> => {
    const dataUrl = await host.fs.readBase64(from)
    await host.fs.mkdirp?.(dirname(to))
    await host.fs.writeBase64?.(to, dataUrl)
    await host.fs.remove?.(from)
  }

  const copyImageBytes = async (from: string, to: string): Promise<void> => {
    const dataUrl = await host.fs.readBase64(from)
    await host.fs.mkdirp?.(dirname(to))
    await host.fs.writeBase64?.(to, dataUrl)
  }

  /**
   * 转换图片语法 — one toggle, as in Typora: flip whatever the selection is made
   * of to the other syntax. With a bare caret that means the whole document.
   */
  const switchImageSyntax = (): void => {
    const markdown = editor.getMarkdown()
    const range = selectionRange()
    const target: ImageSyntax = imagesInScope(markdown, range).some(
      (ref) => ref.kind === 'markdown',
    )
      ? 'html'
      : 'markdown'
    const edit = switchImageSyntaxEdit(markdown, range, target)
    if (!edit) {
      toastHost.show(target === 'html' ? '没有 Markdown 图片可转换' : '没有 HTML 图片可转换')
      return
    }
    applyTextEdit(edit)
  }

  const copyImagePath = async (): Promise<void> => {
    const image = currentImage()
    if (!image) {
      toastHost.show('光标不在本地图片上', { level: 'warn' })
      return
    }
    await navigator.clipboard.writeText(image.path)
    toastHost.show('已复制图片路径')
  }

  const deleteImageFile = async (): Promise<void> => {
    const image = currentImage()
    if (!image) {
      toastHost.show('光标不在本地图片上', { level: 'warn' })
      return
    }
    const name = imageDisplayName(image.path)
    // The reference is deliberately left behind. Deleting the *file* is not the
    // same as deleting the paragraph, and the author may be about to put the
    // file back — Typora leaves the broken link too.
    const ok = await confirmImageAction(
      '删除图片文件',
      `从磁盘删除 ${name}？文档中的引用会保留，并显示为断开。`,
      '删除',
    )
    if (!ok) return
    try {
      await host.fs.remove?.(image.path)
      toastHost.show(`已删除 ${name}`)
    } catch (error) {
      toastHost.show(`删除失败：${String(error)}`, { level: 'error' })
    }
  }

  const renameImageFile = async (): Promise<void> => {
    const image = currentImage()
    const { docPath, style, options } = imageContext()
    if (!image || !docPath) {
      toastHost.show('光标不在本地图片上（未保存的文档没有目录可解析）', { level: 'warn' })
      return
    }
    const next = await showPrompt({
      title: '重命名 / 移动图片到',
      message: '相对路径按文档所在目录解析，也可以填绝对路径。',
      value: imageDisplayName(image.path),
      placeholder: 'assets/new-name.png',
      confirmText: '移动',
    })
    if (!next?.trim()) return
    // The typed value is resolved exactly like a reference would be, so `a.png`,
    // `./a.png` and `C:/x/a.png` all mean what they look like.
    const nextPath = resolveImagePath(next.trim(), docPath, style) ?? next.trim()
    if (nextPath === image.path) return
    try {
      await moveImageFile(image.path, nextPath)
    } catch (error) {
      toastHost.show(`移动失败：${String(error)}`, { level: 'error' })
      return
    }
    applyTextEdit(
      repointImagesEdit(editor.getMarkdown(), docPath, image.path, nextPath, options, style),
    )
  }

  const transferAllImages = async (move: boolean): Promise<void> => {
    const { docPath, style, options } = imageContext()
    if (!docPath) {
      toastHost.show('请先保存文档', { level: 'warn' })
      return
    }
    if (localImages(editor.getMarkdown(), docPath, style).length === 0) {
      toastHost.show('文档中没有本地图片')
      return
    }
    const picked = await host.dialog.open({
      directory: true,
      multiple: false,
      defaultPath: dirname(docPath),
    })
    const dir = picked[0]?.path
    if (!dir) return
    // Names are resolved against what is already there *and* against what this
    // same run has just written, so two `a.png` from different folders cannot
    // silently become one file.
    const taken = new Set<string>()
    try {
      for (const entry of await host.fs.readDir(dir)) taken.add(entry.name.toLowerCase())
    } catch {
      // A folder that does not list yet has nothing to collide with.
    }
    // The list is a snapshot taken before any edit; each round re-reads the
    // markdown because repointing rewrites it (and shifts every later offset).
    const images = localImages(editor.getMarkdown(), docPath, style)
    let done = 0
    for (const image of images) {
      const name = uniqueFileName(dir, imageDisplayName(image.path), taken)
      taken.add(name.toLowerCase())
      const to = joinPath(dir, name, style.sep)
      if (to === image.path) continue
      try {
        if (move) await moveImageFile(image.path, to)
        else await copyImageBytes(image.path, to)
      } catch (error) {
        toastHost.show(
          `处理 ${imageDisplayName(image.path)} 失败：${String(error)}`,
          { level: 'error' },
        )
        continue
      }
      done += 1
      applyTextEdit(
        repointImagesEdit(editor.getMarkdown(), docPath, image.path, to, options, style),
      )
    }
    toastHost.show(`${move ? '移动' : '复制'}了 ${done} 张图片`)
  }

  /**
   * 重新加载所有图片. Images are resolved from disk at render time — there is
   * no cache to invalidate, so re-rendering the current markdown is exactly what
   * "reload" has to mean. `setValue` does not dirty the document.
   */
  const reloadAllImages = (): void => {
    editor.setValue(editor.getMarkdown())
    toastHost.show('已重新加载图片')
  }

  const editor: EditorPaneApi = renderEditorPane(doc, {
    onContentChanged: () => refreshSidePanel?.(),
    onContextMenu: (event, context) => showEditorContextMenu(event, context),
    persistImage,
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

  // 工具栏 — shown over a selection. It lives outside the editor pane so it can
  // overlap the mode bar / status bar when a selection sits near an edge.
  const selectionToolbar = createSelectionToolbar((command) => registry.run(command))
  root.appendChild(selectionToolbar.el)

  // 字数统计浮窗. Numbers only refresh while it is open — counting the whole
  // document on every keystroke for a panel nobody is looking at is pure waste.
  const statsPanel = createStatsPanel()
  root.appendChild(statsPanel.el)

  const refreshStatsPanel = (): void => {
    if (!statsPanel.visible) return
    const markdown = editor.getMarkdown()
    const range = editor.getSelectionRange()
    const selection =
      range && range.to > range.from ? countStats(markdown.slice(range.from, range.to)) : null
    statsPanel.update(countStats(markdown), selection)
  }
  for (const type of ['keyup', 'mouseup'] as const) {
    editor.el.addEventListener(type, () => window.setTimeout(refreshStatsPanel, 0))
  }

  // 大纲浮窗. Same extractor as the sidebar's 大纲 tab, so a heading can never
  // show up in one and not the other.
  const outlinePanel = createOutlinePanel((item) => {
    editor.gotoAnchor({ offset: item.offset, line: item.line })
    editor.focus()
  })
  root.appendChild(outlinePanel.el)

  const refreshOutlinePanel = (): void => {
    if (!outlinePanel.visible) return
    outlinePanel.update(
      filterOutlineLevel(extractOutline(editor.getMarkdown()), appearance.outlineMaxLevel ?? 0),
    )
    outlinePanel.setActive(editor.getSelectionRange()?.from ?? null)
  }

  /**
   * 工具栏 visibility.
   *
   * Position comes from the DOM selection, which only ProseMirror and
   * CodeMirror expose — 分屏 overlays a transparent textarea whose selection no
   * browser reports through `window.getSelection()`, so the bar stays hidden
   * there rather than appearing in the wrong place.
   */
  const updateSelectionToolbar = (): void => {
    if (appearance.readOnly === true) {
      selectionToolbar.hide()
      return
    }
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      selectionToolbar.hide()
      return
    }
    const range = selection.getRangeAt(0)
    // Only for a selection the editor owns — dragging over the sidebar or the
    // status bar must not pop a format bar.
    if (!editor.el.contains(range.commonAncestorContainer)) {
      selectionToolbar.hide()
      return
    }
    const rect = range.getBoundingClientRect()
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      selectionToolbar.hide()
      return
    }
    selectionToolbar.update({
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.width,
    })
  }

  editor.el.addEventListener('mouseup', () => window.setTimeout(updateSelectionToolbar, 0))
  editor.el.addEventListener('keyup', (event) => {
    // Escape dismisses it; anything else re-evaluates after the editor has
    // settled its own selection.
    if (event.key === 'Escape') {
      selectionToolbar.hide()
      return
    }
    window.setTimeout(updateSelectionToolbar, 0)
  })
  // A scroll or a click elsewhere invalidates the rect, so hide rather than
  // leaving the bar floating over unrelated text.
  document.addEventListener('scroll', () => selectionToolbar.hide(), true)
  document.addEventListener('mousedown', (event) => {
    if (!selectionToolbar.el.contains(event.target as Node)) selectionToolbar.hide()
  })

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

  /**
   * 拖入文件.
   *
   * A dropped markdown file opens; an image goes through exactly the same
   * 插入图片时 rules as a pasted one; anything else becomes a link to the file.
   * The web build has no path for a dropped file, so markdown opens untitled
   * (its text is what we have) and other files link by name only — better than
   * a path that does not exist.
   */
  const handleDroppedFiles = async (files: File[]): Promise<void> => {
    for (const file of files) {
      const path = (file as File & { path?: string }).path
      const name = file.name || 'file'
      // The ordering (document beats image beats link) lives in core so it can be
      // pinned without a drag event — see `classifyDroppedFile`.
      switch (classifyDroppedFile(file)) {
        case 'document':
          if (path) await openPath(path)
          else openDocument('', await file.text())
          break
        case 'image':
          await editor.insertImage(file)
          break
        default:
          editor.insertMarkdown(`[${name}](${path ?? name})`)
      }
    }
  }

  editor.el.addEventListener('dragover', (event: DragEvent) => {
    // Only for files: the tab strip reorders with its own drag payload, and
    // claiming every drag would break it when a tab passes over the editor.
    if (!event.dataTransfer?.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    editor.el.classList.add('is-drop-target')
  })
  editor.el.addEventListener('dragleave', (event: DragEvent) => {
    // `dragleave` also fires when moving between children; only clear when the
    // pointer genuinely left the pane.
    const next = event.relatedTarget
    if (next instanceof Node && editor.el.contains(next)) return
    editor.el.classList.remove('is-drop-target')
  })
  editor.el.addEventListener('drop', (event: DragEvent) => {
    const files = [...(event.dataTransfer?.files ?? [])]
    if (files.length === 0) return
    event.preventDefault()
    editor.el.classList.remove('is-drop-target')
    void handleDroppedFiles(files)
  })

  /**
   * 文件树内新建文件 / 文件夹.
   *
   * The name is asked for rather than auto-generated: a `新建文件 1.md` the user
   * then has to rename is worse than one prompt.
   */
  const createWorkspaceEntry = async (dir: string, kind: 'file' | 'folder'): Promise<void> => {
    const name = await showPrompt({
      title: kind === 'file' ? '新建文件' : '新建文件夹',
      message: `在 ${dir} 下创建`,
      value: kind === 'file' ? 'untitled.md' : '新文件夹',
      confirmText: '创建',
    })
    const trimmed = name?.trim()
    if (!trimmed) return
    // A separator would silently create somewhere else entirely — refuse rather
    // than guess which of the two the user meant.
    if (/[\\/]/.test(trimmed)) {
      await showError('名称不能包含斜杠')
      return
    }
    const target = joinPath(dir, trimmed, pathStyleFor(dir).sep)
    try {
      // Refuse to overwrite: `fs.write` would clobber an existing file without a
      // word, and a tree action that eats a document is not recoverable.
      let exists = false
      try {
        await host.fs.read(target)
        exists = true
      } catch {
        /* absent — safe to create */
      }
      if (exists) {
        await showError(`「${trimmed}」已存在`)
        return
      }
      if (kind === 'folder') {
        if (!host.fs.mkdirp) throw new Error('当前环境无法创建文件夹')
        await host.fs.mkdirp(target)
      } else {
        await host.fs.write(target, '')
      }
    } catch (error) {
      await showError(`创建失败：${String(error)}`)
      return
    }
    sidebar.refreshWorkspace()
    // Opening it is the point of creating it — otherwise the user has to go and
    // find the file they just made.
    if (kind === 'file') await openPath(target)
  }

  const getRecents = async (): Promise<string[]> => {
    try {
      const config = await host.app.getConfig()
      return config.recentDocuments ?? []
    } catch {
      return appearance.recentDocuments ?? []
    }
  }

  /**
   * 文件树 glob 过滤. Applied to the list the tree renders, not to the walk:
   * the walk is what `刷新工作区列表` re-runs, and re-walking a tree because a
   * filter string changed would make the filter feel expensive for no reason.
   */
  const applyWorkspaceFilter = (files: string[]): string[] => {
    const rules = parseGlobList(appearance.workspaceGlob ?? '')
    return filterPaths(files, rules)
  }

  /** Walk + filter the current root into `workspace`. */
  const reloadWorkspace = async (): Promise<void> => {
    if (!workspace.root) return
    const files = await walkMarkdownFiles(workspace.root, undefined, {
      includeHidden: appearance.showHiddenFiles === true,
    })
    // The unfiltered walk is kept so changing the filter does not need a
    // re-walk — `workspace.files` is the filtered view the tree renders.
    workspace.allFiles = files
    workspace.files = applyWorkspaceFilter(files)
    sidebar.refreshWorkspace()
  }

  const openFolder = async (): Promise<void> => {
    const rootPath = await openWorkspaceFolder()
    if (!rootPath) return
    try {
      workspace.root = rootPath
      await reloadWorkspace()
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
    createEntry: (dir, kind) => void createWorkspaceEntry(dir, kind),
    getOutlineMaxLevel: () => appearance.outlineMaxLevel ?? 0,
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
    // 在文档列表中显示: keep the tree's mark on the document you are actually in,
    // so switching tabs moves the highlight rather than leaving it behind.
    sidebar.revealPath(doc.getDocument()?.path ?? null)
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

  /**
   * 重新打开关闭的文件. Only saved documents are remembered — an untitled tab has
   * nothing to read back from disk, so "reopen" could not honestly restore it.
   */
  const recentlyClosed: string[] = []
  const RECENT_CLOSED_MAX = 20
  const rememberClosed = (path: string | undefined): void => {
    if (!path) return
    const at = recentlyClosed.indexOf(path)
    if (at >= 0) recentlyClosed.splice(at, 1)
    recentlyClosed.push(path)
    if (recentlyClosed.length > RECENT_CLOSED_MAX) recentlyClosed.shift()
  }

  const closeTab = async (id: string): Promise<void> => {
    const tab = doc.getTab(id)
    if (!tab) return
    if (!(await confirmDiscard([tab]))) return
    rememberClosed(tab.path || undefined)
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

  /** 保存全部 — every modified tab that has a path, in one pass. */
  const saveAll = async (): Promise<void> => {
    try {
      const count = await doc.saveModified()
      statusbar.refresh()
      sidebar.refreshRecents()
      toastHost.show(count > 0 ? `已保存 ${count} 个文件` : '没有需要保存的文件')
    } catch (error) {
      await showError(`保存失败：${String(error)}`)
    }
  }

  const reopenClosed = async (): Promise<void> => {
    const path = recentlyClosed.pop()
    if (!path) {
      toastHost.show('没有可重新打开的文件')
      return
    }
    await openPath(path)
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

  /** Files a drop opens as documents rather than linking to. */

  /** `file://` URL for a local path, for handing to `app.openExternal`. */
  const fileUrl = (path: string): string =>
    `file:///${path
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`

  /**
   * 导出 ▸ 默认导出文件夹. Empty means "next to the document", which is what the
   * save dialog already defaults to — so an unset folder keeps the old
   * behaviour rather than guessing one.
   */
  const exportDefaultPath = (ext: string): string => {
    const name = `${exportBaseName()}.${ext}`
    const folder = appearance.exportFolder?.trim()
    if (!folder) return name
    return joinPath(folder, name, pathStyleFor(folder).sep)
  }

  /**
   * 导出后. Both actions go through `openExternal` with a `file:` URL — that is
   * the one primitive every shell already has for "let the OS deal with this".
   * A failure is logged, not surfaced: the export itself already succeeded, and
   * telling the user it failed would be a lie.
   */
  const afterExport = async (path: string): Promise<void> => {
    const action = appearance.exportAfter ?? 'none'
    if (action === 'none') return
    try {
      await host.app.openExternal(fileUrl(action === 'openFolder' ? dirname(path) : path))
    } catch (error) {
      console.error('[markup] 导出后打开失败', error)
    }
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
      const html = await exportHtmlDocument(editor.getMarkdown(), {
        title: base,
        pipeline: pipelineOptionsFromConfig(appearance),
        ...exportOptionsFromConfig(appearance),
      })
      if (host.platform === 'web') {
        downloadText(`${base}.html`, html, 'text/html;charset=utf-8')
        return
      }
      const picked = await host.dialog.save({
        defaultPath: exportDefaultPath('html'),
        filters: [{ name: 'HTML', extensions: ['html'] }],
      })
      if (!picked?.path) return
      await host.fs.write(picked.path, html)
      await afterExport(picked.path)
    } catch (error) {
      await showError(`导出 HTML 失败：${String(error)}`)
    }
  }

  const exportAsPdf = async (): Promise<void> => {
    const base = exportBaseName()
    try {
      const html = await exportHtmlDocument(editor.getMarkdown(), {
        title: base,
        pipeline: pipelineOptionsFromConfig(appearance),
        ...exportOptionsFromConfig(appearance),
      })
      if (host.app.exportPdf) {
        const picked = await host.dialog.save({
          defaultPath: exportDefaultPath('pdf'),
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        })
        if (!picked?.path) return
        const ok = await host.app.exportPdf(picked.path, html)
        if (!ok) throw new Error('exportPdf 返回失败')
        await afterExport(picked.path)
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
  const DEFAULT_MARKDOWN_FORMAT = 'gfm'

  /**
   * Markdown 变体 — the format name handed to the converter, in both directions.
   *
   * A *name*, not a dialect we implement: `gfm` keeps this renderer's own syntax
   * working through a round trip, while `commonmark_x` is what Typora calls
   * 「CommonMark + pandoc 扩展」. Passed through as-is so a user can name any
   * format their pandoc knows.
   */
  const markdownFormat = (): string =>
    appearance.converterMarkdownFormat?.trim() || DEFAULT_MARKDOWN_FORMAT

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
    if (answer.button === '打开设置') settings.open('export')
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
        to: markdownFormat(),
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
        defaultPath: exportDefaultPath(target.ext),
        filters: [{ name: target.filterName, extensions: [target.ext] }],
      })
      if (!picked?.path) return
      const open = doc.getDocument()
      await convert({
        from: markdownFormat(),
        to: target.format,
        text: editor.getMarkdown(),
        outputPath: picked.path,
        // Relative `![](./images/cover.png)` links resolve against the
        // document's own folder — not wherever the copy is being saved to,
        // which is what makes images survive the round trip.
        ...(open?.path ? { cwd: dirname(open.path) } : {}),
      })
      await afterExport(picked.path)
    } catch (error) {
      await showError(`导出失败：${String(error)}`)
    }
  }

  const printDocumentHtml = async (html?: string): Promise<void> => {
    try {
      const payload =
        html ??
        (await exportHtmlDocument(editor.getMarkdown(), {
          title: exportBaseName(),
          pipeline: pipelineOptionsFromConfig(appearance),
          ...exportOptionsFromConfig(appearance),
        }))
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

  /**
   * Put HTML on the clipboard as a real `text/html` flavour, with a plain-text
   * fallback.
   *
   * `writeText` alone would hand the destination the *source* — pasting into
   * Word would show `&lt;p&gt;…&lt;/p&gt;` instead of a paragraph. `ClipboardItem`
   * is the only way to offer an HTML flavour; where it is missing the command
   * still does something (plain text) rather than failing silently.
   */
  const writeClipboardHtml = async (html: string, plain: string): Promise<void> => {
    const Item = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem
    if (navigator.clipboard?.write && Item) {
      try {
        await navigator.clipboard.write([
          new Item({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([plain], { type: 'text/plain' }),
          }),
        ])
        return
      } catch {
        /* some hosts deny the richer write — fall through to plain text */
      }
    }
    await writeClipboard(plain)
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
    underline: '下划线',
    highlight: '高亮',
    sup: '上标',
    sub: '下标',
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

  // ── 选中当前… / 跳转 / 整行复制剪切 ───────────────────────────────────────
  // The markdown is the source of truth for where things are, so these read the
  // offsets from it and hand the result to the active view — each view then
  // applies the range its own way.
  const applySelectionRange = (range: TextRange | null): void => {
    if (!range) return
    editor.setSelectionRange(range.from, range.to)
    editor.focus()
  }

  const selectScopeCommand = (scope: SelectScope): void =>
    applySelectionRange(selectScope(editor.getMarkdown(), selectionRange().from, scope))

  const jumpTo = (range: TextRange): void => applySelectionRange(range)

  const copyOrCutLine = async (cut: boolean): Promise<void> => {
    const markdown = editor.getMarkdown()
    const range = lineRangeAt(markdown, selectionRange().from)
    if (!range) return
    const text = markdown.slice(range.from, range.to)
    if (!text) return
    await writeClipboard(text)
    if (!cut) return
    // Take the newline with the line, or the document gains a blank line where
    // the text used to be. The last line has no trailing newline to take, so it
    // gives up the one before it instead.
    const hasTrailing = range.to < markdown.length
    const from = hasTrailing ? range.from : Math.max(0, range.from - 1)
    const to = hasTrailing ? range.to + 1 : range.to
    applyTextEdit({ range: { from, to }, text: '', caret: from })
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
      // 默认的代码块语言: the native command creates the fence without an info
      // string, so it is applied right after — `setCodeLanguage` is a no-op when
      // the caret is not in a code block, which is exactly the guard wanted.
      if (id === 'codeBlock' && appearance.codeBlockLanguage?.trim()) {
        editor.setCodeLanguage(appearance.codeBlockLanguage.trim())
      }
      return
    }
    applyTextEdit(
      blockFormatEdit(
        editor.getMarkdown(),
        selectionRange(),
        id,
        appearance.codeBlockLanguage ?? '',
      ),
    )
  }

  /** BlockFormatId for a heading level; 0 (or out of range) means a paragraph. */
  const HEADING_IDS: BlockFormatId[] = ['plain', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']

  /**
   * 提升 / 降低标题级别.
   *
   * The level is read from the markdown and then applied through the same
   * native block command as 一级标题: a heading is *structure* in the wysiwyg
   * view, so splicing markdown text would rewrite a line that is not the one
   * the caret is on.
   */
  const applyHeadingStep = (step: HeadingStep): void => {
    const markdown = editor.getMarkdown()
    const range = selectionRange()
    const level = stepHeadingLevel(headingLevelAt(markdown, range), step)
    if (editor.supportsBlockFormat()) {
      editor.setBlockFormat(HEADING_IDS[level] ?? 'plain')
      return
    }
    applyTextEdit(headingLevelEdit(markdown, range, step))
  }

  const applyListIndent = (step: ListIndentStep): void => {
    const size = appearance.listIndentSize ?? 2
    // Prefer the view's own command — nesting a list is a structure change the
    // markdown-text rewrite cannot express in the wysiwyg view.
    if (editor.setListIndent?.(step)) return
    applyTextEdit(listIndentEdit(editor.getMarkdown(), selectionRange(), step, size))
  }

  const applyTaskStatus = (status: TaskStatus): void => {
    if (editor.setTaskStatus?.(status)) return
    applyTextEdit(taskStatusEdit(editor.getMarkdown(), selectionRange(), status))
  }

  /** A minimal front matter block; the user fills the fields in. */
  const FRONTMATTER_TEMPLATE = '---\ntitle: \n---\n'

  /**
   * 插入 YAML Front Matter.
   *
   * The block only means anything at byte 0, so it is spliced in there rather
   * than at the caret — and skipped entirely when the document already opens
   * with one, instead of stacking a second `---` run.
   */
  const insertFrontmatter = (): void => {
    const markdown = editor.getMarkdown()
    if (splitFrontmatter(markdown).frontmatter) {
      toastHost.show('文档已经是 YAML Front Matter 开头', { level: 'warn' })
      return
    }
    editor.setSelectionRange(0, 0)
    editor.insertMarkdown(`${FRONTMATTER_TEMPLATE}\n`)
  }

  /**
   * 链接引用 — a reference-style link: the visible text keeps its own form and
   * the URL lives in a single definition. The label comes from the selected text
   * so two links that read the same share one definition.
   */
  /**
   * 创建副本 — write a second copy of this document next to it and open it.
   *
   * The copy comes from the *buffer*, not from disk: duplicating a document you
   * have been editing should carry the edits, which is usually the whole point.
   */
  const duplicateDocument = async (): Promise<void> => {
    const current = doc.getDocument()
    if (!current?.path) {
      toastHost.show('请先保存文档', { level: 'warn' })
      return
    }
    const suggested = basename(current.path).replace(/\.(md|markdown)$/i, ' 副本.md')
    const name = await showPrompt({
      title: '创建副本',
      message: '相对路径按文档所在目录解析，也可以填绝对路径。',
      value: suggested,
      confirmText: '创建',
    })
    const trimmed = name?.trim()
    if (!trimmed) return
    const style = pathStyleFor(current.path)
    // The same path resolution images use: it is about paths, not pictures.
    const target = resolveImagePath(trimmed, current.path, style) ?? trimmed
    try {
      // Refuse to overwrite — a duplicate that eats an existing document is not
      // recoverable.
      let exists = false
      try {
        await host.fs.read(target)
        exists = true
      } catch {
        /* absent — safe to create */
      }
      if (exists) {
        await showError(`「${trimmed}」已存在`)
        return
      }
      await host.fs.write(target, current.content)
    } catch (error) {
      await showError(`创建副本失败：${String(error)}`)
      return
    }
    await openPath(target)
  }

  /**
   * 重命名 / 移动到 — write the document at a new path, then drop the old file.
   *
   * Order matters: the new copy is written first and only then is the original
   * removed. The other way round would lose the document whenever the write
   * failed — and a file operation that can destroy a document is not one to be
   * clever about.
   */
  const renameDocument = async (): Promise<void> => {
    const current = doc.getDocument()
    if (!current?.path) {
      toastHost.show('请先保存文档', { level: 'warn' })
      return
    }
    const oldPath = current.path
    const style = pathStyleFor(oldPath)
    const name = await showPrompt({
      title: '重命名 / 移动到',
      message: '相对路径按文档所在目录解析，也可以填绝对路径。',
      value: basename(oldPath),
      confirmText: '移动',
    })
    const trimmed = name?.trim()
    if (!trimmed) return
    const target = resolveImagePath(trimmed, oldPath, style) ?? trimmed
    if (target === oldPath) return
    try {
      let exists = false
      try {
        await host.fs.read(target)
        exists = true
      } catch {
        /* absent — safe to move onto */
      }
      if (exists) {
        await showError(`「${trimmed}」已存在`)
        return
      }
      // `doc.save(target)` writes the buffer *and* repoints the tab + recents,
      // so there is no second place that has to learn about the new path.
      await doc.save(target)
    } catch (error) {
      await showError(`移动失败：${String(error)}`)
      return
    }
    try {
      await host.fs.remove?.(oldPath)
    } catch (error) {
      // The document is safely at its new path; a leftover original is untidy,
      // not a loss — so say that rather than pretending the move failed.
      toastHost.show(`已移动到新位置，但原文件未能删除：${String(error)}`, { level: 'warn' })
    }
    sidebar.refreshRecents()
  }

  /** Decode a `data:` URL's payload to bytes — the inverse of `readBase64`. */
  const dataUrlBytes = (dataUrl: string): Uint8Array => {
    const comma = dataUrl.indexOf(',')
    if (comma < 0) throw new Error('不是 data URL')
    const binary = atob(dataUrl.slice(comma + 1))
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  }

  /**
   * 选择编码重新打开.
   *
   * Decoding happens in the renderer through `TextDecoder`, which means no new
   * host API: `readBase64` already hands over the bytes, and the platform is the
   * authority on which encodings exist.
   *
   * `fatal: true` on purpose — a wrong encoding must report, not quietly fill the
   * document with replacement characters that the next save would write back.
   */
  const reopenWithEncoding = async (): Promise<void> => {
    const current = doc.getDocument()
    if (!current?.path) {
      toastHost.show('请先保存文档', { level: 'warn' })
      return
    }
    const typed = await showPrompt({
      title: '选择编码重新打开',
      message: '例如 utf-8、gbk、shift_jis、utf-16le',
      value: 'utf-8',
      confirmText: '重新打开',
    })
    const label = typed?.trim().toLowerCase()
    if (!label) return
    let text: string
    try {
      text = new TextDecoder(label, { fatal: true }).decode(
        dataUrlBytes(await host.fs.readBase64(current.path)),
      )
    } catch (error) {
      await showError(`无法用 ${label} 读取：${String(error)}`)
      return
    }
    // Replaces the tab's content without marking it modified: decoding is how the
    // file reads, not an edit to it.
    doc.setDocument(current.path, text)
    sidebar.refreshRecents()
    statusbar.refresh()
  }

  /**
   * 复制公式 — 复制为 Tex 代码 / 复制为 MathML.
   *
   * The formula is located in the *markdown*, not the DOM: the three views
   * render math differently, and the source is the one place all of them agree
   * on what the formula is.
   */
  const copyMath = async (kind: 'tex' | 'mathml'): Promise<void> => {
    const span = mathSpanAt(editor.getMarkdown(), selectionRange().from)
    if (!span) {
      toastHost.show('光标不在公式内', { level: 'warn' })
      return
    }
    const latex = span.latex.trim()
    if (kind === 'tex') {
      await writeClipboard(latex)
      return
    }
    const mathml = latexToMathML(span.latex, span.block)
    if (!mathml) {
      // Better to say so than to put a half-rendered fragment on the clipboard.
      toastHost.show('该公式无法转换为 MathML', { level: 'warn' })
      return
    }
    // MathML *is* HTML, so it goes on as `text/html` with the LaTeX as the
    // plain-text fallback — a target that cannot take MathML still gets the formula.
    await writeClipboardHtml(mathml, latex)
  }

  const insertLinkReference = async (): Promise<void> => {
    // Capture the range up front — the prompt is modal and steals focus.
    const markdown = editor.getMarkdown()
    const range = selectionRange()
    const selected = markdown.slice(range.from, range.to).trim()
    if (!selected) {
      toastHost.show('请先选中要作为链接文字的文本', { level: 'warn' })
      return
    }
    const label = referenceLabel(selected)
    const url = await showPrompt({
      title: '链接引用',
      message: `引用标识：${label}`,
      placeholder: 'https://',
      confirmText: '插入',
    })
    if (!url?.trim()) return
    const inline = referenceLinkInline(selected, label)
    applyTextEdit({ range, text: inline, caret: range.from + inline.length })
    // The definition goes at the end, and only once: a second definition for the
    // same label is a document error, not a duplicate convenience.
    const after = editor.getMarkdown()
    if (hasReferenceDefinition(after, label)) return
    const separator = after.endsWith('\n\n') ? '' : after.endsWith('\n') ? '\n' : '\n\n'
    applyTextEdit({
      range: { from: after.length, to: after.length },
      text: `${separator}${referenceLinkDefinition(label, url.trim())}\n`,
    })
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

  const copySelectionAs = async (
    mode: 'markdown' | 'text' | 'html' | 'clean' | 'word',
  ): Promise<void> => {
    const markdown = editor.getMarkdown()
    const range = selectionRange()
    if (range.to <= range.from) return
    let text = markdown.slice(range.from, range.to)
    // 当复制纯文本时复制 Markdown 源码: the setting makes 复制为纯文本 hand over
    // the source rather than the rendered text — which is also the only way to get
    // the source out of the wysiwyg view, where the DOM has no markers.
    if (mode === 'text') {
      text = appearance.copyTextAsMarkdown === true
        ? markdown.slice(range.from, range.to)
        : editor.getSelectedText() || text
    }
    // 源码视图 has no rendered DOM: 纯文本/HTML fall back to the markdown slice.
    const sourceHtml = selectionHtml() || `<p>${escapeHtml(text)}</p>`
    const plainFallback = editor.getSelectedText() || text
    // 复制为 HTML 代码 / 复制到 MS Word / 复制内容并简化格式 all want a real
    // `text/html` flavour — writing the source as *text* would show the tags
    // wherever it is pasted.
    if (mode === 'html') {
      await writeClipboardHtml(sourceHtml, plainFallback)
      return
    }
    if (mode === 'clean' || mode === 'word') {
      // Our presentation describes how it looks *here*; pasted elsewhere it is
      // meaningless (or fights the destination's own styling). Word is the case
      // that motivated stripping it — our CSS confuses its importer.
      await writeClipboardHtml(stripHtmlFormatting(sourceHtml), plainFallback)
      return
    }
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
      { label: '正文', run: () => registry.run('format.plain') },
      { label: '一级标题', shortcut: formatShortcut('Mod+1'), run: () => registry.run('format.h1') },
      { label: '二级标题', shortcut: formatShortcut('Mod+2'), run: () => registry.run('format.h2') },
      { label: '三级标题', shortcut: formatShortcut('Mod+3'), run: () => registry.run('format.h3') },
      { label: '四级标题', shortcut: formatShortcut('Mod+4'), run: () => registry.run('format.h4') },
      { label: '五级标题', shortcut: formatShortcut('Mod+5'), run: () => registry.run('format.h5') },
      { label: '六级标题', shortcut: formatShortcut('Mod+6'), run: () => registry.run('format.h6') },
      {
        label: '提升标题级别',
        shortcut: formatShortcut('Mod+='),
        run: () => registry.run('format.headingUp'),
      },
      {
        label: '降低标题级别',
        shortcut: formatShortcut('Mod+-'),
        run: () => registry.run('format.headingDown'),
      },
      { separator: true },
      { label: '引用', shortcut: formatShortcut('Mod+Shift+Q'), run: () => registry.run('format.quote') },
      { label: '无序列表', run: () => registry.run('format.bullet') },
      { label: '有序列表', run: () => registry.run('format.ordered') },
      { label: '任务列表', run: () => registry.run('format.task') },
      { label: '标记为已完成', run: () => registry.run('format.taskDone') },
      { label: '标记为未完成', run: () => registry.run('format.taskTodo') },
      { label: '增加缩进', shortcut: formatShortcut('Mod+['), run: () => registry.run('format.listIndent') },
      {
        label: '减少缩进',
        shortcut: formatShortcut('Mod+]'),
        run: () => registry.run('format.listOutdent'),
      },
      { separator: true },
      { label: '代码块', shortcut: formatShortcut('Mod+Shift+K'), run: () => registry.run('format.codeBlock') },
      { label: '内容目录', run: () => registry.run('insert.toc') },
      { label: 'YAML Front Matter', run: () => registry.run('insert.frontmatter') },
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
      // The file-touching items need the reference in the *markdown*, which the
      // caret only knows when the right-click landed on (or selected) the image
      // node. Document-wide items stay available either way.
      const onImage = currentImage()
      items.unshift(
        {
          label: '打开图片',
          run: () => void host.app.openExternal(img.src),
        },
        {
          label: '复制图片地址',
          run: () => void writeClipboard(img.src),
        },
        {
          // 打开图片位置: the same `file:`-URL primitive the document-level
          // 「打开文件位置」 uses — a folder is just another path.
          label: '打开图片位置',
          run: () => {
            if (onImage) void revealFolder(dirname(onImage.path), '图片')
          },
          disabled: !onImage,
        },
        { separator: true },
        { label: '转换图片语法', run: () => registry.run('image.switchSyntax') },
        {
          label: '复制图片路径',
          run: () => registry.run('image.copyPath'),
          disabled: !onImage,
        },
        {
          label: '重命名 / 移动图片到…',
          run: () => registry.run('image.renameFile'),
          disabled: !onImage || !canEditImageFiles(),
        },
        {
          label: '删除图片文件',
          run: () => registry.run('image.deleteFile'),
          disabled: !onImage || !canEditImageFiles(),
        },
        { separator: true },
        {
          label: '复制所有图片到…',
          run: () => registry.run('image.copyAllTo'),
          disabled: !canEditImageFiles(),
        },
        {
          label: '移动所有图片到…',
          run: () => registry.run('image.moveAllTo'),
          disabled: !canEditImageFiles(),
        },
        { label: '重新加载所有图片', run: () => registry.run('image.reloadAll') },
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

  // Tracked so 保持窗口在最前端 is only pushed to the shell when it actually
  // changes — `applyAppearanceConfig` runs on every settings tweak.
  let appliedAlwaysOnTop: boolean | null = null
  /** Tracked so 显示隐藏的文件夹 only re-walks the tree when it really changes. */
  let appliedShowHidden: boolean | null = null

  const applyAppearanceConfig = (next: AppConfig): void => {
    appearance = next
    autoSaveEnabled = next.autoSave === true
    autoSaveDelayMs = next.autoSaveDelayMs ?? 1500
    applyAppearance(next)
    editor.setTypewriter(next.typewriter === true)
    editor.setLineNumbers(next.lineNumbers === true)
    editor.setSpellcheck(next.spellcheck === true)
    editor.setReadOnly(next.readOnly === true)
    editor.setSmartInput({
      smartQuotes: next.smartQuotes === true,
      smartDashes: next.smartDashes === true,
      pairedSymbols: next.pairedSymbols === true,
      emoji: next.emojiAutocomplete === true,
    })
    // 文件树 glob 过滤 is a view over an existing walk, so re-deriving the list
    // is enough — no re-walk, and the tree updates as the setting is typed.
    if (workspace.root) {
      workspace.files = applyWorkspaceFilter(workspace.allFiles ?? [])
      sidebar.refreshWorkspace()
    }
    // 目录显示的标题层数 is a view over the extracted outline too, so both the
    // sidebar tab and the floating panel just re-render.
    if (next.outlineMaxLevel !== undefined || appearance.outlineMaxLevel !== undefined) {
      sidebar.refreshOutline()
      refreshOutlinePanel()
    }
    // 显示隐藏的文件夹 / 文件 needs the opposite: the filter decides which entries
    // are *visited*, so there is no unfiltered list to re-derive from.
    const hidden = next.showHiddenFiles === true
    if (hidden !== appliedShowHidden) {
      appliedShowHidden = hidden
      if (workspace.root) void reloadWorkspace().catch(() => undefined)
    }
    editor.setImagePasteEnabled(next.imagePaste !== false)
    // 分屏 renders through OverType's own parser, so it needs the syntax
    // extensions installed separately from the remark pipeline.
    setOvertypeSyntax(mdSyntaxOptionsFromConfig(next))
    statusbar.setShowStats(next.showStats !== false)
    shellEl?.classList.toggle('shell--focus', next.focusMode === true)
    const onTop = next.alwaysOnTop === true
    if (onTop !== appliedAlwaysOnTop) {
      appliedAlwaysOnTop = onTop
      void host.app.setWindowState?.({ alwaysOnTop: onTop })
    }
    host.app.setConfig(next)
    statusbar.refresh()
    sidebar.refreshRecents()
  }

  let zoomPersistTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 视图 ▸ 放大 / 缩小.
   *
   * The CSS variable is set straight away so Ctrl+滚轮 feels attached to the
   * document, but the config write is debounced: one wheel gesture fires dozens
   * of events, and each would otherwise rewrite the config file.
   */
  const setViewZoom = (value: number, immediate: boolean): void => {
    const next = clampZoom(value)
    if (next === clampZoom(appearance.viewZoom)) return
    appearance = { ...appearance, viewZoom: next }
    document.documentElement.style.setProperty('--view-zoom', zoomCss(next))
    if (immediate) {
      host.app.setConfig(appearance)
      return
    }
    if (zoomPersistTimer !== null) clearTimeout(zoomPersistTimer)
    zoomPersistTimer = setTimeout(() => {
      zoomPersistTimer = null
      host.app.setConfig(appearance)
    }, 400)
  }

  /**
   * Ctrl/⌘ + wheel zooms, as in Typora. Bound to the editor pane rather than
   * the window so it does not fight the sidebar's own scrolling.
   */
  editor.el.addEventListener(
    'wheel',
    (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      const next = zoomFromWheelDelta(appearance.viewZoom, event.deltaY)
      // At either end of the ladder, leave the gesture alone so it still
      // scrolls instead of swallowing the event for nothing.
      if (next === clampZoom(appearance.viewZoom)) return
      event.preventDefault()
      setViewZoom(next, false)
    },
    // Required: wheel listeners are passive by default, and a passive listener
    // cannot preventDefault the browser's own page zoom.
    { passive: false },
  )

  const findPanel = createFindPanel({
    // 查找/替换的基准文本。别换成 `editor.getMarkdown()` —— 实时预览的
    // `restoreAnchor` 按序列化输出对齐，两者差在转义上，锚点会整体错位。
    getMarkdown: () => editor.getSearchValue(),
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
  registry.register({ id: 'file.saveAll', label: '保存全部', run: () => void saveAll() })
  registry.register({
    id: 'file.reopenClosed',
    label: '重新打开关闭的文件',
    shortcut: 'Mod+Shift+T',
    run: () => void reopenClosed(),
  })
  /**
   * Reveal a folder through `openExternal` with a `file:` URL — the one
   * primitive every shell already has for "let the OS deal with this". A
   * failure is reported, unlike 导出后: nothing else happened, so staying silent
   * would look like the command did nothing.
   */
  const revealFolder = async (folder: string, what: string): Promise<void> => {
    try {
      await host.app.openExternal(fileUrl(folder))
    } catch (error) {
      await showError(`无法打开${what}所在目录：${String(error)}`)
    }
  }
  registry.register({
    id: 'file.revealInFolder',
    label: '打开文件位置',
    run: () => {
      const current = doc.getDocument()
      if (!current?.path) {
        toastHost.show('当前文档尚未保存', { level: 'warn' })
        return
      }
      void revealFolder(dirname(current.path), '文档')
    },
  })
  registry.register({
    id: 'file.revealInSidebar',
    label: '在文件树中显示',
    run: () => {
      const current = doc.getDocument()
      if (!current?.path) {
        toastHost.show('当前文档尚未保存', { level: 'warn' })
        return
      }
      sidebar.showTab('file')
      sidebar.revealPath(current.path, { scroll: true })
    },
  })
  registry.register({
    id: 'settings.advancedConfig',
    label: '高级设置（打开配置目录）',
    run: async () => {
      // The config root, not a guessed file name: the file is written by the
      // shell and an older build may not have created it yet.
      const folder = await host.app.getPath?.('userData').catch(() => null)
      if (!folder) {
        toastHost.show('当前环境无法定位配置目录', { level: 'warn' })
        return
      }
      void revealFolder(folder, '配置')
    },
  })
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
    id: 'format.underline',
    label: '下划线',
    shortcut: 'Mod+U',
    run: () => applyInlineFormat('underline'),
  })
  registry.register({
    id: 'format.strike',
    label: '删除线',
    run: () => applyInlineFormat('strike'),
  })
  registry.register({
    id: 'format.highlight',
    label: '高亮',
    run: () => applyInlineFormat('highlight'),
  })
  registry.register({
    id: 'format.sup',
    label: '上标',
    run: () => applyInlineFormat('sup'),
  })
  registry.register({
    id: 'format.sub',
    label: '下标',
    run: () => applyInlineFormat('sub'),
  })
  registry.register({
    id: 'format.link',
    label: '超链接…',
    shortcut: 'Mod+K',
    run: () => void insertLink(),
  })
  registry.register({
    id: 'format.linkReference',
    label: '链接引用…',
    run: () => void insertLinkReference(),
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
    shortcut: 'Mod+0',
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
    id: 'format.tableSource',
    label: '格式化表格源码',
    // Aligns the columns of the table the caret is in, in the source text. Only
    // the *source* can be aligned; the rendered table is already aligned by CSS.
    run: () => applyTextEdit(formatTableSource(editor.getMarkdown(), selectionRange())),
  })
  registry.register({
    id: 'format.deleteBlock',
    label: '删除块',
    run: () => applyTextEdit(deleteBlockEdit(editor.getMarkdown(), selectionRange())),
  })
  registry.register({
    id: 'format.insertParagraphBefore',
    label: '在上方插入段落',
    run: () => applyTextEdit(insertParagraphEdit(editor.getMarkdown(), selectionRange(), 'before')),
  })
  registry.register({
    id: 'format.insertParagraphAfter',
    label: '在下方插入段落',
    run: () => applyTextEdit(insertParagraphEdit(editor.getMarkdown(), selectionRange(), 'after')),
  })
  registry.register({
    id: 'format.headingUp',
    label: '提升标题级别',
    shortcut: 'Mod+=',
    run: () => applyHeadingStep('up'),
  })
  registry.register({
    id: 'format.headingDown',
    label: '降低标题级别',
    shortcut: 'Mod+-',
    run: () => applyHeadingStep('down'),
  })
  registry.register({
    id: 'format.listIndent',
    label: '增加缩进',
    shortcut: 'Mod+[',
    run: () => applyListIndent('in'),
  })
  registry.register({
    id: 'format.listOutdent',
    label: '减少缩进',
    shortcut: 'Mod+]',
    run: () => applyListIndent('out'),
  })
  registry.register({
    id: 'format.taskDone',
    label: '标记为已完成',
    run: () => applyTaskStatus('done'),
  })
  registry.register({
    id: 'format.taskTodo',
    label: '标记为未完成',
    run: () => applyTaskStatus('todo'),
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
  // 选中当前… / 跳转 / 整行 — Typora 的「编辑」节.
  registry.register({
    id: 'edit.selectLine',
    label: '选中当前行',
    shortcut: 'Mod+L',
    run: () => selectScopeCommand('line'),
  })
  registry.register({
    id: 'edit.selectWord',
    label: '选中当前词',
    shortcut: 'Mod+D',
    run: () => selectScopeCommand('word'),
  })
  registry.register({
    id: 'edit.selectSentence',
    label: '选中当前句',
    run: () => selectScopeCommand('sentence'),
  })
  registry.register({
    id: 'edit.selectBlock',
    label: '选中当前块',
    shortcut: 'Mod+Shift+A',
    run: () => selectScopeCommand('block'),
  })
  registry.register({
    id: 'edit.copyLine',
    label: '复制整行',
    shortcut: 'Mod+Shift+X',
    run: () => void copyOrCutLine(false),
  })
  registry.register({
    id: 'edit.cutLine',
    label: '剪切整行',
    run: () => void copyOrCutLine(true),
  })
  registry.register({
    id: 'edit.jumpStart',
    label: '跳转到文首',
    shortcut: 'Mod+Home',
    run: () => jumpTo(documentEdge(editor.getMarkdown(), 'start')),
  })
  registry.register({
    id: 'edit.jumpEnd',
    label: '跳转到文末',
    shortcut: 'Mod+End',
    run: () => jumpTo(documentEdge(editor.getMarkdown(), 'end')),
  })
  registry.register({
    id: 'edit.jumpLineStart',
    label: '跳转到行首',
    run: () => jumpTo(lineEdge(editor.getMarkdown(), selectionRange().from, 'start')),
  })
  registry.register({
    id: 'edit.jumpLineEnd',
    label: '跳转到行尾',
    run: () => jumpTo(lineEdge(editor.getMarkdown(), selectionRange().from, 'end')),
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
    id: 'edit.copyAsCleanHtml',
    label: '复制内容并简化格式',
    run: () => void copySelectionAs('clean'),
  })
  registry.register({
    id: 'edit.copyMathTex',
    label: '复制为 Tex 代码',
    run: () => void copyMath('tex'),
  })
  registry.register({
    id: 'edit.copyMathMl',
    label: '复制为 MathML',
    run: () => void copyMath('mathml'),
  })
  registry.register({
    id: 'edit.copyToWord',
    label: '复制到 MS Word',
    run: () => void copySelectionAs('word'),
  })
  registry.register({
    id: 'search.google',
    label: '使用 Google 搜索所选内容',
    run: () => {
      const query = editor.getSelectedText().trim()
      if (!query) {
        toastHost.show('请先选中要搜索的内容', { level: 'warn' })
        return
      }
      void host.app.openExternal(`https://www.google.com/search?q=${encodeURIComponent(query)}`)
    },
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
    id: 'insert.toc',
    label: '内容目录',
    // The marker is expanded by the render pipeline into a nested list of
    // links to every heading, and each heading carries the matching anchor.
    run: () => editor.insertMarkdown(`${TOC_MARKER}\n\n`),
  })
  registry.register({
    id: 'insert.htmlBlock',
    label: 'HTML 内容块',
    // A pair of tags with an empty line between them, caret inside: markdown
    // passes raw HTML through, so an editor that wants to write some only needs
    // the block opened.
    run: () => editor.insertMarkdown('<div>\n\n</div>\n\n'),
  })
  registry.register({
    id: 'file.duplicate',
    label: '创建副本',
    run: () => void duplicateDocument(),
  })
  registry.register({
    id: 'file.rename',
    label: '重命名 / 移动到…',
    run: () => void renameDocument(),
  })
  registry.register({
    id: 'file.reopenEncoding',
    label: '选择编码重新打开…',
    run: () => void reopenWithEncoding(),
  })
  registry.register({
    id: 'insert.frontmatter',
    label: 'YAML Front Matter',
    run: insertFrontmatter,
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
  // 图像工具 — the document-side operations from Typora's image menu.
  registry.register({ id: 'image.switchSyntax', label: '转换图片语法', run: switchImageSyntax })
  registry.register({
    id: 'image.copyPath',
    label: '复制图片路径',
    run: () => void copyImagePath(),
  })
  registry.register({
    id: 'image.deleteFile',
    label: '删除图片文件',
    run: () => void deleteImageFile(),
  })
  registry.register({
    id: 'image.renameFile',
    label: '重命名 / 移动图片到…',
    run: () => void renameImageFile(),
  })
  registry.register({
    id: 'image.copyAllTo',
    label: '复制所有图片到…',
    run: () => void transferAllImages(false),
  })
  registry.register({
    id: 'image.moveAllTo',
    label: '移动所有图片到…',
    run: () => void transferAllImages(true),
  })
  registry.register({
    id: 'image.reloadAll',
    label: '重新加载所有图片',
    run: reloadAllImages,
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
    id: 'view.zoomIn',
    label: '放大',
    shortcut: 'Mod+Shift+=',
    run: () => setViewZoom(stepZoom(appearance.viewZoom, 'in'), true),
  })
  registry.register({
    id: 'view.zoomOut',
    label: '缩小',
    shortcut: 'Mod+Shift+-',
    run: () => setViewZoom(stepZoom(appearance.viewZoom, 'out'), true),
  })
  registry.register({
    id: 'view.zoomReset',
    label: '实际大小',
    shortcut: 'Mod+Shift+0',
    run: () => setViewZoom(ZOOM_DEFAULT, true),
  })
  // Set-style twins of the toggles above, so menu.json can render them as
  // checkboxes (a toggle command cannot report state). The toggles stay for the
  // context menu and the command palette. Written out one by one rather than
  // generated: pm-l-menu matches literal `registry.register({ id: '…' })`, and
  // that check is exactly what should catch a menu id with no command behind it.
  const setViewFlag = (
    key: 'typewriter' | 'focusMode' | 'lineNumbers' | 'showStats' | 'alwaysOnTop' | 'readOnly',
    value: boolean,
  ): void => applyAppearanceConfig({ ...appearance, [key]: value })
  registry.register({ id: 'view.readOnlyOn', label: '只读模式：开', run: () => setViewFlag('readOnly', true) })
  registry.register({ id: 'view.readOnlyOff', label: '只读模式：关', run: () => setViewFlag('readOnly', false) })
  registry.register({ id: 'view.typewriterOn', label: '打字机模式：开', run: () => setViewFlag('typewriter', true) })
  registry.register({ id: 'view.typewriterOff', label: '打字机模式：关', run: () => setViewFlag('typewriter', false) })
  registry.register({ id: 'view.focusModeOn', label: '专注模式：开', run: () => setViewFlag('focusMode', true) })
  registry.register({ id: 'view.focusModeOff', label: '专注模式：关', run: () => setViewFlag('focusMode', false) })
  registry.register({ id: 'view.lineNumbersOn', label: '行号：开', run: () => setViewFlag('lineNumbers', true) })
  registry.register({ id: 'view.lineNumbersOff', label: '行号：关', run: () => setViewFlag('lineNumbers', false) })
  registry.register({ id: 'view.showStatsOn', label: '字数统计：开', run: () => setViewFlag('showStats', true) })
  registry.register({ id: 'view.showStatsOff', label: '字数统计：关', run: () => setViewFlag('showStats', false) })
  registry.register({
    id: 'view.alwaysOnTopOn',
    label: '保持窗口在最前端：开',
    run: () => setViewFlag('alwaysOnTop', true),
  })
  registry.register({
    id: 'view.alwaysOnTopOff',
    label: '保持窗口在最前端：关',
    run: () => setViewFlag('alwaysOnTop', false),
  })
  // Fullscreen is window state, not document state — it is deliberately not
  // persisted (a window that reopens fullscreen is a nuisance) and tracked here
  // so the menu can be a plain toggle.
  let fullscreen = false
  registry.register({
    id: 'view.fullscreen',
    label: '切换全屏',
    shortcut: 'F11',
    run: () => {
      fullscreen = !fullscreen
      void host.app.setWindowState?.({ fullscreen })
    },
  })
  registry.register({
    id: 'view.stats',
    label: '字数统计浮窗',
    run: () => {
      statsPanel.toggle()
      refreshStatsPanel()
    },
  })
  registry.register({
    id: 'view.outline',
    label: '大纲浮窗',
    run: () => {
      outlinePanel.toggle()
      refreshOutlinePanel()
    },
  })
  registry.register({
    id: 'settings.open',
    label: '打开设置…',
    shortcut: 'Mod+,',
    run: settings.open,
  })
  registry.register({
    id: 'settings.general',
    label: '设置：通用',
    run: () => settings.open('general'),
  })
  registry.register({
    id: 'settings.appearance',
    label: '设置：外观',
    run: () => settings.open('appearance'),
  })
  registry.register({
    id: 'settings.editor',
    label: '设置：编辑器',
    run: () => settings.open('editor'),
  })
  registry.register({
    id: 'settings.image',
    label: '设置：图像',
    run: () => settings.open('image'),
  })
  registry.register({
    id: 'settings.export',
    label: '设置：导出',
    run: () => settings.open('export'),
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
    isChecked: (id) => {
      if (id === 'file.autoSave') return autoSaveEnabled
      if (id === 'view.typewriter') return appearance.typewriter === true
      if (id === 'view.focusMode') return appearance.focusMode === true
      if (id === 'view.lineNumbers') return appearance.lineNumbers === true
      if (id === 'view.showStats') return appearance.showStats !== false
      if (id === 'view.alwaysOnTop') return appearance.alwaysOnTop === true
      if (id === 'view.readOnly') return appearance.readOnly === true
      return false
    },
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
      // 右侧滑入面板：与侧栏/编辑器同一 flex 行，收起时宽度 0。
      settings.el,
    ),
    statusbar.el,
  )
  shellEl = shell
  if (appearance.focusMode === true) shell.classList.add('shell--focus')

  root.replaceChildren(
    shell,
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

import {
  DocStore,
  SyncEngine,
  createHybridAdapter,
  createSourceAdapter,
  createWysiwygAdapter,
  isImageFile,
  type Anchor,
  type BlockFormatId,
  type LineAt,
  type TableCommandId,
  type ViewKind,
} from '@markup/core'
import { el } from '../dom'

const VIEW_KINDS: ViewKind[] = ['wysiwyg', 'source', 'hybrid']

const MODE_LABELS: Record<ViewKind, string> = {
  wysiwyg: '实时预览',
  source: '分屏',
  hybrid: '源码',
}

export interface EditorPaneApi {
  el: HTMLElement
  getMarkdown(): string
  setValue(markdown: string): void
  gotoAnchor(anchor: Anchor): void
  setView(kind: ViewKind): void
  insertMarkdown(markdown: string, caretOffset?: number): void
  insertImage(file: File): Promise<boolean>
  insertTable(rows?: number, cols?: number): void
  /** Run a wysiwyg table edit command; false when unsupported/guarded/no-op. */
  runTableCommand(id: TableCommandId): boolean
  /**
   * True when the active view applies paragraph formats natively (wysiwyg).
   * When false the caller rewrites the markdown text instead.
   */
  supportsBlockFormat(): boolean
  /**
   * Apply a paragraph format in the active view. Returns false when the view
   * cannot do it natively (the caller then rewrites the markdown text).
   */
  setBlockFormat(id: BlockFormatId): boolean
  setCodeLanguage(language: string): void
  /** When enabled, keep the caret line centered after edits/selection. */
  setTypewriter(enabled: boolean): void
  /** Immediately center the caret line if typewriter is on. */
  centerCaret(): void
  /** Focus the active adapter's editable surface. */
  focus(): void
  /** Current selection text from DOM/textarea if available. */
  getSelectedText(): string
  /** Caret/selection as 0-based markdown offsets (to exclusive); null without a mounted surface. */
  getSelectionRange(): { from: number; to: number } | null
  /** Move caret/selection to offsets (to omitted = collapse). Clamped; false without a surface. */
  setSelectionRange(from: number, to?: number): boolean
  /** Toggle line numbers in source/hybrid (re-applied on view switch). */
  setLineNumbers(enabled: boolean): void
  /** Toggle browser spellcheck (re-applied on view switch). */
  setSpellcheck(enabled: boolean): void
  /** True when pasted clipboard images should become markdown images. */
  getImagePasteEnabled(): boolean
  setImagePasteEnabled(enabled: boolean): void
  /** Active view kind (wysiwyg/source/hybrid). */
  getViewKind(): ViewKind
  /** Resolve markdown line under viewport point (source/hybrid; null when unsupported). */
  getLineAt(clientX: number, clientY: number): LineAt | null
}

export interface EditorContextMenuContext {
  target: EventTarget | null
  clientX: number
  clientY: number
}

export function renderEditorPane(
  doc: DocStore,
  hooks: {
    onContentChanged?: () => void
    onContextMenu?: (event: MouseEvent, context: EditorContextMenuContext) => void
  } = {},
): EditorPaneApi {
  const sidebarRefresh = hooks.onContentChanged
  const sync = new SyncEngine()
  let typewriter = false
  let centerTimer: ReturnType<typeof requestAnimationFrame> | null = null
  let lineNumbers = false
  let spellcheck = false
  let imagePaste = true
  let buttons: HTMLElement[] = []
  // Remount may fire adapter onChange (OverType init, Milkdown serialize).
  // View switches must not mark the document dirty.
  let suppressDirty = false

  const push = (markdown: string): void => {
    doc.setContent(markdown, { markModified: !suppressDirty })
    if (typewriter) scheduleCenter()
  }
  sync.register('wysiwyg', createWysiwygAdapter({ onChange: push }))
  sync.register('source', createSourceAdapter({ onChange: push }))
  sync.register('hybrid', createHybridAdapter({ onChange: push }))

  const applyViewChrome = (): void => {
    const active = sync.getActive()
    active?.setLineNumbers?.(lineNumbers)
    active?.setSpellcheck?.(spellcheck)
  }

  const centerNow = (): void => {
    centerTimer = null
    if (!typewriter) return
    const active = sync.getActive()
    active?.centerCaret?.()
  }

  const scheduleCenter = (): void => {
    if (centerTimer !== null) cancelAnimationFrame(centerTimer)
    centerTimer = requestAnimationFrame(centerNow)
  }

  const setTypewriter = (enabled: boolean): void => {
    typewriter = enabled
    if (enabled) scheduleCenter()
  }

  const onSelection = (): void => {
    if (typewriter) scheduleCenter()
  }

  doc.subscribe(() => {
    const current = doc.getDocument()
    if (!current) return
    const active = sync.getActive()
    if (active && active.getValue() === current.content) return
    sync.setMarkdown(current.content)
  })

  const viewport = el('div', { class: 'editor-viewport' })
  sync.mount('wysiwyg', viewport)
  viewport.addEventListener('selectionchange', onSelection)
  viewport.addEventListener('keyup', onSelection)
  viewport.addEventListener('mouseup', onSelection)
  viewport.addEventListener('contextmenu', (event: MouseEvent) => {
    if (!hooks.onContextMenu) return
    event.preventDefault()
    hooks.onContextMenu(event, {
      target: event.target,
      clientX: event.clientX,
      clientY: event.clientY,
    })
  })

  const extractImageFile = (event: ClipboardEvent): File | null => {
    const items = event.clipboardData?.items
    if (!items) return null
    for (const item of items) {
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (file && isImageFile(file)) return file
    }
    return null
  }

  viewport.addEventListener('paste', (event: ClipboardEvent) => {
    // Milkdown's upload plugin may consume file pastes first (it calls
    // preventDefault); inserting again would duplicate the image.
    if (!imagePaste || event.defaultPrevented) return
    const file = extractImageFile(event)
    if (!file) return
    event.preventDefault()
    void editorPane.insertImage(file)
  })

  const setView = (kind: ViewKind): void => {
    if (sync.getKind() === kind) return
    suppressDirty = true
    try {
      sync.mount(kind, viewport)
    } finally {
      // Cover async Milkdown create() settling after mount returns.
      window.setTimeout(() => {
        window.requestAnimationFrame(() => {
          suppressDirty = false
        })
      }, 0)
    }
    for (let i = 0; i < buttons.length; i++) {
      buttons[i]?.classList.toggle('is-active', VIEW_KINDS[i] === kind)
    }
    applyViewChrome()
    if (typewriter) scheduleCenter()
  }

  buttons = VIEW_KINDS.map((kind) =>
    el('button', {
      class: `mode-btn${kind === 'wysiwyg' ? ' is-active' : ''}`,
      type: 'button',
      text: MODE_LABELS[kind],
      title: MODE_LABELS[kind],
      onclick: () => setView(kind),
    }),
  )

  const pane = el('section', { class: 'editor-pane' }, viewport, el('div', { class: 'mode-bar' }, ...buttons))

  const editorPane: EditorPaneApi = {
    el: pane,
    getMarkdown: () => sync.getMarkdown(),
    setValue: (markdown: string) => {
      const active = sync.getActive()
      if (active) active.setValue(markdown)
      doc.setContent(markdown)
    },
    gotoAnchor: (anchor) => {
      const active = sync.getActive()
      if (!active) return
      active.restoreAnchor(anchor)
      active.focus()
    },
    setView,
    insertMarkdown: (markdown, caretOffset) => {
      const active = sync.getActive()
      if (!active?.insertMarkdown) return
      active.insertMarkdown({ markdown, caretOffset })
      doc.setContent(active.getValue())
      sidebarRefresh?.()
    },
    insertImage: async (file) => {
      const active = sync.getActive()
      if (!active?.insertImage) return false
      const ok = await active.insertImage(file)
      if (ok) {
        doc.setContent(active.getValue())
        sidebarRefresh?.()
      }
      return ok
    },
    insertTable: (rows, cols) => {
      const active = sync.getActive()
      if (active?.insertTable) active.insertTable(rows, cols)
      else if (active?.insertMarkdown) {
        const r = rows ?? 3
        const c = cols ?? 3
        const header = `| ${Array.from({ length: c }, (_, i) => `H${i + 1}`).join(' | ')} |`
        const sep = `| ${Array.from({ length: c }, () => '---').join(' | ')} |`
        const body = Array.from(
          { length: Math.max(0, r - 1) },
          () => `| ${Array.from({ length: c }, () => ' ').join(' | ')} |`,
        )
        active.insertMarkdown({ markdown: [header, sep, ...body].join('\n') })
      }
      const active2 = sync.getActive()
      if (active2) {
        doc.setContent(active2.getValue())
        sidebarRefresh?.()
      }
    },
    runTableCommand: (id) => {
      const active = sync.getActive()
      if (!active?.runTableCommand) return false
      const ok = active.runTableCommand(id)
      if (ok) {
        doc.setContent(active.getValue())
        sidebarRefresh?.()
      }
      return ok
    },
    setCodeLanguage: (language) => {
      const active = sync.getActive()
      if (!active) return
      if (active.setCodeLanguage) active.setCodeLanguage(language)
      else if (active.insertMarkdown) {
        active.insertMarkdown({ markdown: `\n\`\`\`${language}\n\n\`\`\`\n` })
      }
      doc.setContent(active.getValue())
      sidebarRefresh?.()
    },
    supportsBlockFormat: () => Boolean(sync.getActive()?.setBlockFormat),
    setBlockFormat: (id) => {
      const active = sync.getActive()
      if (!active?.setBlockFormat) return false
      const applied = active.setBlockFormat(id)
      if (applied) {
        // The adapter flushes its serializer synchronously; mirror it into the
        // store so the tab goes dirty / autosave sees it right away.
        doc.setContent(active.getValue())
        sidebarRefresh?.()
        active.focus()
      }
      return applied
    },
    setTypewriter,
    centerCaret: () => {
      if (!typewriter) return
      sync.getActive()?.centerCaret?.()
    },
    focus: () => {
      sync.getActive()?.focus()
      const active = document.activeElement
      if (
        active instanceof HTMLElement &&
        (active.tagName === 'TEXTAREA' || active.isContentEditable)
      ) {
        return
      }
      const editable = viewport.querySelector<HTMLElement>('textarea, [contenteditable="true"]')
      editable?.focus()
    },
    getSelectedText: () => {
      const selection = window.getSelection()
      if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
        return selection.toString()
      }
      const active = document.activeElement
      if (
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLInputElement
      ) {
        const start = active.selectionStart ?? 0
        const end = active.selectionEnd ?? start
        if (end > start) return active.value.slice(start, end)
      }
      return ''
    },
    getSelectionRange: () => {
      const active = sync.getActive()
      if (!active) return null
      const anchor = active.captureAnchor()
      const from = anchor.offset
      return { from, to: anchor.endOffset ?? from }
    },
    setSelectionRange: (from, to) => {
      const active = sync.getActive()
      if (!active) return false
      const value = active.getValue()
      const clamp = (n: number): number => Math.min(Math.max(Math.trunc(n), 0), value.length)
      const start = clamp(from)
      const end = clamp(to ?? from)
      const prefix = value.slice(0, start)
      active.restoreAnchor({
        offset: start,
        line: prefix.length === 0 ? 1 : prefix.split('\n').length,
        endOffset: Math.max(start, end),
      })
      return true
    },
    setLineNumbers: (enabled: boolean) => {
      lineNumbers = enabled
      applyViewChrome()
    },
    setSpellcheck: (enabled: boolean) => {
      spellcheck = enabled
      applyViewChrome()
    },
    getImagePasteEnabled: () => imagePaste,
    setImagePasteEnabled: (enabled: boolean) => {
      imagePaste = enabled
    },
    getViewKind: () => sync.getKind() ?? 'wysiwyg',
    getLineAt: (clientX, clientY) => sync.getActive()?.getLineAt?.(clientX, clientY) ?? null,
  }

  applyViewChrome()

  return editorPane
}

import { getHost } from '@markup/host-api'

export interface OpenDoc {
  /** Stable in-memory tab id — never persisted, never a path. */
  id: string
  path: string
  content: string
  modified: boolean
}

type DocListener = () => void

/**
 * Tab-backed document store: N open documents, exactly one active.
 *
 * `getDocument()` / `setContent()` keep their single-document semantics and
 * always address the **active** tab, so the editor pane, export and plugins
 * stay tab-agnostic; the tab bar drives the tab-only operations.
 */
export class DocStore {
  private docs: OpenDoc[] = []
  private activeId: string | null = null
  private listeners = new Set<DocListener>()
  private recentsListener: ((recents: string[]) => void) | null = null
  private seq = 0

  subscribe(listener: DocListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Notified whenever this store writes the persisted `recentDocuments`.
   * The shell keeps its in-memory config copy in sync through it, so the
   * session save cannot overwrite the list with a stale snapshot.
   */
  onRecentsChange(listener: (recents: string[]) => void): void {
    this.recentsListener = listener
  }

  /** Shallow copy of the tab list in visual order. */
  getTabs(): OpenDoc[] {
    return [...this.docs]
  }

  getTabCount(): number {
    return this.docs.length
  }

  getTab(id: string): OpenDoc | null {
    return this.docs.find((doc) => doc.id === id) ?? null
  }

  getActiveId(): string | null {
    return this.activeId
  }

  hasPath(path: string): boolean {
    return !!path && this.docs.some((doc) => doc.path === path)
  }

  getDocument(): OpenDoc | null {
    return this.docs.find((doc) => doc.id === this.activeId) ?? null
  }

  isOpen(): boolean {
    return this.docs.length > 0
  }

  hasModified(): boolean {
    return this.docs.some((doc) => doc.modified)
  }

  getModified(): OpenDoc[] {
    return this.docs.filter((doc) => doc.modified)
  }

  /**
   * Read `path` into a tab and focus it. An already-open path is focused as-is
   * (re-reading would silently discard unsaved edits in that tab).
   */
  async open(path: string): Promise<void> {
    const existing = this.docs.find((doc) => doc.path && doc.path === path)
    if (existing) {
      this.switchTo(existing.id)
      return
    }
    const { content } = await getHost().fs.read(path)
    this.createTab(path, content, false)
    void this.pushRecent(path)
  }

  /**
   * Focus the tab owning `path`, or open it as a new tab (reusing a blank
   * untitled tab first). Same contract as before tabs existed, plus focus.
   */
  setDocument(path: string, content: string): void {
    const existing = this.docs.find((doc) => doc.path && doc.path === path)
    if (existing) {
      this.activeId = existing.id
      // Fresh content wins only while the tab is untouched — never overwrite
      // unsaved edits with the bytes we just read from disk.
      if (!existing.modified && existing.content !== content) existing.content = content
      this.emit()
      if (path) void this.pushRecent(path)
      return
    }
    const active = this.getDocument()
    if (active && !active.path && !active.modified && active.content === '') {
      active.path = path
      active.content = content
      active.modified = false
      this.emit()
    } else {
      this.createTab(path, content, false)
    }
    if (path) void this.pushRecent(path)
  }

  /**
   * Session restore: add a tab **without** focusing it and without touching
   * the recents list (the restored order matters more than recency here).
   */
  restoreTab(path: string, content: string): OpenDoc | null {
    if (!path) return null
    const existing = this.docs.find((doc) => doc.path === path)
    if (existing) {
      if (!existing.modified && existing.content !== content) {
        existing.content = content
        this.emit()
      }
      return existing
    }
    return this.createTab(path, content, false, { focus: false })
  }

  /** Drop untouched blank tabs (leftover after session restore). */
  dropBlankTab(): boolean {
    const blank = (doc: OpenDoc): boolean => !doc.path && !doc.modified && doc.content === ''
    const blanks = this.docs.filter(blank)
    if (blanks.length === 0 || this.docs.length - blanks.length < 1) return false
    return this.closeWhere(blank) > 0
  }

  /**
   * Explicit "new tab" (focuses it). Always stacks a fresh tab — reusing an
   * untouched blank one here would make the + button look dead. Blank reuse
   * belongs to `setDocument()`/`open()`, where it stops file opens from piling
   * up empty tabs.
   */
  newTab(content = ''): OpenDoc {
    return this.createTab('', content, content.length > 0)
  }

  /** Focus an existing tab by id. False when unknown or already active. */
  switchTo(id: string): boolean {
    const target = this.getTab(id)
    if (!target || target.id === this.activeId) return false
    this.activeId = id
    this.emit()
    return true
  }

  /** Focus the tab owning `path`. */
  switchToPath(path: string): boolean {
    const target = this.docs.find((doc) => doc.path === path)
    if (!target) return false
    return this.switchTo(target.id)
  }

  /** Focus the tab at `offset` positions from the active one (wrapping). */
  cycle(offset: number): boolean {
    if (this.docs.length < 2) return false
    const index = this.docs.findIndex((doc) => doc.id === this.activeId)
    if (index < 0) return false
    const next = (index + offset + this.docs.length) % this.docs.length
    return this.switchTo(this.docs[next]?.id ?? '')
  }

  /**
   * Close one tab. Returns false when unknown; the caller decides whether a
   * modified document may be discarded. Focus moves to a neighbour.
   */
  closeTab(id: string): boolean {
    const index = this.docs.findIndex((doc) => doc.id === id)
    if (index < 0) return false
    this.docs.splice(index, 1)
    if (this.docs.length === 0) this.activeId = null
    else if (this.activeId === id) {
      this.activeId = this.docs[Math.min(index, this.docs.length - 1)]?.id ?? null
    }
    this.emit()
    return true
  }

  /**
   * Close every tab matching `predicate`. Returns how many closed; the active
   * tab survives when it does not match, otherwise focus moves to its
   * nearest neighbour.
   */
  closeWhere(predicate: (doc: OpenDoc) => boolean): number {
    const activeIndex = this.docs.findIndex((doc) => doc.id === this.activeId)
    const kept = this.docs.filter((doc) => !predicate(doc))
    const removed = this.docs.length - kept.length
    if (removed === 0) return 0
    this.docs = kept
    if (kept.length === 0) this.activeId = null
    else if (!kept.some((doc) => doc.id === this.activeId)) {
      this.activeId = kept[Math.min(Math.max(activeIndex, 0), kept.length - 1)]?.id ?? null
    }
    this.emit()
    return removed
  }

  /** Drag-reorder: move `id` next to `targetId` (before/after it). */
  reorder(id: string, targetId: string, before: boolean): boolean {
    if (id === targetId) return false
    const from = this.docs.findIndex((doc) => doc.id === id)
    if (from < 0) return false
    const [moved] = this.docs.splice(from, 1)
    if (!moved) return false
    let to = this.docs.findIndex((doc) => doc.id === targetId)
    if (to < 0) {
      this.docs.splice(from, 0, moved)
      return false
    }
    if (!before) to += 1
    this.docs.splice(to, 0, moved)
    this.emit()
    return true
  }

  /** Write the active tab (or `targetPath` via save-as). */
  async save(targetPath?: string): Promise<boolean> {
    const doc = this.getDocument()
    if (!doc) return false
    return this.saveOne(doc, targetPath)
  }

  /** Persist every dirty tab that has a path (autosave across all tabs). */
  async saveModified(): Promise<number> {
    let saved = 0
    for (const doc of [...this.docs]) {
      if (!doc.path || !doc.modified) continue
      if (await this.saveOne(doc)) saved += 1
    }
    return saved
  }

  private async saveOne(doc: OpenDoc, targetPath?: string): Promise<boolean> {
    const path = targetPath ?? doc.path
    if (!path) return false
    await getHost().fs.write(path, doc.content)
    if (targetPath && targetPath !== doc.path) doc.path = targetPath
    doc.modified = false
    this.emit()
    void this.pushRecent(doc.path)
    return true
  }

  setContent(content: string, options: { markModified?: boolean } = {}): void {
    const markModified = options.markModified !== false
    const doc = this.getDocument()
    if (!doc) {
      this.createTab('', content, markModified)
      return
    }
    if (doc.content === content) return
    doc.content = content
    if (markModified) doc.modified = true
    this.emit()
  }

  private createTab(
    path: string,
    content: string,
    modified: boolean,
    options: { focus?: boolean } = {},
  ): OpenDoc {
    const doc: OpenDoc = { id: `doc-${++this.seq}`, path, content, modified }
    this.docs.push(doc)
    if (options.focus !== false) this.activeId = doc.id
    this.emit()
    return doc
  }

  private async pushRecent(path: string): Promise<void> {
    if (!path) return
    try {
      const host = getHost()
      const config = await host.app.getConfig()
      const recentDocuments = [path, ...config.recentDocuments.filter((item) => item !== path)].slice(0, 10)
      host.app.setConfig({ ...config, recentDocuments })
      // Mirror into the caller's copy (the shell keeps the same config object in
      // memory and rewrites it on session saves — without this the fresh list
      // would be clobbered by a stale boot-time copy).
      this.recentsListener?.(recentDocuments)
    } catch (error) {
      console.error('[markup] pushRecent failed', error)
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

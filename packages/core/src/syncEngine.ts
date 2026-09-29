import type { ViewAdapter, ViewKind } from './adapters/types'

export class SyncEngine {
  private adapters = new Map<ViewKind, ViewAdapter>()
  private current: ViewKind | null = null

  register(kind: ViewKind, adapter: ViewAdapter): void {
    this.adapters.set(kind, adapter)
  }

  getActive(): ViewAdapter | null {
    return this.current === null ? null : (this.adapters.get(this.current) ?? null)
  }

  getKind(): ViewKind | null {
    return this.current
  }

  mount(kind: ViewKind, container: HTMLElement): void {
    const next = this.adapters.get(kind)
    if (!next) throw new Error(`adapter 未注册: ${kind}`)
    const previous = this.getActive()
    if (previous && previous !== next) {
      const anchor = previous.captureAnchor()
      next.setValue(previous.getValue())
      previous.unmount()
      this.current = kind
      next.mount(container)
      next.restoreAnchor(anchor)
      next.focus()
      return
    }
    this.current = kind
    next.mount(container)
    next.focus()
  }

  getMarkdown(): string {
    return this.getActive()?.getValue() ?? ''
  }

  setMarkdown(markdown: string): void {
    this.getActive()?.setValue(markdown)
  }
}
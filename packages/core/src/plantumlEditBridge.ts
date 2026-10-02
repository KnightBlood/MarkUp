import { normalizeEmbedLang } from './embeds'
import { fenceContentInsert, findFenceAtOffset } from './fenceRange'

/**
 * A resolved ```plantuml block: the current source plus a precise write-back
 * that rewrites only the block's content (fence lines / node structure stay).
 */
export interface PlantumlTarget {
  code: string
  writeBack: (next: string) => boolean
}

export interface PlantumlAnchor {
  /** DOM element under the pointer (context menu), when any. */
  target?: Element | null
  clientX?: number
  clientY?: number
  /** Resolve from the caret/selection instead of a pointer position. */
  caret?: boolean
}

export type PlantumlResolver = (anchor: PlantumlAnchor) => PlantumlTarget | null

let resolver: PlantumlResolver | null = null

/**
 * Adapters register on mount and clear on unmount — syncEngine keeps exactly
 * one view mounted, so there is never more than one resolver at a time.
 */
export function setPlantumlResolver(next: PlantumlResolver | null): void {
  resolver = next
}

/** Ask the active adapter for a plantuml block at the anchor (never throws). */
export function resolvePlantumlTarget(anchor: PlantumlAnchor = {}): PlantumlTarget | null {
  if (!resolver) return null
  try {
    return resolver(anchor)
  } catch (error) {
    console.warn('[markup] PlantUML block resolve failed', error)
    return null
  }
}

/** True for ```plantuml / ```puml fence info strings (case-insensitive). */
export function isPlantumlFence(info: string): boolean {
  return normalizeEmbedLang(info) === 'plantuml'
}

export type PlantumlVisualEditHandler = () => void

let visualEditHandler: PlantumlVisualEditHandler | null = null

/**
 * The widget bar's 编辑 button hands off to the visual dialog: the ui side
 * wires the dialog owner (it resolves the caret's fence itself), core only
 * needs to know whether one exists.
 */
export function setPlantumlVisualEditHandler(next: PlantumlVisualEditHandler | null): void {
  visualEditHandler = next
}

/** Returns false when no dialog owner is wired (caller falls back to source). */
export function requestPlantumlVisualEdit(): boolean {
  if (!visualEditHandler) return false
  visualEditHandler()
  return true
}

/**
 * Shared markdown-fence target for the plain-text adapters: scans for the
 * fence at `offset` and hands back a write-back that splices the content span
 * through the adapter's own editor (`replace`).
 */
export function plantumlFenceTarget(
  markdown: string,
  offset: number,
  replace: (from: number, to: number, text: string) => boolean,
): PlantumlTarget | null {
  const range = findFenceAtOffset(markdown, offset, isPlantumlFence)
  if (!range) return null
  return {
    code: range.code,
    writeBack: (next) => replace(range.contentFrom, range.contentTo, fenceContentInsert(next)),
  }
}

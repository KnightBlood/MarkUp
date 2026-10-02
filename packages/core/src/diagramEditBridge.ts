export interface DiagramEditRequest {
  lang: string
  code: string
}

/** `null` = cancelled; otherwise the replacement fence content. */
export type DiagramEditDone = (newCode: string | null) => void
export type DiagramEditHandler = (request: DiagramEditRequest, done: DiagramEditDone) => void

let handler: DiagramEditHandler | null = null

export function setDiagramEditHandler(next: DiagramEditHandler | null): void {
  handler = next
}

export function requestDiagramEdit(request: DiagramEditRequest, done: DiagramEditDone): boolean {
  if (!handler) return false
  handler(request, done)
  return true
}

export interface DiagramEnlargeRequest {
  lang: string
  code: string
}

export type DiagramEnlargeHandler = (request: DiagramEnlargeRequest) => void

let enlargeHandler: DiagramEnlargeHandler | null = null

export function setDiagramEnlargeHandler(next: DiagramEnlargeHandler | null): void {
  enlargeHandler = next
}

/** Returns false when no enlarge viewer is wired (caller falls back to source). */
export function requestDiagramEnlarge(request: DiagramEnlargeRequest): boolean {
  if (!enlargeHandler) return false
  enlargeHandler(request)
  return true
}

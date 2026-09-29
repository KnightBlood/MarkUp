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

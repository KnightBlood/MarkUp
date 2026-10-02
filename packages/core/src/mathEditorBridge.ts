export interface MathEditRequest {
  latex: string
  display: boolean
}

export interface MathEditResult {
  latex: string
  display: boolean
}

export type MathEditDone = (result: MathEditResult | null) => void
export type MathEditHandler = (request: MathEditRequest, done: MathEditDone) => void

let handler: MathEditHandler | null = null

export function setMathEditHandler(next: MathEditHandler | null): void {
  handler = next
}

export function requestMathEdit(request: MathEditRequest, done: MathEditDone): boolean {
  if (!handler) return false
  handler(request, done)
  return true
}

export interface MathEnlargeRequest {
  latex: string
  display: boolean
}

export type MathEnlargeHandler = (request: MathEnlargeRequest) => void

let enlargeHandler: MathEnlargeHandler | null = null

export function setMathEnlargeHandler(next: MathEnlargeHandler | null): void {
  enlargeHandler = next
}

/** Returns false when no enlarge viewer is wired (caller falls back to source). */
export function requestMathEnlarge(request: MathEnlargeRequest): boolean {
  if (!enlargeHandler) return false
  enlargeHandler(request)
  return true
}

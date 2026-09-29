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

/**
 * View zoom — 视图 ▸ 实际大小 / 放大 / 缩小, and Ctrl/⌘ + 滚轮.
 *
 * Steps through a fixed ladder rather than multiplying by a factor. Two
 * reasons: repeated 放大 then 缩小 lands back exactly on 100% instead of
 * drifting off it through floating-point error, and every reachable scale is a
 * round number the user can recognise in the status bar.
 */

export const ZOOM_STEPS: readonly number[] = [
  0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3,
]

export const ZOOM_MIN = ZOOM_STEPS[0]!
export const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1]!
export const ZOOM_DEFAULT = 1

/** Snap an arbitrary stored value onto the ladder (a hand-edited config may hold anything). */
export function clampZoom(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ZOOM_DEFAULT
  if (value <= ZOOM_MIN) return ZOOM_MIN
  if (value >= ZOOM_MAX) return ZOOM_MAX
  let best = ZOOM_DEFAULT
  let bestDistance = Infinity
  for (const step of ZOOM_STEPS) {
    const distance = Math.abs(step - value)
    if (distance < bestDistance) {
      bestDistance = distance
      best = step
    }
  }
  return best
}

/**
 * Next step up or down. Returns `current` unchanged at either end, so the
 * caller can detect "nothing to do" without duplicating the bounds check.
 */
export function stepZoom(current: unknown, direction: 'in' | 'out'): number {
  const from = clampZoom(current)
  const index = ZOOM_STEPS.indexOf(from)
  const next = index + (direction === 'in' ? 1 : -1)
  return ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, next))] ?? from
}

/** A wheel delta to a zoom step: wheel-up (`deltaY < 0`) zooms in. */
export function zoomFromWheelDelta(current: unknown, deltaY: number): number {
  if (!deltaY) return clampZoom(current)
  return stepZoom(current, deltaY < 0 ? 'in' : 'out')
}

/** The value for the `--view-zoom` CSS variable. */
export function zoomCss(value: unknown): string {
  return String(clampZoom(value))
}

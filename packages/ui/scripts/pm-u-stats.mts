/**
 * Smoke: 字数统计浮窗.
 *
 * Two things worth pinning: the reading-time rounding (an empty document must
 * not claim "约 1 分钟"), and the fact that a missing selection renders as `—`
 * rather than as zeros — "所选内容 0" reads as a bug when nothing is selected.
 */

import { JSDOM } from 'jsdom'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>')
const g = globalThis as typeof globalThis & Record<string, unknown>
g.window = dom.window
g.document = dom.window.document
g.Element = dom.window.Element
g.HTMLElement = dom.window.HTMLElement
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })

const { createStatsPanel, readingMinutes, formatReadingTime, WORDS_PER_MINUTE } = await import(
  '../src/ui/statsPanel'
)

// ---- 阅读时长 --------------------------------------------------------------
assert(readingMinutes(0) === 0, 'an empty document is zero minutes')
assert(formatReadingTime(0) === '—', 'and renders as a dash, not "约 1 分钟"')
assert(readingMinutes(1) === 1, 'a single word still rounds up to a minute')
assert(readingMinutes(WORDS_PER_MINUTE) === 1, `exactly one minute at ${WORDS_PER_MINUTE} 字`)
assert(readingMinutes(WORDS_PER_MINUTE * 3) === 3, 'three minutes')
// Rounds to nearest, not floor: 1.6 minutes is "约 2 分钟".
assert(readingMinutes(WORDS_PER_MINUTE * 1.6) === 2, 'rounds to nearest')
assert(readingMinutes(-5) === 0, 'a negative count is zero, not a negative duration')
assert(formatReadingTime(WORDS_PER_MINUTE * 2) === '约 2 分钟', 'formatted')

// ---- the panel -------------------------------------------------------------
{
  const panel = createStatsPanel()
  document.getElementById('app')?.appendChild(panel.el)
  assert(!panel.visible, 'starts hidden')

  panel.open()
  assert(panel.visible, 'open() shows it')
  panel.close()
  assert(!panel.visible, 'close() hides it')
  panel.toggle()
  assert(panel.visible, 'toggle() shows it')

  const values = (): string[] =>
    [...panel.el.querySelectorAll('.stats-panel__value')].map((node) => node.textContent ?? '')

  // Nothing yet: both sections are dashes, not zeros.
  assert(values().every((text) => text === '—'), `starts blank: ${values().join(',')}`)

  panel.update({ words: 600, chars: 700, lines: 12 }, null)
  const shown = values()
  assert(shown[0] === '600', `document words: ${shown[0]}`)
  assert(shown[1] === '700', `document chars: ${shown[1]}`)
  assert(shown[2] === '12', `document lines: ${shown[2]}`)
  assert(shown[3] === '约 2 分钟', `document reading time: ${shown[3]}`)
  // No selection → the second section stays blank rather than claiming zeros.
  assert(
    shown.slice(4).every((text) => text === '—'),
    `selection section stays blank: ${shown.slice(4).join(',')}`,
  )

  panel.update({ words: 600, chars: 700, lines: 12 }, { words: 3, chars: 3, lines: 1 })
  const withSel = values()
  assert(withSel[4] === '3' && withSel[5] === '3' && withSel[6] === '1', 'selection counts')
  assert(withSel[7] === '约 1 分钟', `selection reading time: ${withSel[7]}`)

  // Back to no selection: the section clears again.
  panel.update({ words: 1, chars: 1, lines: 1 }, null)
  assert(values().slice(4).every((text) => text === '—'), 'clearing the selection clears the rows')
}

console.log('SMOKE UI STATS OK: reading-time rounding + document/selection sections + toggle')

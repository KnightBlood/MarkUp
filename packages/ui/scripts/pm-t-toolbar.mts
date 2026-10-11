/**
 * Smoke: 工具栏 (the floating format bar over a selection).
 *
 * The two things worth pinning are both invisible until they break: pressing a
 * button must not let the editor collapse the selection first, and the bar must
 * refuse to show when there is no usable rect (no selection, a collapsed
 * selection, or a selection outside the editor).
 */

import { JSDOM } from 'jsdom'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
  pretendToBeVisual: true,
})
const g = globalThis as typeof globalThis & Record<string, unknown>
g.window = dom.window
g.document = dom.window.document
g.Element = dom.window.Element
g.HTMLElement = dom.window.HTMLElement
g.Event = dom.window.Event
g.MouseEvent = dom.window.MouseEvent
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })

const { createSelectionToolbar, SELECTION_TOOLBAR_ITEMS } = await import('../src/ui/selectionToolbar')

const run: string[] = []
const toolbar = createSelectionToolbar((command) => run.push(command))
document.getElementById('app')?.appendChild(toolbar.el)

// ---- shape -----------------------------------------------------------------
{
  const buttons = toolbar.el.querySelectorAll('button')
  const expected = SELECTION_TOOLBAR_ITEMS.filter((item) => item !== 'separator').length
  assert(buttons.length === expected, `one button per item: ${buttons.length} vs ${expected}`)
  assert(toolbar.el.getAttribute('role') === 'toolbar', 'exposed as a toolbar')
  assert(toolbar.visible === false, 'starts hidden')
  // Every button needs a name; a bare glyph is not one.
  for (const button of buttons) {
    assert(button.getAttribute('aria-label'), `button "${button.textContent}" has a label`)
  }
}

// ---- placement -------------------------------------------------------------
{
  toolbar.update({ top: 100, bottom: 120, left: 300, width: 80 })
  assert(toolbar.visible, 'a real rect shows the bar')
  // Centred over the selection: 300 + 40 - width/2.
  const left = Number.parseFloat(toolbar.el.style.left)
  assert(Number.isFinite(left) && left >= 8, `left is a sane number: ${toolbar.el.style.left}`)
  const top = Number.parseFloat(toolbar.el.style.top)
  // jsdom reports offsetHeight/offsetWidth as 0, so "above" always fits here.
  assert(top === 100 - 0 - 8, `placed above by the gap: ${toolbar.el.style.top}`)
}
{
  // Near the right edge the bar must pull back inside the viewport.
  toolbar.update({ top: 100, bottom: 120, left: dom.window.innerWidth - 4, width: 8 })
  const left = Number.parseFloat(toolbar.el.style.left)
  assert(left >= 8 && left <= dom.window.innerWidth, `clamped to the viewport: ${left}`)
}
{
  toolbar.update(null)
  assert(!toolbar.visible, 'no rect hides the bar')
}
{
  // A selection on the first line has no room above, so the bar goes below.
  toolbar.update({ top: 0, bottom: 18, left: 40, width: 60 })
  assert(Number.parseFloat(toolbar.el.style.top) >= 0, 'never placed off the top')
}

// ---- dispatch --------------------------------------------------------------
{
  toolbar.update({ top: 100, bottom: 120, left: 300, width: 80 })
  const first = toolbar.el.querySelector('button')
  assert(first, 'first button')
  const expectedCommand = SELECTION_TOOLBAR_ITEMS[0]
  assert(typeof expectedCommand === 'object', 'first entry is an item')
  first.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  assert(run.length === 1, 'the click dispatched exactly one command')
  assert(
    run[0] === expectedCommand.command,
    `dispatched ${run[0]}, expected ${expectedCommand.command}`,
  )
  assert(!toolbar.visible, 'the bar hides after a command (its rect is stale)')
}
{
  // Pressing a button must not let the editor collapse the selection first.
  const button = toolbar.el.querySelector('button')
  assert(button, 'button')
  const event = new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true })
  button.dispatchEvent(event)
  assert(event.defaultPrevented, 'mousedown is cancelled so the selection survives')
}

// ---- hide ------------------------------------------------------------------
{
  toolbar.update({ top: 100, bottom: 120, left: 300, width: 80 })
  assert(toolbar.visible, 'shown again')
  toolbar.hide()
  assert(!toolbar.visible, 'hide() hides')
}

console.log(
  `SMOKE UI TOOLBAR OK: ${toolbar.el.querySelectorAll('button').length} commands + selection-safe mousedown + viewport clamping`,
)

/**
 * Smoke: 大纲浮窗.
 *
 * The only part with real logic is which heading the caret is "in": the panel
 * highlights it, so an off-by-one there points the reader at the wrong section.
 * Offsets come from the same `extractOutline` the sidebar uses, so the test
 * feeds it real markdown rather than hand-built items.
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

const { createOutlinePanel, activeOutlineIndex } = await import('../src/ui/outlinePanel')
const { extractOutline } = await import('../src/outline')

const md = ['# 一', '', '正文', '', '## 二', '', '正文', '', '## 三', '', '正文'].join('\n')
const items = extractOutline(md)
assert(items.length === 3, `three headings: ${items.length}`)

// ---- which heading the caret is under --------------------------------------
{
  // Before the first heading: nothing is active.
  assert(activeOutlineIndex(items, 0) === 0, 'offset 0 is inside the first heading')
  assert(activeOutlineIndex(items, items[0]!.offset - 1) === -1, 'before it, nothing is active')
  assert(activeOutlineIndex(items, null) === -1, 'no caret means nothing is active')
  assert(activeOutlineIndex([], 100) === -1, 'an empty outline has nothing to highlight')
  // Exactly on a heading switches to it — `<=`, so the heading itself counts.
  assert(activeOutlineIndex(items, items[1]!.offset) === 1, 'on the second heading')
  assert(activeOutlineIndex(items, items[1]!.offset - 1) === 0, 'just before it, still the first')
  assert(activeOutlineIndex(items, 10_000) === items.length - 1, 'past the end, the last one')
}

// ---- the panel -------------------------------------------------------------
{
  const selected: string[] = []
  const panel = createOutlinePanel((item) => selected.push(item.text))
  document.getElementById('app')?.appendChild(panel.el)
  assert(!panel.visible, 'starts hidden')
  panel.open()
  assert(panel.visible, 'open() shows it')
  panel.toggle()
  assert(!panel.visible, 'toggle() hides it')
  panel.toggle()

  const empty = panel.el.querySelector('.outline-panel__empty')
  assert(empty, 'has an empty state')
  // Before any update there is nothing rendered, so the empty state shows.
  assert(empty.hidden === false, 'starts showing the empty state')

  panel.update(items)
  assert(empty.hidden === true, 'a non-empty outline hides the empty state')
  const buttons = [...panel.el.querySelectorAll<HTMLButtonElement>('.outline-panel__item')]
  assert(buttons.length === 3, `one button per heading: ${buttons.length}`)
  assert(buttons.map((b) => b.textContent).join(',') === '一,二,三', 'in document order')

  // Level → indent, so the hierarchy is visible.
  const indent = (index: number): number => Number.parseFloat(buttons[index]!.style.paddingLeft)
  assert(indent(0) < indent(1), `an h2 is indented past an h1: ${indent(0)} vs ${indent(1)}`)
  assert(indent(1) === indent(2), 'same level, same indent')

  // Clicking is how the panel navigates.
  buttons[1]!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  assert(selected.join(',') === '二', `click selects: ${selected.join(',')}`)

  // Active tracking.
  panel.setActive(items[2]!.offset)
  assert(buttons[2]!.classList.contains('is-active'), 'the third is marked active')
  assert(!buttons[0]!.classList.contains('is-active'), 'and the first is not')
  panel.setActive(null)
  assert(
    buttons.every((b) => !b.classList.contains('is-active')),
    'a null offset clears the highlight',
  )

  // Re-rendering drops stale active state with the old buttons.
  panel.update(items.slice(0, 2))
  const after = [...panel.el.querySelectorAll('.outline-panel__item')]
  assert(after.length === 2, 're-render replaces the list')
  assert(after.every((b) => !b.classList.contains('is-active')), 'and no stale highlight survives')

  // An outline with nothing in it shows the empty state instead of a blank box.
  panel.update([])
  assert(empty.hidden === false, 'an empty outline shows the empty state')
}

console.log('SMOKE UI OUTLINE OK: caret→heading + indent by level + click-to-jump + active tracking')

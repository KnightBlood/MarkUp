import { JSDOM } from 'jsdom'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const dom = new JSDOM('<!doctype html><html><body></body></html>')
const g = globalThis as typeof globalThis & {
  window: Window & typeof globalThis
  document: Document
  HTMLElement: typeof HTMLElement
  HTMLInputElement: typeof HTMLInputElement
  Event: typeof Event
  KeyboardEvent: typeof KeyboardEvent
}
g.window = dom.window as unknown as Window & typeof globalThis
g.document = dom.window.document
g.HTMLElement = dom.window.HTMLElement as typeof g.HTMLElement
g.HTMLInputElement = dom.window.HTMLInputElement as typeof g.HTMLInputElement
g.Event = dom.window.Event as typeof g.Event
g.KeyboardEvent = dom.window.KeyboardEvent as typeof g.KeyboardEvent

const { createFindPanel } = await import('../src/ui/findPanel')

const markdown = ['alpha beta gamma', 'the quick brown fox', 'the lazy dog'].join('\n')

// Both real focus thieves, reproduced on purpose. `editorPane.gotoAnchor()`
// calls active.focus() unconditionally, and the source adapter calls
// textarea.focus() inside restoreAnchor() — so every keystroke used to land
// focus on the adapter instead of the find box.
const adapter = dom.window.document.createElement('textarea')
dom.window.document.body.appendChild(adapter)

const panel = createFindPanel({
  getMarkdown: () => markdown,
  gotoAnchor: () => adapter.focus(),
  replaceInDocument: () => {},
})
dom.window.document.body.appendChild(panel.el)

const input = panel.el.querySelector('input')
assert(input, 'find input should exist')

panel.open(false)
assert(!panel.el.hidden, 'panel should be visible after open()')

input.focus()
assert(
  dom.window.document.activeElement === input,
  'sanity: jsdom must support focus on the find input, or this test proves nothing',
)

// Typing a query auto-locates the first match — the step that lost focus.
input.value = 'the'
input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
assert(
  dom.window.document.activeElement === input,
  'find input lost focus after auto-locate (gotoAnchor stole it)',
)
const count = panel.el.querySelector('.find-panel__count')
assert(count, 'count label should exist')
assert(
  count.textContent !== '0/0',
  `expected real matches to exercise goTo(), got ${String(count?.textContent)}`,
)
assert(
  dom.window.document.activeElement === input,
  'find input lost focus before the match count could be read',
)

// Enter = find next; Shift+Enter = find previous. Both re-locate.
input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
assert(
  dom.window.document.activeElement === input,
  'find input lost focus after Enter (find next)',
)
assert(
  count.textContent === '2/2',
  `Enter should advance to the next match, got ${String(count?.textContent)}`,
)

input.dispatchEvent(
  new dom.window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }),
)
assert(
  dom.window.document.activeElement === input,
  'find input lost focus after Shift+Enter (find previous)',
)

// The replace field has its own path (Enter → replace) and its own focus.
const replace = panel.el.querySelectorAll('input')[1]
assert(replace, 'replace input should exist')
replace.focus()
assert(
  dom.window.document.activeElement === replace,
  'sanity: jsdom must support focus on the replace input',
)
replace.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
assert(
  dom.window.document.activeElement === replace,
  'replace input lost focus after Enter (replace one)',
)

console.log('SMOKE UI FIND OK: auto-locate keeps focus on find + replace, Enter/Shift+Enter advance')

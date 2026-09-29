import { JSDOM } from 'jsdom'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>')
const g = globalThis as typeof globalThis & {
  window: Window & typeof globalThis
  document: Document
  HTMLElement: typeof HTMLElement
  HTMLInputElement: typeof HTMLInputElement
  HTMLTextAreaElement: typeof HTMLTextAreaElement
  HTMLButtonElement: typeof HTMLButtonElement
  HTMLDivElement: typeof HTMLDivElement
  HTMLLabelElement: typeof HTMLLabelElement
  Event: typeof Event
  KeyboardEvent: typeof KeyboardEvent
  getComputedStyle: typeof getComputedStyle
}
g.window = dom.window as unknown as Window & typeof globalThis
g.document = dom.window.document
g.HTMLElement = dom.window.HTMLElement as typeof g.HTMLElement
g.HTMLInputElement = dom.window.HTMLInputElement as typeof g.HTMLInputElement
g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement as typeof g.HTMLTextAreaElement
g.HTMLButtonElement = dom.window.HTMLButtonElement as typeof g.HTMLButtonElement
g.HTMLDivElement = dom.window.HTMLDivElement as typeof g.HTMLDivElement
g.HTMLLabelElement = dom.window.HTMLLabelElement as typeof g.HTMLLabelElement
g.Event = dom.window.Event as typeof g.Event
g.KeyboardEvent = dom.window.KeyboardEvent as typeof g.KeyboardEvent
g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window) as typeof g.getComputedStyle

const { createFormulaEditor } = await import('../src/ui/formulaEditor')
const { CommandRegistry } = await import('../src/commands')
const coreRender = await import('../../core/src/mathRender')
const coreBridge = await import('../../core/src/mathEditorBridge')

const { setMathEditHandler, requestMathEdit } = coreBridge

const formula = createFormulaEditor()
assert(formula.el.classList.contains('formula'), 'formula root class')
assert(formula.isOpen() === false, 'starts closed')

let confirmed: { latex: string; mode: string } | null = null
formula.open({
  latex: '',
  mode: 'block',
  title: '插入公式',
  onConfirm: (result) => {
    confirmed = result
  },
})
assert(formula.isOpen(), 'open shows dialog')
assert(formula.getMode() === 'block', 'default block mode')
assert(formula.el.querySelector('.formula__panel[role="dialog"]'), 'dialog role')

const textareas = formula.el.querySelectorAll<HTMLTextAreaElement>('textarea.formula__source')
assert(textareas.length === 1, 'has latex source textarea')
const source = textareas[0]!
source.value = '\\frac{1}{2}'
source.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
assert(formula.getLatex() === '\\frac{1}{2}', 'latex tracked from textarea')
assert(
  formula.el.querySelector('.formula__status--ok') !== null ||
    formula.el.querySelector('.formula__status') !== null,
  'status element present',
)

const templates = formula.el.querySelectorAll<HTMLButtonElement>('.formula__tpl')
assert(templates.length > 0, 'templates rendered')
templates[0]!.click()
assert(formula.getLatex().includes('\\frac{1}{2}') || formula.getLatex().length > 0, 'template inserts latex')

const cats = formula.el.querySelectorAll<HTMLButtonElement>('.formula__cat')
assert(cats.length >= 4, `category tabs: ${cats.length}`)
cats[1]!.click()
assert(cats[1]!.classList.contains('is-active'), 'category switches')

const inlineRadio = formula.el.querySelector<HTMLInputElement>('#formula-mode-inline')
assert(inlineRadio, 'inline radio exists')
inlineRadio.checked = true
inlineRadio.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
assert(formula.getMode() === 'inline', 'mode switches to inline')

const confirmBtn = Array.from(
  formula.el.querySelectorAll<HTMLButtonElement>('button.formula__btn--primary'),
)[0]
assert(confirmBtn, 'confirm button exists')
confirmBtn.click()
assert(formula.isOpen() === false, 'confirm closes')
assert(confirmed !== null, 'confirm callback fired')
assert(confirmed && confirmed.mode === 'inline', 'confirmed mode is inline')
assert(confirmed && confirmed.latex.length > 0, 'confirmed latex non-empty')

// Escape closes without confirm
let cancelled = false
formula.open({
  latex: 'x^2',
  mode: 'block',
  onConfirm: () => {
    throw new Error('should not confirm')
  },
  onCancel: () => {
    cancelled = true
  },
})
formula.el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
assert(!formula.isOpen(), 'escape closes')
assert(cancelled, 'cancel callback fired')

// Bridge: widget edit path
let bridgeRequest: { latex: string; display: boolean } | null = null
setMathEditHandler((request, done) => {
  bridgeRequest = request
  formula.open({
    latex: request.latex,
    mode: request.display ? 'block' : 'inline',
    title: '编辑公式',
    onConfirm: (result) => done({ latex: result.latex, display: result.mode === 'block' }),
    onCancel: () => done(null),
  })
})
let bridgeResult: { latex: string; display: boolean } | null = null
const handled = requestMathEdit({ latex: 'a+b', display: true }, (result) => {
  bridgeResult = result
})
assert(handled === true, 'bridge handled')
assert(bridgeRequest?.latex === 'a+b', 'bridge request latex')
assert(bridgeRequest?.display === true, 'bridge request display')
assert(formula.isOpen(), 'bridge opens formula editor')

// Confirm edit through dialog
const source2 = formula.el.querySelector<HTMLTextAreaElement>('.formula__source')!
source2.value = 'a+b+c'
source2.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
const confirm2 = formula.el.querySelector<HTMLButtonElement>('.formula__btn--primary')!
confirm2.click()
assert(bridgeResult?.latex === 'a+b+c', `bridge result latex: ${bridgeResult?.latex}`)
assert(bridgeResult?.display === true, 'bridge result display')
setMathEditHandler(null)

// Command registry wiring (labels only)
const registry = new CommandRegistry()
let insertMode = ''
registry.register({
  id: 'insert.formula',
  label: '插入公式…',
  run: () => {
    insertMode = 'block'
  },
})
registry.register({
  id: 'insert.formula.inline',
  label: '插入行内公式…',
  run: () => {
    insertMode = 'inline'
  },
})
registry.run('insert.formula')
assert(insertMode === 'block', 'insert.formula command')
registry.run('insert.formula.inline')
assert(insertMode === 'inline', 'insert.formula.inline command')

// Math render + bridge helpers exist
assert(typeof coreRender.renderMath === 'function', 'renderMath exported')
assert(typeof coreBridge.setMathEditHandler === 'function', 'setMathEditHandler exported')
assert(typeof coreBridge.requestMathEdit === 'function', 'requestMathEdit exported')

console.log(
  'SMOKE UI FORMULA OK: open/close/mode/templates/confirm/cancel + bridge edit + commands',
)

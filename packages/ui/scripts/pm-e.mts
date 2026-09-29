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
g.HTMLInputElement = dom.window.HTMLInputElement
g.HTMLSelectElement = dom.window.HTMLSelectElement
g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement
g.Event = dom.window.Event
g.MouseEvent = dom.window.MouseEvent
g.KeyboardEvent = dom.window.KeyboardEvent
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
})
g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
g.requestAnimationFrame = (cb: FrameRequestCallback) =>
  dom.window.setTimeout(() => cb(0), 16)
g.cancelAnimationFrame = (id: number) => dom.window.clearTimeout(id)

const { createContextMenu } = await import('../src/ui/contextMenu')
const { formatShortcut } = await import('../src/commands')

const host = document.getElementById('app')
assert(host, 'has #app')
const menu = createContextMenu(host)
assert(menu.el.classList.contains('context-menu'), 'root class')
assert(menu.isOpen() === false, 'starts closed')

menu.show(10, 20, [
  { label: '复制', shortcut: formatShortcut('Mod+C'), run: () => undefined },
  { separator: true },
  { label: '禁用项', disabled: true },
])
assert(menu.isOpen(), 'show opens')
assert(menu.el.querySelectorAll('.context-menu__item').length === 2, 'two items')
assert(menu.el.querySelectorAll('.context-menu__sep').length === 1, 'one separator')
const disabled = menu.el.querySelector<HTMLButtonElement>('.context-menu__item:disabled')
assert(disabled, 'disabled item is disabled button')

const first = menu.el.querySelector<HTMLButtonElement>('.context-menu__item')
first?.click()
assert(menu.isOpen() === false, 'click hides')

menu.show(5, 5, [{ label: 'x', run: () => undefined }])
const escape = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
dom.window.dispatchEvent(escape)
assert(menu.isOpen() === false, 'escape hides')

// ---- submenus + checkbox rows ------------------------------------------
let ran = ''
menu.show(10, 20, [
  { label: '插入', submenu: [{ label: '表格', run: () => (ran = 'table') }] },
  { label: '自动保存', checked: true, run: () => (ran = 'auto') },
  { label: '行号', checked: false, run: () => (ran = 'lines') },
])
const rootItems = menu.el.querySelectorAll('.context-menu__item')
assert(rootItems.length === 3, `root rows: ${rootItems.length}`)
assert(!menu.el.querySelector('.context-menu--sub'), 'no flyout until opened')

const subOwner = rootItems[0] as HTMLButtonElement
subOwner.click()
const flyout = host.querySelector<HTMLElement>('.context-menu--sub')
assert(flyout, 'flyout layer opens')
assert(flyout.querySelectorAll('.context-menu__item').length === 1, 'flyout rows')
assert(subOwner.getAttribute('aria-expanded') === 'true', 'owner marked expanded')
assert(menu.isOpen(), 'root still open while flyout shows')

const leaf = flyout.querySelector<HTMLButtonElement>('.context-menu__item')
leaf?.click()
assert(ran === 'table', `leaf ran (${ran})`)
assert(menu.isOpen() === false, 'running a leaf closes everything')
assert(!host.querySelector('.context-menu--sub'), 'flyout layer removed')

// Checkbox rows: marker only where `checked` is defined, aria-checked set.
menu.show(10, 20, [
  { label: '自动保存', checked: true, run: () => undefined },
  { label: '行号', checked: false, run: () => undefined },
  { label: '普通项', run: () => undefined },
])
const rows = menu.el.querySelectorAll<HTMLElement>('.context-menu__item')
assert(rows[0]?.getAttribute('role') === 'menuitemcheckbox', 'checked row role')
assert(rows[1]?.querySelector('.context-menu__check')?.textContent === '', 'unchecked marker empty')
assert(rows[0]?.querySelector('.context-menu__check')?.textContent === '✓', 'checked marker tick')
assert(rows[2]?.getAttribute('role') === 'menuitem', 'plain row role')
assert(!rows[2]?.querySelector('.context-menu__check'), 'no marker on plain row')

// Escape closes the root plus any open flyout.
menu.show(10, 20, [{ label: '插入', submenu: [{ label: '深层', submenu: [{ label: '叶子' }] }] }])
;(menu.el.querySelector('.context-menu__item') as HTMLButtonElement).click()
assert(host.querySelector('.context-menu--sub'), 'level 1 open')
const level1 = host.querySelector<HTMLElement>('.context-menu--sub')
;((level1?.querySelector('.context-menu__item') ?? null) as HTMLButtonElement | null)?.click()
assert(
  host.querySelectorAll('.context-menu--sub').length === 2,
  'nested level 2 open',
)
dom.window.dispatchEvent(escape)
assert(menu.isOpen() === false, 'escape closes root')
assert(!host.querySelector('.context-menu--sub'), 'escape closes every flyout')

// ---- glyph toolbar rows (Typora-style) ----------------------------------
let glyph = ''
menu.show(10, 20, [
  {
    row: [
      { icon: '✂', label: '剪切', shortcut: formatShortcut('Mod+X'), run: () => (glyph = 'cut') },
      { icon: '⧉', label: '复制', run: () => (glyph = 'copy') },
      { icon: '🗑', label: '删除', disabled: true, run: () => (glyph = 'delete') },
    ],
  },
  { separator: true },
  { icon: 'B', label: '粗体', run: () => (glyph = 'bold') },
])
const toolbar = menu.el.querySelectorAll('.context-menu__row')
assert(toolbar.length === 1, `one glyph row: ${toolbar.length}`)
assert(menu.el.querySelectorAll('.context-menu__sep').length === 1, 'row keeps separators')
const cells = toolbar[0]?.querySelectorAll<HTMLButtonElement>('.context-menu__iconbtn') ?? []
assert(cells.length === 3, `three glyph buttons: ${cells.length}`)
assert(cells[0]?.textContent === '✂', `glyph text: ${cells[0]?.textContent}`)
assert(
  cells[0]?.getAttribute('title') === `剪切 ${formatShortcut('Mod+X')}`,
  `glyph tooltip carries the shortcut: ${cells[0]?.getAttribute('title')}`,
)
assert(cells[0]?.getAttribute('aria-label') === '剪切', 'glyph aria-label')
assert(cells[2]?.disabled === true, 'glyph button can be disabled')
assert(
  menu.el.querySelector('.context-menu__icon')?.textContent === 'B',
  'plain row keeps its leading glyph',
)

cells[0]?.click()
assert(glyph === 'cut', `glyph ran (${glyph})`)
assert(menu.isOpen() === false, 'running a glyph closes the menu')
assert(menu.el.querySelector('.context-menu__row') === null, 'rows cleared with the menu')

console.log(
  'SMOKE UI CONTEXT MENU OK: show/hide/items/disabled/escape/submenu/checked/glyph rows',
)

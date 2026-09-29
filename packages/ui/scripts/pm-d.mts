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
  HTMLSelectElement: typeof HTMLSelectElement
  HTMLButtonElement: typeof HTMLButtonElement
  HTMLDivElement: typeof HTMLDivElement
  Event: typeof Event
  KeyboardEvent: typeof KeyboardEvent
  requestAnimationFrame: typeof requestAnimationFrame
  cancelAnimationFrame: typeof cancelAnimationFrame
  getComputedStyle: typeof getComputedStyle
}
g.window = dom.window as unknown as Window & typeof globalThis
g.document = dom.window.document
g.HTMLElement = dom.window.HTMLElement as typeof g.HTMLElement
g.HTMLInputElement = dom.window.HTMLInputElement as typeof g.HTMLInputElement
g.HTMLSelectElement = dom.window.HTMLSelectElement as typeof g.HTMLSelectElement
g.HTMLButtonElement = dom.window.HTMLButtonElement as typeof g.HTMLButtonElement
g.HTMLDivElement = dom.window.HTMLDivElement as typeof g.HTMLDivElement
g.Event = dom.window.Event as typeof g.Event
g.KeyboardEvent = dom.window.KeyboardEvent as typeof g.KeyboardEvent
g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window) as typeof g.getComputedStyle

const { createSettings } = await import('../src/ui/settings')
const { CommandRegistry } = await import('../src/commands')

let theme = 'system'
let fontSize = 16
let typewriter = false
let lineNumbers = false
let showStats = true
let focusMode = false
let imagePaste = true
let spellcheck = false
let restoreSession = true

const settings = createSettings({
  getAppearance: () => ({
    theme: theme as 'system',
    fontSize,
    lineWidth: 780,
    recentDocuments: [],
    typewriter,
    autoSave: false,
    lineNumbers,
    showStats,
    focusMode,
    imagePaste,
    spellcheck,
    restoreSession,
    customTheme: { bg: '#101010', accent: '#ff0000' },
  }),
  onAppearanceChange: (next) => {
    theme = next.theme
    fontSize = next.fontSize
    typewriter = next.typewriter === true
    lineNumbers = next.lineNumbers === true
    showStats = next.showStats !== false
    focusMode = next.focusMode === true
    imagePaste = next.imagePaste !== false
    spellcheck = next.spellcheck === true
    restoreSession = next.restoreSession !== false
  },
})

assert(settings.el.classList.contains('settings'), 'settings root class')
assert(settings.isOpen() === false, 'starts closed')
settings.open()
assert(settings.isOpen() === true, 'open sets visible')
settings.close()
assert(settings.isOpen() === false, 'close hides')

const registry = new CommandRegistry()
registry.register({ id: 'settings.open', label: '设置', run: () => settings.open() })
registry.register({ id: 'settings.view', label: '设置：视图', run: () => settings.open('view') })
registry.register({
  id: 'view.typewriter',
  label: '打字机',
  run: () => {
    typewriter = !typewriter
  },
})
registry.run('settings.open')
assert(settings.isOpen(), 'command opens settings')
settings.close()
registry.run('view.typewriter')
assert(typewriter === true, 'typewriter toggles via registry')

const tabButtons = settings.el.querySelectorAll<HTMLButtonElement>('.settings__tab')
assert(tabButtons.length === 3, `three tabs: ${tabButtons.length}`)
assert(
  tabButtons[0]?.textContent === '外观' &&
    tabButtons[1]?.textContent === '编辑' &&
    tabButtons[2]?.textContent === '视图',
  'tab labels appearance/editor/view',
)
assert(settings.getTab() === 'appearance', 'default tab is appearance')

settings.setTab('view')
assert(settings.getTab() === 'view', 'setTab switches')
assert(settings.el.querySelector('[data-tab-panel="view"]')?.hidden === false, 'view panel visible')
assert(settings.el.querySelector('[data-tab-panel="appearance"]')?.hidden === true, 'appearance hidden')

const lineNumbersCheck = settings.el.querySelector<HTMLInputElement>(
  '[data-tab-panel="view"] input[type="checkbox"]',
)
assert(lineNumbersCheck, 'line numbers checkbox exists')
lineNumbersCheck.checked = true
lineNumbersCheck.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
assert(lineNumbers === true, 'lineNumbers emitted')

const showStatsCheck = settings.el.querySelectorAll<HTMLInputElement>(
  '[data-tab-panel="view"] input[type="checkbox"]',
)[1]
assert(showStatsCheck, 'showStats checkbox exists')
showStatsCheck.checked = false
showStatsCheck.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
assert(showStats === false, 'showStats emitted')

settings.setTab('editor')
const editorChecks = settings.el.querySelectorAll<HTMLInputElement>(
  '[data-tab-panel="editor"] input[type="checkbox"]',
)
assert(editorChecks.length === 5, `editor checkboxes: ${editorChecks.length}`)
const imagePasteCheck = editorChecks[2]
const spellcheckCheck = editorChecks[3]
const restoreSessionCheck = editorChecks[4]
assert(imagePasteCheck && spellcheckCheck && restoreSessionCheck, 'imagePaste + spellcheck + session checkboxes')
imagePasteCheck.checked = false
imagePasteCheck.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
assert(imagePaste === false, 'imagePaste emitted')
spellcheckCheck.checked = true
spellcheckCheck.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
assert(spellcheck === true, 'spellcheck emitted')
assert(restoreSession === true, 'restoreSession defaults on')
restoreSessionCheck.checked = false
restoreSessionCheck.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
assert(restoreSession === false, 'restoreSession emitted')

registry.run('settings.view')
assert(settings.getTab() === 'view', 'settings.view opens view tab')

const themeSelect = settings.el.querySelector<HTMLSelectElement>('select')
assert(themeSelect, 'theme select exists')
assert(themeSelect.options.length === 4, 'theme options: system/light/dark/custom')
const colorSection = settings.el.querySelector<HTMLElement>('[data-section="custom-theme"]')
assert(colorSection, 'custom theme section exists')

const colorInputs = settings.el.querySelectorAll<HTMLInputElement>('input[type="color"]')
assert(colorInputs.length === 10, `color fields: ${colorInputs.length}`)

// registration surface: registerTab appends button + panel, unsubscribe restores previous tab
const pluginTab = settings.registerTab({
  id: 'plugin',
  label: '插件',
  render: () => {
    const div = document.createElement('div')
    div.className = 'settings__plugin-panel'
    div.textContent = 'plugin settings'
    return div
  },
})
const pluginBtn = settings.el.querySelector<HTMLButtonElement>('[data-tab="plugin"]')
assert(pluginBtn, 'plugin tab button appended')
assert(settings.el.querySelector('.settings__plugin-panel'), 'plugin panel appended')
pluginBtn?.click()
assert(settings.getTab() === 'plugin', 'plugin tab activates')
const pluginPanel = settings.el.querySelector<HTMLElement>('.settings__plugin-panel')
assert(pluginPanel && pluginPanel.hidden === false, 'plugin panel visible')
let dupThrew = false
try {
  settings.registerTab({ id: 'plugin', label: 'x', render: () => document.createElement('div') })
} catch {
  dupThrew = true
}
assert(dupThrew, 'duplicate tab id throws while registered')
pluginTab()
assert(!settings.el.querySelector('[data-tab="plugin"]'), 'unsubscribe removes button')
assert(!settings.el.querySelector('.settings__plugin-panel'), 'unsubscribe removes panel')
assert(settings.getTab() === 'appearance', 'unsubscribe falls back to appearance tab')

console.log('SMOKE UI SETTINGS OK: tabs + editor/view options + open/close + registry + registerTab')

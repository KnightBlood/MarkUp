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
let autoSave = false
let typewriter = false
let lineNumbers = false
let showStats = true
let focusMode = false
let imagePaste = true
let mdSubscript = true
let spellcheck = false
let restoreSession = true
let bodyFont: string | undefined
let codeFont: string | undefined

const settings = createSettings({
  getAppearance: () => ({
    theme: theme as 'system',
    fontSize,
    lineWidth: 780,
    recentDocuments: [],
    typewriter,
    autoSave,
    lineNumbers,
    showStats,
    focusMode,
    imagePaste,
    mdSubscript,
    spellcheck,
    restoreSession,
    bodyFont,
    codeFont,
    customTheme: { bg: '#101010', accent: '#ff0000' },
  }),
  onAppearanceChange: (next) => {
    theme = next.theme
    fontSize = next.fontSize
    typewriter = next.typewriter === true
    autoSave = next.autoSave === true
    lineNumbers = next.lineNumbers === true
    showStats = next.showStats !== false
    focusMode = next.focusMode === true
    imagePaste = next.imagePaste !== false
    mdSubscript = next.mdSubscript !== false
    spellcheck = next.spellcheck === true
    restoreSession = next.restoreSession !== false
    bodyFont = next.bodyFont
    codeFont = next.codeFont
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
registry.register({ id: 'settings.export', label: '设置：导出', run: () => settings.open('export') })
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

// 面板顺序对齐 Typora 的偏好设置：通用 → 外观 → 编辑器 → Markdown → 图像 → 导出。
const tabButtons = settings.el.querySelectorAll<HTMLButtonElement>('.settings__tab')
assert(tabButtons.length === 6, `six tabs: ${tabButtons.length}`)
assert(
  tabButtons[0]?.textContent === '通用' &&
    tabButtons[1]?.textContent === '外观' &&
    tabButtons[2]?.textContent === '编辑器' &&
    tabButtons[3]?.textContent === 'Markdown' &&
    tabButtons[4]?.textContent === '图像' &&
    tabButtons[5]?.textContent === '导出',
  'tab labels general/appearance/editor/markdown/image/export',
)
assert(settings.getTab() === 'general', 'default tab is general')

settings.setTab('editor')
assert(settings.getTab() === 'editor', 'setTab switches')
assert(settings.el.querySelector('[data-tab-panel="editor"]')?.hidden === false, 'editor panel visible')
assert(settings.el.querySelector('[data-tab-panel="general"]')?.hidden === true, 'general hidden')

// ---- 通用：启动 / 保存与恢复 / 统计与校对 ---------------------------------
settings.setTab('general')
const generalChecks = settings.el.querySelectorAll<HTMLInputElement>(
  '[data-tab-panel="general"] input[type="checkbox"]',
)
assert(generalChecks.length === 4, `general checkboxes: ${generalChecks.length}`)
const [restoreSessionCheck, autoSaveCheck, showStatsCheck, spellcheckCheck] = generalChecks
assert(
  restoreSessionCheck && autoSaveCheck && showStatsCheck && spellcheckCheck,
  'restoreSession + autoSave + showStats + spellcheck checkboxes',
)
assert(restoreSession === true, 'restoreSession defaults on')
restoreSessionCheck.checked = false
restoreSessionCheck.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
assert(restoreSession === false, 'restoreSession emitted')
autoSaveCheck.checked = true
autoSaveCheck.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
assert(autoSave === true, 'autoSave emitted')
showStatsCheck.checked = false
showStatsCheck.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
assert(showStats === false, 'showStats emitted')
spellcheckCheck.checked = true
spellcheckCheck.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
assert(spellcheck === true, 'spellcheck emitted')

// ---- 编辑器：打字机 / 专注 / 行号 -----------------------------------------
settings.setTab('editor')
const editorChecks = settings.el.querySelectorAll<HTMLInputElement>(
  '[data-tab-panel="editor"] input[type="checkbox"]',
)
assert(editorChecks.length === 3, `editor checkboxes: ${editorChecks.length}`)
const lineNumbersCheck = editorChecks[2]!
lineNumbersCheck.checked = true
lineNumbersCheck.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
assert(lineNumbers === true, 'lineNumbers emitted')

// ---- Markdown：语法支持 ---------------------------------------------------
settings.setTab('markdown')
const mdChecks = settings.el.querySelectorAll<HTMLInputElement>(
  '[data-tab-panel="markdown"] input[type="checkbox"]',
)
assert(mdChecks.length === 9, `markdown checkboxes: ${mdChecks.length}`)
// Subscript carries a cross-view consequence — it is only free because the
// pipeline opts out of single-tilde strikethrough — so assert it round-trips.
const mdSubscriptCheck = mdChecks[2]!
mdSubscriptCheck.checked = false
mdSubscriptCheck.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
assert(mdSubscript === false, 'mdSubscript emitted')

// ---- 图像：插入图片时 -----------------------------------------------------
settings.setTab('image')
const imagePasteCheck = settings.el.querySelector<HTMLInputElement>(
  '[data-tab-panel="image"] input[type="checkbox"]',
)
assert(imagePasteCheck, 'imagePaste checkbox exists')
imagePasteCheck.checked = false
imagePasteCheck.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
assert(imagePaste === false, 'imagePaste emitted')

// ---- 导出：转换器路径 -----------------------------------------------------
registry.run('settings.export')
assert(settings.getTab() === 'export', 'settings.export opens export tab')

const themeSelect = settings.el.querySelector<HTMLSelectElement>('select')
assert(themeSelect, 'theme select exists')
assert(
  themeSelect.options.length === 6,
  `theme options: system/light/dark/github/github-dark/custom, got ${themeSelect.options.length}`,
)
const colorSection = settings.el.querySelector<HTMLElement>('[data-section="custom-theme"]')
assert(colorSection, 'custom theme section exists')

// ---- fonts (外观 → 字体) ------------------------------------------------
settings.setTab('appearance')
const fontInputs = settings.el.querySelectorAll<HTMLInputElement>(
  '[data-section="fonts"] input[type="text"]',
)
assert(fontInputs.length === 2, `font inputs: ${fontInputs.length}`)
const bodyFontInput = fontInputs[0]!
const codeFontInput = fontInputs[1]!
bodyFontInput.value = 'Maple Mono NF CN'
bodyFontInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
assert(bodyFont === 'Maple Mono NF CN', `bodyFont emitted: ${bodyFont}`)
codeFontInput.value = 'JetBrains Mono'
codeFontInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
assert(codeFont === 'JetBrains Mono', `codeFont emitted: ${codeFont}`)
bodyFontInput.value = '   '
bodyFontInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
assert(bodyFont === undefined, 'blank bodyFont clears to undefined')

// ---- appearance metadata (theme classes + font vars) --------------------
const { fontVars, themeClass, THEME_OPTIONS, THEME_LABELS, THEME_ORDER } = await import(
  '../src/appearance'
)
assert(THEME_OPTIONS.length === 6, `theme options metadata: ${THEME_OPTIONS.length}`)
assert(
  THEME_ORDER.includes('github') && THEME_ORDER.includes('github-dark'),
  'github themes in cycle order',
)
assert(THEME_LABELS['github-dark'] === 'github-dark', 'theme label github-dark')
assert(themeClass('github') === 'theme-github', 'themeClass github')
assert(themeClass('github-dark') === 'theme-github-dark', 'themeClass github-dark')
assert(themeClass('light') === 'theme-light', 'themeClass light')
assert(themeClass('system') === null, 'themeClass system resolves through OS preference')

const fontVarsOf = (patch: { bodyFont?: string; codeFont?: string }): Record<string, string | null> =>
  Object.fromEntries(
    fontVars({
      theme: 'system',
      fontSize: 16,
      lineWidth: 780,
      recentDocuments: [],
      ...patch,
    }).map((entry) => [entry.name, entry.value]),
  )
const withFonts = fontVarsOf({ bodyFont: 'Maple Mono NF CN', codeFont: 'JetBrains Mono' })
assert(
  withFonts['--font-ui'] === 'Maple Mono NF CN, var(--font-ui-default)',
  `body font keeps the fallback stack: ${withFonts['--font-ui']}`,
)
assert(
  withFonts['--font-editor'] === 'JetBrains Mono, var(--font-editor-default)',
  `code font keeps the fallback stack: ${withFonts['--font-editor']}`,
)
const blankFonts = fontVarsOf({})
assert(
  blankFonts['--font-ui'] === null && blankFonts['--font-editor'] === null,
  'blank fonts fall back to the CSS defaults',
)

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
assert(settings.getTab() === 'general', 'unsubscribe falls back to the first tab')

console.log('SMOKE UI SETTINGS OK: typora-aligned tabs + general/editor/markdown/image/export options + open/close + registry + registerTab')

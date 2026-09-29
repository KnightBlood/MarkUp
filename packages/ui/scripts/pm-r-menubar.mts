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
g.Event = dom.window.Event
g.MouseEvent = dom.window.MouseEvent
g.KeyboardEvent = dom.window.KeyboardEvent
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
})

const { createContextMenu } = await import('../src/ui/contextMenu')
const { createMenuBar, toAppShortcut } = await import('../src/ui/menuBar')
const { CommandRegistry, formatShortcut } = await import('../src/commands')
const { MENU_TEMPLATE, menuCommandIds } = await import('@markup/host-api')

const host = document.getElementById('app')
assert(host, 'has #app')

// Register every id menu.json mentions, so nothing is disabled by accident.
// Two of them carry shortcuts to prove accelerators come from the registry.
const SHORTCUTS: Record<string, string> = {
  'format.h2': 'Mod+2',
  'edit.copyAsMarkdown': 'Mod+Shift+C',
}
const runs: string[] = []
const registry = new CommandRegistry()
for (const id of menuCommandIds()) {
  registry.register({
    id,
    label: id,
    shortcut: SHORTCUTS[id],
    run: () => runs.push(id),
  })
}

const menu = createContextMenu(host)
const bar = createMenuBar({
  registry,
  menu,
  isChecked: (id) => id === 'file.autoSave',
  actions: { reload: () => runs.push('reload') },
})

// ---- structure ----------------------------------------------------------
const labels = bar.labels()
assert(
  labels.join(' / ') === '文件 / 编辑 / 段落 / 格式 / 插入 / 视图 / 帮助',
  `sections follow menu.json: ${labels.join(' / ')}`,
)
assert(
  bar.el.querySelectorAll('.menubar__btn').length === MENU_TEMPLATE.length,
  'one button per section',
)
const rendered = [...bar.el.querySelectorAll('.menubar__btn')].map((b) => b.textContent)
assert(rendered[0] === '文件', `first button labelled 文件: ${rendered[0]}`)
assert(rendered.includes('段落') && rendered.includes('格式'), '段落/格式 sections rendered')

// ---- item mapping -------------------------------------------------------
const edit = bar.itemsFor('编辑')
const copyMd = edit.find((item) => item.label === '复制为 Markdown')
assert(copyMd, '编辑 has 复制为 Markdown')
assert(copyMd?.disabled !== true, 'registered command is enabled')
copyMd?.run?.()
assert(runs.at(-1) === 'edit.copyAsMarkdown', `item runs the command (${runs.at(-1)})`)

const paragraph = bar.itemsFor('段落')
const h2 = paragraph.find((item) => item.label === '二级标题')
assert(h2?.shortcut === formatShortcut('Mod+2'), `heading shortcut shown: ${h2?.shortcut}`)
const plain = paragraph.find((item) => item.label === '正文')
assert(plain?.checked === undefined, 'command rows are not checkboxes')

const file = bar.itemsFor('文件')
const autoSave = file.find((item) => item.label === '自动保存')
assert(autoSave?.checked === true, 'checkbox reflects isChecked')
autoSave?.run?.()
assert(runs.at(-1) === 'file.autoSaveOff', `checked box runs the off command (${runs.at(-1)})`)
const quit = file.find((item) => item.label === '退出')
assert(quit?.disabled === true, 'action without a handler renders disabled')
assert(
  quit?.shortcut === formatShortcut('Mod+Q'),
  `action accelerator localized: ${quit?.shortcut}`,
)

const help = bar.itemsFor('帮助')
const devtools = help.find((item) => item.label === '开发者工具')
assert(devtools?.disabled === true, 'devtools stays native-only in the web shell')

assert(toAppShortcut('CmdOrCtrl+Shift+T') === 'Mod+Shift+T', 'CmdOrCtrl → Mod')

// ---- dropdown opens through the shared context menu ---------------------
const editButton = bar.el.querySelectorAll<HTMLButtonElement>('.menubar__btn')[1]
editButton?.click()
assert(menu.isOpen(), 'clicking a section opens the dropdown')
assert(
  menu.el.querySelectorAll('.context-menu__item').length > 0,
  'dropdown rendered rows',
)
assert(editButton?.getAttribute('aria-expanded') === 'true', 'open section marked expanded')
const separators = menu.el.querySelectorAll('.context-menu__sep').length
assert(separators >= 3, `separators preserved: ${separators}`)
editButton?.click()
assert(menu.isOpen() === false, 'clicking the open section closes it')
assert(editButton?.getAttribute('aria-expanded') === 'false', 'collapsed again')

console.log(
  `SMOKE UI MENUBAR OK: ${labels.length} sections from menu.json / ${menuCommandIds().length} ids / disabled+checkbox+accelerator mapping`,
)

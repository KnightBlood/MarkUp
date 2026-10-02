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
g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement
g.Event = dom.window.Event
g.MouseEvent = dom.window.MouseEvent
g.KeyboardEvent = dom.window.KeyboardEvent
g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
g.requestAnimationFrame = (cb: FrameRequestCallback) => dom.window.setTimeout(() => cb(0), 16)
g.cancelAnimationFrame = (id: number) => dom.window.clearTimeout(id)

const { renderSidebar } = await import('../src/ui/sidebar')
const { setHost } = await import('@markup/host-api')

setHost({
  platform: 'web',
  fs: {
    read: async () => ({ path: '', content: '' }),
    write: async () => undefined,
    readDir: async () => [],
    watch: () => () => undefined,
  },
  dialog: {
    open: async () => [],
    save: async () => null,
    message: async () => ({ confirmed: true }),
  },
  app: {
    openExternal: async () => undefined,
    setTitle: () => undefined,
    getConfig: async () => ({
      theme: 'system',
      fontSize: 16,
      lineWidth: 780,
      recentDocuments: [],
    }),
    setConfig: () => undefined,
    on: () => () => undefined,
  },
} as never)

let lastMenu: Array<{ label?: string; separator?: boolean; run?: () => void }> | null = null
const opened: string[] = []
const copied: string[] = []
const removed: string[] = []
let folderOpens = 0

const sidebar = renderSidebar({
  onOpen: (path) => opened.push(path),
  openPath: async (path) => {
    opened.push(path)
  },
  getCurrentPath: () => null,
  getMarkdown: () => '# 标题一\n\n段落\n\n## 标题二',
  gotoAnchor: () => undefined,
  getWorkspace: () => ({ root: null, files: [] }),
  onOpenFolder: async () => {
    folderOpens += 1
  },
  getRecents: async () => ['/tmp/a.md', '/tmp/b.md'],
  showContextMenu: (_x, _y, items) => {
    lastMenu = items
  },
  copyText: async (text) => {
    copied.push(text)
  },
  removeFromRecents: async (path) => {
    removed.push(path)
  },
})

await new Promise((r) => setTimeout(r, 20))
sidebar.refreshOutline()
sidebar.showTab('file')

const root = sidebar.el
assert(root.classList.contains('sidebar'), 'sidebar root')

const fileBtn = root.querySelector<HTMLButtonElement>('.file-tree__recent')
assert(fileBtn, 'file item exists')
const fileEvent = new dom.window.MouseEvent('contextmenu', {
  bubbles: true,
  cancelable: true,
  clientX: 10,
  clientY: 20,
})
fileBtn.dispatchEvent(fileEvent)
assert(lastMenu && lastMenu.length >= 2, 'file menu items')
assert(lastMenu.some((i) => i.label === '打开'), 'file has open')
assert(lastMenu.some((i) => i.label === '复制路径'), 'file has copy path')
assert(lastMenu.some((i) => i.label === '从最近列表移除'), 'file has remove from recents')

lastMenu = null
sidebar.showTab('outline')
const outlineBtn = root.querySelector<HTMLButtonElement>('.outline__item')
assert(outlineBtn, 'outline item')
outlineBtn.dispatchEvent(
  new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
)
assert(lastMenu && lastMenu.some((i) => i.label === '复制标题文本'), 'outline copy text')
assert(lastMenu.some((i) => i.label === '复制 Markdown 链接'), 'outline copy link')

lastMenu = null
const blank = root.querySelector('.file-tree')
assert(blank, 'file tree present')
blank.dispatchEvent(
  new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
)
assert(lastMenu && lastMenu.some((i) => i.label === '打开文件…'), 'blank open file')

// 面板顶部两个按钮已移除，空白区菜单改为直接动作（不再 click 按钮）
const blankFolder = lastMenu.find((i) => i.label === '打开文件夹…')
assert(blankFolder && blankFolder.run, 'blank menu folder item runnable')
blankFolder.run()
assert(folderOpens === 1, 'folder menu item calls onOpenFolder')
const blankFile = lastMenu.find((i) => i.label === '打开文件…')
assert(blankFile && blankFile.run, 'blank menu file item runnable')
const opensBefore = opened.length
blankFile.run() // dialog.open mock 未选文件 → 直接返回，不得抛错
assert(opened.length === opensBefore, 'file picker without selection opens nothing')

// registration surface: registerTab appends button + panel, unsubscribe removes both
const pluginTab = sidebar.registerTab({
  id: 'plugin',
  label: '插件',
  render: () => {
    const div = document.createElement('div')
    div.className = 'sidebar__panel plugin-panel'
    div.textContent = 'plugin side'
    return div
  },
})
const tabButtons = root.querySelectorAll<HTMLButtonElement>('.sidebar__tabs .sidebar__tab')
const pluginBtn = tabButtons[tabButtons.length - 1]
assert(pluginBtn && pluginBtn.textContent === '插件', 'plugin tab button appended last')
const fileBtn2 = tabButtons[0]
fileBtn2?.click()
pluginBtn?.click()
assert(
  pluginBtn.classList.contains('is-active'),
  'plugin tab activates and deactivates the previous one',
)
const pluginPanel = root.querySelector<HTMLElement>('.plugin-panel')
assert(pluginPanel && pluginPanel.hidden === false, 'plugin panel visible after click')
let dupThrew = false
try {
  sidebar.registerTab({ id: 'plugin', label: 'x', render: () => document.createElement('div') })
} catch {
  dupThrew = true
}
assert(dupThrew, 'duplicate tab id throws while registered')
pluginTab()
assert(!root.querySelector('.plugin-panel'), 'unsubscribe removes plugin panel')
assert(
  root.querySelectorAll('.sidebar__tabs .sidebar__tab').length === 3,
  'unsubscribe restores built-in tab count',
)

console.log('SMOKE SIDEBAR CONTEXT OK: file/outline/blank menus + registerTab')

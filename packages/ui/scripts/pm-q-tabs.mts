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
g.Event = dom.window.Event
g.MouseEvent = dom.window.MouseEvent

const { createTabBar } = await import('../src/ui/tabBar')
type TabSpec = import('../src/ui/tabBar').TabSpec

const host = document.getElementById('app')
assert(host, 'has #app')

let tabs: TabSpec[] = [
  { id: 't1', title: 'readme.md', path: '/w/readme.md', modified: false, active: true },
  { id: 't2', title: 'notes.md', path: '/w/notes.md', modified: true, active: false },
  { id: 't3', title: '未命名文档', path: '', modified: false, active: false },
]

const calls: string[] = []
let menu: Array<{ label?: string; separator?: boolean; disabled?: boolean }> | null = null
let menuAt: { x: number; y: number } | null = null

const bar = createTabBar({
  getTabs: () => tabs,
  onSelect: (id) => calls.push(`select:${id}`),
  onClose: (id) => calls.push(`close:${id}`),
  onCloseOthers: (id) => calls.push(`closeOthers:${id}`),
  onCloseAll: () => calls.push('closeAll'),
  onCloseSaved: () => calls.push('closeSaved'),
  onNew: () => calls.push('new'),
  onReorder: (id, target, before) => calls.push(`reorder:${id}>${target}:${before ? 'before' : 'after'}`),
  onCopyPath: (path) => calls.push(`copy:${path}`),
  showMenu: (x, y, items) => {
    menu = items
    menuAt = { x, y }
  },
})

host.append(bar.el)
bar.refresh()

// --- render ------------------------------------------------------------
const rows = [...bar.el.querySelectorAll<HTMLElement>('.tabbar__tab')]
assert(rows.length === 3, `3 tabs rendered, got ${rows.length}`)
assert(rows[0]!.classList.contains('is-active'), 'first tab active')
assert(rows[1]!.classList.contains('is-dirty'), 'second tab dirty')
assert(rows[1]!.querySelector('.tabbar__dirty'), 'dirty dot present')
assert(!rows[0]!.querySelector('.tabbar__dirty'), 'clean tab has no dot')
assert(rows[2]!.textContent.includes('未命名文档'), 'untitled label')
assert(rows[0]!.getAttribute('aria-selected') === 'true', 'aria-selected on active')
assert(rows[1]!.getAttribute('aria-selected') === 'false', 'aria-selected off')

// --- select / close / plus ---------------------------------------------
rows[2]!.click()
assert(calls.pop() === 'select:t3', 'click selects the tab')

const closeHit = rows[1]!.querySelector<HTMLElement>('.tabbar__close')
assert(closeHit, 'close affordance exists')
closeHit!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
const last = calls.pop()
assert(last === 'close:t2', `close span closes (got ${last})`)
assert(calls.length === 0, 'close does not also select (stopPropagation)')

rows[0]!.dispatchEvent(new dom.window.MouseEvent('auxclick', { bubbles: true, button: 1 }))
assert(calls.pop() === 'close:t1', 'middle click closes')

bar.el.querySelector<HTMLButtonElement>('.tabbar__new')!.click()
assert(calls.pop() === 'new', 'plus button creates a tab')

// --- tab context menu ---------------------------------------------------
rows[1]!.dispatchEvent(
  new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 60 }),
)
assert(menu !== null, 'context menu shown')
assert(menuAt && menuAt.x === 40 && menuAt.y === 60, 'menu anchored at pointer')
const labels = menu!.filter((item) => item.label).map((item) => item.label)
assert(labels.join(',') === '关闭,关闭其他,关闭全部,关闭已保存的标签页,新建标签页,复制路径', `menu labels: ${labels.join(',')}`)
const copyPathEntry = menu!.find((item) => item.label === '复制路径')
assert(copyPathEntry?.disabled === false, 'copy path enabled for a tab with a path')
const closeOthersItem = menu!.find((item) => item.label === '关闭其他')
assert(closeOthersItem?.disabled === false, 'close others enabled with 3 tabs')

// run a couple of entries
for (const item of menu!) item.run?.()
const ran = calls.splice(0, calls.length)
assert(ran.includes('close:t2'), 'menu close ran')
assert(ran.includes('closeOthers:t2'), 'menu close others ran')
assert(ran.includes('closeAll'), 'menu close all ran')
assert(ran.includes('closeSaved'), 'menu close saved ran')
assert(ran.includes('new'), 'menu new ran')
assert(ran.includes('copy:/w/notes.md'), 'menu copy path ran')

// --- untitled tab: copy path disabled -----------------------------------
menu = null
rows[2]!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
assert(
  menu!.find((item) => item.label === '复制路径')?.disabled === true,
  'untitled tab cannot copy a path',
)
assert(
  menu!.find((item) => item.label === '关闭其他')?.disabled === false,
  'close others still offered',
)
menu = null

// --- single tab: close others disabled ----------------------------------
tabs = [tabs[0]!]
bar.refresh()
const only = bar.el.querySelector<HTMLElement>('.tabbar__tab')
assert(only, 'one tab after refresh')
only!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
assert(
  menu!.find((item) => item.label === '关闭其他')?.disabled === true,
  'close others disabled with a single tab',
)
menu = null

// --- drag & drop reorder ------------------------------------------------
tabs = [
  { id: 't1', title: 'one.md', path: '/1.md', modified: false, active: true },
  { id: 't2', title: 'two.md', path: '/2.md', modified: false, active: false },
  { id: 't3', title: 'three.md', path: '/3.md', modified: false, active: false },
]
bar.refresh()
const [r1, r2] = [...bar.el.querySelectorAll<HTMLElement>('.tabbar__tab')]
r1!.dispatchEvent(new dom.window.MouseEvent('dragstart', { bubbles: true }))
assert(r1!.classList.contains('is-dragging'), 'dragging state marked')
r2!.dispatchEvent(new dom.window.MouseEvent('dragover', { bubbles: true, cancelable: true, clientX: 10 }))
assert(r2!.classList.contains('is-drop-after') || r2!.classList.contains('is-drop-before'), 'drop hint shown')
r2!.dispatchEvent(new dom.window.MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 10 }))
const reorderCall = calls.find((entry) => entry.startsWith('reorder:'))
assert(reorderCall === 'reorder:t1>t2:after', `reorder call, got ${reorderCall}`)
assert(!r1!.classList.contains('is-dragging'), 'dragging state cleared')
assert(!r2!.classList.contains('is-drop-after'), 'drop hint cleared')

console.log('SMOKE UI TABBAR OK: render/select/close/context menu/drag reorder')

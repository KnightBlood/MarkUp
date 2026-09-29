function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

// host-api stores the injected host on `window.__HOST__` — no DOM here.
const g = globalThis as typeof globalThis & { window?: unknown }
if (!g.window) g.window = {}

const { setHost } = await import('@markup/host-api')
const { DocStore } = await import('../src/docStore')

const files = new Map<string, string>([
  ['/tmp/a.md', '# A'],
  ['/tmp/b.md', '# B'],
  ['/tmp/gone.md', ''],
])
const writes: Array<{ path: string; content: string }> = []
const recents: string[][] = []

setHost({
  platform: 'web',
  fs: {
    read: async (path: string) => {
      if (!files.has(path)) throw new Error(`ENOENT: ${path}`)
      return { path, content: files.get(path) ?? '', encoding: 'utf8', crlf: false, bom: false }
    },
    write: async (path: string, content: string) => {
      files.set(path, content)
      writes.push({ path, content })
    },
    readDir: async () => [],
    watch: () => () => undefined,
  },
  app: {
    getConfig: async () => ({ theme: 'system', fontSize: 16, lineWidth: 780, recentDocuments: [] }),
    setConfig: (config) => {
      recents.push(config.recentDocuments)
    },
    openExternal: async () => undefined,
    setTitle: () => undefined,
    on: () => () => undefined,
  },
} as never)

// --- boot state: empty, no tabs -----------------------------------------
const store = new DocStore()
assert(store.isOpen() === false && store.getTabs().length === 0, 'starts empty')
assert(store.getDocument() === null, 'no active doc')
assert(store.hasModified() === false, 'nothing modified')

// --- setContent without a doc still yields a document -------------------
store.setContent('hello')
assert(store.getTabCount() === 1, 'setContent opens a tab')
const first = store.getDocument()
assert(first && first.content === 'hello' && first.modified, 'first tab content/dirty')
assert(first?.id, 'tab has an id')

// --- newTab always stacks (a + that does nothing reads as a bug) --------
store.setContent('')
const blank = store.getDocument()
if (blank) blank.modified = false
store.newTab()
assert(store.getTabCount() === 2, `newTab stacks a fresh tab, got ${store.getTabCount()}`)
assert(store.getDocument() !== blank && store.getDocument()?.content === '', 'fresh blank tab focused')
store.closeTab(store.getActiveId() ?? '')
assert(store.getTabCount() === 1, 'stacked tab closed again')

// --- two real tabs + focus ---------------------------------------------
store.setDocument('/tmp/a.md', '# A')
store.setDocument('/tmp/b.md', '# B')
assert(store.getTabCount() === 2, `two tabs, got ${store.getTabCount()}`)
assert(store.getDocument()?.path === '/tmp/b.md', 'b.md active')
const [tabA, tabB] = store.getTabs()
assert(tabA && tabB && tabA.path === '/tmp/a.md' && tabB.path === '/tmp/b.md', 'tab order a,b')

// --- reopening the same path focuses instead of duplicating -------------
store.setDocument('/tmp/a.md', '# A changed on disk')
assert(store.getTabCount() === 2, 'no duplicate tab for the same path')
assert(store.getDocument() === tabA, 'focused the existing tab')

// --- stale content never clobbers unsaved edits -------------------------
tabA!.modified = true
tabA!.content = '# A unsaved'
store.setDocument('/tmp/a.md', '# A changed on disk')
assert(tabA!.content === '# A unsaved', 'dirty tab keeps its edits')
tabA!.modified = false
store.setDocument('/tmp/a.md', '# A changed on disk')
assert(tabA!.content === '# A changed on disk', 'clean tab picks up fresh bytes')

// --- switch / cycle -----------------------------------------------------
store.switchTo(tabB!.id)
assert(store.getActiveId() === tabB!.id, 'switchTo focuses b')
store.cycle(1)
assert(store.getActiveId() === tabA!.id, 'cycle wraps to a')
store.cycle(-1)
assert(store.getActiveId() === tabB!.id, 'cycle back to b')

// --- reorder ------------------------------------------------------------
assert(store.reorder(tabA!.id, tabB!.id, false) === true, 'reorder moves a after b')
assert(store.getTabs().map((t) => t.path).join(',') === '/tmp/b.md,/tmp/a.md', 'order b,a')
assert(store.reorder(tabB!.id, tabB!.id, false) === false, 'reorder onto self is a no-op')

// --- restoreTab: appended, not focused, no recents churn ----------------
// Let earlier async pushRecent() writes settle first, so the count below is
// strictly attributable to restoreTab (which must never touch recents).
await new Promise((resolve) => setTimeout(resolve, 20))
const beforeRecents = recents.length
const restored = store.restoreTab('/tmp/a.md', '# A')
assert(restored === tabA, 'restore of an open path reuses the tab')
const added = store.restoreTab('/tmp/new.md', '# New')
assert(added && store.getTabCount() === 3, 'restore adds a tab')
assert(store.getActiveId() !== added.id, 'restore does not steal focus')
await new Promise((resolve) => setTimeout(resolve, 10))
assert(recents.length === beforeRecents, 'restore never touches recents')

// --- close: focus moves to a neighbour, empty store stays open-safe -----
assert(store.closeTab(added!.id) === true, 'closeTab')
assert(store.getTabCount() === 2, 'two tabs left')
assert(store.closeTab('nope') === false, 'unknown id rejected')

// --- closeWhere (close others / saved) ----------------------------------
const others = store.closeWhere((t) => t.id !== store.getActiveId())
assert(others === 1, `close others removes 1, got ${others}`)
assert(store.getTabCount() === 1 && store.getActiveId() !== null, 'one active tab left')

// --- save / saveModified across tabs ------------------------------------
store.setDocument('/tmp/a.md', '# A clean')
store.setContent('# A dirty')
store.newTab('')
store.setDocument('/tmp/b.md', '# B clean')
store.setContent('# B dirty')
assert(store.getModified().length === 2, `two dirty tabs, got ${store.getModified().length}`)
const savedCount = await store.saveModified()
assert(savedCount === 2, `saveModified wrote both, got ${savedCount}`)
assert(store.hasModified() === false, 'all clean after saveModified')
assert(writes.filter((w) => w.path === '/tmp/a.md').at(-1)?.content === '# A dirty', 'a written')
assert(writes.filter((w) => w.path === '/tmp/b.md').at(-1)?.content === '# B dirty', 'b written')

// --- dropBlankTab -------------------------------------------------------
store.newTab('')
const blankTab = store.getDocument()
assert(blankTab && !blankTab.path, 'blank tab open')
store.restoreTab('/tmp/extra.md', 'x')
assert(store.getTabCount() > 2, 'more than one tab')
assert(store.dropBlankTab() === true, 'blank dropped')
assert(store.getTabs().every((t) => t.path), 'no blank tab remains')

// --- unsubscribe --------------------------------------------------------
let ticks = 0
const off = store.subscribe(() => (ticks += 1))
store.switchToPath('/tmp/a.md')
assert(ticks === 1, 'listener fired')
off()
store.switchToPath('/tmp/b.md')
assert(ticks === 1, 'listener removed')

// --- recents: the store owns the list and mirrors it to callers --------
// Regression: the shell rewrites the whole config on session saves, so it must
// learn about every recents write (otherwise a stale copy wins and the list
// ends up empty).
const mirrored: string[][] = []
store.onRecentsChange((list) => mirrored.push([...list]))
store.setDocument('/tmp/recents.md', '# R')
await new Promise((resolve) => setTimeout(resolve, 20))
assert(
  recents.at(-1)?.[0] === '/tmp/recents.md',
  `pushRecent writes the path first: ${JSON.stringify(recents.at(-1))}`,
)
assert(
  mirrored.at(-1)?.[0] === '/tmp/recents.md',
  `recents mirror notifies with the same list: ${JSON.stringify(mirrored.at(-1))}`,
)
store.setDocument('/tmp/recents.md', '# R2')
await new Promise((resolve) => setTimeout(resolve, 20))
assert(
  recents.at(-1)?.filter((path) => path === '/tmp/recents.md').length === 1,
  `recents dedupe the same path: ${JSON.stringify(recents.at(-1))}`,
)
assert(
  recents.at(-1)?.length === 1,
  `recents start from the (empty) stored list: ${JSON.stringify(recents.at(-1))}`,
)

console.log(
  'SMOKE CORE TABS OK: new/close/cycle/reorder/restore/saveModified/blank-guard/recents-mirror',
)

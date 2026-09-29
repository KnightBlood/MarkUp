import { JSDOM } from 'jsdom'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true })
const window = dom.window
const define = (key: string, value: unknown): void => {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
}
define('window', window)
define('document', window.document)
define('navigator', window.navigator)
define('HTMLElement', window.HTMLElement)
define('Element', window.Element)
define('Node', window.Node)
define('MutationObserver', window.MutationObserver)
define('CustomEvent', window.CustomEvent)
define('getComputedStyle', window.getComputedStyle.bind(window))
let rafId = 0
define('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => cb(rafId++), 16))
define('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
define('addEventListener', (type: string, fn: EventListener) => window.addEventListener(type, fn))
define('removeEventListener', (type: string, fn: EventListener) => window.removeEventListener(type, fn))
define('dispatchEvent', (event: Event) => window.dispatchEvent(event))
window.Element.prototype.scrollIntoView = function () {}
window.HTMLElement.prototype.focus = function () {}

const { createWysiwygAdapter } = await import('../src/adapters/wysiwyg')

const markdown = [
  '# 标题',
  '',
  '前言段落。',
  '',
  '```mermaid',
  'flowchart TD',
  '  A[开始] --> B[结束]',
  '```',
  '',
  '尾段落。',
  '',
].join('\n')

const adapter = createWysiwygAdapter({})
adapter.setValue(markdown)
const root = window.document.getElementById('root')
assert(root, 'root missing')
adapter.mount(root)

const deadline = Date.now() + 5000
let widget: Element | null = null
let hidden: Element | null = null
while (Date.now() < deadline) {
  widget = root.querySelector('.md-diagram--widget')
  hidden = root.querySelector('.md-diagram-hidden')
  if (widget && hidden) break
  await new Promise((r) => setTimeout(r, 50))
}
assert(widget, 'diagram widget not drawn')
assert(hidden, 'source block not hidden')

const hydrateDeadline = Date.now() + 5000
let hydrated = false
while (Date.now() < hydrateDeadline) {
  const el = root.querySelector('.md-diagram--widget[data-diagram]')
  if (el && ((el as HTMLElement).dataset.rendered !== undefined || (el as HTMLElement).dataset.error !== undefined)) {
    hydrated = true
    break
  }
  await new Promise((r) => setTimeout(r, 50))
}
assert(hydrated, 'hydrate never ran on widget root (self-match regression)')

widget.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
await new Promise((r) => setTimeout(r, 50))
assert(!root.querySelector('.md-diagram--widget'), 'widget still present after click')
assert(!root.querySelector('.md-diagram-hidden'), 'source still hidden after click')

adapter.restoreAnchor({ offset: 0, line: 1 })
await new Promise((r) => setTimeout(r, 80))
assert(root.querySelector('.md-diagram--widget'), 'widget not restored after cursor leaves')
assert(root.querySelector('.md-diagram--hidden, .md-diagram-hidden'), 'hide not restored')

const value = adapter.getValue()
assert(value.includes('```mermaid'), 'markdown lost mermaid fence')

// Graphical editor bridge: registered handler receives mermaid edit requests
// and its `done(code)` replaces the fence content in place.
const { setDiagramEditHandler } = await import('../src/diagramEditBridge')
let diagramRequest: { lang: string; code: string } | null = null
let diagramDoneCount = 0
setDiagramEditHandler((request, done) => {
  diagramRequest = request
  diagramDoneCount += 1
  done('flowchart TD\n  A[updated] --> B[done]')
})
const editWidget = root.querySelector('.md-diagram--widget')
assert(editWidget, 'widget missing before bridge click')
editWidget.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
// markdownUpdated is debounced (200ms); wait for the listener flush before reading.
await new Promise((r) => setTimeout(r, 300))
assert(diagramDoneCount === 1, `bridge handler should fire once, got ${diagramDoneCount}`)
assert(diagramRequest?.lang === 'mermaid', `bridge lang: ${diagramRequest?.lang}`)
assert(
  String(diagramRequest?.code).includes('flowchart TD'),
  `bridge code should carry current fence, got: ${diagramRequest?.code}`,
)
const afterEdit = adapter.getValue()
assert(afterEdit.includes('A[updated]'), 'done(code) must replace block content')
assert(afterEdit.includes('```mermaid'), 'done(code) must keep the fence language')

// Cancel path: done(null) leaves the document untouched.
setDiagramEditHandler((request, done) => {
  void request
  done(null)
})
const cancelWidget = root.querySelector('.md-diagram--widget')
assert(cancelWidget, 'widget missing before cancel click')
const beforeCancel = adapter.getValue()
cancelWidget.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
await new Promise((r) => setTimeout(r, 300))
assert(adapter.getValue() === beforeCancel, 'done(null) must not modify the document')
setDiagramEditHandler(null)

// Non-mermaid diagram languages must not open the graphical editor.
const flowMd = ['```flow', 'st=>start: Start', 'e=>end: End', 'st->e', '```', '', 'after flow', ''].join('\n')
adapter.setValue(flowMd)
await new Promise((r) => setTimeout(r, 80))
adapter.restoreAnchor({ offset: flowMd.indexOf('after flow'), line: 7 })
let flowWidget: Element | null = null
const flowDeadline = Date.now() + 3000
while (Date.now() < flowDeadline) {
  flowWidget = root.querySelector('.md-diagram--widget')
  if (flowWidget) break
  await new Promise((r) => setTimeout(r, 50))
}
if (!flowWidget) {
  console.log('DBG value:', JSON.stringify(adapter.getValue()))
  console.log('DBG html:', root.innerHTML.slice(0, 900))
}
assert(flowWidget, 'flow diagram widget missing')
let flowBridgeCount = 0
setDiagramEditHandler(() => {
  flowBridgeCount += 1
})
flowWidget.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
await new Promise((r) => setTimeout(r, 60))
assert(flowBridgeCount === 0, `flow lang must skip diagram bridge, got ${flowBridgeCount} calls`)
setDiagramEditHandler(null)

const taskMd = [
  '# Tasks',
  '',
  '- [ ] todo one',
  '- [x] done two',
  '- [ ] todo three',
  '',
  'after list',
  '',
].join('\n')
adapter.setValue(taskMd)
await new Promise((r) => setTimeout(r, 80))
const taskLen = adapter.getValue().length
for (const offset of [0, 5, 20, Math.floor(taskLen / 2), taskLen - 1, taskLen]) {
  adapter.restoreAnchor({ offset, line: 1, endOffset: Math.min(offset + 3, taskLen) })
}
adapter.restoreAnchor({ offset: 0, line: 1 })
adapter.captureAnchor()
assert(adapter.getValue().includes('todo three'), 'task list markdown preserved')

const fmMd = [
  '---',
  'title: Hello Frontmatter',
  'author: tester',
  '---',
  '',
  '# Body Heading',
  '',
  'body paragraph',
  '',
  '```math',
  'a^2 + b^2 = c^2',
  '```',
  '',
].join('\n')
adapter.setValue(fmMd)
await new Promise((r) => setTimeout(r, 80))
assert(adapter.getValue().startsWith('---'), 'frontmatter preserved on getValue')
assert(adapter.getValue().includes('title: Hello Frontmatter'), 'frontmatter content kept')
assert(adapter.getValue().includes('# Body Heading'), 'body kept with frontmatter')

const bodyHeadingOffset = fmMd.indexOf('# Body Heading')
assert(bodyHeadingOffset > 0, 'body heading offset')
adapter.restoreAnchor({ offset: bodyHeadingOffset, line: 6 })
await new Promise((r) => setTimeout(r, 40))
const fmJump = adapter.captureAnchor()
assert(
  fmJump.offset >= bodyHeadingOffset - 2,
  `frontmatter jump landed at ${fmJump.offset}, want near ${bodyHeadingOffset}`,
)

let mathWidget: Element | null = null
const mathDeadline = Date.now() + 3000
while (Date.now() < mathDeadline) {
  mathWidget = root.querySelector('.md-math--widget')
  if (mathWidget) break
  await new Promise((r) => setTimeout(r, 50))
}
assert(mathWidget, 'math widget not drawn for ```math fence')
assert((mathWidget as HTMLElement).querySelector('.katex'), 'math widget missing katex output')

const { setMathEditHandler } = await import('../src/mathEditorBridge')
let mathEditRequest: { latex: string; display: boolean } | null = null
let mathEditDoneCount = 0
setMathEditHandler((request, done) => {
  mathEditRequest = request
  mathEditDoneCount += 1
  void done
})
;(mathWidget as HTMLElement).dispatchEvent(
  new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }),
)
;(mathWidget as HTMLElement).dispatchEvent(
  new window.MouseEvent('click', { bubbles: true, cancelable: true }),
)
await new Promise((r) => setTimeout(r, 50))
assert(mathEditDoneCount === 1, `math widget click should open edit bridge once, got ${mathEditDoneCount}`)
assert(mathEditRequest?.latex === 'a^2 + b^2 = c^2', `math edit latex: ${mathEditRequest?.latex}`)
assert(mathEditRequest?.display === true, 'math edit display mode')
assert(
  root.querySelector('.md-math--widget'),
  'math widget must stay visible until edit confirms (mousedown stopEvent regression)',
)
setMathEditHandler(null)

const latexOffset = fmMd.indexOf('a^2 + b^2 = c^2')
assert(latexOffset > 0, 'latex body offset missing')
adapter.restoreAnchor({ offset: latexOffset, line: 11 })
await new Promise((r) => setTimeout(r, 80))
const liveMath = root.querySelector('.md-math--widget')
assert(liveMath, 'math widget must render while caret inside code_block (live preview regression)')
assert((liveMath as HTMLElement).querySelector('.katex'), 'live math widget missing katex output')
assert(
  !root.querySelector('.md-diagram-hidden'),
  'math source must stay visible while caret inside (live source+preview)',
)

adapter.restoreAnchor({ offset: fmMd.indexOf('body paragraph'), line: 7 })
await new Promise((r) => setTimeout(r, 60))
adapter.insertTable?.(3, 3)
await new Promise((r) => setTimeout(r, 200))
const tableValue = adapter.getValue()
assert(
  tableValue.includes('|') && tableValue.includes('---'),
  `insertTable markdown table missing: ${JSON.stringify(tableValue.slice(-500))}`,
)

adapter.restoreAnchor({ offset: adapter.getValue().length, line: 99 })
await new Promise((r) => setTimeout(r, 60))
adapter.insertMarkdown?.({ markdown: '\n\nfootnote test[^1]\n\n[^1]: note body\n' })
await new Promise((r) => setTimeout(r, 200))
assert(adapter.getValue().includes('[^1]'), `footnote reference missing: ${JSON.stringify(adapter.getValue().slice(-300))}`)

type TableCmd = Parameters<NonNullable<typeof adapter.runTableCommand>>[0]
const runTable = (id: TableCmd): boolean => adapter.runTableCommand?.(id) ?? false
const pipeLines = (md: string): string[] => md.split('\n').filter((line) => line.trim().startsWith('|'))
const rowCount = (md: string): number => Math.max(0, pipeLines(md).length - 1)
const setCaret = async (needle: string): Promise<void> => {
  const md = adapter.getValue()
  const offset = md.indexOf(needle)
  assert(offset >= 0, `table fixture needle missing: ${needle}`)
  adapter.restoreAnchor({ offset, line: 1 })
  await new Promise((r) => setTimeout(r, 60))
}

const tableFix = [
  '| H1 | H2 | H3 |',
  '| --- | --- | --- |',
  '| a1 | b1 | c1 |',
  '| a2 | b2 | c2 |',
  '',
  'after table',
  '',
].join('\n')
adapter.setValue(tableFix)
await new Promise((r) => setTimeout(r, 80))
await setCaret('H1')
assert(root.querySelector('.table-toolbar'), 'table toolbar missing when caret inside table')
assert(
  root.querySelectorAll('.table-toolbar__btn').length === 9,
  `compact toolbar should expose 9 buttons, got ${root.querySelectorAll('.table-toolbar__btn').length}`,
)
const baseRows = rowCount(adapter.getValue())
assert(baseRows === 3, `fixture rows: ${baseRows}`)

// Header row: insert-before falls back to insert-after; delete is schema-guarded.
assert(runTable('rowBefore'), 'rowBefore in header should fall back to rowAfter')
assert(rowCount(adapter.getValue()) === baseRows + 1, 'rowBefore fallback should add one row')
assert(!runTable('rowDelete'), 'rowDelete in header must be guarded')
assert(rowCount(adapter.getValue()) === baseRows + 1, 'guarded rowDelete must not change rows')

// Whole-column alignment must reach the separator row (md round-trip).
assert(runTable('alignCenter'), 'alignCenter should apply')
const sepLine = pipeLines(adapter.getValue()).find((line) => line.includes('---'))
assert(sepLine && sepLine.includes(':'), `separator should carry alignment markers: ${sepLine}`)

// Row move keeps header anchored and swaps body order.
await setCaret('a1')
const beforeMove = adapter.getValue()
assert(runTable('rowDown'), 'rowDown in body')
assert(adapter.getValue() !== beforeMove, 'rowDown should reorder rows')
await setCaret('a1')
assert(runTable('rowUp'), 'rowUp in body')
assert(adapter.getValue() === beforeMove, 'rowUp should restore row order')

// Body row insert/delete.
const rowsNow = rowCount(adapter.getValue())
assert(runTable('rowAfter'), 'rowAfter in body')
assert(rowCount(adapter.getValue()) === rowsNow + 1, 'rowAfter should add one row')
assert(runTable('rowDelete'), 'rowDelete in body')
assert(rowCount(adapter.getValue()) === rowsNow, 'rowDelete should remove one row')
assert(!adapter.getValue().includes('a1'), 'rowDelete should remove the caret row content')

// Column insert widens the header row too.
await setCaret('H1')
const beforeCol = pipeLines(adapter.getValue())[0].split('|').length
assert(runTable('colAfter'), 'colAfter in header row')
const afterCol = pipeLines(adapter.getValue())[0].split('|').length
assert(afterCol === beforeCol + 1, `colAfter should widen header: ${beforeCol} -> ${afterCol}`)

// Selection commands report success via CellSelection.
assert(runTable('selectRow'), 'selectRow should select a row')
assert(runTable('selectTable'), 'selectTable should select the table')

// Exit hides the toolbar; deleteTable clears the table entirely.
assert(runTable('exit'), 'exit table')
assert(!root.querySelector('.table-toolbar'), 'toolbar should hide after leaving table')
await setCaret('H1')
assert(runTable('deleteTable'), 'deleteTable')
assert(pipeLines(adapter.getValue()).length === 0, 'table should be gone after deleteTable')
assert(!root.querySelector('.table-toolbar'), 'toolbar hidden after deleteTable')

const outlineMd = [
  '# One',
  '',
  'para one content for scrolling far enough',
  '',
  '## Two',
  '',
  'para two',
  '',
  '### Three',
  '',
  'tail',
  '',
].join('\n')
adapter.setValue(outlineMd)
await new Promise((r) => setTimeout(r, 80))
const threeOffset = outlineMd.indexOf('### Three')
assert(threeOffset > 0, 'outline fixture missing Three')
adapter.restoreAnchor({ offset: threeOffset, line: 9 })
await new Promise((r) => setTimeout(r, 40))
const afterJump = adapter.captureAnchor()
assert(
  afterJump.offset >= threeOffset - 2,
  `outline jump landed at ${afterJump.offset}, want near ${threeOffset}`,
)

// Selection ranges must survive a round trip: the format menu wraps the
// selected text, so captureAnchor has to report endOffset, not just the caret.
const selectMd = 'alpha beta gamma\n\nsecond paragraph'
adapter.setValue(selectMd)
await new Promise((r) => setTimeout(r, 80))
adapter.restoreAnchor({ offset: 0, line: 1, endOffset: 5 })
const ranged = adapter.captureAnchor()
assert(ranged.offset === 0, `selection start captured: ${ranged.offset}`)
assert(ranged.endOffset === 5, `selection end captured: ${ranged.endOffset}`)
adapter.restoreAnchor({ offset: 11, line: 1, endOffset: 16 })
const second = adapter.captureAnchor()
assert(
  second.offset === 11 && second.endOffset === 16,
  `mid-document range captured: ${second.offset}-${second.endOffset}`,
)
adapter.restoreAnchor({ offset: 17, line: 1 })
const collapsed = adapter.captureAnchor()
assert(
  collapsed.offset === 17 && collapsed.endOffset === undefined,
  `collapsed caret reports no endOffset: ${JSON.stringify(collapsed)}`,
)
// Caret positions inside a paragraph (not just at block edges) must be
// addressable, otherwise a selection can never be restored accurately.
adapter.restoreAnchor({ offset: 5, line: 1 })
const mid = adapter.captureAnchor()
assert(mid.offset === 5, `mid-paragraph caret captured: ${mid.offset}`)

// ---- block formats run natively (structure, not text) --------------------
adapter.setValue('para one\n\nsecond')
await new Promise((r) => setTimeout(r, 80))
const firstLine = (): string => adapter.getValue().split('\n')[0] ?? ''
const applyBlock = (id: string): void => {
  const ok = (adapter.setBlockFormat as (value: string) => boolean)(id)
  assert(ok, `setBlockFormat(${id}) applied`)
}
adapter.restoreAnchor({ offset: 2, line: 1 })
applyBlock('h2')
assert(firstLine() === '## para one', `h2 markdown: ${firstLine()}`)
applyBlock('h3')
assert(firstLine() === '### para one', `heading level switches: ${firstLine()}`)
applyBlock('h3')
assert(firstLine() === 'para one', `same level toggles off: ${firstLine()}`)
applyBlock('quote')
assert(firstLine() === '> para one', `quote wraps: ${firstLine()}`)
applyBlock('quote')
assert(firstLine() === 'para one', `quote lifts: ${firstLine()}`)
// Milkdown's serializer picks its own bullet marker (`*`), so match the shape.
const body = (line: string): string => line.replace(/^([*+-]|\d+[.)])\s+/, '')
const marker = (line: string): string => /^([*+-]|\d+[.)])\s+/.exec(line)?.[1] ?? ''
const isBullet = (line: string): boolean => ['*', '-', '+'].includes(marker(line))
const isOrdered = (line: string): boolean => /^\d+[.)]$/.test(marker(line))
applyBlock('bullet')
assert(isBullet(firstLine()) && body(firstLine()) === 'para one', `bullet wraps: ${firstLine()}`)
applyBlock('ordered')
assert(isOrdered(firstLine()) && body(firstLine()) === 'para one', `ordered converts in place: ${firstLine()}`)
applyBlock('task')
assert(isBullet(firstLine()) && firstLine().includes('[ ]'), `task list: ${firstLine()}`)
applyBlock('task')
assert(isBullet(firstLine()) && !firstLine().includes('[ ]'), `task off keeps the bullet: ${firstLine()}`)
applyBlock('plain')
assert(firstLine() === 'para one', `plain leaves the list: ${firstLine()}`)
applyBlock('ordered')
applyBlock('bullet')
assert(isBullet(firstLine()), `ordered -> bullet back: ${firstLine()}`)
// 列表行上套引用/代码块：先脱列表再套，否则 schema 不允许静默失败
applyBlock('quote')
assert(firstLine() === '> para one', `quote from a list line: ${firstLine()}`)
applyBlock('quote')
applyBlock('bullet')
applyBlock('codeBlock')
assert(firstLine() === '```', `code block from a list line: ${firstLine()}`)
applyBlock('codeBlock')
applyBlock('bullet')
applyBlock('h2')
assert(firstLine() === '## para one', `heading from a list line: ${firstLine()}`)
// eslint-disable-next-line no-console
applyBlock('plain')
assert(firstLine() === 'para one', `heading -> plain: ${firstLine()}`)
applyBlock('codeBlock')
assert(firstLine() === '```', `code block opens: ${firstLine()}`)
assert(adapter.getValue().includes('para one'), 'code block keeps content')
applyBlock('codeBlock')
assert(firstLine() === 'para one', `code block toggles off: ${firstLine()}`)

// ---- task list checkbox: CSS-drawn box + click toggles -------------------
adapter.setValue('- [ ] todo one\n- [x] todo two')
await new Promise((r) => setTimeout(r, 80))
const taskItems = root.querySelectorAll('li[data-item-type="task"]')
assert(taskItems.length === 2, `task items rendered: ${taskItems.length}`)
assert(taskItems[0]?.getAttribute('data-checked') === 'false', 'first item unchecked')
assert(taskItems[1]?.getAttribute('data-checked') === 'true', 'second item checked')
taskItems[0]?.dispatchEvent(
  new window.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 6, clientY: 6 }),
)
await new Promise((r) => setTimeout(r, 40))
const taskLine = (checked: boolean, text: string): boolean =>
  adapter
    .getValue()
    .split('\n')
    .some((line) => new RegExp(`^[*+-] \\[${checked ? 'x' : ' '}\\] ${text}$`).test(line))
assert(taskLine(true, 'todo one'), `clicking the box checks the item: ${adapter.getValue()}`)
taskItems[1]?.dispatchEvent(
  new window.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 6, clientY: 6 }),
)
await new Promise((r) => setTimeout(r, 40))
assert(taskLine(false, 'todo two'), `clicking again unchecks: ${adapter.getValue()}`)
// Clicking the *text* (right of the drawn box) must not toggle.
root
  .querySelector('li[data-item-type="task"] p')
  ?.dispatchEvent(
    new window.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 120, clientY: 6 }),
  )
await new Promise((r) => setTimeout(r, 40))
assert(taskLine(true, 'todo one'), 'text clicks leave the box alone')

adapter.unmount()

console.log(
  'SMOKE WYSIWYG DIAGRAM OK: widget draw/click-to-source/cursor-leave/serialize + math widget click-to-edit + live math while caret inside + task-list/outline anchors + selection range round-trip + native block formats + table toolbar/guards/align/move/delete',
)
process.exit(0)

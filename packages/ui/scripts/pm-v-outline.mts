/**
 * Smoke: 大纲浮窗.
 *
 * The only part with real logic is which heading the caret is "in": the panel
 * highlights it, so an off-by-one there points the reader at the wrong section.
 * Offsets come from the same `extractOutline` the sidebar uses, so the test
 * feeds it real markdown rather than hand-built items.
 */

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
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })

const { createOutlinePanel, activeOutlineIndex, visibleOutlineIndices, hasNestedHeadings } =
  await import('../src/ui/outlinePanel')
const { extractOutline, filterOutlineLevel } = await import('../src/outline')

const md = ['# 一', '', '正文', '', '## 二', '', '正文', '', '## 三', '', '正文'].join('\n')
const items = extractOutline(md)
assert(items.length === 3, `three headings: ${items.length}`)

// ---- which heading the caret is under --------------------------------------
{
  // Before the first heading: nothing is active.
  assert(activeOutlineIndex(items, 0) === 0, 'offset 0 is inside the first heading')
  assert(activeOutlineIndex(items, items[0]!.offset - 1) === -1, 'before it, nothing is active')
  assert(activeOutlineIndex(items, null) === -1, 'no caret means nothing is active')
  assert(activeOutlineIndex([], 100) === -1, 'an empty outline has nothing to highlight')
  // Exactly on a heading switches to it — `<=`, so the heading itself counts.
  assert(activeOutlineIndex(items, items[1]!.offset) === 1, 'on the second heading')
  assert(activeOutlineIndex(items, items[1]!.offset - 1) === 0, 'just before it, still the first')
  assert(activeOutlineIndex(items, 10_000) === items.length - 1, 'past the end, the last one')
}

// ---- the panel -------------------------------------------------------------
{
  const selected: string[] = []
  const panel = createOutlinePanel((item) => selected.push(item.text))
  document.getElementById('app')?.appendChild(panel.el)
  assert(!panel.visible, 'starts hidden')
  panel.open()
  assert(panel.visible, 'open() shows it')
  panel.toggle()
  assert(!panel.visible, 'toggle() hides it')
  panel.toggle()

  const empty = panel.el.querySelector('.outline-panel__empty')
  assert(empty, 'has an empty state')
  // Before any update there is nothing rendered, so the empty state shows.
  assert(empty.hidden === false, 'starts showing the empty state')

  panel.update(items)
  assert(empty.hidden === true, 'a non-empty outline hides the empty state')
  const buttons = [...panel.el.querySelectorAll<HTMLButtonElement>('.outline-panel__item')]
  assert(buttons.length === 3, `one button per heading: ${buttons.length}`)
  assert(buttons.map((b) => b.textContent).join(',') === '一,二,三', 'in document order')

  // Level → indent, so the hierarchy is visible.
  const indent = (index: number): number => Number.parseFloat(buttons[index]!.style.paddingLeft)
  assert(indent(0) < indent(1), `an h2 is indented past an h1: ${indent(0)} vs ${indent(1)}`)
  assert(indent(1) === indent(2), 'same level, same indent')

  // Clicking is how the panel navigates.
  buttons[1]!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  assert(selected.join(',') === '二', `click selects: ${selected.join(',')}`)

  // Active tracking.
  panel.setActive(items[2]!.offset)
  assert(buttons[2]!.classList.contains('is-active'), 'the third is marked active')
  assert(!buttons[0]!.classList.contains('is-active'), 'and the first is not')
  panel.setActive(null)
  assert(
    buttons.every((b) => !b.classList.contains('is-active')),
    'a null offset clears the highlight',
  )

  // Re-rendering drops stale active state with the old buttons.
  panel.update(items.slice(0, 2))
  const after = [...panel.el.querySelectorAll('.outline-panel__item')]
  assert(after.length === 2, 're-render replaces the list')
  assert(after.every((b) => !b.classList.contains('is-active')), 'and no stale highlight survives')

  // An outline with nothing in it shows the empty state instead of a blank box.
  panel.update([])
  assert(empty.hidden === false, 'an empty outline shows the empty state')
}

// ---- collapsing ------------------------------------------------------------
{
  const nested = extractOutline(
    ['# 一', '', '## 一甲', '', '### 一甲A', '', '## 一乙', '', '# 二', '', '## 二甲'].join('\n'),
  )
  const levels = nested.map((item) => item.level).join(',')
  assert(levels === '1,2,3,2,1,2', `fixture shape: ${levels}`)

  const none = new Set<number>()
  assert(
    visibleOutlineIndices(nested, none).length === nested.length,
    'nothing collapsed shows everything',
  )
  // Collapsing `# 一` hides `## 一甲`, `### 一甲A` and `## 一乙`, but not `# 二`.
  assert(
    visibleOutlineIndices(nested, new Set([0])).join(',') === '0,4,5',
    `collapsing an h1 hides its subtree: ${visibleOutlineIndices(nested, new Set([0])).join(',')}`,
  )
  // Collapsing the h2 hides only the h3 under it.
  assert(
    visibleOutlineIndices(nested, new Set([1])).join(',') === '0,1,3,4,5',
    'collapsing an h2 hides just its children',
  )
  assert(hasNestedHeadings(nested, 0), 'an h1 followed by an h2 has children')
  assert(!hasNestedHeadings(nested, 2), 'an h3 followed by an h2 does not')
  assert(!hasNestedHeadings(nested, nested.length - 1), 'the last item never has children')

  // ---- the panel ----
  const panel = createOutlinePanel(() => undefined)
  document.getElementById('app')?.appendChild(panel.el)
  panel.update(nested)
  const rows = (): HTMLElement[] => [...panel.el.querySelectorAll<HTMLElement>('.outline-panel__row')]
  const twisty = (n: number): HTMLButtonElement | null =>
    rows()[n]?.querySelector<HTMLButtonElement>('button.outline-panel__twisty') ?? null
  assert(rows().length === nested.length, 'all six rows render')
  // Only headings with children get a clickable twisty.
  assert(twisty(0) && twisty(1), 'nested headings have a twisty')
  assert(twisty(2) === null, 'a leaf has none')
  assert(rows()[2]!.querySelector('.outline-panel__twisty--empty'), 'a leaf keeps the alignment spacer')

  twisty(0)!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  assert(rows().length === 3, `clicking a twisty collapses the subtree: ${rows().length}`)
  assert(twisty(0)!.getAttribute('aria-expanded') === 'false', 'and reports it')
  twisty(0)!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  assert(rows().length === nested.length, 'clicking again expands it')

  const action = (label: string): HTMLButtonElement => {
    const found = [...panel.el.querySelectorAll<HTMLButtonElement>('.outline-panel__action')].find(
      (b) => b.textContent === label,
    )
    assert(found, `the ${label} action exists`)
    return found
  }
  action('折叠').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  // Collapse-all leaves only the top-level headings: `# 一` swallows its whole
  // subtree and `## 二甲` goes with `# 二`.
  assert(rows().length === 2, `全部折叠 leaves the h1s: ${rows().length}`)
  action('展开').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  assert(rows().length === nested.length, '全部展开 restores everything')

  // A different document must not inherit the previous one's collapsed indices —
  // the same index would mean a different heading.
  twisty(0)!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  panel.update([{ text: 'x', level: 1, offset: 0, line: 1 }])
  assert(rows().length === 1, 'the new outline renders fully')
}

// ---- 目录显示的标题层数 ----------------------------------------------------
{
  const nested = extractOutline(
    ['# 一', '', '## 二', '', '### 三', '', '#### 四', '', '## 五'].join('\n'),
  )
  assert(nested.map((i) => i.level).join(',') === '1,2,3,4,2', 'fixture levels')
  // 0 means every level — the default, so an absent setting changes nothing.
  assert(filterOutlineLevel(nested, 0).length === nested.length, '0 shows everything')
  assert(filterOutlineLevel(nested, 2).length === 3, '到二级 keeps h1 and h2 only')
  assert(filterOutlineLevel(nested, 1).length === 1, '仅一级标题')
  assert(filterOutlineLevel(nested, 9).length === nested.length, 'a level beyond the range is harmless')
  // Levels are NOT renumbered: an h3 under a filtered-out h2 stays an h3, so it
  // still indents like one instead of taking its parent's place.
  assert(filterOutlineLevel(nested, 4)[2]!.level === 3, 'levels survive the filter')
  assert(
    filterOutlineLevel(nested, 2).every((item) => item.level <= 2),
    'and nothing deeper slips through',
  )
  assert(filterOutlineLevel([], 2).length === 0, 'an empty outline stays empty')
}

console.log('SMOKE UI OUTLINE OK: caret→heading + indent by level + click-to-jump + active tracking')

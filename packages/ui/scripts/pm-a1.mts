function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const { extractOutline, countStats } = await import('../src/outline')
const { CommandRegistry, shortcutFromEvent, formatShortcut } = await import('../src/commands')

const md = [
  '# 一级',
  '',
  '正文',
  '',
  '## 二级',
  '',
  '```',
  '# 围栏内的假标题',
  '```',
  '',
  '### 三级',
  '',
].join('\n')

const outline = extractOutline(md)
assert(outline.length === 3, `outline length: ${outline.length}`)
assert(outline[0]?.text === '一级' && outline[0]?.level === 1, 'h1')
assert(outline[1]?.text === '二级' && outline[1]?.level === 2, 'h2')
assert(outline[2]?.text === '三级' && outline[2]?.level === 3, 'h3')
assert(md.slice(outline[1]!.offset).startsWith('## 二级'), 'h2 offset points at heading')

const stats = countStats('hello world\n中文测试')
assert(stats.lines === 2, `lines: ${stats.lines}`)
assert(stats.chars === 'hello world\n中文测试'.length, 'chars')
assert(stats.words === 6, `words: ${stats.words}`)

const empty = countStats('')
assert(empty.lines === 1 && empty.words === 0 && empty.chars === 0, 'empty stats')

const registry = new CommandRegistry()
let saves = 0
registry.register({ id: 'file.save', label: '保存', shortcut: 'Mod+S', run: () => (saves += 1) })
registry.register({ id: 'view.source', label: '源码', shortcut: 'Mod+Alt+2', run: () => undefined })
assert(registry.list().length === 2, 'registry list')
registry.run('file.save')
assert(saves === 1, 'registry run')

const mkEvent = (init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent =>
  ({ isComposing: false, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...init }) as KeyboardEvent

assert(shortcutFromEvent(mkEvent({ key: 's', ctrlKey: true })) === 'Mod+S', 'Mod+S')
assert(shortcutFromEvent(mkEvent({ key: 'S', ctrlKey: true, shiftKey: true })) === 'Mod+Shift+S', 'Mod+Shift+S')
assert(shortcutFromEvent(mkEvent({ key: '2', ctrlKey: true, altKey: true })) === 'Mod+Alt+2', 'Mod+Alt+2')
assert(shortcutFromEvent(mkEvent({ key: 's' })) === null, 'no mod')
assert(shortcutFromEvent(mkEvent({ key: 's', ctrlKey: true, isComposing: true })) === null, 'ime composing')

assert(formatShortcut('Mod+S').length > 0, 'format non-empty')
assert(formatShortcut(undefined) === '', 'format empty')

const fmMd = ['---', 'title: FM', 'author: x', '---', '', '# Real', '', 'body', ''].join('\n')
const fmOutline = extractOutline(fmMd)
assert(fmOutline.length === 1, `frontmatter outline length: ${fmOutline.length}`)
assert(fmOutline[0]?.text === 'Real', 'frontmatter heading skipped')
assert(fmMd.slice(fmOutline[0]!.offset).startsWith('# Real'), 'fm outline offset')

console.log('SMOKE UI A1 OK: outline/fence/stats/registry/shortcuts/frontmatter')

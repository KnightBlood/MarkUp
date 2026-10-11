/**
 * Smoke: 格式化表格源码.
 *
 * Alignment is a property of the rendered text, not of the string length — a
 * CJK character occupies two cells. Padding by `.length` produces a table that
 * looks ragged in exactly the documents this feature exists for, so the wide
 * cases are the ones worth pinning.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const { formatTableSource, splitRow, displayWidth } = await import('../src/tableFormat')

const format = (md: string, at = 0): string | null => {
  const edit = formatTableSource(md, { from: at, to: at })
  return edit ? md.slice(0, edit.range.from) + edit.text + md.slice(edit.range.to) : null
}

// ---- widths ----------------------------------------------------------------
assert(displayWidth('abc') === 3, 'latin is one cell each')
assert(displayWidth('中文') === 4, 'CJK is two cells each')
assert(displayWidth('a中b') === 4, 'mixed')
assert(displayWidth('') === 0, 'empty is zero')
// An emoji is wide too; counting it as one would shift the whole column.
assert(displayWidth('😀') === 2, 'emoji counts as wide')

// ---- row splitting ---------------------------------------------------------
assert(splitRow('| a | b |').join(',') === 'a,b', 'outer pipes are not cells')
assert(splitRow('a | b').join(',') === 'a,b', 'outer pipes are optional')
assert(splitRow('| a | b').join(',') === 'a,b', 'only a leading pipe')
assert(splitRow('|a|b|').join(',') === 'a,b', 'pipes need no spaces')
// An escaped pipe is content, not a separator.
assert(splitRow('| a \\| b | c |').join(',') === 'a \\| b,c', 'escaped pipe stays in its cell')
assert(splitRow('|  | x |').join(',') === ',x', 'an empty cell is kept')

// ---- formatting ------------------------------------------------------------
{
  const md = ['|a|bb|', '|---|---|', '|ccc|d|'].join('\n')
  const out = format(md)
  assert(out, 'formats a table')
  assert(
    out === ['| a   | bb |', '| --- | --- |', '| ccc | d  |'].join('\n'),
    `aligned:\n${out}`,
  )
}
{
  // CJK columns: `中文` is four cells, so its column is four wide, not two.
  const md = ['| 名称 | v |', '| --- | --- |', '| 中文 | x |'].join('\n')
  const out = format(md)!
  const lines = out.split('\n')
  assert(displayWidth(lines[0]!) === displayWidth(lines[2]!), 'every row has the same width')
  assert(lines[0]!.includes('名称'), 'the header is untouched apart from padding')
}
{
  // Alignment markers survive, and the delimiter widens with its column.
  const md = ['| a | b | c |', '|:--|:-:|--:|', '| longer | mid | x |'].join('\n')
  const out = format(md)!
  const delimiter = out.split('\n')[1]!
  assert(delimiter.includes(':'), 'left alignment kept')
  assert(/:\s*-+\s*:/.test(delimiter), `centre alignment kept: ${delimiter}`)
  assert(/-\s*:/.test(delimiter), `right alignment kept: ${delimiter}`)
  const cells = splitRow(delimiter)
  assert(cells[0]!.startsWith(':') && !cells[0]!.endsWith(':'), 'first stays left-aligned')
  assert(cells[1]!.startsWith(':') && cells[1]!.endsWith(':'), 'second stays centred')
  assert(!cells[2]!.startsWith(':') && cells[2]!.endsWith(':'), 'third stays right-aligned')
}
{
  // Ragged rows are padded out to the widest column count.
  const md = ['| a | b | c |', '| --- | --- | --- |', '| 1 | 2 |'].join('\n')
  const out = format(md)!
  assert(out.split('\n')[2] === '| 1 | 2 |   |', `short row is padded: ${out.split('\n')[2]}`)
}
{
  // Already aligned → no edit, so the document is not dirtied. The fixture is the
  // formatter's own canonical output; anything wider is not yet formatted.
  const md = ['| a | b |', '| --- | --- |', '| c | d |'].join('\n')
  assert(format(md) === null, 'an aligned table is a no-op')
}
{
  // Not a table at all.
  assert(format('just a paragraph') === null, 'a paragraph is not a table')
  assert(format('| a | b |') === null, 'a single row is not a table')
  assert(format(['| a | b |', '| nope | --- |'].join('\n')) === null, 'no delimiter row')
}
{
  // A caret anywhere in the block formats the whole block.
  const md = ['text', '', '|a|b|', '|---|---|', '|cc|d|', '', 'after'].join('\n')
  const out = format(md, md.indexOf('d|'))!
  assert(out.includes('| a  | b |'), `formatted from inside the block:\n${out}`)
  assert(out.startsWith('text\n\n'), 'surrounding text untouched')
  assert(out.endsWith('\nafter'), 'and the text after it')
}

console.log('SMOKE CORE TABLE FORMAT OK: display width(CJK/emoji) + escaped pipes + alignment + padding')

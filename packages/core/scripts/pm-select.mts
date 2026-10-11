/**
 * Smoke: 选中当前行/词/句/块 and 跳转.
 *
 * These all speak in markdown offsets, so the ranges have to be right in both
 * directions: a range that runs one character long selects the space after a
 * word on the next click, and a "sentence" that swallows a leading newline ruins
 * the next replacement. CJK matters here too — Chinese has no spaces, so the
 * word scanner has to treat a whole non-ASCII run as one word or double-click
 * would select a single character.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const { selectScope, lineRangeAt, documentEdge, lineEdge } = await import('../src/textFormat')

const slice = (md: string, range: { from: number; to: number } | null): string | null =>
  range ? md.slice(range.from, range.to) : null

// ---- line ------------------------------------------------------------------
{
  const md = 'one\ntwo\nthree'
  assert(slice(md, lineRangeAt(md, 0)) === 'one', 'first line')
  assert(slice(md, lineRangeAt(md, 5)) === 'two', 'the line the offset is on')
  assert(slice(md, lineRangeAt(md, 12)) === 'three', 'last line, no trailing newline')
  assert(slice(md, lineRangeAt(md, 999)) === 'three', 'an out-of-range offset clamps')
  assert(slice(md, lineRangeAt(md, 3)) === 'one', 'a caret on the line break belongs to the line')
  assert(lineRangeAt('', 0) === null, 'empty document has no line')
}

// ---- word ------------------------------------------------------------------
{
  const md = 'alpha beta, gamma'
  assert(slice(md, selectScope(md, 2, 'word')) === 'alpha', 'word at the caret')
  assert(slice(md, selectScope(md, 6, 'word')) === 'beta', 'second word')
  assert(slice(md, selectScope(md, 10, 'word')) === 'beta', 'punctuation steps back to the word')
  assert(slice(md, selectScope(md, 11, 'word')) === 'beta', 'a caret in the gap prefers the word it left')
  assert(slice(md, selectScope(md, 13, 'word')) === 'gamma', 'after the space')
  assert(slice(md, selectScope('   ', 1, 'word')) === null, 'whitespace has no word')
}
{
  // CJK: no spaces, so a run of characters is one word.
  const md = '这是中文文本'
  assert(slice(md, selectScope(md, 2, 'word')) === md, 'a CJK run is one word')
  const mixed = 'abc 中文 def'
  assert(slice(mixed, selectScope(mixed, 6, 'word')) === '中文', 'a CJK run inside latin text')
}

// ---- sentence --------------------------------------------------------------
{
  const md = 'First sentence. Second one here! Third'
  assert(slice(md, selectScope(md, 3, 'sentence')) === 'First sentence.', 'first sentence')
  assert(slice(md, selectScope(md, 18, 'sentence')) === 'Second one here!', 'second sentence')
  assert(slice(md, selectScope(md, 40, 'sentence')) === 'Third', 'a trailing sentence with no terminator')
}
{
  // The terminator belongs to the sentence before it, and the leading space is
  // never part of the next one.
  const md = 'A. B'
  assert(slice(md, selectScope(md, 3, 'sentence')) === 'B', 'leading space trimmed')
}
{
  // Full-width terminators are what CJK documents actually use.
  const md = '第一句。第二句！第三句'
  assert(slice(md, selectScope(md, 1, 'sentence')) === '第一句。', 'full-width period ends it')
  assert(slice(md, selectScope(md, 6, 'sentence')) === '第二句！', 'full-width bang ends it')
}
{
  // A sentence never spans a blank line: that would make it a paragraph.
  const md = 'one\n\ntwo'
  assert(slice(md, selectScope(md, 0, 'sentence')) === 'one', 'stops at the blank line')
}

// ---- block -----------------------------------------------------------------
{
  const md = 'para one\nline two\n\npara two\nmore'
  assert(slice(md, selectScope(md, 2, 'block')) === 'para one\nline two', 'the whole paragraph')
  assert(slice(md, selectScope(md, 20, 'block')) === 'para two\nmore', 'the second paragraph')
  // A caret on the blank line itself selects that line rather than a neighbour —
  // the command still has to do something visible. (Offset 18 is the blank
  // line's own newline: a newline belongs to the line it terminates.)
  assert(slice(md, selectScope(md, 18, 'block')) === '', 'blank line selects itself')
}

// ---- jump ------------------------------------------------------------------
{
  const md = 'one\ntwo'
  assert(documentEdge(md, 'start').from === 0, '文首')
  assert(documentEdge(md, 'end').from === md.length, '文末')
  assert(lineEdge(md, 5, 'start').from === 4, '行首')
  assert(lineEdge(md, 5, 'end').from === md.length, '行尾')
  // A collapsed range at either edge: a jump moves the caret, it selects nothing.
  assert(lineEdge(md, 5, 'start').to === lineEdge(md, 5, 'start').from, 'jump collapses the range')
}

console.log('SMOKE CORE SELECT OK: line/word(CJK)/sentence(。！)/block + 跳转 edges')

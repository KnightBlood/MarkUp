/**
 * Smoke: 智能输入 — 智能引号 / 智能破折号 / 成对的符号.
 *
 * The three ways this breaks are all invisible until a user hits them: a closer
 * that doubles up instead of being stepped over (`))`), a dash rule that needs
 * to delete but only reports an insert (leaving `---`), and a quote that opens
 * where it should close (every nested quote becomes `“…”` instead of `“…”`).
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const { smartInput, smartInputEdit, SMART_INPUT_OFF } = await import('../src/smartInput')

const all = { smartQuotes: true, smartDashes: true, pairedSymbols: true } as const
const pairsOnly = { smartQuotes: false, smartDashes: false, pairedSymbols: true } as const

/** `before` + (what gets inserted) + `after`, for readable assertions. */
const type = (
  before: string,
  text: string,
  options: typeof all | typeof pairsOnly | typeof SMART_INPUT_OFF,
  after = '',
  hasSelection = false,
) => smartInput({ before, after, text, hasSelection }, options)

// ---- everything off is a no-op --------------------------------------------
// "No rule applies" means the typed character still goes in — an empty result
// would silently swallow every keystroke.
for (const [before, ch] of [
  ['', '"'],
  ['(', ')'],
  ['a', '-'],
  ['..', '.'],
  ['a', 'x'],
] as const) {
  const r = type(before, ch, SMART_INPUT_OFF)
  assert(r.text === ch, `off inserts what was typed (${ch})`)
  assert(r.deleteBefore === 0, `off deletes nothing (${ch})`)
  assert(r.caretOffset === ch.length, `caret after the character (${ch})`)
  assert(!r.wrap, `off never wraps (${ch})`)
}

// ---- 成对的符号 ------------------------------------------------------------
{
  const r = type('', '(', pairsOnly)
  assert(r.text === '()', `opener inserts both: ${r.text}`)
  // The caret lands between them — `caretOffset` counts from the insertion point.
  assert(r.caretOffset === 1, `caret inside the pair: ${r.caretOffset}`)
  assert(type('', '[', pairsOnly).text === '[]', 'bracket')
  assert(type('', '{', pairsOnly).text === '{}', 'brace')
  assert(type('', '（', pairsOnly).text === '（）', 'full-width paren')
  assert(type('', '《', pairsOnly).text === '《》', 'book title marks')
  // Typing the closer right before the one we inserted steps over it.
  const over = type('(', ')', all, ')')
  assert(over.text === '', 'the closer is not inserted again')
  assert(over.caretOffset === 1, 'the caret moves past it')
  // …but a closer with something else after it is a normal character.
  const notOver = type('(', ')', all, 'x')
  assert(notOver.text === ')', 'no stepping over unrelated text')
  assert(notOver.caretOffset === 1, 'and the closer is just typed')
}

// ---- 智能破折号 ------------------------------------------------------------
{
  const em = type('a-', '-', all)
  assert(em.text === '—', `-- becomes an em dash: ${em.text}`)
  // It has to delete the first hyphen, or the document ends up with `-—`.
  assert(em.deleteBefore === 1, `and removes the one already typed: ${em.deleteBefore}`)
  assert(em.caretOffset === 1, 'caret after the dash')

  const ellipsis = type('a..', '.', all)
  assert(ellipsis.text === '…', `... becomes an ellipsis: ${ellipsis.text}`)
  assert(ellipsis.deleteBefore === 2, `and removes both dots: ${ellipsis.deleteBefore}`)

  // A single hyphen or dot is left alone (inserted as typed).
  assert(type('a', '-', all).text === '-', 'one hyphen is not a dash')
  assert(type('a.', '.', all).text === '.', 'two dots are not an ellipsis')
  // Dash rules must not fire when off.
  assert(type('a-', '-', pairsOnly).text === '-', 'dashes off')
}

// ---- 智能引号 --------------------------------------------------------------
{
  // Opening positions: start of input, after whitespace, after an opener.
  assert(type('', '"', all).text === '“”', 'at the start it opens and pairs')
  assert(type('a ', '"', all).text === '“”', 'after a space it opens')
  assert(type('(', '"', all).text === '“”', 'after an opener it opens')
  // Closing position: right after a word.
  assert(type('a', '"', all).text === '”', 'after a word it closes')
  assert(type('a', '"', all).caretOffset === 1, 'closing quote does not pair')
  assert(type('a', "'", all).text === '’', 'single quote closes too')
  assert(type('', "'", all).text === '‘’', 'and opens at the start')
  // Full-width quotes in CJK text behave the same way.
  assert(type('中文', '"', all).text === '”', 'CJK word then a closing quote')
}
{
  // A quote with a selection asks the caller to wrap it — this module has no
  // access to the selected text.
  const r = type('a', '"', all, '', true)
  assert(r.wrap, 'a selection is wrapped, not replaced')
  assert(r.wrap?.open === '“' && r.wrap?.close === '”', `curly pair: ${JSON.stringify(r.wrap)}`)
  assert(r.text === '', 'and nothing is inserted by this module')
  // …including when pairing is off: 智能引号 alone still asks for the wrap.
  const curlyOnly = { smartQuotes: true, smartDashes: false, pairedSymbols: false } as const
  assert(type('a', '"', curlyOnly, '', true).wrap, '智能引号 alone wraps')
  // But with every rule off, a selection is left to the editor.
  const pairsOff = type('a', '"', SMART_INPUT_OFF, '', true)
  assert(!pairsOff.wrap, 'no rule means no wrap')
}
{
  // Quotes stay as typed when 智能引号 is off, but pairing still applies.
  assert(type('', '"', pairsOnly).text === '""', 'off means straight quotes, still paired')
  assert(type('a', '"', pairsOnly).text === '"', 'and a closing one is not doubled up')
}
{
  // Backticks pair (code spans) but are never curled.
  assert(type('', '`', all).text === '``', 'backtick pairs')
  assert(type('a', '`', all, '`').text === '', 'and steps over its closer')
}

// ---- smartInputEdit: the offset arithmetic each view would otherwise repeat ----
{
  // Typing the second `-`: the document is `a-b` and the caret is at 2, so
  // `deleteBefore: 1` has to reach back over the hyphen that is already there.
  const md = 'a-b'
  const r = smartInput({ before: '-', after: 'b', text: '-', hasSelection: false }, all)
  const edit = smartInputEdit(r, { from: 2, to: 2 }, '')
  assert(edit.from === 1, `dash edit reaches back one: ${edit.from}`)
  assert(edit.insert === '—', 'and inserts the em dash')
  assert(md.slice(0, edit.from) + edit.insert + md.slice(edit.to) === 'a—b', 'the result is `a—b`')
  assert(edit.caret === 2, `caret after the dash: ${edit.caret}`)
}
{
  // The ellipsis reaches back two, so `before` has to be a slice.
  const md = 'a..'
  const r = smartInput({ before: '..', after: '', text: '.', hasSelection: false }, all)
  const edit = smartInputEdit(r, { from: 3, to: 3 }, '')
  assert(md.slice(0, edit.from) + edit.insert + md.slice(edit.to) === 'a…', 'the result is `a…`')
}
{
  // Pairing keeps the caret between.
  const r = smartInput({ before: '', after: '', text: '(', hasSelection: false }, all)
  const edit = smartInputEdit(r, { from: 0, to: 0 }, '')
  assert(edit.insert === '()' && edit.caret === 1, `caret sits inside: ${edit.caret}`)
}
{
  // Wrapping a selection splices the text inside the pair and puts the caret
  // after the closer, so the user can keep typing.
  const r = smartInput({ before: 'a', after: '', text: '"', hasSelection: true }, all)
  const edit = smartInputEdit(r, { from: 2, to: 5 }, 'xyz')
  assert(edit.insert === '“xyz”', `wrapped: ${edit.insert}`)
  assert(edit.caret === 7, `caret after the pair: ${edit.caret}`)
}

console.log('SMOKE CORE SMART INPUT OK: pairs/step-over + dashes(with delete) + quotes(open/close/CJK)')

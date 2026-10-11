/**
 * Smoke: 保存时规范化 — 默认换行符 and 保存时在文末添加空行.
 *
 * Applied on the way to disk, never to the buffer, because rewriting the text
 * under the caret would move the selection in every view. The subtle parts are
 * the ones that look like nothing: an empty document must not gain a newline
 * (that turns "no content" into "a blank line"), and the terminator added at the
 * end has to match the chosen style or exactly one line disagrees with the rest.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const { normalizeForSave } = await import('../src/saveText')

const preserve = { lineEnding: 'preserve', finalNewline: false } as const
const lf = { lineEnding: 'lf', finalNewline: false } as const
const crlf = { lineEnding: 'crlf', finalNewline: false } as const

// ---- nothing asked for -----------------------------------------------------
assert(normalizeForSave('a\r\nb', preserve) === 'a\r\nb', 'preserve is a no-op')
assert(normalizeForSave('a\nb', preserve) === 'a\nb', 'preserve keeps LF too')

// ---- line endings ----------------------------------------------------------
assert(normalizeForSave('a\r\nb\r\n', lf) === 'a\nb\n', 'CRLF → LF')
assert(normalizeForSave('a\nb', crlf) === 'a\r\nb', 'LF → CRLF')
// Mixed input has to end up uniformly one style, or the setting only half works.
assert(normalizeForSave('a\r\nb\nc\rd', lf) === 'a\nb\nc\nd', 'mixed → LF')
assert(normalizeForSave('a\nb\r\nc', crlf) === 'a\r\nb\r\nc', 'mixed → CRLF')
// A lone CR is an old-Mac line ending and still counts as one.
assert(normalizeForSave('a\rb', lf) === 'a\nb', 'a lone CR is a line ending')

// ---- final newline ---------------------------------------------------------
const lfFinal = { lineEnding: 'lf', finalNewline: true } as const
const crlfFinal = { lineEnding: 'crlf', finalNewline: true } as const
assert(normalizeForSave('a', lfFinal) === 'a\n', 'adds a trailing newline')
assert(normalizeForSave('a\n', lfFinal) === 'a\n', 'does not double an existing one')
assert(normalizeForSave('a\n\n', lfFinal) === 'a\n\n', 'nor trim extra blank lines')
// The terminator has to match the chosen style.
assert(normalizeForSave('a', crlfFinal) === 'a\r\n', 'CRLF style terminates with CRLF')
assert(normalizeForSave('a\r\n', crlfFinal) === 'a\r\n', 'and recognises CRLF as present')
// A CRLF document under `preserve` + finalNewline: the existing CRLF counts, so
// nothing is appended with the wrong ending.
assert(
  normalizeForSave('a\r\n', { lineEnding: 'preserve', finalNewline: true }) === 'a\r\n',
  'preserve still recognises an existing terminator',
)
assert(
  normalizeForSave('a', { lineEnding: 'preserve', finalNewline: true }) === 'a\n',
  'and appends LF when it has to guess',
)

// ---- empty -----------------------------------------------------------------
assert(normalizeForSave('', lfFinal) === '', 'an empty document stays empty')
assert(normalizeForSave('', crlf) === '', 'empty under CRLF too')

// ---- idempotent ------------------------------------------------------------
for (const options of [preserve, lf, crlf, lfFinal, crlfFinal]) {
  for (const input of ['', 'a', 'a\n', 'a\r\n', 'a\nb\r\n']) {
    const once = normalizeForSave(input, options)
    const twice = normalizeForSave(once, options)
    assert(once === twice, `normalising twice must be a no-op for ${JSON.stringify(input)}`)
  }
}

console.log('SMOKE CORE SAVE OK: line endings (mixed/lone CR) + final newline + empty + idempotent')

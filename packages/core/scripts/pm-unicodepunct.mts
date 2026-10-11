/**
 * Smoke: 解析时识别 Unicode 标点.
 *
 * Two things are easy to get wrong and both are silent: remapping ordinary prose
 * punctuation (which changes the document rather than helping it parse), and
 * remapping an *escaped* character (which removes the only way a user has to ask
 * for a literal one).
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const { remapUnicodePunctuation, PUNCTUATION_REMAP } = await import('../src/unicodePunct')

const remap = (input: string): string => remapUnicodePunctuation(input)

// ---- the documented cases ----------------------------------------------
// A link title that smart punctuation or an IME left as Unicode quotes.
assert(remap('![link](url “title”)') === '![link](url "title")', 'curly quotes become a title')
assert(remap('![link](url «title»)', 'x') !== '', 'guillemets are mapped')
assert(remap('![link](url «title»)') === '![link](url "title")', 'guillemets become a title')
// `》` is how a CJK keyboard produces a blockquote.
assert(remap('》 引用') === '> 引用', 'the CJK bracket becomes a blockquote marker')
// Full-width forms of the punctuation markdown is built from.
assert(remap('＃ 标题') === '# 标题', 'full-width hash')
assert(remap('＊强调＊') === '*强调*', 'full-width asterisk')
assert(remap('－ 项目') === '- 项目', 'full-width hyphen')
assert(remap('｜ 甲 ｜ 乙 ｜') === '| 甲 | 乙 |', 'full-width pipe makes a table')
assert(
  remap('－ ＊ － ＊ ＊') === '- * - * *',
  'a mix of full-width markers is usable markdown',
)

// ---- what must NOT change ------------------------------------------------
// Prose punctuation has no ASCII meaning to map onto; rewriting it would change
// the text rather than help it parse.
assert(remap('你好，世界。') === '你好，世界。', 'a full-width comma and stop are left alone')
assert(remap('他说："好"') === '他说:"好"', 'quotes and the CJK colon are mapped')
assert(remap('（一）') === '(一)', 'full-width parens map, their contents do not')
// An escape is an explicit request for the literal character.
assert(remap('\\》 引用') === '\\》 引用', 'an escaped bracket is left alone')
assert(remap('\\“引号”') === '\\“引号"', 'an escaped quote keeps its backslash and stays curly')
// A backslash at the very end has nothing to escape and must survive.
assert(remap('abc\\') === 'abc\\', 'a trailing backslash survives')
// Ordinary text is untouched.
assert(remap('plain text') === 'plain text', 'plain text')
assert(remap('') === '', 'empty')
assert(remap('\n\n') === '\n\n', 'newlines')

// ---- round trip and idempotence -----------------------------------------
{
  // Everything in the table maps to something *outside* the table, so a second
  // pass is a no-op — otherwise a re-render could keep rewriting.
  for (const [from, to] of Object.entries(PUNCTUATION_REMAP)) {
    const once = remap(from)
    assert(once === to, `${from} → ${to}`)
    assert(remap(once) === once, `${from} is stable`)
  }
  assert(!(Object.keys(PUNCTUATION_REMAP) as string[]).includes('，'), 'the CJK comma is not in the table')
}
{
  const sample = '》 “甲” ＃＊－｜'
  const once = remap(sample)
  assert(remap(once) === once, 'the whole remap is idempotent')
}

console.log('SMOKE CORE UNICODE PUNCT OK: syntax forms remapped + prose/escapes untouched + idempotent')

/**
 * Smoke: Emoji 自动补全.
 *
 * The rule rides the *existing* smart-input hook, so what it has to get right is
 * the offset arithmetic: the closing colon is the character being typed, and the
 * opening colon plus the name have to come out of the document. An emoji outside
 * the BMP is also two UTF-16 units, so the caret offset is not `1`.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const { EMOJI, shortcodeBefore, emojiForShortcode } = await import('../src/emoji')
const { smartInput, smartInputEdit } = await import('../src/smartInput')

const off = { smartQuotes: false, smartDashes: false, pairedSymbols: false, emoji: false } as const
const on = { ...off, emoji: true } as const

const type = (before: string, text = ':', options: typeof on | typeof off = on) =>
  smartInput({ before, after: '', text, hasSelection: false }, options)

// ---- the table -------------------------------------------------------------
assert(EMOJI.smile === '😄', 'a known shortcode')
assert(emojiForShortcode('smile') === '😄', 'lookup')
assert(emojiForShortcode('not_a_real_emoji') === null, 'an unknown one is not invented')
assert(emojiForShortcode('SMILE') === '😄', 'and lookup tolerates the case people type')
// The `+1` / `-1` aliases exist because those are what people actually type.
assert(EMOJI['+1'] === '👍' && EMOJI['-1'] === '👎', 'the thumbs aliases survive')

// ---- finding the shortcode -------------------------------------------------
// The closing colon is the character being typed, so it is *not* in `before`.
assert(shortcodeBefore(':smile') === 'smile', 'a shortcode right before the colon')
assert(shortcodeBefore('text :smile') === 'smile', 'inside prose')
assert(shortcodeBefore(':smile:') === null, 'a finished shortcode is not re-triggered')
assert(shortcodeBefore('smile') === null, 'no opening colon')
assert(shortcodeBefore(':') === null, 'an empty shortcode')
assert(shortcodeBefore(':with space') === null, 'a space ends the name')
assert(shortcodeBefore(':a-b+c_d1') === 'a-b+c_d1', 'the characters the table uses')

// ---- the rule --------------------------------------------------------------
{
  const result = type(':smile')
  assert(result.text === '😄', `the colon becomes the emoji: ${result.text}`)
  // `:smile` is six characters to remove, plus the colon that opened it.
  assert(result.deleteBefore === 6, `removes the shortcode: ${result.deleteBefore}`)
  // An emoji outside the BMP is two UTF-16 units, so the caret is not at 1.
  assert(result.caretOffset === '😄'.length, `caret lands after the emoji: ${result.caretOffset}`)
}
{
  // The whole edit, end to end: `a :smile:` + the typed `:` becomes `a 😄`.
  const md = 'a :smile'
  const result = type(':smile')
  const edit = smartInputEdit(result, { from: md.length, to: md.length }, '')
  assert(
    md.slice(0, edit.from) + edit.insert + md.slice(edit.to) === 'a 😄',
    `the resulting document is "a 😄", got "${md.slice(0, edit.from) + edit.insert + md.slice(edit.to)}"`,
  )
  assert(edit.caret === edit.from + '😄'.length, 'and the caret ends after the emoji')
}
{
  // An unknown shortcode must fall through to a literal colon — otherwise the
  // user could never type `:foo:` at all.
  const result = type(':foo')
  assert(result.text === ':', 'an unknown shortcode leaves the colon alone')
  assert(result.deleteBefore === 0, 'and removes nothing')
}
{
  // Off is off: the emoji table must not fire when the setting is disabled.
  const result = type(':smile', ':', off)
  assert(result.text === ':', 'disabled leaves a literal colon')
  assert(result.deleteBefore === 0, 'and removes nothing')
}
{
  // The rule only runs on `:`, so the rest of a shortcode types normally.
  assert(type(':smile', 'e').text === 'e', 'a normal character inside a shortcode is untouched')
}

console.log('SMOKE CORE EMOJI OK: :name: → emoji + unknown falls through + BMP caret offset')

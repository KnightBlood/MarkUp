/**
 * Smoke: 复制内容并简化格式.
 *
 * The point is to drop *presentation* and keep *meaning*. Losing a class name
 * that carries semantics (a callout, a task checkbox) would be a worse outcome
 * than keeping one nobody styles, so both directions are pinned.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const { stripHtmlFormatting, hasInlineFormatting } = await import('../src/htmlCopy')

// ---- inline styles go ------------------------------------------------------
assert(
  stripHtmlFormatting('<p style="color: red">x</p>') === '<p>x</p>',
  'a double-quoted inline style is removed',
)
assert(
  stripHtmlFormatting("<span style='font: 12px' >y</span>") === '<span >y</span>',
  'a single-quoted style is removed too',
)
assert(stripHtmlFormatting('<b style=color:blue>z</b>') === '<b>z</b>', 'an unquoted style is removed')
// Multiple attributes: only the style one goes.
assert(
  stripHtmlFormatting('<a href="x" style="a:b" title="t">y</a>') ===
    '<a href="x" title="t">y</a>',
  'other attributes are untouched',
)

// ---- <style> blocks go -----------------------------------------------------
assert(
  stripHtmlFormatting('<style>p { color: red }</style><p>x</p>') === '<p>x</p>',
  'a style block is removed',
)
assert(
  stripHtmlFormatting('<style type="text/css">a{}</style>ok') === 'ok',
  'a style block with attributes is removed',
)
assert(
  stripHtmlFormatting('<STYLE>a{}</STYLE>ok') === 'ok',
  'the tag match is case-insensitive',
)
// A `style` inside text is not a tag and must survive.
assert(stripHtmlFormatting('<p>style is a word</p>') === '<p>style is a word</p>', 'prose is untouched')

// ---- meaning stays ---------------------------------------------------------
assert(
  stripHtmlFormatting('<div class="md-alert md-alert--note">x</div>') ===
    '<div class="md-alert md-alert--note">x</div>',
  'classes carry meaning and stay',
)
assert(
  stripHtmlFormatting('<ul><li><input type="checkbox" checked>a</li></ul>') ===
    '<ul><li><input type="checkbox" checked>a</li></ul>',
  'structure and form controls stay',
)
// A style *attribute value* containing a `>` must not confuse the tag scanner
// into eating the rest of the fragment.
assert(
  stripHtmlFormatting('<p style="content: \'>\'">after</p>') === '<p>after</p>',
  'a bracket inside a style value does not derail the scan',
)

// ---- nothing to do ---------------------------------------------------------
assert(stripHtmlFormatting('plain text') === 'plain text', 'plain text passes through')
assert(stripHtmlFormatting('') === '', 'empty stays empty')
assert(!hasInlineFormatting('<p class="x">y</p>'), 'a clean fragment reports as clean')
assert(hasInlineFormatting('<p style="a:b">y</p>'), 'an inline style is detected')
assert(hasInlineFormatting('<style>x</style>'), 'a style block is detected')
// The detection has to agree with the stripper, or a caller would skip work that
// was actually needed (or do work that was not).
for (const sample of [
  '<p style="a:b">x</p>',
  "<i style='a:b'>x</i>",
  '<style>x{}</style>y',
  '<p>clean</p>',
  'plain',
]) {
  const needed = hasInlineFormatting(sample)
  const changed = stripHtmlFormatting(sample) !== sample
  assert(needed === changed, `detection agrees with stripping for ${JSON.stringify(sample)}`)
}

console.log('SMOKE CORE HTML COPY OK: style attrs + style blocks removed, classes/structure kept')

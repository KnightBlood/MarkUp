function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const { inlineFormatEdit, linkEdit, blockFormatEdit, selectionLineRange } = await import(
  '../src/textFormat'
)

/** Apply an edit the way the shell does: slice + splice + caret. */
function apply(
  markdown: string,
  edit: { range: { from: number; to: number }; text: string; caret?: number },
): { md: string; caret: number } {
  const { range } = edit
  const md = markdown.slice(0, range.from) + edit.text + markdown.slice(range.to)
  return { md, caret: range.from + (edit.caret ?? edit.text.length) }
}
const find = (md: string, needle: string, from = 0): number => {
  const at = md.indexOf(needle, from)
  assert(at >= 0, `expected to find ${JSON.stringify(needle)} in ${JSON.stringify(md)}`)
  return at
}

// ── inline: bold ────────────────────────────────────────────────────────
{
  const md = 'hello world'
  const from = find(md, 'hello')
  const wrapped = inlineFormatEdit(md, { from, to: from + 5 }, 'bold')
  const once = apply(md, wrapped)
  assert(once.md === '**hello** world', `bold wrap: ${once.md}`)
  assert(once.caret === 9, `bold caret at end of the marks: ${once.caret}`)
  assert(
    wrapped.select && wrapped.select.from === 2 && wrapped.select.to === 7,
    'bold leaves the word selected',
  )

  const back = inlineFormatEdit(once.md, { from: 0, to: 9 }, 'bold')
  assert(back.text === 'hello', `bold unwraps: ${back.text}`)

  const empty = inlineFormatEdit(md, { from: 5, to: 5 }, 'bold')
  const blank = apply(md, empty)
  assert(blank.md === 'hello**** world', `empty bold without placeholder: ${blank.md}`)
  assert(blank.caret === 7, `empty bold caret between marks: ${blank.caret}`)

  // A placeholder is what the shell passes: `****` alone is a thematic break
  // in markdown, so the seeded form is the only one that survives a re-parse.
  const seeded = inlineFormatEdit(md, { from: 5, to: 5 }, 'bold', '粗体')
  const seededApply = apply(md, seeded)
  assert(seededApply.md === 'hello**粗体** world', `empty bold seeded: ${seededApply.md}`)
  assert(
    seeded.select?.from === 2 && seeded.select?.to === 4,
    `placeholder selected so typing replaces it: ${JSON.stringify(seeded.select)}`,
  )
}

// ── inline: italic must not eat bold ────────────────────────────────────
{
  const md = '**bold**'
  const off = inlineFormatEdit(md, { from: 0, to: md.length }, 'italic')
  const on = apply(md, off)
  assert(on.md === '***bold***', `italic over bold wraps: ${on.md}`)

  const ital = 'plain words'
  const edit = inlineFormatEdit(ital, { from: 0, to: ital.length }, 'italic')
  const once = apply(ital, edit)
  assert(once.md === '*plain words*', `italic wrap: ${once.md}`)
  const undo = inlineFormatEdit(once.md, { from: 0, to: once.md.length }, 'italic')
  assert(undo.text === 'plain words', `italic unwrap: ${undo.text}`)
}

// ── inline: strike + code ──────────────────────────────────────────────
{
  const md = 'gone soon'
  const strike = apply(md, inlineFormatEdit(md, { from: 0, to: 4 }, 'strike'))
  assert(strike.md === '~~gone~~ soon', `strike: ${strike.md}`)

  const code = apply(md, inlineFormatEdit(md, { from: 5, to: 9 }, 'code'))
  assert(code.md === 'gone `soon`', `code: ${code.md}`)

  const tick = 'a ` b'
  const code2 = inlineFormatEdit(tick, { from: 0, to: tick.length }, 'code')
  assert(code2.text === '``a ` b``', `code fence grows around a backtick: ${code2.text}`)
}

// ── link ───────────────────────────────────────────────────────────────
{
  const md = 'docs'
  const at = find(md, 'docs')
  const made = apply(md, linkEdit(md, { from: at, to: at + 4 }, 'https://x.dev'))
  assert(made.md === '[docs](https://x.dev)', `link: ${made.md}`)
  assert(made.caret === made.md.length, 'link caret lands at end')

  const empty = apply('see ', linkEdit('see ', { from: 4, to: 4 }, 'https://x.dev'))
  assert(empty.md === 'see [](https://x.dev)', `empty link: ${empty.md}`)
  assert(empty.caret === 5, 'empty link caret sits inside the brackets')

  const re = '[docs](https://old.dev)'
  const fixed = linkEdit(re, { from: 0, to: re.length }, 'https://new.dev')
  assert(fixed.text === '[docs](https://new.dev)', `re-link keeps the label: ${fixed.text}`)

  const url = 'https://x.dev'
  const fromUrl = apply(url, linkEdit(url, { from: 0, to: url.length }, 'https://y.dev'))
  assert(fromUrl.md === '[https://x.dev](https://y.dev)', `url as label: ${fromUrl.md}`)
}

// ── block: headings ────────────────────────────────────────────────────
{
  const md = 'title\nbody text'
  const title = find(md, 'title')
  const h1 = blockFormatEdit(md, { from: title, to: title }, 'h1')
  assert(h1, 'h1 edit produced')
  const applied = apply(md, h1!)
  assert(applied.md === '# title\nbody text', `h1: ${applied.md}`)
  assert(applied.caret === 2, `h1 caret follows the text, not the marker: ${applied.caret}`)

  const back = blockFormatEdit(applied.md, { from: 2, to: 2 }, 'h1')
  assert(back, 'h1 toggle-off produced')
  assert(apply(applied.md, back!).md === 'title\nbody text', 'h1 toggles back off')

  const h3 = blockFormatEdit('# title', { from: 3, to: 3 }, 'h3')
  assert(h3 && apply('# title', h3).md === '### title', 'heading level swaps')

  // Toggling h1 off a quoted heading keeps the quote.
  const quoted = '> # title'
  const off = blockFormatEdit(quoted, { from: 4, to: 4 }, 'h1')
  assert(off && apply(quoted, off).md === '> title', `quoted heading keeps quote: ${off?.text}`)
}

// ── block: quote / list / task / plain ─────────────────────────────────
{
  const md = 'alpha\nbeta'
  const whole = { from: 0, to: md.length }
  const q = blockFormatEdit(md, whole, 'quote')
  assert(q && apply(md, q).md === '> alpha\n> beta', `quote multi-line: ${q && apply(md, q).md}`)
  const quoted = '> alpha\n> beta'
  const qBack = blockFormatEdit(quoted, { from: 0, to: quoted.length }, 'quote')
  assert(qBack && apply(quoted, qBack).md === 'alpha\nbeta', 'quote toggles off')

  const b = blockFormatEdit(md, whole, 'bullet')
  assert(b && apply(md, b).md === '- alpha\n- beta', 'bullet lists every selected line')
  const o = blockFormatEdit(md, whole, 'ordered')
  assert(o && apply(md, o).md === '1. alpha\n1. beta', 'ordered lists every selected line')

  // bullet → ordered → plain round trip
  const toOrdered = blockFormatEdit('- alpha', { from: 3, to: 3 }, 'ordered')
  assert(toOrdered && apply('- alpha', toOrdered).md === '1. alpha', 'bullet becomes ordered')
  const toPlain = blockFormatEdit('1. alpha', { from: 4, to: 4 }, 'plain')
  assert(toPlain && apply('1. alpha', toPlain).md === 'alpha', 'ordered becomes plain')

  const t = blockFormatEdit('alpha', { from: 0, to: 5 }, 'task')
  assert(t && apply('alpha', t).md === '- [ ] alpha', `task: ${t?.text}`)
  const tOff = blockFormatEdit('- [ ] alpha', { from: 5, to: 5 }, 'task')
  assert(tOff && apply('- [ ] alpha', tOff).md === '- alpha', 'task off keeps the bullet')

  const blanks = 'alpha\n\nbeta'
  const blankEdit = blockFormatEdit(blanks, { from: 0, to: blanks.length }, 'quote')
  assert(
    blankEdit && apply(blanks, blankEdit).md === '> alpha\n\n> beta',
    `blank lines untouched: ${blankEdit && apply(blanks, blankEdit).md}`,
  )
}

// ── block: no-op returns null (so the doc never goes dirty) ────────────
{
  assert(blockFormatEdit('alpha', { from: 0, to: 5 }, 'plain') === null, 'plain on plain is null')
  assert(
    blockFormatEdit('alpha', { from: 0, to: 5 }, 'quote') !== null,
    'quote on plain produces an edit',
  )
  const quoted = blockFormatEdit('> alpha', { from: 2, to: 2 }, 'quote')
  assert(quoted, 'quote on quoted strips the marker')
  assert(apply('> alpha', quoted!).md === 'alpha', 'quote toggles off cleanly')
}

// ── block: code fences wrap and unwrap ─────────────────────────────────
{
  const md = 'alpha\nbeta'
  const wrap = blockFormatEdit(md, { from: 0, to: md.length }, 'codeBlock')
  assert(wrap, 'fence wrap produced')
  const wrapped = apply(md, wrap!)
  assert(wrapped.md === '```\nalpha\nbeta\n```', `fence: ${wrapped.md}`)
  assert(
    wrapped.caret === wrapped.md.indexOf('alpha'),
    `caret stays on its text inside the fence: ${wrapped.caret}`,
  )

  const inner = find(wrapped.md, 'alpha') + 2
  const unwrap = blockFormatEdit(wrapped.md, { from: inner, to: inner }, 'codeBlock')
  assert(unwrap, 'fence unwrap produced')
  assert(apply(wrapped.md, unwrap!).md === 'alpha\nbeta', 'fence toggles back off')
}

// ── selection bounds helper ─────────────────────────────────────────────
{
  const md = 'one\ntwo\nthree'
  const span = selectionLineRange(md, { from: 5, to: 5 })
  assert(span && md.slice(span.from, span.to) === 'two', 'line range for a caret')
}

console.log('pm-fmt: OK')

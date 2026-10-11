/**
 * Smoke: 复制公式 — locating a formula in the source, and rendering it to MathML.
 *
 * `$` is context-sensitive in markdown, so the cases that matter are the ones
 * where it is *not* math: an escaped `\$`, a `$` inside a code fence or inline
 * code, a lone `$` used as a currency sign, and a `$$…$$` block that must not be
 * read as two inline spans.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const { collectMathSpans, mathSpanAt, latexToMathML } = await import('../src/mathSource')

const latices = (md: string): string[] => collectMathSpans(md).map((span) => span.latex)

// ---- the shapes that are math ---------------------------------------------
assert(latices('$x$').join('|') === 'x', 'inline math')
assert(latices('a $x+y$ b').join('|') === 'x+y', 'inline math inside prose')
assert(latices('$$x^2$$').join('|') === 'x^2', 'block math on one line')
assert(latices('$$\n\\frac{a}{b}\n$$').join('|') === '\n\\frac{a}{b}\n', 'block math across lines')
assert(latices('$a$ and $b$').join('|') === 'a|b', 'two spans')
{
  const spans = collectMathSpans('a $x$ b')
  assert(spans[0]!.from === 2 && spans[0]!.to === 5, `span covers the delimiters: ${spans[0]!.from}-${spans[0]!.to}`)
  assert(spans[0]!.block === false, 'inline is not block')
  assert(collectMathSpans('$$x$$')[0]!.block === true, 'double dollar is block')
}

// ---- the shapes that are not ----------------------------------------------
assert(latices('\\$5').join('') === '', 'an escaped dollar is not a delimiter')
assert(latices('price is $5').join('') === '', 'a lone dollar has no partner')
// `$x $` is not math: remark-math forbids whitespace before the closing `$`.
assert(latices('$x $').join('') === '', 'a space before the closer disqualifies it')
assert(latices('$ x$').join('') === '', 'and a space after the opener')
assert(latices('```\n$x$\n```').join('') === '', 'a fence is opaque')
assert(latices('~~~\n$x$\n~~~').join('') === '', 'a tilde fence too')
assert(latices('`$x$`').join('') === '', 'inline code is opaque')
assert(latices('``$x$``').join('') === '', 'and a longer backtick run')
// The fence must stop mattering again once it closes.
assert(latices('```\n$x$\n```\n$y$').join('|') === 'y', 'after the fence, math is read again')
assert(latices('`$x$` $y$').join('|') === 'y', 'after a code span too')
// Two inline spans are not one block: `$$` is matched as a unit.
assert(collectMathSpans('$$x$$')[0]!.latex === 'x', '$$ is one block, not two inline spans')

// ---- mathSpanAt ------------------------------------------------------------
{
  const md = 'a $x^2$ b'
  assert(mathSpanAt(md, 4)?.latex === 'x^2', 'a caret inside the formula finds it')
  assert(mathSpanAt(md, 0) === null, 'a caret outside finds nothing')
  // The whole span counts, delimiters included, so a caret just inside `$` works.
  assert(mathSpanAt(md, 2)?.latex === 'x^2', 'on the opening delimiter')
  assert(mathSpanAt(md, 7)?.latex === 'x^2', 'on the closing delimiter')
}

// ---- LaTeX → MathML --------------------------------------------------------
{
  const inline = latexToMathML('x^2')
  assert(inline, 'a simple formula renders')
  assert(inline!.includes('<math'), `MathML output: ${inline!.slice(0, 60)}`)
  assert(inline!.includes('<msup>'), 'and carries the structure, not just the text')
  // KaTeX wraps its MathML in a `<span class="katex">`; that wrapper is part of
  // what it emits, so the assertion records it rather than pretending otherwise.
  assert(inline!.includes('class="katex"'), 'the KaTeX wrapper comes with it')
  assert(latexToMathML('\\frac{a}{b}', true), 'display mode renders too')
  // A formula KaTeX cannot parse reports as null rather than half-rendering, so
  // the caller can say so instead of putting a fragment on the clipboard.
  assert(latexToMathML('\\frac{') === null, 'an unparseable formula returns null')
}

console.log('SMOKE CORE MATH SOURCE OK: $ / $$ in prose + fences/code/escapes skipped + MathML')

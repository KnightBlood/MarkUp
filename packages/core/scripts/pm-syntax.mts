/**
 * Smoke: Typora 「Markdown ▸ 语法支持」 — subscript / superscript / highlight /
 * underline and GitHub-style alerts.
 *
 * Two contracts are pinned here, both of which are easy to break silently:
 *
 * 1. **`~~x~~` stays the only strikethrough.** The pipeline runs
 *    `remark-gfm({ singleTilde: false })` so the lone `~` is free for
 *    `H~2~O`. Drop that option and subscript quietly turns into `<del>`
 *    everywhere — in export first, since nothing else fails loudly.
 * 2. **Every toggle really disables.** `codeBlockMath: false` in particular has
 *    to defeat `rehype-katex`, which renders `language-math` code blocks on its
 *    own regardless of the mdast interception.
 *
 * The OverType half is here too: 分屏 is not remark, it replays the same
 * patterns over HTML OverType already produced.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const { createSharedPipeline } = await import('../src/pipeline')
const { applyOvertypeSyntaxHtml, setOvertypeSyntax } = await import('../src/overtypeSyntax')

const all = createSharedPipeline()
const none = createSharedPipeline({
  subscript: false,
  superscript: false,
  highlight: false,
  underline: false,
  alerts: false,
})

const render = async (md: string, pipeline = all): Promise<string> =>
  (await pipeline.render(md)).html

// ---- the four inline forms -------------------------------------------------
assert(
  (await render('H~2~O')).includes('<sub>2</sub>'),
  'subscript: H~2~O should carry a <sub>',
)
assert(
  (await render('X^2^')).includes('<sup>2</sup>'),
  'superscript: X^2^ should carry a <sup>',
)
assert((await render('==key==')).includes('<mark>key</mark>'), 'highlight: ==key== → <mark>')
assert((await render('<u>x</u>')).includes('<u>x</u>'), 'underline: <u> survives the html filter')
// An unclosed tag is not a mark; it is dropped rather than leaking a stray tag.
assert(
  !(await render('<u>没有闭合')).includes('<u>'),
  'underline: unclosed <u> must not leak',
)

// ---- the single-tilde contract --------------------------------------------
assert(
  (await render('~~删~~')).includes('<del>'),
  'strikethrough: ~~x~~ must stay <del> even with singleTilde off',
)
assert(
  !(await render('~~删~~')).includes('<sub>'),
  'strikethrough: ~~x~~ must not be re-read as subscript',
)
assert(
  (await render('~x~')).includes('<sub>x</sub>'),
  'subscript: a lone ~ is free for subscript once singleTilde is off',
)

// ---- nesting, and no false positives --------------------------------------
assert(
  (await render('==外层 ^上^ 内==')).includes('<mark>外层 <sup>上</sup> 内</mark>'),
  'nesting: superscript must apply inside a highlight',
)
assert(
  !(await render('=== 三等号 ==')).includes('<mark>'),
  'false positive: === must not open a highlight',
)
assert(
  !(await render('== 空格 ==')).includes('<mark>'),
  'false positive: a space-padded body is not a highlight',
)

// ---- code is never rewritten ----------------------------------------------
const fenced = await render('```\n==not== 和 ~sub~\n```')
assert(!fenced.includes('<mark>') && !fenced.includes('<sub>'), 'fenced code is opaque')
const inlineCode = await render('`==not==`')
assert(!inlineCode.includes('<mark>'), 'inline code is opaque')

// ---- alerts ----------------------------------------------------------------
const note = await render('> [!NOTE]\n> 内容')
assert(note.includes('md-alert--note'), 'alerts: [!NOTE] becomes a titled block')
assert(note.includes('md-alert__title'), 'alerts: the callout carries a title')
assert(
  (await render('> [!不是类型]\n> 普通引用')).includes('<blockquote>'),
  'alerts: an unknown marker stays an ordinary blockquote',
)

// ---- toggles actually switch off -------------------------------------------
const offText = await render('H~2~O 和 X^2^ 和 ==key==', none)
assert(offText.includes('H~2~O'), 'subscript off: markers render literally')
assert(offText.includes('==key=='), 'highlight off: markers render literally')
assert(
  (await render('> [!TIP]\n> 内容', none)).includes('<blockquote>'),
  'alerts off: the callout degrades to a blockquote',
)

// `rehype-katex` renders `language-math` on its own, so an mdast-level guard
// alone would leave ```math rendering even with the toggle off.
const mathOff = createSharedPipeline({ codeBlockMath: false })
const mathHtml = await render('```math\nx^2\n```', mathOff)
assert(
  !mathHtml.includes('katex'),
  'codeBlockMath off: rehype-katex must not still render the fence',
)
assert(
  (await render('```math\nx^2\n```')).includes('md-math'),
  'codeBlockMath on: the fence renders through the math placeholder',
)
const mathInlineOff = await render('质能 $E=mc^2$', createSharedPipeline({ inlineMath: false }))
assert(
  mathInlineOff.includes('$E=mc^2$') && !mathInlineOff.includes('katex'),
  'inlineMath off: $...$ stays literal text',
)

// ---- 分屏: the same rules replayed over OverType's HTML --------------------
const splitOn = {}
const splitOff = { subscript: false, superscript: false, highlight: false, underline: false }

assert(
  applyOvertypeSyntaxHtml('这是 ==高亮== 和 H~2~O', splitOn).includes('<mark>高亮</mark>'),
  'overtype: highlight applies to literal text',
)
assert(
  applyOvertypeSyntaxHtml('这是 ==高亮==', splitOff).includes('==高亮=='),
  'overtype: highlight off leaves the markers alone',
)
// OverType reads `~x~` as strikethrough; the hook has to undo it or 分屏
// disagrees with the other two views about what a single tilde means.
assert(
  applyOvertypeSyntaxHtml(
    '<del><span class="syntax-marker">~</span>2<span class="syntax-marker">~</span></del>',
    splitOn,
  ).includes('<sub>2</sub>'),
  'overtype: single-tilde <del> is re-read as subscript',
)
assert(
  applyOvertypeSyntaxHtml('文字 &lt;u&gt;下&lt;/u&gt;', splitOn).includes('<u>'),
  'overtype: escaped <u> is un-escaped when underline is on',
)
assert(
  applyOvertypeSyntaxHtml(
    '行内 <code><span class="syntax-marker">`</span>==x==<span class="syntax-marker">`</span></code>',
    splitOn,
  ).includes('==x=='),
  'overtype: code spans are opaque',
)

// The installed hook must read the current options on every call, so a toggle
// in 设置 takes effect without re-installing.
setOvertypeSyntax({})
assert(
  (await import('overtype')).default.MarkdownParser.applyCustomSyntax('a ==高== b ~i~ c ^p^ d')
    .includes('<mark>高</mark>'),
  'overtype: the installed hook renders with the live options',
)
setOvertypeSyntax(splitOff)
assert(
  (await import('overtype')).default.MarkdownParser.applyCustomSyntax('a ==高== b ~i~ c ^p^ d')
    .includes('==高=='),
  'overtype: re-configuring the hook flips it without re-installing',
)

console.log('SMOKE CORE MARKDOWN SYNTAX OK: sub/sup/highlight/underline + alerts + overtype hook')

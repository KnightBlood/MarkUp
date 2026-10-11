/**
 * Smoke: 图像工具 — finding image references, mapping them to paths, and
 * respelling them after a syntax switch or a file move.
 *
 * The scanning contract is the load-bearing part. An `![](…)` inside a fenced
 * block is *sample* markdown; rewriting it corrupts the sample. And a reference
 * has to be matched by its *resolved* path, not the bytes the author typed, or
 * `./a.png`, `a.png` and `sub/../a.png` would each be treated as a different
 * file.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const {
  collectImages,
  imageAt,
  respellImage,
  switchImageSyntaxEdit,
  resolveImagePath,
  normalizePath,
  repointImagesEdit,
  localImages,
  imageUrlScheme,
  isRemoteImageUrl,
  imageDisplayName,
} = await import('../src/imageTools')

const POSIX = { sep: '/', caseInsensitive: false } as const

const apply = (md: string, edit: { range: { from: number; to: number }; text: string }): string =>
  md.slice(0, edit.range.from) + edit.text + md.slice(edit.range.to)

// ---- scanning --------------------------------------------------------------
{
  const md = 'a ![alt](one.png) b ![](two.png "T") c <img src="three.png" alt="x"> end'
  const refs = collectImages(md)
  assert(refs.length === 3, `three references, got ${refs.length}`)
  assert(refs[0]!.url === 'one.png' && refs[0]!.alt === 'alt', 'markdown ref parsed')
  assert(refs[0]!.kind === 'markdown', 'kind is markdown')
  assert(md.slice(refs[0]!.from, refs[0]!.to) === '![alt](one.png)', 'the whole ref is spanned')
  assert(refs[1]!.url === 'two.png' && refs[1]!.alt === '', 'a title is not part of the URL')
  assert(refs[2]!.kind === 'html' && refs[2]!.url === 'three.png', 'html src parsed')
  assert(refs[2]!.alt === 'x', 'html alt parsed')
  // The URL span has to be exactly the URL, or a later rewrite eats the parens.
  assert(md.slice(refs[0]!.urlFrom, refs[0]!.urlTo) === 'one.png', 'url span is surgical')
  assert(md.slice(refs[2]!.urlFrom, refs[2]!.urlTo) === 'three.png', 'html url span is surgical')
}
{
  // Angle-bracket destinations and paths with spaces.
  const md = '![a](<my file.png>)'
  const refs = collectImages(md)
  assert(refs.length === 1 && refs[0]!.url === 'my file.png', `angled url: ${refs[0]?.url}`)
}
{
  // Sample markdown inside fences and inline code must be left alone.
  const md = [
    '```md',
    '![sample](a.png)',
    '```',
    'inline `![sample](b.png)` here',
    '![real](c.png)',
  ].join('\n')
  const refs = collectImages(md)
  assert(refs.length === 1, `only the real image, got ${refs.length}`)
  assert(refs[0]!.url === 'c.png', 'the real image is the one outside code')
}
{
  const md = 'x ![a](a.png) y'
  const at = md.indexOf('a.png')
  assert(imageAt(md, at)?.url === 'a.png', 'imageAt finds the reference under the caret')
  assert(imageAt(md, 0) === null, 'imageAt returns null off an image')
}

// ---- syntax switching ------------------------------------------------------
{
  const md = '![a](a.png)'
  const toHtml = switchImageSyntaxEdit(md, { from: 0, to: 0 }, 'html')
  assert(toHtml, 'a switch produces an edit')
  assert(apply(md, toHtml!) === '<img src="a.png" alt="a" />', `to html: ${apply(md, toHtml!)}`)
  const back = switchImageSyntaxEdit('<img src="a.png" alt="a" />', { from: 0, to: 0 }, 'markdown')
  assert(apply('<img src="a.png" alt="a" />', back!) === '![a](a.png)', 'html back to markdown')
}
{
  // Already in the target syntax → no edit, so the document is not dirtied.
  assert(
    switchImageSyntaxEdit('![a](a.png)', { from: 0, to: 0 }, 'markdown') === null,
    'switching to the current syntax is a no-op',
  )
}
{
  // A selection switches only what it touches.
  const md = '![a](a.png)\n\n![b](b.png)'
  const second = md.indexOf('![b]')
  const edit = switchImageSyntaxEdit(md, { from: second, to: md.length }, 'html')
  const out = apply(md, edit!)
  assert(out.startsWith('![a](a.png)'), 'the untouched image keeps its syntax')
  assert(out.includes('<img src="b.png"'), 'the selected image switched')
}
{
  // Mixed document: both directions in one pass when the range covers both.
  const md = '![a](a.png) and <img src="b.png" />'
  const edit = switchImageSyntaxEdit(md, { from: 0, to: 0 }, 'html')
  const out = apply(md, edit!)
  assert(out === '<img src="a.png" alt="a" /> and <img src="b.png" />', `mixed: ${out}`)
}
{
  const md = '![a](a.png)'
  const toHtml = switchImageSyntaxEdit(md, { from: 0, to: 0 }, 'html')
  assert(toHtml!.range.from === 0 && toHtml!.range.to === md.length, 'edit spans every change')
}

// ---- URL schemes -----------------------------------------------------------
assert(imageUrlScheme('data:image/png;base64,AA') === 'data', 'data: is a scheme')
assert(imageUrlScheme('https://x/y.png') === 'https', 'https is a scheme')
assert(imageUrlScheme('C:/a.png') === null, 'a drive letter is not a scheme')
assert(imageUrlScheme('a/b.png') === null, 'a relative path has no scheme')
assert(isRemoteImageUrl('web:/virtual.png'), 'the virtual web root is remote')
assert(!isRemoteImageUrl('./a.png'), 'a dot-slash path is local')

// ---- path resolution -------------------------------------------------------
assert(normalizePath('/a/./b/../c.png', POSIX) === '/a/c.png', 'normalize collapses . and ..')
assert(normalizePath('a/b/../../c.png', POSIX) === 'c.png', 'normalize walks out')
assert(normalizePath('C:\\x\\..\\y.png', { sep: '\\', caseInsensitive: true }) === 'C:\\y.png', 'windows normalize')

assert(
  resolveImagePath('a.png', '/docs/note.md', POSIX) === '/docs/a.png',
  'a bare name resolves against the document folder',
)
assert(
  resolveImagePath('./sub/a.png', '/docs/note.md', POSIX) === '/docs/sub/a.png',
  './ resolves the same way',
)
assert(
  resolveImagePath('../a.png', '/docs/note.md', POSIX) === '/a.png',
  '.. walks up',
)
assert(
  resolveImagePath('sub/../a.png', '/docs/note.md', POSIX) === '/docs/a.png',
  'a path is normalized before use',
)
assert(
  resolveImagePath('/abs/a.png', '/docs/note.md', POSIX) === '/abs/a.png',
  'an absolute path is left alone',
)
assert(
  resolveImagePath('my%20file.png', '/docs/note.md', POSIX) === '/docs/my file.png',
  'a percent-encoded URL decodes to the real file name',
)
assert(
  resolveImagePath('https://x/y.png', '/docs/note.md', POSIX) === null,
  'a remote URL has no local path',
)
assert(
  resolveImagePath('data:image/png;base64,AA', '/docs/note.md', POSIX) === null,
  'an inline bitmap has no local path',
)
assert(
  resolveImagePath('a.png', null, POSIX) === null,
  'an unsaved document has no folder to resolve against',
)
assert(imageDisplayName('sub/my%20file.png') === 'my file.png', 'display name decodes')

// ---- repointing after a move ----------------------------------------------
{
  // Two spellings of the same file: both have to follow the move.
  const md = '![a](./a.png) ![b](a.png) ![c](b.png)'
  const edit = repointImagesEdit(
    md,
    '/docs/note.md',
    '/docs/a.png',
    '/docs/assets/a.png',
    { preferRelative: true, dotPrefix: false, escapeUrl: false },
    POSIX,
  )
  assert(edit, 'a move produces an edit')
  const out = apply(md, edit!)
  assert(
    out === '![a](assets/a.png) ![b](assets/a.png) ![c](b.png)',
    `both spellings repointed, others untouched: ${out}`,
  )
}
{
  // Moving out of the document folder produces a climbing path.
  const edit = repointImagesEdit(
    '![a](a.png)',
    '/docs/note.md',
    '/docs/a.png',
    '/media/a.png',
    { preferRelative: true, dotPrefix: false, escapeUrl: false },
    POSIX,
  )
  assert(apply('![a](a.png)', edit!) === '![a](../media/a.png)', 'a move out of the folder climbs')
}
{
  assert(
    repointImagesEdit(
      '![a](a.png)',
      '/docs/note.md',
      '/docs/other.png',
      '/docs/x.png',
      { preferRelative: true, dotPrefix: false, escapeUrl: false },
      POSIX,
    ) === null,
    'nothing points at the old path → no edit',
  )
}

// ---- the image list --------------------------------------------------------
{
  const md = '![a](a.png) ![again](./a.png) ![b](b.png) ![r](https://x/y.png)'
  const list = localImages(md, '/docs/note.md', POSIX)
  assert(list.length === 2, `two distinct local files, got ${list.length}`)
  assert(list[0]!.path === '/docs/a.png' && list[1]!.path === '/docs/b.png', 'paths resolved in order')
  assert(list.every((item) => item.ref.url !== 'https://x/y.png'), 'remote images are excluded')
}

console.log('SMOKE CORE IMAGE TOOLS OK: scan/fence-skip/url-span + syntax switch + path resolve + repoint')

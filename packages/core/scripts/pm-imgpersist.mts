/**
 * Smoke: Typora「图像 ▸ 插入图片时」—— where an inserted image lands and how
 * the markdown reference is spelled.
 *
 * The rules exercised here all fail silently if broken: a wrong `${filename}`
 * substitution, a collision that overwrites an existing image, or a Windows
 * backslash in the URL (`![](D:\a.png)` — a backslash escapes the next
 * character inside a link destination) produce documents that look fine until
 * the image is moved or shared.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const {
  resolveImageInsert,
  imageTargetDir,
  imageMarkdownUrl,
  uniqueFileName,
  relativePath,
  substitute,
  dirname,
  stem,
  extname,
} = await import('../src/imagePersist')

const DATA = 'data:image/png;base64,AAA='

/** Fake filesystem: remembers writes, and reports whatever it was told to. */
function fakeDeps(docPath: string | null, listing: Record<string, string[]> = {}) {
  const made: string[] = []
  const written: Array<{ path: string; dataUrl: string }> = []
  return {
    made,
    written,
    deps: {
      mkdirp: async (dir: string) => {
        made.push(dir)
      },
      listNames: async (dir: string) => listing[dir] ?? [],
      writeDataUrl: async (path: string, dataUrl: string) => {
        written.push({ path, dataUrl })
      },
      docPath: () => docPath,
    },
  }
}

const POSIX = { sep: '/', caseInsensitive: false } as const
const WINDOWS = { sep: '\\', caseInsensitive: true } as const

const opts = (over: Partial<Parameters<typeof imageMarkdownUrl>[2]> = {}) => ({
  mode: 'none' as const,
  customPath: '',
  preferRelative: true,
  dotPrefix: false,
  escapeUrl: false,
  ...over,
})

// ---- path helpers ----------------------------------------------------------
assert(stem('/a/note.md') === 'note', 'stem drops the extension')
assert(stem('/a/.env') === '.env', 'a leading dot is part of the name')
assert(extname('/a/note.png') === 'png', 'extname')
assert(dirname('/a/b/c.md', '/') === '/a/b', 'dirname posix')
assert(dirname('C:\\a\\c.md', '\\') === 'C:\\a', 'dirname windows')
assert(dirname('C:\\c.md', '\\') === 'C:\\', 'dirname keeps a drive root')
assert(substitute('${filename}/assets', '/a/note.md') === 'note/assets', '${filename}')
assert(
  substitute('${filepath}/img', '/a/note.md') === '/a/note/img',
  '${filepath} drops the extension from the full path',
)
assert(
  relativePath('/a', '/a/b/c.png', POSIX) === 'b/c.png',
  'relative path inside the tree',
)
assert(relativePath('/a', '/b/c.png', POSIX) === '../b/c.png', 'climbs out with ..')
assert(relativePath('/a', '/a/b.png', POSIX) === 'b.png', 'same directory')
assert(
  relativePath('C:\\docs', 'C:\\docs\\img\\a.png', WINDOWS) === 'img\\a.png',
  'relative path on windows',
)
assert(
  relativePath('C:\\docs', 'D:\\other\\a.png', WINDOWS) === '',
  'a different drive has no relative form',
)
assert(
  relativePath('/a/B', '/a/b/x.png', POSIX) === '../b/x.png',
  'posix must not fold case — /a/B and /a/b are different directories',
)
assert(
  relativePath('C:\\Docs', 'C:\\docs\\x.png', WINDOWS) === 'x.png',
  'windows folds case — it is the same directory there',
)

// ---- the five destination modes --------------------------------------------
const DOC = '/a/note.md'
assert(imageTargetDir(opts(), DOC, '/') === null, 'mode none copies nothing')
assert(
  imageTargetDir(opts({ mode: 'folder' }), DOC, '/') === '/a',
  'folder mode targets the document folder',
)
assert(
  imageTargetDir(opts({ mode: 'assets' }), DOC, '/') === '/a/assets',
  'assets mode targets ./assets',
)
assert(
  imageTargetDir(opts({ mode: 'docAssets' }), DOC, '/') === '/a/note.assets',
  'docAssets names the folder after the document',
)
assert(
  imageTargetDir(opts({ mode: 'custom', customPath: '${filename}.img' }), DOC, '/') ===
    '/a/note.img',
  'custom mode substitutes ${filename}',
)
assert(
  imageTargetDir(opts({ mode: 'assets' }), null, '/') === null,
  'an unsaved document has no folder to copy into',
)
// A user-typed `./` is the same directory, not a literal `.` segment; a typed
// leading `/` is an absolute path and must not be relocated into the document.
assert(
  imageTargetDir(opts({ mode: 'custom', customPath: './assets' }), DOC, '/') === '/a/assets',
  'a typed ./assets normalises to the document folder',
)
assert(
  imageTargetDir(opts({ mode: 'custom', customPath: '/data/img' }), DOC, '/') === '/data/img',
  'a typed absolute custom path is honoured as-is',
)

// ---- collision naming ------------------------------------------------------
assert(uniqueFileName('/a', 'x.png', []) === 'x.png', 'no collision keeps the name')
assert(uniqueFileName('/a', 'x.png', ['x.png']) === 'x-1.png', 'first collision suffixes')
assert(
  uniqueFileName('/a', 'x.png', ['x.png', 'x-1.png']) === 'x-2.png',
  'repeated collisions keep counting',
)
assert(
  uniqueFileName('/a', 'x.png', ['X.PNG']) === 'x-1.png',
  'collisions compare case-insensitively — overwriting is worse than renaming',
)

// ---- end to end: paste → url ----------------------------------------------
{
  const f = fakeDeps(DOC)
  const r = await resolveImageInsert(
    { dataUrl: DATA, name: 'shot.png' },
    opts({ mode: 'assets' }),
    f.deps,
    POSIX,
  )
  assert(r.kind === 'saved', 'assets mode writes the file')
  assert(r.path === '/a/assets/shot.png', `target path: ${r.path}`)
  assert(r.url === 'assets/shot.png', `markdown url: ${r.url}`)
  assert(f.made.length === 1 && f.made[0] === '/a/assets', 'the directory is created')
  assert(f.written[0]?.dataUrl === DATA, 'the bytes reach the file')
}
{
  // The `./` preference, percent-escaping, and a collision, all at once.
  const f = fakeDeps(DOC, { '/a/assets': ['my shot(1).png'] })
  const r = await resolveImageInsert(
    { dataUrl: DATA, name: 'my shot(1).png' },
    opts({ mode: 'assets', dotPrefix: true, escapeUrl: true }),
    f.deps,
    POSIX,
  )
  assert(r.kind === 'saved', 'writes despite the collision')
  assert(r.path === '/a/assets/my shot(1)-1.png', `renamed: ${r.path}`)
  assert(r.url === './assets/my%20shot%281%29-1.png', `escaped: ${r.url}`)
}
{
  // Windows: forward slashes in the URL, backslashes in the real path.
  const f = fakeDeps('C:\\docs\\note.md')
  const r = await resolveImageInsert(
    { dataUrl: DATA, name: 'a b.png' },
    opts({ mode: 'docAssets' }),
    f.deps,
    WINDOWS,
  )
  assert(r.kind === 'saved', 'windows writes the file')
  assert(r.path === 'C:\\docs\\note.assets\\a b.png', `windows path: ${r.path}`)
  assert(
    !r.url.includes('\\') && r.url === 'note.assets/a b.png',
    `windows url is posix-shaped so the backslash does not escape the next char: ${r.url}`,
  )
}
{
  // A custom path that substitutes to an absolute location is honoured as-is
  // (not glued onto the document folder), yet the reference is still relative
  // because the target happens to sit under it.
  const r = await resolveImageInsert(
    { dataUrl: DATA, name: 'a.png' },
    opts({ mode: 'custom', customPath: '${filepath}-assets' }),
    fakeDeps('C:\\docs\\note.md').deps,
    WINDOWS,
  )
  assert(r.kind === 'saved', 'writes the file')
  assert(r.path === 'C:\\docs\\note-assets\\a.png', `absolute custom path kept: ${r.path}`)
  assert(r.url === 'note-assets/a.png', `still referenced relatively: ${r.url}`)
}
{
  // Nothing under the document folder → no relative form, so the absolute
  // path wins rather than a chain of `..` climbing out of the drive.
  assert(
    imageMarkdownUrl(
      'D:\\media\\a.png',
      'C:\\docs\\note.md',
      opts({ preferRelative: true }),
      WINDOWS,
    ) === 'D:/media/a.png',
    'a cross-drive target falls back to the absolute path',
  )
}
{
  // mode none → the bitmap stays inline, and nothing touches the filesystem.
  const f = fakeDeps(DOC)
  const r = await resolveImageInsert({ dataUrl: DATA, name: 'x.png' }, opts(), f.deps, POSIX)
  assert(r.kind === 'inline' && r.url === DATA, 'mode none keeps the data URL')
  assert(f.written.length === 0 && f.made.length === 0, 'the filesystem is untouched')
}
{
  // Unsaved document → still inline, never a lost paste.
  const f = fakeDeps(null)
  const r = await resolveImageInsert(
    { dataUrl: DATA, name: 'x.png' },
    opts({ mode: 'assets' }),
    f.deps,
    POSIX,
  )
  assert(r.kind === 'inline', 'an unsaved document falls back to inline')
  assert(f.written.length === 0, 'and never writes to a guessed location')
}

// ---- imageMarkdownUrl is reachable on its own (the "open image tools" half
// of Typora reuses it when re-spelling an existing reference) ---------------
assert(
  imageMarkdownUrl(
    '/a/assets/x y.png',
    '/a/note.md',
    opts({ preferRelative: false, dotPrefix: true }),
    POSIX,
  ) === '/a/assets/x y.png',
  'preferRelative off leaves the absolute path alone, and ./ does not prefix it',
)
assert(
  imageMarkdownUrl('/a/assets/x.png', '/a/note.md', opts({ dotPrefix: true }), POSIX) ===
    './assets/x.png',
  './ only prefixes a relative path',
)

console.log(
  'SMOKE CORE IMAGE PERSIST OK: 5 copy modes + ${filename} substitution + collision suffixes + relative/drive + url escape',
)

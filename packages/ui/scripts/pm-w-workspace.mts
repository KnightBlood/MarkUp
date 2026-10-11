/**
 * Smoke: 显示隐藏的文件夹 / 文件.
 *
 * The rule has two halves that must not be conflated: *hidden* means a leading
 * dot, and *noise* means `node_modules` / `.git` / `dist`. Turning on "show
 * hidden" must not become a way to accidentally walk a checkout — that is the
 * whole reason the two sets are separate.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const { shouldSkipEntry } = await import('../src/workspace')

const file = (name: string) => ({ name, kind: 'file' as const })
const dir = (name: string) => ({ name, kind: 'dir' as const })

// ---- hidden off (the default) ---------------------------------------------
assert(shouldSkipEntry(file('.env'), false), 'a dot-file is hidden by default')
assert(shouldSkipEntry(dir('.config'), false), 'a dot-directory too')
assert(shouldSkipEntry(file('.gitignore'), false), 'and dot-files that are not markdown')
assert(!shouldSkipEntry(file('notes.md'), false), 'a normal file is shown')
assert(!shouldSkipEntry(dir('notes'), false), 'a normal directory is walked')

// ---- hidden on --------------------------------------------------------------
assert(!shouldSkipEntry(file('.env'), true), 'the setting reveals dot-files')
assert(!shouldSkipEntry(dir('.config'), true), 'and dot-directories')
assert(!shouldSkipEntry(file('.gitignore'), true), 'and other dot-files')
// The noise set is unaffected — this is the point of keeping them separate.
assert(shouldSkipEntry(dir('node_modules'), true), 'node_modules stays hidden')
assert(shouldSkipEntry(dir('.git'), true), '.git stays hidden even with the setting on')
assert(shouldSkipEntry(dir('dist'), true), 'build output stays hidden')
assert(shouldSkipEntry(dir('target'), true), 'and so do other build dirs')
assert(!shouldSkipEntry(file('node_modules'), true), 'only a *directory* named that is skipped')
// A name that merely contains a dot is not hidden.
assert(!shouldSkipEntry(file('a.b.md'), false), 'an inner dot is not a leading dot')
assert(!shouldSkipEntry(file('a.b.md'), true), 'and neither is it with the setting on')

// ---- buildFileTree ---------------------------------------------------------
const { buildFileTree } = await import('../src/workspace')

/** `a/b, c` shape for a readable assertion. */
const shape = (nodes: ReturnType<typeof buildFileTree>): string =>
  nodes
    .map((node) =>
      node.kind === 'dir' ? `${node.name}/[${shape(node.children)}]` : node.name,
    )
    .join(',')

{
  const root = '/w'
  const tree = buildFileTree(root, ['/w/a.md', '/w/notes/b.md', '/w/notes/deep/c.md', '/w/z.md'])
  assert(shape(tree) === 'notes/[deep/[c.md],b.md],a.md,z.md', `tree shape: ${shape(tree)}`)
  // Directories sort first, then files, each case-insensitively by name.
  assert(tree[0]!.kind === 'dir', 'a directory leads the listing')
  assert(tree[1]!.name === 'a.md' && tree[2]!.name === 'z.md', 'files follow, in name order')
  assert(tree[0]!.children[0]!.name === 'deep', 'sub-directories nest')
}
{
  // The tree carries absolute paths, because that is what a click hands back.
  const tree = buildFileTree('/w', ['/w/notes/b.md'])
  assert(tree[0]!.path === '/w/notes', `dir path: ${tree[0]!.path}`)
  assert(tree[0]!.children[0]!.path === '/w/notes/b.md', 'file path stays absolute')
  assert(tree[0]!.children[0]!.children.length === 0, 'files have no children')
}
{
  // Windows separators, and a trailing separator on the root.
  const tree = buildFileTree('C:\\w\\', ['C:\\w\\notes\\b.md', 'C:\\w\\a.md'])
  assert(shape(tree) === 'notes/[b.md],a.md', `windows shape: ${shape(tree)}`)
}
{
  // Every directory exists because a file is below it — no empty folders.
  const tree = buildFileTree('/w', ['/w/a/b/c/d.md'])
  const names: string[] = []
  let level = tree
  while (level.length > 0) {
    names.push(level[0]!.name)
    level = level[0]!.children
  }
  assert(names.join('/') === 'a/b/c/d.md', `the chain is unbroken: ${names.join('/')}`)
  assert(
    tree.every((node) => node.kind === 'dir' || node.children.length === 0),
    'no node has children unless it is a directory',
  )
}
{
  // Degenerate inputs must not throw or invent a node.
  assert(buildFileTree('/w', []).length === 0, 'no paths means no tree')
  assert(buildFileTree('/w', ['/w']).length === 0, 'the root itself is not a node')
  // A path outside the root still yields sensible segments rather than crashing.
  assert(buildFileTree('/w', ['/elsewhere/x.md']).length === 1, 'an outside path still lists')
}

console.log('SMOKE UI WORKSPACE OK: hidden = leading dot + noise dirs always skipped + file tree')
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const { fuzzyMatch, fuzzyFilter } = await import('../src/fuzzy')
const { findDocMatches, replaceDocAll, replaceDocOnce, lineOfOffset } = await import('../src/findText')
const { basename, joinPath, relativePath, isMarkdownPath, collectSearchTargets } = await import(
  '../src/workspace'
)

const sub = fuzzyMatch('read', 'README.md')
assert(sub !== null && sub.score > 0, 'fuzzy substring hit')
const miss = fuzzyMatch('xyz', 'README.md')
assert(miss === null, 'fuzzy miss')

const ranked = fuzzyFilter(
  'abc',
  ['x/a/b/c.md', 'zzz.md', 'deep/abc.md'],
  (item) => item,
)
assert(ranked[0]?.item === 'deep/abc.md' || ranked[0]?.item === 'x/a/b/c.md', 'fuzzy filter ranks hits')

assert(basename('C:/tmp/a/b.md') === 'b.md', 'basename')
assert(isMarkdownPath('note.md') && isMarkdownPath('note.markdown'), 'md ext')
assert(!isMarkdownPath('app.ts'), 'non md')
assert(joinPath('C:/root', 'a.md') === 'C:/root/a.md', 'joinPath slash')
assert(relativePath('C:/root', 'C:/root/docs/a.md') === 'docs/a.md', 'relativePath')

const md = 'Hello world\nhello again\n中文 hello'
const plain = findDocMatches(md, 'hello', false, false)
assert(plain.length === 3, `plain matches: ${plain.length}`)
const caseHit = findDocMatches(md, 'Hello', true, false)
assert(caseHit.length === 1, `case matches: ${caseHit.length}`)
const regexHit = findDocMatches(md, 'h.llo', false, true)
assert(regexHit.length === 3, `regex matches: ${regexHit.length}`)

assert(lineOfOffset(md, 0) === 1, 'line 1')
assert(lineOfOffset(md, 12) === 2, 'line 2')

const all = replaceDocAll(md, 'hello', 'HI', false, false)
assert(all === 'HI world\nHI again\n中文 HI', `replace all: ${JSON.stringify(all)}`)

const one = replaceDocOnce(md, plain[1]!, 'hello', 'BYE', false, false)
assert(one === 'Hello world\nBYE again\n中文 hello', `replace once: ${JSON.stringify(one)}`)

const groups = replaceDocAll('id=42', 'id=(\\d+)', 'num=$1', true, true)
assert(groups === 'num=42', `regex groups: ${groups}`)

const targets = collectSearchTargets(
  { root: '/w', files: ['/w/a.md', '/w/b.txt'] },
  ['/w/a.md', '/other/c.md', '/w/no.txt'],
)
assert(targets.length === 2, `targets: ${targets.length}`)
assert(targets.includes('/w/a.md') && targets.includes('/other/c.md'), 'target contents')

console.log('SMOKE UI A2 OK: fuzzy/find/replace/paths/targets')

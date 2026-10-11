/**
 * Smoke: 文件树 glob 过滤.
 *
 * Two rules do most of the work and are the ones a naive implementation gets
 * wrong: `*` must not cross a `/`, and **the last matching pattern wins** —
 * without that, a broad include can never be narrowed again, and `!draft-*`
 * would be an exclude that another pattern then silently undoes.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const { parseGlobPattern, parseGlobList, matchesGlobList, filterPaths } = await import(
  '../src/globFilter'
)

const match = (path: string, list: string): boolean =>
  matchesGlobList(path, parseGlobList(list))

// ---- parsing ---------------------------------------------------------------
assert(parseGlobPattern('') === null, 'a blank pattern is not a rule')
assert(parseGlobPattern('   ') === null, 'nor is whitespace')
assert(parseGlobPattern('# comment') === null, 'nor is a comment')
assert(parseGlobPattern('!') === null, 'a bare `!` excludes nothing')
assert(parseGlobPattern('*.md')?.negated === false, 'a plain pattern includes')
assert(parseGlobPattern('!*.md')?.negated === true, 'a `!` pattern excludes')
assert(parseGlobPattern('!*.md')?.pattern === '*.md', 'the `!` is not part of the pattern')
assert(parseGlobPattern('a/b')?.anchored === true, 'a slash anchors')
assert(parseGlobPattern('*.md')?.anchored === false, 'no slash does not anchor')
// Newlines and commas are both separators, blank lines and comments are skipped.
assert(parseGlobList('*.md\n\n# x\n!draft-*').length === 2, 'list parsing skips blanks/comments')
assert(parseGlobList('*.md, !draft-*').length === 2, 'commas separate too')

// ---- `*` does not cross a slash --------------------------------------------
assert(match('a.md', '*.md'), 'a bare name matches')
assert(match('notes/a.md', '*.md'), 'and matches at depth (unanchored ⇒ basename)')
assert(match('notes/deep/a.md', '*.md'), 'at any depth')
assert(match('a/b.md', 'a/*.md'), 'an anchored single level matches')
assert(!match('a/b/c.md', 'a/*.md'), '`*` must not cross a slash')
assert(match('a/b/c.md', 'a/**/*.md'), '`**` crosses slashes')
assert(match('a/c.md', 'a/**/*.md'), '`**/` also matches zero directories')
assert(match('a.md', '**/*.md'), 'a leading `**/` matches at the root too')
assert(match('a/b/c.md', 'a/**'), 'a trailing `**` takes everything below')
assert(match('notes/x.txt', 'notes/*'), 'a one-level wildcard')
assert(!match('notes/dir/x.txt', 'notes/*'), 'but not deeper')
assert(match('ab.md', 'a?.md'), '`?` is exactly one character')
assert(!match('a.md', 'a?.md'), '`?` needs a character to consume')
assert(match('file2.md', 'file[0-9].md'), 'a character class works')
assert(!match('filex.md', 'file[0-9].md'), 'and rejects what it does not cover')

// ---- last match wins -------------------------------------------------------
assert(!match('draft-1.md', '*.md\n!draft-*'), 'an exclude after an include wins')
assert(match('draft-1.md', '!draft-*\n*.md'), 'an include after an exclude wins')
assert(!match('a/draft-1.md', '*.md\n!draft-*'), 'the exclude reaches into subfolders')
// A broad exclude narrowed again — the case that motivates last-match-wins.
assert(match('keep/draft-1.md', '!draft-*\nkeep/**'), 'a later include rescues it')
assert(!match('other/draft-1.md', '!draft-*\nkeep/**'), 'but only under keep/')

// ---- empty filter hides nothing --------------------------------------------
assert(match('anything.md', ''), 'no rules means everything passes')
assert(match('a/b/c.txt', '   \n# just a comment'), 'so does a comment-only filter')
assert(filterPaths(['a.md', 'b.txt'], []).join(',') === 'a.md,b.txt', 'filterPaths keeps all')
assert(filterPaths(['a.md', 'b.txt'], parseGlobList('*.md')).join(',') === 'a.md', 'and filters')
// Returning a copy, not the caller's array: a filter must not mutate its input.
const input = ['a.md']
assert(filterPaths(input, []) !== input, 'filterPaths returns a new array')

// ---- the rules are actually meaningful for a file tree ---------------------
assert(
  filterPaths(
    ['README.md', 'draft-notes.md', 'src/index.md', 'src/draft-old.md', 'logo.png'],
    parseGlobList('*.md\n!draft-*'),
  ).join(',') === 'README.md,src/index.md',
  'only markdown, no drafts',
)

console.log('SMOKE CORE GLOB OK: * / ** / ? / [] + anchoring + last-match-wins + empty hides nothing')

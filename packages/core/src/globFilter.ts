/**
 * 文件树 glob 过滤.
 *
 * A list of patterns for the file tree: positives include, `!`-prefixed ones
 * exclude, and **the last pattern that matches wins** — the same rule gitignore
 * and Typora use, and the only one that lets a broad include be narrowed again
 * without rewriting it.
 *
 * Two glob details matter more than they look:
 *   - `*` does not cross a `/`, so `*.md` means "a markdown file in one
 *     directory", not "any markdown file anywhere".
 *   - A pattern with no `/` in it matches the **basename at any depth**, which is
 *     what makes `!draft-*` mean what a reader expects.
 */

export interface GlobRule {
  /** The pattern as written, without the `!`. */
  pattern: string
  negated: boolean
  /** True when the pattern contains a `/` and must be matched against the path. */
  anchored: boolean
  matcher: RegExp
}

const REGEX_META = /[.+^${}()|\\]/

/**
 * Compile one glob into a regexp source fragment.
 *
 * `**` is handled as a unit before `*`, because turning `**` into two `[^/]*`
 * would make it stop at the first slash — the one thing `**` exists to avoid.
 */
function globToRegExpSource(pattern: string): string {
  let out = ''
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i]!
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` — any number of leading directories, including none.
        if (pattern[i + 2] === '/') {
          out += '(?:.*/)?'
          i += 2
        } else {
          out += '.*'
          i += 1
        }
      } else {
        out += '[^/]*'
      }
      continue
    }
    if (char === '?') {
      out += '[^/]'
      continue
    }
    if (char === '[') {
      // A character class passes through, so `[0-9]` and `[!a-z]` work.
      const close = pattern.indexOf(']', i + 1)
      if (close > i) {
        const body = pattern.slice(i + 1, close).replace(/^!/, '^')
        out += `[${body}]`
        i = close
        continue
      }
    }
    out += REGEX_META.test(char) ? `\\${char}` : char
  }
  return out
}

/** A single rule, or null when the pattern is blank. */
export function parseGlobPattern(pattern: string): GlobRule | null {
  const trimmed = pattern.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  const negated = trimmed.startsWith('!')
  const body = (negated ? trimmed.slice(1) : trimmed).trim()
  if (!body) return null
  // A leading `/` anchors to the root; it is not part of the text to match.
  const anchored = body.includes('/')
  const source = globToRegExpSource(body.replace(/^\//, ''))
  return {
    pattern: body,
    negated,
    anchored,
    matcher: new RegExp(`^${source}$`),
  }
}

/**
 * Parse a whole list. Accepts newlines and commas, skips blanks and `#` comments —
 * a filter that a user types into one box should tolerate both spellings.
 */
export function parseGlobList(text: string): GlobRule[] {
  return text
    .split(/[\n,]/)
    .map((line) => parseGlobPattern(line))
    .filter((rule): rule is GlobRule => rule !== null)
}

/** True when `rule` matches `path`, honouring anchoring and basename matching. */
function ruleMatches(rule: GlobRule, path: string): boolean {
  if (rule.matcher.test(path)) return true
  // An unanchored pattern may match any path segment's tail, so `!draft-*`
  // excludes `a/b/draft-1.md` as well as `draft-1.md`.
  if (rule.anchored) return false
  const segments = path.split('/')
  for (let i = 0; i < segments.length; i += 1) {
    if (rule.matcher.test(segments.slice(i).join('/'))) return true
    if (rule.matcher.test(segments[i]!)) return true
  }
  return false
}

/**
 * Whether `path` passes the list. No rules means everything passes — an empty
 * filter hides nothing, which is the only sane default for a file tree.
 */
export function matchesGlobList(path: string, rules: GlobRule[]): boolean {
  if (rules.length === 0) return true
  let included = false
  for (const rule of rules) {
    if (ruleMatches(rule, path)) included = !rule.negated
  }
  return included
}

/** Filter a list of relative paths. */
export function filterPaths(paths: string[], rules: GlobRule[]): string[] {
  if (rules.length === 0) return [...paths]
  return paths.filter((path) => matchesGlobList(path, rules))
}

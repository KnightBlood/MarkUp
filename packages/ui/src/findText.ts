export interface DocMatch {
  start: number
  end: number
  line: number
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function lineOfOffset(markdown: string, offset: number): number {
  let line = 1
  const end = Math.min(Math.max(offset, 0), markdown.length)
  for (let i = 0; i < end; i++) {
    if (markdown.charCodeAt(i) === 10) line += 1
  }
  return line
}

export function buildFindRegex(
  query: string,
  caseSensitive: boolean,
  useRegex: boolean,
  global = true,
): RegExp | null {
  if (!query) return null
  try {
    const source = useRegex ? query : escapeRegExp(query)
    const flags = (global ? 'g' : '') + (caseSensitive ? '' : 'i')
    return new RegExp(source, flags)
  } catch {
    return null
  }
}

export function findDocMatches(
  markdown: string,
  query: string,
  caseSensitive: boolean,
  useRegex: boolean,
): DocMatch[] {
  const re = buildFindRegex(query, caseSensitive, useRegex, true)
  if (!re) return []
  const matches: DocMatch[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    const start = m.index
    const end = start + Math.max(m[0].length, 1)
    matches.push({ start, end, line: lineOfOffset(markdown, start) })
    if (matches.length >= 5000) break
    if (m[0].length === 0) re.lastIndex += 1
  }
  return matches
}

function expandRegexTemplate(template: string, groups: string[]): string {
  return template.replace(/\$(\$|&|\d{1,2})/g, (_whole, token: string) => {
    if (token === '$') return '$'
    if (token === '&') return groups[0] ?? ''
    const index = Number(token)
    if (Number.isNaN(index) || index < 1) return `$${token}`
    return groups[index] ?? ''
  })
}

export function replaceDocOnce(
  markdown: string,
  match: DocMatch,
  query: string,
  template: string,
  caseSensitive: boolean,
  useRegex: boolean,
): string {
  const head = markdown.slice(0, match.start)
  const tail = markdown.slice(match.end)
  if (!useRegex) return head + template + tail

  const re = buildFindRegex(query, caseSensitive, true, false)
  if (!re) return head + template + tail

  const sticky = new RegExp(re.source, re.flags + 'y')
  sticky.lastIndex = match.start
  const hit = sticky.exec(markdown)
  if (!hit) return head + template + tail
  return head + expandRegexTemplate(template, [...hit]) + tail
}

export function replaceDocAll(
  markdown: string,
  query: string,
  template: string,
  caseSensitive: boolean,
  useRegex: boolean,
): string {
  const re = buildFindRegex(query, caseSensitive, useRegex, true)
  if (!re) return markdown
  if (!useRegex) return markdown.replace(re, template.replace(/\$/g, '$$$$'))
  return markdown.replace(re, (...args) => {
    const groups = args.slice(0, -2).map((value) => String(value ?? ''))
    return expandRegexTemplate(template, groups)
  })
}

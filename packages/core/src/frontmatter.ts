export interface FrontmatterSplit {
  frontmatter: string
  body: string
}

const FM_OPEN = /^---\r?\n/

export function splitFrontmatter(markdown: string): FrontmatterSplit {
  if (!FM_OPEN.test(markdown)) return { frontmatter: '', body: markdown }
  const lines = markdown.split(/\r?\n/)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (line === '---' || line === '...') {
      const cut = lines.slice(0, i + 1).join('\n')
      const rest = lines.slice(i + 1).join('\n')
      const body = rest.startsWith('\n') ? rest.slice(1) : rest
      return { frontmatter: cut, body }
    }
  }
  return { frontmatter: '', body: markdown }
}

export function joinFrontmatter(split: FrontmatterSplit): string {
  if (!split.frontmatter) return split.body
  return `${split.frontmatter}\n\n${split.body}`
}

export function hasFrontmatter(markdown: string): boolean {
  return splitFrontmatter(markdown).frontmatter !== ''
}

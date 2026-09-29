export interface FuzzyResult {
  score: number
  positions: number[]
}

export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  if (!query) return { score: 0, positions: [] }
  const q = query.toLowerCase()
  const t = target.toLowerCase()

  const substring = t.indexOf(q)
  if (substring >= 0) {
    const positions = Array.from({ length: q.length }, (_, i) => substring + i)
    let score = 1000 - substring
    if (substring === 0) score += 500
    if (substring > 0 && /[\s/\\_.-]/.test(t[substring - 1] ?? '')) score += 80
    return { score, positions }
  }

  let ti = 0
  const positions: number[] = []
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!
    let found = -1
    while (ti < t.length) {
      if (t[ti] === ch) {
        found = ti
        break
      }
      ti++
    }
    if (found < 0) return null
    positions.push(found)
    ti++
  }

  let score = 100
  if (positions[0] === 0) score += 50
  score -= Math.min(positions[0] ?? 0, 40)
  for (let i = 1; i < positions.length; i++) {
    const prev = positions[i - 1]!
    const cur = positions[i]!
    if (cur === prev + 1) score += 12
  }
  return { score, positions }
}

export function fuzzyFilter<T>(
  query: string,
  items: T[],
  getText: (item: T) => string,
): { item: T; score: number }[] {
  if (!query.trim()) {
    return items.map((item) => ({ item, score: 0 }))
  }
  const hits: { item: T; score: number }[] = []
  for (const item of items) {
    const text = getText(item)
    const direct = fuzzyMatch(query, text)
    if (direct) {
      hits.push({ item, score: direct.score })
      continue
    }
    const base = text.split(/[\\/]/).pop() ?? text
    const baseHit = fuzzyMatch(query, base)
    if (baseHit) hits.push({ item, score: baseHit.score - 50 })
  }
  hits.sort((a, b) => b.score - a.score)
  return hits
}

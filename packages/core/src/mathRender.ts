import katex from 'katex'

export type MathLang = 'math' | 'latex' | 'tex' | 'katex'

const MATH_ALIASES: Record<string, MathLang> = {
  math: 'math',
  latex: 'latex',
  tex: 'tex',
  katex: 'katex',
  formula: 'math',
}

export function normalizeMathLang(lang?: string | null): MathLang | null {
  if (!lang) return null
  const key = lang.trim().toLowerCase()
  if (!key) return null
  return MATH_ALIASES[key] ?? null
}

export function renderMath(source: string, container: HTMLElement, displayMode: boolean): void {
  katex.render(source, container, {
    displayMode,
    throwOnError: false,
    output: 'html',
    strict: 'ignore',
  })
}

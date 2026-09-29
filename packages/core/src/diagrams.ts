export type DiagramLang = 'mermaid' | 'flow'

const DIAGRAM_ALIASES: Record<string, DiagramLang> = {
  mermaid: 'mermaid',
  mmd: 'mermaid',
  graph: 'mermaid',
  flow: 'flow',
  flowchart: 'flow',
  'flowchart.js': 'flow',
}

export function normalizeDiagramLang(lang?: string | null): DiagramLang | null {
  if (!lang) return null
  const key = lang.trim().toLowerCase()
  if (!key) return null
  return DIAGRAM_ALIASES[key] ?? null
}

interface FlowchartApi {
  parse(code: string): { drawSVG(container: HTMLElement): void }
}

type FlowchartNamespace = Partial<FlowchartApi> & { default?: Partial<FlowchartApi> }

let mermaidReady = false

async function renderMermaid(code: string, container: HTMLElement): Promise<void> {
  const { default: mermaid } = await import('mermaid')
  if (!mermaidReady) {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' })
    mermaidReady = true
  }
  const id = `mk-diagram-${Math.random().toString(36).slice(2, 10)}`
  const { svg, bindFunctions } = await mermaid.render(id, code)
  container.innerHTML = svg
  bindFunctions?.(container)
}

async function renderFlow(code: string, container: HTMLElement): Promise<void> {
  const raw = (await import('flowchart.js')) as unknown as FlowchartNamespace
  const api = typeof raw.parse === 'function' ? raw : raw.default
  if (!api || typeof api.parse !== 'function') {
    throw new Error('flowchart.js 模块加载失败')
  }
  api.parse(code).drawSVG(container)
}

export async function renderDiagram(lang: DiagramLang, code: string, container: HTMLElement): Promise<void> {
  const source = code.trim()
  if (!source) throw new Error('图表源码为空')
  if (lang === 'mermaid') {
    await renderMermaid(source, container)
    return
  }
  await renderFlow(source, container)
}

export interface HydrateResult {
  rendered: number
  failed: number
}

export async function hydrateDiagrams(root: ParentNode): Promise<HydrateResult> {
  const selector = '.md-diagram[data-diagram]'
  const candidates: Element[] = []
  const maybeSelf = root as Partial<Element>
  if (typeof maybeSelf.matches === 'function' && maybeSelf.matches(selector)) {
    candidates.push(root as Element)
  }
  candidates.push(...root.querySelectorAll<HTMLElement>(selector))
  const nodes = candidates as HTMLElement[]
  const result: HydrateResult = { rendered: 0, failed: 0 }
  for (const el of nodes) {
    if (el.dataset.rendered !== undefined || el.dataset.error !== undefined) continue
    const lang = normalizeDiagramLang(el.dataset.diagram)
    const sourceEl = el.querySelector('.md-diagram__source')
    if (!lang || !sourceEl) continue
    const code = sourceEl.textContent ?? ''
    if (!code.trim()) {
      el.dataset.rendered = '1'
      continue
    }
    const canvas = document.createElement('div')
    canvas.className = 'md-diagram__canvas'
    el.append(canvas)
    try {
      await renderDiagram(lang, code, canvas)
      el.dataset.rendered = '1'
      result.rendered += 1
    } catch (error) {
      canvas.remove()
      el.dataset.error = '1'
      el.classList.add('md-diagram--error')
      console.error('[markup] 流程图渲染失败', lang, error)
      result.failed += 1
    }
  }
  return result
}

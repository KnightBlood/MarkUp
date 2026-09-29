import { renderMath } from '../../../core/src/mathRender'
import { el } from '../dom'

export type FormulaMode = 'block' | 'inline'

export interface FormulaResult {
  latex: string
  mode: FormulaMode
}

export interface FormulaOpenOptions {
  latex?: string
  mode?: FormulaMode
  title?: string
  onConfirm: (result: FormulaResult) => void
  onCancel?: () => void
}

export interface FormulaEditorApi {
  el: HTMLElement
  open: (options?: FormulaOpenOptions) => void
  close: () => void
  isOpen: () => boolean
  getLatex: () => string
  getMode: () => FormulaMode
}

interface FormulaTemplate {
  id: string
  label: string
  latex: string
  category: TemplateCategory
}

type TemplateCategory = 'structure' | 'operator' | 'greek' | 'relation' | 'arrow'

const TEMPLATE_CATEGORIES: Array<{ id: TemplateCategory; label: string }> = [
  { id: 'structure', label: '结构' },
  { id: 'operator', label: '运算' },
  { id: 'relation', label: '关系' },
  { id: 'arrow', label: '箭头' },
  { id: 'greek', label: '希腊' },
]

const TEMPLATES: FormulaTemplate[] = [
  { id: 'frac', label: '分数', latex: '\\frac{a}{b}', category: 'structure' },
  { id: 'sqrt', label: '根号', latex: '\\sqrt{x}', category: 'structure' },
  { id: 'nthroot', label: 'n 次根', latex: '\\sqrt[n]{x}', category: 'structure' },
  { id: 'pow', label: '上标', latex: 'x^{n}', category: 'structure' },
  { id: 'sub', label: '下标', latex: 'x_{n}', category: 'structure' },
  { id: 'paren', label: '括号', latex: '\\left( x \\right)', category: 'structure' },
  { id: 'abs', label: '绝对值', latex: '\\left| x \\right|', category: 'structure' },
  { id: 'matrix', label: '矩阵', latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', category: 'structure' },
  { id: 'cases', label: '分段', latex: '\\begin{cases} a & x>0 \\\\ b & x\\le 0 \\end{cases}', category: 'structure' },
  { id: 'vector', label: '向量', latex: '\\vec{v}', category: 'structure' },
  { id: 'hat', label: '帽子', latex: '\\hat{x}', category: 'structure' },
  { id: 'bar', label: '上划线', latex: '\\bar{x}', category: 'structure' },

  { id: 'sum', label: '求和', latex: '\\sum_{i=1}^{n} a_i', category: 'operator' },
  { id: 'prod', label: '连乘', latex: '\\prod_{i=1}^{n} a_i', category: 'operator' },
  { id: 'int', label: '积分', latex: '\\int_{a}^{b} f(x)\\,dx', category: 'operator' },
  { id: 'iint', label: '二重积分', latex: '\\iint_{D} f(x,y)\\,dA', category: 'operator' },
  { id: 'oint', label: '环路积分', latex: '\\oint_{C} \\mathbf{F}\\cdot d\\mathbf{r}', category: 'operator' },
  { id: 'lim', label: '极限', latex: '\\lim_{x \\to 0} f(x)', category: 'operator' },
  { id: 'partial', label: '偏导', latex: '\\frac{\\partial f}{\\partial x}', category: 'operator' },
  { id: 'nabla', label: '梯度', latex: '\\nabla f', category: 'operator' },
  { id: 'infty', label: '无穷', latex: '\\infty', category: 'operator' },
  { id: 'pm', label: '±', latex: '\\pm', category: 'operator' },
  { id: 'cdot', label: '点乘', latex: '\\cdot', category: 'operator' },
  { id: 'times', label: '叉乘', latex: '\\times', category: 'operator' },
  { id: 'div', label: '除', latex: '\\div', category: 'operator' },

  { id: 'eq', label: '=', latex: '=', category: 'relation' },
  { id: 'neq', label: '≠', latex: '\\neq', category: 'relation' },
  { id: 'approx', label: '≈', latex: '\\approx', category: 'relation' },
  { id: 'leq', label: '≤', latex: '\\leq', category: 'relation' },
  { id: 'geq', label: '≥', latex: '\\geq', category: 'relation' },
  { id: 'equiv', label: '≡', latex: '\\equiv', category: 'relation' },
  { id: 'propto', label: '∝', latex: '\\propto', category: 'relation' },
  { id: 'in', label: '∈', latex: '\\in', category: 'relation' },
  { id: 'notin', label: '∉', latex: '\\notin', category: 'relation' },
  { id: 'subset', label: '⊂', latex: '\\subset', category: 'relation' },
  { id: 'ldots', label: '…', latex: '\\ldots', category: 'relation' },

  { id: 'to', label: '→', latex: '\\to', category: 'arrow' },
  { id: 'rightarrow', label: '⇒', latex: '\\Rightarrow', category: 'arrow' },
  { id: 'leftrightarrow', label: '↔', latex: '\\leftrightarrow', category: 'arrow' },
  { id: 'Leftrightarrow', label: '⇔', latex: '\\Leftrightarrow', category: 'arrow' },
  { id: 'mapsto', label: '↦', latex: '\\mapsto', category: 'arrow' },
  { id: 'uparrow', label: '↑', latex: '\\uparrow', category: 'arrow' },
  { id: 'downarrow', label: '↓', latex: '\\downarrow', category: 'arrow' },

  { id: 'alpha', label: 'α', latex: '\\alpha', category: 'greek' },
  { id: 'beta', label: 'β', latex: '\\beta', category: 'greek' },
  { id: 'gamma', label: 'γ', latex: '\\gamma', category: 'greek' },
  { id: 'delta', label: 'δ', latex: '\\delta', category: 'greek' },
  { id: 'epsilon', label: 'ε', latex: '\\varepsilon', category: 'greek' },
  { id: 'theta', label: 'θ', latex: '\\theta', category: 'greek' },
  { id: 'lambda', label: 'λ', latex: '\\lambda', category: 'greek' },
  { id: 'mu', label: 'μ', latex: '\\mu', category: 'greek' },
  { id: 'pi', label: 'π', latex: '\\pi', category: 'greek' },
  { id: 'sigma', label: 'σ', latex: '\\sigma', category: 'greek' },
  { id: 'phi', label: 'φ', latex: '\\phi', category: 'greek' },
  { id: 'omega', label: 'ω', latex: '\\omega', category: 'greek' },
  { id: 'Gamma', label: 'Γ', latex: '\\Gamma', category: 'greek' },
  { id: 'Delta', label: 'Δ', latex: '\\Delta', category: 'greek' },
  { id: 'Sigma', label: 'Σ', latex: '\\Sigma', category: 'greek' },
  { id: 'Omega', label: 'Ω', latex: '\\Omega', category: 'greek' },
]

let mathliveReady: Promise<boolean> | null = null

async function ensureMathlive(): Promise<boolean> {
  if (!mathliveReady) {
    mathliveReady = (async () => {
      try {
        const mod = await import('mathlive')
        const MathfieldElement = (mod as { MathfieldElement?: typeof import('mathlive').MathfieldElement }).MathfieldElement
        if (!MathfieldElement) return false
        MathfieldElement.fontsDirectory = null
        MathfieldElement.soundsDirectory = null
        await import('mathlive/fonts.css')
        return true
      } catch (error) {
        console.warn('[markup] mathlive load failed, fallback to LaTeX source', error)
        return false
      }
    })()
  }
  return mathliveReady
}

export function createFormulaEditor(): FormulaEditorApi {
  let openState: FormulaOpenOptions | null = null
  let latex = ''
  let mode: FormulaMode = 'block'
  let activeCategory: TemplateCategory = 'structure'
  let mathField: HTMLElement | null = null
  let mathliveAvailable = false

  const titleEl = el('h2', { class: 'settings__title', text: '插入公式' })
  const closeBtn = el('button', {
    class: 'settings__close',
    type: 'button',
    text: '×',
    'aria-label': '关闭',
    onclick: () => close(),
  })

  const modeBlock = el('input', {
    type: 'radio',
    name: 'formula-mode',
    value: 'block',
    id: 'formula-mode-block',
    onchange: () => setMode('block'),
  })
  const modeInline = el('input', {
    type: 'radio',
    name: 'formula-mode',
    value: 'inline',
    id: 'formula-mode-inline',
    onchange: () => setMode('inline'),
  })
  const modeLabels = el(
    'div',
    { class: 'formula__modes' },
    el('label', { class: 'formula__mode' }, modeBlock, el('span', { text: '块级公式（```math）' })),
    el('label', { class: 'formula__mode' }, modeInline, el('span', { text: '行内公式（$…$）' })),
  )

  const visualHost = el('div', { class: 'formula__visual', text: '正在加载可视化编辑器…' })
  const sourceArea = el('textarea', {
    class: 'formula__source',
    rows: '4',
    spellcheck: 'false',
    placeholder: '输入 LaTeX，例如 \\frac{a}{b}',
    'aria-label': 'LaTeX 源码',
    oninput: () => {
      latex = sourceArea.value
      syncFromSource()
    },
  }) as HTMLTextAreaElement

  const preview = el('div', { class: 'formula__preview', 'aria-label': '预览' })
  const statusEl = el('div', { class: 'formula__status', text: '' })

  const categoryBar = el(
    'div',
    { class: 'formula__cats', role: 'tablist' },
    ...TEMPLATE_CATEGORIES.map((cat) =>
      el('button', {
        class: `formula__cat${cat.id === activeCategory ? ' is-active' : ''}`,
        type: 'button',
        text: cat.label,
        'data-cat': cat.id,
        onclick: () => setCategory(cat.id),
      }),
    ),
  )

  const templateList = el('div', { class: 'formula__templates' })

  const clearBtn = el('button', {
    class: 'btn formula__btn',
    type: 'button',
    text: '清除',
    onclick: () => {
      latex = ''
      sourceArea.value = ''
      if (mathField && 'value' in mathField) {
        ;(mathField as HTMLElement & { value: string }).value = ''
      }
      refreshPreview()
    },
  })
  const cancelBtn = el('button', {
    class: 'btn formula__btn',
    type: 'button',
    text: '取消',
    onclick: () => close(),
  })
  const confirmBtn = el('button', {
    class: 'btn btn--primary formula__btn formula__btn--primary',
    type: 'button',
    text: '插入',
    onclick: () => confirm(),
  })

  const panel = el(
    'div',
    { class: 'settings__panel formula__panel', role: 'dialog', 'aria-label': '公式编辑器' },
    el(
      'header',
      { class: 'settings__header' },
      titleEl,
      closeBtn,
    ),
    el(
      'div',
      { class: 'settings__body formula__body' },
      modeLabels,
      visualHost,
      el(
        'label',
        { class: 'formula__field' },
        el('span', { class: 'formula__label', text: 'LaTeX 源码' }),
        sourceArea,
      ),
      el(
        'div',
        { class: 'formula__field' },
        el('span', { class: 'formula__label', text: '预览（KaTeX）' }),
        preview,
      ),
      statusEl,
      el(
        'div',
        { class: 'formula__palette' },
        categoryBar,
        templateList,
      ),
      el(
        'footer',
        { class: 'formula__footer' },
        clearBtn,
        el('div', { class: 'formula__spacer' }),
        cancelBtn,
        confirmBtn,
      ),
    ),
  )
  const root = el('div', { class: 'settings formula', hidden: true }, panel)

  function setCategory(cat: TemplateCategory): void {
    activeCategory = cat
    for (const btn of categoryBar.querySelectorAll<HTMLButtonElement>('.formula__cat')) {
      btn.classList.toggle('is-active', btn.dataset.cat === cat)
    }
    renderTemplates()
  }

  function renderTemplates(): void {
    templateList.replaceChildren()
    for (const t of TEMPLATES) {
      if (t.category !== activeCategory) continue
      templateList.append(
        el('button', {
          class: 'formula__tpl',
          type: 'button',
          text: t.label,
          title: t.latex,
          onclick: () => insertLatex(t.latex),
        }),
      )
    }
  }

  function insertLatex(snippet: string): void {
    const area = sourceArea
    const start = area.selectionStart ?? latex.length
    const end = area.selectionEnd ?? start
    const before = latex.slice(0, start)
    const after = latex.slice(end)
    latex = before + snippet + after
    area.value = latex
    const caret = start + snippet.length
    area.selectionStart = caret
    area.selectionEnd = caret
    syncFromSource()
    area.focus()
  }

  function setMode(next: FormulaMode): void {
    mode = next
    modeBlock.checked = next === 'block'
    modeInline.checked = next === 'inline'
    refreshPreview()
  }

  function syncFromSource(): void {
    latex = sourceArea.value
    if (mathField && mathField !== sourceArea) {
      try {
        ;(mathField as HTMLElement & { value: string }).value = latex
      } catch {
        /* ignore */
      }
    }
    refreshPreview()
  }

  function syncFromMathfield(value: string): void {
    latex = value
    sourceArea.value = value
    refreshPreview()
  }

  function refreshPreview(): void {
    preview.replaceChildren()
    if (!latex.trim()) {
      statusEl.textContent = '在上方输入或点击模板插入公式'
      statusEl.className = 'formula__status'
      return
    }
    try {
      renderMath(latex, preview, mode === 'block')
      statusEl.textContent = mode === 'block' ? '块级公式 · KaTeX 渲染正常' : '行内公式 · KaTeX 渲染正常'
      statusEl.className = 'formula__status formula__status--ok'
    } catch (error) {
      statusEl.textContent = `LaTeX 错误：${error instanceof Error ? error.message : String(error)}`
      statusEl.className = 'formula__status formula__status--bad'
    }
  }

  async function mountMathlive(): Promise<void> {
    mathliveAvailable = await ensureMathlive()
    if (!mathliveAvailable) {
      visualHost.replaceChildren(
        el('div', {
          class: 'formula__fallback',
          text: '可视化编辑器不可用，已使用 LaTeX 源码模式（功能完整，仅无点选输入）。',
        }),
      )
      return
    }
    try {
      const { MathfieldElement } = await import('mathlive')
      const mf = new MathfieldElement({
        smartMode: true,
        inlineShortcuts: {
          '^': '^{#?}',
          '_': '_{#?}',
          '/': '\\frac{#?}{#?}',
        },
      })
      mf.mathVirtualKeyboardPolicy = 'manual'
      mf.value = latex
      mf.className = 'formula__mathfield'
      mf.setAttribute('aria-label', '可视化公式输入')
      mf.addEventListener('input', () => {
        syncFromMathfield(String(mf.value ?? ''))
      })
      visualHost.replaceChildren(mf)
      mathField = mf as unknown as HTMLElement
      const kbBtn = el('button', {
        class: 'btn formula__btn',
        type: 'button',
        text: '符号键盘',
        onclick: () => {
          try {
            mf.executeCommand('toggleVirtualKeyboard')
          } catch {
            /* ignore */
          }
        },
      })
      visualHost.append(kbBtn)
    } catch (error) {
      console.warn('[markup] mathlive mount failed', error)
      visualHost.replaceChildren(
        el('div', {
          class: 'formula__fallback',
          text: '可视化编辑器初始化失败，可直接编辑 LaTeX 源码。',
        }),
      )
    }
  }

  function confirm(): void {
    const result: FormulaResult = { latex: latex.trim(), mode }
    if (!result.latex) {
      statusEl.textContent = '公式内容为空'
      statusEl.className = 'formula__status formula__status--bad'
      return
    }
    const opts = openState
    close()
    opts?.onConfirm(result)
  }

  function hideVirtualKeyboard(): void {
    try {
      const w = window as { mathVirtualKeyboard?: { hide?: () => void; visible?: boolean } }
      if (w.mathVirtualKeyboard?.visible) w.mathVirtualKeyboard.hide?.()
    } catch {
      /* ignore */
    }
  }

  function close(): void {
    if (root.hidden) return
    const opts = openState
    openState = null
    root.hidden = true
    hideVirtualKeyboard()
    try {
      ;(document.documentElement as HTMLElement & { style?: CSSStyleDeclaration }).style?.removeProperty?.(
        '--keyboard-zindex',
      )
    } catch {
      /* ignore */
    }
    visualHost.replaceChildren(
      el('div', { class: 'formula__fallback', text: '正在加载可视化编辑器…' }),
    )
    mathField = null
    opts?.onCancel?.()
  }

  function open(options?: FormulaOpenOptions): void {
    openState = options ?? null
    latex = options?.latex ?? ''
    mode = options?.mode ?? 'block'
    titleEl.textContent = options?.title ?? (options?.latex ? '编辑公式' : '插入公式')
    const isEdit = Boolean(options?.latex)
    confirmBtn.textContent = isEdit ? '替换' : '插入'
    sourceArea.value = latex
    modeBlock.checked = mode === 'block'
    modeInline.checked = mode === 'inline'
    setCategory(activeCategory)
    visualHost.replaceChildren(
      el('div', { class: 'formula__fallback', text: '正在加载可视化编辑器…' }),
    )
    mathField = null
    root.hidden = false
    hideVirtualKeyboard()
    try {
      ;(document.documentElement as HTMLElement & { style?: CSSStyleDeclaration }).style?.setProperty?.(
        '--keyboard-zindex',
        '140',
      )
    } catch {
      /* ignore */
    }
    refreshPreview()
    void mountMathlive()
    sourceArea.focus()
  }

  root.addEventListener('click', (event) => {
    if (event.target === root) close()
  })
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      close()
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      confirm()
    }
  })

  renderTemplates()

  return {
    el: root,
    open,
    close,
    isOpen: () => !root.hidden,
    getLatex: () => latex,
    getMode: () => mode,
  }
}

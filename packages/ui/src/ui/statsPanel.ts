/**
 * 字数统计浮窗 — Typora's 字数统计 window.
 *
 * The shell already counts a document for the status bar; this is the same
 * numbers in a panel, plus the selection and a reading-time estimate. Kept as
 * its own component so the status bar (one line, always visible) and this
 * (several lines, on demand) can format the same input differently.
 */

export interface StatsInput {
  words: number
  chars: number
  lines: number
}

export interface StatsPanelApi {
  el: HTMLElement
  /** Re-render. `selection` is null when nothing is selected. */
  update(document: StatsInput, selection: StatsInput | null): void
  toggle(): void
  open(): void
  close(): void
  readonly visible: boolean
}

/** Blended 字/词 per minute: the usual heuristic for CJK-plus-latin text. */
export const WORDS_PER_MINUTE = 300

/**
 * 阅读时长 in whole minutes. Zero words is zero minutes, not one — "约 1 分钟" for
 * an empty document reads as a bug.
 */
export function readingMinutes(words: number): number {
  if (words <= 0) return 0
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE))
}

/** `0` → `—`; otherwise `约 N 分钟`. */
export function formatReadingTime(words: number): string {
  const minutes = readingMinutes(words)
  return minutes === 0 ? '—' : `约 ${minutes} 分钟`
}

const ROWS: Array<{ key: keyof StatsInput | 'reading'; label: string }> = [
  { key: 'words', label: '字数' },
  { key: 'chars', label: '字符数' },
  { key: 'lines', label: '行数' },
  { key: 'reading', label: '阅读时长' },
]

export function createStatsPanel(): StatsPanelApi {
  const el = document.createElement('aside')
  el.className = 'stats-panel'
  el.hidden = true
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-label', '字数统计')

  const heading = document.createElement('h2')
  heading.className = 'stats-panel__title'
  heading.textContent = '字数统计'
  el.append(heading)

  const body = document.createElement('div')
  body.className = 'stats-panel__body'
  el.append(body)

  /** Live cell per row, so `update` never rebuilds the DOM. */
  const cells = new Map<string, HTMLElement>()
  const sections: Array<{ title: string; prefix: string }> = [
    { title: '文档', prefix: 'doc' },
    { title: '所选内容', prefix: 'sel' },
  ]
  for (const section of sections) {
    const block = document.createElement('section')
    block.className = 'stats-panel__section'
    const title = document.createElement('h3')
    title.className = 'stats-panel__heading'
    title.textContent = section.title
    block.append(title)
    for (const row of ROWS) {
      const line = document.createElement('div')
      line.className = 'stats-panel__row'
      const label = document.createElement('span')
      label.className = 'stats-panel__label'
      label.textContent = row.label
      const value = document.createElement('span')
      value.className = 'stats-panel__value'
      value.textContent = '—'
      line.append(label, value)
      block.append(line)
      cells.set(`${section.prefix}:${row.key}`, value)
    }
    body.append(block)
  }

  const render = (prefix: string, stats: StatsInput | null): void => {
    for (const row of ROWS) {
      const cell = cells.get(`${prefix}:${row.key}`)
      if (!cell) continue
      if (!stats) {
        cell.textContent = '—'
        continue
      }
      if (row.key === 'reading') cell.textContent = formatReadingTime(stats.words)
      else cell.textContent = String(stats[row.key])
    }
  }

  return {
    el,
    get visible() {
      return !el.hidden
    },
    update(document, selection) {
      render('doc', document)
      render('sel', selection)
    },
    toggle() {
      el.hidden = !el.hidden
    },
    open() {
      el.hidden = false
    },
    close() {
      el.hidden = true
    },
  }
}

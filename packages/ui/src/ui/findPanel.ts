import type { Anchor } from '@markup/core'
import { el } from '../dom'
import {
  findDocMatches,
  replaceDocAll,
  replaceDocOnce,
  type DocMatch,
} from '../findText'

export interface FindReplaceOptions {
  getMarkdown: () => string
  gotoAnchor: (anchor: Anchor) => void
  replaceInDocument: (markdown: string) => void
}

export interface FindPanelApi {
  el: HTMLElement
  open: (withReplace: boolean) => void
  close: () => void
  isOpen: () => boolean
  focusFind: () => void
  findNext: () => void
  findPrev: () => void
}

export function createFindPanel(options: FindReplaceOptions): FindPanelApi {
  let matches: DocMatch[] = []
  let current = -1
  let openState = false

  const findInput = el('input', {
    class: 'find-panel__input',
    type: 'text',
    placeholder: '查找',
    spellcheck: 'false',
    autocomplete: 'off',
  })
  const replaceInput = el('input', {
    class: 'find-panel__input',
    type: 'text',
    placeholder: '替换为',
    spellcheck: 'false',
    autocomplete: 'off',
  })
  const countLabel = el('span', { class: 'find-panel__count', text: '0/0' })
  const caseBtn = el('button', {
    class: 'find-panel__toggle',
    type: 'button',
    text: 'Aa',
    title: '区分大小写',
  })
  const regexBtn = el('button', {
    class: 'find-panel__toggle',
    type: 'button',
    text: '.*',
    title: '正则表达式',
  })
  const prevBtn = el('button', { class: 'find-panel__btn', type: 'button', text: '↑', title: '上一个' })
  const nextBtn = el('button', { class: 'find-panel__btn', type: 'button', text: '↓', title: '下一个' })
  const closeBtn = el('button', { class: 'find-panel__btn', type: 'button', text: '×', title: '关闭' })
  const replaceOneBtn = el('button', { class: 'find-panel__btn', type: 'button', text: '替换' })
  const replaceAllBtn = el('button', { class: 'find-panel__btn', type: 'button', text: '全部' })

  let caseSensitive = false
  let useRegex = false

  const replaceRow = el(
    'div',
    { class: 'find-panel__row find-panel__row--replace', hidden: true },
    replaceInput,
    replaceOneBtn,
    replaceAllBtn,
  )

  const root = el(
    'div',
    { class: 'find-panel', hidden: true },
    el(
      'div',
      { class: 'find-panel__row' },
      findInput,
      countLabel,
      caseBtn,
      regexBtn,
      prevBtn,
      nextBtn,
      closeBtn,
    ),
    replaceRow,
  )

  const updateCount = (): void => {
    const total = matches.length
    countLabel.textContent = total === 0 ? '0/0' : `${current + 1}/${total}`
    countLabel.classList.toggle(
      'find-panel__count--miss',
      total === 0 && findInput.value.length > 0,
    )
  }

  const recompute = (): void => {
    matches = findDocMatches(
      options.getMarkdown(),
      findInput.value,
      caseSensitive,
      useRegex,
    )
    if (matches.length === 0) current = -1
    else if (current < 0 || current >= matches.length) current = 0
    updateCount()
  }

  const goTo = (index: number): void => {
    if (matches.length === 0) return
    current = ((index % matches.length) + matches.length) % matches.length
    const match = matches[current]!
    options.gotoAnchor({ offset: match.start, line: match.line, endOffset: match.end })
    updateCount()
  }

  const findNext = (): void => {
    recompute()
    if (matches.length === 0) return
    goTo(current + 1)
  }

  const findPrev = (): void => {
    recompute()
    if (matches.length === 0) return
    goTo(current <= 0 ? matches.length - 1 : current - 1)
  }

  const escapeHandler = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.isComposing) return
    event.preventDefault()
    event.stopPropagation()
    close()
  }

  const open = (withReplace: boolean): void => {
    openState = true
    root.hidden = false
    replaceRow.hidden = !withReplace
    recompute()
    findInput.focus()
    findInput.select()
    if (matches.length > 0 && current >= 0) goTo(current)
    window.addEventListener('keydown', escapeHandler, true)
  }

  const close = (): void => {
    openState = false
    root.hidden = true
    window.removeEventListener('keydown', escapeHandler, true)
  }

  const doReplaceOne = (): void => {
    recompute()
    if (current < 0 || current >= matches.length) return
    const markdown = options.getMarkdown()
    const match = matches[current]!
    const next = replaceDocOnce(
      markdown,
      match,
      findInput.value,
      replaceInput.value,
      caseSensitive,
      useRegex,
    )
    options.replaceInDocument(next)
    recompute()
    if (matches.length > 0) goTo(Math.min(current, matches.length - 1))
    else updateCount()
  }

  const doReplaceAll = (): void => {
    recompute()
    if (matches.length === 0) return
    const next = replaceDocAll(
      options.getMarkdown(),
      findInput.value,
      replaceInput.value,
      caseSensitive,
      useRegex,
    )
    options.replaceInDocument(next)
    recompute()
    current = matches.length > 0 ? 0 : -1
    updateCount()
  }

  findInput.addEventListener('input', () => {
    current = 0
    recompute()
    if (matches.length > 0) goTo(0)
  })

  findInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.shiftKey) findPrev()
      else findNext()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  })

  replaceInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      doReplaceOne()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  })

  caseBtn.addEventListener('click', () => {
    caseSensitive = !caseSensitive
    caseBtn.classList.toggle('is-active', caseSensitive)
    current = 0
    recompute()
  })

  regexBtn.addEventListener('click', () => {
    useRegex = !useRegex
    regexBtn.classList.toggle('is-active', useRegex)
    current = 0
    recompute()
  })

  prevBtn.addEventListener('click', findPrev)
  nextBtn.addEventListener('click', findNext)
  closeBtn.addEventListener('click', close)
  replaceOneBtn.addEventListener('click', doReplaceOne)
  replaceAllBtn.addEventListener('click', doReplaceAll)

  return {
    el: root,
    open,
    close,
    isOpen: () => openState,
    focusFind: () => {
      findInput.focus()
      findInput.select()
    },
    findNext,
    findPrev,
  }
}

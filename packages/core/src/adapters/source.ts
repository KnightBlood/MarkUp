import OverType, { type Options, type OverTypeInstance } from 'overtype'
import {
  plantumlFenceTarget,
  setPlantumlResolver,
  type PlantumlAnchor,
  type PlantumlTarget,
} from '../plantumlEditBridge'
import {
  imageAltText,
  isImageFile,
  type Anchor,
  type InsertMarkdownOptions,
  type LineAt,
  type ViewAdapter,
} from './types'

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result ?? '')), { once: true })
    reader.addEventListener('error', () => reject(reader.error ?? new Error('read failed')), {
      once: true,
    })
    reader.readAsDataURL(file)
  })
}

const decodeEntities = (text: string): string =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')

/**
 * OverType renders `![alt](url)` as a plain anchor (and its sanitizeUrl turns
 * `data:` into `#`), so images never appear in the split view. Swap each image
 * anchor for a thumbnail constrained to one line box: the textarea overlay
 * aligns by line metrics (one source line = one row), so the preview must not
 * grow taller than the raw line under it.
 */
const renderPreviewImages = (preview: HTMLElement): void => {
  for (const anchor of Array.from(preview.querySelectorAll('a'))) {
    const prev = anchor.previousSibling
    if (!prev || prev.nodeType !== Node.TEXT_NODE) continue
    const prevText = prev.textContent ?? ''
    if (!prevText.endsWith('!')) continue
    const tail = anchor.querySelector('.syntax-marker.url-part')?.textContent ?? ''
    if (!tail.startsWith('](')) continue
    const dest = tail.slice(2).replace(/\)$/, '')
    if (!dest) continue
    const titled = dest.match(/^(.*?)\s+"([\s\S]*)"$/)
    let src = decodeEntities(titled?.[1] ?? dest)
    const title = titled ? decodeEntities(titled[2] ?? '') : ''
    if (src.startsWith('<') && src.endsWith('>')) src = src.slice(1, -1)
    if (!src) continue
    const altHost = anchor.cloneNode(true) as HTMLElement
    for (const marker of Array.from(altHost.querySelectorAll('.syntax-marker'))) marker.remove()
    const img = document.createElement('img')
    img.className = 'source-image'
    img.src = src
    img.alt = decodeEntities(altHost.textContent ?? '')
    if (title) img.title = title
    prev.textContent = prevText.slice(0, -1)
    anchor.replaceWith(img)
  }
}

export interface SourceAdapterOptions {
  onChange?: (markdown: string) => void
}

export function createSourceAdapter(options: SourceAdapterOptions = {}): ViewAdapter {
  let value = ''
  let instance: OverTypeInstance | null = null
  let rootEl: HTMLElement | null = null
  let gutterEl: HTMLElement | null = null
  let lineNumbers = false
  let spellcheck = false
  const { onChange } = options

  const lineCount = (): number => (value === '' ? 1 : value.split('\n').length)

  const renderGutter = (): void => {
    if (!gutterEl) return
    const count = lineCount()
    const parts: string[] = []
    for (let i = 1; i <= count; i++) parts.push(String(i))
    gutterEl.textContent = parts.join('\n')
  }

  const syncGutterScroll = (): void => {
    if (!gutterEl || !instance?.textarea) return
    gutterEl.scrollTop = instance.textarea.scrollTop
  }

  const applyChrome = (): void => {
    if (!rootEl) return
    rootEl.classList.toggle('has-line-numbers', lineNumbers)
    if (gutterEl) {
      gutterEl.hidden = !lineNumbers
      renderGutter()
      syncGutterScroll()
    }
    if (instance?.textarea) {
      instance.textarea.spellcheck = spellcheck
      instance.options.spellcheck = spellcheck
    }
  }

  const lineAt = (clientX: number, clientY: number): LineAt | null => {
    const textarea = instance?.textarea
    if (!textarea) return null
    const lines = value === '' ? [''] : value.split('\n')
    let lineIndex = 0
    let column = 0
    const rect = textarea.getBoundingClientRect()
    const inBounds =
      rect.height > 0 && clientY >= rect.top - 4 && clientY <= rect.bottom + 4
    if (inBounds) {
      const style = window.getComputedStyle(textarea)
      const lineHeight =
        Number.parseFloat(style.lineHeight) ||
        Number.parseFloat(style.fontSize) * 1.6 ||
        24
      const padTop = Number.parseFloat(style.paddingTop) || 0
      const padLeft = Number.parseFloat(style.paddingLeft) || 0
      const y = clientY - rect.top - padTop + textarea.scrollTop
      lineIndex = Math.max(0, Math.floor(y / lineHeight))
      const fontSize = Number.parseFloat(style.fontSize) || 14
      const charWidth = fontSize * 0.6
      const x = clientX - rect.left - padLeft
      column = charWidth > 0 ? Math.max(0, Math.round(x / charWidth)) : 0
    } else {
      const pos = textarea.selectionStart ?? 0
      const prefix = value.slice(0, pos)
      lineIndex = prefix.length === 0 ? 0 : prefix.split('\n').length - 1
      column = pos - (prefix.lastIndexOf('\n') + 1)
    }
    const idx = Math.min(Math.max(lineIndex, 0), lines.length - 1)
    const text = lines[idx] ?? ''
    let offset = 0
    for (let i = 0; i < idx; i++) offset += (lines[i]?.length ?? 0) + 1
    column = Math.min(Math.max(column, 0), text.length)
    return { text, line: idx + 1, offset, column }
  }

  // PlantUML blocks are located through the fence scan and rewritten by
  // splicing only the content span — mirrors insertMarkdown's value flow.
  const resolvePlantuml = (anchor: PlantumlAnchor): PlantumlTarget | null => {
    const textarea = instance?.textarea
    if (!textarea) return null
    let offset: number | null = null
    if (anchor.target && anchor.clientX !== undefined && anchor.clientY !== undefined) {
      offset = lineAt(anchor.clientX, anchor.clientY)?.offset ?? null
    }
    if (offset == null && anchor.caret) offset = textarea.selectionStart ?? 0
    if (offset == null) return null
    return plantumlFenceTarget(value, offset, (from, to, text) => {
      const target = instance?.textarea
      if (!target) return false
      const next = value.slice(0, from) + text + value.slice(to)
      value = next
      instance?.setValue(next)
      // Park the caret at the end of the content — not on the trailing
      // newline, which would sit it on the closing fence line.
      const body = text.endsWith('\n') ? text.slice(0, -1) : text
      const caret = body.length > 0 ? from + body.length : Math.max(from - 1, 0)
      target.focus()
      target.setSelectionRange(caret, caret)
      onChange?.(next)
      return true
    })
  }

  return {
    kind: 'source',

    mount(container: HTMLElement): void {
      if (rootEl) return
      const host = document.createElement('div')
      host.className = 'adapter-source'
      const gutter = document.createElement('div')
      gutter.className = 'source-gutter'
      gutter.hidden = !lineNumbers
      gutter.setAttribute('aria-hidden', 'true')
      gutterEl = gutter
      host.append(gutter)
      container.replaceChildren(host)
      rootEl = host

      let ignoreInitNotify = true
      const editors = new OverType(host, {
        value,
        autofocus: false,
        spellcheck,
        toolbar: false,
        showStats: false,
        // Runtime option (overtype supports it; published d.ts omits it).
        onRender: renderPreviewImages,
        onChange: (markdown) => {
          value = markdown
          renderGutter()
          if (ignoreInitNotify) {
            ignoreInitNotify = false
            return
          }
          onChange?.(markdown)
        },
      } as Options)
      ignoreInitNotify = false
      instance = editors[0] ?? null
      instance?.textarea?.addEventListener('scroll', syncGutterScroll, { passive: true })
      applyChrome()
      setPlantumlResolver(resolvePlantuml)
    },

    unmount(): void {
      setPlantumlResolver(null)
      instance?.textarea?.removeEventListener('scroll', syncGutterScroll)
      instance?.destroy()
      instance = null
      rootEl?.remove()
      rootEl = null
      gutterEl = null
    },

    setValue(markdown: string): void {
      value = markdown
      instance?.setValue(markdown)
      renderGutter()
    },

    getValue(): string {
      return value
    },

    focus(): void {
      instance?.focus()
    },

    insertMarkdown(options: InsertMarkdownOptions): void {
      const textarea = instance?.textarea
      if (!textarea) return
      const start = textarea.selectionStart ?? value.length
      const end = textarea.selectionEnd ?? start
      const next = value.slice(0, start) + options.markdown + value.slice(end)
      const caret =
        start + (options.caretOffset ?? options.markdown.length)
      value = next
      instance?.setValue(next)
      textarea.focus()
      textarea.setSelectionRange(caret, caret)
      onChange?.(next)
    },

    async insertImage(file: File): Promise<boolean> {
      if (!isImageFile(file)) return false
      const dataUrl = await readFileAsDataUrl(file)
      const textarea = instance?.textarea
      if (!textarea) return false
      const start = textarea.selectionStart ?? value.length
      const end = textarea.selectionEnd ?? start
      const md = `![${imageAltText(file)}](${dataUrl})`
      const next = value.slice(0, start) + md + value.slice(end)
      value = next
      instance?.setValue(next)
      textarea.focus()
      textarea.setSelectionRange(start + md.length, start + md.length)
      onChange?.(next)
      return true
    },

    insertTable(rows = 3, cols = 3): void {
      const header = `| ${Array.from({ length: cols }, (_, i) => `H${i + 1}`).join(' | ')} |`
      const sep = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`
      const body = Array.from(
        { length: Math.max(0, rows - 1) },
        () => `| ${Array.from({ length: cols }, () => ' ').join(' | ')} |`,
      )
      const md = [header, sep, ...body].join('\n')
      const textarea = instance?.textarea
      if (!textarea) {
        value = value + md
        instance?.setValue(value)
        onChange?.(value)
        return
      }
      const start = textarea.selectionStart ?? value.length
      const end = textarea.selectionEnd ?? start
      const next = value.slice(0, start) + md + value.slice(end)
      value = next
      instance?.setValue(next)
      textarea.focus()
      textarea.setSelectionRange(start + md.length, start + md.length)
      onChange?.(next)
    },

    setCodeLanguage(): void {
      /* source 视图在光标处插入围栏由命令层处理 */
    },

    centerCaret(): void {
      const textarea = instance?.textarea
      if (!textarea) return
      const pos = textarea.selectionStart ?? 0
      const before = textarea.value.slice(0, pos)
      const lineIndex = before.length === 0 ? 0 : before.split('\n').length - 1
      const style = window.getComputedStyle(textarea)
      const lineHeight =
        Number.parseFloat(style.lineHeight) ||
        Number.parseFloat(style.fontSize) * 1.6 ||
        24
      const target = lineIndex * lineHeight - textarea.clientHeight / 2 + lineHeight / 2
      textarea.scrollTop = Math.max(0, target)
    },

    captureAnchor(): Anchor {
      const textarea = instance?.textarea
      if (!textarea) return { offset: 0, line: 1 }
      const start = textarea.selectionStart ?? 0
      const end = textarea.selectionEnd ?? start
      const prefix = value.slice(0, start)
      return {
        offset: start,
        line: prefix.length === 0 ? 1 : prefix.split('\n').length,
        // Both ends, so callers can act on the selection and not just the caret.
        ...(end > start ? { endOffset: Math.min(end, value.length) } : {}),
      }
    },

    restoreAnchor(anchor: Anchor): void {
      const textarea = instance?.textarea
      if (!textarea) return
      const pos = Math.min(Math.max(anchor.offset, 0), value.length)
      const end =
        anchor.endOffset === undefined
          ? pos
          : Math.min(Math.max(anchor.endOffset, pos), value.length)
      textarea.focus()
      textarea.setSelectionRange(pos, end)
      const scroller = textarea.closest('.editor-viewport') ?? textarea.parentElement
      if (scroller && typeof scroller.scrollTo === 'function') {
        const before = textarea.value.slice(0, pos).split('\n').length
        const lineHeight = textarea.scrollHeight / Math.max(textarea.value.split('\n').length, 1)
        const targetTop = Math.max(0, (before - 1) * lineHeight - scroller.clientHeight / 3)
        scroller.scrollTo({ top: targetTop, behavior: 'smooth' })
      }
      syncGutterScroll()
    },

    setLineNumbers(enabled: boolean): void {
      lineNumbers = enabled
      applyChrome()
    },

    setSpellcheck(enabled: boolean): void {
      spellcheck = enabled
      applyChrome()
    },

    getLineAt: lineAt,
  }
}
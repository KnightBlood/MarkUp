import OverType, { type Options, type OverTypeInstance } from 'overtype'
import { smartInput, smartInputEdit, SMART_INPUT_OFF, type SmartInputOptions } from '../smartInput'
import {
  plantumlFenceTarget,
  setPlantumlResolver,
  type PlantumlAnchor,
  type PlantumlTarget,
} from '../plantumlEditBridge'
import {
  type InsertedImage,
  type Anchor,
  type InsertMarkdownOptions,
  type LineAt,
  type ViewAdapter,
} from './types'

/**
 * 这个码点在等宽字体里是不是占两格。
 *
 * 只列常用的东亚宽字符区间；判断错一个字不过是高亮偏一格，比整行全错好。代理对
 * （生僻字、emoji）按高位码元查，落到宽区间即可。
 */
function isWideCode(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) || // 谚文字母
    (code >= 0x2e80 && code <= 0x303e) || // CJK 部首、康熙部首、CJK 符号
    (code >= 0x3041 && code <= 0x33ff) || // 假名、注音、兼容、制表、圈号
    (code >= 0x3400 && code <= 0x4dbf) || // CJK 扩展 A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK 基本区
    (code >= 0xa000 && code <= 0xa4cf) || // 彝文
    (code >= 0xa960 && code <= 0xa97f) || // 谚文扩展 A
    (code >= 0xac00 && code <= 0xd7a3) || // 谚文音节
    (code >= 0xf900 && code <= 0xfaff) || // CJK 兼容表意
    (code >= 0xfe10 && code <= 0xfe19) || // 竖排标点
    (code >= 0xfe30 && code <= 0xfe6f) || // CJK 兼容形式、小写变体
    (code >= 0xff00 && code <= 0xff60) || // 全角 ASCII
    (code >= 0xffe0 && code <= 0xffe6) || // 全角符号
    (code >= 0xd800 && code <= 0xdbff) || // 代理对高位，随低位走宽区间
    (code >= 0x17000 && code <= 0x18aff) // 西夏文、契丹文
  )
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
  let selectionLayer: HTMLElement | null = null
  let charWidth = 0
  let wideCells = 0
  let lineNumbers = false
  let spellcheck = false
  let readOnly = false
  let smartInputOptions: SmartInputOptions = SMART_INPUT_OFF
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

  const measureAdvance = (textarea: HTMLTextAreaElement, sample: string): number => {
    const cs = window.getComputedStyle(textarea)
    const probe = document.createElement('span')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText = [
      'position:absolute',
      'left:-100000px',
      'top:0',
      'visibility:hidden',
      'white-space:pre',
      // Same face as the textarea, ligatures off — OverType pins those to keep
      // its two layers aligned, so the advance width has to come from them.
      `font-family:${cs.fontFamily}`,
      `font-size:${cs.fontSize}`,
      `font-weight:${cs.fontWeight}`,
      'font-variant:normal',
      'font-variant-ligatures:none',
    ].join(';')
    probe.textContent = sample
    document.body.appendChild(probe)
    const measured = probe.getBoundingClientRect().width / sample.length
    probe.remove()
    return measured
  }

  const measureCharWidth = (textarea: HTMLTextAreaElement): number => {
    if (charWidth > 0) return charWidth
    const measured = measureAdvance(textarea, '0'.repeat(200))
    if (measured > 0) charWidth = measured
    return charWidth
  }

  /**
   * 全角字符折合成多少个半角格。
   *
   * 等宽字体里 `前缀` 这样的全角字占两格。源码列号是「字符个数」，视觉格数却是
   * 「宽度」，两者对不上 —— `# 前缀 JMeter` 里 `JMeter` 的列号是 5、格数是 7，
   * 拿列号直接乘字符宽会把高亮整体左移两格。真去量一遍，不猜是不是正好 2。
   */
  const measureWideCells = (textarea: HTMLTextAreaElement): number => {
    if (wideCells > 0) return wideCells
    const ascii = measureCharWidth(textarea)
    // 用一个必然走中文字体的字去量，避免命中 ASCII 回退。
    const wide = measureAdvance(textarea, '国'.repeat(100))
    if (ascii > 0 && wide > 0) wideCells = wide / ascii
    return wideCells
  }

  /** 源码列号 → 该行左边缘起算的像素宽度。 */
  const rowWidth = (
    row: string,
    col: number,
    charW: number,
    wide: number,
    tabSize: number,
  ): number => {
    let cells = 0
    const limit = Math.min(Math.max(col, 0), row.length)
    for (let i = 0; i < limit; i++) {
      const code = row.charCodeAt(i)
      // 制表符按 tab-size 跳到下一个制表位，不是一格。
      if (code === 9) cells += tabSize - (cells % tabSize)
      else cells += isWideCode(code) ? wide : 1
    }
    return cells * charW
  }

  /**
   * 行距。
   *
   * 不能用 `scrollHeight / 行数` —— 文档比视口矮时 `scrollHeight` 就是
   * `clientHeight`（一整屏），除出来的「行高」是整屏高度，矩形直接画到几十行以外
   * （实测 71.8px vs 真实 22.4px）。`line-height` 交给浏览器算出来的 px 是准的；
   * 只有 `normal` 拿不到数值，才探针量两行的差。
   */
  const readLineHeight = (textarea: HTMLTextAreaElement): number => {
    const declared = Number.parseFloat(window.getComputedStyle(textarea).lineHeight)
    if (declared > 0) return declared
    const cs = window.getComputedStyle(textarea)
    const probe = document.createElement('span')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText = [
      'position:absolute',
      'left:-100000px',
      'top:0',
      'visibility:hidden',
      'white-space:pre',
      `font-family:${cs.fontFamily}`,
      `font-size:${cs.fontSize}`,
      `font-weight:${cs.fontWeight}`,
      'font-variant:normal',
      'font-variant-ligatures:none',
    ].join(';')
    probe.textContent = 'X\nX'
    document.body.appendChild(probe)
    const measured = probe.getBoundingClientRect().height / 2
    probe.remove()
    return measured > 0 ? measured : 0
  }

  /** 制表位间距，`tab-size` 拿不到数值时退回等宽字体的默认 8。 */
  const readTabSize = (textarea: HTMLTextAreaElement): number => {
    const declared = Number.parseFloat(window.getComputedStyle(textarea).tabSize)
    return declared > 0 ? declared : 8
  }

  /**
   * 分屏 的选区高亮，画在 OverType 自己的两层之外。
   *
   * Chrome 只在 `<textarea>` 持有焦点时绘制它自己的 `::selection`，而查找面板每
   * 定位一次就把焦点抢回去 —— 选区就地消失，分屏看起来「压根不高亮」。CodeMirror
   * 和 ProseMirror 都把选区画成自己的装饰、失焦也留着，唯独 OverType 的选区长在
   * 组件内部。这里补上一层：预览层是「一行源码 = 一行渲染」的同字号等宽排版，所以
   * 按行号 / 列号算出来的矩形正好压在被渲染的那几个字符上。
   *
   * 焦点还在 textarea 上时不画 —— 那时它自己的 `::selection` 才是真的，两层叠着
   * 会比正常选区更深。
   */
  const paintSelection = (): void => {
    const textarea = instance?.textarea
    if (!textarea || !selectionLayer) return
    selectionLayer.replaceChildren()
    if (document.activeElement === textarea) return
    const start = textarea.selectionStart ?? 0
    const end = Math.max(textarea.selectionEnd ?? start, start)
    if (end <= start) return
    const cs = window.getComputedStyle(textarea)
    const padTop = Number.parseFloat(cs.paddingTop) || 0
    const padLeft = Number.parseFloat(cs.paddingLeft) || 0
    const rows = textarea.value.split('\n')
    const lineH = readLineHeight(textarea)
    const charW = measureCharWidth(textarea)
    if (!(lineH > 0) || !(charW > 0)) return
    const wide = measureWideCells(textarea)
    const tabSize = readTabSize(textarea)
    let rowStart = 0
    for (let i = 0; i < rows.length && rowStart < end; i++) {
      const row = rows[i] ?? ''
      const rowEnd = rowStart + row.length
      const from = Math.max(start, rowStart)
      const to = Math.min(end, rowEnd)
      if (to > from) {
        // 列号是字符个数，画矩形要用**宽度**：全角字占两格、制表符占到下一个制表位，
        // 直接拿列号乘字符宽，只要行里有中文就会整段左移。
        const fromX = rowWidth(row, from - rowStart, charW, wide, tabSize)
        const toX = rowWidth(row, to - rowStart, charW, wide, tabSize)
        const rect = document.createElement('div')
        rect.className = 'source-selection'
        rect.style.left = `${padLeft + fromX}px`
        rect.style.top = `${padTop + i * lineH - textarea.scrollTop}px`
        rect.style.width = `${Math.max(toX - fromX, charW)}px`
        rect.style.height = `${lineH}px`
        selectionLayer.appendChild(rect)
      }
      rowStart = rowEnd + 1
    }
  }

  const onSelectionChange = (): void => {
    paintSelection()
  }

  const onTextareaScroll = (): void => {
    syncGutterScroll()
    // The painted rects are in textarea coordinates, so they ride along.
    paintSelection()
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
      // OverType's own input handlers bail out when the textarea is `readOnly`,
      // so this is the supported lever — and it keeps selection, scrolling and
      // copying working.
      instance.textarea.readOnly = readOnly
    }
  }

  /**
   * 智能输入 for the OverType view. `beforeinput` is the only place a textarea
   * lets us see and replace the typed text before it lands; cancelling it and
   * writing the replacement through the adapter's own setter keeps OverType's
   * re-render and `onChange` on exactly the same path as a normal keystroke.
   */
  const onBeforeInput = (event: InputEvent): void => {
    if (smartInputOptions === SMART_INPUT_OFF) return
    const textarea = instance?.textarea
    if (!textarea || event.inputType !== 'insertText' || !event.data) return
    const from = textarea.selectionStart ?? 0
    const to = textarea.selectionEnd ?? from
    const current = textarea.value
    const result = smartInput(
      {
        // A slice, not one character: the ellipsis rule looks at the two dots
        // already typed, and Emoji 自动补全 looks back over a whole `:shortcode`.
        before: current.slice(Math.max(0, from - 32), from),
        after: current.slice(to, to + 2),
        text: event.data,
        hasSelection: to > from,
      },
      smartInputOptions,
    )
    if (!result.wrap && result.deleteBefore === 0 && result.text === event.data) return
    const edit = smartInputEdit(result, { from, to }, current.slice(from, to))
    event.preventDefault()
    const next = current.slice(0, edit.from) + edit.insert + current.slice(edit.to)
    value = next
    instance?.setValue(next)
    textarea.setSelectionRange(edit.caret, edit.caret)
    onChange?.(next)
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
      const textarea = instance?.textarea
      if (textarea) {
        // OverType owns the wrapper (`position: relative`, `overflow: hidden`),
        // so a layer sized to it is clipped and positioned with the textarea.
        const layer = document.createElement('div')
        layer.className = 'source-selection-layer'
        layer.setAttribute('aria-hidden', 'true')
        textarea.parentElement?.appendChild(layer)
        selectionLayer = layer
        textarea.addEventListener('scroll', onTextareaScroll, { passive: true })
        textarea.addEventListener('beforeinput', onBeforeInput)
        textarea.addEventListener('focus', paintSelection)
        textarea.addEventListener('blur', paintSelection)
      }
      document.addEventListener('selectionchange', onSelectionChange)
      charWidth = 0
      wideCells = 0
      applyChrome()
      setPlantumlResolver(resolvePlantuml)
    },

    unmount(): void {
      setPlantumlResolver(null)
      document.removeEventListener('selectionchange', onSelectionChange)
      const textarea = instance?.textarea
      textarea?.removeEventListener('scroll', onTextareaScroll)
      textarea?.removeEventListener('focus', paintSelection)
      textarea?.removeEventListener('blur', paintSelection)
      instance?.destroy()
      instance = null
      selectionLayer = null
      charWidth = 0
      wideCells = 0
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

    insertImage(image: InsertedImage): boolean {
      const textarea = instance?.textarea
      if (!textarea) return false
      const start = textarea.selectionStart ?? value.length
      const end = textarea.selectionEnd ?? start
      const md = `![${image.alt}](${image.url})`
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
      // The textarea is the scroller. OverType grows its wrapper to the content
      // and lets the input scroll inside it, so `.editor-viewport` never
      // overflows — scrolling that instead did nothing, which is why 上一个 /
      // 下一个 never moved the view in 分屏.
      const rows = textarea.value.split('\n')
      const lineIndex = textarea.value.slice(0, pos).split('\n').length - 1
      const lineHeight = textarea.scrollHeight / Math.max(rows.length, 1)
      textarea.scrollTop = Math.max(0, lineIndex * lineHeight - textarea.clientHeight / 3)
      onTextareaScroll()
    },

    setLineNumbers(enabled: boolean): void {
      lineNumbers = enabled
      applyChrome()
    },

    setSpellcheck(enabled: boolean): void {
      spellcheck = enabled
      applyChrome()
    },

    setReadOnly(enabled: boolean): void {
      readOnly = enabled
      if (rootEl) rootEl.classList.toggle('is-readonly', enabled)
      applyChrome()
    },

    setSmartInput(next: SmartInputOptions): void {
      smartInputOptions = next
    },

    getLineAt: lineAt,
  }
}
/** Comprehensive code-fence language list for the in-editor language dropdown. */

import type { EditorView } from '@milkdown/kit/prose/view'

export interface CodeLangGroup {
  /** optgroup label */
  readonly label: string
  readonly values: readonly string[]
}

/**
 * Grouped language table. Preview-capable fence languages come first so the
 * dropdown can switch a code block into a live preview (diagram / embed /
 * math). Aliases of the normalize* helpers in diagrams.ts / embeds.ts /
 * mathRender.ts are included so any entry maps to a working preview kind.
 */
export const CODE_LANG_GROUPS: readonly CodeLangGroup[] = [
  {
    label: '可预览（图表 / 公式 / 白板）',
    values: [
      'mermaid',
      'mmd',
      'graph',
      'flow',
      'flowchart',
      'flowchart.js',
      'plantuml',
      'puml',
      'math',
      'latex',
      'tex',
      'katex',
      'formula',
      'mindmap',
      'drawio',
      'dio',
    ],
  },
  {
    label: '常用编程语言',
    values: [
      'js',
      'javascript',
      'ts',
      'typescript',
      'jsx',
      'tsx',
      'python',
      'py',
      'java',
      'c',
      'cpp',
      'c++',
      'cxx',
      'csharp',
      'cs',
      'go',
      'golang',
      'rust',
      'ruby',
      'rb',
      'php',
      'swift',
      'kotlin',
      'kt',
      'scala',
      'dart',
      'lua',
      'r',
      'perl',
      'sql',
      'graphql',
      'gql',
      'proto',
      'json',
      'json5',
      'jsonc',
      'yaml',
      'yml',
      'toml',
      'xml',
      'html',
      'css',
      'scss',
      'sass',
      'less',
      'vue',
      'svelte',
      'markdown',
      'md',
      'mdx',
      'text',
      'txt',
      'plaintext',
    ],
  },
  {
    label: '脚本 / Shell',
    values: [
      'bash',
      'sh',
      'shell',
      'zsh',
      'fish',
      'powershell',
      'ps1',
      'bat',
      'cmd',
      'batch',
      'awk',
      'sed',
      'applescript',
    ],
  },
  {
    label: '系统 / 编译型',
    values: [
      'h',
      'hpp',
      'objective-c',
      'objc',
      'zig',
      'nim',
      'crystal',
      'julia',
      'elixir',
      'erlang',
      'haskell',
      'hs',
      'ocaml',
      'fsharp',
      'fs',
      'clojure',
      'clj',
      'lisp',
      'scheme',
      'racket',
      'prolog',
      'ada',
      'pascal',
      'fortran',
      'cobol',
      'vb',
      'vba',
      'asm',
      'nasm',
      'verilog',
      'vhdl',
    ],
  },
  {
    label: '标记 / 数据 / 配置',
    values: [
      'svg',
      'ini',
      'cfg',
      'conf',
      'dockerfile',
      'docker',
      'makefile',
      'make',
      'cmake',
      'gradle',
      'gitignore',
      'diff',
      'patch',
      'log',
      'regex',
      'rst',
      'asciidoc',
      'adoc',
      'org',
      'bibtex',
      'thrift',
      'tsv',
      'properties',
      'editorconfig',
    ],
  },
]

/** Placeholder option: no language set (plain text / auto). */
export const LANG_EMPTY_VALUE = ''

/**
 * Locate the enclosing code_block for a widget position. Wrapper widgets sit
 * at the node start (`from`), the in-pre language select sits at `from + 1`.
 */
export function codeBlockPosAt(view: EditorView, widgetPos: number): number | null {
  const doc = view.state.doc
  const pos = Math.min(Math.max(widgetPos, 0), doc.content.size)
  const node = doc.nodeAt(pos)
  if (node?.type.name === 'code_block') return pos
  const $pos = doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === 'code_block') return $pos.before(depth)
  }
  return null
}

/** Rewrite the fence language of the code_block a widget belongs to. */
export function applyCodeLanguage(view: EditorView, widgetPos: number, language: string): void {
  const blockPos = codeBlockPosAt(view, widgetPos)
  if (blockPos === null) return
  view.dispatch(view.state.tr.setNodeAttribute(blockPos, 'language', language))
  // The pick rebuilds the widget (new decoration key), so the select that had
  // focus is gone — hand focus back to the editor instead of the body.
  view.focus()
}

/**
 * Language dropdown bound to a widget position: picking an option rewrites
 * the enclosing code_block's `language` attribute.
 */
export function buildWidgetLangSelect(
  view: EditorView,
  getPos: () => number | undefined,
  language: string,
): HTMLSelectElement {
  return buildLangSelect({
    current: language,
    onPick: (value) => {
      const pos = getPos()
      if (pos === undefined) return
      applyCodeLanguage(view, pos, value)
    },
  })
}

/**
 * All values in the table (flattened, order preserved). Used to check whether
 * the current language needs a dynamically inserted option.
 */
export const CODE_LANG_VALUES: readonly string[] = CODE_LANG_GROUPS.flatMap(
  (group) => group.values,
)

export interface BuildLangSelectOptions {
  /** Currently set code_block language attribute (may be ''). */
  readonly current?: string
  /** CSS class for the select element. */
  readonly className?: string
  /** Accessible label. */
  readonly ariaLabel?: string
  /** Called with the picked language value (never fires for no-op picks). */
  readonly onPick: (language: string) => void
}

/**
 * Build a native `<select>` for choosing a code fence language.
 *
 * - First option is the empty value "纯文本" (no language).
 * - Renders optgroup sections from {@link CODE_LANG_GROUPS}.
 * - If `current` is not in the table it is inserted as an extra option and
 *   preselected, so the dropdown always reflects the actual state.
 * - `change` fires `onPick` with the chosen value.
 */
export function buildLangSelect(options: BuildLangSelectOptions): HTMLSelectElement {
  const select = document.createElement('select')
  select.className = options.className ?? 'md-embed__lang'
  select.setAttribute('aria-label', options.ariaLabel ?? '代码块语言')
  select.title = '设置代码块语言'

  const current = (options.current ?? '').trim()

  const placeholder = document.createElement('option')
  placeholder.value = LANG_EMPTY_VALUE
  placeholder.textContent = '纯文本'
  select.append(placeholder)

  const seen = new Set<string>([LANG_EMPTY_VALUE])
  for (const group of CODE_LANG_GROUPS) {
    const optgroup = document.createElement('optgroup')
    optgroup.label = group.label
    for (const value of group.values) {
      if (seen.has(value)) continue
      seen.add(value)
      const option = document.createElement('option')
      option.value = value
      option.textContent = value
      optgroup.append(option)
    }
    if (optgroup.childElementCount > 0) select.append(optgroup)
  }

  if (current && !seen.has(current)) {
    const option = document.createElement('option')
    option.value = current
    option.textContent = current
    select.append(option)
    seen.add(current)
  }

  select.value = current
  if (select.value !== current) select.value = LANG_EMPTY_VALUE

  select.addEventListener('change', () => {
    options.onPick(select.value)
  })

  // Direction keys must navigate the dropdown, not the ProseMirror caret.
  select.addEventListener('keydown', (event) => {
    event.stopPropagation()
  })

  return select
}

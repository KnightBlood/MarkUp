import type { AppConfig, CustomTheme, ImageCopyMode } from '@markup/host-api'
import { IMAGE_COPY_MODES } from '@markup/host-api'
import { el } from '../dom'
import { THEME_OPTIONS } from '../appearance'

export type SettingsTab = 'general' | 'appearance' | 'editor' | 'markdown' | 'image' | 'export'

/** Extra settings tab contributed at runtime (plugins / registration surface). */
export interface SettingsTabSpec {
  id: string
  label: string
  render: () => HTMLElement
}

export interface SettingsApi {
  el: HTMLElement
  open: (tab?: string) => void
  close: () => void
  toggle: () => void
  isOpen: () => boolean
  getTab: () => string
  setTab: (tab: string) => void
  /** Append a plugin tab (button + panel). Returns an unsubscribe that removes it. */
  registerTab: (spec: SettingsTabSpec) => () => void
}

export interface SettingsCallbacks {
  getAppearance: () => AppConfig
  onAppearanceChange: (next: AppConfig) => void
  /** Called when the dialog closes (pending key capture must stop). */
  onClose?: () => void
}

const COLOR_FIELDS: Array<{ key: keyof CustomTheme; label: string; fallback: string }> = [
  { key: 'bg', label: '背景', fallback: '#ffffff' },
  { key: 'bgSoft', label: '次背景', fallback: '#f6f7f9' },
  { key: 'bgRaise', label: '浮层背景', fallback: '#ffffff' },
  { key: 'fg', label: '文字', fallback: '#24292f' },
  { key: 'fgMuted', label: '次要文字', fallback: '#6e7781' },
  { key: 'border', label: '边框', fallback: '#d0d7de' },
  { key: 'accent', label: '强调色', fallback: '#0969da' },
  { key: 'accentFg', label: '强调前景', fallback: '#ffffff' },
  { key: 'ok', label: '成功', fallback: '#1a7f37' },
  { key: 'bad', label: '错误', fallback: '#cf222e' },
]

/**
 * 面板顺序与命名对齐 Typora 的偏好设置：通用 → 外观 → 编辑器 → Markdown →
 * 图像 → 导出。（Typora 还有「文件」面板，本项目暂无对应功能，故不设空壳。）
 */
const TAB_LABELS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: '通用' },
  { id: 'appearance', label: '外观' },
  { id: 'editor', label: '编辑器' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'image', label: '图像' },
  { id: 'export', label: '导出' },
]

function toHexColor(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  return value
}

function checked(input: HTMLInputElement): boolean {
  return input.checked
}

export function createSettings(callbacks: SettingsCallbacks): SettingsApi {
  const themeSelect = el('select', { class: 'settings__input' })
  for (const option of THEME_OPTIONS) {
    themeSelect.append(el('option', { value: option.value, text: option.label }))
  }

  const fontInput = el('input', {
    class: 'settings__input',
    type: 'number',
    min: '12',
    max: '28',
    step: '1',
  })
  const widthInput = el('input', {
    class: 'settings__input',
    type: 'number',
    min: '480',
    max: '1400',
    step: '10',
  })

  const autoSaveCheck = el('input', { class: 'settings__check', type: 'checkbox' })
  const autoSaveDelayInput = el('input', {
    class: 'settings__input',
    type: 'number',
    min: '300',
    max: '60000',
    step: '100',
  })
  const typewriterCheck = el('input', { class: 'settings__check', type: 'checkbox' })
  const restoreSessionCheck = el('input', { class: 'settings__check', type: 'checkbox' })
  const imagePasteCheck = el('input', { class: 'settings__check', type: 'checkbox' })

  // Typora「图像 ▸ 插入图片时」。五个目标按 Typora 的顺序（与
  // `IMAGE_COPY_MODES` 一一对应），选中 custom 时才显示路径输入框。
  const IMAGE_MODE_LABELS: Array<{ mode: ImageCopyMode; label: string }> = [
    { mode: 'none', label: '无特殊操作' },
    { mode: 'folder', label: '复制图片到当前文件夹（./）' },
    { mode: 'assets', label: '复制图片到 ./assets 文件夹' },
    { mode: 'docAssets', label: '复制图片到 ./${filename}.assets 文件夹' },
    { mode: 'custom', label: '复制到指定路径' },
  ]
  const imageModeInputs = new Map<ImageCopyMode, HTMLInputElement>(
    IMAGE_COPY_MODES.map((mode) => [
      mode,
      el('input', { class: 'settings__radio', type: 'radio', name: 'image-copy-mode' }),
    ]),
  )
  const imageCustomPathInput = el('input', {
    class: 'settings__input',
    type: 'text',
    spellcheck: 'false',
    autocomplete: 'off',
    placeholder: './${filename}.assets',
  })
  const imageCustomRow = el(
    'label',
    { class: 'settings__field' },
    el('span', { class: 'settings__label', text: '目标路径' }),
    imageCustomPathInput,
  )
  const imagePreferRelativeCheck = el('input', { class: 'settings__check', type: 'checkbox' })
  const imageDotPrefixCheck = el('input', { class: 'settings__check', type: 'checkbox' })
  const imageEscapeUrlCheck = el('input', { class: 'settings__check', type: 'checkbox' })
  const imageApplyLocalCheck = el('input', { class: 'settings__check', type: 'checkbox' })

  // 导出 ▸ 页面设置 / HTML / 导出后.
  const exportFolderInput = el('input', {
    class: 'settings__input',
    type: 'text',
    spellcheck: 'false',
    autocomplete: 'off',
    placeholder: '留空则与文档同目录',
  })
  const exportAfterSelect = el(
    'select',
    { class: 'settings__input' },
    el('option', { value: 'none', text: '不做任何事' }),
    el('option', { value: 'openFile', text: '打开导出的文件' }),
    el('option', { value: 'openFolder', text: '打开文件所在目录' }),
  )
  const exportPageSizeInput = el('input', {
    class: 'settings__input',
    type: 'text',
    spellcheck: 'false',
    autocomplete: 'off',
    placeholder: 'A4 / Letter（留空用打印机默认）',
  })
  const exportPageMarginInput = el('input', {
    class: 'settings__input',
    type: 'text',
    spellcheck: 'false',
    autocomplete: 'off',
    placeholder: '20mm / 1in 2cm（留空用打印机默认）',
  })
  const exportPageBreakCheck = el('input', { class: 'settings__check', type: 'checkbox' })
  const exportOutlineCheck = el('input', { class: 'settings__check', type: 'checkbox' })
  const exportCustomCssInput = el('textarea', {
    class: 'settings__input',
    rows: '3',
    spellcheck: 'false',
    placeholder: '追加在导出样式之后，可覆盖它',
  })
  const exportHeadHtmlInput = el('textarea', {
    class: 'settings__input',
    rows: '2',
    spellcheck: 'false',
    placeholder: '插入到 </head> 之前',
  })
  const exportBodyHtmlInput = el('textarea', {
    class: 'settings__input',
    rows: '2',
    spellcheck: 'false',
    placeholder: '插入到 </body> 之前',
  })
  const spellcheckCheck = el('input', { class: 'settings__check', type: 'checkbox' })

  const bodyFontInput = el('input', {
    class: 'settings__input',
    type: 'text',
    spellcheck: 'false',
    autocomplete: 'off',
  })
  const codeFontInput = el('input', {
    class: 'settings__input',
    type: 'text',
    spellcheck: 'false',
    autocomplete: 'off',
  })
  const converterPathInput = el('input', {
    class: 'settings__input',
    type: 'text',
    spellcheck: 'false',
    autocomplete: 'off',
    placeholder: '留空则从 PATH 查找 pandoc / carta',
  })
  const markdownFormatSelect = el(
    'select',
    { class: 'settings__input' },
    el('option', { value: 'gfm', text: 'gfm（GitHub 风格，默认）' }),
    el('option', { value: 'commonmark_x', text: 'commonmark_x（CommonMark + pandoc 扩展）' }),
    el('option', { value: 'commonmark', text: 'commonmark（纯 CommonMark）' }),
    el('option', { value: 'markdown', text: 'markdown（原始，无扩展）' }),
  )

  const lineNumbersCheck = el('input', { class: 'settings__check', type: 'checkbox' })

  // 编辑器 ▸ 智能输入 / 代码块 / 保存时.
  const smartQuotesCheck = el('input', { class: 'settings__check', type: 'checkbox' })
  const smartDashesCheck = el('input', { class: 'settings__check', type: 'checkbox' })
  const pairedSymbolsCheck = el('input', { class: 'settings__check', type: 'checkbox' })
  const emojiAutocompleteCheck = el('input', { class: 'settings__check', type: 'checkbox' })
  const codeBlockLanguageInput = el('input', {
    class: 'settings__input',
    type: 'text',
    spellcheck: 'false',
    autocomplete: 'off',
    placeholder: '留空则为无语言的围栏',
  })
  const lineEndingSelect = el(
    'select',
    { class: 'settings__input' },
    el('option', { value: 'preserve', text: '保持原样' }),
    el('option', { value: 'lf', text: 'LF（Unix）' }),
    el('option', { value: 'crlf', text: 'CRLF（Windows）' }),
  )
  const finalNewlineCheck = el('input', { class: 'settings__check', type: 'checkbox' })
  const copyTextAsMarkdownCheck = el('input', { class: 'settings__check', type: 'checkbox' })
  const workspaceGlobInput = el('textarea', {
    class: 'settings__input',
    rows: '3',
    spellcheck: 'false',
    autocomplete: 'off',
    placeholder: '每行或逗号分隔，例如：\n*.md\n!draft-*',
  })
  const showHiddenFilesCheck = el('input', { class: 'settings__check', type: 'checkbox' })
  const firstLineIndentCheck = el('input', { class: 'settings__check', type: 'checkbox' })
  const codeBlockWrapCheck = el('input', { class: 'settings__check', type: 'checkbox' })
  const preserveLineBreaksCheck = el('input', { class: 'settings__check', type: 'checkbox' })
  const remapUnicodePunctuationCheck = el('input', { class: 'settings__check', type: 'checkbox' })
  const listIndentInput = el('input', {
    class: 'settings__input',
    type: 'number',
    min: '1',
    max: '8',
    step: '1',
  })
  const outlineMaxLevelSelect = el(
    'select',
    { class: 'settings__input' },
    el('option', { value: '0', text: '全部层级' }),
    el('option', { value: '1', text: '仅一级标题' }),
    el('option', { value: '2', text: '到二级' }),
    el('option', { value: '3', text: '到三级' }),
    el('option', { value: '4', text: '到四级' }),
    el('option', { value: '5', text: '到五级' }),
    el('option', { value: '6', text: '到六级' }),
  )
  const showStatsCheck = el('input', { class: 'settings__check', type: 'checkbox' })
  const focusModeCheck = el('input', { class: 'settings__check', type: 'checkbox' })

  // Typora「Markdown ▸ 语法支持」。每项都默认开启，与本应用此前硬编码的行为
  // 一致；关闭任一项只影响解析与渲染，不改动文档内容。
  const mdSyntaxChecks = {
    mdInlineMath: el('input', { class: 'settings__check', type: 'checkbox' }),
    mdCodeBlockMath: el('input', { class: 'settings__check', type: 'checkbox' }),
    mdSubscript: el('input', { class: 'settings__check', type: 'checkbox' }),
    mdSuperscript: el('input', { class: 'settings__check', type: 'checkbox' }),
    mdHighlight: el('input', { class: 'settings__check', type: 'checkbox' }),
    mdUnderline: el('input', { class: 'settings__check', type: 'checkbox' }),
    mdAlerts: el('input', { class: 'settings__check', type: 'checkbox' }),
    mdDiagrams: el('input', { class: 'settings__check', type: 'checkbox' }),
    mdAutoLink: el('input', { class: 'settings__check', type: 'checkbox' }),
  } satisfies Record<string, HTMLInputElement>

  const MD_SYNTAX_FIELDS: Array<{ key: keyof typeof mdSyntaxChecks; label: string; hint: string }> = [
    { key: 'mdInlineMath', label: '内联公式', hint: '$E=mc^2$ 与 $$ 块' },
    { key: 'mdCodeBlockMath', label: '代码块公式', hint: '```math 围栏' },
    { key: 'mdSubscript', label: '下标', hint: 'H~2~O' },
    { key: 'mdSuperscript', label: '上标', hint: 'X^2^' },
    { key: 'mdHighlight', label: '高亮', hint: '==key==' },
    { key: 'mdUnderline', label: '下划线', hint: '<u>key</u>' },
    { key: 'mdAlerts', label: 'Github Style Alert', hint: '> [!NOTE] 等五种' },
    { key: 'mdDiagrams', label: '图表', hint: 'mermaid / flowchart / sequence' },
    { key: 'mdAutoLink', label: '自动识别链接', hint: '正文里的裸 URL' },
  ]

  const colorRow = el('div', { class: 'settings__colors' })
  const colorInputs = new Map<keyof CustomTheme, HTMLInputElement>()
  for (const field of COLOR_FIELDS) {
    const input = el('input', { class: 'settings__color', type: 'color' })
    colorInputs.set(field.key, input)
    colorRow.append(
      el(
        'label',
        { class: 'settings__field settings__field--color' },
        el('span', { class: 'settings__label', text: field.label }),
        input,
      ),
    )
  }

  const colorSection = el(
    'section',
    { class: 'settings__section', 'data-section': 'custom-theme' },
    el('h3', { class: 'settings__heading', text: '自定义主题色' }),
    colorRow,
  )

  // 通用：启动、保存、统计、拼写。Typora 把这四项都放在「通用」面板
  // （启动选项 / 保存&恢复 / 字数统计 / 拼写检查），此处照搬其归类。
  const generalPanel = el(
    'div',
    { class: 'settings__panel-body', 'data-tab-panel': 'general' },
    el(
      'section',
      { class: 'settings__section', 'data-section': 'launch' },
      el('h3', { class: 'settings__heading', text: '启动' }),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        restoreSessionCheck,
        el('span', { class: 'settings__label', text: '重启后恢复上次打开的标签页' }),
      ),
    ),
    el(
      'section',
      { class: 'settings__section', 'data-section': 'save-recover' },
      el('h3', { class: 'settings__heading', text: '保存与恢复' }),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        autoSaveCheck,
        el('span', { class: 'settings__label', text: '自动保存（有路径的文档）' }),
      ),
      el(
        'label',
        { class: 'settings__field' },
        el('span', { class: 'settings__label', text: '自动保存延时 (ms)' }),
        autoSaveDelayInput,
      ),
    ),
    el(
      'section',
      { class: 'settings__section', 'data-section': 'status' },
      el('h3', { class: 'settings__heading', text: '统计与校对' }),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        showStatsCheck,
        el('span', { class: 'settings__label', text: '状态栏显示字数统计' }),
      ),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        spellcheckCheck,
        el('span', { class: 'settings__label', text: '拼写检查' }),
      ),
    ),
  )

  const appearancePanel = el(
    'div',
    { class: 'settings__panel-body', 'data-tab-panel': 'appearance' },
    el(
      'section',
      { class: 'settings__section' },
      el('h3', { class: 'settings__heading', text: '主题与字号' }),
      el(
        'label',
        { class: 'settings__field' },
        el('span', { class: 'settings__label', text: '主题' }),
        themeSelect,
      ),
      el(
        'label',
        { class: 'settings__field' },
        el('span', { class: 'settings__label', text: '字号 (px)' }),
        fontInput,
      ),
      el(
        'label',
        { class: 'settings__field' },
        el('span', { class: 'settings__label', text: '编辑区宽度 (px)' }),
        widthInput,
      ),
    ),
    el(
      'section',
      { class: 'settings__section', 'data-section': 'fonts' },
      el('h3', { class: 'settings__heading', text: '字体' }),
      el(
        'label',
        { class: 'settings__field' },
        el('span', { class: 'settings__label', text: '正文字体（界面与预览正文）' }),
        bodyFontInput,
      ),
      el(
        'label',
        { class: 'settings__field' },
        el('span', { class: 'settings__label', text: '代码字体（源码视图与代码块）' }),
        codeFontInput,
      ),
      el('p', {
        class: 'settings__label',
        text: '留空即恢复系统默认字体；可填 “Georgia, serif”、“JetBrains Mono” 等字体族。',
      }),
    ),
    colorSection,
  )

  const editorPanel = el(
    'div',
    { class: 'settings__panel-body', 'data-tab-panel': 'editor' },
    el(
      'section',
      { class: 'settings__section' },
      el('h3', { class: 'settings__heading', text: '编辑行为' }),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        typewriterCheck,
        el('span', { class: 'settings__label', text: '打字机模式（光标行居中）' }),
      ),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        focusModeCheck,
        el('span', { class: 'settings__label', text: '专注模式（隐藏侧栏与状态栏）' }),
      ),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        lineNumbersCheck,
        el('span', { class: 'settings__label', text: '分屏/源码视图显示行号' }),
      ),
    ),
    el(
      'section',
      { class: 'settings__section', 'data-section': 'editor-smart-input' },
      el('h3', { class: 'settings__heading', text: '智能输入' }),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        smartQuotesCheck,
        el('span', { class: 'settings__label', text: '智能引号（" 变成 “ ”）' }),
      ),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        smartDashesCheck,
        el('span', { class: 'settings__label', text: '智能破折号（-- 变成 —，... 变成 …）' }),
      ),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        pairedSymbolsCheck,
        el('span', { class: 'settings__label', text: '使用成对的符号（打左括号自动补右括号）' }),
      ),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        emojiAutocompleteCheck,
        el('span', { class: 'settings__label', text: 'Emoji 自动补全（:smile: → 😄）' }),
      ),
      el('p', {
        class: 'settings__label',
        text: '三项默认全部关闭 —— 它们会改写你敲进去的内容，开与不开应当由你决定。',
      }),
    ),
    el(
      'section',
      { class: 'settings__section', 'data-section': 'editor-code' },
      el('h3', { class: 'settings__heading', text: '代码块' }),
      el(
        'label',
        { class: 'settings__field' },
        el('span', { class: 'settings__label', text: '新建代码块的默认语言' }),
        codeBlockLanguageInput,
      ),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        codeBlockWrapCheck,
        el('span', { class: 'settings__label', text: '代码块自动换行' }),
      ),
      el(
        'label',
        { class: 'settings__field' },
        el('span', { class: 'settings__label', text: '默认缩进（空格数，1–8）' }),
        listIndentInput,
      ),
      el('p', {
        class: 'settings__label',
        text: '只取第一个词：空格会提前结束围栏的 info string，后面会变成围栏元数据。',
      }),
    ),
    el(
      'section',
      { class: 'settings__section', 'data-section': 'editor-save' },
      el('h3', { class: 'settings__heading', text: '保存时' }),
      el(
        'label',
        { class: 'settings__field' },
        el('span', { class: 'settings__label', text: '换行符' }),
        lineEndingSelect,
      ),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        finalNewlineCheck,
        el('span', { class: 'settings__label', text: '在文末添加空行' }),
      ),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        copyTextAsMarkdownCheck,
        el('span', { class: 'settings__label', text: '复制为纯文本时复制 Markdown 源码' }),
      ),
      el('p', {
        class: 'settings__label',
        text: '换行符只在写盘时应用，不会改动编辑器里的内容（否则光标会因为你换了个偏好而跳动）。',
      }),
    ),
    el(
      'section',
      { class: 'settings__section', 'data-section': 'editor-workspace' },
      el('h3', { class: 'settings__heading', text: '文件树过滤' }),
      el(
        'label',
        { class: 'settings__field' },
        el('span', { class: 'settings__label', text: 'Glob 模式（留空显示全部）' }),
        workspaceGlobInput,
      ),
      el('p', {
        class: 'settings__label',
        text: '每行或逗号分隔。`!` 前缀表示排除，最后一条匹配的规则生效（与 gitignore 一致，所以宽泛的包含后面还能再收窄）。`*` 不跨目录，`**` 跨；不含 `/` 的模式匹配任意层级的文件名。',
      }),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        showHiddenFilesCheck,
        el('span', { class: 'settings__label', text: '显示隐藏的文件夹 / 文件' }),
      ),
      el('p', {
        class: 'settings__label',
        text: '只影响以 `.` 开头的条目。`node_modules`、`.git` 之类属于构建与版本控制的噪音，无论开关如何都仍然隐藏 —— 「显示隐藏」不该变成误入代码仓库的途径。',
      }),
      el(
        'label',
        { class: 'settings__field' },
        el('span', { class: 'settings__label', text: '大纲显示的标题层数' }),
        outlineMaxLevelSelect,
      ),
      el('p', {
        class: 'settings__label',
        text: '只过滤显示，不改变层级编号：被过滤掉的二级标题下面的三级标题，仍然按三级缩进。',
      }),
    ),
  )

  // Markdown：Typora 的「Markdown」面板，负责语法开关。这些开关同时作用于
  // 导出管线与分屏视图，因此不需要重启即可生效。
  const markdownPanel = el(
    'div',
    { class: 'settings__panel-body', 'data-tab-panel': 'markdown' },
    el(
      'section',
      { class: 'settings__section', 'data-section': 'syntax-support' },
      el('h3', { class: 'settings__heading', text: '语法支持' }),
      ...MD_SYNTAX_FIELDS.map((field) =>
        el(
          'label',
          { class: 'settings__field settings__field--row' },
          mdSyntaxChecks[field.key],
          el('span', { class: 'settings__label', text: `${field.label} — ${field.hint}` }),
        ),
      ),
      el('p', {
        class: 'settings__label',
        text: '关闭后，对应的语法按普通文本显示与导出；文档内容不受影响，重新开启即可恢复。',
      }),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        preserveLineBreaksCheck,
        el('span', { class: 'settings__label', text: '保留单换行符（段落内换行渲染为换行）' }),
      ),
      el('p', {
        class: 'settings__label',
        text: '只影响渲染与导出：源码里那个换行不会被改写。代码块内的换行是内容，不受影响。',
      }),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        remapUnicodePunctuationCheck,
        el('span', { class: 'settings__label', text: '解析时识别 Unicode 标点' }),
      ),
      el('p', {
        class: 'settings__label',
        text: '把 Unicode 标点的替代形式当作 ASCII 来读：「title」/«title» 当作链接标题，》当作引用，全角 ＃＊－ 当作 Markdown 标记 —— 适合输入法打不出 ASCII 标点的情况。源文件不改写，但渲染结果会是重映射后的形式。',
      }),
    ),
  )

  // 图像：对应 Typora「图像」面板。Markup 另有「粘贴图片转为 Markdown」这道
  // 总开关（Typora 没有），所以拆成两节：先管粘贴要不要转，再管转出来的图片放哪。
  const imagePanel = el(
    'div',
    { class: 'settings__panel-body', 'data-tab-panel': 'image' },
    el(
      'section',
      { class: 'settings__section', 'data-section': 'image-paste' },
      el('h3', { class: 'settings__heading', text: '粘贴图片' }),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        imagePasteCheck,
        el('span', { class: 'settings__label', text: '粘贴图片转为 Markdown' }),
      ),
      el('p', {
        class: 'settings__label',
        text: '开启后，从浏览器或截图工具复制的位图粘贴进来时会转成 Markdown 图片；关闭则保持为纯文本。',
      }),
    ),
    el(
      'section',
      { class: 'settings__section', 'data-section': 'image-insert' },
      el('h3', { class: 'settings__heading', text: '插入图片时' }),
      ...IMAGE_MODE_LABELS.map(({ mode, label }) =>
        el(
          'label',
          { class: 'settings__field settings__field--row' },
          imageModeInputs.get(mode)!,
          // 字面量里带 ${filename}，所以用普通字符串而不是模板串。
          el('span', { class: 'settings__label', text: label }),
        ),
      ),
      imageCustomRow,
      el('p', {
        class: 'settings__label',
        text: '可用 ${filename}（当前文件名，不含扩展名）与 ${filepath}（含目录、不含扩展名）。文档尚未保存时无目录可用，图片会保持内联。',
      }),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        imagePreferRelativeCheck,
        el('span', {
          class: 'settings__label',
          text: '优先使用相对路径（跨盘符时自动回退为绝对路径）',
        }),
      ),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        imageDotPrefixCheck,
        el('span', { class: 'settings__label', text: '图片语法偏好：为相对路径添加 ./' }),
      ),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        imageEscapeUrlCheck,
        el('span', { class: 'settings__label', text: '插入时自动转义图片 URL' }),
      ),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        imageApplyLocalCheck,
        el('span', { class: 'settings__label', text: '对本地位置的图片应用上述规则' }),
      ),
    ),
  )

  // 导出：Typora 把 Pandoc 路径放在「导出」面板，转换器路径同理归到这里。
  const exportPanel = el(
    'div',
    { class: 'settings__panel-body', 'data-tab-panel': 'export' },
    el(
      'section',
      { class: 'settings__section', 'data-section': 'converter' },
      el('h3', { class: 'settings__heading', text: '文档转换' }),
      el(
        'label',
        { class: 'settings__field' },
        el('span', { class: 'settings__label', text: '转换器程序路径' }),
        converterPathInput,
      ),
      el('p', {
        class: 'settings__label',
        text: '「导入文档」与「导出为 Word/ODT/RTF/EPUB」靠它完成转换。留空则依次查找 PATH 上的 pandoc、carta；Markup 不内置该程序，装好后无需填写。',
      }),
      el(
        'label',
        { class: 'settings__field' },
        el('span', { class: 'settings__label', text: 'Markdown 变体（导入 / 导出用）' }),
        markdownFormatSelect,
      ),
      el('p', {
        class: 'settings__label',
        text: '这是一个交给 pandoc 的格式名，不是本应用实现的方言：gfm 能让本渲染器自己的表格、脚注与任务列表原样往返；commonmark_x 即 Typora 的「CommonMark + pandoc 扩展」。',
      }),
    ),
    el(
      'section',
      { class: 'settings__section', 'data-section': 'export-output' },
      el('h3', { class: 'settings__heading', text: '导出位置与后续动作' }),
      el(
        'label',
        { class: 'settings__field' },
        el('span', { class: 'settings__label', text: '默认导出文件夹' }),
        exportFolderInput,
      ),
      el(
        'label',
        { class: 'settings__field' },
        el('span', { class: 'settings__label', text: '导出后' }),
        exportAfterSelect,
      ),
    ),
    el(
      'section',
      { class: 'settings__section', 'data-section': 'export-page' },
      el('h3', { class: 'settings__heading', text: '页面设置' }),
      el(
        'label',
        { class: 'settings__field' },
        el('span', { class: 'settings__label', text: '纸张大小' }),
        exportPageSizeInput,
      ),
      el(
        'label',
        { class: 'settings__field' },
        el('span', { class: 'settings__label', text: '页边距' }),
        exportPageMarginInput,
      ),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        exportPageBreakCheck,
        el('span', { class: 'settings__label', text: '按一级标题分页' }),
      ),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        firstLineIndentCheck,
        el('span', { class: 'settings__label', text: '首行缩进（每段首行缩进两字）' }),
      ),
      el('p', {
        class: 'settings__label',
        text: '页面设置只作用于导出 PDF 与打印（浏览器忽略屏幕上的 @page 规则）。纸张与页边距会做白名单校验，只允许字母数字与空格 . % / -，避免破坏样式表。',
      }),
    ),
    el(
      'section',
      { class: 'settings__section', 'data-section': 'export-html' },
      el('h3', { class: 'settings__heading', text: 'HTML 与打印' }),
      el(
        'label',
        { class: 'settings__field settings__field--row' },
        exportOutlineCheck,
        el('span', { class: 'settings__label', text: '在导出的 HTML 开头加上大纲' }),
      ),
      el(
        'label',
        { class: 'settings__field' },
        el('span', { class: 'settings__label', text: '自定义 CSS（追加在内置样式之后）' }),
        exportCustomCssInput,
      ),
      el(
        'label',
        { class: 'settings__field' },
        el('span', { class: 'settings__label', text: '追加到 <head>' }),
        exportHeadHtmlInput,
      ),
      el(
        'label',
        { class: 'settings__field' },
        el('span', { class: 'settings__label', text: '追加到 <body>' }),
        exportBodyHtmlInput,
      ),
    ),
  )

  let current: AppConfig = callbacks.getAppearance()
  let activeTab = 'general'
  /** Set while a search hides the custom-theme section regardless of theme. */
  let colorSectionHiddenBySearch = false

  const tabButtons = new Map<string, HTMLButtonElement>()
  const tabNav = el(
    'nav',
    { class: 'settings__tabs', role: 'tablist', 'aria-label': '设置分类' },
    ...TAB_LABELS.map(({ id, label }) => {
      const button = el('button', {
        class: `settings__tab${id === activeTab ? ' is-active' : ''}`,
        type: 'button',
        role: 'tab',
        'data-tab': id,
        'aria-selected': id === activeTab ? 'true' : 'false',
        text: label,
        onclick: () => setTab(id),
      })
      tabButtons.set(id, button as HTMLButtonElement)
      return button
    }),
  )

  const panels = new Map<string, HTMLElement>([
    ['general', generalPanel],
    ['appearance', appearancePanel],
    ['editor', editorPanel],
    ['markdown', markdownPanel],
    ['image', imagePanel],
    ['export', exportPanel],
  ])

  const setTab = (tab: string): void => {
    activeTab = tab
    for (const [id, button] of tabButtons) {
      const on = id === tab
      button.classList.toggle('is-active', on)
      button.setAttribute('aria-selected', on ? 'true' : 'false')
    }
    for (const [id, panel] of panels) {
      panel.hidden = id !== tab
    }
    colorSection.hidden =
      tab !== 'appearance' || current.theme !== 'custom' || colorSectionHiddenBySearch
  }

  /** Select a 插入图片时 radio; the target-path row only applies to `custom`. */
  const applyImageMode = (mode: ImageCopyMode): void => {
    for (const [value, input] of imageModeInputs) input.checked = value === mode
    // A class, not `hidden`: the settings search walks every `.settings__field`
    // and writes `hidden` on each, which would clobber the row on every
    // keystroke and on open.
    imageCustomRow.classList.toggle('settings__field--off', mode !== 'custom')
  }

  const checkedImageMode = (): ImageCopyMode =>
    IMAGE_COPY_MODES.find((mode) => imageModeInputs.get(mode)?.checked) ?? 'none'

  const fill = (config: AppConfig): void => {
    current = config
    themeSelect.value = config.theme
    fontInput.value = String(config.fontSize || 16)
    widthInput.value = String(config.lineWidth || 780)
    bodyFontInput.value = config.bodyFont ?? ''
    codeFontInput.value = config.codeFont ?? ''
    converterPathInput.value = config.converterPath ?? ''
    markdownFormatSelect.value = config.converterMarkdownFormat ?? 'gfm'
    autoSaveCheck.checked = config.autoSave === true
    autoSaveDelayInput.value = String(config.autoSaveDelayMs ?? 1500)
    autoSaveDelayInput.disabled = config.autoSave !== true
    typewriterCheck.checked = config.typewriter === true
    imagePasteCheck.checked = config.imagePaste !== false
    applyImageMode(config.imageCopyMode ?? 'none')
    imageCustomPathInput.value = config.imageCopyCustomPath ?? ''
    imagePreferRelativeCheck.checked = config.imagePreferRelative !== false
    imageDotPrefixCheck.checked = config.imageDotPrefix === true
    imageEscapeUrlCheck.checked = config.imageEscapeUrl === true
    imageApplyLocalCheck.checked = config.imageApplyLocal !== false
    smartQuotesCheck.checked = config.smartQuotes === true
    smartDashesCheck.checked = config.smartDashes === true
    pairedSymbolsCheck.checked = config.pairedSymbols === true
    emojiAutocompleteCheck.checked = config.emojiAutocomplete === true
    codeBlockLanguageInput.value = config.codeBlockLanguage ?? ''
    lineEndingSelect.value = config.lineEnding ?? 'preserve'
    finalNewlineCheck.checked = config.ensureFinalNewline === true
    copyTextAsMarkdownCheck.checked = config.copyTextAsMarkdown === true
    workspaceGlobInput.value = config.workspaceGlob ?? ''
    showHiddenFilesCheck.checked = config.showHiddenFiles === true
    outlineMaxLevelSelect.value = String(config.outlineMaxLevel ?? 0)
    firstLineIndentCheck.checked = config.firstLineIndent === true
    codeBlockWrapCheck.checked = config.codeBlockWrap === true
    preserveLineBreaksCheck.checked = config.preserveLineBreaks === true
    remapUnicodePunctuationCheck.checked = config.remapUnicodePunctuation === true
    listIndentInput.value = String(config.listIndentSize ?? 2)
    exportFolderInput.value = config.exportFolder ?? ''
    exportAfterSelect.value = config.exportAfter ?? 'none'
    exportPageSizeInput.value = config.exportPageSize ?? ''
    exportPageMarginInput.value = config.exportPageMargin ?? ''
    exportPageBreakCheck.checked = config.exportPageBreakOnH1 === true
    exportOutlineCheck.checked = config.exportOutline === true
    exportCustomCssInput.value = config.exportCustomCss ?? ''
    exportHeadHtmlInput.value = config.exportHeadHtml ?? ''
    exportBodyHtmlInput.value = config.exportBodyHtml ?? ''
    spellcheckCheck.checked = config.spellcheck === true
    restoreSessionCheck.checked = config.restoreSession !== false
    lineNumbersCheck.checked = config.lineNumbers === true
    showStatsCheck.checked = config.showStats !== false
    focusModeCheck.checked = config.focusMode === true
    for (const field of MD_SYNTAX_FIELDS) {
      // Absent key means enabled — same default the pipeline and 分屏 use.
      mdSyntaxChecks[field.key].checked = config[field.key] !== false
    }
    colorSection.hidden =
      activeTab !== 'appearance' || config.theme !== 'custom' || colorSectionHiddenBySearch
    for (const field of COLOR_FIELDS) {
      const input = colorInputs.get(field.key)
      if (input) {
        input.value = toHexColor(config.customTheme?.[field.key], field.fallback)
      }
    }
  }

  /** Read the nine 语法支持 checkboxes back into an AppConfig patch. */
  const mdSyntaxPatch = (): Partial<AppConfig> =>
    Object.fromEntries(MD_SYNTAX_FIELDS.map((field) => [field.key, checked(mdSyntaxChecks[field.key])]))

  const emit = (patch: Partial<AppConfig>): void => {
    const autoSaveOn = checked(autoSaveCheck)
    const next: AppConfig = {
      ...current,
      ...patch,
      theme: themeSelect.value as AppConfig['theme'],
      fontSize: Math.max(12, Math.min(28, Number(fontInput.value) || 16)),
      lineWidth: Math.max(480, Math.min(1400, Number(widthInput.value) || 780)),
      bodyFont: bodyFontInput.value.trim() || undefined,
      codeFont: codeFontInput.value.trim() || undefined,
      converterPath: converterPathInput.value.trim() || undefined,
      // 'gfm' is the default, so it never has to be stored.
      converterMarkdownFormat:
        markdownFormatSelect.value === 'gfm' ? undefined : markdownFormatSelect.value,
      autoSave: autoSaveOn,
      autoSaveDelayMs: Math.max(300, Math.min(60000, Number(autoSaveDelayInput.value) || 1500)),
      typewriter: checked(typewriterCheck),
      imagePaste: checked(imagePasteCheck),
      imageCopyMode: checkedImageMode(),
      imageCopyCustomPath: imageCustomPathInput.value.trim() || undefined,
      imagePreferRelative: checked(imagePreferRelativeCheck),
      imageDotPrefix: checked(imageDotPrefixCheck),
      imageEscapeUrl: checked(imageEscapeUrlCheck),
      imageApplyLocal: checked(imageApplyLocalCheck),
      smartQuotes: checked(smartQuotesCheck),
      smartDashes: checked(smartDashesCheck),
      pairedSymbols: checked(pairedSymbolsCheck),
      emojiAutocomplete: checked(emojiAutocompleteCheck),
      codeBlockLanguage: codeBlockLanguageInput.value.trim() || undefined,
      // `preserve` is the default, so it never has to be stored.
      lineEnding:
        lineEndingSelect.value === 'preserve'
          ? undefined
          : (lineEndingSelect.value as AppConfig['lineEnding']),
      ensureFinalNewline: checked(finalNewlineCheck),
      copyTextAsMarkdown: checked(copyTextAsMarkdownCheck),
      workspaceGlob: workspaceGlobInput.value.trim() || undefined,
      showHiddenFiles: checked(showHiddenFilesCheck),
      // 0 is "全部层级", the default, so it never has to be stored.
      outlineMaxLevel: Number(outlineMaxLevelSelect.value) || undefined,
      firstLineIndent: checked(firstLineIndentCheck),
      codeBlockWrap: checked(codeBlockWrapCheck),
      // 2 is the default, so it never has to be stored.
      listIndentSize: Number(listIndentInput.value) === 2 ? undefined : Number(listIndentInput.value),
      preserveLineBreaks: checked(preserveLineBreaksCheck),
      remapUnicodePunctuation: checked(remapUnicodePunctuationCheck),
      exportFolder: exportFolderInput.value.trim() || undefined,
      // Absent means "do nothing", so the default never has to be stored.
      exportAfter:
        exportAfterSelect.value === 'none'
          ? undefined
          : (exportAfterSelect.value as AppConfig['exportAfter']),
      exportPageSize: exportPageSizeInput.value.trim() || undefined,
      exportPageMargin: exportPageMarginInput.value.trim() || undefined,
      exportPageBreakOnH1: checked(exportPageBreakCheck),
      exportOutline: checked(exportOutlineCheck),
      exportCustomCss: exportCustomCssInput.value.trim() || undefined,
      exportHeadHtml: exportHeadHtmlInput.value.trim() || undefined,
      exportBodyHtml: exportBodyHtmlInput.value.trim() || undefined,
      spellcheck: checked(spellcheckCheck),
      restoreSession: checked(restoreSessionCheck),
      lineNumbers: checked(lineNumbersCheck),
      showStats: checked(showStatsCheck),
      focusMode: checked(focusModeCheck),
      ...mdSyntaxPatch(),
    }
    autoSaveDelayInput.disabled = !autoSaveOn
    if (next.theme === 'custom') {
      const customTheme: CustomTheme = { ...current.customTheme }
      for (const field of COLOR_FIELDS) {
        const input = colorInputs.get(field.key)
        if (input) customTheme[field.key] = input.value
      }
      next.customTheme = customTheme
    }
    current = next
    callbacks.onAppearanceChange(next)
    colorSection.hidden =
      activeTab !== 'appearance' || next.theme !== 'custom' || colorSectionHiddenBySearch
  }

  themeSelect.addEventListener('change', () => emit({}))
  fontInput.addEventListener('change', () => emit({}))
  widthInput.addEventListener('change', () => emit({}))
  bodyFontInput.addEventListener('change', () => emit({}))
  codeFontInput.addEventListener('change', () => emit({}))
  converterPathInput.addEventListener('change', () => emit({}))
  markdownFormatSelect.addEventListener('change', () => emit({}))
  autoSaveDelayInput.addEventListener('change', () => emit({}))
  listIndentInput.addEventListener('change', () => emit({}))
  for (const input of [
    autoSaveCheck,
    typewriterCheck,
    imagePasteCheck,
    spellcheckCheck,
    restoreSessionCheck,
    lineNumbersCheck,
    showStatsCheck,
    focusModeCheck,
    ...MD_SYNTAX_FIELDS.map((field) => mdSyntaxChecks[field.key]),
    imagePreferRelativeCheck,
    imageDotPrefixCheck,
    imageEscapeUrlCheck,
    imageApplyLocalCheck,
    exportPageBreakCheck,
    exportOutlineCheck,
    firstLineIndentCheck,
    codeBlockWrapCheck,
    preserveLineBreaksCheck,
    remapUnicodePunctuationCheck,
    smartQuotesCheck,
    smartDashesCheck,
    pairedSymbolsCheck,
    emojiAutocompleteCheck,
    finalNewlineCheck,
    copyTextAsMarkdownCheck,
    showHiddenFilesCheck,
  ]) {
    input.addEventListener('change', () => emit({}))
  }
  lineEndingSelect.addEventListener('change', () => emit({}))
  outlineMaxLevelSelect.addEventListener('change', () => emit({}))
  exportAfterSelect.addEventListener('change', () => emit({}))
  for (const input of [
    exportFolderInput,
    exportPageSizeInput,
    exportPageMarginInput,
    exportCustomCssInput,
    exportHeadHtmlInput,
    exportBodyHtmlInput,
    codeBlockLanguageInput,
    workspaceGlobInput,
  ]) {
    input.addEventListener('change', () => emit({}))
  }
  // Radios need the same emit plus a re-derive, so the 目标路径 row appears and
  // disappears with the selection instead of only on the next fill().
  for (const input of imageModeInputs.values()) {
    input.addEventListener('change', () => {
      applyImageMode(checkedImageMode())
      emit({})
    })
  }
  imageCustomPathInput.addEventListener('change', () => emit({}))
  for (const input of colorInputs.values()) {
    input.addEventListener('input', () => emit({}))
  }

  // ---- settings search -------------------------------------------------
  // Filters every tab generically: sections/fields are matched by their text,
  // tabs without hits collapse, and the active tab hops to the first hit.
  const searchInput = el('input', {
    class: 'settings__search',
    type: 'search',
    placeholder: '搜索设置…',
    spellcheck: 'false',
    autocomplete: 'off',
    'aria-label': '搜索设置',
  })
  const searchStatus = el('p', {
    class: 'settings__label settings__search-status',
    text: '没有匹配的设置项',
    hidden: true,
  })

  const includesQuery = (text: string, query: string): boolean =>
    text.toLowerCase().includes(query)

  let colorSectionMatched = false

  const applyFilter = (): void => {
    const query = searchInput.value.trim().toLowerCase()
    const searching = query.length > 0
    const matchesById = new Map<string, boolean>()
    colorSectionMatched = false

    for (const [id, panelBody] of panels) {
      let panelHit = !searching
      const sections = [...panelBody.querySelectorAll<HTMLElement>('.settings__section')]
      const units = sections.length > 0 ? sections : [panelBody]
      for (const section of units) {
        const isColorSection = section === colorSection
        const heading = section.querySelector('.settings__heading')?.textContent ?? ''
        const fields = [...section.querySelectorAll<HTMLElement>('.settings__field')]
        let sectionHit = !searching
        if (fields.length > 0) {
          const headingHit = searching && includesQuery(heading, query)
          let fieldHits = 0
          for (const field of fields) {
            if (field.hasAttribute('data-keep')) {
              field.hidden = false
              continue
            }
            const hit = headingHit || !searching || includesQuery(field.textContent ?? '', query)
            field.hidden = !hit
            if (hit) {
              fieldHits += 1
              sectionHit = true
            }
          }
          if (headingHit && fieldHits === 0) sectionHit = true
        } else {
          sectionHit = !searching || includesQuery(section.textContent ?? '', query)
        }
        section.hidden = !sectionHit
        if (sectionHit) {
          panelHit = true
          if (isColorSection) colorSectionMatched = true
        }
      }
      matchesById.set(id, panelHit)
      const button = tabButtons.get(id)
      if (button) button.hidden = searching && !panelHit
    }

    let firstMatch: string | null = null
    for (const [id, hit] of matchesById) {
      if (hit) {
        firstMatch = id
        break
      }
    }
    colorSectionHiddenBySearch = searching && !colorSectionMatched
    searchStatus.hidden = !searching || firstMatch !== null
    if (searching && matchesById.get(activeTab) === false && firstMatch) setTab(firstMatch)
    else setTab(activeTab)
  }

  searchInput.addEventListener('input', applyFilter)

  const body = el(
    'div',
    { class: 'settings__body' },
    generalPanel,
    appearancePanel,
    editorPanel,
    markdownPanel,
    imagePanel,
    exportPanel,
  )
  const panel = el(
    'div',
    { class: 'settings__panel', role: 'dialog', 'aria-label': '设置' },
    el(
      'header',
      { class: 'settings__header' },
      el('h2', { class: 'settings__title', text: '设置' }),
      searchInput,
      el('button', {
        class: 'settings__close',
        type: 'button',
        text: '×',
        'aria-label': '关闭',
        onclick: () => close(),
      }),
    ),
    searchStatus,
    tabNav,
    body,
  )
  const root = el('div', { class: 'settings', hidden: true }, panel)

  const registerTab = (spec: SettingsTabSpec): (() => void) => {
    if (tabButtons.has(spec.id)) throw new Error(`settings tab already registered: ${spec.id}`)
    const button = el('button', {
      class: 'settings__tab',
      type: 'button',
      role: 'tab',
      'data-tab': spec.id,
      'aria-selected': 'false',
      text: spec.label,
      onclick: () => setTab(spec.id),
    })
    const newPanel = spec.render()
    newPanel.hidden = true
    tabNav.appendChild(button)
    body.appendChild(newPanel)
    tabButtons.set(spec.id, button)
    panels.set(spec.id, newPanel)
    return () => {
      button.remove()
      newPanel.remove()
      tabButtons.delete(spec.id)
      panels.delete(spec.id)
      if (activeTab === spec.id) setTab('general')
    }
  }

  const open = (tab?: string): void => {
    fill(callbacks.getAppearance())
    applyFilter()
    if (tab) setTab(tab)
    else setTab(activeTab)
    root.hidden = false
    themeSelect.focus()
  }

  const close = (): void => {
    root.hidden = true
    callbacks.onClose?.()
    // A stale query would hide fields on the next open — reset it here.
    if (searchInput.value !== '') {
      searchInput.value = ''
      applyFilter()
    }
  }

  const toggle = (): void => {
    if (root.hidden) open()
    else close()
  }

  root.addEventListener('click', (event) => {
    if (event.target === root) close()
  })

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      close()
    }
  })

  fill(current)
  setTab(activeTab)

  return {
    el: root,
    open,
    close,
    toggle,
    isOpen: () => !root.hidden,
    getTab: () => activeTab,
    setTab,
    registerTab,
  }
}

# Typora 功能对齐清单

参照来源：本机 Typora 安装包 `resources/locales/Base.lproj/Menu.json`（301 条菜单项）
与 `Panel.json`（500 条偏好键）。键序即 Typora 面板/菜单的真实排列。

**范围**：除 license 外全部。已排除 Typora 的 My License / Registration / Activation
（菜单项 268、269）及偏好面板里的激活相关提示（面板键 399–406）。

状态标记：
- ✅ 已有 —— MarkUp 已具备等价能力
- 🔶 差异 —— 有但行为/入口不同
- ⬜ 缺失 —— 待实现

---

## 施工批次

| 批次 | 主题 | 状态 |
|---|---|---|
| 1 | Markdown 语法扩展与行内格式 | ✅ |
| 2 | 图像落盘与图像工具 | 🔶 落盘 + 文档侧图像工具已完成；打开图片位置/上传待办 |
| 3 | 段落与列表操作 | 🔶 标题步进/缩进/任务状态/目录/Front Matter/表格/删除块/上下方插入段落 已完成；链接引用、HTML 块待办 |
| 4 | 视图、缩放与窗口 | 🔶 缩放/只读/全屏/置顶/工具栏已完成；文档列表待办 |
| 5 | 导出选项与页面设置 | 🔶 位置/导出后/页面设置/HTML 追加/大纲已完成 |
| 6 | 文件操作与拖放 | 🔶 保存全部/重开关闭/拖放/打开位置/在树中显示已完成；编码重开、创建副本待办 |
| 7 | 编辑器行为 | 🔶 智能输入/选中/跳转/整行/保存规范化/代码块语言/缩进/换行/首行缩进 已完成；输入时转换、Unicode 标点、Emoji 待办 |
| 8 | 查找、导航与统计 | ✅ 全词匹配 + 字数统计浮窗 + 大纲浮窗 |
| 9 | 侧边栏增强 | ✅ 大纲折叠与层数、文件树/文件库、glob 过滤、隐藏文件、树内新建、在树中显示 |
| 10 | 系统集成与杂项 | 🔶 简化格式/表格源码/Google 搜索/复制到 Word 已完成；**界面语言、检查更新暂不实现**（见下） |

### 暂不实现（已明确决定，非遗漏）

| 项 | 原因 |
|---|---|
| 界面语言（i18n） | 需要抽出全应用数百条中文字面量并建立文案表 + 语言切换通道。是独立工程，不该混在功能批次里做半套。 |
| 检查更新 | 需要版本端点 + 网络策略 + 各壳的更新器（Tauri updater / Electron autoUpdater / …），且无法在本机验证。 |
| 字典（添加到字典 / 忘记拼写） | 依赖 Chromium 的拼写检查会话 API，Electron/Tauri/Wails 均未向外暴露。 |
| 资源管理器「新建」菜单 | 是安装器写注册表的行为（NSIS），不属于运行时功能。 |
| 复制为图片 | 需要把选区连同**计算样式**光栅化（SVG foreignObject → canvas）。要在本机验证，否则等于交付一个看不见的东西。 |


| 9 | 侧边栏增强（文档库/文件树/大纲） | ⬜ |
| 10 | 系统集成与杂项 | ⬜ |

---

## 1. Markdown 语法扩展与行内格式（Typora 的灵魂）

对应 Typora 偏好「Markdown ▸ 语法支持」与菜单「格式」节。

| Typora 项 | 语法 | 状态 |
|---|---|---|
| 内联公式 | `$...$` | ✅ `math.ts`；可开关 |
| Code Block Math | ` ```math ` | ✅ `pipeline.ts`；可开关 |
| 下标 | `H~2~O` | ✅ `mdSyntax.ts`；分屏 + 导出 |
| 上标 | `X^2^` | ✅ `mdSyntax.ts`；分屏 + 导出 |
| 高亮 | `==key==` | ✅ `mdSyntax.ts`；分屏 + 导出 |
| 下划线 | `<u>` / `<ins>` | ✅ `mdSyntax.ts`；分屏 + 导出 |
| 删除线 | `~~x~~` | ✅ 引擎本就支持，已补命令与菜单项 |
| 自动识别链接 | 裸 URL | ✅ 可开关（按 `class="auto"` 识别自动链接） |
| 图表（序列/流程/Mermaid） | | ✅ `diagrams.ts`；可开关 |
| Github Style Alert | `> [!NOTE]` 等五种 | ✅ `mdAlerts.ts`；分屏 + 导出 |
| 严格模式（更严格遵循 GFM） | | 🔶 引擎固定 GFM |
| 行内注释 | | ⬜ |
| 清除样式（行内） | | ⬜ |

设置项（Typora「Markdown ▸ 语法支持」）：内联公式 / 代码块公式 / 下标 / 上标 /
高亮 / 下划线 / Github Style Alert / 图表 / 自动识别链接 —— **九项全部可开关**，
落在新增的「Markdown」设置面板（位置与 Typora 一致：编辑器与图像之间）。

**关键取舍：`remark-gfm({ singleTilde: false })`。** GFM 默认把 `~x~` 也当删除线，
那样单个 `~` 就没法给下标用。关掉后 `~~x~~` 成为唯一的删除线写法 —— 与 Typora 相同。
同一条规则也在分屏视图里手工复原（OverType 自己的解析器吃单个 `~`，见 `overtypeSyntax.ts`）。

**已知缺口：实时预览（Milkdown）暂未渲染这四种行内样式。** 文档内容不受影响 ——
`~x~` / `==x==` / `^x^` / `<u>` 在该视图里原样往返，不丢失、不改写，只是不带样式；
分屏、源码与导出均已完整支持。补齐需要给 Milkdown 加自定义 mark 并验证其
`remark.stringify` 往返，那属于不能凭猜测上线的部分，单列后续。

## 2. 图像落盘与图像工具

对应 Typora 偏好「图像 ▸ 插入图片时」与菜单「图像工具」节。

**落盘部分（已做）** —— 一份解析器决定字节去哪，三个视图只负责把结果拼进文档，
所以 paste 与「插入图片」走的是同一条规则，视图之间不可能分叉。

| Typora 项 | 状态 |
|---|---|
| 插入图片时：无特殊操作 | ✅ `imageCopyMode: 'none'`（默认，保持内联 data URL） |
| 复制图片到当前文件夹 `./` | ✅ `imageCopyMode: 'folder'` |
| 复制图片到 `./assets` | ✅ `imageCopyMode: 'assets'` |
| 复制图片到 `./${filename}.assets` | ✅ `imageCopyMode: 'docAssets'` |
| 复制到指定路径（支持 `${filename}` / `${filepath}`） | ✅ `imageCopyMode: 'custom'` + `imageCopyCustomPath` |
| 优先使用相对路径 | ✅ `imagePreferRelative`（默认开；跨盘符自动回退绝对路径） |
| 插入时自动转义图片 URL | ✅ `imageEscapeUrl` |
| 图片语法偏好（为相对路径添加 `./`） | ✅ `imageDotPrefix` |
| 对本地位置的图片应用上述规则 | ✅ `imageApplyLocal`（默认开；只对「插入图片」生效，粘贴永远走规则） |
| 粘贴图片转为 Markdown | ✅ `imagePaste`（Markup 自有总开关，Typora 没有；单列一节） |
| 图片质量（中/高/极高） | ⬜ 本机不重编码图片 |
| 对网络位置的图片应用上述规则 | ⬜ 需要先下载，与「上传」同批 |
| **图像工具菜单** | 🔶 见下表 |
| 插入本地图片（文件选择器） | ✅ `insert.image`（同样走上面的规则） |
| 转换图片语法（Markdown ⇄ HTML） | ✅ `image.switchSyntax` |
| 复制图片路径 | ✅ `image.copyPath` |
| 重命名 / 移动图片到 | ✅ `image.renameFile` |
| 删除图片文件 | ✅ `image.deleteFile`（保留文档里的引用，故意留成断开） |
| 重新加载所有图片 | ✅ `image.reloadAll` |
| 复制所有图片到 | ✅ `image.copyAllTo` |
| 移动所有图片到 | ✅ `image.moveAllTo` |
| 打开图片位置 / 在文件管理器中显示 | ⬜ 需 `host.app.revealPath` |
| 拷贝图片（位图进剪贴板） | ⬜ |
| 上传图片（PicGo / PicList / 自定义命令） | ⬜ 需 `app.runCommand` |
| 在浏览器中打开图片 | ✅ 右键「打开图片」走 `app.openExternal` |

图像工具的**文档侧**全部是纯逻辑（`imageTools.ts`）：扫描引用、按解析后的路径
匹配、改写引用。**文件侧**由 shell 负责，只用到已有的可选 fs 能力。

**落盘部分的取舍：**

- **命名冲突一律改名，绝不覆盖。** 目标目录里已有同名文件时插 `-1`、`-2`……比较
  一律按大小写不敏感：在区分大小写的文件系统上最多是白跳过几个名字，在不区分的
  上猜错就是覆盖别人的图片。
- **跨盘符没有相对路径。** 这时 `relativePath` 返回空串，必须回退到绝对路径 ——
  注意 `'' ?? target` 保留空串而不是回退，这里曾经真的踩过，冒烟里钉住了。
- **路径分隔符靠文档路径推断，不能靠 `host.platform`。** 那个字段是「哪个壳」
  （electron/tauri/…），同一个构建跑在所有系统上。URL 一律转成正斜杠：Windows 的
  `\` 在 Markdown 链接目标里会转义下一个字符。
- **未保存的文档保持内联。** Typora 提示先保存；直接放弃粘贴等于丢图，所以退回
  data URL —— 仍是合法 Markdown，只是没落盘。
- **没有可写文件系统（web 壳）就没有 `writeBase64`/`mkdirp`。** 这是刻意的：缺这两
  个方法的壳自动走内联分支，而不是报错。`verifyHost` 只校验「有 writeBase64 就必须
  有 mkdirp」这一条配对不变量。

**图像工具的取舍：**

- **扫描跳过围栏与行内代码。** 围栏里的 `![](…)` 是*示例* Markdown，改写它就是
  毁掉示例。行内代码同理。
- **引用按「解析后的路径」匹配，不按写出来的字节。** `./a.png`、`a.png` 和
  `sub/../a.png` 指向同一个文件，移动它时三个都得跟着走；按字节匹配会漏。
- **`C:/a.png` 不是 URL。** 单字母 + 冒号是盘符，不是 scheme，否则 Windows 上的
  图片会被当成网络图片直接跳过。
- **单字母之外的 scheme（`data:` / `http:` / `web:`）一律算远程。** 没有本地路径，
  也就没有可移动/可删除的文件。
- **删除图片文件保留文档引用**，如 Typora：删文件和删段落是两件事，作者可能正要
  把文件放回来。
- **web 壳没有 `remove`。** 于是会破坏文件的菜单项在这里直接是 disabled，而不是
  给出一个注定失败的动作。

## 3. 段落与列表操作

对应 Typora 菜单「段落」节与其右键子菜单。菜单顺序已按 Typora 重排（正文在最前、
标题级别步进紧随六个标题、任务状态与列表缩进成组、目录 / Front Matter 收尾）。

| Typora 项 | 状态 |
|---|---|
| 正文 / 一级～六级标题 | ✅ `format.plain`（新增 Ctrl+0）–`format.h6` |
| 提升标题级别 | ✅ `format.headingUp`（Ctrl+=） |
| 降低标题级别 | ✅ `format.headingDown`（Ctrl+-） |
| 表格 / 代码块 / 公式块 / 引用 / 脚注 / 水平分割线 | ✅ |
| 有序 / 无序 / 任务列表 | ✅ |
| 切换任务状态 | 🔶 复选框点击可切换单条；「整列表切换」命令见下两项 |
| 标记为已完成 / 未完成（整列表） | ✅ `format.taskDone` / `format.taskTodo` |
| 增加缩进 / 减少缩进 | ✅ `format.listIndent`（Ctrl+[）/ `format.listOutdent`（Ctrl+]） |
| 内容目录 `[TOC]` | 🔶 导出/打印已渲染；应用内三个视图暂显原样标记，见下 |
| YAML Front Matter | ✅ `insert.frontmatter` |
| 链接引用 | ✅ `format.linkReference`（标识由所选文字生成；已存在定义时不重复追加） |
| HTML 内容块 | ✅ `insert.htmlBlock`（插入一对标签，光标在中间） |
| 在上方 / 下方插入段落 | ✅ `format.insertParagraphBefore` / `format.insertParagraphAfter` |
| 删除块 | ✅ `format.deleteBlock`（连带一个分隔符，否则每删一次都会多留一个空行） |
| 选择段落或块 | ⬜ |
| 内容目录（Typora 的 YAML `toc` 开关） | ⬜ |

**「提升 / 降低标题级别」的方向。** 名字看着是反的，直到意识到「更高的标题级别」
指的是更醒目那一头：提升是把 `##` 变成 `#`，降低是把 `#` 变成 `##`。这也是 Typora
自己 Ctrl+= / Ctrl+- 的方向（其源码 `currentLevel > 1 ? currentLevel - 1 : 1`）。
反向实现过一次，冒烟里钉死了这个方向。

**结构性的编辑走视图自己的命令。** 标题级别、列表缩进、任务状态都会改变节点结构，
而 shell 的 markdown 文本重写表达不了这类变化（`wysiwyg.ts` 的注释里记着为什么：
`# ` 与 `- ` 在实时预览里是结构而不是文本）。所以适配器提供
`setListIndent` / `setTaskStatus`（走 Milkdown 的 sink/lift 与列表项属性），
shell 只在视图给不出原生命令时才回退到纯文本变换。

**`[TOC]` 只在导出与打印时展开。** 展开发生在渲染管线里（两遍：先收标题与锚点，
再改写标记），所以导出 HTML / 打印给的是可点的目录，且每个标题都带与被链接的
锚点完全相同的 id（同一遍生成，不可能对不上）。应用内的实时预览与分屏用的是
ProseMirror / OverType 各自的渲染，不经过管线，目前会把 `[TOC]` 按字面显示；
文档内容仍然合法。补齐需要在两个视图里各实现一遍目录展开，单列后续。

## 4. 视图、缩放与窗口

对应 Typora 菜单「视图」节。

| Typora 项 | 状态 |
|---|---|
| 实时预览 / 分屏 / 源码 | ✅ 三视图 |
| 只读模式 | ✅ `view.readOnly`（三视图各自翻转 contenteditable 的持有者） |
| 专注模式 / 打字机模式 / 行号 / 字数统计 | ✅ 且菜单改为**复选框**（能显示状态） |
| 显示 / 隐藏侧边栏 | ✅ |
| 大纲 / 文件树 | ✅ |
| 文档列表（Articles 列表视图） | ⬜ |
| 保持窗口在最前端 | ✅ `view.alwaysOnTop`（持久化） |
| 全屏 / 切换全屏 | ✅ `view.fullscreen`（F11；刻意不持久化） |
| 状态栏 | ✅ `showStats` |
| 工具栏 | 🔶 选中文本时的浮动格式条；分屏视图看不到（见下） |
| 实际大小 / 放大 / 缩小 | ✅ `view.zoomReset`（Ctrl+Shift+0）/ `view.zoomIn`（Ctrl+Shift+=）/ `view.zoomOut`（Ctrl+Shift+-） |
| 按住 Ctrl 滚轮缩放 | ✅ 绑在编辑器面板上（不是 window，免得和侧栏滚动打架） |
| 开发者工具 / 重新加载 | ✅ |

**缩放的档位制。** 走固定档位（0.5–3 十三档）而不是每次乘一个系数：连按放大再连按缩小
能精确回到 100%（浮点乘法会漂），且每一档都是能认出来的整数百分比。CSS 用 `zoom` 而不是
`transform: scale` —— 前者会重排，滚动高度才是对的。只缩文档，侧栏/状态栏/菜单保持原大小。
滚轮只写 CSS 变量、不立刻落盘（一次手势几十个事件，每个都写配置文件毫无意义），持久化延后
400ms；手势到头时不再 `preventDefault`，让滚动恢复正常。

**只读模式的关键是「谁拥有 contenteditable」。** ProseMirror 与 CodeMirror 都会在下次渲染时
把直接写在 DOM 上的属性抹掉，所以必须走各自的通道：ProseMirror 的 props、CodeMirror 的
editable facet、OverType 的 textarea（OverType 自己的输入处理里就检查 `readOnly`，
这正是它期望的开关）。另外**切换视图时必须重新施加** —— 每个适配器 mount 出来的都是全新的
可编辑面，忘了这一步就等于「开了只读，切个视图又能打字了」。

**全屏/置顶是一个「设置」API 而不是「切换」API**（`setWindowState`）：Wails 的运行时只提供
`ToggleFullscreen`，得先读回当前状态再决定要不要翻。置顶持久化（窗口下次开在原来的位置），
全屏刻意不持久化 —— 一开就全屏是骚扰。**窗口开关只在真正变化时才下发**，因为
`applyAppearanceConfig` 每次改设置都会跑一遍。

**工具栏**：选中文本时浮出的格式条，13 个命令。按按钮必须先取消 `mousedown`，否则编辑器会在
指针按下时就把选区收起来，命令全都作用在空光标上。位置由调用方给的 rect 决定 ——
分屏（分屏是 OverType 的透明 textarea 叠层）的选区任何浏览器都不通过
`window.getSelection()` 暴露，所以那里它干脆不显示，而不是显示在错的地方。

## 5. 导出选项与页面设置

对应 Typora 偏好「导出」与菜单「页面设置」节。

| Typora 项 | 状态 |
|---|---|
| 导出 HTML / PDF / 打印 | ✅ |
| 导出 docx / odt / rtf / epub | ✅ |
| Pandoc 路径 | ✅ `converterPath` |
| 默认的导出文件夹（同目录 / 自定义） | ✅ `exportFolder`（留空 = 与文档同目录） |
| 导出后（无 / 打开文件 / 打开目录） | ✅ `exportAfter` |
| 页面设置：纸张大小 | ✅ `exportPageSize`（`@page size`） |
| 页面设置：页边距 | ✅ `exportPageMargin`（`@page margin`） |
| 按一级标题分页 | ✅ `exportPageBreakOnH1` |
| HTML：大纲 | ✅ `exportOutline` |
| HTML：自定义 CSS | ✅ `exportCustomCss`（追加在内置样式之后） |
| HTML：`<head>` 追加 | ✅ `exportHeadHtml` |
| HTML：`<body>` 追加 | ✅ `exportBodyHtml` |
| 导出项列表（增删改名排序） | ⏸ **暂不实现**（执行自定义命令需要新增 `app.runCommand` 五壳实现，本机无法验证；一个跑不起来的导出项列表比没有更糟） |
| 页面设置：页首页尾 | ⏸ **暂不实现**（需要 `@page` 的 margin box，Chromium/WebKit 都不支持，当前打印路径做不到） |
| Markdown 变体（原始无扩展 / CommonMark+pandoc 扩展） | ✅ `converterMarkdownFormat`（交给 pandoc 的格式名：gfm / commonmark_x / commonmark / markdown） |
| 导出与打印的空格与换行 | ⬜ |
| 复制为 MathML / Tex / 图片 | 🔶 复制为 Tex ✅ `edit.copyMathTex`；复制为 MathML ✅ `edit.copyMathMl`；复制为图片 ⏸ 暂不实现 |
| 使用上一次设置导出 / 导出并覆盖 | ⬜ |

**纸张与页边距要过白名单。** 这些值最终落在 `<style>` 元素里，一个 `}` 就能提前结束
规则、让后面的内容变成任意 CSS。所以只放行 `[A-Za-z0-9 .%/-]`，不合格就整条规则不发 ——
宁可少一条 `@page`，不要输出半条被人续写的规则。冒烟里钉了这条。

**自定义 CSS 排在内置样式之后**（顺序就是覆盖能力），head/body 追加分别落在
`</head>` / `</body>` 之前。

**「大纲」直接复用文档自己的 `[TOC]` 标记**，而不是另建一份列表：同一套构造、同一套
锚点、同一张样式表，不可能出现「导出的大纲链接和标题 id 对不上」。作者已经写了 `[TOC]`
时不再加，免得出现两份。

**导出后动作失败只记日志不上报** —— 导出本身已经成功了，说「失败」是撒谎。

## 6. 文件操作与拖放

对应 Typora 菜单「文件」节。

| Typora 项 | 状态 |
|---|---|
| 新建 / 打开 / 打开文件夹 | ✅ |
| 保存 / 另存为 | ✅ |
| 保存全部 | ✅ `file.saveAll` |
| 快速打开 | ✅ |
| 打开最近文件 / 清除 | ✅ |
| 重新打开关闭的文件 | ✅ `file.reopenClosed`（Ctrl+Shift+T） |
| 最近使用的目录 | ⬜ |
| 从磁盘重新加载 | 🔶 `app.reload` 重载整窗，非单文档 |
| 选择编码重新打开 | ✅ `file.reopenEncoding`（渲染层 `TextDecoder`；`fatal` 解码，错编码报错而非塞满替换字符） |
| 打开文件位置 | ✅ 见 `file.revealInFolder` |
| 创建副本 / 重命名 / 移动到 / 恢复 | 🔶 创建副本 ✅ `file.duplicate`；重命名/移动到 ✅ `file.rename`；恢复 未做 |
| 新建窗口 | ⬜ |
| 拖入 Markdown 文件 → 打开 | ✅ 有路径则开标签页；web 无路径则按未命名文档打开其文本 |
| 拖入文件夹 → 打开 / 插入链接 | ⬜ |
| 拖入可导入文件 → 插入链接 | ✅ 其他文件插入 `[名字](路径)` |
| 拖入图片 → 按「插入图片时」规则落盘 | ✅ |
| 默认文件类型 / 扩展名 | ⬜ |

**拖放的判定顺序就是那个决定**，所以放在 core 里当纯函数（`classifyDroppedFile`）而不是埋在
事件处理里：文档 → 图片 → 链接。`diagram.png.md` 的 MIME 是 `image/png`，但它必须当成文档打开 ——
把图片判断放在前面就会把它吞掉。

**只记「已保存」的标签页供重新打开**：未命名标签页磁盘上没有东西可读回来，说「重新打开」
是不诚实的。

**只接管文件拖放**（`types.includes('Files')`）：标签栏用自己的拖放载荷做重排，把每一次
拖拽都算进来的话，标签页经过编辑器上方时会被误判。

## 7. 编辑器行为

对应 Typora 偏好「编辑器」与「通用」节。

| Typora 项 | 状态 |
|---|---|
| 打字机模式保持光标居中 | ✅ |
| 拼写检查（键入时 / 立即检查 / 自动更正） | 🔶 有开关，无「立即检查」「自动更正」 |
| 智能引号 | ✅ `smartQuotes`（按语境判断开/闭，中文全角同理） |
| 智能破折号 | ✅ `smartDashes`（`--` → `—`，`...` → `…`） |
| 使用成对的符号（括号/引号） | ✅ `pairedSymbols`（含「敲右括号跳过去」；Markdown 标记字符未做） |
| 输入时转换 / 渲染时转换 | ⬜ |
| 解析时识别 Unicode 标点 | ✅ `remapUnicodePunctuation`（解析前重写输入；源文件不改，渲染结果用 ASCII 形式） |
| 默认缩进（引用/列表） | ✅ `listIndentSize`（1–8，默认 2；缩进与反缩进都按它算） |
| 代码缩进 / 代码块自动换行 | 🔶 代码块自动换行 ✅ `codeBlockWrap`；代码缩进未做 |
| 默认的代码块语言 | ✅ `codeBlockLanguage`（只取第一个词，空格会提前结束 info string） |
| 默认换行符（LF / CRLF） | ✅ `lineEnding`（`preserve`/`lf`/`crlf`） |
| 保存时在文末添加空行 | ✅ `ensureFinalNewline` |
| 当复制纯文本时复制 Markdown 源码 | ✅ `copyTextAsMarkdown` |
| 空格与换行（编辑时 / 导出时保留或忽略） | 🔶 保留单换行符 ✅ `preserveLineBreaks`；只影响渲染与导出，源码不被改写 |
| 首行缩进 | ✅ `firstLineIndent`（预览 + 导出；只作用于段落，列表项与引用有自己的前导标记） |
| 当复制纯文本时复制 Markdown 源码 | ✅ `copyTextAsMarkdown` |
| 复制或剪切光标所在整行 | ✅ `edit.copyLine`（Ctrl+Shift+X）/ `edit.cutLine` |
| 选中当前行 | ✅ `edit.selectLine`（Ctrl+L） |
| 选中当前词 | ✅ `edit.selectWord`（Ctrl+D） |
| 选中当前句 | ✅ `edit.selectSentence` |
| 选中当前块（对应 Typora 的「段落/块」；「当前格式文本」未做） | ✅ `edit.selectBlock`（Ctrl+Shift+A） |
| 跳转到文首 / 文末 | ✅ `edit.jumpStart`（Ctrl+Home）/ `edit.jumpEnd`（Ctrl+End） |
| 跳转到行首 / 行尾 | ✅ `edit.jumpLineStart` / `edit.jumpLineEnd` |
| 跳转到所选内容 | ⬜ |
| Emoji 自动补全（Esc 触发 / 自动触发） | 🔶 自动触发 ✅ `emojiAutocomplete`（`:name:` → emoji）；Esc 触发的候选列表未做，表为常用集而非全量 |

## 8. 查找、导航与统计

| Typora 项 | 状态 |
|---|---|
| 查找 / 替换（含下一个 / 上一个） | ✅ |
| 全词匹配 | ✅ 查找面板的 `W` 开关（Unicode 边界，中文可用） |
| 全局搜索 | ✅ `search.global` |
| 字数统计（状态栏） | ✅ |
| 字数统计窗口（浮窗：字/词/行/字符/选中部分/阅读时长） | ✅ `view.stats`（字数/字符数/行数/阅读时长 + 所选内容一组） |
| 大纲窗口（浮窗） | ✅ `view.outline`（复用侧栏的 `extractOutline`；随光标高亮当前标题） |

## 9. 侧边栏增强

| Typora 项 | 状态 |
|---|---|
| 大纲（点击跳转） | ✅ |
| 大纲：可折叠 / 扁平、全部展开 / 折叠 | ✅ 浮窗可折叠 + 全部展开/折叠 |
| 高亮当前标题 | 🔶 浮窗已按光标偏移高亮；侧栏大纲未做 |
| 目录显示的标题层数 | ✅ `outlineMaxLevel`（0 = 全部；只过滤显示，不改层级编号） |
| 文件树 | ✅ 文件标签可切 **列表 / 树**（`buildFileTree`） |
| 文件库（列表视图） | ✅ 原本就有的扁平列表即此项 —— 之前把两者标反了：缺口是树，不是列表 |
| 文件树 / 文件库 glob 过滤（含 `!` 排除） | ✅ `workspaceGlob`（最后匹配的规则生效；`*` 不跨目录，`**` 跨） |
| 显示隐藏的文件夹 / 文件 | ✅ `showHiddenFiles`（只影响 `.` 开头；`node_modules`/`.git` 等始终隐藏） |
| 在文件树中显示 / 在文档列表中显示 | ✅ 文件树标记当前文档（`file.revealInSidebar` + 切换标签页时自动跟随） |
| 文件树内新建文件 / 文件夹 | ✅ 工作区根目录右键（拒绝含斜杠的名字，不覆盖同名） |

## 10. 系统集成与杂项

| Typora 项 | 状态 |
|---|---|
| 复制为图片 | ⏸ **暂不实现**（需连同计算样式光栅化，本机无法验证） |
| 复制到 MS Word | ✅ `edit.copyToWord`（去样式后以真正的 `text/html` 剪贴板格式写入） |
| 复制内容并简化格式（无样式 HTML） | ✅ `edit.copyAsCleanHtml`（去掉内联样式与 `<style>`，保留类名与结构） |
| 格式化表格源码 | ✅ `format.tableSource`（按显示宽度对齐，中文按两格算） |
| 使用 Google 搜索 / 搜索… | ✅ `search.google`（搜索所选内容） |
| 添加到字典 / 忘记拼写 | ⏸ **暂不实现**（依赖 Chromium 拼写检查会话 API） |
| 语言（界面语言） | ⏸ **暂不实现**（i18n 是独立工程，见「暂不实现」） |
| 向 Windows 资源管理器「新建」菜单添加 Markdown | ⏸ **暂不实现**（安装器写注册表，非运行时功能） |
| 资源管理器「新建」菜单删除项 | ⬜ |
| 向 Windows 资源管理器「打开方式」注册 | ✅ 安装包已做关联 |
| 检查更新 | ⏸ **暂不实现**（需版本端点 + 各壳更新器，本机无法验证） |
| 打开文件位置 | ✅ `file.revealInFolder` |
| 高级设置（打开配置文件） | ✅ `settings.advancedConfig`（打开配置目录） |
| 重置全部警告提示对话框 | ⬜ |

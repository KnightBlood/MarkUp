# Markup 插件开发指南

一个插件 = 一个文件夹（`manifest.json` + 入口 JS），放进任一 plugins 目录，重启或热加载即生效。

## 目录约定

两个位置都扫（全局目录**先**扫——同一 `id` 同时存在于两处时只加载全局那份）：

| 目录 | 位置 | 说明 |
| --- | --- | --- |
| 全局（绝对，三壳一致） | `~/.markup/plugins/` | Windows = `%USERPROFILE%\.markup\plugins\`，macOS/Linux = `~/.markup/plugins`；首次访问自动创建 |
| 程序目录（相对） | `<程序目录>/plugins/` | 紧挨可执行文件（Electron = `Markup.exe` 旁，Wails/Tauri = exe 旁）；内部解析为绝对路径，**不自动创建** |
| Web | 无 | 浏览器读不了本地目录，不加载插件 |

设置 → 「插件」页空态会直接显示本机这两个路径。保存/修改插件文件会触发**热加载**（400ms 去抖自动重载，见 `watchDirs` + `fs.watch`）。

## manifest.json

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "main": "index.js",
  "description": "设置 → 插件列表里显示的一句话说明",
  "permissions": ["document"],
  "engines": { "hostApi": 1 }
}
```

- `id` / `name` / `version` 必填，缺一即整插件报错（可去设置页红字看到）。
- `main` 可选，缺省 `index.js`。
- `permissions` 见下表；**未声明的能力调用即抛** `plugin permission denied: <id>`。
- `engines.hostApi` 必须等于宿主的 `PLUGIN_API_VERSION`（当前 `1`，`packages/ui/src/plugins.ts` 导出），不匹配即拒绝加载；省略 = 兼容任意版本。
- 未知权限 id 不致命，记 warning（控制台 + 设置页灰字）。

### 权限表

| id | 放开的面 |
| --- | --- |
| `document` | `api.doc` 读写当前文档 |
| `fs` | `api.host.fs` |
| `dialog` | `api.host.dialog` |
| `config` | `api.host.app.getConfig / setConfig` |

注册面（命令/右键菜单/侧栏 tab/设置 tab）不需要任何权限。

## 入口：只拿一个 `api`

入口是 `new Function('api', code)` 执行的普通脚本（严格模式，无 `require`/`import`，**受信本地代码、无沙箱**——不要安装来源不明的插件）。

```js
// api.commands —— 进命令面板 / 快捷键 / 原生菜单自检
api.commands.register({ id: 'demo.hello', label: '演示：你好', run: () => {} })

// api.doc —— 活动文档（需 permissions: ["document"]）
const md = api.doc.getMarkdown()
api.doc.insertMarkdown('插入/替换选区的文本')
const sel = api.doc.getSelectedText()
await api.doc.open('/path/other.md') // 打开文件为活动文档（经 host.fs.read，失败返回 false）
api.doc.getPath() // 活动文档绝对路径；未保存为 null
const cur = api.doc.getCursor() // { from, to } 0 基 markdown 偏移；无编辑面为 null
api.doc.setSelection(cur.from, cur.to + 1) // 设选区（to 省略 = 收拢光标）

// 宿主反馈（零权限）
api.notify('完成', { level: 'info' }) // toast：info/warn/error，timeout 0 = 不自动消失
const off = api.statusbar.set('my-plugin', '已选 12 字') // 同 id 覆盖；返回移除函数
api.statusbar.remove('my-plugin')

// 工作区上下文（零权限、只读）
const root = api.workspace.root // 打开的文件夹根路径；未打开为 null

// api.host —— 宿主能力（按 permissions 门禁）
await api.host.fs.read('/path/file.md')

// 注册面：全部返回退订函数，插件 deactivate 时自动反序退订
api.registerContextItem((event, context) =>
  api.doc.getSelectedText() ? [{ label: '做点什么', run() {} }] : [], // 动态右键
)
api.registerSidebarTab({ id: 'x', label: '页签', render: () => panelEl })
api.registerSettingsTab({ id: 'x', label: '页签', render: () => panelEl })

// 可选：返回 teardown（函数或 Promise），deactivate 时执行一次
return () => clearInterval(timer)
```

`api` 是唯一作用域参数——脚本里用 `api.host`，没有全局 `host`。

## 生命周期

1. 启动：读配置 → `loadPlugins` 扫描 plugins 根 + 每个子目录 → 校验 manifest → engines → 构造门禁版 `api` → 执行入口。
2. `AppConfig.disabledPlugins` 里的 id 只读 manifest 展示、代码不执行；设置页开关即时禁用/重载并回写配置。
3. `deactivate()`：跑插件自己的 teardown → 命令全部 unregister → 三条注册面反序退订（幂等，可重复调）。
4. 加载失败/警告同时进 console 与设置 → 插件页的红/灰错误行。

## 样例

- `template-library/` —— 四注册面全用（4 命令、侧栏「模板」页、设置页、右键 2 项），零权限。
- `dev-tools/` —— `api.doc` 读写：插日期/UUID、计算选中表达式、跑 ```js 代码块、动态右键。
- `ai-assistant/` —— 异步命令 + `fetch` + 设置页 + localStorage 配置（OpenAI 兼容接口，需端点允许 CORS）。
- `text-toolbox/` —— 选区变换 vs 全文变换两种写法（有选区 `insertMarkdown` 替换、无选区 `setMarkdown` 且无变化不写）、动态右键按选区显隐。
- `toc/` —— `<!-- toc -->` 目录块 generate/update/remove：围栏代码内标题排除、重复标题锚点 `-1` 后缀、front matter 后插入、二次 insert 幂等。
- `daily-note/` —— `fs` + `dialog` + `doc.open` 组合：读→不存在则写模板→打开；侧栏列表 + 设置页（文件夹/模板，localStorage 配置）。
- `backlinks/` —— 扫工作区建 `[[双链]]` 反向索引 + front matter 标签索引，侧栏 tab 展示（轮询 `doc.getPath()` 自动跟随当前文档，点击反链跳转）；纯解析/扫描函数挂 `globalThis.__bl` 供冒烟直测（无 DOM 环境）。
- `snippets/` —— 片段插入（右键选中触发词 / 侧栏点击），`${1:占位}` → `compile` 展开 + `setSelection` 自动选中，`snippets.next` 逐位跳转（可绑快捷键）；localStorage 配置 + 设置页 JSON 编辑。
- `selection-stats/` —— 轮询选区 → `api.statusbar.set/remove` 动态条目（选区字符/词/行数，折叠即移除）；teardown 清 interval + 兜底 remove。
- `table-tools/` —— `dialog`+`fs`：CSV 导入插入 Markdown 表 / 选区表格导出 CSV（RFC4180 引号转义）、`ClipboardItem` 复制 `text/html`+`text/plain` 富文本（Excel/文档直贴）。
- `link-checker/` —— 抽取 http(s) 链接（md/自动/裸链接、去尾标点、去重），HEAD→GET 降级 + 并发 4 + 8s 超时；摘要 notify + 失败明细以 HTML 注释写回文档尾；右键检查选区。
- `ai-tools/` —— 选区翻译（中/英）与摘要，**复用 ai-assistant 的 `localStorage` 配置**（同一 `markup.ai-assistant` 键，设置 → AI 只配一次）；无选区取文末 2000 字。

十二个样例均已声明 `engines.hostApi: 1`；template-library 零权限，dev-tools / ai-assistant / text-toolbox / toc / snippets / selection-stats / link-checker / ai-tools 声明 `permissions: ["document"]`，daily-note 声明 `["document","fs","dialog"]`，backlinks 声明 `["document","fs"]`，table-tools 声明 `["document","fs","dialog"]`。

## 冒烟

加载器与各样例的端到端断言在 `packages/ui/scripts/pm-n-plugins.mts`：

```bash
corepack pnpm --filter @markup/ui exec tsx scripts/pm-n-plugins.mts
```

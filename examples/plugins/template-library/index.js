// Markup plugin example — receives a single `api` object (PluginAPI):
//   api.commands.register({ id, label, shortcut?, run })   → palette / shortcuts
//   api.registerSidebarTab({ id, label, render })          → sidebar tab (button + panel)
//   api.registerSettingsTab({ id, label, render })         → settings tab
//   api.registerContextItem((event, context) => items[])   → editor context menu
//   api.host                                                → HostAPI (fs/dialog/app/…)
// Everything registered through `api` is torn down automatically by the loader;
// an optional returned function runs extra teardown.
var TEMPLATES = [
  {
    id: 'meeting',
    name: '会议纪要',
    body: '# 会议纪要\n\n- 日期：\n- 参会人：\n\n## 议题\n\n1. \n\n## 结论\n\n- [ ] \n',
  },
  {
    id: 'todo',
    name: '任务清单',
    body: '## 任务\n\n- [ ] 待办一\n- [ ] 待办二\n- [x ] 已完成\n',
  },
  {
    id: 'bug',
    name: '缺陷报告',
    body: '# 缺陷标题\n\n**环境**：\n\n**复现步骤**：\n1. \n2. \n\n**期望结果**：\n\n**实际结果**：\n',
  },
  {
    id: 'api',
    name: 'API 文档',
    body: '## 接口\n\n`GET /path`\n\n**参数**：\n\n| 名称 | 类型 | 说明 |\n| --- | --- | --- |\n|  |  |  |\n',
  },
]

function copy(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
    return
  }
  var ta = document.createElement('textarea')
  ta.value = text
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  ta.remove()
}

TEMPLATES.forEach(function (template) {
  api.commands.register({
    id: 'template.copy.' + template.id,
    label: '复制模板：' + template.name,
    run: function () {
      copy(template.body)
    },
  })
})

api.registerSidebarTab({
  id: 'templates',
  label: '模板',
  render: function () {
    var panel = document.createElement('div')
    panel.className = 'sidebar__panel template-library'
    var hint = document.createElement('div')
    hint.className = 'sidebar__workspace'
    hint.textContent = '点击模板复制到剪贴板'
    panel.appendChild(hint)
    var list = document.createElement('ul')
    list.className = 'file-tree'
    TEMPLATES.forEach(function (template) {
      var li = document.createElement('li')
      var button = document.createElement('button')
      button.type = 'button'
      button.className = 'btn'
      button.textContent = template.name
      button.title = '复制「' + template.name + '」'
      button.addEventListener('click', function () {
        copy(template.body)
      })
      li.appendChild(button)
      list.appendChild(li)
    })
    panel.appendChild(list)
    return panel
  },
})

api.registerSettingsTab({
  id: 'templates',
  label: '模板',
  render: function () {
    var div = document.createElement('div')
    div.className = 'settings__plugin-note'
    div.textContent =
      '模板库：共 ' + TEMPLATES.length + ' 个模板。侧栏「模板」页点击复制，或用命令面板「复制模板：…」。'
    return div
  },
})

api.registerContextItem(function () {
  return TEMPLATES.slice(0, 2).map(function (template) {
    return {
      label: '复制模板：' + template.name,
      run: function () {
        copy(template.body)
      },
    }
  })
})

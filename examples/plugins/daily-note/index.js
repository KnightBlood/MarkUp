// Markup plugin example — daily notes: open/create <folder>/YYYY-MM-DD.md and
// list them in a sidebar tab. Folder + template persist in localStorage.
var FOLDER_KEY = 'markup.daily-note.folder'
var TEMPLATE_KEY = 'markup.daily-note.template'

function cfgGet(key) {
  try {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(key)
  } catch (e) {
    /* node test env */
  }
  return null
}

function cfgSet(key, value) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value)
  } catch (e) {
    /* ignore */
  }
}

function pad(n) {
  return n < 10 ? '0' + n : String(n)
}

function dateOf(offsetDays) {
  var d = new Date()
  if (offsetDays) d.setDate(d.getDate() + offsetDays)
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

function defaultTemplate(date) {
  return (
    '# ' +
    date +
    '\n\n- 今日状态：\n- 今日待办：\n  - [ ] \n\n## 记录\n\n\n## 复盘\n\n- 收获：\n- 改进：\n'
  )
}

function joinPath(folder, name) {
  return folder.replace(/[\\/]+$/, '') + '/' + name
}

async function ensureFolder() {
  var folder = (cfgGet(FOLDER_KEY) || '').trim()
  if (folder) return folder
  var picked = await api.host.dialog.open({ directory: true, title: '选择日记文件夹' })
  var path = picked && picked[0] && picked[0].path
  if (!path) return null
  cfgSet(FOLDER_KEY, path)
  return path
}

async function openDaily(offsetDays) {
  var folder = await ensureFolder()
  if (!folder) return
  var date = dateOf(offsetDays)
  var path = joinPath(folder, date + '.md')
  var content = null
  try {
    content = (await api.host.fs.read(path)).content
  } catch (e) {
    content = null // not created yet
  }
  if (content === null) {
    var template = cfgGet(TEMPLATE_KEY) || defaultTemplate(date)
    content = template.replace(/\{\{date\}\}/g, date) + ''
    try {
      await api.host.fs.write(path, content)
    } catch (error) {
      console.error('[daily-note] create failed:', path, error)
      return
    }
  }
  await api.doc.open(path)
}

api.commands.register({
  id: 'daily.today',
  label: '日记：打开今日',
  run: function () {
    return openDaily(0)
  },
})
api.commands.register({
  id: 'daily.yesterday',
  label: '日记：打开昨日',
  run: function () {
    return openDaily(-1)
  },
})
api.commands.register({
  id: 'daily.setFolder',
  label: '日记：选择日记文件夹…',
  run: function () {
    cfgSet(FOLDER_KEY, '')
    return openDaily(0)
  },
})

// Sidebar tab: list notes in the folder, click to open.
api.registerSidebarTab({
  id: 'daily-notes',
  label: '日记',
  render: function () {
    var panel = document.createElement('div')
    panel.className = 'sidebar__panel daily-notes'
    var hint = document.createElement('div')
    hint.className = 'sidebar__workspace'
    hint.textContent = '点击打开，命令「日记：打开今日」创建'
    panel.appendChild(hint)
    var list = document.createElement('ul')
    list.className = 'file-tree'
    panel.appendChild(list)
    ;(async function () {
      var folder = (cfgGet(FOLDER_KEY) || '').trim()
      if (!folder) return
      try {
        var entries = await api.host.fs.readDir(folder)
        entries
          .filter(function (entry) {
            return entry.kind === 'file' && /^\d{4}-\d{2}-\d{2}\.md$/.test(entry.name)
          })
          .sort(function (a, b) {
            return a.name < b.name ? 1 : -1
          })
          .forEach(function (entry) {
            var li = document.createElement('li')
            var button = document.createElement('button')
            button.type = 'button'
            button.className = 'btn'
            button.textContent = entry.name.replace(/\.md$/, '')
            button.addEventListener('click', function () {
              void api.doc.open(entry.path)
            })
            li.appendChild(button)
            list.appendChild(li)
          })
      } catch (e) {
        hint.textContent = '日记文件夹不可读'
      }
    })()
    return panel
  },
})

// Settings tab: folder picker + template editor.
api.registerSettingsTab({
  id: 'daily',
  label: '日记',
  render: function () {
    var panel = document.createElement('div')
    panel.className = 'settings__panel-body'
    panel.setAttribute('data-tab-panel', 'daily')
    var section = document.createElement('section')
    section.className = 'settings__section'
    var heading = document.createElement('h3')
    heading.className = 'settings__heading'
    heading.textContent = '日记'
    section.appendChild(heading)

    var folderLabel = document.createElement('label')
    folderLabel.className = 'settings__field'
    var folderText = document.createElement('span')
    folderText.className = 'settings__label'
    folderText.textContent = '文件夹：' + (cfgGet(FOLDER_KEY) || '未设置')
    folderLabel.appendChild(folderText)
    var pick = document.createElement('button')
    pick.type = 'button'
    pick.className = 'btn'
    pick.textContent = '选择…'
    pick.addEventListener('click', function () {
      cfgSet(FOLDER_KEY, '')
      void openDaily(0).then(function () {
        folderText.textContent = '文件夹：' + (cfgGet(FOLDER_KEY) || '未设置')
      })
    })
    folderLabel.appendChild(pick)
    section.appendChild(folderLabel)

    var templateLabel = document.createElement('label')
    templateLabel.className = 'settings__field'
    var templateText = document.createElement('span')
    templateText.className = 'settings__label'
    templateText.textContent = '模板（支持 {{date}} 占位）'
    templateLabel.appendChild(templateText)
    var textarea = document.createElement('textarea')
    textarea.className = 'settings__input'
    textarea.rows = 8
    textarea.value = cfgGet(TEMPLATE_KEY) || defaultTemplate('{{date}}')
    textarea.addEventListener('change', function () {
      cfgSet(TEMPLATE_KEY, textarea.value)
    })
    templateLabel.appendChild(textarea)
    section.appendChild(templateLabel)

    panel.appendChild(section)
    return panel
  },
})

// Markup plugin example — snippet library: expand templates with ${n:placeholder}
// slots, jump between slots with a command (bindable to a shortcut). Snippets live
// in localStorage (settings tab edits them as JSON); insertion works from the
// context menu (selected trigger) or the sidebar list.
var STORAGE_KEY = 'markup.snippets'
var DEFAULTS = [
  { name: '代码块', trigger: 'fence', body: '```js\n${1:code}\n```\n${0}' },
  { name: '引用块', trigger: 'quote', body: '> ${1:引用内容}\n${0}' },
  { name: '表格 2×3', trigger: 'tbl', body: '| ${1:列1} | 列2 | 列3 |\n| --- | --- | --- |\n| ${2:值} |  |  |\n${0}' },
  { name: '今日日期', trigger: 'today', body: '${1:' + dateNow() + '}\n${0}' },
]

function dateNow() {
  var d = new Date()
  var pad = function (n) { return n < 10 ? '0' + n : String(n) }
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

function loadSnippets() {
  try {
    if (typeof localStorage !== 'undefined') {
      var raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        var parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) return parsed.filter(function (s) { return s && s.name && s.body })
      }
    }
  } catch (e) {
    /* fall through to defaults */
  }
  return DEFAULTS.slice()
}

function saveSnippets(list) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch (e) {
    /* ignore */
  }
}

function compile(body) {
  // → { text, slots: [{ n, from, to }] } with placeholders removed from text.
  var out = ''
  var slots = []
  var re = /\$\{(\d+)(?::([^}]*))?\}/g
  var last = 0
  var m
  while ((m = re.exec(body)) !== null) {
    out += body.slice(last, m.index)
    var value = m[2] !== undefined ? m[2] : ''
    slots.push({ n: Number(m[1]), from: out.length, to: out.length + value.length })
    out += value
    last = m.index + m[0].length
  }
  out += body.slice(last)
  slots.sort(function (a, b) { return a.from - b.from })
  return { text: out, slots: slots }
}

// Active slots after the last insert: [{ from, to, n }], ordered by document position.
var activeSlots = []

function insertSnippet(snippet) {
  var compiled = compile(String(snippet.body))
  var md = api.doc.getMarkdown()
  var cursor = api.doc.getCursor()
  var start = 0
  if (cursor && cursor.to > cursor.from) start = cursor.from // replace selection
  api.doc.setSelection(start, start + (cursor ? cursor.to - cursor.from : 0))
  api.doc.insertMarkdown(compiled.text)
  activeSlots = compiled.slots
    .map(function (slot) {
      return { n: slot.n, from: start + slot.from, to: start + slot.to }
    })
    .sort(function (a, b) { return a.from - b.from })
  void md
  if (activeSlots.length) selectSlot(0)
}

function selectSlot(index) {
  var slot = activeSlots[index]
  if (!slot) return false
  api.doc.setSelection(slot.from, slot.to)
  activeSlots.splice(index, 1)
  return true
}

function nextPlaceholder() {
  if (activeSlots.length) {
    if (selectSlot(0)) return
  }
  // Fallback: find an unexpanded marker still present in the text (stale slots).
  var md = api.doc.getMarkdown()
  var m = md.match(/\$\{(\d+)(?::[^}]*)?\}/)
  if (!m) {
    api.notify('片段：没有下一个占位符', { level: 'warn' })
    return
  }
  api.doc.setSelection(m.index, m.index + m[0].length)
}

api.commands.register({
  id: 'snippets.insert',
  label: '片段：按触发词插入（选中触发词）',
  run: function () {
    var trigger = api.doc.getSelectedText().trim().toLowerCase()
    var list = loadSnippets()
    var found = list.find(function (s) {
      return String(s.trigger || '').toLowerCase() === trigger
    })
    if (!found) {
      api.notify(
        '片段：未匹配触发词「' + (trigger || '空选区') + '」，可用：' +
          list.map(function (s) { return s.trigger }).join(', '),
        { level: 'warn' },
      )
      return
    }
    insertSnippet(found)
  },
})

api.commands.register({
  id: 'snippets.next',
  label: '片段：下一个占位符',
  run: function () {
    nextPlaceholder()
  },
})

api.registerContextItem(function (event, context) {
  var selected = api.doc.getSelectedText().trim()
  if (!selected) return []
  var trigger = selected.toLowerCase()
  var snippet = loadSnippets().find(function (s) {
    return String(s.trigger || '').toLowerCase() === trigger
  })
  if (!snippet) return []
  return [
    {
      label: '片段：' + snippet.name,
      run: function () {
        insertSnippet(snippet)
      },
    },
  ]
})

api.registerSidebarTab({
  id: 'snippets',
  label: '片段',
  render: function () {
    var panel = document.createElement('div')
    panel.className = 'sidebar__panel snippets'
    var hint = document.createElement('div')
    hint.className = 'sidebar__workspace'
    hint.textContent = '点击插入；触发词可选中后右键'
    panel.appendChild(hint)
    var list = document.createElement('ul')
    list.className = 'file-tree'
    loadSnippets().forEach(function (snippet) {
      var li = document.createElement('li')
      var button = document.createElement('button')
      button.type = 'button'
      button.className = 'btn'
      button.textContent = snippet.name
      button.title = '触发词：' + (snippet.trigger || '—')
      button.addEventListener('click', function () {
        insertSnippet(snippet)
      })
      li.appendChild(button)
      list.appendChild(li)
    })
    panel.appendChild(list)
    return panel
  },
})

api.registerSettingsTab({
  id: 'snippets',
  label: '片段',
  render: function () {
    var panel = document.createElement('div')
    panel.className = 'settings__panel-body'
    panel.setAttribute('data-tab-panel', 'snippets')
    var section = document.createElement('section')
    section.className = 'settings__section'
    var heading = document.createElement('h3')
    heading.className = 'settings__heading'
    heading.textContent = '片段（JSON：name / trigger / body，${n:占位} 为跳转位）'
    section.appendChild(heading)
    var label = document.createElement('label')
    label.className = 'settings__field'
    var textarea = document.createElement('textarea')
    textarea.className = 'settings__input'
    textarea.rows = 12
    textarea.value = JSON.stringify(loadSnippets(), null, 2)
    label.appendChild(textarea)
    section.appendChild(label)
    var save = document.createElement('button')
    save.type = 'button'
    save.className = 'btn'
    save.textContent = '保存'
    save.addEventListener('click', function () {
      try {
        var parsed = JSON.parse(textarea.value)
        if (!Array.isArray(parsed)) throw new Error('须为数组')
        saveSnippets(parsed)
        api.notify('片段：已保存 ' + parsed.length + ' 条')
      } catch (error) {
        api.notify('片段：保存失败 — ' + error.message, { level: 'error' })
      }
    })
    section.appendChild(save)
    panel.appendChild(section)
    return panel
  },
})

globalThis.__sn = { compile: compile, insertSnippet: insertSnippet, nextPlaceholder: nextPlaceholder, loadSnippets: loadSnippets }

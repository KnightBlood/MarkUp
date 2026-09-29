// Markup plugin example — pure text transforms over the active document.
// With a selection: transform replaces the selection (insertMarkdown).
// Without: transform the whole document (setMarkdown), no-op when unchanged.
function edit(fn) {
  var selection = api.doc.getSelectedText()
  if (selection) {
    api.doc.insertMarkdown(fn(selection))
    return
  }
  var markdown = api.doc.getMarkdown()
  var next = fn(markdown)
  if (next !== markdown) api.doc.setMarkdown(next)
}

function lines(text, fn) {
  return fn(text.split('\n')).join('\n')
}

function trimLines(text) {
  return lines(text, function (list) {
    return list.map(function (line) {
      return line.replace(/[ \t]+$/, '')
    })
  })
}

function squeezeBlank(text) {
  return lines(text, function (list) {
    var out = []
    for (var i = 0; i < list.length; i++) {
      if (list[i].trim() === '' && out.length > 0 && out[out.length - 1].trim() === '') continue
      out.push(list[i])
    }
    while (out.length > 0 && out[0].trim() === '') out.shift()
    while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()
    return out
  })
}

function dedupeLines(text) {
  return lines(text, function (list) {
    var seen = {}
    var out = []
    for (var i = 0; i < list.length; i++) {
      var line = list[i]
      if (line.trim() === '') {
        out.push(line) // blank lines stay untouched
        continue
      }
      if (seen[line]) continue
      seen[line] = true
      out.push(line)
    }
    return out
  })
}

function sortLines(text) {
  return lines(text, function (list) {
    return list.slice().sort(function (a, b) {
      return a.localeCompare(b)
    })
  })
}

function renumberList(text) {
  var list = text.split('\n')
  var counters = {}
  for (var i = 0; i < list.length; i++) {
    var line = list[i]
    var match = /^([ \t]*)(\d+)[.)]([ \t]+)/.exec(line)
    if (match) {
      var indent = match[1].replace(/\t/g, '  ').length
      for (var key in counters) if (Number(key) > indent) delete counters[key]
      counters[indent] = (counters[indent] || 0) + 1
      list[i] = match[1] + counters[indent] + '.' + match[3] + line.slice(match[0].length)
    } else if (line.trim() !== '' && !/^[ \t]/.test(line)) {
      counters = {} // a top-level non-list line ends the list
    }
  }
  return list.join('\n')
}

function smartQuotes(text) {
  return text
    .replace(/"([^"\n]+)"/g, '\u201c$1\u201d')
    .replace(/'([^'\n]+)'/g, '\u2018$1\u2019')
}

var TOOLS = [
  { id: 'text.upper', label: '文本：转大写', fn: function (t) { return t.toUpperCase() } },
  { id: 'text.lower', label: '文本：转小写', fn: function (t) { return t.toLowerCase() } },
  {
    id: 'text.titleCase',
    label: '文本：英文单词首字母大写',
    fn: function (t) {
      return t.replace(/\b([a-z])/g, function (c) { return c.toUpperCase() })
    },
  },
  { id: 'text.trimLines', label: '文本：去行尾空白', fn: trimLines },
  { id: 'text.squeezeBlank', label: '文本：连续空行压缩为一行', fn: squeezeBlank },
  { id: 'text.dedupeLines', label: '文本：去重行（保序，保留空行）', fn: dedupeLines },
  { id: 'text.sortLines', label: '文本：行排序 A→Z', fn: sortLines },
  { id: 'text.renumberList', label: '文本：有序列表按层级重编号', fn: renumberList },
  { id: 'text.smartQuotes', label: '文本：直引号转弯引号', fn: smartQuotes },
]

TOOLS.forEach(function (tool) {
  api.commands.register({
    id: tool.id,
    label: tool.label,
    run: function () {
      edit(tool.fn)
    },
  })
})

// Context menu: three frequent transforms while something is selected.
api.registerContextItem(function () {
  if (!api.doc.getSelectedText().trim()) return []
  return ['text.trimLines', 'text.dedupeLines', 'text.renumberList'].map(function (id) {
    var tool = TOOLS.filter(function (t) { return t.id === id })[0]
    return {
      label: tool.label,
      run: function () {
        edit(tool.fn)
      },
    }
  })
})

// Markup plugin example — `api.doc` gives read/write access to the active document.
function pad(n) {
  return n < 10 ? '0' + n : String(n)
}

function formatDate(d, withTime) {
  var s = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  if (withTime) s += ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
  return s
}

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0
    var v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function evalSelection() {
  var sel = api.doc.getSelectedText().trim()
  if (!sel) {
    console.warn('[dev-tools] 没有选中的表达式')
    return
  }
  try {
    var result = new Function('return (' + sel + ')')()
    api.doc.insertMarkdown(result === undefined ? '' : String(result))
  } catch (e) {
    api.doc.insertMarkdown(' // 计算失败: ' + (e && e.message ? e.message : e))
  }
}

function runCodeBlocks() {
  var md = api.doc.getMarkdown()
  var re = /```(?:js|javascript)\n([\s\S]*?)```/g
  var outputs = []
  var m
  while ((m = re.exec(md))) {
    var lines = []
    var write = function () {
      lines.push(Array.prototype.slice.call(arguments).map(String).join(' '))
    }
    var fakeConsole = { log: write, info: write, warn: write, error: write, debug: write }
    try {
      var ret = new Function('console', '"use strict";\n' + m[1])(fakeConsole)
      if (ret !== undefined) lines.push(String(ret))
    } catch (e) {
      lines.push('Error: ' + (e && e.message ? e.message : e))
    }
    outputs.push('#' + (outputs.length + 1) + ':\n' + (lines.join('\n') || '(no output)'))
  }
  if (outputs.length === 0) {
    api.doc.insertMarkdown('> dev-tools: 未找到 ```js 代码块')
    return
  }
  api.doc.insertMarkdown(
    '\n\n**代码输出**（dev-tools）：\n```\n' + outputs.join('\n\n') + '\n```\n',
  )
}

api.commands.register({ id: 'dev.insertDate', label: '插入：日期', run: function () {
  api.doc.insertMarkdown(formatDate(new Date(), false))
} })
api.commands.register({ id: 'dev.insertDatetime', label: '插入：日期时间', run: function () {
  api.doc.insertMarkdown(formatDate(new Date(), true))
} })
api.commands.register({ id: 'dev.insertUuid', label: '插入：UUID', run: function () {
  api.doc.insertMarkdown(uuid())
} })
api.commands.register({ id: 'dev.evalSelection', label: '计算：选中表达式', run: evalSelection })
api.commands.register({ id: 'dev.runCodeBlocks', label: '运行：文档中的 JS 代码块', run: runCodeBlocks })

// Dynamic context menu: only appears when something is selected.
api.registerContextItem(function () {
  var sel = api.doc.getSelectedText().trim()
  if (!sel) return []
  var preview = sel.length > 20 ? sel.slice(0, 20) + '…' : sel
  return [{ label: '计算：' + preview, run: evalSelection }]
})

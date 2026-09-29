// Markup plugin example — table tools: CSV ⇄ Markdown conversion through native
// dialogs, plus "copy as rich text" (text/html + text/plain) for pasting real
// tables into Excel/Docs. Pure converters live on globalThis.__tb for tests.

function parseCsv(text) {
  var rows = []
  var row = []
  var field = ''
  var inQuotes = false
  var source = String(text).replace(/^﻿/, '')
  for (var i = 0; i < source.length; i++) {
    var c = source[i]
    if (inQuotes) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter(function (r) {
    return r.some(function (cell) { return cell.length > 0 })
  })
}

function escapeMdCell(cell) {
  return String(cell).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
}

function csvToMarkdown(rows) {
  if (!rows.length) return ''
  var header = rows[0]
  var body = rows.slice(1)
  var lines = []
  lines.push('| ' + header.map(escapeMdCell).join(' | ') + ' |')
  lines.push('| ' + header.map(function () { return '---' }).join(' | ') + ' |')
  body.forEach(function (row) {
    var cells = header.map(function (_, i) { return row[i] !== undefined ? row[i] : '' })
    lines.push('| ' + cells.map(escapeMdCell).join(' | ') + ' |')
  })
  return lines.join('\n')
}

function csvField(value) {
  var text = String(value)
  if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"'
  return text
}

function toCsv(rows) {
  return rows
    .map(function (row) {
      return row.map(csvField).join(',')
    })
    .join('\r\n')
}

function splitRow(line) {
  var trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  var cells = []
  var field = ''
  for (var i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '\\' && trimmed[i + 1] === '|') {
      field += '|'
      i++
    } else if (trimmed[i] === '|') {
      cells.push(field.trim())
      field = ''
    } else {
      field += trimmed[i]
    }
  }
  cells.push(field.trim())
  return cells
}

function isSeparatorRow(line) {
  var cells = splitRow(line)
  return cells.length > 0 && cells.every(function (cell) { return /^:?-{3,}:?$/.test(cell) })
}

// Parse a markdown table from text; null when the selection is not a table.
function parseMarkdownTable(text) {
  var lines = String(text)
    .split('\n')
    .filter(function (line) { return line.indexOf('|') >= 0 })
  if (lines.length < 2) return null
  var rows = []
  for (var i = 0; i < lines.length; i++) {
    if (isSeparatorRow(lines[i])) continue
    rows.push(splitRow(lines[i]))
  }
  return rows.length >= 2 ? rows : null
}

function mdTableToHtml(rows) {
  var esc = function (cell) {
    return String(cell)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\r?\n/g, '<br>')
  }
  var head = rows[0]
  var html = '<table><thead><tr>'
  head.forEach(function (cell) {
    html += '<th>' + esc(cell) + '</th>'
  })
  html += '</tr></thead><tbody>'
  rows.slice(1).forEach(function (row) {
    html += '<tr>'
    head.forEach(function (_, i) {
      html += '<td>' + esc(row[i] !== undefined ? row[i] : '') + '</td>'
    })
    html += '</tr>'
  })
  return html + '</tbody></table>'
}

async function importCsv() {
  var picked = await api.host.dialog.open({
    title: '选择 CSV 文件',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  })
  var info = picked && picked[0]
  if (!info) return
  var content = (await api.host.fs.read(info.path)).content
  var rows = parseCsv(content)
  if (!rows.length) {
    api.notify('表格工具：CSV 为空', { level: 'warn' })
    return
  }
  api.doc.insertMarkdown(csvToMarkdown(rows))
  api.notify('表格工具：已插入 ' + rows.length + ' 行 × ' + rows[0].length + ' 列')
}

async function exportCsv() {
  var selected = api.doc.getSelectedText()
  var rows = selected ? parseMarkdownTable(selected) : null
  if (!rows) {
    api.notify('表格工具：请先选中一个 Markdown 表格', { level: 'warn' })
    return
  }
  var target = await api.host.dialog.save({
    title: '导出 CSV',
    defaultPath: 'table.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  })
  if (!target) return
  await api.host.fs.write(target, toCsv(rows))
  api.notify('表格工具：已导出 ' + rows.length + ' 行到 CSV')
}

async function copyRich() {
  var selected = api.doc.getSelectedText()
  var rows = selected ? parseMarkdownTable(selected) : null
  if (!rows) {
    api.notify('表格工具：请先选中一个 Markdown 表格', { level: 'warn' })
    return
  }
  if (typeof navigator === 'undefined' || !navigator.clipboard || typeof ClipboardItem === 'undefined') {
    api.notify('表格工具：当前环境不支持富文本剪贴板', { level: 'error' })
    return
  }
  try {
    var html = mdTableToHtml(rows)
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([selected], { type: 'text/plain' }),
      }),
    ])
    api.notify('表格工具：已复制富文本（' + rows.length + ' 行），可粘贴到 Excel/文档')
  } catch (error) {
    api.notify('表格工具：复制失败 — ' + error.message, { level: 'error' })
  }
}

api.commands.register({ id: 'table.csvToMd', label: '表格：CSV 导入为 Markdown', run: importCsv })
api.commands.register({ id: 'table.mdToCsv', label: '表格：选区导出为 CSV…', run: exportCsv })
api.commands.register({ id: 'table.copyRich', label: '表格：复制为富文本', run: copyRich })

globalThis.__tb = {
  parseCsv: parseCsv,
  csvToMarkdown: csvToMarkdown,
  toCsv: toCsv,
  parseMarkdownTable: parseMarkdownTable,
  mdTableToHtml: mdTableToHtml,
}

// Markup plugin example — dead link checker: extracts http(s) links from the
// selection (or whole doc), probes them with HEAD falling back to GET, reports
// through api.notify and appends an HTML comment report (invisible in preview).
var CONCURRENCY = 4
var TIMEOUT_MS = 8000

function extractLinks(text) {
  var found = []
  var push = function (url) {
    url = url.replace(/[.,;:!?)，。；：！？]+$/, '')
    if (url && found.indexOf(url) < 0) found.push(url)
  }
  var md = /\[[^\]]*\]\(\s*(https?:\/\/[^)\s]+)[^)]*\)/g
  var m
  while ((m = md.exec(text)) !== null) push(m[1])
  var auto = /<(https?:\/\/[^>\s]+)>/g
  while ((m = auto.exec(text)) !== null) push(m[1])
  var bare = /https?:\/\/[^\s<>()\[\]"']+/g
  while ((m = bare.exec(text)) !== null) push(m[0])
  return found
}

async function checkOne(url) {
  var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  var timer = ctrl ? setTimeout(function () { ctrl.abort() }, TIMEOUT_MS) : null
  try {
    var res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctrl ? ctrl.signal : undefined })
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl ? ctrl.signal : undefined })
    }
    if (!res.ok) return { url: url, ok: false, status: res.status }
    return { url: url, ok: true, status: res.status }
  } catch (error) {
    return { url: url, ok: false, status: 0, error: String(error && error.message ? error.message : error) }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function check(text, sourceLabel) {
  var links = extractLinks(text)
  if (!links.length) {
    api.notify('链接检查：没有找到链接', { level: 'warn' })
    return
  }
  api.notify('链接检查：正在检查 ' + links.length + ' 个链接…')
  var queue = links.slice()
  var results = []
  var workers = []
  for (var i = 0; i < CONCURRENCY; i++) {
    workers.push(
      (async function () {
        while (queue.length) {
          results.push(await checkOne(queue.shift()))
        }
      })(),
    )
  }
  await Promise.all(workers)
  results.sort(function (a, b) { return links.indexOf(a.url) - links.indexOf(b.url) })
  var bad = results.filter(function (r) { return !r.ok })
  var summary =
    '链接检查：' + results.length + ' 个链接，' + (results.length - bad.length) + ' 正常，' + bad.length + ' 异常'
  api.notify(summary, bad.length ? { level: 'warn' } : undefined)
  if (bad.length) {
    var lines = bad.map(function (r) {
      return '- ' + r.url + ' → ' + (r.error ? r.error : 'HTTP ' + r.status)
    })
    api.doc.insertMarkdown(
      '\n<!-- link-check ' + sourceLabel + ' ' + new Date().toISOString() + '\n' + lines.join('\n') + '\n-->\n',
    )
  }
}

api.commands.register({
  id: 'links.check',
  label: '链接：检查全文死链',
  run: function () {
    return check(api.doc.getMarkdown(), 'full')
  },
})

api.registerContextItem(function () {
  var selected = api.doc.getSelectedText()
  if (!selected || extractLinks(selected).length === 0) return []
  return [
    {
      label: '链接：检查选区死链',
      run: function () {
        return check(selected, 'selection')
      },
    },
  ]
})

globalThis.__lc = { extractLinks: extractLinks, checkOne: checkOne }

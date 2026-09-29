// Markup plugin example — backlinks + tag index: scans the open workspace for
// [[wikilinks]] and front-matter tags, shown in a sidebar tab. Pure helpers are
// exposed on globalThis.__bl so the smoke test can assert them without a DOM.
var MAX_FILES = 400
var MAX_DEPTH = 6

function baseName(path) {
  return path.split(/[\\/]+/).pop().replace(/\.md$/i, '')
}

function normalizeTarget(target) {
  return target.split(/[\\/]+/).pop().trim().replace(/\.md$/i, '').toLowerCase()
}

function wikiLinks(markdown) {
  var out = []
  var re = /\[\[([^\[\]]+)\]\]/g
  var m
  while ((m = re.exec(markdown)) !== null) {
    var target = m[1]
    var pipe = target.indexOf('|')
    if (pipe >= 0) target = target.slice(0, pipe) // alias
    var hash = target.indexOf('#')
    if (hash >= 0) target = target.slice(0, hash) // anchor
    target = target.trim()
    if (target) out.push(target)
  }
  return out
}

function frontMatterTags(markdown) {
  if (markdown.slice(0, 3) !== '---') return []
  var end = markdown.indexOf('\n---', 3)
  if (end < 0) return []
  var fm = markdown.slice(3, end)
  var quoted = function (value) {
    return value.trim().replace(/^['"]|['"]$/g, '')
  }
  var inline = fm.match(/^tags:[ \t]*\[(.*)\][ \t]*$/m)
  if (inline) {
    return inline[1]
      .split(',')
      .map(quoted)
      .filter(Boolean)
  }
  if (/^tags:[ \t]*$/m.test(fm)) {
    var tags = []
    fm.split('\n').forEach(function (line) {
      var item = line.match(/^\s*-\s+(.+)$/)
      if (item) tags.push(quoted(item[1]))
    })
    return tags
  }
  return []
}

async function scan() {
  var root = api.workspace.root
  if (!root) return null
  var files = []
  async function walk(dir, depth) {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES) return
    var entries
    try {
      entries = await api.host.fs.readDir(dir)
    } catch (e) {
      return
    }
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i]
      if (files.length >= MAX_FILES) return
      if (entry.kind === 'dir') await walk(entry.path, depth + 1)
      else if (/\.md$/i.test(entry.name)) files.push(entry)
    }
  }
  await walk(root, 0)

  var backlinks = {} // normalized target -> [{ path, name, count }]
  var tagIndex = {} // tag -> { label, sources: [{ path, name }] }
  var fileTags = {} // absolute path -> [tag]
  for (var f = 0; f < files.length; f++) {
    var file = files[f]
    var content
    try {
      content = (await api.host.fs.read(file.path)).content
    } catch (e) {
      continue
    }
    var name = file.name.replace(/\.md$/i, '')
    var counts = {}
    wikiLinks(content).forEach(function (target) {
      var key = normalizeTarget(target)
      counts[key] = (counts[key] || 0) + 1
    })
    Object.keys(counts).forEach(function (key) {
      ;(backlinks[key] = backlinks[key] || []).push({
        path: file.path,
        name: name,
        count: counts[key],
      })
    })
    var own = frontMatterTags(content)
    if (own.length) fileTags[file.path] = own
    own.forEach(function (tag) {
      var key = tag.toLowerCase()
      tagIndex[key] = tagIndex[key] || { label: tag, sources: [] }
      tagIndex[key].sources.push({ path: file.path, name: name })
    })
  }
  return { files: files, backlinks: backlinks, tagIndex: tagIndex, fileTags: fileTags }
}

function summarize(index, targetName) {
  var key = normalizeTarget(targetName)
  return index.backlinks[key] || []
}

api.commands.register({
  id: 'links.scan',
  label: '反链：重新扫描工作区',
  run: async function () {
    var index = await scan()
    if (!index) {
      api.notify('反链：未打开工作区', { level: 'warn' })
      return
    }
    var links = 0
    Object.keys(index.backlinks).forEach(function (key) {
      links += index.backlinks[key].length
    })
    api.notify(
      '反链：' + index.files.length + ' 个文件、' + links + ' 个引用目标、' +
        Object.keys(index.tagIndex).length + ' 个标签',
    )
  },
})

api.registerSidebarTab({
  id: 'backlinks',
  label: '反链',
  render: function () {
    var panel = document.createElement('div')
    panel.className = 'sidebar__panel backlinks'
    var title = document.createElement('div')
    title.className = 'sidebar__workspace'
    title.textContent = '反链'
    var list = document.createElement('ul')
    list.className = 'file-tree'
    var tags = document.createElement('div')
    tags.className = 'backlinks__tags'
    panel.append(title, list, tags)

    var lastPath = undefined
    var busy = false

    var refresh = async function (path) {
      if (!path) {
        title.textContent = '反链 · 未打开文档'
        list.textContent = ''
        tags.textContent = ''
        return
      }
      title.textContent = '反链 · ' + baseName(path)
      var index
      try {
        index = await scan()
      } catch (e) {
        title.textContent = '反链 · 扫描失败'
        return
      }
      if (!index) {
        title.textContent = '反链 · 未打开工作区'
        return
      }
      var sources = summarize(index, baseName(path))
      list.textContent = ''
      if (!sources.length) {
        var empty = document.createElement('li')
        empty.className = 'backlinks__empty'
        empty.textContent = '没有其他文档引用这里'
        list.appendChild(empty)
      }
      sources.forEach(function (source) {
        var li = document.createElement('li')
        var button = document.createElement('button')
        button.type = 'button'
        button.className = 'btn'
        button.textContent = source.name + (source.count > 1 ? ' ×' + source.count : '')
        button.title = source.path
        button.addEventListener('click', function () {
          void api.doc.open(source.path)
        })
        li.appendChild(button)
        list.appendChild(li)
      })
      var currentTags = index.fileTags[path] || []
      tags.textContent = ''
      if (currentTags.length) {
        var ownHead = document.createElement('div')
        ownHead.className = 'backlinks__tags-head'
        ownHead.textContent = '本篇标签'
        tags.appendChild(ownHead)
        currentTags.forEach(function (tag) {
          var ownChip = document.createElement('span')
          ownChip.className = 'backlinks__tag'
          ownChip.textContent = tag
          tags.appendChild(ownChip)
        })
      }
      var labels = Object.keys(index.tagIndex).sort()
      if (labels.length) {
        var head = document.createElement('div')
        head.className = 'backlinks__tags-head'
        head.textContent = '标签索引'
        tags.appendChild(head)
        labels.forEach(function (key) {
          var chip = document.createElement('span')
          chip.className = 'backlinks__tag'
          chip.textContent = index.tagIndex[key].label + ' (' + index.tagIndex[key].sources.length + ')'
          chip.title = index.tagIndex[key].sources.map(function (s) { return s.name }).join(', ')
          tags.appendChild(chip)
        })
      }
    }

    var timer = window.setInterval(function () {
      if (!panel.isConnected) {
        window.clearInterval(timer)
        return
      }
      if (busy) return
      var path = api.doc.getPath()
      if (path === lastPath) return
      lastPath = path
      busy = true
      void refresh(path).then(function () {
        busy = false
      })
    }, 800)

    void refresh(api.doc.getPath()).then(function () {
      lastPath = api.doc.getPath()
    })

    return panel
  },
})

globalThis.__bl = { wikiLinks: wikiLinks, frontMatterTags: frontMatterTags, scan: scan, summarize: summarize, normalizeTarget: normalizeTarget, baseName: baseName }

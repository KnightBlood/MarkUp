// Markup plugin example — table of contents: generate/update/remove a TOC block
// delimited by <!-- toc --> … <!-- /toc -->, with GitHub-style heading anchors.
var TOC_OPEN = '<!-- toc -->'
var TOC_CLOSE = '<!-- /toc -->'
var BLOCK_RE = /<!-- toc -->[\s\S]*?<!-- \/toc -->/

function slugify(text) {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff\s-]/g, '')
      .replace(/\s+/g, '-')
  )
}

function stripInline(heading) {
  return heading
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim()
}

// Collect { level, text } headings, skipping fenced code and front matter.
function parseHeadings(markdown) {
  var lines = markdown.split('\n')
  var headings = []
  var inFence = false
  var fenceMarker = ''
  var inFrontMatter = lines.length > 1 && lines[0].trim() === '---'
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i]
    if (i === 0 && inFrontMatter) continue
    if (inFrontMatter) {
      if (line.trim() === '---') inFrontMatter = false
      continue
    }
    var fence = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      if (!inFence) {
        inFence = true
        fenceMarker = fence[1][0]
      } else if (fence[1][0] === fenceMarker) {
        inFence = false
      }
      continue
    }
    if (inFence) continue
    var m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (m) {
      headings.push({ level: m[1].length, text: stripInline(m[2]) })
    }
  }
  return headings
}

function buildToc(markdown) {
  var headings = parseHeadings(markdown)
  if (!headings.length) return null
  var minLevel = headings.reduce(function (min, h) {
    return Math.min(min, h.level)
  }, 6)
  var used = {}
  var items = []
  for (var i = 0; i < headings.length; i++) {
    var h = headings[i]
    var base = slugify(h.text)
    var slug = base
    used[slug] = (used[slug] || 0) + 1
    if (used[slug] > 1) slug = base + '-' + (used[slug] - 1)
    var indent = '  '.repeat(h.level - minLevel)
    items.push(indent + '- [' + h.text + '](#' + slug + ')')
  }
  return items.join('\n')
}

function insertToc(markdown) {
  if (BLOCK_RE.test(markdown)) return null // already has a block — use toc.update
  var toc = buildToc(markdown)
  if (!toc) return null
  var block = TOC_OPEN + '\n' + toc + '\n' + TOC_CLOSE
  var lines = markdown.split('\n')
  if (lines[0] && lines[0].trim() === '---') {
    for (var i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        lines.splice(i + 1, 0, '', block, '')
        return lines.join('\n')
      }
    }
  }
  return block + '\n\n' + markdown
}

function updateToc(markdown) {
  if (!BLOCK_RE.test(markdown)) return null
  var toc = buildToc(markdown)
  var block = toc ? TOC_OPEN + '\n' + toc + '\n' + TOC_CLOSE : TOC_OPEN + '\n' + TOC_CLOSE
  return markdown.replace(BLOCK_RE, block)
}

function removeToc(markdown) {
  if (!BLOCK_RE.test(markdown)) return null
  return markdown
    .replace(new RegExp('[ \\t]*' + TOC_OPEN + '[\\s\\S]*?' + TOC_CLOSE + '\\n?'), '')
    .replace(/\n{3,}/g, '\n\n')
}

function apply(transform) {
  var md = api.doc.getMarkdown()
  var next = transform(md)
  if (next === null) {
    console.warn('[toc] nothing to do')
    return
  }
  if (next === md) return
  api.doc.setMarkdown(next)
}

api.commands.register({
  id: 'toc.insert',
  label: '目录：生成 TOC（已有则报无操作）',
  run: function () {
    apply(insertToc)
  },
})
api.commands.register({
  id: 'toc.update',
  label: '目录：更新 TOC',
  run: function () {
    apply(updateToc)
  },
})
api.commands.register({
  id: 'toc.remove',
  label: '目录：移除 TOC',
  run: function () {
    apply(removeToc)
  },
})

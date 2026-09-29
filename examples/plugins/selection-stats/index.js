// Markup plugin example — selection statistics in the statusbar: polls the
// caret/selection via api.doc.getCursor + getSelectedText and publishes a slot
// through api.statusbar (removed again when the selection collapses).
var INTERVAL_MS = 700
var ITEM_ID = 'selection-stats'
var showing = false

function tick() {
  var cursor = api.doc.getCursor()
  var text = cursor && cursor.to > cursor.from ? api.doc.getSelectedText() : ''
  if (!text) {
    if (showing) {
      api.statusbar.remove(ITEM_ID)
      showing = false
    }
    return
  }
  var chars = text.length
  var words = (text.match(/\S+/g) || []).length
  var lines = text.split('\n').length
  var suffix = chars > 2000 ? ' (截断)' : ''
  api.statusbar.set(ITEM_ID, '选区 ' + chars + ' 字 · ' + words + ' 词 · ' + lines + ' 行' + suffix)
  showing = true
}

var timer = setInterval(tick, INTERVAL_MS)
tick()

globalThis.__ss = { tick: tick }

return function () {
  clearInterval(timer)
  if (showing) api.statusbar.remove(ITEM_ID)
}

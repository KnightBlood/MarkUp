// Markup plugin example — translation & summarization. Reads the SAME localStorage
// config as the ai-assistant sample (key `markup.ai-assistant`: apiKey/baseUrl/model),
// so users configure it once under 设置 → AI.
var CFG_KEY = 'markup.ai-assistant'
var MAX_CONTEXT = 2000

function cfg() {
  try {
    if (typeof localStorage !== 'undefined') {
      var raw = localStorage.getItem(CFG_KEY)
      if (raw) return JSON.parse(raw)
    }
  } catch (e) {
    /* ignore */
  }
  return {}
}

function currentText() {
  var selected = api.doc.getSelectedText()
  if (selected) return { text: selected, replace: true }
  var md = api.doc.getMarkdown()
  return { text: md.slice(-MAX_CONTEXT), replace: false }
}

async function callAI(instruction) {
  var config = cfg()
  var key = String(config.apiKey || '').trim()
  if (!key) {
    api.notify('AI：未配置 API Key（设置 → AI）', { level: 'error' })
    api.doc.insertMarkdown('\n<!-- ai-tools: 未配置 API Key（设置 → AI），或选中 ai-assistant 已配好的 Key -->\n')
    return
  }
  var base = String(config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
  var model = String(config.model || 'gpt-4o-mini')
  var source = currentText()
  try {
    var res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: instruction },
          { role: 'user', content: source.text },
        ],
        temperature: 0.3,
      }),
    })
    if (!res.ok) {
      var message = 'HTTP ' + res.status
      api.notify('AI：错误：' + message, { level: 'error' })
      api.doc.insertMarkdown('\n<!-- ai-tools: AI 请求失败 ' + message + ' -->\n')
      return
    }
    var data = await res.json()
    var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
    if (typeof content !== 'string' || !content.trim()) {
      api.notify('AI：响应缺少内容', { level: 'error' })
      api.doc.insertMarkdown('\n<!-- ai-tools: AI 响应缺少 choices[0].message.content -->\n')
      return
    }
    if (source.replace) {
      api.doc.insertMarkdown(content)
    } else {
      api.doc.insertMarkdown('\n\n## AI 摘要\n\n' + content + '\n')
    }
    api.notify('AI：完成（' + content.length + ' 字）')
  } catch (error) {
    api.notify('AI：网络错误 — ' + error.message, { level: 'error' })
    api.doc.insertMarkdown('\n<!-- ai-tools: ' + String(error.message || error) + ' -->\n')
  }
}

api.commands.register({
  id: 'ai.translateZh',
  label: 'AI：译为中文（选区，无选区取文末）',
  run: function () {
    return callAI('把用户内容翻译成简体中文，保持 Markdown 格式与代码块原样，只输出译文。')
  },
})
api.commands.register({
  id: 'ai.translateEn',
  label: 'AI：译为英文（选区，无选区取文末）',
  run: function () {
    return callAI('Translate the user content into English, keep Markdown structure and code blocks intact, output only the translation.')
  },
})
api.commands.register({
  id: 'ai.summarize',
  label: 'AI：摘要（选区，无选区取文末 2000 字）',
  run: function () {
    return callAI('用不超过三句话总结用户内容（简体中文），只输出摘要。')
  },
})

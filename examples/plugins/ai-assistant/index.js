// Markup plugin example — talks to an OpenAI-compatible /chat/completions endpoint.
// Config lives in localStorage (browser global, survives restarts, no host config needed).
// Network: plain fetch from the renderer — works when the endpoint allows CORS
// (api.openai.com does; local gateways may need an explicit origin allowlist).
var CFG_KEY = 'markup.ai-assistant'

function cfgStorage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch (e) {
    /* private mode / node test env */
  }
  return null
}

function loadCfg() {
  var storage = cfgStorage()
  if (!storage) return {}
  try {
    return JSON.parse(storage.getItem(CFG_KEY) || '{}') || {}
  } catch (e) {
    return {}
  }
}

function saveCfg(cfg) {
  var storage = cfgStorage()
  if (storage) storage.setItem(CFG_KEY, JSON.stringify(cfg))
}

function docHint(text) {
  api.doc.insertMarkdown('<!-- AI 助手：' + text + '')
}

async function callAI(kind) {
  var cfg = loadCfg()
  var key = String(cfg.apiKey || '').trim()
  if (!key) {
    docHint('请先在 设置 → AI 页填写 API Key')
    return
  }
  var selection = api.doc.getSelectedText().trim()
  var userText = selection
  if (!userText) {
    if (kind === 'polish') {
      docHint('请先选中要润色的文本')
      return
    }
    userText = api.doc.getMarkdown().slice(-2000)
  }
  if (!userText.trim()) {
    docHint('没有可发送的内容')
    return
  }
  var base = String(cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
  var model = String(cfg.model || 'gpt-4o-mini')
  var system =
    kind === 'polish'
      ? '你是 Markdown 编辑助手。润色用户的文本，保持语言与 Markdown 结构，只输出润色结果，不要解释。'
      : '你是 Markdown 编辑助手。根据用户文本给出简洁回答，直接输出 Markdown，不要寒暄。'
  try {
    var res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userText },
        ],
        temperature: 0.7,
      }),
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    var data = await res.json()
    var text =
      data &&
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content
    if (!text) throw new Error('响应缺少 choices[0].message.content')
    api.doc.insertMarkdown(String(text).trim())
  } catch (error) {
    docHint('错误：' + (error && error.message ? error.message : error) + '')
    console.error('[ai-assistant]', error)
  }
}

function configField(label, key, placeholder, type) {
  var input = document.createElement('input')
  input.className = 'settings__input'
  input.type = type || 'text'
  input.placeholder = placeholder
  input.value = loadCfg()[key] || ''
  input.addEventListener('change', function () {
    var cfg = loadCfg()
    cfg[key] = input.value
    saveCfg(cfg)
  })
  var field = document.createElement('label')
  field.className = 'settings__field'
  var span = document.createElement('span')
  span.className = 'settings__label'
  span.textContent = label
  field.appendChild(span)
  field.appendChild(input)
  return field
}

api.commands.register({
  id: 'ai.polish',
  label: 'AI：润色选中文本',
  run: function () {
    return callAI('polish')
  },
})
api.commands.register({
  id: 'ai.chat',
  label: 'AI：询问选中文本（无选区则问文末）',
  run: function () {
    return callAI('chat')
  },
})

api.registerContextItem(function () {
  var selection = api.doc.getSelectedText().trim()
  if (!selection) return []
  var preview = selection.length > 20 ? selection.slice(0, 20) + '…' : selection
  return [
    {
      label: 'AI：润色「' + preview + '」',
      run: function () {
        return callAI('polish')
      },
    },
    {
      label: 'AI：询问「' + preview + '」',
      run: function () {
        return callAI('chat')
      },
    },
  ]
})

api.registerSettingsTab({
  id: 'ai',
  label: 'AI',
  render: function () {
    var panel = document.createElement('div')
    panel.className = 'settings__panel-body'
    panel.setAttribute('data-tab-panel', 'ai')
    var section = document.createElement('section')
    section.className = 'settings__section'
    var heading = document.createElement('h3')
    heading.className = 'settings__heading'
    heading.textContent = 'AI 助手'
    section.appendChild(heading)
    section.appendChild(configField('API Key', 'apiKey', 'sk-…', 'password'))
    section.appendChild(
      configField('Base URL', 'baseUrl', 'https://api.openai.com/v1', 'text'),
    )
    section.appendChild(configField('模型', 'model', 'gpt-4o-mini', 'text'))
    var hint = document.createElement('p')
    hint.className = 'settings__label'
    hint.textContent =
      'OpenAI 兼容接口，配置存 localStorage；请求需目标端点允许浏览器 CORS。'
    section.appendChild(hint)
    panel.appendChild(section)
    return panel
  },
})

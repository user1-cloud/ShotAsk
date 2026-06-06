type Translations = Record<string, string>

const zhCN: Translations = {
  // app.ts — Header
  'app.subtitle': '屏幕 › 截图 › 分析',

  // app.ts — Shortcut section
  'app.section.shortcut': '全局快捷键',
  'app.shortcut.placeholder': '按下快捷键...',
  'app.shortcut.record': '录制',
  'app.shortcut.recording': '监听中...',
  'app.shortcut.pressKeys': '按下按键...',
  'app.shortcut.hint': '点击录制按钮，然后按下你想要的组合键',
  'app.shortcut.badge': '按下',
  'app.shortcut.toCapture': '截图',

  // app.ts — AI Provider section
  'app.section.provider': 'AI 提供商',
  'app.provider.zhipu': '智谱',
  'app.provider.ollama': 'OLLAMA',
  'app.provider.openai': 'OPENAI',
  'app.provider.custom': '自定义',

  // app.ts — Provider settings labels
  'app.provider.endpoint': '接口地址',
  'app.provider.model': '模型',
  'app.provider.apiKey': 'API 密钥',

  // app.ts — System Prompt section
  'app.section.systemPrompt': '系统提示词',

  // app.ts — Buttons
  'app.save': '保存配置',
  'app.test': '测试连接',

  // app.ts — Status messages
  'app.status.saved': '配置已保存',
  'app.status.saveFailed': '保存失败',
  'app.status.testing': '正在测试连接...',
  'app.status.connectionOk': '连接正常 — AI 响应中',
  'app.status.unexpectedResponse': '异常响应',
  'app.status.connectionFailed': '连接失败',

  // result.ts — Loading / errors
  'result.analyzing': '分析中',
  'result.processing': '正在处理截图',
  'result.placeholder': '输入追问...',
  'result.send': '发送',
  'result.error': '错误',

  // overlay.ts / overlay.html
  'overlay.dragHint': '拖拽选择截图区域',
  'overlay.escHint': '按 ESC 取消',
  'overlay.sending': '正在发送到 AI 模型',

  // main.ts / index.html
  'main.initializing': '系统初始化中',
  'main.version': 'SHOTASK v1.0.0',
}

const en: Translations = {
  'app.subtitle': 'SCREEN › CAPTURE › SYNTHESIZE',

  'app.section.shortcut': 'Global Shortcut',
  'app.shortcut.placeholder': 'Press shortcut...',
  'app.shortcut.record': 'REC',
  'app.shortcut.recording': 'LISTENING...',
  'app.shortcut.pressKeys': 'Press keys...',
  'app.shortcut.hint': 'Click REC then press your desired key combination',
  'app.shortcut.badge': 'PRESS',
  'app.shortcut.toCapture': 'TO CAPTURE',

  'app.section.provider': 'AI Provider',
  'app.provider.zhipu': 'ZHIPU',
  'app.provider.ollama': 'OLLAMA',
  'app.provider.openai': 'OPENAI',
  'app.provider.custom': 'CUSTOM',

  'app.provider.endpoint': 'ENDPOINT',
  'app.provider.model': 'MODEL',
  'app.provider.apiKey': 'API KEY',

  'app.section.systemPrompt': 'System Prompt',

  'app.save': 'SAVE CONFIG',
  'app.test': 'TEST CONNECTION',

  'app.status.saved': 'CONFIGURATION SAVED',
  'app.status.saveFailed': 'SAVE FAILED',
  'app.status.testing': 'TESTING CONNECTION...',
  'app.status.connectionOk': 'CONNECTION OK — AI RESPONDING',
  'app.status.unexpectedResponse': 'UNEXPECTED RESPONSE',
  'app.status.connectionFailed': 'CONNECTION FAILED',

  'result.analyzing': 'ANALYZING',
  'result.processing': 'processing screenshot',
  'result.placeholder': 'Ask a follow-up question...',
  'result.send': 'Send',
  'result.error': 'ERROR',

  'overlay.dragHint': 'DRAG TO SELECT REGION',
  'overlay.escHint': 'ESC TO CANCEL',
  'overlay.sending': 'SENDING TO AI MODEL',

  'main.initializing': 'INITIALIZING SYSTEM',
  'main.version': 'SHOTASK v1.0.0',
}

let currentLang: 'zh-CN' | 'en' = 'zh-CN'
const dicts: Record<string, Translations> = { 'zh-CN': zhCN, en }

export function t(key: string, params?: Record<string, string>): string {
  const dict = dicts[currentLang] || zhCN
  let text = dict[key]
  if (text === undefined) {
    console.warn(`[i18n] missing key: ${key}`)
    return key
  }
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{{${k}}}`, v)
    }
  }
  return text
}

export function detectLanguage(): void {
  try {
    const saved = localStorage.getItem('shotask-lang')
    if (saved === 'en' || saved === 'zh-CN') {
      currentLang = saved as 'zh-CN' | 'en'
      return
    }
  } catch { /* localStorage unavailable */ }
  const nav = navigator.language
  currentLang = nav.startsWith('zh') ? 'zh-CN' : 'en'
}

export function getLanguage(): 'zh-CN' | 'en' {
  return currentLang
}

export function setLanguage(lang: 'zh-CN' | 'en'): void {
  currentLang = lang
  try { localStorage.setItem('shotask-lang', lang) } catch { /* ignore */ }
  applyI18n(document)
}

export function applyI18n(root: HTMLElement | Document = document): void {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n')!
    el.textContent = t(key)
  })
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder')!
    ;(el as HTMLInputElement).placeholder = t(key)
  })
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title')!
    el.setAttribute('title', t(key))
  })
}

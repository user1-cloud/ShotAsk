import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { marked } from 'marked'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { initZoom, getZoom, setZoom } from './zoom'
import { t, applyI18n } from './i18n'

applyI18n()

// --- LaTeX inline math extension for marked ---
// Safe because marked's built-in code-span tokenizer takes priority.
marked.use({
  extensions: [{
    name: 'inlineMath',
    level: 'inline',
    start(src: string) {
      let i = -1
      while (true) {
        i = src.indexOf('$', i + 1)
        if (i === -1) return -1
        if (src[i + 1] === '$') { i++; continue }
        if (i > 0 && src[i - 1] === '\\') continue
        return i
      }
    },
    tokenizer(src: string) {
      const m = /^\$([^$\n]+?)\$(?!\$)/.exec(src)
      if (m) return { type: 'inlineMath', raw: m[0], text: m[1] }
    },
    renderer(token: any) {
      try { return katex.renderToString(token.text, { throwOnError: false }) }
      catch { return `<code>$${token.text}$</code>` }
    },
  }],
})

function renderMarkdown(text: string): string {
  // Step 0: Normalize LaTeX delimiters AI models commonly use
  // \[...\] → $$...$$  (display math)
  // \(...\) → $...$    (inline math)
  let normalized = text
    .replace(/\\\[([\s\S]*?)\\]/g, (_, math: string) => `$$${math}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, math: string) => `$${math}$`)

  // Step 1: Extract $$...$$ display math blocks into markers
  const blocks: string[] = []
  const safe = normalized.replace(/\$\$([\s\S]*?)\$\$/g, (_, math: string) => {
    const i = blocks.length
    blocks.push(math.trim())
    return `\x00KATEX${i}\x00`
  })

  // Step 2: Parse with marked (inline math handled by extension)
  let html = marked.parse(safe) as string

  // Step 3: Replace display-math markers with KaTeX HTML
  html = html.replace(/\x00KATEX(\d+)\x00/g, (_, i: string) => {
    const math = blocks[parseInt(i)]
    if (math === undefined) return ''
    try { return katex.renderToString(math, { displayMode: true, throwOnError: false }) }
    catch { return `<pre><code>$${math}$</code></pre>` }
  })

  return html
}

initZoom()

// Debounced save of result window position/size on every move/resize
{
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      invoke('save_result_geometry', { zoom: getZoom() }).catch(() => {})
    }, 500)
  }
  const win = getCurrentWindow()
  win.onMoved(() => scheduleSave())
  win.onResized(() => scheduleSave())
}

// Click ripple effect
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement
  const btn = target.closest('button')
  if (!btn || (btn as HTMLButtonElement).disabled) return

  const ripple = document.createElement('span')
  ripple.className = 'ripple-effect'
  ripple.style.position = 'fixed'
  const rect = btn.getBoundingClientRect()
  const size = Math.max(rect.width, rect.height) * 2.5
  ripple.style.left = (e.clientX - size / 2) + 'px'
  ripple.style.top = (e.clientY - size / 2) + 'px'
  ripple.style.width = ripple.style.height = size + 'px'

  document.body.appendChild(ripple)
  ripple.addEventListener('animationend', () => ripple.remove())
})

// Restore saved zoom when the window is shown for a new screenshot
listen<{ zoom: number }>('restore-zoom', (event) => {
  setZoom(event.payload.zoom)
}).catch(console.error)

const responseArea = document.getElementById('response-area')!
const chatInput = document.getElementById('chat-input') as HTMLInputElement
const chatSendBtn = document.getElementById('chat-send-btn') as HTMLButtonElement
const chatBar = document.getElementById('chat-bar')!
const zoomHintBar = document.getElementById('zoom-hint-bar')!

let isStreaming = false
let fullResponse = ''
let screenshotB64 = ''
let conversationHistory: { role: string; content: string }[] = []

// Show screenshot image immediately — before AI streaming starts
listen<{ image: string; prompt: string }>('show-screenshot', (event) => {
  screenshotB64 = event.payload.image
  responseArea.innerHTML = ''
  appendImageBubble(event.payload.image)
  appendChatBubble('assistant', '')
}).catch(console.error)

// Reset content when a new screenshot flow starts
listen('reset-content', () => {
  resetContent()
}).catch(console.error)

// Intercept native close (X button / Alt+F4) — hide instead of destroying
getCurrentWindow().onCloseRequested(async (event) => {
  event.preventDefault()
  invoke('cancel_analysis').catch(() => {})
  invoke('save_result_geometry', { zoom: getZoom() }).catch(() => {})
  resetContent()
  await getCurrentWindow().hide()
})

// Streaming chunks
listen<{ text: string }>('ai-stream-chunk', (event) => {
  if (!isStreaming) {
    isStreaming = true
    fullResponse = ''
  }
  fullResponse += event.payload.text

  // Always use chat bubble — find or create last assistant bubble
  const bubbles = responseArea.querySelectorAll('.chat-bubble.assistant')
  let bubble = bubbles[bubbles.length - 1] as HTMLElement | undefined
  if (!bubble) {
    responseArea.innerHTML = ''
    bubble = document.createElement('div')
    bubble.className = 'chat-bubble assistant'
    responseArea.appendChild(bubble)
  }
  bubble.innerHTML = (renderMarkdown(fullResponse) as string) + '<span class="cursor-blink"></span>'
  scrollIfAtBottom()
}).catch(console.error)

// Final response (first screenshot analysis only — follow-ups handled in sendFollowUp)
listen<{ text: string; image?: string; prompt?: string }>('ai-response', (event) => {
  if (!isStreaming && event.payload.text) {
    fullResponse = event.payload.text
  }

  if (event.payload.prompt) {
    conversationHistory.push({ role: 'user', content: event.payload.prompt })
  }

  const existingAssistant = responseArea.querySelector('.chat-bubble.assistant') as HTMLElement | null

  if (existingAssistant) {
    // Streaming case: bubble already created during streaming, finalize it
    existingAssistant.innerHTML = renderMarkdown(fullResponse) as string
  } else {
    // Non-streaming case: create bubbles from scratch
    responseArea.innerHTML = ''
    if (event.payload.image) {
      appendImageBubble(event.payload.image)
    }
    appendChatBubble('assistant', fullResponse)
  }

  conversationHistory.push({ role: 'assistant', content: fullResponse })

  const cursor = responseArea.querySelector('.cursor-blink')
  if (cursor) (cursor as HTMLElement).style.display = 'none'
  isStreaming = false
  chatInput.disabled = false
  chatSendBtn.disabled = false
  chatBar.style.display = 'flex'
  zoomHintBar.style.display = 'block'
  chatInput.focus()
}).catch(console.error)

// Send follow-up message
async function sendFollowUp() {
  const message = chatInput.value.trim()
  if (!message || isStreaming || !screenshotB64) return

  chatInput.value = ''
  chatInput.disabled = true
  chatSendBtn.disabled = true

  // Add user bubble
  appendChatBubble('user', message)
  // Add empty assistant bubble
  appendChatBubble('assistant', '')

  conversationHistory.push({ role: 'assistant', content: '' })

  // Build history for API (exclude last empty assistant entry)
  const apiHistory = conversationHistory.slice(0, -1)

  try {
    // Reset stream state
    isStreaming = false
    fullResponse = ''
    invoke('cancel_analysis').catch(() => {})

    const result = await invoke<string>('chat_followup', {
      imageB64: screenshotB64,
      history: apiHistory,
      newMessage: message,
    })

    // Update last assistant bubble with final markdown
    const bubbles = responseArea.querySelectorAll('.chat-bubble.assistant')
    const lastBubble = bubbles[bubbles.length - 1]
    if (lastBubble) {
      lastBubble.innerHTML = renderMarkdown(result) as string
    }
    conversationHistory[conversationHistory.length - 1] = { role: 'assistant', content: result }
  } catch (e) {
    const bubbles = responseArea.querySelectorAll('.chat-bubble.assistant')
    const lastBubble = bubbles[bubbles.length - 1]
    if (lastBubble) {
      lastBubble.innerHTML = `<span style="color:var(--phosphor-magenta)">${t('result.error')}: ${escapeText(String(e))}</span>`
    }
  } finally {
    isStreaming = false
    chatInput.disabled = false
    chatSendBtn.disabled = false
    chatInput.focus()
  }
}

chatSendBtn.addEventListener('click', sendFollowUp)
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendFollowUp()
  }
})

function appendChatBubble(role: string, content: string) {
  const bubble = document.createElement('div')
  bubble.className = `chat-bubble ${role}`
  if (role === 'user') {
    bubble.textContent = content
  } else {
    bubble.innerHTML = content
      ? renderMarkdown(content) as string
      : '<span class="cursor-blink"></span>'
  }
  responseArea.appendChild(bubble)
  scrollIfAtBottom()
}

function createImageBubble(imageB64: string): HTMLElement {
  const bubble = document.createElement('div')
  bubble.className = 'chat-bubble user has-image'
  const img = document.createElement('img')
  img.src = `data:image/png;base64,${imageB64}`
  img.alt = 'Screenshot'
  bubble.appendChild(img)

  let expanded = false
  bubble.addEventListener('click', () => {
    expanded = !expanded
    if (expanded) {
      bubble.classList.add('expanded')
    } else {
      bubble.classList.remove('expanded')
    }
  })

  return bubble
}

function appendImageBubble(imageB64: string) {
  responseArea.appendChild(createImageBubble(imageB64))
  scrollIfAtBottom()
}

function scrollIfAtBottom() {
  const threshold = 60
  const atBottom = responseArea.scrollHeight - responseArea.scrollTop - responseArea.clientHeight < threshold
  if (atBottom) {
    responseArea.scrollTop = responseArea.scrollHeight
  }
}

function escapeText(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
}

function resetContent() {
  isStreaming = false
  fullResponse = ''
  screenshotB64 = ''
  conversationHistory = []
  chatBar.style.display = 'none'
  zoomHintBar.style.display = 'none'
  chatInput.value = ''
  chatInput.disabled = true
  chatSendBtn.disabled = true
  responseArea.innerHTML = `
    <div class="loading-wrapper">
      <div class="loader-dual-ring"></div>
      <div class="loading-label">${t('result.analyzing')}</div>
      <div class="loading-sub">${t('result.processing')}</div>
    </div>
  `
}

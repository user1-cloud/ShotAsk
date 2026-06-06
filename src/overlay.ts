import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { applyI18n } from './i18n'

applyI18n()

let startX = 0, startY = 0, isSelecting = false
let screenshotReady = false

const selection = document.getElementById('selection')!
const hint = document.getElementById('hint')!
const loading = document.getElementById('loading')!
const bgImage = document.getElementById('bg-image')!
const sizeIndicator = document.getElementById('size-indicator')!

// Show loading spinner immediately
loading.style.display = 'block'
hint.style.opacity = '0'

listen<{ image: string }>('screenshot-data', (event) => {
  bgImage.style.backgroundImage = `url(data:image/png;base64,${event.payload.image})`
  loading.style.display = 'none'
  hint.style.opacity = '1'
  screenshotReady = true
}).catch(console.error)

document.addEventListener('mousedown', (e) => {
  if (!screenshotReady) return
  if (e.button !== 0) return
  isSelecting = true
  startX = e.clientX
  startY = e.clientY
  selection.style.display = 'block'
  selection.style.left = startX + 'px'
  selection.style.top = startY + 'px'
  selection.style.width = '0px'
  selection.style.height = '0px'
  hint.style.opacity = '0'
  sizeIndicator.style.display = 'block'
})

document.addEventListener('mousemove', (e) => {
  if (!isSelecting) return
  const x = Math.min(startX, e.clientX)
  const y = Math.min(startY, e.clientY)
  const w = Math.abs(e.clientX - startX)
  const h = Math.abs(e.clientY - startY)

  selection.style.left = x + 'px'
  selection.style.top = y + 'px'
  selection.style.width = w + 'px'
  selection.style.height = h + 'px'

  // Show size indicator near cursor
  sizeIndicator.textContent = `${Math.round(w)} × ${Math.round(h)}`
  sizeIndicator.style.left = (e.clientX + 16) + 'px'
  sizeIndicator.style.top = (e.clientY + 16) + 'px'
})

document.addEventListener('mouseup', async (e) => {
  if (!isSelecting) return
  isSelecting = false

  const x = Math.min(startX, e.clientX)
  const y = Math.min(startY, e.clientY)
  const w = Math.abs(e.clientX - startX)
  const h = Math.abs(e.clientY - startY)

  sizeIndicator.style.display = 'none'

  if (w < 10 || h < 10) {
    selection.style.display = 'none'
    hint.style.opacity = '1'
    return
  }

  selection.style.display = 'none'

  // Hide overlay immediately, then fire backend processing
  const win = getCurrentWindow()
  await win.setFullscreen(false)
  await win.hide()

  const dpr = window.devicePixelRatio || 1
  invoke('crop_and_ask', {
    x: Math.round(x * dpr), y: Math.round(y * dpr),
    width: Math.round(w * dpr), height: Math.round(h * dpr),
    customPrompt: null,
  }).catch(async (e) => {
    console.error('crop_and_ask failed:', e)
    const { emit } = await import('@tauri-apps/api/event')
    await emit('ai-response', { text: 'ERROR: ' + String(e) })
  })
})

document.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') {
    const win = getCurrentWindow()
    await win.setFullscreen(false)
    await win.hide()
  }
})

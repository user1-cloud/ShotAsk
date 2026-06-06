import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { invoke } from '@tauri-apps/api/core'

const MIN_ZOOM = 0.3
const MAX_ZOOM = 3.0
const ZOOM_STEP = 0.1

let currentZoom = 1.0

export function getZoom(): number {
  return currentZoom
}

export function setZoom(level: number) {
  currentZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, level))
  getCurrentWebviewWindow().setZoom(currentZoom)
}

// Exposed globally so Rust can call via eval() to restore/sync zoom reliably
;(window as any).__shotaskSetZoom = setZoom
;(window as any).__shotaskGetZoom = getZoom

let saveTimer: ReturnType<typeof setTimeout> | null = null

function scheduleZoomSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    invoke('save_zoom', { zoom: currentZoom }).catch(() => {})
  }, 400)
}

export function initZoom() {
  document.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return
    e.preventDefault()
    const delta = -Math.sign(e.deltaY) * ZOOM_STEP
    currentZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, currentZoom + delta))
    getCurrentWebviewWindow().setZoom(currentZoom)
    scheduleZoomSave()
  }, { passive: false })
}

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'
import './style.css'

// Module scripts load async — DOM may already be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => bootstrap())
} else {
  bootstrap()
}

async function bootstrap() {
  try {
    const { detectLanguage } = await import('./i18n')
    detectLanguage()

    const { mountApp } = await import('./app')
    mountApp(document.getElementById('app')!)
  } catch (e) {
    console.error('Failed to bootstrap ShotAsk:', e)
    const app = document.getElementById('app')!
    app.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#020212;color:#22d3ee;font-family:monospace;text-align:center">
        <div>
          <h1 style="font-family:'Orbitron',sans-serif;letter-spacing:4px;margin-bottom:16px">SHOTASK</h1>
          <p style="color:#94a3b8;font-size:14px">Loading failed. Is this running inside Tauri?</p>
          <p style="color:#64748b;font-size:12px;margin-top:8px">${String(e)}</p>
        </div>
      </div>
    `
  }
}

import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { listen, emit } from '@tauri-apps/api/event'
import { initZoom } from './zoom'
import { t, getLanguage, setLanguage, applyI18n } from './i18n'

interface AppConfig {
  shortcut: string
  api_type: 'Ollama' | 'OpenAI' | 'ZhiPu' | 'Custom'
  ollama_endpoint: string
  ollama_model: string
  openai_endpoint: string
  openai_key: string
  openai_model: string
  zhipu_key: string
  zhipu_model: string
  custom_endpoint: string
  custom_key: string
  custom_model: string
  system_prompt: string
}

type StatusType = '' | 'success' | 'error' | 'loading'

let config: AppConfig | null = null

export function mountApp(root: HTMLElement) {
  root.innerHTML = `
    <div class="vignette-overlay" style="position:relative;width:100vw;height:100vh;background:var(--void-deep);overflow:hidden;display:flex;flex-direction:column">

      <!-- Hex background -->
      <div class="hex-bg"></div>

      <!-- Data stream columns -->
      <div id="data-streams" class="data-stream-bg"></div>

      <!-- ====== HEADER ====== -->
      <header style="
        position:relative;z-index:10;
        display:flex;align-items:center;justify-content:space-between;
        padding:16px 24px;
        border-bottom:1px solid var(--void-border);
        background:linear-gradient(180deg, var(--void-elevated) 0%, transparent 100%);
        backdrop-filter:blur(12px);
      ">
        <div style="display:flex;align-items:center;gap:14px">
          <!-- Logo mark -->
          <div style="position:relative;width:44px;height:44px">
            <svg viewBox="0 0 44 44" style="position:absolute;inset:0">
              <polygon points="22,4 38,13 38,31 22,40 6,31 6,13"
                fill="none"
                stroke="var(--phosphor-cyan)"
                stroke-width="1.5"
                style="filter:drop-shadow(0 0 6px var(--phosphor-cyan))"
              />
              <polygon points="22,10 33,16 33,28 22,34 11,28 11,16"
                fill="rgba(0,240,255,0.06)"
                stroke="var(--phosphor-cyan-dim)"
                stroke-width="0.5"
              />
              <circle cx="22" cy="22" r="3" fill="var(--phosphor-cyan)" style="filter:drop-shadow(0 0 8px var(--phosphor-cyan))"/>
            </svg>
          </div>

          <div>
            <h1 class="glitch-text" data-text="SHOTASK" style="
              font-family:var(--font-display);
              font-size:20px;
              font-weight:800;
              letter-spacing:6px;
              color:var(--phosphor-cyan);
              animation:phosphor-pulse 3s ease-in-out infinite;
              margin:0;line-height:1;
            ">SHOTASK</h1>
            <p style="
              font-family:var(--font-mono);
              font-size:9px;
              color:var(--text-muted);
              letter-spacing:4px;
              margin:2px 0 0;
            ">${t('app.subtitle')}</p>
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:16px">
          <!-- Language toggle -->
          <button id="lang-toggle-btn" class="btn-press hover-sweep" style="
            padding:4px 10px;
            background:var(--void);
            border:1px solid var(--void-border);
            color:var(--text-secondary);
            font-family:var(--font-mono);
            font-size:9px;
            letter-spacing:2px;
            cursor:pointer;
            transition:all 0.3s;
          "
          onmouseover="this.style.borderColor='var(--phosphor-cyan)';this.style.color='var(--phosphor-cyan)'"
          onmouseout="this.style.borderColor='var(--void-border)';this.style.color='var(--text-secondary)'"
          >EN</button>
        </div>
      </header>

      <!-- ====== MAIN CONTENT ====== -->
      <main style="
        position:relative;z-index:10;
        flex:1;overflow-y:auto;
        padding:20px 24px;
        display:flex;flex-direction:column;gap:16px;
      ">

        <!-- SECTION: Shortcut -->
        <section style="
          position:relative;
          border:1px solid var(--void-border);
          background:var(--void-surface);
          padding:18px 20px;
          animation:slide-up-fade 0.5s ease-out both;
        ">
          <span style="position:absolute;top:-1px;left:-1px;width:10px;height:10px;border-top:2px solid var(--phosphor-cyan);border-left:2px solid var(--phosphor-cyan)"></span>
          <span style="position:absolute;bottom:-1px;right:-1px;width:10px;height:10px;border-bottom:2px solid var(--phosphor-cyan);border-right:2px solid var(--phosphor-cyan)"></span>

          <h2 style="
            font-family:var(--font-display);
            font-size:10px;
            letter-spacing:4px;
            color:var(--phosphor-cyan);
            margin-bottom:14px;
            text-transform:uppercase;
          ">${t('app.section.shortcut')}</h2>

          <div style="display:flex;gap:10px;align-items:center">
            <input id="shortcut-field" class="input-glow"
              style="
                flex:1;
                padding:12px 14px;
                background:var(--void);
                border:1px solid var(--void-border);
                color:var(--text-phosphor);
                font-family:var(--font-mono);
                font-size:13px;
                letter-spacing:2px;
                outline:none;
                transition:all 0.3s;
              "
              onfocus="this.style.borderColor='var(--phosphor-cyan)';this.style.boxShadow='0 0 12px rgba(0,240,255,0.15)'"
              onblur="this.style.borderColor='var(--void-border)';this.style.boxShadow='none'"
              value="Alt+S"
              placeholder="${t('app.shortcut.placeholder')}"
              readonly
            />
            <button id="record-shortcut-btn" class="btn-press hover-sweep" style="
              padding:12px 20px;
              background:var(--void);
              border:1px solid var(--phosphor-cyan);
              color:var(--phosphor-cyan);
              font-family:var(--font-display);
              font-size:11px;
              letter-spacing:3px;
              cursor:pointer;
              transition:all 0.3s;
              white-space:nowrap;
            "
            onmouseover="this.style.background='rgba(0,240,255,0.1)';this.style.boxShadow='0 0 16px rgba(0,240,255,0.3)'"
            onmouseout="this.style.background='var(--void)';this.style.boxShadow='none'"
            >${t('app.shortcut.record')}</button>
          </div>
          <p style="font-size:9px;color:var(--text-muted);margin-top:8px;letter-spacing:1px">
            ${t('app.shortcut.hint')}
          </p>
        </section>

        <!-- SECTION: AI Provider -->
        <section style="
          position:relative;
          border:1px solid var(--void-border);
          background:var(--void-surface);
          padding:18px 20px;
          animation:slide-up-fade 0.5s ease-out 0.08s both;
        ">
          <span style="position:absolute;top:-1px;left:-1px;width:10px;height:10px;border-top:2px solid var(--phosphor-amber);border-left:2px solid var(--phosphor-amber)"></span>
          <span style="position:absolute;bottom:-1px;right:-1px;width:10px;height:10px;border-bottom:2px solid var(--phosphor-amber);border-right:2px solid var(--phosphor-amber)"></span>

          <h2 style="
            font-family:var(--font-display);
            font-size:10px;
            letter-spacing:4px;
            color:var(--phosphor-amber);
            margin-bottom:14px;
            text-transform:uppercase;
          ">${t('app.section.provider')}</h2>

          <div style="display:flex;gap:2px;margin-bottom:14px">
            <button id="api-zhipu-btn" class="btn-press hover-sweep" style="
              flex:1;padding:10px;
              background:rgba(0,240,255,0.08);
              border:1px solid var(--phosphor-cyan);
              color:var(--phosphor-cyan);
              font-family:var(--font-display);
              font-size:10px;letter-spacing:2px;cursor:pointer;
              transition:all 0.3s;
            ">${t('app.provider.zhipu')}</button>
            <button id="api-ollama-btn" class="btn-press hover-sweep" style="
              flex:1;padding:10px;
              background:transparent;
              border:1px solid var(--void-border);
              color:var(--text-secondary);
              font-family:var(--font-display);
              font-size:10px;letter-spacing:2px;cursor:pointer;
              transition:all 0.3s;
            ">${t('app.provider.ollama')}</button>
            <button id="api-openai-btn" class="btn-press hover-sweep" style="
              flex:1;padding:10px;
              background:transparent;
              border:1px solid var(--void-border);
              color:var(--text-secondary);
              font-family:var(--font-display);
              font-size:10px;letter-spacing:2px;cursor:pointer;
              transition:all 0.3s;
            ">${t('app.provider.openai')}</button>
            <button id="api-custom-btn" class="btn-press hover-sweep" style="
              flex:1;padding:10px;
              background:transparent;
              border:1px solid var(--void-border);
              color:var(--text-secondary);
              font-family:var(--font-display);
              font-size:10px;letter-spacing:2px;cursor:pointer;
              transition:all 0.3s;
            ">${t('app.provider.custom')}</button>
          </div>

          <div id="ollama-settings" style="display:flex;flex-direction:column;gap:10px">
            <div>
              <label style="display:block;font-size:9px;color:var(--text-muted);letter-spacing:2px;margin-bottom:4px">${t('app.provider.endpoint')}</label>
              <input id="ollama-endpoint" value="http://localhost:11434" placeholder="http://localhost:11434"
                style="width:100%;padding:10px 12px;background:var(--void);border:1px solid var(--void-border);color:var(--text-primary);font-family:var(--font-mono);font-size:11px;outline:none;transition:all 0.3s"
                onfocus="this.style.borderColor='var(--phosphor-cyan)'"
                onblur="this.style.borderColor='var(--void-border)'"
              />
            </div>
            <div>
              <label style="display:block;font-size:9px;color:var(--text-muted);letter-spacing:2px;margin-bottom:4px">${t('app.provider.model')}</label>
              <input id="ollama-model" value="llava:latest" placeholder="llava:latest"
                style="width:100%;padding:10px 12px;background:var(--void);border:1px solid var(--void-border);color:var(--text-primary);font-family:var(--font-mono);font-size:11px;outline:none;transition:all 0.3s"
                onfocus="this.style.borderColor='var(--phosphor-cyan)'"
                onblur="this.style.borderColor='var(--void-border)'"
              />
            </div>
          </div>

          <div id="openai-settings" style="display:none;flex-direction:column;gap:10px">
            <div>
              <label style="display:block;font-size:9px;color:var(--text-muted);letter-spacing:2px;margin-bottom:4px">${t('app.provider.endpoint')}</label>
              <input id="openai-endpoint" value="https://api.openai.com/v1"
                style="width:100%;padding:10px 12px;background:var(--void);border:1px solid var(--void-border);color:var(--text-primary);font-family:var(--font-mono);font-size:11px;outline:none;transition:all 0.3s"
                onfocus="this.style.borderColor='var(--phosphor-cyan)'"
                onblur="this.style.borderColor='var(--void-border)'"
              />
            </div>
            <div>
              <label style="display:block;font-size:9px;color:var(--text-muted);letter-spacing:2px;margin-bottom:4px">${t('app.provider.apiKey')}</label>
              <input id="openai-key" type="password" placeholder="sk-..."
                style="width:100%;padding:10px 12px;background:var(--void);border:1px solid var(--void-border);color:var(--text-primary);font-family:var(--font-mono);font-size:11px;outline:none;transition:all 0.3s"
                onfocus="this.style.borderColor='var(--phosphor-cyan)'"
                onblur="this.style.borderColor='var(--void-border)'"
              />
            </div>
            <div>
              <label style="display:block;font-size:9px;color:var(--text-muted);letter-spacing:2px;margin-bottom:4px">${t('app.provider.model')}</label>
              <input id="openai-model" value="gpt-4o" placeholder="gpt-4o"
                style="width:100%;padding:10px 12px;background:var(--void);border:1px solid var(--void-border);color:var(--text-primary);font-family:var(--font-mono);font-size:11px;outline:none;transition:all 0.3s"
                onfocus="this.style.borderColor='var(--phosphor-cyan)'"
                onblur="this.style.borderColor='var(--void-border)'"
              />
            </div>
          </div>

          <div id="zhipu-settings" style="display:none;flex-direction:column;gap:10px">
            <div>
              <label style="display:block;font-size:9px;color:var(--text-muted);letter-spacing:2px;margin-bottom:4px">${t('app.provider.endpoint')}</label>
              <input id="zhipu-endpoint" value="https://open.bigmodel.cn/api/paas/v4" disabled
                style="width:100%;padding:10px 12px;background:var(--void);border:1px solid var(--void-border);color:var(--text-muted);font-family:var(--font-mono);font-size:11px;outline:none;opacity:0.7"
              />
            </div>
            <div>
              <label style="display:block;font-size:9px;color:var(--text-muted);letter-spacing:2px;margin-bottom:4px">${t('app.provider.apiKey')}</label>
              <input id="zhipu-key" type="password" placeholder="智谱 API Key..."
                style="width:100%;padding:10px 12px;background:var(--void);border:1px solid var(--void-border);color:var(--text-primary);font-family:var(--font-mono);font-size:11px;outline:none;transition:all 0.3s"
                onfocus="this.style.borderColor='var(--phosphor-cyan)'"
                onblur="this.style.borderColor='var(--void-border)'"
              />
            </div>
            <div>
              <label style="display:block;font-size:9px;color:var(--text-muted);letter-spacing:2px;margin-bottom:4px">${t('app.provider.model')}</label>
              <input id="zhipu-model" value="glm-4v-flash" placeholder="glm-4v-flash"
                style="width:100%;padding:10px 12px;background:var(--void);border:1px solid var(--void-border);color:var(--text-primary);font-family:var(--font-mono);font-size:11px;outline:none;transition:all 0.3s"
                onfocus="this.style.borderColor='var(--phosphor-cyan)'"
                onblur="this.style.borderColor='var(--void-border)'"
              />
            </div>
          </div>

          <div id="custom-settings" style="display:none;flex-direction:column;gap:10px">
            <div>
              <label style="display:block;font-size:9px;color:var(--text-muted);letter-spacing:2px;margin-bottom:4px">${t('app.provider.endpoint')}</label>
              <input id="custom-endpoint" placeholder="https://api.deepseek.com/v1"
                style="width:100%;padding:10px 12px;background:var(--void);border:1px solid var(--void-border);color:var(--text-primary);font-family:var(--font-mono);font-size:11px;outline:none;transition:all 0.3s"
                onfocus="this.style.borderColor='var(--phosphor-cyan)'"
                onblur="this.style.borderColor='var(--void-border)'"
              />
            </div>
            <div>
              <label style="display:block;font-size:9px;color:var(--text-muted);letter-spacing:2px;margin-bottom:4px">${t('app.provider.apiKey')}</label>
              <input id="custom-key" type="password" placeholder="sk-..."
                style="width:100%;padding:10px 12px;background:var(--void);border:1px solid var(--void-border);color:var(--text-primary);font-family:var(--font-mono);font-size:11px;outline:none;transition:all 0.3s"
                onfocus="this.style.borderColor='var(--phosphor-cyan)'"
                onblur="this.style.borderColor='var(--void-border)'"
              />
            </div>
            <div>
              <label style="display:block;font-size:9px;color:var(--text-muted);letter-spacing:2px;margin-bottom:4px">${t('app.provider.model')}</label>
              <input id="custom-model" placeholder="deepseek-chat"
                style="width:100%;padding:10px 12px;background:var(--void);border:1px solid var(--void-border);color:var(--text-primary);font-family:var(--font-mono);font-size:11px;outline:none;transition:all 0.3s"
                onfocus="this.style.borderColor='var(--phosphor-cyan)'"
                onblur="this.style.borderColor='var(--void-border)'"
              />
            </div>
          </div>
        </section>

        <!-- SECTION: System Prompt -->
        <section style="
          position:relative;
          border:1px solid var(--void-border);
          background:var(--void-surface);
          padding:18px 20px;
          animation:slide-up-fade 0.5s ease-out 0.16s both;
        ">
          <h2 style="
            font-family:var(--font-display);
            font-size:10px;
            letter-spacing:4px;
            color:var(--phosphor-green);
            margin-bottom:14px;
            text-transform:uppercase;
          ">${t('app.section.systemPrompt')}</h2>
          <textarea id="system-prompt"
            style="
              width:100%;height:88px;resize:none;
              padding:12px;
              background:var(--void);
              border:1px solid var(--void-border);
              color:var(--text-primary);
              font-family:var(--font-mono);
              font-size:10px;
              line-height:1.6;
              outline:none;
              transition:all 0.3s;
            "
            onfocus="this.style.borderColor='var(--phosphor-green)';this.style.boxShadow='0 0 12px rgba(0,255,136,0.1)'"
            onblur="this.style.borderColor='var(--void-border)';this.style.boxShadow='none'"
          >You are a helpful assistant. Analyze this screenshot image and answer any questions about it. Be concise and direct. If there's text in the screenshot, read and explain it. If there's code, analyze it. If there's a UI, describe it. Respond in Chinese.</textarea>
        </section>

        <!-- Actions -->
        <div style="
          display:flex;gap:10px;
          animation:slide-up-fade 0.5s ease-out 0.24s both;
        ">
          <button id="save-btn" class="btn-press hover-sweep" style="
            flex:1;padding:14px;
            background:rgba(0,240,255,0.06);
            border:1px solid var(--phosphor-cyan);
            color:var(--phosphor-cyan);
            font-family:var(--font-display);
            font-size:11px;letter-spacing:4px;
            cursor:pointer;
            transition:all 0.3s;
          "
          onmouseover="this.style.background='rgba(0,240,255,0.15)';this.style.boxShadow='0 0 20px rgba(0,240,255,0.2)'"
          onmouseout="this.style.background='rgba(0,240,255,0.06)';this.style.boxShadow='none'"
          >${t('app.save')}</button>
          <button id="test-btn" class="btn-press hover-sweep" style="
            flex:1;padding:14px;
            background:transparent;
            border:1px solid var(--void-border);
            color:var(--text-secondary);
            font-family:var(--font-display);
            font-size:11px;letter-spacing:4px;
            cursor:pointer;
            transition:all 0.3s;
          "
          onmouseover="this.style.borderColor='var(--phosphor-amber)';this.style.color='var(--phosphor-amber)'"
          onmouseout="this.style.borderColor='var(--void-border)';this.style.color='var(--text-secondary)'"
          >${t('app.test')}</button>
        </div>

        <!-- Status message -->
        <div id="status-msg" style="
          text-align:center;font-size:10px;
          min-height:20px;letter-spacing:2px;
          animation:slide-up-fade 0.3s ease-out;
        "></div>

      </main>

      <!-- ====== FOOTER ====== -->
      <footer style="
        position:relative;z-index:10;
        display:flex;justify-content:space-between;align-items:center;
        padding:10px 24px;
        border-top:1px solid var(--void-border);
        font-size:9px;
        color:var(--text-muted);
        letter-spacing:2px;
      ">
        <span>${t('main.version')}</span>
        <span style="display:flex;align-items:center;gap:4px">
          <span style="color:var(--phosphor-cyan)">[</span>
          ${t('app.shortcut.badge')} <kbd id="footer-shortcut" style="
            padding:2px 8px;
            background:var(--void);
            border:1px solid var(--void-border);
            color:var(--phosphor-cyan);
            font-family:var(--font-mono);
            font-size:9px;
            letter-spacing:1px;
          ">Alt+S</kbd> ${t('app.shortcut.toCapture')}
          <span style="color:var(--phosphor-cyan)">]</span>
          <span style="margin-left:8px;font-size:8px;color:var(--text-muted);letter-spacing:1px">${t('app.zoomHint')}</span>
        </span>
      </footer>
    </div>

    <!-- Selection overlay (hidden by default, shown for screenshot region selection) -->
    <div id="selection-overlay" style="
      display:none;
      position:fixed;inset:0;
      z-index:1000;
      cursor:crosshair;
      user-select:none;-webkit-user-select:none;
    ">
      <div id="sel-bg-image" style="
        position:absolute;inset:0;
        background-size:cover;
        background-position:center;
        background-repeat:no-repeat;
        filter:brightness(0.55) saturate(0.8);
      "></div>
      <div id="sel-selection" style="
        position:absolute;
        border:1.5px solid var(--phosphor-cyan);
        background:rgba(0,240,255,0.04);
        box-shadow:0 0 6px rgba(0,240,255,0.2),inset 0 0 6px rgba(0,240,255,0.06);
        pointer-events:none;
        z-index:100;
        display:none;
      "></div>
      <div id="sel-size-indicator" style="
        position:absolute;pointer-events:none;z-index:101;display:none;
        font-family:'JetBrains Mono',monospace;font-size:10px;
        color:var(--phosphor-cyan);
        background:rgba(1,1,9,0.85);
        border:1px solid rgba(0,240,255,0.3);
        padding:3px 8px;letter-spacing:1px;
        text-shadow:0 0 4px rgba(0,240,255,0.5);
      "></div>
      <div id="sel-hint" style="
        position:absolute;top:50%;left:50%;
        transform:translate(-50%,-50%);
        color:rgba(0,240,255,0.6);
        font-family:'JetBrains Mono',monospace;
        font-size:13px;letter-spacing:3px;
        pointer-events:none;z-index:60;
        text-shadow:0 0 10px rgba(0,0,0,0.9);
        text-align:center;
      ">
        <span data-i18n="overlay.dragHint">DRAG TO SELECT REGION</span>
        <span style="display:block;font-size:9px;color:rgba(0,240,255,0.4);margin-top:4px;letter-spacing:2px" data-i18n="overlay.escHint">ESC TO CANCEL</span>
      </div>
      <div id="sel-loading" style="
        position:absolute;top:50%;left:50%;
        transform:translate(-50%,-50%);
        display:none;z-index:200;text-align:center;
      ">
        <div style="width:48px;height:48px;margin:0 auto 16px;position:relative">
          <div style="position:absolute;inset:4px;border:2px solid rgba(0,240,255,0.1);border-top-color:var(--phosphor-cyan);border-radius:50%;animation:spin 1s linear infinite;box-shadow:0 0 16px rgba(0,240,255,0.2)"></div>
          <div style="position:absolute;inset:10px;border:1.5px solid rgba(0,240,255,0.06);border-bottom-color:rgba(0,240,255,0.3);border-radius:50%;animation:spin 1.5s linear infinite reverse"></div>
        </div>
        <div style="color:var(--phosphor-cyan);font-family:'Orbitron',sans-serif;font-size:11px;letter-spacing:5px" data-i18n="result.analyzing">ANALYZING</div>
        <div style="color:rgba(0,240,255,0.5);font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:3px;margin-top:6px" data-i18n="overlay.sending">SENDING TO AI MODEL</div>
      </div>
    </div>
  `

  // Apply translations to all data-i18n elements (selection overlay etc.)
  applyI18n(document)

  initDataStreams()
  initRippleEffect()
  loadConfig()
  bindEvents()
  initSelectionMode()
  initZoom()

  // Debounced save of main window position/size on every move/resize
  {
    let saveTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleSave = () => {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(async () => {
        const win = getCurrentWindow()
        try {
          const pos = await win.outerPosition()
          const size = await win.outerSize()
          await invoke('save_main_geometry', {
            x: pos.x, y: pos.y,
            w: size.width, h: size.height,
          })
        } catch { /* ignore */ }
      }, 500)
    }
    const win = getCurrentWindow()
    win.onMoved(() => scheduleSave())
    win.onResized(() => scheduleSave())
  }
}

function initRippleEffect() {
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    const btn = target.closest('button')
    if (!btn || btn.disabled) return

    const ripple = document.createElement('span')
    ripple.className = 'ripple-effect'
    const rect = btn.getBoundingClientRect()
    const size = Math.max(rect.width, rect.height) * 2.5
    ripple.style.left = (e.clientX - rect.left) + 'px'
    ripple.style.top = (e.clientY - rect.top) + 'px'
    ripple.style.width = ripple.style.height = size + 'px'

    if (getComputedStyle(btn).position === 'static') {
      btn.style.position = 'relative'
    }
    btn.style.overflow = 'hidden'
    btn.appendChild(ripple)
    ripple.addEventListener('animationend', () => ripple.remove())
  })
}

function initDataStreams() {
  const container = document.getElementById('data-streams')
  if (!container) return
  for (let i = 0; i < 16; i++) {
    const col = document.createElement('div')
    col.className = 'stream-column'
    col.style.left = (Math.random() * 96 + 2) + '%'
    col.style.height = (Math.random() * 60 + 40) + 'px'
    col.style.animationDuration = (Math.random() * 4 + 6) + 's'
    col.style.animationDelay = (Math.random() * 8) + 's'
    container.appendChild(col)
  }
}

async function loadConfig() {
  try {
    config = await invoke<AppConfig>('get_config')
    applyConfig(config)
  } catch (e) {
    console.error('Failed to load config:', e)
    config = null
  }
}

function applyConfig(c: AppConfig) {
  const shortcutField = document.getElementById('shortcut-field') as HTMLInputElement
  const footerShortcut = document.getElementById('footer-shortcut')
  const ollamaEndpoint = document.getElementById('ollama-endpoint') as HTMLInputElement
  const ollamaModel = document.getElementById('ollama-model') as HTMLInputElement
  const openaiEndpoint = document.getElementById('openai-endpoint') as HTMLInputElement
  const openaiKey = document.getElementById('openai-key') as HTMLInputElement
  const openaiModel = document.getElementById('openai-model') as HTMLInputElement
  const systemPrompt = document.getElementById('system-prompt') as HTMLTextAreaElement

  if (shortcutField) shortcutField.value = c.shortcut
  if (footerShortcut) footerShortcut.textContent = c.shortcut
  if (ollamaEndpoint) ollamaEndpoint.value = c.ollama_endpoint
  if (ollamaModel) ollamaModel.value = c.ollama_model
  if (openaiEndpoint) openaiEndpoint.value = c.openai_endpoint
  if (openaiKey) openaiKey.value = c.openai_key
  const zhipuKey = document.getElementById('zhipu-key') as HTMLInputElement
  const zhipuModel = document.getElementById('zhipu-model') as HTMLInputElement

  if (openaiModel) openaiModel.value = c.openai_model
  if (zhipuKey) zhipuKey.value = c.zhipu_key || ''
  if (zhipuModel) zhipuModel.value = c.zhipu_model || 'glm-4v-flash'
  const customEndpoint = document.getElementById('custom-endpoint') as HTMLInputElement
  const customKey = document.getElementById('custom-key') as HTMLInputElement
  const customModel = document.getElementById('custom-model') as HTMLInputElement
  if (customEndpoint) customEndpoint.value = c.custom_endpoint || ''
  if (customKey) customKey.value = c.custom_key || ''
  if (customModel) customModel.value = c.custom_model || ''
  if (systemPrompt) systemPrompt.value = c.system_prompt

  currentApiType = c.api_type
  setApiType(c.api_type)
}

function setApiType(type: string) {
  const zhipuBtn = document.getElementById('api-zhipu-btn')!
  const ollamaBtn = document.getElementById('api-ollama-btn')!
  const openaiBtn = document.getElementById('api-openai-btn')!
  const customBtn = document.getElementById('api-custom-btn')!
  const zhipuSettings = document.getElementById('zhipu-settings')!
  const ollamaSettings = document.getElementById('ollama-settings')!
  const openaiSettings = document.getElementById('openai-settings')!
  const customSettings = document.getElementById('custom-settings')!

  const active = 'rgba(0,240,255,0.08)'
  const activeBorder = 'var(--phosphor-cyan)'
  const activeColor = 'var(--phosphor-cyan)'
  const inactive = 'transparent'
  const inactiveBorder = 'var(--void-border)'
  const inactiveColor = 'var(--text-secondary)'

  const buttons = [
    { btn: zhipuBtn, settings: zhipuSettings },
    { btn: ollamaBtn, settings: ollamaSettings },
    { btn: openaiBtn, settings: openaiSettings },
    { btn: customBtn, settings: customSettings },
  ]

  buttons.forEach(b => {
    b.btn.style.background = inactive
    b.btn.style.borderColor = inactiveBorder
    b.btn.style.color = inactiveColor
    b.settings.style.display = 'none'
  })

  let activeIndex = 0
  if (type === 'Ollama') activeIndex = 1
  else if (type === 'OpenAI') activeIndex = 2
  else if (type === 'Custom') activeIndex = 3

  buttons[activeIndex].btn.style.background = active
  buttons[activeIndex].btn.style.borderColor = activeBorder
  buttons[activeIndex].btn.style.color = activeColor
  buttons[activeIndex].settings.style.display = 'flex'
}

let currentApiType: 'Ollama' | 'OpenAI' | 'ZhiPu' | 'Custom' = 'Ollama'
let recording = false
let recordedKeys: string[] = []
let hadNonModifier = false

function bindEvents() {
  // Language toggle
  const langBtn = document.getElementById('lang-toggle-btn')!
  const updateLangBtn = () => {
    langBtn.textContent = getLanguage() === 'zh-CN' ? 'EN' : '中文'
  }
  updateLangBtn()
  langBtn.addEventListener('click', () => {
    const newLang = getLanguage() === 'zh-CN' ? 'en' : 'zh-CN'
    setLanguage(newLang)
    emit('language-changed', { lang: newLang }).catch(() => {})
    location.reload()
  })

  document.getElementById('api-ollama-btn')!.addEventListener('click', () => {
    currentApiType = 'Ollama'
    setApiType('Ollama')
  })
  document.getElementById('api-openai-btn')!.addEventListener('click', () => {
    currentApiType = 'OpenAI'
    setApiType('OpenAI')
  })
  document.getElementById('api-zhipu-btn')!.addEventListener('click', () => {
    currentApiType = 'ZhiPu'
    setApiType('ZhiPu')
  })
  document.getElementById('api-custom-btn')!.addEventListener('click', () => {
    currentApiType = 'Custom'
    setApiType('Custom')
  })

  const recordBtn = document.getElementById('record-shortcut-btn')!
  const shortcutField = document.getElementById('shortcut-field') as HTMLInputElement

  recordBtn.addEventListener('click', async () => {
    if (recording) { stopRecording(true); return }
    recording = true
    recordedKeys = []
    hadNonModifier = false
    recordBtn.textContent = t('app.shortcut.recording')
    recordBtn.style.borderColor = 'var(--phosphor-magenta)'
    recordBtn.style.color = 'var(--phosphor-magenta)'
    recordBtn.style.boxShadow = '0 0 20px rgba(255,0,229,0.3)'
    shortcutField.value = t('app.shortcut.pressKeys')
    shortcutField.style.borderColor = 'var(--phosphor-magenta)'
    shortcutField.style.boxShadow = '0 0 16px rgba(255,0,229,0.2)'
    await invoke('disable_current_shortcut').catch(() => {})
  })

  document.addEventListener('keydown', (e) => {
    if (!recording) return
    e.preventDefault()
    e.stopPropagation()
    const keys: string[] = []
    if (e.ctrlKey) keys.push('Ctrl')
    if (e.altKey) keys.push('Alt')
    if (e.shiftKey) keys.push('Shift')
    if (e.metaKey) keys.push('Meta')
    const key = e.key
    if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
      keys.push(key.length === 1 ? key.toUpperCase() : key)
      hadNonModifier = true
    }
    if (keys.length > 0) {
      recordedKeys = keys.filter((k, i, a) => a.indexOf(k) === i)
      shortcutField.value = recordedKeys.join('+')
    }
  })

  document.addEventListener('keyup', () => {
    if (recording && hadNonModifier) stopRecording(false)
  })

  document.getElementById('save-btn')!.addEventListener('click', async () => {
    if (!config) return
    // Reload from backend so window-geometry fields (saved by other windows)
    // aren't overwritten with stale values from startup.
    const fresh = await invoke<AppConfig>('get_config').catch(() => config)
    const newConfig: AppConfig = {
      ...fresh,
      shortcut: (document.getElementById('shortcut-field') as HTMLInputElement).value,
      api_type: currentApiType,
      ollama_endpoint: (document.getElementById('ollama-endpoint') as HTMLInputElement).value,
      ollama_model: (document.getElementById('ollama-model') as HTMLInputElement).value,
      openai_endpoint: (document.getElementById('openai-endpoint') as HTMLInputElement).value,
      openai_key: (document.getElementById('openai-key') as HTMLInputElement).value,
      openai_model: (document.getElementById('openai-model') as HTMLInputElement).value,
      zhipu_key: (document.getElementById('zhipu-key') as HTMLInputElement).value,
      zhipu_model: (document.getElementById('zhipu-model') as HTMLInputElement).value,
      custom_endpoint: (document.getElementById('custom-endpoint') as HTMLInputElement).value,
      custom_key: (document.getElementById('custom-key') as HTMLInputElement).value,
      custom_model: (document.getElementById('custom-model') as HTMLInputElement).value,
      system_prompt: (document.getElementById('system-prompt') as HTMLTextAreaElement).value,
    }
    try {
      await invoke('save_config', { config: newConfig })
      config = newConfig
      showStatus(t('app.status.saved'), 'success')
      const footerKbd = document.getElementById('footer-shortcut')
      if (footerKbd) footerKbd.textContent = newConfig.shortcut
    } catch (e) {
      showStatus(t('app.status.saveFailed') + ': ' + e, 'error')
    }
  })

  document.getElementById('test-btn')!.addEventListener('click', async () => {
    showStatus(t('app.status.testing'), 'loading')
    try {
      await invoke('take_full_screenshot')
      const result = await invoke<string>('crop_and_ask', {
        x: 0, y: 0, width: 10, height: 10,
        customPrompt: 'Reply with exactly "OK" and nothing else.'
      })
      if (result.includes('OK')) {
        showStatus(t('app.status.connectionOk'), 'success')
      } else {
        showStatus(t('app.status.unexpectedResponse'), 'error')
      }
    } catch (e) {
      showStatus(t('app.status.connectionFailed') + ': ' + e, 'error')
    }
  })
}

function stopRecording(cancelled: boolean) {
  recording = false
  const recordBtn = document.getElementById('record-shortcut-btn')!
  const shortcutField = document.getElementById('shortcut-field') as HTMLInputElement
  recordBtn.textContent = t('app.shortcut.record')
  recordBtn.style.borderColor = 'var(--phosphor-cyan)'
  recordBtn.style.color = 'var(--phosphor-cyan)'
  recordBtn.style.boxShadow = 'none'
  shortcutField.style.borderColor = 'var(--void-border)'
  shortcutField.style.boxShadow = 'none'

  if (cancelled) {
    invoke('reenable_current_shortcut').catch(() => {})
  } else if (recordedKeys.length > 0) {
    const newShortcut = recordedKeys.join('+')
    invoke('register_new_shortcut', { shortcut: newShortcut }).catch((e) => {
      console.error('Failed to activate shortcut:', e)
    })
    const footerKbd = document.getElementById('footer-shortcut')
    if (footerKbd) footerKbd.textContent = newShortcut
  }
}

function showStatus(msg: string, type: StatusType) {
  const el = document.getElementById('status-msg')!
  el.textContent = msg
  if (type === 'success') {
    el.style.color = 'var(--phosphor-green)'
    el.style.textShadow = '0 0 8px rgba(0,255,136,0.5)'
  } else if (type === 'error') {
    el.style.color = 'var(--phosphor-magenta)'
    el.style.textShadow = '0 0 8px rgba(255,0,229,0.5)'
  } else if (type === 'loading') {
    el.style.color = 'var(--phosphor-cyan)'
    el.style.textShadow = '0 0 8px rgba(0,240,255,0.5)'
  }
  setTimeout(() => {
    if (el.textContent === msg) {
      el.textContent = ''
      el.style.textShadow = ''
    }
  }, 4000)
}

// --- Selection mode (screenshot region selection, replaces separate overlay window) ---

function initSelectionMode() {
  const selOverlay = document.getElementById('selection-overlay')!
  const selBgImage = document.getElementById('sel-bg-image')!
  const selSelection = document.getElementById('sel-selection')!
  const selHint = document.getElementById('sel-hint')!
  const selLoading = document.getElementById('sel-loading')!
  const selSizeIndicator = document.getElementById('sel-size-indicator')!
  const vignetteOverlay = document.querySelector('.vignette-overlay') as HTMLElement

  let startX = 0, startY = 0, isSelecting = false
  let screenshotReady = false
  let wasMainVisible = true

  function restoreSettings(hideWindow: boolean) {
    selOverlay.style.display = 'none'
    screenshotReady = false
    if (hideWindow) {
      getCurrentWindow().hide().catch(() => {})
    } else {
      vignetteOverlay.style.display = 'flex'
    }
  }

  // Backend already shows the window fullscreen before emitting this event
  listen<{ image: string; wasMainVisible: boolean }>('screenshot-data', (event) => {
    wasMainVisible = event.payload.wasMainVisible
    vignetteOverlay.style.display = 'none'
    selOverlay.style.display = 'block'
    selLoading.style.display = 'block'
    selHint.style.opacity = '0'
    selSelection.style.display = 'none'
    selSizeIndicator.style.display = 'none'
    screenshotReady = false

    selBgImage.style.backgroundImage = `url(data:image/png;base64,${event.payload.image})`
    selLoading.style.display = 'none'
    selHint.style.opacity = '1'
    screenshotReady = true
  }).catch(console.error)

  document.addEventListener('mousedown', (e) => {
    if (!screenshotReady) return
    if (selOverlay.style.display === 'none') return
    if (e.button !== 0) return
    isSelecting = true
    startX = e.clientX
    startY = e.clientY
    selSelection.style.display = 'block'
    selSelection.style.left = startX + 'px'
    selSelection.style.top = startY + 'px'
    selSelection.style.width = '0px'
    selSelection.style.height = '0px'
    selHint.style.opacity = '0'
    selSizeIndicator.style.display = 'block'
  })

  document.addEventListener('mousemove', (e) => {
    if (!isSelecting) return
    const x = Math.min(startX, e.clientX)
    const y = Math.min(startY, e.clientY)
    const w = Math.abs(e.clientX - startX)
    const h = Math.abs(e.clientY - startY)

    selSelection.style.left = x + 'px'
    selSelection.style.top = y + 'px'
    selSelection.style.width = w + 'px'
    selSelection.style.height = h + 'px'

    selSizeIndicator.textContent = `${Math.round(w)} × ${Math.round(h)}`
    selSizeIndicator.style.left = (e.clientX + 16) + 'px'
    selSizeIndicator.style.top = (e.clientY + 16) + 'px'
  })

  document.addEventListener('mouseup', async (e) => {
    if (!isSelecting) return
    isSelecting = false

    const x = Math.min(startX, e.clientX)
    const y = Math.min(startY, e.clientY)
    const w = Math.abs(e.clientX - startX)
    const h = Math.abs(e.clientY - startY)

    selSizeIndicator.style.display = 'none'

    if (w < 10 || h < 10) {
      selSelection.style.display = 'none'
      selHint.style.opacity = '1'
      return
    }

    selSelection.style.display = 'none'

    const win = getCurrentWindow()
    await win.setFullscreen(false)
    restoreSettings(!wasMainVisible)

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
    if (e.key === 'Escape' && selOverlay.style.display !== 'none') {
      const win = getCurrentWindow()
      await win.setFullscreen(false)
      restoreSettings(!wasMainVisible)
    }
  })
}

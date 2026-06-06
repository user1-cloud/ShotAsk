# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build / run commands

```bash
pnpm install                  # install dependencies
pnpm run tauri dev            # dev mode with hot-reload
pnpm run tauri build          # production build
npx tsc --noEmit              # TypeScript type-check (no output)
cd src-tauri && cargo check   # Rust type-check (fast, no binary)
```

The Vite dev server runs on port 1420 (strict). The `pretauri` script kills any lingering shotask process before starting.

## Architecture

ShotAsk is a **Tauri v2** desktop app: Rust backend (`src-tauri/`) + vanilla TypeScript frontend (`src/`), built with Vite + UnoCSS.

**Three windows** (configured in `src-tauri/tauri.conf.json`):

| Window | Label | Purpose |
|--------|-------|---------|
| Settings | `main` | Config UI: shortcut, AI provider (Ollama/OpenAI/ZhiPu), system prompt. Entry: `index.html` → `src/main.ts` → `src/app.ts` |
| Overlay | `overlay` | Fullscreen transparent selection overlay for screenshots. Borderless, shown via `set_fullscreen(true)`. Entry: `overlay.html` → `src/overlay.ts` |
| Result | `result` | AI response + chat. Native window decorations (minimize/maximize/close). Clicking X hides instead of destroying (`onCloseRequested` + `event.preventDefault()`). Entry: `result.html` → `src/result.ts` |

**Screenshot flow** (`src-tauri/src/lib.rs:trigger_screenshot_flow`):

1. Cancel any in-flight analysis, hide result window, emit `reset-content`
2. Only save result window geometry if it was visible (not already hidden)
3. **Capture screenshot first** (via `xcap`), then show overlay as fullscreen — this ensures the overlay itself doesn't appear in the capture
4. Emit `screenshot-data` to overlay, which displays it as background for drag selection

**Overlay** (`src/overlay.ts`): Shows the fullscreen screenshot as background. User drags a rectangle; on mouseup, hides the overlay and calls `crop_and_ask` with physical-pixel coordinates (client coords × `devicePixelRatio`). Gated by `screenshotReady` flag — selection is blocked until `screenshot-data` arrives.

**Backend modules:**
- `src-tauri/src/screenshot.rs` — `xcap`-based fullscreen capture and PNG crop
- `src-tauri/src/ollama.rs` — SSE-streaming AI clients (Ollama, OpenAI-compatible, ZhiPu)
- `src-tauri/src/config.rs` — JSON config persisted to `directories::ProjectDirs` (`com.shotask.ShotAsk`). Fields: shortcut, API credentials, result window geometry + zoom
- `src-tauri/src/commands.rs` — 8 Tauri IPC commands (get/save config, screenshot, crop_and_ask, chat_followup, etc.)

**Frontend modules:**
- `src/zoom.ts` — Ctrl+wheel zoom via `getCurrentWebviewWindow().setZoom()`. Exposes `getZoom()`/`setZoom()` and `window.__shotaskSetZoom` (for Rust `eval()` restore)
- `src/result.ts` — AI response rendering, chat bubbles, streaming markdown via `marked`. Screenshot image appears as a user-style bubble (like 豆包), click to expand
- `src/app.ts` — Settings UI, shortcut recording, provider switching (Ollama/OpenAI/ZhiPu), config save/load

**Permissions** (`src-tauri/capabilities/default.json`): All three windows have core + window + event + global-shortcut + shell + webview-zoom permissions.

**Styling:** Dark cyberpunk theme ("Phosphor Void") defined in `src/style.css` (shared) and inline in HTML files. Uses CSS custom properties (`--phosphor-cyan`, `--void-deep`, etc.). Fonts: Orbitron (headings), JetBrains Mono (body/code).

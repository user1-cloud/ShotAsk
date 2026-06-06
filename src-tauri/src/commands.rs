use std::sync::Mutex;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::State;
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use crate::config::{AppConfig, ApiType};
use crate::screenshot;
use crate::ollama;

pub struct AppState {
    pub config: Mutex<AppConfig>,
    pub screenshot_data: Mutex<Vec<u8>>,
    pub cancel_flag: Arc<AtomicBool>,
}

#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    let config = state.config.lock().map_err(|e| e.to_string())?;
    Ok(config.clone())
}

#[tauri::command]
pub async fn save_config(
    state: State<'_, AppState>,
    config: AppConfig,
) -> Result<(), String> {
    crate::config::save_config(&config).map_err(|e| e.to_string())?;
    *state.config.lock().map_err(|e| e.to_string())? = config.clone();
    Ok(())
}

#[tauri::command]
pub async fn register_new_shortcut(
    app: tauri::AppHandle,
    shortcut: String,
) -> Result<(), String> {
    crate::register_global_shortcut(&app, &shortcut)?;
    log::info!("New shortcut activated: {}", shortcut);
    Ok(())
}

#[tauri::command]
pub async fn disable_current_shortcut(app: tauri::AppHandle) -> Result<(), String> {
    app.global_shortcut().unregister_all().map_err(|e| e.to_string())?;
    log::info!("Global shortcut disabled");
    Ok(())
}

#[tauri::command]
pub async fn reenable_current_shortcut(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let shortcut_str = state.config.lock().map_err(|e| e.to_string())?.shortcut.clone();
    crate::register_global_shortcut(&app, &shortcut_str)?;
    log::info!("Global shortcut re-enabled: {}", shortcut_str);
    Ok(())
}

#[tauri::command]
pub async fn take_full_screenshot(state: State<'_, AppState>) -> Result<String, String> {
    let data = screenshot::capture_fullscreen().map_err(|e| e.to_string())?;
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &data);
    *state.screenshot_data.lock().map_err(|e| e.to_string())? = data;
    Ok(b64)
}

#[tauri::command]
pub async fn crop_and_ask(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    custom_prompt: Option<String>,
) -> Result<String, String> {
    let config = state.config.lock().map_err(|e| e.to_string())?.clone();
    let full_data = {
        let guard = state.screenshot_data.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };

    // Restore result window — set geometry BEFORE showing to avoid
    // confusing the window manager (especially on Windows after minimize).
    if let Some(result_win) = app.get_webview_window("result") {
        let monitors = screenshot::get_monitor_info().ok();
        let mut placed = false;

        if let (Some(x), Some(y), Some(w), Some(h)) =
            (config.result_win_x, config.result_win_y, config.result_win_w, config.result_win_h)
        {
            // Validate saved position is actually on-screen
            let on_screen = monitors.as_ref().map_or(false, |mons| {
                mons.iter().any(|m| {
                    x >= m.x && y >= m.y
                        && x + (w as i32) <= m.x + m.width as i32
                        && y + (h as i32) <= m.y + m.height as i32
                })
            });
            if on_screen && x > -10000 && y > -10000 {
                let _ = result_win.set_position(tauri::PhysicalPosition::new(x, y));
                let _ = result_win.set_size(tauri::PhysicalSize::new(w, h));
                placed = true;
            }
        }

        if !placed {
            if let Some(ref monitors) = monitors {
                if let Some(primary) = monitors.first() {
                    let padding = 40i32;
                    let win_w = 440i32;
                    let win_h = 360i32;
                    let x = primary.x + primary.width as i32 - win_w - padding;
                    let y = primary.y + primary.height as i32 - win_h - padding;
                    let _ = result_win.set_position(tauri::PhysicalPosition::new(x.max(0), y.max(0)));
                    let _ = result_win.set_size(tauri::PhysicalSize::new(win_w as u32, win_h as u32));
                }
            }
        }

        // unminimize() uses SW_RESTORE on Windows, which both unminimizes
        // and shows the window.
        let _ = result_win.unminimize();
        let _ = result_win.show();
        let _ = result_win.set_focus();

        // Restore saved zoom via global JS function
        let saved_zoom = config.result_win_zoom.unwrap_or(1.0);
        if (saved_zoom - 1.0).abs() > 0.01 {
            let _ = result_win.eval(&format!("window.__shotaskSetZoom({})", saved_zoom));
        }
    }

    let cropped = screenshot::crop_screenshot(&full_data, x, y, width, height)
        .map_err(|e| e.to_string())?;

    // Reset cancel flag before starting
    state.cancel_flag.store(false, Ordering::SeqCst);
    let cancel_flag = Arc::clone(&state.cancel_flag);

    let prompt = custom_prompt.unwrap_or_else(|| config.system_prompt.clone());

    let result = match config.api_type {
        ApiType::Ollama => {
            ollama::ask_ollama(
                &cropped,
                &prompt,
                &config.ollama_endpoint,
                &config.ollama_model,
                &app,
                cancel_flag,
            )
            .await
            .map_err(|e| e.to_string())?
        }
        ApiType::OpenAI => {
            ollama::ask_openai(
                &cropped,
                &prompt,
                &config.openai_endpoint,
                &config.openai_key,
                &config.openai_model,
                &app,
                cancel_flag,
            )
            .await
            .map_err(|e| e.to_string())?
        }
        ApiType::ZhiPu => {
            ollama::ask_openai(
                &cropped,
                &prompt,
                "https://open.bigmodel.cn/api/paas/v4",
                &config.zhipu_key,
                &config.zhipu_model,
                &app,
                cancel_flag,
            )
            .await
            .map_err(|e| e.to_string())?
        }
        ApiType::Custom => {
            ollama::ask_openai(
                &cropped,
                &prompt,
                &config.custom_endpoint,
                &config.custom_key,
                &config.custom_model,
                &app,
                cancel_flag,
            )
            .await
            .map_err(|e| e.to_string())?
        }
    };

    // Emit response + cropped image + prompt to result window
    let cropped_b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &cropped);
    let _ = app.emit("ai-response", serde_json::json!({ "text": result, "image": cropped_b64, "prompt": prompt }));

    Ok(result)
}

#[tauri::command]
pub async fn get_monitors() -> Result<Vec<screenshot::MonitorInfo>, String> {
    screenshot::get_monitor_info().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn chat_followup(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    image_b64: String,
    history: Vec<ollama::ChatMsg>,
    new_message: String,
) -> Result<String, String> {
    let config = state.config.lock().map_err(|e| e.to_string())?.clone();

    state.cancel_flag.store(false, Ordering::SeqCst);
    let cancel_flag = Arc::clone(&state.cancel_flag);

    let result = match config.api_type {
        crate::config::ApiType::Ollama => {
            ollama::chat_ollama(
                &image_b64,
                &config.system_prompt,
                &history,
                &new_message,
                &config.ollama_endpoint,
                &config.ollama_model,
                &app,
                cancel_flag,
            )
            .await
            .map_err(|e| e.to_string())?
        }
        crate::config::ApiType::OpenAI => {
            ollama::chat_openai(
                &image_b64,
                &config.system_prompt,
                &history,
                &new_message,
                &config.openai_endpoint,
                &config.openai_key,
                &config.openai_model,
                &app,
                cancel_flag,
            )
            .await
            .map_err(|e| e.to_string())?
        }
        crate::config::ApiType::ZhiPu => {
            ollama::chat_openai(
                &image_b64,
                &config.system_prompt,
                &history,
                &new_message,
                "https://open.bigmodel.cn/api/paas/v4",
                &config.zhipu_key,
                &config.zhipu_model,
                &app,
                cancel_flag,
            )
            .await
            .map_err(|e| e.to_string())?
        }
        crate::config::ApiType::Custom => {
            ollama::chat_openai(
                &image_b64,
                &config.system_prompt,
                &history,
                &new_message,
                &config.custom_endpoint,
                &config.custom_key,
                &config.custom_model,
                &app,
                cancel_flag,
            )
            .await
            .map_err(|e| e.to_string())?
        }
    };

    Ok(result)
}

#[tauri::command]
pub async fn cancel_analysis(state: State<'_, AppState>) -> Result<(), String> {
    state.cancel_flag.store(true, Ordering::SeqCst);
    log::info!("Analysis cancellation requested");
    Ok(())
}

#[tauri::command]
pub async fn save_result_geometry(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    zoom: Option<f32>,
) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("result") {
        if let Ok(pos) = win.outer_position() {
            if let Ok(size) = win.outer_size() {
                // Hold lock for entire read-modify-write to avoid race conditions
                let mut config = state.config.lock().map_err(|e| e.to_string())?;
                config.result_win_x = Some(pos.x);
                config.result_win_y = Some(pos.y);
                config.result_win_w = Some(size.width);
                config.result_win_h = Some(size.height);
                config.result_win_zoom = zoom;
                crate::config::save_config(&config).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn save_main_geometry(
    state: State<'_, AppState>,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
) -> Result<(), String> {
    let mut config = state.config.lock().map_err(|e| e.to_string())?;
    config.main_win_x = Some(x);
    config.main_win_y = Some(y);
    config.main_win_w = Some(w);
    config.main_win_h = Some(h);
    crate::config::save_config(&config).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn save_zoom(state: State<'_, AppState>, zoom: f32) -> Result<(), String> {
    let mut config = state.config.lock().map_err(|e| e.to_string())?;
    config.result_win_zoom = Some(zoom);
    crate::config::save_config(&config).map_err(|e| e.to_string())?;
    Ok(())
}

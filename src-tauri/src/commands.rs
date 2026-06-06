use std::sync::Mutex;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::State;
use tauri::Emitter;
use tauri::Manager;
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
    app: tauri::AppHandle,
) -> Result<(), String> {
    crate::config::save_config(&config).map_err(|e| e.to_string())?;
    let old_shortcut = state.config.lock().map_err(|e| e.to_string())?.shortcut.clone();
    *state.config.lock().map_err(|e| e.to_string())? = config.clone();

    // Re-register shortcut if changed
    if old_shortcut != config.shortcut {
        use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

        let new_sc: Shortcut = config.shortcut.parse().map_err(|e| format!("Invalid shortcut: {}", e))?;
        app.global_shortcut().unregister_all().map_err(|e| e.to_string())?;

        let h = app.clone();
        app.global_shortcut().on_shortcut(new_sc, move |_app, _sc, event| {
            if event.state == ShortcutState::Pressed {
                let h = h.clone();
                tauri::async_runtime::spawn(async move {
                    crate::trigger_screenshot_flow(&h).await;
                });
            }
        }).map_err(|e| e.to_string())?;
    }

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

    // Show result window with analyzing state
    if let Some(result_win) = app.get_webview_window("result") {
        let _ = result_win.show();

        // Restore saved zoom via global JS function (eval is synchronous/reliable)
        let saved_zoom = config.result_win_zoom.unwrap_or(1.0);
        if (saved_zoom - 1.0).abs() > 0.01 {
            let _ = result_win.eval(&format!("window.__shotaskSetZoom({})", saved_zoom));
        }

        match (config.result_win_x, config.result_win_y, config.result_win_w, config.result_win_h) {
            (Some(x), Some(y), Some(w), Some(h)) => {
                let _ = result_win.set_position(tauri::PhysicalPosition::new(x, y));
                let _ = result_win.set_size(tauri::PhysicalSize::new(w, h));
            }
            _ => {
                // Default: bottom-right corner with padding
                if let Ok(monitors) = screenshot::get_monitor_info() {
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

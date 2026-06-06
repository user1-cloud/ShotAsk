use tauri::Manager;
use tauri::Emitter;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

mod commands;
mod config;
mod ollama;
mod screenshot;

use commands::AppState;

static OVERLAY_ACTIVE: AtomicBool = AtomicBool::new(false);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let saved_config = config::load_config();
    let shortcut_str = saved_config.shortcut.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            config: std::sync::Mutex::new(saved_config),
            screenshot_data: std::sync::Mutex::new(Vec::new()),
            cancel_flag: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        })
        .setup(move |app| {
            let handle = app.handle().clone();

            let shortcut: tauri_plugin_global_shortcut::Shortcut = shortcut_str
                .parse()
                .expect("Failed to parse shortcut");

            // Clean up any leftover registrations from previous crashed sessions
            let _ = app.global_shortcut().unregister_all();

            match app.global_shortcut().on_shortcut(shortcut, move |_app, _sc, event| {
                if event.state == ShortcutState::Pressed {
                    if OVERLAY_ACTIVE.swap(true, Ordering::SeqCst) {
                        return;
                    }
                    let h = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        trigger_screenshot_flow(&h).await;
                        OVERLAY_ACTIVE.store(false, Ordering::SeqCst);
                    });
                }
            }) {
                Ok(_) => log::info!("Global shortcut registered successfully"),
                Err(e) => log::error!("Failed to register global shortcut: {}. The shortcut may be in use by another application.", e),
            }

            // Restore main window geometry from saved config
            {
                let state = app.state::<AppState>();
                let config = state.config.lock().unwrap();
                if let (Some(x), Some(y), Some(w), Some(h)) =
                    (config.main_win_x, config.main_win_y, config.main_win_w, config.main_win_h)
                {
                    drop(config);
                    if let Some(main_win) = app.get_webview_window("main") {
                        let _ = main_win.set_position(tauri::PhysicalPosition::new(x, y));
                        let _ = main_win.set_size(tauri::PhysicalSize::new(w, h));
                    }
                }
            }

            // Save main window geometry on close
            if let Some(main_win) = app.get_webview_window("main") {
                let h = app.handle().clone();
                let win = main_win.clone();
                main_win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { .. } = event {
                        if let Ok(pos) = win.outer_position() {
                            if let Ok(size) = win.outer_size() {
                                if let Some(state) = h.try_state::<AppState>() {
                                    if let Ok(mut config) = state.config.lock() {
                                        config.main_win_x = Some(pos.x);
                                        config.main_win_y = Some(pos.y);
                                        config.main_win_w = Some(size.width);
                                        config.main_win_h = Some(size.height);
                                        let _ = crate::config::save_config(&config);
                                    }
                                }
                            }
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::take_full_screenshot,
            commands::crop_and_ask,
            commands::chat_followup,
            commands::get_monitors,
            commands::cancel_analysis,
            commands::save_result_geometry,
            commands::save_main_geometry,
            commands::save_zoom,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub async fn trigger_screenshot_flow(app: &tauri::AppHandle) {
    // Cancel any in-flight analysis from the previous screenshot
    if let Some(state) = app.try_state::<AppState>() {
        state.cancel_flag.store(true, Ordering::SeqCst);
    }

    // Save geometry (only if window is currently visible — don't read junk
    // coords from a hidden window) then hide the result window for clean capture.
    if let Some(result_win) = app.get_webview_window("result") {
        let visible = result_win.is_visible().unwrap_or(false);
        if visible {
            // Sync zoom from frontend before hiding (eval fires async, lock
            // serializes the writes correctly regardless of order).
            let _ = result_win.eval(
                "if(window.__shotaskGetZoom)window.__TAURI__.core.invoke('save_zoom',{zoom:window.__shotaskGetZoom()})"
            );
            if let Some(state) = app.try_state::<AppState>() {
                if let Ok(mut config) = state.config.lock() {
                    if let Ok(pos) = result_win.outer_position() {
                        if let Ok(size) = result_win.outer_size() {
                            config.result_win_x = Some(pos.x);
                            config.result_win_y = Some(pos.y);
                            config.result_win_w = Some(size.width);
                            config.result_win_h = Some(size.height);
                            let _ = crate::config::save_config(&config);
                        }
                    }
                }
            }
        }
        let _ = result_win.hide();
        let _ = result_win.emit("reset-content", ());
    }

    // Capture screenshot FIRST — before showing overlay, so the overlay
    // itself doesn't appear in the captured image.
    let screenshot_data = match screenshot::capture_fullscreen() {
        Ok(data) => data,
        Err(e) => {
            log::error!("Screenshot failed: {}", e);
            OVERLAY_ACTIVE.store(false, Ordering::SeqCst);
            return;
        }
    };

    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &screenshot_data);

    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut data) = state.screenshot_data.lock() {
            *data = screenshot_data;
        }
    }

    // Now show overlay as true fullscreen (covers taskbar) with the screenshot
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.set_fullscreen(true);
        let _ = overlay.show();
        let _ = overlay.set_focus();
        let _ = overlay.emit("screenshot-data", serde_json::json!({ "image": b64 }));
    }
}

use tauri::Manager;
use tauri::Emitter;
use std::sync::atomic::{AtomicBool, Ordering};
use std::fs::OpenOptions;
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use tauri::tray::{TrayIconBuilder, MouseButton, TrayIconEvent};
use tauri::menu::{MenuBuilder, MenuItemBuilder};

mod commands;
mod config;
mod ollama;
mod screenshot;

use commands::AppState;

pub(crate) static OVERLAY_ACTIVE: AtomicBool = AtomicBool::new(false);

pub fn register_global_shortcut(
    app: &tauri::AppHandle,
    shortcut_str: &str,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::ShortcutState;
    let sc: tauri_plugin_global_shortcut::Shortcut = shortcut_str
        .parse()
        .map_err(|e| format!("Invalid shortcut '{}': {}", shortcut_str, e))?;
    let _ = app.global_shortcut().unregister_all();
    let h = app.clone();
    app.global_shortcut()
        .on_shortcut(sc, move |_app, _sc, event| {
            if event.state == ShortcutState::Pressed {
                if OVERLAY_ACTIVE.swap(true, Ordering::SeqCst) {
                    return;
                }
                let h = h.clone();
                tauri::async_runtime::spawn(async move {
                    trigger_screenshot_flow(&h).await;
                    OVERLAY_ACTIVE.store(false, Ordering::SeqCst);
                });
            }
        })
        .map_err(|e| format!("Failed to register shortcut: {}", e))?;
    Ok(())
}

fn acquire_single_instance_lock() -> Option<std::fs::File> {
    let lock_path = std::env::temp_dir().join("shotask.instance.lock");
    match OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(true)
        .open(&lock_path)
    {
        Ok(file) => match fs2::FileExt::try_lock_exclusive(&file) {
            Ok(()) => {
                use std::io::Write;
                let _ = writeln!(&file, "{}", std::process::id());
                log::info!("Single-instance lock acquired");
                Some(file)
            }
            Err(_) => {
                log::warn!("Another instance is already running, focusing existing window");
                None
            }
        },
        Err(e) => {
            log::error!("Failed to open lock file: {}", e);
            None
        }
    }
}

fn signal_existing_instance() {
    let signal_path = std::env::temp_dir().join("shotask.show.signal");
    let _ = std::fs::write(&signal_path, "show");
    let _ = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", "(New-Object -ComObject WScript.Shell).AppActivate('ShotAsk') | Out-Null"])
        .output();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _single_instance_lock = acquire_single_instance_lock();
    if _single_instance_lock.is_none() {
        signal_existing_instance();
        return;
    }

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
            // --- Tray icon ---
            let show_item = MenuItemBuilder::with_id("show", "Show").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&show_item)
                .item(&quit_item)
                .build()?;

            let icon_bytes = include_bytes!("../icons/32x32.png");
            let decoded = image::load_from_memory(icon_bytes)
                .expect("Failed to decode tray icon")
                .into_rgba8();
            let (w, h) = (decoded.width(), decoded.height());
            let icon = tauri::image::Image::new_owned(decoded.into_raw(), w, h);

            let _tray = TrayIconBuilder::with_id("shotask-tray")
                .icon(icon)
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            // --- Global shortcut ---
            let _ = app.global_shortcut().unregister_all();
            match register_global_shortcut(app.handle(), &shortcut_str) {
                Ok(()) => log::info!("Global shortcut registered: {}", shortcut_str),
                Err(e) => log::error!("{}", e),
            }

            // --- Restore main window geometry ---
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

            // --- Main window: hide on close instead of destroy ---
            if let Some(main_win) = app.get_webview_window("main") {
                let h = app.handle().clone();
                let win = main_win.clone();
                main_win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
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
                        api.prevent_close();
                        let _ = win.hide();
                    }
                });
            }

            // --- Poll for "show" signal from second instance ---
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let signal_path = std::env::temp_dir().join("shotask.show.signal");
                loop {
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    if signal_path.exists() {
                        let _ = std::fs::remove_file(&signal_path);
                        if let Some(w) = app_handle.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                }
            });

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
            commands::register_new_shortcut,
            commands::disable_current_shortcut,
            commands::reenable_current_shortcut,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub async fn trigger_screenshot_flow(app: &tauri::AppHandle) {
    // Cancel any in-flight analysis from the previous screenshot
    if let Some(state) = app.try_state::<AppState>() {
        state.cancel_flag.store(true, Ordering::SeqCst);
    }

    // Save geometry (only if window is normal-visible, not minimized —
    // minimized windows report bogus off-screen coordinates on Windows)
    // then hide for clean capture.
    if let Some(result_win) = app.get_webview_window("result") {
        let normal_visible = result_win.is_visible().unwrap_or(false)
            && !result_win.is_minimized().unwrap_or(false);
        if normal_visible {
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
            let _ = result_win.hide();
        }
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

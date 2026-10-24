mod api;
mod auth;
mod clipper;
mod media;
mod settings;

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use serde_json::{json, Value};
use settings::Settings;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, UserAttentionType, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;

/// So lange darf das Clip-Programm zum Speichern brauchen.
const CLIP_WAIT: Duration = Duration::from_secs(45);

struct AppState {
    client: reqwest::Client,
    settings: Mutex<Settings>,
    login_generation: Arc<AtomicU64>,
    upload_cancel: Mutex<Arc<AtomicBool>>,
    capturing: AtomicBool,
    /// Fertig übertragene Dateien, deren Clip noch nicht angelegt ist (z. B. Formfehler).
    tickets: Mutex<HashMap<PathBuf, String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsView {
    settings: Settings,
    default_clip_dir: String,
    default_clipper_hotkey: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipInfo {
    path: String,
    name: String,
    size_bytes: u64,
    duration_seconds: Option<f64>,
    /// Ende der Aufnahme (Änderungszeit der Datei) in ms seit 1970.
    saved_at: u64,
}

fn videos_dir(app: &AppHandle) -> PathBuf {
    app.path().video_dir().unwrap_or_else(|_| PathBuf::from(r"C:\Users\Public\Videos"))
}

fn settings_view(app: &AppHandle, settings: &Settings) -> SettingsView {
    SettingsView {
        settings: settings.clone(),
        default_clip_dir: clipper::default_clip_dir(settings.clipper, &videos_dir(app)).display().to_string(),
        default_clipper_hotkey: clipper::default_hotkey(settings.clipper),
    }
}

fn effective_clip_dir(app: &AppHandle, settings: &Settings) -> PathBuf {
    if settings.clip_dir.trim().is_empty() {
        clipper::default_clip_dir(settings.clipper, &videos_dir(app))
    } else {
        PathBuf::from(settings.clip_dir.trim())
    }
}

fn effective_clipper_hotkey(settings: &Settings) -> String {
    if settings.clipper_hotkey.trim().is_empty() {
        clipper::default_hotkey(settings.clipper)
    } else {
        settings.clipper_hotkey.trim().to_string()
    }
}

fn register_hotkey(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    let shortcut: Shortcut = hotkey.parse().map_err(|_| format!("Ungültige Bodycam-Taste „{hotkey}“"))?;
    let shortcuts = app.global_shortcut();
    shortcuts.unregister_all().map_err(|e| e.to_string())?;
    shortcuts
        .register(shortcut)
        .map_err(|_| format!("„{hotkey}“ ist schon von einem anderen Programm belegt"))
}

fn inspect(path: &Path) -> Result<ClipInfo, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("Clip nicht lesbar: {e}"))?;
    if !clipper::is_video(path) {
        return Err("Nur MP4-, MKV-, MOV- und WebM-Dateien können hochgeladen werden".into());
    }
    let saved_at = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(ClipInfo {
        path: path.display().to_string(),
        name: path.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string(),
        size_bytes: meta.len(),
        duration_seconds: media::duration_seconds(path),
        saved_at,
    })
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Bodycam-Taste: Clip im Programm speichern lassen, Datei abwarten, Formular füllen.
fn run_capture(app: AppHandle) {
    let state = app.state::<AppState>();
    if state.capturing.swap(true, Ordering::SeqCst) {
        return;
    }
    let settings = state.settings.lock().unwrap().clone();
    let _ = app.emit("capture-status", json!({ "state": "saving" }));

    tauri::async_runtime::spawn_blocking(move || {
        let result = (|| {
            let keys = clipper::parse_hotkey(&effective_clipper_hotkey(&settings))?;
            let since = SystemTime::now() - Duration::from_millis(500);
            clipper::press_hotkey(&keys);
            let path = clipper::wait_for_new_clip(&effective_clip_dir(&app, &settings), since, CLIP_WAIT)?;
            inspect(&path)
        })();
        match result {
            Ok(clip) => {
                let _ = app.emit("clip-ready", clip);
                // Nicht aus dem Spiel reißen – nur in der Taskleiste auf sich aufmerksam machen.
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.request_user_attention(Some(UserAttentionType::Informational));
                }
            }
            Err(message) => {
                let _ = app.emit("capture-status", json!({ "state": "error", "message": message }));
            }
        }
        app.state::<AppState>().capturing.store(false, Ordering::SeqCst);
    });
}

// ── Befehle für das Fenster ──────────────────────────────────────────

#[tauri::command]
fn get_settings(app: AppHandle, state: State<AppState>) -> SettingsView {
    settings_view(&app, &state.settings.lock().unwrap())
}

#[tauri::command]
fn save_settings(app: AppHandle, state: State<AppState>, settings: Settings) -> Result<SettingsView, String> {
    if !settings.clipper_hotkey.trim().is_empty() {
        clipper::parse_hotkey(&settings.clipper_hotkey)?;
    }
    let previous = state.settings.lock().unwrap().bodycam_hotkey.clone();
    if settings.bodycam_hotkey != previous {
        if let Err(error) = register_hotkey(&app, &settings.bodycam_hotkey) {
            let _ = register_hotkey(&app, &previous);
            return Err(error);
        }
    }
    settings::save(&app, &settings)?;
    *state.settings.lock().unwrap() = settings.clone();
    Ok(settings_view(&app, &settings))
}

#[tauri::command]
fn remember_investigation(app: AppHandle, state: State<AppState>, id: String) {
    let mut settings = state.settings.lock().unwrap();
    settings.last_investigation_id = Some(id);
    let _ = settings::save(&app, &settings);
}

#[tauri::command]
fn is_signed_in() -> bool {
    auth::load_token().is_some()
}

#[tauri::command]
async fn login(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let generation = state.login_generation.clone();
    let mine = generation.fetch_add(1, Ordering::SeqCst) + 1;
    let request = auth::prepare_login(api::base_url())?;
    app.opener().open_url(&request.url, None::<&str>).map_err(|e| e.to_string())?;

    let (code, verifier) = tauri::async_runtime::spawn_blocking(move || {
        auth::wait_for_code(&request, &generation, mine).map(|code| (code, request.verifier))
    })
    .await
    .map_err(|e| e.to_string())??;

    let token = api::exchange_code(&state.client, &code, &verifier).await?;
    auth::store_token(&token)?;
    show_main_window(&app);
    Ok(())
}

#[tauri::command]
async fn logout(state: State<'_, AppState>) -> Result<(), String> {
    api::revoke(&state.client).await;
    auth::delete_token();
    Ok(())
}

#[tauri::command]
async fn session_context(state: State<'_, AppState>) -> Result<Value, String> {
    let result = api::session(&state.client).await;
    if result.as_ref().err().map(String::as_str) == Some(api::UNAUTHORIZED) {
        // Widerrufen oder abgelaufen: Token verwerfen, das Fenster zeigt wieder den Login.
        auth::delete_token();
    }
    result
}

#[tauri::command]
fn inspect_clip(path: String) -> Result<ClipInfo, String> {
    inspect(Path::new(&path))
}

#[tauri::command]
fn capture_clip(app: AppHandle) {
    run_capture(app);
}

#[tauri::command]
async fn upload_clip(app: AppHandle, state: State<'_, AppState>, path: String, meta: Value) -> Result<Value, String> {
    let path = PathBuf::from(path);
    let cancel = Arc::new(AtomicBool::new(false));
    *state.upload_cancel.lock().unwrap() = cancel.clone();

    let existing = state.tickets.lock().unwrap().get(&path).cloned();
    let upload_id = match existing {
        Some(id) => id,
        None => {
            let emitter = app.clone();
            let id = api::upload_file(&state.client, &path, cancel, move |progress| {
                let _ = emitter.emit("upload-progress", progress);
            })
            .await?;
            state.tickets.lock().unwrap().insert(path.clone(), id.clone());
            id
        }
    };

    let clip = api::create_clip(&state.client, &upload_id, meta).await?;
    state.tickets.lock().unwrap().remove(&path);
    Ok(clip)
}

#[tauri::command]
fn cancel_upload(state: State<AppState>) {
    state.upload_cancel.lock().unwrap().store(true, Ordering::SeqCst);
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        run_capture(app.clone());
                    }
                })
                .build(),
        )
        .setup(|app| {
            let handle = app.handle().clone();
            let settings = settings::load(&handle);
            if let Err(error) = register_hotkey(&handle, &settings.bodycam_hotkey) {
                eprintln!("{error}");
            }
            app.manage(AppState {
                client: api::client(),
                settings: Mutex::new(settings),
                login_generation: Arc::default(),
                upload_cancel: Mutex::new(Arc::default()),
                capturing: AtomicBool::new(false),
                tickets: Mutex::default(),
            });

            // Im Hintergrund weiterlaufen, damit die Bodycam-Taste auch im Spiel greift.
            let open = MenuItem::with_id(app, "open", "Öffnen", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().expect("App-Icon fehlt"))
                .tooltip("FIB Desktop")
                .menu(&Menu::with_items(app, &[&open, &quit])?)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            remember_investigation,
            is_signed_in,
            login,
            logout,
            session_context,
            inspect_clip,
            capture_clip,
            upload_clip,
            cancel_upload,
        ])
        .run(tauri::generate_context!())
        .expect("FIB Desktop konnte nicht gestartet werden");
}

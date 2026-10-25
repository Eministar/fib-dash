mod api;
mod auth;
mod clipper;
mod media;
mod settings;
mod convert;
mod killclip;
mod recorder;
mod tweaks;

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
    kill_clips: killclip::KillClips,
    recorder: recorder::Recorder,
    tweaks: Arc<tweaks::Service>,
    /// Taste für den Einrichtungs-Screenshot, solange die Einrichtung offen ist.
    calibration_shortcut: Mutex<Option<Shortcut>>,
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
    // Nur die bisherige Bodycam-Taste lösen – die Einrichtungstaste der Kill-Clips bleibt.
    if let Some(previous) = app.try_state::<AppState>().and_then(|s| s.settings.lock().unwrap().bodycam_hotkey.parse::<Shortcut>().ok()) {
        let _ = shortcuts.unregister(previous);
    }
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

/// Löst das eingestellte Clip-Programm aus und liefert die neue Aufnahme.
/// NVIDIA/Medal bekommen ihre Speichertaste, Self-Clip speichert direkt.
fn save_clip_now(app: &AppHandle, settings: &Settings) -> Result<PathBuf, String> {
    if settings.clipper == settings::Clipper::SelfClip {
        let recorder = &app.state::<AppState>().recorder;
        return recorder.save(app, settings.self_clip.buffer_seconds, &effective_clip_dir(app, settings));
    }
    let keys = clipper::parse_hotkey(&effective_clipper_hotkey(settings))?;
    let since = SystemTime::now() - Duration::from_millis(500);
    clipper::press_hotkey(&keys);
    clipper::wait_for_new_clip(&effective_clip_dir(app, settings), since, CLIP_WAIT)
}

/// Self-Clip läuft, solange es als Clip-Programm gewählt ist (wie Instant Replay).
fn sync_recorder(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let settings = state.settings.lock().unwrap().clone();
        if settings.clipper == settings::Clipper::SelfClip && recorder::ffmpeg_path(&app).is_some_and(|p| p.exists()) {
            let _ = state.recorder.start(&app, &settings.self_clip);
        } else {
            state.recorder.stop();
        }
        let _ = app.emit("selfclip-status", state.recorder.status(&app));
    });
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
            let path = save_clip_now(&app, &settings)?;
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
fn save_settings(app: AppHandle, state: State<AppState>, mut settings: Settings) -> Result<SettingsView, String> {
    // Die Kill-Clip-Einrichtung hat ihren eigenen Befehl und bleibt hier unberührt.
    {
        let current = state.settings.lock().unwrap();
        settings.kill_clip = current.kill_clip.clone();
        settings.self_clip = current.self_clip.clone();
    }
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
    let clipper_changed = state.settings.lock().unwrap().clipper != settings.clipper;
    *state.settings.lock().unwrap() = settings.clone();
    if clipper_changed {
        sync_recorder(&app);
    }
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

fn trims_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_cache_dir().map(|dir| dir.join("schnitte")).map_err(|e| e.to_string())
}

/// Schneidet und/oder komprimiert einen Clip; Fortschritt als Ereignis `convert-progress` (0–100).
#[tauri::command]
async fn convert_clip(
    app: AppHandle,
    path: String,
    start: Option<f64>,
    end: Option<f64>,
    duration: f64,
    quality: convert::Quality,
) -> Result<ClipInfo, String> {
    let out_dir = trims_dir(&app)?;
    let emitter = app.clone();
    let job = convert::Job { range: start.zip(end), duration, quality };
    let converted = tauri::async_runtime::spawn_blocking(move || {
        convert::convert(Path::new(&path), &out_dir, job, move |percent| {
            let _ = emitter.emit("convert-progress", percent);
        })
    })
    .await
    .map_err(|e| e.to_string())??;
    inspect(&converted)
}

/// Löscht einen zugeschnittenen Zwischenstand – aber nur aus dem eigenen Ordner.
#[tauri::command]
fn discard_trim(app: AppHandle, path: String) {
    if let Ok(dir) = trims_dir(&app) {
        let path = PathBuf::from(path);
        if path.parent() == Some(dir.as_path()) {
            let _ = std::fs::remove_file(path);
        }
    }
}

#[tauri::command]
async fn api_call(state: State<'_, AppState>, method: String, path: String, body: Option<Value>) -> Result<Value, String> {
    let result = api::call(&state.client, &method, &path, body).await;
    if result.as_ref().err().map(String::as_str) == Some(api::UNAUTHORIZED) {
        auth::delete_token();
    }
    result
}

/// Bild aus dem Dashboard als Data-URL (das Fenster selbst hat keinen Token).
#[tauri::command]
async fn api_image(state: State<'_, AppState>, path: String) -> Result<String, String> {
    use base64::Engine;
    let (bytes, content_type) = api::fetch(&state.client, &path, 25 * 1024 * 1024).await?;
    if !content_type.starts_with("image/") {
        return Err("Keine Bilddatei".into());
    }
    Ok(format!("data:{content_type};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// Lädt eine Datei (z. B. einen Clip) in den Cache und liefert den lokalen Pfad.
#[tauri::command]
async fn api_download(app: AppHandle, state: State<'_, AppState>, path: String, name: String) -> Result<String, String> {
    let safe: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')).collect();
    if safe.is_empty() || safe.starts_with('.') {
        return Err("Ungültiger Dateiname".into());
    }
    let dir = media_dir(&app)?;
    let target = dir.join(&safe);
    if target.exists() {
        return Ok(target.display().to_string());
    }
    let (bytes, _) = api::fetch(&state.client, &path, 20 * 1024 * 1024 * 1024).await?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let partial = dir.join(format!("{safe}.part"));
    std::fs::write(&partial, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&partial, &target).map_err(|e| e.to_string())?;
    Ok(target.display().to_string())
}

fn media_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_cache_dir().map(|dir| dir.join("medien")).map_err(|e| e.to_string())
}

#[tauri::command]
async fn duty_times(state: State<'_, AppState>) -> Result<Value, String> {
    api::duty_times(&state.client).await
}

#[tauri::command]
fn open_dashboard(app: AppHandle, path: Option<String>) -> Result<(), String> {
    let url = format!("{}{}", api::base_url(), path.unwrap_or_default());
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn cancel_upload(state: State<AppState>) {
    state.upload_cancel.lock().unwrap().store(true, Ordering::SeqCst);
}

// ── Self-Clip ────────────────────────────────────────────────────────

#[tauri::command]
fn selfclip_status(app: AppHandle, state: State<AppState>) -> recorder::Status {
    state.recorder.status(&app)
}

#[tauri::command]
async fn selfclip_install(app: AppHandle, state: State<'_, AppState>) -> Result<recorder::Status, String> {
    recorder::install(&app, &state.client).await?;
    sync_recorder(&app);
    Ok(state.recorder.status(&app))
}

#[tauri::command]
fn selfclip_save_config(app: AppHandle, state: State<AppState>, config: recorder::Config) -> Result<SettingsView, String> {
    let view = {
        let mut settings = state.settings.lock().unwrap();
        settings.self_clip = config;
        settings::save(&app, &settings)?;
        settings_view(&app, &settings)
    };
    // Neue Qualität/Pufferlänge gilt sofort.
    sync_recorder(&app);
    Ok(view)
}

#[tauri::command]
fn selfclip_restart(app: AppHandle) {
    sync_recorder(&app);
}

// ── Kill-Clips ───────────────────────────────────────────────────────

/// Taste für den Einrichtungs-Screenshot (nur aktiv, solange die Einrichtung offen ist).
const CALIBRATION_HOTKEY: &str = "Ctrl+Alt+K";

#[tauri::command]
fn killclip_status(state: State<AppState>) -> killclip::Status {
    state.kill_clips.status()
}

#[tauri::command]
async fn killclip_start(app: AppHandle, state: State<'_, AppState>) -> Result<killclip::Status, String> {
    state.kill_clips.start(app.clone()).await
}

#[tauri::command]
fn killclip_stop(app: AppHandle, state: State<AppState>) {
    state.kill_clips.stop(&app);
}

#[tauri::command]
fn killclip_save_config(app: AppHandle, state: State<AppState>, config: killclip::Config) -> Result<SettingsView, String> {
    let mut settings = state.settings.lock().unwrap();
    settings.kill_clip = config;
    settings::save(&app, &settings)?;
    Ok(settings_view(&app, &settings))
}

/// Einrichtung öffnen/schließen: solange offen, speichert Strg+Alt+K im Spiel das Replay mit dem Kill.
#[tauri::command]
fn killclip_calibration(app: AppHandle, state: State<AppState>, active: bool) -> Result<String, String> {
    let shortcuts = app.global_shortcut();
    let mut current = state.calibration_shortcut.lock().unwrap();
    if let Some(previous) = current.take() {
        let _ = shortcuts.unregister(previous);
    }
    if active {
        let shortcut: Shortcut = CALIBRATION_HOTKEY.parse().map_err(|_| "Ungültige Taste".to_string())?;
        shortcuts
            .register(shortcut)
            .map_err(|_| format!("„{CALIBRATION_HOTKEY}“ ist schon von einem anderen Programm belegt"))?;
        *current = Some(shortcut);
    }
    Ok(CALIBRATION_HOTKEY.into())
}

/// Einrichtungstaste im Spiel: Replay mit dem Kill speichern und im Einrichtungsfenster zeigen.
fn emit_reference_clip(app: &AppHandle) {
    let _ = app.emit("killclip-reference-clip", json!({ "saving": true }));
    let payload = match killclip::record_reference(app) {
        Ok((path, duration)) => json!({ "path": path.display().to_string(), "duration": duration }),
        Err(message) => json!({ "error": message }),
    };
    let _ = app.emit("killclip-reference-clip", payload);
}

#[tauri::command]
async fn killclip_saved_reference(app: AppHandle) -> Option<killclip::SavedReference> {
    tauri::async_runtime::spawn_blocking(move || killclip::saved_reference(&app)).await.ok().flatten()
}

#[tauri::command]
async fn killclip_analyze(app: AppHandle, path: String, at: f64) -> Result<killclip::reference::Reference, String> {
    let clip = PathBuf::from(path);
    if !clipper::is_video(&clip) || !clip.exists() {
        return Err("Clip nicht gefunden".into());
    }
    tauri::async_runtime::spawn_blocking(move || killclip::analyze_reference(&app, &clip, at)).await.map_err(|e| e.to_string())?
}

/// Ordner mit den fertigen Kill-Clips (bzw. die Datei darin) im Explorer zeigen.
#[tauri::command]
fn killclip_reveal(app: AppHandle, path: Option<String>) -> Result<(), String> {
    let dir = killclip::output_dir(&app);
    match path.map(PathBuf::from).filter(|p| p.starts_with(&dir) && p.exists()) {
        Some(file) => app.opener().reveal_item_in_dir(file).map_err(|e| e.to_string()),
        None => {
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            app.opener().open_path(dir.display().to_string(), None::<&str>).map_err(|e| e.to_string())
        }
    }
}

/// Nur Links zu Discord-Nachrichten öffnen.
#[tauri::command]
fn killclip_open_link(app: AppHandle, url: String) -> Result<(), String> {
    if !url.starts_with("https://discord.com/channels/") {
        return Err("Ungültiger Link".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// Links aus Ankündigungen im Browser öffnen – nur http(s), nie Dateien oder Programme.
#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Ungültiger Link".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
async fn killclip_test_marker(app: AppHandle) -> Result<f32, String> {
    tauri::async_runtime::spawn_blocking(move || killclip::test_marker(&app)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn killclip_test_feed(app: AppHandle, region: killclip::screen::Region) -> Result<killclip::FeedTest, String> {
    tauri::async_runtime::spawn_blocking(move || killclip::test_killfeed(&app, region))
        .await
        .map_err(|e| e.to_string())?
}

pub fn run() {
    // Administrator-Helfer der Tweaks (per UAC gestartet): ohne Fenster arbeiten und beenden.
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some(tweaks::elevate::HELPER_FLAG) {
        std::process::exit(tweaks::elevate::helper_main(&args[2..]));
    }
    tauri::Builder::default()
        // Nur eine Instanz: Ein zweiter Start holt das laufende Fenster nach vorne – sonst
        // würden zwei Kill-Erkennungen gleichzeitig laufen und doppelt posten.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main_window(app)))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let calibration = app
                        .try_state::<AppState>()
                        .is_some_and(|s| s.calibration_shortcut.lock().unwrap().is_some_and(|c| &c == shortcut));
                    if calibration {
                        let app = app.clone();
                        tauri::async_runtime::spawn_blocking(move || emit_reference_clip(&app));
                    } else {
                        run_capture(app.clone());
                    }
                })
                .build(),
        )
        .setup(|app| {
            let handle = app.handle().clone();
            // Zugeschnittene Zwischenstände vom letzten Lauf wegräumen.
            if let Ok(dir) = trims_dir(&handle) {
                let _ = std::fs::remove_dir_all(dir);
            }
            // Zwischengespeicherte Clips aus dem Dashboard ebenso.
            if let Ok(dir) = media_dir(&handle) {
                let _ = std::fs::remove_dir_all(dir);
            }
            let settings = settings::load(&handle);
            if let Err(error) = register_hotkey(&handle, &settings.bodycam_hotkey) {
                eprintln!("{error}");
            }
            let self_clip = settings.clipper == settings::Clipper::SelfClip;
            app.manage(AppState {
                client: api::client(),
                settings: Mutex::new(settings),
                login_generation: Arc::default(),
                upload_cancel: Mutex::new(Arc::default()),
                capturing: AtomicBool::new(false),
                tickets: Mutex::default(),
                kill_clips: killclip::KillClips::default(),
                recorder: recorder::Recorder::default(),
                tweaks: Arc::new(tweaks::Service::windows(
                    handle.path().app_config_dir().unwrap_or_else(|_| std::env::temp_dir()).join(tweaks::backup::BACKUP_FILE_NAME),
                )),
                calibration_shortcut: Mutex::default(),
            });

            if self_clip {
                sync_recorder(&handle);
            }

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
            convert_clip,
            discard_trim,
            duty_times,
            open_dashboard,
            api_call,
            api_image,
            api_download,
            selfclip_status,
            selfclip_install,
            selfclip_save_config,
            selfclip_restart,
            tweaks::commands::get_wasd_tweak_status,
            tweaks::commands::get_wasd_tweak_details,
            tweaks::commands::preview_wasd_changes,
            tweaks::commands::apply_wasd_tweak,
            tweaks::commands::restore_wasd_tweak,
            tweaks::commands::apply_tweak,
            tweaks::commands::restore_tweak,
            tweaks::commands::restore_all_tweaks,
            tweaks::commands::reset_tweak_to_default,
            tweaks::commands::get_input_devices,
            tweaks::commands::measure_polling_rate,
            killclip_status,
            killclip_start,
            killclip_stop,
            killclip_save_config,
            killclip_calibration,
            killclip_analyze,
            killclip_saved_reference,
            killclip_reveal,
            killclip_open_link,
            open_external,
            killclip_test_feed,
            killclip_test_marker,
        ])
        .run(tauri::generate_context!())
        .expect("FIB Desktop konnte nicht gestartet werden");
}

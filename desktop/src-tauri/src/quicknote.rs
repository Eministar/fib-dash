//! Schnellnotiz: Eine eigene Taste öffnet ein kleines Fenster über allem – auch über
//! dem Spiel. Gespeichert wird eine persönliche Notiz (`/api/desktop/notes`); danach
//! bekommt das Fenster, das vorher vorne war (meist FiveM), den Fokus zurück.
//!
//! Das Fenster wird beim Schließen zerstört statt versteckt: Ein verstecktes Fenster
//! hielte dauerhaft einen weiteren WebView2-Prozess (~30–60 MB) am Leben.

use std::sync::Mutex;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use windows::Win32::{
    Foundation::HWND,
    UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow},
};

pub const LABEL: &str = "quick-note";

/// Fenster, das vor der Schnellnotiz vorne war – bekommt den Fokus zurück.
static PREVIOUS: Mutex<Option<isize>> = Mutex::new(None);

/// Vordergrundfenster merken, sofern es nicht zur App selbst gehört.
fn remember_foreground() {
    unsafe {
        let window = GetForegroundWindow();
        let mut pid = 0u32;
        GetWindowThreadProcessId(window, Some(&mut pid));
        if !window.is_invalid() && pid != std::process::id() {
            *PREVIOUS.lock().unwrap_or_else(|e| e.into_inner()) = Some(window.0 as isize);
        }
    }
}

/// Öffnet das Fenster (oder holt es nach vorne). Muss außerhalb des Hauptthreads laufen:
/// Fenster aus einem Ereignis-Handler heraus zu bauen, kann unter Windows hängen bleiben.
pub fn open(app: &AppHandle) -> Result<(), String> {
    remember_foreground();
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        return window.set_focus().map_err(|e| e.to_string());
    }
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("quicknote.html".into()))
        .title("Schnellnotiz")
        .inner_size(460.0, 300.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .center()
        .focused(true)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Schließt das Fenster und gibt den Fokus an das vorherige Fenster zurück.
pub fn close(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.destroy();
    }
    if let Some(previous) = PREVIOUS.lock().unwrap_or_else(|e| e.into_inner()).take() {
        unsafe {
            let _ = SetForegroundWindow(HWND(previous as *mut _));
        }
    }
}

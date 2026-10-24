use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Clipper {
    Nvidia,
    Medal,
    /// AMD Software: Adrenalin Edition (Instant Replay).
    Amd,
    /// Eigene Hintergrundaufnahme der App (FIB Self-Clip).
    #[serde(rename = "selfclip")]
    SelfClip,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub clipper: Clipper,
    /// Eigene Taste der App: löst den Clip im Programm aus und öffnet den Upload.
    pub bodycam_hotkey: String,
    /// Speichertaste im Clip-Programm; leer = Standard des Programms.
    pub clipper_hotkey: String,
    /// Ablageordner der Clips; leer = Standard des Programms.
    pub clip_dir: String,
    pub last_investigation_id: Option<String>,
    /// Komprimierung vor dem Upload: "720p", "1080p" oder "original" (nur schneiden).
    pub clip_quality: String,
    pub kill_clip: crate::killclip::Config,
    pub self_clip: crate::recorder::Config,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            clipper: Clipper::Nvidia,
            bodycam_hotkey: "Ctrl+Shift+B".into(),
            clipper_hotkey: String::new(),
            clip_dir: String::new(),
            last_investigation_id: None,
            clip_quality: "720p".into(),
            kill_clip: crate::killclip::Config::default(),
            self_clip: crate::recorder::Config::default(),
        }
    }
}

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("settings.json"))
}

pub fn load(app: &AppHandle) -> Settings {
    settings_path(app)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app).ok_or("Einstellungsordner nicht gefunden")?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

//! Sicherung der Originalwerte. Eine JSON-Datei im Datenordner der App,
//! versioniert und atomar geschrieben (erst `.tmp`, dann umbenennen).
//!
//! Regeln:
//! - Der Originalwert wird nur beim ersten Ändern gesichert; erneutes Aktivieren
//!   überschreibt ihn nie.
//! - „Wert fehlte“ wird als `Missing` gesichert und beim Wiederherstellen wieder gelöscht.
//! - `applied` hält fest, was die App gesetzt hat – so fallen spätere Änderungen
//!   durch andere Programme auf.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::model::{TweakError, TweakId, TweakResult};
use super::platform::{FilterKeys, Hive, RegValue};

pub const BACKUP_VERSION: u32 = 1;
pub const BACKUP_FILE_NAME: &str = "tweaks-backup.json";

/// Was verändert wird – nur feste, im Backend bekannte Ziele.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Target {
    Registry { hive: Hive, path: String, name: String },
    Mouse,
    KeyboardSpeed,
    KeyboardDelay,
    FilterKeys,
}

impl Target {
    pub fn key(&self) -> String {
        match self {
            Target::Registry { hive, path, name } => format!("reg:{}\\{path}\\{name}", hive.label()),
            Target::Mouse => "api:SPI_SETMOUSE".into(),
            Target::KeyboardSpeed => "api:SPI_SETKEYBOARDSPEED".into(),
            Target::KeyboardDelay => "api:SPI_SETKEYBOARDDELAY".into(),
            Target::FilterKeys => "api:SPI_SETFILTERKEYS".into(),
        }
    }

    pub fn label(&self) -> String {
        match self {
            Target::Registry { hive, path, name } => format!("{}\\{path} → {name}", hive.label()),
            Target::Mouse => "Mausparameter (SPI_SETMOUSE)".into(),
            Target::KeyboardSpeed => "Wiederholrate (SPI_SETKEYBOARDSPEED)".into(),
            Target::KeyboardDelay => "Wiederholverzögerung (SPI_SETKEYBOARDDELAY)".into(),
            Target::FilterKeys => "FilterKeys (SPI_SETFILTERKEYS)".into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
pub enum Value {
    /// Registry-Wert existierte nicht.
    Missing,
    Reg(RegValue),
    Mouse([i32; 3]),
    Number(u32),
    FilterKeys(FilterKeys),
}

impl Value {
    pub fn same(&self, other: &Value) -> bool {
        match (self, other) {
            (Value::Reg(a), Value::Reg(b)) => a.same(b),
            _ => self == other,
        }
    }

    pub fn display(&self) -> String {
        match self {
            Value::Missing => "nicht gesetzt".into(),
            Value::Reg(value) => value.display(),
            Value::Mouse([t1, t2, accel]) => format!("Schwellen {t1}/{t2}, Beschleunigung {}", if *accel == 0 { "aus" } else { "an" }),
            Value::Number(value) => value.to_string(),
            Value::FilterKeys(keys) => format!(
                "{}{} (Warten {} ms, Prellen {} ms)",
                if keys.flags & super::platform::FKF_FILTERKEYSON != 0 { "an" } else { "aus" },
                if keys.flags & super::platform::FKF_HOTKEYACTIVE != 0 { ", Tastenkürzel aktiv" } else { "" },
                keys.wait_ms,
                keys.bounce_ms,
            ),
        }
    }
}

/// Womit die App den Wert gesetzt hat.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    /// Der Tweak selbst.
    #[default]
    Tweak,
    /// „Windows-Standard herstellen“ (z. B. um regelkonform zu werden).
    WindowsDefault,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub tweak: TweakId,
    pub key: String,
    pub target: Target,
    /// Zustand vor der ersten Änderung durch die App.
    pub original: Value,
    /// Was die App zuletzt gesetzt hat.
    pub applied: Value,
    /// Ältere Sicherungen kennen das Feld nicht – dann war es der Tweak.
    #[serde(default)]
    pub mode: Mode,
    pub created_at: String,
    pub created_at_ms: u64,
    pub app_version: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub tweak: TweakId,
    pub key: String,
    pub message: String,
    pub at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile {
    pub version: u32,
    pub entries: Vec<Entry>,
    /// Gescheiterte Wiederherstellungen – bleiben sichtbar, bis es klappt.
    #[serde(default)]
    pub failures: Vec<Failure>,
}

impl Default for BackupFile {
    fn default() -> Self {
        Self { version: BACKUP_VERSION, entries: Vec::new(), failures: Vec::new() }
    }
}

impl BackupFile {
    #[cfg(test)]
    pub fn entry(&self, key: &str) -> Option<&Entry> {
        self.entries.iter().find(|e| e.key == key)
    }

    pub fn entries_for(&self, tweak: TweakId) -> Vec<Entry> {
        self.entries.iter().filter(|e| e.tweak == tweak).cloned().collect()
    }

    /// Prüft die geladene Datei auf Widersprüche.
    pub fn validate(&self) -> TweakResult<()> {
        if self.version != BACKUP_VERSION {
            return Err(TweakError::backup(format!(
                "Die Sicherung hat das Format {} – diese App-Version kennt nur {BACKUP_VERSION}.",
                self.version
            )));
        }
        let mut keys = std::collections::HashSet::new();
        for entry in &self.entries {
            if !keys.insert(entry.key.as_str()) {
                return Err(TweakError::backup(format!("Die Sicherung enthält „{}“ doppelt.", entry.key)));
            }
            if entry.key != entry.target.key() {
                return Err(TweakError::backup(format!("Die Sicherung ist widersprüchlich („{}“).", entry.key)));
            }
            let type_fits = matches!(
                (&entry.target, &entry.original),
                (Target::Registry { .. }, Value::Reg(_) | Value::Missing)
                    | (Target::Mouse, Value::Mouse(_))
                    | (Target::KeyboardSpeed | Target::KeyboardDelay, Value::Number(_))
                    | (Target::FilterKeys, Value::FilterKeys(_))
            );
            if !type_fits {
                return Err(TweakError::backup(format!("Der gesicherte Wert für „{}“ passt nicht zum Ziel.", entry.key)));
            }
        }
        Ok(())
    }
}

/// Speicherort und Lese-/Schreiblogik der Sicherung.
#[derive(Clone, Debug)]
pub struct BackupStore {
    path: PathBuf,
}

impl BackupStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// Fehlende Datei = leere Sicherung. Kaputte Datei = Fehler (nie stillschweigend überschreiben).
    pub fn load(&self) -> TweakResult<BackupFile> {
        let raw = match std::fs::read_to_string(&self.path) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(BackupFile::default()),
            Err(error) => return Err(TweakError::backup(format!("Sicherung nicht lesbar: {error}"))),
        };
        let file: BackupFile = serde_json::from_str(&raw)
            .map_err(|error| TweakError::backup(format!("Die Sicherung ist beschädigt ({error}). Sie wird nicht überschrieben: {}", self.path.display())))?;
        file.validate()?;
        Ok(file)
    }

    pub fn save(&self, file: &BackupFile) -> TweakResult<()> {
        file.validate()?;
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| TweakError::backup(format!("Ordner für die Sicherung: {e}")))?;
        }
        let raw = serde_json::to_string_pretty(file).map_err(|e| TweakError::backup(e.to_string()))?;
        let temp = self.path.with_extension("json.tmp");
        {
            use std::io::Write;
            let mut out = std::fs::File::create(&temp).map_err(|e| TweakError::backup(format!("Sicherung schreiben: {e}")))?;
            out.write_all(raw.as_bytes()).map_err(|e| TweakError::backup(format!("Sicherung schreiben: {e}")))?;
            out.sync_all().map_err(|e| TweakError::backup(format!("Sicherung schreiben: {e}")))?;
        }
        // Unter Windows ersetzt `rename` die bestehende Datei (MOVEFILE_REPLACE_EXISTING).
        std::fs::rename(&temp, &self.path).map_err(|e| TweakError::backup(format!("Sicherung ablegen: {e}")))
    }
}

pub fn now_stamp() -> (String, u64) {
    let now = chrono::Utc::now();
    (now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true), now.timestamp_millis().max(0) as u64)
}

//! Abstraktion der Windows-Schnittstellen, die die Tweaks verändern. Die echte
//! Umsetzung steht in `windows_impl.rs`; Tests nutzen Attrappen im Speicher und
//! fassen so nie die Einstellungen des Rechners an.

use serde::{Deserialize, Serialize};

use super::model::TweakResult;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Hive {
    #[serde(rename = "HKCU")]
    CurrentUser,
    #[serde(rename = "HKLM")]
    LocalMachine,
}

impl Hive {
    pub fn label(self) -> &'static str {
        match self {
            Hive::CurrentUser => "HKEY_CURRENT_USER",
            Hive::LocalMachine => "HKEY_LOCAL_MACHINE",
        }
    }
}

pub const REG_SZ: u32 = 1;
pub const REG_EXPAND_SZ: u32 = 2;
pub const REG_DWORD: u32 = 4;

/// Registry-Wert mit Originaltyp und Rohdaten – so lässt er sich exakt zurückschreiben.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RegValue {
    pub kind: u32,
    pub data: Vec<u8>,
}

impl RegValue {
    pub fn sz(text: &str) -> Self {
        let data = text.encode_utf16().chain(std::iter::once(0)).flat_map(u16::to_le_bytes).collect();
        Self { kind: REG_SZ, data }
    }

    #[cfg(test)]
    pub fn dword(value: u32) -> Self {
        Self { kind: REG_DWORD, data: value.to_le_bytes().to_vec() }
    }

    pub fn as_text(&self) -> Option<String> {
        if self.kind != REG_SZ && self.kind != REG_EXPAND_SZ {
            return None;
        }
        let wide: Vec<u16> = self.data.as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes(*c)).collect();
        Some(String::from_utf16_lossy(&wide).trim_end_matches('\0').to_string())
    }

    pub fn as_dword(&self) -> Option<u32> {
        (self.kind == REG_DWORD && self.data.len() >= 4).then(|| u32::from_le_bytes(self.data[..4].try_into().unwrap()))
    }

    /// Gleichwertig? Zeichenfolgen ohne Rücksicht auf abschließende Nullen.
    pub fn same(&self, other: &RegValue) -> bool {
        match (self.as_text(), other.as_text()) {
            (Some(a), Some(b)) => self.kind == other.kind && a == b,
            _ => self == other,
        }
    }

    pub fn display(&self) -> String {
        if let Some(text) = self.as_text() {
            return format!("\"{text}\"");
        }
        if let Some(value) = self.as_dword() {
            return value.to_string();
        }
        format!("{} Byte (Typ {})", self.data.len(), self.kind)
    }
}

/// FILTERKEYS ohne `cbSize` – vollständig, damit nichts verloren geht.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterKeys {
    pub flags: u32,
    pub wait_ms: u32,
    pub delay_ms: u32,
    pub repeat_ms: u32,
    pub bounce_ms: u32,
}

pub const FKF_FILTERKEYSON: u32 = 0x0000_0001;
#[cfg(test)]
pub const FKF_AVAILABLE: u32 = 0x0000_0002;
pub const FKF_HOTKEYACTIVE: u32 = 0x0000_0004;

pub trait Registry: Send + Sync {
    fn key_exists(&self, hive: Hive, path: &str) -> TweakResult<bool>;
    /// `None` = Wert fehlt.
    fn read(&self, hive: Hive, path: &str, name: &str) -> TweakResult<Option<RegValue>>;
    fn write(&self, hive: Hive, path: &str, name: &str, value: &RegValue) -> TweakResult<()>;
    /// Fehlt der Wert schon, ist das kein Fehler.
    fn delete(&self, hive: Hive, path: &str, name: &str) -> TweakResult<()>;
}

/// Die über SystemParametersInfo verwalteten Benutzereinstellungen.
pub trait SystemParams: Send + Sync {
    /// [Schwelle 1, Schwelle 2, Beschleunigung] wie bei SPI_GETMOUSE.
    fn mouse(&self) -> TweakResult<[i32; 3]>;
    /// `persist`: auch ins Benutzerprofil schreiben (Windows legt die Werte dann als REG_SZ ab).
    /// Ohne nur für die laufende Sitzung – die Registry stellt die App dann selbst exakt her.
    fn set_mouse(&self, value: [i32; 3], persist: bool) -> TweakResult<()>;
    /// Zeigergeschwindigkeit 1–20 (wird nur angezeigt, nie verändert).
    fn mouse_speed(&self) -> TweakResult<u32>;
    fn keyboard_speed(&self) -> TweakResult<u32>;
    fn set_keyboard_speed(&self, value: u32, persist: bool) -> TweakResult<()>;
    fn keyboard_delay(&self) -> TweakResult<u32>;
    fn set_keyboard_delay(&self, value: u32, persist: bool) -> TweakResult<()>;
    fn filter_keys(&self) -> TweakResult<FilterKeys>;
    fn set_filter_keys(&self, value: FilterKeys) -> TweakResult<()>;
}

//! Minimaler Helfer für Einstellungen, die Administratorrechte brauchen (MMCSS).
//!
//! Die App startet sich selbst über „Als Administrator ausführen“ (UAC) mit
//! `--fib-tweak-helper <apply|restore> <id> <backup> <ergebnis> <force>`. Der Helfer
//! öffnet kein Fenster, akzeptiert nur feste Aktionen und Tweak-IDs, die wirklich
//! Adminrechte brauchen, und schreibt sein Ergebnis als JSON in eine Temp-Datei.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value as Json;

use super::backup::{BackupStore, BACKUP_FILE_NAME};
use super::engine::Engine;
use super::model::{meta, ErrorCode, TweakError, TweakId, TweakResult};
use super::windows_impl::{boot_ms, is_admin, WinRegistry, WinSystemParams};

pub const HELPER_FLAG: &str = "--fib-tweak-helper";
const RESULT_PREFIX: &str = "fib-tweak-";
const ERROR_CANCELLED: i32 = 1223;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Apply,
    Restore,
}

impl Action {
    fn as_str(self) -> &'static str {
        match self {
            Action::Apply => "apply",
            Action::Restore => "restore",
        }
    }
}

#[derive(Serialize, Deserialize)]
struct Outcome {
    ok: Option<Json>,
    error: Option<TweakError>,
}

#[derive(Debug, PartialEq)]
pub struct HelperArgs {
    pub action: Action,
    pub id: TweakId,
    pub backup: PathBuf,
    pub result: PathBuf,
    pub force: bool,
}

/// Prüft die Kommandozeile des Helfers streng – alles Unerwartete wird abgelehnt.
pub fn parse_args(args: &[String]) -> Result<HelperArgs, String> {
    let [action, id, backup, result, force] = args else {
        return Err("Falsche Anzahl Argumente".into());
    };
    let action = match action.as_str() {
        "apply" => Action::Apply,
        "restore" => Action::Restore,
        _ => return Err("Unbekannte Aktion".into()),
    };
    let id = TweakId::parse(id).ok_or("Unbekannter Tweak")?;
    if !meta(id).needs_admin {
        return Err("Dieser Tweak braucht keinen Helfer".into());
    }
    let backup = PathBuf::from(backup);
    if !backup.is_absolute() || backup.file_name().and_then(|n| n.to_str()) != Some(BACKUP_FILE_NAME) {
        return Err("Ungültiger Pfad der Sicherung".into());
    }
    let result = PathBuf::from(result);
    let in_temp = result.parent().is_some_and(|dir| same_dir(dir, &std::env::temp_dir()));
    let named = result.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with(RESULT_PREFIX) && n.ends_with(".json"));
    if !in_temp || !named {
        return Err("Ungültiger Ergebnispfad".into());
    }
    let force = match force.as_str() {
        "true" => true,
        "false" => false,
        _ => return Err("Ungültiger Schalter".into()),
    };
    Ok(HelperArgs { action, id, backup, result, force })
}

fn same_dir(a: &Path, b: &Path) -> bool {
    let normalize = |p: &Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    normalize(a) == normalize(b)
}

/// Einstieg des Helfers (aus `run()` vor dem Start der Oberfläche). Rückgabe = Exit-Code.
pub fn helper_main(args: &[String]) -> i32 {
    let parsed = match parse_args(args) {
        Ok(parsed) => parsed,
        Err(_) => return 2,
    };
    let engine = Engine {
        reg: &WinRegistry,
        sys: &WinSystemParams,
        admin: is_admin(),
        store: BackupStore::new(parsed.backup.clone()),
        app_version: env!("CARGO_PKG_VERSION").into(),
        boot_ms: boot_ms(),
    };
    let outcome = match parsed.action {
        Action::Apply => engine.apply(parsed.id).map(|r| serde_json::to_value(r).unwrap_or(Json::Null)),
        Action::Restore => engine.restore(parsed.id, parsed.force).map(|r| serde_json::to_value(r).unwrap_or(Json::Null)),
    };
    let outcome = match outcome {
        Ok(value) => Outcome { ok: Some(value), error: None },
        Err(error) => Outcome { ok: None, error: Some(error) },
    };
    let written = serde_json::to_string(&outcome).ok().and_then(|raw| std::fs::write(&parsed.result, raw).ok());
    if written.is_some() { 0 } else { 3 }
}

/// Startet den Helfer mit UAC-Abfrage und wartet auf sein Ergebnis.
pub fn run_elevated(action: Action, id: TweakId, backup: &Path, force: bool) -> TweakResult<Json> {
    use windows::{
        core::{HSTRING, PCWSTR},
        Win32::{
            Foundation::CloseHandle,
            System::Threading::{GetExitCodeProcess, WaitForSingleObject},
            UI::{
                Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SEE_MASK_NO_CONSOLE, SHELLEXECUTEINFOW},
                WindowsAndMessaging::SW_HIDE,
            },
        },
    };

    let exe = std::env::current_exe().map_err(|e| TweakError::os(e.to_string()))?;
    let stamp = chrono::Utc::now().timestamp_millis();
    let result = std::env::temp_dir().join(format!("{RESULT_PREFIX}{}-{stamp}.json", std::process::id()));
    let params = format!(
        "{HELPER_FLAG} {} {} \"{}\" \"{}\" {force}",
        action.as_str(),
        id.as_str(),
        backup.display(),
        result.display()
    );
    let verb = HSTRING::from("runas");
    let file = HSTRING::from(exe.as_os_str());
    let parameters = HSTRING::from(params);
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NO_CONSOLE,
        lpVerb: PCWSTR(verb.as_ptr()),
        lpFile: PCWSTR(file.as_ptr()),
        lpParameters: PCWSTR(parameters.as_ptr()),
        nShow: SW_HIDE.0,
        ..Default::default()
    };
    unsafe {
        if let Err(error) = ShellExecuteExW(&mut info) {
            if error.code().0 & 0xFFFF == ERROR_CANCELLED {
                return Err(TweakError::new(ErrorCode::ElevationDenied, "Die Administrator-Abfrage wurde abgelehnt – es wurde nichts geändert."));
            }
            return Err(TweakError::os(format!("Administrator-Helfer startet nicht: {}", error.message())));
        }
        WaitForSingleObject(info.hProcess, 120_000);
        let mut code = 0u32;
        let _ = GetExitCodeProcess(info.hProcess, &mut code);
        let _ = CloseHandle(info.hProcess);
        let raw = std::fs::read_to_string(&result).map_err(|_| TweakError::os(format!("Der Administrator-Helfer hat kein Ergebnis geliefert (Code {code}).")))?;
        let _ = std::fs::remove_file(&result);
        let outcome: Outcome = serde_json::from_str(&raw).map_err(|e| TweakError::os(format!("Ergebnis des Helfers unlesbar: {e}")))?;
        match outcome {
            Outcome { error: Some(error), .. } => Err(error),
            Outcome { ok: Some(value), .. } => Ok(value),
            _ => Err(TweakError::os("Leeres Ergebnis des Helfers")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn accepts_only_known_admin_tweaks_and_safe_paths() {
        let temp = std::env::temp_dir();
        let result = temp.join("fib-tweak-1-2.json").display().to_string();
        let backup = r"C:\Users\x\AppData\Roaming\de.fib.desktop\tweaks-backup.json";
        let ok = parse_args(&args(&["apply", "mmcss_games", backup, &result, "false"])).unwrap();
        assert_eq!((ok.action, ok.id, ok.force), (Action::Apply, TweakId::MmcssGames, false));

        // Benutzer-Tweaks brauchen keinen Helfer.
        assert!(parse_args(&args(&["apply", "mouse_acceleration", backup, &result, "false"])).is_err());
        // Unbekanntes, falsche Pfade, fremde Dateien.
        assert!(parse_args(&args(&["delete", "mmcss_games", backup, &result, "false"])).is_err());
        assert!(parse_args(&args(&["apply", "mmcss_games", r"C:\Windows\System32\config\SAM", &result, "false"])).is_err());
        assert!(parse_args(&args(&["apply", "mmcss_games", backup, r"C:\Windows\fib-tweak-x.json", "false"])).is_err());
        assert!(parse_args(&args(&["apply", "mmcss_games", backup, &result, "ja"])).is_err());
        assert!(parse_args(&args(&["apply", "mmcss_games", backup])).is_err());
    }
}

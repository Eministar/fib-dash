//! Absturzberichte: Fällt die App aus, erfährt das Dashboard davon – bevor sich
//! jemand meldet. Gemeldet wird anonym (Version, letzte Aktion, Fehlertext; keine
//! Namen oder IDs, Benutzerpfade unkenntlich) an `/api/runtime-events`, das die
//! Meldung mit Ratenbegrenzung in den Discord-Webhook weiterreicht.
//!
//! * Rust-Panic: Der Hook schreibt Text und Ort in `absturz.txt` (danach bricht die
//!   App ab, `panic = "abort"`); gesendet wird beim nächsten Start.
//! * Harter Absturz (Zugriffsverletzung, Task-Manager): Eine Laufzeitmarke, die nur
//!   beim sauberen Beenden verschwindet. Liegt sie beim Start noch da, war der letzte
//!   Lauf nicht sauber – außer Windows wurde inzwischen neu gestartet (Herunterfahren).
//! * Fehler im Fenster (JavaScript) meldet das Fenster über `report_error`.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU32, Ordering},
        Mutex, OnceLock,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::json;

const MARKER: &str = "laeuft.json";
const PANIC: &str = "absturz.txt";
/// So viele Fenster-Fehler höchstens pro Lauf – eine Fehlerschleife flutet sonst den Webhook.
const MAX_WINDOW_REPORTS: u32 = 5;

static DIR: OnceLock<PathBuf> = OnceLock::new();
static LAST_ACTION: Mutex<String> = Mutex::new(String::new());
static WINDOW_REPORTS: AtomicU32 = AtomicU32::new(0);
static REPORTED: Mutex<Vec<String>> = Mutex::new(Vec::new());

#[derive(Serialize, Deserialize)]
struct Marker {
    version: String,
    /// Startzeit von Windows (Sekunden seit 1970) – anders = inzwischen neu gestartet.
    boot: u64,
    action: String,
}

/// Was vom letzten Lauf zu melden ist.
#[derive(Debug, PartialEq)]
pub struct Report {
    pub title: String,
    pub message: String,
    pub action: String,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn boot_time() -> u64 {
    let uptime = unsafe { windows::Win32::System::SystemInformation::GetTickCount64() } / 1000;
    now_secs().saturating_sub(uptime)
}

fn write_marker(dir: &Path, action: &str) {
    let marker = Marker { version: env!("CARGO_PKG_VERSION").into(), boot: boot_time(), action: action.into() };
    if let Ok(raw) = serde_json::to_string(&marker) {
        let _ = fs::write(dir.join(MARKER), raw);
    }
}

/// Liest, was der letzte Lauf hinterlassen hat. Reine Logik, damit sie testbar bleibt.
fn evaluate(marker: Option<&str>, panic: Option<&str>, boot_now: u64) -> Option<Report> {
    let marker: Option<Marker> = marker.and_then(|raw| serde_json::from_str(raw).ok());
    let version = marker.as_ref().map(|m| m.version.clone()).unwrap_or_else(|| env!("CARGO_PKG_VERSION").into());
    let action = marker.as_ref().map(|m| m.action.clone()).unwrap_or_default();
    if let Some(text) = panic.filter(|t| !t.trim().is_empty()) {
        return Some(Report { title: format!("FIB Desktop {version}: Absturz"), message: text.trim().to_string(), action });
    }
    let marker = marker?;
    // Startzeiten schwanken um Sekunden (Uhr-Abgleich) – erst ab zwei Minuten ist es ein Neustart.
    if marker.boot.abs_diff(boot_now) > 120 {
        return None;
    }
    Some(Report {
        title: format!("FIB Desktop {version}: unerwartet beendet"),
        message: "Die App wurde ohne sauberes Beenden geschlossen (Absturz oder im Task-Manager beendet).".into(),
        action,
    })
}

/// Beim Start: Bericht vom letzten Lauf einsammeln, neue Laufzeitmarke setzen, Panic-Hook anmelden.
pub fn install(dir: PathBuf) -> Option<Report> {
    let _ = fs::create_dir_all(&dir);
    let marker = fs::read_to_string(dir.join(MARKER)).ok();
    let panic = fs::read_to_string(dir.join(PANIC)).ok();
    let report = evaluate(marker.as_deref(), panic.as_deref(), boot_time());
    let _ = fs::remove_file(dir.join(PANIC));
    write_marker(&dir, "Start");

    let hook_dir = dir.clone();
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // try_lock: Ein Panic beim Halten der Sperre darf hier nicht hängen bleiben.
        let action = LAST_ACTION.try_lock().map(|a| a.clone()).unwrap_or_default();
        let _ = fs::write(hook_dir.join(PANIC), format!("{info}\nLetzte Aktion: {action}"));
        default_hook(info);
    }));
    let _ = DIR.set(dir);
    report
}

/// Merkt sich, was der Nutzer zuletzt getan hat (Seite, Werkzeug) – steht im Bericht.
pub fn note_action(action: &str) {
    let action: String = action.chars().take(120).collect();
    *LAST_ACTION.lock().unwrap_or_else(|e| e.into_inner()) = action.clone();
    if let Some(dir) = DIR.get() {
        write_marker(dir, &action);
    }
}

pub fn last_action() -> String {
    LAST_ACTION.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/// Sauberes Ende (Beenden im Tray, Update-Neustart): keine Meldung beim nächsten Start.
pub fn clean_exit() {
    if let Some(dir) = DIR.get() {
        let _ = fs::remove_file(dir.join(MARKER));
    }
}

/// Benutzerpfade und -namen unkenntlich machen.
fn anonymize(text: &str) -> String {
    let mut out = text.to_string();
    for (var, placeholder) in [("USERPROFILE", "%USERPROFILE%"), ("USERNAME", "%USERNAME%"), ("COMPUTERNAME", "%COMPUTERNAME%")] {
        if let Ok(value) = std::env::var(var) {
            if value.len() >= 3 {
                out = replace_ignore_case(&out, &value, placeholder);
            }
        }
    }
    out
}

fn replace_ignore_case(haystack: &str, needle: &str, replacement: &str) -> String {
    let lower = haystack.to_lowercase();
    let needle_lower = needle.to_lowercase();
    // Nur wenn Kleinschreibung die Längen nicht verändert (sonst passen die Indizes nicht).
    if lower.len() != haystack.len() || needle_lower.is_empty() {
        return haystack.replace(needle, replacement);
    }
    let mut out = String::with_capacity(haystack.len());
    let mut rest = 0;
    while let Some(found) = lower[rest..].find(&needle_lower) {
        out.push_str(&haystack[rest..rest + found]);
        out.push_str(replacement);
        rest += found + needle_lower.len();
    }
    out.push_str(&haystack[rest..]);
    out
}

fn clip(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

pub async fn send(client: &reqwest::Client, title: &str, message: &str, action: &str, stack: Option<&str>) {
    let body = json!({
        "title": clip(&anonymize(title), 120),
        "message": clip(&anonymize(message), 1200),
        "path": clip(&format!("Desktop · {}", if action.is_empty() { "–" } else { action }), 300),
        "stack": stack.map(|s| clip(&anonymize(s), 2000)),
    });
    let _ = client
        .post(format!("{}/api/runtime-events", crate::api::base_url()))
        .timeout(Duration::from_secs(15))
        .json(&body)
        .send()
        .await;
}

/// Fehler aus dem Fenster melden – pro Lauf begrenzt und ohne Wiederholungen.
pub fn accept_window_report(message: &str) -> bool {
    let mut reported = REPORTED.lock().unwrap_or_else(|e| e.into_inner());
    if reported.iter().any(|m| m == message) || WINDOW_REPORTS.fetch_add(1, Ordering::SeqCst) >= MAX_WINDOW_REPORTS {
        return false;
    }
    reported.push(message.to_string());
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn marker(boot: u64) -> String {
        serde_json::to_string(&Marker { version: "1.2.3".into(), boot, action: "Kill-Clips".into() }).unwrap()
    }

    #[test]
    fn clean_run_reports_nothing() {
        assert_eq!(evaluate(None, None, 1000), None);
    }

    #[test]
    fn leftover_marker_in_the_same_windows_session_is_a_crash() {
        let report = evaluate(Some(&marker(1000)), None, 1030).unwrap();
        assert_eq!(report.title, "FIB Desktop 1.2.3: unerwartet beendet");
        assert_eq!(report.action, "Kill-Clips");
    }

    #[test]
    fn leftover_marker_after_a_reboot_is_a_shutdown() {
        assert_eq!(evaluate(Some(&marker(1000)), None, 50_000), None);
    }

    #[test]
    fn panic_text_wins_and_keeps_the_last_action() {
        let report = evaluate(Some(&marker(1000)), Some("panicked at src/x.rs:1:1:\nboom"), 1000).unwrap();
        assert_eq!(report.title, "FIB Desktop 1.2.3: Absturz");
        assert!(report.message.contains("boom"));
        assert_eq!(report.action, "Kill-Clips");
    }

    #[test]
    fn user_paths_are_hidden() {
        assert_eq!(replace_ignore_case(r"C:\Users\Benou\x.txt", r"c:\users\benou", "%USERPROFILE%"), r"%USERPROFILE%\x.txt");
    }

    #[test]
    fn window_reports_are_limited_and_deduplicated() {
        assert!(accept_window_report("a"));
        assert!(!accept_window_report("a"));
        for i in 0..10 {
            accept_window_report(&format!("b{i}"));
        }
        assert!(!accept_window_report("neu"));
    }
}

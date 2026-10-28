//! Auslösen und Wiederfinden von Clips aus NVIDIA, AMD (Instant Replay) und Medal.

use std::{
    fs,
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant, SystemTime},
};

use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, MapVirtualKeyW, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
    MAPVK_VK_TO_VSC,
};
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

use crate::settings::Clipper;

const VIDEO_EXTENSIONS: [&str; 4] = ["mp4", "mkv", "mov", "webm"];
const NVIDIA_KEY: &str = r"Software\NVIDIA Corporation\Global\ShadowPlay\NVSPCAPS";
const AMD_KEY: &str = r"Software\AMD\DVR";

const VK_SHIFT: u16 = 0x10;
const VK_CONTROL: u16 = 0x11;
const VK_MENU: u16 = 0x12;
const VK_LWIN: u16 = 0x5B;
const VK_RWIN: u16 = 0x5C;

// ── Standardwerte der Programme ──────────────────────────────────────

fn nvidia_reg() -> Option<RegKey> {
    RegKey::predef(HKEY_CURRENT_USER).open_subkey(NVIDIA_KEY).ok()
}

fn nvidia_binary(name: &str) -> Option<Vec<u8>> {
    nvidia_reg()?.get_raw_value(name).ok().map(|value| value.bytes.into_owned())
}

/// NVIDIA legt den Speicherort als UTF-16 in `DefaultPathW` ab.
fn nvidia_clip_dir() -> Option<PathBuf> {
    let bytes = nvidia_binary("DefaultPathW")?;
    let wide: Vec<u16> = bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
    let path = String::from_utf16_lossy(&wide).trim_end_matches('\0').to_string();
    (!path.is_empty()).then(|| PathBuf::from(path))
}

/// „Instant Replay speichern" steht als Folge von Tastencodes in `DVRHKey0…n`.
fn nvidia_save_hotkey() -> Option<String> {
    let count = u32::from_le_bytes(nvidia_binary("DVRHKeyCount")?.get(..4)?.try_into().ok()?);
    let keys: Option<Vec<u16>> = (0..count)
        .map(|i| nvidia_binary(&format!("DVRHKey{i}")).and_then(|b| b.first().map(|&vk| vk as u16)))
        .collect();
    let names: Vec<String> = keys?.into_iter().filter_map(vk_name).collect();
    (!names.is_empty()).then(|| names.join("+"))
}

/// AMD Adrenalin legt die Taste „Instant Replay speichern" als Text ab (z. B. "Ctrl+Shift+S").
fn amd_save_hotkey() -> Option<String> {
    let value: String = RegKey::predef(HKEY_CURRENT_USER).open_subkey(AMD_KEY).ok()?.get_value("SaveInstantReplayHotkey").ok()?;
    let value = value.trim().to_string();
    (!value.is_empty() && !value.eq_ignore_ascii_case("none") && parse_hotkey(&value).is_ok()).then_some(value)
}

pub fn default_clip_dir(clipper: Clipper, videos: &Path) -> PathBuf {
    match clipper {
        Clipper::Nvidia => nvidia_clip_dir().unwrap_or_else(|| videos.to_path_buf()),
        Clipper::Medal => videos.join("Medal").join("Clips"),
        Clipper::Amd => videos.join("Radeon ReLive"),
        Clipper::SelfClip => videos.join("FIB Self-Clip"),
    }
}

/// Wie viele Sekunden das Programm rückwirkend speichert. NVIDIA legt das in
/// `DVRBufferLen` ab; Medal nicht lesbar – dort gilt die Einstellung der App.
pub fn replay_seconds(clipper: Clipper) -> Option<u32> {
    match clipper {
        Clipper::Nvidia => Some(u32::from_le_bytes(nvidia_binary("DVRBufferLen")?.get(..4)?.try_into().ok()?)).filter(|s| *s >= 15),
        Clipper::Medal | Clipper::Amd | Clipper::SelfClip => None,
    }
}

pub fn default_hotkey(clipper: Clipper) -> String {
    match clipper {
        Clipper::Nvidia => nvidia_save_hotkey().unwrap_or_else(|| "Alt+F10".into()),
        // Medal legt die Taste nicht lesbar ab; F8 ist der Standard.
        Clipper::Medal => "F8".into(),
        Clipper::Amd => amd_save_hotkey().unwrap_or_else(|| "Ctrl+Shift+S".into()),
        // Self-Clip speichert direkt, ohne Taste.
        Clipper::SelfClip => String::new(),
    }
}

// ── Tastenkürzel ─────────────────────────────────────────────────────

fn vk_name(vk: u16) -> Option<String> {
    Some(match vk {
        VK_SHIFT => "Shift".into(),
        VK_CONTROL => "Ctrl".into(),
        VK_MENU => "Alt".into(),
        VK_LWIN | VK_RWIN => "Win".into(),
        0x70..=0x87 => format!("F{}", vk - 0x6F),
        0x30..=0x39 | 0x41..=0x5A => char::from(vk as u8).to_string(),
        _ => named_keys().iter().find(|(_, code)| *code == vk)?.0.to_string(),
    })
}

fn named_keys() -> &'static [(&'static str, u16)] {
    &[
        ("Space", 0x20),
        ("PageUp", 0x21),
        ("PageDown", 0x22),
        ("End", 0x23),
        ("Home", 0x24),
        ("Insert", 0x2D),
        ("Delete", 0x2E),
        ("Pause", 0x13),
        ("PrintScreen", 0x2C),
    ]
}

/// "Alt+F10" → [VK_MENU, VK_F10]. Groß-/Kleinschreibung egal.
pub fn parse_hotkey(text: &str) -> Result<Vec<u16>, String> {
    let keys = text
        .split('+')
        .map(|part| {
            let part = part.trim();
            let upper = part.to_ascii_uppercase();
            match upper.as_str() {
                "CTRL" | "CONTROL" | "STRG" => Some(VK_CONTROL),
                "SHIFT" | "UMSCHALT" => Some(VK_SHIFT),
                "ALT" => Some(VK_MENU),
                "WIN" | "SUPER" => Some(VK_LWIN),
                _ if upper.len() == 1 && upper.chars().all(|c| c.is_ascii_alphanumeric()) => {
                    Some(upper.as_bytes()[0] as u16)
                }
                _ if upper.starts_with('F') => upper[1..]
                    .parse::<u16>()
                    .ok()
                    .filter(|n| (1..=24).contains(n))
                    .map(|n| 0x6F + n),
                _ => named_keys().iter().find(|(name, _)| name.eq_ignore_ascii_case(part)).map(|(_, vk)| *vk),
            }
            .ok_or_else(|| format!("Unbekannte Taste „{part}“"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    if keys.is_empty() {
        return Err("Keine Taste angegeben".into());
    }
    Ok(keys)
}

fn key_input(vk: u16, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: unsafe { MapVirtualKeyW(vk as u32, MAPVK_VK_TO_VSC) } as u16,
                dwFlags: if up { KEYEVENTF_KEYUP } else { 0 },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

fn is_down(vk: u16) -> bool {
    unsafe { GetAsyncKeyState(vk as i32) as u16 & 0x8000 != 0 }
}

/// Drückt das Speicherkürzel des Clip-Programms. Vorher wird gewartet, bis die
/// Modifier der Bodycam-Taste losgelassen sind – sonst sähe das Programm z. B.
/// Strg+Umschalt+Alt+F10 statt Alt+F10.
pub fn press_hotkey(keys: &[u16]) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_millis(1500);
    while [VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN].iter().any(|&vk| is_down(vk)) {
        if Instant::now() >= deadline {
            return Err("Bitte die Tasten der Aufnahme-Tastenkombination loslassen und erneut versuchen.".into());
        }
        thread::sleep(Duration::from_millis(15));
    }

    send_hotkey(keys, |inputs| unsafe {
        SendInput(inputs.len() as u32, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32)
    }, || thread::sleep(Duration::from_millis(40)))
}

fn send_hotkey(keys: &[u16], mut send: impl FnMut(&[INPUT]) -> u32, hold: impl FnOnce()) -> Result<(), String> {
    if keys.is_empty() { return Err("Keine Speichertaste angegeben".into()); }
    let down: Vec<_> = keys.iter().map(|&vk| key_input(vk, false)).collect();
    let pressed = (send(&down) as usize).min(keys.len());
    // Auch bei unvollständiger Eingabe die bereits gedrückten Tasten lösen.
    if pressed > 0 {
        if pressed == keys.len() { hold(); }
        let up: Vec<_> = keys[..pressed].iter().rev().map(|&vk| key_input(vk, true)).collect();
        let released = (send(&up) as usize).min(up.len());
        if released < up.len() && send(&up[released..]) as usize != up.len() - released {
            return Err("Windows konnte die Speichertasten nicht vollständig loslassen. Bitte die Tasten einmal selbst drücken und loslassen.".into());
        }
    }
    if pressed != keys.len() {
        return Err("Windows hat die Speichertaste nicht vollständig an das Clip-Programm übergeben. Prüfe, ob Spiel, Clip-Programm und FIB Desktop mit derselben Berechtigungsstufe laufen.".into());
    }
    Ok(())
}

// ── Clip finden ──────────────────────────────────────────────────────

pub fn is_video(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| VIDEO_EXTENSIONS.iter().any(|v| v.eq_ignore_ascii_case(ext)))
}

/// Neueste Videodatei unter `dir` (bis drei Ebenen tief: Programme sortieren nach Spiel).
fn newest_video(dir: &Path, depth: u8, best: &mut Option<(SystemTime, PathBuf)>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            if depth > 0 {
                newest_video(&path, depth - 1, best);
            }
        } else if is_video(&path) {
            if let Ok(modified) = meta.modified() {
                if best.as_ref().is_none_or(|(time, _)| modified > *time) {
                    *best = Some((modified, path));
                }
            }
        }
    }
}

/// Fertig geschrieben = Größe stabil und kein anderes Programm hält die Datei offen.
fn is_finished(path: &Path, last_size: &mut u64) -> bool {
    use std::os::windows::fs::OpenOptionsExt;
    let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let stable = size > 0 && size == *last_size;
    *last_size = size;
    stable && fs::OpenOptions::new().read(true).share_mode(0).open(path).is_ok()
}

/// Wartet auf den Clip, den das Programm nach `since` ablegt.
pub fn wait_for_new_clip(dir: &Path, since: SystemTime, timeout: Duration) -> Result<PathBuf, String> {
    if !dir.is_dir() {
        return Err(format!("Clip-Ordner nicht gefunden: {}", dir.display()));
    }
    let deadline = Instant::now() + timeout;
    let mut candidate: Option<PathBuf> = None;
    let mut last_size = 0;
    while Instant::now() < deadline {
        thread::sleep(Duration::from_millis(500));
        let mut best = None;
        newest_video(dir, 3, &mut best);
        if let Some((modified, path)) = best {
            if modified >= since {
                if candidate.as_ref() != Some(&path) {
                    candidate = Some(path.clone());
                    last_size = 0;
                }
                if is_finished(&path, &mut last_size) {
                    return Ok(path);
                }
            }
        }
    }
    Err(if candidate.is_some() {
        "Der Clip wird noch geschrieben – bitte gleich über „Clip auswählen“ hochladen.".into()
    } else {
        "Kein neuer Clip gefunden. Läuft das Clip-Programm und ist die Speichertaste richtig eingestellt?".into()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn reports_blocked_input_without_waiting_for_a_clip() {
        let error = send_hotkey(&[VK_CONTROL, VK_SHIFT, 0x53], |_| 0, || panic!("Keine Taste gedrückt")).unwrap_err();
        assert!(error.contains("Speichertaste nicht vollständig"));
    }

    #[test]
    fn releases_partially_sent_hotkeys() {
        let mut calls = 0;
        let error = send_hotkey(&[VK_CONTROL, VK_SHIFT, 0x53], |inputs| {
            calls += 1;
            if calls == 1 { return 2; }
            assert_eq!(inputs.len(), 2);
            unsafe {
                assert_eq!(inputs[0].Anonymous.ki.wVk, VK_SHIFT);
                assert_eq!(inputs[1].Anonymous.ki.wVk, VK_CONTROL);
                assert!(inputs.iter().all(|input| input.Anonymous.ki.dwFlags == KEYEVENTF_KEYUP));
            }
            inputs.len() as u32
        }, || panic!("Unvollständige Kombination nicht halten")).unwrap_err();
        assert_eq!(calls, 2);
        assert!(error.contains("Speichertaste nicht vollständig"));
    }

    #[test]
    fn sends_and_releases_complete_hotkey() {
        let mut calls = 0;
        let mut held = false;
        send_hotkey(&[VK_CONTROL, VK_SHIFT, 0x53], |inputs| {
            calls += 1;
            assert_eq!(inputs.len(), 3);
            unsafe {
                assert_eq!(inputs[0].Anonymous.ki.wVk, if calls == 1 { VK_CONTROL } else { 0x53 });
                assert!(inputs.iter().all(|input| input.Anonymous.ki.dwFlags == if calls == 1 { 0 } else { KEYEVENTF_KEYUP }));
            }
            inputs.len() as u32
        }, || held = true).unwrap();
        assert!(held);
        assert_eq!(calls, 2);
    }

    #[test]
    fn retries_only_the_keys_that_were_not_released() {
        let mut calls = 0;
        send_hotkey(&[VK_CONTROL, 0x53], |inputs| {
            calls += 1;
            match calls {
                1 => 2,
                2 => 1,
                _ => {
                    assert_eq!(inputs.len(), 1);
                    unsafe { assert_eq!(inputs[0].Anonymous.ki.wVk, VK_CONTROL); }
                    1
                }
            }
        }, || {}).unwrap();
        assert_eq!(calls, 3);
    }

    #[test]
    fn reports_keys_that_windows_could_not_release() {
        let mut calls = 0;
        let error = send_hotkey(&[VK_CONTROL, 0x53], |_| {
            calls += 1;
            if calls == 1 { 2 } else { 0 }
        }, || {}).unwrap_err();
        assert_eq!(calls, 3);
        assert!(error.contains("nicht vollständig loslassen"));
    }

    #[test]
    fn parses_hotkeys() {
        assert_eq!(parse_hotkey("Alt+F10").unwrap(), vec![VK_MENU, 0x79]);
        assert_eq!(parse_hotkey("ctrl+shift+b").unwrap(), vec![VK_CONTROL, VK_SHIFT, 0x42]);
        assert_eq!(parse_hotkey("F8").unwrap(), vec![0x77]);
        assert_eq!(parse_hotkey("Strg+Umschalt+1").unwrap(), vec![VK_CONTROL, VK_SHIFT, 0x31]);
        assert!(parse_hotkey("Alt+Banane").is_err());
    }

    #[test]
    fn names_round_trip() {
        for hotkey in ["Alt+F10", "Ctrl+Shift+B", "F8", "Alt+PageUp"] {
            let names: Vec<String> = parse_hotkey(hotkey).unwrap().into_iter().filter_map(vk_name).collect();
            assert_eq!(names.join("+"), hotkey);
        }
    }

    #[test]
    fn reads_nvidia_defaults_from_registry() {
        // Ohne NVIDIA-App greift der Fallback; beides muss ein gültiges Kürzel ergeben.
        let hotkey = default_hotkey(Clipper::Nvidia);
        println!("NVIDIA-Speichertaste: {hotkey}");
        assert!(parse_hotkey(&hotkey).is_ok());
        println!("NVIDIA-Ordner: {}", default_clip_dir(Clipper::Nvidia, Path::new(r"C:\Videos")).display());
    }

    #[test]
    fn finds_clip_once_it_is_written() {
        let dir = std::env::temp_dir().join(format!("fib-clip-test-{}", std::process::id()));
        let game = dir.join("Grand Theft Auto V");
        fs::create_dir_all(&game).unwrap();
        fs::write(game.join("alt.mp4"), b"alter clip").unwrap();
        thread::sleep(Duration::from_millis(50));
        let since = SystemTime::now();

        // Wie das Clip-Programm: Datei anlegen und eine Weile weiterschreiben.
        let target = game.join("neu.mp4");
        let writer = {
            let target = target.clone();
            thread::spawn(move || {
                let mut file = fs::File::create(&target).unwrap();
                for _ in 0..5 {
                    file.write_all(&[0u8; 64 * 1024]).unwrap();
                    file.flush().unwrap();
                    thread::sleep(Duration::from_millis(300));
                }
            })
        };

        let found = wait_for_new_clip(&dir, since, Duration::from_secs(10)).unwrap();
        writer.join().unwrap();
        assert_eq!(found, target);
        assert_eq!(fs::metadata(&found).unwrap().len(), 5 * 64 * 1024, "darf erst nach dem Schreiben melden");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reports_missing_clip() {
        let dir = std::env::temp_dir().join(format!("fib-clip-empty-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let error = wait_for_new_clip(&dir, SystemTime::now(), Duration::from_secs(1)).unwrap_err();
        assert!(error.contains("Kein neuer Clip"));
        let _ = fs::remove_dir_all(&dir);
    }
}

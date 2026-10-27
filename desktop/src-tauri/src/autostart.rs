//! Autostart für das aktuelle Windows-Konto, ohne Administratorrechte.
use std::{io, path::Path};

use winreg::{enums::{HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE}, RegKey};

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const VALUE_NAME: &str = "FIB Desktop";

pub const AVAILABLE: bool = !cfg!(debug_assertions);

fn command(path: &Path) -> String {
    // Auch Installationspfade mit Leerzeichen müssen als genau eine EXE gelten.
    format!("\"{}\"", path.display())
}

fn write_entry(key: &RegKey, executable: Option<&Path>) -> io::Result<()> {
    match executable {
        Some(path) => key.set_value(VALUE_NAME, &command(path)),
        None => match key.delete_value(VALUE_NAME) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            result => result,
        },
    }
}

pub fn sync(enabled: bool) -> Result<(), String> {
    // Ein lokaler Entwicklungsbuild darf keinen installierten Autostart überschreiben.
    if !AVAILABLE { return Ok(()); }
    let root = RegKey::predef(HKEY_CURRENT_USER);
    let key = root.create_subkey_with_flags(RUN_KEY, KEY_SET_VALUE)
        .map_err(|e| format!("Windows-Autostart kann nicht geändert werden: {e}"))?.0;
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    write_entry(&key, enabled.then_some(executable.as_path()))
        .map_err(|e| format!("Windows-Autostart kann nicht geändert werden: {e}"))
}

/// Fehler auch nach dem Programmstart in den Einstellungen sichtbar machen.
pub fn status_error(enabled: bool) -> Option<String> {
    if !AVAILABLE { return None; }
    let result = (|| -> Result<bool, String> {
        let key = match RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(RUN_KEY, KEY_QUERY_VALUE) {
            Ok(key) => key,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(!enabled),
            Err(e) => return Err(e.to_string()),
        };
        let actual: Option<String> = match key.get_value(VALUE_NAME) {
            Ok(value) => Some(value),
            Err(e) if e.kind() == io::ErrorKind::NotFound => None,
            Err(e) => return Err(e.to_string()),
        };
        let expected = if enabled {
            Some(command(&std::env::current_exe().map_err(|e| e.to_string())?))
        } else { None };
        Ok(actual == expected)
    })();
    match result {
        Ok(true) => None,
        Ok(false) => Some("Autostart stimmt nicht mit Windows überein. Schalte ihn aus und wieder ein.".into()),
        Err(error) => Some(format!("Windows-Autostart konnte nicht geprüft werden: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn executable_paths_are_quoted_including_spaces_and_unicode() {
        assert_eq!(command(Path::new(r"C:\Programme\FIB Desktop\fib-desktop.exe")), r#""C:\Programme\FIB Desktop\fib-desktop.exe""#);
        assert_eq!(command(Path::new(r"C:\Users\Jörg\FIB Desktop.exe")), r#""C:\Users\Jörg\FIB Desktop.exe""#);
    }

    #[test]
    fn enable_update_and_disable_only_our_entry() {
        // Absichtlich ein isolierter Testschlüssel, niemals der echte Run-Schlüssel.
        let root = RegKey::predef(HKEY_CURRENT_USER);
        let path = format!(r"Software\FIB Desktop Tests\Autostart-{}", std::process::id());
        let (key, _) = root.create_subkey(&path).unwrap();
        let result = std::panic::catch_unwind(|| {
            key.set_value("Other application", &"unchanged").unwrap();
            write_entry(&key, None).unwrap();
            for executable in [r"C:\Old Folder\fib.exe", r"C:\New Folder\fib.exe"] {
                write_entry(&key, Some(Path::new(executable))).unwrap();
                assert_eq!(key.get_value::<String, _>(VALUE_NAME).unwrap(), command(Path::new(executable)));
            }
            write_entry(&key, None).unwrap();
            write_entry(&key, None).unwrap();
            assert_eq!(key.get_value::<String, _>(VALUE_NAME).unwrap_err().kind(), io::ErrorKind::NotFound);
            assert_eq!(key.get_value::<String, _>("Other application").unwrap(), "unchanged");
        });
        drop(key);
        root.delete_subkey_all(&path).unwrap();
        if let Err(panic) = result { std::panic::resume_unwind(panic); }
    }
}
